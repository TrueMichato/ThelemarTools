import crypto from "node:crypto";

import {MemoryHubStore} from "../../../server/src/memory-hub-store.js";

const SOURCE_ENTITY = {type: "spell", uid: "cure wounds|phb", version: "phb-2014-v1"};
const EFFECT_TEMPLATE_ID = "spell.cure-wounds.heal";

function getIdempotencyKey (commandId, request) {
	return {
		key: commandId,
		requestHash: crypto.createHash("sha256").update(JSON.stringify(request)).digest("hex"),
	};
}

function getCharacterData ({name, hp, hasCureWounds = false}) {
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
			spellSlots: {1: {current: 1, max: 1}},
			pactSlots: {current: 0, max: 0, level: 0},
		},
	};
}

function getAuthorityState (store) {
	return structuredClone({
		campaigns: store._campaigns,
		characters: store._characters,
		semanticOperations: store._semanticOperations,
		semanticOperationCommands: store._semanticOperationCommands,
		commandReceipts: store._commandReceipts,
		events: store._events,
		campaignEvents: store._campaignEvents,
		outbox: store._outbox,
		audit: store._audit,
	});
}

async function pCreateScenario ({isSelfTarget}) {
	const now = new Date("2026-09-21T09:00:00.000Z");
	let faultStage = null;
	let fnBeforeFault = null;
	const store = new MemoryHubStore({
		fnNow: () => new Date(now),
		peerSourceCostsEnabled: true,
		fnTestResolveStructuredActionFault: ({stage}) => {
			if (stage !== faultStage) return;
			faultStage = null;
			fnBeforeFault?.();
			fnBeforeFault = null;
			throw new Error(`Injected ${stage} failure`);
		},
	});
	const pCreateActor = async label => {
		const account = await store.pUpsertOAuthAccount({
			provider: "github",
			providerSubject: `${label}-${crypto.randomUUID()}`,
			login: label,
			displayName: label,
		});
		const session = await store.pCreateSession({
			accountId: account.id,
			tokenHash: crypto.randomBytes(32).toString("hex"),
			expiresAt: new Date(now.getTime() + 3_600_000),
		});
		return {account, session};
	};
	const dm = await pCreateActor("DM");
	const sourceOwner = await pCreateActor("Source owner");
	const targetOwner = isSelfTarget ? sourceOwner : await pCreateActor("Target owner");
	const campaign = (await store.pCreateCampaign({
		accountId: dm.account.id,
		name: "Atomic source costs",
		idempotencyKey: crypto.randomUUID(),
	})).campaign;
	const pJoin = async actor => {
		const tokenHash = crypto.randomBytes(32).toString("hex");
		await store.pCreateInvite({
			accountId: dm.account.id,
			campaignId: campaign.id,
			role: "player",
			tokenHash,
			expiresAt: new Date(now.getTime() + 60_000),
			maxUses: 1,
			idempotencyKey: crypto.randomUUID(),
		});
		await store.pRedeemInvite({
			accountId: actor.account.id,
			tokenHash,
			idempotencyKey: crypto.randomUUID(),
		});
	};
	await pJoin(sourceOwner);
	if (!isSelfTarget) await pJoin(targetOwner);
	const rulesVersion = (await store.pCreateRulesVersion({
		accountId: dm.account.id,
		campaignId: campaign.id,
		schemaVersion: 1,
		rules: {},
		idempotencyKey: crypto.randomUUID(),
	})).rulesVersion;
	await store.pActivateRulesVersion({
		accountId: dm.account.id,
		campaignId: campaign.id,
		rulesVersionId: rulesVersion.id,
		idempotencyKey: crypto.randomUUID(),
	});
	const pCreateCharacter = async ({actor, name, hp, hasCureWounds = false}) => (await store.pCreateCharacter({
		accountId: actor.account.id,
		campaignId: campaign.id,
		data: getCharacterData({name, hp, hasCureWounds}),
		schemaVersion: 1,
		clientImportId: crypto.randomUUID(),
		idempotencyKey: crypto.randomUUID(),
	})).character;
	const source = await pCreateCharacter({
		actor: sourceOwner,
		name: "Aster",
		hp: isSelfTarget ? 5 : 20,
		hasCureWounds: true,
	});
	const target = isSelfTarget
		? source
		: await pCreateCharacter({actor: targetOwner, name: "Bryn", hp: 5});
	const pPropose = async () => {
		const commandId = crypto.randomUUID();
		const request = {
			contractVersion: 1,
			commandId,
			sourceCharacterId: source.id,
			sourceEntity: SOURCE_ENTITY,
			effectTemplateId: EFFECT_TEMPLATE_ID,
			choice: {castLevel: 1},
			targetRef: target.targetRef,
			rulesVersionId: rulesVersion.id,
		};
		return store.pCreateStructuredAction({
			accountId: sourceOwner.account.id,
			sessionId: sourceOwner.session.id,
			campaignId: campaign.id,
			...request,
			protocolVersion: "4",
			idempotencyKey: getIdempotencyKey(commandId, request),
		});
	};
	const getResolution = (operationId, {decision = "accept", actor = targetOwner} = {}) => {
		const commandId = crypto.randomUUID();
		const request = {
			contractVersion: 1,
			commandId,
			operationId,
			decision,
		};
		return {
			commandId,
			pResolve: () => store.pResolveStructuredAction({
				accountId: actor.account.id,
				sessionId: actor.session.id,
				campaignId: campaign.id,
				actionId: operationId,
				contractVersion: 1,
				commandId,
				decision,
				protocolVersion: "4",
				idempotencyKey: getIdempotencyKey(commandId, request),
			}),
		};
	};
	const proposal = await pPropose();
	const resolution = getResolution(proposal.operation.operationId);
	return {
		store,
		campaign,
		dm,
		source,
		target,
		sourceOwner,
		targetOwner,
		operationId: proposal.operation.operationId,
		resolutionCommandId: resolution.commandId,
		pResolve: resolution.pResolve,
		pPropose,
		getResolution,
		setFaultStage: (value, fnBefore = null) => {
			faultStage = value;
			fnBeforeFault = fnBefore;
		},
	};
}

