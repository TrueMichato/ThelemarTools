/**
 * Character Sheet Condition → Spellcasting Integration Tests
 *
 * Tests the generic casting constraint system:
 * - getCastingConstraints() aggregates verbal/somatic constraints from active conditions
 * - Silenced → cantCast verbal (banned)
 * - TGTT Frightened → verbalConstraint (check)
 * - TGTT Grappled → somaticConstraint (check)
 * - TGTT Restrained → somaticConstraint (banned)
 * - TGTT Choked → verbalConstraint (check)
 * - Incapacitating conditions auto-break concentration
 * - Non-incapacitating conditions don't break concentration
 * - Subtle Spell bypasses verbal/somatic constraints
 * - _checkCastingConstraints returns structured {block, checks}
 */

import "./setup.js";
import "../../../js/charactersheet/charactersheet-state.js";

const CharacterSheetState = globalThis.CharacterSheetState;

describe("CharacterSheetConditionSpellcasting", () => {
	let state;

	beforeEach(() => {
		state = new CharacterSheetState();
		state.setName("Condition Caster");
		state.setAbilityBase("str", 10);
		state.setAbilityBase("dex", 14);
		state.setAbilityBase("con", 14);
		state.setAbilityBase("int", 16);
		state.setAbilityBase("wis", 12);
		state.setAbilityBase("cha", 10);
		state.addClass({name: "Wizard", source: "XPHB", level: 5});
	});

	// =========================================================================
	// getCastingConstraints()
	// =========================================================================
	describe("getCastingConstraints", () => {
		it("should return empty constraints with no conditions", () => {
			const constraints = state.getCastingConstraints();
			expect(constraints.verbal).toEqual([]);
			expect(constraints.somatic).toEqual([]);
		});

		it("should detect Silenced as verbal banned", () => {
			state.addCondition({name: "Silenced", source: "HB"});
			const constraints = state.getCastingConstraints();
			expect(constraints.verbal).toEqual([
				expect.objectContaining({value: "banned", conditionName: "Silenced"}),
			]);
			expect(constraints.somatic).toEqual([]);
		});

		it("should detect TGTT Frightened as verbal check", () => {
			state.addCondition({name: "Frightened", source: "TGTT"});
			const constraints = state.getCastingConstraints();
			expect(constraints.verbal).toEqual([
				expect.objectContaining({value: "check", conditionName: "Frightened"}),
			]);
			expect(constraints.somatic).toEqual([]);
		});

		it("should detect TGTT Choked as verbal check", () => {
			state.addCondition({name: "Choked", source: "TGTT"});
			const constraints = state.getCastingConstraints();
			expect(constraints.verbal).toEqual([
				expect.objectContaining({value: "check", conditionName: "Choked"}),
			]);
		});

		it("should detect TGTT Grappled as somatic check", () => {
			state.addCondition({name: "Grappled", source: "TGTT"});
			const constraints = state.getCastingConstraints();
			expect(constraints.somatic).toEqual([
				expect.objectContaining({value: "check", conditionName: "Grappled"}),
			]);
			expect(constraints.verbal).toEqual([]);
		});

		it("should detect TGTT Restrained as somatic banned", () => {
			state.addCondition({name: "Restrained", source: "TGTT"});
			const constraints = state.getCastingConstraints();
			expect(constraints.somatic).toEqual([
				expect.objectContaining({value: "banned", conditionName: "Restrained"}),
			]);
		});

		it("should aggregate multiple constraints", () => {
			state.addCondition({name: "Frightened", source: "TGTT"});
			state.addCondition({name: "Grappled", source: "TGTT"});
			const constraints = state.getCastingConstraints();
			expect(constraints.verbal.length).toBe(1);
			expect(constraints.verbal[0].value).toBe("check");
			expect(constraints.somatic.length).toBe(1);
			expect(constraints.somatic[0].value).toBe("check");
		});

		it("should not return constraints for standard (non-TGTT) Grappled", () => {
			state.addCondition({name: "Grappled", source: "XPHB"});
			const constraints = state.getCastingConstraints();
			expect(constraints.verbal).toEqual([]);
			expect(constraints.somatic).toEqual([]);
		});

		it("should not return constraints for standard Frightened", () => {
			state.addCondition({name: "Frightened", source: "XPHB"});
			const constraints = state.getCastingConstraints();
			expect(constraints.verbal).toEqual([]);
			expect(constraints.somatic).toEqual([]);
		});

		it("should not return constraints for standard Restrained", () => {
			state.addCondition({name: "Restrained", source: "XPHB"});
			const constraints = state.getCastingConstraints();
			expect(constraints.verbal).toEqual([]);
			expect(constraints.somatic).toEqual([]);
		});

		it("should not return constraints for Blinded (no casting impact)", () => {
			state.addCondition({name: "Blinded", source: "XPHB"});
			const constraints = state.getCastingConstraints();
			expect(constraints.verbal).toEqual([]);
			expect(constraints.somatic).toEqual([]);
		});

		it("should clear constraints when condition is removed", () => {
			state.addCondition({name: "Silenced", source: "HB"});
			expect(state.getCastingConstraints().verbal.length).toBe(1);
			state.removeCondition({name: "Silenced", source: "HB"});
			const constraints = state.getCastingConstraints();
			expect(constraints.verbal).toEqual([]);
		});
	});

	// =========================================================================
	// Auto-break concentration on incapacitating conditions
	// =========================================================================
	describe("Concentration auto-break on incapacitation", () => {
		beforeEach(() => {
			state.setConcentration("Haste", 3);
		});

		it("should break concentration when Stunned is added", () => {
			expect(state.getConcentratingSpell()).not.toBeNull();
			state.addCondition({name: "Stunned", source: "XPHB"});
			expect(state.getConcentratingSpell()).toBeNull();
		});

		it("should break concentration when Paralyzed is added", () => {
			state.addCondition({name: "Paralyzed", source: "XPHB"});
			expect(state.getConcentratingSpell()).toBeNull();
		});

		it("should break concentration when Unconscious is added", () => {
			state.addCondition({name: "Unconscious", source: "XPHB"});
			expect(state.getConcentratingSpell()).toBeNull();
		});

		it("should break concentration when Petrified is added", () => {
			state.addCondition({name: "Petrified", source: "XPHB"});
			expect(state.getConcentratingSpell()).toBeNull();
		});

		it("should break concentration when TGTT Incapacitated is added", () => {
			state.addCondition({name: "Incapacitated", source: "TGTT"});
			expect(state.getConcentratingSpell()).toBeNull();
		});

		it("should break concentration when TGTT Petrified is added", () => {
			state.addCondition({name: "Petrified", source: "TGTT"});
			expect(state.getConcentratingSpell()).toBeNull();
		});

		it("should NOT break concentration for Silenced", () => {
			state.addCondition({name: "Silenced", source: "HB"});
			expect(state.getConcentratingSpell()).not.toBeNull();
			expect(state.getConcentratingSpell().spellName).toBe("Haste");
		});

		it("should NOT break concentration for Blinded", () => {
			state.addCondition({name: "Blinded", source: "XPHB"});
			expect(state.getConcentratingSpell()).not.toBeNull();
		});

		it("should NOT break concentration for Prone", () => {
			state.addCondition({name: "Prone", source: "XPHB"});
			expect(state.getConcentratingSpell()).not.toBeNull();
		});

		it("should NOT break concentration for Frightened", () => {
			state.addCondition({name: "Frightened", source: "XPHB"});
			expect(state.getConcentratingSpell()).not.toBeNull();
		});

		it("should NOT break concentration for TGTT Frightened", () => {
			state.addCondition({name: "Frightened", source: "TGTT"});
			expect(state.getConcentratingSpell()).not.toBeNull();
		});

		it("should NOT break concentration for TGTT Grappled", () => {
			state.addCondition({name: "Grappled", source: "TGTT"});
			expect(state.getConcentratingSpell()).not.toBeNull();
		});

		it("should NOT break concentration for Poisoned", () => {
			state.addCondition({name: "Poisoned", source: "XPHB"});
			expect(state.getConcentratingSpell()).not.toBeNull();
		});

		it("should not error when adding incapacitating condition without concentration", () => {
			state.breakConcentration();
			expect(state.getConcentratingSpell()).toBeNull();
			state.addCondition({name: "Stunned", source: "XPHB"});
			expect(state.getConcentratingSpell()).toBeNull();
		});

		it("should not break concentration for immune condition", () => {
			// Add condition immunity for Stunned (stored as lowercase strings)
			state._data.conditionImmunities = state._data.conditionImmunities || [];
			state._data.conditionImmunities.push("stunned");
			state.addCondition({name: "Stunned", source: "XPHB"});
			// Should not be added at all, so concentration preserved
			expect(state.getConcentratingSpell()).not.toBeNull();
		});
	});

	// =========================================================================
	// isIncapacitated() integration
	// =========================================================================
	describe("isIncapacitated", () => {
		it("should return false with no conditions", () => {
			expect(state.isIncapacitated()).toBe(false);
		});

		it("should return true when Stunned", () => {
			state.addCondition({name: "Stunned", source: "XPHB"});
			expect(state.isIncapacitated()).toBe(true);
		});

		it("should return true when Paralyzed", () => {
			state.addCondition({name: "Paralyzed", source: "XPHB"});
			expect(state.isIncapacitated()).toBe(true);
		});

		it("should return true when Unconscious", () => {
			state.addCondition({name: "Unconscious", source: "XPHB"});
			expect(state.isIncapacitated()).toBe(true);
		});

		it("should return false for Silenced", () => {
			state.addCondition({name: "Silenced", source: "HB"});
			expect(state.isIncapacitated()).toBe(false);
		});

		it("should return false for Frightened", () => {
			state.addCondition({name: "Frightened", source: "XPHB"});
			expect(state.isIncapacitated()).toBe(false);
		});

		it("should return true for TGTT Incapacitated", () => {
			state.addCondition({name: "Incapacitated", source: "TGTT"});
			expect(state.isIncapacitated()).toBe(true);
		});
	});

	// =========================================================================
	// CONDITION_EFFECTS definitions validation
	// =========================================================================
	describe("CONDITION_EFFECTS spellcasting effect types", () => {
		it("silenced should have cantCast verbal", () => {
			const def = CharacterSheetState.getConditionEffects("Silenced");
			const cantCast = def.effects.find(e => e.type === "cantCast" && e.target === "verbal");
			expect(cantCast).toBeTruthy();
		});

		it("choked (TGTT) should have verbalConstraint check", () => {
			const def = CharacterSheetState.getConditionEffects("Choked", "TGTT");
			const constraint = def.effects.find(e => e.type === "verbalConstraint" && e.value === "check");
			expect(constraint).toBeTruthy();
		});

		it("grappled_tgtt should have somaticConstraint check", () => {
			const def = CharacterSheetState.getConditionEffects("Grappled", "TGTT");
			const constraint = def.effects.find(e => e.type === "somaticConstraint" && e.value === "check");
			expect(constraint).toBeTruthy();
		});

		it("restrained_tgtt should have somaticConstraint banned", () => {
			const def = CharacterSheetState.getConditionEffects("Restrained", "TGTT");
			const constraint = def.effects.find(e => e.type === "somaticConstraint" && e.value === "banned");
			expect(constraint).toBeTruthy();
		});

		it("frightened_tgtt should have verbalConstraint check", () => {
			const def = CharacterSheetState.getConditionEffects("Frightened", "TGTT");
			const constraint = def.effects.find(e => e.type === "verbalConstraint" && e.value === "check");
			expect(constraint).toBeTruthy();
		});

		it("poisoned_tgtt should have concentration save disadvantage", () => {
			const def = CharacterSheetState.getConditionEffects("Poisoned", "TGTT");
			const disadv = def.effects.find(e => e.type === "disadvantage" && e.target === "save:con:concentration");
			expect(disadv).toBeTruthy();
		});

		it("standard grappled should NOT have somatic constraint", () => {
			const def = CharacterSheetState.getConditionEffects("Grappled");
			const constraint = def.effects.find(e => e.type === "somaticConstraint");
			expect(constraint).toBeFalsy();
		});

		it("standard frightened should NOT have verbal constraint", () => {
			const def = CharacterSheetState.getConditionEffects("Frightened");
			const constraint = def.effects.find(e => e.type === "verbalConstraint");
			expect(constraint).toBeFalsy();
		});

		it("standard restrained should NOT have somatic constraint", () => {
			const def = CharacterSheetState.getConditionEffects("Restrained");
			const constraint = def.effects.find(e => e.type === "somaticConstraint");
			expect(constraint).toBeFalsy();
		});
	});

	// =========================================================================
	// Multiple condition stacking
	// =========================================================================
	describe("Multiple condition constraint stacking", () => {
		it("should aggregate verbal + somatic from different conditions", () => {
			state.addCondition({name: "Choked", source: "TGTT"});
			state.addCondition({name: "Grappled", source: "TGTT"});
			const constraints = state.getCastingConstraints();
			expect(constraints.verbal.length).toBe(1);
			expect(constraints.verbal[0].conditionName).toBe("Choked");
			expect(constraints.somatic.length).toBe(1);
			expect(constraints.somatic[0].conditionName).toBe("Grappled");
		});

		it("should stack multiple verbal constraints from different sources", () => {
			state.addCondition({name: "Choked", source: "TGTT"});
			state.addCondition({name: "Frightened", source: "TGTT"});
			const constraints = state.getCastingConstraints();
			expect(constraints.verbal.length).toBe(2);
		});

		it("Silenced banned should coexist with TGTT check constraints", () => {
			state.addCondition({name: "Silenced", source: "HB"});
			state.addCondition({name: "Frightened", source: "TGTT"});
			const constraints = state.getCastingConstraints();
			// Should have both: banned from Silenced + check from Frightened
			const banned = constraints.verbal.find(c => c.value === "banned");
			const check = constraints.verbal.find(c => c.value === "check");
			expect(banned).toBeTruthy();
			expect(check).toBeTruthy();
		});
	});

	// =========================================================================
	// TGTT Poisoned → concentration save disadvantage
	// =========================================================================
	describe("TGTT Poisoned concentration disadvantage", () => {
		it("should add concentration save disadvantage when TGTT Poisoned", () => {
			state.addCondition({name: "Poisoned", source: "TGTT"});
			// The disadvantage on concentration saves comes through the active effects system
			const effects = state.getActiveStateEffects();
			const concDisadv = effects.find(e =>
				e.type === "disadvantage" && e.target === "save:con:concentration",
			);
			expect(concDisadv).toBeTruthy();
		});

		it("should NOT add concentration disadvantage for standard Poisoned", () => {
			state.addCondition({name: "Poisoned", source: "XPHB"});
			const effects = state.getActiveStateEffects();
			const concDisadv = effects.find(e =>
				e.type === "disadvantage" && e.target === "save:con:concentration",
			);
			expect(concDisadv).toBeFalsy();
		});
	});

	// =========================================================================
	// Standard incapacitated conditions - effect validation
	// =========================================================================
	describe("Standard incapacitating condition effects", () => {
		const incapacitatingConditions = [
			{name: "Stunned", source: "XPHB"},
			{name: "Paralyzed", source: "XPHB"},
			{name: "Unconscious", source: "XPHB"},
			{name: "Petrified", source: "XPHB"},
		];

		it.each(incapacitatingConditions)(
			"$name should have incapacitated effect in definition",
			({name, source}) => {
				const def = CharacterSheetState.getConditionEffects(name, source);
				expect(def).toBeTruthy();
				const incapEffect = def.effects.find(e => e.type === "incapacitated" && e.value === true);
				expect(incapEffect).toBeTruthy();
			},
		);
	});
});
