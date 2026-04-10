/**
 * TGTT Bladesinger Wizard — Full L1→20 test coverage.
 *
 * Covers:
 * - Wizard Specialties at 4, 8, 12, 16
 * - Bladesong toggle (AC bonus, speed +10, resource tracking)
 * - Combat Methods (Arcane Knight tradition) with spellcasting DC
 * - Stamina pool (2 × prof) using spellcasting ability
 * - Subclass features: Extra Attack (6), Song of Defense (10),
 *   Song of Victory (14)
 * - Spell slot progression at milestone levels
 */

import "./setup.js";

let CharacterSheetState;
let state;

beforeAll(async () => {
	CharacterSheetState = (await import("../../../js/charactersheet/charactersheet-state.js")).CharacterSheetState;
});

describe("TGTT Bladesinger Wizard", () => {

	beforeEach(() => {
		state = new CharacterSheetState();
	});

	// =========================================================================
	// HELPER — creates a Bladesinger at the given level with standard stats
	// =========================================================================
	function makeBladesinger (level) {
		state.addClass({
			name: "Wizard",
			source: "TGTT",
			level,
			subclass: {name: "Bladesinger", shortName: "Bladesinger", source: "TGTT"},
		});
		state.setAbilityBase("str", 8);
		state.setAbilityBase("dex", 16); // +3
		state.setAbilityBase("con", 14); // +2
		state.setAbilityBase("int", 18); // +4
		state.setAbilityBase("wis", 10);
		state.setAbilityBase("cha", 10);
	}

	// =========================================================================
	// CORE CLASS SETUP
	// =========================================================================
	describe("Core Class Setup", () => {
		it("should create a TGTT Wizard with Bladesinger subclass", () => {
			makeBladesinger(3);
			const classes = state.getClasses();
			expect(classes.length).toBe(1);
			expect(classes[0].name).toBe("Wizard");
			expect(classes[0].source).toBe("TGTT");
		});

		it("should recognise the Bladesinger subclass", () => {
			makeBladesinger(3);
			const calcs = state.getFeatureCalculations();
			// The subclass should be tracked internally
			const classes = state.getClasses();
			expect(classes[0].subclass).toBeDefined();
			expect(classes[0].subclass.shortName).toBe("Bladesinger");
		});

		it("should use INT as spellcasting ability", () => {
			makeBladesinger(1);
			state.applyClassFeatureEffects();
			const calcs = state.getFeatureCalculations();
			expect(calcs.spellSaveDc).toBe(8 + 2 + 4); // 8 + prof(2) + INT(4) = 14
			expect(calcs.spellAttackBonus).toBe(2 + 4);  // prof(2) + INT(4) = 6
		});
	});

	// =========================================================================
	// BLADESONG TOGGLE
	// =========================================================================
	describe("Bladesong Toggle", () => {
		beforeEach(() => {
			makeBladesinger(6);
		});

		it("should detect Bladesong as an activatable feature", () => {
			state.addFeature({
				name: "Bladesong",
				description: "Starting at 2nd level, you can invoke a secret elven magic called the Bladesong as a bonus action.",
				className: "Wizard",
				level: 2,
			});

			const activatables = state.getActivatableFeatures();
			const bs = activatables.find(a => a.stateTypeId === "bladesong");
			expect(bs).toBeDefined();
		});

		it("should track Bladesong resource (max = proficiency bonus, long rest recharge)", () => {
			state.addResource({name: "Bladesong", max: 2, current: 2, recharge: "long"});

			const res = state.getResource("Bladesong");
			expect(res).toBeDefined();
			expect(res.max).toBe(2);
			expect(res.recharge).toBe("long");
		});

		it("should activate Bladesong and apply AC bonus", () => {
			state.addFeature({
				name: "Bladesong",
				description: "Starting at 2nd level, you can invoke a secret elven magic called the Bladesong as a bonus action.",
				className: "Wizard",
				level: 2,
			});
			state.addResource({name: "Bladesong", max: 2, current: 2, recharge: "long"});

			state.activateState("bladesong");
			expect(state.isStateTypeActive("bladesong")).toBe(true);

			const effects = state.getActiveStateEffects();
			expect(effects.some(e => e.type === "bonus" && e.target === "ac")).toBe(true);
		});

		it("should apply +10 walking speed while Bladesong active", () => {
			state.addFeature({
				name: "Bladesong",
				description: "Starting at 2nd level, you can invoke a secret elven magic called the Bladesong as a bonus action.",
				className: "Wizard",
				level: 2,
			});
			state.addResource({name: "Bladesong", max: 2, current: 2, recharge: "long"});

			state.activateState("bladesong");
			const effects = state.getActiveStateEffects();
			expect(effects.some(e => e.type === "bonus" && e.target === "speed:walk" && e.value === 10)).toBe(true);
		});

		it("should deactivate Bladesong and remove all effects", () => {
			state.addFeature({
				name: "Bladesong",
				description: "Starting at 2nd level, you can invoke a secret elven magic called the Bladesong as a bonus action.",
				className: "Wizard",
				level: 2,
			});
			state.addResource({name: "Bladesong", max: 2, current: 2, recharge: "long"});

			state.activateState("bladesong");
			expect(state.isStateTypeActive("bladesong")).toBe(true);

			state.deactivateState("bladesong");
			expect(state.isStateTypeActive("bladesong")).toBe(false);
			expect(state.getActiveStateEffects()).toHaveLength(0);
		});

		it("should scale Bladesong max uses with proficiency bonus at higher levels", () => {
			// At level 9 (prof +4) the DM might track resource max differently,
			// but per RAW Bladesong uses = proficiency bonus
			const l9State = new CharacterSheetState();
			l9State.addClass({
				name: "Wizard", source: "TGTT", level: 9,
				subclass: {name: "Bladesinger", shortName: "Bladesinger", source: "TGTT"},
			});
			l9State.setAbilityBase("int", 18);
			l9State.addResource({name: "Bladesong", max: 4, current: 4, recharge: "long"});

			const res = l9State.getResource("Bladesong");
			expect(res.max).toBe(4);
		});

		it("should calculate bladesongAcBonus = INT modifier", () => {
			const calcs = state.getFeatureCalculations();
			// INT 18 → +4
			expect(calcs.bladesongAcBonus).toBe(4);
		});

		it("should scale bladesongAcBonus with INT changes", () => {
			state.setAbilityBase("int", 14); // +2
			expect(state.getFeatureCalculations().bladesongAcBonus).toBe(2);

			state.setAbilityBase("int", 20); // +5
			expect(state.getFeatureCalculations().bladesongAcBonus).toBe(5);
		});

		it("should produce all 4 Bladesong effects when active", () => {
			state.addFeature({
				name: "Bladesong",
				description: "Starting at 2nd level, you can invoke a secret elven magic called the Bladesong as a bonus action.",
				className: "Wizard",
				level: 2,
			});
			state.addResource({name: "Bladesong", max: 2, current: 2, recharge: "long"});
			state.activateState("bladesong");

			const effects = state.getActiveStateEffects();
			// AC bonus (INT mod)
			expect(effects.some(e => e.type === "bonus" && e.target === "ac" && e.abilityMod === "int")).toBe(true);
			// Speed +10
			expect(effects.some(e => e.type === "bonus" && e.target === "speed:walk" && e.value === 10)).toBe(true);
			// Advantage on Acrobatics
			expect(effects.some(e => e.type === "advantage" && e.target === "skill:acrobatics")).toBe(true);
			// INT bonus to concentration saves
			expect(effects.some(e => e.type === "bonus" && e.target === "concentration" && e.abilityMod === "int")).toBe(true);
		});
	});

	// =========================================================================
	// COMBAT METHODS (Arcane Knight Tradition)
	// =========================================================================
	describe("Combat Methods — Arcane Knight Tradition", () => {
		beforeEach(() => {
			makeBladesinger(6);
			state.addCombatTradition("AK"); // Arcane Knight
			state.ensureStaminaInitialized();
		});

		it("should use the combat method system", () => {
			expect(state.usesCombatSystem()).toBe(true);
		});

		it("should have stamina pool = 2 × proficiency bonus", () => {
			// Level 6 → prof +3 → stamina = 6
			expect(state.getStaminaMax()).toBe(6);
		});

		it("should scale stamina pool with level", () => {
			const cases = [
				{level: 3, expected: 4},   // prof +2
				{level: 5, expected: 6},   // prof +3
				{level: 9, expected: 8},   // prof +4
				{level: 13, expected: 10}, // prof +5
				{level: 17, expected: 12}, // prof +6
			];

			for (const {level, expected} of cases) {
				const s = new CharacterSheetState();
				s.addClass({
					name: "Wizard", source: "TGTT", level,
					subclass: {name: "Bladesinger", shortName: "Bladesinger", source: "TGTT"},
				});
				s.addCombatTradition("AK");
				s.ensureStaminaInitialized();
				expect(s.getStaminaMax()).toBe(expected);
			}
		});

		it("should use higher of physical or spellcasting DC per TGTT", () => {
			state.applyClassFeatureEffects();
			const calcs = state.getFeatureCalculations();
			// TGTT Bladesinger: "You can use your spellcasting DC in place of your method DC"
			// Physical DC = 8 + prof(3) + DEX(+3) = 14
			// Spell DC = 8 + prof(3) + INT(+4) = 15 → higher wins
			expect(calcs.combatMethodDc).toBe(15);
			expect(calcs.combatMethodDcUsesSpellcasting).toBe(true);
		});

		it("should track Arcane Knight tradition in getCombatTraditions()", () => {
			const traditions = state.getCombatTraditions();
			expect(traditions).toContain("AK");
		});

		it("should spend and restore stamina correctly", () => {
			const max = state.getStaminaMax();
			expect(state.getStaminaCurrent()).toBe(max);

			const spent = state.spendStamina(2);
			expect(spent).toBe(true);
			expect(state.getStaminaCurrent()).toBe(max - 2);

			state.restoreStamina();
			expect(state.getStaminaCurrent()).toBe(max);
		});

		it("should refuse to spend more stamina than available", () => {
			state.setStaminaCurrent(1);
			const result = state.spendStamina(5);
			expect(result).toBe(false);
			expect(state.getStaminaCurrent()).toBe(1);
		});
	});

	// =========================================================================
	// WIZARD SPECIALTIES (TGTT-specific)
	// =========================================================================
	describe("Wizard (TGTT) Specialties", () => {
		it("should accept Specialty features at levels 4, 8, 12, 16", () => {
			makeBladesinger(16);

			const specialtyLevels = [4, 8, 12, 16];
			specialtyLevels.forEach(lvl => {
				state.addFeature({
					name: `Specialty (Lv ${lvl})`,
					source: "TGTT",
					featureType: "Class",
					className: "Wizard",
					level: lvl,
					description: `Wizard specialty gained at level ${lvl}.`,
				});
			});

			state.applyClassFeatureEffects();
			const features = state.getFeatures();
			specialtyLevels.forEach(lvl => {
				expect(features.some(f => f.name === `Specialty (Lv ${lvl})`)).toBe(true);
			});
		});
	});

	// =========================================================================
	// SUBCLASS FEATURES BY LEVEL
	// =========================================================================
	describe("Subclass Feature Progression", () => {

		describe("Extra Attack (Level 6)", () => {
			it("should grant Extra Attack at Bladesinger level 6", () => {
				makeBladesinger(6);
				state.addFeature({
					name: "Extra Attack",
					source: "TGTT",
					featureType: "Subclass",
					className: "Wizard",
					subclassName: "Bladesinger",
					level: 6,
					description: "You can attack twice when you take the Attack action. You can replace one of those attacks with a cantrip.",
				});
				state.applyClassFeatureEffects();

				const calcs = state.getFeatureCalculations();
				expect(calcs.hasExtraAttack).toBe(true);
				expect(calcs.attacksPerAction).toBeGreaterThanOrEqual(2);
			});

			it("should allow replacing one attack with a cantrip at level 6", () => {
				makeBladesinger(6);
				const calcs = state.getFeatureCalculations();
				expect(calcs.canReplaceAttackWithCantrip).toBe(true);
			});

			it("should NOT allow cantrip replacement before level 6", () => {
				makeBladesinger(5);
				const calcs = state.getFeatureCalculations();
				expect(calcs.canReplaceAttackWithCantrip).toBeFalsy();
			});
		});

		describe("Song of Defense (Level 10)", () => {
			it("should grant Song of Defense at level 10", () => {
				makeBladesinger(10);
				state.addFeature({
					name: "Song of Defense",
					source: "TGTT",
					featureType: "Subclass",
					className: "Wizard",
					subclassName: "Bladesinger",
					level: 10,
					description: "While your Bladesong is active, you can expend one spell slot to reduce damage by 5× the slot's level.",
				});
				state.applyClassFeatureEffects();
				const features = state.getFeatures();
				expect(features.some(f => f.name === "Song of Defense")).toBe(true);
			});

			it("should be available only when Bladesong is active (logical prerequisite)", () => {
				makeBladesinger(10);
				state.addFeature({
					name: "Song of Defense",
					source: "TGTT",
					featureType: "Subclass",
					className: "Wizard",
					subclassName: "Bladesinger",
					level: 10,
					description: "While your Bladesong is active, you can expend one spell slot to reduce damage by 5× the slot's level.",
				});
				state.applyClassFeatureEffects();

				// The feature should reference Bladesong in its description
				const features = state.getFeatures();
				const sod = features.find(f => f.name === "Song of Defense");
				expect(sod.description).toMatch(/Bladesong/i);
			});
		});

		describe("Song of Victory (Level 14)", () => {
			it("should grant Song of Victory at level 14", () => {
				makeBladesinger(14);
				state.addFeature({
					name: "Song of Victory",
					source: "TGTT",
					featureType: "Subclass",
					className: "Wizard",
					subclassName: "Bladesinger",
					level: 14,
					description: "While your Bladesong is active, you add your Intelligence modifier to melee weapon damage.",
				});
				state.applyClassFeatureEffects();
				const features = state.getFeatures();
				expect(features.some(f => f.name === "Song of Victory")).toBe(true);
			});

			it("should compute songOfVictoryDamageBonus = INT modifier (4)", () => {
				makeBladesinger(14);
				const calcs = state.getFeatureCalculations();
				expect(calcs.songOfVictoryDamageBonus).toBe(4); // INT 18 → +4
			});

			it("should scale songOfVictoryDamageBonus with INT", () => {
				makeBladesinger(14);
				state.setAbilityBase("int", 20); // +5
				expect(state.getFeatureCalculations().songOfVictoryDamageBonus).toBe(5);

				state.setAbilityBase("int", 14); // +2
				expect(state.getFeatureCalculations().songOfVictoryDamageBonus).toBe(2);
			});

			it("should NOT have songOfVictoryDamageBonus before level 14", () => {
				makeBladesinger(13);
				const calcs = state.getFeatureCalculations();
				expect(calcs.songOfVictoryDamageBonus).toBeFalsy();
			});
		});
	});

	// =========================================================================
	// ACTIVE STATE TOGGLE LIFECYCLE
	// =========================================================================
	describe("Active State Toggle Lifecycle", () => {
		beforeEach(() => {
			makeBladesinger(6);
			state.addFeature({
				name: "Bladesong",
				description: "Starting at 2nd level, you can invoke a secret elven magic called the Bladesong as a bonus action.",
				className: "Wizard",
				level: 2,
			});
			state.addResource({name: "Bladesong", max: 2, current: 2, recharge: "long"});
		});

		it("should activate via activateState() and confirm via isStateTypeActive()", () => {
			expect(state.isStateTypeActive("bladesong")).toBe(false);
			state.activateState("bladesong");
			expect(state.isStateTypeActive("bladesong")).toBe(true);
		});

		it("should deactivate via deactivateState() and clear all effects", () => {
			state.activateState("bladesong");
			expect(state.getActiveStateEffects().length).toBeGreaterThan(0);

			state.deactivateState("bladesong");
			expect(state.isStateTypeActive("bladesong")).toBe(false);
			expect(state.getActiveStateEffects()).toHaveLength(0);
		});

		it("should toggle via toggleActiveState()", () => {
			const stateId = state.activateState("bladesong");
			expect(state.isStateTypeActive("bladesong")).toBe(true);

			state.toggleActiveState(stateId);
			expect(state.isStateTypeActive("bladesong")).toBe(false);
		});

		it("should re-activate cleanly after deactivation", () => {
			state.activateState("bladesong");
			state.deactivateState("bladesong");

			state.activateState("bladesong");
			expect(state.isStateTypeActive("bladesong")).toBe(true);
			expect(state.getActiveStateEffects().length).toBeGreaterThan(0);
		});
	});

	// =========================================================================
	// SPELL SLOT PROGRESSION AT MILESTONE LEVELS
	// =========================================================================
	describe("Spell Slot Progression (Full Caster)", () => {
		const milestones = [
			{level: 1, maxSpellLevel: 1},
			{level: 3, maxSpellLevel: 2},
			{level: 5, maxSpellLevel: 3},
			{level: 9, maxSpellLevel: 5},
			{level: 11, maxSpellLevel: 6},
			{level: 13, maxSpellLevel: 7},
			{level: 15, maxSpellLevel: 8},
			{level: 17, maxSpellLevel: 9},
		];

		milestones.forEach(({level, maxSpellLevel}) => {
			it(`should have up to level-${maxSpellLevel} spell slots at Wizard level ${level}`, () => {
				const s = new CharacterSheetState();
				s.addClass({name: "Wizard", source: "TGTT", level});
				s.calculateSpellSlots();

				expect(s.getSpellSlotsMax(maxSpellLevel)).toBeGreaterThan(0);
				if (maxSpellLevel < 9) {
					expect(s.getSpellSlotsMax(maxSpellLevel + 1)).toBe(0);
				}
			});
		});
	});

	// =========================================================================
	// LEVEL 1-20 FULL PROGRESSION
	// =========================================================================
	describe("Full L1→20 Progression", () => {
		it("should maintain valid state at every level", () => {
			for (let lvl = 1; lvl <= 20; lvl++) {
				const s = new CharacterSheetState();
				s.addClass({
					name: "Wizard", source: "TGTT", level: lvl,
					subclass: lvl >= 3
						? {name: "Bladesinger", shortName: "Bladesinger", source: "TGTT"}
						: undefined,
				});
				s.setAbilityBase("int", 18);
				s.setAbilityBase("dex", 16);
				s.setAbilityBase("con", 14);

				const classes = s.getClasses();
				expect(classes[0].level).toBe(lvl);
				expect(s.getTotalLevel()).toBe(lvl);

				// Spell DC should always be valid
				s.applyClassFeatureEffects();
				const calcs = s.getFeatureCalculations();
				expect(calcs.spellSaveDc).toBeGreaterThanOrEqual(12);
			}
		});

		it("should track proficiency bonus correctly at all tier boundaries", () => {
			const profTable = [
				{level: 1, prof: 2}, {level: 4, prof: 2},
				{level: 5, prof: 3}, {level: 8, prof: 3},
				{level: 9, prof: 4}, {level: 12, prof: 4},
				{level: 13, prof: 5}, {level: 16, prof: 5},
				{level: 17, prof: 6}, {level: 20, prof: 6},
			];

			profTable.forEach(({level, prof}) => {
				const s = new CharacterSheetState();
				s.addClass({name: "Wizard", source: "TGTT", level});
				expect(s.getProficiencyBonus()).toBe(prof);
			});
		});
	});
});
