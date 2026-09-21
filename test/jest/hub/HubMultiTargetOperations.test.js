import crypto from "node:crypto";

import {createHubApp} from "../../../server/src/app.js";
import {HubStoreError} from "../../../server/src/hub-store-error.js";
import {MemoryHubStore} from "../../../server/src/memory-hub-store.js";
import {createSemanticOperationRegistry} from "../../../server/src/semantic-operation-registry.js";

const SOURCE_ENTITY = {type: "ability", uid: "shared restoration|tst", version: "tst-v1"};
const EFFECT_TEMPLATE_ID = "ability.shared-restoration.heal";

function getIdempotency (commandId, request) {
	return {
		key: commandId,
		requestHash: crypto.createHash("sha256").update(JSON.stringify(request)).digest("hex"),
	};
}

function getRegistry ({allowTargetNoOp = true} = {}) {
	return createSemanticOperationRegistry({
		templates: [{
			sourceEntity: SOURCE_ENTITY,
			effectTemplateId: EFFECT_TEMPLATE_ID,
			sourceCostVersion: 1,
			multiTarget: {contractVersion: 1, maxTargets: 8, allowTargetNoOp},
			display: {label: "Shared Restoration", outcomeLabel: "Healing"},
			normalizeChoice: choice => {
				if (
					!choice
					|| Object.keys(choice).length !== 1
					|| !Number.isSafeInteger(choice.amount)
					|| choice.amount < 1
					|| choice.amount > 20
				) throw new HubStoreError("SOURCE_OR_TARGET_UNAVAILABLE", `Unavailable.`, {status: 404});
				return {amount: choice.amount};
			},
			hasSource: () => true,
			buildSourceCost: () => ({
				version: 1,
				components: [{kind: "spell_slot", pool: "standard", level: 1, amount: 1}],
			}),
			deriveOperation: ({choice}) => ({kind: "hp.heal", arguments: {amount: choice.amount}}),
			targetFootprint: () => ["hp"],
		}],
	});
}

function getCharacterData ({name, hp = 5, slots = 1}) {
	return {
		name,
		abilities: {str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10},
		abilityBonuses: {str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0},
		classes: [],
		features: [],
		hp: {current: hp, max: 20, effectiveMax: 20, temp: 0},
		conditions: [],
		inventory: [],
		spellcasting: {
			spellsKnown: [],
			cantripsKnown: [],
			innateSpells: [],
			spellSlots: {1: {current: slots, max: 1}},
			pactSlots: {current: 0, max: 0, level: 0},
		},
	};
}

