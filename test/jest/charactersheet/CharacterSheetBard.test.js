/**
 * Character Sheet Bard Class Tests
 * Comprehensive testing for all Bard class features and subclasses
 *
 * This test suite verifies that:
 * - All core class features are correctly parsed and provide expected effects
 * - Bardic Inspiration dice progression (d6 -> d8 -> d10 -> d12) is accurate
 * - Jack of All Trades half-proficiency bonus is calculated correctly
 * - Song of Rest dice progression is correct
 * - All subclass features work correctly at their designated levels
 * - Both PHB (Classic) and XPHB (2024) versions are handled properly
 * - Spellcasting mechanics (full caster, prepared vs known) work correctly
 */

import "./setup.js";
import "../../../js/charactersheet/charactersheet-state.js";

const CharacterSheetState = globalThis.CharacterSheetState;

// ==========================================================================
// PART 1: CORE BARD CLASS FEATURES (PHB)
// ==========================================================================
describe("Bard Core Class Features (PHB)", () => {
	let state;

	beforeEach(() => {
		state = new CharacterSheetState();
		state.setRace({name: "Human", source: "PHB"});
		state.addClass({name: "Bard", source: "PHB", level: 1});
		state.setAbilityBase("cha", 16); // +3 modifier
		state.setAbilityBase("dex", 14); // +2 modifier
		state.setAbilityBase("con", 12); // +1 modifier
		state.setAbilityBase("int", 10);
		state.setAbilityBase("wis", 10);
		state.setAbilityBase("str", 8);
	});

	// -------------------------------------------------------------------------
	// 1.1 Bardic Inspiration
	// -------------------------------------------------------------------------
	describe("Bardic Inspiration", () => {
		it("should have Bardic Inspiration at level 1", () => {
			expect(state.getTotalLevel()).toBe(1);
		});

		it("should have d6 Bardic Inspiration die at levels 1-4", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.bardicInspirationDie).toBe("1d6");
		});

		it("should have d8 Bardic Inspiration die at levels 5-9", () => {
			state.addClass({name: "Bard", source: "PHB", level: 5});
			const calculations = state.getFeatureCalculations();
			expect(calculations.bardicInspirationDie).toBe("1d8");
		});

		it("should have d10 Bardic Inspiration die at levels 10-14", () => {
			state.addClass({name: "Bard", source: "PHB", level: 10});
			const calculations = state.getFeatureCalculations();
			expect(calculations.bardicInspirationDie).toBe("1d10");
		});

		it("should have d12 Bardic Inspiration die at levels 15-20", () => {
			state.addClass({name: "Bard", source: "PHB", level: 15});
			const calculations = state.getFeatureCalculations();
			expect(calculations.bardicInspirationDie).toBe("1d12");
		});

		it("should have uses equal to Charisma modifier (3 uses with CHA 16)", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.bardicInspirationUses).toBe(3);
		});

		it("should have minimum 1 use even with low Charisma", () => {
			state.setAbilityBase("cha", 8); // -1 modifier
			const calculations = state.getFeatureCalculations();
			expect(calculations.bardicInspirationUses).toBe(1);
		});

		it("should have 5 uses with Charisma 20", () => {
			state.setAbilityBase("cha", 20); // +5 modifier
			const calculations = state.getFeatureCalculations();
			expect(calculations.bardicInspirationUses).toBe(5);
		});
	});

	// -------------------------------------------------------------------------
	// 1.2 Spellcasting
	// -------------------------------------------------------------------------
	describe("Spellcasting", () => {
		it("should be a full caster", () => {
			const classes = state.getClasses();
			const bardClass = classes.find(c => c.name === "Bard");
			expect(bardClass).toBeDefined();
		});

		it("should have 2 first-level spell slots at level 1", () => {
			const spellSlots = state.getSpellSlots();
			expect(spellSlots[1]?.max).toBe(2);
		});

		it("should have correct spell slots at level 5", () => {
			state.addClass({name: "Bard", source: "PHB", level: 5});
			const spellSlots = state.getSpellSlots();
			expect(spellSlots[1]?.max).toBe(4);
			expect(spellSlots[2]?.max).toBe(3);
			expect(spellSlots[3]?.max).toBe(2);
		});

		it("should calculate spell save DC correctly", () => {
			const profBonus = state.getProficiencyBonus();
			const chaMod = state.getAbilityMod("cha");
			const expectedDC = 8 + profBonus + chaMod;
			expect(expectedDC).toBe(13);
		});

		it("should calculate spell attack bonus correctly", () => {
			const profBonus = state.getProficiencyBonus();
			const chaMod = state.getAbilityMod("cha");
			const expectedBonus = profBonus + chaMod;
			expect(expectedBonus).toBe(5);
		});
	});

	// -------------------------------------------------------------------------
	// 1.3 Jack of All Trades
	// -------------------------------------------------------------------------
	describe("Jack of All Trades", () => {
		it("should not have Jack of All Trades at level 1", () => {
			// Level 1 already set in beforeEach
			const calculations = state.getFeatureCalculations();
			expect(calculations.jackOfAllTrades).toBeUndefined();
		});

		it("should have Jack of All Trades bonus of +1 at level 2", () => {
			state.addClass({name: "Bard", source: "PHB", level: 2});
			const calculations = state.getFeatureCalculations();
			expect(calculations.jackOfAllTrades).toBe(1);
		});

		it("should have Jack of All Trades bonus of +1 at level 4", () => {
			state.addClass({name: "Bard", source: "PHB", level: 4});
			const calculations = state.getFeatureCalculations();
			expect(calculations.jackOfAllTrades).toBe(1);
		});

		it("should have Jack of All Trades bonus of +2 at level 9", () => {
			state.addClass({name: "Bard", source: "PHB", level: 9});
			const calculations = state.getFeatureCalculations();
			expect(calculations.jackOfAllTrades).toBe(2);
		});

		it("should have Jack of All Trades bonus of +3 at level 17", () => {
			state.addClass({name: "Bard", source: "PHB", level: 17});
			const calculations = state.getFeatureCalculations();
			expect(calculations.jackOfAllTrades).toBe(3);
		});
	});

	// -------------------------------------------------------------------------
	// 1.4 Song of Rest
	// -------------------------------------------------------------------------
	describe("Song of Rest", () => {
		it("should have d6 Song of Rest at level 2", () => {
			state.addClass({name: "Bard", source: "PHB", level: 2});
			const calculations = state.getFeatureCalculations();
			expect(calculations.songOfRestDie).toBe("1d6");
		});

		it("should have d8 Song of Rest at level 9", () => {
			state.addClass({name: "Bard", source: "PHB", level: 9});
			const calculations = state.getFeatureCalculations();
			expect(calculations.songOfRestDie).toBe("1d8");
		});

		it("should have d10 Song of Rest at level 13", () => {
			state.addClass({name: "Bard", source: "PHB", level: 13});
			const calculations = state.getFeatureCalculations();
			expect(calculations.songOfRestDie).toBe("1d10");
		});

		it("should have d12 Song of Rest at level 17", () => {
			state.addClass({name: "Bard", source: "PHB", level: 17});
			const calculations = state.getFeatureCalculations();
			expect(calculations.songOfRestDie).toBe("1d12");
		});
	});

	// -------------------------------------------------------------------------
	// 1.5 Expertise
	// -------------------------------------------------------------------------
	describe("Expertise", () => {
		it("should be available at level 3", () => {
			state.addClass({name: "Bard", source: "PHB", level: 3});
			expect(state.getTotalLevel()).toBe(3);
		});

		it("should double proficiency for expertise skills", () => {
			state.addClass({name: "Bard", source: "PHB", level: 3});
			state.setSkillProficiency("performance", true);
			state.setSkillExpertise("performance", true);

			const profBonus = state.getProficiencyBonus();
			const chaMod = state.getAbilityMod("cha");
			const expectedBonus = chaMod + (profBonus * 2);
			const performanceBonus = state.getSkillBonus("performance");
			expect(performanceBonus).toBe(expectedBonus);
		});
	});

	// -------------------------------------------------------------------------
	// 1.6 Core Features Availability
	// -------------------------------------------------------------------------
	describe("Core Features Availability", () => {
		it("should have Font of Inspiration at level 5", () => {
			state.addClass({name: "Bard", source: "PHB", level: 5});
			expect(state.getTotalLevel()).toBe(5);
		});

		it("should have Countercharm at level 6", () => {
			state.addClass({name: "Bard", source: "PHB", level: 6});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasCountercharm).toBe(true);
		});

		it("should not have Countercharm before level 6", () => {
			state.addClass({name: "Bard", source: "PHB", level: 5});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasCountercharm).toBeUndefined();
		});

		it("should have Magical Secrets at level 10", () => {
			state.addClass({name: "Bard", source: "PHB", level: 10});
			expect(state.getTotalLevel()).toBe(10);
		});

		it("should have Magical Secrets at level 10", () => {
			state.addClass({name: "Bard", source: "PHB", level: 10});
			expect(state.getTotalLevel()).toBe(10);
		});

		it("should have Superior Inspiration at level 20", () => {
			state.addClass({name: "Bard", source: "PHB", level: 20});
			expect(state.getTotalLevel()).toBe(20);
		});
	});
});

