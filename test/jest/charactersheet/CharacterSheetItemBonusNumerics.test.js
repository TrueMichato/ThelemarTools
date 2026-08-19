/**
 * Item bonus numerics — Unit Tests
 *
 * `bonusWeapon` is authored as a SIGNED STRING. All 190 of them in the site catalogue are
 * `"+1"` / `"+2"` / `"+3"`, never numbers, and the same is true of `bonusAc` and
 * `bonusSpellAttack`. `getEffectiveItemBonuses` used to pass that raw text straight through
 * while coercing everything around it, so a caller doing the obvious
 *
 *     (eff.bonusWeapon || 0) + (eff.bonusWeaponAttack || 0)
 *
 * concatenated instead of adding, and a +2 longsword with three upgrades reported an attack
 * bonus of `"2200"`. Twenty-one call sites across four modules made exactly that mistake.
 *
 * These tests pin the two halves of the fix: the derivation returns NUMBERS for every numeric
 * field, and it exposes `totalAttackBonus` / `totalDamageBonus` already folded, so no reader
 * has to know that `bonusWeapon` applies to both axes.
 */

import "./setup.js";
import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-upgrades.js";

const CharacterSheetState = globalThis.CharacterSheetState;
const CharacterSheetUpgrades = globalThis.CharacterSheetUpgrades;

const UPGRADES = [
	{name: "Balanced", source: "TCAH", upgradeType: ["WU:1"], entries: ["+1 attack."]},
	{name: "Wounding: Keen", source: "TCAH", upgradeType: ["WU:1"], entries: ["+1 damage."]},
	{name: "Masterwork", source: "TCAH", upgradeType: ["WU:3"], entries: ["+1 attack and damage."]},
	{name: "Superior", source: "TCAH", upgradeType: ["WU:2"], entries: ["Die up one size."]},
	{name: "Critical: Sharpened", source: "TCAH", upgradeType: ["WU:1"], entries: ["Crit range."]},
];

const mkState = () => {
	CharacterSheetUpgrades.setUpgradeCatalog?.(UPGRADES);
	const state = new CharacterSheetState();
	state.addClass({name: "Fighter", source: "PHB", level: 5});
	return state;
};

const addSword = (state, over = {}) => {
	state.addItem({
		name: "Longsword",
		source: "PHB",
		type: "M",
		weapon: true,
		weaponCategory: "martial",
		dmg1: "1d8",
		dmgType: "S",
		weight: 3,
		value: 1500,
		quantity: 1,
		equipped: true,
		...over,
	});
	return state.getItems().slice(-1)[0].id;
};

const applyAll = (state, id, names) => {
	for (const name of names) state.applyItemUpgrade(id, UPGRADES.find(u => u.name === name), 0);
};

