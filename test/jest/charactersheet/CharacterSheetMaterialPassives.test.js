/**
 * Material passives that reach the character sheet: speed and initiative.
 *
 * Both were authored in the brew, normalised by `getMaterialEffects`, and then read by
 * nobody at all. Rootstone promised "reduce the wearer's Speed by 5 feet" and the
 * character walked at full pace; Stormprism promised +1 Initiative and the number never
 * moved.
 *
 * The speed cases are deliberately paranoid about the THREE entry points, because
 * `getSpeed(type)` early-returns into `getSpeedByType(type)` — a bonus wired into only
 * one of them is invisible from half the sheet.
 */

import "./setup.js";
import "../../../js/charactersheet/charactersheet-materials.js";
import "../../../js/charactersheet/charactersheet-state.js";

const CharacterSheetState = globalThis.CharacterSheetState;

const ROOTSTONE = {
	name: "Rootstone",
	source: "TGTT",
	materialCategory: "condensate",
	density: 2.5,
	magicCapacity: 3,
	appliesTo: ["armor", "shield"],
	effects: [{type: "speedDelta", value: -5, appliesTo: ["armor"]}],
};

const STORMPRISM = {
	name: "Stormprism",
	source: "TGTT",
	materialCategory: "condensate",
	density: 2.5,
	magicCapacity: 3,
	appliesTo: ["weapon", "armor", "other"],
	effects: [{type: "bonusInitiative", value: 1}],
};

const ADAMANTINE = {
	name: "Adamantine",
	source: "TGTT",
	materialCategory: "metal",
	density: 8,
	magicCapacity: 4,
	appliesTo: ["weapon", "armor", "shield"],
	effects: [
		{type: "damageReduction", value: 3, armorType: "heavy", damageTypes: ["bludgeoning", "piercing", "slashing"]},
		{type: "damageReduction", value: 2, armorType: "medium", damageTypes: ["bludgeoning", "piercing", "slashing"]},
	],
};

const CATALOG = [ROOTSTONE, STORMPRISM, ADAMANTINE];

function makeState () {
	const state = new CharacterSheetState();
	state.addClass({name: "Fighter", source: "PHB", level: 5});
	state.setAbilityBase("dex", 14);
	state.setItemMaterialCatalog(CATALOG);
	return state;
}

/** Add an item, equip it, apply a material, and return its id. */
function equipWithMaterial (state, item, materialName) {
	state.addItem({quantity: 1, equipped: true, ...item});
	const id = state.getItems().slice(-1)[0].id;
	state.setItemMaterial(id, CATALOG.find(m => m.name === materialName));
	const raw = state._data.inventory.find(it => it.id === id);
	if (raw) raw.equipped = true;
	state._recalculateEquipmentModifiers();
	return id;
}

const HEAVY_ARMOR = {name: "Plate", source: "PHB", type: "HA", ac: 18, weight: 65, value: 150000};
const MEDIUM_ARMOR = {name: "Breastplate", source: "PHB", type: "MA", ac: 14, weight: 20, value: 40000};
const SWORD = {name: "Longsword", source: "PHB", type: "M", weapon: true, dmg1: "1d8", dmgType: "S", weight: 3, value: 1500};