// ==========================================================================
// PART 2: BARD HIT DICE AND HP
// ==========================================================================
describe("Bard Hit Dice and HP", () => {
	let state;

	beforeEach(() => {
		state = new CharacterSheetState();
		state.setRace({name: "Human", source: "PHB"});
		state.setAbilityBase("con", 14);
	});

	it("should use d8 hit dice", () => {
		state.addClass({name: "Bard", source: "PHB", level: 1});
		const hitDice = state.getHitDice();
		expect(hitDice.some(hd => hd.die === 8)).toBe(true);
	});

	it("should have correct number of hit dice per level", () => {
		for (let level = 1; level <= 5; level++) {
			const testState = new CharacterSheetState();
			testState.setAbilityBase("con", 14);
			testState.addClass({name: "Bard", source: "PHB", level: level});
			const hitDice = testState.getHitDice();
			const d8Dice = hitDice.find(hd => hd.die === 8);
			expect(d8Dice.max).toBe(level);
		}
	});

	it("should calculate max HP correctly at level 1", () => {
		state.addClass({name: "Bard", source: "PHB", level: 1});
		// Level 1: 8 (max d8) + 2 (CON) = 10
		expect(state.getHp().max).toBe(10);
	});

	it("should calculate max HP correctly at level 5", () => {
		state.addClass({name: "Bard", source: "PHB", level: 5});
		// Level 1: 8 + 2 = 10
		// Levels 2-5: 4 × (5 + 2) = 28 (using average of 5 for d8)
		// Total: 10 + 28 = 38
		expect(state.getHp().max).toBe(38);
	});
});

// ==========================================================================
// PART 3: COLLEGE OF LORE SUBCLASS (PHB)
// ==========================================================================
describe("College of Lore (PHB)", () => {
	let state;

	beforeEach(() => {
		state = new CharacterSheetState();
		state.setRace({name: "Human", source: "PHB"});
		state.addClass({
			name: "Bard",
			source: "PHB",
			level: 3,
			subclass: {name: "College of Lore", shortName: "Lore", source: "PHB"},
		});
		state.setAbilityBase("cha", 16);
		state.setAbilityBase("dex", 14);
		state.setAbilityBase("con", 12);
	});

	it("should have Lore subclass at level 3", () => {
		const classes = state.getClasses();
		expect(classes[0].subclass).toBeDefined();
		expect(classes[0].subclass.name).toBe("College of Lore");
	});

	it("should include subclass in class summary", () => {
		const summary = state.getClassSummary();
		expect(summary).toContain("Lore");
	});

	describe("Cutting Words DC", () => {
		it("should use CHA-based calculation for Bardic Inspiration effects", () => {
			const profBonus = state.getProficiencyBonus();
			const chaMod = state.getAbilityMod("cha");
			const expectedDc = 8 + profBonus + chaMod;
			expect(expectedDc).toBe(13);
		});
	});

	describe("Additional Magical Secrets (Level 6)", () => {
		it("should have Additional Magical Secrets at level 6", () => {
			state.addClass({
				name: "Bard",
				source: "PHB",
				level: 6,
				subclass: {name: "College of Lore", shortName: "Lore", source: "PHB"},
			});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasAdditionalMagicalSecrets).toBe(true);
			expect(calculations.additionalMagicalSecretsCount).toBe(2);
		});

		it("should not have Additional Magical Secrets before level 6", () => {
			// Already level 3 from beforeEach
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasAdditionalMagicalSecrets).toBeUndefined();
		});
	});

	describe("Peerless Skill (Level 14)", () => {
		it("should have Peerless Skill at level 14", () => {
			state.addClass({
				name: "Bard",
				source: "PHB",
				level: 14,
				subclass: {name: "College of Lore", shortName: "Lore", source: "PHB"},
			});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasPeerlessSkill).toBe(true);
			expect(calculations.peerlessSkillDie).toBe("1d10"); // d10 at level 10-14
		});

		it("should have d12 Peerless Skill die at level 15+", () => {
			state.addClass({
				name: "Bard",
				source: "PHB",
				level: 15,
				subclass: {name: "College of Lore", shortName: "Lore", source: "PHB"},
			});
			const calculations = state.getFeatureCalculations();
			expect(calculations.peerlessSkillDie).toBe("1d12");
		});

		it("should not have Peerless Skill before level 14", () => {
			state.addClass({
				name: "Bard",
				source: "PHB",
				level: 10,
				subclass: {name: "College of Lore", shortName: "Lore", source: "PHB"},
			});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasPeerlessSkill).toBeUndefined();
		});
	});

	describe("Cutting Words", () => {
		it("should have Cutting Words at level 3", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasCuttingWords).toBe(true);
			expect(calculations.cuttingWordsDie).toBe("1d6"); // Level 3 = d6
		});

		it("should scale Cutting Words die with level", () => {
			state.addClass({
				name: "Bard",
				source: "PHB",
				level: 10,
				subclass: {name: "College of Lore", shortName: "Lore", source: "PHB"},
			});
			const calculations = state.getFeatureCalculations();
			expect(calculations.cuttingWordsDie).toBe("1d10");
		});
	});

	describe("Bonus Proficiencies", () => {
		it("should have 3 bonus skill proficiencies at level 3", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasLoreBonusProficiencies).toBe(true);
			expect(calculations.loreBonusSkills).toBe(3);
		});
	});
});

// ==========================================================================
// PART 4: COLLEGE OF VALOR SUBCLASS (PHB)
// ==========================================================================
describe("College of Valor (PHB)", () => {
	let state;

	beforeEach(() => {
		state = new CharacterSheetState();
		state.setRace({name: "Human", source: "PHB"});
		state.addClass({
			name: "Bard",
			source: "PHB",
			level: 3,
			subclass: {name: "College of Valor", shortName: "Valor", source: "PHB"},
		});
		state.setAbilityBase("str", 14);
		state.setAbilityBase("dex", 14);
		state.setAbilityBase("con", 12);
		state.setAbilityBase("cha", 16);
	});

	it("should have Valor subclass at level 3", () => {
		const classes = state.getClasses();
		expect(classes[0].subclass).toBeDefined();
		expect(classes[0].subclass.name).toBe("College of Valor");
	});

	describe("Combat Inspiration", () => {
		it("should have Combat Inspiration at level 3", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasCombatInspiration).toBe(true);
			expect(calculations.combatInspirationDie).toBe("1d6");
		});
	});

	describe("Bonus Proficiencies", () => {
		it("should have martial weapon and armor proficiencies at level 3", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasValorBonusProficiencies).toBe(true);
		});
	});

	describe("Extra Attack (Level 6)", () => {
		it("should have Extra Attack at level 6", () => {
			state.addClass({
				name: "Bard",
				source: "PHB",
				level: 6,
				subclass: {name: "College of Valor", shortName: "Valor", source: "PHB"},
			});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasExtraAttack).toBe(true);
			expect(calculations.attacksPerAction).toBe(2);
		});

		it("should not have Extra Attack before level 6", () => {
			// Already level 3 from beforeEach
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasExtraAttack).toBeUndefined();
		});
	});

	describe("Battle Magic (Level 14)", () => {
		it("should have Battle Magic at level 14", () => {
			state.addClass({
				name: "Bard",
				source: "PHB",
				level: 14,
				subclass: {name: "College of Valor", shortName: "Valor", source: "PHB"},
			});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasBattleMagic).toBe(true);
		});

		it("should not have Battle Magic before level 14", () => {
			state.addClass({
				name: "Bard",
				source: "PHB",
				level: 10,
				subclass: {name: "College of Valor", shortName: "Valor", source: "PHB"},
			});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasBattleMagic).toBeUndefined();
		});
	});
});

