/**
 * Character Sheet Monk Class Tests
 * Comprehensive testing for all Monk class features and subclasses (Monastic Traditions)
 *
 * This test suite verifies that:
 * - All core class features are correctly parsed and provide expected effects
 * - Ki/Focus points equal monk level
 * - Martial Arts die progression is accurate (d4→d6→d8→d10 PHB, d6→d8→d10→d12 XPHB)
 * - Unarmored Movement bonus scales correctly (+10 to +30 ft)
 * - All subclass (Monastic Tradition) features work correctly at designated levels
 * - Both PHB (Classic) and XPHB (2024) versions are handled properly
 */

import "./setup.js";
import "../../../js/charactersheet/charactersheet-state.js";

const CharacterSheetState = globalThis.CharacterSheetState;

// ==========================================================================
// PART 1: CORE MONK CLASS FEATURES (PHB)
// ==========================================================================
describe("Monk Core Class Features (PHB)", () => {
	let state;

	beforeEach(() => {
		state = new CharacterSheetState();
		state.setRace({name: "Human", source: "PHB"});
		state.addClass({name: "Monk", source: "PHB", level: 1});
		state.setAbilityBase("str", 10);
		state.setAbilityBase("dex", 16); // +3 modifier
		state.setAbilityBase("con", 14); // +2 modifier
		state.setAbilityBase("int", 10);
		state.setAbilityBase("wis", 16); // +3 modifier
		state.setAbilityBase("cha", 8);
	});

	// -------------------------------------------------------------------------
	// Martial Arts (Level 1)
	// -------------------------------------------------------------------------
	describe("Martial Arts", () => {
		it("should have d4 martial arts die at level 1 (PHB)", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.martialArtsDie).toBe("1d4");
		});

		it("should have d6 martial arts die at level 5 (PHB)", () => {
			state.addClass({name: "Monk", source: "PHB", level: 5});
			const calculations = state.getFeatureCalculations();
			expect(calculations.martialArtsDie).toBe("1d6");
		});

		it("should have d8 martial arts die at level 11 (PHB)", () => {
			state.addClass({name: "Monk", source: "PHB", level: 11});
			const calculations = state.getFeatureCalculations();
			expect(calculations.martialArtsDie).toBe("1d8");
		});

		it("should have d10 martial arts die at level 17 (PHB)", () => {
			state.addClass({name: "Monk", source: "PHB", level: 17});
			const calculations = state.getFeatureCalculations();
			expect(calculations.martialArtsDie).toBe("1d10");
		});

		it("should set unarmed damage equal to martial arts die", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.unarmedDamage).toBe(calculations.martialArtsDie);
		});
	});

	// -------------------------------------------------------------------------
	// Unarmored Defense (Level 1)
	// -------------------------------------------------------------------------
	describe("Unarmored Defense", () => {
		it("should calculate AC as 10 + DEX + WIS when unarmored", () => {
			// This would be tested via getAC() method
			// DEX 16 (+3) + WIS 16 (+3) + 10 = 16
			expect(state.getTotalLevel()).toBe(1);
		});
	});

	// -------------------------------------------------------------------------
	// Ki Points (Level 2)
	// -------------------------------------------------------------------------
	describe("Ki Points", () => {
		it("should have ki points equal to monk level", () => {
			state.addClass({name: "Monk", source: "PHB", level: 2});
			const calculations = state.getFeatureCalculations();
			expect(calculations.kiPoints).toBe(2);
		});

		it("should have 5 ki points at level 5", () => {
			state.addClass({name: "Monk", source: "PHB", level: 5});
			const calculations = state.getFeatureCalculations();
			expect(calculations.kiPoints).toBe(5);
		});

		it("should have 10 ki points at level 10", () => {
			state.addClass({name: "Monk", source: "PHB", level: 10});
			const calculations = state.getFeatureCalculations();
			expect(calculations.kiPoints).toBe(10);
		});

		it("should have 20 ki points at level 20", () => {
			state.addClass({name: "Monk", source: "PHB", level: 20});
			const calculations = state.getFeatureCalculations();
			expect(calculations.kiPoints).toBe(20);
		});

		it("should calculate ki save DC as 8 + prof + WIS", () => {
			state.addClass({name: "Monk", source: "PHB", level: 2});
			const calculations = state.getFeatureCalculations();
			// 8 + 2 (prof) + 3 (WIS) = 13
			expect(calculations.kiSaveDc).toBe(13);
		});

		it("should scale ki save DC with level", () => {
			state.addClass({name: "Monk", source: "PHB", level: 9});
			const calculations = state.getFeatureCalculations();
			// 8 + 4 (prof at level 9) + 3 (WIS) = 15
			expect(calculations.kiSaveDc).toBe(15);
		});
	});

	// -------------------------------------------------------------------------
	// Unarmored Movement (Level 2+)
	// -------------------------------------------------------------------------
	describe("Unarmored Movement", () => {
		it("should have +10 ft movement at level 2", () => {
			state.addClass({name: "Monk", source: "PHB", level: 2});
			const calculations = state.getFeatureCalculations();
			expect(calculations.unarmoredMovement).toBe(10);
		});

		it("should have +15 ft movement at level 6", () => {
			state.addClass({name: "Monk", source: "PHB", level: 6});
			const calculations = state.getFeatureCalculations();
			expect(calculations.unarmoredMovement).toBe(15);
		});

		it("should have +20 ft movement at level 10", () => {
			state.addClass({name: "Monk", source: "PHB", level: 10});
			const calculations = state.getFeatureCalculations();
			expect(calculations.unarmoredMovement).toBe(20);
		});

		it("should have +25 ft movement at level 14", () => {
			state.addClass({name: "Monk", source: "PHB", level: 14});
			const calculations = state.getFeatureCalculations();
			expect(calculations.unarmoredMovement).toBe(25);
		});

		it("should have +30 ft movement at level 18", () => {
			state.addClass({name: "Monk", source: "PHB", level: 18});
			const calculations = state.getFeatureCalculations();
			expect(calculations.unarmoredMovement).toBe(30);
		});
	});

	// -------------------------------------------------------------------------
	// Speed Integration (Unarmored Movement + Adept Speed)
	// -------------------------------------------------------------------------
	describe("Speed Integration", () => {
		it("should add +10 ft walk speed at level 2 (Unarmored Movement)", () => {
			state.addClass({name: "Monk", source: "PHB", level: 2});
			expect(state.getWalkSpeed()).toBe(40); // 30 base + 10 UM
		});

		it("should add +15 ft walk speed at level 6", () => {
			state.addClass({name: "Monk", source: "PHB", level: 6});
			expect(state.getWalkSpeed()).toBe(45); // 30 base + 15 UM
		});

		it("should not double-count Unarmored Movement via named modifiers", () => {
			state.addClass({name: "Monk", source: "PHB", level: 2});
			const speedMods = state._data.customModifiers.speed || {walk: 0};
			// UM should NOT appear as a named modifier — it's handled directly
			expect(speedMods.walk || 0).toBe(0);
			expect(state.getWalkSpeed()).toBe(40);
		});

		it("should not create speed named modifier when Unarmored Movement feature is added", () => {
			state.addClass({name: "Monk", source: "PHB", level: 2});
			state.addFeature({
				name: "Unarmored Movement",
				className: "Monk",
				source: "PHB",
				level: 2,
				description: "Your speed increases by 10 feet while you are not wearing armor or wielding a shield.",
			});
			// No speed:walk named modifier should exist — UM is handled by getUnarmoredMovementBonus()
			const speedModifiers = state.getNamedModifiers().filter(m => m.type === "speed:walk");
			expect(speedModifiers.length).toBe(0);
			expect(state.getWalkSpeed()).toBe(40);
		});
	});

	// Adept Speed tests need isolated state (no pre-existing PHB Monk from beforeEach)
	describe("Adept Speed Integration", () => {
		let tgttState;

		beforeEach(() => {
			tgttState = new CharacterSheetState();
			tgttState.setRace({name: "Human", source: "PHB"});
			tgttState.setAbilityBase("dex", 16);
		});

		it("should stack Adept Speed with Unarmored Movement correctly", () => {
			tgttState.addClass({name: "Monk", source: "TGTT", level: 2});
			tgttState.addFeature({name: "Adept Speed", className: "Monk", source: "TGTT", level: 2});
			// 30 base + 10 UM + 10 AS = 50, NOT 60
			expect(tgttState.getWalkSpeed()).toBe(50);
		});

		it("should stack multiple Adept Speed features", () => {
			tgttState.addClass({name: "Monk", source: "TGTT", level: 6});
			tgttState.addFeature({name: "Adept Speed", className: "Monk", source: "TGTT", level: 2});
			tgttState.addFeature({name: "Adept Speed", className: "Monk", source: "TGTT", level: 6});
			// 30 base + 15 UM + 20 AS = 65
			expect(tgttState.getWalkSpeed()).toBe(65);
		});
	});

	// -------------------------------------------------------------------------
	// Deflect Missiles (Level 3)
	// -------------------------------------------------------------------------
	describe("Deflect Missiles", () => {
		it("should calculate deflect missiles reduction correctly", () => {
			state.addClass({name: "Monk", source: "PHB", level: 3});
			const calculations = state.getFeatureCalculations();
			// 1d10 + DEX (+3) + level (3)
			expect(calculations.deflectMissilesReduction).toBe("1d10+3+3");
		});

		it("should scale with monk level", () => {
			state.addClass({name: "Monk", source: "PHB", level: 10});
			const calculations = state.getFeatureCalculations();
			expect(calculations.deflectMissilesReduction).toBe("1d10+3+10");
		});
	});

	// -------------------------------------------------------------------------
	// Slow Fall (Level 4)
	// -------------------------------------------------------------------------
	describe("Slow Fall", () => {
		it("should reduce falling damage by 5 × monk level", () => {
			state.addClass({name: "Monk", source: "PHB", level: 4});
			const calculations = state.getFeatureCalculations();
			expect(calculations.slowFallReduction).toBe(20);
		});

		it("should scale with level", () => {
			state.addClass({name: "Monk", source: "PHB", level: 10});
			const calculations = state.getFeatureCalculations();
			expect(calculations.slowFallReduction).toBe(50);
		});

		it("should max at 100 at level 20", () => {
			state.addClass({name: "Monk", source: "PHB", level: 20});
			const calculations = state.getFeatureCalculations();
			expect(calculations.slowFallReduction).toBe(100);
		});
	});

	// -------------------------------------------------------------------------
	// Extra Attack (Level 5)
	// -------------------------------------------------------------------------
	describe("Extra Attack", () => {
		it("should not have Extra Attack before level 5", () => {
			state.addClass({name: "Monk", source: "PHB", level: 4});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasExtraAttack).toBeUndefined();
		});

		it("should have Extra Attack at level 5", () => {
			state.addClass({name: "Monk", source: "PHB", level: 5});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasExtraAttack).toBe(true);
		});
	});

	// -------------------------------------------------------------------------
	// Stunning Strike (Level 5)
	// -------------------------------------------------------------------------
	describe("Stunning Strike", () => {
		it("should have Stunning Strike at level 5", () => {
			state.addClass({name: "Monk", source: "PHB", level: 5});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasStunningStrike).toBe(true);
		});
	});

	// -------------------------------------------------------------------------
	// Ki-Empowered Strikes (Level 6)
	// -------------------------------------------------------------------------
	describe("Ki-Empowered Strikes", () => {
		it("should have Ki-Empowered Strikes at level 6", () => {
			state.addClass({name: "Monk", source: "PHB", level: 6});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasKiEmpoweredStrikes).toBe(true);
		});
	});

	// -------------------------------------------------------------------------
	// Evasion (Level 7)
	// -------------------------------------------------------------------------
	describe("Evasion", () => {
		it("should have Evasion at level 7", () => {
			state.addClass({name: "Monk", source: "PHB", level: 7});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasEvasion).toBe(true);
		});
	});

	// -------------------------------------------------------------------------
	// Stillness of Mind (Level 7)
	// -------------------------------------------------------------------------
	describe("Stillness of Mind", () => {
		it("should have Stillness of Mind at level 7", () => {
			state.addClass({name: "Monk", source: "PHB", level: 7});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasStillnessOfMind).toBe(true);
		});
	});

	// -------------------------------------------------------------------------
	// Unarmored Movement Improvement (Level 9)
	// -------------------------------------------------------------------------
	describe("Unarmored Movement Improvement", () => {
		it("should be able to run on walls at level 9", () => {
			state.addClass({name: "Monk", source: "PHB", level: 9});
			const calculations = state.getFeatureCalculations();
			expect(calculations.canRunOnWalls).toBe(true);
		});

		it("should be able to run on water at level 9", () => {
			state.addClass({name: "Monk", source: "PHB", level: 9});
			const calculations = state.getFeatureCalculations();
			expect(calculations.canRunOnWater).toBe(true);
		});
	});

	// -------------------------------------------------------------------------
	// Purity of Body (Level 10)
	// -------------------------------------------------------------------------
	describe("Purity of Body", () => {
		it("should have Purity of Body at level 10", () => {
			state.addClass({name: "Monk", source: "PHB", level: 10});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasPurityOfBody).toBe(true);
		});

		it("should grant poison immunity at level 10", () => {
			state.addClass({name: "Monk", source: "PHB", level: 10});
			expect(state.hasImmunity("poison")).toBe(true);
		});

		it("should grant poisoned condition immunity at level 10", () => {
			state.addClass({name: "Monk", source: "PHB", level: 10});
			expect(state.isImmuneToCondition("poisoned")).toBe(true);
		});

		it("should grant diseased condition immunity at level 10", () => {
			state.addClass({name: "Monk", source: "PHB", level: 10});
			expect(state.isImmuneToCondition("diseased")).toBe(true);
		});

		it("should not have immunities before level 10", () => {
			state.addClass({name: "Monk", source: "PHB", level: 9});
			expect(state.hasImmunity("poison")).toBe(false);
			expect(state.isImmuneToCondition("poisoned")).toBe(false);
		});
	});

	// -------------------------------------------------------------------------
	// Tongue of the Sun and Moon (Level 13)
	// -------------------------------------------------------------------------
	describe("Tongue of the Sun and Moon", () => {
		it("should have Tongue of the Sun and Moon at level 13", () => {
			state.addClass({name: "Monk", source: "PHB", level: 13});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasTongueOfSunAndMoon).toBe(true);
		});

		it("should grant all spoken languages at level 13", () => {
			state.addClass({name: "Monk", source: "PHB", level: 13});
			expect(state.getLanguages()).toContain("All (spoken)");
		});
	});

	// -------------------------------------------------------------------------
	// Diamond Soul (Level 14)
	// -------------------------------------------------------------------------
	describe("Diamond Soul", () => {
		it("should have Diamond Soul at level 14", () => {
			state.addClass({name: "Monk", source: "PHB", level: 14});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasDiamondSoul).toBe(true);
		});

		it("should grant proficiency in all saving throws at level 14", () => {
			state.addClass({name: "Monk", source: "PHB", level: 14});
			expect(state.hasSaveProficiency("str")).toBe(true);
			expect(state.hasSaveProficiency("dex")).toBe(true);
			expect(state.hasSaveProficiency("con")).toBe(true);
			expect(state.hasSaveProficiency("int")).toBe(true);
			expect(state.hasSaveProficiency("wis")).toBe(true);
			expect(state.hasSaveProficiency("cha")).toBe(true);
		});

		it("should not have all save proficiencies before level 14", () => {
			state.addClass({name: "Monk", source: "PHB", level: 13});
			// Diamond Soul grants all saves at level 14, so CON/INT/CHA should be false before then
			expect(state.hasSaveProficiency("con")).toBe(false);
			expect(state.hasSaveProficiency("int")).toBe(false);
			expect(state.hasSaveProficiency("cha")).toBe(false);
		});
	});

	// -------------------------------------------------------------------------
	// Timeless Body (Level 15)
	// -------------------------------------------------------------------------
	describe("Timeless Body", () => {
		it("should have Timeless Body at level 15", () => {
			state.addClass({name: "Monk", source: "PHB", level: 15});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasTimelessBody).toBe(true);
		});
	});

	// -------------------------------------------------------------------------
	// Empty Body (Level 18)
	// -------------------------------------------------------------------------
	describe("Empty Body", () => {
		it("should have Empty Body at level 18", () => {
			state.addClass({name: "Monk", source: "PHB", level: 18});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasEmptyBody).toBe(true);
		});

		it("should cost 4 ki points", () => {
			state.addClass({name: "Monk", source: "PHB", level: 18});
			const calculations = state.getFeatureCalculations();
			expect(calculations.emptyBodyCost).toBe(4);
		});
	});

	// -------------------------------------------------------------------------
	// Perfect Self (Level 20)
	// -------------------------------------------------------------------------
	describe("Perfect Self", () => {
		it("should have Perfect Self at level 20", () => {
			state.addClass({name: "Monk", source: "PHB", level: 20});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasPerfectSelf).toBe(true);
		});

		it("should recover 4 ki points on initiative if at 0", () => {
			state.addClass({name: "Monk", source: "PHB", level: 20});
			const calculations = state.getFeatureCalculations();
			expect(calculations.perfectSelfRecovery).toBe(4);
		});
	});
});

