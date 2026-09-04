import crypto from "node:crypto";

import {
	applySourceCost,
	getPeerSourceCostsCapability,
	getSourceCostMutationFootprint,
	hasSourceCostBindingChanged,
	normalizeSourceCost,
	resolveSourceCost,
	SOURCE_COST_KINDS,
} from "../../../js/hub/hub-source-costs.js";

describe("Hub shared source-cost contract", () => {
	it("advertises a closed default-off version-1 capability", () => {
		expect(getPeerSourceCostsCapability()).toEqual({
			enabled: false,
			contractVersion: 1,
			protocolVersion: 4,
			operationVersion: 1,
			resourceKinds: SOURCE_COST_KINDS,
			templateRegistryVersion: "peer-effects-v1",
		});
	});

	it("normalizes, combines, and canonically orders closed descriptors", () => {
		const entryId = crypto.randomUUID();
		expect(normalizeSourceCost({
			version: 1,
			components: [
				{kind: "spell_slot", pool: "standard", level: 2, amount: 1},
				{kind: "inventory_quantity", inventoryEntryId: entryId, itemRef: {uid: "arrow|phb"}, amount: 2},
				{kind: "spell_slot", pool: "standard", level: 2, amount: 2},
			],
		})).toEqual({
			version: 1,
			components: [
				{kind: "inventory_quantity", inventoryEntryId: entryId, itemRef: {uid: "arrow|phb"}, amount: 2},
				{kind: "spell_slot", pool: "standard", level: 2, amount: 3},
			],
		});
		for (const invalid of [
			{version: 2, components: [{kind: "spell_slot", pool: "standard", level: 1, amount: 1}]},
			{version: 1, components: [{kind: "spell_slot", pool: "standard", level: 1, amount: 1, path: "/secret"}]},
			{version: 1, components: [{kind: "custom", amount: 1}]},
		]) expect(() => normalizeSourceCost(invalid)).toThrow(expect.objectContaining({code: "SOURCE_COST_UNSUPPORTED"}));
	});

	it("resolves and applies every v1 kind without mutating input, including mirrors", () => {
		const itemId = crypto.randomUUID();
		const resourceId = crypto.randomUUID();
		const data = {
			spellcasting: {
				spellSlots: {2: {current: 3, max: 3}},
				pactSlots: {current: 2, max: 2, level: 3},
				innateSpells: [
					{name: "Unrelated", source: "PHB", uses: {current: 4, max: 4}},
					{name: "Bless", source: "PHB", resourceId, uses: {current: 2, max: 3}},
				],
			},
			inventory: [{
				id: itemId,
				item: {name: "Wand of Aid", source: "DMG", charges: 5, chargesCurrent: 4},
				quantity: 3,
			}],
			resources: [{
				id: resourceId,
				featureRef: {uid: "blessing|phb"},
				current: 2,
				max: 3,
			}],
			features: [{
				name: "Unrelated",
				source: "PHB",
				uses: {current: 4, max: 4},
			}, {
				name: "Blessing",
				source: "PHB",
				resourceId,
				uses: {current: 2, max: 3},
			}],
		};
		const before = structuredClone(data);
		const sourceCost = {
			version: 1,
			components: [
				{kind: "feature_use", resourceId, featureRef: {uid: "blessing|phb"}, amount: 1},
				{kind: "item_charge", inventoryEntryId: itemId, itemRef: {uid: "wand of aid|dmg"}, amount: 2},
				{kind: "inventory_quantity", inventoryEntryId: itemId, itemRef: {uid: "wand of aid|dmg"}, amount: 1},
				{kind: "spell_slot", pool: "pact", level: 3, amount: 1},
				{kind: "spell_slot", pool: "standard", level: 2, amount: 2},
			],
		};

		expect(resolveSourceCost({data, sourceCost}).components).toHaveLength(5);
		const applied = applySourceCost({data, sourceCost});
		expect(data).toEqual(before);
		expect(applied.changed).toBe(true);
		expect(applied.data.spellcasting.spellSlots[2].current).toBe(1);
		expect(applied.data.spellcasting.pactSlots.current).toBe(1);
		expect(applied.data.inventory[0]).toMatchObject({quantity: 2, item: {chargesCurrent: 2}});
		expect(applied.data.resources[0].current).toBe(1);
		expect(applied.data.features.map(feature => feature.uses.current)).toEqual([4, 1]);
		expect(applied.data.spellcasting.innateSpells.map(spell => spell.uses.current)).toEqual([4, 1]);
		expect(applied.footprint).toEqual(getSourceCostMutationFootprint(sourceCost));
	});

	it("fails closed on insufficient, replaced, and unsafe zero-quantity resources", () => {
		const entryId = crypto.randomUUID();
		const cost = amount => ({
			version: 1,
			components: [{
				kind: "inventory_quantity",
				inventoryEntryId: entryId,
				itemRef: {uid: "arrow|phb"},
				amount,
			}],
		});
		expect(() => applySourceCost({
			data: {inventory: [{id: entryId, item: {name: "Arrow", source: "PHB"}, quantity: 1, equipped: true}]},
			sourceCost: cost(1),
		})).toThrow(expect.objectContaining({code: "SOURCE_COST_UNAVAILABLE"}));
		expect(() => resolveSourceCost({
			data: {inventory: [{id: entryId, item: {name: "Bolt", source: "PHB"}, quantity: 2}]},
			sourceCost: cost(1),
		})).toThrow(expect.objectContaining({code: "SOURCE_COST_UNAVAILABLE"}));
		expect(() => resolveSourceCost({
			data: {inventory: [{id: entryId, item: {name: "Arrow", source: "PHB"}, quantity: 1}]},
			sourceCost: cost(2),
		})).toThrow(expect.objectContaining({code: "SOURCE_COST_UNAVAILABLE"}));
	});

	it("invalidates consent only when a bound source resource changes", () => {
		const itemId = crypto.randomUUID();
		const resourceId = crypto.randomUUID();
		const before = {
			spellcasting: {spellSlots: {1: {current: 2, max: 3}, 2: {current: 1, max: 1}}},
			inventory: [{id: itemId, item: {name: "Wand of Aid", source: "DMG", chargesCurrent: 4}, quantity: 2}],
			resources: [{id: resourceId, featureRef: {uid: "blessing|phb"}, current: 2, max: 3}],
		};
		const slotCost = {version: 1, components: [{kind: "spell_slot", pool: "standard", level: 1, amount: 1}]};
		const unchangedBinding = structuredClone(before);
		unchangedBinding.hp = {current: 10, max: 20};
		unchangedBinding.spellcasting.spellSlots[2].current = 0;
		expect(hasSourceCostBindingChanged({beforeData: before, afterData: unchangedBinding, sourceCost: slotCost})).toBe(false);

		const restoredSlot = structuredClone(before);
		restoredSlot.spellcasting.spellSlots[1].current = 1;
		expect(hasSourceCostBindingChanged({beforeData: before, afterData: restoredSlot, sourceCost: slotCost})).toBe(true);

		const itemCost = {
			version: 1,
			components: [{kind: "item_charge", inventoryEntryId: itemId, itemRef: {uid: "wand of aid|dmg"}, amount: 1}],
		};
		const replacedItem = structuredClone(before);
		replacedItem.inventory[0].item.name = "Wand of Fireballs";
		expect(hasSourceCostBindingChanged({beforeData: before, afterData: replacedItem, sourceCost: itemCost})).toBe(true);

		const featureCost = {
			version: 1,
			components: [{kind: "feature_use", resourceId, featureRef: {uid: "blessing|phb"}, amount: 1}],
		};
		const changedFeature = structuredClone(before);
		changedFeature.resources[0].current = 1;
		expect(hasSourceCostBindingChanged({beforeData: before, afterData: changedFeature, sourceCost: featureCost})).toBe(true);
	});
});
