import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {fileURLToPath} from "node:url";

import {assertCampaignRuleWriteFence} from "../../../server/src/campaign-rule-authority.js";
import {createDefaultCampaignRulesPolicy} from "../../../js/hub/hub-campaign-rules.js";
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

	it("uses the same authority helper in memory and PostgreSQL transactions", () => {
		for (const file of ["server/src/memory-hub-store.js", "server/src/postgres-hub-store.js"]) {
			const source = readFileSync(resolve(REPO_ROOT, file), "utf8");
			expect(source).toContain("assertCampaignRuleWriteFence({");
		}
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
	});
});
