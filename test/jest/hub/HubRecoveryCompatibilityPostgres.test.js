import crypto from "node:crypto";
import fs from "node:fs";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import pg from "pg";
import "../charactersheet/setup.js";
import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import {PostgresHubStore} from "../../../server/src/postgres-hub-store.js";
import {pGetRecoveryCompatibility} from "../../../server/scripts/check-recovery-compatibility.mjs";

const describePostgres = process.env.HUB_TEST_POSTGRES_URL ? describe : describe.skip;
const checkerScript = fileURLToPath(new URL("../../../server/scripts/check-recovery-compatibility.mjs", import.meta.url));

function getUnavailableDatabaseUrl (databaseUrl, databaseName) {
	const unavailableDatabaseUrl = new URL(databaseUrl);
	unavailableDatabaseUrl.pathname = `/hub_missing_${databaseName}`;
	return unavailableDatabaseUrl;
}

function acquiredLayOnHandsData (level = 3) {
	const state = new globalThis.CharacterSheetState();
	const book = JSON.parse(fs.readFileSync("data/class/class-paladin.json", "utf8"));
	const cls = book.class.find(entry => entry.name === "Paladin" && entry.source === "XPHB");
	state.addClass({name: "Paladin", source: "XPHB", level});
	globalThis.CharacterSheetClassUtils.updateClassResources(state, state.getClasses()[0], level, cls);
	globalThis.CharacterSheetClassUtils.reconcileClassFeatures(state, {getClassData: () => cls, classFeatures: book.classFeature});
	return state.toJson();
}

function withLayOnHandsIdentity ({resourceId, featureUid}) {
	const data = acquiredLayOnHandsData();
	const feature = data.features.find(entry => entry.name === "Lay on Hands" && entry.source === "XPHB");
	if (!feature) throw new Error("The acquired XPHB Lay on Hands feature is missing.");
	const resource = data.resources.find(entry => entry.featureId === feature.id);
	if (!resource) throw new Error("The acquired XPHB Lay on Hands resource is missing.");
	feature.uid = featureUid;
	feature.resourceId = resourceId;
	resource.id = resourceId;
	resource.featureId = feature.id;
	resource.featureRef = {uid: featureUid};
	return data;
}

