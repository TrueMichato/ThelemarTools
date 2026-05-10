/**
 * Source-Gating Negative Tests
 *
 * Verifies that TGTT-exclusive features (combat traditions, stamina, combat
 * method DC, etc.) do NOT leak into PHB or XPHB characters. A critical
 * regression safety net: if any of these tests fail, source gating is broken.
 */

import "./setup.js";

let CharacterSheetState;
let state;

beforeAll(async () => {
	CharacterSheetState = (await import("../../../js/charactersheet/charactersheet-state.js")).CharacterSheetState;
});

describe("Source Gating — TGTT features must not appear for non-TGTT characters", () => {
	beforeEach(() => {
		state = new CharacterSheetState();
	});

	// =========================================================================
	// PHB FIGHTER — no combat traditions
	// =========================================================================
	describe("PHB Fighter should NOT have combat traditions", () => {
		beforeEach(() => {
			state.addClass({name: "Fighter", source: "PHB", level: 5});
		});

		it("usesCombatSystem() returns false", () => {
			expect(state.usesCombatSystem()).toBe(false);
		});

		it("getFeatureCalculations() has no combatMethodDc", () => {
			const calc = state.getFeatureCalculations();
			expect(calc.combatMethodDc).toBeUndefined();
		});

		it("combat traditions list is empty", () => {
			expect(state.getCombatTraditions().length).toBe(0);
		});
	});

	// =========================================================================
	// PHB BARBARIAN — no stamina system
	// =========================================================================
	describe("PHB Barbarian should NOT have stamina system", () => {
		beforeEach(() => {
			state.addClass({name: "Barbarian", source: "PHB", level: 5});
		});

		it("usesCombatSystem() returns false", () => {
			expect(state.usesCombatSystem()).toBe(false);
		});

		it("stamina max is 0", () => {
			expect(state.getStaminaMax()).toBe(0);
		});

		it("stamina current is 0", () => {
			expect(state.getStaminaCurrent()).toBe(0);
		});

		it("getFeatureCalculations() has no combatMethodDc", () => {
			const calc = state.getFeatureCalculations();
			expect(calc.combatMethodDc).toBeUndefined();
		});
	});

	// =========================================================================
	// TGTT FIGHTER — SHOULD have combat traditions (positive control)
	// =========================================================================
	describe("TGTT Fighter SHOULD have combat traditions", () => {
		beforeEach(() => {
			state.addClass({name: "Fighter", source: "TGTT", level: 5});
			state.addCombatTradition("Unarmored Combat");
		});

		it("usesCombatSystem() returns true", () => {
			expect(state.usesCombatSystem()).toBe(true);
		});

		it("getFeatureCalculations() includes combatMethodDc", () => {
			const calc = state.getFeatureCalculations();
			expect(calc.combatMethodDc).toBeDefined();
			expect(typeof calc.combatMethodDc).toBe("number");
		});

		it("combat traditions list is non-empty", () => {
			expect(state.getCombatTraditions().length).toBeGreaterThan(0);
		});

		it("stamina pool is available after initialization", () => {
			state.ensureStaminaInitialized();
			// Level 5 → +3 prof bonus → 6 stamina
			expect(state.getStaminaMax()).toBe(6);
			expect(state.getStaminaCurrent()).toBe(6);
		});
	});

	// =========================================================================
	// PHB RANGER — no TGTT weapon mastery features
	// =========================================================================
	describe("PHB Ranger should NOT get TGTT-specific features", () => {
		beforeEach(() => {
			state.addClass({name: "Ranger", source: "PHB", level: 5});
		});

		it("usesCombatSystem() returns false", () => {
			expect(state.usesCombatSystem()).toBe(false);
		});

		it("getFeatureCalculations() has no combatMethodDc", () => {
			const calc = state.getFeatureCalculations();
			expect(calc.combatMethodDc).toBeUndefined();
		});

		it("combat traditions list is empty", () => {
			expect(state.getCombatTraditions().length).toBe(0);
		});

		it("stamina max is 0", () => {
			expect(state.getStaminaMax()).toBe(0);
		});
	});

	// =========================================================================
	// XPHB FIGHTER — no TGTT combat traditions
	// =========================================================================
	describe("XPHB Fighter should NOT have TGTT combat traditions", () => {
		beforeEach(() => {
			state.addClass({name: "Fighter", source: "XPHB", level: 5});
		});

		it("usesCombatSystem() returns false", () => {
			expect(state.usesCombatSystem()).toBe(false);
		});

		it("getFeatureCalculations() has no combatMethodDc", () => {
			const calc = state.getFeatureCalculations();
			expect(calc.combatMethodDc).toBeUndefined();
		});

		it("combat traditions list is empty", () => {
			expect(state.getCombatTraditions().length).toBe(0);
		});

		it("stamina max is 0", () => {
			expect(state.getStaminaMax()).toBe(0);
		});

		it("XPHB-specific features still work (weapon mastery)", () => {
			const calc = state.getFeatureCalculations();
			// XPHB Fighter gets weapon mastery — that's fine, it's not TGTT
			expect(calc.hasWeaponMastery).toBe(true);
		});
	});

	// =========================================================================
	// Cross-source isolation — adding traditions to PHB should still gate
	// =========================================================================
	describe("Cross-source edge cases", () => {
		it("PHB Fighter with no traditions does not use combat system even after ensureStaminaInitialized", () => {
			state.addClass({name: "Fighter", source: "PHB", level: 5});
			state.ensureStaminaInitialized();

			expect(state.usesCombatSystem()).toBe(false);
			expect(state.getStaminaMax()).toBe(0);
		});

		it("XPHB Barbarian does not use combat system", () => {
			state.addClass({name: "Barbarian", source: "XPHB", level: 5});

			expect(state.usesCombatSystem()).toBe(false);
			expect(state.getStaminaMax()).toBe(0);
		});

		it("PHB Monk does not use combat system", () => {
			state.addClass({name: "Monk", source: "PHB", level: 5});

			expect(state.usesCombatSystem()).toBe(false);
			expect(state.getFeatureCalculations().combatMethodDc).toBeUndefined();
		});

		it("XPHB Monk does not use combat system", () => {
			state.addClass({name: "Monk", source: "XPHB", level: 5});

			expect(state.usesCombatSystem()).toBe(false);
			expect(state.getFeatureCalculations().combatMethodDc).toBeUndefined();
		});
	});
});