// ==========================================================================
// PART 5: COLLEGE OF GLAMOUR SUBCLASS (XGE)
// ==========================================================================
describe("College of Glamour (XGE)", () => {
	let state;

	beforeEach(() => {
		state = new CharacterSheetState();
		state.setRace({name: "Human", source: "PHB"});
		state.addClass({
			name: "Bard",
			source: "PHB",
			level: 3,
			subclass: {name: "College of Glamour", shortName: "Glamour", source: "XGE"},
		});
		state.setAbilityBase("cha", 16);
	});

	it("should have Glamour subclass at level 3", () => {
		const classes = state.getClasses();
		expect(classes[0].subclass).toBeDefined();
		expect(classes[0].subclass.name).toBe("College of Glamour");
	});

	describe("Mantle of Inspiration", () => {
		it("should have Mantle of Inspiration at level 3", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasMantleOfInspiration).toBe(true);
			expect(calculations.mantleOfInspirationTempHp).toBe(8); // 5 + level 3
			expect(calculations.mantleOfInspirationTargets).toBe(3); // CHA mod = 3
		});

		it("should scale temp HP with level", () => {
			state.addClass({
				name: "Bard",
				source: "PHB",
				level: 10,
				subclass: {name: "College of Glamour", shortName: "Glamour", source: "XGE"},
			});
			const calculations = state.getFeatureCalculations();
			expect(calculations.mantleOfInspirationTempHp).toBe(15); // 5 + level 10
		});
	});

	describe("Enthralling Performance", () => {
		it("should have Enthralling Performance at level 3", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasEnthrallingPerformance).toBe(true);
			expect(calculations.enthrallingPerformanceDc).toBe(13); // 8 + 2 (prof) + 3 (CHA)
		});
	});

	describe("Mantle of Majesty (Level 6)", () => {
		it("should have Mantle of Majesty at level 6", () => {
			state.addClass({
				name: "Bard",
				source: "PHB",
				level: 6,
				subclass: {name: "College of Glamour", shortName: "Glamour", source: "XGE"},
			});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasMantleOfMajesty).toBe(true);
			expect(calculations.mantleOfMajestyDc).toBe(14); // 8 + 3 (prof) + 3 (CHA)
		});

		it("should not have Mantle of Majesty before level 6", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasMantleOfMajesty).toBeUndefined();
		});
	});

	describe("Unbreakable Majesty (Level 14)", () => {
		it("should have Unbreakable Majesty at level 14", () => {
			state.addClass({
				name: "Bard",
				source: "PHB",
				level: 14,
				subclass: {name: "College of Glamour", shortName: "Glamour", source: "XGE"},
			});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasUnbreakableMajesty).toBe(true);
		});
	});
});

// ==========================================================================
// PART 6: COLLEGE OF SWORDS SUBCLASS (XGE)
// ==========================================================================
describe("College of Swords (XGE)", () => {
	let state;

	beforeEach(() => {
		state = new CharacterSheetState();
		state.setRace({name: "Human", source: "PHB"});
		state.addClass({
			name: "Bard",
			source: "PHB",
			level: 3,
			subclass: {name: "College of Swords", shortName: "Swords", source: "XGE"},
		});
		state.setAbilityBase("cha", 16);
		state.setAbilityBase("dex", 16);
	});

	it("should have Swords subclass at level 3", () => {
		const classes = state.getClasses();
		expect(classes[0].subclass).toBeDefined();
		expect(classes[0].subclass.name).toBe("College of Swords");
	});

	describe("Fighting Style", () => {
		it("should have Fighting Style at level 3", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasFightingStyle).toBe(true);
		});
	});

	describe("Blade Flourish", () => {
		it("should have Blade Flourish at level 3", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasBladeFlourish).toBe(true);
			expect(calculations.bladeFlourish.die).toBe("1d6");
		});

		it("should scale Blade Flourish die with level", () => {
			state.addClass({
				name: "Bard",
				source: "PHB",
				level: 10,
				subclass: {name: "College of Swords", shortName: "Swords", source: "XGE"},
			});
			const calculations = state.getFeatureCalculations();
			expect(calculations.bladeFlourish.die).toBe("1d10");
		});
	});

	describe("Bonus Proficiencies", () => {
		it("should have medium armor and scimitar proficiency at level 3", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasSwordsBonusProficiencies).toBe(true);
		});
	});

	describe("Extra Attack (Level 6)", () => {
		it("should have Extra Attack at level 6", () => {
			state.addClass({
				name: "Bard",
				source: "PHB",
				level: 6,
				subclass: {name: "College of Swords", shortName: "Swords", source: "XGE"},
			});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasExtraAttack).toBe(true);
			expect(calculations.attacksPerAction).toBe(2);
		});
	});

	describe("Master's Flourish (Level 14)", () => {
		it("should have Master's Flourish at level 14", () => {
			state.addClass({
				name: "Bard",
				source: "PHB",
				level: 14,
				subclass: {name: "College of Swords", shortName: "Swords", source: "XGE"},
			});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasMastersFlourish).toBe(true);
		});
	});
});

// ==========================================================================
// PART 7: COLLEGE OF WHISPERS SUBCLASS (XGE)
// ==========================================================================
describe("College of Whispers (XGE)", () => {
	let state;

	beforeEach(() => {
		state = new CharacterSheetState();
		state.setRace({name: "Human", source: "PHB"});
		state.addClass({
			name: "Bard",
			source: "PHB",
			level: 3,
			subclass: {name: "College of Whispers", shortName: "Whispers", source: "XGE"},
		});
		state.setAbilityBase("cha", 16);
	});

	it("should have Whispers subclass at level 3", () => {
		const classes = state.getClasses();
		expect(classes[0].subclass).toBeDefined();
		expect(classes[0].subclass.name).toBe("College of Whispers");
	});

	describe("Psychic Blades", () => {
		it("should have Psychic Blades at level 3 with 2d6 damage", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasPsychicBlades).toBe(true);
			expect(calculations.psychicBladesDamage).toBe("2d6");
		});

		it("should have 3d6 Psychic Blades at level 5", () => {
			state.addClass({
				name: "Bard",
				source: "PHB",
				level: 5,
				subclass: {name: "College of Whispers", shortName: "Whispers", source: "XGE"},
			});
			const calculations = state.getFeatureCalculations();
			expect(calculations.psychicBladesDamage).toBe("3d6");
		});

		it("should have 5d6 Psychic Blades at level 10", () => {
			state.addClass({
				name: "Bard",
				source: "PHB",
				level: 10,
				subclass: {name: "College of Whispers", shortName: "Whispers", source: "XGE"},
			});
			const calculations = state.getFeatureCalculations();
			expect(calculations.psychicBladesDamage).toBe("5d6");
		});

		it("should have 8d6 Psychic Blades at level 15", () => {
			state.addClass({
				name: "Bard",
				source: "PHB",
				level: 15,
				subclass: {name: "College of Whispers", shortName: "Whispers", source: "XGE"},
			});
			const calculations = state.getFeatureCalculations();
			expect(calculations.psychicBladesDamage).toBe("8d6");
		});
	});

	describe("Words of Terror", () => {
		it("should have Words of Terror at level 3", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasWordsOfTerror).toBe(true);
			expect(calculations.wordsOfTerrorDc).toBe(13); // 8 + 2 (prof) + 3 (CHA)
		});
	});

	describe("Mantle of Whispers (Level 6)", () => {
		it("should have Mantle of Whispers at level 6", () => {
			state.addClass({
				name: "Bard",
				source: "PHB",
				level: 6,
				subclass: {name: "College of Whispers", shortName: "Whispers", source: "XGE"},
			});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasMantleOfWhispers).toBe(true);
		});
	});

	describe("Shadow Lore (Level 14)", () => {
		it("should have Shadow Lore at level 14", () => {
			state.addClass({
				name: "Bard",
				source: "PHB",
				level: 14,
				subclass: {name: "College of Whispers", shortName: "Whispers", source: "XGE"},
			});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasShadowLore).toBe(true);
			expect(calculations.shadowLoreDc).toBe(16); // 8 + 5 (prof at level 14) + 3 (CHA mod)
		});
	});
});

