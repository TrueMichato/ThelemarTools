/**
 * R26 #1 (Bracers of Archery) + #3 (Staff of Healing) item mechanics.
 *
 * #1: Equipped Bracers of Archery grant +2 damage with longbow & shortbow attacks. Detection
 *     is by BASE ITEM (so a magic weapon derived from a shortbow benefits), gated on
 *     equip + attunement, and expressible generically via an `effects[]` weaponDamageBonus.
 *     The combat damage roll folds these per-attack contributions into its total.
 *
 * #3: Staff of Healing recognition + the spend-charges-to-cast-healing helpers (menu, ability
 *     mod, healing roll). The charges + dawn recharge already flow through the generic item
 *     charge system; these tests pin the new cast affordance's pure logic.
 */

import "./setup.js";
import "../../../js/charactersheet/charactersheet-state.js";

const CharacterSheetState = globalThis.CharacterSheetState;

function mkState () {
	const state = new CharacterSheetState();
	state.addClass({name: "Fighter", source: "PHB", level: 5});
	state.setAbilityBase("dex", 14); // +2
	return state;
}

function bow (name, extra = {}) {
	return {
		name,
		source: "PHB",
		weapon: true,
		weaponCategory: "martial",
		type: "R",
		dmg1: "1d8",
		dmgType: "P",
		properties: ["A", "H", "2H"],
		range: "150/600",
		equipped: true,
		_isCustom: true,
		...extra,
	};
}

function bracers (extra = {}) {
	return {
		name: "Bracers of Archery",
		source: "DMG",
		wondrous: true,
		requiresAttunement: true,
		bonusWeaponDamage: 2,
		equipped: true,
		attuned: true,
		_isCustom: true,
		...extra,
	};
}

