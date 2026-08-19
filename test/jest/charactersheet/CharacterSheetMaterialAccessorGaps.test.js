/**
 * Three accessor-level gaps found by the NPC-export session reading this subsystem from the
 * outside. All three are the same defect in different clothes: a value is derived correctly in
 * one place and then read from somewhere that cannot see it.
 *
 * 1. **`getEffectiveItemBonuses().critThreshold` read the RAW item.** A material's `critical`
 *    axis lands on the PROJECTION, so an Orichaline katana reported 20 from this accessor while
 *    the projected item said 19. Live on the combat tab, not just in export.
 *
 * 2. **Adamantine's damage reduction never applied to a custom-built armour.** The gate asked
 *    `item.type === "HA"` — the 5etools catalogue's vocabulary — but the custom-item builder
 *    writes `type: "armor"` with a separate `armorType: "heavy"`. Every hand-built plate in the
 *    corpus silently lost its DR while a catalogue plate kept it.
 *
 * 3. **`getMaterialEffects(item)` returned a fully-populated EMPTY shape** when the material
 *    argument was forgotten, because — alone among its siblings — it did not resolve internally.
 *    A forgotten argument was indistinguishable from a material with no effects.
 *
 * The crit test pins the thing that makes this class of bug expensive: material crit and the
 * `Critical: Spiked` upgrade are two INDEPENDENT sources that must combine exactly once. Both
 * over- and under-counting are one-character mistakes, so both are asserted.
 */

import "./setup.js";
import "../../../js/charactersheet/charactersheet-materials.js";
import "../../../js/charactersheet/charactersheet-upgrades.js";
import "../../../js/charactersheet/charactersheet-state.js";

const CharacterSheetState = globalThis.CharacterSheetState;
const CharacterSheetMaterials = globalThis.CharacterSheetMaterials;

const ORICHALINE = {
	name: "Orichaline",
	source: "TGTT",
	materialCategory: "metal",
	critical: 1,
	appliesTo: ["weapon", "armor", "shield"],
	effects: [],
};

const ADAMANTINE = {
	name: "Adamantine",
	source: "TGTT",
	materialCategory: "metal",
	appliesTo: ["weapon", "armor", "shield"],
	effects: [
		{type: "damageReduction", value: 3, armorType: "heavy", damageTypes: ["bludgeoning", "piercing", "slashing"]},
		{type: "damageReduction", value: 2, armorType: "medium", damageTypes: ["bludgeoning", "piercing", "slashing"]},
	],
};

const PLAIN = {name: "Plain Steel", source: "TGTT", materialCategory: "metal", appliesTo: ["weapon", "armor"], effects: []};

const CATALOG = [ORICHALINE, ADAMANTINE, PLAIN];

const KATANA = {name: "Katana", source: "PHB", type: "M", weapon: true, dmg1: "1d8", dmgType: "S", weight: 3, value: 1500};

/** A catalogue-shaped heavy armour: the vocabulary the old gate understood. */
const CATALOG_PLATE = {name: "Plate Armor", source: "PHB", type: "HA", ac: 18, weight: 65, value: 150000};

/** A custom-built heavy armour: the vocabulary the old gate did NOT understand. */
const CUSTOM_PLATE = {name: "Angelic Plate", source: "Custom", type: "armor", armorType: "heavy", ac: 18, weight: 65, value: 150000};

function makeState () {
	const state = new CharacterSheetState();
	state.addClass({name: "Fighter", source: "PHB", level: 5});
	state.setItemMaterialCatalog(CATALOG);
	return state;
}

function equipWithMaterial (state, item, materialName) {
	state.addItem({quantity: 1, ...item});
	const id = state.getItems().slice(-1)[0].id;
	if (materialName) state.setItemMaterial(id, CATALOG.find(m => m.name === materialName));
	const raw = state._data.inventory.find(it => it.id === id);
	if (raw) raw.equipped = true;
	state._recalculateEquipmentModifiers();
	return id;
}

