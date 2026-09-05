import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {fileURLToPath} from "node:url";

import {
	assertCampaignRuleWriteFence,
	prepareCampaignTransitionData,
} from "../../../server/src/campaign-rule-authority.js";
import {createDefaultCampaignRulesPolicy} from "../../../js/hub/hub-campaign-rules.js";
import {getPublicCampaignRulesVersion} from "../../../server/src/campaign-content.js";
import {MemoryHubStore} from "../../../server/src/memory-hub-store.js";

const REPO_ROOT = resolve(fileURLToPath(new URL("../../..", import.meta.url)));

function rulesVersion () {
	return {
		id: "rules-current",
		version: 4,
		schemaVersion: 2,
		catalogVersion: 1,
		rules: createDefaultCampaignRulesPolicy(),
	};
}

function characterData (rulesVersionId) {
	return {
		settings: {enableTgtt: true},
		carry: {
			schemaVersion: 1,
			basis: {
				kind: "campaign",
				rulesVersionId,
				brewBundleHash: null,
				settingsDigest: "digest",
			},
		},
	};
}

describe("campaign rule write authority", () => {
	it("accepts the active immutable policy identity", () => {
		expect(assertCampaignRuleWriteFence({
			rulesVersion: rulesVersion(),
			data: characterData("rules-current"),
			protocolVersion: "4",
		})).toMatchObject({
			status: "compliant",
			policyIdentity: {id: "rules-current", version: 4},
		});
	});

	it("rejects a stale policy identity before a write can commit", () => {
		expect(() => assertCampaignRuleWriteFence({
			rulesVersion: rulesVersion(),
			data: characterData("rules-old"),
			protocolVersion: "4",
		})).toThrow(expect.objectContaining({
			code: "POLICY_VERSION_STALE",
			status: 409,
		}));
	});

	it.each([
		["a detached basis", {...characterData("rules-current"), carry: {...characterData("rules-current").carry, basis: {kind: "detached", settingsDigest: "digest"}}}],
		["a missing policy identity", characterData(null)],
	])("rejects %s instead of downgrading the fence", (_label, data) => {
		expect(() => assertCampaignRuleWriteFence({
			rulesVersion: rulesVersion(),
			data,
			protocolVersion: "4",
		})).toThrow(expect.objectContaining({code: "POLICY_VERSION_STALE"}));
	});

	it("rejects protocol 3 before evaluating a schema-v2 write", () => {
		expect(() => assertCampaignRuleWriteFence({
			rulesVersion: rulesVersion(),
			data: characterData("rules-current"),
			protocolVersion: "3",
		})).toThrow(expect.objectContaining({code: "RULES_PROTOCOL_UNSUPPORTED"}));
	});

	it("requires an explicit protocol proof for schema-v2 writes", () => {
		expect(() => assertCampaignRuleWriteFence({
			rulesVersion: rulesVersion(),
			data: characterData("rules-current"),
		})).toThrow(expect.objectContaining({code: "RULES_PROTOCOL_UNSUPPORTED"}));
	});

	it("keeps legacy clients compatible when no schema-v2 policy-sensitive carry write exists", () => {
		expect(assertCampaignRuleWriteFence({
			rulesVersion: {...rulesVersion(), schemaVersion: 1, rules: {enableTgtt: false}},
			data: {settings: {enableTgtt: true}},
		})).toBeNull();
	});

	it("reads pre-enforcement schema-v2 carry modes without rewriting their immutable labels", () => {
		const historical = rulesVersion();
		historical.rules.rules.find(rule => rule.id === "tgtt.carry-weight").mode = "advisory";
		historical.rules.rules.find(rule => rule.id === "tgtt.encumbrance-tiers").mode = "advisory";

		expect(getPublicCampaignRulesVersion(historical)).toEqual(expect.objectContaining({
			policySummary: expect.objectContaining({
				rules: expect.arrayContaining([
					expect.objectContaining({id: "tgtt.carry-weight", supportLabel: "Advisory"}),
					expect.objectContaining({id: "tgtt.encumbrance-tiers", supportLabel: "Advisory"}),
				]),
			}),
			ruleDecision: expect.objectContaining({
				status: "compliant",
				appliedRules: expect.arrayContaining([
					expect.objectContaining({id: "tgtt.carry-weight", mode: "advisory"}),
					expect.objectContaining({id: "tgtt.encumbrance-tiers", mode: "advisory"}),
				]),
			}),
		}));
	});

	it("uses the same authority helper in memory and PostgreSQL transactions", () => {
		for (const file of ["server/src/memory-hub-store.js", "server/src/postgres-hub-store.js"]) {
			const source = readFileSync(resolve(REPO_ROOT, file), "utf8");
			expect(source).toContain("assertCampaignRuleWriteFence({");
			expect(source).toContain("prepareCampaignTransitionData({");
		}
	});

	it("drops a source carry summary when a transition crosses policy identity", () => {
		const source = characterData("rules-old");
		const prepared = prepareCampaignTransitionData({data: source, rulesVersion: rulesVersion()});
		expect(prepared).not.toBe(source);
		expect(prepared.carry).toBeUndefined();
		expect(source.carry.basis.rulesVersionId).toBe("rules-old");
	});

	it("keeps a current carry summary for a destination with the same immutable policy", () => {
		const source = characterData("rules-current");
		const prepared = prepareCampaignTransitionData({data: source, rulesVersion: rulesVersion()});
		expect(prepared.carry).toEqual(source.carry);
	});

	it("rejects a stale schema-v2 create in the memory store without a partial character write", async () => {
		const store = new MemoryHubStore();
		const account = await store.pUpsertOAuthAccount({provider: "test", providerSubject: "rule-fence", displayName: "Rule Fence"});
		const campaign = (await store.pCreateCampaign({accountId: account.id, name: "Rules", idempotencyKey: "campaign"})).campaign;
		const active = await store.pCreateAndActivateRulesPolicy({
			accountId: account.id,
			campaignId: campaign.id,
			policy: createDefaultCampaignRulesPolicy(),
			expectedActiveRulesVersionId: null,
			idempotencyKey: "rules",
		});
		const eventCountBeforeInvalidCreates = store._events.length;
		for (const {label, basis, protocolVersion, code} of [
			{label: "missing identity", basis: {kind: "campaign", settingsDigest: "digest"}, protocolVersion: "4", code: "POLICY_VERSION_STALE"},
			{label: "detached", basis: {kind: "detached", settingsDigest: "digest"}, protocolVersion: "4", code: "POLICY_VERSION_STALE"},
			{label: "stale identity", basis: {kind: "campaign", rulesVersionId: "rules-old", settingsDigest: "digest"}, protocolVersion: "4", code: "POLICY_VERSION_STALE"},
			{label: "old protocol", basis: {kind: "campaign", rulesVersionId: active.rulesVersion.id, settingsDigest: "digest"}, protocolVersion: "3", code: "RULES_PROTOCOL_UNSUPPORTED"},
			{label: "omitted protocol", basis: {kind: "campaign", rulesVersionId: active.rulesVersion.id, settingsDigest: "digest"}, protocolVersion: null, code: "RULES_PROTOCOL_UNSUPPORTED"},
		]) {
			await expect(store.pCreateCharacter({
				accountId: account.id,
				campaignId: campaign.id,
				clientImportId: `invalid-${label}`,
				schemaVersion: 1,
				data: {carry: {schemaVersion: 1, basis}},
				protocolVersion,
				idempotencyKey: `invalid-create-${label}`,
			})).rejects.toEqual(expect.objectContaining({code}));
		}
		expect(store._characters.size).toBe(0);
		expect(store._events).toHaveLength(eventCountBeforeInvalidCreates);
		await expect(store.pCreateCharacter({
			accountId: account.id,
			campaignId: campaign.id,
			clientImportId: "stale",
			schemaVersion: 1,
			data: characterData("rules-old"),
			protocolVersion: "4",
			idempotencyKey: "stale-create",
		})).rejects.toEqual(expect.objectContaining({code: "POLICY_VERSION_STALE"}));
		expect(store._characters.size).toBe(0);
		const created = await store.pCreateCharacter({
			accountId: account.id,
			campaignId: campaign.id,
			clientImportId: "current",
			schemaVersion: 1,
			data: characterData(active.rulesVersion.id),
			protocolVersion: "4",
			idempotencyKey: "current-create",
		});
		expect(created.character.campaignId).toBe(campaign.id);

		const destinationCampaign = (await store.pCreateCampaign({
			accountId: account.id,
			name: "Destination",
			idempotencyKey: "destination-campaign",
		})).campaign;
		await store.pCreateAndActivateRulesPolicy({
			accountId: account.id,
			campaignId: destinationCampaign.id,
			policy: createDefaultCampaignRulesPolicy(),
			expectedActiveRulesVersionId: null,
			idempotencyKey: "destination-rules",
		});
		const detached = await store.pCreateCharacter({
			accountId: account.id,
			campaignId: null,
			clientImportId: "detached-attach",
			schemaVersion: 1,
			data: {name: "Detached", carry: {schemaVersion: 1, basis: {kind: "detached"}}},
			idempotencyKey: "detached-attach-create",
		});
		const attached = await store.pMoveCharacter({
			accountId: account.id,
			characterId: detached.character.id,
			campaignId: destinationCampaign.id,
			idempotencyKey: "detached-attach-move",
		});
		expect(attached.character.data.carry).toBeUndefined();
		const cloned = await store.pCloneCharacter({
			accountId: account.id,
			characterId: created.character.id,
			campaignId: destinationCampaign.id,
			idempotencyKey: "destination-clone",
		});
		expect(cloned.character.data.carry).toBeUndefined();
		expect(store._characters.get(created.character.id).data.carry).toBeDefined();

		const moved = await store.pMoveCharacter({
			accountId: account.id,
			characterId: cloned.character.id,
			campaignId: campaign.id,
			idempotencyKey: "destination-move",
		});
		expect(moved.character.data.carry).toBeUndefined();
	});

	it("fences stale and old-protocol memory patches without revision or event changes", async () => {
		const store = new MemoryHubStore();
		const account = await store.pUpsertOAuthAccount({provider: "test", providerSubject: "rule-patch", displayName: "Rule Patch"});
		const session = await store.pCreateSession({
			accountId: account.id,
			tokenHash: "a".repeat(64),
			expiresAt: new Date(Date.now() + 60_000),
		});
		const campaign = (await store.pCreateCampaign({accountId: account.id, name: "Rules", idempotencyKey: "patch-campaign"})).campaign;
		const active = await store.pCreateAndActivateRulesPolicy({
			accountId: account.id,
			campaignId: campaign.id,
			policy: createDefaultCampaignRulesPolicy(),
			expectedActiveRulesVersionId: null,
			idempotencyKey: "patch-rules",
		});
		const created = await store.pCreateCharacter({
			accountId: account.id,
			campaignId: campaign.id,
			clientImportId: "patch-character",
			schemaVersion: 1,
			data: characterData(active.rulesVersion.id),
			protocolVersion: "4",
			idempotencyKey: "patch-create",
		});
		const lease = await store.pAcquireCharacterLease({
			accountId: account.id,
			sessionId: session.id,
			characterId: created.character.id,
		});
		const eventCount = store._events.length;
		for (const {basis, protocolVersion} of [
			{basis: {kind: "campaign", settingsDigest: "digest"}, protocolVersion: "4"},
			{basis: {kind: "detached", settingsDigest: "digest"}, protocolVersion: "4"},
			{basis: {kind: "campaign", rulesVersionId: "rules-stale", settingsDigest: "digest"}, protocolVersion: "4"},
			{basis: {kind: "campaign", rulesVersionId: active.rulesVersion.id, settingsDigest: "digest"}, protocolVersion: null},
			{basis: {kind: "campaign", rulesVersionId: active.rulesVersion.id, settingsDigest: "digest"}, protocolVersion: "3"},
		]) {
			await expect(store.pPatchCharacter({
				accountId: account.id,
				sessionId: session.id,
				characterId: created.character.id,
				baseRevision: 1,
				leaseEpoch: lease.epoch,
				patches: [{op: "replace", path: "/carry", value: {schemaVersion: 1, basis}}],
				protocolVersion,
				idempotencyKey: `patch-${protocolVersion}-${basis.kind}`,
			})).rejects.toEqual(expect.objectContaining({
				code: expect.stringMatching(/POLICY_VERSION_STALE|RULES_PROTOCOL_UNSUPPORTED/),
			}));
		}
		const unchanged = store._characters.get(created.character.id);
		expect(unchanged.revision).toBe(1);
		expect(store._events).toHaveLength(eventCount);
		const patched = await store.pPatchCharacter({
			accountId: account.id,
			sessionId: session.id,
			characterId: created.character.id,
			baseRevision: 1,
			leaseEpoch: lease.epoch,
			patches: [{op: "replace", path: "/carry", value: characterData(active.rulesVersion.id).carry}],
			protocolVersion: "4",
			idempotencyKey: "patch-current",
		});
		expect(patched.character.revision).toBe(2);
		expect(store._events.length).toBeGreaterThan(eventCount);
	});

	it("returns an active existing import before fencing discarded incoming data", async () => {
		const store = new MemoryHubStore();
		const account = await store.pUpsertOAuthAccount({provider: "test", providerSubject: "existing-import", displayName: "Existing Import"});
		const campaign = (await store.pCreateCampaign({accountId: account.id, name: "Rules", idempotencyKey: "existing-campaign"})).campaign;
		const first = await store.pCreateAndActivateRulesPolicy({
			accountId: account.id,
			campaignId: campaign.id,
			policy: createDefaultCampaignRulesPolicy(),
			expectedActiveRulesVersionId: null,
			idempotencyKey: "existing-rules-1",
		});
		const created = await store.pCreateCharacter({
			accountId: account.id,
			campaignId: campaign.id,
			clientImportId: "same-import",
			schemaVersion: 1,
			data: characterData(first.rulesVersion.id),
			protocolVersion: "4",
			idempotencyKey: "existing-create",
		});
		const changed = createDefaultCampaignRulesPolicy();
		changed.rules.find(rule => rule.id === "tgtt.carry-weight").parameters.enabled = false;
		changed.rules.find(rule => rule.id === "tgtt.encumbrance-tiers").parameters.enabled = false;
		await store.pCreateAndActivateRulesPolicy({
			accountId: account.id,
			campaignId: campaign.id,
			policy: changed,
			expectedActiveRulesVersionId: first.rulesVersion.id,
			idempotencyKey: "existing-rules-2",
		});

		const replayed = await store.pCreateCharacter({
			accountId: account.id,
			campaignId: campaign.id,
			clientImportId: "same-import",
			schemaVersion: 1,
			data: characterData(first.rulesVersion.id),
			protocolVersion: "4",
			idempotencyKey: "existing-replay",
		});
		expect(replayed.character.id).toBe(created.character.id);
		expect(replayed.character.revision).toBe(created.character.revision);

		await store.pArchiveCharacter({accountId: account.id, characterId: created.character.id, idempotencyKey: "existing-archive"});
		await expect(store.pCreateCharacter({
			accountId: account.id,
			campaignId: campaign.id,
			clientImportId: "same-import",
			schemaVersion: 1,
			data: characterData(first.rulesVersion.id),
			protocolVersion: "4",
			idempotencyKey: "existing-reactivate",
		})).rejects.toEqual(expect.objectContaining({code: "POLICY_VERSION_STALE"}));
		expect(store._characters.get(created.character.id).status).toBe("archived");
	});
});
