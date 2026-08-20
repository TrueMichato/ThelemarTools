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
import {readFileSync} from "fs";
import {dirname, resolve} from "path";
import {fileURLToPath} from "url";
import "../../../js/charactersheet/charactersheet-materials.js";
import "../../../js/charactersheet/charactersheet-upgrades.js";
import "../../../js/charactersheet/charactersheet-state.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "../../..");

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

/**
 * The same "two independent sources, combined exactly once" shape as the crit tests above, for
 * damage dice — pinned because the NPC-export session reasoned about it from the outside and
 * reached a true conclusion from a false premise.
 *
 * They believed the die path was safe *because no material steps a damage die*. Thirteen of the
 * brew's seventy-two do (Steel +1, Darkeline +2, Paradox Metal +2, the dragon materials…), so
 * that premise is simply false. What actually makes it safe is a separation of channels:
 *
 * - a MATERIAL's step is baked into the projected `dmg1` by `applyToItem`
 * - an UPGRADE's step is published as `getEffectiveItemBonuses().damageDieIncrease`
 *
 * `damageDieIncrease` is fed only by `getUpgradeEffects`, so it stays 0 for a material-only
 * weapon and a reader that steps the projected die by it counts each source once. Route a
 * material's step into the accessor and every such weapon silently gains a die — which is why
 * the zero is asserted directly rather than inferred from the final die.
 */
describe("a material's die step and an upgrade's die step each land exactly once", () => {
	const DARKELINE = {
		name: "Darkeline",
		source: "TGTT",
		materialCategory: "metal",
		damage: 2,
		appliesTo: ["weapon"],
		effects: [],
	};
	const STEEL = {
		name: "Steel",
		source: "TGTT",
		materialCategory: "metal",
		damage: 1,
		appliesTo: ["weapon"],
		effects: [],
	};
	const HEART_STONE = {
		name: "Heart Stone",
		source: "TGTT",
		materialCategory: "stone",
		damage: -2,
		appliesTo: ["weapon"],
		effects: [],
	};
	const DIE_CATALOG = [...CATALOG, STEEL, DARKELINE, HEART_STONE];

	// A d4 base leaves headroom on BOTH ladders. Starting at 1d8 puts the two-step case on 1d12,
	// which is the upgrade stepper's ceiling -- so a third, erroneous step would be clamped away
	// and the assertion would pass on a broken build.
	const DAGGER = {name: "Dagger", type: "M", weapon: true, dmg1: "1d4", dmgType: "P"};

	function armed (materialName, appliedUpgrades, base = KATANA) {
		const state = new CharacterSheetState();
		state.addClass({name: "Fighter", source: "PHB", level: 5});
		state.setItemMaterialCatalog(DIE_CATALOG);
		state.addItem({quantity: 1, ...base});
		const id = state.getItems().slice(-1)[0].id;
		if (materialName) state.setItemMaterial(id, DIE_CATALOG.find(m => m.name === materialName));
		const raw = state._data.inventory.find(it => it.id === id);
		if (appliedUpgrades) {
			raw.appliedUpgrades = appliedUpgrades;
			if (raw.item) raw.item.appliedUpgrades = appliedUpgrades;
		}
		raw.equipped = true;
		state._recalculateEquipmentModifiers();
		return {state, id};
	}

	it("steps the die once for a material, through the projection", () => {
		const {state, id} = armed("Steel");

		expect(state.getItems().find(it => it.id === id).dmg1).toBe("1d10");
		expect(state.getEffectiveWeaponDamage(id).dice).toBe("1d10");
	});

	it("keeps a material's step OUT of damageDieIncrease, which is the upgrade channel", () => {
		const dieIncreaseFor = name => {
			const {state, id} = armed(name);
			return state.getEffectiveItemBonuses(id).damageDieIncrease || 0;
		};

		expect(dieIncreaseFor("Steel")).toBe(0);
		expect(dieIncreaseFor("Darkeline")).toBe(0);
		expect(dieIncreaseFor("Heart Stone")).toBe(0);
	});

	it("steps the die once for an upgrade, leaving the projection alone", () => {
		const {state, id} = armed(null, [{name: "superior"}]);

		expect(state.getItems().find(it => it.id === id).dmg1).toBe("1d8");
		expect(state.getEffectiveItemBonuses(id).damageDieIncrease).toBe(1);
		expect(state.getEffectiveWeaponDamage(id).dice).toBe("1d10");
	});

	it("combines the two sources into exactly two steps, never three", () => {
		const {state, id} = armed("Steel", [{name: "superior"}], DAGGER);

		// 1d4 --material--> 1d6 --upgrade--> 1d8. A third step (1d10) would mean one source was
		// counted twice; 1d6 would mean one was dropped. Both directions are visible here only
		// because the run ends short of either ladder's ceiling.
		expect(state.getItems().find(it => it.id === id).dmg1).toBe("1d6");
		expect(state.getEffectiveWeaponDamage(id).dice).toBe("1d8");
	});

	it("steps a negative material's die down, without the accessor undoing it", () => {
		const {state, id} = armed("Heart Stone");

		const projected = state.getItems().find(it => it.id === id).dmg1;
		expect(state.getEffectiveWeaponDamage(id).dice).toBe(projected);
	});
});