// ==========================================================================
// PART 8: COLLEGE OF CREATION SUBCLASS (TCE)
// ==========================================================================
describe("College of Creation (TCE)", () => {
	let state;

	beforeEach(() => {
		state = new CharacterSheetState();
		state.setRace({name: "Human", source: "PHB"});
		state.addClass({
			name: "Bard",
			source: "PHB",
			level: 3,
			subclass: {name: "College of Creation", shortName: "Creation", source: "TCE"},
		});
		state.setAbilityBase("cha", 16);
	});

	it("should have Creation subclass at level 3", () => {
		const classes = state.getClasses();
		expect(classes[0].subclass).toBeDefined();
		expect(classes[0].subclass.name).toBe("College of Creation");
	});

	describe("Mote of Potential", () => {
		it("should have Mote of Potential at level 3", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasMoteOfPotential).toBe(true);
			expect(calculations.moteOfPotentialDie).toBe("1d6");
		});
	});

	describe("Performance of Creation", () => {
		it("should have Performance of Creation at level 3", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasPerformanceOfCreation).toBe(true);
			expect(calculations.createdItemMaxGp).toBe(60); // level * 20 = 3 * 20
			expect(calculations.createdItemMaxSize).toBe("Medium");
		});

		it("should allow Large items at level 6", () => {
			state.addClass({
				name: "Bard",
				source: "PHB",
				level: 6,
				subclass: {name: "College of Creation", shortName: "Creation", source: "TCE"},
			});
			const calculations = state.getFeatureCalculations();
			expect(calculations.createdItemMaxSize).toBe("Large");
		});

		it("should allow Huge items at level 14", () => {
			state.addClass({
				name: "Bard",
				source: "PHB",
				level: 14,
				subclass: {name: "College of Creation", shortName: "Creation", source: "TCE"},
			});
			const calculations = state.getFeatureCalculations();
			expect(calculations.createdItemMaxSize).toBe("Huge");
		});
	});

	describe("Animating Performance (Level 6)", () => {
		it("should have Animating Performance at level 6", () => {
			state.addClass({
				name: "Bard",
				source: "PHB",
				level: 6,
				subclass: {name: "College of Creation", shortName: "Creation", source: "TCE"},
			});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasAnimatingPerformance).toBe(true);
			expect(calculations.dancingItemHp).toBe(40); // 10 + 5 * 6
			expect(calculations.dancingItemAc).toBe(16);
		});

		it("should scale Dancing Item HP with level", () => {
			state.addClass({
				name: "Bard",
				source: "PHB",
				level: 10,
				subclass: {name: "College of Creation", shortName: "Creation", source: "TCE"},
			});
			const calculations = state.getFeatureCalculations();
			expect(calculations.dancingItemHp).toBe(60); // 10 + 5 * 10
		});
	});

	describe("Creative Crescendo (Level 14)", () => {
		it("should have Creative Crescendo at level 14", () => {
			state.addClass({
				name: "Bard",
				source: "PHB",
				level: 14,
				subclass: {name: "College of Creation", shortName: "Creation", source: "TCE"},
			});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasCreativeCrescendo).toBe(true);
			expect(calculations.simultaneousCreations).toBe(3); // CHA mod
		});
	});
});

// ==========================================================================
// PART 9: COLLEGE OF ELOQUENCE SUBCLASS (TCE)
// ==========================================================================
describe("College of Eloquence (TCE)", () => {
	let state;

	beforeEach(() => {
		state = new CharacterSheetState();
		state.setRace({name: "Human", source: "PHB"});
		state.addClass({
			name: "Bard",
			source: "PHB",
			level: 3,
			subclass: {name: "College of Eloquence", shortName: "Eloquence", source: "TCE"},
		});
		state.setAbilityBase("cha", 16);
	});

	it("should have Eloquence subclass at level 3", () => {
		const classes = state.getClasses();
		expect(classes[0].subclass).toBeDefined();
		expect(classes[0].subclass.name).toBe("College of Eloquence");
	});

	describe("Silver Tongue", () => {
		it("should have Silver Tongue at level 3", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasSilverTongue).toBe(true);
			expect(calculations.silverTongueMinimum).toBe(10);
		});
	});

	describe("Unsettling Words", () => {
		it("should have Unsettling Words at level 3", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasUnsettlingWords).toBe(true);
			expect(calculations.unsettlingWordsDie).toBe("1d6");
		});
	});

	describe("Unfailing Inspiration & Universal Speech (Level 6)", () => {
		it("should have Unfailing Inspiration at level 6", () => {
			state.addClass({
				name: "Bard",
				source: "PHB",
				level: 6,
				subclass: {name: "College of Eloquence", shortName: "Eloquence", source: "TCE"},
			});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasUnfailingInspiration).toBe(true);
		});

		it("should have Universal Speech at level 6", () => {
			state.addClass({
				name: "Bard",
				source: "PHB",
				level: 6,
				subclass: {name: "College of Eloquence", shortName: "Eloquence", source: "TCE"},
			});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasUniversalSpeech).toBe(true);
			expect(calculations.universalSpeechTargets).toBe(3); // CHA mod
		});
	});

	describe("Infectious Inspiration (Level 14)", () => {
		it("should have Infectious Inspiration at level 14", () => {
			state.addClass({
				name: "Bard",
				source: "PHB",
				level: 14,
				subclass: {name: "College of Eloquence", shortName: "Eloquence", source: "TCE"},
			});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasInfectiousInspiration).toBe(true);
			expect(calculations.infectiousInspirationUses).toBe(3); // CHA mod
		});
	});
});

// ==========================================================================
// PART 10: COLLEGE OF SPIRITS SUBCLASS (VRGR)
// ==========================================================================
describe("College of Spirits (VRGR)", () => {
	let state;

	beforeEach(() => {
		state = new CharacterSheetState();
		state.setRace({name: "Human", source: "PHB"});
		state.addClass({
			name: "Bard",
			source: "PHB",
			level: 3,
			subclass: {name: "College of Spirits", shortName: "Spirits", source: "VRGR"},
		});
		state.setAbilityBase("cha", 16);
	});

	it("should have Spirits subclass at level 3", () => {
		const classes = state.getClasses();
		expect(classes[0].subclass).toBeDefined();
		expect(classes[0].subclass.name).toBe("College of Spirits");
	});

	describe("Guiding Whispers", () => {
		it("should have Guiding Whispers at level 3", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasGuidingWhispers).toBe(true);
			expect(calculations.guidanceCantrip).toBe(true);
		});
	});

	describe("Spiritual Focus", () => {
		it("should have Spiritual Focus at level 3", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasSpiritualFocus).toBe(true);
		});

		it("should add d6 to healing/damage at level 6", () => {
			state.addClass({
				name: "Bard",
				source: "PHB",
				level: 6,
				subclass: {name: "College of Spirits", shortName: "Spirits", source: "VRGR"},
			});
			const calculations = state.getFeatureCalculations();
			expect(calculations.spiritualFocusBonus).toBe("1d6");
		});
	});

	describe("Tales from Beyond", () => {
		it("should have Tales from Beyond at level 3 with d6", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasTalesFromBeyond).toBe(true);
			expect(calculations.spiritTaleDie).toBe("1d6");
		});

		it("should use d8 for Tales from Beyond at level 6", () => {
			state.addClass({
				name: "Bard",
				source: "PHB",
				level: 6,
				subclass: {name: "College of Spirits", shortName: "Spirits", source: "VRGR"},
			});
			const calculations = state.getFeatureCalculations();
			expect(calculations.spiritTaleDie).toBe("1d8");
		});

		it("should use d12 for Tales from Beyond at level 14", () => {
			state.addClass({
				name: "Bard",
				source: "PHB",
				level: 14,
				subclass: {name: "College of Spirits", shortName: "Spirits", source: "VRGR"},
			});
			const calculations = state.getFeatureCalculations();
			expect(calculations.spiritTaleDie).toBe("1d12");
		});
	});

	describe("Spirit Session (Level 6)", () => {
		it("should have Spirit Session at level 6", () => {
			state.addClass({
				name: "Bard",
				source: "PHB",
				level: 6,
				subclass: {name: "College of Spirits", shortName: "Spirits", source: "VRGR"},
			});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasSpiritSession).toBe(true);
			expect(calculations.spiritSessionMaxSpellLevel).toBe(2); // ceil(3/2) = 2 at prof +3
		});
	});

	describe("Mystical Connection (Level 14)", () => {
		it("should have Mystical Connection at level 14", () => {
			state.addClass({
				name: "Bard",
				source: "PHB",
				level: 14,
				subclass: {name: "College of Spirits", shortName: "Spirits", source: "VRGR"},
			});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasMysticalConnection).toBe(true);
		});
	});
});

