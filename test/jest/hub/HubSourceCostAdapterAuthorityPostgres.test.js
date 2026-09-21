import crypto from "node:crypto";
import pg from "pg";

import {PostgresHubStore} from "../../../server/src/postgres-hub-store.js";
import {
	COST_CASES,
	createSourceCostAdapterRegistry,
	ECMASCRIPT_TRIM_VECTORS,
	getExpectedSourceDataAfterCost,
	getSourceCharacterData,
	getTargetCharacterData,
	pCreateSourceCostAdapterScenario,
	RESOURCE_IDS,
	UNKNOWN_WRAPPER_FIELD_CASES,
	ZERO_QUANTITY_BLOCKER_CASES,
} from "./HubSourceCostAdapterAuthority.fixture.js";

const {Pool} = pg;
const describePostgres = process.env.HUB_TEST_POSTGRES_URL ? describe : describe.skip;

describePostgres("Wave A2 source-cost adapter authority (PostgreSQL)", () => {
	let pool;
	let store;

	beforeAll(async () => {
		pool = new Pool({
			connectionString: process.env.HUB_TEST_POSTGRES_URL,
			ssl: false,
			max: 8,
		});
		store = new PostgresHubStore({
			pool,
			semanticOperationRegistry: createSourceCostAdapterRegistry(),
			peerSourceCostsEnabled: true,
		});
		await store.pCheckHealth();
	});

	afterAll(async () => {
		await pool?.end();
	});

	async function pGetSourceCostInvalidated (operationId) {
		const result = await pool.query(`
			SELECT source_cost_invalidated
			FROM hub.semantic_operations
			WHERE id = $1
		`, [operationId]);
		return result.rows[0]?.source_cost_invalidated === true;
	}

	async function pGetFeatureBinding (data) {
		const result = await pool.query(`
			SELECT hub.peer_source_cost_binding_value($1::jsonb, $2::jsonb) AS binding
		`, [
			data,
			{kind: "feature_use", resourceId: RESOURCE_IDS.featureResource},
		]);
		return result.rows[0].binding;
	}

	async function pTamperSourceAfterProposal ({ctx, operationId, mutate}) {
		const data = (await ctx.pGetSource()).data;
		mutate(data);
		await pool.query(`UPDATE hub.characters SET data = $2::jsonb WHERE id = $1`, [
			ctx.source.id,
			JSON.stringify(data),
		]);
		await pool.query(`
			UPDATE hub.semantic_operations
			SET source_cost_invalidated = false
			WHERE id = $1
		`, [operationId]);
		return ctx.pGetSource();
	}

	test.each(ECMASCRIPT_TRIM_VECTORS)(
		"matches ECMAScript %s identity trimming for UUID and case-sensitive non-UUID ids",
		async (_label, whitespace) => {
			const uuidId = `${whitespace}${RESOURCE_IDS.chargeEntry.toUpperCase()}${whitespace}`;
			const caseId = `${whitespace}${RESOURCE_IDS.caseItem}${whitespace}`;
			const siblingId = `${whitespace}${RESOURCE_IDS.caseItemSibling}${whitespace}`;
			const data = {
				inventory: [
					{id: caseId, item: {name: "Case Authority Focus", source: "PHB"}},
					{id: siblingId, item: {name: "Case Authority Focus", source: "PHB"}},
				],
			};
			const result = await pool.query(`
				SELECT
					hub.normalize_peer_source_cost_resource_id($1) AS uuid_id,
					hub.normalize_peer_source_cost_resource_id($2) AS case_id,
					hub.normalize_peer_source_cost_resource_id($3) AS sibling_id,
					hub.peer_source_cost_binding_value($4::jsonb, $5::jsonb) AS binding
			`, [
				uuidId,
				caseId,
				siblingId,
				data,
				{kind: "item_charge", inventoryEntryId: RESOURCE_IDS.caseItem},
			]);

			expect(result.rows[0]).toEqual({
				uuid_id: RESOURCE_IDS.chargeEntry,
				case_id: RESOURCE_IDS.caseItem,
				sibling_id: RESOURCE_IDS.caseItemSibling,
				binding: {matches: [data.inventory[0]]},
			});
		},
	);

	test.each(COST_CASES)(
		"matches the fixed $label acceptance transaction",
		async ({templateId, sourceCost}) => {
			const ctx = await pCreateSourceCostAdapterScenario({store});
			const sourceBefore = await ctx.pGetSource();
			const targetBefore = await ctx.pGetTarget();
			const proposed = await ctx.pPropose({templateId});

			expect(proposed.operation).toMatchObject({
				status: "proposed",
				sourceResult: {sourceCost},
			});
			expect(await ctx.pGetSource()).toEqual(sourceBefore);
			expect(await ctx.pGetTarget()).toEqual(targetBefore);

			const resolved = await ctx.pResolve({operationId: proposed.operation.operationId});
			const sourceAfter = await ctx.pGetSource();
			const targetAfter = await ctx.pGetTarget();
			expect(resolved.operation).toMatchObject({status: "applied", sourceCostState: "consumed"});
			expect(sourceAfter.data).toEqual(getExpectedSourceDataAfterCost({
				templateId,
				data: sourceBefore.data,
			}));
			expect(targetAfter.data).toEqual({
				...targetBefore.data,
				hp: {...targetBefore.data.hp, current: targetBefore.data.hp.current + 1},
			});
			expect(sourceAfter.revision).toBe(sourceBefore.revision + 1);
			expect(targetAfter.revision).toBe(targetBefore.revision + 1);
		},
	);

	test.each([
		{
			label: "item",
			templateId: "test.wave-a2.item-charge",
			patches: [{op: "replace", path: "/inventory/0/item/chargesCurrent", value: 3}],
		},
		{
			label: "quantity",
			templateId: "test.wave-a2.inventory-quantity",
			patches: [{op: "replace", path: "/inventory/1/quantity", value: 3}],
		},
		{
			label: "feature",
			templateId: "test.wave-a2.feature-use",
			patches: [
				{op: "replace", path: "/resources/0/current", value: 2},
				{op: "replace", path: "/features/1/uses/current", value: 2},
				{op: "replace", path: "/spellcasting/innateSpells/0/uses/current", value: 2},
			],
		},
	])("matches whitespace-padded stored UUID $label identities", async ({templateId, patches}) => {
		const sourceData = getSourceCharacterData();
		sourceData.inventory[0].id = `  ${RESOURCE_IDS.chargeEntry.toUpperCase()}  `;
		sourceData.inventory[1].id = `  ${RESOURCE_IDS.quantityEntry.toUpperCase()}  `;
		sourceData.resources[0].id = ` ${RESOURCE_IDS.featureResource.toUpperCase()} `;
		const ctx = await pCreateSourceCostAdapterScenario({store, sourceData});
		const proposed = await ctx.pPropose({templateId});
		const targetBefore = await ctx.pGetTarget();
		await ctx.pPatchSource({patches});

		expect(await pGetSourceCostInvalidated(proposed.operation.operationId)).toBe(true);
		const resolved = await ctx.pResolve({operationId: proposed.operation.operationId});
		expect(resolved.operation.status).toBe("failed");
		expect(await ctx.pGetTarget()).toEqual(targetBefore);
	});

	test.each([
		{
			label: "item",
			templateId: "test.wave-a2.case-item-charge",
			patches: [{op: "replace", path: "/inventory/3/item/chargesCurrent", value: 1}],
		},
		{
			label: "feature resource",
			templateId: "test.wave-a2.case-feature-use",
			patches: [
				{op: "replace", path: "/resources/2/current", value: 1},
				{op: "replace", path: "/features/3/uses/current", value: 1},
				{op: "replace", path: "/spellcasting/innateSpells/2/uses/current", value: 1},
			],
		},
	])("preserves case for non-UUID $label identities", async ({templateId, patches}) => {
		const ctx = await pCreateSourceCostAdapterScenario({store});
		const proposed = await ctx.pPropose({templateId});
		const patched = await ctx.pPatchSource({patches});

		expect(await pGetSourceCostInvalidated(proposed.operation.operationId)).toBe(false);
		const resolved = await ctx.pResolve({operationId: proposed.operation.operationId});
		expect(resolved.operation.status).toBe("applied");
		expect((await ctx.pGetSource()).data).toEqual(getExpectedSourceDataAfterCost({
			templateId,
			data: patched.character.data,
		}));
	});

	test("rolls back both legs when the target effect fails", async () => {
		const ctx = await pCreateSourceCostAdapterScenario({
			store,
			targetData: getTargetCharacterData({hpCurrent: 20}),
		});
		const sourceBefore = await ctx.pGetSource();
		const targetBefore = await ctx.pGetTarget();
		const proposed = await ctx.pPropose({templateId: "test.wave-a2.multi-component"});
		const resolved = await ctx.pResolve({operationId: proposed.operation.operationId});

		expect(resolved.operation).toMatchObject({
			status: "failed",
			sourceCostState: "not_consumed",
			failureCode: "TARGET_EFFECT_UNAVAILABLE",
		});
		expect(await ctx.pGetSource()).toEqual(sourceBefore);
		expect(await ctx.pGetTarget()).toEqual(targetBefore);
	});

	test.each([
		{
			label: "featureId",
			mutate: data => data.resources[0].featureId = "dangling-feature-id",
			expectedBinding: {features: 0, innateSpells: 1},
		},
		{
			label: "linkedInnateSpellId",
			mutate: data => data.resources[0].linkedInnateSpellId = "dangling-innate-id",
			expectedBinding: {features: 1, innateSpells: 0},
		},
	])("rejects dangling explicit $label despite a reverse-linked mirror", async ({
		mutate,
		expectedBinding,
	}) => {
		const sourceData = getSourceCharacterData();
		mutate(sourceData);
		const binding = await pGetFeatureBinding(sourceData);
		expect(binding.resources).toHaveLength(1);
		expect(binding.features).toHaveLength(expectedBinding.features);
		expect(binding.innateSpells).toHaveLength(expectedBinding.innateSpells);

		const ctx = await pCreateSourceCostAdapterScenario({store, sourceData});
		const sourceBefore = await ctx.pGetSource();
		const targetBefore = await ctx.pGetTarget();
		await expect(ctx.pPropose({templateId: "test.wave-a2.feature-use"}))
			.rejects.toMatchObject({code: "SOURCE_COST_UNAVAILABLE"});
		expect(await ctx.pGetSource()).toEqual(sourceBefore);
		expect(await ctx.pGetTarget()).toEqual(targetBefore);
	});

	test("uses unique reverse feature and innate links when explicit forward links are absent", async () => {
		const sourceData = getSourceCharacterData();
		delete sourceData.resources[0].featureId;
		delete sourceData.resources[0].linkedInnateSpellId;
		const binding = await pGetFeatureBinding(sourceData);
		expect(binding.resources).toHaveLength(1);
		expect(binding.features).toHaveLength(1);
		expect(binding.innateSpells).toHaveLength(1);

		const ctx = await pCreateSourceCostAdapterScenario({store, sourceData});
		const sourceBefore = await ctx.pGetSource();
		const proposed = await ctx.pPropose({templateId: "test.wave-a2.feature-use"});
		const resolved = await ctx.pResolve({operationId: proposed.operation.operationId});

		expect(resolved.operation.status).toBe("applied");
		expect((await ctx.pGetSource()).data).toEqual(getExpectedSourceDataAfterCost({
			templateId: "test.wave-a2.feature-use",
			data: sourceBefore.data,
		}));
	});

	test.each([
		{
			label: "item",
			templateId: "test.wave-a2.item-charge",
			path: "/inventory",
			getDuplicate: data => [...data.inventory, structuredClone(data.inventory[0])],
			getOriginal: data => data.inventory,
		},
		{
			label: "resource",
			templateId: "test.wave-a2.feature-use",
			path: "/resources",
			getDuplicate: data => [...data.resources, structuredClone(data.resources[0])],
			getOriginal: data => data.resources,
		},
	])("permanently invalidates when a duplicate matching $label appears and disappears", async ({
		templateId,
		path,
		getDuplicate,
		getOriginal,
	}) => {
		const ctx = await pCreateSourceCostAdapterScenario({store});
		const proposed = await ctx.pPropose({templateId});
		const sourceBefore = await ctx.pGetSource();
		const targetBefore = await ctx.pGetTarget();

		await ctx.pPatchSource({
			patches: [{op: "replace", path, value: getDuplicate(sourceBefore.data)}],
		});
		expect(await pGetSourceCostInvalidated(proposed.operation.operationId)).toBe(true);
		await ctx.pPatchSource({
			patches: [{op: "replace", path, value: getOriginal(sourceBefore.data)}],
		});
		expect(await pGetSourceCostInvalidated(proposed.operation.operationId)).toBe(true);

		const resolved = await ctx.pResolve({operationId: proposed.operation.operationId});
		expect(resolved.operation).toMatchObject({
			status: "failed",
			sourceCostState: "not_consumed",
			failureCode: "unavailable",
		});
		expect((await ctx.pGetSource()).data[path.slice(1)]).toEqual(getOriginal(sourceBefore.data));
		expect(await ctx.pGetTarget()).toEqual(targetBefore);
	});

	test.each([
		{
			label: "item charge",
			templateId: "test.wave-a2.item-charge",
			spend: [{op: "replace", path: "/inventory/0/item/chargesCurrent", value: 2}],
			restore: [{op: "replace", path: "/inventory/0/item/chargesCurrent", value: 4}],
		},
		{
			label: "inventory quantity",
			templateId: "test.wave-a2.inventory-quantity",
			spend: [{op: "replace", path: "/inventory/1/quantity", value: 2}],
			restore: [{op: "replace", path: "/inventory/1/quantity", value: 4}],
		},
		{
			label: "feature use",
			templateId: "test.wave-a2.feature-use",
			spend: [
				{op: "replace", path: "/resources/0/current", value: 2},
				{op: "replace", path: "/features/1/uses/current", value: 2},
				{op: "replace", path: "/spellcasting/innateSpells/0/uses/current", value: 2},
			],
			restore: [
				{op: "replace", path: "/resources/0/current", value: 3},
				{op: "replace", path: "/features/1/uses/current", value: 3},
				{op: "replace", path: "/spellcasting/innateSpells/0/uses/current", value: 3},
			],
		},
	])("permanently invalidates consent after committed $label spend and restore", async ({
		templateId,
		spend,
		restore,
	}) => {
		const ctx = await pCreateSourceCostAdapterScenario({store});
		const proposed = await ctx.pPropose({templateId});
		const targetBefore = await ctx.pGetTarget();
		const revisionBefore = (await ctx.pGetSource()).revision;

		const spent = await ctx.pPatchSource({patches: spend});
		expect(spent.character.revision).toBe(revisionBefore + 1);
		expect(await pGetSourceCostInvalidated(proposed.operation.operationId)).toBe(true);
		const restored = await ctx.pPatchSource({patches: restore});
		expect(restored.character.revision).toBe(revisionBefore + 2);
		expect(await pGetSourceCostInvalidated(proposed.operation.operationId)).toBe(true);

		const resolved = await ctx.pResolve({operationId: proposed.operation.operationId});
		expect(resolved.operation).toMatchObject({
			status: "failed",
			sourceCostState: "not_consumed",
			failureCode: "unavailable",
		});
		expect(await ctx.pGetTarget()).toEqual(targetBefore);
	});

	test.each([
		{
			label: "ambiguous item identity",
			templateId: "test.wave-a2.item-charge",
			mutate: data => data.inventory.push(structuredClone(data.inventory[0])),
		},
		{
			label: "drifted feature mirror",
			templateId: "test.wave-a2.feature-use",
			mutate: data => data.features[1].uses.current--,
		},
		{
			label: "equipped whole-stack blocker",
			templateId: "test.wave-a2.inventory-quantity",
			mutate: data => {
				data.inventory[1].quantity = 2;
				data.inventory[1].equipped = true;
			},
		},
		{
			label: "nested container, Ioun, and item-link blockers",
			templateId: "test.wave-a2.inventory-quantity",
			mutate: data => {
				data.inventory[1].quantity = 2;
				data.inventory[0].item.containedItems = [RESOURCE_IDS.quantityEntry];
				data.inventory[0].item.iounSet = [RESOURCE_IDS.quantityEntry];
				data.itemGrantedSpells = [{
					name: "Linked Test Spell",
					source: "PHB",
					itemId: RESOURCE_IDS.quantityEntry,
				}];
			},
		},
	])("fails acceptance atomically for $label", async ({templateId, mutate}) => {
		const ctx = await pCreateSourceCostAdapterScenario({store});
		const proposed = await ctx.pPropose({templateId});
		const sourceData = (await ctx.pGetSource()).data;
		mutate(sourceData);
		await pool.query(`UPDATE hub.characters SET data = $2::jsonb WHERE id = $1`, [
			ctx.source.id,
			JSON.stringify(sourceData),
		]);
		await pool.query(`
			UPDATE hub.semantic_operations
			SET source_cost_invalidated = false
			WHERE id = $1
		`, [proposed.operation.operationId]);
		const sourceBefore = await ctx.pGetSource();
		const targetBefore = await ctx.pGetTarget();

		const resolved = await ctx.pResolve({operationId: proposed.operation.operationId});
		expect(resolved.operation).toMatchObject({
			status: "failed",
			sourceCostState: "not_consumed",
			failureCode: "unavailable",
		});
		expect(await ctx.pGetSource()).toEqual(sourceBefore);
		expect(await ctx.pGetTarget()).toEqual(targetBefore);
	});

	test.each(ZERO_QUANTITY_BLOCKER_CASES)(
		"fails padded-UUID full-stack quantity zeroing atomically when $label",
		async ({mutate}) => {
			const sourceData = getSourceCharacterData();
			sourceData.inventory[1].id = ` ${RESOURCE_IDS.quantityEntry.toUpperCase()} `;
			const ctx = await pCreateSourceCostAdapterScenario({store, sourceData});
			const proposed = await ctx.pPropose({templateId: "test.wave-a2.inventory-quantity"});
			const targetBefore = await ctx.pGetTarget();
			const tamperedSource = await pTamperSourceAfterProposal({
				ctx,
				operationId: proposed.operation.operationId,
				mutate: data => {
					data.inventory[1].quantity = 2;
					mutate(data);
				},
			});

			const resolved = await ctx.pResolve({operationId: proposed.operation.operationId});
			expect(resolved.operation).toMatchObject({
				status: "failed",
				sourceCostState: "not_consumed",
				failureCode: "unavailable",
			});
			expect(await ctx.pGetSource()).toEqual(tamperedSource);
			expect(await ctx.pGetTarget()).toEqual(targetBefore);
		},
	);

	test("allows full-stack removal with benign unknown wrapper defaults", async () => {
		const sourceData = getSourceCharacterData();
		sourceData.inventory[1].quantity = 2;
		for (const {field, benign} of UNKNOWN_WRAPPER_FIELD_CASES) {
			sourceData.inventory[1][field] = structuredClone(benign);
		}
		const ctx = await pCreateSourceCostAdapterScenario({store, sourceData});
		const proposed = await ctx.pPropose({templateId: "test.wave-a2.inventory-quantity"});
		const resolved = await ctx.pResolve({operationId: proposed.operation.operationId});

		expect(resolved.operation.status).toBe("applied");
		expect((await ctx.pGetSource()).data.inventory.some(entry =>
			entry.id.trim().toLowerCase() === RESOURCE_IDS.quantityEntry,
		)).toBe(false);
	});

	test.each(UNKNOWN_WRAPPER_FIELD_CASES)(
		"fails full-stack removal atomically for non-default $label wrapper metadata",
		async ({field, unsafe}) => {
			const ctx = await pCreateSourceCostAdapterScenario({store});
			const proposed = await ctx.pPropose({templateId: "test.wave-a2.inventory-quantity"});
			const targetBefore = await ctx.pGetTarget();
			const tamperedSource = await pTamperSourceAfterProposal({
				ctx,
				operationId: proposed.operation.operationId,
				mutate: data => {
					data.inventory[1].quantity = 2;
					data.inventory[1][field] = structuredClone(unsafe);
				},
			});

			const resolved = await ctx.pResolve({operationId: proposed.operation.operationId});
			expect(resolved.operation).toMatchObject({
				status: "failed",
				sourceCostState: "not_consumed",
				failureCode: "unavailable",
			});
			expect(await ctx.pGetSource()).toEqual(tamperedSource);
			expect(await ctx.pGetTarget()).toEqual(targetBefore);
		},
	);

	test("serializes competing finalizations against one final resource", async () => {
		const ctx = await pCreateSourceCostAdapterScenario({
			store,
			sourceData: getSourceCharacterData({standardSlots: 1}),
		});
		const [proposalA, proposalB] = await Promise.all([
			ctx.pPropose({templateId: "test.wave-a2.standard-slot"}),
			ctx.pPropose({templateId: "test.wave-a2.standard-slot"}),
		]);
		const [resultA, resultB] = await Promise.all([
			ctx.pResolve({operationId: proposalA.operation.operationId}),
			ctx.pResolve({operationId: proposalB.operation.operationId}),
		]);

		expect([resultA.operation.status, resultB.operation.status].sort()).toEqual(["applied", "failed"]);
		expect((await ctx.pGetSource()).data.spellcasting.spellSlots[2].current).toBe(0);
		expect((await ctx.pGetTarget()).data.hp.current).toBe(6);
	});

	test("replays once, rejects changed bodies, and conceals source details from the target event", async () => {
		const ctx = await pCreateSourceCostAdapterScenario({store});
		const proposed = await ctx.pPropose({templateId: "test.wave-a2.multi-component"});
		const commandId = crypto.randomUUID();
		const first = await ctx.pResolve({
			operationId: proposed.operation.operationId,
			commandId,
		});
		const sourceAfterFirst = await ctx.pGetSource();
		const replay = await ctx.pResolve({
			operationId: proposed.operation.operationId,
			commandId,
		});

		expect(replay).toEqual(JSON.parse(JSON.stringify(first)));
		expect(await ctx.pGetSource()).toEqual(sourceAfterFirst);
		await expect(ctx.pResolve({
			operationId: proposed.operation.operationId,
			commandId,
			requestExtra: {changed: true},
		})).rejects.toMatchObject({code: "IDEMPOTENCY_KEY_REUSED"});

		const targetEvent = (await pool.query(`
			SELECT payload
			FROM hub.domain_events
			WHERE event_type = 'character.operation.applied'
				AND payload->'operation'->>'operationId' = $1
				AND payload->>'leg' = 'target'
		`, [proposed.operation.operationId])).rows[0];
		expect(targetEvent).toBeDefined();
		const serializedPayload = JSON.stringify(targetEvent.payload);
		expect(serializedPayload).not.toContain("sourceCost");
		expect(serializedPayload).not.toContain("sourceCharacterId");
		expect(serializedPayload).not.toContain(RESOURCE_IDS.chargeEntry);
		expect(serializedPayload).not.toContain(RESOURCE_IDS.quantityEntry);
		expect(serializedPayload).not.toContain(RESOURCE_IDS.featureResource);
	});

	test("combines source-as-target into one revision and one applied event", async () => {
		const ctx = await pCreateSourceCostAdapterScenario({
			store,
			sameCharacter: true,
			sourceData: getSourceCharacterData({hpCurrent: 5}),
		});
		const before = await ctx.pGetSource();
		const proposed = await ctx.pPropose({templateId: "test.wave-a2.multi-component"});
		const resolved = await ctx.pResolve({operationId: proposed.operation.operationId});
		const after = await ctx.pGetSource();

		expect(resolved.operation).toMatchObject({
			status: "applied",
			leg: "combined",
			sourceResult: {leg: "combined"},
		});
		expect(after.revision).toBe(before.revision + 1);
		const persisted = await pool.query(`
			SELECT count(*)::integer AS applied_count,
				count(*) FILTER (WHERE payload->>'leg' = 'combined')::integer AS combined_count
			FROM hub.domain_events
			WHERE event_type = 'character.operation.applied'
				AND payload->'operation'->>'operationId' = $1
		`, [proposed.operation.operationId]);
		expect(persisted.rows[0]).toEqual({applied_count: 1, combined_count: 1});
	});
});
