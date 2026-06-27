/**
 * S3 #7 — Last Ditch Evasion battle tactic (in-play application).
 *
 * The bug: a FAILED Dexterity save against a "half on success" effect was applying
 * ZERO damage (treating LDE like Evasion). RAW it should leave the Fighter at HALF
 * damage, and the tactic also imposes the Slowed condition. These tests assert the
 * pure in-play helper applyLastDitchEvasion():
 *  - halves (floors) the incoming damage instead of negating it,
 *  - applies the Slowed condition (TGTT variant resolves for Thelemar tables),
 *  - no-ops cleanly when the tactic is not active.
 */

import "./setup.js";
import "../../../js/charactersheet/charactersheet-state.js";

const CharacterSheetState = globalThis.CharacterSheetState;

describe("Last Ditch Evasion (in-play)", () => {
	let state;

	function makeFighter (level = 10) {
		state = new CharacterSheetState();
		state.addClass({
			name: "Fighter",
			source: "XPHB",
			level,
			hitDice: "d10",
			subclass: {name: "Battle Master", shortName: "Battle Master", source: "XPHB"},
		});
		state.setAbilityBase("dex", 18);
		state.setAbilityBase("con", 16);
	}

	function flagLastDitchEvasion () {
		const origGet = state.getFeatureCalculations.bind(state);
		state.getFeatureCalculations = () => ({...origGet(), hasLastDitchEvasion: true});
	}

	it("yields HALF damage (not zero) on a failed save", () => {
		makeFighter();
		flagLastDitchEvasion();
		const res = state.applyLastDitchEvasion({damage: 20});
		expect(res.applied).toBe(true);
		expect(res.full).toBe(20);
		expect(res.halved).toBe(10); // NOT 0
	});

	it("floors odd damage", () => {
		makeFighter();
		flagLastDitchEvasion();
		expect(state.applyLastDitchEvasion({damage: 21}).halved).toBe(10);
		expect(state.applyLastDitchEvasion({damage: 1}).halved).toBe(0);
	});

	it("applies the Slowed condition", () => {
		makeFighter();
		flagLastDitchEvasion();
		expect(state.getConditionNames().some(n => /slow/i.test(n))).toBe(false);
		const res = state.applyLastDitchEvasion({damage: 30});
		expect(res.slowedApplied).toBe(true);
		expect(state.getConditionNames().some(n => /slow/i.test(n))).toBe(true);
	});

	it("does not stack a second Slowed if already present", () => {
		makeFighter();
		flagLastDitchEvasion();
		state.applyLastDitchEvasion({damage: 12});
		const before = state.getConditionNames().filter(n => /slow/i.test(n)).length;
		const res2 = state.applyLastDitchEvasion({damage: 12});
		const after = state.getConditionNames().filter(n => /slow/i.test(n)).length;
		expect(res2.slowedApplied).toBe(false);
		expect(after).toBe(before);
	});

	it("no-ops (and does not apply Slowed) when the tactic is not active", () => {
		makeFighter();
		// No flag override → hasLastDitchEvasion is falsy.
		const res = state.applyLastDitchEvasion({damage: 20});
		expect(res.applied).toBe(false);
		expect(res.halved).toBe(20); // caller takes full damage
		expect(state.getConditionNames().some(n => /slow/i.test(n))).toBe(false);
	});
});
