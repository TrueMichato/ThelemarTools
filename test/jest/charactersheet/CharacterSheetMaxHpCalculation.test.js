/**
 * Tests for the history-driven max HP calculation in CharacterSheetState.
 *
 * Covers the fix for "levelup/quickbuild still sometimes lead to non full hp for players":
 *   - per-level hpRoll stored on levelHistory entries flows into _calculateMaxHp
 *   - L1 always uses max hit die (RAW)
 *   - feat / racial hpPerLevel modifiers apply across all levels via recalculateHp
 *   - CON ability changes ripple to every level
 *   - syncCurrent fills current HP to max
 *   - rolled HP is clamped to the current class's hit die (respec safety)
 *   - legacy characters without level history still compute correctly via fallback
 */

import "./setup.js";
import "../../../js/charactersheet/charactersheet-state.js";

const CharacterSheetState = globalThis.CharacterSheetState;

const recordLevels = (state, levels) => {
	levels.forEach(({level, className, classSource = "PHB", hpRoll}) => {
		const choices = {};
		if (hpRoll != null) choices.hpRoll = hpRoll;
		state.recordLevelChoice({
			level,
			class: {name: className, source: classSource},
			choices,
			complete: true,
		});
	});
};

describe("CharacterSheetMaxHpCalculation", () => {
	let state;

	beforeEach(() => {
		state = new CharacterSheetState();
		state.setAbilityBase("con", 14); // +2
	});

	describe("History-driven path", () => {
		it("uses max hit die at L1 and average for subsequent levels with no rolls", () => {
			state.addClass({name: "Fighter", source: "PHB", level: 5});
			recordLevels(state, [
				{level: 1, className: "Fighter"},
				{level: 2, className: "Fighter"},
				{level: 3, className: "Fighter"},
				{level: 4, className: "Fighter"},
				{level: 5, className: "Fighter"},
			]);

			state.recalculateHp({syncCurrent: true});

			// L1: 10 + 2 = 12
			// L2-5: ceil(10/2)+1+2 = 8 each → 32
			// total: 44
			expect(state.getMaxHp()).toBe(44);
			expect(state.getCurrentHp()).toBe(44);
		});

		it("honours stored hpRoll for non-L1 levels", () => {
			state.addClass({name: "Fighter", source: "PHB", level: 3});
			recordLevels(state, [
				{level: 1, className: "Fighter"},
				{level: 2, className: "Fighter", hpRoll: 9}, // 9 + 2 = 11
				{level: 3, className: "Fighter", hpRoll: 7}, // 7 + 2 = 9
			]);

			state.recalculateHp({syncCurrent: true});

			// L1: 12, L2: 11, L3: 9 → 32
			expect(state.getMaxHp()).toBe(32);
		});

		it("ignores hpRoll at L1 (always uses max hit die per RAW)", () => {
			state.addClass({name: "Wizard", source: "PHB", level: 1});
			recordLevels(state, [{level: 1, className: "Wizard", hpRoll: 1}]);

			state.recalculateHp({syncCurrent: true});

			// L1: 6 (d6 max) + 2 = 8 — the hpRoll of 1 is intentionally ignored
			expect(state.getMaxHp()).toBe(8);
		});

		it("clamps stored hpRoll to the current class hit die (respec safety)", () => {
			// Pretend the level was rolled as a Fighter (d10=10) but is now a Wizard (d6).
			state.addClass({name: "Wizard", source: "PHB", level: 2});
			recordLevels(state, [
				{level: 1, className: "Wizard"},
				{level: 2, className: "Wizard", hpRoll: 10},
			]);

			state.recalculateHp({syncCurrent: true});

			// L1: 6+2=8, L2: min(10,6)+2=8 → 16
			expect(state.getMaxHp()).toBe(16);
		});

		it("re-applies live CON modifier across every level when CON changes", () => {
			state.addClass({name: "Fighter", source: "PHB", level: 4});
			recordLevels(state, [
				{level: 1, className: "Fighter"},
				{level: 2, className: "Fighter"},
				{level: 3, className: "Fighter"},
				{level: 4, className: "Fighter"},
			]);

			state.setAbilityBase("con", 14); // +2
			state.recalculateHp({syncCurrent: true});
			const hpAtCon14 = state.getMaxHp(); // 12 + 8*3 = 36

			state.setAbilityBase("con", 16); // +3
			state.recalculateHp({syncCurrent: true});
			const hpAtCon16 = state.getMaxHp();

			// CON +1 across 4 levels = +4 max HP
			expect(hpAtCon16 - hpAtCon14).toBe(4);
			expect(hpAtCon14).toBe(36);
			expect(hpAtCon16).toBe(40);
		});
	});

	describe("Feature modifiers (Toughness, racial hpPerLevel)", () => {
		it("adds customModifiers.hpPerLevel * totalLevel via recalc", () => {
			state.addClass({name: "Wizard", source: "PHB", level: 5});
			recordLevels(state, [
				{level: 1, className: "Wizard"},
				{level: 2, className: "Wizard"},
				{level: 3, className: "Wizard"},
				{level: 4, className: "Wizard"},
				{level: 5, className: "Wizard"},
			]);

			state.recalculateHp({syncCurrent: true});
			const baseMax = state.getMaxHp();

			// Add a Toughness-style hpPerLevel modifier (matches FeatureEffectRegistry shape)
			state.addNamedModifier({
				name: "Tough",
				type: "hp",
				value: 2,
				perLevel: true,
				note: "Tough feat",
				enabled: true,
			});
			state.recalculateHp({syncCurrent: true});

			// +2 per level * 5 levels = +10
			expect(state.getMaxHp() - baseMax).toBe(10);
			expect(state.getCurrentHp()).toBe(state.getMaxHp());
		});

		it("flat customModifiers.hp adds once regardless of level count", () => {
			state.addClass({name: "Wizard", source: "PHB", level: 5});
			recordLevels(state, [
				{level: 1, className: "Wizard"},
				{level: 2, className: "Wizard"},
				{level: 3, className: "Wizard"},
				{level: 4, className: "Wizard"},
				{level: 5, className: "Wizard"},
			]);
			state.recalculateHp({syncCurrent: true});
			const baseMax = state.getMaxHp();

			state.addNamedModifier({
				name: "Magic Hat of HP",
				type: "hp",
				value: 7,
				enabled: true,
			});
			state.recalculateHp({syncCurrent: true});

			expect(state.getMaxHp() - baseMax).toBe(7);
		});

		it("combines flat and per-level modifiers correctly", () => {
			state.addClass({name: "Fighter", source: "PHB", level: 3});
			recordLevels(state, [
				{level: 1, className: "Fighter"},
				{level: 2, className: "Fighter"},
				{level: 3, className: "Fighter"},
			]);
			state.addNamedModifier({name: "Tough", type: "hp", value: 2, perLevel: true, enabled: true});
			state.addNamedModifier({name: "Hat", type: "hp", value: 5, enabled: true});

			state.recalculateHp({syncCurrent: true});

			// Base: 12 + 8 + 8 = 28; +2*3 per-level = 6; +5 flat = 39
			expect(state.getMaxHp()).toBe(39);
		});
	});

	describe("Multiclass interleaving via history", () => {
		it("uses the chronological class for each level, not class array order", () => {
			// Character order: Fighter L1 → Wizard L1 → Fighter L2 → Wizard L2 (4 char levels)
			state.addClass({name: "Fighter", source: "PHB", level: 2});
			state.addClass({name: "Wizard", source: "PHB", level: 2});
			recordLevels(state, [
				{level: 1, className: "Fighter"}, // d10 max + 2 = 12
				{level: 2, className: "Wizard"}, // ceil(6/2)+1+2 = 6
				{level: 3, className: "Fighter"}, // ceil(10/2)+1+2 = 8
				{level: 4, className: "Wizard"}, // 6
			]);

			state.recalculateHp({syncCurrent: true});

			expect(state.getMaxHp()).toBe(12 + 6 + 8 + 6);
		});
	});

	describe("Legacy fallback (no/incomplete history)", () => {
		it("falls back to class iteration when history is empty", () => {
			state.addClass({name: "Fighter", source: "PHB", level: 3});
			// No recordLevelChoice calls
			state.recalculateHp({syncCurrent: true});

			// 12 + 8 + 8 = 28
			expect(state.getMaxHp()).toBe(28);
		});

		it("falls back when history length doesn't match total level", () => {
			state.addClass({name: "Fighter", source: "PHB", level: 3});
			recordLevels(state, [{level: 1, className: "Fighter"}]); // only L1 recorded
			state.recalculateHp({syncCurrent: true});

			// Fallback path: 12 + 8 + 8 = 28
			expect(state.getMaxHp()).toBe(28);
		});
	});

	describe("getHpRollForLevel helper", () => {
		it("returns the stored bare die roll for a recorded level", () => {
			state.addClass({name: "Fighter", source: "PHB", level: 2});
			recordLevels(state, [
				{level: 1, className: "Fighter"},
				{level: 2, className: "Fighter", hpRoll: 7},
			]);
			expect(state.getHpRollForLevel(2)).toBe(7);
		});

		it("returns null when no roll was stored", () => {
			state.addClass({name: "Fighter", source: "PHB", level: 2});
			recordLevels(state, [
				{level: 1, className: "Fighter"},
				{level: 2, className: "Fighter"},
			]);
			expect(state.getHpRollForLevel(2)).toBe(null);
		});

		it("returns null for a level that has no history entry", () => {
			expect(state.getHpRollForLevel(3)).toBe(null);
		});
	});

	describe("syncCurrent semantics", () => {
		it("recalculateHp({syncCurrent: true}) sets current to max", () => {
			state.addClass({name: "Fighter", source: "PHB", level: 1});
			recordLevels(state, [{level: 1, className: "Fighter"}]);
			state.setCurrentHp(1);
			state.recalculateHp({syncCurrent: true});
			expect(state.getCurrentHp()).toBe(state.getMaxHp());
		});

		it("recalculateHp({syncCurrent: false}) preserves current and only caps if over max", () => {
			state.addClass({name: "Fighter", source: "PHB", level: 2});
			recordLevels(state, [
				{level: 1, className: "Fighter"},
				{level: 2, className: "Fighter"},
			]);
			state.recalculateHp({syncCurrent: true});
			const max = state.getMaxHp();
			state.setCurrentHp(5);
			state.recalculateHp({syncCurrent: false});
			expect(state.getCurrentHp()).toBe(5);
			expect(state.getMaxHp()).toBe(max);
		});
	});
});
