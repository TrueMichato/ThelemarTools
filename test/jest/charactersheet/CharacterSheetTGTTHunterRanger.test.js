/**
 * TGTT Hunter Ranger — Full L1→20 test coverage.
 *
 * Covers:
 * - Core TGTT Ranger setup (half-caster, WIS-based spells)
 * - Primal Focus system (predator/prey mode, Focused Quarry, Hunter's Dodge)
 * - Ranger Specialties at 1, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20 (11 total)
 * - Combat Methods at L2 (6 traditions, WIS-based or STR/DEX DC)
 * - Fighting Style at L2
 * - Primal Focus Upgrade at L6/L10/L14/L20
 * - Hunter subclass features:
 *     Colossus Slayer / Giant Killer / Horde Breaker (L3),
 *     Defensive Tactics (L7), Multiattack (L11),
 *     Superior Hunter's Defense (L15)
 * - Spell slot progression (half-caster)
 * - Full L1→20 progression
 */

import "./setup.js";

let CharacterSheetState;
let state;

beforeAll(async () => {
	CharacterSheetState = (await import("../../../js/charactersheet/charactersheet-state.js")).CharacterSheetState;
});

describe("TGTT Hunter Ranger", () => {

	beforeEach(() => {
		state = new CharacterSheetState();
	});

	// =========================================================================
	// HELPER
	// =========================================================================
	function makeHunterRanger (level) {
		state.addClass({
			name: "Ranger",
			source: "TGTT",
			level,
			subclass: level >= 3
				? {name: "Hunter", shortName: "Hunter", source: "TGTT"}
				: undefined,
		});
		state.setAbilityBase("str", 12); // +1
		state.setAbilityBase("dex", 16); // +3
		state.setAbilityBase("con", 14); // +2
		state.setAbilityBase("int", 10);
		state.setAbilityBase("wis", 16); // +3
		state.setAbilityBase("cha", 8);
	}

	// =========================================================================
	// CORE CLASS SETUP
	// =========================================================================
	describe("Core Class Setup", () => {
		it("should create a TGTT Ranger", () => {
			makeHunterRanger(1);
			const classes = state.getClasses();
			expect(classes.length).toBe(1);
			expect(classes[0].name).toBe("Ranger");
			expect(classes[0].source).toBe("TGTT");
		});

		it("should recognise the Hunter subclass at level 3", () => {
			makeHunterRanger(3);
			const classes = state.getClasses();
			expect(classes[0].subclass).toBeDefined();
			expect(classes[0].subclass.shortName).toBe("Hunter");
		});

		it("should use WIS as spellcasting ability", () => {
			makeHunterRanger(5);
			state.applyClassFeatureEffects();
			const calcs = state.getFeatureCalculations();
			// Spell DC = 8 + prof(3) + WIS(3) = 14
			expect(calcs.spellSaveDc).toBe(14);
			expect(calcs.spellAttackBonus).toBe(6);
		});
	});

	// =========================================================================
	// PRIMAL FOCUS SYSTEM
	// =========================================================================
	describe("Primal Focus System", () => {
		it("should have Primal Focus as a TGTT Ranger", () => {
			makeHunterRanger(1);
			state.applyClassFeatureEffects();
			expect(state.hasPrimalFocus()).toBe(true);
		});

		it("should not have Primal Focus as non-TGTT Ranger", () => {
			state.addClass({name: "Ranger", source: "PHB", level: 5});
			state.applyClassFeatureEffects();
			expect(state.hasPrimalFocus()).toBe(false);
		});

		describe("Focus Switches Progression", () => {
			const progression = [
				{level: 1, expected: 1},
				{level: 5, expected: 1},
				{level: 6, expected: 2},
				{level: 10, expected: 3},
				{level: 14, expected: 4},
				{level: 20, expected: "Unlimited"},
			];

			progression.forEach(({level, expected}) => {
				it(`should have ${expected} focus switch(es) at level ${level}`, () => {
					const s = new CharacterSheetState();
					s.addClass({name: "Ranger", source: "TGTT", level});
					s.applyClassFeatureEffects();
					expect(s.getFeatureCalculations().focusSwitchesMax).toBe(expected);
				});
			});
		});

		describe("Focused Quarry Damage Progression", () => {
			const progression = [
				{level: 1, damage: "1d4"},
				{level: 5, damage: "1d6"},
				{level: 10, damage: "1d8"},
				{level: 14, damage: "1d10"},
			];

			progression.forEach(({level, damage}) => {
				it(`should deal ${damage} extra damage at level ${level}`, () => {
					const s = new CharacterSheetState();
					s.addClass({name: "Ranger", source: "TGTT", level});
					s.applyClassFeatureEffects();
					expect(s.getFeatureCalculations().focusedQuarryDamage).toBe(damage);
				});
			});
		});

		describe("Mode Switching", () => {
			beforeEach(() => {
				makeHunterRanger(6);
				state.applyClassFeatureEffects();
			});

			it("should start in predator mode", () => {
				expect(state.getPrimalFocusMode()).toBe("predator");
			});

			it("should toggle between predator and prey modes", () => {
				state.switchPrimalFocus();
				expect(state.getPrimalFocusMode()).toBe("prey");

				state.switchPrimalFocus();
				expect(state.getPrimalFocusMode()).toBe("predator");
			});

			it("should consume focus switches on switch", () => {
				expect(state.getFocusSwitchesRemaining()).toBe(2); // L6 = 2
				state.switchPrimalFocus();
				expect(state.getFocusSwitchesRemaining()).toBe(1);
			});

			it("should prevent over-switching at non-L20", () => {
				state.switchPrimalFocus();
				state.switchPrimalFocus();
				expect(state.getFocusSwitchesRemaining()).toBe(0);

				const mode = state.getPrimalFocusMode();
				state.switchPrimalFocus();
				expect(state.getPrimalFocusMode()).toBe(mode); // unchanged
			});
		});

		describe("Hunter's Dodge", () => {
			it("should have uses equal to proficiency bonus", () => {
				[[1, 2], [5, 3], [9, 4], [13, 5], [17, 6]].forEach(([level, prof]) => {
					const s = new CharacterSheetState();
					s.addClass({name: "Ranger", source: "TGTT", level});
					s.applyClassFeatureEffects();
					expect(s.getFeatureCalculations().huntersDodgeUses).toBe(prof);
				});
			});

			it("should track and decrement dodge uses", () => {
				makeHunterRanger(5);
				state.applyClassFeatureEffects();
				expect(state.getHuntersDodgeRemaining()).toBe(3); // prof 3

				state.useHuntersDodge();
				expect(state.getHuntersDodgeRemaining()).toBe(2);

				state.useHuntersDodge();
				state.useHuntersDodge();
				expect(state.getHuntersDodgeRemaining()).toBe(0);
			});

			it("should floor at 0 uses", () => {
				makeHunterRanger(1);
				state.applyClassFeatureEffects();
				state.useHuntersDodge();
				state.useHuntersDodge();
				state.useHuntersDodge(); // more than prof bonus = 2
				expect(state.getHuntersDodgeRemaining()).toBe(0);
			});
		});

		describe("Focused Quarry Targeting", () => {
			beforeEach(() => {
				makeHunterRanger(5);
				state.applyClassFeatureEffects();
			});

			it("should start with no quarry", () => {
				expect(state.getFocusedQuarry()).toBeNull();
			});

			it("should set and clear quarry", () => {
				state.setFocusedQuarry("dragon-1");
				expect(state.getFocusedQuarry()).toBe("dragon-1");

				state.setFocusedQuarry(null);
				expect(state.getFocusedQuarry()).toBeNull();
			});
		});

		describe("Long Rest Recovery", () => {
			it("should restore all Primal Focus resources on long rest", () => {
				makeHunterRanger(6);
				state.applyClassFeatureEffects();

				state.switchPrimalFocus();
				state.switchPrimalFocus();
				state.useHuntersDodge();
				state.useHuntersDodge();

				expect(state.getFocusSwitchesRemaining()).toBe(0);
				expect(state.getHuntersDodgeRemaining()).toBe(1);

				state.restorePrimalFocus();

				expect(state.getFocusSwitchesRemaining()).toBe(2);
				expect(state.getHuntersDodgeRemaining()).toBe(3);
			});
		});
	});

	// =========================================================================
	// COMBAT METHODS (Ranger gets at L2)
	// =========================================================================
	describe("Combat Methods (Ranger at L2)", () => {
		beforeEach(() => {
			makeHunterRanger(5);
		});

		it("should use the combat system", () => {
			state.addCombatTradition("Rapid Current");
			expect(state.usesCombatSystem()).toBe(true);
		});

		it("should have stamina pool = 2 × prof", () => {
			state.addCombatTradition("Rapid Current");
			state.ensureStaminaInitialized();
			expect(state.getStaminaMax()).toBe(6); // prof 3 × 2
		});

		it("should support 6 combat traditions", () => {
			// TGTT Ranger traditions: Biting Zephyr, Mirror's Glint, Rapid Current,
			// Razor's Edge, Spirited Steed, Unending Wheel
			const traditions = [
				"Biting Zephyr", "Mirror's Glint", "Rapid Current",
				"Razor's Edge", "Spirited Steed", "Unending Wheel",
			];
			traditions.forEach(t => state.addCombatTradition(t));
			expect(state.getCombatTraditions().length).toBe(6);
		});

		it("should calculate combat method DC from DEX (higher than STR)", () => {
			state.addCombatTradition("Rapid Current");
			state.applyClassFeatureEffects();
			const calcs = state.getFeatureCalculations();
			// DC = 8 + prof(3) + DEX(3) = 14
			expect(calcs.combatMethodDc).toBe(14);
		});
	});

	// =========================================================================
	// COMBAT METHOD DEGREE PROGRESSION (Ranger schedule)
	// =========================================================================
	describe("Combat Method Degree Progression", () => {
		// Ranger: L2→1st, L5→2nd, L9→3rd, L13→4th, L17→5th
		const degreeProgression = [
			{level: 1, expected: 0},
			{level: 2, expected: 1},
			{level: 4, expected: 1},
			{level: 5, expected: 2},
			{level: 8, expected: 2},
			{level: 9, expected: 3},
			{level: 12, expected: 3},
			{level: 13, expected: 4},
			{level: 16, expected: 4},
			{level: 17, expected: 5},
			{level: 20, expected: 5},
		];

		degreeProgression.forEach(({level, expected}) => {
			it(`should have degree ${expected} access at Ranger level ${level}`, () => {
				const s = new CharacterSheetState();
				s.addClass({name: "Ranger", source: "TGTT", level});
				s.addCombatTradition("Rapid Current");
				expect(s.getMethodDegreeAccess()).toBe(expected);
			});
		});
	});

	// =========================================================================
	// FIGHTING STYLE (L2)
	// =========================================================================
	describe("Fighting Style (Level 2)", () => {
		it("should accept a Fighting Style feature at level 2", () => {
			makeHunterRanger(2);
			state.addFeature({
				name: "Fighting Style: Archery",
				source: "TGTT",
				featureType: "Class",
				className: "Ranger",
				level: 2,
				description: "+2 bonus to attack rolls with ranged weapons.",
			});
			state.applyClassFeatureEffects();
			const features = state.getFeatures();
			expect(features.some(f => f.name === "Fighting Style: Archery")).toBe(true);
		});
	});

	// =========================================================================
	// RANGER (TGTT) SPECIALTIES — 11 levels
	// =========================================================================
	describe("Ranger (TGTT) Specialties — 11 levels", () => {
		it("should accept specialties at 1, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20", () => {
			makeHunterRanger(20);
			const specialtyLevels = [1, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20];

			specialtyLevels.forEach(lvl => {
				state.addFeature({
					name: `Ranger Specialty (Lv ${lvl})`,
					source: "TGTT",
					featureType: "Class",
					className: "Ranger",
					level: lvl,
					description: `Ranger specialty at level ${lvl}.`,
				});
			});

			state.applyClassFeatureEffects();
			const features = state.getFeatures();
			specialtyLevels.forEach(lvl => {
				expect(features.some(f => f.name === `Ranger Specialty (Lv ${lvl})`)).toBe(true);
			});
		});
	});

	// =========================================================================
	// HUNTER SUBCLASS FEATURES
	// =========================================================================
	describe("Hunter Subclass Features", () => {

		describe("Hunter's Prey (Level 3)", () => {
			it("should grant Colossus Slayer at level 3", () => {
				makeHunterRanger(3);
				state.addFeature({
					name: "Colossus Slayer",
					source: "TGTT",
					featureType: "Subclass",
					className: "Ranger",
					subclassName: "Hunter",
					level: 3,
					description: "When you hit a creature with a weapon attack, the creature takes an extra 1d8 damage if it's below its hit point maximum.",
				});
				state.applyClassFeatureEffects();
				expect(state.getFeatures().some(f => f.name === "Colossus Slayer")).toBe(true);
			});

			it("should grant Giant Killer at level 3", () => {
				makeHunterRanger(3);
				state.addFeature({
					name: "Giant Killer",
					source: "TGTT",
					featureType: "Subclass",
					className: "Ranger",
					subclassName: "Hunter",
					level: 3,
					description: "When a Large or larger creature within 5 feet hits or misses you with an attack, you can use your reaction to attack that creature.",
				});
				state.applyClassFeatureEffects();
				expect(state.getFeatures().some(f => f.name === "Giant Killer")).toBe(true);
			});

			it("should grant Horde Breaker at level 3", () => {
				makeHunterRanger(3);
				state.addFeature({
					name: "Horde Breaker",
					source: "TGTT",
					featureType: "Subclass",
					className: "Ranger",
					subclassName: "Hunter",
					level: 3,
					description: "Once on each of your turns, you can make another attack with the same weapon against a different creature within 5 feet of the original target.",
				});
				state.applyClassFeatureEffects();
				expect(state.getFeatures().some(f => f.name === "Horde Breaker")).toBe(true);
			});
		});

		describe("Defensive Tactics (Level 7)", () => {
			it("should grant Escape the Horde at level 7", () => {
				makeHunterRanger(7);
				state.addFeature({
					name: "Escape the Horde",
					source: "TGTT",
					featureType: "Subclass",
					className: "Ranger",
					subclassName: "Hunter",
					level: 7,
					description: "Opportunity attacks against you are made with disadvantage.",
				});
				state.applyClassFeatureEffects();
				expect(state.getFeatures().some(f => f.name === "Escape the Horde")).toBe(true);
			});

			it("should grant Steel Will at level 7", () => {
				makeHunterRanger(7);
				state.addFeature({
					name: "Steel Will",
					source: "TGTT",
					featureType: "Subclass",
					className: "Ranger",
					subclassName: "Hunter",
					level: 7,
					description: "You have advantage on saving throws against being frightened.",
				});
				state.applyClassFeatureEffects();
				expect(state.getFeatures().some(f => f.name === "Steel Will")).toBe(true);
			});
		});

		describe("Multiattack (Level 11)", () => {
			it("should grant Volley at level 11", () => {
				makeHunterRanger(11);
				state.addFeature({
					name: "Volley",
					source: "TGTT",
					featureType: "Subclass",
					className: "Ranger",
					subclassName: "Hunter",
					level: 11,
					description: "You can use your action to make a ranged attack against any number of creatures within 10 feet of a point you can see within your weapon's range.",
				});
				state.applyClassFeatureEffects();
				expect(state.getFeatures().some(f => f.name === "Volley")).toBe(true);
			});

			it("should grant Whirlwind Attack at level 11", () => {
				makeHunterRanger(11);
				state.addFeature({
					name: "Whirlwind Attack",
					source: "TGTT",
					featureType: "Subclass",
					className: "Ranger",
					subclassName: "Hunter",
					level: 11,
					description: "You can use your action to make a melee attack against any number of creatures within 5 feet of you.",
				});
				state.applyClassFeatureEffects();
				expect(state.getFeatures().some(f => f.name === "Whirlwind Attack")).toBe(true);
			});
		});

		describe("Superior Hunter's Defense (Level 15)", () => {
			it("should grant Evasion at level 15", () => {
				makeHunterRanger(15);
				state.addFeature({
					name: "Evasion",
					source: "TGTT",
					featureType: "Subclass",
					className: "Ranger",
					subclassName: "Hunter",
					level: 15,
					description: "When subjected to an effect that allows a Dexterity saving throw for half damage, you take no damage on a success and half on a failure.",
				});
				state.applyClassFeatureEffects();
				expect(state.getFeatures().some(f => f.name === "Evasion")).toBe(true);
			});

			it("should grant Uncanny Dodge at level 15", () => {
				makeHunterRanger(15);
				state.addFeature({
					name: "Uncanny Dodge",
					source: "TGTT",
					featureType: "Subclass",
					className: "Ranger",
					subclassName: "Hunter",
					level: 15,
					description: "When an attacker that you can see hits you with an attack, you can use your reaction to halve the attack's damage against you.",
				});
				state.applyClassFeatureEffects();
				expect(state.getFeatures().some(f => f.name === "Uncanny Dodge")).toBe(true);
			});
		});
	});

	// =========================================================================
	// SPELL SLOT PROGRESSION (Half-Caster)
	// =========================================================================
	describe("Spell Slot Progression (Half-Caster)", () => {
		const milestones = [
			{level: 2, maxSpellLevel: 1},
			{level: 5, maxSpellLevel: 2},
			{level: 9, maxSpellLevel: 3},
			{level: 13, maxSpellLevel: 4},
			{level: 17, maxSpellLevel: 5},
		];

		milestones.forEach(({level, maxSpellLevel}) => {
			it(`should have up to level-${maxSpellLevel} slots at Ranger level ${level}`, () => {
				const s = new CharacterSheetState();
				s.addClass({name: "Ranger", source: "TGTT", level});
				s.calculateSpellSlots();
				expect(s.getSpellSlotsMax(maxSpellLevel)).toBeGreaterThan(0);
				if (maxSpellLevel < 5) {
					expect(s.getSpellSlotsMax(maxSpellLevel + 1)).toBe(0);
				}
			});
		});
	});

	// =========================================================================
	// FULL L1→20 PROGRESSION
	// =========================================================================
	describe("Full L1→20 Progression", () => {
		it("should maintain valid state at every level", () => {
			for (let lvl = 1; lvl <= 20; lvl++) {
				const s = new CharacterSheetState();
				s.addClass({
					name: "Ranger", source: "TGTT", level: lvl,
					subclass: lvl >= 3
						? {name: "Hunter", shortName: "Hunter", source: "TGTT"}
						: undefined,
				});
				s.setAbilityBase("dex", 16);
				s.setAbilityBase("wis", 16);

				expect(s.getTotalLevel()).toBe(lvl);
				s.applyClassFeatureEffects();
				expect(s.hasPrimalFocus()).toBe(true);
			}
		});

		it("should always have Primal Focus damage scaling", () => {
			for (let lvl = 1; lvl <= 20; lvl++) {
				const s = new CharacterSheetState();
				s.addClass({name: "Ranger", source: "TGTT", level: lvl});
				s.applyClassFeatureEffects();
				const dmg = s.getFeatureCalculations().focusedQuarryDamage;
				expect(dmg).toBeTruthy();
			}
		});

		it("should track proficiency bonus correctly", () => {
			const profTable = [
				{level: 1, prof: 2}, {level: 4, prof: 2},
				{level: 5, prof: 3}, {level: 8, prof: 3},
				{level: 9, prof: 4}, {level: 12, prof: 4},
				{level: 13, prof: 5}, {level: 16, prof: 5},
				{level: 17, prof: 6}, {level: 20, prof: 6},
			];

			profTable.forEach(({level, prof}) => {
				const s = new CharacterSheetState();
				s.addClass({name: "Ranger", source: "TGTT", level});
				expect(s.getProficiencyBonus()).toBe(prof);
			});
		});
	});
});
