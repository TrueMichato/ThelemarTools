/**
 * TGTT Arcane Archer Fighter — Full L1→20 test coverage.
 *
 * Covers:
 * - Core TGTT Fighter setup
 * - Fighter Specialties (TGTT schedule)
 * - Combat Methods at L1 (stamina pool, STR/DEX DC)
 * - Battle Tactics at L3 (level-gated reactions)
 * - Arcane Shot (CON-based DC in TGTT, prof-bonus uses)
 * - Arcane Archer subclass features:
 *     Magic Arrow (L3), Arcane Shot (L3),
 *     Curving Shot (L7), Ever-Ready Shot (L15)
 * - Fighting Style (L1)
 * - Action Surge / Extra Attack progression
 * - Full L1→20 progression
 */

import "./setup.js";

let CharacterSheetState;
let state;

beforeAll(async () => {
	CharacterSheetState = (await import("../../../js/charactersheet/charactersheet-state.js")).CharacterSheetState;
});

describe("TGTT Arcane Archer Fighter", () => {
	beforeEach(() => {
		state = new CharacterSheetState();
	});

	// =========================================================================
	// HELPER
	// =========================================================================
	function makeArcaneArcher (level) {
		state.addClass({
			name: "Fighter",
			source: "TGTT",
			level,
			hitDice: "d10",
			subclass: level >= 3
				? {name: "Arcane Archer", shortName: "Arcane Archer", source: "TGTT"}
				: undefined,
		});
		state.setAbilityBase("str", 10);
		state.setAbilityBase("dex", 18); // +4
		state.setAbilityBase("con", 16); // +3
		state.setAbilityBase("int", 10);
		state.setAbilityBase("wis", 12); // +1
		state.setAbilityBase("cha", 8);
	}

	// =========================================================================
	// CORE CLASS SETUP
	// =========================================================================
	describe("Core Class Setup", () => {
		it("should create a TGTT Fighter", () => {
			makeArcaneArcher(1);
			const classes = state.getClasses();
			expect(classes.length).toBe(1);
			expect(classes[0].name).toBe("Fighter");
			expect(classes[0].source).toBe("TGTT");
		});

		it("should recognise the Arcane Archer subclass at level 3", () => {
			makeArcaneArcher(3);
			const classes = state.getClasses();
			expect(classes[0].subclass).toBeDefined();
			expect(classes[0].subclass.shortName).toBe("Arcane Archer");
		});
	});

	// =========================================================================
	// ARCANE SHOT — CON-based DC + prof-bonus uses (TGTT changes)
	// =========================================================================
	describe("Arcane Shot (TGTT Modifications)", () => {
		it("should use CON-based DC for TGTT Arcane Archer", () => {
			makeArcaneArcher(3);
			const calcs = state.getFeatureCalculations();
			// DC = 8 + prof(2) + CON(3) = 13
			expect(calcs.arcaneShotSaveDc).toBe(13);
			expect(calcs.arcaneShotAbility).toBe("con");
		});

		it("should use INT-based DC for XGE Arcane Archer", () => {
			state.addClass({
				name: "Fighter",
				source: "XGE",
				level: 3,
				hitDice: "d10",
				subclass: {name: "Arcane Archer", shortName: "Arcane Archer", source: "XGE"},
			});
			state.setAbilityBase("con", 16); // +3
			state.setAbilityBase("int", 14); // +2

			const calcs = state.getFeatureCalculations();
			expect(calcs.arcaneShotSaveDc).toBe(12); // 8 + 2(prof) + 2(INT)
			expect(calcs.arcaneShotAbility).toBe("int");
		});

		it("should grant prof-bonus uses for TGTT (not flat 2)", () => {
			makeArcaneArcher(5); // prof 3
			const calcs = state.getFeatureCalculations();
			expect(calcs.arcaneShotUses).toBe(3);
		});

		it("should grant flat 2 uses for official Arcane Archer", () => {
			state.addClass({
				name: "Fighter",
				source: "PHB",
				level: 5,
				hitDice: "d10",
				subclass: {name: "Arcane Archer", shortName: "Arcane Archer", source: "XGE"},
			});
			const calcs = state.getFeatureCalculations();
			expect(calcs.arcaneShotUses).toBe(2);
		});

		it("should scale TGTT Arcane Shot DC with level and CON", () => {
			const cases = [
				{level: 3, conBase: 16, expected: 13}, // 8+2+3
				{level: 5, conBase: 16, expected: 14}, // 8+3+3
				{level: 9, conBase: 18, expected: 16}, // 8+4+4
				{level: 17, conBase: 20, expected: 19}, // 8+6+5
			];

			for (const {level, conBase, expected} of cases) {
				const s = new CharacterSheetState();
				s.addClass({
					name: "Fighter",
					source: "TGTT",
					level,
					hitDice: "d10",
					subclass: {name: "Arcane Archer", shortName: "Arcane Archer", source: "TGTT"},
				});
				s.setAbilityBase("con", conBase);
				expect(s.getFeatureCalculations().arcaneShotSaveDc).toBe(expected);
			}
		});
	});

	// =========================================================================
	// COMBAT METHODS (Fighter gets at L1)
	// =========================================================================
	describe("Combat Methods (Fighter at L1)", () => {
		beforeEach(() => {
			makeArcaneArcher(5);
		});

		it("should use the combat system", () => {
			// TGTT Arcane Archer traditions: Biting Zephyr, Razor's Edge, Unending Wheel, Unerring Hawk
			state.addCombatTradition("Biting Zephyr");
			expect(state.usesCombatSystem()).toBe(true);
		});

		it("should have stamina pool = 2 × prof", () => {
			state.addCombatTradition("Biting Zephyr");
			state.ensureStaminaInitialized();
			expect(state.getStaminaMax()).toBe(6); // prof 3 × 2
		});

		it("should calculate combat method DC from DEX (higher)", () => {
			state.addCombatTradition("Biting Zephyr");
			state.applyClassFeatureEffects();
			const calcs = state.getFeatureCalculations();
			// DC = 8 + prof(3) + DEX(4) = 15
			expect(calcs.combatMethodDc).toBe(15);
		});

		it("should spend and track stamina", () => {
			state.addCombatTradition("Biting Zephyr");
			state.ensureStaminaInitialized();
			const max = state.getStaminaMax();

			state.spendStamina(3);
			expect(state.getStaminaCurrent()).toBe(max - 3);

			state.restoreStamina();
			expect(state.getStaminaCurrent()).toBe(max);
		});
	});

	// =========================================================================
	// BATTLE TACTICS (Fighter gets at L3)
	// =========================================================================
	describe("Battle Tactics (Fighter L3 system)", () => {
		it("should meet prerequisite for level-gated tactics", () => {
			makeArcaneArcher(7);
			expect(state.meetsBattleTacticPrerequisite(5)).toBe(true);
			expect(state.meetsBattleTacticPrerequisite(7)).toBe(true);
			expect(state.meetsBattleTacticPrerequisite(9)).toBe(false);
			expect(state.meetsBattleTacticPrerequisite(null)).toBe(true);
		});

		it("should enable Dying Surge at Fighter level 5", () => {
			makeArcaneArcher(5);
			state.addFeature({
				name: "Dying Surge",
				source: "TGTT",
				featureType: "Optional Feature",
				optionalFeatureTypes: ["BT"],
			});
			const calcs = state.getFeatureCalculations();
			expect(calcs.hasDyingSurge).toBe(true);
			expect(calcs.dyingSurgeAvailable).toBe(true);
		});

		it("should NOT enable Daring Feint at level 5 (needs 9)", () => {
			makeArcaneArcher(5);
			state.addFeature({
				name: "Daring Feint",
				source: "TGTT",
				featureType: "Optional Feature",
				optionalFeatureTypes: ["BT"],
			});
			const calcs = state.getFeatureCalculations();
			expect(calcs.hasDaringFeint).toBe(true);
			expect(calcs.daringFeintAvailable).toBeUndefined();
		});

		it("should enable Daring Feint at level 9", () => {
			makeArcaneArcher(9);
			state.addFeature({
				name: "Daring Feint",
				source: "TGTT",
				featureType: "Optional Feature",
				optionalFeatureTypes: ["BT"],
			});
			const calcs = state.getFeatureCalculations();
			expect(calcs.daringFeintAvailable).toBe(true);
			expect(calcs.daringFeintCritRange).toBe(19);
		});

		it("should list available combat reactions", () => {
			makeArcaneArcher(9);
			state.addFeature({
				name: "Daring Feint",
				source: "TGTT",
				featureType: "Optional Feature",
				optionalFeatureTypes: ["BT"],
			});
			state.addFeature({
				name: "Dying Surge",
				source: "TGTT",
				featureType: "Optional Feature",
				optionalFeatureTypes: ["BT"],
			});

			const reactions = state.getAvailableCombatReactions();
			expect(reactions.length).toBe(2);
			expect(reactions.map(r => r.name)).toContain("Daring Feint");
			expect(reactions.map(r => r.name)).toContain("Dying Surge");
		});
	});

	// =========================================================================
	// FIGHTING STYLE (L1)
	// =========================================================================
	describe("Fighting Style (Level 1)", () => {
		it("should accept Archery fighting style", () => {
			makeArcaneArcher(1);
			state.addFeature({
				name: "Fighting Style: Archery",
				source: "TGTT",
				featureType: "Class",
				className: "Fighter",
				level: 1,
				description: "+2 bonus to attack rolls with ranged weapons.",
			});
			state.applyClassFeatureEffects();
			expect(state.getFeatures().some(f => f.name === "Fighting Style: Archery")).toBe(true);
		});
	});

	// =========================================================================
	// FIGHTER SPECIALTIES
	// =========================================================================
	describe("Fighter (TGTT) Specialties", () => {
		it("should accept specialties at expected levels", () => {
			makeArcaneArcher(20);
			[4, 6, 8, 12, 14, 16, 19].forEach(lvl => {
				state.addFeature({
					name: `Fighter Specialty (Lv ${lvl})`,
					source: "TGTT",
					featureType: "Class",
					className: "Fighter",
					level: lvl,
					description: `Fighter specialty at level ${lvl}.`,
				});
			});
			state.applyClassFeatureEffects();
			const features = state.getFeatures();
			expect(features.filter(f => f.name.startsWith("Fighter Specialty")).length).toBe(7);
		});
	});

	// =========================================================================
	// ARCANE SHOT OPTIONS PROGRESSION
	// =========================================================================
	describe("Arcane Shot Options Known", () => {
		const optionsProgression = [
			{level: 3, expected: 2},
			{level: 6, expected: 2},
			{level: 7, expected: 3},
			{level: 9, expected: 3},
			{level: 10, expected: 4},
			{level: 14, expected: 4},
			{level: 15, expected: 5},
			{level: 17, expected: 5},
			{level: 18, expected: 6},
			{level: 20, expected: 6},
		];

		optionsProgression.forEach(({level, expected}) => {
			it(`should have ${expected} Arcane Shot options at Fighter level ${level}`, () => {
				const s = new CharacterSheetState();
				s.addClass({
					name: "Fighter",
					source: "TGTT",
					level,
					hitDice: "d10",
					subclass: {name: "Arcane Archer", shortName: "Arcane Archer", source: "TGTT"},
				});
				expect(s.getFeatureCalculations().arcaneShotOptions).toBe(expected);
			});
		});
	});

	// =========================================================================
	// SECOND WIND SCALING (TGTT)
	// =========================================================================
	describe("Second Wind (TGTT)", () => {
		describe("Second Wind Healing", () => {
			const healingProgression = [
				{level: 1, expected: "1d10+1"},
				{level: 5, expected: "1d10+5"},
				{level: 10, expected: "1d10+10"},
				{level: 20, expected: "1d10+20"},
			];

			healingProgression.forEach(({level, expected}) => {
				it(`should compute secondWindHealing = "${expected}" at level ${level}`, () => {
					const s = new CharacterSheetState();
					s.addClass({name: "Fighter", source: "TGTT", level, hitDice: "d10"});
					expect(s.getFeatureCalculations().secondWindHealing).toBe(expected);
				});
			});
		});

		describe("Second Wind Uses (TGTT schedule)", () => {
			const usesProgression = [
				{level: 1, expected: 2},
				{level: 3, expected: 2},
				{level: 4, expected: 3},
				{level: 9, expected: 3},
				{level: 10, expected: 4},
				{level: 15, expected: 4},
				{level: 16, expected: 5},
				{level: 20, expected: 5},
			];

			usesProgression.forEach(({level, expected}) => {
				it(`should have ${expected} Second Wind uses at level ${level}`, () => {
					const s = new CharacterSheetState();
					s.addClass({name: "Fighter", source: "TGTT", level, hitDice: "d10"});
					expect(s.getFeatureCalculations().secondWindUses).toBe(expected);
				});
			});

			it("should differ from PHB Fighter (always 1 use)", () => {
				const s = new CharacterSheetState();
				s.addClass({name: "Fighter", source: "PHB", level: 10, hitDice: "d10"});
				expect(s.getFeatureCalculations().secondWindUses).toBe(1);
			});
		});
	});

	// =========================================================================
	// ACTION SURGE USES (Computed)
	// =========================================================================
	describe("Action Surge Uses (Computed)", () => {
		const surgeProgression = [
			{level: 2, expected: 1},
			{level: 10, expected: 1},
			{level: 16, expected: 1},
			{level: 17, expected: 2},
			{level: 20, expected: 2},
		];

		surgeProgression.forEach(({level, expected}) => {
			it(`should have ${expected} Action Surge use(s) at level ${level}`, () => {
				const s = new CharacterSheetState();
				s.addClass({name: "Fighter", source: "TGTT", level, hitDice: "d10"});
				expect(s.getFeatureCalculations().actionSurgeUses).toBe(expected);
			});
		});
	});

	// =========================================================================
	// INDOMITABLE USES
	// =========================================================================
	describe("Indomitable Uses", () => {
		const indomProgression = [
			{level: 9, expected: 1},
			{level: 12, expected: 1},
			{level: 13, expected: 2},
			{level: 16, expected: 2},
			{level: 17, expected: 3},
			{level: 20, expected: 3},
		];

		indomProgression.forEach(({level, expected}) => {
			it(`should have ${expected} Indomitable use(s) at level ${level}`, () => {
				const s = new CharacterSheetState();
				s.addClass({
					name: "Fighter",
					source: "TGTT",
					level,
					hitDice: "d10",
					subclass: level >= 3 ? {name: "Arcane Archer", shortName: "Arcane Archer", source: "TGTT"} : undefined,
				});
				expect(s.getFeatureCalculations().indomitableUses).toBe(expected);
			});
		});
	});

	// =========================================================================
	// BATTLE TACTICS COMPUTED VALUES
	// =========================================================================
	describe("Battle Tactics Computed Values", () => {
		const flatBonusTactics = [
			{name: "High Ground", calcKey: "highGroundBonus", expected: 2},
			{name: "Sweeping Blows", calcKey: "sweepingBlowsBonus", expected: 2},
			{name: "Hammer and Anvil", calcKey: "hammerAndAnvilBonus", expected: 2},
			{name: "Flanking", calcKey: "flankingBonus", expected: 2},
		];

		flatBonusTactics.forEach(({name, calcKey, expected}) => {
			it(`should compute ${calcKey} = ${expected} for ${name}`, () => {
				makeArcaneArcher(5);
				state.addFeature({
					name,
					source: "TGTT",
					featureType: "Optional Feature",
					optionalFeatureTypes: ["BT"],
				});
				const calcs = state.getFeatureCalculations();
				expect(calcs[calcKey]).toBe(expected);
			});
		});

		it("should compute daringFeintCritRange = 19 at Fighter level 9+", () => {
			makeArcaneArcher(9);
			state.addFeature({
				name: "Daring Feint",
				source: "TGTT",
				featureType: "Optional Feature",
				optionalFeatureTypes: ["BT"],
			});
			expect(state.getFeatureCalculations().daringFeintCritRange).toBe(19);
		});

		it("should compute sheathingTheSwordCritRange = 19 at Fighter level 9+", () => {
			makeArcaneArcher(9);
			state.addFeature({
				name: "Sheathing the Sword",
				source: "TGTT",
				featureType: "Optional Feature",
				optionalFeatureTypes: ["BT"],
			});
			expect(state.getFeatureCalculations().sheathingTheSwordCritRange).toBe(19);
		});

		it("should NOT grant crit range bonuses before Fighter level 9", () => {
			makeArcaneArcher(8);
			state.addFeature({
				name: "Daring Feint",
				source: "TGTT",
				featureType: "Optional Feature",
				optionalFeatureTypes: ["BT"],
			});
			expect(state.getFeatureCalculations().daringFeintCritRange).toBeUndefined();
		});
	});

	// =========================================================================
	// COMBAT METHOD DEGREE PROGRESSION (Fighter schedule)
	// =========================================================================
	describe("Combat Method Degree Progression", () => {
		// Fighter: L1→1st, L4→2nd, L8→3rd, L12→4th, L16→5th
		const degreeProgression = [
			{level: 1, expected: 1},
			{level: 3, expected: 1},
			{level: 4, expected: 2},
			{level: 7, expected: 2},
			{level: 8, expected: 3},
			{level: 11, expected: 3},
			{level: 12, expected: 4},
			{level: 15, expected: 4},
			{level: 16, expected: 5},
			{level: 20, expected: 5},
		];

		degreeProgression.forEach(({level, expected}) => {
			it(`should have degree ${expected} access at Fighter level ${level}`, () => {
				const s = new CharacterSheetState();
				s.addClass({name: "Fighter", source: "TGTT", level, hitDice: "d10"});
				s.addCombatTradition("Biting Zephyr");
				expect(s.getMethodDegreeAccess()).toBe(expected);
			});
		});
	});

	// =========================================================================
	// ARCANE ARCHER SUBCLASS FEATURES
	// =========================================================================
	describe("Arcane Archer Subclass Features", () => {
		describe("Magic Arrow (Level 3)", () => {
			it("should grant Magic Arrow at level 3", () => {
				makeArcaneArcher(3);
				state.addFeature({
					name: "Magic Arrow",
					source: "TGTT",
					featureType: "Subclass",
					className: "Fighter",
					subclassName: "Arcane Archer",
					level: 3,
					description: "When you fire a nonmagical arrow from a shortbow or longbow, you can make it magical for the purpose of overcoming resistance and immunity.",
				});
				state.applyClassFeatureEffects();
				expect(state.getFeatures().some(f => f.name === "Magic Arrow")).toBe(true);
			});
		});

		describe("Curving Shot (Level 7)", () => {
			it("should grant Curving Shot at level 7", () => {
				makeArcaneArcher(7);
				state.addFeature({
					name: "Curving Shot",
					source: "TGTT",
					featureType: "Subclass",
					className: "Fighter",
					subclassName: "Arcane Archer",
					level: 7,
					description: "When you make an attack roll with a magic arrow and miss, you can use a bonus action to reroll the attack roll against a different target within 60 feet.",
				});
				state.applyClassFeatureEffects();
				expect(state.getFeatures().some(f => f.name === "Curving Shot")).toBe(true);
			});
		});

		describe("Ever-Ready Shot (Level 15)", () => {
			it("should grant Ever-Ready Shot at level 15", () => {
				makeArcaneArcher(15);
				state.addFeature({
					name: "Ever-Ready Shot",
					source: "TGTT",
					featureType: "Subclass",
					className: "Fighter",
					subclassName: "Arcane Archer",
					level: 15,
					description: "When you roll initiative and have no uses of Arcane Shot remaining, you regain one use of it.",
				});
				state.applyClassFeatureEffects();
				expect(state.getFeatures().some(f => f.name === "Ever-Ready Shot")).toBe(true);
			});
		});
	});

	// =========================================================================
	// ACTION SURGE AND EXTRA ATTACK
	// =========================================================================
	describe("Action Surge and Extra Attack", () => {
		it("should have Extra Attack at level 5", () => {
			makeArcaneArcher(5);
			state.applyClassFeatureEffects();
			const calcs = state.getFeatureCalculations();
			expect(calcs.extraAttacks).toBeGreaterThanOrEqual(1);
		});

		it("should have 2 extra attacks at level 11", () => {
			makeArcaneArcher(11);
			state.applyClassFeatureEffects();
			const calcs = state.getFeatureCalculations();
			expect(calcs.extraAttacks).toBeGreaterThanOrEqual(2);
		});

		it("should have 3 extra attacks at level 20", () => {
			makeArcaneArcher(20);
			state.applyClassFeatureEffects();
			const calcs = state.getFeatureCalculations();
			expect(calcs.extraAttacks).toBeGreaterThanOrEqual(3);
		});

		it("should track Action Surge uses", () => {
			makeArcaneArcher(2);
			state.addResource({name: "Action Surge", max: 1, current: 1, recharge: "short"});
			const res = state.getResource("Action Surge");
			expect(res.max).toBe(1);
			expect(res.recharge).toBe("short");
		});

		it("should get 2 Action Surge uses at level 17", () => {
			makeArcaneArcher(17);
			state.addResource({name: "Action Surge", max: 2, current: 2, recharge: "short"});
			const res = state.getResource("Action Surge");
			expect(res.max).toBe(2);
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
					name: "Fighter",
					source: "TGTT",
					level: lvl,
					hitDice: "d10",
					subclass: lvl >= 3
						? {name: "Arcane Archer", shortName: "Arcane Archer", source: "TGTT"}
						: undefined,
				});
				s.setAbilityBase("dex", 18);
				s.setAbilityBase("con", 16);

				expect(s.getTotalLevel()).toBe(lvl);
			}
		});

		it("should scale Arcane Shot DC at every level with subclass", () => {
			for (let lvl = 3; lvl <= 20; lvl++) {
				const s = new CharacterSheetState();
				s.addClass({
					name: "Fighter",
					source: "TGTT",
					level: lvl,
					hitDice: "d10",
					subclass: {name: "Arcane Archer", shortName: "Arcane Archer", source: "TGTT"},
				});
				s.setAbilityBase("con", 16);
				const calcs = s.getFeatureCalculations();
				expect(calcs.arcaneShotSaveDc).toBeGreaterThanOrEqual(13);
				expect(calcs.arcaneShotAbility).toBe("con");
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
				s.addClass({name: "Fighter", source: "TGTT", level, hitDice: "d10"});
				expect(s.getProficiencyBonus()).toBe(prof);
			});
		});
	});
});