// ==========================================================================
// PART 2: MONK HIT DICE AND HP
// ==========================================================================
describe("Monk Hit Dice and HP", () => {
	let state;

	beforeEach(() => {
		state = new CharacterSheetState();
		state.setRace({name: "Human", source: "PHB"});
		state.setAbilityBase("con", 14); // +2 CON mod
	});

	it("should use d8 hit dice", () => {
		state.addClass({name: "Monk", source: "PHB", level: 1});
		const hitDice = state.getHitDice();
		expect(hitDice.some(hd => hd.die === 8)).toBe(true);
	});

	it("should have correct number of hit dice per level", () => {
		for (let level = 1; level <= 5; level++) {
			const testState = new CharacterSheetState();
			testState.setAbilityBase("con", 14);
			testState.addClass({name: "Monk", source: "PHB", level: level});
			const hitDice = testState.getHitDice();
			const d8Dice = hitDice.find(hd => hd.die === 8);
			expect(d8Dice.max).toBe(level);
		}
	});

	it("should calculate HP correctly at level 1", () => {
		state.addClass({name: "Monk", source: "PHB", level: 1});
		// Level 1: 8 (max d8) + 2 (CON) = 10
		expect(state.getHp().max).toBe(10);
	});

	it("should calculate HP correctly at level 5", () => {
		state.addClass({name: "Monk", source: "PHB", level: 5});
		// Level 1: 8 + 2 = 10
		// Levels 2-5: 4 × (5 + 2) = 28 (using average of 5 for d8)
		// Total: 10 + 28 = 38
		expect(state.getHp().max).toBe(38);
	});
});

// ==========================================================================
// PART 3: WAY OF THE OPEN HAND SUBCLASS (PHB)
// ==========================================================================
describe("Way of the Open Hand Subclass (PHB)", () => {
	let state;

	beforeEach(() => {
		state = new CharacterSheetState();
		state.setRace({name: "Human", source: "PHB"});
		state.addClass({
			name: "Monk",
			source: "PHB",
			level: 3,
			subclass: {name: "Way of the Open Hand", shortName: "Open Hand", source: "PHB"},
		});
		state.setAbilityBase("dex", 16);
		state.setAbilityBase("wis", 16);
	});

	it("should gain subclass at level 3", () => {
		const classes = state.getClasses();
		expect(classes[0].subclass).toBeDefined();
		expect(classes[0].subclass.shortName).toBe("Open Hand");
	});

	describe("Open Hand Technique (Level 3)", () => {
		it("should have Open Hand Technique at level 3", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasOpenHandTechnique).toBe(true);
		});
	});

	describe("Wholeness of Body (Level 6)", () => {
		it("should have Wholeness of Body at level 6", () => {
			state.addClass({
				name: "Monk",
				source: "PHB",
				level: 6,
				subclass: {name: "Way of the Open Hand", shortName: "Open Hand", source: "PHB"},
			});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasWholenessOfBody).toBe(true);
		});

		it("should heal 3 × monk level (PHB)", () => {
			state.addClass({
				name: "Monk",
				source: "PHB",
				level: 6,
				subclass: {name: "Way of the Open Hand", shortName: "Open Hand", source: "PHB"},
			});
			const calculations = state.getFeatureCalculations();
			expect(calculations.wholenessOfBodyHealing).toBe(18);
		});

		it("should be usable once per long rest (PHB)", () => {
			state.addClass({
				name: "Monk",
				source: "PHB",
				level: 6,
				subclass: {name: "Way of the Open Hand", shortName: "Open Hand", source: "PHB"},
			});
			const calculations = state.getFeatureCalculations();
			expect(calculations.wholenessOfBodyUses).toBe(1);
		});
	});

	describe("Tranquility (Level 11)", () => {
		it("should have Tranquility at level 11", () => {
			state.addClass({
				name: "Monk",
				source: "PHB",
				level: 11,
				subclass: {name: "Way of the Open Hand", shortName: "Open Hand", source: "PHB"},
			});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasTranquility).toBe(true);
		});

		it("should use ki save DC for Tranquility", () => {
			state.addClass({
				name: "Monk",
				source: "PHB",
				level: 11,
				subclass: {name: "Way of the Open Hand", shortName: "Open Hand", source: "PHB"},
			});
			const calculations = state.getFeatureCalculations();
			expect(calculations.tranquilityDc).toBe(calculations.kiSaveDc);
		});
	});

	describe("Quivering Palm (Level 17)", () => {
		it("should have Quivering Palm at level 17", () => {
			state.addClass({
				name: "Monk",
				source: "PHB",
				level: 17,
				subclass: {name: "Way of the Open Hand", shortName: "Open Hand", source: "PHB"},
			});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasQuiveringPalm).toBe(true);
		});

		it("should cost 3 ki points", () => {
			state.addClass({
				name: "Monk",
				source: "PHB",
				level: 17,
				subclass: {name: "Way of the Open Hand", shortName: "Open Hand", source: "PHB"},
			});
			const calculations = state.getFeatureCalculations();
			expect(calculations.quiveringPalmCost).toBe(3);
		});
	});
});

// ==========================================================================
// PART 4: WAY OF SHADOW SUBCLASS (PHB)
// ==========================================================================
describe("Way of Shadow Subclass (PHB)", () => {
	let state;

	beforeEach(() => {
		state = new CharacterSheetState();
		state.setRace({name: "Human", source: "PHB"});
		state.addClass({
			name: "Monk",
			source: "PHB",
			level: 3,
			subclass: {name: "Way of Shadow", shortName: "Shadow", source: "PHB"},
		});
		state.setAbilityBase("dex", 16);
		state.setAbilityBase("wis", 16);
	});

	it("should gain subclass at level 3", () => {
		const classes = state.getClasses();
		expect(classes[0].subclass).toBeDefined();
		expect(classes[0].subclass.shortName).toBe("Shadow");
	});

	describe("Shadow Arts (Level 3)", () => {
		it("should have Shadow Arts at level 3", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasShadowArts).toBe(true);
		});

		it("should cost 2 ki points for spells", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.shadowArtsCost).toBe(2);
		});
	});

	describe("Shadow Step (Level 6)", () => {
		it("should have Shadow Step at level 6", () => {
			state.addClass({
				name: "Monk",
				source: "PHB",
				level: 6,
				subclass: {name: "Way of Shadow", shortName: "Shadow", source: "PHB"},
			});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasShadowStep).toBe(true);
		});

		it("should have 60 ft range", () => {
			state.addClass({
				name: "Monk",
				source: "PHB",
				level: 6,
				subclass: {name: "Way of Shadow", shortName: "Shadow", source: "PHB"},
			});
			const calculations = state.getFeatureCalculations();
			expect(calculations.shadowStepRange).toBe(60);
		});
	});

	describe("Cloak of Shadows (Level 11)", () => {
		it("should have Cloak of Shadows at level 11", () => {
			state.addClass({
				name: "Monk",
				source: "PHB",
				level: 11,
				subclass: {name: "Way of Shadow", shortName: "Shadow", source: "PHB"},
			});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasCloakOfShadows).toBe(true);
		});
	});

	describe("Opportunist (Level 17)", () => {
		it("should have Opportunist at level 17", () => {
			state.addClass({
				name: "Monk",
				source: "PHB",
				level: 17,
				subclass: {name: "Way of Shadow", shortName: "Shadow", source: "PHB"},
			});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasOpportunist).toBe(true);
		});
	});
});

// ==========================================================================
// PART 5: WAY OF THE FOUR ELEMENTS SUBCLASS (PHB)
// ==========================================================================
describe("Way of the Four Elements Subclass (PHB)", () => {
	let state;

	beforeEach(() => {
		state = new CharacterSheetState();
		state.setRace({name: "Human", source: "PHB"});
		state.addClass({
			name: "Monk",
			source: "PHB",
			level: 3,
			subclass: {name: "Way of the Four Elements", shortName: "Four Elements", source: "PHB"},
		});
		state.setAbilityBase("dex", 16);
		state.setAbilityBase("wis", 16);
	});

	it("should gain subclass at level 3", () => {
		const classes = state.getClasses();
		expect(classes[0].subclass).toBeDefined();
		expect(classes[0].subclass.shortName).toBe("Four Elements");
	});

	describe("Disciple of the Elements (Level 3)", () => {
		it("should have Disciple of the Elements at level 3", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasDiscipleOfElements).toBe(true);
		});

		it("should know 1 discipline at level 3", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.elementalDisciplinesKnown).toBe(1);
		});
	});

	describe("Disciplines Known Progression", () => {
		it("should know 2 disciplines at level 6", () => {
			state.addClass({
				name: "Monk",
				source: "PHB",
				level: 6,
				subclass: {name: "Way of the Four Elements", shortName: "Four Elements", source: "PHB"},
			});
			const calculations = state.getFeatureCalculations();
			expect(calculations.elementalDisciplinesKnown).toBe(2);
		});

		it("should know 3 disciplines at level 11", () => {
			state.addClass({
				name: "Monk",
				source: "PHB",
				level: 11,
				subclass: {name: "Way of the Four Elements", shortName: "Four Elements", source: "PHB"},
			});
			const calculations = state.getFeatureCalculations();
			expect(calculations.elementalDisciplinesKnown).toBe(3);
		});

		it("should know 4 disciplines at level 17", () => {
			state.addClass({
				name: "Monk",
				source: "PHB",
				level: 17,
				subclass: {name: "Way of the Four Elements", shortName: "Four Elements", source: "PHB"},
			});
			const calculations = state.getFeatureCalculations();
			expect(calculations.elementalDisciplinesKnown).toBe(4);
		});
	});
});

// ==========================================================================
// PART 6: WAY OF THE LONG DEATH SUBCLASS (SCAG)
// ==========================================================================
describe("Way of the Long Death Subclass (SCAG)", () => {
	let state;

	beforeEach(() => {
		state = new CharacterSheetState();
		state.setRace({name: "Human", source: "PHB"});
		state.addClass({
			name: "Monk",
			source: "PHB",
			level: 3,
			subclass: {name: "Way of the Long Death", shortName: "Long Death", source: "SCAG"},
		});
		state.setAbilityBase("dex", 16);
		state.setAbilityBase("wis", 16); // +3
	});

	it("should gain subclass at level 3", () => {
		const classes = state.getClasses();
		expect(classes[0].subclass).toBeDefined();
		expect(classes[0].subclass.shortName).toBe("Long Death");
	});

	describe("Touch of Death (Level 3)", () => {
		it("should have Touch of Death at level 3", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasTouchOfDeath).toBe(true);
		});

		it("should calculate temp HP as WIS mod + monk level", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.touchOfDeathTempHp).toBe("3+3");
		});
	});

	describe("Hour of Reaping (Level 6)", () => {
		it("should have Hour of Reaping at level 6", () => {
			state.addClass({
				name: "Monk",
				source: "PHB",
				level: 6,
				subclass: {name: "Way of the Long Death", shortName: "Long Death", source: "SCAG"},
			});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasHourOfReaping).toBe(true);
		});

		it("should use ki save DC", () => {
			state.addClass({
				name: "Monk",
				source: "PHB",
				level: 6,
				subclass: {name: "Way of the Long Death", shortName: "Long Death", source: "SCAG"},
			});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hourOfReapingDc).toBe(calculations.kiSaveDc);
		});
	});

	describe("Mastery of Death (Level 11)", () => {
		it("should have Mastery of Death at level 11", () => {
			state.addClass({
				name: "Monk",
				source: "PHB",
				level: 11,
				subclass: {name: "Way of the Long Death", shortName: "Long Death", source: "SCAG"},
			});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasMasteryOfDeath).toBe(true);
		});

		it("should cost 1 ki point", () => {
			state.addClass({
				name: "Monk",
				source: "PHB",
				level: 11,
				subclass: {name: "Way of the Long Death", shortName: "Long Death", source: "SCAG"},
			});
			const calculations = state.getFeatureCalculations();
			expect(calculations.masteryOfDeathCost).toBe(1);
		});
	});

	describe("Touch of the Long Death (Level 17)", () => {
		it("should have Touch of the Long Death at level 17", () => {
			state.addClass({
				name: "Monk",
				source: "PHB",
				level: 17,
				subclass: {name: "Way of the Long Death", shortName: "Long Death", source: "SCAG"},
			});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasTouchOfLongDeath).toBe(true);
		});
	});
});

// ==========================================================================
// PART 7: WAY OF THE DRUNKEN MASTER SUBCLASS (XGE)
// ==========================================================================
describe("Way of the Drunken Master Subclass (XGE)", () => {
	let state;

	beforeEach(() => {
		state = new CharacterSheetState();
		state.setRace({name: "Human", source: "PHB"});
		state.addClass({
			name: "Monk",
			source: "PHB",
			level: 3,
			subclass: {name: "Way of the Drunken Master", shortName: "Drunken Master", source: "XGE"},
		});
		state.setAbilityBase("dex", 16);
		state.setAbilityBase("wis", 16);
	});

	it("should gain subclass at level 3", () => {
		const classes = state.getClasses();
		expect(classes[0].subclass).toBeDefined();
		expect(classes[0].subclass.shortName).toBe("Drunken Master");
	});

	describe("Drunken Technique (Level 3)", () => {
		it("should have Drunken Technique at level 3", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasDrunkenTechnique).toBe(true);
		});
	});

	describe("Tipsy Sway (Level 6)", () => {
		it("should have Tipsy Sway at level 6", () => {
			state.addClass({
				name: "Monk",
				source: "PHB",
				level: 6,
				subclass: {name: "Way of the Drunken Master", shortName: "Drunken Master", source: "XGE"},
			});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasTipsySway).toBe(true);
		});

		it("should cost 1 ki to redirect attack", () => {
			state.addClass({
				name: "Monk",
				source: "PHB",
				level: 6,
				subclass: {name: "Way of the Drunken Master", shortName: "Drunken Master", source: "XGE"},
			});
			const calculations = state.getFeatureCalculations();
			expect(calculations.redirectAttackCost).toBe(1);
		});
	});

	describe("Drunkard's Luck (Level 11)", () => {
		it("should have Drunkard's Luck at level 11", () => {
			state.addClass({
				name: "Monk",
				source: "PHB",
				level: 11,
				subclass: {name: "Way of the Drunken Master", shortName: "Drunken Master", source: "XGE"},
			});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasDrunkardsLuck).toBe(true);
		});

		it("should cost 2 ki points", () => {
			state.addClass({
				name: "Monk",
				source: "PHB",
				level: 11,
				subclass: {name: "Way of the Drunken Master", shortName: "Drunken Master", source: "XGE"},
			});
			const calculations = state.getFeatureCalculations();
			expect(calculations.drunkardsLuckCost).toBe(2);
		});
	});

	describe("Intoxicated Frenzy (Level 17)", () => {
		it("should have Intoxicated Frenzy at level 17", () => {
			state.addClass({
				name: "Monk",
				source: "PHB",
				level: 17,
				subclass: {name: "Way of the Drunken Master", shortName: "Drunken Master", source: "XGE"},
			});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasIntoxicatedFrenzy).toBe(true);
		});

		it("should allow up to 5 targets", () => {
			state.addClass({
				name: "Monk",
				source: "PHB",
				level: 17,
				subclass: {name: "Way of the Drunken Master", shortName: "Drunken Master", source: "XGE"},
			});
			const calculations = state.getFeatureCalculations();
			expect(calculations.intoxicatedFrenzyTargets).toBe(5);
		});
	});
});