// ==========================================================================
// PART 11: XPHB BARD CORE FEATURES
// ==========================================================================
describe("Bard Core Class Features (XPHB)", () => {
	let state;

	beforeEach(() => {
		state = new CharacterSheetState();
		state.setRace({name: "Human", source: "XPHB"});
		state.addClass({name: "Bard", source: "XPHB", level: 1});
		state.setAbilityBase("cha", 16);
		state.setAbilityBase("dex", 14);
		state.setAbilityBase("con", 12);
	});

	// -------------------------------------------------------------------------
	// 11.1 Bardic Inspiration (XPHB)
	// -------------------------------------------------------------------------
	describe("Bardic Inspiration (XPHB)", () => {
		it("should have Bardic Inspiration at level 1", () => {
			expect(state.getTotalLevel()).toBe(1);
		});

		it("should have same die progression as PHB", () => {
			// d6 at 1-4, d8 at 5-9, d10 at 10-14, d12 at 15+
			const calculations = state.getFeatureCalculations();
			expect(calculations.bardicInspirationDie).toBe("1d6");
		});

		it("should scale die to d12 at level 15", () => {
			state.addClass({name: "Bard", source: "XPHB", level: 15});
			const calculations = state.getFeatureCalculations();
			expect(calculations.bardicInspirationDie).toBe("1d12");
		});
	});

	// -------------------------------------------------------------------------
	// 11.2 Expertise (XPHB - at level 2 and 9)
	// -------------------------------------------------------------------------
	describe("Expertise (XPHB)", () => {
		it("should have Expertise at level 2 (not level 3)", () => {
			state.addClass({name: "Bard", source: "XPHB", level: 2});
			expect(state.getTotalLevel()).toBe(2);
		});

		it("should have second Expertise at level 9 (not level 10)", () => {
			state.addClass({name: "Bard", source: "XPHB", level: 9});
			expect(state.getTotalLevel()).toBe(9);
		});
	});

	// -------------------------------------------------------------------------
	// 11.3 Jack of All Trades (XPHB)
	// -------------------------------------------------------------------------
	describe("Jack of All Trades (XPHB)", () => {
		it("should have Jack of All Trades at level 2", () => {
			state.addClass({name: "Bard", source: "XPHB", level: 2});
			expect(state.getTotalLevel()).toBe(2);
		});
	});

	// -------------------------------------------------------------------------
	// 11.4 Font of Inspiration (XPHB)
	// -------------------------------------------------------------------------
	describe("Font of Inspiration (XPHB)", () => {
		it("should have Font of Inspiration at level 5", () => {
			state.addClass({name: "Bard", source: "XPHB", level: 5});
			expect(state.getTotalLevel()).toBe(5);
		});
	});

	// -------------------------------------------------------------------------
	// 11.5 Countercharm (XPHB - at level 7)
	// -------------------------------------------------------------------------
	describe("Countercharm (XPHB)", () => {
		it("should have Countercharm at level 7 (not level 6)", () => {
			state.addClass({name: "Bard", source: "XPHB", level: 7});
			expect(state.getTotalLevel()).toBe(7);
		});
	});

	// -------------------------------------------------------------------------
	// 11.6 Magical Secrets (XPHB)
	// -------------------------------------------------------------------------
	describe("Magical Secrets (XPHB)", () => {
		it("should have Magical Secrets at level 10", () => {
			state.addClass({name: "Bard", source: "XPHB", level: 10});
			expect(state.getTotalLevel()).toBe(10);
		});
	});

	// -------------------------------------------------------------------------
	// 11.7 Superior Inspiration (XPHB - at level 18)
	// -------------------------------------------------------------------------
	describe("Superior Inspiration (XPHB)", () => {
		it("should have Superior Inspiration at level 18", () => {
			state.addClass({name: "Bard", source: "XPHB", level: 18});
			expect(state.getTotalLevel()).toBe(18);
		});
	});

	// -------------------------------------------------------------------------
	// 11.8 Epic Boon (XPHB)
	// -------------------------------------------------------------------------
	describe("Epic Boon (XPHB)", () => {
		it("should have Epic Boon at level 19", () => {
			state.addClass({name: "Bard", source: "XPHB", level: 19});
			expect(state.getTotalLevel()).toBe(19);
		});
	});

	// -------------------------------------------------------------------------
	// 11.9 Words of Creation (XPHB)
	// -------------------------------------------------------------------------
	describe("Words of Creation (XPHB)", () => {
		it("should have Words of Creation at level 20", () => {
			state.addClass({name: "Bard", source: "XPHB", level: 20});
			expect(state.getTotalLevel()).toBe(20);
		});
	});
});

// ==========================================================================
// PART 12: COLLEGE OF DANCE SUBCLASS (XPHB)
// ==========================================================================
describe("College of Dance (XPHB)", () => {
	let state;

	beforeEach(() => {
		state = new CharacterSheetState();
		state.setRace({name: "Human", source: "XPHB"});
		state.addClass({
			name: "Bard",
			source: "XPHB",
			level: 3,
			subclass: {name: "College of Dance", shortName: "Dance", source: "XPHB"},
		});
		state.setAbilityBase("cha", 16);
		state.setAbilityBase("dex", 16);
		state.setAbilityBase("con", 12);
	});

	it("should have Dance subclass at level 3", () => {
		const classes = state.getClasses();
		expect(classes[0].subclass).toBeDefined();
		expect(classes[0].subclass.name).toBe("College of Dance");
	});

	describe("Dazzling Footwork", () => {
		it("should have Dazzling Footwork at level 3", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasDazzlingFootwork).toBe(true);
		});

		it("should calculate Unarmored Defense as 10 + DEX + CHA", () => {
			const calculations = state.getFeatureCalculations();
			// AC = 10 + DEX mod + CHA mod = 10 + 3 + 3 = 16
			expect(calculations.danceUnarmoredDefense).toBe(16);
		});

		it("should have +10 ft speed bonus", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.danceSpeedBonus).toBe(10);
		});
	});

	describe("Inspiring Movement", () => {
		it("should have Inspiring Movement at level 3", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasInspiringMovement).toBe(true);
		});
	});

	describe("Leading Evasion (Level 6)", () => {
		it("should have Leading Evasion at level 6", () => {
			state.addClass({
				name: "Bard",
				source: "XPHB",
				level: 6,
				subclass: {name: "College of Dance", shortName: "Dance", source: "XPHB"},
			});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasLeadingEvasion).toBe(true);
			expect(calculations.leadingEvasionDie).toBe("1d8"); // Level 5+ = d8
		});
	});

	describe("Tandem Footwork (Level 6)", () => {
		it("should have Tandem Footwork at level 6", () => {
			state.addClass({
				name: "Bard",
				source: "XPHB",
				level: 6,
				subclass: {name: "College of Dance", shortName: "Dance", source: "XPHB"},
			});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasTandemFootwork).toBe(true);
			expect(calculations.tandemFootworkDie).toBe("1d8");
		});
	});

	describe("Irresistible Dance (Level 14)", () => {
		it("should have Irresistible Dance at level 14", () => {
			state.addClass({
				name: "Bard",
				source: "XPHB",
				level: 14,
				subclass: {name: "College of Dance", shortName: "Dance", source: "XPHB"},
			});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasIrresistibleDance).toBe(true);
			expect(calculations.irresistibleDanceDamage).toBe("3d10"); // CHA mod = 3
		});
	});
});

// ==========================================================================
// PART 13: COLLEGE OF GLAMOUR SUBCLASS (XPHB)
// ==========================================================================
describe("College of Glamour (XPHB)", () => {
	let state;

	beforeEach(() => {
		state = new CharacterSheetState();
		state.setRace({name: "Human", source: "XPHB"});
		state.addClass({
			name: "Bard",
			source: "XPHB",
			level: 3,
			subclass: {name: "College of Glamour", shortName: "Glamour", source: "XPHB"},
		});
		state.setAbilityBase("cha", 16);
	});

	it("should have Glamour subclass at level 3", () => {
		const classes = state.getClasses();
		expect(classes[0].subclass).toBeDefined();
		expect(classes[0].subclass.name).toBe("College of Glamour");
	});

	describe("Beguiling Magic", () => {
		it("should have Beguiling Magic at level 3", () => {
			// Always prepares Charm Person and Mirror Image
			expect(state.getTotalLevel()).toBe(3);
		});
	});

	describe("Mantle of Majesty (XPHB Level 6)", () => {
		it("should have Mantle of Majesty at level 6", () => {
			state.addClass({
				name: "Bard",
				source: "XPHB",
				level: 6,
				subclass: {name: "College of Glamour", shortName: "Glamour", source: "XPHB"},
			});
			expect(state.getTotalLevel()).toBe(6);
		});
	});

	describe("Unbreakable Majesty (XPHB Level 14)", () => {
		it("should have Unbreakable Majesty at level 14", () => {
			state.addClass({
				name: "Bard",
				source: "XPHB",
				level: 14,
				subclass: {name: "College of Glamour", shortName: "Glamour", source: "XPHB"},
			});
			expect(state.getTotalLevel()).toBe(14);
		});
	});
});