describePostgres("Campaign Hub recovery compatibility (real PostgreSQL)", () => {
	let pool;
	let store;
	let dm;
	let campaign;
	let rulesVersion;

	async function pCreateAccountWithSession (label) {
		const account = await store.pUpsertOAuthAccount({
			provider: "test",
			providerSubject: `${label}-${crypto.randomUUID()}`,
			displayName: label,
		});
		const session = await store.pCreateSession({
			accountId: account.id,
			tokenHash: crypto.randomBytes(32).toString("hex"),
			expiresAt: new Date(Date.now() + 60_000),
		});
		return {account, session};
	}

	async function pJoinCampaign (account) {
		const tokenHash = crypto.randomBytes(32).toString("hex");
		await store.pCreateInvite({
			accountId: dm.id,
			campaignId: campaign.id,
			role: "player",
			tokenHash,
			expiresAt: new Date(Date.now() + 60_000),
			maxUses: 1,
			idempotencyKey: crypto.randomUUID(),
		});
		await store.pRedeemInvite({
			accountId: account.id,
			tokenHash,
			idempotencyKey: crypto.randomUUID(),
		});
	}

	async function pCreateCharacter ({owner, name, data}) {
		return (await store.pCreateCharacter({
			accountId: owner.id,
			campaignId: campaign.id,
			data,
			schemaVersion: 1,
			clientImportId: crypto.randomUUID(),
			idempotencyKey: crypto.randomUUID(),
		})).character;
	}

	beforeAll(async () => {
		pool = new pg.Pool({
			connectionString: process.env.HUB_TEST_POSTGRES_URL,
			ssl: false,
			max: 4,
		});
		store = new PostgresHubStore({
			pool,
			peerSourceCostsEnabled: campaignId => campaign?.id === campaignId,
		});
		await store.pCheckHealth();
		({account: dm} = await pCreateAccountWithSession("Recovery Compatibility DM"));
		campaign = (await store.pCreateCampaign({
			accountId: dm.id,
			name: `Recovery compatibility ${crypto.randomUUID()}`,
			idempotencyKey: crypto.randomUUID(),
		})).campaign;
		rulesVersion = (await store.pCreateRulesVersion({
			accountId: dm.id,
			campaignId: campaign.id,
			schemaVersion: 1,
			rules: {},
			idempotencyKey: crypto.randomUUID(),
		})).rulesVersion;
		await store.pActivateRulesVersion({
			accountId: dm.id,
			campaignId: campaign.id,
			rulesVersionId: rulesVersion.id,
			idempotencyKey: crypto.randomUUID(),
		});
	});

	afterAll(async () => {
		await pool?.end();
	});

	it("checks UUID-acquired and case-sensitive LoH resource identities with both reviewed feature UIDs", async () => {
		const variants = [
			{resourceId: crypto.randomUUID(), featureUid: "lay on hands|xphb"},
			{resourceId: "LayOnHands:CaseSensitive-Pool", featureUid: "lay on hands|xphb"},
			{resourceId: crypto.randomUUID(), featureUid: "lay on hands|paladin|xphb|1"},
			{resourceId: "Pool:LoH:CaseSensitive-A7", featureUid: "lay on hands|paladin|xphb|1"},
		];
		const operationIds = [];

		for (const [index, variant] of variants.entries()) {
			const sourceOwner = (await pCreateAccountWithSession(`Recovery Source ${index}`));
			const targetOwner = (await pCreateAccountWithSession(`Recovery Target ${index}`));
			await pJoinCampaign(sourceOwner.account);
			await pJoinCampaign(targetOwner.account);
			const sourceData = withLayOnHandsIdentity(variant);
			const source = await pCreateCharacter({
				owner: sourceOwner.account,
				name: `Recovery Source ${index}`,
				data: {
					...sourceData,
					name: `Recovery Source ${index}`,
					hp: {current: 20, max: 20, temp: 0},
					inventory: [],
				},
			});
			const target = await pCreateCharacter({
				owner: targetOwner.account,
				name: `Recovery Target ${index}`,
				data: {
					name: `Recovery Target ${index}`,
					abilities: {str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10},
					abilityBonuses: {str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0},
					hp: {current: 5, max: 20, temp: 0},
					classes: [],
					features: [],
					spellcasting: {spellsKnown: [], cantripsKnown: [], spellSlots: {}},
					inventory: [],
				},
			});
			const request = {
				commandId: crypto.randomUUID(),
				contractVersion: 1,
				sourceCharacterId: source.id,
				sourceEntity: {type: "ability", uid: "lay on hands|xphb", version: "xphb-2024-v1"},
				effectTemplateId: "ability.lay-on-hands.heal",
				choice: {amount: 11},
				rulesVersionId: rulesVersion.id,
				targetRef: target.targetRef,
			};
			const created = await store.pCreateStructuredAction({
				accountId: sourceOwner.account.id,
				sessionId: sourceOwner.session.id,
				campaignId: campaign.id,
				protocolVersion: "4",
				...request,
				idempotencyKey: {
					key: request.commandId,
					requestHash: crypto.createHash("sha256").update(JSON.stringify(request)).digest("hex"),
				},
			});
			operationIds.push(created.operation.operationId);
		}

		const persisted = await pool.query(`
			SELECT
				source_cost #>> '{components,0,resourceId}' AS resource_id,
				source_cost #>> '{components,0,featureRef,uid}' AS feature_uid
			FROM hub.semantic_operations
			WHERE id = ANY($1::uuid[])
			ORDER BY source_cost #>> '{components,0,featureRef,uid}', source_cost #>> '{components,0,resourceId}'
		`, [operationIds]);
		expect(persisted.rows).toHaveLength(4);
		expect(persisted.rows).toEqual(expect.arrayContaining(variants.map(({resourceId, featureUid}) => ({
			resource_id: resourceId,
			feature_uid: featureUid,
		}))));

		const compatible = await pGetRecoveryCompatibility(pool);
		expect(compatible).toMatchObject({
			target: "qualified-full-workflow-fallback",
			compatible: true,
			blockers: [],
			diagnostics: {unsupportedSingularOperationCount: 0},
		});

		const sourceCost = (await pool.query(
			`SELECT source_cost FROM hub.semantic_operations WHERE id = $1`,
			[operationIds[0]],
		)).rows[0].source_cost;
		const client = await pool.connect();
		try {
			await client.query("BEGIN");
			await client.query("SAVEPOINT unsupported_template");
			const unsupported = await client.query(`
				INSERT INTO hub.semantic_operations
				SELECT (jsonb_populate_record(
					NULL::hub.semantic_operations,
					to_jsonb(operation) || jsonb_build_object(
						'id', gen_random_uuid(),
						'template_registry_version', 'peer-effects-v2'
					)
				)).*
				FROM hub.semantic_operations operation
				WHERE operation.id = $1
				RETURNING id
			`, [operationIds[0]]);
			expect(unsupported.rowCount).toBe(1);
			const unsupportedResult = await pGetRecoveryCompatibility(client);
			expect(unsupportedResult).toMatchObject({
				compatible: false,
				blockers: ["UNSUPPORTED_SINGULAR_TEMPLATE_HISTORY"],
				diagnostics: {unsupportedSingularOperationCount: 1},
			});
			await client.query("ROLLBACK TO SAVEPOINT unsupported_template");
			await client.query("RELEASE SAVEPOINT unsupported_template");

			await client.query("SAVEPOINT malformed_cost");
			const malformedCost = structuredClone(sourceCost);
			malformedCost.components[0].resourceId = " Pool:malformed";
			const malformed = await client.query(`
				INSERT INTO hub.semantic_operations
				SELECT (jsonb_populate_record(
					NULL::hub.semantic_operations,
					to_jsonb(operation) || jsonb_build_object(
						'id', gen_random_uuid(),
						'source_cost', $2::jsonb
					)
				)).*
				FROM hub.semantic_operations operation
				WHERE operation.id = $1
				RETURNING id
			`, [operationIds[0], JSON.stringify(malformedCost)]);
			expect(malformed.rowCount).toBe(1);
			const malformedResult = await pGetRecoveryCompatibility(client);
			expect(malformedResult.compatible).toBe(false);
			expect(malformedResult.diagnostics.unsupportedSingularOperationCount).toBe(1);
			await client.query("ROLLBACK TO SAVEPOINT malformed_cost");
			await client.query("RELEASE SAVEPOINT malformed_cost");

			await client.query("SAVEPOINT incomplete_cost");
			const incompleteCost = structuredClone(sourceCost);
			delete incompleteCost.components[0].featureRef;
			const incomplete = await client.query(`
				INSERT INTO hub.semantic_operations
				SELECT (jsonb_populate_record(
					NULL::hub.semantic_operations,
					to_jsonb(operation) || jsonb_build_object(
						'id', gen_random_uuid(),
						'source_cost', $2::jsonb
					)
				)).*
				FROM hub.semantic_operations operation
				WHERE operation.id = $1
				RETURNING id
			`, [operationIds[0], JSON.stringify(incompleteCost)]);
			expect(incomplete.rowCount).toBe(1);
			const incompleteResult = await pGetRecoveryCompatibility(client);
			expect(incompleteResult.compatible).toBe(false);
			expect(incompleteResult.diagnostics.unsupportedSingularOperationCount).toBe(1);
			await client.query("ROLLBACK TO SAVEPOINT incomplete_cost");
			await client.query("RELEASE SAVEPOINT incomplete_cost");
			await client.query("ROLLBACK");
		} catch (error) {
			await client.query("ROLLBACK");
			throw error;
		} finally {
			client.release();
		}

		await expect(pGetRecoveryCompatibility({
			query: async () => { throw new Error("simulated database query failure"); },
		})).rejects.toThrow("simulated database query failure");

		const missingDatabaseName = crypto.randomUUID().replaceAll("-", "");
		const queryFailure = spawnSync(process.execPath, [checkerScript], {
			encoding: "utf8",
			timeout: 15_000,
			env: {
				...process.env,
				DATABASE_URL: getUnavailableDatabaseUrl(process.env.HUB_TEST_POSTGRES_URL, missingDatabaseName).toString(),
				HUB_DATABASE_SSL: "false",
			},
		});
		expect(queryFailure.status).not.toBe(0);
		expect(queryFailure.stdout).toBe("");
		expect(queryFailure.stderr).toContain("RECOVERY_COMPATIBILITY_QUERY_FAILED");
	});
});

