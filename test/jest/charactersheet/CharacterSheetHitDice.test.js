/**
 * Character Sheet Hit Dice Tests (Bug #12)
 *
 * Canonical per-die-type Hit Dice model shared by the Overview tab and the
 * Short Rest modal:
 *   _data.hitDice = { d8: {current, max}, d10: {current, max}, ... }
 *
 * These are state/derived-level tests (the suite has no jsdom, so Overview DOM
 * rendering is not unit-testable here). They assert on the pools and the public
 * API, not on level counts.
 */

import "./setup.js";
import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";

const CharacterSheetState = globalThis.CharacterSheetState;
const CharacterSheetClassUtils = globalThis.CharacterSheetClassUtils;

const byType = (state, type) => state.getHitDice().find(h => h.type === type);

describe("Hit Dice — canonical per-die-type model (Bug #12)", () => {
	let state;

	beforeEach(() => {
		state = new CharacterSheetState();
	});

	// ==========================================================================
	// 1. Multiclass max pools per die type
	// ==========================================================================
	describe("Multiclass max pools", () => {
		it("aggregates per die type across classes (Ranger 6 d10 / Druid 3 d8)", () => {
			state.addClass({name: "Ranger", source: "PHB", level: 1});
			for (let i = 2; i <= 6; i++) state.levelUp("Ranger");
			state.addClass({name: "Druid", source: "PHB", level: 1});
			for (let i = 2; i <= 3; i++) state.levelUp("Druid");

			expect(byType(state, "d10").max).toBe(6);
			expect(byType(state, "d8").max).toBe(3);
			// Fresh character: everything available.
			expect(byType(state, "d10").current).toBe(6);
			expect(byType(state, "d8").current).toBe(3);
		});

		it("sums same-die classes into a single pool (Fighter 5 + Paladin 3 = 8d10)", () => {
			state.addClass({name: "Fighter", source: "PHB", level: 1});
			for (let i = 2; i <= 5; i++) state.levelUp("Fighter");
			state.addClass({name: "Paladin", source: "PHB", level: 1});
			for (let i = 2; i <= 3; i++) state.levelUp("Paladin");

			const pools = state.getHitDice().filter(h => h.type === "d10");
			expect(pools).toHaveLength(1);
			expect(pools[0].max).toBe(8);
		});
	});

	// ==========================================================================
	// 2. Off-by-one regression (the user-reported multiclass-add bug)
	// ==========================================================================
	describe("Off-by-one regression", () => {
		it("does NOT double-count the new class's first die when add+updateHitDice both run", () => {
			// Simulate the multiclass-add path: addClass (recalcs) THEN ClassUtils
			// .updateHitDice (the historical incremental +1).
			state.addClass({name: "Ranger", source: "PHB", level: 1});
			for (let i = 2; i <= 6; i++) state.levelUp("Ranger");

			state.addClass({name: "Druid", source: "PHB", level: 1});
			CharacterSheetClassUtils.updateHitDice(state, {name: "Druid", source: "PHB"});
			expect(byType(state, "d8").max).toBe(1); // was 2 before the fix

			for (let i = 2; i <= 3; i++) {
				state.levelUp("Druid");
				CharacterSheetClassUtils.updateHitDice(state, {name: "Druid", source: "PHB"});
			}
			expect(byType(state, "d8").max).toBe(3); // was 4 before the fix
			expect(byType(state, "d10").max).toBe(6);
		});

		it("recalculateHitDice() is idempotent", () => {
			state.addClass({name: "Druid", source: "PHB", level: 1});
			for (let i = 2; i <= 3; i++) state.levelUp("Druid");

			const before = state.getHitDiceByType();
			state.recalculateHitDice();
			state.recalculateHitDice();
			expect(state.getHitDiceByType()).toEqual(before);
			expect(byType(state, "d8").max).toBe(3);
		});
	});

	// ==========================================================================
	// 3. Spent preservation across recalc / level-up
	// ==========================================================================
	describe("Spent preservation", () => {
		it("keeps spent dice spent when recalculating", () => {
			state.addClass({name: "Druid", source: "PHB", level: 1});
			for (let i = 2; i <= 3; i++) state.levelUp("Druid");

			state.adjustHitDieCurrent("d8", -2); // spend 2 → current 1 / max 3
			expect(byType(state, "d8").current).toBe(1);

			state.recalculateHitDice();
			expect(byType(state, "d8").current).toBe(1);
			expect(byType(state, "d8").max).toBe(3);
		});

		it("a new level adds an available die while preserving prior spends", () => {
			state.addClass({name: "Druid", source: "PHB", level: 1});
			for (let i = 2; i <= 3; i++) state.levelUp("Druid");

			state.adjustHitDieCurrent("d8", -2); // current 1 / max 3 (spent 2)
			state.levelUp("Druid"); // → max 4, the new die is available

			expect(byType(state, "d8").max).toBe(4);
			expect(byType(state, "d8").current).toBe(2); // 1 prior + 1 new
		});
	});

	// ==========================================================================
	// 4. adjustHitDieCurrent — clamp / normalize / persist
	// ==========================================================================
	describe("adjustHitDieCurrent", () => {
		beforeEach(() => {
			state.addClass({name: "Ranger", source: "PHB", level: 1});
			for (let i = 2; i <= 6; i++) state.levelUp("Ranger");
		});

		it("clamps current to [0, max] and reports whether it changed", () => {
			expect(state.adjustHitDieCurrent("d10", -10)).toBe(true);
			expect(byType(state, "d10").current).toBe(0);
			// Already at floor → no change.
			expect(state.adjustHitDieCurrent("d10", -1)).toBe(false);

			expect(state.adjustHitDieCurrent("d10", 99)).toBe(true);
			expect(byType(state, "d10").current).toBe(6);
			// Already at ceiling → no change.
			expect(state.adjustHitDieCurrent("d10", 1)).toBe(false);
		});

		it("returns false for an unknown die type", () => {
			expect(state.adjustHitDieCurrent("d12", -1)).toBe(false);
		});

		it("persists across toJson / loadFromJson", () => {
			state.adjustHitDieCurrent("d10", -2); // current 4 / max 6

			const reloaded = new CharacterSheetState();
			reloaded.loadFromJson(state.toJson());
			expect(reloaded.getHitDice().find(h => h.type === "d10").current).toBe(4);
			expect(reloaded.getHitDice().find(h => h.type === "d10").max).toBe(6);
		});
	});

	// ==========================================================================
	// 5. getLargestSpendableHitDieType
	// ==========================================================================
	describe("getLargestSpendableHitDieType", () => {
		beforeEach(() => {
			state.addClass({name: "Ranger", source: "PHB", level: 1});
			for (let i = 2; i <= 6; i++) state.levelUp("Ranger");
			state.addClass({name: "Druid", source: "PHB", level: 1});
			for (let i = 2; i <= 3; i++) state.levelUp("Druid");
		});

		it("picks the largest-faced pool with dice available", () => {
			expect(state.getLargestSpendableHitDieType()).toBe("d10");
		});

		it("skips an empty larger pool in favour of a smaller non-empty one", () => {
			state.adjustHitDieCurrent("d10", -6); // empty the d10 pool
			expect(state.getLargestSpendableHitDieType()).toBe("d8");
		});

		it("returns null when every pool is empty", () => {
			state.adjustHitDieCurrent("d10", -6);
			state.adjustHitDieCurrent("d8", -3);
			expect(state.getLargestSpendableHitDieType()).toBeNull();
		});
	});

	// ==========================================================================
	// 6. Load reconcile (migration)
	// ==========================================================================
	describe("Load reconcile / migration", () => {
		it("repairs a Lunaria-style inflated d8 pool (4 → 3) preserving spent", () => {
			const save = {
				classes: [
					{name: "Ranger", source: "TGTT", level: 6},
					{name: "Druid", source: "XPHB", level: 3},
				],
				// Persisted with the off-by-one and one die already spent.
				hitDice: {
					d10: {current: 6, max: 6},
					d8: {current: 3, max: 4},
				},
			};

			const loaded = new CharacterSheetState();
			loaded.loadFromJson(save);

			expect(byType(loaded, "d8").max).toBe(3);
			expect(byType(loaded, "d8").current).toBe(2); // spent 1 preserved (4-3)
			expect(byType(loaded, "d10").max).toBe(6);
			expect(byType(loaded, "d10").current).toBe(6);
		});

		it("backfills a legacy save with no hitDice field to full pools", () => {
			const loaded = new CharacterSheetState();
			loaded.loadFromJson({
				classes: [{name: "Wizard", source: "PHB", level: 5}],
			});

			expect(byType(loaded, "d6").max).toBe(5);
			expect(byType(loaded, "d6").current).toBe(5);
		});

		it("leaves an already-correct save unchanged", () => {
			const save = {
				classes: [{name: "Fighter", source: "PHB", level: 4}],
				hitDice: {d10: {current: 2, max: 4}},
			};
			const loaded = new CharacterSheetState();
			loaded.loadFromJson(save);

			expect(byType(loaded, "d10").max).toBe(4);
			expect(byType(loaded, "d10").current).toBe(2);
		});
	});

	// ==========================================================================
	// 7. Shared state / sync (Overview source == Short Rest spend path)
	// ==========================================================================
	describe("Shared state between Overview and Short Rest", () => {
		it("a short-rest-style decrement is reflected by getHitDice and getHitDiceByType", () => {
			state.addClass({name: "Ranger", source: "PHB", level: 1});
			for (let i = 2; i <= 6; i++) state.levelUp("Ranger");

			// Short Rest spends via adjustHitDieCurrent(type, -1) (same call the
			// Overview +/- and Use-Hit-Die button use).
			state.adjustHitDieCurrent("d10", -1);

			expect(byType(state, "d10").current).toBe(5); // Overview source
			expect(state.getHitDiceByType().d10.current).toBe(5); // Short Rest source
		});
	});

	// ==========================================================================
	// 8. Double-heal fix anchor
	// ==========================================================================
	describe("Double-heal fix anchor", () => {
		beforeEach(() => {
			state.addClass({name: "Fighter", source: "PHB", level: 1});
			for (let i = 2; i <= 5; i++) state.levelUp("Fighter");
			state.setAbilityBase("con", 14); // +2
		});

		it("adjustHitDieCurrent does NOT change HP", () => {
			state.setCurrentHp(1);
			const before = state.getCurrentHp();
			state.adjustHitDieCurrent("d10", -1);
			expect(state.getCurrentHp()).toBe(before);
		});

		it("useHitDie DOES heal (so the Overview/Short-Rest call sites must not heal twice)", () => {
			state.setCurrentHp(1);
			const before = state.getCurrentHp();
			state.useHitDie("d10");
			expect(state.getCurrentHp()).toBeGreaterThan(before);
		});
	});
});
