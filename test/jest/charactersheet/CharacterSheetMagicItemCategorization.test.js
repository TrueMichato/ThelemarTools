/**
 * Character Sheet — Magic item categorization + weapon-attack surfacing.
 *
 * Two tightly-coupled bugs shared one root cause: stored inventory items carry a COARSE `type`
 * string (produced by `_getItemType`), yet the render-time categoriser tested RAW 5etools codes
 * ("P"/"WD"/"ST"/"RG") and an `item.wondrous` flag that was never persisted — so every magic
 * staff/wand/ring/wondrous item collapsed into "Other". Separately, a `type:"M"`/`type:"R"`
 * artifact (Gae Bolg) carries NO `weapon:true` flag, so the pre-fix add path stored `weapon:false`,
 * which ALSO denied it an attack (Combat generates attacks from `items.filter(i => i.weapon)`).
 *
 * These tests pin:
 *   - `state.addItem` derives the `weapon` flag from raw weapon type codes (the builder/raw path);
 *   - `_getItemType` handles source-suffixed codes ("RG|DMG") and boolean flags ("staff":true);
 *   - `_getItemCategory` maps the coarse stored type so nothing magic falls into "Other";
 *   - `_migrateInventoryItemWeaponFlag` repairs the `weapon` flag on pre-fix saves (idempotently).
 */

import "./setup.js";

if (typeof globalThis.document === "undefined") {
	globalThis.document = {
		addEventListener () {},
		getElementById () { return null; },
		querySelector () { return null; },
		querySelectorAll () { return []; },
	};
}

if (typeof globalThis.Parser?.dmgTypeToFull !== "function") {
	globalThis.Parser = globalThis.Parser || {};
	globalThis.Parser.dmgTypeToFull = (c) => ({S: "slashing", P: "piercing", B: "bludgeoning"}[c] || c);
}

if (typeof globalThis.CharacterSheetUpgrades === "undefined") {
	globalThis.CharacterSheetUpgrades = {
		isWeapon: () => false,
		isArmor: () => false,
		isShield: () => false,
		getUpgradeEffects: () => ({tags: [], notes: []}),
		getGemstoneSummary: () => "",
	};
}

import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-inventory.js";

const CharacterSheetState = globalThis.CharacterSheetState;
const CharacterSheetInventory = globalThis.CharacterSheetInventory;

function newState () {
	const state = new CharacterSheetState();
	state.addClass({name: "Fighter", source: "PHB", level: 5});
	state.setAbilityBase("str", 16);
	state.setAbilityBase("dex", 14);
	return state;
}

function makeInventory (state) {
	const inv = new CharacterSheetInventory({getState: () => state});
	inv._page = {getState: () => state, renderCharacter: () => {}, saveCharacter: () => {}};
	return inv;
}

function lastAdded (state) {
	const items = state.getItems();
	return items[items.length - 1];
}

/** The combat attack generator's entry gate (charactersheet-combat.js). */
function isAttackEligible (state, id) {
	return state.getItems().some(i => i.id === id && i.weapon && i.equipped);
}

describe("state.addItem derives the weapon flag from raw type codes (builder/raw path)", () => {
	test("a raw type:'M' weapon with NO weapon flag becomes weapon:true and attack-eligible", () => {
		const state = newState();
		// Mirrors a builder-added raw data-file weapon: type code only, no boolean flag.
		state.addItem({name: "Raw Greatsword", source: "PHB", type: "M", weaponCategory: "martial", dmg1: "2d6", dmgType: "S"});
		const added = lastAdded(state);
		expect(added.weapon).toBe(true);

		state.setItemEquipped(added.id, true);
		expect(isAttackEligible(state, added.id)).toBe(true);
		expect(state.getWeaponDamageDie(added)).toBe("2d6");
	});

	test("Gae Bolg (type:'M' artifact, no weapon flag) is attack-eligible with its 4d10 die", () => {
		const state = newState();
		state.addItem({name: "Gae Bolg", source: "TGTT", type: "M", weaponCategory: "simple", dmg1: "4d10", dmgType: "P", bonusWeapon: "+4", rarity: "artifact"});
		const gae = lastAdded(state);
		expect(gae.weapon).toBe(true);

		state.setItemEquipped(gae.id, true);
		expect(isAttackEligible(state, gae.id)).toBe(true);
		expect(state.getWeaponDamageDie(gae)).toBe("4d10");
	});

	test("a raw type:'R' ranged weapon is flagged", () => {
		const state = newState();
		state.addItem({name: "Raw Longbow", source: "PHB", type: "R", weaponCategory: "martial", dmg1: "1d8", dmgType: "P"});
		expect(lastAdded(state).weapon).toBe(true);
	});

	test("non-weapon raw items (a wand) are NOT flagged as weapons", () => {
		const state = newState();
		state.addItem({name: "Wand of Magic Missiles", source: "DMG", type: "WD|DMG", charges: 7});
		expect(lastAdded(state).weapon).toBe(false);
	});

	test("an explicit weapon:false from the inventory module is not overridden", () => {
		const state = newState();
		state.addItem({name: "Not A Weapon", source: "DMG", type: "wondrous", weapon: false});
		expect(lastAdded(state).weapon).toBe(false);
	});
});