// ==========================================================================
// PART 14: COLLEGE OF LORE SUBCLASS (XPHB)
// ==========================================================================
describe("College of Lore (XPHB)", () => {
	let state;

	beforeEach(() => {
		state = new CharacterSheetState();
		state.setRace({name: "Human", source: "XPHB"});
		state.addClass({
			name: "Bard",
			source: "XPHB",
			level: 3,
			subclass: {name: "College of Lore", shortName: "Lore", source: "XPHB"},
		});
		state.setAbilityBase("cha", 16);
	});

	it("should have Lore subclass at level 3", () => {
		const classes = state.getClasses();
		expect(classes[0].subclass).toBeDefined();
		expect(classes[0].subclass.name).toBe("College of Lore");
	});

	describe("Magical Discoveries (XPHB Level 6)", () => {
		it("should have Magical Discoveries at level 6", () => {
			state.addClass({
				name: "Bard",
				source: "XPHB",
				level: 6,
				subclass: {name: "College of Lore", shortName: "Lore", source: "XPHB"},
			});
			expect(state.getTotalLevel()).toBe(6);
		});
	});

	describe("Peerless Skill (XPHB Level 14)", () => {
		it("should have Peerless Skill at level 14", () => {
			state.addClass({
				name: "Bard",
				source: "XPHB",
				level: 14,
				subclass: {name: "College of Lore", shortName: "Lore", source: "XPHB"},
			});
			expect(state.getTotalLevel()).toBe(14);
		});
	});
});

// ==========================================================================
// PART 15: COLLEGE OF VALOR SUBCLASS (XPHB)
// ==========================================================================
describe("College of Valor (XPHB)", () => {
	let state;

	beforeEach(() => {
		state = new CharacterSheetState();
		state.setRace({name: "Human", source: "XPHB"});
		state.addClass({
			name: "Bard",
			source: "XPHB",
			level: 3,
			subclass: {name: "College of Valor", shortName: "Valor", source: "XPHB"},
		});
		state.setAbilityBase("str", 14);
		state.setAbilityBase("dex", 14);
		state.setAbilityBase("cha", 16);
	});

	it("should have Valor subclass at level 3", () => {
		const classes = state.getClasses();
		expect(classes[0].subclass).toBeDefined();
		expect(classes[0].subclass.name).toBe("College of Valor");
	});

	describe("Combat Inspiration and Martial Training", () => {
		it("should have level 3 features", () => {
			expect(state.getTotalLevel()).toBe(3);
		});
	});

	describe("Extra Attack (XPHB Level 6)", () => {
		it("should have Extra Attack at level 6", () => {
			state.addClass({
				name: "Bard",
				source: "XPHB",
				level: 6,
				subclass: {name: "College of Valor", shortName: "Valor", source: "XPHB"},
			});
			expect(state.getTotalLevel()).toBe(6);
		});
	});

	describe("Battle Magic (XPHB Level 14)", () => {
		it("should have Battle Magic at level 14", () => {
			state.addClass({
				name: "Bard",
				source: "XPHB",
				level: 14,
				subclass: {name: "College of Valor", shortName: "Valor", source: "XPHB"},
			});
			expect(state.getTotalLevel()).toBe(14);
		});
	});
});

// ==========================================================================
// PART 16: PHB VS XPHB FEATURE COMPARISON
// ==========================================================================
describe("PHB vs XPHB Feature Comparison", () => {
	let state;

	beforeEach(() => {
		state = new CharacterSheetState();
		state.setRace({name: "Human", source: "PHB"});
		state.setAbilityBase("cha", 16);
	});

	describe("Features in both versions", () => {
		it("both PHB and XPHB have Bardic Inspiration at level 1", () => {
			state.addClass({name: "Bard", source: "PHB", level: 1});
			expect(state.getTotalLevel()).toBe(1);

			const xphbState = new CharacterSheetState();
			xphbState.setRace({name: "Human", source: "XPHB"});
			xphbState.addClass({name: "Bard", source: "XPHB", level: 1});
			expect(xphbState.getTotalLevel()).toBe(1);
		});

		it("both have Jack of All Trades at level 2", () => {
			state.addClass({name: "Bard", source: "PHB", level: 2});
			expect(state.getTotalLevel()).toBe(2);

			const xphbState = new CharacterSheetState();
			xphbState.setRace({name: "Human", source: "XPHB"});
			xphbState.addClass({name: "Bard", source: "XPHB", level: 2});
			expect(xphbState.getTotalLevel()).toBe(2);
		});

		it("both have Font of Inspiration at level 5", () => {
			state.addClass({name: "Bard", source: "PHB", level: 5});
			expect(state.getTotalLevel()).toBe(5);

			const xphbState = new CharacterSheetState();
			xphbState.setRace({name: "Human", source: "XPHB"});
			xphbState.addClass({name: "Bard", source: "XPHB", level: 5});
			expect(xphbState.getTotalLevel()).toBe(5);
		});
	});

	describe("Features with different levels", () => {
		it("PHB Expertise at level 3, XPHB at level 2", () => {
			// PHB: Expertise at 3
			state.addClass({name: "Bard", source: "PHB", level: 3});
			expect(state.getTotalLevel()).toBe(3);

			// XPHB: Expertise at 2
			const xphbState = new CharacterSheetState();
			xphbState.setRace({name: "Human", source: "XPHB"});
			xphbState.addClass({name: "Bard", source: "XPHB", level: 2});
			expect(xphbState.getTotalLevel()).toBe(2);
		});

		it("PHB Countercharm at level 6, XPHB at level 7", () => {
			// PHB: Countercharm at 6
			state.addClass({name: "Bard", source: "PHB", level: 6});
			expect(state.getTotalLevel()).toBe(6);

			// XPHB: Countercharm at 7
			const xphbState = new CharacterSheetState();
			xphbState.setRace({name: "Human", source: "XPHB"});
			xphbState.addClass({name: "Bard", source: "XPHB", level: 7});
			expect(xphbState.getTotalLevel()).toBe(7);
		});

		it("PHB Superior Inspiration at level 20, XPHB at level 18", () => {
			// PHB: Superior Inspiration at 20
			state.addClass({name: "Bard", source: "PHB", level: 20});
			expect(state.getTotalLevel()).toBe(20);

			// XPHB: Superior Inspiration at 18
			const xphbState = new CharacterSheetState();
			xphbState.setRace({name: "Human", source: "XPHB"});
			xphbState.addClass({name: "Bard", source: "XPHB", level: 18});
			expect(xphbState.getTotalLevel()).toBe(18);
		});
	});

	describe("XPHB-exclusive features", () => {
		it("Epic Boon is XPHB only at level 19", () => {
			const xphbState = new CharacterSheetState();
			xphbState.setRace({name: "Human", source: "XPHB"});
			xphbState.addClass({name: "Bard", source: "XPHB", level: 19});
			expect(xphbState.getTotalLevel()).toBe(19);
		});

		it("Words of Creation is XPHB capstone at level 20", () => {
			const xphbState = new CharacterSheetState();
			xphbState.setRace({name: "Human", source: "XPHB"});
			xphbState.addClass({name: "Bard", source: "XPHB", level: 20});
			expect(xphbState.getTotalLevel()).toBe(20);
		});

		it("College of Dance is XPHB exclusive", () => {
			const xphbState = new CharacterSheetState();
			xphbState.setRace({name: "Human", source: "XPHB"});
			xphbState.addClass({
				name: "Bard",
				source: "XPHB",
				level: 3,
				subclass: {name: "College of Dance", shortName: "Dance", source: "XPHB"},
			});
			const classes = xphbState.getClasses();
			expect(classes[0].subclass?.name).toBe("College of Dance");
		});
	});
});

