/**
 * R26 #1 — Combat folds weapon-type-scoped item damage into the damage roll.
 *
 * `_rollDamage` reads `state.getItemWeaponScopedDamageContributions(attack)` and must:
 *   - add each contribution's value into the reported `modifier` (totalBonus), and
 *   - label each contribution in the breakdown subtitle (e.g. "+ 2 (Bracers of Archery)").
 * This pins the integration point in isolation (the contribution-resolution logic itself
 * is unit-tested at the state level in CharacterSheetItemBracersStaff.test.js).
 */

import "./setup.js";
import "../../../js/charactersheet/charactersheet-combat.js";

const CharacterSheetCombat = globalThis.CharacterSheetCombat;

function makeCombat (contribs) {
	const combat = Object.create(CharacterSheetCombat.prototype);
	const attack = {
		id: "atk1",
		name: "Longbow",
		damage: "1d8",
		damageType: "Piercing",
		abilityMod: "dex",
		isRanged: true,
		sourceItem: {name: "Longbow", baseItem: null},
	};
	combat._state = {
		getAttacks: () => [attack],
		getWeaponAbilityMod: () => 3, // +3 dex
		getNamedModifiersByType: () => [],
		getItemWeaponScopedDamageContributions: () => contribs,
		getFeatureCalculations: () => ({}),
	};
	let shown = null;
	combat._page = {
		showDiceResult: (payload) => { shown = payload; },
		pAnimateDamageDice: () => {},
	};
	// Stub the combat helpers that are not under test so the math is isolated.
	combat._parseDamage = () => ({total: 5, sides: 8, rolls: [5]});
	combat._canApplySneakAttack = () => false;
	combat._resolveChannelRiderDamage = () => ({channelSpell: null, channelSpellRoll: null, channelSpellDamage: 0, riderMatched: false});
	combat._promptUseCombatMethod = async () => null;
	return {combat, getShown: () => shown};
}

describe("R26 #1 — combat damage roll integrates item weapon-scoped bonus", () => {
	it("adds the Bracers contribution to the modifier and labels it in the subtitle", async () => {
		const {combat, getShown} = makeCombat([{name: "Bracers of Archery", value: 2}]);
		await combat._rollDamage("atk1", false);
		const shown = getShown();
		expect(shown).toBeTruthy();
		// abilityMod 3 + bracers 2 = 5
		expect(shown.modifier).toBe(5);
		expect(shown.subtitle).toContain("+ 2 (Bracers of Archery)");
	});

	it("does not change the modifier when there are no contributions", async () => {
		const {combat, getShown} = makeCombat([]);
		await combat._rollDamage("atk1", false);
		const shown = getShown();
		expect(shown.modifier).toBe(3); // dex only
		expect(shown.subtitle).not.toContain("Bracers");
	});

	it("sums and labels multiple contributions", async () => {
		const {combat, getShown} = makeCombat([
			{name: "Bracers of Archery", value: 2},
			{name: "Quiver of Sharpness", value: 1},
		]);
		await combat._rollDamage("atk1", false);
		const shown = getShown();
		expect(shown.modifier).toBe(6); // 3 + 2 + 1
		expect(shown.subtitle).toContain("+ 2 (Bracers of Archery)");
		expect(shown.subtitle).toContain("+ 1 (Quiver of Sharpness)");
	});
});