async function pExpectAtomicFaultAndRetry ({isSelfTarget, stage}) {
	const ctx = await pCreateScenario({isSelfTarget});
	const before = getAuthorityState(ctx.store);
	const beforeEventCount = ctx.store._events.length;
	const beforeOutboxCount = ctx.store._outbox.length;
	const beforeAuditCount = ctx.store._audit.length;
	const beforeCommandCount = ctx.store._semanticOperationCommands.size;
	ctx.setFaultStage(stage);

	await expect(ctx.pResolve()).rejects.toThrow(`Injected ${stage} failure`);
	expect(getAuthorityState(ctx.store)).toEqual(before);

	ctx.setFaultStage(null);
	const resolved = await ctx.pResolve();
	expect(resolved.operation).toMatchObject({
		operationId: ctx.operationId,
		status: "applied",
		sourceCostState: "consumed",
	});
	const afterRetry = getAuthorityState(ctx.store);
	const replay = await ctx.pResolve();
	expect(replay).toEqual(resolved);
	expect(getAuthorityState(ctx.store)).toEqual(afterRetry);

	const newEvents = ctx.store._events.slice(beforeEventCount);
	expect(newEvents.map(event => event.type)).toEqual(isSelfTarget
		? [
			"character.operation.applied",
			"character.projection.invalidated",
		]
		: [
			"character.operation.source_cost_consumed",
			"character.operation.applied",
			"character.projection.invalidated",
			"character.projection.invalidated",
		]);
	expect(ctx.store._outbox).toHaveLength(beforeOutboxCount + newEvents.length);
	expect(ctx.store._audit).toHaveLength(beforeAuditCount + 1);
	expect(ctx.store._audit.slice(beforeAuditCount)).toEqual([
		expect.objectContaining({
			action: "character.operation.applied",
			targetId: ctx.operationId,
		}),
	]);
	expect(ctx.store._semanticOperationCommands.size).toBe(beforeCommandCount + 1);
	expect(ctx.store._semanticOperationCommands.get(ctx.resolutionCommandId)?.eventIds).toEqual(resolved.eventIds);
	expect(ctx.store._characters.get(ctx.source.id).data.spellcasting.spellSlots[1].current).toBe(0);
	expect(ctx.store._characters.get(ctx.source.id).revision).toBe(
		before.characters.get(ctx.source.id).revision + 1,
	);
	expect(ctx.store._characters.get(ctx.target.id).revision).toBe(
		before.characters.get(ctx.target.id).revision + 1,
	);
	const appliedEvent = newEvents.find(event => event.type === "character.operation.applied");
	expect(ctx.store._characters.get(ctx.target.id).data.hp.current).toBe(
		before.characters.get(ctx.target.id).data.hp.current + appliedEvent.payload.operation.arguments.amount,
	);
}

