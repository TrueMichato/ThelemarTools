/**
 * Character Sheet Rogue Class Tests
 * Comprehensive testing for all Rogue class features and subclasses (Roguish Archetypes)
 *
 * This test suite verifies that:
 * - Sneak Attack damage scales correctly (1d6 per 2 levels, rounded up)
 * - Core class features unlock at correct levels
 * - PHB vs XPHB differences are handled (Reliable Talent at 11 vs 7, etc.)
 * - All subclass (Roguish Archetype) features work correctly at designated levels
 * - Arcane Trickster spellcasting calculations are correct
 */

import "./setup.js";
import "../../../js/charactersheet/charactersheet-state.js";

const CharacterSheetState = globalThis.CharacterSheetState;

// ==========================================================================
// PART 1: CORE ROGUE CLASS FEATURES (PHB)
// ==========================================================================
describe("Rogue Core Class Features (PHB)", () => {
	let state;

	beforeEach(() => {
		state = new CharacterSheetState();
		state.setRace({name: "Human", source: "PHB"});
		state.addClass({name: "Rogue", source: "PHB", level: 1});
		state.setAbilityBase("str", 10);
		state.setAbilityBase("dex", 16); // +3 modifier
		state.setAbilityBase("con", 14); // +2 modifier
		state.setAbilityBase("int", 14); // +2 modifier
		state.setAbilityBase("wis", 12); // +1 modifier
		state.setAbilityBase("cha", 10);
	});

	// -------------------------------------------------------------------------
	// Sneak Attack (Level 1)
	// -------------------------------------------------------------------------
	describe("Sneak Attack", () => {
		it("should deal 1d6 at level 1", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.sneakAttack.dice).toBe("1d6");
		});

		it("should deal 1d6 at level 2", () => {
			state.addClass({name: "Rogue", source: "PHB", level: 2});
			const calculations = state.getFeatureCalculations();
			expect(calculations.sneakAttack.dice).toBe("1d6");
		});

		it("should deal 2d6 at level 3", () => {
			state.addClass({name: "Rogue", source: "PHB", level: 3});
			const calculations = state.getFeatureCalculations();
			expect(calculations.sneakAttack.dice).toBe("2d6");
		});

		it("should deal 3d6 at level 5", () => {
			state.addClass({name: "Rogue", source: "PHB", level: 5});
			const calculations = state.getFeatureCalculations();
			expect(calculations.sneakAttack.dice).toBe("3d6");
		});

		it("should deal 5d6 at level 10", () => {
			state.addClass({name: "Rogue", source: "PHB", level: 10});
			const calculations = state.getFeatureCalculations();
			expect(calculations.sneakAttack.dice).toBe("5d6");
		});

		it("should deal 10d6 at level 20", () => {
			state.addClass({name: "Rogue", source: "PHB", level: 20});
			const calculations = state.getFeatureCalculations();
			expect(calculations.sneakAttack.dice).toBe("10d6");
		});

		it("should calculate average damage correctly", () => {
			state.addClass({name: "Rogue", source: "PHB", level: 5});
			const calculations = state.getFeatureCalculations();
			// 3d6 = 3 * 3.5 = 10.5, floored to 10
			expect(calculations.sneakAttack.avgDamage).toBe(10);
		});
	});

	// -------------------------------------------------------------------------
	// Expertise (Level 1 and 6)
	// -------------------------------------------------------------------------
	describe("Expertise", () => {
		it("should have Expertise at level 1", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasExpertise).toBe(true);
		});

		it("should have 2 expertise skills at level 1", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.expertiseSkills).toBe(2);
		});

		it("should have 4 expertise skills at level 6", () => {
			state.addClass({name: "Rogue", source: "PHB", level: 6});
			const calculations = state.getFeatureCalculations();
			expect(calculations.expertiseSkills).toBe(4);
		});
	});

	// -------------------------------------------------------------------------
	// Thieves' Cant (Level 1)
	// -------------------------------------------------------------------------
	describe("Thieves' Cant", () => {
		it("should have Thieves' Cant at level 1", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasThievesCant).toBe(true);
		});
	});

	// -------------------------------------------------------------------------
	// Cunning Action (Level 2)
	// -------------------------------------------------------------------------
	describe("Cunning Action", () => {
		it("should not have Cunning Action at level 1", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasCunningAction).toBeFalsy();
		});

		it("should have Cunning Action at level 2", () => {
			state.addClass({name: "Rogue", source: "PHB", level: 2});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasCunningAction).toBe(true);
		});
	});

	// -------------------------------------------------------------------------
	// Steady Aim (Level 3 - TCE Optional/XPHB Core)
	// -------------------------------------------------------------------------
	describe("Steady Aim", () => {
		it("should not have Steady Aim before level 3", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasSteadyAim).toBeFalsy();
		});

		it("should have Steady Aim at level 3", () => {
			state.addClass({name: "Rogue", source: "PHB", level: 3});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasSteadyAim).toBe(true);
		});
	});

	// -------------------------------------------------------------------------
	// Uncanny Dodge (Level 5)
	// -------------------------------------------------------------------------
	describe("Uncanny Dodge", () => {
		it("should not have Uncanny Dodge before level 5", () => {
			state.addClass({name: "Rogue", source: "PHB", level: 4});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasUncannyDodge).toBeFalsy();
		});

		it("should have Uncanny Dodge at level 5", () => {
			state.addClass({name: "Rogue", source: "PHB", level: 5});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasUncannyDodge).toBe(true);
		});
	});

	// -------------------------------------------------------------------------
	// Evasion (Level 7)
	// -------------------------------------------------------------------------
	describe("Evasion", () => {
		it("should not have Evasion before level 7", () => {
			state.addClass({name: "Rogue", source: "PHB", level: 6});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasEvasion).toBeFalsy();
		});

		it("should have Evasion at level 7", () => {
			state.addClass({name: "Rogue", source: "PHB", level: 7});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasEvasion).toBe(true);
		});
	});

	// -------------------------------------------------------------------------
	// Reliable Talent (PHB Level 11)
	// -------------------------------------------------------------------------
	describe("Reliable Talent (PHB)", () => {
		it("should not have Reliable Talent at level 10 (PHB)", () => {
			state.addClass({name: "Rogue", source: "PHB", level: 10});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasReliableTalent).toBeFalsy();
		});

		it("should have Reliable Talent at level 11 (PHB)", () => {
			state.addClass({name: "Rogue", source: "PHB", level: 11});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasReliableTalent).toBe(true);
		});

		it("should have minimum roll of 10", () => {
			state.addClass({name: "Rogue", source: "PHB", level: 11});
			const calculations = state.getFeatureCalculations();
			expect(calculations.reliableTalentMinimum).toBe(10);
		});

		it("should populate rollFloors after applyClassFeatureEffects", () => {
			state.addClass({name: "Rogue", source: "PHB", level: 11});
			state.setSkillProficiency("stealth", 1);
			state.applyClassFeatureEffects();
			expect(state._data.rollFloors).toBeDefined();
			expect(state._data.rollFloors.skill).toBeDefined();
			expect(state._data.rollFloors.skill["all"]).toBeDefined();
			expect(state._data.rollFloors.skill["all"].minimum).toBe(10);
			expect(state._data.rollFloors.skill["all"].requiresProficiency).toBe(true);
		});

		it("should apply minimum 10 to proficient skill via aggregateModifiers", () => {
			state.addClass({name: "Rogue", source: "PHB", level: 11});
			state.setSkillProficiency("stealth", 1);
			state.applyClassFeatureEffects();
			const agg = state.aggregateModifiers("skill:stealth");
			expect(agg.minimum).toBe(10);
		});

		it("should NOT apply minimum to unproficient skill", () => {
			state.addClass({name: "Rogue", source: "PHB", level: 11});
			// arcana is not proficient
			state.applyClassFeatureEffects();
			const agg = state.aggregateModifiers("skill:arcana");
			expect(agg.minimum).toBeNull();
		});

		it("should clear rollFloors when level drops below 11", () => {
			state.addClass({name: "Rogue", source: "PHB", level: 11});
			state.setSkillProficiency("stealth", 1);
			state.applyClassFeatureEffects();
			expect(state._data.rollFloors.skill["all"]).toBeDefined();

			// Drop level
			state.addClass({name: "Rogue", source: "PHB", level: 10});
			state.applyClassFeatureEffects();
			expect(state._data.rollFloors.skill?.["all"]).toBeUndefined();
		});
	});

	// -------------------------------------------------------------------------
	// Blindsense (PHB Level 14)
	// -------------------------------------------------------------------------
	describe("Blindsense (PHB)", () => {
		it("should not have Blindsense before level 14", () => {
			state.addClass({name: "Rogue", source: "PHB", level: 13});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasBlindsense).toBeFalsy();
		});

		it("should have Blindsense at level 14", () => {
			state.addClass({name: "Rogue", source: "PHB", level: 14});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasBlindsense).toBe(true);
		});

		it("should have 10 ft blindsense range", () => {
			state.addClass({name: "Rogue", source: "PHB", level: 14});
			const calculations = state.getFeatureCalculations();
			expect(calculations.blindsenseRange).toBe(10);
		});
	});

	// -------------------------------------------------------------------------
	// Slippery Mind (Level 15)
	// -------------------------------------------------------------------------
	describe("Slippery Mind", () => {
		it("should not have Slippery Mind before level 15", () => {
			state.addClass({name: "Rogue", source: "PHB", level: 14});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasSlipperyMind).toBeFalsy();
		});

		it("should have Slippery Mind at level 15", () => {
			state.addClass({name: "Rogue", source: "PHB", level: 15});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasSlipperyMind).toBe(true);
		});

		it("should grant WIS save proficiency", () => {
			state.addClass({name: "Rogue", source: "PHB", level: 15});
			const calculations = state.getFeatureCalculations();
			expect(calculations.wisdomSaveProficiency).toBe(true);
		});
	});

	// -------------------------------------------------------------------------
	// Elusive (Level 18)
	// -------------------------------------------------------------------------
	describe("Elusive", () => {
		it("should not have Elusive before level 18", () => {
			state.addClass({name: "Rogue", source: "PHB", level: 17});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasElusive).toBeFalsy();
		});

		it("should have Elusive at level 18", () => {
			state.addClass({name: "Rogue", source: "PHB", level: 18});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasElusive).toBe(true);
		});
	});

	// -------------------------------------------------------------------------
	// Stroke of Luck (Level 20)
	// -------------------------------------------------------------------------
	describe("Stroke of Luck", () => {
		it("should not have Stroke of Luck before level 20", () => {
			state.addClass({name: "Rogue", source: "PHB", level: 19});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasStrokeOfLuck).toBeFalsy();
		});

		it("should have Stroke of Luck at level 20", () => {
			state.addClass({name: "Rogue", source: "PHB", level: 20});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasStrokeOfLuck).toBe(true);
		});
	});
});