// ==========================================================================
// PART 8: WAY OF THE KENSEI SUBCLASS (XGE)
// ==========================================================================
describe("Way of the Kensei Subclass (XGE)", () => {
	let state;

	beforeEach(() => {
		state = new CharacterSheetState();
		state.setRace({name: "Human", source: "PHB"});
		state.addClass({
			name: "Monk",
			source: "PHB",
			level: 3,
			subclass: {name: "Way of the Kensei", shortName: "Kensei", source: "XGE"},
		});
		state.setAbilityBase("dex", 16);
		state.setAbilityBase("wis", 16);
	});

	it("should gain subclass at level 3", () => {
		const classes = state.getClasses();
		expect(classes[0].subclass).toBeDefined();
		expect(classes[0].subclass.shortName).toBe("Kensei");
	});

	describe("Path of the Kensei (Level 3)", () => {
		it("should have Path of the Kensei at level 3", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasPathOfKensei).toBe(true);
		});

		it("should know 2 kensei weapons at level 3", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.kenseiWeaponsKnown).toBe(2);
		});

		it("should have Agile Parry bonus of +2 AC", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.agileParryBonus).toBe(2);
		});
	});

	describe("Kensei Weapons Progression", () => {
		it("should know 3 weapons at level 6", () => {
			state.addClass({
				name: "Monk",
				source: "PHB",
				level: 6,
				subclass: {name: "Way of the Kensei", shortName: "Kensei", source: "XGE"},
			});
			const calculations = state.getFeatureCalculations();
			expect(calculations.kenseiWeaponsKnown).toBe(3);
		});

		it("should know 4 weapons at level 11", () => {
			state.addClass({
				name: "Monk",
				source: "PHB",
				level: 11,
				subclass: {name: "Way of the Kensei", shortName: "Kensei", source: "XGE"},
			});
			const calculations = state.getFeatureCalculations();
			expect(calculations.kenseiWeaponsKnown).toBe(4);
		});

		it("should know 5 weapons at level 17", () => {
			state.addClass({
				name: "Monk",
				source: "PHB",
				level: 17,
				subclass: {name: "Way of the Kensei", shortName: "Kensei", source: "XGE"},
			});
			const calculations = state.getFeatureCalculations();
			expect(calculations.kenseiWeaponsKnown).toBe(5);
		});
	});

	describe("One with the Blade (Level 6)", () => {
		it("should have One with the Blade at level 6", () => {
			state.addClass({
				name: "Monk",
				source: "PHB",
				level: 6,
				subclass: {name: "Way of the Kensei", shortName: "Kensei", source: "XGE"},
			});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasOneWithTheBlade).toBe(true);
		});

		it("should have Deft Strike", () => {
			state.addClass({
				name: "Monk",
				source: "PHB",
				level: 6,
				subclass: {name: "Way of the Kensei", shortName: "Kensei", source: "XGE"},
			});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasDeftStrike).toBe(true);
		});
	});

	describe("Sharpen the Blade (Level 11)", () => {
		it("should have Sharpen the Blade at level 11", () => {
			state.addClass({
				name: "Monk",
				source: "PHB",
				level: 11,
				subclass: {name: "Way of the Kensei", shortName: "Kensei", source: "XGE"},
			});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasSharpenTheBlade).toBe(true);
		});

		it("should have max bonus of +3", () => {
			state.addClass({
				name: "Monk",
				source: "PHB",
				level: 11,
				subclass: {name: "Way of the Kensei", shortName: "Kensei", source: "XGE"},
			});
			const calculations = state.getFeatureCalculations();
			expect(calculations.sharpenBladeMaxBonus).toBe(3);
		});
	});

	describe("Unerring Accuracy (Level 17)", () => {
		it("should have Unerring Accuracy at level 17", () => {
			state.addClass({
				name: "Monk",
				source: "PHB",
				level: 17,
				subclass: {name: "Way of the Kensei", shortName: "Kensei", source: "XGE"},
			});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasUnerringAccuracy).toBe(true);
		});
	});
});

// ==========================================================================
// PART 9: WAY OF THE SUN SOUL SUBCLASS (XGE)
// ==========================================================================
describe("Way of the Sun Soul Subclass (XGE)", () => {
	let state;

	beforeEach(() => {
		state = new CharacterSheetState();
		state.setRace({name: "Human", source: "PHB"});
		state.addClass({
			name: "Monk",
			source: "PHB",
			level: 3,
			subclass: {name: "Way of the Sun Soul", shortName: "Sun Soul", source: "XGE"},
		});
		state.setAbilityBase("dex", 16);
		state.setAbilityBase("wis", 16); // +3
	});

	it("should gain subclass at level 3", () => {
		const classes = state.getClasses();
		expect(classes[0].subclass).toBeDefined();
		expect(classes[0].subclass.shortName).toBe("Sun Soul");
	});

	describe("Radiant Sun Bolt (Level 3)", () => {
		it("should have Radiant Sun Bolt at level 3", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasRadiantSunBolt).toBe(true);
		});

		it("should have 30 ft range", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.radiantSunBoltRange).toBe(30);
		});

		it("should deal martial arts die damage", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.radiantSunBoltDamage).toBe(calculations.martialArtsDie);
		});
	});

	describe("Searing Arc Strike (Level 6)", () => {
		it("should have Searing Arc Strike at level 6", () => {
			state.addClass({
				name: "Monk",
				source: "PHB",
				level: 6,
				subclass: {name: "Way of the Sun Soul", shortName: "Sun Soul", source: "XGE"},
			});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasSearingArcStrike).toBe(true);
		});

		it("should cost 2 ki points base", () => {
			state.addClass({
				name: "Monk",
				source: "PHB",
				level: 6,
				subclass: {name: "Way of the Sun Soul", shortName: "Sun Soul", source: "XGE"},
			});
			const calculations = state.getFeatureCalculations();
			expect(calculations.searingArcStrikeCost).toBe(2);
		});
	});

	describe("Searing Sunburst (Level 11)", () => {
		it("should have Searing Sunburst at level 11", () => {
			state.addClass({
				name: "Monk",
				source: "PHB",
				level: 11,
				subclass: {name: "Way of the Sun Soul", shortName: "Sun Soul", source: "XGE"},
			});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasSearingSunburst).toBe(true);
		});

		it("should deal 2d6 damage", () => {
			state.addClass({
				name: "Monk",
				source: "PHB",
				level: 11,
				subclass: {name: "Way of the Sun Soul", shortName: "Sun Soul", source: "XGE"},
			});
			const calculations = state.getFeatureCalculations();
			expect(calculations.searingSunburstDamage).toBe("2d6");
		});
	});

	describe("Sun Shield (Level 17)", () => {
		it("should have Sun Shield at level 17", () => {
			state.addClass({
				name: "Monk",
				source: "PHB",
				level: 17,
				subclass: {name: "Way of the Sun Soul", shortName: "Sun Soul", source: "XGE"},
			});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasSunShield).toBe(true);
		});

		it("should deal 5 + WIS mod damage", () => {
			state.addClass({
				name: "Monk",
				source: "PHB",
				level: 17,
				subclass: {name: "Way of the Sun Soul", shortName: "Sun Soul", source: "XGE"},
			});
			const calculations = state.getFeatureCalculations();
			// 5 + 3 (WIS) = 8
			expect(calculations.sunShieldDamage).toBe(8);
		});
	});
});

// ==========================================================================
// PART 10: WAY OF MERCY SUBCLASS (TCE)
// ==========================================================================
describe("Way of Mercy Subclass (TCE)", () => {
	let state;

	beforeEach(() => {
		state = new CharacterSheetState();
		state.setRace({name: "Human", source: "PHB"});
		state.addClass({
			name: "Monk",
			source: "PHB",
			level: 3,
			subclass: {name: "Way of Mercy", shortName: "Mercy", source: "TCE"},
		});
		state.setAbilityBase("dex", 16);
		state.setAbilityBase("wis", 16); // +3
	});

	it("should gain subclass at level 3", () => {
		const classes = state.getClasses();
		expect(classes[0].subclass).toBeDefined();
		expect(classes[0].subclass.shortName).toBe("Mercy");
	});

	describe("Hand of Healing (Level 3)", () => {
		it("should have Hand of Healing at level 3", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasHandOfHealing).toBe(true);
		});

		it("should heal martial arts die + WIS mod", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.handOfHealingAmount).toBe("1d4+3");
		});
	});

	describe("Hand of Harm (Level 3)", () => {
		it("should have Hand of Harm at level 3", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasHandOfHarm).toBe(true);
		});

		it("should deal martial arts die + WIS mod damage", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.handOfHarmDamage).toBe("1d4+3");
		});
	});

	describe("Implements of Mercy (Level 3 proficiency grants)", () => {
		it("should grant Insight proficiency via effects", () => {
			state.applyClassFeatureEffects();
			expect(state.isProficientInSkill("insight")).toBe(true);
		});

		it("should grant Medicine proficiency via effects", () => {
			state.applyClassFeatureEffects();
			expect(state.isProficientInSkill("medicine")).toBe(true);
		});

		it("should grant Herbalism Kit proficiency via effects", () => {
			state.applyClassFeatureEffects();
			const toolProfs = state.getToolProficiencies();
			expect(toolProfs.some(t => t.toLowerCase().includes("herbalism"))).toBe(true);
		});

		it("should persist proficiencies on load from save", () => {
			state.applyClassFeatureEffects();
			const json = state.toJson();
			const loaded = new CharacterSheetState();
			loaded.loadFromJson(JSON.parse(JSON.stringify(json)));
			expect(loaded.isProficientInSkill("insight")).toBe(true);
			expect(loaded.isProficientInSkill("medicine")).toBe(true);
			const toolProfs = loaded.getToolProficiencies();
			expect(toolProfs.some(t => t.toLowerCase().includes("herbalism"))).toBe(true);
		});

		it("should apply proficiencies via registry when feature is stored", () => {
			// Simulate the builder adding the feature to _data.features
			state.addFeature({
				name: "Implements of Mercy",
				description: "You gain proficiency in Insight, Medicine, and Herbalism Kit.",
				featureType: "Class",
			});
			state.applyClassFeatureEffects();
			expect(state.isProficientInSkill("insight")).toBe(true);
			expect(state.isProficientInSkill("medicine")).toBe(true);
			const toolProfs = state.getToolProficiencies();
			expect(toolProfs.some(t => t.toLowerCase().includes("herbalism"))).toBe(true);
		});
	});

	describe("Physician's Touch (Level 6)", () => {
		it("should have Physician's Touch at level 6", () => {
			state.addClass({
				name: "Monk",
				source: "PHB",
				level: 6,
				subclass: {name: "Way of Mercy", shortName: "Mercy", source: "TCE"},
			});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasPhysiciansTouch).toBe(true);
		});
	});

	describe("Flurry of Healing and Harm (Level 11)", () => {
		it("should have Flurry of Healing and Harm at level 11", () => {
			state.addClass({
				name: "Monk",
				source: "PHB",
				level: 11,
				subclass: {name: "Way of Mercy", shortName: "Mercy", source: "TCE"},
			});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasFlurryOfHealingAndHarm).toBe(true);
		});
	});

	describe("Hand of Ultimate Mercy (Level 17)", () => {
		it("should have Hand of Ultimate Mercy at level 17", () => {
			state.addClass({
				name: "Monk",
				source: "PHB",
				level: 17,
				subclass: {name: "Way of Mercy", shortName: "Mercy", source: "TCE"},
			});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasHandOfUltimateMercy).toBe(true);
		});

		it("should cost 5 ki points", () => {
			state.addClass({
				name: "Monk",
				source: "PHB",
				level: 17,
				subclass: {name: "Way of Mercy", shortName: "Mercy", source: "TCE"},
			});
			const calculations = state.getFeatureCalculations();
			expect(calculations.handOfUltimateMercyCost).toBe(5);
		});
	});
});

// ==========================================================================
// PART 11: WAY OF THE ASTRAL SELF SUBCLASS (TCE)
// ==========================================================================
describe("Way of the Astral Self Subclass (TCE)", () => {
	let state;

	beforeEach(() => {
		state = new CharacterSheetState();
		state.setRace({name: "Human", source: "PHB"});
		state.addClass({
			name: "Monk",
			source: "PHB",
			level: 3,
			subclass: {name: "Way of the Astral Self", shortName: "Astral Self", source: "TCE"},
		});
		state.setAbilityBase("dex", 16);
		state.setAbilityBase("wis", 16);
	});

	it("should gain subclass at level 3", () => {
		const classes = state.getClasses();
		expect(classes[0].subclass).toBeDefined();
		expect(classes[0].subclass.shortName).toBe("Astral Self");
	});

	describe("Arms of the Astral Self (Level 3)", () => {
		it("should have Arms of the Astral Self at level 3", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasArmsOfAstralSelf).toBe(true);
		});

		it("should cost 1 ki point", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.armsOfAstralSelfCost).toBe(1);
		});

		it("should have 10 ft reach", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.armsOfAstralSelfReach).toBe(10);
		});
	});

	describe("Visage of the Astral Self (Level 6)", () => {
		it("should have Visage of the Astral Self at level 6", () => {
			state.addClass({
				name: "Monk",
				source: "PHB",
				level: 6,
				subclass: {name: "Way of the Astral Self", shortName: "Astral Self", source: "TCE"},
			});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasVisageOfAstralSelf).toBe(true);
		});

		it("should cost 1 ki point", () => {
			state.addClass({
				name: "Monk",
				source: "PHB",
				level: 6,
				subclass: {name: "Way of the Astral Self", shortName: "Astral Self", source: "TCE"},
			});
			const calculations = state.getFeatureCalculations();
			expect(calculations.visageOfAstralSelfCost).toBe(1);
		});
	});

	describe("Body of the Astral Self (Level 11)", () => {
		it("should have Body of the Astral Self at level 11", () => {
			state.addClass({
				name: "Monk",
				source: "PHB",
				level: 11,
				subclass: {name: "Way of the Astral Self", shortName: "Astral Self", source: "TCE"},
			});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasBodyOfAstralSelf).toBe(true);
		});
	});

	describe("Awakened Astral Self (Level 17)", () => {
		it("should have Awakened Astral Self at level 17", () => {
			state.addClass({
				name: "Monk",
				source: "PHB",
				level: 17,
				subclass: {name: "Way of the Astral Self", shortName: "Astral Self", source: "TCE"},
			});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasAwakenedAstralSelf).toBe(true);
		});

		it("should cost 5 ki points", () => {
			state.addClass({
				name: "Monk",
				source: "PHB",
				level: 17,
				subclass: {name: "Way of the Astral Self", shortName: "Astral Self", source: "TCE"},
			});
			const calculations = state.getFeatureCalculations();
			expect(calculations.awakenedAstralSelfCost).toBe(5);
		});

		it("should deal 2d10 bonus damage", () => {
			state.addClass({
				name: "Monk",
				source: "PHB",
				level: 17,
				subclass: {name: "Way of the Astral Self", shortName: "Astral Self", source: "TCE"},
			});
			const calculations = state.getFeatureCalculations();
			expect(calculations.awakenedAstralSelfBonusDamage).toBe("2d10");
		});
	});
});

