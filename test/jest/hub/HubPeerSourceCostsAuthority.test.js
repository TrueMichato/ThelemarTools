import crypto from "node:crypto";

import {createHubApp} from "../../../server/src/app.js";
import {MemoryHubStore} from "../../../server/src/memory-hub-store.js";
import {createPeerSourceCostsGate, isCanonicalEqual} from "../../../server/src/peer-source-cost-authority.js";
import {createSemanticOperationRegistry} from "../../../server/src/semantic-operation-registry.js";

const SOURCE_ENTITY = {type: "spell", uid: "cure wounds|phb", version: "phb-2014-v1"};
const EFFECT_TEMPLATE_ID = "spell.cure-wounds.heal";

function idempotency (commandId, request) {
	return {
		key: commandId,
		requestHash: crypto.createHash("sha256").update(JSON.stringify(request)).digest("hex"),
	};
}

function characterData ({name, hp = 5, hasCureWounds = false, slots = 1}) {
	return {
		name,
		abilities: {str: 10, dex: 10, con: 10, int: 10, wis: 16, cha: 10},
		abilityBonuses: {str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0},
		classes: [{name: "Cleric", source: "PHB", level: 1, casterProgression: "full", spellcastingAbility: "wis"}],
		features: [],
		hp: {current: hp, max: 30, effectiveMax: 30, temp: 0},
		conditions: [],
		inventory: [],
		spellcasting: {
			ability: "wis",
			spellsKnown: hasCureWounds
				? [{name: "Cure Wounds", source: "PHB", level: 1, prepared: true, sourceClass: "Cleric", sourceFeature: "Prepared Spells"}]
				: [],
			cantripsKnown: [],
			innateSpells: [],
			spellSlots: {1: {current: slots, max: Math.max(1, slots)}},
			pactSlots: {current: 0, max: 0, level: 0},
		},
	};
}

async function fixture ({sameCharacter = false, slots = 1, gate = true, activateRules = true} = {}) {
	let now = new Date("2026-09-04T00:00:00.000Z");
	let isEnabled = gate;
	const store = new MemoryHubStore({
		fnNow: () => new Date(now),
		peerSourceCostsEnabled: () => isEnabled,
		semanticProposalTtlMs: 60_000,
	});
	const createActor = async label => {
		const identity = {
			provider: "github",
			providerSubject: `${label}-${crypto.randomUUID()}`,
			login: label,
			displayName: label,
		};
		const account = await store.pUpsertOAuthAccount(identity);
		const session = await store.pCreateSession({
			accountId: account.id,
			tokenHash: crypto.randomBytes(32).toString("hex"),
			expiresAt: new Date(now.getTime() + 3_600_000),
		});
		return {account, session, identity};
	};
	const dm = await createActor("DM");
	const sourceOwner = await createActor("Source owner");
	const targetOwner = sameCharacter ? sourceOwner : await createActor("Target owner");
	const other = await createActor("Other");
	const outsider = await createActor("Outsider");
	const campaign = (await store.pCreateCampaign({
		accountId: dm.account.id,
		name: "Peer costs",
		idempotencyKey: crypto.randomUUID(),
	})).campaign;
	const join = async ({actor, role = "player"}) => {
		const tokenHash = crypto.randomBytes(32).toString("hex");
		await store.pCreateInvite({
			accountId: dm.account.id,
			campaignId: campaign.id,
			role,
			tokenHash,
			expiresAt: new Date(now.getTime() + 60_000),
			maxUses: 1,
			idempotencyKey: crypto.randomUUID(),
		});
		return (await store.pRedeemInvite({
			accountId: actor.account.id,
			tokenHash,
			idempotencyKey: crypto.randomUUID(),
		})).membership;
	};
	const sourceOwnerMembership = await join({actor: sourceOwner});
	const targetOwnerMembership = sameCharacter ? sourceOwnerMembership : await join({actor: targetOwner});
	const otherMembership = await join({actor: other});
	const rulesVersion = (await store.pCreateRulesVersion({
		accountId: dm.account.id,
		campaignId: campaign.id,
		schemaVersion: 1,
		rules: {},
		idempotencyKey: crypto.randomUUID(),
	})).rulesVersion;
	if (activateRules) {
		await store.pActivateRulesVersion({
			accountId: dm.account.id,
			campaignId: campaign.id,
			rulesVersionId: rulesVersion.id,
			idempotencyKey: crypto.randomUUID(),
		});
	}
	const createCharacter = async ({actor, name, hasCureWounds = false, hp = 5}) => (await store.pCreateCharacter({
		accountId: actor.account.id,
		campaignId: campaign.id,
		data: characterData({name, hp, hasCureWounds, slots}),
		schemaVersion: 1,
		clientImportId: crypto.randomUUID(),
		idempotencyKey: crypto.randomUUID(),
	})).character;
	const source = await createCharacter({
		actor: sourceOwner,
		name: "Aster",
		hasCureWounds: true,
		hp: sameCharacter ? 5 : 20,
	});
	const target = sameCharacter
		? source
		: await createCharacter({actor: targetOwner, name: "Bryn", hp: 5});

	const propose = async ({
		targetCharacter = target,
		sourceCharacter = source,
		actor = sourceOwner,
		commandId = crypto.randomUUID(),
	} = {}) => {
		const request = {
			contractVersion: 1,
			commandId,
			sourceCharacterId: sourceCharacter.id,
			sourceEntity: SOURCE_ENTITY,
			effectTemplateId: EFFECT_TEMPLATE_ID,
			choice: {castLevel: 1},
			targetRef: targetCharacter.targetRef,
			rulesVersionId: rulesVersion.id,
		};
		return store.pCreateStructuredAction({
			accountId: actor.account.id,
			sessionId: actor.session.id,
			campaignId: campaign.id,
			...request,
			protocolVersion: "4",
			idempotencyKey: idempotency(commandId, request),
		});
	};
	const resolve = async ({
		operationId,
		actor = targetOwner,
		decision = "accept",
		commandId = crypto.randomUUID(),
		requestExtra = {},
	} = {}) => {
		const request = {contractVersion: 1, commandId, operationId, decision, ...requestExtra};
		return store.pResolveStructuredAction({
			accountId: actor.account.id,
			sessionId: actor.session.id,
			campaignId: campaign.id,
			actionId: operationId,
			contractVersion: 1,
			commandId,
			decision,
			protocolVersion: "4",
			idempotencyKey: idempotency(commandId, request),
		});
	};
	return {
		store,
		campaign,
		dm,
		sourceOwner,
		targetOwner,
		other,
		otherMembership,
		outsider,
		sourceOwnerMembership,
		targetOwnerMembership,
		rulesVersion,
		source,
		target,
		createCharacter,
		propose,
		resolve,
		setNow: value => now = new Date(value),
		setEnabled: value => isEnabled = value,
	};
}

