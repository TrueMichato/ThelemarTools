/**
 * Spell buff effects on character HP — Aid and friends.
 *
 * These tests lock the contract that any active state carrying a
 * `{type: "hpMaxIncrease", value: N}` custom effect adds N to the character's
 * max HP for as long as it is active, and that activation bumps current HP by
 * the same delta (RAW for Aid). Deactivation drops max back down and caps
 * current to the new max, but never raises current.
 *
 * Background: SPELL_BUFF_REGISTRY has had an `aid` entry shipping
 * `hpMaxIncrease` effects for some time, but no consumer ever applied the
 * delta — so casting Aid was cosmetic. This suite exists to prevent that
 * regression and to support the Combat tab "Apply Buff" picker which lets
 * non-spellcaster characters track buffs cast on them.
 */

import "./setup.js";
import "../../../js/charactersheet/charactersheet-state.js";

const CharacterSheetState = globalThis.CharacterSheetState;

const buildL5Fighter = () => {
	const state = new CharacterSheetState();
	state.setAbilityBase("con", 14); // +2
	state.addClass({name: "Fighter", source: "PHB", level: 5});
	for (let lvl = 1; lvl <= 5; lvl++) {
		state.recordLevelChoice({level: lvl, class: {name: "Fighter", source: "PHB"}, choices: {}, complete: true});
	}
	state.recalculateHp({syncCurrent: true});
	return state;
};

const aidEffects = (value = 5) => [{type: "hpMaxIncrease", value}];

const activateAid = (state, {value = 5, sourceFeatureId = "spell_Aid_test"} = {}) => state.activateState("custom", {
	name: "Aid",
	icon: "✨",
	description: "Spell effect: Aid",
	sourceFeatureId,
	customEffects: aidEffects(value),
	isSpellEffect: true,
	duration: {amount: 8, unit: "hour"},
});