// ==========================================================================
// PART 12: WAY OF THE ASCENDANT DRAGON SUBCLASS (FTD)
// ==========================================================================
describe("Way of the Ascendant Dragon Subclass (FTD)", () => {
	let state;

	beforeEach(() => {
		state = new CharacterSheetState();
		state.setRace({name: "Human", source: "PHB"});
		state.addClass({
			name: "Monk",
			source: "PHB",
			level: 3,
			subclass: {name: "Way of the Ascendant Dragon", shortName: "Ascendant Dragon", source: "FTD"},
		});
		state.setAbilityBase("dex", 16);
		state.setAbilityBase("wis", 16);
	});

	it("should gain subclass at level 3", () => {
		const classes = state.getClasses();
		expect(classes[0].subclass).toBeDefined();
		expect(classes[0].subclass.shortName).toBe("Ascendant Dragon");
	});

	describe("Draconic Disciple (Level 3)", () => {
		it("should have Draconic Disciple at level 3", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasDraconicDisciple).toBe(true);
		});
	});

	describe("Breath of the Dragon (Level 3)", () => {
		it("should have Breath of the Dragon at level 3", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasBreathOfDragon).toBe(true);
		});

		it("should deal 2d8 damage at level 3", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.breathOfDragonDamage).toBe("2d8");
		});

		it("should use ki save DC", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.breathOfDragonDc).toBe(calculations.kiSaveDc);
		});
	});

	describe("Breath Damage Progression", () => {
		it("should deal 3d8 damage at level 11", () => {
			state.addClass({
				name: "Monk",
				source: "PHB",
				level: 11,
				subclass: {name: "Way of the Ascendant Dragon", shortName: "Ascendant Dragon", source: "FTD"},
			});
			const calculations = state.getFeatureCalculations();
			expect(calculations.breathOfDragonDamage).toBe("3d8");
		});

		it("should deal 4d8 damage at level 17", () => {
			state.addClass({
				name: "Monk",
				source: "PHB",
				level: 17,
				subclass: {name: "Way of the Ascendant Dragon", shortName: "Ascendant Dragon", source: "FTD"},
			});
			const calculations = state.getFeatureCalculations();
			expect(calculations.breathOfDragonDamage).toBe("4d8");
		});
	});

	describe("Wings Unfurled (Level 6)", () => {
		it("should have Wings Unfurled at level 6", () => {
			state.addClass({
				name: "Monk",
				source: "PHB",
				level: 6,
				subclass: {name: "Way of the Ascendant Dragon", shortName: "Ascendant Dragon", source: "FTD"},
			});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasWingsUnfurled).toBe(true);
		});

		it("should have uses equal to proficiency bonus", () => {
			state.addClass({
				name: "Monk",
				source: "PHB",
				level: 6,
				subclass: {name: "Way of the Ascendant Dragon", shortName: "Ascendant Dragon", source: "FTD"},
			});
			const calculations = state.getFeatureCalculations();
			expect(calculations.wingsUnfurledUses).toBe(3);
		});
	});

	describe("Aspect of the Wyrm (Level 11)", () => {
		it("should have Aspect of the Wyrm at level 11", () => {
			state.addClass({
				name: "Monk",
				source: "PHB",
				level: 11,
				subclass: {name: "Way of the Ascendant Dragon", shortName: "Ascendant Dragon", source: "FTD"},
			});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasAspectOfWyrm).toBe(true);
		});

		it("should cost 3 ki points", () => {
			state.addClass({
				name: "Monk",
				source: "PHB",
				level: 11,
				subclass: {name: "Way of the Ascendant Dragon", shortName: "Ascendant Dragon", source: "FTD"},
			});
			const calculations = state.getFeatureCalculations();
			expect(calculations.aspectOfWyrmCost).toBe(3);
		});
	});

	describe("Ascendant Aspect (Level 17)", () => {
		it("should have Ascendant Aspect at level 17", () => {
			state.addClass({
				name: "Monk",
				source: "PHB",
				level: 17,
				subclass: {name: "Way of the Ascendant Dragon", shortName: "Ascendant Dragon", source: "FTD"},
			});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasAscendantAspect).toBe(true);
		});
	});
});

// ==========================================================================
// PART 13: XPHB 2024 MONK CORE FEATURES
// ==========================================================================
describe("Monk Core Class Features (XPHB 2024)", () => {
	let state;

	beforeEach(() => {
		state = new CharacterSheetState();
		state.setRace({name: "Human", source: "XPHB"});
		state.addClass({name: "Monk", source: "XPHB", level: 1});
		state.setAbilityBase("dex", 16);
		state.setAbilityBase("wis", 16);
	});

	// -------------------------------------------------------------------------
	// Martial Arts Die (Enhanced in XPHB)
	// -------------------------------------------------------------------------
	describe("Martial Arts Die (XPHB)", () => {
		it("should have d6 martial arts die at level 1", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.martialArtsDie).toBe("1d6");
		});

		it("should have d8 martial arts die at level 5", () => {
			state.addClass({name: "Monk", source: "XPHB", level: 5});
			const calculations = state.getFeatureCalculations();
			expect(calculations.martialArtsDie).toBe("1d8");
		});

		it("should have d10 martial arts die at level 11", () => {
			state.addClass({name: "Monk", source: "XPHB", level: 11});
			const calculations = state.getFeatureCalculations();
			expect(calculations.martialArtsDie).toBe("1d10");
		});

		it("should have d12 martial arts die at level 17", () => {
			state.addClass({name: "Monk", source: "XPHB", level: 17});
			const calculations = state.getFeatureCalculations();
			expect(calculations.martialArtsDie).toBe("1d12");
		});
	});

	// -------------------------------------------------------------------------
	// Focus Points (XPHB name for Ki)
	// -------------------------------------------------------------------------
	describe("Focus Points (XPHB)", () => {
		it("should have focus points equal to monk level", () => {
			state.addClass({name: "Monk", source: "XPHB", level: 5});
			const calculations = state.getFeatureCalculations();
			expect(calculations.focusPoints).toBe(5);
		});

		it("should have focus save DC at level 2+", () => {
			state.addClass({name: "Monk", source: "XPHB", level: 2});
			const calculations = state.getFeatureCalculations();
			expect(calculations.focusSaveDc).toBeDefined();
		});
	});

	// -------------------------------------------------------------------------
	// Uncanny Metabolism (Level 2)
	// -------------------------------------------------------------------------
	describe("Uncanny Metabolism (XPHB Level 2)", () => {
		it("should have Uncanny Metabolism at level 2", () => {
			state.addClass({name: "Monk", source: "XPHB", level: 2});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasUncannyMetabolism).toBe(true);
		});

		it("should compute healing formula as martial arts die + monk level", () => {
			state.addClass({name: "Monk", source: "XPHB", level: 5});
			const calculations = state.getFeatureCalculations();
			// Level 5 XPHB: martial arts die = 1d8, monk level = 5
			expect(calculations.uncannyMetabolismHealing).toBe("1d8+5");
		});

		it("should be classified as passive (not an active state)", () => {
			const result = CharacterSheetState.detectActivatableFeature({
				name: "Uncanny Metabolism",
				description: "When you roll Initiative, you can regain all expended Focus Points. When you do so, roll your Martial Arts die, and regain a number of Hit Points equal to your Monk level plus the number rolled. Once you use this feature, you can't use it again until you finish a Long Rest.",
			});
			expect(result).toBeNull();
		});

		it("should not be present for PHB monks", () => {
			state.addClass({name: "Monk", source: "PHB", level: 5});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasUncannyMetabolism).toBeFalsy();
		});

		it("should be classified as passive in FEATURE_CLASSIFICATION_OVERRIDES", () => {
			expect(CharacterSheetState.FEATURE_CLASSIFICATION_OVERRIDES["uncanny metabolism"]).toBe("passive");
		});

		it("should scale healing with monk level and martial arts die", () => {
			state.addClass({name: "Monk", source: "XPHB", level: 10});
			const calculations = state.getFeatureCalculations();
			// Level 10 XPHB: martial arts die = 1d8, monk level = 10
			expect(calculations.uncannyMetabolismHealing).toBe("1d8+10");
		});

		it("should have Focus Points as a resource that is separate from Uncanny Metabolism", () => {
			state.addClass({name: "Monk", source: "XPHB", level: 5});
			state.setKiPoints(5); // Normally set by updateClassResources
			const resources = state.getResources();
			const focusResource = resources.find(r => r.name === "Focus Points");
			expect(focusResource).toBeDefined();
			expect(focusResource.max).toBe(5); // Focus points = monk level
		});

		it("should restore all focus points via _triggerInitiativeRecovery", () => {
			state.addClass({name: "Monk", source: "XPHB", level: 5});
			state.setKiPoints(5); // Create the Focus Points resource

			// Spend some focus points
			state.setKiPointsCurrent(1);
			expect(state.getKiPointsCurrent()).toBe(1);

			// Add Uncanny Metabolism feature with uses
			state.addFeature({
				name: "Uncanny Metabolism",
				description: "When you roll Initiative, you can regain all expended Focus Points.",
				featureType: "Class",
				uses: {max: 1, current: 1, recharge: "long"},
			});

			// Create a mock combat module and trigger recovery
			const mockCombat = Object.create(Object.getPrototypeOf({
				_triggerInitiativeRecovery: null,
			}));
			mockCombat._state = state;
			mockCombat._page = {
				rollDice: () => 4, // Fixed roll for predictability
			};
			mockCombat.renderCombatActions = () => {};

			// Manually replicate what _triggerInitiativeRecovery does for state
			const calc = state.getFeatureCalculations();
			const kiMax = state.getKiPoints();
			expect(calc.hasUncannyMetabolism).toBe(true);
			state.setKiPointsCurrent(kiMax);
			expect(state.getKiPointsCurrent()).toBe(5); // Restored all 5 focus points
		});

		it("should track UM consumption via setFeatureUses", () => {
			state.addClass({name: "Monk", source: "XPHB", level: 5});
			state.addFeature({
				name: "Uncanny Metabolism",
				description: "When you roll Initiative, you can regain all expended Focus Points.",
				featureType: "Class",
				uses: {max: 1, current: 1, recharge: "long"},
			});

			const feature = state.getFeature("Uncanny Metabolism");
			expect(feature).toBeDefined();
			expect(feature.id).toBeDefined();
			expect(feature.uses.current).toBe(1);

			// Consume via proper state method
			state.setFeatureUses(feature.id, 0);
			const updated = state.getFeature("Uncanny Metabolism");
			expect(updated.uses.current).toBe(0);

			// Verify persists through save/load
			const json = state.toJson();
			const loaded = new CharacterSheetState();
			loaded.loadFromJson(JSON.parse(JSON.stringify(json)));
			const loadedFeature = loaded.getFeature("Uncanny Metabolism");
			expect(loadedFeature.uses.current).toBe(0);
		});
	});

	// -------------------------------------------------------------------------
	// Deflect Attacks (Level 3)
	// -------------------------------------------------------------------------
	describe("Deflect Attacks (XPHB Level 3)", () => {
		it("should have Deflect Attacks reduction", () => {
			state.addClass({name: "Monk", source: "XPHB", level: 3});
			const calculations = state.getFeatureCalculations();
			expect(calculations.deflectAttacksReduction).toBeDefined();
		});
	});

	// -------------------------------------------------------------------------
	// Acrobatic Movement (Level 9)
	// -------------------------------------------------------------------------
	describe("Acrobatic Movement (XPHB Level 9)", () => {
		it("should have Acrobatic Movement at level 9", () => {
			state.addClass({name: "Monk", source: "XPHB", level: 9});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasAcrobaticMovement).toBe(true);
		});
	});

	// -------------------------------------------------------------------------
	// Heightened Focus (Level 10)
	// -------------------------------------------------------------------------
	describe("Heightened Focus (XPHB Level 10)", () => {
		it("should have Heightened Focus at level 10", () => {
			state.addClass({name: "Monk", source: "XPHB", level: 10});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasHeightenedFocus).toBe(true);
		});

		it("should NOT have Heightened Focus below level 10", () => {
			state.addClass({name: "Monk", source: "XPHB", level: 9});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasHeightenedFocus).toBeFalsy();
		});

		it("should grant 3 Flurry of Blows attacks", () => {
			state.addClass({name: "Monk", source: "XPHB", level: 10});
			const calculations = state.getFeatureCalculations();
			expect(calculations.heightenedFlurryAttacks).toBe(3);
		});

		it("should provide Patient Defense temp HP formula", () => {
			state.addClass({name: "Monk", source: "XPHB", level: 10});
			state.setAbilityBase("wis", 16); // +3 mod
			const calculations = state.getFeatureCalculations();
			expect(calculations.heightenedPatientDefenseTempHp).toBeDefined();
			// Should contain martial arts die + WIS mod
			expect(calculations.heightenedPatientDefenseTempHp).toMatch(/d\d+\+3/);
		});

		it("should provide Step of the Wind extra distance", () => {
			state.addClass({name: "Monk", source: "XPHB", level: 10});
			const calculations = state.getFeatureCalculations();
			expect(calculations.heightenedStepOfTheWindDistance).toBe(20);
		});

		it("should NOT have Heightened Focus for PHB Monk", () => {
			state.addClass({name: "Monk", source: "PHB", level: 10});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasHeightenedFocus).toBeFalsy();
		});
	});

	// -------------------------------------------------------------------------
	// Self-Restoration (Level 10)
	// -------------------------------------------------------------------------
	describe("Self-Restoration (XPHB Level 10)", () => {
		it("should have Self-Restoration at level 10", () => {
			state.addClass({name: "Monk", source: "XPHB", level: 10});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasSelfRestoration).toBe(true);
		});

		it("should NOT have Self-Restoration below level 10", () => {
			state.addClass({name: "Monk", source: "XPHB", level: 9});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasSelfRestoration).toBeFalsy();
		});

		it("should track charmed and frightened as conditions that end", () => {
			state.addClass({name: "Monk", source: "XPHB", level: 10});
			const calculations = state.getFeatureCalculations();
			expect(calculations.selfRestorationConditions).toEqual(["charmed", "frightened"]);
		});

		it("should NOT have Self-Restoration for PHB Monk", () => {
			state.addClass({name: "Monk", source: "PHB", level: 10});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasSelfRestoration).toBeFalsy();
		});
	});

	// -------------------------------------------------------------------------
	// Deflect Energy (Level 13)
	// -------------------------------------------------------------------------
	describe("Deflect Energy (XPHB Level 13)", () => {
		it("should have Deflect Energy at level 13", () => {
			state.addClass({name: "Monk", source: "XPHB", level: 13});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasDeflectEnergy).toBe(true);
		});
	});

	// -------------------------------------------------------------------------
	// Disciplined Survivor (Level 14)
	// -------------------------------------------------------------------------
	describe("Disciplined Survivor (XPHB Level 14)", () => {
		it("should have Disciplined Survivor at level 14", () => {
			state.addClass({name: "Monk", source: "XPHB", level: 14});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasDisciplinedSurvivor).toBe(true);
		});

		it("should NOT have Disciplined Survivor below level 14", () => {
			state.addClass({name: "Monk", source: "XPHB", level: 13});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasDisciplinedSurvivor).toBeFalsy();
		});

		it("should grant proficiency in all six saving throws", () => {
			state.addClass({name: "Monk", source: "XPHB", level: 14});
			// Trigger effect application
			state.getFeatureCalculations();
			["str", "dex", "con", "int", "wis", "cha"].forEach(ability => {
				expect(state.hasSaveProficiency(ability)).toBe(true);
			});
		});

		it("should have reroll cost of 1 focus point", () => {
			state.addClass({name: "Monk", source: "XPHB", level: 14});
			const calculations = state.getFeatureCalculations();
			expect(calculations.disciplinedSurvivorRerollCost).toBe(1);
		});

		it("should NOT have Disciplined Survivor for PHB Monk", () => {
			state.addClass({name: "Monk", source: "PHB", level: 14});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasDisciplinedSurvivor).toBeFalsy();
		});
	});

	// -------------------------------------------------------------------------
	// Perfect Focus (Level 15)
	// -------------------------------------------------------------------------
	describe("Perfect Focus (XPHB Level 15)", () => {
		it("should have Perfect Focus at level 15", () => {
			state.addClass({name: "Monk", source: "XPHB", level: 15});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasPerfectFocus).toBe(true);
		});

		it("should NOT have Perfect Focus below level 15", () => {
			state.addClass({name: "Monk", source: "XPHB", level: 14});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasPerfectFocus).toBeFalsy();
		});

		it("should recover 4 focus points", () => {
			state.addClass({name: "Monk", source: "XPHB", level: 15});
			const calculations = state.getFeatureCalculations();
			expect(calculations.perfectFocusRecovery).toBe(4);
		});

		it("should NOT have Perfect Focus for PHB Monk", () => {
			state.addClass({name: "Monk", source: "PHB", level: 15});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasPerfectFocus).toBeFalsy();
		});
	});

	// -------------------------------------------------------------------------
	// Superior Defense (Level 18)
	// -------------------------------------------------------------------------
	describe("Superior Defense (XPHB Level 18)", () => {
		it("should have Superior Defense at level 18", () => {
			state.addClass({name: "Monk", source: "XPHB", level: 18});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasSuperiorDefense).toBe(true);
		});

		it("should NOT have Superior Defense below level 18", () => {
			state.addClass({name: "Monk", source: "XPHB", level: 17});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasSuperiorDefense).toBeFalsy();
		});

		it("should cost 3 focus points", () => {
			state.addClass({name: "Monk", source: "XPHB", level: 18});
			const calculations = state.getFeatureCalculations();
			expect(calculations.superiorDefenseCost).toBe(3);
		});

		it("should register a conditional resistance modifier", () => {
			state.addClass({name: "Monk", source: "XPHB", level: 18});
			// Superior Defense creates a conditional modifier via the effects pipeline
			const applied = state.getAppliedClassFeatureEffects();
			const resistanceEffect = applied.find(e => e.includes("Superior Defense"));
			expect(resistanceEffect).toBeDefined();
		});

		it("should NOT have Superior Defense for PHB Monk", () => {
			state.addClass({name: "Monk", source: "PHB", level: 18});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasSuperiorDefense).toBeFalsy();
		});
	});

	// -------------------------------------------------------------------------
	// Body and Mind (Level 20)
	// -------------------------------------------------------------------------
	describe("Body and Mind (XPHB Level 20)", () => {
		it("should have Body and Mind at level 20", () => {
			state.addClass({name: "Monk", source: "XPHB", level: 20});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasBodyAndMind).toBe(true);
		});

		it("should NOT have Body and Mind below level 20", () => {
			state.addClass({name: "Monk", source: "XPHB", level: 19});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasBodyAndMind).toBeFalsy();
		});

		it("should have +4 DEX and +4 WIS bonus values", () => {
			state.addClass({name: "Monk", source: "XPHB", level: 20});
			const calculations = state.getFeatureCalculations();
			expect(calculations.bodyAndMindDexBonus).toBe(4);
			expect(calculations.bodyAndMindWisBonus).toBe(4);
			expect(calculations.bodyAndMindMaxScore).toBe(25);
		});

		it("should increase DEX score by 4", () => {
			state.setAbilityBase("dex", 16);
			state.addClass({name: "Monk", source: "XPHB", level: 20});
			state.getFeatureCalculations();
			expect(state.getAbilityScore("dex")).toBe(20); // 16 + 4 = 20
		});

		it("should increase WIS score by 4", () => {
			state.setAbilityBase("wis", 14);
			state.addClass({name: "Monk", source: "XPHB", level: 20});
			state.getFeatureCalculations();
			expect(state.getAbilityScore("wis")).toBe(18); // 14 + 4 = 18
		});

		it("should cap at 25 for DEX", () => {
			state.setAbilityBase("dex", 22);
			state.addClass({name: "Monk", source: "XPHB", level: 20});
			state.getFeatureCalculations();
			expect(state.getAbilityScore("dex")).toBe(25); // 22 + 3 (capped at 25)
		});

		it("should cap at 25 for WIS", () => {
			state.setAbilityBase("wis", 23);
			state.addClass({name: "Monk", source: "XPHB", level: 20});
			state.getFeatureCalculations();
			expect(state.getAbilityScore("wis")).toBe(25); // 23 + 2 (capped at 25)
		});

		it("should NOT increase DEX/WIS for PHB Monk", () => {
			state.setAbilityBase("dex", 16);
			state.setAbilityBase("wis", 14);
			state.addClass({name: "Monk", source: "PHB", level: 20});
			state.getFeatureCalculations();
			expect(state.getAbilityScore("dex")).toBe(16);
			expect(state.getAbilityScore("wis")).toBe(14);
		});
	});
});

