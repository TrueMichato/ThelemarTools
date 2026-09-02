import crypto from "node:crypto";
import pg from "pg";

import {HubStoreError} from "../../../server/src/hub-store-error.js";
import {PostgresHubStore} from "../../../server/src/postgres-hub-store.js";
import {createSemanticOperationRegistry} from "../../../server/src/semantic-operation-registry.js";

const {Pool} = pg;

const describePostgres = process.env.HUB_TEST_POSTGRES_URL ? describe : describe.skip;

function getIdempotency (key, request) {
	return {
		key,
		requestHash: crypto.createHash("sha256").update(JSON.stringify(request)).digest("hex"),
	};
}

function getCharacterData ({name, hpCurrent = 5, features = []}) {
	return {
		name,
		abilities: {str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10},
		abilityBonuses: {str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0},
		hp: {current: hpCurrent, max: 20, temp: 0},
		classes: [],
		features,
		spellcasting: {spellsKnown: [], cantripsKnown: [], spellSlots: {}},
		inventory: [],
	};
}

function getTestRegistry () {
	return createSemanticOperationRegistry({
		templates: [{
			sourceEntity: {type: "ability", uid: "steadying word|tst", version: "tst-v1"},
			effectTemplateId: "ability.steadying-word.heal",
			cost: "none",
			display: {label: "Steadying Word"},
			normalizeChoice: choice => {
				if (
					!choice
					|| typeof choice !== "object"
					|| Array.isArray(choice)
					|| Object.keys(choice).some(key => key !== "amount")
					|| !Number.isInteger(choice.amount)
					|| choice.amount < 1
					|| choice.amount > 10
				) {
					throw new HubStoreError("SOURCE_OR_TARGET_UNAVAILABLE", `Source or target is unavailable.`, {status: 404});
				}
				return {amount: choice.amount};
			},
			deriveOperation: ({choice}) => ({kind: "hp.heal", arguments: {amount: choice.amount}}),
		}],
	});
}