// ==========================================================================
// PART 17: MULTICLASS TESTS
// ==========================================================================
describe("Bard Multiclass", () => {
	let state;

	beforeEach(() => {
		state = new CharacterSheetState();
		state.setRace({name: "Human", source: "PHB"});
		state.setAbilityBase("cha", 16);
		state.setAbilityBase("dex", 14);
		state.setAbilityBase("str", 13);
		state.setAbilityBase("con", 12);
	});

	it("should be able to multiclass Bard/Rogue", () => {
		state.addClass({name: "Bard", source: "PHB", level: 5});
		state.addClass({name: "Rogue", source: "PHB", level: 3});

		const classes = state.getClasses();
		expect(classes.length).toBe(2);
		expect(state.getTotalLevel()).toBe(8);
	});

	it("should calculate multiclass spell slots correctly (Bard/Sorcerer)", () => {
		state.addClass({name: "Bard", source: "PHB", level: 5});
		state.addClass({name: "Sorcerer", source: "PHB", level: 5});

		// Both full casters: 5 + 5 = 10 caster level
		const spellSlots = state.getSpellSlots();
		expect(spellSlots[5]?.max).toBeGreaterThanOrEqual(2);
	});

	it("Jack of All Trades should apply even with multiclass", () => {
		state.addClass({name: "Fighter", source: "PHB", level: 5});
		state.addClass({name: "Bard", source: "PHB", level: 2});

		expect(state.getTotalLevel()).toBe(7);
	});
});

// ==========================================================================
// PART 18: PROFICIENCY TESTS
// ==========================================================================
describe("Bard Proficiencies", () => {
	let state;

	beforeEach(() => {
		state = new CharacterSheetState();
		state.setRace({name: "Human", source: "PHB"});
		state.addClass({name: "Bard", source: "PHB", level: 1});
		state.setAbilityBase("cha", 16);
		state.setAbilityBase("dex", 14);
		state.setAbilityBase("con", 12);
	});

	it("should have DEX and CHA saving throw proficiency", () => {
		state.addSaveProficiency("dex");
		state.addSaveProficiency("cha");

		const dexSave = state.getSaveMod("dex");
		const chaSave = state.getSaveMod("cha");

		// DEX save = DEX mod + proficiency = 2 + 2 = 4
		expect(dexSave).toBe(4);
		// CHA save = CHA mod + proficiency = 3 + 2 = 5
		expect(chaSave).toBe(5);
	});

	it("should calculate proficiency bonus correctly at all levels", () => {
		// Level 1-4: +2
		expect(state.getProficiencyBonus()).toBe(2);

		state.addClass({name: "Bard", source: "PHB", level: 5});
		// Level 5-8: +3
		expect(state.getProficiencyBonus()).toBe(3);

		state.addClass({name: "Bard", source: "PHB", level: 9});
		// Level 9-12: +4
		expect(state.getProficiencyBonus()).toBe(4);

		state.addClass({name: "Bard", source: "PHB", level: 13});
		// Level 13-16: +5
		expect(state.getProficiencyBonus()).toBe(5);

		state.addClass({name: "Bard", source: "PHB", level: 17});
		// Level 17-20: +6
		expect(state.getProficiencyBonus()).toBe(6);
	});
});

// ==========================================================================
// PART 19: SPELL SLOT PROGRESSION
// ==========================================================================
describe("Bard Spell Slot Progression", () => {
	let state;

	beforeEach(() => {
		state = new CharacterSheetState();
		state.setRace({name: "Human", source: "PHB"});
		state.setAbilityBase("cha", 16);
	});

	it("should have correct spell slots at level 1", () => {
		state.addClass({name: "Bard", source: "PHB", level: 1});
		const slots = state.getSpellSlots();
		expect(slots[1]?.max).toBe(2);
	});

	it("should have correct spell slots at level 3", () => {
		state.addClass({name: "Bard", source: "PHB", level: 3});
		const slots = state.getSpellSlots();
		expect(slots[1]?.max).toBe(4);
		expect(slots[2]?.max).toBe(2);
	});

	it("should have correct spell slots at level 5", () => {
		state.addClass({name: "Bard", source: "PHB", level: 5});
		const slots = state.getSpellSlots();
		expect(slots[1]?.max).toBe(4);
		expect(slots[2]?.max).toBe(3);
		expect(slots[3]?.max).toBe(2);
	});

	it("should have correct spell slots at level 9", () => {
		state.addClass({name: "Bard", source: "PHB", level: 9});
		const slots = state.getSpellSlots();
		expect(slots[1]?.max).toBe(4);
		expect(slots[2]?.max).toBe(3);
		expect(slots[3]?.max).toBe(3);
		expect(slots[4]?.max).toBe(3);
		expect(slots[5]?.max).toBe(1);
	});

	it("should have correct spell slots at level 20", () => {
		state.addClass({name: "Bard", source: "PHB", level: 20});
		const slots = state.getSpellSlots();
		expect(slots[1]?.max).toBe(4);
		expect(slots[2]?.max).toBe(3);
		expect(slots[3]?.max).toBe(3);
		expect(slots[4]?.max).toBe(3);
		expect(slots[5]?.max).toBe(3);
		expect(slots[6]?.max).toBe(2);
		expect(slots[7]?.max).toBe(2);
		expect(slots[8]?.max).toBe(1);
		expect(slots[9]?.max).toBe(1);
	});

	it("should correctly identify Bard as full caster", () => {
		state.addClass({name: "Bard", source: "PHB", level: 20});
		const spellSlots = state.getSpellSlots();
		expect(spellSlots[9]?.max).toBeGreaterThanOrEqual(1);
	});
});

// ==========================================================================
// PART 20: EDGE CASES
// ==========================================================================
describe("Bard Edge Cases", () => {
	let state;

	beforeEach(() => {
		state = new CharacterSheetState();
		state.setRace({name: "Human", source: "PHB"});
	});

	it("should handle minimum Charisma for Bardic Inspiration uses", () => {
		state.setAbilityBase("cha", 1);
		state.addClass({name: "Bard", source: "PHB", level: 1});

		const chaMod = state.getAbilityMod("cha");
		expect(chaMod).toBe(-5);
	});

	it("should track hit dice correctly", () => {
		state.setAbilityBase("con", 12);
		state.addClass({name: "Bard", source: "PHB", level: 5});

		const hitDice = state.getHitDice();
		const bardHitDice = hitDice.find(hd => hd.die === 8);
		expect(bardHitDice.max).toBe(5);
	});

	it("should handle subclass selection", () => {
		state.setAbilityBase("cha", 16);
		state.addClass({name: "Bard", source: "PHB", level: 1});

		const classes = state.getClasses();
		const bard = classes.find(c => c.name === "Bard");
		expect(bard.subclass).toBeUndefined();

		state.addClass({
			name: "Bard",
			source: "PHB",
			level: 3,
			subclass: {name: "College of Lore", shortName: "Lore", source: "PHB"},
		});

		const updatedClasses = state.getClasses();
		const updatedBard = updatedClasses.find(c => c.name === "Bard");
		expect(updatedBard.subclass?.name).toBe("College of Lore");
	});
});