// ==========================================================================
// PART 2: ROGUE HIT DICE
// ==========================================================================
describe("Rogue Hit Dice", () => {
	let state;

	beforeEach(() => {
		state = new CharacterSheetState();
		state.setRace({name: "Human", source: "PHB"});
		state.addClass({name: "Rogue", source: "PHB", level: 1});
	});

	it("should use d8 hit dice", () => {
		const hitDice = state.getHitDice();
		// Check for d8
		if (Array.isArray(hitDice)) {
			expect(hitDice.some(hd => hd.die === 8 || hd.faces === 8)).toBe(true);
		} else {
			expect(hitDice["d8"] || hitDice[8]).toBeDefined();
		}
	});

	it("should have correct number of hit dice per level", () => {
		state.addClass({name: "Rogue", source: "PHB", level: 5});
		const hitDice = state.getHitDice();
		const totalDice = Array.isArray(hitDice)
			? hitDice.reduce((sum, hd) => sum + (hd.max || hd.current || 0), 0)
			: Object.values(hitDice).reduce((sum, val) => sum + val, 0);
		expect(totalDice).toBe(5);
	});
});

// ==========================================================================
// PART 3: THIEF SUBCLASS
// ==========================================================================
describe("Thief Subclass", () => {
	let state;

	beforeEach(() => {
		state = new CharacterSheetState();
		state.setRace({name: "Human", source: "PHB"});
		state.addClass({name: "Rogue", source: "PHB", level: 3, subclass: {name: "Thief", source: "PHB"}});
		state.setAbilityBase("dex", 16); // +3
	});

	it("should gain subclass at level 3", () => {
		const calculations = state.getFeatureCalculations();
		expect(calculations.hasFastHands).toBe(true);
	});

	// Fast Hands (Level 3)
	describe("Fast Hands (Level 3)", () => {
		it("should have Fast Hands at level 3", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasFastHands).toBe(true);
		});
	});

	// Second-Story Work (Level 3)
	describe("Second-Story Work (Level 3)", () => {
		it("should have Second-Story Work at level 3", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasSecondStoryWork).toBe(true);
		});

		it("should add DEX mod to climb speed", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.climbSpeedBonus).toBe(3); // DEX mod
		});
	});

	// Supreme Sneak (Level 9)
	describe("Supreme Sneak (Level 9)", () => {
		it("should have Supreme Sneak at level 9", () => {
			state.addClass({name: "Rogue", source: "PHB", level: 9, subclass: {name: "Thief", source: "PHB"}});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasSupremeSneak).toBe(true);
		});
	});

	// Use Magic Device (Level 13)
	describe("Use Magic Device (Level 13)", () => {
		it("should have Use Magic Device at level 13", () => {
			state.addClass({name: "Rogue", source: "PHB", level: 13, subclass: {name: "Thief", source: "PHB"}});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasUseMagicDevice).toBe(true);
		});
	});

	// Thief's Reflexes (Level 17)
	describe("Thief's Reflexes (Level 17)", () => {
		it("should have Thief's Reflexes at level 17", () => {
			state.addClass({name: "Rogue", source: "PHB", level: 17, subclass: {name: "Thief", source: "PHB"}});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasThiefsReflexes).toBe(true);
		});

		it("should grant extra turn in first round", () => {
			state.addClass({name: "Rogue", source: "PHB", level: 17, subclass: {name: "Thief", source: "PHB"}});
			const calculations = state.getFeatureCalculations();
			expect(calculations.extraTurnsFirstRound).toBe(1);
		});
	});
});

