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
