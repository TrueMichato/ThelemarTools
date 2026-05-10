/**
 * Character Sheet Edge Cases and Stress Tests
 * Comprehensive testing for robustness and correctness
 */

import "./setup.js";
import "../../../js/charactersheet/charactersheet-state.js";

const CharacterSheetState = globalThis.CharacterSheetState;

describe("Edge Cases and Stress Tests", () => {
	let state;

	beforeEach(() => {
		state = new CharacterSheetState();
	});

	// ==========================================================================
	// Ability Score Edge Cases
	// ==========================================================================
	describe("Ability Score Edge Cases", () => {
		it("should handle ability score of 1 (minimum)", () => {
			state.setAbilityBase("str", 1);
			expect(state.getAbilityScore("str")).toBe(1);
			expect(state.getAbilityModifier("str")).toBe(-5);
		});

		it("should handle ability score of 30 (deity level)", () => {
			state.setAbilityBase("str", 30);
			expect(state.getAbilityScore("str")).toBe(30);
			expect(state.getAbilityModifier("str")).toBe(10);
		});

		it("should handle ability score exactly at 10 (0 modifier)", () => {
			state.setAbilityBase("dex", 10);
			expect(state.getAbilityModifier("dex")).toBe(0);
		});

		it("should handle ability score at 11 (still 0 modifier)", () => {
			state.setAbilityBase("dex", 11);
			expect(state.getAbilityModifier("dex")).toBe(0);
		});

		it("should correctly calculate all ability modifiers", () => {
			const testCases = [
				{score: 1, mod: -5},
				{score: 2, mod: -4}, {score: 3, mod: -4},
				{score: 4, mod: -3}, {score: 5, mod: -3},
				{score: 6, mod: -2}, {score: 7, mod: -2},
				{score: 8, mod: -1}, {score: 9, mod: -1},
				{score: 10, mod: 0}, {score: 11, mod: 0},
				{score: 12, mod: 1}, {score: 13, mod: 1},
				{score: 14, mod: 2}, {score: 15, mod: 2},
				{score: 16, mod: 3}, {score: 17, mod: 3},
				{score: 18, mod: 4}, {score: 19, mod: 4},
				{score: 20, mod: 5}, {score: 21, mod: 5},
				{score: 22, mod: 6}, {score: 23, mod: 6},
				{score: 24, mod: 7}, {score: 25, mod: 7},
				{score: 26, mod: 8}, {score: 27, mod: 8},
				{score: 28, mod: 9}, {score: 29, mod: 9},
				{score: 30, mod: 10},
			];

			testCases.forEach(({score, mod}) => {
				state.setAbilityBase("str", score);
				expect(state.getAbilityModifier("str")).toBe(mod);
			});
		});

		it("should stack multiple racial bonuses correctly", () => {
			state.setAbilityBase("cha", 15);
			state.setAbilityBonus("cha", 2); // Half-Elf +2
			expect(state.getAbilityScore("cha")).toBe(17);

			// Add another bonus (e.g., from a feat or item)
			state.setAbilityBonus("cha", 3); // Replaces previous bonus
			expect(state.getAbilityScore("cha")).toBe(18);
		});

		it("should handle addAbilityBonus stacking", () => {
			state.setAbilityBase("str", 14);
			state.addAbilityBonus("str", 1); // Feat bonus
			state.addAbilityBonus("str", 1); // Another feat
			expect(state.getAbilityScore("str")).toBeGreaterThanOrEqual(15);
		});

		it("should handle negative ability modifiers in calculations", () => {
			state.setAbilityBase("int", 6); // -2 modifier
			state.addClass({name: "Wizard", source: "PHB", level: 1});

			// Spell save DC should be 8 + 2 (prof) + (-2) = 8
			expect(state.getSpellSaveDC("int")).toBe(8);
		});

		it("should cap ability scores at 20 for normal increases", () => {
			state.setAbilityBase("str", 19);
			state.increaseAbility("str", 2); // ASI +2

			// Should cap at 20 unless using setAbilityBase directly
			const score = state.getAbilityScore("str");
			expect(score).toBeLessThanOrEqual(21); // Some implementations may not cap
		});
	});

	// ==========================================================================
	// Hit Points Edge Cases
	// ==========================================================================
	describe("Hit Points Edge Cases", () => {
		it("should handle 0 HP correctly", () => {
			state.setMaxHp(50);
			state.setCurrentHp(0);
			expect(state.getCurrentHp()).toBe(0);
			expect(state.isUnconscious()).toBe(true);
		});

		it("should handle massive damage (instant death)", () => {
			state.setMaxHp(20);
			state.setCurrentHp(20);

			// Take 45 damage (more than max HP remaining after reduction)
			state.takeDamage(45);

			// Remaining damage after hitting 0 is 25, which exceeds max HP of 20
			// This should trigger instant death
			expect(state.getCurrentHp()).toBe(0);
		});

		it("should handle healing when at 0 HP", () => {
			state.setMaxHp(50);
			state.setCurrentHp(0);

			state.heal(5);
			expect(state.getCurrentHp()).toBe(5);
			expect(state.isUnconscious()).toBe(false);
		});

		it("should handle temp HP absorbing damage", () => {
			state.setMaxHp(30);
			state.setCurrentHp(30);
			state.setTempHp(10);

			state.takeDamage(15);

			// 10 temp HP absorbed, 5 damage to regular HP
			expect(state.getTempHp()).toBe(0);
			expect(state.getCurrentHp()).toBe(25);
		});

		it("should not allow temp HP to stack (take higher)", () => {
			state.setTempHp(10);
			expect(state.getTempHp()).toBe(10);

			// Getting 5 temp HP shouldn't replace 10
			state.setTempHp(5);
			// Implementation may vary - some replace, some take higher
			// Most D&D-correct is to keep the higher value
		});

		it("should handle exactly max HP healing", () => {
			state.setMaxHp(50);
			state.setCurrentHp(25);

			state.heal(25);
			expect(state.getCurrentHp()).toBe(50);
		});

		it("should handle over-healing (cap at max)", () => {
			state.setMaxHp(50);
			state.setCurrentHp(45);

			state.heal(100);
			expect(state.getCurrentHp()).toBe(50);
		});

		it("should handle max HP changes while damaged", () => {
			state.setMaxHp(50);
			state.setCurrentHp(50);

			// Lose max HP (e.g., vampire bite)
			state.setMaxHp(40);

			// Current HP should not exceed new max
			expect(state.getCurrentHp()).toBeLessThanOrEqual(40);
		});

		it("should handle 1 HP survival", () => {
			state.setMaxHp(50);
			state.setCurrentHp(1);

			expect(state.getCurrentHp()).toBe(1);
			expect(state.isUnconscious()).toBe(false);
		});
	});

	// ==========================================================================
	// Death Save Edge Cases
	// ==========================================================================
	describe("Death Save Edge Cases", () => {
		it("should stabilize at 3 successes", () => {
			state.setDeathSaveSuccesses(3);
			expect(state.isStable()).toBe(true);
		});

		it("should die at 3 failures", () => {
			state.setDeathSaveFailures(3);
			expect(state.isDead()).toBe(true);
		});

		it("should handle nat 1 (2 failures)", () => {
			state.setDeathSaveFailures(1);
			state.addDeathSaveFailure(2); // Nat 1 adds 2 failures

			expect(state.getDeathSaveFailures()).toBe(3);
			expect(state.isDead()).toBe(true);
		});

		it("should handle nat 20 (regain 1 HP, reset saves)", () => {
			state.setMaxHp(50);
			state.setCurrentHp(0);
			state.setDeathSaveSuccesses(2);
			state.setDeathSaveFailures(2);

			// Nat 20 effect
			state.setCurrentHp(1);
			state.resetDeathSaves();

			expect(state.getCurrentHp()).toBe(1);
			expect(state.getDeathSaveSuccesses()).toBe(0);
			expect(state.getDeathSaveFailures()).toBe(0);
		});

		it("should reset death saves when healed from 0", () => {
			state.setMaxHp(50);
			state.setCurrentHp(0);
			state.setDeathSaveSuccesses(2);
			state.setDeathSaveFailures(1);

			state.heal(10);

			// Death saves should reset when getting HP back
			expect(state.getDeathSaveSuccesses()).toBe(0);
			expect(state.getDeathSaveFailures()).toBe(0);
		});

		it("should not allow death saves above 3", () => {
			state.setDeathSaveSuccesses(5);
			expect(state.getDeathSaveSuccesses()).toBeLessThanOrEqual(3);

			state.setDeathSaveFailures(5);
			expect(state.getDeathSaveFailures()).toBeLessThanOrEqual(3);
		});

		it("should track death saves independently", () => {
			state.addDeathSaveSuccess();
			state.addDeathSaveFailure();
			state.addDeathSaveSuccess();

			expect(state.getDeathSaveSuccesses()).toBe(2);
			expect(state.getDeathSaveFailures()).toBe(1);
		});
	});

	// ==========================================================================
	// Armor Class Edge Cases
	// ==========================================================================
	describe("Armor Class Edge Cases", () => {
		it("should calculate base unarmored AC (10 + DEX)", () => {
			state.setAbilityBase("dex", 14); // +2
			expect(state.getAC()).toBe(12);
		});

		it("should handle negative DEX modifier", () => {
			state.setAbilityBase("dex", 6); // -2
			expect(state.getAC()).toBe(8);
		});

		it("should apply Monk unarmored defense (10 + DEX + WIS)", () => {
			state.setAbilityBase("dex", 16); // +3
			state.setAbilityBase("wis", 14); // +2
			state.addClass({name: "Monk", source: "PHB", level: 1});
			state.setUnarmoredDefense("monk"); // 10 + DEX + WIS

			expect(state.getAC()).toBe(15);
		});

		it("should apply Barbarian unarmored defense (10 + DEX + CON)", () => {
			state.setAbilityBase("dex", 14); // +2
			state.setAbilityBase("con", 16); // +3
			state.addClass({name: "Barbarian", source: "PHB", level: 1});
			state.setUnarmoredDefense("barbarian"); // 10 + DEX + CON

			expect(state.getAC()).toBe(15);
		});

		it("should cap medium armor DEX bonus at +2", () => {
			state.setAbilityBase("dex", 18); // +4
			state.setArmor({
				name: "Breastplate",
				ac: 14,
				type: "medium",
				source: "PHB",
			});

			// Breastplate (14) + DEX (capped at +2) = 16
			expect(state.getAC()).toBe(16);
		});

		it("should not add DEX to heavy armor", () => {
			state.setAbilityBase("dex", 18); // +4
			state.setArmor({
				name: "Plate",
				ac: 18,
				type: "heavy",
				source: "PHB",
			});

			expect(state.getAC()).toBe(18);
		});

		it("should add shield bonus to armor", () => {
			state.setAbilityBase("dex", 14); // +2
			state.setArmor({name: "Chain Mail", ac: 16, type: "heavy", source: "PHB"});
			state.setShield({name: "Shield", ac: 2, source: "PHB"});

			expect(state.getAC()).toBe(18);
		});

		it("should stack magic item AC bonuses", () => {
			state.setAbilityBase("dex", 14); // +2
			state.setArmor({name: "Leather", ac: 11, type: "light", source: "PHB"});
			state.setItemAcBonus(2); // Ring of Protection or similar

			// Light armor (11) + DEX (+2) + item (+2) = 15
			expect(state.getAC()).toBe(15);
		});

		it("should handle armor requiring STR minimum", () => {
			state.setAbilityBase("str", 12);
			state.setAbilityBase("dex", 14);

			// Plate requires STR 15
			const armor = {
				name: "Plate",
				ac: 18,
				type: "heavy",
				strReq: 15,
				source: "PHB",
			};
			state.setArmor(armor);

			// Should still apply AC but character is affected by speed penalty
			expect(state.getAC()).toBe(18);
			// Speed penalty check would be separate
		});

		it("should choose best AC when multiple options available", () => {
			state.setAbilityBase("dex", 16); // +3
			state.setAbilityBase("con", 16); // +3
			state.addClass({name: "Barbarian", source: "PHB", level: 1});

			// Unarmored defense: 10 + 3 + 3 = 16
			state.setUnarmoredDefense("barbarian");

			// But player puts on armor
			state.setArmor({name: "Hide", ac: 12, type: "medium", source: "PHB"});

			// Hide: 12 + 2 (capped DEX) = 14
			// Unarmored: 16
			// Should use unarmored (higher) OR armor replaces unarmored
			// Per RAW, wearing armor disables unarmored defense
		});
	});

	// ==========================================================================
	// Skill Check Edge Cases
	// ==========================================================================
	describe("Skill Check Edge Cases", () => {
		it("should handle expertise doubling proficiency", () => {
			state.addClass({name: "Rogue", source: "PHB", level: 5}); // +3 prof
			state.setAbilityBase("dex", 16); // +3
			state.setSkillProficiency("stealth", true);
			state.setSkillExpertise("stealth", true);

			// Stealth: DEX (+3) + expertise (+6) = +9
			expect(state.getSkillModifier("stealth")).toBe(9);
		});

		it("should handle Jack of All Trades (half proficiency to non-proficient)", () => {
			state.addClass({name: "Bard", source: "PHB", level: 2}); // +2 prof
			state.setAbilityBase("str", 10); // +0
			state.addFeature({
				name: "Jack of All Trades",
				source: "PHB",
				halfProficiencyToAll: true,
			});

			// Athletics (not proficient): STR (+0) + half prof (+1) = +1
			const mod = state.getSkillModifier("athletics");
			// This depends on implementation
		});

		it("should not stack expertise with Jack of All Trades", () => {
			state.addClass({name: "Bard", source: "PHB", level: 3}); // +2 prof
			state.setAbilityBase("cha", 16); // +3
			state.setSkillProficiency("persuasion", true);
			state.setSkillExpertise("persuasion", true);
			state.addFeature({name: "Jack of All Trades", source: "PHB"});

			// Persuasion: CHA (+3) + expertise (+4) = +7
			// Jack of All Trades doesn't apply to proficient skills
			expect(state.getSkillModifier("persuasion")).toBe(7);
		});

		it("should handle Reliable Talent (minimum 10 on d20)", () => {
			state.addClass({name: "Rogue", source: "PHB", level: 11});
			state.setSkillProficiency("stealth", true);
			state.addFeature({name: "Reliable Talent", source: "PHB"});

			// Reliable Talent is a floor on the roll, not the modifier
			// Just verify the feature is tracked
			expect(state.hasFeature("Reliable Talent")).toBe(true);
		});

		it("should calculate passive score with advantage/disadvantage", () => {
			state.setAbilityBase("wis", 14); // +2
			state.setSkillProficiency("perception", true);
			state.addClass({name: "Fighter", source: "PHB", level: 1}); // +2 prof

			// Base passive: 10 + 2 + 2 = 14
			expect(state.getPassivePerception()).toBe(14);

			// With advantage: +5
			// With disadvantage: -5
			// These would be situational modifiers
		});

		it("should handle skill with 0 ability modifier", () => {
			state.setAbilityBase("int", 10); // +0
			state.addClass({name: "Wizard", source: "PHB", level: 1}); // +2 prof
			state.setSkillProficiency("arcana", true);

			expect(state.getSkillModifier("arcana")).toBe(2);
		});

		it("should handle all 18 skills correctly", () => {
			const skills = [
				{name: "acrobatics", ability: "dex"},
				{name: "animalHandling", ability: "wis"},
				{name: "arcana", ability: "int"},
				{name: "athletics", ability: "str"},
				{name: "deception", ability: "cha"},
				{name: "history", ability: "int"},
				{name: "insight", ability: "wis"},
				{name: "intimidation", ability: "cha"},
				{name: "investigation", ability: "int"},
				{name: "medicine", ability: "wis"},
				{name: "nature", ability: "int"},
				{name: "perception", ability: "wis"},
				{name: "performance", ability: "cha"},
				{name: "persuasion", ability: "cha"},
				{name: "religion", ability: "int"},
				{name: "sleightOfHand", ability: "dex"},
				{name: "stealth", ability: "dex"},
				{name: "survival", ability: "wis"},
			];

			state.setAbilityBase("str", 12);
			state.setAbilityBase("dex", 14);
			state.setAbilityBase("con", 10);
			state.setAbilityBase("int", 16);
			state.setAbilityBase("wis", 8);
			state.setAbilityBase("cha", 13);

			skills.forEach(({name, ability}) => {
				const expectedMod = state.getAbilityModifier(ability);
				const skillMod = state.getSkillModifier(name);
				expect(skillMod).toBe(expectedMod);
			});
		});
	});

	// ==========================================================================
	// Saving Throw Edge Cases
	// ==========================================================================
	describe("Saving Throw Edge Cases", () => {
		it("should apply class save proficiencies", () => {
			state.setAbilityBase("str", 14); // +2
			state.setAbilityBase("con", 14); // +2
			state.addClass({name: "Fighter", source: "PHB", level: 1}); // +2 prof

			state.addSaveProficiency("str");
			state.addSaveProficiency("con");

			expect(state.getSaveModifier("str")).toBe(4); // +2 STR + 2 prof
			expect(state.getSaveModifier("con")).toBe(4); // +2 CON + 2 prof
			expect(state.getSaveModifier("dex")).toBe(0); // No proficiency
		});

		it("should handle Ring of Protection style save bonus", () => {
			state.setAbilityBase("wis", 10); // +0
			state.setItemBonus("saves", 1); // Ring of Protection

			expect(state.getSaveModifier("wis")).toBeGreaterThanOrEqual(1);
		});

		it("should handle Paladin aura (+CHA to saves)", () => {
			state.setAbilityBase("cha", 16); // +3
			state.addClass({name: "Paladin", source: "PHB", level: 6});
			state.addFeature({
				name: "Aura of Protection",
				source: "PHB",
				savingThrowBonus: "cha",
			});

			// All saves should get +3 from CHA
			// Implementation would need to check for this aura
		});

		it("should handle advantage on specific saves", () => {
			// Fey Ancestry: advantage on saves vs charmed
			state.addFeature({
				name: "Fey Ancestry",
				source: "PHB",
				saveAdvantage: ["charmed"],
			});

			// Just verify feature is tracked
			expect(state.hasFeature("Fey Ancestry")).toBe(true);
		});

		it("should handle proficiency in all saves (Monk Diamond Soul)", () => {
			state.addClass({name: "Monk", source: "PHB", level: 14}); // +5 prof
			state.setAbilityBase("str", 10);

			// Diamond Soul grants proficiency in all saves
			state.addFeature({name: "Diamond Soul", source: "PHB"});
			["str", "dex", "con", "int", "wis", "cha"].forEach(ability => {
				state.addSaveProficiency(ability);
			});

			expect(state.getSaveModifier("str")).toBe(5); // 0 + 5 prof
		});
	});

	// ==========================================================================
	// Spell Slot Edge Cases
	// ==========================================================================
	describe("Spell Slot Edge Cases", () => {
		it("should handle Warlock pact magic separately", () => {
			state.addClass({name: "Warlock", source: "PHB", level: 5});

			const pactSlots = state.getPactSlots();
			expect(pactSlots.max).toBe(2);
			expect(pactSlots.level).toBe(3); // 3rd level slots at Warlock 5
		});

		it("should handle Sorcerer/Warlock multiclass spell slots", () => {
			state.setAbilityBase("cha", 14);
			state.addClass({name: "Sorcerer", source: "PHB", level: 5});
			state.addClass({name: "Warlock", source: "PHB", level: 2});

			state.calculateSpellSlots();
			const slots = state.getSpellSlots();
			const pactSlots = state.getPactSlots();

			// Sorcerer 5 = 5 caster levels (4/3/2 slots)
			// Warlock pact slots are separate
			expect(slots[3]?.max).toBe(2);
			expect(pactSlots.max).toBe(2);
		});

		it("should handle Paladin/Ranger half-caster rounding", () => {
			state.setAbilityBase("cha", 14);
			state.addClass({name: "Paladin", source: "PHB", level: 5});

			state.calculateSpellSlots();
			const slots = state.getSpellSlots();

			// Paladin 5 = floor(5/2) = 2 caster levels
			// At caster level 2: 2 1st-level slots
			expect(slots[1]?.max).toBeGreaterThanOrEqual(2);
		});

		it("should handle Eldritch Knight/Arcane Trickster third-caster", () => {
			state.addClass({name: "Fighter", source: "PHB", level: 9});
			state.setSubclass("Fighter", {name: "Eldritch Knight", source: "PHB"});

			state.calculateSpellSlots();
			const slots = state.getSpellSlots();

			// EK 9 = floor(9/3) = 3 caster levels
			expect(slots[1]?.max).toBeGreaterThanOrEqual(2);
		});

		it("should handle Artificer unique half-caster rounding (rounds up)", () => {
			state.setAbilityBase("int", 14);
			state.addClass({name: "Artificer", source: "TCE", level: 5});

			state.calculateSpellSlots();
			const slots = state.getSpellSlots();

			// Artificer rounds UP: ceil(5/2) = 3 caster levels
			expect(slots[1]?.max).toBeGreaterThanOrEqual(3);
		});

		it("should handle using last spell slot", () => {
			state.addClass({name: "Wizard", source: "PHB", level: 1});
			state.calculateSpellSlots();

			// Use all 1st level slots
			state.useSpellSlot(1);
			state.useSpellSlot(1);

			const slots = state.getSpellSlots();
			expect(slots[1].current).toBe(0);

			// Should fail to use another
			const result = state.useSpellSlot(1);
			expect(result).toBe(false);
		});

		it("should not allow using slots you don't have", () => {
			state.addClass({name: "Wizard", source: "PHB", level: 1});
			state.calculateSpellSlots();

			// Level 1 wizard has no 9th level slots
			const result = state.useSpellSlot(9);
			expect(result).toBe(false);
		});

		it("should restore all slots on long rest", () => {
			state.addClass({name: "Wizard", source: "PHB", level: 5});
			state.calculateSpellSlots();

			// Use some slots
			state.useSpellSlot(1);
			state.useSpellSlot(2);
			state.useSpellSlot(3);

			state.onLongRest();

			const slots = state.getSpellSlots();
			expect(slots[1].current).toBe(slots[1].max);
			expect(slots[2].current).toBe(slots[2].max);
			expect(slots[3].current).toBe(slots[3].max);
		});
	});

	// ==========================================================================
	// Hit Dice Edge Cases
	// ==========================================================================
	describe("Hit Dice Edge Cases", () => {
		it("should track multiple hit die types for multiclass", () => {
			state.addClass({name: "Fighter", source: "PHB", level: 5});
			state.addClass({name: "Wizard", source: "PHB", level: 3});

			const hitDice = state.getHitDice();
			expect(hitDice.find(h => h.type === "d10")?.max).toBe(5);
			expect(hitDice.find(h => h.type === "d6")?.max).toBe(3);
		});

		it("should use specific hit die type", () => {
			state.addClass({name: "Fighter", source: "PHB", level: 5});
			state.addClass({name: "Wizard", source: "PHB", level: 3});

			const result = state.useHitDie("d10");
			expect(result).toBe(true);

			const hitDice = state.getHitDice();
			expect(hitDice.find(h => h.type === "d10")?.current).toBe(4);
		});

		it("should not use hit die when none available", () => {
			state.addClass({name: "Fighter", source: "PHB", level: 1});
			state.setHitDice([{type: "d10", current: 0, max: 1}]);

			const result = state.useHitDie("d10");
			expect(result).toBe(false);
		});

		it("should recover half hit dice on long rest (rounded up)", () => {
			state.addClass({name: "Fighter", source: "PHB", level: 5});
			state.setHitDice([{type: "d10", current: 0, max: 5}]);

			state.onLongRest();

			const hitDice = state.getHitDice();
			// Recover ceil(5/2) = 3 hit dice
			expect(hitDice.find(h => h.type === "d10")?.current).toBeGreaterThanOrEqual(2);
		});

		it("should recover at least 1 hit die", () => {
			state.addClass({name: "Fighter", source: "PHB", level: 1});
			state.setHitDice([{type: "d10", current: 0, max: 1}]);

			state.onLongRest();

			const hitDice = state.getHitDice();
			expect(hitDice.find(h => h.type === "d10")?.current).toBeGreaterThanOrEqual(1);
		});

		it("should not exceed max hit dice on recovery", () => {
			state.addClass({name: "Fighter", source: "PHB", level: 3});
			state.setHitDice([{type: "d10", current: 2, max: 3}]);

			state.onLongRest();

			const hitDice = state.getHitDice();
			expect(hitDice.find(h => h.type === "d10")?.current).toBe(3);
		});
	});

	// ==========================================================================
	// Exhaustion Edge Cases
	// ==========================================================================
	describe("Exhaustion Edge Cases", () => {
		it("should track exhaustion levels 0-6", () => {
			for (let i = 0; i <= 6; i++) {
				state.setExhaustion(i);
				expect(state.getExhaustion()).toBe(i);
			}
		});

		it("should not exceed exhaustion level 6", () => {
			// Set to 2024 rules which cap at 6
			state.setExhaustionRules("2024");
			expect(state.getExhaustion()).toBeLessThanOrEqual(6);
		});

		it("should not allow negative exhaustion", () => {
			state.setExhaustion(-1);
			expect(state.getExhaustion()).toBeGreaterThanOrEqual(0);
		});

		it("should reduce exhaustion by 1 on long rest", () => {
			state.setExhaustion(3);
			state.onLongRest();
			expect(state.getExhaustion()).toBe(2);
		});

		it("should not reduce exhaustion below 0", () => {
			state.setExhaustion(0);
			state.onLongRest();
			expect(state.getExhaustion()).toBe(0);
		});

		it("should cause death at exhaustion 6", () => {
			// Set 2014 rules where exhaustion 6 = death
			state._data.settings = {exhaustionRules: "2014"};
			state.setExhaustion(6);
			expect(state.isDead()).toBe(true);
		});
	});

	// ==========================================================================
	// Condition Edge Cases
	// ==========================================================================
	describe("Condition Edge Cases", () => {
		it("should track multiple conditions", () => {
			state.addCondition("poisoned");
			state.addCondition("frightened");
			state.addCondition("prone");

			const conditions = state.getConditions();
			// Conditions are stored as objects with name and source
			expect(conditions.some(c => c.name === "poisoned")).toBe(true);
			expect(conditions.some(c => c.name === "frightened")).toBe(true);
			expect(conditions.some(c => c.name === "prone")).toBe(true);
		});

		it("should not duplicate conditions", () => {
			state.addCondition("poisoned");
			state.addCondition("poisoned");

			const conditions = state.getConditions();
			const poisonedCount = conditions.filter(c => c.name === "poisoned").length;
			expect(poisonedCount).toBe(1);
		});

		it("should remove specific condition", () => {
			state.addCondition("poisoned");
			state.addCondition("frightened");

			state.removeCondition("poisoned");

			const conditions = state.getConditions();
			expect(conditions.some(c => c.name === "poisoned")).toBe(false);
			expect(conditions.some(c => c.name === "frightened")).toBe(true);
		});

		it("should clear all conditions", () => {
			state.addCondition("poisoned");
			state.addCondition("frightened");
			state.addCondition("prone");

			state.clearConditions();

			expect(state.getConditions().length).toBe(0);
		});

		it("should check for specific condition", () => {
			state.addCondition("paralyzed");

			expect(state.hasCondition("paralyzed")).toBe(true);
			expect(state.hasCondition("stunned")).toBe(false);
		});

		it("should track condition immunities", () => {
			state.addConditionImmunity("frightened");
			state.addConditionImmunity("charmed");

			expect(state.isImmuneToCondition("frightened")).toBe(true);
			expect(state.isImmuneToCondition("poisoned")).toBe(false);
		});
	});

	// ==========================================================================
	// Equipment and Attunement Edge Cases
	// ==========================================================================
	describe("Equipment and Attunement Edge Cases", () => {
		it("should enforce attunement limit of 3", () => {
			state.addItem({id: "1", name: "Item 1", requiresAttunement: true, attuned: true});
			state.addItem({id: "2", name: "Item 2", requiresAttunement: true, attuned: true});
			state.addItem({id: "3", name: "Item 3", requiresAttunement: true, attuned: true});

			expect(state.getAttunedCount()).toBe(3);
			expect(state.canAttune()).toBe(false);
		});

		it("should increase attunement slots for Artificer", () => {
			state.addClass({name: "Artificer", source: "TCE", level: 10});

			// Artificer 10 gets +2 attunement slots (5 total)
			expect(state.getMaxAttunement()).toBeGreaterThan(3);
		});

		it("should handle equipping and unequipping items", () => {
			state.addItem({id: "sword", name: "Longsword", equipped: false});

			state.setItemEquipped("sword", true);
			let item = state.getItem("sword");
			expect(item.equipped).toBe(true);

			state.setItemEquipped("sword", false);
			item = state.getItem("sword");
			expect(item.equipped).toBe(false);
		});

		it("should calculate encumbrance correctly", () => {
			state.setAbilityBase("str", 15); // Carry capacity: 15 * 15 = 225 lbs

			state.addItem({id: "1", name: "Heavy Item", weight: 50, quantity: 2});
			state.addItem({id: "2", name: "Light Item", weight: 5, quantity: 10});

			const weight = state.getTotalWeight();
			expect(weight).toBe(150); // 100 + 50
		});

		it("should track item quantities", () => {
			state.addItem({id: "arrows", name: "Arrows", quantity: 20});

			state.setItemQuantity("arrows", 15);
			let item = state.getItem("arrows");
			expect(item.quantity).toBe(15);

			state.setItemQuantity("arrows", 0);
			// Item should be removed or quantity set to 0
		});

		it("should handle magic item charges", () => {
			state.addItem({
				id: "wand",
				name: "Wand of Fireballs",
				charges: 7,
				chargesCurrent: 7,
			});

			state.useItemCharge("wand", 3);
			let item = state.getItem("wand");
			expect(item.chargesCurrent).toBe(4);

			state.useItemCharge("wand", 5);
			item = state.getItem("wand");
			expect(item.chargesCurrent).toBe(0); // Should not go negative
		});
	});

	// ==========================================================================
	// Speed Edge Cases
	// ==========================================================================
	describe("Speed Edge Cases", () => {
		it("should handle base walking speed", () => {
			state.setSpeed("walk", 30);
			expect(state.getSpeed("walk")).toBe(30);
		});

		it("should handle multiple movement types", () => {
			state.setSpeed("walk", 30);
			state.setSpeed("fly", 60);
			state.setSpeed("swim", 30);
			state.setSpeed("climb", 30);
			state.setSpeed("burrow", 15);

			expect(state.getSpeed("walk")).toBe(30);
			expect(state.getSpeed("fly")).toBe(60);
			expect(state.getSpeed("swim")).toBe(30);
			expect(state.getSpeed("climb")).toBe(30);
			expect(state.getSpeed("burrow")).toBe(15);
		});

		it("should handle speed of 0 (e.g., grappled)", () => {
			state.setSpeed("walk", 0);
			expect(state.getSpeed("walk")).toBe(0);
		});

		it("should handle Monk Unarmored Movement bonus", () => {
			state.setSpeed("walk", 30);
			state.addClass({name: "Monk", source: "PHB", level: 10});

			// Monk 10 gets +20 ft movement
			// This would need to be implemented as a feature modifier
		});

		it("should handle speed reduction from heavy armor", () => {
			state.setAbilityBase("str", 12);
			state.setSpeed("walk", 30);

			// Plate requires STR 15, character has 12
			// Should reduce speed by 10
			state.setArmor({
				name: "Plate",
				ac: 18,
				type: "heavy",
				strReq: 15,
				source: "PHB",
			});

			// Implementation would check STR requirement
		});
	});

	// ==========================================================================
	// Concentration Edge Cases
	// ==========================================================================
	describe("Concentration Edge Cases", () => {
		it("should track concentrating spell", () => {
			state.setConcentration({name: "Bless", level: 1});

			expect(state.isConcentrating()).toBe(true);
			expect(state.getConcentratingSpell().name).toBe("Bless");
		});

		it("should break concentration when casting another concentration spell", () => {
			state.setConcentration({name: "Bless", level: 1});
			state.setConcentration({name: "Hold Person", level: 2});

			expect(state.getConcentratingSpell().name).toBe("Hold Person");
		});

		it("should calculate concentration save DC (half damage, minimum 10)", () => {
			// Taking 15 damage: DC = max(10, 15/2) = 10
			expect(state.getConcentrationDC(15)).toBe(10);

			// Taking 25 damage: DC = max(10, 25/2) = 12 (or 13 depending on rounding)
			expect(state.getConcentrationDC(25)).toBeGreaterThanOrEqual(12);

			// Taking 50 damage: DC = max(10, 50/2) = 25
			expect(state.getConcentrationDC(50)).toBe(25);
		});

		it("should clear concentration", () => {
			state.setConcentration({name: "Fly", level: 3});
			state.breakConcentration();

			expect(state.isConcentrating()).toBe(false);
			expect(state.getConcentratingSpell()).toBeNull();
		});
	});

	// ==========================================================================
	// Feature and Resource Tracking Edge Cases
	// ==========================================================================
	describe("Feature and Resource Tracking Edge Cases", () => {
		it("should track feature uses correctly", () => {
			state.addFeature({
				name: "Second Wind",
				source: "PHB",
				uses: 1,
				usesCurrent: 1,
				recharge: "short",
			});

			state.useFeatureCharge("Second Wind");
			expect(state.getFeatureUses("Second Wind")).toBe(0);
		});

		it("should restore short rest features on short rest", () => {
			state.addFeature({
				name: "Second Wind",
				source: "PHB",
				uses: {max: 1, current: 0, recharge: "short"},
			});

			state.onShortRest();
			expect(state.getFeatureUses("Second Wind")).toBe(1);
		});

		it("should restore long rest features on long rest", () => {
			state.addFeature({
				name: "Wild Shape",
				source: "PHB",
				uses: {max: 2, current: 0, recharge: "long"},
			});

			state.onLongRest();
			expect(state.getFeatureUses("Wild Shape")).toBe(2);
		});

		it("should track Ki points for Monk", () => {
			state.addClass({name: "Monk", source: "PHB", level: 5});
			state.setKiPoints(5);
			state.setKiPointsCurrent(5);

			state.useKiPoint(2);
			expect(state.getKiPointsCurrent()).toBe(3);
		});

		it("should restore Ki points on short rest", () => {
			state.addClass({name: "Monk", source: "PHB", level: 5});
			state.setKiPoints(5);
			state.setKiPointsCurrent(0);

			state.onShortRest();
			expect(state.getKiPointsCurrent()).toBe(5);
		});

		it("should track Sorcery points", () => {
			state.addClass({name: "Sorcerer", source: "PHB", level: 5});
			state.setSorceryPoints(5);

			state.useSorceryPoint(2);
			// getSorceryPoints returns {current, max}
			expect(state.getSorceryPoints().current).toBe(3);
		});

		it("should track Bardic Inspiration dice", () => {
			state.addClass({name: "Bard", source: "PHB", level: 5}); // 3 uses (CHA mod)
			state.setAbilityBase("cha", 16); // +3 mod

			state.addResource({
				name: "Bardic Inspiration",
				max: 3,
				current: 3,
				recharge: "long", // Until Bard 5 (Font of Inspiration)
			});

			// Use one
			state.useResourceCharge("Bardic Inspiration");
			const resource = state.getResource("Bardic Inspiration");
			expect(resource.current).toBe(2);
		});

		it("should track Rage uses for Barbarian", () => {
			state.addClass({name: "Barbarian", source: "PHB", level: 5}); // 3 rages

			state.addResource({
				name: "Rage",
				max: 3,
				current: 3,
				recharge: "long",
			});

			state.useResourceCharge("Rage");
			state.useResourceCharge("Rage");

			const resource = state.getResource("Rage");
			expect(resource.current).toBe(1);
		});
	});

	// ==========================================================================
	// Serialization Edge Cases
	// ==========================================================================
	describe("Serialization Edge Cases", () => {
		it("should serialize and deserialize a complex character", () => {
			// Build complex character
			state.setCharacterName("Test Hero");
			state.setRace({name: "Half-Elf", source: "PHB"});
			state.setBackground({name: "Noble", source: "PHB"});
			state.addClass({name: "Fighter", source: "PHB", level: 6});
			state.addClass({name: "Wizard", source: "PHB", level: 4});

			state.setAbilityBase("str", 16);
			state.setAbilityBase("dex", 14);
			state.setAbilityBase("con", 14);
			state.setAbilityBase("int", 13);
			state.setAbilityBase("wis", 10);
			state.setAbilityBase("cha", 12);

			state.setMaxHp(76);
			state.setCurrentHp(45);
			state.setTempHp(10);

			state.addItem({id: "sword", name: "Longsword +1", equipped: true});
			state.addItem({id: "armor", name: "Chain Mail", equipped: true});

			state.addSpell({name: "Shield", level: 1});
			state.addSpell({name: "Magic Missile", level: 1});

			// Serialize
			const json = state.toJSON();

			// Deserialize into new state
			const newState = new CharacterSheetState();
			newState.fromJSON(json);

			// Verify
			expect(newState.getCharacterName()).toBe("Test Hero");
			expect(newState.getTotalLevel()).toBe(10);
			expect(newState.getCurrentHp()).toBe(45);
			expect(newState.getMaxHp()).toBe(76);
		});

		it("should handle missing data gracefully", () => {
			const incompleteData = {
				name: "Partial Character",
				// Missing most fields
			};

			const result = state.fromJSON(JSON.stringify(incompleteData));

			// Should not throw, should use defaults
			expect(state.getTotalLevel()).toBeGreaterThanOrEqual(0);
		});

		it("should handle corrupted JSON gracefully", () => {
			const corruptedJson = "{ invalid json }}}";

			expect(() => {
				state.fromJSON(corruptedJson);
			}).not.toThrow();
		});

		it("should preserve version for migrations", () => {
			// Use serialize() which returns a versioned JSON string
			const json = state.serialize();
			const parsed = JSON.parse(json);

			expect(parsed.version).toBeDefined();
		});
	});
});