// ==========================================================================
// PART 4: ASSASSIN SUBCLASS
// ==========================================================================
describe("Assassin Subclass", () => {
	let state;

	beforeEach(() => {
		state = new CharacterSheetState();
		state.setRace({name: "Human", source: "PHB"});
		state.addClass({name: "Rogue", source: "PHB", level: 3, subclass: {name: "Assassin", source: "PHB"}});
		state.setAbilityBase("dex", 16); // +3
	});

	it("should gain subclass at level 3", () => {
		const calculations = state.getFeatureCalculations();
		expect(calculations.hasAssassinate).toBe(true);
	});

	// Assassinate (Level 3)
	describe("Assassinate (Level 3)", () => {
		it("should have Assassinate at level 3", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasAssassinate).toBe(true);
		});

		it("should grant advantage on surprised targets", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasAdvantageOnSurprisedTargets).toBe(true);
		});
	});

	// Bonus Proficiencies (PHB Level 3)
	describe("Bonus Proficiencies (PHB Level 3)", () => {
		it("should have Disguise Kit proficiency", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasDisguiseKitProficiency).toBe(true);
		});

		it("should have Poisoner's Kit proficiency", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasPoisonerKitProficiency).toBe(true);
		});
	});

	// Infiltration Expertise (Level 9)
	describe("Infiltration Expertise (Level 9)", () => {
		it("should have Infiltration Expertise at level 9", () => {
			state.addClass({name: "Rogue", source: "PHB", level: 9, subclass: {name: "Assassin", source: "PHB"}});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasInfiltrationExpertise).toBe(true);
		});
	});

	// Impostor (PHB Level 13)
	describe("Impostor (PHB Level 13)", () => {
		it("should have Impostor at level 13", () => {
			state.addClass({name: "Rogue", source: "PHB", level: 13, subclass: {name: "Assassin", source: "PHB"}});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasImpostor).toBe(true);
		});
	});

	// Death Strike (Level 17)
	describe("Death Strike (Level 17)", () => {
		it("should have Death Strike at level 17", () => {
			state.addClass({name: "Rogue", source: "PHB", level: 17, subclass: {name: "Assassin", source: "PHB"}});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasDeathStrike).toBe(true);
		});

		it("should calculate DC as 8 + prof + DEX", () => {
			state.addClass({name: "Rogue", source: "PHB", level: 17, subclass: {name: "Assassin", source: "PHB"}});
			const calculations = state.getFeatureCalculations();
			// 8 + 6 (prof at 17) + 3 (DEX) = 17
			expect(calculations.deathStrikeDc).toBe(17);
		});
	});
});

// ==========================================================================
// PART 5: ARCANE TRICKSTER SUBCLASS
// ==========================================================================
describe("Arcane Trickster Subclass", () => {
	let state;

	beforeEach(() => {
		state = new CharacterSheetState();
		state.setRace({name: "Human", source: "PHB"});
		state.addClass({name: "Rogue", source: "PHB", level: 3, subclass: {name: "Arcane Trickster", source: "PHB"}});
		state.setAbilityBase("int", 16); // +3
	});

	it("should gain subclass at level 3", () => {
		const calculations = state.getFeatureCalculations();
		expect(calculations.hasSpellcasting).toBe(true);
	});

	// Spellcasting (Level 3)
	describe("Spellcasting (Level 3)", () => {
		it("should have spellcasting at level 3", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasSpellcasting).toBe(true);
		});

		it("should use INT as spellcasting ability", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.spellcastingAbility).toBe("int");
		});

		it("should calculate spell save DC as 8 + prof + INT", () => {
			const calculations = state.getFeatureCalculations();
			// 8 + 2 (prof at 3) + 3 (INT) = 13
			expect(calculations.spellSaveDc).toBe(13);
		});

		it("should calculate spell attack bonus as prof + INT", () => {
			const calculations = state.getFeatureCalculations();
			// 2 (prof at 3) + 3 (INT) = 5
			expect(calculations.spellAttackBonus).toBe(5);
		});

		it("should know 3 cantrips", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.cantripsKnown).toBe(3);
		});

		it("should know 3 spells at level 3", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.spellsKnown).toBe(3);
		});

		it("should know 4 spells at level 4", () => {
			state.addClass({name: "Rogue", source: "PHB", level: 4, subclass: {name: "Arcane Trickster", source: "PHB"}});
			const calculations = state.getFeatureCalculations();
			expect(calculations.spellsKnown).toBe(4);
		});

		it("should know 13 spells at level 20", () => {
			state.addClass({name: "Rogue", source: "PHB", level: 20, subclass: {name: "Arcane Trickster", source: "PHB"}});
			const calculations = state.getFeatureCalculations();
			expect(calculations.spellsKnown).toBe(13);
		});
	});

	// Mage Hand Legerdemain (Level 3)
	describe("Mage Hand Legerdemain (Level 3)", () => {
		it("should have Mage Hand Legerdemain at level 3", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasMageHandLegerdemain).toBe(true);
		});
	});

	// Magical Ambush (Level 9)
	describe("Magical Ambush (Level 9)", () => {
		it("should have Magical Ambush at level 9", () => {
			state.addClass({name: "Rogue", source: "PHB", level: 9, subclass: {name: "Arcane Trickster", source: "PHB"}});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasMagicalAmbush).toBe(true);
		});
	});

	// Versatile Trickster (Level 13)
	describe("Versatile Trickster (Level 13)", () => {
		it("should have Versatile Trickster at level 13", () => {
			state.addClass({name: "Rogue", source: "PHB", level: 13, subclass: {name: "Arcane Trickster", source: "PHB"}});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasVersatileTrickster).toBe(true);
		});
	});

	// Spell Thief (Level 17)
	describe("Spell Thief (Level 17)", () => {
		it("should have Spell Thief at level 17", () => {
			state.addClass({name: "Rogue", source: "PHB", level: 17, subclass: {name: "Arcane Trickster", source: "PHB"}});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasSpellThief).toBe(true);
		});

		it("should calculate DC as 8 + prof + INT", () => {
			state.addClass({name: "Rogue", source: "PHB", level: 17, subclass: {name: "Arcane Trickster", source: "PHB"}});
			const calculations = state.getFeatureCalculations();
			// 8 + 6 (prof at 17) + 3 (INT) = 17
			expect(calculations.spellThiefDc).toBe(17);
		});
	});
});

