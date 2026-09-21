import crypto from "node:crypto";

import {MemoryHubStore} from "../../../server/src/memory-hub-store.js";
import {resolveSourceCost} from "../../../js/hub/hub-source-costs.js";
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

function createStore () {
	return new MemoryHubStore({
		semanticOperationRegistry: createSourceCostAdapterRegistry(),
		peerSourceCostsEnabled: true,
	});
}

function expectOnlyExpectedSourceCostApplied ({templateId, before, after}) {
	expect(after).toEqual(getExpectedSourceDataAfterCost({templateId, data: before}));
}

describe("Wave A2 source-cost adapter authority (MemoryHubStore)", () => {
	it("keeps resource identity and spend amounts server-owned", async () => {
		const ctx = await pCreateSourceCostAdapterScenario({store: createStore()});
		const beforeSource = await ctx.pGetSource();
		const beforeTarget = await ctx.pGetTarget();

		for (const choice of [
			{amount: 99},
			{resourceId: crypto.randomUUID()},
			{inventoryEntryId: crypto.randomUUID(), amount: 1},
		]) {
			await expect(ctx.pPropose({
				templateId: "test.wave-a2.multi-component",
				choice,
			})).rejects.toMatchObject({code: "SOURCE_OR_TARGET_UNAVAILABLE"});
		}

		expect(await ctx.pGetSource()).toEqual(beforeSource);
		expect(await ctx.pGetTarget()).toEqual(beforeTarget);

		const proposed = await ctx.pPropose({templateId: "test.wave-a2.multi-component"});
		expect(proposed.operation.sourceResult.sourceCost).toEqual(
			COST_CASES.find(it => it.templateId === "test.wave-a2.multi-component").sourceCost,
		);
	});

	it.each(ECMASCRIPT_TRIM_VECTORS)(
		"matches ECMAScript %s identity trimming for UUID and case-sensitive non-UUID ids",
		(_label, whitespace) => {
			const data = {
				inventory: [{
					id: `${whitespace}${RESOURCE_IDS.chargeEntry.toUpperCase()}${whitespace}`,
					item: {name: "Wand of Authority", source: "PHB", charges: 2, chargesCurrent: 2},
				}, {
					id: `${whitespace}${RESOURCE_IDS.caseItem}${whitespace}`,
					item: {name: "Case Authority Focus", source: "PHB", charges: 2, chargesCurrent: 2},
				}, {
					id: `${whitespace}${RESOURCE_IDS.caseItemSibling}${whitespace}`,
					item: {name: "Case Authority Focus", source: "PHB", charges: 2, chargesCurrent: 1},
				}],
			};
			const resolveItem = inventoryEntryId => resolveSourceCost({
				data,
				sourceCost: {
					version: 1,
					components: [{
						kind: "item_charge",
						inventoryEntryId,
						itemRef: {
							uid: inventoryEntryId === RESOURCE_IDS.chargeEntry
								? "wand of authority|phb"
								: "case authority focus|phb",
						},
						amount: 1,
					}],
				},
			}).components[0].current;

			expect(resolveItem(RESOURCE_IDS.chargeEntry)).toBe(2);
			expect(resolveItem(RESOURCE_IDS.caseItem)).toBe(2);
			expect(resolveItem(RESOURCE_IDS.caseItemSibling)).toBe(1);
		},
	);

	it.each(COST_CASES)(
		"proposes without mutation and atomically accepts a fixed $label",
		async ({templateId, sourceCost}) => {
			const store = createStore();
			const ctx = await pCreateSourceCostAdapterScenario({store});
			const sourceBefore = await ctx.pGetSource();
			const targetBefore = await ctx.pGetTarget();
			const eventCountBefore = store.getDomainEvents().length;

			const proposed = await ctx.pPropose({templateId});
			expect(proposed.operation).toMatchObject({
				status: "proposed",
				sourceCostState: "pending",
				sourceResult: {sourceCharacterId: ctx.source.id, sourceCost},
			});
			expect(await ctx.pGetSource()).toEqual(sourceBefore);
			expect(await ctx.pGetTarget()).toEqual(targetBefore);

			const resolved = await ctx.pResolve({operationId: proposed.operation.operationId});
			expect(resolved.operation).toMatchObject({
				status: "applied",
				sourceCostState: "consumed",
				resultingTargetCharacterRevision: targetBefore.revision + 1,
			});
			const sourceAfter = await ctx.pGetSource();
			const targetAfter = await ctx.pGetTarget();
			expectOnlyExpectedSourceCostApplied({
				templateId,
				before: sourceBefore.data,
				after: sourceAfter.data,
			});
			expect(targetAfter.data).toEqual({
				...targetBefore.data,
				hp: {...targetBefore.data.hp, current: targetBefore.data.hp.current + 1},
			});
			expect(sourceAfter.revision).toBe(sourceBefore.revision + 1);
			expect(targetAfter.revision).toBe(targetBefore.revision + 1);

			const events = store.getDomainEvents().slice(eventCountBefore);
			const targetEvent = events.find(event =>
				event.type === "character.operation.applied"
				&& event.payload.leg === "target",
			);
			expect(targetEvent).toBeDefined();
			expect(targetEvent.payload).toEqual({
				leg: "target",
				operation: expect.objectContaining({kind: "hp.heal", arguments: {amount: 1}}),
				resultingCharacterRevision: targetAfter.revision,
			});
			const serializedTargetEvent = JSON.stringify(targetEvent.payload);
			expect(serializedTargetEvent).not.toContain("sourceCost");
			expect(serializedTargetEvent).not.toContain("sourceCharacterId");
			expect(serializedTargetEvent).not.toContain(RESOURCE_IDS.chargeEntry);
			expect(serializedTargetEvent).not.toContain(RESOURCE_IDS.quantityEntry);
			expect(serializedTargetEvent).not.toContain(RESOURCE_IDS.featureResource);
		},
	);

	it.each([
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
		const store = createStore();
		const ctx = await pCreateSourceCostAdapterScenario({store, sourceData});
		const proposed = await ctx.pPropose({templateId});
		const targetBefore = await ctx.pGetTarget();
		await ctx.pPatchSource({patches});

		expect(store._semanticOperations.get(proposed.operation.operationId).sourceCostInvalidated).toBe(true);
		const resolved = await ctx.pResolve({operationId: proposed.operation.operationId});
		expect(resolved.operation.status).toBe("failed");
		expect(await ctx.pGetTarget()).toEqual(targetBefore);
	});

	it.each([
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
		const store = createStore();
		const ctx = await pCreateSourceCostAdapterScenario({store});
		const proposed = await ctx.pPropose({templateId});
		const patched = await ctx.pPatchSource({patches});

		expect(store._semanticOperations.get(proposed.operation.operationId).sourceCostInvalidated).toBe(false);
		const resolved = await ctx.pResolve({operationId: proposed.operation.operationId});
		expect(resolved.operation.status).toBe("applied");
		expect((await ctx.pGetSource()).data).toEqual(getExpectedSourceDataAfterCost({
			templateId,
			data: patched.character.data,
		}));
	});

	it("preserves item and feature metadata while updating every canonical mirror", async () => {
		const ctx = await pCreateSourceCostAdapterScenario({store: createStore()});
		const sourceBefore = await ctx.pGetSource();
		const proposed = await ctx.pPropose({templateId: "test.wave-a2.multi-component"});
		await ctx.pResolve({operationId: proposed.operation.operationId});
		const sourceAfter = await ctx.pGetSource();

		expect(sourceAfter.data.inventory[0]).toEqual({
			...sourceBefore.data.inventory[0],
			item: {...sourceBefore.data.inventory[0].item, chargesCurrent: 2},
		});
		expect(sourceAfter.data.inventory[1]).toEqual({
			...sourceBefore.data.inventory[1],
			quantity: 2,
		});
		expect(sourceAfter.data.resources[0]).toEqual({
			...sourceBefore.data.resources[0],
			current: 2,
		});
		expect(sourceAfter.data.features[1]).toEqual({
			...sourceBefore.data.features[1],
			uses: {...sourceBefore.data.features[1].uses, current: 2},
		});
		expect(sourceAfter.data.spellcasting.innateSpells[0]).toEqual({
			...sourceBefore.data.spellcasting.innateSpells[0],
			uses: {...sourceBefore.data.spellcasting.innateSpells[0].uses, current: 2},
		});
	});

	it.each([
		{
			label: "featureId",
			mutate: data => data.resources[0].featureId = "dangling-feature-id",
		},
		{
			label: "linkedInnateSpellId",
			mutate: data => data.resources[0].linkedInnateSpellId = "dangling-innate-id",
		},
	])("rejects dangling explicit $label despite a reverse-linked mirror", async ({mutate}) => {
		const sourceData = getSourceCharacterData();
		mutate(sourceData);
		const ctx = await pCreateSourceCostAdapterScenario({store: createStore(), sourceData});
		const sourceBefore = await ctx.pGetSource();
		const targetBefore = await ctx.pGetTarget();

		await expect(ctx.pPropose({templateId: "test.wave-a2.feature-use"}))
			.rejects.toMatchObject({code: "SOURCE_COST_UNAVAILABLE"});
		expect(await ctx.pGetSource()).toEqual(sourceBefore);
		expect(await ctx.pGetTarget()).toEqual(targetBefore);
	});

	it("uses unique reverse feature and innate links when explicit forward links are absent", async () => {
		const sourceData = getSourceCharacterData();
		delete sourceData.resources[0].featureId;
		delete sourceData.resources[0].linkedInnateSpellId;
		const ctx = await pCreateSourceCostAdapterScenario({store: createStore(), sourceData});
		const sourceBefore = await ctx.pGetSource();
		const proposed = await ctx.pPropose({templateId: "test.wave-a2.feature-use"});
		const resolved = await ctx.pResolve({operationId: proposed.operation.operationId});

		expect(resolved.operation.status).toBe("applied");
		expect((await ctx.pGetSource()).data).toEqual(getExpectedSourceDataAfterCost({
			templateId: "test.wave-a2.feature-use",
			data: sourceBefore.data,
		}));
	});

	it("leaves both legs untouched when the target effect cannot apply", async () => {
		const store = createStore();
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

	it.each([
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
		const store = createStore();
		const ctx = await pCreateSourceCostAdapterScenario({store});
		const proposed = await ctx.pPropose({templateId});
		const sourceBefore = await ctx.pGetSource();
		const targetBefore = await ctx.pGetTarget();

		await ctx.pPatchSource({
			patches: [{op: "replace", path, value: getDuplicate(sourceBefore.data)}],
		});
		expect(store._semanticOperations.get(proposed.operation.operationId).sourceCostInvalidated).toBe(true);
		await ctx.pPatchSource({
			patches: [{op: "replace", path, value: getOriginal(sourceBefore.data)}],
		});
		expect(store._semanticOperations.get(proposed.operation.operationId).sourceCostInvalidated).toBe(true);

		const resolved = await ctx.pResolve({operationId: proposed.operation.operationId});
		expect(resolved.operation).toMatchObject({
			status: "failed",
			sourceCostState: "not_consumed",
			failureCode: "unavailable",
		});
		expect((await ctx.pGetSource()).data[path.slice(1)]).toEqual(getOriginal(sourceBefore.data));
		expect(await ctx.pGetTarget()).toEqual(targetBefore);
	});

	it.each([
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
		const store = createStore();
		const ctx = await pCreateSourceCostAdapterScenario({store});
		const proposed = await ctx.pPropose({templateId});
		const targetBefore = await ctx.pGetTarget();
		const revisionBefore = (await ctx.pGetSource()).revision;

		const spent = await ctx.pPatchSource({patches: spend});
		expect(spent.character.revision).toBe(revisionBefore + 1);
		expect(store._semanticOperations.get(proposed.operation.operationId).sourceCostInvalidated).toBe(true);
		const restored = await ctx.pPatchSource({patches: restore});
		expect(restored.character.revision).toBe(revisionBefore + 2);
		expect(store._semanticOperations.get(proposed.operation.operationId).sourceCostInvalidated).toBe(true);

		const resolved = await ctx.pResolve({operationId: proposed.operation.operationId});
		expect(resolved.operation).toMatchObject({
			status: "failed",
			sourceCostState: "not_consumed",
			failureCode: "unavailable",
		});
		expect(await ctx.pGetTarget()).toEqual(targetBefore);
	});

	it.each([
		{
			label: "ambiguous item identity",
			templateId: "test.wave-a2.item-charge",
			tamper: data => data.inventory.push(structuredClone(data.inventory[0])),
		},
		{
			label: "drifted feature mirror",
			templateId: "test.wave-a2.feature-use",
			tamper: data => data.features[1].uses.current--,
		},
		{
			label: "equipped whole-stack blocker",
			templateId: "test.wave-a2.inventory-quantity",
			tamper: data => {
				data.inventory[1].quantity = 2;
				data.inventory[1].equipped = true;
			},
		},
		{
			label: "nested container, Ioun, and item-link blockers",
			templateId: "test.wave-a2.inventory-quantity",
			tamper: data => {
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
	])("fails acceptance atomically for $label", async ({templateId, tamper}) => {
		const store = createStore();
		const ctx = await pCreateSourceCostAdapterScenario({store});
		const proposed = await ctx.pPropose({templateId});
		const storedSource = store._characters.get(ctx.source.id);
		tamper(storedSource.data);
		const tamperedSource = structuredClone(await ctx.pGetSource());
		const targetBefore = await ctx.pGetTarget();

		const resolved = await ctx.pResolve({operationId: proposed.operation.operationId});
		expect(resolved.operation).toMatchObject({
			status: "failed",
			sourceCostState: "not_consumed",
			failureCode: "unavailable",
		});
		expect(await ctx.pGetSource()).toEqual(tamperedSource);
		expect(await ctx.pGetTarget()).toEqual(targetBefore);
	});

	it.each(ZERO_QUANTITY_BLOCKER_CASES)(
		"fails padded-UUID full-stack quantity zeroing atomically when $label",
		async ({mutate}) => {
			const sourceData = getSourceCharacterData();
			sourceData.inventory[1].id = ` ${RESOURCE_IDS.quantityEntry.toUpperCase()} `;
			const store = createStore();
			const ctx = await pCreateSourceCostAdapterScenario({store, sourceData});
			const proposed = await ctx.pPropose({templateId: "test.wave-a2.inventory-quantity"});
			const storedSource = store._characters.get(ctx.source.id);
			storedSource.data.inventory[1].quantity = 2;
			mutate(storedSource.data);
			const tamperedSource = structuredClone(await ctx.pGetSource());
			const targetBefore = await ctx.pGetTarget();

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

	it("allows full-stack removal with benign unknown wrapper defaults", async () => {
		const sourceData = getSourceCharacterData();
		sourceData.inventory[1].quantity = 2;
		for (const {field, benign} of UNKNOWN_WRAPPER_FIELD_CASES) {
			sourceData.inventory[1][field] = structuredClone(benign);
		}
		const ctx = await pCreateSourceCostAdapterScenario({store: createStore(), sourceData});
		const proposed = await ctx.pPropose({templateId: "test.wave-a2.inventory-quantity"});
		const resolved = await ctx.pResolve({operationId: proposed.operation.operationId});

		expect(resolved.operation.status).toBe("applied");
		expect((await ctx.pGetSource()).data.inventory.some(entry =>
			entry.id.trim().toLowerCase() === RESOURCE_IDS.quantityEntry,
		)).toBe(false);
	});

	it.each([
		{label: "raw non-UUID object key", key: RESOURCE_IDS.caseItem},
		{label: "item-prefixed non-UUID object key", key: `item:${RESOURCE_IDS.caseItem}`},
	])("fails case-sensitive full-stack removal atomically for $label", async ({key}) => {
		const store = createStore();
		const ctx = await pCreateSourceCostAdapterScenario({store});
		const proposed = await ctx.pPropose({templateId: "test.wave-a2.case-item-quantity"});
		const storedSource = store._characters.get(ctx.source.id);
		storedSource.data.customLinks = {[key]: true};
		const tamperedSource = structuredClone(await ctx.pGetSource());
		const targetBefore = await ctx.pGetTarget();

		const resolved = await ctx.pResolve({operationId: proposed.operation.operationId});
		expect(resolved.operation).toMatchObject({
			status: "failed",
			sourceCostState: "not_consumed",
			failureCode: "unavailable",
		});
		expect(await ctx.pGetSource()).toEqual(tamperedSource);
		expect(await ctx.pGetTarget()).toEqual(targetBefore);
	});

	it("does not treat an unrelated or differently cased object key as a case-sensitive item reference", async () => {
		const sourceData = getSourceCharacterData();
		sourceData.customLinks = {
			[RESOURCE_IDS.caseItemSibling]: true,
			"unrelated-key": true,
		};
		const ctx = await pCreateSourceCostAdapterScenario({store: createStore(), sourceData});
		const proposed = await ctx.pPropose({templateId: "test.wave-a2.case-item-quantity"});
		const resolved = await ctx.pResolve({operationId: proposed.operation.operationId});

		expect(resolved.operation.status).toBe("applied");
		expect((await ctx.pGetSource()).data.inventory.some(entry => entry.id === RESOURCE_IDS.caseItem)).toBe(false);
		expect((await ctx.pGetSource()).data.inventory.some(entry => entry.id === RESOURCE_IDS.caseItemSibling)).toBe(true);
	});

	it.each(UNKNOWN_WRAPPER_FIELD_CASES)(
		"fails full-stack removal atomically for non-default $label wrapper metadata",
		async ({field, unsafe}) => {
			const store = createStore();
			const ctx = await pCreateSourceCostAdapterScenario({store});
			const proposed = await ctx.pPropose({templateId: "test.wave-a2.inventory-quantity"});
			const storedSource = store._characters.get(ctx.source.id);
			storedSource.data.inventory[1].quantity = 2;
			storedSource.data.inventory[1][field] = structuredClone(unsafe);
			const tamperedSource = structuredClone(await ctx.pGetSource());
			const targetBefore = await ctx.pGetTarget();

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

	it("serializes competing finalizations against one final resource", async () => {
		const ctx = await pCreateSourceCostAdapterScenario({
			store: createStore(),
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

	it("replays exact acceptance once and rejects a changed body under the same key", async () => {
		const store = createStore();
		const ctx = await pCreateSourceCostAdapterScenario({store});
		const proposed = await ctx.pPropose({templateId: "test.wave-a2.item-charge"});
		const commandId = crypto.randomUUID();
		const first = await ctx.pResolve({
			operationId: proposed.operation.operationId,
			commandId,
		});
		const sourceAfterFirst = await ctx.pGetSource();
		const eventsAfterFirst = store.getDomainEvents();
		const replay = await ctx.pResolve({
			operationId: proposed.operation.operationId,
			commandId,
		});

		expect(replay).toEqual(first);
		expect(await ctx.pGetSource()).toEqual(sourceAfterFirst);
		expect(store.getDomainEvents()).toEqual(eventsAfterFirst);
		await expect(ctx.pResolve({
			operationId: proposed.operation.operationId,
			commandId,
			requestExtra: {changed: true},
		})).rejects.toMatchObject({code: "IDEMPOTENCY_KEY_REUSED"});
		expect((await ctx.pGetSource()).data.inventory[0].item.chargesCurrent).toBe(2);
	});

	it("combines source-as-target cost and effect into one revision and mutation event", async () => {
		const store = createStore();
		const ctx = await pCreateSourceCostAdapterScenario({
			store,
			sameCharacter: true,
			sourceData: getSourceCharacterData({hpCurrent: 5}),
		});
		const before = await ctx.pGetSource();
		const proposed = await ctx.pPropose({templateId: "test.wave-a2.multi-component"});
		const eventStart = store.getDomainEvents().length;
		const resolved = await ctx.pResolve({operationId: proposed.operation.operationId});
		const after = await ctx.pGetSource();
		const mutationEvents = store.getDomainEvents().slice(eventStart).filter(event =>
			event.type === "character.operation.applied"
			&& event.aggregateId === ctx.source.id,
		);

		expect(resolved.operation).toMatchObject({
			status: "applied",
			leg: "combined",
			sourceResult: {leg: "combined"},
		});
		expect(after.revision).toBe(before.revision + 1);
		expect(after.data.hp.current).toBe(before.data.hp.current + 1);
		expectOnlyExpectedSourceCostApplied({
			templateId: "test.wave-a2.multi-component",
			before: {...before.data, hp: after.data.hp},
			after: after.data,
		});
		expect(mutationEvents).toHaveLength(1);
		expect(mutationEvents[0].payload.leg).toBe("combined");
		expect(resolved.eventIds.filter(id => id === mutationEvents[0].id)).toHaveLength(1);
		expect(store._semanticOperations.get(proposed.operation.operationId).sourceCostEventId).toBeNull();
	});
});