describe("Campaign Hub recovery compatibility URL fixture", () => {
	it("changes only the database path when constructing an unavailable database URL", () => {
		const databaseUrl = "postgresql://hub_test:example%2Dfixture@example.invalid:5433/hub?sslmode=verify-full&application_name=recovery-test&options=-c%20role%3Dhub_test#fixture-fragment";
		const originalUrl = new URL(databaseUrl);
		const originalHref = originalUrl.href;

		const unavailableDatabaseUrl = getUnavailableDatabaseUrl(databaseUrl, "0123456789abcdef0123456789abcdef");

		expect(unavailableDatabaseUrl.href).toBe("postgresql://hub_test:example%2Dfixture@example.invalid:5433/hub_missing_0123456789abcdef0123456789abcdef?sslmode=verify-full&application_name=recovery-test&options=-c%20role%3Dhub_test#fixture-fragment");
		expect(unavailableDatabaseUrl.username).toBe(originalUrl.username);
		expect(unavailableDatabaseUrl.password).toBe(originalUrl.password);
		expect(unavailableDatabaseUrl.password).not.toBe("");
		expect(unavailableDatabaseUrl.host).toBe(originalUrl.host);
		expect(unavailableDatabaseUrl.port).toBe(originalUrl.port);
		expect(unavailableDatabaseUrl.search).toBe(originalUrl.search);
		expect(unavailableDatabaseUrl.hash).toBe(originalUrl.hash);
		expect(unavailableDatabaseUrl.hash).not.toBe("");
		expect(originalUrl.href).toBe(originalHref);
	});
});