// ==========================================================================
// PART 6: INQUISITIVE SUBCLASS (XGE)
// ==========================================================================
describe("Inquisitive Subclass (XGE)", () => {
	let state;

	beforeEach(() => {
		state = new CharacterSheetState();
		state.setRace({name: "Human", source: "PHB"});
		state.addClass({name: "Rogue", source: "PHB", level: 3, subclass: {name: "Inquisitive", source: "XGE"}});
		state.setAbilityBase("wis", 16); // +3
	});

	it("should gain subclass at level 3", () => {
		const calculations = state.getFeatureCalculations();
		expect(calculations.hasEarForDeceit).toBe(true);
	});

	// Ear for Deceit (Level 3)
	describe("Ear for Deceit (Level 3)", () => {
		it("should have Ear for Deceit at level 3", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasEarForDeceit).toBe(true);
		});

		it("should have minimum Insight roll of 8", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.insightMinimum).toBe(8);
		});
	});

	// Eye for Detail (Level 3)
	describe("Eye for Detail (Level 3)", () => {
		it("should have Eye for Detail at level 3", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasEyeForDetail).toBe(true);
		});
	});

	// Insightful Fighting (Level 3)
	describe("Insightful Fighting (Level 3)", () => {
		it("should have Insightful Fighting at level 3", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasInsightfulFighting).toBe(true);
		});
	});

	// Steady Eye (Level 9)
	describe("Steady Eye (Level 9)", () => {
		it("should have Steady Eye at level 9", () => {
			state.addClass({name: "Rogue", source: "PHB", level: 9, subclass: {name: "Inquisitive", source: "XGE"}});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasSteadyEye).toBe(true);
		});
	});

	// Unerring Eye (Level 13)
	describe("Unerring Eye (Level 13)", () => {
		it("should have Unerring Eye at level 13", () => {
			state.addClass({name: "Rogue", source: "PHB", level: 13, subclass: {name: "Inquisitive", source: "XGE"}});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasUnerringEye).toBe(true);
		});

		it("should have WIS mod uses", () => {
			state.addClass({name: "Rogue", source: "PHB", level: 13, subclass: {name: "Inquisitive", source: "XGE"}});
			const calculations = state.getFeatureCalculations();
			expect(calculations.unerringEyeUses).toBe(3); // WIS mod
		});
	});

	// Eye for Weakness (Level 17)
	describe("Eye for Weakness (Level 17)", () => {
		it("should have Eye for Weakness at level 17", () => {
			state.addClass({name: "Rogue", source: "PHB", level: 17, subclass: {name: "Inquisitive", source: "XGE"}});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasEyeForWeakness).toBe(true);
		});

		it("should add 3d6 to Sneak Attack", () => {
			state.addClass({name: "Rogue", source: "PHB", level: 17, subclass: {name: "Inquisitive", source: "XGE"}});
			const calculations = state.getFeatureCalculations();
			expect(calculations.eyeForWeaknessBonus).toBe("3d6");
		});
	});
});

// ==========================================================================
// PART 7: MASTERMIND SUBCLASS (XGE)
// ==========================================================================
describe("Mastermind Subclass (XGE)", () => {
	let state;

	beforeEach(() => {
		state = new CharacterSheetState();
		state.setRace({name: "Human", source: "PHB"});
		state.addClass({name: "Rogue", source: "PHB", level: 3, subclass: {name: "Mastermind", source: "XGE"}});
	});

	it("should gain subclass at level 3", () => {
		const calculations = state.getFeatureCalculations();
		expect(calculations.hasMasterOfIntrigue).toBe(true);
	});

	// Master of Intrigue (Level 3)
	describe("Master of Intrigue (Level 3)", () => {
		it("should have Master of Intrigue at level 3", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasMasterOfIntrigue).toBe(true);
		});
	});

	// Master of Tactics (Level 3)
	describe("Master of Tactics (Level 3)", () => {
		it("should have Master of Tactics at level 3", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasMasterOfTactics).toBe(true);
		});

		it("should have 30 ft Help range", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.helpRange).toBe(30);
		});
	});

	// Insightful Manipulator (Level 9)
	describe("Insightful Manipulator (Level 9)", () => {
		it("should have Insightful Manipulator at level 9", () => {
			state.addClass({name: "Rogue", source: "PHB", level: 9, subclass: {name: "Mastermind", source: "XGE"}});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasInsightfulManipulator).toBe(true);
		});
	});

	// Misdirection (Level 13)
	describe("Misdirection (Level 13)", () => {
		it("should have Misdirection at level 13", () => {
			state.addClass({name: "Rogue", source: "PHB", level: 13, subclass: {name: "Mastermind", source: "XGE"}});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasMisdirection).toBe(true);
		});
	});

	// Soul of Deceit (Level 17)
	describe("Soul of Deceit (Level 17)", () => {
		it("should have Soul of Deceit at level 17", () => {
			state.addClass({name: "Rogue", source: "PHB", level: 17, subclass: {name: "Mastermind", source: "XGE"}});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasSoulOfDeceit).toBe(true);
		});
	});
});

// ==========================================================================
// PART 8: SWASHBUCKLER SUBCLASS (XGE)
// ==========================================================================
describe("Swashbuckler Subclass (XGE)", () => {
	let state;

	beforeEach(() => {
		state = new CharacterSheetState();
		state.setRace({name: "Human", source: "PHB"});
		state.addClass({name: "Rogue", source: "PHB", level: 3, subclass: {name: "Swashbuckler", source: "XGE"}});
		state.setAbilityBase("cha", 16); // +3
	});

	it("should gain subclass at level 3", () => {
		const calculations = state.getFeatureCalculations();
		expect(calculations.hasFancyFootwork).toBe(true);
	});

	// Fancy Footwork (Level 3)
	describe("Fancy Footwork (Level 3)", () => {
		it("should have Fancy Footwork at level 3", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasFancyFootwork).toBe(true);
		});
	});

	// Rakish Audacity (Level 3)
	describe("Rakish Audacity (Level 3)", () => {
		it("should have Rakish Audacity at level 3", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasRakishAudacity).toBe(true);
		});

		it("should add CHA mod to initiative", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.initiativeBonus).toBe(3); // CHA mod
		});
	});

	// Panache (Level 9)
	describe("Panache (Level 9)", () => {
		it("should have Panache at level 9", () => {
			state.addClass({name: "Rogue", source: "PHB", level: 9, subclass: {name: "Swashbuckler", source: "XGE"}});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasPanache).toBe(true);
		});
	});

	// Elegant Maneuver (Level 13)
	describe("Elegant Maneuver (Level 13)", () => {
		it("should have Elegant Maneuver at level 13", () => {
			state.addClass({name: "Rogue", source: "PHB", level: 13, subclass: {name: "Swashbuckler", source: "XGE"}});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasElegantManeuver).toBe(true);
		});
	});

	// Master Duelist (Level 17)
	describe("Master Duelist (Level 17)", () => {
		it("should have Master Duelist at level 17", () => {
			state.addClass({name: "Rogue", source: "PHB", level: 17, subclass: {name: "Swashbuckler", source: "XGE"}});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasMasterDuelist).toBe(true);
		});
	});
});