/**
 * The material ladder and the upgrade ladder DISAGREE, and this pins the disagreement so it is a
 * declared property rather than a discovery someone makes from a bug report.
 *
 * `CharacterSheetMaterials.stepDamageDie` walks the authored eleven-step Thelemar ladder, which
 * continues past 1d12 into 2d6. `CharacterSheetUpgrades.increaseDamageDie` walks `[4,6,8,10,12]`
 * and clamps. They agree on every die a base weapon actually has -- and diverge at exactly one
 * point, 1d12, which materials can now REACH (Darkeline and Paradox Metal are +2, so any d8
 * weapon lands there).
 *
 * The user-visible consequence: a Superior upgrade on a 1d12 weapon costs resources, prints
 * "Damage die +1 step", and changes nothing. That predates materials -- a Superior greataxe was
 * always inert -- but materials make it common rather than a corner.
 *
 * This is deliberately NOT fixed here. The cap is pinned by `CharacterSheetUpgrades.test.js`, the
 * NPC exporter depends on `increaseDamageDie` returning the die term alone (it pre-extracts
 * because of it), and the two ladders come from different books -- so whether TCAH's step should
 * inherit Thelemar's ladder is a rules decision, not a refactor. If it is ever taken, this test
 * fails and points at everything that has to move together.
 */
describe("the material ladder and the upgrade ladder diverge at 1d12", () => {
	const agreeing = ["1d4", "1d6", "1d8", "1d10", "2d6", "2d8"];

	it.each(agreeing)("steps %s identically on both ladders", (die) => {
		expect(CharacterSheetUpgrades.increaseDamageDie(die, 1))
			.toBe(CharacterSheetMaterials.stepDamageDie(die, 1));
	});

	it("diverges at 1d12: the material ladder continues, the upgrade ladder clamps", () => {
		expect(CharacterSheetMaterials.stepDamageDie("1d12", 1)).toBe("2d6");
		expect(CharacterSheetUpgrades.increaseDamageDie("1d12", 1)).toBe("1d12");
	});

	it("is reachable, because the shipped brew really does author +2 materials", () => {
		// Read from the brew rather than a hard-coded list. A guard that asserts a die ladder
		// against names it supplies itself proves only that the test file is self-consistent --
		// which is precisely the vacuity this whole describe exists to avoid.
		const raw = readFileSync(resolve(REPO_ROOT, "homebrew/TravelersGuidetoThelemar.json"), "utf8");
		const materials = JSON.parse(raw).itemMaterial || [];
		const plusTwo = materials.filter(m => Number(m.damage) === 2).map(m => m.name);

		expect(plusTwo.length).toBeGreaterThan(0);
		// A d8 weapon plus any of them lands exactly on the one die the two ladders disagree about.
		expect(CharacterSheetMaterials.stepDamageDie("1d8", 2)).toBe("1d12");
	});
});