describe("Material speed delta", () => {
	it("is zero with no materials equipped", () => {
		expect(makeState().getMaterialSpeedBonus()).toBe(0);
	});

	it("reads Rootstone's −5 off equipped armour", () => {
		const state = makeState();
		equipWithMaterial(state, HEAVY_ARMOR, "Rootstone");
		expect(state.getMaterialSpeedBonus()).toBe(-5);
	});

	it("reaches the formatted speed string", () => {
		const state = makeState();
		const before = state.getSpeed();
		equipWithMaterial(state, HEAVY_ARMOR, "Rootstone");
		expect(state.getSpeed()).not.toBe(before);
		expect(state.getSpeed()).toContain("25 ft.");
	});

	it("reaches getWalkSpeed()", () => {
		const state = makeState();
		const before = state.getWalkSpeed();
		equipWithMaterial(state, HEAVY_ARMOR, "Rootstone");
		expect(state.getWalkSpeed()).toBe(before - 5);
	});

	it("reaches getSpeedByType('walk') — the early-return path", () => {
		const state = makeState();
		const before = state.getSpeedByType("walk");
		equipWithMaterial(state, HEAVY_ARMOR, "Rootstone");
		expect(state.getSpeedByType("walk")).toBe(before - 5);
	});

	it("agrees with getSpeed('walk'), which delegates to getSpeedByType", () => {
		const state = makeState();
		equipWithMaterial(state, HEAVY_ARMOR, "Rootstone");
		expect(state.getSpeed("walk")).toBe(state.getSpeedByType("walk"));
	});

	it("does not conjure a climb speed the character does not have", () => {
		const state = makeState();
		equipWithMaterial(state, HEAVY_ARMOR, "Rootstone");
		expect(state.getSpeedByType("climb")).toBe(0);
	});

	it("ignores a material on an unequipped item", () => {
		const state = makeState();
		state.addItem({quantity: 1, equipped: false, ...HEAVY_ARMOR});
		const id = state.getItems().slice(-1)[0].id;
		state.setItemMaterial(id, ROOTSTONE);
		const raw = state._data.inventory.find(it => it.id === id);
		if (raw) raw.equipped = false;
		expect(state.getMaterialSpeedBonus()).toBe(0);
	});

	it("respects the effect's own appliesTo — Rootstone on a sword is inert", () => {
		const state = makeState();
		equipWithMaterial(state, SWORD, "Rootstone");
		expect(state.getMaterialSpeedBonus()).toBe(0);
	});

	it("never drives speed below zero", () => {
		const state = makeState();
		state.setSpeed("walk", 5);
		equipWithMaterial(state, HEAVY_ARMOR, "Rootstone");
		expect(state.getWalkSpeed()).toBeGreaterThanOrEqual(0);
	});
});

describe("Material initiative bonus", () => {
	it("is empty with no materials equipped", () => {
		expect(makeState().getMaterialInitiativeBonuses()).toEqual([]);
	});

	it("reads Stormprism's +1 and names the material", () => {
		const state = makeState();
		equipWithMaterial(state, SWORD, "Stormprism");
		expect(state.getMaterialInitiativeBonuses()).toEqual([{name: "Stormprism", value: 1}]);
	});

	it("reaches the initiative total", () => {
		const state = makeState();
		const before = state.getInitiative();
		equipWithMaterial(state, SWORD, "Stormprism");
		expect(state.getInitiative()).toBe(before + 1);
	});

	it("reaches the initiative breakdown, so the total is explainable", () => {
		const state = makeState();
		equipWithMaterial(state, SWORD, "Stormprism");
		const breakdown = state.getInitiativeBreakdown();
		const entry = breakdown.components.find(c => c.name === "Stormprism");
		expect(entry).toBeTruthy();
		expect(entry.value).toBe(1);
		expect(entry.type).toBe("material");
	});

	it("keeps the breakdown total equal to getInitiative()", () => {
		const state = makeState();
		equipWithMaterial(state, SWORD, "Stormprism");
		const breakdown = state.getInitiativeBreakdown();
		expect(breakdown.canonical).toBe(state.getInitiative());
	});

	it("stacks across two materialled items", () => {
		const state = makeState();
		equipWithMaterial(state, SWORD, "Stormprism");
		equipWithMaterial(state, {...SWORD, name: "Shortsword", dmg1: "1d6"}, "Stormprism");
		expect(state.getInitiative()).toBe(state.getAbilityMod("dex") + 2);
	});
});

describe("Material damage reduction", () => {
	const getDr = (state) => state._data.namedModifiers.filter(m => m.type === "damageReduction" && m.sourceType === "itemMaterial");

	it("registers Adamantine's heavy-armour reduction as a real modifier", () => {
		const state = makeState();
		equipWithMaterial(state, HEAVY_ARMOR, "Adamantine");
		const dr = getDr(state);
		expect(dr.length).toBe(1);
		expect(dr[0].value).toBe(3);
		expect(dr[0].damageTypes).toEqual(["bludgeoning", "piercing", "slashing"]);
	});

	it("picks the medium-armour value on medium armour", () => {
		const state = makeState();
		equipWithMaterial(state, MEDIUM_ARMOR, "Adamantine");
		const dr = getDr(state);
		expect(dr.length).toBe(1);
		expect(dr[0].value).toBe(2);
	});

	it("applies neither on a weapon", () => {
		const state = makeState();
		equipWithMaterial(state, SWORD, "Adamantine");
		expect(getDr(state)).toEqual([]);
	});

	it("is idempotent — recalculating does not duplicate the modifier", () => {
		const state = makeState();
		equipWithMaterial(state, HEAVY_ARMOR, "Adamantine");
		state._recalculateEquipmentModifiers();
		state._recalculateEquipmentModifiers();
		expect(getDr(state).length).toBe(1);
	});
});