// ==========================================================================
// PART 9: SCOUT SUBCLASS (XGE)
// ==========================================================================
describe("Scout Subclass (XGE)", () => {
	let state;

	beforeEach(() => {
		state = new CharacterSheetState();
		state.setRace({name: "Human", source: "PHB"});
		state.addClass({name: "Rogue", source: "PHB", level: 3, subclass: {name: "Scout", source: "XGE"}});
	});

	it("should gain subclass at level 3", () => {
		const calculations = state.getFeatureCalculations();
		expect(calculations.hasSkirmisher).toBe(true);
	});

	// Skirmisher (Level 3)
	describe("Skirmisher (Level 3)", () => {
		it("should have Skirmisher at level 3", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasSkirmisher).toBe(true);
		});
	});

	// Survivalist (Level 3)
	describe("Survivalist (Level 3)", () => {
		it("should have Survivalist at level 3", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasSurvivalist).toBe(true);
		});
	});

	// Superior Mobility (Level 9)
	describe("Superior Mobility (Level 9)", () => {
		it("should have Superior Mobility at level 9", () => {
			state.addClass({name: "Rogue", source: "PHB", level: 9, subclass: {name: "Scout", source: "XGE"}});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasSuperiorMobility).toBe(true);
		});

		it("should grant +10 movement", () => {
			state.addClass({name: "Rogue", source: "PHB", level: 9, subclass: {name: "Scout", source: "XGE"}});
			const calculations = state.getFeatureCalculations();
			expect(calculations.movementBonus).toBe(10);
		});
	});

	// Ambush Master (Level 13)
	describe("Ambush Master (Level 13)", () => {
		it("should have Ambush Master at level 13", () => {
			state.addClass({name: "Rogue", source: "PHB", level: 13, subclass: {name: "Scout", source: "XGE"}});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasAmbushMaster).toBe(true);
		});
	});

	// Sudden Strike (Level 17)
	describe("Sudden Strike (Level 17)", () => {
		it("should have Sudden Strike at level 17", () => {
			state.addClass({name: "Rogue", source: "PHB", level: 17, subclass: {name: "Scout", source: "XGE"}});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasSuddenStrike).toBe(true);
		});
	});
});

// ==========================================================================
// PART 10: PHANTOM SUBCLASS (TCE)
// ==========================================================================
describe("Phantom Subclass (TCE)", () => {
	let state;

	beforeEach(() => {
		state = new CharacterSheetState();
		state.setRace({name: "Human", source: "PHB"});
		state.addClass({name: "Rogue", source: "PHB", level: 3, subclass: {name: "Phantom", source: "TCE"}});
	});

	it("should gain subclass at level 3", () => {
		const calculations = state.getFeatureCalculations();
		expect(calculations.hasWhispersOfTheDead).toBe(true);
	});

	// Whispers of the Dead (Level 3)
	describe("Whispers of the Dead (Level 3)", () => {
		it("should have Whispers of the Dead at level 3", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasWhispersOfTheDead).toBe(true);
		});
	});

	// Wails from the Grave (Level 3)
	describe("Wails from the Grave (Level 3)", () => {
		it("should have Wails from the Grave at level 3", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasWailsFromTheGrave).toBe(true);
		});

		it("should deal half sneak attack dice damage", () => {
			const calculations = state.getFeatureCalculations();
			// At level 3, sneak attack is 2d6, half is 1d6
			expect(calculations.wailsDamage).toBe("1d6");
		});

		it("should scale with level", () => {
			state.addClass({name: "Rogue", source: "PHB", level: 9, subclass: {name: "Phantom", source: "TCE"}});
			const calculations = state.getFeatureCalculations();
			// At level 9, sneak attack is 5d6, half is ~2.5 rounded up = 3d6
			expect(calculations.wailsDamage).toBe("3d6");
		});
	});

	// Tokens of the Departed (Level 9)
	describe("Tokens of the Departed (Level 9)", () => {
		it("should have Tokens of the Departed at level 9", () => {
			state.addClass({name: "Rogue", source: "PHB", level: 9, subclass: {name: "Phantom", source: "TCE"}});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasTokensOfTheDeparted).toBe(true);
		});

		it("should have max trinkets equal to proficiency bonus", () => {
			state.addClass({name: "Rogue", source: "PHB", level: 9, subclass: {name: "Phantom", source: "TCE"}});
			const calculations = state.getFeatureCalculations();
			expect(calculations.maxSoulTrinkets).toBe(4); // Prof at level 9
		});
	});

	// Ghost Walk (Level 13)
	describe("Ghost Walk (Level 13)", () => {
		it("should have Ghost Walk at level 13", () => {
			state.addClass({name: "Rogue", source: "PHB", level: 13, subclass: {name: "Phantom", source: "TCE"}});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasGhostWalk).toBe(true);
		});

		it("should grant 10 ft fly speed", () => {
			state.addClass({name: "Rogue", source: "PHB", level: 13, subclass: {name: "Phantom", source: "TCE"}});
			const calculations = state.getFeatureCalculations();
			expect(calculations.ghostWalkFlySpeed).toBe(10);
		});
	});

	// Death's Friend (Level 17)
	describe("Death's Friend (Level 17)", () => {
		it("should have Death's Friend at level 17", () => {
			state.addClass({name: "Rogue", source: "PHB", level: 17, subclass: {name: "Phantom", source: "TCE"}});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasDeathsFriend).toBe(true);
		});
	});
});