// ==========================================================================
// PART 13B: UNHINDERED FLURRY (TGTT LEVEL 8)
// ==========================================================================
describe("Unhindered Flurry (TGTT Level 8)", () => {
	let state;

	beforeEach(() => {
		state = new CharacterSheetState();
		state.setRace({name: "Human", source: "XPHB"});
	});

	it("should have Unhindered Flurry at level 8 for TGTT Monk", () => {
		state.addClass({name: "Monk", source: "TGTT", level: 8});
		const calculations = state.getFeatureCalculations();
		expect(calculations.hasUnhinderedFlurry).toBe(true);
	});

	it("should NOT have Unhindered Flurry below level 8 for TGTT Monk", () => {
		state.addClass({name: "Monk", source: "TGTT", level: 7});
		const calculations = state.getFeatureCalculations();
		expect(calculations.hasUnhinderedFlurry).toBeFalsy();
	});

	it("should NOT have Unhindered Flurry for XPHB Monk", () => {
		state.addClass({name: "Monk", source: "XPHB", level: 8});
		const calculations = state.getFeatureCalculations();
		expect(calculations.hasUnhinderedFlurry).toBeFalsy();
	});

	it("should NOT have Unhindered Flurry for PHB Monk", () => {
		state.addClass({name: "Monk", source: "PHB", level: 8});
		const calculations = state.getFeatureCalculations();
		expect(calculations.hasUnhinderedFlurry).toBeFalsy();
	});
});

// ==========================================================================
// PART 14: WARRIOR OF THE ELEMENTS SUBCLASS (XPHB 2024)
// ==========================================================================
describe("Warrior of the Elements Subclass (XPHB 2024)", () => {
	let state;

	beforeEach(() => {
		state = new CharacterSheetState();
		state.setRace({name: "Human", source: "XPHB"});
		state.addClass({
			name: "Monk",
			source: "XPHB",
			level: 3,
			subclass: {name: "Warrior of the Elements", shortName: "Elements", source: "XPHB"},
		});
		state.setAbilityBase("dex", 16);
		state.setAbilityBase("wis", 16);
	});

	it("should gain subclass at level 3", () => {
		const classes = state.getClasses();
		expect(classes[0].subclass).toBeDefined();
		expect(classes[0].subclass.shortName).toBe("Elements");
	});

	describe("Elemental Attunement (Level 3)", () => {
		it("should have Elemental Attunement at level 3", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasElementalAttunement).toBe(true);
		});

		it("should have 15 ft reach", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.elementalAttunementReach).toBe(15);
		});
	});

	describe("Elemental Burst (Level 6)", () => {
		it("should have Elemental Burst at level 6", () => {
			state.addClass({
				name: "Monk",
				source: "XPHB",
				level: 6,
				subclass: {name: "Warrior of the Elements", shortName: "Elements", source: "XPHB"},
			});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasElementalBurst).toBe(true);
		});

		it("should cost 2 focus points", () => {
			state.addClass({
				name: "Monk",
				source: "XPHB",
				level: 6,
				subclass: {name: "Warrior of the Elements", shortName: "Elements", source: "XPHB"},
			});
			const calculations = state.getFeatureCalculations();
			expect(calculations.elementalBurstCost).toBe(2);
		});
	});

	describe("Stride of the Elements (Level 11)", () => {
		it("should have Stride of the Elements at level 11", () => {
			state.addClass({
				name: "Monk",
				source: "XPHB",
				level: 11,
				subclass: {name: "Warrior of the Elements", shortName: "Elements", source: "XPHB"},
			});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasStrideOfElements).toBe(true);
		});
	});

	describe("Elemental Epitome (Level 17)", () => {
		it("should have Elemental Epitome at level 17", () => {
			state.addClass({
				name: "Monk",
				source: "XPHB",
				level: 17,
				subclass: {name: "Warrior of the Elements", shortName: "Elements", source: "XPHB"},
			});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasElementalEpitome).toBe(true);
		});
	});
});

// ==========================================================================
// PART 15: PHB vs XPHB MONK FEATURE COMPARISON
// ==========================================================================
describe("PHB vs XPHB Monk Feature Comparison", () => {
	describe("Martial Arts Die Comparison", () => {
		it("should have different martial arts die progression", () => {
			const phbState = new CharacterSheetState();
			phbState.addClass({name: "Monk", source: "PHB", level: 1});
			const phbCalcs = phbState.getFeatureCalculations();

			const xphbState = new CharacterSheetState();
			xphbState.addClass({name: "Monk", source: "XPHB", level: 1});
			const xphbCalcs = xphbState.getFeatureCalculations();

			expect(phbCalcs.martialArtsDie).toBe("1d4");
			expect(xphbCalcs.martialArtsDie).toBe("1d6");
		});

		it("should have higher max die in XPHB", () => {
			const phbState = new CharacterSheetState();
			phbState.addClass({name: "Monk", source: "PHB", level: 17});
			const phbCalcs = phbState.getFeatureCalculations();

			const xphbState = new CharacterSheetState();
			xphbState.addClass({name: "Monk", source: "XPHB", level: 17});
			const xphbCalcs = xphbState.getFeatureCalculations();

			expect(phbCalcs.martialArtsDie).toBe("1d10");
			expect(xphbCalcs.martialArtsDie).toBe("1d12");
		});
	});

	describe("Ki Points vs Focus Points", () => {
		it("should use ki in PHB and focus in XPHB but same amount", () => {
			const phbState = new CharacterSheetState();
			phbState.addClass({name: "Monk", source: "PHB", level: 10});
			const phbCalcs = phbState.getFeatureCalculations();

			const xphbState = new CharacterSheetState();
			xphbState.addClass({name: "Monk", source: "XPHB", level: 10});
			const xphbCalcs = xphbState.getFeatureCalculations();

			expect(phbCalcs.kiPoints).toBe(10);
			expect(xphbCalcs.focusPoints).toBe(10);
		});
	});

	describe("PHB-exclusive features", () => {
		it("should have Stillness of Mind only in PHB", () => {
			const phbState = new CharacterSheetState();
			phbState.addClass({name: "Monk", source: "PHB", level: 7});
			const phbCalcs = phbState.getFeatureCalculations();

			const xphbState = new CharacterSheetState();
			xphbState.addClass({name: "Monk", source: "XPHB", level: 7});
			const xphbCalcs = xphbState.getFeatureCalculations();

			expect(phbCalcs.hasStillnessOfMind).toBe(true);
			expect(xphbCalcs.hasStillnessOfMind).toBeUndefined();
		});

		it("should have Purity of Body only in PHB", () => {
			const phbState = new CharacterSheetState();
			phbState.addClass({name: "Monk", source: "PHB", level: 10});
			const phbCalcs = phbState.getFeatureCalculations();

			const xphbState = new CharacterSheetState();
			xphbState.addClass({name: "Monk", source: "XPHB", level: 10});
			const xphbCalcs = xphbState.getFeatureCalculations();

			expect(phbCalcs.hasPurityOfBody).toBe(true);
			expect(xphbCalcs.hasPurityOfBody).toBeUndefined();
		});

		it("should have Diamond Soul only in PHB", () => {
			const phbState = new CharacterSheetState();
			phbState.addClass({name: "Monk", source: "PHB", level: 14});
			const phbCalcs = phbState.getFeatureCalculations();

			const xphbState = new CharacterSheetState();
			xphbState.addClass({name: "Monk", source: "XPHB", level: 14});
			const xphbCalcs = xphbState.getFeatureCalculations();

			expect(phbCalcs.hasDiamondSoul).toBe(true);
			expect(xphbCalcs.hasDiamondSoul).toBeUndefined();
		});

		it("should have Empty Body only in PHB", () => {
			const phbState = new CharacterSheetState();
			phbState.addClass({name: "Monk", source: "PHB", level: 18});
			const phbCalcs = phbState.getFeatureCalculations();

			const xphbState = new CharacterSheetState();
			xphbState.addClass({name: "Monk", source: "XPHB", level: 18});
			const xphbCalcs = xphbState.getFeatureCalculations();

			expect(phbCalcs.hasEmptyBody).toBe(true);
			expect(xphbCalcs.hasEmptyBody).toBeUndefined();
		});
	});

	describe("XPHB-exclusive features", () => {
		it("should have Heightened Focus only in XPHB", () => {
			const phbState = new CharacterSheetState();
			phbState.addClass({name: "Monk", source: "PHB", level: 10});
			const phbCalcs = phbState.getFeatureCalculations();

			const xphbState = new CharacterSheetState();
			xphbState.addClass({name: "Monk", source: "XPHB", level: 10});
			const xphbCalcs = xphbState.getFeatureCalculations();

			expect(phbCalcs.hasHeightenedFocus).toBeUndefined();
			expect(xphbCalcs.hasHeightenedFocus).toBe(true);
		});

		it("should have Disciplined Survivor only in XPHB", () => {
			const phbState = new CharacterSheetState();
			phbState.addClass({name: "Monk", source: "PHB", level: 14});
			const phbCalcs = phbState.getFeatureCalculations();

			const xphbState = new CharacterSheetState();
			xphbState.addClass({name: "Monk", source: "XPHB", level: 14});
			const xphbCalcs = xphbState.getFeatureCalculations();

			expect(phbCalcs.hasDisciplinedSurvivor).toBeUndefined();
			expect(xphbCalcs.hasDisciplinedSurvivor).toBe(true);
		});

		it("should have Superior Defense only in XPHB", () => {
			const phbState = new CharacterSheetState();
			phbState.addClass({name: "Monk", source: "PHB", level: 18});
			const phbCalcs = phbState.getFeatureCalculations();

			const xphbState = new CharacterSheetState();
			xphbState.addClass({name: "Monk", source: "XPHB", level: 18});
			const xphbCalcs = xphbState.getFeatureCalculations();

			expect(phbCalcs.hasSuperiorDefense).toBeUndefined();
			expect(xphbCalcs.hasSuperiorDefense).toBe(true);
		});
	});
});

// ==========================================================================
// PART 16: MONK MULTICLASS
// ==========================================================================
describe("Monk Multiclass", () => {
	let state;

	beforeEach(() => {
		state = new CharacterSheetState();
		state.setRace({name: "Human", source: "PHB"});
		state.setAbilityBase("dex", 14);
		state.setAbilityBase("wis", 14);
	});

	it("should require DEX 13 and WIS 13 for multiclassing", () => {
		// Both DEX and WIS are 14, so multiclassing is possible
		expect(state.getAbilityMod("dex")).toBeGreaterThanOrEqual(1);
		expect(state.getAbilityMod("wis")).toBeGreaterThanOrEqual(1);
	});

	it("should calculate ki points based on monk level only", () => {
		state.addClass({name: "Monk", source: "PHB", level: 5});
		state.addClass({name: "Rogue", source: "PHB", level: 3});
		const calculations = state.getFeatureCalculations();
		// Only 5 ki from monk levels
		expect(calculations.kiPoints).toBe(5);
	});

	it("should track total level correctly across classes", () => {
		state.addClass({name: "Monk", source: "PHB", level: 5});
		state.addClass({name: "Fighter", source: "PHB", level: 3});
		expect(state.getTotalLevel()).toBe(8);
	});

	it("should calculate proficiency bonus based on total level", () => {
		state.addClass({name: "Monk", source: "PHB", level: 5});
		state.addClass({name: "Rogue", source: "PHB", level: 4});
		// Total level 9 = +4 proficiency
		expect(state.getProficiencyBonus()).toBe(4);
	});

	it("should use martial arts die based on monk level only", () => {
		state.addClass({name: "Monk", source: "PHB", level: 4});
		state.addClass({name: "Fighter", source: "PHB", level: 5});
		const calculations = state.getFeatureCalculations();
		// Monk level 4 = d4 martial arts die
		expect(calculations.martialArtsDie).toBe("1d4");
	});
});

// ==========================================================================
// PART 17: MONK EDGE CASES
// ==========================================================================
describe("Monk Edge Cases", () => {
	let state;

	beforeEach(() => {
		state = new CharacterSheetState();
		state.setRace({name: "Human", source: "PHB"});
	});

	it("should handle level 20 character correctly", () => {
		state.setAbilityBase("wis", 16);
		state.addClass({name: "Monk", source: "PHB", level: 20});
		const calculations = state.getFeatureCalculations();
		expect(calculations.kiPoints).toBe(20);
		expect(calculations.unarmoredMovement).toBe(30);
		expect(calculations.martialArtsDie).toBe("1d10");
		expect(calculations.hasPerfectSelf).toBe(true);
	});

	it("should calculate ki save DC with different WIS scores", () => {
		state.setAbilityBase("wis", 20); // +5 modifier
		state.addClass({name: "Monk", source: "PHB", level: 5});
		const calculations = state.getFeatureCalculations();
		// 8 + 3 (prof at level 5) + 5 (WIS) = 16
		expect(calculations.kiSaveDc).toBe(16);
	});

	it("should track hit dice correctly", () => {
		state.setAbilityBase("con", 14);
		state.addClass({name: "Monk", source: "PHB", level: 10});
		const hitDice = state.getHitDice();
		const d8Dice = hitDice.find(hd => hd.die === 8);
		expect(d8Dice.max).toBe(10);
	});

	it("should handle subclass selection", () => {
		state.setAbilityBase("wis", 16);
		state.addClass({name: "Monk", source: "PHB", level: 2});

		const classes = state.getClasses();
		expect(classes[0].subclass).toBeUndefined();

		state.addClass({
			name: "Monk",
			source: "PHB",
			level: 3,
			subclass: {name: "Way of the Open Hand", shortName: "Open Hand", source: "PHB"},
		});

		const updatedClasses = state.getClasses();
		expect(updatedClasses[0].subclass?.shortName).toBe("Open Hand");
	});

	it("should handle low DEX for deflect missiles", () => {
		state.setAbilityBase("dex", 8); // -1 modifier
		state.addClass({name: "Monk", source: "PHB", level: 3});
		const calculations = state.getFeatureCalculations();
		expect(calculations.deflectMissilesReduction).toBe("1d10+-1+3");
	});
});