/**
 * The four tests above assert that the modifier is REGISTERED. Every one of them passed
 * while `takeDamage(10)` took exactly 10 — `applyDamageDefenses` handled immunity,
 * resistance and vulnerability and nothing else, and no code anywhere called
 * `aggregateModifiers("damageReduction")`. Registration and consumption are separate
 * claims and only the first had a test.
 */
describe("Material damage reduction is actually consumed", () => {
	/**
	 * Damage TAKEN, not HP remaining. Equipping armour recalculates max HP and clamps
	 * `current` to it, so a fixture that pins an absolute HP value before equipping is
	 * measuring the clamp as much as the reduction. The delta is the claim being made.
	 */
	const damageTaken = (state, amount, opts) => {
		state._data.hp.current = state.getMaxHp();
		const before = state.getCurrentHp();
		state.takeDamage(amount, opts);
		return before - state.getCurrentHp();
	};

	it("CONTROL — the harness moves a number at all, via resistance", () => {
		// Without this control every assertion below could pass on a state whose HP simply
		// never changes, and the suite would read as proof of a reduction that never ran.
		const state = makeState();
		state.addResistance("bludgeoning");
		expect(damageTaken(state, 10, {damageType: "bludgeoning"})).toBe(5);
	});

	it("CONTROL — an undefended character takes the full amount", () => {
		expect(damageTaken(makeState(), 10, {damageType: "bludgeoning"})).toBe(10);
	});

	it("Adamantine's 3 points come off the damage taken", () => {
		const state = makeState();
		equipWithMaterial(state, HEAVY_ARMOR, "Adamantine");
		expect(damageTaken(state, 10, {damageType: "bludgeoning"})).toBe(7);
	});

	it("does not reduce a damage type it is not scoped to", () => {
		const state = makeState();
		equipWithMaterial(state, HEAVY_ARMOR, "Adamantine");
		expect(damageTaken(state, 10, {damageType: "fire"})).toBe(10);
	});

	it("applies BEFORE resistance halves, per RAW — and the two orders differ", () => {
		// PHB: "Resistance and then vulnerability are applied after all other modifiers to
		// damage." The numbers are chosen so the orders are distinguishable:
		//   correct: (9 − 3) = 6, halved = 3
		//   wrong:   floor(9 / 2) = 4, − 3 = 1
		// An assertion that could not tell them apart would be no test of the ordering.
		const state = makeState();
		equipWithMaterial(state, HEAVY_ARMOR, "Adamantine");
		state.addResistance("bludgeoning");
		const result = state.applyDamageDefenses(9, "bludgeoning");
		expect(result.damage).toBe(3);
		expect(result.damage).not.toBe(1);
		expect(result).toMatchObject({raw: 9, reduction: 3, applied: "resistance"});
	});

	it("cannot take the damage below zero", () => {
		const state = makeState();
		equipWithMaterial(state, HEAVY_ARMOR, "Adamantine");
		expect(state.applyDamageDefenses(2, "bludgeoning").damage).toBe(0);
	});

	it("immunity still wins outright, without consuming the reduction", () => {
		const state = makeState();
		equipWithMaterial(state, HEAVY_ARMOR, "Adamantine");
		state.addImmunity("bludgeoning");
		expect(state.applyDamageDefenses(10, "bludgeoning")).toMatchObject({damage: 0, applied: "immunity"});
	});

	it("surfaces its damage types so the sheet's damage prompt asks for one", () => {
		// The prompt is built from resistances/immunities/vulnerabilities. A character whose
		// ONLY defence is a reduction would never be asked for a damage type, `damageType`
		// would arrive null, and this B/P/S-scoped reduction could not match — correct in the
		// model and unreachable through the UI.
		const state = makeState();
		expect(state.getDamageReductionDamageTypes()).toEqual([]);
		equipWithMaterial(state, HEAVY_ARMOR, "Adamantine");
		expect(state.getDamageReductionDamageTypes().sort()).toEqual(["bludgeoning", "piercing", "slashing"]);
	});

	it("materials are unconditional, so nothing asks about magical damage", () => {
		const state = makeState();
		equipWithMaterial(state, HEAVY_ARMOR, "Adamantine");
		expect(state.hasNonmagicalDamageReduction()).toBe(false);
		expect(state.getDamageReduction("bludgeoning", {isMagicalDamage: true}).total).toBe(3);
	});
});