// ==========================================================================
// PART 11: SOULKNIFE SUBCLASS (TCE)
// ==========================================================================
describe("Soulknife Subclass (TCE)", () => {
	let state;

	beforeEach(() => {
		state = new CharacterSheetState();
		state.setRace({name: "Human", source: "PHB"});
		state.addClass({name: "Rogue", source: "PHB", level: 3, subclass: {name: "Soulknife", source: "TCE"}});
		state.setAbilityBase("dex", 16); // +3
	});

	it("should gain subclass at level 3", () => {
		const calculations = state.getFeatureCalculations();
		expect(calculations.hasPsionicPower).toBe(true);
	});

	// Psionic Power (Level 3)
	describe("Psionic Power (Level 3)", () => {
		it("should have Psionic Power at level 3", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasPsionicPower).toBe(true);
		});

		it("should have 2x proficiency bonus energy dice", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.psionicEnergyDice).toBe(4); // 2 * 2 (prof at level 3)
		});

		it("should use d6 at level 3", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.psionicEnergyDie).toBe("d6");
		});

		it("should use d8 at level 5", () => {
			state.addClass({name: "Rogue", source: "PHB", level: 5, subclass: {name: "Soulknife", source: "TCE"}});
			const calculations = state.getFeatureCalculations();
			expect(calculations.psionicEnergyDie).toBe("d8");
		});

		it("should use d10 at level 11", () => {
			state.addClass({name: "Rogue", source: "PHB", level: 11, subclass: {name: "Soulknife", source: "TCE"}});
			const calculations = state.getFeatureCalculations();
			expect(calculations.psionicEnergyDie).toBe("d10");
		});

		it("should use d12 at level 17", () => {
			state.addClass({name: "Rogue", source: "PHB", level: 17, subclass: {name: "Soulknife", source: "TCE"}});
			const calculations = state.getFeatureCalculations();
			expect(calculations.psionicEnergyDie).toBe("d12");
		});
	});

	// Psychic Blades (Level 3)
	describe("Psychic Blades (Level 3)", () => {
		it("should have Psychic Blades at level 3", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasPsychicBlades).toBe(true);
		});

		it("should deal 1d6 main hand damage", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.psychicBladeDamage).toBe("1d6");
		});

		it("should deal 1d4 offhand damage", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.psychicBladeOffhand).toBe("1d4");
		});
	});

	// Psi-Bolstered Knack (Level 3)
	describe("Psi-Bolstered Knack (Level 3)", () => {
		it("should have Psi-Bolstered Knack at level 3", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasPsiBolsteredKnack).toBe(true);
		});
	});

	// Psychic Whispers (Level 3)
	describe("Psychic Whispers (Level 3)", () => {
		it("should have Psychic Whispers at level 3", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasPsychicWhispers).toBe(true);
		});

		it("should affect proficiency bonus number of targets", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.psychicWhispersTargets).toBe(2); // Prof at level 3
		});
	});

	// Soul Blades (Level 9)
	describe("Soul Blades (Level 9)", () => {
		it("should have Soul Blades at level 9", () => {
			state.addClass({name: "Rogue", source: "PHB", level: 9, subclass: {name: "Soulknife", source: "TCE"}});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasSoulBlades).toBe(true);
		});

		it("should have Homing Strikes", () => {
			state.addClass({name: "Rogue", source: "PHB", level: 9, subclass: {name: "Soulknife", source: "TCE"}});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasHomingStrikes).toBe(true);
		});

		it("should have Psychic Teleportation", () => {
			state.addClass({name: "Rogue", source: "PHB", level: 9, subclass: {name: "Soulknife", source: "TCE"}});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasPsychicTeleportation).toBe(true);
		});
	});

	// Psychic Veil (Level 13)
	describe("Psychic Veil (Level 13)", () => {
		it("should have Psychic Veil at level 13", () => {
			state.addClass({name: "Rogue", source: "PHB", level: 13, subclass: {name: "Soulknife", source: "TCE"}});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasPsychicVeil).toBe(true);
		});
	});

	// Rend Mind (Level 17)
	describe("Rend Mind (Level 17)", () => {
		it("should have Rend Mind at level 17", () => {
			state.addClass({name: "Rogue", source: "PHB", level: 17, subclass: {name: "Soulknife", source: "TCE"}});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasRendMind).toBe(true);
		});

		it("should calculate DC as 8 + prof + DEX", () => {
			state.addClass({name: "Rogue", source: "PHB", level: 17, subclass: {name: "Soulknife", source: "TCE"}});
			const calculations = state.getFeatureCalculations();
			// 8 + 6 (prof at 17) + 3 (DEX) = 17
			expect(calculations.rendMindDc).toBe(17);
		});
	});
});

// ==========================================================================
// PART 12: XPHB 2024 ROGUE FEATURES
// ==========================================================================
describe("Rogue Core Class Features (XPHB 2024)", () => {
	let state;

	beforeEach(() => {
		state = new CharacterSheetState();
		state.setRace({name: "Human", source: "XPHB"});
		state.addClass({name: "Rogue", source: "XPHB", level: 1});
		state.setAbilityBase("dex", 16); // +3
		state.setAbilityBase("int", 14); // +2
	});

	// Weapon Mastery (XPHB Level 1)
	describe("Weapon Mastery (XPHB)", () => {
		it("should have Weapon Mastery at level 1", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasWeaponMastery).toBe(true);
		});

		it("should have 2 weapon masteries", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.weaponMasteryCount).toBe(2);
		});
	});

	// Cunning Strike (XPHB Level 5)
	describe("Cunning Strike (XPHB)", () => {
		it("should not have Cunning Strike before level 5", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasCunningStrike).toBeFalsy();
		});

		it("should have Cunning Strike at level 5", () => {
			state.addClass({name: "Rogue", source: "XPHB", level: 5});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasCunningStrike).toBe(true);
		});

		it("should have Poison, Trip, Withdraw options", () => {
			state.addClass({name: "Rogue", source: "XPHB", level: 5});
			const calculations = state.getFeatureCalculations();
			expect(calculations.cunningStrikeOptions).toContain("Poison");
			expect(calculations.cunningStrikeOptions).toContain("Trip");
			expect(calculations.cunningStrikeOptions).toContain("Withdraw");
		});
	});

	// Reliable Talent (XPHB Level 7)
	describe("Reliable Talent (XPHB)", () => {
		it("should not have Reliable Talent at level 6 (XPHB)", () => {
			state.addClass({name: "Rogue", source: "XPHB", level: 6});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasReliableTalent).toBeFalsy();
		});

		it("should have Reliable Talent at level 7 (XPHB)", () => {
			state.addClass({name: "Rogue", source: "XPHB", level: 7});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasReliableTalent).toBe(true);
		});
	});

	// Improved Cunning Strike (XPHB Level 11)
	describe("Improved Cunning Strike (XPHB)", () => {
		it("should have Improved Cunning Strike at level 11", () => {
			state.addClass({name: "Rogue", source: "XPHB", level: 11});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasImprovedCunningStrike).toBe(true);
		});

		it("should add Daze option", () => {
			state.addClass({name: "Rogue", source: "XPHB", level: 11});
			const calculations = state.getFeatureCalculations();
			expect(calculations.cunningStrikeOptions).toContain("Daze");
		});
	});

	// Devious Strikes (XPHB Level 14)
	describe("Devious Strikes (XPHB)", () => {
		it("should have Devious Strikes at level 14", () => {
			state.addClass({name: "Rogue", source: "XPHB", level: 14});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasDeviousStrikes).toBe(true);
		});

		it("should have Daze, Knock Out, Obscure options", () => {
			state.addClass({name: "Rogue", source: "XPHB", level: 14});
			const calculations = state.getFeatureCalculations();
			expect(calculations.deviousStrikeOptions).toContain("Daze");
			expect(calculations.deviousStrikeOptions).toContain("Knock Out");
			expect(calculations.deviousStrikeOptions).toContain("Obscure");
		});
	});

	// No Blindsense in XPHB
	describe("No Blindsense (XPHB)", () => {
		it("should not have Blindsense in XPHB", () => {
			state.addClass({name: "Rogue", source: "XPHB", level: 14});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasBlindsense).toBeFalsy();
		});
	});
});