describePostgres("Campaign Hub semantic operations (real PostgreSQL)", () => {
	let pool;
	let store;
	let dm;
	let sourceOwner;
	let targetOwner;
	let dmSession;
	let sourceSession;
	let targetSession;
	let campaign;
	let sourceMembership;
	let sourceCharacter;
	let targetCharacter;

	async function pCreateAccountWithSession (label) {
		const nonce = crypto.randomUUID();
		const account = await store.pUpsertOAuthAccount({
			provider: "test",
			providerSubject: `${label}-${nonce}`,
			displayName: label,
		});
		const session = await store.pCreateSession({
			accountId: account.id,
			tokenHash: crypto.randomBytes(32).toString("hex"),
			expiresAt: new Date(Date.now() + 60_000),
		});
		return {account, session};
	}

	async function pJoinCampaign ({account, role = "player"}) {
		const tokenHash = crypto.randomBytes(32).toString("hex");
		await store.pCreateInvite({
			accountId: dm.id,
			campaignId: campaign.id,
			role,
			tokenHash,
			expiresAt: new Date(Date.now() + 60_000),
			maxUses: 1,
			idempotencyKey: crypto.randomUUID(),
		});
		return (await store.pRedeemInvite({
			accountId: account.id,
			tokenHash,
			idempotencyKey: crypto.randomUUID(),
		})).membership;
	}

	beforeAll(async () => {
		pool = new Pool({
			connectionString: process.env.HUB_TEST_POSTGRES_URL,
			ssl: false,
			max: 8,
		});
		store = new PostgresHubStore({
			pool,
			semanticOperationRegistry: getTestRegistry(),
		});
		await store.pCheckHealth();

		({account: dm, session: dmSession} = await pCreateAccountWithSession("Semantic DM"));
		({account: sourceOwner, session: sourceSession} = await pCreateAccountWithSession("Semantic Source"));
		({account: targetOwner, session: targetSession} = await pCreateAccountWithSession("Semantic Target"));
		campaign = (await store.pCreateCampaign({
			accountId: dm.id,
			name: `Semantic PostgreSQL ${crypto.randomUUID()}`,
			idempotencyKey: crypto.randomUUID(),
		})).campaign;
		sourceMembership = await pJoinCampaign({account: sourceOwner});
		await pJoinCampaign({account: targetOwner});

		sourceCharacter = (await store.pCreateCharacter({
			accountId: sourceOwner.id,
			campaignId: campaign.id,
			data: getCharacterData({
				name: "Source",
				features: [{name: "Steadying Word", source: "TST"}],
			}),
			schemaVersion: 1,
			clientImportId: crypto.randomUUID(),
			idempotencyKey: crypto.randomUUID(),
		})).character;
		targetCharacter = (await store.pCreateCharacter({
			accountId: targetOwner.id,
			campaignId: campaign.id,
			data: getCharacterData({name: "Target"}),
			schemaVersion: 1,
			clientImportId: crypto.randomUUID(),
			idempotencyKey: crypto.randomUUID(),
		})).character;
	});

	afterAll(async () => {
		await pool?.end();
	});

	test("commits privileged application, replay metadata, and watermark exactly once", async () => {
		const commandId = crypto.randomUUID();
		const request = {
			commandId,
			targetCharacterId: targetCharacter.id,
			operation: {kind: "hp.heal", version: 1, arguments: {amount: 2}},
		};
		const input = {
			accountId: dm.id,
			sessionId: dmSession.id,
			campaignId: campaign.id,
			commandId,
			targetCharacterId: targetCharacter.id,
			operation: request.operation,
			idempotencyKey: getIdempotency(commandId, request),
		};
		const [first, replay] = await Promise.all([
			store.pCreateStructuredAction(input),
			store.pCreateStructuredAction(input),
		]);

		expect(replay).toEqual(first);
		expect(first.operation).toMatchObject({
			operationId: expect.any(String),
			status: "applied",
			operation: {
				kind: "hp.heal",
				arguments: {amount: 2},
			},
			resultingCharacterRevision: 2,
		});

		const persisted = await pool.query(`
			SELECT c.revision, c.operation_watermark, c.data, so.applied_event_id,
				(SELECT count(*)::integer FROM hub.semantic_operation_commands soc WHERE soc.command_id = $2) AS command_count,
				(SELECT count(*)::integer FROM hub.domain_events de
					WHERE de.id = so.applied_event_id AND de.event_type = 'character.operation.applied') AS applied_event_count
			FROM hub.characters c
			JOIN hub.semantic_operations so ON so.target_character_id = c.id
			WHERE c.id = $1 AND so.id = $3
		`, [targetCharacter.id, commandId, first.operation.operationId]);
		expect(persisted.rows[0]).toMatchObject({
			revision: "2",
			operation_watermark: expect.any(String),
			applied_event_id: first.eventIds[0],
			command_count: 1,
			applied_event_count: 1,
		});
		expect(persisted.rows[0].data.hp.current).toBe(7);
		expect(Number(persisted.rows[0].operation_watermark)).toBeGreaterThan(0);

		await expect(store.pCreateStructuredAction({
			...input,
			operation: {kind: "hp.heal", version: 1, arguments: {amount: 3}},
			idempotencyKey: getIdempotency(commandId, {...request, operation: {kind: "hp.heal", version: 1, arguments: {amount: 3}}}),
		})).rejects.toMatchObject({code: "IDEMPOTENCY_KEY_REUSED"});
	});

	test("serializes explicit target-owner approval and preserves source truth", async () => {
		const commandId = crypto.randomUUID();
		const request = {
			commandId,
			sourceCharacterId: sourceCharacter.id,
			sourceEntity: {type: "ability", uid: "steadying word|tst", version: "tst-v1"},
			effectTemplateId: "ability.steadying-word.heal",
			choice: {amount: 3},
			targetRef: targetCharacter.targetRef,
		};
		const proposed = await store.pCreateStructuredAction({
			accountId: sourceOwner.id,
			sessionId: sourceSession.id,
			campaignId: campaign.id,
			...request,
			idempotencyKey: getIdempotency(commandId, request),
		});
		expect(proposed.operation).toMatchObject({status: "proposed", operationId: expect.any(String)});
		expect(proposed.operation).not.toHaveProperty("sourceCharacterId");

		const resolutions = await Promise.allSettled([3, 4].map(amount => {
			const resolveCommandId = crypto.randomUUID();
			const resolveRequest = {commandId: resolveCommandId, operationId: proposed.operation.operationId, decision: "accept"};
			return store.pResolveStructuredAction({
				accountId: targetOwner.id,
				sessionId: targetSession.id,
				campaignId: campaign.id,
				commandId: resolveCommandId,
				actionId: proposed.operation.operationId,
				decision: "accept",
				idempotencyKey: getIdempotency(resolveCommandId, {...resolveRequest, amount}),
			});
		}));
		const fulfilled = resolutions.filter(result => result.status === "fulfilled");
		const rejected = resolutions.filter(result => result.status === "rejected");
		expect(fulfilled).toHaveLength(1);
		expect(fulfilled[0].value.operation).toMatchObject({status: "applied", resultingCharacterRevision: 3});
		expect(rejected).toHaveLength(1);
		expect(rejected[0].reason).toMatchObject({code: "ACTION_NOT_FOUND"});

		const persisted = await pool.query(`
			SELECT
				(SELECT revision FROM hub.characters WHERE id = $1) AS source_revision,
				(SELECT data->'hp'->>'current' FROM hub.characters WHERE id = $2) AS target_hp,
				(SELECT count(*)::integer FROM hub.semantic_operation_commands WHERE operation_id = $3) AS command_count,
				(SELECT payload FROM hub.domain_events WHERE id = so.applied_event_id) AS applied_payload
			FROM hub.semantic_operations so
			WHERE so.id = $3
		`, [sourceCharacter.id, targetCharacter.id, proposed.operation.operationId]);
		expect(persisted.rows[0].source_revision).toBe("1");
		expect(persisted.rows[0].target_hp).toBe("10");
		expect(persisted.rows[0].command_count).toBe(2);
		expect(persisted.rows[0].applied_payload).toEqual({
			operation: {
				operationId: proposed.operation.operationId,
				kind: "hp.heal",
				version: 1,
				targetCharacterId: targetCharacter.id,
				arguments: {amount: 3},
			},
			resultingCharacterRevision: 3,
		});
	});

	test("expires and lifecycle-cancels proposals with privacy-safe terminal events", async () => {
		const pPropose = async amount => {
			const commandId = crypto.randomUUID();
			const request = {
				commandId,
				sourceCharacterId: sourceCharacter.id,
				sourceEntity: {type: "ability", uid: "steadying word|tst", version: "tst-v1"},
				effectTemplateId: "ability.steadying-word.heal",
				choice: {amount},
				targetRef: targetCharacter.targetRef,
			};
			return store.pCreateStructuredAction({
				accountId: sourceOwner.id,
				sessionId: sourceSession.id,
				campaignId: campaign.id,
				...request,
				idempotencyKey: getIdempotency(commandId, request),
			});
		};

		const expiring = await pPropose(4);
		await pool.query(`
			UPDATE hub.semantic_operations
			SET created_at = now() - interval '25 hours',
				expires_at = now() - interval '1 hour'
			WHERE id = $1
		`, [expiring.operation.operationId]);
		await store.pListPendingActions({accountId: dm.id, campaignId: campaign.id});

		const cancellable = await pPropose(5);
		await store.pRemoveMember({
			accountId: dm.id,
			campaignId: campaign.id,
			membershipId: sourceMembership.id,
			idempotencyKey: crypto.randomUUID(),
		});

		const terminal = await pool.query(`
			SELECT so.id, so.status, so.terminal_reason, de.event_type, de.visibility,
				de.visible_account_ids, de.payload
			FROM hub.semantic_operations so
			JOIN hub.domain_events de ON de.id = so.terminal_event_id
			WHERE so.id = ANY($1::uuid[])
			ORDER BY so.id
		`, [[expiring.operation.operationId, cancellable.operation.operationId]]);
		expect(terminal.rows.map(row => row.status).sort()).toEqual(["cancelled", "expired"]);
		for (const row of terminal.rows) {
			expect(row.visibility).toBe("explicit_accounts");
			expect(row.visible_account_ids).toEqual(expect.arrayContaining([sourceOwner.id, targetOwner.id]));
			expect(row.payload).toMatchObject({
				operationId: row.id,
				targetCharacterId: targetCharacter.id,
				status: row.status,
				reason: "unavailable",
			});
			expect(JSON.stringify(row.payload)).not.toContain(sourceOwner.id);
			expect(JSON.stringify(row.payload)).not.toContain(sourceCharacter.id);
		}
	});

	test("continues PostgreSQL replay past privacy-redacted pages by scanned sequence", async () => {
		const {account: hiddenOwner} = await pCreateAccountWithSession("Semantic Hidden");
		await pJoinCampaign({account: hiddenOwner});
		const hiddenCharacter = (await store.pCreateCharacter({
			accountId: hiddenOwner.id,
			campaignId: campaign.id,
			data: getCharacterData({name: "Hidden"}),
			schemaVersion: 1,
			clientImportId: crypto.randomUUID(),
			idempotencyKey: crypto.randomUUID(),
		})).character;
		const before = await store.pGetCampaignCursor({accountId: targetOwner.id, campaignId: campaign.id});
		await store.pSetProjectionPolicy({
			accountId: hiddenOwner.id,
			characterId: hiddenCharacter.id,
			policy: {version: 1, preset: "private", overrides: {}},
			expectedProjectionRevision: hiddenCharacter.projectionRevision,
			idempotencyKey: crypto.randomUUID(),
		});
		await store.pLogRoll({
			accountId: hiddenOwner.id,
			campaignId: campaign.id,
			characterId: hiddenCharacter.id,
			visibility: "all_members",
			payload: {formula: "1d20", total: 12},
			idempotencyKey: crypto.randomUUID(),
		});
		const commandId = crypto.randomUUID();
		const request = {
			commandId,
			targetCharacterId: targetCharacter.id,
			operation: {kind: "hp.damage", version: 1, arguments: {amount: 1}},
		};
		const applied = await store.pCreateStructuredAction({
			accountId: dm.id,
			sessionId: dmSession.id,
			campaignId: campaign.id,
			...request,
			idempotencyKey: getIdempotency(commandId, request),
		});

		let afterSequence = before.cursor.lastSequence;
		const visible = [];
		const first = await store.pListVisibleEventPage({
			accountId: targetOwner.id,
			campaignId: campaign.id,
			afterSequence,
			limit: 1,
		});
		expect(first.events).toEqual([]);
		expect(first.replay.hasMore).toBe(true);
		expect(first.replay.scannedThroughSequence).toBeGreaterThan(afterSequence);
		afterSequence = first.replay.scannedThroughSequence;

		for (let i = 0; i < 10; ++i) {
			const page = await store.pListVisibleEventPage({
				accountId: targetOwner.id,
				campaignId: campaign.id,
				afterSequence,
				limit: 1,
			});
			visible.push(...page.events);
			afterSequence = page.replay.scannedThroughSequence;
			if (!page.replay.hasMore) break;
		}
		expect(visible).toContainEqual(expect.objectContaining({
			type: "character.operation.applied",
			payload: expect.objectContaining({
				operation: expect.objectContaining({operationId: applied.operation.operationId}),
			}),
		}));
	});
});