async function pFixture ({allowTargetNoOp = true} = {}) {
	let now = new Date("2026-09-21T10:00:00.000Z");
	let faultStage = null;
	const store = new MemoryHubStore({
		fnNow: () => new Date(now),
		semanticOperationRegistry: getRegistry({allowTargetNoOp}),
		multiTargetOperationsEnabled: true,
		multiTargetCollectionTtlMs: 60_000,
		multiTargetOperationTtlMs: 3_600_000,
		fnTestResolveStructuredActionFault: ({stage}) => {
			if (stage === faultStage) throw new Error(`Injected ${stage}`);
		},
	});
	const pActor = async label => {
		const account = await store.pUpsertOAuthAccount({
			provider: "github",
			providerSubject: `${label}-${crypto.randomUUID()}`,
			displayName: label,
		});
		const token = crypto.randomBytes(32).toString("hex");
		const session = await store.pCreateSession({
			accountId: account.id,
			tokenHash: crypto.createHash("sha256").update(token).digest("hex"),
			expiresAt: new Date(now.getTime() + 86_400_000),
		});
		return {account, session, token};
	};
	const dm = await pActor("DM");
	const sourceOwner = await pActor("Source");
	const targetOwner = await pActor("Target");
	const other = await pActor("Other");
	const campaign = (await store.pCreateCampaign({
		accountId: dm.account.id,
		name: "Multi-target authority",
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
	await pJoin(targetOwner);
	await pJoin(other);
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
	const pCharacter = async ({actor, name, hp = 5, slots = 1}) => (await store.pCreateCharacter({
		accountId: actor.account.id,
		campaignId: campaign.id,
		data: getCharacterData({name, hp, slots}),
		schemaVersion: 1,
		clientImportId: crypto.randomUUID(),
		idempotencyKey: crypto.randomUUID(),
	})).character;
	const source = await pCharacter({actor: sourceOwner, name: "Source", hp: 10});
	const targetA = await pCharacter({actor: targetOwner, name: "Target A"});
	const targetB = await pCharacter({actor: targetOwner, name: "Target B"});
	const otherTarget = await pCharacter({actor: other, name: "Other target", hp: 20});
	const pPropose = async ({
		targetRefs = [targetA.targetRef, targetB.targetRef],
		protocolVersion = "6",
		commandId = crypto.randomUUID(),
	} = {}) => {
		const request = {
			contractVersion: 1,
			commandId,
			sourceCharacterId: source.id,
			sourceEntity: SOURCE_ENTITY,
			effectTemplateId: EFFECT_TEMPLATE_ID,
			choice: {amount: 4},
			targetRefs,
			rulesVersionId: rulesVersion.id,
		};
		return store.pCreateMultiTargetOperation({
			accountId: sourceOwner.account.id,
			sessionId: sourceOwner.session.id,
			campaignId: campaign.id,
			...request,
			protocolVersion,
			idempotencyKey: getIdempotency(commandId, request),
		});
	};
	const pRespond = async ({
		operationId,
		invitationId,
		actor = targetOwner,
		decision = "approve",
		commandId = crypto.randomUUID(),
	} = {}) => {
		const request = {contractVersion: 1, commandId, operationId, invitationId, decision};
		return store.pRespondMultiTargetInvitation({
			accountId: actor.account.id,
			sessionId: actor.session.id,
			campaignId: campaign.id,
			operationId,
			invitationId,
			decision,
			contractVersion: 1,
			protocolVersion: "6",
			commandId,
			idempotencyKey: getIdempotency(commandId, request),
		});
	};
	const pFinalize = async ({
		operationId,
		selectedInvitationIds,
		commandId = crypto.randomUUID(),
	} = {}) => {
		const request = {contractVersion: 1, commandId, operationId, selectedInvitationIds};
		return store.pFinalizeMultiTargetOperation({
			accountId: sourceOwner.account.id,
			sessionId: sourceOwner.session.id,
			campaignId: campaign.id,
			operationId,
			selectedInvitationIds,
			contractVersion: 1,
			protocolVersion: "6",
			commandId,
			idempotencyKey: getIdempotency(commandId, request),
		});
	};
	const pCancel = async ({
		operationId,
		actor = sourceOwner,
		commandId = crypto.randomUUID(),
	} = {}) => {
		const request = {contractVersion: 1, commandId, operationId};
		return store.pCancelMultiTargetOperation({
			accountId: actor.account.id,
			sessionId: actor.session.id,
			campaignId: campaign.id,
			operationId,
			contractVersion: 1,
			protocolVersion: "6",
			commandId,
			idempotencyKey: getIdempotency(commandId, request),
		});
	};
	return {
		store,
		campaign,
		dm,
		sourceOwner,
		targetOwner,
		other,
		source,
		targetA,
		targetB,
		otherTarget,
		pCharacter,
		pPropose,
		pRespond,
		pFinalize,
		pCancel,
		setNow: value => now = new Date(value),
		setFaultStage: value => faultStage = value,
	};
}

describe("Campaign Hub multi-target Memory authority", () => {
	it.each(["3", "4", "5"])("fails protocol %s before creating workflow evidence", async protocolVersion => {
		const ctx = await pFixture();
		const before = {
			operations: ctx.store._semanticOperations.size,
			targets: ctx.store._semanticOperationTargets.size,
			events: ctx.store._events.length,
		};
		await expect(ctx.pPropose({protocolVersion})).rejects.toMatchObject({code: "PROTOCOL_UPDATE_REQUIRED"});
		expect({
			operations: ctx.store._semanticOperations.size,
			targets: ctx.store._semanticOperationTargets.size,
			events: ctx.store._events.length,
		}).toEqual(before);
	});

	it("enforces protocol-6 route schemas and serves proposal, response, finalization, and reads", async () => {
		const ctx = await pFixture();
		const app = await createHubApp({
			store: ctx.store,
			oauthProvider: {
				getAuthorizationUrl: () => "https://example.invalid",
				pExchangeCode: async () => ctx.sourceOwner.account,
			},
			config: {
				appOrigin: "https://tools.example",
				cookieSecret: "x".repeat(32),
				csrfSecret: "y".repeat(32),
			},
		});
		try {
			const pSession = async actor => {
				const cookie = `__Host-hub_session=${app.signCookie(actor.token)}`;
				const session = (await app.inject({
					method: "GET",
					url: "/api/session",
					headers: {cookie},
				})).json();
				return {cookie, csrfToken: session.csrfToken};
			};
			const sourceSession = await pSession(ctx.sourceOwner);
			const targetSession = await pSession(ctx.targetOwner);
			const commandId = crypto.randomUUID();
			const payload = {
				contractVersion: 1,
				commandId,
				sourceCharacterId: ctx.source.id,
				sourceEntity: SOURCE_ENTITY,
				effectTemplateId: EFFECT_TEMPLATE_ID,
				choice: {amount: 4},
				targetRefs: [ctx.targetA.targetRef],
				rulesVersionId: ctx.store._campaigns.get(ctx.campaign.id).activeRulesVersionId,
			};
			const headers = (session, protocolVersion, key) => ({
				cookie: session.cookie,
				origin: "https://tools.example",
				"x-csrf-token": session.csrfToken,
				"x-hub-protocol-version": protocolVersion,
				"idempotency-key": key,
			});
			const stale = await app.inject({
				method: "POST",
				url: `/api/campaigns/${ctx.campaign.id}/multi-target-operations`,
				headers: headers(sourceSession, "5", commandId),
				payload,
			});
			expect(stale.statusCode).toBe(426);
			const created = await app.inject({
				method: "POST",
				url: `/api/campaigns/${ctx.campaign.id}/multi-target-operations`,
				headers: headers(sourceSession, "6", commandId),
				payload,
			});
			expect(created.statusCode).toBe(201);
			const operation = created.json().operation;
			const [staleInbox, staleReplay] = await Promise.all([
				app.inject({
					method: "GET",
					url: `/api/campaigns/${ctx.campaign.id}/multi-target-operations/inbox`,
					headers: {cookie: targetSession.cookie, "x-hub-protocol-version": "5"},
				}),
				app.inject({
					method: "GET",
					url: `/api/campaigns/${ctx.campaign.id}/events`,
					headers: {cookie: targetSession.cookie, "x-hub-protocol-version": "5"},
				}),
			]);
			expect([staleInbox.statusCode, staleReplay.statusCode]).toEqual([426, 426]);
			for (let index = 0; index < 9; ++index) {
				const replay = await app.inject({
					method: "POST",
					url: `/api/campaigns/${ctx.campaign.id}/multi-target-operations`,
					headers: headers(sourceSession, "6", commandId),
					payload,
				});
				expect(replay.statusCode).toBe(201);
			}
			const rateLimitedEvidence = {
				operations: ctx.store._semanticOperations.size,
				events: ctx.store._events.length,
				commands: ctx.store._semanticOperationCommands.size,
			};
			const rateLimited = await app.inject({
				method: "POST",
				url: `/api/campaigns/${ctx.campaign.id}/multi-target-operations`,
				headers: headers(sourceSession, "6", commandId),
				payload,
			});
			expect(rateLimited.statusCode).toBe(429);
			expect(rateLimited.json()).toEqual({error: "RATE_LIMITED"});
			expect({
				operations: ctx.store._semanticOperations.size,
				events: ctx.store._events.length,
				commands: ctx.store._semanticOperationCommands.size,
			}).toEqual(rateLimitedEvidence);
			const invitationId = operation.targets[0].invitationId;
			const responseCommandId = crypto.randomUUID();
			const responded = await app.inject({
				method: "POST",
				url: `/api/campaigns/${ctx.campaign.id}/multi-target-operations/${operation.operationId}/invitations/${invitationId}/respond`,
				headers: headers(targetSession, "6", responseCommandId),
				payload: {contractVersion: 1, commandId: responseCommandId, decision: "approve"},
			});
			expect(responded.statusCode).toBe(200);
			const finalizationCommandId = crypto.randomUUID();
			const finalized = await app.inject({
				method: "POST",
				url: `/api/campaigns/${ctx.campaign.id}/multi-target-operations/${operation.operationId}/finalize`,
				headers: headers(sourceSession, "6", finalizationCommandId),
				payload: {
					contractVersion: 1,
					commandId: finalizationCommandId,
					selectedInvitationIds: [invitationId],
				},
			});
			expect(finalized.statusCode).toBe(200);
			expect(finalized.json().operation.status).toBe("applied");
			const [inbox, outgoing, detail] = await Promise.all([
				app.inject({
					method: "GET",
					url: `/api/campaigns/${ctx.campaign.id}/multi-target-operations/inbox`,
					headers: {cookie: targetSession.cookie, "x-hub-protocol-version": "6"},
				}),
				app.inject({
					method: "GET",
					url: `/api/campaigns/${ctx.campaign.id}/multi-target-operations/outgoing`,
					headers: {cookie: sourceSession.cookie, "x-hub-protocol-version": "6"},
				}),
				app.inject({
					method: "GET",
					url: `/api/campaigns/${ctx.campaign.id}/multi-target-operations/${operation.operationId}`,
					headers: {cookie: targetSession.cookie, "x-hub-protocol-version": "6"},
				}),
			]);
			expect([inbox.statusCode, outgoing.statusCode, detail.statusCode]).toEqual([200, 200, 200]);
			expect(outgoing.json().operations[0].operationId).toBe(operation.operationId);
		} finally {
			await app.close();
		}
	});

	it("rejects duplicate resolved candidates without workflow evidence", async () => {
		const ctx = await pFixture();
		const beforeEvents = ctx.store._events.length;
		await expect(ctx.pPropose({
			targetRefs: [ctx.targetA.targetRef, ctx.targetA.targetRef],
		})).rejects.toMatchObject({code: "DUPLICATE_TARGET"});
		expect(ctx.store._semanticOperations.size).toBe(0);
		expect(ctx.store._semanticOperationTargets.size).toBe(0);
		expect(ctx.store._events).toHaveLength(beforeEvents);
	});

	it("keeps two invitations for one owner independent and finalizes one atomic source cost", async () => {
		const ctx = await pFixture();
		const proposed = await ctx.pPropose();
		const operationId = proposed.operation.operationId;
		const invitations = proposed.operation.targets.map(target => target.invitationId);
		expect(new Set(invitations).size).toBe(2);
		expect(ctx.store._semanticMultiTargetUsage).toMatchObject({firstOperationId: operationId});

		await ctx.pRespond({operationId, invitationId: invitations[0]});
		const second = await ctx.pRespond({operationId, invitationId: invitations[1]});
		expect(second.operation.status).toBe("awaiting_source_selection");

		const sourceBefore = structuredClone(ctx.store._characters.get(ctx.source.id));
		const targetABefore = structuredClone(ctx.store._characters.get(ctx.targetA.id));
		const targetBBefore = structuredClone(ctx.store._characters.get(ctx.targetB.id));
		const finalized = await ctx.pFinalize({
			operationId,
			selectedInvitationIds: invitations,
		});
		expect(finalized.operation.status).toBe("applied");
		expect(ctx.store._characters.get(ctx.source.id).data.spellcasting.spellSlots[1].current).toBe(0);
		expect(ctx.store._characters.get(ctx.source.id).revision).toBe(sourceBefore.revision + 1);
		expect(ctx.store._characters.get(ctx.targetA.id).data.hp.current).toBe(targetABefore.data.hp.current + 4);
		expect(ctx.store._characters.get(ctx.targetB.id).data.hp.current).toBe(targetBBefore.data.hp.current + 4);
		expect(ctx.store._characters.get(ctx.targetA.id).revision).toBe(targetABefore.revision + 1);
		expect(ctx.store._characters.get(ctx.targetB.id).revision).toBe(targetBBefore.revision + 1);

		const finalEvents = finalized.eventIds.map(id => ctx.store._events.find(event => event.id === id));
		expect(finalEvents.map(event => event.type)).toEqual([
			"character.multi_operation.source_cost_consumed",
			"character.multi_operation.target_applied",
			"character.multi_operation.target_applied",
			"character.multi_operation.finalized",
			"character.projection.invalidated",
		]);
		expect(finalEvents.at(-1).payload).toEqual({});
	});

	it("persists an immediately-ready proposal event in the command receipt", async () => {
		const ctx = await pFixture();
		const commandId = crypto.randomUUID();
		const proposed = await ctx.pPropose({
			targetRefs: [ctx.source.targetRef],
			commandId,
		});
		expect(proposed.operation.status).toBe("awaiting_source_selection");
		expect(proposed.eventIds.map(id => ctx.store._events.find(event => event.id === id).type)).toEqual([
			"character.multi_operation.proposed",
			"character.multi_operation.target_requested",
			"character.multi_operation.ready",
		]);
		expect(ctx.store._semanticOperationCommands.get(commandId).eventIds).toEqual(proposed.eventIds);
	});

	it("preserves the same atomic contract at the eight-target bound", async () => {
		const ctx = await pFixture();
		const targets = [ctx.targetA, ctx.targetB];
		for (let index = targets.length; index < 8; ++index) {
			targets.push(await ctx.pCharacter({
				actor: ctx.targetOwner,
				name: `Target ${index + 1}`,
			}));
		}
		const proposed = await ctx.pPropose({targetRefs: targets.map(target => target.targetRef)});
		expect(proposed.operation.candidateCount).toBe(8);
		for (const target of proposed.operation.targets) {
			await ctx.pRespond({
				operationId: proposed.operation.operationId,
				invitationId: target.invitationId,
			});
		}
		const finalized = await ctx.pFinalize({
			operationId: proposed.operation.operationId,
			selectedInvitationIds: proposed.operation.targets.map(target => target.invitationId),
		});
		expect(finalized.operation.status).toBe("applied");
		expect(ctx.store._getMultiTargetTargets(proposed.operation.operationId)
			.filter(target => target.selectionState === "applied")).toHaveLength(8);
		expect(ctx.store._characters.get(ctx.source.id).data.spellcasting.spellSlots[1].current).toBe(0);
	});

	it("does not reveal co-target identity, count, or decision to a target-only owner", async () => {
		const ctx = await pFixture();
		const proposed = await ctx.pPropose({
			targetRefs: [ctx.targetA.targetRef, ctx.otherTarget.targetRef],
		});
		const otherInvitation = proposed.operation.targets.find(target =>
			target.presentation.targetName === "Other target");
		const visible = await ctx.store.pListVisibleEvents({
			accountId: ctx.other.account.id,
			campaignId: ctx.campaign.id,
		});
		const serialized = JSON.stringify(visible.filter(event =>
			event.type.startsWith("character.multi_operation.")));
		expect(serialized).toContain(otherInvitation.invitationId);
		expect(serialized).not.toContain(ctx.targetA.id);
		expect(serialized).not.toContain(ctx.targetA.targetRef);
		expect(serialized).not.toContain("candidateCount");
		const detail = await ctx.store.pGetMultiTargetOperation({
			accountId: ctx.other.account.id,
			campaignId: ctx.campaign.id,
			operationId: proposed.operation.operationId,
		});
		expect(detail.operation.targets).toEqual([
			expect.objectContaining({invitationId: otherInvitation.invitationId}),
		]);
		expect(detail.operation).not.toHaveProperty("counts");
		const exported = await ctx.store.pExportAccountData({accountId: ctx.other.account.id});
		expect(exported.multiTargetOperations).toEqual([
			expect.objectContaining({
				operationId: proposed.operation.operationId,
				targets: [expect.objectContaining({invitationId: otherInvitation.invitationId})],
			}),
		]);
		expect(exported.multiTargetOperations[0]).not.toHaveProperty("candidateCount");

		for (const target of proposed.operation.targets) {
			await ctx.pRespond({
				operationId: proposed.operation.operationId,
				invitationId: target.invitationId,
				actor: target.invitationId === otherInvitation.invitationId ? ctx.other : ctx.targetOwner,
			});
		}
		await ctx.pFinalize({
			operationId: proposed.operation.operationId,
			selectedInvitationIds: proposed.operation.targets.map(target => target.invitationId),
		});
		const membership = await ctx.store.pGetMembership({
			accountId: ctx.other.account.id,
			campaignId: ctx.campaign.id,
		});
		await ctx.store.pChangeMemberRole({
			accountId: ctx.dm.account.id,
			campaignId: ctx.campaign.id,
			membershipId: membership.id,
			role: "co_dm",
			idempotencyKey: crypto.randomUUID(),
		});
		await ctx.store.pRemoveMember({
			accountId: ctx.dm.account.id,
			campaignId: ctx.campaign.id,
			membershipId: membership.id,
			idempotencyKey: crypto.randomUUID(),
		});
		const removedExport = await ctx.store.pExportAccountData({accountId: ctx.other.account.id});
		expect(removedExport.multiTargetOperations).toEqual([
			expect.objectContaining({
				operationId: proposed.operation.operationId,
				targets: [expect.objectContaining({invitationId: otherInvitation.invitationId})],
			}),
		]);
		expect(removedExport.multiTargetOperations[0]).not.toHaveProperty("candidateCount");
		const serializedRemovedExport = JSON.stringify(removedExport.multiTargetOperations);
		expect(serializedRemovedExport).not.toContain(ctx.targetA.id);
		expect(serializedRemovedExport).not.toContain(proposed.operation.targets[0].invitationId);
	});

	it("omits aggregate candidate and response counts from target-only detail and response DTOs", async () => {
		const ctx = await pFixture();
		const proposed = await ctx.pPropose();
		const invitation = proposed.operation.targets[0];
		const detail = await ctx.store.pGetMultiTargetOperation({
			accountId: ctx.targetOwner.account.id,
			campaignId: ctx.campaign.id,
			operationId: proposed.operation.operationId,
		});
		expect(detail.operation).not.toHaveProperty("candidateCount");
		expect(detail.operation).not.toHaveProperty("counts");
		expect(detail.operation.targets).toHaveLength(2);
		const responded = await ctx.pRespond({
			operationId: proposed.operation.operationId,
			invitationId: invitation.invitationId,
		});
		expect(responded.operation).not.toHaveProperty("candidateCount");
		expect(responded.operation).not.toHaveProperty("counts");
	});

	it("cancels during collection for the source and after readiness for a DM without character writes", async () => {
		for (const actorKind of ["source", "dm"]) {
			const ctx = await pFixture();
			const proposed = await ctx.pPropose();
			if (actorKind === "dm") {
				for (const target of proposed.operation.targets) {
					await ctx.pRespond({
						operationId: proposed.operation.operationId,
						invitationId: target.invitationId,
					});
				}
			}
			const revisions = new Map([...ctx.store._characters].map(([id, character]) => [id, character.revision]));
			const commandId = crypto.randomUUID();
			const cancelled = await ctx.pCancel({
				operationId: proposed.operation.operationId,
				actor: actorKind === "dm" ? ctx.dm : ctx.sourceOwner,
				commandId,
			});
			await expect(ctx.pCancel({
				operationId: proposed.operation.operationId,
				actor: actorKind === "dm" ? ctx.dm : ctx.sourceOwner,
				commandId,
			})).resolves.toEqual(cancelled);
			expect(cancelled.operation.status).toBe("cancelled");
			expect(ctx.store._getMultiTargetTargets(proposed.operation.operationId)
				.every(target => ["revoked", "declined", "rejected", "expired"].includes(target.responseState))).toBe(true);
			expect(new Map([...ctx.store._characters].map(([id, character]) => [id, character.revision])))
				.toEqual(revisions);
			expect(cancelled.eventIds.map(id => ctx.store._events.find(event => event.id === id).type)).toEqual([
				"character.multi_operation.target_responded",
				"character.multi_operation.target_responded",
				"character.multi_operation.cancelled",
			]);
		}
	});

	it("writes a selected source target once with one combined event and revision", async () => {
		const ctx = await pFixture();
		const proposed = await ctx.pPropose({
			targetRefs: [ctx.source.targetRef, ctx.targetA.targetRef],
		});
		const operationId = proposed.operation.operationId;
		const sourceInvitation = proposed.operation.targets.find(target => target.presentation.targetName === "Source");
		const targetInvitation = proposed.operation.targets.find(target => target.presentation.targetName === "Target A");
		await ctx.pRespond({operationId, invitationId: targetInvitation.invitationId});
		const before = structuredClone(ctx.store._characters.get(ctx.source.id));
		const finalized = await ctx.pFinalize({
			operationId,
			selectedInvitationIds: [sourceInvitation.invitationId, targetInvitation.invitationId],
		});
		expect(ctx.store._characters.get(ctx.source.id).revision).toBe(before.revision + 1);
		expect(finalized.eventIds
			.map(id => ctx.store._events.find(event => event.id === id))
			.filter(event => event.aggregateId === ctx.source.id)).toEqual([
			expect.objectContaining({
				type: "character.multi_operation.target_applied",
				payload: expect.objectContaining({leg: "combined"}),
			}),
		]);
		expect(finalized.operation.sourceResult).toMatchObject({
			sourceCharacterId: ctx.source.id,
			legKind: "combined",
			legId: expect.any(String),
			operation: expect.objectContaining({targetCharacterId: ctx.source.id}),
			resultingSourceCharacterRevision: before.revision + 1,
		});
		const visibleCombined = (await ctx.store.pListVisibleEvents({
			accountId: ctx.sourceOwner.account.id,
			campaignId: ctx.campaign.id,
		})).find(event =>
			event.type === "character.multi_operation.target_applied"
			&& event.payload.operationId === operationId);
		expect(visibleCombined.payload).not.toHaveProperty("changed");
		expect(visibleCombined.payload.operation).not.toHaveProperty("targetCharacterId");
		expect(visibleCombined).toMatchObject({
			aggregateType: "semantic_operation",
			aggregateId: operationId,
			aggregateRevision: null,
		});
	});

	it("permits a reviewed target no-op without exposing it in the source result", async () => {
		const ctx = await pFixture();
		const proposed = await ctx.pPropose({targetRefs: [ctx.otherTarget.targetRef]});
		const invitation = proposed.operation.targets[0];
		await ctx.pRespond({
			operationId: proposed.operation.operationId,
			invitationId: invitation.invitationId,
			actor: ctx.other,
		});
		const revisionBefore = ctx.store._characters.get(ctx.otherTarget.id).revision;
		const finalized = await ctx.pFinalize({
			operationId: proposed.operation.operationId,
			selectedInvitationIds: [invitation.invitationId],
		});
		expect(finalized.operation.targets[0].result).toBeUndefined();
		expect(ctx.store._characters.get(ctx.otherTarget.id).revision).toBe(revisionBefore);
		const sourceEvents = await ctx.store.pListVisibleEvents({
			accountId: ctx.sourceOwner.account.id,
			campaignId: ctx.campaign.id,
		});
		const sourceTargetEvent = sourceEvents.find(event =>
			event.type === "character.multi_operation.target_applied"
			&& event.payload.invitationId === invitation.invitationId);
		expect(sourceTargetEvent.payload).not.toHaveProperty("changed");
		expect(sourceTargetEvent.payload).not.toHaveProperty("resultingCharacterRevision");
		expect(sourceTargetEvent.payload.operation).not.toHaveProperty("targetCharacterId");
		expect(sourceTargetEvent).toMatchObject({
			aggregateType: "semantic_operation",
			aggregateId: proposed.operation.operationId,
			aggregateRevision: null,
		});
		const ownerView = await ctx.store.pGetMultiTargetOperation({
			accountId: ctx.other.account.id,
			campaignId: ctx.campaign.id,
			operationId: proposed.operation.operationId,
		});
		expect(ownerView.operation.targets[0].result).toMatchObject({changed: false});
		expect(ownerView.operation.targets[0].result.operation).toMatchObject({
			targetCharacterId: ctx.otherTarget.id,
			kind: "hp.heal",
		});
	});

	it("terminally fails an unreviewed target no-op without drifting approved leg state", async () => {
		const ctx = await pFixture({allowTargetNoOp: false});
		const proposed = await ctx.pPropose({targetRefs: [ctx.targetA.targetRef]});
		const invitationId = proposed.operation.targets[0].invitationId;
		await ctx.pRespond({operationId: proposed.operation.operationId, invitationId});
		const target = ctx.store._characters.get(ctx.targetA.id);
		const fullData = structuredClone(target.data);
		fullData.hp.current = fullData.hp.effectiveMax;
		ctx.store._setCharacterData({character: target, data: fullData});
		target.revision++;
		const finalized = await ctx.pFinalize({
			operationId: proposed.operation.operationId,
			selectedInvitationIds: [invitationId],
		});
		expect(finalized.operation.status).toBe("failed");
		expect(ctx.store._getMultiTargetTargets(proposed.operation.operationId)).toEqual([
			expect.objectContaining({
				responseState: "approved",
				selectionState: "unselected",
				legId: null,
			}),
		]);
		expect(ctx.store._events.filter(event =>
			event.payload?.operationId === proposed.operation.operationId
			&& event.payload?.status === "declined")).toHaveLength(0);
	});

	it("expires pending invitations without a reader and rejects late approval", async () => {
		const ctx = await pFixture();
		const proposed = await ctx.pPropose();
		const invitation = proposed.operation.targets[0];
		ctx.setNow("2026-09-21T10:02:00.000Z");
		await expect(ctx.store.pExpireMultiTargetOperations()).resolves.toEqual({processed: 1});
		const operation = ctx.store._semanticOperations.get(proposed.operation.operationId);
		expect(operation.status).toBe("awaiting_source_selection");
		await expect(ctx.pRespond({
			operationId: operation.id,
			invitationId: invitation.invitationId,
		})).resolves.toMatchObject({
			invitation: expect.objectContaining({status: "expired"}),
		});
	});

	it("persists inline expiry and readiness events in the finalization receipt", async () => {
		const ctx = await pFixture();
		const commandId = crypto.randomUUID();
		const proposed = await ctx.pPropose();
		await ctx.pRespond({
			operationId: proposed.operation.operationId,
			invitationId: proposed.operation.targets[0].invitationId,
		});
		ctx.setNow("2026-09-21T10:02:00.000Z");
		const finalized = await ctx.pFinalize({
			operationId: proposed.operation.operationId,
			selectedInvitationIds: [proposed.operation.targets[0].invitationId],
			commandId,
		});
		const types = finalized.eventIds.map(id => ctx.store._events.find(event => event.id === id).type);
		expect(types.slice(0, 2)).toEqual([
			"character.multi_operation.target_responded",
			"character.multi_operation.ready",
		]);
		expect(ctx.store._semanticOperationCommands.get(commandId).eventIds).toEqual(finalized.eventIds);
	});

	it("uses an exclusive oldest-pending cursor without starving later invitations", async () => {
		const ctx = await pFixture();
		await ctx.pPropose({
			targetRefs: [ctx.targetA.targetRef, ctx.targetB.targetRef, ctx.otherTarget.targetRef],
		});
		const first = await ctx.store.pListMultiTargetInbox({
			accountId: ctx.dm.account.id,
			campaignId: ctx.campaign.id,
			limit: 2,
		});
		expect(first.invitations).toHaveLength(2);
		expect(first.nextCursor).toEqual(expect.any(String));
		const second = await ctx.store.pListMultiTargetInbox({
			accountId: ctx.dm.account.id,
			campaignId: ctx.campaign.id,
			cursor: first.nextCursor,
			limit: 2,
		});
		expect(second.invitations).toHaveLength(1);
		expect(new Set([
			...first.invitations.map(invitation => invitation.invitationId),
			...second.invitations.map(invitation => invitation.invitationId),
		]).size).toBe(3);
	});

	it("serializes the global source-account fifth slot across campaigns with one winner and no loser evidence", async () => {
		const ctx = await pFixture();
		const pCreate = async ({campaignId, source, target, rulesVersionId}) => {
			const commandId = crypto.randomUUID();
			const request = {
				contractVersion: 1,
				commandId,
				sourceCharacterId: source.id,
				sourceEntity: SOURCE_ENTITY,
				effectTemplateId: EFFECT_TEMPLATE_ID,
				choice: {amount: 4},
				targetRefs: [target.targetRef],
				rulesVersionId,
			};
			return ctx.store.pCreateMultiTargetOperation({
				accountId: ctx.sourceOwner.account.id,
				sessionId: ctx.sourceOwner.session.id,
				campaignId,
				...request,
				protocolVersion: "6",
				idempotencyKey: getIdempotency(commandId, request),
			});
		};
		const currentRulesVersionId = ctx.store._campaigns.get(ctx.campaign.id).activeRulesVersionId;
		for (let index = 0; index < 3; ++index) {
			await pCreate({
				campaignId: ctx.campaign.id,
				source: ctx.source,
				target: ctx.targetA,
				rulesVersionId: currentRulesVersionId,
			});
		}
		const currentExtraSource = await ctx.pCharacter({
			actor: ctx.sourceOwner,
			name: "Current extra source",
		});
		const campaign2 = (await ctx.store.pCreateCampaign({
			accountId: ctx.dm.account.id,
			name: "Second quota campaign",
			idempotencyKey: crypto.randomUUID(),
		})).campaign;
		for (const actor of [ctx.sourceOwner, ctx.targetOwner]) {
			const tokenHash = crypto.randomBytes(32).toString("hex");
			await ctx.store.pCreateInvite({
				accountId: ctx.dm.account.id,
				campaignId: campaign2.id,
				role: "player",
				tokenHash,
				expiresAt: new Date("2026-09-21T10:01:00.000Z"),
				maxUses: 1,
				idempotencyKey: crypto.randomUUID(),
			});
			await ctx.store.pRedeemInvite({
				accountId: actor.account.id,
				tokenHash,
				idempotencyKey: crypto.randomUUID(),
			});
		}
		const rules2 = (await ctx.store.pCreateRulesVersion({
			accountId: ctx.dm.account.id,
			campaignId: campaign2.id,
			schemaVersion: 1,
			rules: {},
			idempotencyKey: crypto.randomUUID(),
		})).rulesVersion;
		await ctx.store.pActivateRulesVersion({
			accountId: ctx.dm.account.id,
			campaignId: campaign2.id,
			rulesVersionId: rules2.id,
			idempotencyKey: crypto.randomUUID(),
		});
		const pCharacterInCampaign2 = async ({actor, name}) => (await ctx.store.pCreateCharacter({
			accountId: actor.account.id,
			campaignId: campaign2.id,
			data: getCharacterData({name}),
			schemaVersion: 1,
			clientImportId: crypto.randomUUID(),
			idempotencyKey: crypto.randomUUID(),
		})).character;
		const source2 = await pCharacterInCampaign2({actor: ctx.sourceOwner, name: "Second source"});
		const target2 = await pCharacterInCampaign2({actor: ctx.targetOwner, name: "Second target"});
		await pCreate({campaignId: campaign2.id, source: source2, target: target2, rulesVersionId: rules2.id});

		const before = {
			operations: ctx.store._semanticOperations.size,
			targets: ctx.store._semanticOperationTargets.size,
			commands: ctx.store._semanticOperationCommands.size,
			events: ctx.store._events.length,
			audit: ctx.store._audit.length,
		};
		const results = await Promise.allSettled([
			pCreate({
				campaignId: ctx.campaign.id,
				source: currentExtraSource,
				target: ctx.targetB,
				rulesVersionId: currentRulesVersionId,
			}),
			pCreate({campaignId: campaign2.id, source: source2, target: target2, rulesVersionId: rules2.id}),
		]);
		expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
		expect(results.filter(result => result.status === "rejected")).toEqual([
			expect.objectContaining({reason: expect.objectContaining({code: "COLLECTION_LIMIT_REACHED"})}),
		]);
		expect(ctx.store._semanticOperations.size).toBe(before.operations + 1);
		expect(ctx.store._semanticOperationTargets.size).toBe(before.targets + 1);
		expect(ctx.store._semanticOperationCommands.size).toBe(before.commands + 1);
		expect(ctx.store._audit).toHaveLength(before.audit + 1);
		expect(ctx.store._events.length).toBe(before.events + 2);
	});

	it.each(["source", "target"])("terminalizes %s-side archive without orphaning target rows", async side => {
		const ctx = await pFixture();
		const proposed = await ctx.pPropose({targetRefs: [ctx.targetA.targetRef]});
		await ctx.store.pArchiveCharacter({
			accountId: side === "source" ? ctx.sourceOwner.account.id : ctx.targetOwner.account.id,
			characterId: side === "source" ? ctx.source.id : ctx.targetA.id,
			idempotencyKey: crypto.randomUUID(),
		});
		const operation = ctx.store._semanticOperations.get(proposed.operation.operationId);
		const targets = ctx.store._getMultiTargetTargets(operation.id);
		expect(operation.status).toBe("cancelled");
		expect(operation.terminalEventId).toEqual(expect.any(String));
		expect(targets).toHaveLength(1);
		if (side === "target") expect(targets[0].responseState).toBe("revoked");
	});

	it("cancels a live multi-target parent before purging one target owner and continues the due batch", async () => {
		const ctx = await pFixture();
		const proposed = await ctx.pPropose({
			targetRefs: [ctx.targetA.targetRef, ctx.otherTarget.targetRef],
		});
		const extraDue = await ctx.store.pUpsertOAuthAccount({
			provider: "github",
			providerSubject: `extra-due-${crypto.randomUUID()}`,
			displayName: "Extra due",
		});
		for (const account of [
			ctx.store._accounts.get(ctx.targetOwner.account.id),
			ctx.store._accounts.get(extraDue.id),
		]) {
			account.status = "deletion_requested";
			account.deletionRequestedAt = "2026-09-20T00:00:00.000Z";
			account.purgeAfter = "2026-09-20T00:00:00.000Z";
		}
		const result = await ctx.store.pPurgeDueAccounts({limit: 100});
		expect(new Set(result.purgedAccountIds)).toEqual(new Set([
			ctx.targetOwner.account.id,
			extraDue.id,
		]));
		expect(ctx.store._semanticOperations.has(proposed.operation.operationId)).toBe(false);
		expect(ctx.store._getMultiTargetTargets(proposed.operation.operationId)).toEqual([]);
		expect(ctx.store._accounts.has(ctx.other.account.id)).toBe(true);
		expect(ctx.store._characters.has(ctx.otherTarget.id)).toBe(true);
		const retainedEvents = ctx.store._events.filter(event =>
			event.payload?.operationId === proposed.operation.operationId);
		expect(retainedEvents.map(event => event.type)).toEqual(expect.arrayContaining([
			"character.multi_operation.target_responded",
			"character.multi_operation.cancelled",
		]));
		expect(ctx.store._outbox.filter(entry =>
			retainedEvents.some(event => event.id === entry.eventId)).length).toBe(retainedEvents.length);
		expect(ctx.store._audit).toContainEqual(expect.objectContaining({
			action: "character.multi_operation.cancelled",
			targetId: proposed.operation.operationId,
			details: {reason: "account_purge"},
		}));
	});

	it("rejects a submitted non-approved leg without finalization evidence", async () => {
		const ctx = await pFixture();
		const proposed = await ctx.pPropose();
		const operationId = proposed.operation.operationId;
		const [approved, pending] = proposed.operation.targets;
		await ctx.pRespond({operationId, invitationId: approved.invitationId});
		ctx.setNow("2026-09-21T10:02:00.000Z");
		await ctx.store.pExpireMultiTargetOperations();
		const before = {
			commands: ctx.store._semanticOperationCommands.size,
			finalizations: ctx.store._semanticOperationFinalizations.size,
			events: ctx.store._events.length,
		};
		await expect(ctx.pFinalize({
			operationId,
			selectedInvitationIds: [approved.invitationId, pending.invitationId],
		})).rejects.toMatchObject({code: "FINALIZATION_SELECTION_INVALID"});
		expect({
			commands: ctx.store._semanticOperationCommands.size,
			finalizations: ctx.store._semanticOperationFinalizations.size,
			events: ctx.store._events.length,
		}).toEqual(before);
	});

	it("rejects target authority drift without evidence and lets a fresh valid subset finalize", async () => {
		const ctx = await pFixture();
		const proposed = await ctx.pPropose();
		const operationId = proposed.operation.operationId;
		const [stale, valid] = proposed.operation.targets;
		await ctx.pRespond({operationId, invitationId: stale.invitationId});
		await ctx.pRespond({operationId, invitationId: valid.invitationId});
		ctx.store._characters.get(ctx.targetA.id).targetRef = crypto.randomUUID();
		const before = {
			commands: ctx.store._semanticOperationCommands.size,
			finalizations: ctx.store._semanticOperationFinalizations.size,
			events: ctx.store._events.length,
			audit: ctx.store._audit.length,
			sourceRevision: ctx.store._characters.get(ctx.source.id).revision,
			validRevision: ctx.store._characters.get(ctx.targetB.id).revision,
		};
		await expect(ctx.pFinalize({
			operationId,
			selectedInvitationIds: [stale.invitationId, valid.invitationId],
		})).rejects.toMatchObject({code: "FINALIZATION_SELECTION_INVALID"});
		expect({
			commands: ctx.store._semanticOperationCommands.size,
			finalizations: ctx.store._semanticOperationFinalizations.size,
			events: ctx.store._events.length,
			audit: ctx.store._audit.length,
			sourceRevision: ctx.store._characters.get(ctx.source.id).revision,
			validRevision: ctx.store._characters.get(ctx.targetB.id).revision,
		}).toEqual(before);
		await expect(ctx.pFinalize({
			operationId,
			selectedInvitationIds: [valid.invitationId],
		})).resolves.toMatchObject({operation: {status: "applied"}});
	});

	it("permanently invalidates consent after a source cost is spent and restored", async () => {
		const ctx = await pFixture();
		const proposed = await ctx.pPropose();
		for (const invitation of proposed.operation.targets) {
			await ctx.pRespond({
				operationId: proposed.operation.operationId,
				invitationId: invitation.invitationId,
			});
		}
		const source = ctx.store._characters.get(ctx.source.id);
		const spent = structuredClone(source.data);
		spent.spellcasting.spellSlots[1].current = 0;
		ctx.store._setCharacterData({character: source, data: spent});
		const restored = structuredClone(source.data);
		restored.spellcasting.spellSlots[1].current = 1;
		ctx.store._setCharacterData({character: source, data: restored});
		expect(ctx.store._semanticOperations.get(proposed.operation.operationId).sourceCostInvalidated).toBe(true);
		const targetBefore = structuredClone(ctx.store._characters.get(ctx.targetA.id));
		const finalized = await ctx.pFinalize({
			operationId: proposed.operation.operationId,
			selectedInvitationIds: [proposed.operation.targets[0].invitationId],
		});
		expect(finalized.operation.status).toBe("failed");
		expect(ctx.store._characters.get(ctx.source.id).data.spellcasting.spellSlots[1].current).toBe(1);
		expect(ctx.store._characters.get(ctx.targetA.id)).toEqual(targetBefore);
		expect(ctx.store._getMultiTargetTargets(proposed.operation.operationId).map(target => ({
			responseState: target.responseState,
			selectionState: target.selectionState,
		}))).toEqual([
			{responseState: "approved", selectionState: "unselected"},
			{responseState: "approved", selectionState: "unselected"},
		]);
		expect(ctx.store._events.filter(event =>
			event.payload?.operationId === proposed.operation.operationId
			&& event.payload?.status === "declined")).toHaveLength(0);
	});

	it("emits a deterministic declined leg event for every approved target omitted at finalization", async () => {
		const ctx = await pFixture();
		const proposed = await ctx.pPropose();
		const operationId = proposed.operation.operationId;
		for (const target of proposed.operation.targets) {
			await ctx.pRespond({operationId, invitationId: target.invitationId});
		}
		const finalized = await ctx.pFinalize({
			operationId,
			selectedInvitationIds: [proposed.operation.targets[1].invitationId],
		});
		const declined = ctx.store._getMultiTargetTargets(operationId)[0];
		expect(declined.responseState).toBe("declined");
		const finalizationEvents = finalized.eventIds
			.map(id => ctx.store._events.find(event => event.id === id));
		const declinedEvent = finalizationEvents
			.find(event => event.payload?.invitationId === declined.invitationId);
		expect(declinedEvent).toMatchObject({
			type: "character.multi_operation.target_responded",
			payload: {status: "declined"},
		});
		expect(finalizationEvents.slice(0, 3).map(event => event.type)).toEqual([
			"character.multi_operation.source_cost_consumed",
			"character.multi_operation.target_responded",
			"character.multi_operation.target_applied",
		]);
	});

	it.each([
		"multi-target:character-write",
		"multi-target:source-event",
		"multi-target:target-event",
		"multi-target:projection-invalidation",
		"multi-target:audit",
		"multi-target:receipt",
	])("rolls back the whole finalization after an injected %s fault", async faultStage => {
		const ctx = await pFixture();
		const proposed = await ctx.pPropose();
		const operationId = proposed.operation.operationId;
		const invitations = proposed.operation.targets.map(target => target.invitationId);
		for (const invitationId of invitations) await ctx.pRespond({operationId, invitationId});
		const before = structuredClone({
			characters: ctx.store._characters,
			operations: ctx.store._semanticOperations,
			targets: ctx.store._semanticOperationTargets,
			finalizations: ctx.store._semanticOperationFinalizations,
			commands: ctx.store._semanticOperationCommands,
			events: ctx.store._events,
			outbox: ctx.store._outbox,
			audit: ctx.store._audit,
		});
		ctx.setFaultStage(faultStage);
		await expect(ctx.pFinalize({
			operationId,
			selectedInvitationIds: invitations,
		})).rejects.toThrow(`Injected ${faultStage}`);
		expect(structuredClone({
			characters: ctx.store._characters,
			operations: ctx.store._semanticOperations,
			targets: ctx.store._semanticOperationTargets,
			finalizations: ctx.store._semanticOperationFinalizations,
			commands: ctx.store._semanticOperationCommands,
			events: ctx.store._events,
			outbox: ctx.store._outbox,
			audit: ctx.store._audit,
		})).toEqual(before);
		ctx.setFaultStage(null);
		await expect(ctx.pFinalize({
			operationId,
			selectedInvitationIds: invitations,
		})).resolves.toMatchObject({operation: {status: "applied"}});
	});

	it("keeps the irreversible first-use marker after ordinary campaign cleanup", async () => {
		const ctx = await pFixture();
		const proposed = await ctx.pPropose();
		const marker = structuredClone(ctx.store._semanticMultiTargetUsage);
		expect(marker.firstOperationId).toBe(proposed.operation.operationId);
		ctx.store._deleteCampaignData(ctx.campaign.id);
		expect(ctx.store._semanticMultiTargetUsage).toEqual(marker);
	});

	it("cleans bounded 90-day terminal history without deleting the usage marker", async () => {
		const ctx = await pFixture();
		const proposed = await ctx.pPropose({
			targetRefs: [ctx.source.targetRef, ctx.targetA.targetRef],
		});
		const sourceInvitation = proposed.operation.targets.find(target =>
			target.presentation.targetName === "Source");
		const targetInvitation = proposed.operation.targets.find(target =>
			target.presentation.targetName === "Target A");
		await ctx.pRespond({
			operationId: proposed.operation.operationId,
			invitationId: targetInvitation.invitationId,
		});
		await ctx.pFinalize({
			operationId: proposed.operation.operationId,
			selectedInvitationIds: [sourceInvitation.invitationId, targetInvitation.invitationId],
		});
		const marker = structuredClone(ctx.store._semanticMultiTargetUsage);
		ctx.store._semanticOperations.get(proposed.operation.operationId).resolvedAt = "2026-01-01T00:00:00.000Z";
		for (const entry of ctx.store._outbox) {
			const event = ctx.store._events.find(candidate => candidate.id === entry.eventId);
			if (event?.type !== "character.projection.invalidated") entry.status = "published";
		}
		ctx.setNow("2026-09-21T10:00:00.000Z");
		await expect(ctx.store.pCleanupMultiTargetHistory()).resolves.toEqual({deleted: 0});
		for (const entry of ctx.store._outbox) entry.status = "published";
		await expect(ctx.store.pCleanupMultiTargetHistory()).resolves.toEqual({deleted: 1});
		expect(ctx.store._semanticOperations.has(proposed.operation.operationId)).toBe(false);
		expect(ctx.store._semanticOperationTargets.size).toBe(0);
		expect(ctx.store._semanticOperationFinalizations.size).toBe(0);
		expect(ctx.store._semanticMultiTargetUsage).toEqual(marker);
		expect(await ctx.store.pCampaignRequiresProtocol6({campaignId: ctx.campaign.id})).toBe(true);
		const sourceEvents = (await ctx.store.pListVisibleEvents({
			accountId: ctx.sourceOwner.account.id,
			campaignId: ctx.campaign.id,
		})).filter(event => event.type === "character.multi_operation.target_applied");
		expect(sourceEvents).toHaveLength(2);
		for (const event of sourceEvents) {
			expect(event).toMatchObject({
				aggregateType: "semantic_operation",
				aggregateId: proposed.operation.operationId,
				aggregateRevision: null,
			});
			expect(event.payload).not.toHaveProperty("_sourceOwnerAccountId");
			expect(event.payload).not.toHaveProperty("_targetOwnerAccountId");
		}
		const targetEvent = (await ctx.store.pListVisibleEvents({
			accountId: ctx.targetOwner.account.id,
			campaignId: ctx.campaign.id,
		})).find(event =>
			event.type === "character.multi_operation.target_applied"
			&& event.payload.invitationId === targetInvitation.invitationId);
		expect(targetEvent).toMatchObject({
			aggregateType: "character",
			aggregateId: ctx.targetA.id,
			aggregateRevision: 2,
			payload: {changed: true, resultingCharacterRevision: 2},
		});
		expect(targetEvent.payload).not.toHaveProperty("_sourceOwnerAccountId");
		expect(targetEvent.payload).not.toHaveProperty("_targetOwnerAccountId");
		const dmEvents = (await ctx.store.pListVisibleEvents({
			accountId: ctx.dm.account.id,
			campaignId: ctx.campaign.id,
		})).filter(event => event.type === "character.multi_operation.target_applied");
		expect(dmEvents.map(event => event.aggregateId)).toEqual([ctx.source.id, ctx.targetA.id]);
		for (const event of dmEvents) {
			expect(event.payload).not.toHaveProperty("_sourceOwnerAccountId");
			expect(event.payload).not.toHaveProperty("_targetOwnerAccountId");
		}
		expect((await ctx.store.pListVisibleEvents({
			accountId: ctx.other.account.id,
			campaignId: ctx.campaign.id,
		})).filter(event => event.type === "character.multi_operation.target_applied")).toEqual([]);
	});

	it("keeps legacy pending/outgoing reads safe when multi-target parents coexist", async () => {
		const ctx = await pFixture();
		await ctx.pPropose();
		await expect(ctx.store.pListPendingActions({
			accountId: ctx.sourceOwner.account.id,
			campaignId: ctx.campaign.id,
		})).resolves.toEqual([]);
		await expect(ctx.store.pListCharacterOutgoingActions({
			accountId: ctx.sourceOwner.account.id,
			campaignId: ctx.campaign.id,
			characterId: ctx.source.id,
		})).resolves.toEqual([]);
	});
});