describe("CharacterSheetSpellBuffEffects — hpMaxIncrease", () => {
	describe("Aid (base)", () => {
		it("bumps max HP by 5 and current HP by 5 when activated at full HP", () => {
			const state = buildL5Fighter();
			expect(state.getMaxHp()).toBe(44);
			expect(state.getCurrentHp()).toBe(44);

			activateAid(state);

			expect(state.getMaxHp()).toBe(49);
			expect(state.getCurrentHp()).toBe(49);
		});

		it("bumps current HP by the delta even when below max", () => {
			const state = buildL5Fighter();
			state.setCurrentHp(20);

			activateAid(state);

			expect(state.getMaxHp()).toBe(49);
			// 20 + 5 (delta) = 25 — Aid grants both max and current per RAW.
			expect(state.getCurrentHp()).toBe(25);
		});

		it("does not exceed new max when bumping current", () => {
			const state = buildL5Fighter();
			state.setCurrentHp(46); // already over old max via some other system; defensive
			activateAid(state);
			expect(state.getMaxHp()).toBe(49);
			expect(state.getCurrentHp()).toBeLessThanOrEqual(49);
		});

		it("exposes the contribution in getHpBreakdown.spellEffects", () => {
			const state = buildL5Fighter();
			activateAid(state);
			const bd = state.getHpBreakdown();
			expect(bd.spellEffects.value).toBe(5);
			expect(bd.spellEffects.sources).toEqual([
				expect.objectContaining({name: "Aid", value: 5}),
			]);
			expect(bd.total).toBe(49);
		});
	});

	describe("Aid expiry / deactivation", () => {
		it("drops max back when deactivated and caps current to the new max", () => {
			const state = buildL5Fighter();
			activateAid(state);
			expect(state.getMaxHp()).toBe(49);
			expect(state.getCurrentHp()).toBe(49);

			state.deactivateState("custom");

			expect(state.getMaxHp()).toBe(44);
			// Was at full (49) → capped to 44.
			expect(state.getCurrentHp()).toBe(44);
		});

		it("does not raise current HP on expiry when below the old max", () => {
			const state = buildL5Fighter();
			activateAid(state);
			state.setCurrentHp(30);

			state.deactivateState("custom");

			expect(state.getMaxHp()).toBe(44);
			// Below max — must not be touched upward.
			expect(state.getCurrentHp()).toBe(30);
		});

		it("never lets current drop below 1 when max contracts", () => {
			const state = buildL5Fighter();
			activateAid(state);
			state.setCurrentHp(1);
			state.deactivateState("custom");
			expect(state.getCurrentHp()).toBeGreaterThanOrEqual(1);
		});
	});

	describe("Aid upcast", () => {
		it("applies +10 max HP at slot 3 (registry upcastPerLevel: 5/level)", () => {
			const state = buildL5Fighter();
			activateAid(state, {value: 10}); // simulate picker computing upcast value
			expect(state.getMaxHp()).toBe(54);
			expect(state.getCurrentHp()).toBe(54);
		});
	});

	describe("Stacking", () => {
		it("sums hpMaxIncrease across multiple distinct active states", () => {
			const state = buildL5Fighter();
			// Aid +5
			activateAid(state, {sourceFeatureId: "spell_Aid_caster1"});
			// Heroes' Feast-style +8 from a different source
			state.activateState("custom", {
				name: "Heroes' Feast",
				icon: "✨",
				description: "Spell effect: Heroes' Feast",
				sourceFeatureId: "spell_HeroesFeast_test",
				customEffects: [{type: "hpMaxIncrease", value: 8}],
				isSpellEffect: true,
				duration: {amount: 24, unit: "hour"},
			});

			expect(state.getMaxHp()).toBe(44 + 5 + 8);
			const bd = state.getHpBreakdown();
			expect(bd.spellEffects.value).toBe(13);
			expect(bd.spellEffects.sources.map(s => s.name).sort()).toEqual(["Aid", "Heroes' Feast"]);
		});

		it("ignores deactivated states even if they remain in activeStates", () => {
			const state = buildL5Fighter();
			activateAid(state);
			expect(state.getMaxHp()).toBe(49);

			state.deactivateState("custom");
			// State still exists on the array but is inactive — must not contribute.
			expect(state.getMaxHp()).toBe(44);
			expect(state.getHpBreakdown().spellEffects.value).toBe(0);
		});
	});

	describe("removeActiveState", () => {
		it("recomputes max HP and caps current when an hpMaxIncrease state is removed entirely", () => {
			const state = buildL5Fighter();
			const stateId = activateAid(state);
			expect(state.getMaxHp()).toBe(49);

			state.removeActiveState(stateId);

			expect(state.getMaxHp()).toBe(44);
			expect(state.getCurrentHp()).toBeLessThanOrEqual(44);
		});
	});

	describe("advanceRound expiry", () => {
		it("recomputes max HP when an hpMaxIncrease state expires mid-combat", () => {
			const state = buildL5Fighter();
			// Activate with a 1-round duration so it expires on the first advance.
			state.activateState("custom", {
				name: "Aid",
				icon: "✨",
				description: "Spell effect: Aid",
				sourceFeatureId: "spell_Aid_round",
				customEffects: aidEffects(5),
				isSpellEffect: true,
				duration: {amount: 1, unit: "round"},
			});
			state.startCombat();
			expect(state.getMaxHp()).toBe(49);

			const expired = state.advanceRound();
			expect(expired).toContain("Aid");
			expect(state.getMaxHp()).toBe(44);
		});
	});

	describe("Picker stacking-rejection contract", () => {
		// The Apply Buff picker (charactersheet.js#_applyBuffFromRegistry) refuses to
		// activate a buff whose name matches an already-active spell-effect state.
		// That check reads `getActiveStates()`, looks for `s.active && s.isSpellEffect
		// && s.name`. These tests lock the state-model side of the contract.
		it("getActiveStates surfaces name + isSpellEffect on applied buffs", () => {
			const state = buildL5Fighter();
			activateAid(state);
			const active = state.getActiveStates().filter(s => s.active && s.isSpellEffect);
			expect(active).toHaveLength(1);
			expect(active[0].name).toBe("Aid");
			expect(active[0].isSpellEffect).toBe(true);
		});

		it("does not match by name across different sourceFeatureIds — picker's check is the gate, not activateState", () => {
			// Demonstrates that activateState itself permits multiple "Aid"-named
			// custom states with different sourceFeatureIds — the no-stacking
			// rule lives in the picker. The HP-calc layer must therefore stay
			// summation-safe (proved in the Stacking suite above).
			const state = buildL5Fighter();
			activateAid(state, {sourceFeatureId: "spell_Aid_a"});
			activateAid(state, {sourceFeatureId: "spell_Aid_b"});
			const aids = state.getActiveStates().filter(s => s.active && s.name === "Aid");
			expect(aids.length).toBe(2);
			// Defensive sum: 5 + 5
			expect(state.getMaxHp()).toBe(54);
		});
	});
});
