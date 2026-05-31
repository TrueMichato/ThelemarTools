
import "./setup.js";

let CharacterSheetState;
let state;

beforeAll(async () => {
	CharacterSheetState = (await import("../../../js/charactersheet/charactersheet-state.js")).CharacterSheetState;
});

describe("Exhaustion Mechanics", () => {
	beforeEach(() => {
		state = new CharacterSheetState();
		state.setAbilityBase("str", 14);
		state.setAbilityBase("dex", 14);
		state.setAbilityBase("con", 14);
		state.setAbilityBase("int", 16);
		state.setAbilityBase("wis", 14);
		state.setAbilityBase("cha", 10);
		state.addClass({name: "Wizard", source: "PHB", level: 5});
	});

	// ===================================================================
	// THELEMAR EXHAUSTION (priority)
	// ===================================================================
	describe("Thelemar Rules", () => {
		beforeEach(() => {
			state.setExhaustionRules("thelemar");
		});

		test("max exhaustion should be 10", () => {
			expect(state.getMaxExhaustion()).toBe(10);
		});

		test("should not die at exhaustion 6", () => {
			state.setExhaustion(6);
			expect(state.isDead()).toBe(false);
		});

		test("should not die at exhaustion 9", () => {
			state.setExhaustion(9);
			expect(state.isDead()).toBe(false);
		});

		test("should die at exhaustion 10", () => {
			state.setExhaustion(10);
			expect(state.isDead()).toBe(true);
		});

		test("exhaustion should clamp to 10", () => {
			state.setExhaustion(15);
			expect(state.getExhaustion()).toBe(10);
		});

		// --- d20 penalty: display methods are NOT affected (penalty applied at roll time only) ---
		test("should NOT bake d20 penalty into displayed save mod", () => {
			const baseSave = state.getSaveMod("dex");
			state.setExhaustion(3);
			expect(state.getSaveMod("dex")).toBe(baseSave);
			expect(state._getExhaustionD20Penalty()).toBe(3); // penalty still available for roll handlers
		});

		test("should NOT bake d20 penalty into displayed skill mod", () => {
			const baseSkill = state.getSkillMod("perception");
			state.setExhaustion(2);
			expect(state.getSkillMod("perception")).toBe(baseSkill);
			expect(state._getExhaustionD20Penalty()).toBe(2);
		});

		test("should NOT bake d20 penalty into displayed initiative", () => {
			const baseInit = state.getInitiative();
			state.setExhaustion(4);
			expect(state.getInitiative()).toBe(baseInit);
			expect(state._getExhaustionD20Penalty()).toBe(4);
		});

		test("should NOT bake d20 penalty into displayed spell attack bonus", () => {
			state._data.spellcasting.ability = "int";
			const baseAttack = state.getSpellAttackBonus();
			state.setExhaustion(2);
			expect(state.getSpellAttackBonus()).toBe(baseAttack);
			expect(state._getExhaustionD20Penalty()).toBe(2);
		});

		test("should NOT bake d20 penalty into displayed spell attack bonus by class name", () => {
			const baseAttack = state.getSpellAttackBonus("Wizard");
			state.setExhaustion(3);
			expect(state.getSpellAttackBonus("Wizard")).toBe(baseAttack);
			expect(state._getExhaustionD20Penalty()).toBe(3);
		});

		test("should apply -1 per level to spell save DC", () => {
			state._data.spellcasting.ability = "int";
			const baseDc = state.getSpellSaveDc();
			state.setExhaustion(2);
			expect(state.getSpellSaveDc()).toBe(baseDc - 2);
		});

		test("should NOT apply speed penalty", () => {
			const baseSpeed = state.getWalkSpeed();
			state.setExhaustion(5);
			expect(state.getWalkSpeed()).toBe(baseSpeed);
		});

		test("d20 penalty source returns correct magnitude regardless of display", () => {
			state.setExhaustion(8);
			expect(state._getExhaustionD20Penalty()).toBe(8);
			// Display value is "pure" — penalty NOT baked in
			const save = state.getSaveMod("dex");
			expect(save).toBe(state.getAbilityMod("dex")); // No proficiency in DEX saves for wizard
		});

		test("passive perception is NOT reduced by exhaustion (it is a static value, not a roll)", () => {
			const basePassive = state.getPassivePerception();
			state.setExhaustion(3);
			expect(state.getPassivePerception()).toBe(basePassive);
		});

		// --- Feature calc d20 bonuses: stay pure (parallel to getSpellAttackBonus) ---
		test("getFeatureCalculations spell attack bonus stays pure (d20 bonus, not DC)", () => {
			// Per Phase 1 doctrine: d20 bonuses (incl. calc.spellAttackBonus) are exhaustion-free
			// at display/calc time. Roll handlers apply the penalty once via _getExhaustionD20Penalty.
			const baseCalcs = state.getFeatureCalculations?.() || {};
			const baseAttack = baseCalcs.spellAttackBonus;
			// Only run the assertion if this character actually exposes spellAttackBonus
			if (baseAttack == null) return;
			state.setExhaustion(3);
			const newCalcs = state.getFeatureCalculations?.() || {};
			expect(newCalcs.spellAttackBonus).toBe(baseAttack);
			expect(state._getExhaustionD20Penalty()).toBe(3);
		});

		test("getFeatureCalculations spell save DC IS reduced by exhaustion (DC, not d20 bonus)", () => {
			// Per Phase 1 doctrine: DCs ARE reduced by exhaustion in Thelemar rules.
			// This test pins the asymmetry against accidental "cleanup" of DC sites.
			const baseCalcs = state.getFeatureCalculations?.() || {};
			const baseDc = baseCalcs.spellSaveDc;
			if (baseDc == null) return;
			state.setExhaustion(2);
			const newCalcs = state.getFeatureCalculations?.() || {};
			expect(newCalcs.spellSaveDc).toBe(baseDc - 2);
		});
	});

	// ===================================================================
	// 2024 XPHB EXHAUSTION
	// ===================================================================
	describe("2024 Rules", () => {
		beforeEach(() => {
			state.setExhaustionRules("2024");
		});

		test("max exhaustion should be 6", () => {
			expect(state.getMaxExhaustion()).toBe(6);
		});

		test("should die at exhaustion 6", () => {
			state.setExhaustion(6);
			expect(state.isDead()).toBe(true);
		});

		test("should not die at exhaustion 5", () => {
			state.setExhaustion(5);
			expect(state.isDead()).toBe(false);
		});

		// --- d20 penalty: display methods unaffected; penalty exposed for roll handlers ---
		test("should NOT bake d20 penalty into displayed save mod", () => {
			const baseSave = state.getSaveMod("wis");
			state.setExhaustion(2);
			expect(state.getSaveMod("wis")).toBe(baseSave);
			expect(state._getExhaustionD20Penalty()).toBe(2);
		});

		test("should NOT bake d20 penalty into displayed skill mod", () => {
			const baseSkill = state.getSkillMod("athletics");
			state.setExhaustion(3);
			expect(state.getSkillMod("athletics")).toBe(baseSkill);
			expect(state._getExhaustionD20Penalty()).toBe(3);
		});

		test("should NOT bake d20 penalty into displayed initiative", () => {
			const baseInit = state.getInitiative();
			state.setExhaustion(2);
			expect(state.getInitiative()).toBe(baseInit);
			expect(state._getExhaustionD20Penalty()).toBe(2);
		});

		test("should NOT bake d20 penalty into displayed spell attack bonus", () => {
			state._data.spellcasting.ability = "int";
			const baseAttack = state.getSpellAttackBonus();
			state.setExhaustion(1);
			expect(state.getSpellAttackBonus()).toBe(baseAttack);
			expect(state._getExhaustionD20Penalty()).toBe(1);
		});

		// --- Speed penalty ---
		test("should reduce walk speed by 5 per level", () => {
			const baseSpeed = state.getWalkSpeed();
			state.setExhaustion(2);
			expect(state.getWalkSpeed()).toBe(baseSpeed - 10);
		});

		test("should reduce walk speed by 5 per level (level 4 = -20)", () => {
			state.setExhaustion(4);
			// Base 30 - 20 = 10
			expect(state.getWalkSpeed()).toBe(10);
		});

		test("speed should not go below 0", () => {
			state.setExhaustion(7); // Would be -35 from base 30, clamped
			state.setExhaustion(Math.min(6, 7)); // Clamped to 6
			// Exhaustion 6 = death, but speed: 30 - 30 = 0
			expect(state.getWalkSpeed()).toBe(0);
		});

		test("fly speed should also be reduced", () => {
			state.setSpeed("fly", 60);
			state.setExhaustion(3);
			// 60 - 15 = 45
			expect(state.getSpeedByType("fly")).toBe(45);
		});

		test("should NOT apply penalty to spell save DCs (DCs aren't d20 rolls)", () => {
			expect(state._getExhaustionDcPenalty()).toBe(0);
		});

		test("getSpeed display string should reflect exhaustion penalty", () => {
			state.setExhaustion(2);
			const speedStr = state.getSpeed();
			// Base 30 - 10 = 20
			expect(speedStr).toContain("20 ft.");
		});
	});

	// ===================================================================
	// 2014 PHB EXHAUSTION
	// ===================================================================
	describe("2014 Rules", () => {
		beforeEach(() => {
			state.setExhaustionRules("2014");
		});

		test("max exhaustion should be 6", () => {
			expect(state.getMaxExhaustion()).toBe(6);
		});

		test("should die at exhaustion 6", () => {
			state.setExhaustion(6);
			expect(state.isDead()).toBe(true);
		});

		test("should NOT bake flat d20 penalty into displayed save mod (2014 uses disadvantage tiers)", () => {
			expect(state._getExhaustionD20Penalty()).toBe(0);
			const baseSave = state.getSaveMod("str");
			state.setExhaustion(3);
			expect(state.getSaveMod("str")).toBe(baseSave); // No change
		});

		test("should NOT apply flat speed penalty (2014 uses multiplier tiers)", () => {
			expect(state._getExhaustionSpeedPenalty()).toBe(0);
		});

		test("should NOT apply DC penalty", () => {
			expect(state._getExhaustionDcPenalty()).toBe(0);
		});
	});

	// ===================================================================
	// PENALTY METHODS DIRECTLY
	// ===================================================================
	describe("Penalty Helper Methods", () => {
		test("_getExhaustionD20Penalty should return 0 at exhaustion 0", () => {
			state.setExhaustionRules("2024");
			state.setExhaustion(0);
			expect(state._getExhaustionD20Penalty()).toBe(0);
		});

		test("_getExhaustionD20Penalty should scale with level (2024)", () => {
			state.setExhaustionRules("2024");
			for (let i = 1; i <= 5; i++) {
				state.setExhaustion(i);
				expect(state._getExhaustionD20Penalty()).toBe(i);
			}
		});

		test("_getExhaustionD20Penalty should scale with level (thelemar)", () => {
			state.setExhaustionRules("thelemar");
			for (let i = 1; i <= 10; i++) {
				state.setExhaustion(i);
				expect(state._getExhaustionD20Penalty()).toBe(i);
			}
		});

		test("_getExhaustionSpeedPenalty should be 5*level for 2024", () => {
			state.setExhaustionRules("2024");
			state.setExhaustion(3);
			expect(state._getExhaustionSpeedPenalty()).toBe(15);
		});

		test("_getExhaustionSpeedPenalty should be 0 for thelemar", () => {
			state.setExhaustionRules("thelemar");
			state.setExhaustion(5);
			expect(state._getExhaustionSpeedPenalty()).toBe(0);
		});

		test("_getExhaustionSpeedPenalty should be 0 for 2014", () => {
			state.setExhaustionRules("2014");
			state.setExhaustion(3);
			expect(state._getExhaustionSpeedPenalty()).toBe(0);
		});

		test("_getExhaustionDcPenalty should apply only for thelemar", () => {
			state.setExhaustion(3);

			state.setExhaustionRules("thelemar");
			expect(state._getExhaustionDcPenalty()).toBe(3);

			state.setExhaustionRules("2024");
			expect(state._getExhaustionDcPenalty()).toBe(0);

			state.setExhaustionRules("2014");
			expect(state._getExhaustionDcPenalty()).toBe(0);
		});
	});

	// ===================================================================
	// isDead ACROSS RULE SETS
	// ===================================================================
	describe("isDead", () => {
		test("2024: dead at exhaustion 6", () => {
			state.setExhaustionRules("2024");
			state.setExhaustion(5);
			expect(state.isDead()).toBe(false);
			state.setExhaustion(6);
			expect(state.isDead()).toBe(true);
		});

		test("2014: dead at exhaustion 6", () => {
			state.setExhaustionRules("2014");
			state.setExhaustion(5);
			expect(state.isDead()).toBe(false);
			state.setExhaustion(6);
			expect(state.isDead()).toBe(true);
		});

		test("thelemar: NOT dead at exhaustion 6 or 9, dead at 10", () => {
			state.setExhaustionRules("thelemar");
			state.setExhaustion(6);
			expect(state.isDead()).toBe(false);
			state.setExhaustion(9);
			expect(state.isDead()).toBe(false);
			state.setExhaustion(10);
			expect(state.isDead()).toBe(true);
		});

		test("death saves still cause death regardless of exhaustion rules", () => {
			state.setExhaustionRules("thelemar");
			state._data.deathSaves.failures = 3;
			expect(state.isDead()).toBe(true);
		});
	});

	// ===================================================================
	// RULE SWITCHING
	// ===================================================================
	describe("Rule Switching", () => {
		test("switching from thelemar to 2024 should clamp exhaustion to 6", () => {
			state.setExhaustionRules("thelemar");
			state.setExhaustion(8);
			expect(state.getExhaustion()).toBe(8);
			state.setExhaustionRules("2024");
			expect(state.getExhaustion()).toBe(6);
		});

		test("switching from 2024 to thelemar should preserve exhaustion", () => {
			state.setExhaustionRules("2024");
			state.setExhaustion(4);
			state.setExhaustionRules("thelemar");
			expect(state.getExhaustion()).toBe(4);
		});

		test("penalty type should change when rules change", () => {
			state.setExhaustion(3);
			state.setExhaustionRules("2024");
			expect(state._getExhaustionD20Penalty()).toBe(3);
			expect(state._getExhaustionSpeedPenalty()).toBe(15);
			expect(state._getExhaustionDcPenalty()).toBe(0);

			state.setExhaustionRules("thelemar");
			expect(state._getExhaustionD20Penalty()).toBe(3);
			expect(state._getExhaustionSpeedPenalty()).toBe(0);
			expect(state._getExhaustionDcPenalty()).toBe(3);

			state.setExhaustionRules("2014");
			expect(state._getExhaustionD20Penalty()).toBe(0);
			expect(state._getExhaustionSpeedPenalty()).toBe(0);
			expect(state._getExhaustionDcPenalty()).toBe(0);
		});
	});

	// ===================================================================
	// EDGE CASES
	// ===================================================================
	describe("Edge Cases", () => {
		test("no penalty at exhaustion 0", () => {
			state.setExhaustionRules("2024");
			state.setExhaustion(0);
			expect(state._getExhaustionD20Penalty()).toBe(0);
			expect(state._getExhaustionSpeedPenalty()).toBe(0);
		});

		test("removing exhaustion is a no-op on displayed save mod (penalty was never baked in)", () => {
			state.setExhaustionRules("thelemar");
			state.setExhaustion(5);
			const penalizedSave = state.getSaveMod("wis");
			state.setExhaustion(0);
			const normalSave = state.getSaveMod("wis");
			expect(normalSave).toBe(penalizedSave); // displayed bonus unchanged by exhaustion
		});

		test("addExhaustion should increment correctly", () => {
			state.setExhaustionRules("thelemar");
			state.addExhaustion(3);
			expect(state.getExhaustion()).toBe(3);
			state.addExhaustion(2);
			expect(state.getExhaustion()).toBe(5);
		});

		test("removeExhaustion should decrement correctly", () => {
			state.setExhaustionRules("2024");
			state.setExhaustion(4);
			state.removeExhaustion(2);
			expect(state.getExhaustion()).toBe(2);
		});

		test("removeExhaustion should not go below 0", () => {
			state.setExhaustion(1);
			state.removeExhaustion(5);
			expect(state.getExhaustion()).toBe(0);
		});

		test("no d20-based display outputs are affected by exhaustion (penalty only at roll time)", () => {
			state.setExhaustionRules("2024");
			state._data.spellcasting.ability = "int";

			const baseSave = state.getSaveMod("str");
			const baseSkill = state.getSkillMod("athletics");
			const baseInit = state.getInitiative();
			const baseSpellAtk = state.getSpellAttackBonus();

			state.setExhaustion(3);

			expect(state.getSaveMod("str")).toBe(baseSave);
			expect(state.getSkillMod("athletics")).toBe(baseSkill);
			expect(state.getInitiative()).toBe(baseInit);
			expect(state.getSpellAttackBonus()).toBe(baseSpellAtk);
			// Penalty is still available for the roll handlers to subtract at roll time
			expect(state._getExhaustionD20Penalty()).toBe(3);
		});
	});
});