describe("getEffectiveItemBonuses — the derivation absorbs the authored format", () => {
	// ==========================================================================
	// Every numeric field comes back a number
	// ==========================================================================
	it("coerces a signed-string bonusWeapon to a number", () => {
		const state = mkState();
		const id = addSword(state, {bonusWeapon: "+2"});
		const eff = state.getEffectiveItemBonuses(id);
		expect(typeof eff.bonusWeapon).toBe("number");
		expect(eff.bonusWeapon).toBe(2);
	});

	it("coerces a NEGATIVE signed-string bonus", () => {
		const state = mkState();
		const id = addSword(state, {bonusWeapon: "-1"});
		expect(state.getEffectiveItemBonuses(id).bonusWeapon).toBe(-1);
	});

	it("coerces every other authored-as-string numeric field", () => {
		const state = mkState();
		const id = addSword(state, {
			bonusWeaponAttack: "+1",
			bonusWeaponDamage: "+3",
			bonusSpellAttack: "+2",
			bonusSpellSaveDc: "+1",
		});
		const eff = state.getEffectiveItemBonuses(id);
		for (const k of ["bonusWeaponAttack", "bonusWeaponDamage", "bonusSpellAttack", "bonusSpellSaveDc"]) {
			expect(typeof eff[k]).toBe("number");
		}
		expect(eff.bonusWeaponAttack).toBe(1);
		expect(eff.bonusWeaponDamage).toBe(3);
		expect(eff.bonusSpellAttack).toBe(2);
		expect(eff.bonusSpellSaveDc).toBe(1);
	});

	it("reports zero — never NaN — for an unparseable bonus", () => {
		const state = mkState();
		const id = addSword(state, {bonusWeapon: "magical"});
		const eff = state.getEffectiveItemBonuses(id);
		expect(eff.bonusWeapon).toBe(0);
		expect(Number.isNaN(eff.totalAttackBonus)).toBe(false);
		expect(eff.totalAttackBonus).toBe(0);
	});

	it("leaves a plain weapon at zero on both axes", () => {
		const state = mkState();
		const id = addSword(state);
		const eff = state.getEffectiveItemBonuses(id);
		expect(eff.totalAttackBonus).toBe(0);
		expect(eff.totalDamageBonus).toBe(0);
	});

	it("keeps the default crit threshold numeric", () => {
		const state = mkState();
		const eff = state.getEffectiveItemBonuses(addSword(state));
		expect(eff.critThreshold).toBe(20);
	});

	// ==========================================================================
	// The folded totals
	// ==========================================================================
	it("folds bonusWeapon into BOTH axes", () => {
		const state = mkState();
		const id = addSword(state, {bonusWeapon: "+2"});
		const eff = state.getEffectiveItemBonuses(id);
		expect(eff.totalAttackBonus).toBe(2);
		expect(eff.totalDamageBonus).toBe(2);
	});

	it("keeps a per-axis bonus on its own axis only", () => {
		const state = mkState();
		const id = addSword(state, {bonusWeaponDamage: "+3"});
		const eff = state.getEffectiveItemBonuses(id);
		expect(eff.totalAttackBonus).toBe(0);
		expect(eff.totalDamageBonus).toBe(3);
	});

	it("sums bonusWeapon and a per-axis bonus arithmetically, not textually", () => {
		const state = mkState();
		const id = addSword(state, {bonusWeapon: "+2", bonusWeaponAttack: "+1"});
		const eff = state.getEffectiveItemBonuses(id);
		// The historic failure produced the string "21" here.
		expect(eff.totalAttackBonus).toBe(3);
		expect(typeof eff.totalAttackBonus).toBe("number");
	});

	// ==========================================================================
	// The user's reported loadout
	// ==========================================================================
	it("gives a +2 weapon with Balanced + Wounding:Keen + Masterwork +4 on each axis", () => {
		const state = mkState();
		const id = addSword(state, {bonusWeapon: "+2"});
		applyAll(state, id, ["Balanced", "Wounding: Keen", "Masterwork"]);

		const eff = state.getEffectiveItemBonuses(id);
		// attack: 2 (weapon) + 1 (Balanced) + 1 (Masterwork)
		expect(eff.totalAttackBonus).toBe(4);
		// damage: 2 (weapon) + 1 (Wounding: Keen) + 1 (Masterwork)
		expect(eff.totalDamageBonus).toBe(4);
	});

	it("agrees with getEffectiveWeaponDamage on the same weapon", () => {
		const state = mkState();
		const id = addSword(state, {bonusWeapon: "+2"});
		applyAll(state, id, ["Balanced", "Wounding: Keen", "Masterwork"]);

		const eff = state.getEffectiveItemBonuses(id);
		const dmg = state.getEffectiveWeaponDamage(id);
		expect(dmg.attackBonus).toBe(eff.totalAttackBonus);
		expect(dmg.flat).toBe(eff.totalDamageBonus);
		expect(dmg.display).toContain("+4");
	});

	// ==========================================================================
	// Upgrades still land on top of the coerced base
	// ==========================================================================
	it("adds upgrade attack bonuses to a string-authored bonusWeapon", () => {
		const state = mkState();
		const id = addSword(state, {bonusWeapon: "+1"});
		applyAll(state, id, ["Balanced"]);
		expect(state.getEffectiveItemBonuses(id).totalAttackBonus).toBe(2);
	});

	it("keeps a crit-threshold upgrade numeric", () => {
		const state = mkState();
		const id = addSword(state, {bonusWeapon: "+1"});
		applyAll(state, id, ["Critical: Sharpened"]);
		const eff = state.getEffectiveItemBonuses(id);
		expect(eff.critThreshold).toBe(19);
		expect(typeof eff.critThreshold).toBe("number");
	});

	it("keeps a die-step upgrade off the flat totals", () => {
		const state = mkState();
		const id = addSword(state, {bonusWeapon: "+1"});
		applyAll(state, id, ["Superior"]);
		const eff = state.getEffectiveItemBonuses(id);
		expect(eff.damageDieIncrease).toBe(1);
		expect(eff.totalDamageBonus).toBe(1);
	});

	// ==========================================================================
	// The empty case a caller must survive
	// ==========================================================================
	it("returns an empty object for an unknown id, so `|| 0` guards hold", () => {
		const eff = mkState().getEffectiveItemBonuses("nope");
		expect(eff).toEqual({});
		expect(eff.totalAttackBonus || 0).toBe(0);
	});
});