describe("_getItemType classifies source-suffixed codes and boolean flags", () => {
	let inv;
	beforeEach(() => { inv = makeInventory(newState()); });

	test.each([
		["Ring of Protection", {type: "RG|DMG"}, "ring"],
		["Wand of Missiles", {type: "WD|DMG"}, "wand"],
		["Rod of Lordly Might", {type: "RD|DMG"}, "rod"],
		["Scroll", {type: "SC|XPHB"}, "scroll"],
		["Potion", {type: "P|DMG"}, "potion"],
		["Staff of Power (DMG, staff flag)", {staff: true}, "staff"],
		["Robe of the Archmagi", {wondrous: true}, "wondrous"],
		["Gae Bolg", {type: "M", weaponCategory: "simple"}, "weapon"],
	])("%s => %s", (_name, item, expected) => {
		expect(inv._getItemType(item)).toBe(expected);
	});
});

describe("_getItemCategory keeps magic items out of 'Other'", () => {
	let state; let inv;
	beforeEach(() => { state = newState(); inv = makeInventory(state); });

	/** Add a catalog item through the real state path, return the STORED (coarse) form. */
	function addStored (raw) {
		state.addItem(raw);
		return lastAdded(state);
	}

	test.each([
		["Gae Bolg", {name: "Gae Bolg", source: "TGTT", type: "M", weaponCategory: "simple", dmg1: "4d10", dmgType: "P"}, "Weapons"],
		["Staff of Power (DMG)", {name: "Staff of Power", source: "DMG", staff: true}, "Wondrous Items"],
		["Ring of Protection", {name: "Ring of Protection", source: "DMG", type: "RG|DMG"}, "Wondrous Items"],
		["Wand of Missiles", {name: "Wand of Magic Missiles", source: "DMG", type: "WD|DMG"}, "Wondrous Items"],
		["Rod of Lordly Might", {name: "Rod of Lordly Might", source: "DMG", type: "RD|DMG"}, "Wondrous Items"],
		["Robe of the Archmagi", {name: "Robe of the Archmagi", source: "DMG", wondrous: true}, "Wondrous Items"],
		["Potion of Healing", {name: "Potion of Healing", source: "DMG", type: "P"}, "Consumables"],
		["Spell Scroll", {name: "Spell Scroll", source: "DMG", type: "SC"}, "Consumables"],
	])("%s stores + categorises as %s (never 'Other')", (_n, raw, expectedCategory) => {
		const stored = addStored(raw);
		const category = inv._getItemCategory(stored);
		expect(category).not.toBe("Other");
		expect(category).toBe(expectedCategory);
	});
});

describe("_migrateInventoryItemWeaponFlag repairs pre-fix saves", () => {
	function stateWithInventory (inventory) {
		const state = new CharacterSheetState();
		state._data.inventory = inventory;
		return state;
	}

	test("promotes a stored coarse type:'weapon' item that was saved weapon:false", () => {
		const state = stateWithInventory([
			{id: "gae", item: {name: "Gae Bolg", type: "weapon", weapon: false, weaponCategory: "simple", dmg1: "4d10"}, quantity: 1, equipped: true},
		]);
		state._migrateInventoryItemWeaponFlag();
		expect(state.getItems().find(i => i.id === "gae").weapon).toBe(true);
	});

	test("promotes a raw type:'M' item saved without a weapon flag", () => {
		const state = stateWithInventory([
			{id: "raw", item: {name: "Old Sword", type: "M", weaponCategory: "martial"}, quantity: 1, equipped: false},
		]);
		state._migrateInventoryItemWeaponFlag();
		expect(state.getItems().find(i => i.id === "raw").weapon).toBe(true);
	});

	test("does NOT flag non-weapons (a wand / gear with no weapon signals)", () => {
		const state = stateWithInventory([
			{id: "wand", item: {name: "Wand", type: "wand", weapon: false}, quantity: 1},
			{id: "gear", item: {name: "Rope", type: "gear"}, quantity: 1},
		]);
		state._migrateInventoryItemWeaponFlag();
		const items = state.getItems();
		expect(items.find(i => i.id === "wand").weapon).toBe(false);
		expect(!!items.find(i => i.id === "gear").weapon).toBe(false);
	});

	test("is idempotent — repeated runs never clobber an existing true flag", () => {
		const state = stateWithInventory([
			{id: "gae", item: {name: "Gae Bolg", type: "weapon", weapon: false, weaponCategory: "simple"}, quantity: 1},
		]);
		state._migrateInventoryItemWeaponFlag();
		state._migrateInventoryItemWeaponFlag();
		expect(state.getItems().find(i => i.id === "gae").weapon).toBe(true);
	});
});