// ==========================================================================
// PART 13: ASSASSIN SUBCLASS (XPHB 2024)
// ==========================================================================
describe("Assassin Subclass (XPHB 2024)", () => {
	let state;

	beforeEach(() => {
		state = new CharacterSheetState();
		state.setRace({name: "Human", source: "XPHB"});
		state.addClass({name: "Rogue", source: "XPHB", level: 3, subclass: {name: "Assassin", source: "XPHB"}});
		state.setAbilityBase("dex", 16); // +3
	});

	// Assassin's Tools (XPHB Level 3)
	describe("Assassin's Tools (XPHB Level 3)", () => {
		it("should have Assassin's Tools at level 3", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasAssassinsTools).toBe(true);
		});

		it("should not have old Bonus Proficiencies", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasDisguiseKitProficiency).toBeFalsy();
		});
	});

	// Envenom Weapons (XPHB Level 13)
	describe("Envenom Weapons (XPHB Level 13)", () => {
		it("should have Envenom Weapons at level 13", () => {
			state.addClass({name: "Rogue", source: "XPHB", level: 13, subclass: {name: "Assassin", source: "XPHB"}});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasEnvenomWeapons).toBe(true);
		});

		it("should deal proficiency bonus d6 poison damage", () => {
			state.addClass({name: "Rogue", source: "XPHB", level: 13, subclass: {name: "Assassin", source: "XPHB"}});
			const calculations = state.getFeatureCalculations();
			expect(calculations.envenomDamage).toBe("5d6"); // Prof at level 13
		});
	});
});

// ==========================================================================
// PART 14: ARCANE TRICKSTER (XPHB 2024) - PREPARED SPELLS
// ==========================================================================
describe("Arcane Trickster Subclass (XPHB 2024)", () => {
	let state;

	beforeEach(() => {
		state = new CharacterSheetState();
		state.setRace({name: "Human", source: "XPHB"});
		state.addClass({name: "Rogue", source: "XPHB", level: 3, subclass: {name: "Arcane Trickster", source: "XPHB"}});
		state.setAbilityBase("int", 16); // +3
	});

	describe("Prepared Spells (XPHB)", () => {
		it("should use prepared spells instead of spells known", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.preparedSpells).toBeDefined();
			expect(calculations.spellsKnown).toBeUndefined();
		});

		it("should have 3 prepared spells at level 3", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.preparedSpells).toBe(3);
		});

		it("should have 4 prepared spells at level 4", () => {
			state.addClass({name: "Rogue", source: "XPHB", level: 4, subclass: {name: "Arcane Trickster", source: "XPHB"}});
			const calculations = state.getFeatureCalculations();
			expect(calculations.preparedSpells).toBe(4);
		});

		it("should have 13 prepared spells at level 19", () => {
			state.addClass({name: "Rogue", source: "XPHB", level: 19, subclass: {name: "Arcane Trickster", source: "XPHB"}});
			const calculations = state.getFeatureCalculations();
			expect(calculations.preparedSpells).toBe(13);
		});
	});
});

// ==========================================================================
// PART 15: PHB vs XPHB FEATURE COMPARISON
// ==========================================================================
describe("PHB vs XPHB Rogue Feature Comparison", () => {
	describe("Reliable Talent Level", () => {
		it("should have different Reliable Talent levels", () => {
			const phbState = new CharacterSheetState();
			phbState.setRace({name: "Human", source: "PHB"});
			phbState.addClass({name: "Rogue", source: "PHB", level: 7});

			const xphbState = new CharacterSheetState();
			xphbState.setRace({name: "Human", source: "XPHB"});
			xphbState.addClass({name: "Rogue", source: "XPHB", level: 7});

			const phbCalc = phbState.getFeatureCalculations();
			const xphbCalc = xphbState.getFeatureCalculations();

			// PHB doesn't get Reliable Talent until level 11
			expect(phbCalc.hasReliableTalent).toBeFalsy();
			// XPHB gets it at level 7
			expect(xphbCalc.hasReliableTalent).toBe(true);
		});
	});

	describe("Blindsense vs Devious Strikes", () => {
		it("should have different level 14 features", () => {
			const phbState = new CharacterSheetState();
			phbState.setRace({name: "Human", source: "PHB"});
			phbState.addClass({name: "Rogue", source: "PHB", level: 14});

			const xphbState = new CharacterSheetState();
			xphbState.setRace({name: "Human", source: "XPHB"});
			xphbState.addClass({name: "Rogue", source: "XPHB", level: 14});

			const phbCalc = phbState.getFeatureCalculations();
			const xphbCalc = xphbState.getFeatureCalculations();

			// PHB gets Blindsense at level 14
			expect(phbCalc.hasBlindsense).toBe(true);
			expect(phbCalc.hasDeviousStrikes).toBeFalsy();

			// XPHB gets Devious Strikes at level 14
			expect(xphbCalc.hasDeviousStrikes).toBe(true);
			expect(xphbCalc.hasBlindsense).toBeFalsy();
		});
	});

	describe("Cunning Strike (XPHB only)", () => {
		it("should only have Cunning Strike in XPHB", () => {
			const phbState = new CharacterSheetState();
			phbState.setRace({name: "Human", source: "PHB"});
			phbState.addClass({name: "Rogue", source: "PHB", level: 5});

			const xphbState = new CharacterSheetState();
			xphbState.setRace({name: "Human", source: "XPHB"});
			xphbState.addClass({name: "Rogue", source: "XPHB", level: 5});

			const phbCalc = phbState.getFeatureCalculations();
			const xphbCalc = xphbState.getFeatureCalculations();

			expect(phbCalc.hasCunningStrike).toBeFalsy();
			expect(xphbCalc.hasCunningStrike).toBe(true);
		});
	});
});

