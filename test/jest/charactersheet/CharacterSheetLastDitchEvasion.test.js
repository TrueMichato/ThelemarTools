/**
 * S3 #7 — Last Ditch Evasion battle tactic (in-play application).
 *
 * The bug: the tooltip/roll LABEL said "half damage" while the applied result was 0.
 * The canonical TGTT rule is AVOID ALL DAMAGE (take 0) + become Slowed until the end
 * of your next turn — so the 0 is correct and the "half" label was the bug. These tests
 * assert the pure in-play helper applyLastDitchEvasion():
 *  - reduces the incoming attack damage to ZERO (not half),
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

	it("AVOIDS ALL damage (reduces to 0, not half)", () => {
		makeFighter();
		flagLastDitchEvasion();
		const res = state.applyLastDitchEvasion({damage: 20});
		expect(res.applied).toBe(true);
		expect(res.full).toBe(20);
		expect(res.reduced).toBe(0); // NOT 10 (half) and NOT 20 (full)
	});

	it("reduces to 0 regardless of the incoming amount", () => {
		makeFighter();
		flagLastDitchEvasion();
		expect(state.applyLastDitchEvasion({damage: 21}).reduced).toBe(0);
		expect(state.applyLastDitchEvasion({damage: 1}).reduced).toBe(0);
		expect(state.applyLastDitchEvasion({damage: 999}).reduced).toBe(0);
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

	it("works as a no-arg reaction (the manual button passes no damage)", () => {
		makeFighter();
		flagLastDitchEvasion();
		const res = state.applyLastDitchEvasion({});
		expect(res.applied).toBe(true);
		expect(res.reduced).toBe(0);
		expect(res.slowedApplied).toBe(true);
		expect(state.getConditionNames().some(n => /slow/i.test(n))).toBe(true);
	});

	it("no-ops (and does not apply Slowed) when the tactic is not active", () => {
		makeFighter();
		// No flag override → hasLastDitchEvasion is falsy.
		const res = state.applyLastDitchEvasion({damage: 20});
		expect(res.applied).toBe(false);
		expect(res.reduced).toBe(20); // caller takes full damage
		expect(state.getConditionNames().some(n => /slow/i.test(n))).toBe(false);
	});
});
