import crypto from "node:crypto";
import pg from "pg";
import {MemoryHubStore} from "../../../server/src/memory-hub-store.js";
import {PostgresHubStore} from "../../../server/src/postgres-hub-store.js";

const describePostgres = process.env.HUB_TEST_POSTGRES_URL ? describe : describe.skip;

for (const [name, describeStore, isPostgres] of [
	["memory", describe, false],
	["PostgreSQL", describePostgres, true],
]) {
	describeStore(`owner Roll History (${name})`, () => {
		let store;
		let pool;
		let owner;
		let dm;
		let peer;
		let campaign;
		let character;
		let otherCharacter;

		beforeEach(async () => {
			if (isPostgres) {
				pool = new pg.Pool({connectionString: process.env.HUB_TEST_POSTGRES_URL, ssl: false, statement_timeout: 10_000});
				store = new PostgresHubStore({pool});
			} else store = new MemoryHubStore();
			const account = displayName => store.pUpsertOAuthAccount({
				provider: "test",
				providerSubject: crypto.randomUUID(),
				displayName,
			});
			[owner, dm, peer] = await Promise.all([account("Roll owner"), account("Roll DM"), account("Roll peer")]);
			campaign = (await store.pCreateCampaign({accountId: dm.id, name: "Roll history", idempotencyKey: crypto.randomUUID()})).campaign;
			for (const member of [owner, peer]) {
				const tokenHash = crypto.randomBytes(32).toString("hex");
				await store.pCreateInvite({accountId: dm.id, campaignId: campaign.id, role: "player", tokenHash, expiresAt: new Date(Date.now() + 60_000), maxUses: 1, idempotencyKey: crypto.randomUUID()});
				await store.pRedeemInvite({accountId: member.id, tokenHash, idempotencyKey: crypto.randomUUID()});
			}
			const create = () => store.pCreateCharacter({
				accountId: owner.id,
				campaignId: campaign.id,
				schemaVersion: 1,
				clientImportId: crypto.randomUUID(),
				data: {name: "Roll character"},
				idempotencyKey: crypto.randomUUID(),
			});
			character = (await create()).character;
			otherCharacter = (await create()).character;
		});

		afterEach(async () => {
			if (!isPostgres) return;
			const cleanupPool = pool;
			const cleanupStore = store;
			const cleanupAccountIds = [owner?.id, dm?.id, peer?.id].filter(Boolean);
			const cleanupCampaignId = campaign?.id;
			try {
				await cleanupPool.query("DELETE FROM hub.characters WHERE owner_account_id = ANY($1::uuid[])", [cleanupAccountIds]);
				if (cleanupCampaignId) await cleanupPool.query("DELETE FROM hub.campaigns WHERE id = $1", [cleanupCampaignId]);
				await cleanupPool.query("DELETE FROM hub.accounts WHERE id = ANY($1::uuid[])", [cleanupAccountIds]);
			} finally {
				await cleanupStore.pClose();
			}
		});

		const log = ({accountId = owner.id, characterId = character.id, total = 17, visibility = "actor_and_dm", key = crypto.randomUUID(), detail = {title: "Perception", breakdown: "1d20+3"}} = {}) => store.pLogRoll({
			accountId,
			campaignId: campaign.id,
			characterId,
			visibility,
			payload: {formula: "1d20+3", total, context: "skill", detail},
			idempotencyKey: key,
		});
		const history = options => store.pListCharacterRollHistory({
			accountId: owner.id, campaignId: campaign.id, characterId: character.id, ...options,
		});

		it("returns the latest 200 own rolls, not DM rolls, another character, or campaign activity", async () => {
			const own = [];
			for (let index = 0; index < 205; index++) own.push((await log({total: index})).event.id);
			for (let index = 0; index < 210; index++) {
				await log({accountId: dm.id, total: -index, visibility: "all_members"});
				await log({characterId: otherCharacter.id});
				await log({characterId: null, accountId: peer.id});
			}
			const page = await history();
			expect(page.events.map(event => event.id)).toEqual(own.slice(-200));
			expect(page.history.hasMore).toBe(true);
			expect(page.events).toHaveLength(200);
			expect(page.events.every(event => event.actorAccountId === owner.id && event.aggregateId === character.id)).toBe(true);
			const older = await history({beforeSequence: page.history.scannedBackThroughSequence});
			expect(older.events.map(event => event.id)).toEqual(own.slice(0, 5));
			expect(older.history.hasMore).toBe(false);
		});

		it("authorizes current ownership and membership, not DM inspection or a visible peer profile", async () => {
			await log();
			for (const account of [dm, peer]) {
				await expect(history({accountId: account.id})).rejects.toMatchObject({code: "CHARACTER_NOT_FOUND", status: 404});
			}
			await expect(history({campaignId: crypto.randomUUID()})).rejects.toMatchObject({code: "CAMPAIGN_NOT_FOUND"});
			const membership = await store.pGetMembership({accountId: owner.id, campaignId: campaign.id});
			await store.pRemoveMember({accountId: dm.id, campaignId: campaign.id, membershipId: membership.id, idempotencyKey: crypto.randomUUID()});
			await expect(history()).rejects.toMatchObject({code: "CAMPAIGN_NOT_FOUND"});
		});

		it("keeps existing event audiences and bounds legacy detail instead of returning arbitrary payloads", async () => {
			await log({visibility: "dm_only"});
			const logged = await log({detail: {title: "Secret roll", breakdown: "x".repeat(2_000), privateBlob: {secret: "DO NOT RETURN"}, resultNote: "note"}});
			const page = await history();
			expect(page.events.map(event => event.id)).toEqual([logged.event.id]);
			expect(page.events[0].payload.detail.breakdown.length).toBeLessThanOrEqual(200);
			expect(JSON.stringify(page)).not.toContain("DO NOT RETURN");
		});

		it("replays one exact roll command and provides actor-only correlation for lost-response reconciliation", async () => {
			const key = crypto.randomUUID();
			const first = await log({key});
			expect((await log({key})).event.id).toBe(first.event.id);
			const found = await history({commandId: key});
			expect(found.events).toHaveLength(1);
			expect(found.events[0].payload.actorCommandId).toBe(key);
			expect((await history({commandId: crypto.randomUUID()})).events).toEqual([]);
			const dmEvents = await store.pListVisibleEventPage({accountId: dm.id, campaignId: campaign.id});
			expect(dmEvents.events.find(event => event.id === first.event.id).payload.actorCommandId).toBeUndefined();
		});

		it("uses exclusive cursors without including newly committed rolls in older history", async () => {
			const first = (await log()).event;
			const second = (await log()).event;
			const initial = await history({limit: 1});
			await log();
			expect(initial.events.map(event => event.id)).toEqual([second.id]);
			const older = await history({beforeSequence: initial.history.scannedBackThroughSequence, limit: 1});
			expect(older.events.map(event => event.id)).toEqual([first.id]);
			expect(older.history.hasMore).toBe(false);
		});

		it("cannot read a retained source-campaign history after archive detaches the character", async () => {
			await log();
			await store.pArchiveCampaign({accountId: dm.id, campaignId: campaign.id, idempotencyKey: crypto.randomUUID()});
			await expect(history()).rejects.toMatchObject({code: "CHARACTER_NOT_FOUND", status: 404});
		});

		if (isPostgres) {
			it("indexes every semantic event-reference foreign key without weakening retention", async () => {
				const {rows} = await pool.query(`
					SELECT constraint_row.conname AS constraint_name,
						EXISTS (
							SELECT 1
							FROM pg_index index_row
							WHERE index_row.indrelid = constraint_row.conrelid
								AND index_row.indisvalid AND index_row.indisready
								AND index_row.indkey[0] = constraint_row.conkey[1]
								AND index_row.indkey[1] = constraint_row.conkey[2]
								AND (
									index_row.indpred IS NULL
									OR pg_get_expr(index_row.indpred, index_row.indrelid)
										= format('(%I IS NOT NULL)', event_column.attname)
								)
						) AS indexed
					FROM pg_constraint constraint_row
					JOIN pg_class table_row ON table_row.oid = constraint_row.conrelid
					JOIN pg_attribute event_column ON event_column.attrelid = constraint_row.conrelid
						AND event_column.attnum = constraint_row.conkey[2]
					WHERE constraint_row.contype = 'f'
						AND constraint_row.confrelid = 'hub.domain_events'::regclass
						AND table_row.oid IN (
							'hub.semantic_operations'::regclass,
							'hub.semantic_operation_targets'::regclass,
							'hub.semantic_operation_finalizations'::regclass
						)
					ORDER BY constraint_row.conname
				`);
				expect(rows).toHaveLength(12);
				expect(rows.filter(row => !row.indexed)).toEqual([]);
			});

			it("reads sparse own history behind 100,000 unrelated events within the query and byte budgets", async () => {
				const own = [];
				for (let i = 0; i < 205; i++) own.push((await log({total: i})).event.id);
				const offset = (await pool.query("SELECT next_event_sequence FROM hub.campaigns WHERE id = $1", [campaign.id])).rows[0].next_event_sequence;
				const stressPool = pool;
				const stressIds = [campaign.id, offset, peer.id, otherCharacter.id];
				let inserted = false;
				try {
					const insertion = await stressPool.query(`
						INSERT INTO hub.domain_events
							(id, campaign_id, sequence, event_type, actor_account_id, aggregate_type, aggregate_id, visibility, payload)
						SELECT gen_random_uuid(), $1, $2::bigint + i, 'roll.logged', $3, 'character', $4, 'actor_and_dm',
							'{"formula":"1d20","total":10,"detail":{"privateBlob":"Unrelated roll"}}'::jsonb
						FROM generate_series(0, 99999) AS i
					`, stressIds);
					inserted = true;
					expect(insertion.rowCount).toBe(100_000);
					await stressPool.query("UPDATE hub.campaigns SET next_event_sequence = $2::bigint + 100000 WHERE id = $1", [stressIds[0], offset]);
					const start = performance.now();
					const result = await history();
					const elapsed = performance.now() - start;
					expect(result.events.map(event => event.id)).toEqual(own.slice(-200));
					expect(elapsed).toBeLessThan(5_000);
					expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThan(1_000_000);
					console.log(`Roll History: 100,000 newer unrelated rows retained through read assertions, ${elapsed.toFixed(1)} ms, ${Buffer.byteLength(JSON.stringify(result))} bytes. No dedicated index: unbounded growth is not proven; 5s timeout fails explicitly.`);
				} finally {
					if (inserted) {
						const deletion = await stressPool.query(`
							DELETE FROM hub.domain_events
							WHERE campaign_id = $1 AND sequence >= $2::bigint AND sequence < $2::bigint + 100000
								AND actor_account_id = $3 AND aggregate_type = 'character' AND aggregate_id = $4
								AND event_type = 'roll.logged' AND visibility = 'actor_and_dm'
								AND payload = '{"formula":"1d20","total":10,"detail":{"privateBlob":"Unrelated roll"}}'::jsonb
						`, stressIds);
						expect(deletion.rowCount).toBe(100_000);
						console.log(`Roll History cleanup: deleted exactly ${deletion.rowCount} owned synthetic rows by campaign, sequence interval, actor, aggregate and payload after the populated read. Original 30s body/5s hook limits remain.`);
					}
				}
			}, 30_000);

			it("interleaves reads and roll writes without a lock upgrade or duplicate command", async () => {
				const keys = Array.from({length: 8}, () => crypto.randomUUID());
				await Promise.all(keys.map(async key => {
					await Promise.all([history(), log({key}), log({key})]);
				}));
				expect((await history()).events).toHaveLength(8);
			}, 30_000);

			it("fails explicitly when the campaign authority lock exceeds the read budget", async () => {
				const blocker = await pool.connect();
				try {
					await blocker.query("BEGIN");
					await blocker.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 6))", [campaign.id]);
					await expect(history()).rejects.toMatchObject({code: "ROLL_HISTORY_UNAVAILABLE", status: 503});
				} finally {
					await blocker.query("ROLLBACK");
					blocker.release();
				}
			}, 10_000);
		}
	});
}
