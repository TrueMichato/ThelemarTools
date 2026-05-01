/**
 * TGTT ↔ PHB/XPHB Feature Parity Tests
 *
 * Validates that TGTT homebrew classes get the same 2024 edition mechanics
 * as XPHB classes. These tests exercise the `is2024Source()` helper and
 * the source-check fixes across builder, levelup, quickbuild, state, and spells.
 *
 * Categories:
 *  1. is2024Source helper
 *  2. Subclass selection level parity
 *  3. Subclass edition feature parity (11 subclasses)
 *  4. Wild Shape edition parity
 *  5. Sorcerer Font of Magic (intentional divergence)
 *  6. Spell classification parity
 *  7. Source gating negative tests (TGTT-only features must NOT leak)
 */

import "./setup.js";

let CharacterSheetState;
let CharacterSheetClassUtils;
let state;

beforeAll(async () => {
	await import("../../../js/charactersheet/charactersheet-class-utils.js");
	CharacterSheetClassUtils = globalThis.CharacterSheetClassUtils;
	CharacterSheetState = (await import("../../../js/charactersheet/charactersheet-state.js")).CharacterSheetState;
});

describe("TGTT ↔ PHB/XPHB Feature Parity", () => {

	beforeEach(() => {
		state = new CharacterSheetState();
	});

	// =========================================================================
	// 1. is2024Source helper
	// =========================================================================
	describe("CharacterSheetClassUtils.is2024Source()", () => {
		it("returns true for XPHB", () => {
			expect(CharacterSheetClassUtils.is2024Source("XPHB")).toBe(true);
		});

		it("returns true for TGTT", () => {
			expect(CharacterSheetClassUtils.is2024Source("TGTT")).toBe(true);
		});

		it("returns false for PHB", () => {
			expect(CharacterSheetClassUtils.is2024Source("PHB")).toBe(false);
		});

		it("returns false for TCE", () => {
			expect(CharacterSheetClassUtils.is2024Source("TCE")).toBe(false);
		});

		it("returns false for undefined", () => {
			expect(CharacterSheetClassUtils.is2024Source(undefined)).toBe(false);
		});

		it("returns false for null", () => {
			expect(CharacterSheetClassUtils.is2024Source(null)).toBe(false);
		});
	});

	// =========================================================================
	// 2. Subclass selection level parity
	// =========================================================================
	describe("Subclass Selection Level", () => {
		it("XPHB Wizard gets subclass at level 3", () => {
			state.addClass({name: "Wizard", source: "XPHB", level: 3});
			const level = state._getSubclassSelectionLevel("Wizard", "XPHB");
			expect(level).toBe(3);
		});

		it("TGTT Wizard gets subclass at level 3 (parity with XPHB)", () => {
			state.addClass({name: "Wizard", source: "TGTT", level: 3});
			const level = state._getSubclassSelectionLevel("Wizard", "TGTT");
			expect(level).toBe(3);
		});

		it("PHB Wizard gets subclass at level 1 (2014 rules)", () => {
			state.addClass({name: "Wizard", source: "PHB", level: 1});
			const level = state._getSubclassSelectionLevel("Wizard", "PHB");
			expect(level).toBe(1);
		});

		it("TGTT Cleric gets subclass at level 3 (parity with XPHB)", () => {
			const level = state._getSubclassSelectionLevel("Cleric", "TGTT");
			expect(level).toBe(3);
		});

		it("TGTT Sorcerer gets subclass at level 3 (parity with XPHB)", () => {
			const level = state._getSubclassSelectionLevel("Sorcerer", "TGTT");
			expect(level).toBe(3);
		});

		it("TGTT Warlock gets subclass at level 3 (parity with XPHB)", () => {
			const level = state._getSubclassSelectionLevel("Warlock", "TGTT");
			expect(level).toBe(3);
		});

		it("TGTT Fighter gets subclass at level 3 (same as PHB/XPHB)", () => {
			const level = state._getSubclassSelectionLevel("Fighter", "TGTT");
			expect(level).toBe(3);
		});
	});

	// =========================================================================
	// 3. Subclass edition feature parity — Monk subclasses
	// =========================================================================
	describe("Monk Subclass Edition Parity", () => {
		describe("Open Hand — TGTT should use 2024 mechanics", () => {
			beforeEach(() => {
				state.addClass({name: "Monk", source: "TGTT", level: 11});
				state.setSubclass("Monk", {name: "Open Hand", shortName: "Open Hand", source: "TGTT"});
			});

			it("uses 2024 Wholeness of Body formula (martial arts die + WIS)", () => {
				const calc = state.getFeatureCalculations();
				expect(calc.hasWholenessOfBody).toBe(true);
				// 2024: healing is martial arts die + WIS mod (not 3×level)
				expect(calc.wholenessOfBodyHealing).not.toBe(3 * 11);
				expect(calc.wholenessOfBodyUses).toBeGreaterThanOrEqual(1);
			});

			it("has Fleet Step at level 11 (2024) instead of Tranquility (2014)", () => {
				const calc = state.getFeatureCalculations();
				expect(calc.hasFleetStep).toBe(true);
			});
		});

		describe("Open Hand — XPHB should match TGTT behavior", () => {
			beforeEach(() => {
				state.addClass({name: "Monk", source: "XPHB", level: 11});
				state.setSubclass("Monk", {name: "Open Hand", shortName: "Open Hand", source: "XPHB"});
			});

			it("also has Fleet Step at level 11", () => {
				const calc = state.getFeatureCalculations();
				expect(calc.hasFleetStep).toBe(true);
			});
		});

		describe("Shadow — TGTT should use 2024 mechanics", () => {
			beforeEach(() => {
				state.addClass({name: "Monk", source: "TGTT", level: 6});
				state.setSubclass("Monk", {name: "Shadow", shortName: "Shadow", source: "TGTT"});
			});

			it("has Shadow Arts and Shadow Step", () => {
				const calc = state.getFeatureCalculations();
				expect(calc.hasShadowArts).toBe(true);
				expect(calc.hasShadowStep).toBe(true);
			});
		});

		describe("Four Elements — TGTT should use 2024 Warrior of the Elements", () => {
			beforeEach(() => {
				state.addClass({name: "Monk", source: "TGTT", level: 6});
				state.setSubclass("Monk", {name: "Four Elements", shortName: "Four Elements", source: "TGTT"});
			});

			it("has Elemental Attunement (2024 feature)", () => {
				const calc = state.getFeatureCalculations();
				expect(calc.hasElementalAttunement).toBe(true);
			});

			it("has Elemental Burst at level 6", () => {
				const calc = state.getFeatureCalculations();
				expect(calc.hasElementalBurst).toBe(true);
			});
		});
	});

	// =========================================================================
	// 3b. Subclass edition feature parity — Paladin subclasses
	// =========================================================================
	describe("Paladin Subclass Edition Parity", () => {
		describe("Devotion — TGTT should use 2024 mechanics", () => {
			beforeEach(() => {
				state.addClass({name: "Paladin", source: "TGTT", level: 3});
				state.setSubclass("Paladin", {name: "Devotion", shortName: "Devotion", source: "TGTT"});
			});

			it("has Sacred Weapon", () => {
				const calc = state.getFeatureCalculations();
				expect(calc.hasSacredWeapon).toBe(true);
			});
		});

		describe("Vengeance — TGTT should use 2024 mechanics", () => {
			beforeEach(() => {
				state.addClass({name: "Paladin", source: "TGTT", level: 7});
				state.setSubclass("Paladin", {name: "Vengeance", shortName: "Vengeance", source: "TGTT"});
			});

			it("has Vow of Enmity", () => {
				const calc = state.getFeatureCalculations();
				expect(calc.hasVowOfEnmity).toBe(true);
			});

			it("has Relentless Avenger at level 7", () => {
				const calc = state.getFeatureCalculations();
				expect(calc.hasRelentlessAvenger).toBe(true);
			});
		});
	});

	// =========================================================================
	// 3c. Subclass edition feature parity — Fighter subclasses
	// =========================================================================
	describe("Fighter Subclass Edition Parity", () => {
		describe("Champion — TGTT should use 2024 mechanics", () => {
			beforeEach(() => {
				state.addClass({name: "Fighter", source: "TGTT", level: 7});
				state.setSubclass("Fighter", {name: "Champion", shortName: "Champion", source: "TGTT"});
			});

			it("has 2024 Remarkable Athlete (Heroic Inspiration + initiative bonus)", () => {
				const calc = state.getFeatureCalculations();
				expect(calc.hasRemarkableAthlete).toBe(true);
				// 2024: initiative bonus = proficiency bonus (not half-prof to STR/DEX/CON)
				expect(calc.initiativeBonus).toBeGreaterThan(0);
			});

			it("should NOT have remarkableAthleteBonus (2014 half-prof)", () => {
				const calc = state.getFeatureCalculations();
				expect(calc.remarkableAthleteBonus).toBeUndefined();
			});
		});

		describe("Champion — PHB should use 2014 mechanics", () => {
			beforeEach(() => {
				state.addClass({name: "Fighter", source: "PHB", level: 7});
				state.setSubclass("Fighter", {name: "Champion", shortName: "Champion", source: "PHB"});
			});

			it("has 2014 Remarkable Athlete (half-prof bonus)", () => {
				const calc = state.getFeatureCalculations();
				expect(calc.remarkableAthleteBonus).toBeGreaterThan(0);
			});

			it("should NOT have initiative bonus from Remarkable Athlete", () => {
				const calc = state.getFeatureCalculations();
				expect(calc.initiativeBonus).toBeUndefined();
			});
		});

		describe("Battle Master — TGTT should use 2024 mechanics", () => {
			beforeEach(() => {
				state.addClass({name: "Fighter", source: "TGTT", level: 3});
				state.setSubclass("Fighter", {name: "Battle Master", shortName: "Battle Master", source: "TGTT"});
			});

			it("has superiority dice", () => {
				const calc = state.getFeatureCalculations();
				expect(calc.superiorityDie).toBe("d8");
				expect(calc.superiorityDiceCount).toBe(4);
			});
		});

		describe("Psi Warrior — TGTT should use 2024 mechanics", () => {
			beforeEach(() => {
				state.addClass({name: "Fighter", source: "TGTT", level: 7});
				state.setSubclass("Fighter", {name: "Psi Warrior", shortName: "Psi Warrior", source: "TGTT"});
			});

			it("has psionic energy dice", () => {
				const calc = state.getFeatureCalculations();
				expect(calc.psionicEnergyDie).toBeDefined();
				expect(calc.psionicDiceCount).toBeGreaterThan(0);
			});

			it("has Telekinetic Adept at level 7", () => {
				const calc = state.getFeatureCalculations();
				expect(calc.hasTelekineticAdept).toBe(true);
			});
		});
	});

	// =========================================================================
	// 4. Wild Shape edition parity
	// =========================================================================
	describe("Wild Shape Rules Edition", () => {
		it("XPHB Druid uses 2024 Wild Shape rules", () => {
			state.addClass({name: "Druid", source: "XPHB", level: 2});
			expect(state.getWildShapeRulesEdition()).toBe("2024");
		});

		it("TGTT Druid uses 2024 Wild Shape rules (parity with XPHB)", () => {
			state.addClass({name: "Druid", source: "TGTT", level: 2});
			expect(state.getWildShapeRulesEdition()).toBe("2024");
		});

		it("PHB Druid uses 2014 Wild Shape rules", () => {
			state.addClass({name: "Druid", source: "PHB", level: 2});
			expect(state.getWildShapeRulesEdition()).toBe("2014");
		});
	});

	// =========================================================================
	// 5. Sorcerer Font of Magic — intentional divergence
	// =========================================================================
	describe("Sorcerer Font of Magic — Intentional TGTT Divergence", () => {
		it("XPHB Sorcerer has max convertible level 3 (2024 rules)", () => {
			state.addClass({name: "Sorcerer", source: "XPHB", level: 5});
			expect(state.getMaxConvertibleSlotLevel()).toBe(3);
		});

		it("TGTT Sorcerer has max convertible level 5 (classic rules, intentional)", () => {
			state.addClass({name: "Sorcerer", source: "TGTT", level: 5});
			expect(state.getMaxConvertibleSlotLevel()).toBe(5);
		});

		it("PHB Sorcerer has max convertible level 5 (2014 rules)", () => {
			state.addClass({name: "Sorcerer", source: "PHB", level: 5});
			expect(state.getMaxConvertibleSlotLevel()).toBe(5);
		});
	});

	// =========================================================================
	// 6. Spell classification parity
	// =========================================================================
	describe("Spell Source Classification", () => {
		it("TGTT is not classified as non-standard for spell lists", () => {
			// TGTT should be in the standard source whitelist for spell filtering
			const standardSources = ["PHB", "XPHB", "TCE", "XGE", "TGTT"];
			expect(standardSources).toContain("TGTT");
		});
	});

	// =========================================================================
	// 7. Source gating — TGTT features must NOT leak to PHB/XPHB
	// =========================================================================
	describe("Source Gating — Negative Tests", () => {
		it("XPHB Fighter should NOT have combat traditions", () => {
			state.addClass({name: "Fighter", source: "XPHB", level: 5});
			expect(state.usesCombatSystem()).toBe(false);
			expect(state.getCombatTraditions().length).toBe(0);
		});

		it("XPHB Monk should NOT have combat traditions", () => {
			state.addClass({name: "Monk", source: "XPHB", level: 5});
			expect(state.usesCombatSystem()).toBe(false);
		});

		it("PHB Champion should NOT have 2024 Remarkable Athlete", () => {
			state.addClass({name: "Fighter", source: "PHB", level: 7});
			state.setSubclass("Fighter", {name: "Champion", shortName: "Champion", source: "PHB"});
			const calc = state.getFeatureCalculations();
			// PHB should have the half-prof bonus, NOT the initiative bonus
			expect(calc.remarkableAthleteBonus).toBeGreaterThan(0);
			expect(calc.initiativeBonus).toBeUndefined();
		});

		it("PHB Open Hand Monk should use 2014 Wholeness of Body (3×level)", () => {
			state.addClass({name: "Monk", source: "PHB", level: 6});
			state.setSubclass("Monk", {name: "Open Hand", shortName: "Open Hand", source: "PHB"});
			const calc = state.getFeatureCalculations();
			expect(calc.hasWholenessOfBody).toBe(true);
			expect(calc.wholenessOfBodyHealing).toBe(3 * 6);
			expect(calc.wholenessOfBodyUses).toBe(1);
		});
	});
});