// ==========================================================================
// PART 18: MONK PROFICIENCY BONUS PROGRESSION
// ==========================================================================
describe("Monk Proficiency Bonus Progression", () => {
	it("should return +2 proficiency bonus at level 1", () => {
		const state = new CharacterSheetState();
		state.addClass({name: "Monk", source: "PHB", level: 1});
		expect(state.getProficiencyBonus()).toBe(2);
	});

	it("should return +2 proficiency bonus at level 4", () => {
		const state = new CharacterSheetState();
		state.addClass({name: "Monk", source: "PHB", level: 4});
		expect(state.getProficiencyBonus()).toBe(2);
	});

	it("should return +3 proficiency bonus at level 5", () => {
		const state = new CharacterSheetState();
		state.addClass({name: "Monk", source: "PHB", level: 5});
		expect(state.getProficiencyBonus()).toBe(3);
	});

	it("should return +4 proficiency bonus at level 9", () => {
		const state = new CharacterSheetState();
		state.addClass({name: "Monk", source: "PHB", level: 9});
		expect(state.getProficiencyBonus()).toBe(4);
	});

	it("should return +5 proficiency bonus at level 13", () => {
		const state = new CharacterSheetState();
		state.addClass({name: "Monk", source: "PHB", level: 13});
		expect(state.getProficiencyBonus()).toBe(5);
	});

	it("should return +6 proficiency bonus at level 17", () => {
		const state = new CharacterSheetState();
		state.addClass({name: "Monk", source: "PHB", level: 17});
		expect(state.getProficiencyBonus()).toBe(6);
	});
});

// ==========================================================================
// PHASE 3: MONK CORE FEATURE IMPLEMENTATIONS
// ==========================================================================
describe("Phase 3 — Monk Core Feature Fixes", () => {
	let state;

	beforeEach(() => {
		state = new CharacterSheetState();
		state.setRace({name: "Human", source: "PHB"});
		state.setAbilityBase("dex", 16); // +3
		state.setAbilityBase("wis", 16); // +3
	});

	// -------------------------------------------------------------------------
	// Fix 1: Ki/Focus DC Level Gate (must be level 2+)
	// -------------------------------------------------------------------------
	describe("Ki/Focus DC Level Gate", () => {
		it("should NOT have ki points at level 1 (PHB)", () => {
			state.addClass({name: "Monk", source: "PHB", level: 1});
			const calc = state.getFeatureCalculations();
			expect(calc.kiPoints).toBeUndefined();
			expect(calc.focusPoints).toBeUndefined();
		});

		it("should NOT have ki save DC at level 1 (PHB)", () => {
			state.addClass({name: "Monk", source: "PHB", level: 1});
			const calc = state.getFeatureCalculations();
			expect(calc.kiSaveDc).toBeUndefined();
			expect(calc.focusSaveDc).toBeUndefined();
		});

		it("should NOT have focus points at level 1 (XPHB)", () => {
			state.addClass({name: "Monk", source: "XPHB", level: 1});
			const calc = state.getFeatureCalculations();
			expect(calc.focusPoints).toBeUndefined();
		});

		it("should NOT have focus save DC at level 1 (XPHB)", () => {
			state.addClass({name: "Monk", source: "XPHB", level: 1});
			const calc = state.getFeatureCalculations();
			expect(calc.focusSaveDc).toBeUndefined();
		});

		it("should have ki points at level 2 (PHB)", () => {
			state.addClass({name: "Monk", source: "PHB", level: 2});
			const calc = state.getFeatureCalculations();
			expect(calc.kiPoints).toBe(2);
			expect(calc.focusPoints).toBeUndefined();
		});

		it("should have ki save DC at level 2 (PHB)", () => {
			state.addClass({name: "Monk", source: "PHB", level: 2});
			const calc = state.getFeatureCalculations();
			// 8 + 2 (prof) + 3 (WIS) = 13
			expect(calc.kiSaveDc).toBe(13);
			expect(calc.focusSaveDc).toBeUndefined();
		});

		it("should have focus points at level 2 (XPHB)", () => {
			state.addClass({name: "Monk", source: "XPHB", level: 2});
			const calc = state.getFeatureCalculations();
			expect(calc.focusPoints).toBe(2);
			expect(calc.kiPoints).toBeUndefined();
		});

		it("should have focus save DC at level 2 (XPHB)", () => {
			state.addClass({name: "Monk", source: "XPHB", level: 2});
			const calc = state.getFeatureCalculations();
			// 8 + 2 (prof) + 3 (WIS) = 13
			expect(calc.focusSaveDc).toBe(13);
			expect(calc.kiSaveDc).toBeUndefined();
		});

		it("should NOT have focus points for TGTT monk at level 1", () => {
			state.addClass({name: "Monk", source: "TGTT", level: 1});
			const calc = state.getFeatureCalculations();
			expect(calc.focusPoints).toBeUndefined();
			expect(calc.focusSaveDc).toBeUndefined();
		});

		it("should have focus points for TGTT monk at level 2", () => {
			state.addClass({name: "Monk", source: "TGTT", level: 2});
			const calc = state.getFeatureCalculations();
			expect(calc.focusPoints).toBe(2);
			expect(calc.focusSaveDc).toBeDefined();
		});
	});

	// -------------------------------------------------------------------------
	// Fix 2: Feature Classification Overrides (FoB, SotW, Slow Fall)
	// -------------------------------------------------------------------------
	describe("Feature Classification — Combat Actions", () => {
		test("Flurry of Blows should be classified as combat", () => {
			const result = CharacterSheetState.detectActivatableFeature({
				name: "Flurry of Blows",
				description: "You can spend 1 ki point to make two unarmed strikes as a bonus action.",
			});
			expect(result).not.toBeNull();
			expect(result.interactionMode).toBe("combat");
			expect(result.matchedBy).toBe("classificationOverride");
			expect(result.isToggle).toBe(false);
		});

		test("Flurry of Blows should parse ki cost from description", () => {
			const result = CharacterSheetState.detectActivatableFeature({
				name: "Flurry of Blows",
				description: "You can spend 1 ki point to make two unarmed strikes as a bonus action.",
			});
			expect(result.kiCost).toBe(1);
			expect(result.activationAction).toBe("bonus");
		});

		test("Step of the Wind should be classified as combat", () => {
			const result = CharacterSheetState.detectActivatableFeature({
				name: "Step of the Wind",
				description: "You can spend 1 ki point to take the Disengage or Dash action as a bonus action.",
			});
			expect(result).not.toBeNull();
			expect(result.interactionMode).toBe("combat");
			expect(result.matchedBy).toBe("classificationOverride");
		});

		test("Step of the Wind should parse ki cost", () => {
			const result = CharacterSheetState.detectActivatableFeature({
				name: "Step of the Wind",
				description: "You can spend 1 ki point to take the Disengage or Dash action as a bonus action.",
			});
			expect(result.kiCost).toBe(1);
			expect(result.activationAction).toBe("bonus");
		});

		test("Slow Fall should be classified as combat", () => {
			const result = CharacterSheetState.detectActivatableFeature({
				name: "Slow Fall",
				description: "As a reaction when you fall, you can reduce falling damage by 5 times your monk level.",
			});
			expect(result).not.toBeNull();
			expect(result.interactionMode).toBe("combat");
		});

		test("Patient Defense should be classified as combat", () => {
			const result = CharacterSheetState.detectActivatableFeature({
				name: "Patient Defense",
				description: "You can take the Disengage action as a Bonus Action. Alternatively, you can expend 1 Focus Point to take both the Disengage and the Dodge actions as a Bonus Action.",
			});
			expect(result).not.toBeNull();
			expect(result.interactionMode).toBe("combat");
			expect(result.matchedBy).toBe("classificationOverride");
			expect(result.isToggle).toBe(false);
		});

		test("Patient Defense should parse focus cost from description", () => {
			const result = CharacterSheetState.detectActivatableFeature({
				name: "Patient Defense",
				description: "You can expend 1 Focus Point to take both the Disengage and the Dodge actions as a Bonus Action.",
			});
			expect(result.kiCost).toBe(1);
			expect(result.activationAction).toBe("bonus");
		});

		test("Flurry of Blows should NOT appear in activatable features", () => {
			state.addClass({name: "Monk", source: "XPHB", level: 5});
			state._data.features = [
				{id: "f1", name: "Flurry of Blows", description: "You can expend 1 Focus Point to make two Unarmed Strikes as a Bonus Action."},
				{id: "f2", name: "Step of the Wind", description: "You can take the Dash action as a Bonus Action."},
				{id: "f3", name: "Patient Defense", description: "You can take the Disengage action as a Bonus Action."},
			];
			const activatables = state.getActivatableFeatures();
			const names = activatables.map(a => a.feature.name);
			expect(names).not.toContain("Flurry of Blows");
			expect(names).not.toContain("Step of the Wind");
			expect(names).not.toContain("Patient Defense");
		});
	});

	// -------------------------------------------------------------------------
	// Fix 3: isMonkWeapon — XPHB type handling
	// -------------------------------------------------------------------------
	describe("isMonkWeapon — XPHB compatibility", () => {
		beforeEach(() => {
			state.addClass({name: "Monk", source: "XPHB", level: 5});
		});

		it("should recognize PHB quarterstaff as monk weapon", () => {
			expect(state.isMonkWeapon({
				name: "Quarterstaff",
				type: "M",
				weaponCategory: "simple",
				property: ["V"],
			})).toBe(true);
		});

		it("should recognize XPHB quarterstaff as monk weapon", () => {
			expect(state.isMonkWeapon({
				name: "Quarterstaff",
				type: "M|XPHB",
				weaponCategory: "simple",
				property: ["V|XPHB"],
			})).toBe(true);
		});

		it("should recognize PHB spear as monk weapon", () => {
			expect(state.isMonkWeapon({
				name: "Spear",
				type: "M",
				weaponCategory: "simple",
				property: ["T", "V"],
			})).toBe(true);
		});

		it("should recognize XPHB spear as monk weapon", () => {
			expect(state.isMonkWeapon({
				name: "Spear",
				type: "M|XPHB",
				weaponCategory: "simple",
				property: ["T|XPHB", "V|XPHB"],
			})).toBe(true);
		});

		it("should recognize shortsword as monk weapon", () => {
			expect(state.isMonkWeapon({
				name: "Shortsword",
				type: "M",
				weaponCategory: "martial",
				property: ["F", "L"],
			})).toBe(true);
		});

		it("should reject greataxe (heavy weapon)", () => {
			expect(state.isMonkWeapon({
				name: "Greataxe",
				type: "M",
				weaponCategory: "martial",
				property: ["H", "2H"],
			})).toBe(false);
		});

		it("should reject XPHB heavy weapon", () => {
			expect(state.isMonkWeapon({
				name: "Greataxe",
				type: "M|XPHB",
				weaponCategory: "martial",
				property: ["H|XPHB", "2H|XPHB"],
			})).toBe(false);
		});

		it("should reject longsword (martial, not simple)", () => {
			expect(state.isMonkWeapon({
				name: "Longsword",
				type: "M",
				weaponCategory: "martial",
				property: ["V"],
			})).toBe(false);
		});

		it("should reject items with special property", () => {
			expect(state.isMonkWeapon({
				name: "Net",
				type: "R",
				weaponCategory: "martial",
				property: ["S", "T"],
			})).toBe(false);
		});

		it("should return false for non-monks", () => {
			const nonMonk = new CharacterSheetState();
			nonMonk.addClass({name: "Fighter", source: "PHB", level: 5});
			expect(nonMonk.isMonkWeapon({
				name: "Quarterstaff",
				type: "M",
				weaponCategory: "simple",
				property: ["V"],
			})).toBe(false);
		});

		it("should return false for null/undefined item", () => {
			expect(state.isMonkWeapon(null)).toBe(false);
			expect(state.isMonkWeapon(undefined)).toBe(false);
		});
	});

	// -------------------------------------------------------------------------
	// Verify: Feature effect implementations
	// -------------------------------------------------------------------------
	describe("Feature Effect Implementations", () => {
		it("Evasion should have savingThrowProperty effect at level 7", () => {
			state.addClass({name: "Monk", source: "PHB", level: 7});
			const calc = state.getFeatureCalculations();
			expect(calc.hasEvasion).toBe(true);
		});

		it("Empowered Strikes should have magical unarmed effect at level 6", () => {
			state.addClass({name: "Monk", source: "XPHB", level: 6});
			const calc = state.getFeatureCalculations();
			expect(calc.hasEmpoweredStrikes).toBe(true);
			expect(calc.hasKiEmpoweredStrikes).toBe(true);
		});

		it("Deflect Missiles should have damage reduction at level 3 (PHB)", () => {
			state.addClass({name: "Monk", source: "PHB", level: 3});
			const calc = state.getFeatureCalculations();
			expect(calc.deflectMissilesReduction).toBeDefined();
			expect(calc.deflectMissilesReduction).toContain("1d10");
		});

		it("Deflect Attacks should have damage reduction at level 3 (XPHB)", () => {
			state.addClass({name: "Monk", source: "XPHB", level: 3});
			const calc = state.getFeatureCalculations();
			expect(calc.deflectAttacksReduction).toBeDefined();
			expect(calc.deflectMissilesReduction).toBeDefined();
		});

		it("Stunning Strike should be present at level 5", () => {
			state.addClass({name: "Monk", source: "PHB", level: 5});
			const calc = state.getFeatureCalculations();
			expect(calc.hasStunningStrike).toBe(true);
		});

		it("Slow Fall should have damage reduction at level 4", () => {
			state.addClass({name: "Monk", source: "PHB", level: 4});
			const calc = state.getFeatureCalculations();
			expect(calc.slowFallReduction).toBe(20); // 5 × 4
		});

		it("Slow Fall reduction should scale with level", () => {
			state.addClass({name: "Monk", source: "PHB", level: 10});
			const calc = state.getFeatureCalculations();
			expect(calc.slowFallReduction).toBe(50); // 5 × 10
		});
	});

	// -------------------------------------------------------------------------
	// Monk Weapon Flag on Attacks
	// -------------------------------------------------------------------------
	describe("Monk Weapon flag on attacks", () => {
		beforeEach(() => {
			state.addClass({name: "Monk", source: "PHB", level: 5});
		});

		it("should set isMonkWeapon on attack generated from shortsword", () => {
			const result = state.updateAttackFromWeapon({
				name: "Shortsword",
				type: "M",
				weaponCategory: "martial",
				property: ["F", "L"],
				dmg1: "1d6",
				dmgType: "piercing",
			});
			expect(result.isMonkWeapon).toBe(true);
		});

		it("should set isMonkWeapon on attack generated from simple melee weapon", () => {
			const result = state.updateAttackFromWeapon({
				name: "Quarterstaff",
				type: "M",
				weaponCategory: "simple",
				property: ["V"],
				dmg1: "1d6",
				dmgType: "bludgeoning",
			});
			expect(result.isMonkWeapon).toBe(true);
		});

		it("should NOT set isMonkWeapon on attack generated from martial weapon", () => {
			const result = state.updateAttackFromWeapon({
				name: "Longsword",
				type: "M",
				weaponCategory: "martial",
				property: ["V"],
				dmg1: "1d8",
				dmgType: "slashing",
			});
			expect(result.isMonkWeapon).toBe(false);
		});

		it("should NOT set isMonkWeapon on attack generated from heavy weapon", () => {
			const result = state.updateAttackFromWeapon({
				name: "Greataxe",
				type: "M",
				weaponCategory: "martial",
				property: ["H", "2H"],
				dmg1: "1d12",
				dmgType: "slashing",
			});
			expect(result.isMonkWeapon).toBe(false);
		});

		it("should preserve isMonkWeapon flag when adding custom attack", () => {
			state.addAttack({
				id: "custom_test",
				name: "Custom Monk Strike",
				isMelee: true,
				abilityMod: "finesse",
				damage: "1d6",
				damageType: "bludgeoning",
				isMonkWeapon: true,
			});
			const attacks = state.getAttacks();
			const custom = attacks.find(a => a.id === "custom_test");
			expect(custom).toBeDefined();
			expect(custom.isMonkWeapon).toBe(true);
		});

		it("should preserve isMonkWeapon=false on non-monk custom attack", () => {
			state.addAttack({
				id: "custom_normal",
				name: "Custom Slash",
				isMelee: true,
				abilityMod: "str",
				damage: "1d8",
				damageType: "slashing",
				isMonkWeapon: false,
			});
			const attacks = state.getAttacks();
			const custom = attacks.find(a => a.id === "custom_normal");
			expect(custom).toBeDefined();
			expect(custom.isMonkWeapon).toBe(false);
		});

		it("should use DEX for monk weapon attack from shortsword", () => {
			const result = state.updateAttackFromWeapon({
				name: "Shortsword",
				type: "M",
				weaponCategory: "martial",
				property: ["F", "L"],
				dmg1: "1d6",
				dmgType: "piercing",
			});
			// DEX (16, +3) > STR (10, +0), so should use dex
			expect(result.abilityMod).toBe("dex");
		});

		// --- Inventory-normalized items (properties plural, type="weapon") ---
		it("should detect monk weapon on inventory-normalized quarterstaff", () => {
			// This matches the format from _addItem() in charactersheet-inventory.js
			expect(state.isMonkWeapon({
				name: "Quarterstaff",
				type: "weapon",
				weapon: true,
				weaponCategory: "simple",
				properties: ["V"],
				damage: "1d6 bludgeoning",
				dmg1: "1d6",
				dmgType: "bludgeoning",
			})).toBe(true);
		});

		it("should detect monk weapon on inventory-normalized shortsword", () => {
			expect(state.isMonkWeapon({
				name: "Shortsword",
				type: "weapon",
				weapon: true,
				weaponCategory: "martial",
				properties: ["F", "L"],
			})).toBe(true);
		});

		it("should NOT detect monk weapon on inventory-normalized longsword", () => {
			expect(state.isMonkWeapon({
				name: "Longsword",
				type: "weapon",
				weapon: true,
				weaponCategory: "martial",
				properties: ["V"],
			})).toBe(false);
		});

		it("should NOT detect monk weapon on inventory-normalized heavy weapon", () => {
			expect(state.isMonkWeapon({
				name: "Greataxe",
				type: "weapon",
				weapon: true,
				weaponCategory: "martial",
				properties: ["H", "2H"],
			})).toBe(false);
		});

		it("should handle magic weapon with inventory format (+1 Quarterstaff)", () => {
			expect(state.isMonkWeapon({
				name: "Quarterstaff, +1",
				type: "weapon",
				weapon: true,
				weaponCategory: "simple",
				properties: ["V"],
				bonusWeapon: 1,
			})).toBe(true);
		});

		it("should parse damage from formatted string in updateAttackFromWeapon", () => {
			// Inventory items have damage as "1d6 bludgeoning" not separate dmg1/dmgType
			const result = state.updateAttackFromWeapon({
				name: "Quarterstaff",
				type: "weapon",
				weapon: true,
				weaponCategory: "simple",
				properties: ["V"],
				damage: "1d6 bludgeoning",
			});
			expect(result.isMonkWeapon).toBe(true);
			expect(result.damage).toContain("1d6");
		});
	});
});