describe("getEffectiveItemBonuses reports the material's crit threshold", () => {
	it("reports 19 for an Orichaline weapon, not the raw item's 20", () => {
		const state = makeState();
		const id = equipWithMaterial(state, KATANA, "Orichaline");

		expect(state.getEffectiveItemBonuses(id).critThreshold).toBe(19);
	});

	it("agrees with the projected item, which is where the axis actually lands", () => {
		const state = makeState();
		const id = equipWithMaterial(state, KATANA, "Orichaline");

		const projected = state.getItems().find(it => it.id === id);
		expect(state.getEffectiveItemBonuses(id).critThreshold).toBe(projected.critThreshold);
	});

	it("leaves a material with no crit axis at 20", () => {
		const state = makeState();
		const id = equipWithMaterial(state, KATANA, "Plain Steel");

		expect(state.getEffectiveItemBonuses(id).critThreshold).toBe(20);
	});

	it("combines material crit and a crit upgrade exactly once", () => {
		const state = makeState();
		const id = equipWithMaterial(state, KATANA, "Orichaline");

		// The material and the upgrade are INDEPENDENT sources. 20 − 1 − 1 = 18: counting
		// either twice gives 17, dropping either gives 19.
		const raw = state._data.inventory.find(it => it.id === id);
		raw.item.appliedUpgrades = [{name: "Critical: Spiked", critThresholdReduction: 1}];
		state._recalculateEquipmentModifiers();

		expect(state.getEffectiveItemBonuses(id).critThreshold).toBe(18);
	});

	it("never reports an impossible threshold", () => {
		const state = makeState();
		const id = equipWithMaterial(state, KATANA, "Orichaline");
		const raw = state._data.inventory.find(it => it.id === id);
		raw.item.appliedUpgrades = [{name: "Absurd", critThresholdReduction: 40}];
		state._recalculateEquipmentModifiers();

		expect(state.getEffectiveItemBonuses(id).critThreshold).toBeGreaterThanOrEqual(2);
	});
});

describe("Adamantine damage reduction reaches custom-built armour", () => {
	it("applies to a CUSTOM heavy armour, which declares armorType rather than type HA", () => {
		const state = makeState();
		equipWithMaterial(state, CUSTOM_PLATE, "Adamantine");

		const drs = state.getNamedModifiersByType("damageReduction");
		expect(drs.map(d => d.value)).toContain(3);
	});

	it("still applies to a CATALOGUE heavy armour", () => {
		const state = makeState();
		equipWithMaterial(state, CATALOG_PLATE, "Adamantine");

		const drs = state.getNamedModifiersByType("damageReduction");
		expect(drs.map(d => d.value)).toContain(3);
	});

	it("does not stack the heavy and medium entries onto one armour", () => {
		const state = makeState();
		equipWithMaterial(state, CUSTOM_PLATE, "Adamantine");

		const drs = state.getNamedModifiersByType("damageReduction").filter(d => d.sourceType === "itemMaterial");
		expect(drs).toHaveLength(1);
	});

	it("does not apply to a weapon", () => {
		const state = makeState();
		equipWithMaterial(state, KATANA, "Adamantine");

		expect(state.getNamedModifiersByType("damageReduction").filter(d => d.sourceType === "itemMaterial")).toHaveLength(0);
	});

	it("carries the damage types the brew authored", () => {
		const state = makeState();
		equipWithMaterial(state, CUSTOM_PLATE, "Adamantine");

		const dr = state.getNamedModifiersByType("damageReduction").find(d => d.sourceType === "itemMaterial");
		expect(dr.damageTypes).toEqual(["bludgeoning", "piercing", "slashing"]);
	});
});

describe("getArmorCategory understands both item vocabularies", () => {
	it.each([
		[{type: "HA"}, "heavy"],
		[{type: "MA"}, "medium"],
		[{type: "LA"}, "light"],
		[{type: "S"}, "shield"],
		[{type: "HA|XPHB"}, "heavy"],
		[{type: "armor", armorType: "heavy"}, "heavy"],
		[{type: "armor", armorType: "medium"}, "medium"],
		[{type: "armor", armorType: "light"}, "light"],
		[{shield: true}, "shield"],
		[{type: "M", weapon: true}, null],
		[null, null],
	])("resolves %j to %s", (item, expected) => {
		expect(CharacterSheetState.getArmorCategory(item)).toBe(expected);
	});
});

describe("getMaterialEffects resolves its material like its siblings do", () => {
	beforeEach(() => { globalThis.__csMaterialCatalog = CATALOG; });
	afterEach(() => { delete globalThis.__csMaterialCatalog; });

	it("returns real effects when the material argument is omitted", () => {
		const item = {...CUSTOM_PLATE, material: {name: "Adamantine", source: "TGTT"}};

		expect(CharacterSheetMaterials.getMaterialEffects(item).damageReduction).toHaveLength(2);
	});

	it("agrees with the explicitly-passed form", () => {
		const item = {...CUSTOM_PLATE, material: {name: "Adamantine", source: "TGTT"}};

		expect(CharacterSheetMaterials.getMaterialEffects(item))
			.toEqual(CharacterSheetMaterials.getMaterialEffects(item, ADAMANTINE));
	});

	it("still returns the empty shape for an item with no material", () => {
		expect(CharacterSheetMaterials.getMaterialEffects({...KATANA}).damageReduction).toEqual([]);
	});
});
