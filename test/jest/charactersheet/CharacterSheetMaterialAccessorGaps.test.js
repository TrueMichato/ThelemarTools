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

/**
 * The mirror of gap #2, found by the NPC-export session hitting the same defect from the other
 * side. The MODIFIER path gates each authored tier by the item's armour category; the NOTE path
 * did not gate at all. So the sheet granted the right number and then explained a different one:
 * an Adamantine plate's modal listed a reduction of 3 AND of 2, and an Adamantine longsword —
 * which gets no reduction whatsoever — listed both as well.
 *
 * Inventing a defence is worse than omitting one. A missing note reads as "this material does
 * nothing here"; a manufactured one reads as a rule, and nothing on screen marks it as false.
 */
describe("a material's damage-reduction note is gated to the tier that actually applies", () => {
	beforeEach(() => { globalThis.__csMaterialCatalog = CATALOG; });
	afterEach(() => { delete globalThis.__csMaterialCatalog; });

	const drNotes = (item) => CharacterSheetMaterials.getMaterialNotes({...item, material: {name: "Adamantine", source: "TGTT"}})
		.filter(note => /Reduce incoming/.test(note.description || ""));

	it("gives catalogue heavy armour only the heavy tier", () => {
		const notes = drNotes(CATALOG_PLATE);

		expect(notes).toHaveLength(1);
		expect(notes[0].description).toContain("by 3");
	});

	it("gives custom-built heavy armour the same single tier as the catalogue one", () => {
		const notes = drNotes(CUSTOM_PLATE);

		// Asserted absolutely as well as relatively: two identically-broken outputs are equal to
		// each other, so the comparison alone would survive the gate being removed entirely.
		expect(notes).toHaveLength(1);
		expect(notes).toEqual(drNotes(CATALOG_PLATE));
	});

	it("gives medium armour the medium tier and not the heavy one", () => {
		const notes = drNotes({name: "Half Plate", source: "PHB", type: "MA", ac: 15});

		expect(notes).toHaveLength(1);
		expect(notes[0].description).toContain("by 2");
	});

	it("gives light armour nothing, because Adamantine grants light armour no reduction", () => {
		expect(drNotes({name: "Leather", source: "PHB", type: "LA", ac: 11})).toEqual([]);
	});

	it("gives a weapon nothing, rather than a defence a weapon cannot have", () => {
		expect(drNotes(KATANA)).toEqual([]);
	});

	it("agrees with the modifier path about which tier applies", () => {
		const state = makeState();
		const id = equipWithMaterial(state, CATALOG_PLATE, "Adamantine");

		const modifier = state.getNamedModifiersByType("damageReduction").find(d => d.sourceType === "itemMaterial");
		const notes = drNotes(CATALOG_PLATE);
		expect(notes).toHaveLength(1);
		expect(notes[0].description).toContain(`by ${modifier.value}`);
	});

	it("drops the authored prose too when no tier applies, instead of letting it resurface", () => {
		const noted = {
			...ADAMANTINE,
			name: "Noted Adamantine",
			effects: ADAMANTINE.effects.map(fx => ({...fx, note: "Blows glance from the plating."})),
		};
		globalThis.__csMaterialCatalog = [...CATALOG, noted];

		const notes = CharacterSheetMaterials.getMaterialNotes({...KATANA, material: {name: "Noted Adamantine", source: "TGTT"}});

		expect(notes.some(note => /glance from the plating/.test(note.description || ""))).toBe(false);
	});
});

/**
 * The gate lives in the materials module and `CharacterSheetState` delegates to it, so the tier
 * switch exists exactly once. The armour-category *reading* is the one thing still written
 * twice: materials falls back to an inline copy for headless callers that load it without the
 * state module. These pin the two together so the fallback cannot drift into disagreement.
 */
describe("the headless armour-category fallback agrees with the state module", () => {
	const SHAPES = [
		{type: "HA"}, {type: "MA"}, {type: "LA"}, {type: "S"}, {type: "HA|XPHB"},
		{type: "armor", armorType: "heavy"}, {type: "armor", armorType: "medium"},
		{type: "armor", armorType: "light"}, {shield: true}, {type: "M", weapon: true}, null,
	];

	it.each(SHAPES)("resolves %j identically with and without the state module", (item) => {
		const viaState = CharacterSheetState.getArmorCategory(item);

		const saved = globalThis.CharacterSheetState;
		delete globalThis.CharacterSheetState;
		try {
			expect(CharacterSheetMaterials.getArmorCategory(item)).toBe(viaState);
		} finally {
			globalThis.CharacterSheetState = saved;
		}
	});
});
