import crypto from "node:crypto";
import pg from "pg";

import {createHubApp} from "../../../server/src/app.js";
import {HubStoreError} from "../../../server/src/hub-store-error.js";
import {PostgresHubStore} from "../../../server/src/postgres-hub-store.js";
import {createSemanticOperationRegistry} from "../../../server/src/semantic-operation-registry.js";

const {Pool} = pg;
const describePostgres = process.env.HUB_TEST_POSTGRES_URL ? describe : describe.skip;

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

describePostgres("Campaign Hub multi-target authority (real PostgreSQL)", () => {
	let pool;
	let store;

	async function pActor (label) {
		const account = await store.pUpsertOAuthAccount({
			provider: "test",
			providerSubject: `${label}-${crypto.randomUUID()}`,
			displayName: label,
		});
		const token = crypto.randomBytes(32).toString("hex");
		const session = await store.pCreateSession({
			accountId: account.id,
			tokenHash: crypto.createHash("sha256").update(token).digest("hex"),
			expiresAt: new Date(Date.now() + 86_400_000),
		});
		return {account, session, token};
	}

	async function pCreateCampaign ({dm, name}) {
		const campaign = (await store.pCreateCampaign({
			accountId: dm.account.id,
			name: `${name} ${crypto.randomUUID()}`,
			idempotencyKey: crypto.randomUUID(),
		})).campaign;
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
		return {campaign, rulesVersion};
	}

	async function pJoin ({dm, campaign, actor, role = "player"}) {
		const tokenHash = crypto.randomBytes(32).toString("hex");
		await store.pCreateInvite({
			accountId: dm.account.id,
			campaignId: campaign.id,
			role,
			tokenHash,
			expiresAt: new Date(Date.now() + 60_000),
			maxUses: 1,
			idempotencyKey: crypto.randomUUID(),
		});
		return (await store.pRedeemInvite({
			accountId: actor.account.id,
			tokenHash,
			idempotencyKey: crypto.randomUUID(),
		})).membership;
	}

	async function pCharacter ({actor, campaign, name, hp = 5, slots = 1}) {
		return (await store.pCreateCharacter({
			accountId: actor.account.id,
			campaignId: campaign.id,
			data: getCharacterData({name, hp, slots}),
			schemaVersion: 1,
			clientImportId: crypto.randomUUID(),
			idempotencyKey: crypto.randomUUID(),
		})).character;
	}

	async function pFixture ({targetCount = 2, sameTargetOwner = true, targetHps = []} = {}) {
		const dm = await pActor("Multi PG DM");
		const sourceOwner = await pActor("Multi PG Source");
		const {campaign, rulesVersion} = await pCreateCampaign({dm, name: "Multi PG"});
		await pJoin({dm, campaign, actor: sourceOwner});
		const source = await pCharacter({actor: sourceOwner, campaign, name: "Source", hp: 10});
		const targetOwners = [];
		const targets = [];
		for (let index = 0; index < targetCount; ++index) {
			const actor = sameTargetOwner && targetOwners.length
				? targetOwners[0]
				: await pActor(`Multi PG Target ${index}`);
			if (!targetOwners.includes(actor)) {
				targetOwners.push(actor);
				await pJoin({dm, campaign, actor});
			}
			targets.push(await pCharacter({
				actor,
				campaign,
				name: `Target ${index}`,
				hp: targetHps[index] ?? 5,
			}));
		}
		const pPropose = async ({
			targetRefs = targets.map(target => target.targetRef),
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
		const pRespond = async ({operationId, invitationId, actor = targetOwners[0], commandId = crypto.randomUUID()}) => {
			const request = {contractVersion: 1, commandId, operationId, invitationId, decision: "approve"};
			return store.pRespondMultiTargetInvitation({
				accountId: actor.account.id,
				sessionId: actor.session.id,
				campaignId: campaign.id,
				...request,
				protocolVersion: "6",
				idempotencyKey: getIdempotency(commandId, request),
			});
		};
		const pFinalize = async ({operationId, selectedInvitationIds, commandId = crypto.randomUUID()}) => {
			const request = {contractVersion: 1, commandId, operationId, selectedInvitationIds};
			return store.pFinalizeMultiTargetOperation({
				accountId: sourceOwner.account.id,
				sessionId: sourceOwner.session.id,
				campaignId: campaign.id,
				...request,
				protocolVersion: "6",
				idempotencyKey: getIdempotency(commandId, request),
			});
		};
		return {
			dm,
			sourceOwner,
			campaign,
			rulesVersion,
			source,
			targetOwners,
			targets,
			pPropose,
			pRespond,
			pFinalize,
		};
	}

	beforeAll(async () => {
		pool = new Pool({
			connectionString: process.env.HUB_TEST_POSTGRES_URL,
			ssl: false,
			max: 12,
		});
		store = new PostgresHubStore({
			pool,
			semanticOperationRegistry: getRegistry(),
			multiTargetOperationsEnabled: true,
		});
		await store.pCheckHealth();
	});

	afterAll(async () => {
		await pool?.end();
	});

	test.each([1, 2, 8])("applies one cost and exactly %i selected target legs", async targetCount => {
		const ctx = await pFixture({targetCount});
		const proposed = await ctx.pPropose();
		expect(proposed.operation.targets).toHaveLength(targetCount);
		const invitations = proposed.operation.targets.map(target => target.invitationId);
		for (const invitationId of invitations) {
			await ctx.pRespond({operationId: proposed.operation.operationId, invitationId});
		}
		const finalized = await ctx.pFinalize({
			operationId: proposed.operation.operationId,
			selectedInvitationIds: invitations,
		});
		expect(finalized.operation.status).toBe("applied");
		expect(finalized.operation.sourceResult).toMatchObject({
			sourceCharacterId: ctx.source.id,
			sourceCost: {
				version: 1,
				components: [{kind: "spell_slot", pool: "standard", level: 1, amount: 1}],
			},
			resultingSourceCharacterRevision: 2,
			appliedEventId: expect.any(String),
			legKind: "source",
		});
		expect(finalized.operation.sourceResult).not.toHaveProperty("legId");
		expect(finalized.operation.sourceResult).not.toHaveProperty("operation");
		const ownerDetail = await store.pGetMultiTargetOperation({
			accountId: ctx.targetOwners[0].account.id,
			campaignId: ctx.campaign.id,
			operationId: proposed.operation.operationId,
		});
		expect(ownerDetail.operation).not.toHaveProperty("sourceCharacterId");
		expect(ownerDetail.operation).not.toHaveProperty("sourceResult");
		expect(ownerDetail.operation).not.toHaveProperty("candidateCount");
		expect(ownerDetail.operation).not.toHaveProperty("counts");
		expect(ownerDetail.operation.targets[0].result).toMatchObject({
			changed: true,
			resultingCharacterRevision: 2,
			legId: expect.any(String),
			legKind: "target",
			appliedEventId: expect.any(String),
			operation: {
				operationId: proposed.operation.operationId,
				kind: "hp.heal",
				version: 1,
				targetCharacterId: ctx.targets[0].id,
				arguments: {amount: 4},
			},
		});
		const dmDetail = await store.pGetMultiTargetOperation({
			accountId: ctx.dm.account.id,
			campaignId: ctx.campaign.id,
			operationId: proposed.operation.operationId,
		});
		expect(dmDetail.operation.sourceResult).toEqual(finalized.operation.sourceResult);
		expect(dmDetail.operation.targets).toEqual(expect.arrayContaining([
			expect.objectContaining({
				result: expect.objectContaining({
					legKind: "target",
					operation: expect.objectContaining({kind: "hp.heal"}),
				}),
			}),
		]));
		const persisted = await pool.query(`
			SELECT
				(SELECT data->'spellcasting'->'spellSlots'->'1'->>'current'
					FROM hub.characters WHERE id = $2) AS source_slots,
				count(*) FILTER (WHERE target.selection_state = 'applied')::integer AS applied_targets,
				count(*) FILTER (WHERE target.leg_id IS NOT NULL)::integer AS leg_count
			FROM hub.semantic_operation_targets target
			WHERE target.operation_id = $1
		`, [proposed.operation.operationId, ctx.source.id]);
		expect(persisted.rows[0]).toEqual({
			source_slots: "0",
			applied_targets: targetCount,
			leg_count: targetCount,
		});
	});

	test("exports retained operations with source detail and target-only privacy", async () => {
		const ctx = await pFixture({targetCount: 2, sameTargetOwner: false});
		const proposed = await ctx.pPropose();
		for (let index = 0; index < proposed.operation.targets.length; ++index) {
			await ctx.pRespond({
				operationId: proposed.operation.operationId,
				invitationId: proposed.operation.targets[index].invitationId,
				actor: ctx.targetOwners[index],
			});
		}
		await ctx.pFinalize({
			operationId: proposed.operation.operationId,
			selectedInvitationIds: proposed.operation.targets.map(target => target.invitationId),
		});
		const targetInvitation = proposed.operation.targets[1];
		const targetExport = await store.pExportAccountData({
			accountId: ctx.targetOwners[1].account.id,
		});
		expect(targetExport.multiTargetOperations).toEqual([
			expect.objectContaining({
				operationId: proposed.operation.operationId,
				status: "applied",
				finalization: expect.objectContaining({status: "applied"}),
				targets: [expect.objectContaining({invitationId: targetInvitation.invitationId})],
			}),
		]);
		expect(targetExport.multiTargetOperations[0]).not.toHaveProperty("candidateCount");
		const serializedTargetExport = JSON.stringify(targetExport.multiTargetOperations);
		expect(serializedTargetExport).not.toContain(ctx.targets[0].id);
		expect(serializedTargetExport).not.toContain(ctx.targets[0].targetRef);
		expect(serializedTargetExport).not.toContain(proposed.operation.targets[0].invitationId);

		const sourceExport = await store.pExportAccountData({
			accountId: ctx.sourceOwner.account.id,
		});
		expect(sourceExport.multiTargetOperations).toEqual([
			expect.objectContaining({
				operationId: proposed.operation.operationId,
				candidateCount: 2,
				finalization: {
					status: "applied",
					selectedInvitationIds: proposed.operation.targets.map(target => target.invitationId),
				},
				targets: expect.arrayContaining([
					expect.objectContaining({invitationId: proposed.operation.targets[0].invitationId}),
					expect.objectContaining({invitationId: targetInvitation.invitationId}),
				]),
			}),
		]);

		const membership = await store.pGetMembership({
			accountId: ctx.targetOwners[1].account.id,
			campaignId: ctx.campaign.id,
		});
		await store.pChangeMemberRole({
			accountId: ctx.dm.account.id,
			campaignId: ctx.campaign.id,
			membershipId: membership.id,
			role: "co_dm",
			idempotencyKey: crypto.randomUUID(),
		});
		await store.pRemoveMember({
			accountId: ctx.dm.account.id,
			campaignId: ctx.campaign.id,
			membershipId: membership.id,
			idempotencyKey: crypto.randomUUID(),
		});
		const removedExport = await store.pExportAccountData({
			accountId: ctx.targetOwners[1].account.id,
		});
		expect(removedExport.multiTargetOperations).toEqual([
			expect.objectContaining({
				operationId: proposed.operation.operationId,
				targets: [expect.objectContaining({invitationId: targetInvitation.invitationId})],
			}),
		]);
		expect(removedExport.multiTargetOperations[0]).not.toHaveProperty("candidateCount");
		const serializedRemovedExport = JSON.stringify(removedExport.multiTargetOperations);
		expect(serializedRemovedExport).not.toContain(ctx.targets[0].id);
		expect(serializedRemovedExport).not.toContain(proposed.operation.targets[0].invitationId);
	});

	test("fails protocols 3/4/5 and duplicate targets without workflow evidence", async () => {
		const ctx = await pFixture({targetCount: 1});
		for (const protocolVersion of ["3", "4", "5"]) {
			const commandId = crypto.randomUUID();
			await expect(ctx.pPropose({protocolVersion, commandId}))
				.rejects.toMatchObject({code: "PROTOCOL_UPDATE_REQUIRED"});
			const evidence = await pool.query(`
				SELECT
					(SELECT count(*)::integer FROM hub.semantic_operation_commands WHERE command_id = $1) AS commands,
					(SELECT count(*)::integer FROM hub.semantic_operations WHERE origin_actor_account_id = $2) AS operations
			`, [commandId, ctx.sourceOwner.account.id]);
			expect(evidence.rows[0]).toEqual({commands: 0, operations: 0});
		}
		await expect(ctx.pPropose({
			targetRefs: [ctx.targets[0].targetRef, ctx.targets[0].targetRef],
		})).rejects.toMatchObject({code: "DUPLICATE_TARGET"});
		const proposed = await ctx.pPropose();
		const invitationId = proposed.operation.targets[0].invitationId;
		for (const protocolVersion of ["3", "4", "5"]) {
			const responseCommandId = crypto.randomUUID();
			const responseRequest = {
				contractVersion: 1,
				commandId: responseCommandId,
				operationId: proposed.operation.operationId,
				invitationId,
				decision: "approve",
			};
			await expect(store.pRespondMultiTargetInvitation({
				accountId: ctx.targetOwners[0].account.id,
				sessionId: ctx.targetOwners[0].session.id,
				campaignId: ctx.campaign.id,
				...responseRequest,
				protocolVersion,
				idempotencyKey: getIdempotency(responseCommandId, responseRequest),
			})).rejects.toMatchObject({code: "PROTOCOL_UPDATE_REQUIRED"});
			const finalizationCommandId = crypto.randomUUID();
			const finalizationRequest = {
				contractVersion: 1,
				commandId: finalizationCommandId,
				operationId: proposed.operation.operationId,
				selectedInvitationIds: [],
			};
			await expect(store.pFinalizeMultiTargetOperation({
				accountId: ctx.sourceOwner.account.id,
				sessionId: ctx.sourceOwner.session.id,
				campaignId: ctx.campaign.id,
				...finalizationRequest,
				protocolVersion,
				idempotencyKey: getIdempotency(finalizationCommandId, finalizationRequest),
			})).rejects.toMatchObject({code: "PROTOCOL_UPDATE_REQUIRED"});
		}
	});

	test("keeps same-owner invitations independent and paginates oldest pending rows", async () => {
		const ctx = await pFixture({targetCount: 3});
		const proposed = await ctx.pPropose();
		const [first, second] = proposed.operation.targets;
		await ctx.pRespond({operationId: proposed.operation.operationId, invitationId: first.invitationId});
		const detail = await store.pGetMultiTargetOperation({
			accountId: ctx.targetOwners[0].account.id,
			campaignId: ctx.campaign.id,
			operationId: proposed.operation.operationId,
		});
		expect(detail.operation.targets).toEqual(expect.arrayContaining([
			expect.objectContaining({invitationId: first.invitationId, status: "approved"}),
			expect.objectContaining({invitationId: second.invitationId, status: "pending"}),
		]));
		const firstPage = await store.pListMultiTargetInbox({
			accountId: ctx.targetOwners[0].account.id,
			campaignId: ctx.campaign.id,
			limit: 1,
		});
		expect(firstPage.invitations).toHaveLength(1);
		expect(firstPage.nextCursor).toEqual(expect.any(String));
		const secondPage = await store.pListMultiTargetInbox({
			accountId: ctx.targetOwners[0].account.id,
			campaignId: ctx.campaign.id,
			cursor: firstPage.nextCursor,
			limit: 1,
		});
		expect(secondPage.invitations).toHaveLength(1);
		expect(secondPage.invitations[0].invitationId).not.toBe(firstPage.invitations[0].invitationId);
	});

	test("persists an immediately-ready proposal event in the command receipt", async () => {
		const ctx = await pFixture({targetCount: 1});
		const commandId = crypto.randomUUID();
		const proposed = await ctx.pPropose({
			targetRefs: [ctx.source.targetRef],
			commandId,
		});
		expect(proposed.operation.status).toBe("awaiting_source_selection");
		const events = await pool.query(`
			SELECT event_type
			FROM hub.domain_events
			WHERE id = ANY($1::uuid[])
			ORDER BY sequence
		`, [proposed.eventIds]);
		expect(events.rows.map(row => row.event_type)).toEqual([
			"character.multi_operation.proposed",
			"character.multi_operation.target_requested",
			"character.multi_operation.ready",
		]);
		expect((await pool.query(`
			SELECT event_ids
			FROM hub.semantic_operation_commands
			WHERE command_id = $1
		`, [commandId])).rows[0].event_ids).toEqual(proposed.eventIds);
	});

	test("serializes response expiry and finalization races without partial evidence", async () => {
		const originalStore = store;
		store = new PostgresHubStore({
			pool,
			semanticOperationRegistry: getRegistry(),
			multiTargetOperationsEnabled: true,
			multiTargetCollectionTtlMs: 2_000,
			multiTargetOperationTtlMs: 60_000,
		});
		try {
			const ctx = await pFixture({targetCount: 2});
			const proposed = await ctx.pPropose();
			const [approved, racing] = proposed.operation.targets;
			await ctx.pRespond({
				operationId: proposed.operation.operationId,
				invitationId: approved.invitationId,
			});
			await new Promise(resolve => setTimeout(resolve, 2_100));
			const responseCommandId = crypto.randomUUID();
			const responseRequest = {
				contractVersion: 1,
				commandId: responseCommandId,
				operationId: proposed.operation.operationId,
				invitationId: racing.invitationId,
				decision: "approve",
			};
			const finalizationCommandId = crypto.randomUUID();
			const finalizationRequest = {
				contractVersion: 1,
				commandId: finalizationCommandId,
				operationId: proposed.operation.operationId,
				selectedInvitationIds: [approved.invitationId],
			};
			const settled = await Promise.allSettled([
				store.pRespondMultiTargetInvitation({
					accountId: ctx.targetOwners[0].account.id,
					sessionId: ctx.targetOwners[0].session.id,
					campaignId: ctx.campaign.id,
					...responseRequest,
					protocolVersion: "6",
					idempotencyKey: getIdempotency(responseCommandId, responseRequest),
				}),
				store.pFinalizeMultiTargetOperation({
					accountId: ctx.sourceOwner.account.id,
					sessionId: ctx.sourceOwner.session.id,
					campaignId: ctx.campaign.id,
					...finalizationRequest,
					protocolVersion: "6",
					idempotencyKey: getIdempotency(finalizationCommandId, finalizationRequest),
				}),
			]);
			const rejected = settled.find(result => result.status === "rejected");
			if (rejected) throw rejected.reason;
			expect(settled).toEqual([
				expect.objectContaining({status: "fulfilled"}),
				expect.objectContaining({status: "fulfilled"}),
			]);
			const elapsedEvents = await pool.query(`
				SELECT id
				FROM hub.domain_events
				WHERE payload->>'operationId' = $1::text
					AND (
						(event_type = 'character.multi_operation.target_responded'
							AND payload->>'status' = 'expired')
						OR event_type = 'character.multi_operation.ready'
					)
				ORDER BY sequence
			`, [proposed.operation.operationId]);
			const returnedEventIds = new Set(settled.flatMap(result =>
				result.status === "fulfilled" ? result.value.eventIds : []));
			for (const row of elapsedEvents.rows) expect(returnedEventIds.has(row.id)).toBe(true);
			const commandEvents = await pool.query(`
				SELECT command_id, event_ids
				FROM hub.semantic_operation_commands
				WHERE command_id = ANY($1::uuid[])
			`, [[responseCommandId, finalizationCommandId]]);
			for (const row of commandEvents.rows) {
				const response = settled[
					row.command_id === responseCommandId ? 0 : 1
				];
				expect(row.event_ids).toEqual(response.value.eventIds);
			}
			const persisted = await pool.query(`
				SELECT operation.status,
					(SELECT response_state FROM hub.semantic_operation_targets
						WHERE operation_id = operation.id AND invitation_id = $2) AS racing_state,
					(SELECT count(*)::integer FROM hub.semantic_operation_finalizations
						WHERE operation_id = operation.id) AS finalization_count
				FROM hub.semantic_operations operation
				WHERE operation.id = $1
			`, [proposed.operation.operationId, racing.invitationId]);
			expect(persisted.rows[0]).toEqual({
				status: "applied",
				racing_state: "expired",
				finalization_count: 1,
			});
		} finally {
			store = originalStore;
		}
	});

	test("cancels independently during collection for the source and after readiness for a DM", async () => {
		const collecting = await pFixture({targetCount: 1});
		const collectingProposal = await collecting.pPropose();
		const sourceCommandId = crypto.randomUUID();
		const sourceRequest = {
			contractVersion: 1,
			commandId: sourceCommandId,
			operationId: collectingProposal.operation.operationId,
		};
		const sourceCancelled = await store.pCancelMultiTargetOperation({
			accountId: collecting.sourceOwner.account.id,
			sessionId: collecting.sourceOwner.session.id,
			campaignId: collecting.campaign.id,
			...sourceRequest,
			protocolVersion: "6",
			idempotencyKey: getIdempotency(sourceCommandId, sourceRequest),
		});
		expect(sourceCancelled.operation.status).toBe("cancelled");

		const ready = await pFixture({targetCount: 1});
		const readyProposal = await ready.pPropose();
		await ready.pRespond({
			operationId: readyProposal.operation.operationId,
			invitationId: readyProposal.operation.targets[0].invitationId,
		});
		const dmCommandId = crypto.randomUUID();
		const dmRequest = {
			contractVersion: 1,
			commandId: dmCommandId,
			operationId: readyProposal.operation.operationId,
		};
		const dmCancelled = await store.pCancelMultiTargetOperation({
			accountId: ready.dm.account.id,
			sessionId: ready.dm.session.id,
			campaignId: ready.campaign.id,
			...dmRequest,
			protocolVersion: "6",
			idempotencyKey: getIdempotency(dmCommandId, dmRequest),
		});
		expect(dmCancelled.operation.status).toBe("cancelled");
		const persisted = await pool.query(`
			SELECT
				(SELECT count(*)::integer FROM hub.semantic_operation_finalizations
					WHERE operation_id = $1) AS finalizations,
				(SELECT count(*)::integer FROM hub.semantic_operation_targets
					WHERE operation_id = $1 AND leg_id IS NOT NULL) AS legs
		`, [readyProposal.operation.operationId]);
		expect(persisted.rows[0]).toEqual({finalizations: 0, legs: 0});
	});

	test("collapses source-as-target and permits a privacy-safe no-op target", async () => {
		const ctx = await pFixture({targetCount: 2, targetHps: [20, 5]});
		const proposed = await ctx.pPropose({
			targetRefs: [ctx.source.targetRef, ctx.targets[0].targetRef, ctx.targets[1].targetRef],
		});
		const sourceInvitation = proposed.operation.targets.find(target => target.presentation.targetName === "Source");
		const noOpInvitation = proposed.operation.targets.find(target => target.presentation.targetName === "Target 0");
		const changedInvitation = proposed.operation.targets.find(target => target.presentation.targetName === "Target 1");
		await ctx.pRespond({operationId: proposed.operation.operationId, invitationId: noOpInvitation.invitationId});
		await ctx.pRespond({operationId: proposed.operation.operationId, invitationId: changedInvitation.invitationId});
		const finalized = await ctx.pFinalize({
			operationId: proposed.operation.operationId,
			selectedInvitationIds: [
				sourceInvitation.invitationId,
				noOpInvitation.invitationId,
				changedInvitation.invitationId,
			],
		});
		expect(finalized.operation.status).toBe("applied");
		expect(finalized.operation.sourceResult).toMatchObject({
			sourceCharacterId: ctx.source.id,
			resultingSourceCharacterRevision: 2,
			appliedEventId: expect.any(String),
			legKind: "combined",
			legId: expect.any(String),
			operation: {
				operationId: proposed.operation.operationId,
				kind: "hp.heal",
				targetCharacterId: ctx.source.id,
				arguments: {amount: 4},
			},
		});
		const persisted = await pool.query(`
			SELECT target.target_character_id, target.leg_kind, target.changed,
				target.resulting_character_revision, character.revision
			FROM hub.semantic_operation_targets target
			JOIN hub.characters character ON character.id = target.target_character_id
			WHERE target.operation_id = $1
			ORDER BY target.ordinal
		`, [proposed.operation.operationId]);
		expect(persisted.rows.find(row => row.target_character_id === ctx.source.id)).toMatchObject({
			leg_kind: "combined",
			resulting_character_revision: "2",
			revision: "2",
		});
		expect(persisted.rows.find(row => row.target_character_id === ctx.targets[0].id)).toMatchObject({
			leg_kind: "target",
			changed: false,
			resulting_character_revision: null,
			revision: "1",
		});
		const sourceEvents = await store.pListVisibleEvents({
			accountId: ctx.sourceOwner.account.id,
			campaignId: ctx.campaign.id,
		});
		const noOpEvent = sourceEvents.find(event =>
			event.type === "character.multi_operation.target_applied"
			&& event.payload.invitationId === noOpInvitation.invitationId);
		expect(noOpEvent.payload).not.toHaveProperty("changed");
		expect(noOpEvent.payload).not.toHaveProperty("resultingCharacterRevision");
		expect(noOpEvent.payload.operation).not.toHaveProperty("targetCharacterId");
		expect(noOpEvent.visibleAccountIds).toBeNull();
		expect(noOpEvent).toMatchObject({
			aggregateType: "semantic_operation",
			aggregateId: proposed.operation.operationId,
			aggregateRevision: null,
		});
		const changedEvent = sourceEvents.find(event =>
			event.type === "character.multi_operation.target_applied"
			&& event.payload.invitationId === changedInvitation.invitationId);
		expect(changedEvent).toMatchObject({
			aggregateType: "semantic_operation",
			aggregateId: proposed.operation.operationId,
			aggregateRevision: null,
		});
		const combinedEvent = sourceEvents.find(event =>
			event.type === "character.multi_operation.target_applied"
			&& event.payload.invitationId === sourceInvitation.invitationId);
		expect(combinedEvent.payload).not.toHaveProperty("changed");
		expect(combinedEvent.payload).not.toHaveProperty("resultingCharacterRevision");
		expect(combinedEvent.payload.operation).not.toHaveProperty("targetCharacterId");
		expect(combinedEvent).toMatchObject({
			aggregateType: "semantic_operation",
			aggregateId: proposed.operation.operationId,
			aggregateRevision: null,
		});
		const targetEvents = await store.pListVisibleEvents({
			accountId: ctx.targetOwners[0].account.id,
			campaignId: ctx.campaign.id,
		});
		expect(targetEvents.find(event =>
			event.type === "character.multi_operation.target_applied"
			&& event.payload?.invitationId === noOpInvitation.invitationId)).toMatchObject({
			aggregateType: "character",
			aggregateId: ctx.targets[0].id,
			aggregateRevision: null,
			payload: {changed: false},
		});
		expect(targetEvents.find(event =>
			event.type === "character.multi_operation.target_applied"
			&& event.payload?.invitationId === changedInvitation.invitationId)).toMatchObject({
			aggregateType: "character",
			aggregateId: ctx.targets[1].id,
			aggregateRevision: 2,
			payload: {changed: true, resultingCharacterRevision: 2},
		});
		const dmEvents = await store.pListVisibleEvents({
			accountId: ctx.dm.account.id,
			campaignId: ctx.campaign.id,
		});
		expect(dmEvents.find(event =>
			event.type === "character.multi_operation.target_applied"
			&& event.payload?.invitationId === changedInvitation.invitationId)).toMatchObject({
			aggregateType: "character",
			aggregateId: ctx.targets[1].id,
			aggregateRevision: 2,
		});
		const rawNoOpEvent = (await pool.query(`
			SELECT *
			FROM hub.domain_events
			WHERE id = $1
		`, [noOpEvent.id])).rows[0];
		const wsProjected = await store.redactEventForViewer({
			event: {
				id: rawNoOpEvent.id,
				campaignId: rawNoOpEvent.campaign_id,
				sequence: Number(rawNoOpEvent.sequence),
				type: rawNoOpEvent.event_type,
				actorAccountId: rawNoOpEvent.actor_account_id,
				aggregateType: rawNoOpEvent.aggregate_type,
				aggregateId: rawNoOpEvent.aggregate_id,
				aggregateRevision: rawNoOpEvent.aggregate_revision == null
					? null
					: Number(rawNoOpEvent.aggregate_revision),
				visibility: rawNoOpEvent.visibility,
				visibleAccountIds: rawNoOpEvent.visible_account_ids,
				payload: rawNoOpEvent.payload,
				createdAt: rawNoOpEvent.created_at,
			},
			accountId: ctx.sourceOwner.account.id,
			role: "player",
		});
		expect(wsProjected.visibleAccountIds).toBeNull();
		expect(wsProjected.payload).not.toHaveProperty("changed");
		expect(wsProjected.payload).not.toHaveProperty("resultingCharacterRevision");
		expect(wsProjected.payload.operation).not.toHaveProperty("targetCharacterId");
		expect(wsProjected).toMatchObject({
			aggregateType: "semantic_operation",
			aggregateId: proposed.operation.operationId,
			aggregateRevision: null,
		});
	});

	test("permanently fences a multi-target source cost after spend and restore", async () => {
		const ctx = await pFixture({targetCount: 2});
		const proposed = await ctx.pPropose();
		for (const invitation of proposed.operation.targets) {
			await ctx.pRespond({
				operationId: proposed.operation.operationId,
				invitationId: invitation.invitationId,
			});
		}
		for (const current of [0, 1]) {
			await pool.query(`
				UPDATE hub.characters
				SET data = jsonb_set(
						data,
						'{spellcasting,spellSlots,1,current}',
						to_jsonb($2::integer)
					),
					revision = revision + 1,
					updated_at = now()
				WHERE id = $1
			`, [ctx.source.id, current]);
		}
		const targetBefore = (await pool.query(
			`SELECT revision, data FROM hub.characters WHERE id = $1`,
			[ctx.targets[0].id],
		)).rows[0];
		const finalized = await ctx.pFinalize({
			operationId: proposed.operation.operationId,
			selectedInvitationIds: [proposed.operation.targets[0].invitationId],
		});
		expect(finalized.operation.status).toBe("failed");
		expect((await pool.query(`
			SELECT source_cost_invalidated
			FROM hub.semantic_operations
			WHERE id = $1
		`, [proposed.operation.operationId])).rows[0].source_cost_invalidated).toBe(true);
		const targetAfter = (await pool.query(
			`SELECT revision, data FROM hub.characters WHERE id = $1`,
			[ctx.targets[0].id],
		)).rows[0];
		expect(targetAfter).toEqual(targetBefore);
		const legStates = await pool.query(`
			SELECT response_state, selection_state
			FROM hub.semantic_operation_targets
			WHERE operation_id = $1
			ORDER BY ordinal
		`, [proposed.operation.operationId]);
		expect(legStates.rows).toEqual([
			{response_state: "approved", selection_state: "unselected"},
			{response_state: "approved", selection_state: "unselected"},
		]);
		expect((await pool.query(`
			SELECT count(*)::integer AS count
			FROM hub.domain_events
			WHERE payload->>'operationId' = $1::text
				AND payload->>'status' = 'declined'
		`, [proposed.operation.operationId])).rows[0].count).toBe(0);
	});

	test("terminally fails an unreviewed target no-op without drifting approved leg state", async () => {
		const originalStore = store;
		store = new PostgresHubStore({
			pool,
			semanticOperationRegistry: getRegistry({allowTargetNoOp: false}),
			multiTargetOperationsEnabled: true,
		});
		try {
			const ctx = await pFixture({targetCount: 1});
			const proposed = await ctx.pPropose();
			const invitationId = proposed.operation.targets[0].invitationId;
			await ctx.pRespond({operationId: proposed.operation.operationId, invitationId});
			await pool.query(`
				UPDATE hub.characters
				SET data = jsonb_set(data, '{hp,current}', data #> '{hp,effectiveMax}'),
					revision = revision + 1,
					updated_at = now()
				WHERE id = $1
			`, [ctx.targets[0].id]);
			const finalized = await ctx.pFinalize({
				operationId: proposed.operation.operationId,
				selectedInvitationIds: [invitationId],
			});
			expect(finalized.operation.status).toBe("failed");
			expect((await pool.query(`
				SELECT response_state, selection_state, leg_id
				FROM hub.semantic_operation_targets
				WHERE operation_id = $1
			`, [proposed.operation.operationId])).rows).toEqual([{
				response_state: "approved",
				selection_state: "unselected",
				leg_id: null,
			}]);
			expect((await pool.query(`
				SELECT count(*)::integer AS count
				FROM hub.domain_events
				WHERE payload->>'operationId' = $1::text
					AND payload->>'status' = 'declined'
			`, [proposed.operation.operationId])).rows[0].count).toBe(0);
		} finally {
			store = originalStore;
		}
	});

	test("rejects selected target authority drift without evidence and permits a fresh valid subset", async () => {
		const ctx = await pFixture({targetCount: 2});
		const proposed = await ctx.pPropose();
		const invitations = proposed.operation.targets.map(target => target.invitationId);
		for (const invitationId of invitations) {
			await ctx.pRespond({operationId: proposed.operation.operationId, invitationId});
		}
		await pool.query(`UPDATE hub.characters SET target_ref = gen_random_uuid() WHERE id = $1`, [ctx.targets[0].id]);
		const before = (await pool.query(`
			SELECT
				(SELECT count(*)::integer FROM hub.semantic_operation_commands
					WHERE operation_id = $1) AS commands,
				(SELECT count(*)::integer FROM hub.semantic_operation_finalizations
					WHERE operation_id = $1) AS finalizations,
				(SELECT count(*)::integer FROM hub.domain_events
					WHERE aggregate_id = $1 OR payload->>'operationId' = $1::text) AS events,
				(SELECT count(*)::integer FROM hub.audit_entries
					WHERE target_id = $1) AS audits
		`, [proposed.operation.operationId])).rows[0];
		await expect(ctx.pFinalize({
			operationId: proposed.operation.operationId,
			selectedInvitationIds: invitations,
		})).rejects.toMatchObject({code: "FINALIZATION_SELECTION_INVALID"});
		const afterRejected = (await pool.query(`
			SELECT
				(SELECT status FROM hub.semantic_operations WHERE id = $1) AS status,
				(SELECT count(*)::integer FROM hub.semantic_operation_commands
					WHERE operation_id = $1) AS commands,
				(SELECT count(*)::integer FROM hub.semantic_operation_finalizations
					WHERE operation_id = $1) AS finalizations,
				(SELECT count(*)::integer FROM hub.domain_events
					WHERE aggregate_id = $1 OR payload->>'operationId' = $1::text) AS events,
				(SELECT count(*)::integer FROM hub.audit_entries
					WHERE target_id = $1) AS audits
		`, [proposed.operation.operationId])).rows[0];
		expect(afterRejected).toEqual({status: "awaiting_source_selection", ...before});
		const finalized = await ctx.pFinalize({
			operationId: proposed.operation.operationId,
			selectedInvitationIds: [invitations[1]],
		});
		expect(finalized.operation.status).toBe("applied");
	});

	test("serializes opposing character lock order without deadlock", async () => {
		const dm = await pActor("Opposing DM");
		const left = await pActor("Opposing Left");
		const right = await pActor("Opposing Right");
		const {campaign, rulesVersion} = await pCreateCampaign({dm, name: "Opposing"});
		await pJoin({dm, campaign, actor: left});
		await pJoin({dm, campaign, actor: right});
		const leftCharacter = await pCharacter({actor: left, campaign, name: "Left"});
		const rightCharacter = await pCharacter({actor: right, campaign, name: "Right"});
		const pProposal = async ({actor, source, target}) => {
			const commandId = crypto.randomUUID();
			const request = {
				contractVersion: 1,
				commandId,
				sourceCharacterId: source.id,
				sourceEntity: SOURCE_ENTITY,
				effectTemplateId: EFFECT_TEMPLATE_ID,
				choice: {amount: 1},
				targetRefs: [target.targetRef],
				rulesVersionId: rulesVersion.id,
			};
			return store.pCreateMultiTargetOperation({
				accountId: actor.account.id,
				sessionId: actor.session.id,
				campaignId: campaign.id,
				...request,
				protocolVersion: "6",
				idempotencyKey: getIdempotency(commandId, request),
			});
		};
		const [leftProposal, rightProposal] = await Promise.all([
			pProposal({actor: left, source: leftCharacter, target: rightCharacter}),
			pProposal({actor: right, source: rightCharacter, target: leftCharacter}),
		]);
		const pApprove = async ({actor, proposal}) => {
			const invitationId = proposal.operation.targets[0].invitationId;
			const commandId = crypto.randomUUID();
			const request = {
				contractVersion: 1,
				commandId,
				operationId: proposal.operation.operationId,
				invitationId,
				decision: "approve",
			};
			await store.pRespondMultiTargetInvitation({
				accountId: actor.account.id,
				sessionId: actor.session.id,
				campaignId: campaign.id,
				...request,
				protocolVersion: "6",
				idempotencyKey: getIdempotency(commandId, request),
			});
			return invitationId;
		};
		const [leftInvitation, rightInvitation] = await Promise.all([
			pApprove({actor: right, proposal: leftProposal}),
			pApprove({actor: left, proposal: rightProposal}),
		]);
		const pFinalize = ({actor, proposal, invitationId}) => {
			const commandId = crypto.randomUUID();
			const request = {
				contractVersion: 1,
				commandId,
				operationId: proposal.operation.operationId,
				selectedInvitationIds: [invitationId],
			};
			return store.pFinalizeMultiTargetOperation({
				accountId: actor.account.id,
				sessionId: actor.session.id,
				campaignId: campaign.id,
				...request,
				protocolVersion: "6",
				idempotencyKey: getIdempotency(commandId, request),
			});
		};
		const results = await Promise.all([
			pFinalize({actor: left, proposal: leftProposal, invitationId: leftInvitation}),
			pFinalize({actor: right, proposal: rightProposal, invitationId: rightInvitation}),
		]);
		expect(results.map(result => result.operation.status)).toEqual(["applied", "applied"]);
	});

	test("serializes the cross-campaign source-account slot-five quota with zero loser evidence", async () => {
		const dmA = await pActor("Source quota DM A");
		const dmB = await pActor("Source quota DM B");
		const sourceOwner = await pActor("Source quota owner");
		const targetOwnerA = await pActor("Source quota target A");
		const targetOwnerB = await pActor("Source quota target B");
		const left = await pCreateCampaign({dm: dmA, name: "Source quota A"});
		const right = await pCreateCampaign({dm: dmB, name: "Source quota B"});
		for (const {dm, campaign} of [
			{dm: dmA, campaign: left.campaign},
			{dm: dmB, campaign: right.campaign},
		]) await pJoin({dm, campaign, actor: sourceOwner});
		await pJoin({dm: dmA, campaign: left.campaign, actor: targetOwnerA});
		await pJoin({dm: dmB, campaign: right.campaign, actor: targetOwnerB});
		const sourceA1 = await pCharacter({actor: sourceOwner, campaign: left.campaign, name: "Source quota A1"});
		const sourceA2 = await pCharacter({actor: sourceOwner, campaign: left.campaign, name: "Source quota A2"});
		const sourceB1 = await pCharacter({actor: sourceOwner, campaign: right.campaign, name: "Source quota B1"});
		const sourceB2 = await pCharacter({actor: sourceOwner, campaign: right.campaign, name: "Source quota B2"});
		const targetA = await pCharacter({actor: targetOwnerA, campaign: left.campaign, name: "Source quota target A"});
		const targetB = await pCharacter({actor: targetOwnerB, campaign: right.campaign, name: "Source quota target B"});
		const pPropose = ({campaign, rulesVersion, source, target, commandId = crypto.randomUUID()}) => {
			const request = {
				contractVersion: 1,
				commandId,
				sourceCharacterId: source.id,
				sourceEntity: SOURCE_ENTITY,
				effectTemplateId: EFFECT_TEMPLATE_ID,
				choice: {amount: 1},
				targetRefs: [target.targetRef],
				rulesVersionId: rulesVersion.id,
			};
			return {
				commandId,
				promise: store.pCreateMultiTargetOperation({
					accountId: sourceOwner.account.id,
					sessionId: sourceOwner.session.id,
					campaignId: campaign.id,
					...request,
					protocolVersion: "6",
					idempotencyKey: getIdempotency(commandId, request),
				}),
			};
		};
		for (const args of [
			{campaign: left.campaign, rulesVersion: left.rulesVersion, source: sourceA1, target: targetA},
			{campaign: left.campaign, rulesVersion: left.rulesVersion, source: sourceA1, target: targetA},
			{campaign: right.campaign, rulesVersion: right.rulesVersion, source: sourceB1, target: targetB},
			{campaign: right.campaign, rulesVersion: right.rulesVersion, source: sourceB1, target: targetB},
		]) await pPropose(args).promise;
		const beforeRace = (await pool.query(`
			SELECT
				(SELECT count(*)::integer FROM hub.semantic_operations
					WHERE origin_actor_account_id = $1 AND target_set_version = 1) AS parents,
				(SELECT count(*)::integer FROM hub.semantic_operation_targets target
					JOIN hub.semantic_operations operation ON operation.id = target.operation_id
					WHERE operation.origin_actor_account_id = $1) AS children,
				(SELECT count(*)::integer FROM hub.audit_entries
					WHERE actor_account_id = $1 AND action = 'character.multi_operation.proposed') AS audits,
				(SELECT count(*)::integer FROM hub.domain_events
					WHERE actor_account_id = $1 AND event_type = 'character.multi_operation.proposed') AS events
		`, [sourceOwner.account.id])).rows[0];
		const race = [
			pPropose({campaign: left.campaign, rulesVersion: left.rulesVersion, source: sourceA2, target: targetA}),
			pPropose({campaign: right.campaign, rulesVersion: right.rulesVersion, source: sourceB2, target: targetB}),
		];
		const settled = await Promise.allSettled(race.map(entry => entry.promise));
		expect(settled.map(result => result.status === "fulfilled" ? "fulfilled" : result.reason.code).sort())
			.toEqual(["COLLECTION_LIMIT_REACHED", "fulfilled"]);
		const loserIndex = settled.findIndex(result => result.status === "rejected");
		const loser = race[loserIndex];
		const evidence = await pool.query(`
			SELECT
				(SELECT count(*)::integer FROM hub.semantic_operation_commands WHERE command_id = $1) AS commands,
				(SELECT count(*)::integer FROM hub.semantic_operations
					WHERE origin_actor_account_id = $2 AND target_set_version = 1) AS parents,
				(SELECT count(*)::integer FROM hub.semantic_operation_targets target
					JOIN hub.semantic_operations operation ON operation.id = target.operation_id
					WHERE operation.origin_actor_account_id = $2) AS children,
				(SELECT count(*)::integer FROM hub.audit_entries
					WHERE actor_account_id = $2 AND action = 'character.multi_operation.proposed') AS audits,
				(SELECT count(*)::integer FROM hub.domain_events
					WHERE actor_account_id = $2 AND event_type = 'character.multi_operation.proposed') AS events
		`, [loser.commandId, sourceOwner.account.id]);
		expect(evidence.rows[0]).toEqual({
			commands: 0,
			parents: beforeRace.parents + 1,
			children: beforeRace.children + 1,
			audits: beforeRace.audits + 1,
			events: beforeRace.events + 1,
		});
	});

	test("serializes the cross-campaign target-owner slot-twenty quota", async () => {
		const dmA = await pActor("Target quota DM A");
		const dmB = await pActor("Target quota DM B");
		const targetOwner = await pActor("Target quota owner");
		const left = await pCreateCampaign({dm: dmA, name: "Target quota A"});
		const right = await pCreateCampaign({dm: dmB, name: "Target quota B"});
		await pJoin({dm: dmA, campaign: left.campaign, actor: targetOwner});
		await pJoin({dm: dmB, campaign: right.campaign, actor: targetOwner});
		const targetA = await pCharacter({actor: targetOwner, campaign: left.campaign, name: "Target quota A"});
		const targetB = await pCharacter({actor: targetOwner, campaign: right.campaign, name: "Target quota B"});
		const sources = [];
		for (let index = 0; index < 6; ++index) {
			const actor = await pActor(`Target quota source ${index}`);
			await pJoin({dm: dmA, campaign: left.campaign, actor});
			await pJoin({dm: dmB, campaign: right.campaign, actor});
			sources.push({
				actor,
				left: [
					await pCharacter({actor, campaign: left.campaign, name: `Target quota L${index}a`}),
					await pCharacter({actor, campaign: left.campaign, name: `Target quota L${index}b`}),
				],
				right: [
					await pCharacter({actor, campaign: right.campaign, name: `Target quota R${index}a`}),
					await pCharacter({actor, campaign: right.campaign, name: `Target quota R${index}b`}),
				],
			});
		}
		const pPropose = ({sourceEntry, campaignSide, sourceCharacter, commandId = crypto.randomUUID()}) => {
			const authority = campaignSide === "left" ? left : right;
			const target = campaignSide === "left" ? targetA : targetB;
			const request = {
				contractVersion: 1,
				commandId,
				sourceCharacterId: sourceCharacter.id,
				sourceEntity: SOURCE_ENTITY,
				effectTemplateId: EFFECT_TEMPLATE_ID,
				choice: {amount: 1},
				targetRefs: [target.targetRef],
				rulesVersionId: authority.rulesVersion.id,
			};
			return {
				commandId,
				sourceAccountId: sourceEntry.actor.account.id,
				promise: store.pCreateMultiTargetOperation({
					accountId: sourceEntry.actor.account.id,
					sessionId: sourceEntry.actor.session.id,
					campaignId: authority.campaign.id,
					...request,
					protocolVersion: "6",
					idempotencyKey: getIdempotency(commandId, request),
				}),
			};
		};
		for (let index = 0; index < 19; ++index) {
			const sourceEntry = sources[Math.floor(index / 5)];
			const localIndex = index % 5;
			const campaignSide = localIndex % 2 ? "right" : "left";
			const sourceCharacter = sourceEntry[campaignSide][localIndex < 3 ? 0 : 1];
			await pPropose({sourceEntry, campaignSide, sourceCharacter}).promise;
		}
		const beforeRace = (await pool.query(`
			SELECT
				(SELECT count(*)::integer FROM hub.semantic_operations
					WHERE target_set_version = 1
						AND campaign_id = ANY($1::uuid[])) AS parents,
				(SELECT count(*)::integer FROM hub.semantic_operation_targets
					WHERE target_owner_account_id_at_proposal = $2) AS children,
				(SELECT count(*)::integer FROM hub.audit_entries
					WHERE action = 'character.multi_operation.proposed'
						AND campaign_id = ANY($1::uuid[])) AS audits,
				(SELECT count(*)::integer FROM hub.domain_events
					WHERE event_type = 'character.multi_operation.proposed'
						AND campaign_id = ANY($1::uuid[])) AS events
		`, [[left.campaign.id, right.campaign.id], targetOwner.account.id])).rows[0];
		const race = [
			pPropose({
				sourceEntry: sources[4],
				campaignSide: "left",
				sourceCharacter: sources[4].left[0],
			}),
			pPropose({
				sourceEntry: sources[5],
				campaignSide: "right",
				sourceCharacter: sources[5].right[0],
			}),
		];
		const settled = await Promise.allSettled(race.map(entry => entry.promise));
		expect(settled.map(result => result.status === "fulfilled" ? "fulfilled" : result.reason.code).sort())
			.toEqual(["COLLECTION_LIMIT_REACHED", "fulfilled"]);
		const loser = race[settled.findIndex(result => result.status === "rejected")];
		const pending = await pool.query(`
			SELECT
				(SELECT count(*)::integer FROM hub.semantic_operation_commands
					WHERE command_id = $1) AS loser_commands,
				(SELECT count(*)::integer FROM hub.semantic_operations
					WHERE target_set_version = 1
						AND campaign_id = ANY($2::uuid[])) AS parents,
				(SELECT count(*)::integer FROM hub.semantic_operation_targets
					WHERE target_owner_account_id_at_proposal = $3) AS children,
				(SELECT count(*)::integer FROM hub.audit_entries
					WHERE action = 'character.multi_operation.proposed'
						AND campaign_id = ANY($2::uuid[])) AS audits,
				(SELECT count(*)::integer FROM hub.domain_events
					WHERE event_type = 'character.multi_operation.proposed'
						AND campaign_id = ANY($2::uuid[])) AS events,
				(SELECT count(*)::integer
					FROM hub.semantic_operation_targets target
					JOIN hub.semantic_operations operation ON operation.id = target.operation_id
					WHERE target.target_owner_account_id_at_proposal = $3
						AND target.response_state = 'pending'
						AND operation.status IN ('collecting_responses', 'awaiting_source_selection')) AS pending
		`, [loser.commandId, [left.campaign.id, right.campaign.id], targetOwner.account.id]);
		expect(pending.rows[0]).toEqual({
			loser_commands: 0,
			parents: beforeRace.parents + 1,
			children: beforeRace.children + 1,
			audits: beforeRace.audits + 1,
			events: beforeRace.events + 1,
			pending: 20,
		});
	});

	test("rolls back a faulted finalization and leaves zero partial writes", async () => {
		let faultStage = "multi-target:target-event";
		const faultStore = new PostgresHubStore({
			pool,
			semanticOperationRegistry: getRegistry(),
			multiTargetOperationsEnabled: true,
			fnTestResolveStructuredActionFault: ({stage}) => {
				if (stage === faultStage) throw new Error(`Injected ${stage}`);
			},
		});
		const originalStore = store;
		store = faultStore;
		try {
			const ctx = await pFixture({targetCount: 2});
			const proposed = await ctx.pPropose();
			const invitations = proposed.operation.targets.map(target => target.invitationId);
			for (const invitationId of invitations) {
				await ctx.pRespond({operationId: proposed.operation.operationId, invitationId});
			}
			const before = await pool.query(`
				SELECT id, revision, data
				FROM hub.characters
				WHERE id = ANY($1::uuid[])
				ORDER BY id
			`, [[ctx.source.id, ...ctx.targets.map(target => target.id)]]);
			await expect(ctx.pFinalize({
				operationId: proposed.operation.operationId,
				selectedInvitationIds: invitations,
			})).rejects.toThrow("Injected multi-target:target-event");
			const after = await pool.query(`
				SELECT id, revision, data
				FROM hub.characters
				WHERE id = ANY($1::uuid[])
				ORDER BY id
			`, [[ctx.source.id, ...ctx.targets.map(target => target.id)]]);
			expect(after.rows).toEqual(before.rows);
			const evidence = await pool.query(`
				SELECT
					(SELECT status FROM hub.semantic_operations WHERE id = $1) AS status,
					(SELECT count(*)::integer FROM hub.semantic_operation_finalizations WHERE operation_id = $1) AS finalizations,
					(SELECT count(*)::integer FROM hub.semantic_operation_targets
						WHERE operation_id = $1 AND leg_id IS NOT NULL) AS legs
			`, [proposed.operation.operationId]);
			expect(evidence.rows[0]).toEqual({
				status: "awaiting_source_selection",
				finalizations: 0,
				legs: 0,
			});
			faultStage = null;
			await expect(ctx.pFinalize({
				operationId: proposed.operation.operationId,
				selectedInvitationIds: invitations,
			})).resolves.toMatchObject({operation: {status: "applied"}});
		} finally {
			store = originalStore;
		}
	});

	test("advances expiry maintenance past a locked earliest campaign", async () => {
		const originalStore = store;
		store = new PostgresHubStore({
			pool,
			semanticOperationRegistry: getRegistry(),
			multiTargetOperationsEnabled: true,
			multiTargetCollectionTtlMs: 20,
			multiTargetOperationTtlMs: 60_000,
		});
		try {
			await store.pExpireMultiTargetOperations({limit: 100});
			const first = await pFixture({targetCount: 1});
			const firstProposal = await first.pPropose();
			const second = await pFixture({targetCount: 1});
			const secondProposal = await second.pPropose();
			await new Promise(resolve => setTimeout(resolve, 35));
			const blocker = await pool.connect();
			try {
				await blocker.query(`SELECT pg_advisory_lock(hashtextextended($1, 6))`, [first.campaign.id]);
				await expect(store.pExpireMultiTargetOperations({limit: 1})).resolves.toEqual({processed: 1});
				const statuses = await pool.query(`
					SELECT id, status
					FROM hub.semantic_operations
					WHERE id = ANY($1::uuid[])
				`, [[firstProposal.operation.operationId, secondProposal.operation.operationId]]);
				expect(new Map(statuses.rows.map(row => [row.id, row.status]))).toEqual(new Map([
					[firstProposal.operation.operationId, "collecting_responses"],
					[secondProposal.operation.operationId, "awaiting_source_selection"],
				]));
			} finally {
				await blocker.query(`SELECT pg_advisory_unlock(hashtextextended($1, 6))`, [first.campaign.id]);
				blocker.release();
			}
			await store.pExpireMultiTargetOperations({limit: 100});
		} finally {
			store = originalStore;
		}
	});

	test("advances expiry maintenance past a locked earliest parent", async () => {
		const originalStore = store;
		store = new PostgresHubStore({
			pool,
			semanticOperationRegistry: getRegistry(),
			multiTargetOperationsEnabled: true,
			multiTargetCollectionTtlMs: 20,
			multiTargetOperationTtlMs: 60_000,
		});
		try {
			await store.pExpireMultiTargetOperations({limit: 100});
			const first = await pFixture({targetCount: 1});
			const firstProposal = await first.pPropose();
			const second = await pFixture({targetCount: 1});
			const secondProposal = await second.pPropose();
			await new Promise(resolve => setTimeout(resolve, 35));
			const blocker = await pool.connect();
			try {
				await blocker.query("BEGIN");
				await blocker.query(`
					SELECT id
					FROM hub.semantic_operations
					WHERE id = $1
					FOR UPDATE
				`, [firstProposal.operation.operationId]);
				await expect(store.pExpireMultiTargetOperations({limit: 1})).resolves.toEqual({processed: 1});
				const statuses = await pool.query(`
					SELECT id, status
					FROM hub.semantic_operations
					WHERE id = ANY($1::uuid[])
				`, [[firstProposal.operation.operationId, secondProposal.operation.operationId]]);
				expect(new Map(statuses.rows.map(row => [row.id, row.status]))).toEqual(new Map([
					[firstProposal.operation.operationId, "collecting_responses"],
					[secondProposal.operation.operationId, "awaiting_source_selection"],
				]));
			} finally {
				await blocker.query("ROLLBACK");
				blocker.release();
			}
			await store.pExpireMultiTargetOperations({limit: 100});
		} finally {
			store = originalStore;
		}
	});

	test("advances expiry maintenance past a child-first lock on the earliest parent", async () => {
		const originalStore = store;
		store = new PostgresHubStore({
			pool,
			semanticOperationRegistry: getRegistry(),
			multiTargetOperationsEnabled: true,
			multiTargetCollectionTtlMs: 20,
			multiTargetOperationTtlMs: 60_000,
		});
		try {
			await store.pExpireMultiTargetOperations({limit: 100});
			const first = await pFixture({targetCount: 1});
			const firstProposal = await first.pPropose();
			const second = await pFixture({targetCount: 1});
			const secondProposal = await second.pPropose();
			await new Promise(resolve => setTimeout(resolve, 35));
			const blocker = await pool.connect();
			try {
				await blocker.query("BEGIN");
				await blocker.query(`
					SELECT target_character_id
					FROM hub.semantic_operation_targets
					WHERE operation_id = $1
					FOR UPDATE
				`, [firstProposal.operation.operationId]);
				await expect(store.pExpireMultiTargetOperations({limit: 1})).resolves.toEqual({processed: 1});
				const statuses = await pool.query(`
					SELECT id, status
					FROM hub.semantic_operations
					WHERE id = ANY($1::uuid[])
				`, [[firstProposal.operation.operationId, secondProposal.operation.operationId]]);
				expect(new Map(statuses.rows.map(row => [row.id, row.status]))).toEqual(new Map([
					[firstProposal.operation.operationId, "collecting_responses"],
					[secondProposal.operation.operationId, "awaiting_source_selection"],
				]));
			} finally {
				await blocker.query("ROLLBACK");
				blocker.release();
			}
			await store.pExpireMultiTargetOperations({limit: 100});
		} finally {
			store = originalStore;
		}
	});

	test("retains the per-campaign protocol-6 marker after ordinary history cleanup", async () => {
		const ctx = await pFixture({targetCount: 1});
		const unrelated = await pActor("Multi PG unrelated");
		await pJoin({dm: ctx.dm, campaign: ctx.campaign, actor: unrelated});
		const proposed = await ctx.pPropose({
			targetRefs: [ctx.source.targetRef, ctx.targets[0].targetRef],
		});
		const sourceInvitation = proposed.operation.targets.find(target =>
			target.presentation.targetName === "Source");
		const targetInvitation = proposed.operation.targets.find(target =>
			target.presentation.targetName === "Target 0");
		await ctx.pRespond({
			operationId: proposed.operation.operationId,
			invitationId: targetInvitation.invitationId,
		});
		await ctx.pFinalize({
			operationId: proposed.operation.operationId,
			selectedInvitationIds: [sourceInvitation.invitationId, targetInvitation.invitationId],
		});
		await pool.query(`
			UPDATE hub.semantic_operations
			SET resolved_at = now() - interval '91 days'
			WHERE id = $1
		`, [proposed.operation.operationId]);
		await pool.query(`
			UPDATE hub.outbox_entries outbox
			SET status = 'published', published_at = now()
			FROM hub.domain_events event
			WHERE outbox.event_id = event.id
				AND (event.aggregate_id = $1 OR event.payload->>'operationId' = $1::text)
		`, [proposed.operation.operationId]);
		await expect(store.pCleanupMultiTargetHistory()).resolves.toEqual({deleted: 0});
		await pool.query(`
			UPDATE hub.outbox_entries outbox
			SET status = 'published', published_at = now()
			WHERE outbox.event_id = ANY(
				SELECT unnest(command.event_ids)
				FROM hub.semantic_operation_commands command
				WHERE command.operation_id = $1
			)
		`, [proposed.operation.operationId]);
		await expect(store.pCleanupMultiTargetHistory()).resolves.toEqual({deleted: 1});
		expect((await pool.query(
			`SELECT count(*)::integer AS count FROM hub.semantic_operations WHERE id = $1`,
			[proposed.operation.operationId],
		)).rows[0].count).toBe(0);
		await expect(store.pCampaignRequiresProtocol6({campaignId: ctx.campaign.id})).resolves.toBe(true);
		const sourceEvents = (await store.pListVisibleEvents({
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
		const targetEvent = (await store.pListVisibleEvents({
			accountId: ctx.targetOwners[0].account.id,
			campaignId: ctx.campaign.id,
		})).find(event =>
			event.type === "character.multi_operation.target_applied"
			&& event.payload.invitationId === targetInvitation.invitationId);
		expect(targetEvent).toMatchObject({
			aggregateType: "character",
			aggregateId: ctx.targets[0].id,
			aggregateRevision: 2,
			payload: {changed: true, resultingCharacterRevision: 2},
		});
		expect(targetEvent.payload).not.toHaveProperty("_sourceOwnerAccountId");
		expect(targetEvent.payload).not.toHaveProperty("_targetOwnerAccountId");
		const dmEvents = (await store.pListVisibleEvents({
			accountId: ctx.dm.account.id,
			campaignId: ctx.campaign.id,
		})).filter(event => event.type === "character.multi_operation.target_applied");
		expect(dmEvents.map(event => event.aggregateId)).toEqual([ctx.source.id, ctx.targets[0].id]);
		for (const event of dmEvents) {
			expect(event.payload).not.toHaveProperty("_sourceOwnerAccountId");
			expect(event.payload).not.toHaveProperty("_targetOwnerAccountId");
		}
		expect((await store.pListVisibleEvents({
			accountId: unrelated.account.id,
			campaignId: ctx.campaign.id,
		})).filter(event => event.type === "character.multi_operation.target_applied")).toEqual([]);
		const rawTargetEvent = (await pool.query(`
			SELECT *
			FROM hub.domain_events
			WHERE payload->>'invitationId' = $1
				AND event_type = 'character.multi_operation.target_applied'
		`, [targetInvitation.invitationId])).rows[0];
		const wsTargetProjection = await store.redactEventForViewer({
			event: {
				id: rawTargetEvent.id,
				campaignId: rawTargetEvent.campaign_id,
				sequence: Number(rawTargetEvent.sequence),
				type: rawTargetEvent.event_type,
				actorAccountId: rawTargetEvent.actor_account_id,
				aggregateType: rawTargetEvent.aggregate_type,
				aggregateId: rawTargetEvent.aggregate_id,
				aggregateRevision: Number(rawTargetEvent.aggregate_revision),
				visibility: rawTargetEvent.visibility,
				visibleAccountIds: rawTargetEvent.visible_account_ids,
				payload: rawTargetEvent.payload,
				createdAt: rawTargetEvent.created_at,
			},
			accountId: ctx.targetOwners[0].account.id,
			role: "player",
		});
		expect(wsTargetProjection).toMatchObject({
			aggregateType: "character",
			aggregateId: ctx.targets[0].id,
			aggregateRevision: 2,
		});
		expect(wsTargetProjection.payload).not.toHaveProperty("_sourceOwnerAccountId");
		expect(wsTargetProjection.payload).not.toHaveProperty("_targetOwnerAccountId");

		const disabledStore = new PostgresHubStore({
			pool,
			semanticOperationRegistry: getRegistry(),
			multiTargetOperationsEnabled: false,
		});
		const app = await createHubApp({
			store: disabledStore,
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
			const response = await app.inject({
				method: "GET",
				url: `/api/campaigns/${ctx.campaign.id}/events?afterSequence=0`,
				headers: {
					cookie: `__Host-hub_session=${app.signCookie(ctx.sourceOwner.token)}`,
					"x-hub-protocol-version": "5",
				},
			});
			expect(response.statusCode).toBe(426);
			expect(response.json()).toMatchObject({error: "PROTOCOL_UPDATE_REQUIRED"});
		} finally {
			await app.close();
		}
	});

	test("rejects immutable identity, invalid source consent, and gapped selection indexes with 23514", async () => {
		const ctx = await pFixture({targetCount: 2});
		const proposed = await ctx.pPropose();
		const pExpect23514 = async fn => {
			const client = await pool.connect();
			try {
				await client.query("BEGIN");
				await fn(client);
				await client.query("SET CONSTRAINTS ALL IMMEDIATE");
				throw new Error("Expected constraint violation");
			} catch (error) {
				await client.query("ROLLBACK");
				expect(error.code).toBe("23514");
			} finally {
				client.release();
			}
		};
		await pExpect23514(client => client.query(`
			UPDATE hub.semantic_operation_targets
			SET target_ref = gen_random_uuid()
			WHERE operation_id = $1 AND invitation_id = $2
		`, [proposed.operation.operationId, proposed.operation.targets[0].invitationId]));
		await pExpect23514(async client => {
			await client.query(`
				WITH removed AS (
					DELETE FROM hub.semantic_operations
					WHERE id = $1
					RETURNING *
				)
				INSERT INTO hub.semantic_operations (
					id, campaign_id, origin_actor_account_id, source_character_id,
					status, version, kind, arguments, source_entity, effect_template_id,
					choice, source_display_snapshot, effect_display_snapshot, expires_at,
					source_cost_version, source_cost, rules_version_id, rules_pin,
					template_registry_version, effect_resolution_seed, source_revision_observed,
					target_set_version, candidate_count, collection_closes_at, allow_target_no_op
				)
				SELECT id, campaign_id, origin_actor_account_id, source_character_id,
					status, version, kind, arguments, source_entity, effect_template_id,
					choice, source_display_snapshot, effect_display_snapshot, expires_at,
					source_cost_version, source_cost, rules_version_id, rules_pin,
					template_registry_version, effect_resolution_seed, source_revision_observed,
					target_set_version, candidate_count, collection_closes_at, allow_target_no_op
				FROM removed
			`, [proposed.operation.operationId]);
		});
		await pExpect23514(async client => {
			await client.query(`
				DELETE FROM hub.semantic_operation_targets
				WHERE operation_id = $1 AND invitation_id = $2
			`, [proposed.operation.operationId, proposed.operation.targets[0].invitationId]);
			await client.query(`
				INSERT INTO hub.semantic_operation_targets (
					operation_id, target_character_id, campaign_id, invitation_id, ordinal,
					target_ref, target_owner_account_id_at_proposal, target_display_snapshot,
					target_operation, rules_version_id, target_revision_observed,
					collection_closes_at, response_state, invitation_event_id
				)
				SELECT operation_id, target_character_id, campaign_id, gen_random_uuid(), ordinal,
					target_ref, target_owner_account_id_at_proposal, target_display_snapshot,
					target_operation, rules_version_id, target_revision_observed,
					collection_closes_at, 'pending', invitation_event_id
				FROM hub.semantic_operation_targets
				WHERE operation_id = $1
				ORDER BY ordinal
				LIMIT 1
			`, [proposed.operation.operationId]);
		});
		await pExpect23514(client => client.query(`
			UPDATE hub.semantic_operations
			SET candidate_count = candidate_count + 1
			WHERE id = $1
		`, [proposed.operation.operationId]));
		await pExpect23514(client => client.query(`
			UPDATE hub.semantic_operation_targets
			SET response_state = 'approved_by_source',
				responded_at = now()
			WHERE operation_id = $1 AND invitation_id = $2
		`, [proposed.operation.operationId, proposed.operation.targets[0].invitationId]));

		for (const invitation of proposed.operation.targets) {
			await ctx.pRespond({
				operationId: proposed.operation.operationId,
				invitationId: invitation.invitationId,
			});
		}
		await pExpect23514(async client => {
			await client.query(`
				UPDATE hub.semantic_operation_targets
				SET selection_state = 'selected', selection_index = 1, selected_at = now()
				WHERE operation_id = $1 AND invitation_id = $2
			`, [proposed.operation.operationId, proposed.operation.targets[0].invitationId]);
			await client.query(`
				UPDATE hub.semantic_operation_targets
				SET selection_state = 'selected', selection_index = 3, selected_at = now()
				WHERE operation_id = $1 AND invitation_id = $2
			`, [proposed.operation.operationId, proposed.operation.targets[1].invitationId]);
		});

		const selfProposal = await ctx.pPropose({targetRefs: [ctx.source.targetRef]});
		await pExpect23514(client => client.query(`
			UPDATE hub.semantic_operation_targets
			SET response_state = 'pending',
				response_actor_account_id = NULL,
				responded_at = NULL
			WHERE operation_id = $1
		`, [selfProposal.operation.operationId]));
	});

	test("expires inline, cancels/revokes on lifecycle, and purges without orphan rows", async () => {
		const expiringStore = new PostgresHubStore({
			pool,
			semanticOperationRegistry: getRegistry(),
			multiTargetOperationsEnabled: true,
			multiTargetCollectionTtlMs: 10,
			multiTargetOperationTtlMs: 60_000,
		});
		const originalStore = store;
		store = expiringStore;
		try {
			const ctx = await pFixture({targetCount: 2});
			const expiring = await ctx.pPropose();
			await new Promise(resolve => setTimeout(resolve, 25));
			expect((await store.pExpireMultiTargetOperations()).processed).toBeGreaterThanOrEqual(1);
			const expired = await store.pGetMultiTargetOperation({
				accountId: ctx.sourceOwner.account.id,
				campaignId: ctx.campaign.id,
				operationId: expiring.operation.operationId,
			});
			expect(expired.operation.status).toBe("awaiting_source_selection");

			const sourceLifecycle = await ctx.pPropose();
			await store.pArchiveCharacter({
				accountId: ctx.sourceOwner.account.id,
				characterId: ctx.source.id,
				idempotencyKey: crypto.randomUUID(),
			});
			expect((await pool.query(
				`SELECT status FROM hub.semantic_operations WHERE id = $1`,
				[sourceLifecycle.operation.operationId],
			)).rows[0].status).toBe("cancelled");

			const targetCtx = await pFixture({targetCount: 1});
			const targetLifecycle = await targetCtx.pPropose();
			await store.pArchiveCharacter({
				accountId: targetCtx.targetOwners[0].account.id,
				characterId: targetCtx.targets[0].id,
				idempotencyKey: crypto.randomUUID(),
			});
			expect((await pool.query(
				`SELECT response_state FROM hub.semantic_operation_targets WHERE operation_id = $1`,
				[targetLifecycle.operation.operationId],
			)).rows[0].response_state).toBe("revoked");

			const moveCtx = await pFixture({targetCount: 1});
			const movingOperation = await moveCtx.pPropose();
			const destination = await pCreateCampaign({
				dm: moveCtx.targetOwners[0],
				name: "Moved target destination",
			});
			await expect(store.pMoveCharacter({
				accountId: moveCtx.targetOwners[0].account.id,
				characterId: moveCtx.targets[0].id,
				campaignId: destination.campaign.id,
				rulesVersionId: destination.rulesVersion.id,
				idempotencyKey: crypto.randomUUID(),
			})).resolves.toMatchObject({character: {campaignId: destination.campaign.id}});
			expect((await pool.query(`
				SELECT target.response_state, character.campaign_id
				FROM hub.semantic_operation_targets target
				JOIN hub.characters character ON character.id = target.target_character_id
				WHERE target.operation_id = $1
			`, [movingOperation.operation.operationId])).rows[0]).toEqual({
				response_state: "revoked",
				campaign_id: destination.campaign.id,
			});

			const removalCtx = await pFixture({targetCount: 1});
			const removalOperation = await removalCtx.pPropose();
			const membershipId = (await pool.query(`
				SELECT id
				FROM hub.memberships
				WHERE campaign_id = $1 AND account_id = $2
			`, [removalCtx.campaign.id, removalCtx.targetOwners[0].account.id])).rows[0].id;
			await expect(store.pRemoveMember({
				accountId: removalCtx.dm.account.id,
				campaignId: removalCtx.campaign.id,
				membershipId,
				idempotencyKey: crypto.randomUUID(),
			})).resolves.toMatchObject({removedAccountId: removalCtx.targetOwners[0].account.id});
			expect((await pool.query(`
				SELECT target.response_state, character.campaign_id
				FROM hub.semantic_operation_targets target
				JOIN hub.characters character ON character.id = target.target_character_id
				WHERE target.operation_id = $1
			`, [removalOperation.operation.operationId])).rows[0]).toEqual({
				response_state: "revoked",
				campaign_id: null,
			});

			const purgeCtx = await pFixture({targetCount: 1});
			const purgeOperation = await purgeCtx.pPropose();
			await pool.query(`
				UPDATE hub.accounts
				SET status = 'deletion_requested',
					deletion_requested_at = now() - interval '2 days',
					purge_after = now() - interval '1 day'
				WHERE id = $1
			`, [purgeCtx.targetOwners[0].account.id]);
			const purged = await store.pPurgeDueAccounts({limit: 100});
			expect(purged.purgedAccountIds).toContain(purgeCtx.targetOwners[0].account.id);
			const orphanEvidence = await pool.query(`
				SELECT
					(SELECT count(*)::integer FROM hub.semantic_operation_targets
						WHERE operation_id = $1) AS targets,
					(SELECT count(*)::integer FROM hub.semantic_operation_finalizations
						WHERE operation_id = $1) AS finalizations,
					(SELECT count(*)::integer FROM hub.semantic_operation_commands
						WHERE operation_id = $1) AS commands,
					(SELECT count(*)::integer FROM hub.semantic_operations
						WHERE id = $1) AS parents
			`, [purgeOperation.operation.operationId]);
			expect(orphanEvidence.rows[0]).toEqual({
				targets: 0,
				finalizations: 0,
				commands: 0,
				parents: 0,
			});
		} finally {
			store = originalStore;
		}
	});

	test("cancels a live two-owner parent before purging one target owner and continues the due batch", async () => {
		const ctx = await pFixture({targetCount: 2, sameTargetOwner: false});
		const proposed = await ctx.pPropose();
		const extraDue = await pActor("Multi PG extra due");
		await pool.query(`
			UPDATE hub.accounts
			SET status = 'deletion_requested',
				deletion_requested_at = now() - interval '2 days',
				purge_after = now() - interval '1 day'
			WHERE id = ANY($1::uuid[])
		`, [[ctx.targetOwners[0].account.id, extraDue.account.id]]);
		const purged = await store.pPurgeDueAccounts({limit: 100});
		expect(purged.purgedAccountIds).toEqual(expect.arrayContaining([
			ctx.targetOwners[0].account.id,
			extraDue.account.id,
		]));
		expect(purged.blockedAccountIds).not.toEqual(expect.arrayContaining([
			ctx.targetOwners[0].account.id,
			extraDue.account.id,
		]));
		const evidence = await pool.query(`
			SELECT
				(SELECT count(*)::integer FROM hub.semantic_operations WHERE id = $1) AS parents,
				(SELECT count(*)::integer FROM hub.semantic_operation_targets WHERE operation_id = $1) AS targets,
				(SELECT count(*)::integer FROM hub.accounts WHERE id = $2) AS purged_account,
				(SELECT count(*)::integer FROM hub.accounts WHERE id = $3) AS retained_account,
				(SELECT count(*)::integer FROM hub.characters WHERE id = $4) AS retained_character,
				(SELECT count(*)::integer FROM hub.accounts WHERE id = $5) AS extra_purged_account,
				(SELECT count(*)::integer FROM hub.domain_events
					WHERE payload->>'operationId' = $1::text
						AND event_type IN (
							'character.multi_operation.target_responded',
							'character.multi_operation.cancelled'
						)) AS lifecycle_events,
				(SELECT count(*)::integer
					FROM hub.outbox_entries outbox
					JOIN hub.domain_events event ON event.id = outbox.event_id
					WHERE event.payload->>'operationId' = $1::text
						AND event.event_type IN (
							'character.multi_operation.target_responded',
							'character.multi_operation.cancelled'
						)) AS lifecycle_outbox
		`, [
			proposed.operation.operationId,
			ctx.targetOwners[0].account.id,
			ctx.targetOwners[1].account.id,
			ctx.targets[1].id,
			extraDue.account.id,
		]);
		expect(evidence.rows[0]).toEqual({
			parents: 0,
			targets: 0,
			purged_account: 0,
			retained_account: 1,
			retained_character: 1,
			extra_purged_account: 0,
			lifecycle_events: 3,
			lifecycle_outbox: 3,
		});
	});
});