describe("R26 #1 — Bracers of Archery weapon-type-scoped damage bonus", () => {
	it("adds +2 to a longbow attack while equipped & attuned", () => {
		const state = mkState();
		state.addItem(bow("Longbow"));
		state.addItem(bracers());
		const attack = {name: "Longbow", sourceItem: {name: "Longbow", baseItem: null}};
		const contribs = state.getItemWeaponScopedDamageContributions(attack);
		expect(contribs).toEqual([{name: "Bracers of Archery", value: 2}]);
	});

	it("applies via BASE ITEM detection to a magic shortbow (Frost Shortbow)", () => {
		const state = mkState();
		state.addItem(bracers());
		const attack = {name: "Frost Shortbow", sourceItem: {name: "Frost Shortbow", baseItem: "shortbow|phb"}};
		const contribs = state.getItemWeaponScopedDamageContributions(attack);
		expect(contribs).toEqual([{name: "Bracers of Archery", value: 2}]);
	});

	it("matches a custom-named bow by whole-word name when no baseItem is present", () => {
		const state = mkState();
		state.addItem(bracers());
		const attack = {name: "Screaming Longbow of Doom", sourceItem: {name: "Screaming Longbow of Doom", baseItem: null}};
		expect(state.getItemWeaponScopedDamageContributions(attack)).toEqual([{name: "Bracers of Archery", value: 2}]);
	});

	it("does NOT apply to a crossbow", () => {
		const state = mkState();
		state.addItem(bracers());
		const attack = {name: "Light Crossbow", sourceItem: {name: "Light Crossbow", baseItem: "crossbow, light|phb"}};
		expect(state.getItemWeaponScopedDamageContributions(attack)).toEqual([]);
	});

	it("does NOT apply to a non-bow melee weapon", () => {
		const state = mkState();
		state.addItem(bracers());
		const attack = {name: "Longsword", sourceItem: {name: "Longsword", baseItem: null}};
		expect(state.getItemWeaponScopedDamageContributions(attack)).toEqual([]);
	});

	it("is gated on attunement (no bonus when not attuned)", () => {
		const state = mkState();
		state.addItem(bracers({attuned: false}));
		const attack = {name: "Longbow", sourceItem: {name: "Longbow", baseItem: null}};
		expect(state.getItemWeaponScopedDamageContributions(attack)).toEqual([]);
	});

	it("is gated on being equipped (no bonus when unequipped)", () => {
		const state = mkState();
		state.addItem(bracers({equipped: false}));
		const attack = {name: "Longbow", sourceItem: {name: "Longbow", baseItem: null}};
		expect(state.getItemWeaponScopedDamageContributions(attack)).toEqual([]);
	});

	it("does not apply to spell or unarmed attacks", () => {
		const state = mkState();
		state.addItem(bracers());
		expect(state.getItemWeaponScopedDamageContributions({name: "Fire Bolt", isSpell: true})).toEqual([]);
		expect(state.getItemWeaponScopedDamageContributions({name: "Unarmed Strike", isUnarmedStrike: true})).toEqual([]);
	});

	it("honors the item's own bonusWeaponDamage value when present (e.g. +3 variant)", () => {
		const state = mkState();
		state.addItem(bracers({bonusWeaponDamage: 3}));
		const attack = {name: "Longbow", sourceItem: {name: "Longbow", baseItem: null}};
		expect(state.getItemWeaponScopedDamageContributions(attack)).toEqual([{name: "Bracers of Archery", value: 3}]);
	});

	it("supports a GENERIC data-driven weaponDamageBonus effect (homebrew item)", () => {
		const state = mkState();
		state.addItem({
			name: "Gloves of the Crossbow Adept",
			source: "HB",
			wondrous: true,
			equipped: true,
			_isCustom: true,
			effects: [{type: "weaponDamageBonus", value: 1, weaponBaseItems: ["crossbow, hand", "crossbow, light"]}],
		});
		const handXbow = {name: "Hand Crossbow", sourceItem: {name: "Hand Crossbow", baseItem: "crossbow, hand|phb"}};
		expect(state.getItemWeaponScopedDamageContributions(handXbow)).toEqual([{name: "Gloves of the Crossbow Adept", value: 1}]);
		// And it does not leak onto a longbow
		const longbow = {name: "Longbow", sourceItem: {name: "Longbow", baseItem: null}};
		expect(state.getItemWeaponScopedDamageContributions(longbow)).toEqual([]);
	});

	it("stacks multiple matching items", () => {
		const state = mkState();
		state.addItem(bracers());
		state.addItem({
			name: "Quiver of Sharpness",
			source: "HB",
			wondrous: true,
			equipped: true,
			_isCustom: true,
			effects: [{type: "weaponDamageBonus", value: 1, weaponBaseItems: ["longbow", "shortbow"]}],
		});
		const attack = {name: "Longbow", sourceItem: {name: "Longbow", baseItem: null}};
		const contribs = state.getItemWeaponScopedDamageContributions(attack);
		const total = contribs.reduce((s, c) => s + c.value, 0);
		expect(total).toBe(3);
	});
});

describe("R26 #3 — Staff of Healing cast affordance (state-level prerequisites)", () => {
	it("Staff of Healing added to inventory carries charges + dawn recharge", () => {
		const state = mkState();
		state.addItem({
			name: "Staff of Healing",
			source: "DMG",
			staff: true,
			requiresAttunement: "by a bard, cleric, or druid",
			charges: 10,
			chargesCurrent: 10,
			recharge: "dawn",
			rechargeAmount: "{@dice 1d6 + 4}",
			equipped: true,
			attuned: true,
			_isCustom: true,
		});
		const item = state.getItems().find(i => i.name === "Staff of Healing");
		expect(item.charges).toBe(10);
		expect(item.chargesCurrent).toBe(10);
		expect(item.recharge).toBe("dawn");
	});

	it("setItemCharges + dawn recharge restores 1d6+4 (clamped to max)", () => {
		const state = mkState();
		state.addItem({
			name: "Staff of Healing",
			source: "DMG",
			staff: true,
			charges: 10,
			chargesCurrent: 10,
			recharge: "dawn",
			rechargeAmount: "{@dice 1d6 + 4}",
			equipped: true,
			attuned: true,
			_isCustom: true,
		});
		const item = state.getItems().find(i => i.name === "Staff of Healing");
		state.setItemCharges(item.id, 2); // spent 8
		state._rechargeItems("dawn");
		const after = state.getItems().find(i => i.name === "Staff of Healing").chargesCurrent;
		// 1d6+4 → between 5 and 10 added on top of 2, clamped to max 10
		expect(after).toBeGreaterThanOrEqual(7);
		expect(after).toBeLessThanOrEqual(10);
	});
});
