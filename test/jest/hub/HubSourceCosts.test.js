import crypto from "node:crypto";

import {
	applySourceCost,
	getPeerSourceCostsCapability,
	getSourceCostMutationFootprint,
	hasSourceCostBindingChanged,
	isPeerSourceCostsProtocolVersion,
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

	it("accepts source-cost requests from protocol 4 and the current protocol 5 only", () => {
		expect(isPeerSourceCostsProtocolVersion("3")).toBe(false);
		expect(isPeerSourceCostsProtocolVersion("4")).toBe(true);
		expect(isPeerSourceCostsProtocolVersion("5")).toBe(true);
		expect(isPeerSourceCostsProtocolVersion("6")).toBe(false);
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
			{
				version: 1,
				components: [{kind: "spell_slot", pool: "standard", level: 1, amount: Number.MAX_SAFE_INTEGER + 1}],
			},
			{
				version: 1,
				components: [
					{kind: "spell_slot", pool: "standard", level: 1, amount: Number.MAX_SAFE_INTEGER},
					{kind: "spell_slot", pool: "standard", level: 1, amount: 1},
				],
			},
			{
				version: 1,
				components: [{
					kind: "item_charge",
					inventoryEntryId: entryId,
					itemRef: {uid: "wand of aid|dmg", brewBundleVersionId: crypto.randomUUID()},
					amount: 1,
				}],
			},
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

	it("binds item costs to one exact entry and campaign-brew identity while preserving metadata", () => {
		const entryId = crypto.randomUUID();
		const brewBundleVersionId = crypto.randomUUID();
		const brewContentHash = "a".repeat(64);
		const itemRef = {uid: "wand of aid|hb", brewBundleVersionId, brewContentHash};
		const sourceCost = {
			version: 1,
			components: [
				{kind: "item_charge", inventoryEntryId: entryId, itemRef, amount: 2},
				{kind: "inventory_quantity", inventoryEntryId: entryId, itemRef, amount: 1},
			],
		};
		const data = {
			inventory: [{
				id: entryId,
				item: {
					name: "Wand of Aid",
					source: "HB",
					charges: 5,
					chargesCurrent: 4,
					customMetadata: {maker: "Aster"},
				},
				brewBundleVersionId,
				brewContentHash,
				quantity: 3,
				note: "Keep this note",
			}],
		};

		const applied = applySourceCost({data, sourceCost});
		expect(applied.data.inventory[0]).toEqual({
			...data.inventory[0],
			item: {...data.inventory[0].item, chargesCurrent: 2},
			quantity: 2,
		});

		const wrongBrew = structuredClone(sourceCost);
		wrongBrew.components[0].itemRef.brewContentHash = "b".repeat(64);
		expect(() => resolveSourceCost({data, sourceCost: wrongBrew}))
			.toThrow(expect.objectContaining({code: "SOURCE_COST_UNAVAILABLE"}));

		expect(() => resolveSourceCost({
			data: {inventory: [data.inventory[0], structuredClone(data.inventory[0])]},
			sourceCost,
		})).toThrow(expect.objectContaining({code: "SOURCE_COST_UNAVAILABLE"}));
	});

	it("allows safe full-stack consumption but fails closed for linked or custom zero-removal shapes", () => {
		const entryId = crypto.randomUUID();
		const sourceCost = {
			version: 1,
			components: [{
				kind: "inventory_quantity",
				inventoryEntryId: entryId,
				itemRef: {uid: "arrow|phb"},
				amount: 2,
			}],
		};
		const safe = {
			inventory: [{
				id: entryId,
				item: {
					name: "Arrow",
					source: "PHB",
					containedItems: [],
					iounSet: [],
				},
				quantity: 2,
				equipped: false,
				attuned: false,
				containerId: null,
				active: false,
				custom: {},
				tags: [],
				alias: "",
				note: "Spent ammunition",
			}],
		};
		expect(applySourceCost({data: safe, sourceCost}).data.inventory).toEqual([]);

		for (const unsafe of [
			{...safe.inventory[0], equipped: true},
			{...safe.inventory[0], containerId: crypto.randomUUID()},
			{...safe.inventory[0], active: true},
			{...safe.inventory[0], custom: {unsafe: true}},
			{...safe.inventory[0], item: {...safe.inventory[0].item, containedItems: [crypto.randomUUID()]}},
			{...safe.inventory[0], item: {...safe.inventory[0].item, iounSet: [crypto.randomUUID()]}},
		]) {
			expect(() => applySourceCost({
				data: {inventory: [unsafe]},
				sourceCost,
			})).toThrow(expect.objectContaining({code: "SOURCE_COST_UNAVAILABLE"}));
		}

		expect(() => applySourceCost({
			data: {
				inventory: [safe.inventory[0]],
				ammunitionSelections: {attack: entryId},
			},
			sourceCost,
		})).toThrow(expect.objectContaining({code: "SOURCE_COST_UNAVAILABLE"}));

		const paddedEntryId = `\uFEFF\t${entryId.toUpperCase()}\u00A0`;
		const linkedContainers = [
			{
				inventory: [
					{...safe.inventory[0], id: paddedEntryId},
					{
						id: crypto.randomUUID(),
						item: {name: "Quiver", source: "PHB", containedItems: [entryId], iounSet: []},
						quantity: 1,
						equipped: false,
						attuned: false,
					},
				],
			},
			{
				inventory: [
					{...safe.inventory[0], id: paddedEntryId},
					{
						id: crypto.randomUUID(),
						item: {name: "Ioun Host", source: "PHB", containedItems: [], iounSet: [entryId]},
						quantity: 1,
						equipped: false,
						attuned: false,
					},
				],
			},
			{
				inventory: [
					{...safe.inventory[0], id: paddedEntryId},
					{
						id: crypto.randomUUID(),
						item: {name: "Pack", source: "PHB", containedItems: [], iounSet: []},
						quantity: 1,
						equipped: false,
						attuned: false,
						containerId: entryId.toUpperCase(),
					},
				],
			},
			{inventory: [{...safe.inventory[0], id: paddedEntryId}], selectedAmmo: {[entryId]: true}},
			{inventory: [{...safe.inventory[0], id: paddedEntryId}], selectedAmmo: {attack: entryId}},
			{inventory: [{...safe.inventory[0], id: paddedEntryId}], ammunitionConsumed: {[entryId]: 0}},
			{inventory: [{...safe.inventory[0], id: paddedEntryId}], activeStates: [{itemId: entryId}]},
			{inventory: [{...safe.inventory[0], id: paddedEntryId}], itemGrantedSpells: [{sourceItemId: entryId}]},
			{inventory: [{...safe.inventory[0], id: paddedEntryId}], spellcasting: {componentItemId: entryId}},
			{inventory: [{...safe.inventory[0], id: paddedEntryId}], iounBonds: {[entryId]: {}}},
			{
				inventory: [{...safe.inventory[0], id: paddedEntryId}],
				namedModifiers: [{sourceFeatureId: `item:${entryId.toUpperCase()}`}],
			},
			{
				inventory: [{...safe.inventory[0], id: paddedEntryId}],
				acFormulas: [{sourceFeatureId: `item:${entryId.toUpperCase()}`}],
			},
			{
				inventory: [{...safe.inventory[0], id: paddedEntryId}],
				grantedDefensiveTraits: {resist: {fire: [`item:${entryId.toUpperCase()}`]}},
			},
		];
		for (const data of linkedContainers) {
			expect(() => applySourceCost({data, sourceCost}))
				.toThrow(expect.objectContaining({code: "SOURCE_COST_UNAVAILABLE"}));
		}
	});

	it("resolves every component before staging any mutation", () => {
		const entryId = crypto.randomUUID();
		const data = {
			spellcasting: {spellSlots: {1: {current: 1, max: 1}}},
			inventory: [{
				id: entryId,
				item: {name: "Arrow", source: "PHB"},
				quantity: 1,
			}],
		};
		const before = structuredClone(data);
		expect(() => applySourceCost({
			data,
			sourceCost: {
				version: 1,
				components: [
					{kind: "spell_slot", pool: "standard", level: 1, amount: 1},
					{kind: "inventory_quantity", inventoryEntryId: entryId, itemRef: {uid: "arrow|phb"}, amount: 2},
				],
			},
		})).toThrow(expect.objectContaining({code: "SOURCE_COST_UNAVAILABLE"}));
		expect(data).toEqual(before);
	});

	it("requires one exact feature resource and updates each canonical mirror exactly once", () => {
		const resourceId = crypto.randomUUID();
		const featureId = crypto.randomUUID();
		const innateSpellId = crypto.randomUUID();
		const sourceCost = {
			version: 1,
			components: [{
				kind: "feature_use",
				resourceId,
				featureRef: {uid: "blessing|phb"},
				amount: 1,
			}],
		};
		const data = {
			resources: [{
				id: resourceId,
				featureId,
				linkedInnateSpellId: innateSpellId,
				featureRef: {uid: "blessing|phb"},
				current: 2,
				max: 3,
			}],
			features: [{
				id: featureId,
				name: "Blessing",
				source: "PHB",
				resourceId,
				uses: {current: 2, max: 3},
			}],
			spellcasting: {
				innateSpells: [{
					id: innateSpellId,
					name: "Bless",
					source: "PHB",
					resourceId,
					uses: {current: 2, max: 3},
				}],
			},
		};

		const applied = applySourceCost({data, sourceCost});
		expect(applied.data.resources[0].current).toBe(1);
		expect(applied.data.features[0].uses.current).toBe(1);
		expect(applied.data.spellcasting.innateSpells[0].uses.current).toBe(1);

		const cases = [
			{...structuredClone(data), resources: [data.resources[0], structuredClone(data.resources[0])]},
			{...structuredClone(data), features: [data.features[0], structuredClone(data.features[0])]},
			{
				...structuredClone(data),
				spellcasting: {innateSpells: [
					data.spellcasting.innateSpells[0],
					structuredClone(data.spellcasting.innateSpells[0]),
				]},
			},
			{
				...structuredClone(data),
				features: [{...data.features[0], uses: {current: 1, max: 3}}],
			},
			{
				...structuredClone(data),
				spellcasting: {innateSpells: [{...data.spellcasting.innateSpells[0], uses: {current: 2, max: 4}}]},
			},
			{...structuredClone(data), features: []},
			{
				...structuredClone(data),
				resources: [{
					...data.resources[0],
					featureId: "missing-feature",
					linkedInnateSpellId: "missing-spell",
				}],
			},
		];
		for (const invalid of cases) {
			expect(() => resolveSourceCost({data: invalid, sourceCost}))
				.toThrow(expect.objectContaining({code: "SOURCE_COST_UNAVAILABLE"}));
		}
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

	it("permanently detects spend-then-restore ABA snapshots for every version-1 binding", () => {
		const itemId = crypto.randomUUID();
		const resourceId = crypto.randomUUID();
		const featureId = crypto.randomUUID();
		const before = {
			spellcasting: {
				spellSlots: {2: {current: 2, max: 2}},
				pactSlots: {current: 2, max: 2, level: 3},
				innateSpells: [],
			},
			inventory: [{
				id: itemId,
				item: {name: "Wand of Aid", source: "DMG", charges: 5, chargesCurrent: 4},
				quantity: 3,
			}],
			resources: [{
				id: resourceId,
				featureId,
				featureRef: {uid: "blessing|phb"},
				current: 2,
				max: 2,
			}],
			features: [{
				id: featureId,
				name: "Blessing",
				source: "PHB",
				resourceId,
				uses: {current: 2, max: 2},
			}],
		};
		const cases = [
			{
				cost: {kind: "spell_slot", pool: "standard", level: 2, amount: 1},
				mutate: data => data.spellcasting.spellSlots[2].current--,
			},
			{
				cost: {kind: "spell_slot", pool: "pact", level: 3, amount: 1},
				mutate: data => data.spellcasting.pactSlots.current--,
			},
			{
				cost: {kind: "item_charge", inventoryEntryId: itemId, itemRef: {uid: "wand of aid|dmg"}, amount: 1},
				mutate: data => data.inventory[0].item.chargesCurrent--,
			},
			{
				cost: {kind: "inventory_quantity", inventoryEntryId: itemId, itemRef: {uid: "wand of aid|dmg"}, amount: 1},
				mutate: data => data.inventory[0].quantity--,
			},
			{
				cost: {kind: "feature_use", resourceId, featureRef: {uid: "blessing|phb"}, amount: 1},
				mutate: data => {
					data.resources[0].current--;
					data.features[0].uses.current--;
				},
			},
		];

		for (const {cost, mutate} of cases) {
			const spent = structuredClone(before);
			mutate(spent);
			const sourceCost = {version: 1, components: [cost]};
			expect(hasSourceCostBindingChanged({beforeData: before, afterData: spent, sourceCost})).toBe(true);
			expect(hasSourceCostBindingChanged({beforeData: spent, afterData: before, sourceCost})).toBe(true);
		}
	});
});