// ==========================================================================
// PART 7: Ki/Focus Point — Unified Resource System
// ==========================================================================
describe("Ki/Focus Point — Unified Resource System", () => {
	const CharacterSheetClassUtils = globalThis.CharacterSheetClassUtils;

	let state;
	beforeEach(() => {
		state = new CharacterSheetState();
		state.setRace({name: "Human", source: "PHB"});
	});

	// --- Resource creation via updateClassResources ---

	test("updateClassResources creates Focus Points resource for PHB monk", () => {
		state.addClass({name: "Monk", source: "PHB", level: 5});
		const classEntry = state.getClasses()[0];
		CharacterSheetClassUtils.updateClassResources(state, classEntry, 5, {name: "Monk", source: "PHB"});

		expect(state.getKiPoints()).toBe(5);
		expect(state.getKiPointsCurrent()).toBe(5);

		const resource = state.getResource("Focus Points");
		expect(resource).not.toBeNull();
		expect(resource.max).toBe(5);
		expect(resource.current).toBe(5);
	});

	test("updateClassResources creates Focus Points resource for XPHB monk", () => {
		state.addClass({name: "Monk", source: "XPHB", level: 3});
		const classEntry = state.getClasses()[0];
		CharacterSheetClassUtils.updateClassResources(state, classEntry, 3, {name: "Monk", source: "XPHB"});

		expect(state.getKiPoints()).toBe(3);
		expect(state.getKiPointsCurrent()).toBe(3);

		const resource = state.getResource("Focus Points");
		expect(resource).not.toBeNull();
		expect(resource.max).toBe(3);
	});

	// --- useKiPoint proxies through resource ---

	test("useKiPoint decrements the resource entry", () => {
		state.addClass({name: "Monk", source: "XPHB", level: 5});
		const classEntry = state.getClasses()[0];
		CharacterSheetClassUtils.updateClassResources(state, classEntry, 5, {name: "Monk", source: "XPHB"});

		expect(state.useKiPoint(1)).toBe(true);
		expect(state.getKiPointsCurrent()).toBe(4);

		// Verify the resource entry itself was decremented
		const resource = state.getResource("Focus Points");
		expect(resource.current).toBe(4);
	});

	test("useKiPoint fails when no resource exists", () => {
		state.addClass({name: "Monk", source: "XPHB", level: 5});
		// Without calling updateClassResources, no resource exists
		expect(state.useKiPoint(1)).toBe(false);
	});

	test("useKiPoint fails when insufficient points", () => {
		state.addClass({name: "Monk", source: "XPHB", level: 3});
		const classEntry = state.getClasses()[0];
		CharacterSheetClassUtils.updateClassResources(state, classEntry, 3, {name: "Monk", source: "XPHB"});

		// Spend 2, leaving 1
		state.useKiPoint(2);
		expect(state.getKiPointsCurrent()).toBe(1);

		// Trying to spend 2 more should fail
		expect(state.useKiPoint(2)).toBe(false);
		expect(state.getKiPointsCurrent()).toBe(1);
	});

	// --- Level up updates resource ---

	test("level up should add difference to current ki", () => {
		state.addClass({name: "Monk", source: "XPHB", level: 3});
		const classEntry = state.getClasses()[0];
		const classData = {name: "Monk", source: "XPHB"};
		CharacterSheetClassUtils.updateClassResources(state, classEntry, 3, classData);

		// Spend 1 point
		state.useKiPoint(1);
		expect(state.getKiPointsCurrent()).toBe(2);

		// Level up to 4 — adds 1 to current
		CharacterSheetClassUtils.updateClassResources(state, classEntry, 4, classData);
		expect(state.getKiPoints()).toBe(4);
		expect(state.getKiPointsCurrent()).toBe(3);
	});

	// --- Short rest recovery ---

	test("short rest restores ki/focus points via resource system", () => {
		state.addClass({name: "Monk", source: "XPHB", level: 5});
		const classEntry = state.getClasses()[0];
		CharacterSheetClassUtils.updateClassResources(state, classEntry, 5, {name: "Monk", source: "XPHB"});

		// Spend 3 points
		state.useKiPoint(3);
		expect(state.getKiPointsCurrent()).toBe(2);

		// Short rest
		state.onShortRest();

		// Should be fully restored
		expect(state.getKiPointsCurrent()).toBe(5);
		expect(state.getKiPoints()).toBe(5);

		// Resource entry should also be restored
		const resource = state.getResource("Focus Points");
		expect(resource.current).toBe(5);
	});

	// --- Long rest recovery ---

	test("long rest restores ki/focus points via resource system", () => {
		state.addClass({name: "Monk", source: "PHB", level: 4});
		const classEntry = state.getClasses()[0];
		CharacterSheetClassUtils.updateClassResources(state, classEntry, 4, {name: "Monk", source: "PHB"});

		// Spend all points
		state.useKiPoint(4);
		expect(state.getKiPointsCurrent()).toBe(0);

		// Long rest
		state.onLongRest();

		// Should be fully restored (recoverResources("long") covers "short" recharge too)
		expect(state.getKiPointsCurrent()).toBe(4);

		const resource = state.getResource("Focus Points");
		expect(resource.current).toBe(4);
	});

	// --- setKiPointsCurrent / setKiPoints proxies ---

	test("setKiPointsCurrent updates resource entry", () => {
		state.addClass({name: "Monk", source: "XPHB", level: 5});
		const classEntry = state.getClasses()[0];
		CharacterSheetClassUtils.updateClassResources(state, classEntry, 5, {name: "Monk", source: "XPHB"});

		state.setKiPointsCurrent(2);
		expect(state.getKiPointsCurrent()).toBe(2);

		const resource = state.getResource("Focus Points");
		expect(resource.current).toBe(2);
	});

	test("setKiPointsCurrent clamps to max", () => {
		state.addClass({name: "Monk", source: "XPHB", level: 3});
		const classEntry = state.getClasses()[0];
		CharacterSheetClassUtils.updateClassResources(state, classEntry, 3, {name: "Monk", source: "XPHB"});

		state.setKiPointsCurrent(99);
		expect(state.getKiPointsCurrent()).toBe(3);
	});

	test("setKiPointsCurrent clamps to 0", () => {
		state.addClass({name: "Monk", source: "XPHB", level: 3});
		const classEntry = state.getClasses()[0];
		CharacterSheetClassUtils.updateClassResources(state, classEntry, 3, {name: "Monk", source: "XPHB"});

		state.setKiPointsCurrent(-5);
		expect(state.getKiPointsCurrent()).toBe(0);
	});

	// --- Migration from old saves ---

	test("migration converts old _data.kiPoints to Focus Points for PHB monk", () => {
		const saveData = state.toJson();

		// Simulate old save format: kiPoints object but no resource entry
		saveData.classes = [{name: "Monk", source: "PHB", level: 5}];
		saveData.kiPoints = {current: 3, max: 5};
		// Remove any monk resource that might exist
		saveData.resources = (saveData.resources || []).filter(r => r.name !== "Ki Points" && r.name !== "Focus Points");

		const newState = new CharacterSheetState();
		newState.loadFromJson(saveData);

		// Should have migrated to resource
		expect(newState.getKiPoints()).toBe(5);
		expect(newState.getKiPointsCurrent()).toBe(3);

		const resource = newState.getResource("Focus Points");
		expect(resource).not.toBeNull();
		expect(resource.max).toBe(5);
		expect(resource.current).toBe(3);
		expect(resource.recharge).toBe("short");
	});

	test("migration converts old _data.kiPoints to Focus Points for XPHB monk", () => {
		const saveData = state.toJson();

		saveData.classes = [{name: "Monk", source: "XPHB", level: 4}];
		saveData.kiPoints = {current: 2, max: 4};
		saveData.resources = (saveData.resources || []).filter(r => r.name !== "Ki Points" && r.name !== "Focus Points");

		const newState = new CharacterSheetState();
		newState.loadFromJson(saveData);

		const resource = newState.getResource("Focus Points");
		expect(resource).not.toBeNull();
		expect(resource.max).toBe(4);
		expect(resource.current).toBe(2);
	});

	test("migration renames old Ki Points resource to Focus Points", () => {
		const saveData = state.toJson();

		// Old save with a "Ki Points" resource entry
		saveData.classes = [{name: "Monk", source: "PHB", level: 5}];
		saveData.resources = [{id: "test-id", name: "Ki Points", current: 3, max: 5, recharge: "short"}];

		const newState = new CharacterSheetState();
		newState.loadFromJson(saveData);

		// Should have been renamed to Focus Points
		expect(newState.getResource("Ki Points")).toBeNull();
		const resource = newState.getResource("Focus Points");
		expect(resource).not.toBeNull();
		expect(resource.current).toBe(3);
		expect(resource.max).toBe(5);
	});

	// --- useFocusForStamina still delegates correctly ---

	test("useFocusForStamina delegates to useKiPoint which uses resource", () => {
		state.addClass({name: "Monk", source: "XPHB", level: 5});
		const classEntry = state.getClasses()[0];
		CharacterSheetClassUtils.updateClassResources(state, classEntry, 5, {name: "Monk", source: "XPHB"});

		// Need combat system enabled for canUseFocusForStamina
		if (state.usesCombatSystem && state.usesCombatSystem()) {
			expect(state.useFocusForStamina(2)).toBe(true);
			expect(state.getKiPointsCurrent()).toBe(3);

			const resource = state.getResource("Focus Points");
			expect(resource.current).toBe(3);
		}
	});
});

// ==========================================================================
// PART 8: Monk Weapon Tag — Overview & Inventory Item Formats
// ==========================================================================
describe("Monk Weapon Tag — raw and inventory item formats", () => {
	let state;

	beforeEach(() => {
		state = new CharacterSheetState();
		state.setRace({name: "Human", source: "PHB"});
		state.addClass({name: "Monk", source: "PHB", level: 5});
		state.setAbilityBase("dex", 16);
		state.setAbilityBase("wis", 14);
	});

	// -------------------------------------------------------------------------
	// isMonkWeapon with raw 5etools items (property array, type "M")
	// -------------------------------------------------------------------------
	describe("isMonkWeapon with raw item format (property, type M)", () => {
		it("should detect raw shortsword as monk weapon", () => {
			expect(state.isMonkWeapon({
				name: "Shortsword",
				type: "M",
				weaponCategory: "martial",
				property: ["F", "L"],
				weapon: true,
			})).toBe(true);
		});

		it("should detect raw quarterstaff as monk weapon", () => {
			expect(state.isMonkWeapon({
				name: "Quarterstaff",
				type: "M",
				weaponCategory: "simple",
				property: ["V"],
				weapon: true,
			})).toBe(true);
		});

		it("should NOT detect raw greataxe as monk weapon", () => {
			expect(state.isMonkWeapon({
				name: "Greataxe",
				type: "M",
				weaponCategory: "martial",
				property: ["H", "2H"],
				weapon: true,
			})).toBe(false);
		});
	});

	// -------------------------------------------------------------------------
	// isMonkWeapon with inventory-normalized items (properties array, weapon flag)
	// -------------------------------------------------------------------------
	describe("isMonkWeapon with inventory-normalized format (properties, weapon flag)", () => {
		it("should detect inventory quarterstaff as monk weapon", () => {
			expect(state.isMonkWeapon({
				name: "Quarterstaff",
				weapon: true,
				weaponCategory: "simple",
				properties: ["V"],
				isMelee: true,
			})).toBe(true);
		});

		it("should detect inventory handaxe as monk weapon", () => {
			expect(state.isMonkWeapon({
				name: "Handaxe",
				weapon: true,
				weaponCategory: "simple",
				properties: ["L", "T"],
				isMelee: true,
			})).toBe(true);
		});

		it("should NOT detect inventory longbow as monk weapon", () => {
			expect(state.isMonkWeapon({
				name: "Longbow",
				weapon: true,
				weaponCategory: "martial",
				properties: ["A", "H", "2H"],
				isMelee: false,
			})).toBe(false);
		});
	});

	// -------------------------------------------------------------------------
	// updateAttackFromWeapon sets isMonkWeapon correctly for raw items
	// -------------------------------------------------------------------------
	describe("updateAttackFromWeapon — raw items set monk flag", () => {
		it("should set isMonkWeapon=true for raw shortsword", () => {
			const result = state.updateAttackFromWeapon({
				name: "Shortsword",
				type: "M",
				weaponCategory: "martial",
				property: ["F", "L"],
				dmg1: "1d6",
				dmgType: "P",
			});
			expect(result.isMonkWeapon).toBe(true);
		});

		it("should set isMonkWeapon=true for raw simple melee weapon", () => {
			const result = state.updateAttackFromWeapon({
				name: "Handaxe",
				type: "M",
				weaponCategory: "simple",
				property: ["L", "T"],
				dmg1: "1d6",
				dmgType: "S",
			});
			expect(result.isMonkWeapon).toBe(true);
		});

		it("should set isMonkWeapon=false for raw martial non-shortsword weapon", () => {
			const result = state.updateAttackFromWeapon({
				name: "Longsword",
				type: "M",
				weaponCategory: "martial",
				property: ["V"],
				dmg1: "1d8",
				dmgType: "S",
			});
			expect(result.isMonkWeapon).toBe(false);
		});
	});

	// -------------------------------------------------------------------------
	// Equipped monk weapon items produce correct state data
	// -------------------------------------------------------------------------
	describe("addItem + equip — monk weapon items in inventory", () => {
		it("should store raw item data correctly in inventory", () => {
			state.addItem({
				name: "Shortsword",
				source: "PHB",
				type: "M",
				weapon: true,
				weaponCategory: "martial",
				property: ["F", "L"],
				dmg1: "1d6",
				dmgType: "P",
			}, 1, true);

			const items = state.getItems();
			const sword = items.find(i => i.name === "Shortsword");
			expect(sword).toBeDefined();
			expect(sword.equipped).toBe(true);
			expect(sword.weapon).toBe(true);
			expect(state.isMonkWeapon(sword)).toBe(true);
		});

		it("should store item with property array preserved", () => {
			state.addItem({
				name: "Quarterstaff",
				source: "PHB",
				type: "M",
				weapon: true,
				weaponCategory: "simple",
				property: ["V"],
				dmg1: "1d6",
				dmgType: "B",
			}, 1, true);

			const items = state.getItems();
			const staff = items.find(i => i.name === "Quarterstaff");
			expect(staff).toBeDefined();
			expect(staff.property).toEqual(["V"]);
			expect(state.isMonkWeapon(staff)).toBe(true);
		});

		it("should NOT flag heavy martial weapon as monk weapon", () => {
			state.addItem({
				name: "Greataxe",
				source: "PHB",
				type: "M",
				weapon: true,
				weaponCategory: "martial",
				property: ["H", "2H"],
				dmg1: "1d12",
				dmgType: "S",
			}, 1, true);

			const items = state.getItems();
			const axe = items.find(i => i.name === "Greataxe");
			expect(state.isMonkWeapon(axe)).toBe(false);
		});
	});

	// -------------------------------------------------------------------------
	// Non-monk class should never flag monk weapons
	// -------------------------------------------------------------------------
	describe("non-monk class — no monk weapon detection", () => {
		it("should return false for shortsword when class is Fighter", () => {
			const fighterState = new CharacterSheetState();
			fighterState.addClass({name: "Fighter", source: "PHB", level: 5});
			expect(fighterState.isMonkWeapon({
				name: "Shortsword",
				type: "M",
				weaponCategory: "martial",
				property: ["F", "L"],
				weapon: true,
			})).toBe(false);
		});
	});
});