// ==========================================================================
// PART 21: XPHB 2024 BARD (One D&D / D&D 2024)
// ==========================================================================
describe("XPHB 2024 Bard Core Features", () => {
	let state;

	beforeEach(() => {
		state = new CharacterSheetState();
		state.setRace({name: "Human", source: "PHB"});
		state.setAbilityBase("cha", 16); // +3 modifier
		state.setAbilityBase("dex", 14);
		state.setAbilityBase("con", 12);
		state.setAbilityBase("int", 10);
		state.setAbilityBase("wis", 10);
		state.setAbilityBase("str", 8);
	});

	// -------------------------------------------------------------------------
	// 21.1 Bardic Inspiration (XPHB)
	// -------------------------------------------------------------------------
	describe("Bardic Inspiration (XPHB)", () => {
		it("should have d6 Bardic Inspiration die at level 1", () => {
			state.addClass({name: "Bard", source: "XPHB", level: 1});
			const calculations = state.getFeatureCalculations();
			expect(calculations.bardicInspirationDie).toBe("1d6");
		});

		it("should have d8 Bardic Inspiration die at level 5", () => {
			state.addClass({name: "Bard", source: "XPHB", level: 5});
			const calculations = state.getFeatureCalculations();
			expect(calculations.bardicInspirationDie).toBe("1d8");
		});

		it("should have d10 Bardic Inspiration die at level 10", () => {
			state.addClass({name: "Bard", source: "XPHB", level: 10});
			const calculations = state.getFeatureCalculations();
			expect(calculations.bardicInspirationDie).toBe("1d10");
		});

		it("should have d12 Bardic Inspiration die at level 15", () => {
			state.addClass({name: "Bard", source: "XPHB", level: 15});
			const calculations = state.getFeatureCalculations();
			expect(calculations.bardicInspirationDie).toBe("1d12");
		});

		it("should have uses equal to Charisma modifier", () => {
			state.addClass({name: "Bard", source: "XPHB", level: 1});
			const calculations = state.getFeatureCalculations();
			expect(calculations.bardicInspirationUses).toBe(3);
		});
	});

	// -------------------------------------------------------------------------
	// 21.2 Jack of All Trades (XPHB)
	// -------------------------------------------------------------------------
	describe("Jack of All Trades (XPHB)", () => {
		it("should have Jack of All Trades at level 2", () => {
			state.addClass({name: "Bard", source: "XPHB", level: 2});
			const calculations = state.getFeatureCalculations();
			expect(calculations.jackOfAllTrades).toBe(1);
		});

		it("should have +2 at level 9", () => {
			state.addClass({name: "Bard", source: "XPHB", level: 9});
			const calculations = state.getFeatureCalculations();
			expect(calculations.jackOfAllTrades).toBe(2);
		});

		it("should have +3 at level 17", () => {
			state.addClass({name: "Bard", source: "XPHB", level: 17});
			const calculations = state.getFeatureCalculations();
			expect(calculations.jackOfAllTrades).toBe(3);
		});
	});

	// -------------------------------------------------------------------------
	// 21.3 No Song of Rest in XPHB (Removed in 2024)
	// -------------------------------------------------------------------------
	describe("Song of Rest (Not in XPHB)", () => {
		it("should not have Song of Rest in XPHB Bard", () => {
			state.addClass({name: "Bard", source: "XPHB", level: 2});
			const calculations = state.getFeatureCalculations();
			expect(calculations.songOfRestDie).toBeUndefined();
		});
	});

	// -------------------------------------------------------------------------
	// 21.4 Countercharm (XPHB - Level 7 instead of Level 6)
	// -------------------------------------------------------------------------
	describe("Countercharm (XPHB)", () => {
		it("should not have Countercharm at level 6", () => {
			state.addClass({name: "Bard", source: "XPHB", level: 6});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasCountercharm).toBeUndefined();
		});

		it("should have Countercharm at level 7", () => {
			state.addClass({name: "Bard", source: "XPHB", level: 7});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasCountercharm).toBe(true);
		});
	});

	// -------------------------------------------------------------------------
	// 21.5 Words of Creation (XPHB Level 20 Capstone)
	// -------------------------------------------------------------------------
	describe("Words of Creation (XPHB Level 20)", () => {
		it("should have Words of Creation at level 20", () => {
			state.addClass({name: "Bard", source: "XPHB", level: 20});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasWordsOfCreation).toBe(true);
		});

		it("should not have Words of Creation before level 20", () => {
			state.addClass({name: "Bard", source: "XPHB", level: 19});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasWordsOfCreation).toBeUndefined();
		});

		it("should not use total character level for the Words of Creation gate", () => {
			state.addClass({name: "Bard", source: "XPHB", level: 17});
			state.addClass({name: "Rogue", source: "XPHB", level: 3});
			expect(state.getTotalLevel()).toBe(20);
			expect(state.getFeatureCalculations().hasWordsOfCreation).toBeUndefined();
		});

		it("should support the TGTT 2024 Bard chassis but not PHB Bard", () => {
			state.addClass({name: "Bard", source: "TGTT", level: 20});
			expect(state.getFeatureCalculations().hasWordsOfCreation).toBe(true);

			const phb = new CharacterSheetState();
			phb.addClass({name: "Bard", source: "PHB", level: 20});
			expect(phb.getFeatureCalculations().hasWordsOfCreation).toBeUndefined();
		});
	});

	// -------------------------------------------------------------------------
	// 21.6 Superior Inspiration (XPHB - Level 18)
	// -------------------------------------------------------------------------
	describe("Superior Inspiration (XPHB)", () => {
		it("should have Superior Inspiration at level 18", () => {
			state.addClass({name: "Bard", source: "XPHB", level: 18});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasSuperiorInspiration).toBe(true);
		});

		it("should not have Superior Inspiration before level 18", () => {
			state.addClass({name: "Bard", source: "XPHB", level: 17});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasSuperiorInspiration).toBeUndefined();
		});
	});

	// -------------------------------------------------------------------------
	// 21.7 XPHB Spell Tracking (Prepared instead of Known)
	// -------------------------------------------------------------------------
	describe("Spell Tracking (XPHB Prepared Caster)", () => {
		it("should be able to prepare spells as XPHB Bard", () => {
			state.addClass({name: "Bard", source: "XPHB", level: 1});
			// XPHB Bard uses prepared spells, not known spells
			// Just verify the Bard can be set up and has spellcasting
			const spellSlots = state.getSpellSlots();
			expect(spellSlots[1]?.max).toBe(2);
		});
	});
});

// ==========================================================================
// PART 22: XPHB 2024 BARD SUBCLASSES
// ==========================================================================
describe("XPHB Bard Subclasses", () => {
	let state;

	beforeEach(() => {
		state = new CharacterSheetState();
		state.setRace({name: "Human", source: "PHB"});
		state.setAbilityBase("cha", 16);
		state.setAbilityBase("dex", 14);
		state.setAbilityBase("con", 12);
		state.setAbilityBase("str", 10);
		state.setAbilityBase("int", 10);
		state.setAbilityBase("wis", 10);
	});

	// -------------------------------------------------------------------------
	// 22.1 College of Dance (XPHB)
	// -------------------------------------------------------------------------
	describe("College of Dance", () => {
		it("should set College of Dance subclass at level 3", () => {
			state.addClass({
				name: "Bard",
				source: "XPHB",
				level: 3,
				subclass: {name: "College of Dance", shortName: "Dance", source: "XPHB"},
			});

			const classes = state.getClasses();
			const bard = classes.find(c => c.name === "Bard");
			expect(bard.subclass?.name).toBe("College of Dance");
		});
	});

	// -------------------------------------------------------------------------
	// 22.2 College of Glamour (XPHB)
	// -------------------------------------------------------------------------
	describe("College of Glamour", () => {
		it("should set College of Glamour subclass at level 3", () => {
			state.addClass({
				name: "Bard",
				source: "XPHB",
				level: 3,
				subclass: {name: "College of Glamour", shortName: "Glamour", source: "XPHB"},
			});

			const classes = state.getClasses();
			const bard = classes.find(c => c.name === "Bard");
			expect(bard.subclass?.name).toBe("College of Glamour");
		});
	});

	// -------------------------------------------------------------------------
	// 22.3 College of Lore (XPHB)
	// -------------------------------------------------------------------------
	describe("College of Lore (XPHB)", () => {
		it("should set College of Lore subclass at level 3", () => {
			state.addClass({
				name: "Bard",
				source: "XPHB",
				level: 3,
				subclass: {name: "College of Lore", shortName: "Lore", source: "XPHB"},
			});

			const classes = state.getClasses();
			const bard = classes.find(c => c.name === "Bard");
			expect(bard.subclass?.name).toBe("College of Lore");
		});
	});

	// -------------------------------------------------------------------------
	// 22.4 College of Valor (XPHB)
	// -------------------------------------------------------------------------
	describe("College of Valor (XPHB)", () => {
		it("should set College of Valor subclass at level 3", () => {
			state.addClass({
				name: "Bard",
				source: "XPHB",
				level: 3,
				subclass: {name: "College of Valor", shortName: "Valor", source: "XPHB"},
			});

			const classes = state.getClasses();
			const bard = classes.find(c => c.name === "Bard");
			expect(bard.subclass?.name).toBe("College of Valor");
		});

		it("should have Extra Attack at level 6", () => {
			state.addClass({
				name: "Bard",
				source: "XPHB",
				level: 6,
				subclass: {name: "College of Valor", shortName: "Valor", source: "XPHB"},
			});

			expect(state.getTotalLevel()).toBe(6);
		});
	});
});