/**
 * The channel is not materials-specific, and proving that is the point of this block:
 * Heavy Armor Master registers the identical modifier type through the feature-effect
 * registry and was equally inert. A fix that only worked for materials would pass every
 * test above and still leave the feat broken.
 */
describe("Damage reduction from the feature-effect registry (Heavy Armor Master)", () => {
	const withFeat = (name, source) => {
		const state = new CharacterSheetState();
		state.addClass({name: "Fighter", source: "PHB", level: 5});
		state._data.ac = {...(state._data.ac || {}), armor: {type: "heavy"}};
		state._processFeatRegistryEffects({name, source, id: "feat-ham"});
		return state;
	};

	const damageTaken = (state, amount, opts) => {
		state._data.hp.current = state.getMaxHp();
		const before = state.getCurrentHp();
		state.takeDamage(amount, opts);
		return before - state.getCurrentHp();
	};

	it("PHB: reduces nonmagical B/P/S by 3", () => {
		expect(damageTaken(withFeat("Heavy Armor Master", "PHB"), 10, {damageType: "slashing"})).toBe(7);
	});

	it("PHB: keeps its damage-type scope instead of reducing everything", () => {
		// The registry authors `damageTypes` and the bridge into `addNamedModifier` dropped
		// it, so the reduction silently applied to fire, psychic and every other type.
		expect(damageTaken(withFeat("Heavy Armor Master", "PHB"), 10, {damageType: "fire"})).toBe(10);
	});

	it("PHB: is suppressed when the damage is magical", () => {
		expect(damageTaken(withFeat("Heavy Armor Master", "PHB"), 10, {damageType: "slashing", isMagicalDamage: true})).toBe(10);
	});

	it("XPHB: scales with proficiency bonus rather than a flat 3", () => {
		const state = withFeat("Heavy Armor Master", "XPHB");
		expect(state.getProficiencyBonus()).toBe(3);
		expect(damageTaken(state, 10, {damageType: "slashing"})).toBe(7);
	});

	it("XPHB: is NOT suppressed by magical damage, because the 2024 feat dropped that limit", () => {
		// Keying the suppression on "the modifier has a condition" rather than on the
		// condition SAYING nonmagical would silently nerf this feat back to its 2014 text.
		// XPHB Heavy Armor Master still carries a condition ("while wearing heavy armor").
		const state = withFeat("Heavy Armor Master", "XPHB");
		expect(damageTaken(state, 10, {damageType: "slashing", isMagicalDamage: true})).toBe(7);
	});

	it("requires the heavy armour its condition names", () => {
		const state = withFeat("Heavy Armor Master", "PHB");
		state._data.ac.armor = {type: "light"};
		expect(damageTaken(state, 10, {damageType: "slashing"})).toBe(10);
		expect(state.getDamageReduction("slashing").suppressed[0]).toMatchObject({reason: "heavy armour not worn"});
	});

	it("only PHB advertises the magical question", () => {
		expect(withFeat("Heavy Armor Master", "PHB").hasNonmagicalDamageReduction()).toBe(true);
		expect(withFeat("Heavy Armor Master", "XPHB").hasNonmagicalDamageReduction()).toBe(false);
	});

	it("stacks with a material reduction rather than one shadowing the other", () => {
		const state = withFeat("Heavy Armor Master", "PHB");
		state.setItemMaterialCatalog(CATALOG);
		equipWithMaterial(state, HEAVY_ARMOR, "Adamantine");
		state._data.ac.armor = {type: "heavy"};
		expect(state.getDamageReduction("slashing").total).toBe(6);
	});
});