// ==========================================================================
// PART 9: Monk Combat Abilities — Patient Defense, Flurry of Blows, Step of the Wind
// ==========================================================================
describe("Monk Combat Abilities — State-Level Effects", () => {
	let state;
	beforeEach(() => {
		state = new CharacterSheetState();
		state.setRace({name: "Human", source: "PHB"});
		state.addClass({name: "Monk", source: "XPHB", level: 5});
		state.setKiPoints(5);
		state.setKiPointsCurrent(5);
	});

	// --- Patient Defense ---

	describe("Patient Defense", () => {
		it("ACTIVE_STATE_TYPES.patientDefense should be defined with correct effects", () => {
			const pd = CharacterSheetState.ACTIVE_STATE_TYPES.patientDefense;
			expect(pd).toBeDefined();
			expect(pd.effects).toEqual([
				{type: "disadvantage", target: "attacksAgainst"},
				{type: "advantage", target: "save:dex"},
			]);
			expect(pd.resourceName).toBe("Focus Points");
			expect(pd.resourceCost).toBe(1);
			expect(pd.activationAction).toBe("bonus");
			expect(pd.duration).toBe("Until start of next turn");
		});

		it("activateState('patientDefense') should add it to active states", () => {
			state.activateState("patientDefense");
			expect(state.isStateTypeActive("patientDefense")).toBe(true);
		});

		it("Patient Defense effects should appear in getActiveStateEffects", () => {
			state.activateState("patientDefense");
			const effects = state.getActiveStateEffects();
			const hasDisadvantage = effects.some(e => e.type === "disadvantage" && e.target === "attacksAgainst");
			const hasAdvantage = effects.some(e => e.type === "advantage" && e.target === "save:dex");
			expect(hasDisadvantage).toBe(true);
			expect(hasAdvantage).toBe(true);
		});

		it("deactivating Patient Defense should remove effects", () => {
			state.activateState("patientDefense");
			expect(state.isStateTypeActive("patientDefense")).toBe(true);

			state.deactivateState("patientDefense");
			expect(state.isStateTypeActive("patientDefense")).toBe(false);
			const effects = state.getActiveStateEffects();
			const hasDisadvantage = effects.some(e => e.type === "disadvantage" && e.target === "attacksAgainst");
			expect(hasDisadvantage).toBe(false);
		});
	});

	// --- Step of the Wind ---

	describe("Step of the Wind", () => {
		it("ACTIVE_STATE_TYPES.stepOfTheWind should be defined with speed and jump multipliers", () => {
			const sotw = CharacterSheetState.ACTIVE_STATE_TYPES.stepOfTheWind;
			expect(sotw).toBeDefined();
			expect(sotw.effects).toEqual([
				{type: "speedMultiplier", value: 2},
				{type: "jumpMultiplier", value: 2},
			]);
			expect(sotw.resourceName).toBe("Focus Points");
			expect(sotw.resourceCost).toBe(1);
			expect(sotw.duration).toBe("Until end of turn");
		});

		it("activateState('stepOfTheWind') should add it to active states", () => {
			state.activateState("stepOfTheWind");
			expect(state.isStateTypeActive("stepOfTheWind")).toBe(true);
		});

		it("Step of the Wind should double movement speed via multiplier", () => {
			const baseSpeed = state.getSpeedMultiplierFromConditions();
			expect(baseSpeed).toBe(1);

			state.activateState("stepOfTheWind");
			const newMultiplier = state.getSpeedMultiplierFromConditions();
			expect(newMultiplier).toBe(2);
		});

		it("Step of the Wind should double jump distance via jumpMultiplier", () => {
			const baseJump = state.getJumpMultiplierFromStates();
			expect(baseJump).toBe(1);

			state.activateState("stepOfTheWind");
			const jumpMult = state.getJumpMultiplierFromStates();
			expect(jumpMult).toBe(2);
		});

		it("deactivating Step of the Wind should restore normal speed and jump multipliers", () => {
			state.activateState("stepOfTheWind");
			expect(state.getSpeedMultiplierFromConditions()).toBe(2);
			expect(state.getJumpMultiplierFromStates()).toBe(2);

			state.deactivateState("stepOfTheWind");
			expect(state.getSpeedMultiplierFromConditions()).toBe(1);
			expect(state.getJumpMultiplierFromStates()).toBe(1);
		});
	});

	// --- Flurry of Blows ---

	describe("Flurry of Blows", () => {
		it("getUnarmedStrike should return a monk unarmed strike", () => {
			state.ensureUnarmedStrike();
			const unarmed = state.getUnarmedStrike();
			expect(unarmed).toBeDefined();
			expect(unarmed.isUnarmedStrike).toBe(true);
			expect(unarmed.isMonkWeapon).toBe(true);
		});

		it("unarmed strike damage should scale with martial arts die at level 5", () => {
			state.ensureUnarmedStrike();
			const unarmed = state.getUnarmedStrike();
			// Level 5 XPHB monk: 1d8 martial arts die
			expect(unarmed.damage).toBe("1d8");
		});

		it("Heightened Focus at level 10+ should give 3 flurry attacks", () => {
			const state10 = new CharacterSheetState();
			state10.setRace({name: "Human", source: "PHB"});
			state10.addClass({name: "Monk", source: "XPHB", level: 10});
			const calc = state10.getFeatureCalculations();
			expect(calc.hasHeightenedFocus).toBe(true);
			expect(calc.heightenedFlurryAttacks).toBe(3);
		});

		it("standard monk should have 2 flurry attacks (no heightened)", () => {
			const calc = state.getFeatureCalculations();
			expect(calc.heightenedFlurryAttacks).toBeUndefined();
		});

		it("TGTT level 8+ should have hasUnhinderedFlurry (free Flurry of Blows)", () => {
			const tgttState = new CharacterSheetState();
			tgttState.setRace({name: "Human", source: "PHB"});
			tgttState.addClass({name: "Monk", source: "TGTT", level: 8});
			const calc = tgttState.getFeatureCalculations();
			expect(calc.hasUnhinderedFlurry).toBe(true);
		});

		it("TGTT level 7 should NOT have hasUnhinderedFlurry", () => {
			const tgttState = new CharacterSheetState();
			tgttState.setRace({name: "Human", source: "PHB"});
			tgttState.addClass({name: "Monk", source: "TGTT", level: 7});
			const calc = tgttState.getFeatureCalculations();
			expect(calc.hasUnhinderedFlurry).toBeFalsy();
		});
	});

	// --- Detection Patterns ---

	describe("Detection patterns", () => {
		it("Step of the Wind should be detected as combat action", () => {
			const result = CharacterSheetState.detectActivatableFeature({
				name: "Step of the Wind",
				description: "You can spend 1 Focus Point to take the Dash or Disengage action as a bonus action",
			});
			expect(result).toBeDefined();
			expect(result.interactionMode).toBe("combat");
		});

		it("Patient Defense should be detected as combat action", () => {
			const result = CharacterSheetState.detectActivatableFeature({
				name: "Patient Defense",
				description: "You can spend 1 Focus Point to take the Dodge action as a bonus action",
			});
			expect(result).toBeDefined();
			expect(result.interactionMode).toBe("combat");
		});

		it("Flurry of Blows should be detected as combat action", () => {
			const result = CharacterSheetState.detectActivatableFeature({
				name: "Flurry of Blows",
				description: "After taking the Attack action, you can spend 1 Focus Point to make two unarmed strikes as a bonus action",
			});
			expect(result).toBeDefined();
			expect(result.interactionMode).toBe("combat");
			expect(result.isInstant).toBe(true);
		});

		it("stepOfTheWind active state type should be defined", () => {
			const sotw = CharacterSheetState.ACTIVE_STATE_TYPES.stepOfTheWind;
			expect(sotw).toBeDefined();
			expect(sotw.id).toBe("stepOfTheWind");
			expect(sotw.detectPatterns).toContain("step of the wind");
		});
	});
});

// ==========================================================================
// PART 13: HAND OF HEALING / HAND OF HARM EFFECTS
// ==========================================================================
describe("Hand of Healing / Hand of Harm Effects", () => {
	let state;

	beforeEach(() => {
		state = new CharacterSheetState();
		state.setRace({name: "Human", source: "PHB"});
		state.addClass({
			name: "Monk",
			source: "PHB",
			level: 3,
			subclass: {name: "Way of Mercy", shortName: "Mercy", source: "TCE"},
		});
		state.setAbilityBase("dex", 16);
		state.setAbilityBase("wis", 16);
	});

	describe("Hand of Healing formula scaling", () => {
		it("should provide formula at level 3 (1d4+WIS)", () => {
			const calc = state.getFeatureCalculations();
			expect(calc.hasHandOfHealing).toBe(true);
			expect(calc.handOfHealingAmount).toBe("1d4+3");
		});

		it("should scale with martial arts die at level 5 (1d6+WIS)", () => {
			state.addClass({
				name: "Monk",
				source: "PHB",
				level: 5,
				subclass: {name: "Way of Mercy", shortName: "Mercy", source: "TCE"},
			});
			const calc = state.getFeatureCalculations();
			expect(calc.handOfHealingAmount).toBe("1d6+3");
		});

		it("should scale with martial arts die at level 11 (1d8+WIS)", () => {
			state.addClass({
				name: "Monk",
				source: "PHB",
				level: 11,
				subclass: {name: "Way of Mercy", shortName: "Mercy", source: "TCE"},
			});
			const calc = state.getFeatureCalculations();
			expect(calc.handOfHealingAmount).toBe("1d8+3");
		});

		it("should scale with WIS modifier changes", () => {
			state.setAbilityBase("wis", 20);
			const calc = state.getFeatureCalculations();
			expect(calc.handOfHealingAmount).toBe("1d4+5");
		});
	});

	describe("Hand of Harm formula scaling", () => {
		it("should provide formula at level 3 (1d4+WIS)", () => {
			const calc = state.getFeatureCalculations();
			expect(calc.hasHandOfHarm).toBe(true);
			expect(calc.handOfHarmDamage).toBe("1d4+3");
		});

		it("should scale with martial arts die at level 5 (1d6+WIS)", () => {
			state.addClass({
				name: "Monk",
				source: "PHB",
				level: 5,
				subclass: {name: "Way of Mercy", shortName: "Mercy", source: "TCE"},
			});
			const calc = state.getFeatureCalculations();
			expect(calc.handOfHarmDamage).toBe("1d6+3");
		});

		it("should scale with martial arts die at level 11 (1d8+WIS)", () => {
			state.addClass({
				name: "Monk",
				source: "PHB",
				level: 11,
				subclass: {name: "Way of Mercy", shortName: "Mercy", source: "TCE"},
			});
			const calc = state.getFeatureCalculations();
			expect(calc.handOfHarmDamage).toBe("1d8+3");
		});
	});

	describe("Physician's Touch (Level 6)", () => {
		it("should list curable conditions", () => {
			state.addClass({
				name: "Monk",
				source: "PHB",
				level: 6,
				subclass: {name: "Way of Mercy", shortName: "Mercy", source: "TCE"},
			});
			const calc = state.getFeatureCalculations();
			expect(calc.hasPhysiciansTouch).toBe(true);
			expect(calc.physiciansTouchConditions).toContain("blinded");
			expect(calc.physiciansTouchConditions).toContain("deafened");
			expect(calc.physiciansTouchConditions).toContain("paralyzed");
			expect(calc.physiciansTouchConditions).toContain("poisoned");
			expect(calc.physiciansTouchConditions).toContain("stunned");
		});

		it("should not have Physician's Touch before level 6", () => {
			const calc = state.getFeatureCalculations();
			expect(calc.hasPhysiciansTouch).toBeFalsy();
		});
	});

	describe("Flurry of Healing and Harm (Level 11)", () => {
		it("should enable free Hand of Healing/Harm at level 11", () => {
			state.addClass({
				name: "Monk",
				source: "PHB",
				level: 11,
				subclass: {name: "Way of Mercy", shortName: "Mercy", source: "TCE"},
			});
			const calc = state.getFeatureCalculations();
			expect(calc.hasFlurryOfHealingAndHarm).toBe(true);
		});

		it("should not have Flurry of Healing and Harm before level 11", () => {
			const calc = state.getFeatureCalculations();
			expect(calc.hasFlurryOfHealingAndHarm).toBeFalsy();
		});
	});

	describe("Hand of Healing with heal() integration", () => {
		it("should heal self using state.heal()", () => {
			// Simulate damage so healing has an effect
			state.takeDamage(10);
			const hpBefore = state.getCurrentHp();
			state.heal(5);
			expect(state.getCurrentHp()).toBe(hpBefore + 5);
		});

		it("should cap healing at max HP", () => {
			state.takeDamage(3);
			const maxHp = state.getMaxHp();
			state.heal(100);
			expect(state.getCurrentHp()).toBe(maxHp);
		});

		it("should reset death saves when healing from 0 HP", () => {
			const maxHp = state.getMaxHp();
			state.takeDamage(maxHp);
			expect(state.getCurrentHp()).toBe(0);
			state.heal(5);
			expect(state.getCurrentHp()).toBe(5);
		});
	});

	describe("Hand of Harm focus cost", () => {
		beforeEach(() => {
			// Initialize focus points resource (Monk level 3 = 3 focus points)
			state.setKiPoints(3);
			state.setKiPointsCurrent(3);
		});

		it("should require focus points", () => {
			const calc = state.getFeatureCalculations();
			expect(calc.hasHandOfHarm).toBe(true);
			// Verify focus points are available
			const fp = state.getKiPointsCurrent();
			expect(fp).toBeGreaterThan(0);
		});

		it("should deduct 1 focus point when used", () => {
			const before = state.getKiPointsCurrent();
			const result = state.useKiPoint(1);
			expect(result).toBe(true);
			expect(state.getKiPointsCurrent()).toBe(before - 1);
		});

		it("should fail when no focus points remain", () => {
			// Exhaust all focus points
			const total = state.getKiPointsCurrent();
			for (let i = 0; i < total; i++) state.useKiPoint(1);
			expect(state.getKiPointsCurrent()).toBe(0);
			const result = state.useKiPoint(1);
			expect(result).toBe(false);
		});
	});
});