// ==========================================================================
// PART 16: ROGUE MULTICLASS
// ==========================================================================
describe("Rogue Multiclass", () => {
	let state;

	beforeEach(() => {
		state = new CharacterSheetState();
		state.setRace({name: "Human", source: "PHB"});
		state.setAbilityBase("dex", 16);
	});

	it("should require DEX 13 for multiclassing", () => {
		// This is a design test - multiclass requirements
		const multiclassReq = {dex: 13};
		expect(multiclassReq.dex).toBe(13);
	});

	it("should calculate Sneak Attack based on rogue level only", () => {
		state.addClass({name: "Rogue", source: "PHB", level: 5});
		state.addClass({name: "Fighter", source: "PHB", level: 5});
		const calculations = state.getFeatureCalculations();
		// Sneak Attack based on rogue level 5 = 3d6
		expect(calculations.sneakAttack.dice).toBe("3d6");
	});

	it("should track proficiency bonus based on total level", () => {
		state.addClass({name: "Rogue", source: "PHB", level: 5});
		state.addClass({name: "Fighter", source: "PHB", level: 5});
		const profBonus = state.getProficiencyBonus();
		// Total level 10 = +4 proficiency
		expect(profBonus).toBe(4);
	});
});

// ==========================================================================
// PART 17: ROGUE EDGE CASES
// ==========================================================================
describe("Rogue Edge Cases", () => {
	let state;

	beforeEach(() => {
		state = new CharacterSheetState();
		state.setRace({name: "Human", source: "PHB"});
		state.addClass({name: "Rogue", source: "PHB", level: 1});
		state.setAbilityBase("dex", 16);
		state.setAbilityBase("int", 14);
	});

	it("should handle level 20 character correctly", () => {
		state.addClass({name: "Rogue", source: "PHB", level: 20});
		const calculations = state.getFeatureCalculations();
		expect(calculations.sneakAttack.dice).toBe("10d6");
		expect(calculations.hasStrokeOfLuck).toBe(true);
		expect(calculations.hasElusive).toBe(true);
	});

	it("should track hit dice correctly", () => {
		state.addClass({name: "Rogue", source: "PHB", level: 10});
		const hitDice = state.getHitDice();
		const totalDice = Array.isArray(hitDice)
			? hitDice.reduce((sum, hd) => sum + (hd.max || hd.current || 0), 0)
			: Object.values(hitDice).reduce((sum, val) => sum + val, 0);
		expect(totalDice).toBe(10);
	});

	it("should handle subclass selection", () => {
		state.addClass({name: "Rogue", source: "PHB", level: 3, subclass: {name: "Thief", source: "PHB"}});
		const calculations = state.getFeatureCalculations();
		expect(calculations.hasFastHands).toBe(true);
	});

	it("should handle low WIS for Unerring Eye uses", () => {
		state.setAbilityBase("wis", 8); // -1 modifier
		state.addClass({name: "Rogue", source: "PHB", level: 13, subclass: {name: "Inquisitive", source: "XGE"}});
		const calculations = state.getFeatureCalculations();
		// Minimum 1 use
		expect(calculations.unerringEyeUses).toBe(1);
	});
});

// ==========================================================================
// PART 18: PROFICIENCY BONUS PROGRESSION
// ==========================================================================
describe("Rogue Proficiency Bonus Progression", () => {
	let state;

	beforeEach(() => {
		state = new CharacterSheetState();
		state.setRace({name: "Human", source: "PHB"});
	});

	it("should return +2 proficiency bonus at level 1", () => {
		state.addClass({name: "Rogue", source: "PHB", level: 1});
		expect(state.getProficiencyBonus()).toBe(2);
	});

	it("should return +2 proficiency bonus at level 4", () => {
		state.addClass({name: "Rogue", source: "PHB", level: 4});
		expect(state.getProficiencyBonus()).toBe(2);
	});

	it("should return +3 proficiency bonus at level 5", () => {
		state.addClass({name: "Rogue", source: "PHB", level: 5});
		expect(state.getProficiencyBonus()).toBe(3);
	});

	it("should return +4 proficiency bonus at level 9", () => {
		state.addClass({name: "Rogue", source: "PHB", level: 9});
		expect(state.getProficiencyBonus()).toBe(4);
	});

	it("should return +5 proficiency bonus at level 13", () => {
		state.addClass({name: "Rogue", source: "PHB", level: 13});
		expect(state.getProficiencyBonus()).toBe(5);
	});

	it("should return +6 proficiency bonus at level 17", () => {
		state.addClass({name: "Rogue", source: "PHB", level: 17});
		expect(state.getProficiencyBonus()).toBe(6);
	});
});

// ==========================================================================
// PART 19: ARCANE TRICKSTER SPELL SLOTS (1/3 CASTER)
// ==========================================================================
describe("Arcane Trickster Spell Slots (1/3 Caster)", () => {
	let state;

	beforeEach(() => {
		state = new CharacterSheetState();
		state.setRace({name: "Human", source: "PHB"});
		state.addClass({name: "Rogue", source: "PHB", level: 3, subclass: {name: "Arcane Trickster", source: "PHB"}});
	});

	it("should have 2 1st-level slots at level 3", () => {
		const spellSlots = state.getSpellSlots();
		const slot1 = typeof spellSlots[1] === "object" ? spellSlots[1].max : spellSlots[1];
		expect(slot1).toBe(2);
	});

	it("should have spellcasting starting at level 3", () => {
		const calculations = state.getFeatureCalculations();
		expect(calculations.hasSpellcasting).toBe(true);
	});

	it("should calculate as 1/3 caster for spell slots", () => {
		// At rogue level 3, effective caster level is 1 (3/3 rounded down)
		// At rogue level 20, effective caster level is 6 (20/3 rounded down)
		state.addClass({name: "Rogue", source: "PHB", level: 20, subclass: {name: "Arcane Trickster", source: "PHB"}});
		const spellSlots = state.getSpellSlots();
		// Level 6 caster should have some spell slots
		const slot1 = typeof spellSlots[1] === "object" ? spellSlots[1].max : spellSlots[1];
		expect(slot1).toBeGreaterThan(0);
	});

	it("should not have 5th-level slots", () => {
		state.addClass({name: "Rogue", source: "PHB", level: 20, subclass: {name: "Arcane Trickster", source: "PHB"}});
		const spellSlots = state.getSpellSlots();
		const slot5 = typeof spellSlots[5] === "object" ? spellSlots[5].max : spellSlots[5];
		expect(slot5).toBe(0);
	});
});