describe("MemoryHubStore source-cost acceptance atomicity", () => {
	it.each([
		"source-event",
		"target-event",
		"projection-invalidation",
		"audit",
		"receipt",
	])("rolls back a distinct-target acceptance fault at %s and retries once", async stage => {
		await pExpectAtomicFaultAndRetry({isSelfTarget: false, stage});
	});

	it.each([
		"combined-event",
		"projection-invalidation",
		"audit",
		"receipt",
	])("rolls back a self-target acceptance fault at %s and retries once", async stage => {
		await pExpectAtomicFaultAndRetry({isSelfTarget: true, stage});
	});

	it("does not erase a concurrent distinct resolution when rolling back", async () => {
		const ctx = await pCreateScenario({isSelfTarget: false});
		const secondProposal = await ctx.pPropose();
		const secondResolution = ctx.getResolution(secondProposal.operation.operationId);
		ctx.setFaultStage("source-event");

		const firstAttempt = ctx.pResolve();
		const secondAttempt = secondResolution.pResolve();
		await expect(firstAttempt).rejects.toThrow("Injected source-event failure");
		const secondResponse = await secondAttempt;

		expect(secondResponse.operation).toMatchObject({
			operationId: secondProposal.operation.operationId,
			status: "applied",
		});
		expect(ctx.store._semanticOperations.get(secondProposal.operation.operationId)?.status).toBe("applied");
		expect(ctx.store._semanticOperationCommands.get(secondResolution.commandId)?.response).toEqual(secondResponse);
		const afterSecond = getAuthorityState(ctx.store);
		expect(await secondResolution.pResolve()).toEqual(secondResponse);
		expect(getAuthorityState(ctx.store)).toEqual(afterSecond);
	});

	it("preserves a concurrent self-target resolution across combined-event rollback", async () => {
		const ctx = await pCreateScenario({isSelfTarget: true});
		const secondProposal = await ctx.pPropose();
		const secondOperationId = secondProposal.operation.operationId;
		const secondResolution = ctx.getResolution(secondOperationId);
		const before = getAuthorityState(ctx.store);
		const beforeEventCount = ctx.store._events.length;
		const beforeOutboxCount = ctx.store._outbox.length;
		const beforeAuditCount = ctx.store._audit.length;
		const beforeCommandCount = ctx.store._semanticOperationCommands.size;
		ctx.setFaultStage("combined-event");

		const firstAttempt = ctx.pResolve();
		const secondAttempt = secondResolution.pResolve();
		await expect(firstAttempt).rejects.toThrow("Injected combined-event failure");
		const secondResponse = await secondAttempt;

		expect(secondResponse.operation).toMatchObject({
			operationId: secondOperationId,
			status: "applied",
			leg: "combined",
			sourceCostState: "consumed",
		});
		const character = ctx.store._characters.get(ctx.source.id);
		const newEvents = ctx.store._events.slice(beforeEventCount);
		const [combinedEvent, invalidationEvent] = newEvents;
		expect(newEvents.map(event => event.type)).toEqual([
			"character.operation.applied",
			"character.projection.invalidated",
		]);
		expect(combinedEvent).toMatchObject({
			id: secondResponse.operation.appliedEventId,
			aggregateId: ctx.source.id,
			aggregateRevision: before.characters.get(ctx.source.id).revision + 1,
			payload: {
				leg: "combined",
				resultingCharacterRevision: before.characters.get(ctx.source.id).revision + 1,
				resultingSourceCharacterRevision: before.characters.get(ctx.source.id).revision + 1,
			},
		});
		expect(invalidationEvent.aggregateId).toBe(ctx.campaign.id);
		expect(character.data.spellcasting.spellSlots[1].current).toBe(0);
		expect(character.data.hp.current).toBe(
			before.characters.get(ctx.source.id).data.hp.current + combinedEvent.payload.operation.arguments.amount,
		);
		expect(character.revision).toBe(before.characters.get(ctx.source.id).revision + 1);
		expect(character.operationWatermark).toBe(combinedEvent.sequence);
		expect(ctx.store._semanticOperations.get(secondOperationId)).toMatchObject({
			status: "applied",
			appliedEventId: combinedEvent.id,
			sourceCostEventId: null,
			resultingCharacterRevision: character.revision,
			resultingSourceCharacterRevision: character.revision,
		});
		expect(ctx.store._outbox.slice(beforeOutboxCount).map(entry => entry.eventId)).toEqual(
			newEvents.map(event => event.id),
		);
		expect(ctx.store._audit.slice(beforeAuditCount)).toEqual([
			expect.objectContaining({
				action: "character.operation.applied",
				targetId: secondOperationId,
			}),
		]);
		expect(ctx.store._semanticOperationCommands.size).toBe(beforeCommandCount + 1);
		expect(ctx.store._semanticOperationCommands.has(ctx.resolutionCommandId)).toBe(false);
		expect(ctx.store._semanticOperationCommands.get(secondResolution.commandId)?.response).toEqual(secondResponse);

		const afterSecond = getAuthorityState(ctx.store);
		expect(await secondResolution.pResolve()).toEqual(secondResponse);
		expect(getAuthorityState(ctx.store)).toEqual(afterSecond);
	});

	it.each(["reject", "cancel"])(
		"preserves a concurrent distinct %s resolution and exact replay across rollback",
		async decision => {
			const ctx = await pCreateScenario({isSelfTarget: false});
			const secondProposal = await ctx.pPropose();
			const secondResolution = ctx.getResolution(secondProposal.operation.operationId, {
				decision,
				actor: decision === "cancel" ? ctx.sourceOwner : ctx.targetOwner,
			});
			const beforeEventCount = ctx.store._events.length;
			const beforeOutboxCount = ctx.store._outbox.length;
			const beforeAuditCount = ctx.store._audit.length;
			let secondAttempt;
			ctx.setFaultStage("source-event", () => {
				secondAttempt = secondResolution.pResolve();
			});

			await expect(ctx.pResolve()).rejects.toThrow("Injected source-event failure");
			const secondResponse = await secondAttempt;
			expect(secondResponse.operation).toMatchObject({
				operationId: secondProposal.operation.operationId,
				status: decision === "reject" ? "rejected" : "cancelled",
			});
			expect(ctx.store._semanticOperations.get(secondProposal.operation.operationId)?.status).toBe(
				secondResponse.operation.status,
			);
			const terminalEvent = ctx.store._events.at(-1);
			expect(ctx.store._events).toHaveLength(beforeEventCount + 1);
			expect(terminalEvent).toMatchObject({
				id: secondResponse.eventIds[0],
				type: `character.operation.${secondResponse.operation.status}`,
				aggregateId: secondProposal.operation.operationId,
			});
			expect(ctx.store._outbox).toHaveLength(beforeOutboxCount + 1);
			expect(ctx.store._outbox.at(-1)?.eventId).toBe(terminalEvent.id);
			expect(ctx.store._audit).toHaveLength(beforeAuditCount + 1);
			expect(ctx.store._audit.at(-1)).toMatchObject({
				action: `character.operation.${secondResponse.operation.status}`,
				targetId: secondProposal.operation.operationId,
			});
			expect(ctx.store._semanticOperationCommands.get(secondResolution.commandId)?.response).toEqual(secondResponse);
			const afterSecond = getAuthorityState(ctx.store);
			expect(await secondResolution.pResolve()).toEqual(secondResponse);
			expect(getAuthorityState(ctx.store)).toEqual(afterSecond);
		},
	);

	it("preserves a concurrent ordinary source patch and its exact replay across rollback", async () => {
		const ctx = await pCreateScenario({isSelfTarget: false});
		const lease = await ctx.store.pAcquireCharacterLease({
			accountId: ctx.sourceOwner.account.id,
			sessionId: ctx.sourceOwner.session.id,
			characterId: ctx.source.id,
		});
		const sourceBefore = structuredClone(ctx.store._characters.get(ctx.source.id));
		const patchKey = crypto.randomUUID();
		const patchArgs = {
			accountId: ctx.sourceOwner.account.id,
			sessionId: ctx.sourceOwner.session.id,
			characterId: ctx.source.id,
			baseRevision: sourceBefore.revision,
			leaseEpoch: lease.epoch,
			patches: [{op: "replace", path: "/hp/current", value: sourceBefore.data.hp.current - 1}],
			idempotencyKey: patchKey,
		};
		let patchAttempt;
		ctx.setFaultStage("source-event", () => {
			patchAttempt = ctx.store.pPatchCharacter(patchArgs);
		});

		await expect(ctx.pResolve()).rejects.toThrow("Injected source-event failure");
		const patchResponse = await patchAttempt;
		const patchedSource = ctx.store._characters.get(ctx.source.id);
		expect(ctx.store._semanticOperations.get(ctx.operationId)?.status).toBe("proposed");
		expect(patchedSource.data.spellcasting.spellSlots[1].current).toBe(1);
		expect(patchedSource.data.hp.current).toBe(sourceBefore.data.hp.current - 1);
		expect(patchedSource.revision).toBe(sourceBefore.revision + 1);
		expect(ctx.store._commandReceipts.get(`${ctx.sourceOwner.account.id}::${patchKey}`)?.response)
			.toEqual(patchResponse);
		const afterPatch = getAuthorityState(ctx.store);
		expect(await ctx.store.pPatchCharacter(patchArgs)).toEqual(patchResponse);
		expect(getAuthorityState(ctx.store)).toEqual(afterPatch);
	});

	it("keeps global and campaign event indexes identity-linked through actor purge", async () => {
		const ctx = await pCreateScenario({isSelfTarget: false});
		const resolved = await ctx.pResolve();
		const campaignEvents = ctx.store._campaignEvents.get(ctx.campaign.id);

		for (const event of ctx.store._events.filter(event => event.campaignId === ctx.campaign.id)) {
			expect(campaignEvents.find(campaignEvent => campaignEvent.id === event.id)).toBe(event);
		}
		const appliedEvent = ctx.store._events.find(event => event.id === resolved.operation.appliedEventId);
		expect(appliedEvent.actorAccountId).toBe(ctx.targetOwner.account.id);

		const account = ctx.store._accounts.get(ctx.targetOwner.account.id);
		account.status = "deletion_requested";
		account.deletionRequestedAt = "2026-09-20T09:00:00.000Z";
		account.purgeAfter = "2026-09-20T09:00:00.000Z";
		expect(await ctx.store.pPurgeDueAccounts()).toEqual({
			purgedAccountIds: [ctx.targetOwner.account.id],
			blockedAccountIds: [],
		});

		expect(appliedEvent.actorAccountId).toBeNull();
		expect(campaignEvents.find(event => event.id === appliedEvent.id)?.actorAccountId).toBeNull();
		const replay = await ctx.store.pListVisibleEvents({
			accountId: ctx.dm.account.id,
			campaignId: ctx.campaign.id,
		});
		expect(replay.find(event => event.id === appliedEvent.id)?.actorAccountId).toBeNull();
	});
});
