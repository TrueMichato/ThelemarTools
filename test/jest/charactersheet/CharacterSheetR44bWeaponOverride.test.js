/**
 * Bug 4 (R44-b) — Weapon attack override (DEX-instead-of-STR) persistence.
 *
 * `getItems()` returns SHALLOW copies of `_data.inventory[].item`, so the combat
 * attack editor's write of `attackOverrides.abilityMod` landed on a throwaway copy
 * and was lost on save/reload — the weapon kept using STR. The new state method
 * `updateInventoryItemAttackOverrides()` persists overrides onto the backing item.
 *
 * Verifies:
 *   - the override lands on the real inventory item and is visible via getItems();
 *   - a null field clears the override (Reset action);
 *   - the override round-trips through serialize()/loadFromJson().
 */

import "./setup.js";

let CharacterSheetState;
let state;

beforeAll(async () => {
	CharacterSheetState = (await import("../../../js/charactersheet/charactersheet-state.js")).CharacterSheetState;
});

function addQuarterstaff () {
	// Minimal melee weapon item; STR by default (no finesse).
	const id = "qs_test_1";
	state.addItem({
		id,
		name: "Quarterstaff",
		type: "M",
		weapon: true,
		dmg1: "1d6",
		dmgType: "B",
		property: [],
	});
	return id;
}

describe("Bug 4 — weapon attack override persistence", () => {
	beforeEach(() => {
		state = new CharacterSheetState();
	});

	test("updateInventoryItemAttackOverrides persists onto the backing inventory item", () => {
		const id = addQuarterstaff();
		const ok = state.updateInventoryItemAttackOverrides(id, {
			attackOverrides: {abilityMod: "dex", name: "Quarterstaff", isMelee: true},
			customAttackBonus: 0,
			customDamageBonus: 0,
		});
		expect(ok).toBe(true);

		const item = state.getItems().find(i => i.id === id);
		expect(item.attackOverrides).toBeDefined();
		expect(item.attackOverrides.abilityMod).toBe("dex");
	});

	test("the override is a real copy, not a reference to the caller's object", () => {
		const id = addQuarterstaff();
		const overrides = {abilityMod: "dex"};
		state.updateInventoryItemAttackOverrides(id, {attackOverrides: overrides});
		overrides.abilityMod = "str"; // mutate the caller's object after the fact
		const item = state.getItems().find(i => i.id === id);
		expect(item.attackOverrides.abilityMod).toBe("dex");
	});

	test("passing null clears the override (Reset action)", () => {
		const id = addQuarterstaff();
		state.updateInventoryItemAttackOverrides(id, {attackOverrides: {abilityMod: "dex"}});
		state.updateInventoryItemAttackOverrides(id, {
			attackOverrides: null,
			customAttackBonus: null,
			customDamageBonus: null,
		});
		const item = state.getItems().find(i => i.id === id);
		expect(item.attackOverrides).toBeUndefined();
	});

	test("returns false for an unknown item id", () => {
		expect(state.updateInventoryItemAttackOverrides("nope", {attackOverrides: {abilityMod: "dex"}})).toBe(false);
	});

	test("the DEX override round-trips through serialize()/loadFromJson()", () => {
		const id = addQuarterstaff();
		state.updateInventoryItemAttackOverrides(id, {
			attackOverrides: {abilityMod: "dex", name: "Quarterstaff", isMelee: true},
		});

		const serialized = state.serialize();
		const reloaded = new CharacterSheetState();
		reloaded.loadFromJson(serialized);

		const item = reloaded.getItems().find(i => i.name === "Quarterstaff");
		expect(item).toBeDefined();
		expect(item.attackOverrides?.abilityMod).toBe("dex");
	});
});