describe("peer source-cost memory authority", () => {
	it("does not advertise cost-bearing targeting without an active immutable rules version", async () => {
		const ctx = await fixture({activateRules: false});
		const context = await ctx.store.pGetCampaignContext({
			accountId: ctx.sourceOwner.account.id,
			campaignId: ctx.campaign.id,
		});
		expect(context.rulesVersion).toBeNull();
		expect(context.capabilities.peerSourceCosts.enabled).toBe(false);
		expect(await ctx.store.pGetPeerSourceCostsCapability({
			accountId: ctx.sourceOwner.account.id,
			campaignId: ctx.campaign.id,
		})).toMatchObject({enabled: false});
	});

	it("supports an explicit all-campaign rollout gate for isolated test stacks", () => {
		expect(createPeerSourceCostsGate(["*"])("any-campaign")).toBe(true);
		expect(createPeerSourceCostsGate([])("any-campaign")).toBe(false);
	});

	it("compares pinned JSON canonically across PostgreSQL JSONB key ordering", () => {
		expect(isCanonicalEqual(
			{operation: {kind: "hp.heal", arguments: {amount: 4}}, choice: {castLevel: 1}},
			{choice: {castLevel: 1}, operation: {arguments: {amount: 4}, kind: "hp.heal"}},
		)).toBe(true);
		expect(isCanonicalEqual({components: [{level: 1}, {level: 2}]}, {components: [{level: 2}, {level: 1}]}))
			.toBe(false);
	});

	it("atomically spends one slot, heals once, and emits private source plus target legs", async () => {
		const ctx = await fixture();
		const eventStart = ctx.store.getDomainEvents().length;
		const proposed = await ctx.propose();
		const operationId = proposed.operation.operationId;
		const persistedProposal = ctx.store._semanticOperations.get(operationId);
		const healAmount = persistedProposal.arguments.amount;

		expect(proposed.operation).toMatchObject({
			status: "proposed",
			sourceCostState: "pending",
			sourceResult: {
				sourceCharacterId: ctx.source.id,
				sourceCost: {
					version: 1,
					components: [{kind: "spell_slot", pool: "standard", level: 1, amount: 1}],
				},
			},
		});
		expect(ctx.store._characters.get(ctx.source.id).data.spellcasting.spellSlots[1].current).toBe(1);
		expect(persistedProposal.effectResolutionSeed).toMatch(/^[0-9a-f]{64}$/);
		await expect(ctx.store.pListCharacterPendingActions({
			accountId: ctx.targetOwner.account.id,
			campaignId: ctx.campaign.id,
			characterId: ctx.target.id,
		})).resolves.toEqual([expect.objectContaining({
			actionId: operationId,
			contractVersion: 1,
		})]);

		const accepted = await ctx.resolve({operationId});
		expect(accepted.operation).toMatchObject({
			status: "applied",
			sourceCostState: "consumed",
			resultingTargetCharacterRevision: 2,
			appliedEventId: expect.any(String),
		});
		expect(accepted.operation).not.toHaveProperty("sourceResult");
		expect(JSON.stringify(accepted)).not.toContain("spell_slot");
		expect(ctx.store._characters.get(ctx.source.id).data.spellcasting.spellSlots[1].current).toBe(0);
		expect(ctx.store._characters.get(ctx.target.id).data.hp.current).toBe(5 + healAmount);
		expect(ctx.store._characters.get(ctx.source.id).revision).toBe(2);
		expect(ctx.store._characters.get(ctx.target.id).revision).toBe(2);

		const events = ctx.store.getDomainEvents().slice(eventStart);
		expect(events.map(event => event.type)).toEqual([
			"character.operation.proposed",
			"character.operation.source_cost_consumed",
			"character.operation.applied",
			"character.projection.invalidated",
			"character.projection.invalidated",
		]);
		const proposedEvent = events[0];
		expect(Object.keys(proposedEvent.payload).sort()).toEqual([
			"contractVersion",
			"effectDisplaySnapshot",
			"expiresAt",
			"operationId",
			"status",
			"targetDisplaySnapshot",
		]);
		expect(events[1].visibleAccountIds).toContain(ctx.sourceOwner.account.id);
		expect(events[1].visibleAccountIds).not.toContain(ctx.targetOwner.account.id);
		expect(events[2].payload).toMatchObject({leg: "target", operation: {kind: "hp.heal"}});
		expect(accepted.operation.appliedEventId).toBe(events[2].id);
		expect(new Set(accepted.eventIds).size).toBe(accepted.eventIds.length);
	});

	it("makes wounded, full, malformed, and missing target HP indistinguishable until acceptance", async () => {
		const proposalShapes = [];
		for (const scenario of [
			{label: "wounded", hp: {current: 5, max: 30, effectiveMax: 30, temp: 0}, status: "applied"},
			{label: "full", hp: {current: 30, max: 30, effectiveMax: 30, temp: 0}, status: "failed"},
			{label: "malformed", hp: {current: "hidden", max: 30, temp: 0}, status: "failed"},
			{label: "missing", hp: null, status: "failed"},
		]) {
			const ctx = await fixture();
			const target = ctx.store._characters.get(ctx.target.id);
			if (scenario.hp == null) delete target.data.hp;
			else target.data.hp = structuredClone(scenario.hp);
			const sourceBefore = structuredClone(ctx.store._characters.get(ctx.source.id));
			const targetBefore = structuredClone(target);

			const proposed = await ctx.propose();
			proposalShapes.push({
				status: proposed.operation.status,
				sourceCostState: proposed.operation.sourceCostState,
				effectLabel: proposed.operation.presentation.effectLabel,
				targetName: proposed.operation.presentation.targetName,
				canCancel: proposed.operation.capabilities.canCancel,
			});
			expect(ctx.store._characters.get(ctx.source.id)).toEqual(sourceBefore);
			expect(ctx.store._characters.get(ctx.target.id)).toEqual(targetBefore);

			const resolved = await ctx.resolve({operationId: proposed.operation.operationId});
			expect(resolved.operation.status).toBe(scenario.status);
			if (scenario.status === "applied") {
				expect(resolved.operation.sourceCostState).toBe("consumed");
				continue;
			}
			expect(resolved.operation).toMatchObject({
				sourceCostState: "not_consumed",
				failureCode: "TARGET_EFFECT_UNAVAILABLE",
			});
			expect(ctx.store._characters.get(ctx.source.id)).toEqual(sourceBefore);
			expect(ctx.store._characters.get(ctx.target.id)).toEqual(targetBefore);
			const [sourceView] = await ctx.store.pListCharacterOutgoingActions({
				accountId: ctx.sourceOwner.account.id,
				campaignId: ctx.campaign.id,
				characterId: ctx.source.id,
			});
			expect(sourceView).toMatchObject({
				actionId: proposed.operation.operationId,
				status: "failed",
				failureCode: "unavailable",
				sourceCostState: "not_consumed",
			});
			expect(ctx.store._semanticOperations.get(proposed.operation.operationId).privateFailureCode)
				.toBe("TARGET_EFFECT_UNAVAILABLE");
		}
		expect(new Set(proposalShapes.map(shape => JSON.stringify(shape))).size).toBe(1);
	});

	it.each(["reject", "cancel", "expire"])("%s is terminal and consumes nothing", async decision => {
		const ctx = await fixture();
		const proposed = await ctx.propose();
		const operationId = proposed.operation.operationId;
		const beforeSource = structuredClone(ctx.store._characters.get(ctx.source.id));
		const beforeTarget = structuredClone(ctx.store._characters.get(ctx.target.id));
		const eventsBefore = ctx.store.getDomainEvents().length;
		if (decision === "expire") ctx.setNow("2026-09-04T00:02:00.000Z");
		const actor = decision === "cancel" ? ctx.sourceOwner : ctx.targetOwner;
		const result = await ctx.resolve({
			operationId,
			actor,
			decision: decision === "expire" ? "accept" : decision,
		});
		expect(result.operation.status).toBe({
			reject: "rejected",
			cancel: "cancelled",
			expire: "expired",
		}[decision]);
		expect(result.operation.sourceCostState).toBe("not_consumed");
		expect(ctx.store._characters.get(ctx.source.id)).toEqual(beforeSource);
		expect(ctx.store._characters.get(ctx.target.id)).toEqual(beforeTarget);
		const events = ctx.store.getDomainEvents().slice(eventsBefore);
		expect(events).toHaveLength(1);
		expect(events[0].payload).not.toHaveProperty("sourceCost");
		expect(events[0].payload).not.toHaveProperty("sourceCharacterId");
	});

	it("permanently invalidates consent after a spent-then-restored source slot", async () => {
		const ctx = await fixture();
		const proposed = await ctx.propose();
		const lease = await ctx.store.pAcquireCharacterLease({
			accountId: ctx.sourceOwner.account.id,
			sessionId: ctx.sourceOwner.session.id,
			characterId: ctx.source.id,
		});
		for (const [current, suffix] of [[0, "spend"], [1, "restore"]]) {
			const source = ctx.store._characters.get(ctx.source.id);
			await ctx.store.pPatchCharacter({
				accountId: ctx.sourceOwner.account.id,
				sessionId: ctx.sourceOwner.session.id,
				characterId: ctx.source.id,
				baseRevision: source.revision,
				leaseEpoch: lease.epoch,
				patches: [{op: "replace", path: "/spellcasting/spellSlots/1/current", value: current}],
				idempotencyKey: `${suffix}-${crypto.randomUUID()}`,
			});
		}

		const beforeTarget = structuredClone(ctx.store._characters.get(ctx.target.id));
		const failed = await ctx.resolve({operationId: proposed.operation.operationId});
		expect(failed.operation).toMatchObject({
			status: "failed",
			sourceCostState: "not_consumed",
			failureCode: "unavailable",
		});
		expect(ctx.store._characters.get(ctx.source.id).data.spellcasting.spellSlots[1].current).toBe(1);
		expect(ctx.store._characters.get(ctx.target.id)).toEqual(beforeTarget);
	});

	it("keeps consent valid across unrelated source-character edits", async () => {
		const ctx = await fixture();
		const proposed = await ctx.propose();
		const lease = await ctx.store.pAcquireCharacterLease({
			accountId: ctx.sourceOwner.account.id,
			sessionId: ctx.sourceOwner.session.id,
			characterId: ctx.source.id,
		});
		const source = ctx.store._characters.get(ctx.source.id);
		await ctx.store.pPatchCharacter({
			accountId: ctx.sourceOwner.account.id,
			sessionId: ctx.sourceOwner.session.id,
			characterId: ctx.source.id,
			baseRevision: source.revision,
			leaseEpoch: lease.epoch,
			patches: [{op: "replace", path: "/hp/current", value: 19}],
			idempotencyKey: crypto.randomUUID(),
		});

		const accepted = await ctx.resolve({operationId: proposed.operation.operationId});
		expect(accepted.operation.status).toBe("applied");
		expect(ctx.store._characters.get(ctx.source.id).data.spellcasting.spellSlots[1].current).toBe(0);
	});

	it("commits a stable failed outcome when source, target, or capability changes", async () => {
		for (const failure of ["exhausted", "target-full", "capability"]) {
			const ctx = await fixture();
			const proposed = await ctx.propose();
			const operationId = proposed.operation.operationId;
			if (failure === "exhausted") {
				const source = ctx.store._characters.get(ctx.source.id);
				source.data.spellcasting.spellSlots[1].current = 0;
				source.revision++;
			} else if (failure === "target-full") {
				const target = ctx.store._characters.get(ctx.target.id);
				target.data.hp.current = target.data.hp.effectiveMax;
				target.revision++;
			} else ctx.setEnabled(false);
			const sourceBefore = structuredClone(ctx.store._characters.get(ctx.source.id));
			const targetBefore = structuredClone(ctx.store._characters.get(ctx.target.id));
			const eventCount = ctx.store.getDomainEvents().length;
			const failed = await ctx.resolve({operationId});
			expect(failed.operation).toMatchObject({status: "failed", sourceCostState: "not_consumed"});
			expect(failed.operation.failureCode).toBe(
				failure === "target-full" ? "TARGET_EFFECT_UNAVAILABLE" : "unavailable",
			);
			expect(ctx.store._characters.get(ctx.source.id)).toEqual(sourceBefore);
			expect(ctx.store._characters.get(ctx.target.id)).toEqual(targetBefore);
			expect(ctx.store.getDomainEvents().slice(eventCount).map(it => it.type)).toEqual([
				"character.operation.failed",
			]);
			if (failure === "exhausted") {
				const sourceView = await ctx.resolve({
					operationId,
					actor: ctx.sourceOwner,
					decision: "cancel",
				});
				expect(sourceView.operation.failureCode).toBe("SOURCE_COST_UNAVAILABLE");
			}
		}
	});

	it("pins the active immutable rules identity and fails atomically after activation changes", async () => {
		const ctx = await fixture();
		const proposed = await ctx.propose();
		const sourceBefore = structuredClone(ctx.store._characters.get(ctx.source.id));
		const targetBefore = structuredClone(ctx.store._characters.get(ctx.target.id));
		const nextRules = (await ctx.store.pCreateRulesVersion({
			accountId: ctx.dm.account.id,
			campaignId: ctx.campaign.id,
			schemaVersion: 1,
			rules: {enableTgtt: false},
			idempotencyKey: crypto.randomUUID(),
		})).rulesVersion;
		await ctx.store.pActivateRulesVersion({
			accountId: ctx.dm.account.id,
			campaignId: ctx.campaign.id,
			rulesVersionId: nextRules.id,
			idempotencyKey: crypto.randomUUID(),
		});
		const result = await ctx.resolve({operationId: proposed.operation.operationId});
		expect(result.operation).toMatchObject({
			status: "failed",
			failureCode: "unavailable",
			sourceCostState: "not_consumed",
		});
		expect(ctx.store._characters.get(ctx.source.id)).toEqual(sourceBefore);
		expect(ctx.store._characters.get(ctx.target.id)).toEqual(targetBefore);
	});

	it("uses the same non-enumerating error for hidden and unknown peer targets", async () => {
		const ctx = await fixture();
		await ctx.store.pSetProjectionPolicy({
			accountId: ctx.targetOwner.account.id,
			characterId: ctx.target.id,
			policy: {version: 1, preset: "private", overrides: {}},
			expectedProjectionRevision: ctx.target.projectionRevision,
			idempotencyKey: crypto.randomUUID(),
		});
		await expect(ctx.propose()).rejects.toMatchObject({
			code: "SOURCE_OR_TARGET_UNAVAILABLE",
			status: 404,
		});
		await expect(ctx.propose({
			targetCharacter: {id: crypto.randomUUID(), targetRef: crypto.randomUUID()},
		})).rejects.toMatchObject({
			code: "SOURCE_OR_TARGET_UNAVAILABLE",
			status: 404,
		});
	});

	it.each(["dm", "co_dm", "spectator"])(
		"rejects %s-owned source and target characters outside the player-only slice",
		async role => {
			const sourceContext = await fixture();
			let sourceActor = sourceContext.sourceOwner;
			let sourceCharacter = sourceContext.source;
			if (role === "dm") {
				sourceActor = sourceContext.dm;
				sourceCharacter = await sourceContext.createCharacter({
					actor: sourceContext.dm,
					name: "DM Caster",
					hasCureWounds: true,
					hp: 20,
				});
			} else {
				await sourceContext.store.pChangeMemberRole({
					accountId: sourceContext.dm.account.id,
					campaignId: sourceContext.campaign.id,
					membershipId: sourceContext.sourceOwnerMembership.id,
					role,
					idempotencyKey: crypto.randomUUID(),
				});
			}
			await expect(sourceContext.propose({
				actor: sourceActor,
				sourceCharacter,
			})).rejects.toMatchObject({
				code: "SOURCE_OR_TARGET_UNAVAILABLE",
				status: 404,
			});

			const targetContext = await fixture();
			let targetCharacter = targetContext.target;
			if (role === "dm") {
				targetCharacter = await targetContext.createCharacter({
					actor: targetContext.dm,
					name: "DM Target",
				});
			} else {
				await targetContext.store.pChangeMemberRole({
					accountId: targetContext.dm.account.id,
					campaignId: targetContext.campaign.id,
					membershipId: targetContext.targetOwnerMembership.id,
					role,
					idempotencyKey: crypto.randomUUID(),
				});
			}
			await expect(targetContext.propose({targetCharacter})).rejects.toMatchObject({
				code: "SOURCE_OR_TARGET_UNAVAILABLE",
				status: 404,
			});
			const discovery = await targetContext.store.pListCampaignCharacterProjections({
				accountId: targetContext.sourceOwner.account.id,
				campaignId: targetContext.campaign.id,
			});
			expect(discovery.roster.find(entry => entry.characterId === targetCharacter.id)).not.toHaveProperty("targetRef");
		},
	);

	it("rechecks both active player memberships before acceptance", async () => {
		const sourceChanged = await fixture();
		const sourceProposal = await sourceChanged.propose();
		await sourceChanged.store.pChangeMemberRole({
			accountId: sourceChanged.dm.account.id,
			campaignId: sourceChanged.campaign.id,
			membershipId: sourceChanged.sourceOwnerMembership.id,
			role: "co_dm",
			idempotencyKey: crypto.randomUUID(),
		});
		const sourceBefore = structuredClone(sourceChanged.store._characters.get(sourceChanged.source.id));
		const targetBefore = structuredClone(sourceChanged.store._characters.get(sourceChanged.target.id));
		const failed = await sourceChanged.resolve({operationId: sourceProposal.operation.operationId});
		expect(failed.operation.status).toBe("failed");
		expect(sourceChanged.store._characters.get(sourceChanged.source.id)).toEqual(sourceBefore);
		expect(sourceChanged.store._characters.get(sourceChanged.target.id)).toEqual(targetBefore);

		const targetChanged = await fixture();
		const targetProposal = await targetChanged.propose();
		await targetChanged.store.pChangeMemberRole({
			accountId: targetChanged.dm.account.id,
			campaignId: targetChanged.campaign.id,
			membershipId: targetChanged.targetOwnerMembership.id,
			role: "co_dm",
			idempotencyKey: crypto.randomUUID(),
		});
		await expect(targetChanged.resolve({
			operationId: targetProposal.operation.operationId,
		})).rejects.toMatchObject({code: "OPERATION_FORBIDDEN", status: 403});
		expect(targetChanged.store._semanticOperations.get(targetProposal.operation.operationId).status).toBe("proposed");
	});

	it("rolls back and remains proposed when a pinned handler is temporarily unavailable", async () => {
		const ctx = await fixture();
		const proposed = await ctx.propose();
		const sourceBefore = structuredClone(ctx.store._characters.get(ctx.source.id));
		const targetBefore = structuredClone(ctx.store._characters.get(ctx.target.id));
		const eventsBefore = ctx.store.getDomainEvents().length;
		ctx.store._semanticOperationRegistry = createSemanticOperationRegistry({templates: []});
		await expect(ctx.resolve({operationId: proposed.operation.operationId})).rejects.toMatchObject({
			code: "SOURCE_COST_HANDLER_UNAVAILABLE",
			status: 503,
		});
		expect(ctx.store._semanticOperations.get(proposed.operation.operationId).status).toBe("proposed");
		expect(ctx.store._characters.get(ctx.source.id)).toEqual(sourceBefore);
		expect(ctx.store._characters.get(ctx.target.id)).toEqual(targetBefore);
		expect(ctx.store.getDomainEvents()).toHaveLength(eventsBefore);
	});

	it("serializes concurrent accepts and competing requests for the last slot", async () => {
		const same = await fixture();
		const proposed = await same.propose();
		const operationId = proposed.operation.operationId;
		const [first, second] = await Promise.all([
			same.resolve({operationId}),
			same.resolve({operationId}),
		]);
		expect(first.operation.status).toBe("applied");
		expect(second.operation.status).toBe("applied");
		expect(same.store._characters.get(same.source.id).data.spellcasting.spellSlots[1].current).toBe(0);
		expect(same.store.getDomainEvents().filter(event =>
			event.type === "character.operation.source_cost_consumed"
			&& event.payload.operationId === operationId,
		)).toHaveLength(1);

		const competing = await fixture();
		const [proposalA, proposalB] = await Promise.all([competing.propose(), competing.propose()]);
		const [resultA, resultB] = await Promise.all([
			competing.resolve({operationId: proposalA.operation.operationId}),
			competing.resolve({operationId: proposalB.operation.operationId}),
		]);
		expect([resultA.operation.status, resultB.operation.status].sort()).toEqual(["applied", "failed"]);
		expect(competing.store._characters.get(competing.source.id).data.spellcasting.spellSlots[1].current).toBe(0);
	});

	it("combines self-target cost and healing into one write, revision, event, and watermark", async () => {
		const ctx = await fixture({sameCharacter: true});
		const proposed = await ctx.propose();
		const revisionBefore = ctx.store._characters.get(ctx.source.id).revision;
		const result = await ctx.resolve({
			operationId: proposed.operation.operationId,
			actor: ctx.sourceOwner,
		});
		const operation = ctx.store._semanticOperations.get(proposed.operation.operationId);
		expect(result.operation).toMatchObject({
			leg: "combined",
			operationLegKey: `${operation.id}/combined`,
			sourceResult: {
				leg: "combined",
				operationLegKey: `${operation.id}/combined`,
			},
		});
		expect(ctx.store._characters.get(ctx.source.id).revision).toBe(revisionBefore + 1);
		expect(operation.resultingSourceCharacterRevision).toBe(revisionBefore + 1);
		expect(operation.resultingCharacterRevision).toBe(revisionBefore + 1);
		expect(operation.sourceCostEventId).toBeNull();
		const mutationEvents = ctx.store.getDomainEvents().filter(event =>
			event.aggregateId === ctx.source.id
			&& event.type === "character.operation.applied"
			&& event.payload.operation?.operationId === operation.id,
		);
		expect(mutationEvents).toHaveLength(1);
		expect(mutationEvents[0].payload.leg).toBe("combined");
		expect(result.watermarks).toEqual([{
			characterId: ctx.source.id,
			sequence: mutationEvents[0].sequence,
		}]);
	});

	it("fails closed for protocol, capability, rules, authorization, and command-key mismatches", async () => {
		const disabled = await fixture({gate: false});
		await expect(disabled.propose()).rejects.toMatchObject({code: "CAPABILITY_UNAVAILABLE"});

		const ctx = await fixture();
		const commandId = crypto.randomUUID();
		const request = {
			contractVersion: 1,
			commandId,
			sourceCharacterId: ctx.source.id,
			sourceEntity: SOURCE_ENTITY,
			effectTemplateId: EFFECT_TEMPLATE_ID,
			choice: {castLevel: 1},
			targetRef: ctx.target.targetRef,
			rulesVersionId: ctx.rulesVersion.id,
		};
		await expect(ctx.store.pCreateStructuredAction({
			accountId: ctx.sourceOwner.account.id,
			sessionId: ctx.sourceOwner.session.id,
			campaignId: ctx.campaign.id,
			...request,
			protocolVersion: "3",
			idempotencyKey: idempotency(commandId, request),
		})).rejects.toMatchObject({code: "PROTOCOL_UPDATE_REQUIRED", status: 426});

		const proposed = await ctx.propose();
		await expect(ctx.resolve({
			operationId: proposed.operation.operationId,
			actor: ctx.other,
		})).rejects.toMatchObject({code: "ACTION_NOT_FOUND"});
		await ctx.store.pChangeMemberRole({
			accountId: ctx.dm.account.id,
			campaignId: ctx.campaign.id,
			membershipId: ctx.otherMembership.id,
			role: "spectator",
			idempotencyKey: crypto.randomUUID(),
		});
		await expect(ctx.resolve({
			operationId: proposed.operation.operationId,
			actor: ctx.other,
		})).rejects.toMatchObject({code: "ACTION_NOT_FOUND"});
		await expect(ctx.resolve({
			operationId: proposed.operation.operationId,
			actor: ctx.outsider,
		})).rejects.toMatchObject({code: "ACTION_NOT_FOUND"});

		const replayCommand = crypto.randomUUID();
		const applied = await ctx.resolve({operationId: proposed.operation.operationId, commandId: replayCommand});
		const replayed = await ctx.resolve({operationId: proposed.operation.operationId, commandId: replayCommand});
		expect(replayed).toEqual(applied);
		await expect(ctx.resolve({
			operationId: proposed.operation.operationId,
			commandId: replayCommand,
			requestExtra: {changed: true},
		})).rejects.toMatchObject({code: "IDEMPOTENCY_KEY_REUSED"});
	});

	it("derives identical operations from the persisted seed and supports XPHB Cure Wounds", async () => {
		const ctx = await fixture();
		const proposed = await ctx.propose();
		const stored = ctx.store._semanticOperations.get(proposed.operation.operationId);
		const registry = ctx.store._semanticOperationRegistry;
		const inputs = {
			sourceCharacter: ctx.store._characters.get(ctx.source.id),
			targetCharacter: ctx.store._characters.get(ctx.target.id),
			targetRef: ctx.target.targetRef,
			sourceEntity: stored.sourceEntity,
			effectTemplateId: stored.effectTemplateId,
			choice: stored.choice,
			sourceProfile: {},
			targetProfile: {},
			operationId: stored.id,
			effectResolutionSeed: stored.effectResolutionSeed,
		};
		expect(registry.derive(inputs).operation).toEqual(registry.derive(inputs).operation);

		const source = ctx.store._characters.get(ctx.source.id);
		source.data.spellcasting.spellsKnown = [{
			name: "Cure Wounds",
			source: "XPHB",
			level: 1,
			prepared: true,
			sourceClass: "Cleric",
		}];
		const derived = registry.derive({
			...inputs,
			sourceEntity: {type: "spell", uid: "cure wounds|xphb", version: "xphb-2024-v1"},
		});
		expect(derived.sourceCost.components).toEqual([
			{kind: "spell_slot", pool: "standard", level: 1, amount: 1},
		]);
		expect(derived.operation.arguments.amount).toBeGreaterThanOrEqual(5);
	});

	it("enforces the closed protocol-4 HTTP contract and no-store responses", async () => {
		const ctx = await fixture();
		let activeIdentity = ctx.sourceOwner.identity;
		const app = await createHubApp({
			store: ctx.store,
			oauthProvider: {
				getAuthorizationUrl: ({state}) => `https://example.invalid/?state=${state}`,
				pExchangeCode: async () => activeIdentity,
			},
			config: {
				appOrigin: "https://tools.example",
				cookieSecret: "x".repeat(32),
				csrfSecret: "y".repeat(32),
				allowedOAuthSubjects: [
					ctx.sourceOwner.identity,
					ctx.targetOwner.identity,
				].map(identity => `${identity.provider}:${identity.providerSubject}`),
			},
		});
		const getCookie = (response, name) => response.cookies.find(cookie => cookie.name === name)?.value;
		const signIn = async actor => {
			activeIdentity = actor.identity;
			const start = await app.inject({method: "GET", url: "/auth/github/start"});
			const state = new URL(start.headers.location).searchParams.get("state");
			const callback = await app.inject({
				method: "GET",
				url: `/auth/github/callback?code=x&state=${state}`,
				headers: {cookie: `__Host-hub_oauth=${getCookie(start, "__Host-hub_oauth")}`},
			});
			const cookie = `__Host-hub_session=${getCookie(callback, "__Host-hub_session")}`;
			const session = (await app.inject({method: "GET", url: "/api/session", headers: {cookie}})).json();
			return {...session, cookie};
		};
		const sourceSession = await signIn(ctx.sourceOwner);
		const targetSession = await signIn(ctx.targetOwner);
		const headers = (session, commandId, protocol = "4") => ({
			cookie: session.cookie,
			origin: "https://tools.example",
			"x-csrf-token": session.csrfToken,
			"x-hub-protocol-version": protocol,
			"idempotency-key": commandId,
		});
		const context = await app.inject({
			method: "GET",
			url: `/api/campaigns/${ctx.campaign.id}/context`,
			headers: {cookie: sourceSession.cookie},
		});
		expect(context.json().context).toMatchObject({
			rulesVersion: {id: ctx.rulesVersion.id},
			capabilities: {
				peerSourceCosts: {
					enabled: true,
					contractVersion: 1,
					protocolVersion: 4,
					operationVersion: 1,
					resourceKinds: ["spell_slot", "item_charge", "inventory_quantity", "feature_use"],
					templateRegistryVersion: "peer-effects-v1",
				},
			},
		});
		const projections = await app.inject({
			method: "GET",
			url: `/api/campaigns/${ctx.campaign.id}/character-projections`,
			headers: {cookie: sourceSession.cookie, "x-hub-protocol-version": "4"},
		});
		const targetRosterEntry = projections.json().roster.find(entry => entry.characterId === ctx.target.id);
		expect(targetRosterEntry).toEqual({
			characterId: ctx.target.id,
			targetRef: ctx.target.targetRef,
			ownerMembershipId: expect.any(String),
		});
		const commandId = crypto.randomUUID();
		const proposal = {
			contractVersion: 1,
			commandId,
			sourceCharacterId: ctx.source.id,
			sourceEntity: SOURCE_ENTITY,
			effectTemplateId: EFFECT_TEMPLATE_ID,
			choice: {castLevel: 1},
			targetRef: ctx.target.targetRef,
			rulesVersionId: ctx.rulesVersion.id,
		};
		const oldProtocol = await app.inject({
			method: "POST",
			url: `/api/campaigns/${ctx.campaign.id}/actions`,
			headers: headers(sourceSession, commandId, "3"),
			payload: proposal,
		});
		expect(oldProtocol.statusCode).toBe(426);
		expect(oldProtocol.json()).toEqual({error: "PROTOCOL_UPDATE_REQUIRED"});

		const invalidCommandId = crypto.randomUUID();
		const invalid = await app.inject({
			method: "POST",
			url: `/api/campaigns/${ctx.campaign.id}/actions`,
			headers: headers(sourceSession, invalidCommandId),
			payload: {...proposal, commandId: invalidCommandId, sourceCost: {version: 1, components: []}},
		});
		expect(invalid.statusCode).toBe(400);
		expect(invalid.json()).toEqual({error: "INVALID_REQUEST"});

		const storedTarget = ctx.store._characters.get(ctx.target.id);
		storedTarget.data.hp.current = storedTarget.data.hp.max;
		const fullHpCommandId = crypto.randomUUID();
		const fullHpProposal = await app.inject({
			method: "POST",
			url: `/api/campaigns/${ctx.campaign.id}/actions`,
			headers: headers(sourceSession, fullHpCommandId),
			payload: {...proposal, commandId: fullHpCommandId},
		});
		expect(fullHpProposal.statusCode).toBe(201);
		const fullHpResolveCommandId = crypto.randomUUID();
		const fullHpResolution = await app.inject({
			method: "POST",
			url: `/api/campaigns/${ctx.campaign.id}/actions/${fullHpProposal.json().operation.operationId}/resolve`,
			headers: headers(targetSession, fullHpResolveCommandId),
			payload: {contractVersion: 1, commandId: fullHpResolveCommandId, decision: "accept"},
		});
		expect(fullHpResolution.statusCode).toBe(200);
		expect(fullHpResolution.json().operation).toMatchObject({
			status: "failed",
			sourceCostState: "not_consumed",
			failureCode: "TARGET_EFFECT_UNAVAILABLE",
		});
		expect(ctx.store._characters.get(ctx.source.id).data.spellcasting.spellSlots[1].current).toBe(1);
		storedTarget.data.hp.current = 5;

		const validCommandId = crypto.randomUUID();
		const created = await app.inject({
			method: "POST",
			url: `/api/campaigns/${ctx.campaign.id}/actions`,
			headers: headers(sourceSession, validCommandId),
			payload: {...proposal, commandId: validCommandId},
		});
		expect(created.statusCode).toBe(201);
		expect(created.headers["cache-control"]).toBe("no-store");
		const operationId = created.json().operation.operationId;
		expect(created.json().operation).toMatchObject({
			actionId: operationId,
			status: "proposed",
			presentation: {
				effectLabel: "Cure Wounds",
				targetName: "Bryn",
				outcomeLabel: expect.stringMatching(/^Restore \d+ hit point/),
			},
			sourceCostState: "pending",
			capabilities: {canCancel: true},
		});
		const pending = await app.inject({
			method: "GET",
			url: `/api/campaigns/${ctx.campaign.id}/characters/${ctx.target.id}/pending-actions`,
			headers: {cookie: targetSession.cookie, "x-hub-protocol-version": "4"},
		});
		expect(pending.statusCode).toBe(200);
		expect(pending.json().actions).toEqual([expect.objectContaining({
			actionId: operationId,
			contractVersion: 1,
			presentation: expect.objectContaining({effectLabel: "Cure Wounds", sourceName: "Aster"}),
			capabilities: {canApprove: true, canReject: true},
		})]);
		const outdatedPending = await app.inject({
			method: "GET",
			url: `/api/campaigns/${ctx.campaign.id}/characters/${ctx.target.id}/pending-actions`,
			headers: {cookie: targetSession.cookie, "x-hub-protocol-version": "3"},
		});
		expect(outdatedPending.statusCode).toBe(200);
		expect(outdatedPending.json()).toEqual({actions: []});
		const outdatedGlobal = await app.inject({
			method: "GET",
			url: `/api/campaigns/${ctx.campaign.id}/actions`,
			headers: {cookie: targetSession.cookie, "x-hub-protocol-version": "3"},
		});
		expect(outdatedGlobal.statusCode).toBe(200);
		expect(outdatedGlobal.json()).toEqual({actions: []});

		const outdatedOutgoing = await app.inject({
			method: "GET",
			url: `/api/campaigns/${ctx.campaign.id}/characters/${ctx.source.id}/outgoing-actions`,
			headers: {cookie: sourceSession.cookie, "x-hub-protocol-version": "3"},
		});
		expect(outdatedOutgoing.statusCode).toBe(426);
		const outgoing = await app.inject({
			method: "GET",
			url: `/api/campaigns/${ctx.campaign.id}/characters/${ctx.source.id}/outgoing-actions`,
			headers: {cookie: sourceSession.cookie, "x-hub-protocol-version": "4"},
		});
		expect(outgoing.statusCode).toBe(200);
		expect(outgoing.headers["cache-control"]).toBe("no-store");
		expect(outgoing.json().actions).toEqual(expect.arrayContaining([{
			actionId: operationId,
			status: "proposed",
			expiresAt: expect.any(String),
			presentation: {
				effectLabel: "Cure Wounds",
				targetName: "Bryn",
				outcomeLabel: expect.stringMatching(/^Restore \d+ hit point/),
			},
			sourceCostState: "pending",
			capabilities: {canCancel: true},
		}]));
		expect(outgoing.json().actions.find(action => action.actionId === fullHpProposal.json().operation.operationId))
			.toMatchObject({
				status: "failed",
				sourceCostState: "not_consumed",
				failureCode: "unavailable",
			});
		expect(JSON.stringify(outgoing.json())).not.toContain(ctx.target.id);
		const targetCannotReadOutgoing = await app.inject({
			method: "GET",
			url: `/api/campaigns/${ctx.campaign.id}/characters/${ctx.source.id}/outgoing-actions`,
			headers: {cookie: targetSession.cookie, "x-hub-protocol-version": "4"},
		});
		expect(targetCannotReadOutgoing.statusCode).toBe(404);

		const cancelCommandId = crypto.randomUUID();
		const cancelled = await app.inject({
			method: "POST",
			url: `/api/campaigns/${ctx.campaign.id}/actions/${operationId}/resolve`,
			headers: headers(sourceSession, cancelCommandId),
			payload: {contractVersion: 1, commandId: cancelCommandId, decision: "cancel"},
		});
		expect(cancelled.statusCode).toBe(200);
		expect(cancelled.json().operation).toMatchObject({
			actionId: operationId,
			status: "cancelled",
			sourceCostState: "not_consumed",
			capabilities: {canCancel: false},
		});

		const acceptedProposalCommandId = crypto.randomUUID();
		const acceptedProposal = await app.inject({
			method: "POST",
			url: `/api/campaigns/${ctx.campaign.id}/actions`,
			headers: headers(sourceSession, acceptedProposalCommandId),
			payload: {...proposal, commandId: acceptedProposalCommandId},
		});
		const acceptedOperationId = acceptedProposal.json().operation.operationId;

		const resolutionCommandId = crypto.randomUUID();
		const outdatedResolution = await app.inject({
			method: "POST",
			url: `/api/campaigns/${ctx.campaign.id}/actions/${acceptedOperationId}/resolve`,
			headers: headers(targetSession, resolutionCommandId, "3"),
			payload: {commandId: resolutionCommandId, decision: "accept"},
		});
		expect(outdatedResolution.statusCode).toBe(426);

		const acceptCommandId = crypto.randomUUID();
		const accepted = await app.inject({
			method: "POST",
			url: `/api/campaigns/${ctx.campaign.id}/actions/${acceptedOperationId}/resolve`,
			headers: headers(targetSession, acceptCommandId),
			payload: {contractVersion: 1, commandId: acceptCommandId, decision: "accept"},
		});
		expect(accepted.statusCode).toBe(200);
		expect(accepted.headers["cache-control"]).toBe("no-store");
		expect(accepted.json().operation).toMatchObject({
			actionId: acceptedOperationId,
			status: "applied",
			leg: "target",
			operationLegKey: `${acceptedOperationId}/target`,
			appliedEventId: expect.any(String),
			sourceCostState: "consumed",
		});
		expect(accepted.json().operation.appliedEventId).toBe(accepted.json().eventIds[1]);
		expect(accepted.json().operation).not.toHaveProperty("sourceResult");
		const appliedEvents = ctx.store.getDomainEvents().filter(event =>
			accepted.json().eventIds.includes(event.id)
			&& event.type.startsWith("character.operation."),
		);
		expect(appliedEvents.map(event => event.payload.leg)).toEqual(["source", "target"]);
		await app.close();
	});
});
