/**
 * Tests for CharacterSheetState.getHpBreakdown() — the structured breakdown
 * that powers the HP click-popover and the per-level HP row in level history.
 *
 * Invariants:
 *   - perLevel.length === totalLevel
 *   - sum(levelTotal) + flatBonus.value + perLevelBonus.value === total === getMaxHp()
 *   - L1 always uses max hit die ("max" source)
 *   - rolled levels report source "rolled" with rolled = stored die value (clamped to current hit die)
 *   - missing rolls report source "average"
 *   - legacy fallback (no/incomplete history) sets legacyFallback:true and uses class iteration
 *   - Toughness-style {type:"hp", perLevel:true} surfaces in perLevelBonus.sources
 *   - Flat HP modifier surfaces in flatBonus.sources
 *   - conContribution per level updates when CON changes
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

describe("CharacterSheetHpBreakdown", () => {
	let state;

	beforeEach(() => {
		state = new CharacterSheetState();
		state.setAbilityBase("con", 14); // +2
	});

	describe("Per-level shape", () => {
		it("L1 always reports source='max' with base = hitDie regardless of stored hpRoll", () => {
			state.addClass({name: "Wizard", source: "PHB", level: 1});
			recordLevels(state, [{level: 1, className: "Wizard", hpRoll: 1}]);

			const bd = state.getHpBreakdown();
			expect(bd.perLevel).toHaveLength(1);
			expect(bd.perLevel[0]).toMatchObject({
				level: 1,
				className: "Wizard",
				hitDie: 6,
				rolled: null,
				base: 6,
				conContribution: 2,
				levelTotal: 8,
				isFirstLevel: true,
				source: "max",
			});
		});

		it("rolled levels report source='rolled' and rolled=die value", () => {
			state.addClass({name: "Fighter", source: "PHB", level: 3});
			recordLevels(state, [
				{level: 1, className: "Fighter"},
				{level: 2, className: "Fighter", hpRoll: 9},
				{level: 3, className: "Fighter"},
			]);

			const bd = state.getHpBreakdown();
			expect(bd.perLevel[1]).toMatchObject({
				level: 2,
				rolled: 9,
				base: 9,
				levelTotal: 11,
				source: "rolled",
			});
			expect(bd.perLevel[2].source).toBe("average");
		});

		it("clamps stored rolls higher than the current hit die (respec safety)", () => {
			state.addClass({name: "Wizard", source: "PHB", level: 2});
			recordLevels(state, [
				{level: 1, className: "Wizard"},
				{level: 2, className: "Wizard", hpRoll: 10}, // d6 max
			]);

			const bd = state.getHpBreakdown();
			expect(bd.perLevel[1]).toMatchObject({
				rolled: 10,
				base: 6,
				levelTotal: 8,
				source: "rolled",
			});
		});

		it("missing rolls report source='average' with base = ceil(hitDie/2)+1", () => {
			state.addClass({name: "Fighter", source: "PHB", level: 2});
			recordLevels(state, [
				{level: 1, className: "Fighter"},
				{level: 2, className: "Fighter"},
			]);

			const bd = state.getHpBreakdown();
			expect(bd.perLevel[1]).toMatchObject({
				rolled: null,
				base: 6, // ceil(10/2) + 1
				levelTotal: 8,
				source: "average",
			});
		});
	});

	describe("Multiclass", () => {
		it("each row reports its chronological class", () => {
			state.addClass({name: "Fighter", source: "PHB", level: 2});
			state.addClass({name: "Wizard", source: "PHB", level: 2});
			recordLevels(state, [
				{level: 1, className: "Fighter"},
				{level: 2, className: "Wizard"},
				{level: 3, className: "Fighter"},
				{level: 4, className: "Wizard"},
			]);

			const bd = state.getHpBreakdown();
			expect(bd.perLevel.map(p => p.className)).toEqual(["Fighter", "Wizard", "Fighter", "Wizard"]);
			expect(bd.perLevel.map(p => p.hitDie)).toEqual([10, 6, 10, 6]);
			expect(bd.legacyFallback).toBe(false);
		});
	});

	describe("Bonuses", () => {
		it("Toughness-style modifier surfaces in perLevelBonus.sources with aggregated value", () => {
			state.addClass({name: "Fighter", source: "PHB", level: 5});
			recordLevels(state, [
				{level: 1, className: "Fighter"},
				{level: 2, className: "Fighter"},
				{level: 3, className: "Fighter"},
				{level: 4, className: "Fighter"},
				{level: 5, className: "Fighter"},
			]);
			state.addNamedModifier({name: "Tough", type: "hp", value: 2, perLevel: true, enabled: true});
			state.recalculateHp({syncCurrent: true});

			const bd = state.getHpBreakdown();
			expect(bd.perLevelBonus.perLevelValue).toBe(2);
			expect(bd.perLevelBonus.totalLevels).toBe(5);
			expect(bd.perLevelBonus.value).toBe(10);
			expect(bd.perLevelBonus.sources).toEqual([{name: "Tough", value: 2}]);
		});

		it("Flat HP modifier surfaces in flatBonus.sources", () => {
			state.addClass({name: "Wizard", source: "PHB", level: 3});
			recordLevels(state, [
				{level: 1, className: "Wizard"},
				{level: 2, className: "Wizard"},
				{level: 3, className: "Wizard"},
			]);
			state.addNamedModifier({name: "Magic Hat", type: "hp", value: 7, enabled: true});
			state.recalculateHp({syncCurrent: true});

			const bd = state.getHpBreakdown();
			expect(bd.flatBonus.value).toBe(7);
			expect(bd.flatBonus.sources).toEqual([{name: "Magic Hat", value: 7}]);
		});

		it("Combines flat + perLevel bonus sources", () => {
			state.addClass({name: "Fighter", source: "PHB", level: 3});
			recordLevels(state, [
				{level: 1, className: "Fighter"},
				{level: 2, className: "Fighter"},
				{level: 3, className: "Fighter"},
			]);
			state.addNamedModifier({name: "Tough", type: "hp", value: 2, perLevel: true, enabled: true});
			state.addNamedModifier({name: "Hat", type: "hp", value: 5, enabled: true});
			state.recalculateHp({syncCurrent: true});

			const bd = state.getHpBreakdown();
			expect(bd.flatBonus.value).toBe(5);
			expect(bd.perLevelBonus.value).toBe(6);
		});
	});

	describe("CON ripple", () => {
		it("conContribution per level updates when CON changes", () => {
			state.addClass({name: "Fighter", source: "PHB", level: 3});
			recordLevels(state, [
				{level: 1, className: "Fighter"},
				{level: 2, className: "Fighter"},
				{level: 3, className: "Fighter"},
			]);
			state.recalculateHp({syncCurrent: true});

			const before = state.getHpBreakdown();
			expect(before.conMod).toBe(2);
			expect(before.perLevel.every(p => p.conContribution === 2)).toBe(true);

			state.setAbilityBase("con", 16); // +3
			state.recalculateHp({syncCurrent: true});
			const after = state.getHpBreakdown();
			expect(after.conMod).toBe(3);
			expect(after.perLevel.every(p => p.conContribution === 3)).toBe(true);
		});
	});

	describe("Legacy fallback", () => {
		it("sets legacyFallback:true and synthesizes one row per character level when history is empty", () => {
			state.addClass({name: "Fighter", source: "PHB", level: 3});
			// No recordLevelChoice calls
			const bd = state.getHpBreakdown();
			expect(bd.legacyFallback).toBe(true);
			expect(bd.perLevel).toHaveLength(3);
			expect(bd.perLevel[0]).toMatchObject({source: "fallback", base: 10, isFirstLevel: true});
			expect(bd.perLevel[1]).toMatchObject({source: "fallback", base: 6});
			expect(bd.perLevel[2]).toMatchObject({source: "fallback", base: 6});
		});

		it("falls back when history length doesn't match total level", () => {
			state.addClass({name: "Fighter", source: "PHB", level: 3});
			recordLevels(state, [{level: 1, className: "Fighter"}]); // partial
			const bd = state.getHpBreakdown();
			expect(bd.legacyFallback).toBe(true);
			expect(bd.perLevel).toHaveLength(3);
		});
	});

	describe("Total invariants", () => {
		it("perLevel.length === totalLevel for all builds", () => {
			state.addClass({name: "Fighter", source: "PHB", level: 5});
			recordLevels(state, [
				{level: 1, className: "Fighter"},
				{level: 2, className: "Fighter"},
				{level: 3, className: "Fighter"},
				{level: 4, className: "Fighter"},
				{level: 5, className: "Fighter"},
			]);
			expect(state.getHpBreakdown().perLevel).toHaveLength(5);
		});

		it("sum(levelTotal) + flatBonus + perLevelBonus === total === getMaxHp()", () => {
			state.addClass({name: "Fighter", source: "PHB", level: 4});
			recordLevels(state, [
				{level: 1, className: "Fighter"},
				{level: 2, className: "Fighter", hpRoll: 7},
				{level: 3, className: "Fighter"},
				{level: 4, className: "Fighter", hpRoll: 9},
			]);
			state.addNamedModifier({name: "Tough", type: "hp", value: 2, perLevel: true, enabled: true});
			state.addNamedModifier({name: "Hat", type: "hp", value: 5, enabled: true});
			state.recalculateHp({syncCurrent: true});

			const bd = state.getHpBreakdown();
			const sumLevels = bd.perLevel.reduce((acc, e) => acc + e.levelTotal, 0);
			expect(sumLevels + bd.flatBonus.value + bd.perLevelBonus.value).toBe(bd.total);
			expect(bd.total).toBe(state.getMaxHp());
		});

		it("invariants hold under multiclass + bonuses", () => {
			state.addClass({name: "Fighter", source: "PHB", level: 2});
			state.addClass({name: "Wizard", source: "PHB", level: 2});
			recordLevels(state, [
				{level: 1, className: "Fighter"},
				{level: 2, className: "Wizard", hpRoll: 5},
				{level: 3, className: "Fighter"},
				{level: 4, className: "Wizard"},
			]);
			state.addNamedModifier({name: "Tough", type: "hp", value: 2, perLevel: true, enabled: true});
			state.recalculateHp({syncCurrent: true});

			const bd = state.getHpBreakdown();
			expect(bd.total).toBe(state.getMaxHp());
		});
	});

	describe("Header fields", () => {
		it("reports tempHp and current", () => {
			state.addClass({name: "Fighter", source: "PHB", level: 1});
			recordLevels(state, [{level: 1, className: "Fighter"}]);
			state.recalculateHp({syncCurrent: true});
			state.setTempHp(4);
			state.setCurrentHp(7);

			const bd = state.getHpBreakdown();
			expect(bd.tempHp).toBe(4);
			expect(bd.current).toBe(7);
		});
	});
});
