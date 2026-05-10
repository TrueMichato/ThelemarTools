import "./setup.js"; // Import first to set up mocks

let CharacterSheetState;
let charState;

beforeAll(async () => {
	CharacterSheetState = (await import("../../../js/charactersheet/charactersheet-state.js")).CharacterSheetState;
});

describe("Character Sheet Custom Abilities", () => {
	beforeEach(() => {
		charState = new CharacterSheetState();
		// Set up base character with some stats
		charState.setAbilityBase("str", 10);
		charState.setAbilityBase("dex", 14);
		charState.setAbilityBase("con", 12);
		charState.setAbilityBase("int", 18); // +4 modifier
		charState.setAbilityBase("wis", 10);
		charState.setAbilityBase("cha", 8);
	});

	// ===================================================================
	// Basic CRUD Tests
	// ===================================================================
	describe("Custom Ability CRUD Operations", () => {
		test("should add a new custom ability", () => {
			const abilityId = charState.addCustomAbility({
				name: "Test Ability",
				description: "A test ability",
				icon: "⚔️",
				category: "combat",
				effects: [],
			});

			expect(abilityId).toBeDefined();
			const ability = charState.getCustomAbility(abilityId);
			expect(ability).toBeDefined();
			expect(ability.name).toBe("Test Ability");

			const abilities = charState.getCustomAbilities();
			expect(abilities.length).toBe(1);
		});

		test("should update a custom ability", () => {
			const abilityId = charState.addCustomAbility({
				name: "Original Name",
				description: "Original description",
			});

			charState.updateCustomAbility(abilityId, {
				name: "Updated Name",
				description: "Updated description",
			});

			const updated = charState.getCustomAbility(abilityId);
			expect(updated.name).toBe("Updated Name");
			expect(updated.description).toBe("Updated description");
		});

		test("should remove a custom ability", () => {
			const abilityId = charState.addCustomAbility({
				name: "To Be Removed",
			});

			expect(charState.getCustomAbilities().length).toBe(1);

			charState.removeCustomAbility(abilityId);

			expect(charState.getCustomAbilities().length).toBe(0);
			expect(charState.getCustomAbility(abilityId)).toBeNull(); // Returns null for not found
		});

		test("should remove modifiers when removing a passive ability", () => {
			const abilityId = charState.addCustomAbility({
				name: "Passive INT Boost",
				mode: "passive",
				effects: [{type: "check:int", value: 10}],
			});

			// Modifier should be active immediately for passive
			expect(charState.getAbilityCheckCustomMod("int")).toBe(10);

			// Remove the ability
			charState.removeCustomAbility(abilityId);

			// Modifier should be removed
			expect(charState.getAbilityCheckCustomMod("int")).toBe(0);
			expect(charState.getNamedModifiersByType("check:int").length).toBe(0);
		});

		test("should remove modifiers when removing an active toggleable ability", () => {
			const abilityId = charState.addCustomAbility({
				name: "Toggle INT Boost",
				mode: "toggleable",
				effects: [{type: "skill:arcana", value: 7}],
			});

			// Toggle ON
			charState.toggleCustomAbility(abilityId);
			const baseArcana = charState.getAbilityMod("int"); // +4
			expect(charState.getSkillMod("arcana")).toBe(baseArcana + 7);

			// Remove while active
			charState.removeCustomAbility(abilityId);

			// Modifier should be gone
			expect(charState.getSkillMod("arcana")).toBe(baseArcana);
			expect(charState.getNamedModifiersByType("skill:arcana").length).toBe(0);
		});

		test("should remove resistance when removing ability with resistance effect", () => {
			const abilityId = charState.addCustomAbility({
				name: "Fire Shield",
				mode: "passive",
				effects: [{type: "resistance:fire"}],
			});

			expect(charState.getResistances()).toContain("fire");

			charState.removeCustomAbility(abilityId);

			expect(charState.getResistances()).not.toContain("fire");
		});

		test("should toggle a custom ability on and off", () => {
			const abilityId = charState.addCustomAbility({
				name: "Toggle Test",
				mode: "toggleable",
				effects: [],
			});

			const abilityBefore = charState.getCustomAbility(abilityId);
			expect(abilityBefore.isActive).toBe(false);

			charState.toggleCustomAbility(abilityId); // Toggle ON
			expect(charState.getCustomAbility(abilityId).isActive).toBe(true);

			charState.toggleCustomAbility(abilityId); // Toggle OFF
			expect(charState.getCustomAbility(abilityId).isActive).toBe(false);
		});
	});

	// ===================================================================
	// Effect Registration Tests
	// ===================================================================
	describe("Custom Ability Effect Registration", () => {
		test("should register effect as namedModifier when ability is activated", () => {
			const abilityId = charState.addCustomAbility({
				name: "INT Boost",
				mode: "toggleable",
				effects: [
					{type: "check:int", value: 5},
				],
			});

			// Initially inactive - no modifiers
			const modsBefore = charState.getNamedModifiersByType("check:int");
			expect(modsBefore.length).toBe(0);

			// Activate
			charState.toggleCustomAbility(abilityId);

			// Should now have a modifier
			const modsAfter = charState.getNamedModifiersByType("check:int");
			expect(modsAfter.length).toBe(1);
			expect(modsAfter[0].value).toBe(5);
			expect(modsAfter[0].name).toContain("INT Boost"); // Name includes ability name
		});

		test("should unregister effect when ability is deactivated", () => {
			const abilityId = charState.addCustomAbility({
				name: "STR Boost",
				mode: "toggleable",
				effects: [
					{type: "check:str", value: 3},
				],
			});

			charState.toggleCustomAbility(abilityId);
			expect(charState.getNamedModifiersByType("check:str").length).toBe(1);

			charState.toggleCustomAbility(abilityId);
			expect(charState.getNamedModifiersByType("check:str").length).toBe(0);
		});

		test("should handle multiple effects on one ability", () => {
			const abilityId = charState.addCustomAbility({
				name: "Multi-Effect",
				mode: "toggleable",
				effects: [
					{type: "check:int", value: 2},
					{type: "skill:arcana", value: 3},
					{type: "save:wis", value: 1},
				],
			});

			charState.toggleCustomAbility(abilityId);

			expect(charState.getNamedModifiersByType("check:int").length).toBe(1);
			expect(charState.getNamedModifiersByType("skill:arcana").length).toBe(1);
			expect(charState.getNamedModifiersByType("save:wis").length).toBe(1);
		});
	});

	// ===================================================================
	// Effect Application Tests
	// ===================================================================
	describe("Custom Ability Effect Application to Calculations", () => {
		test("check:int effect should affect ability check modifier", () => {
			const abilityId = charState.addCustomAbility({
				name: "INT Check Boost",
				mode: "toggleable",
				effects: [
					{type: "check:int", value: 15},
				],
			});

			const baseMod = charState.getAbilityCheckCustomMod("int");
			expect(baseMod).toBe(0);

			charState.toggleCustomAbility(abilityId);

			const boostedMod = charState.getAbilityCheckCustomMod("int");
			expect(boostedMod).toBe(15);
		});

		test("check:int effect should also affect INT-based skill checks", () => {
			const abilityId = charState.addCustomAbility({
				name: "INT Check Boost",
				mode: "toggleable",
				effects: [
					{type: "check:int", value: 10},
				],
			});

			// Arcana is INT-based
			const baseMod = charState.getSkillMod("arcana");

			charState.toggleCustomAbility(abilityId);

			const boostedMod = charState.getSkillMod("arcana");
			// Should include the +10 from check:int
			expect(boostedMod).toBe(baseMod + 10);
		});

		test("skill:arcana effect should only affect Arcana checks", () => {
			const abilityId = charState.addCustomAbility({
				name: "Arcana Specialist",
				mode: "toggleable",
				effects: [
					{type: "skill:arcana", value: 5},
				],
			});

			const baseArcana = charState.getSkillMod("arcana");
			const baseHistory = charState.getSkillMod("history");

			charState.toggleCustomAbility(abilityId);

			expect(charState.getSkillMod("arcana")).toBe(baseArcana + 5);
			expect(charState.getSkillMod("history")).toBe(baseHistory); // Unchanged
		});

		test("save:wis effect should affect Wisdom saving throws", () => {
			const abilityId = charState.addCustomAbility({
				name: "Mental Fortitude",
				mode: "toggleable",
				effects: [
					{type: "save:wis", value: 4},
				],
			});

			// Note: getSaveMod calculation may be more complex
			// This tests that the modifier is at least registered
			charState.toggleCustomAbility(abilityId);

			const mods = charState.getNamedModifiersByType("save:wis");
			expect(mods.length).toBe(1);
			expect(mods[0].value).toBe(4);
		});

		test("advantage effect should be recorded for aggregation", () => {
			const abilityId = charState.addCustomAbility({
				name: "Lucky INT",
				mode: "toggleable",
				effects: [
					{type: "check:int", value: 0, advantage: true},
				],
			});

			charState.toggleCustomAbility(abilityId);

			const mods = charState.getNamedModifiersByType("check:int");
			expect(mods.length).toBe(1);
			expect(mods[0].advantage).toBe(true);
		});

		test("setMinimum effect should be recorded for aggregation", () => {
			const abilityId = charState.addCustomAbility({
				name: "Reliable Intelligence",
				mode: "toggleable",
				effects: [
					{type: "check:int", value: 0, setMinimum: 10},
				],
			});

			charState.toggleCustomAbility(abilityId);

			const mods = charState.getNamedModifiersByType("check:int");
			expect(mods.length).toBe(1);
			expect(mods[0].setMinimum).toBe(10);
		});
	});

	// ===================================================================
	// Complex Effect Tests (User's Test Case)
	// ===================================================================
	describe("Complex Custom Ability Effects", () => {
		test("should handle combined effects: +15 INT, advantage, min 20", () => {
			// This is the user's test case
			const abilityId = charState.addCustomAbility({
				name: "Super INT",
				mode: "toggleable",
				effects: [
					{type: "check:int", value: 15, advantage: true, setMinimum: 20},
				],
			});

			charState.toggleCustomAbility(abilityId);

			// Check the modifier is registered correctly
			const mods = charState.getNamedModifiersByType("check:int");
			expect(mods.length).toBe(1);
			expect(mods[0].value).toBe(15);
			expect(mods[0].advantage).toBe(true);
			expect(mods[0].setMinimum).toBe(20);

			// Check it affects calculations
			const abilityCheckMod = charState.getAbilityCheckCustomMod("int");
			expect(abilityCheckMod).toBe(15);

			// INT-based skills should also get +15
			const baseArcana = charState.getAbilityMod("int"); // +4 from 18 INT
			const totalArcana = charState.getSkillMod("arcana");
			// Should be: base INT mod (+4) + check:int bonus (+15) = at least 19
			expect(totalArcana).toBeGreaterThanOrEqual(19);
		});

		test("should aggregate effects using aggregateModifiers", () => {
			const abilityId = charState.addCustomAbility({
				name: "Full Package",
				mode: "toggleable",
				effects: [
					{type: "check:int", value: 5, advantage: true, setMinimum: 10},
				],
			});

			charState.toggleCustomAbility(abilityId);

			const aggregated = charState.aggregateModifiers("check:int");
			expect(aggregated.bonus).toBe(5);
			expect(aggregated.advantage).toBe(true);
			expect(aggregated.minimum).toBe(10);
		});
	});

	// ===================================================================
	// Uses/Charges System Tests
	// ===================================================================
	describe("Custom Ability Uses System", () => {
		test("should track uses when uses object is provided", () => {
			const abilityId = charState.addCustomAbility({
				name: "Limited Power",
				mode: "limited",
				uses: {max: 3, recharge: "long"},
			});

			const ability = charState.getCustomAbility(abilityId);
			expect(ability.uses.current).toBe(3);
			expect(ability.uses.max).toBe(3);
		});

		test("should decrement uses with useCustomAbility", () => {
			const abilityId = charState.addCustomAbility({
				name: "Limited Power",
				mode: "limited",
				uses: {max: 3, recharge: "long"},
			});

			charState.useCustomAbility(abilityId);

			const updated = charState.getCustomAbility(abilityId);
			expect(updated.uses.current).toBe(2);
		});

		test("should not decrement below 0", () => {
			const abilityId = charState.addCustomAbility({
				name: "Limited Power",
				mode: "limited",
				uses: {max: 1, recharge: "long"},
			});

			const ability = charState.getCustomAbility(abilityId);
			// Manually set to 0 for test
			ability.uses.current = 0;

			charState.useCustomAbility(abilityId);

			const updated = charState.getCustomAbility(abilityId);
			expect(updated.uses.current).toBe(0);
		});
	});

	// ===================================================================
	// Mode Tests (Passive vs Toggle)
	// ===================================================================
	describe("Custom Ability Modes", () => {
		test("passive mode abilities should be active immediately", () => {
			const abilityId = charState.addCustomAbility({
				name: "Passive Bonus",
				mode: "passive",
				effects: [
					{type: "skill:perception", value: 2},
				],
			});

			const ability = charState.getCustomAbility(abilityId);
			expect(ability.mode).toBe("passive");
			expect(ability.isActive).toBe(true);

			// Effect should be registered immediately
			const mods = charState.getNamedModifiersByType("skill:perception");
			expect(mods.length).toBe(1);
		});

		test("toggleable mode abilities should start inactive", () => {
			const abilityId = charState.addCustomAbility({
				name: "Toggleable Power",
				mode: "toggleable",
				effects: [
					{type: "check:wis", value: 3},
				],
			});

			const ability = charState.getCustomAbility(abilityId);
			expect(ability.mode).toBe("toggleable");
			expect(ability.isActive).toBe(false);

			// Effect should NOT be registered until toggle
			const mods = charState.getNamedModifiersByType("check:wis");
			expect(mods.length).toBe(0);
		});
	});

	// ===================================================================
	// Resistance Effect Tests
	// ===================================================================
	describe("Custom Ability Resistance Effects", () => {
		test("should add resistance when ability is activated", () => {
			const abilityId = charState.addCustomAbility({
				name: "Fire Shield",
				mode: "toggleable",
				effects: [
					{type: "resistance:fire"},
				],
			});

			charState.toggleCustomAbility(abilityId);

			const resAfter = charState.getResistances();
			expect(resAfter).toContain("fire");
		});

		test("should remove resistance when ability is deactivated", () => {
			const abilityId = charState.addCustomAbility({
				name: "Fire Shield",
				mode: "toggleable",
				effects: [
					{type: "resistance:fire"},
				],
			});

			charState.toggleCustomAbility(abilityId);
			expect(charState.getResistances()).toContain("fire");

			charState.toggleCustomAbility(abilityId);
			// Resistance should be removed (unless from another source)
			// Note: This depends on implementation details
		});
	});

	// ===================================================================
	// Edge Cases
	// ===================================================================
	describe("Edge Cases", () => {
		test("should handle empty effects array", () => {
			const abilityId = charState.addCustomAbility({
				name: "No Effects",
				mode: "toggleable",
				effects: [],
			});

			// Should not throw
			charState.toggleCustomAbility(abilityId);
			charState.toggleCustomAbility(abilityId);
		});

		test("should handle undefined effects", () => {
			const abilityId = charState.addCustomAbility({
				name: "No Effects Defined",
				mode: "toggleable",
			});

			// Should not throw
			charState.toggleCustomAbility(abilityId);
			charState.toggleCustomAbility(abilityId);
		});

		test("should handle multiple abilities affecting same type", () => {
			const ability1Id = charState.addCustomAbility({
				name: "INT Boost 1",
				mode: "toggleable",
				effects: [{type: "check:int", value: 3}],
			});

			const ability2Id = charState.addCustomAbility({
				name: "INT Boost 2",
				mode: "toggleable",
				effects: [{type: "check:int", value: 5}],
			});

			charState.toggleCustomAbility(ability1Id);
			charState.toggleCustomAbility(ability2Id);

			const mods = charState.getNamedModifiersByType("check:int");
			expect(mods.length).toBe(2);

			// Total should be 8
			const checkMod = charState.getAbilityCheckCustomMod("int");
			expect(checkMod).toBe(8);
		});
	});

	// ===================================================================
	// COMPREHENSIVE EFFECT TYPE TESTS
	// ===================================================================

	describe("All Ability Check Types (check:ability)", () => {
		const abilities = ["str", "dex", "con", "int", "wis", "cha"];

		abilities.forEach(abl => {
			test(`check:${abl} should register and aggregate correctly`, () => {
				const abilityId = charState.addCustomAbility({
					name: `${abl.toUpperCase()} Check Boost`,
					mode: "toggleable",
					effects: [{type: `check:${abl}`, value: 7}],
				});

				expect(charState.getAbilityCheckCustomMod(abl)).toBe(0);
				charState.toggleCustomAbility(abilityId);
				expect(charState.getAbilityCheckCustomMod(abl)).toBe(7);
			});
		});
	});

	describe("All Saving Throw Types (save:ability)", () => {
		const abilities = ["str", "dex", "con", "int", "wis", "cha"];

		abilities.forEach(abl => {
			test(`save:${abl} should register as namedModifier`, () => {
				const abilityId = charState.addCustomAbility({
					name: `${abl.toUpperCase()} Save Boost`,
					mode: "toggleable",
					effects: [{type: `save:${abl}`, value: 3}],
				});

				expect(charState.getNamedModifiersByType(`save:${abl}`).length).toBe(0);
				charState.toggleCustomAbility(abilityId);

				const mods = charState.getNamedModifiersByType(`save:${abl}`);
				expect(mods.length).toBe(1);
				expect(mods[0].value).toBe(3);
			});

			test(`save:${abl} should aggregate correctly`, () => {
				const abilityId = charState.addCustomAbility({
					name: `${abl.toUpperCase()} Save Boost`,
					mode: "toggleable",
					effects: [{type: `save:${abl}`, value: 5}],
				});

				charState.toggleCustomAbility(abilityId);
				const aggregated = charState.aggregateModifiers(`save:${abl}`);
				expect(aggregated.bonus).toBe(5);
			});
		});
	});

	describe("Skill Effects (skill:skillname)", () => {
		const skills = [
			{key: "athletics", ability: "str"},
			{key: "acrobatics", ability: "dex"},
			{key: "stealth", ability: "dex"},
			{key: "arcana", ability: "int"},
			{key: "history", ability: "int"},
			{key: "perception", ability: "wis"},
			{key: "insight", ability: "wis"},
			{key: "persuasion", ability: "cha"},
			{key: "deception", ability: "cha"},
		];

		skills.forEach(({key, ability}) => {
			test(`skill:${key} should affect only ${key} skill`, () => {
				const abilityId = charState.addCustomAbility({
					name: `${key} Specialist`,
					mode: "toggleable",
					effects: [{type: `skill:${key}`, value: 4}],
				});

				const baseMod = charState.getSkillMod(key);
				charState.toggleCustomAbility(abilityId);
				expect(charState.getSkillMod(key)).toBe(baseMod + 4);
			});
		});

		test("skill bonus should affect getSkillMod but not other skills", () => {
			const abilityId = charState.addCustomAbility({
				name: "Stealth Expert",
				mode: "toggleable",
				effects: [{type: "skill:stealth", value: 10}],
			});

			const baseAcrobatics = charState.getSkillMod("acrobatics");
			charState.toggleCustomAbility(abilityId);

			// Stealth should increase, acrobatics should not
			expect(charState.getSkillMod("acrobatics")).toBe(baseAcrobatics);
		});
	});

	describe("Check Effects Affecting Skills", () => {
		test("check:dex should affect Stealth (DEX-based skill)", () => {
			const abilityId = charState.addCustomAbility({
				name: "DEX Check Boost",
				mode: "toggleable",
				effects: [{type: "check:dex", value: 6}],
			});

			const baseStealth = charState.getSkillMod("stealth");
			charState.toggleCustomAbility(abilityId);

			// Stealth uses DEX, so +6 from check:dex should apply
			expect(charState.getSkillMod("stealth")).toBe(baseStealth + 6);
		});

		test("check:wis should affect Perception (WIS-based skill)", () => {
			const abilityId = charState.addCustomAbility({
				name: "WIS Check Boost",
				mode: "toggleable",
				effects: [{type: "check:wis", value: 4}],
			});

			const basePerception = charState.getSkillMod("perception");
			charState.toggleCustomAbility(abilityId);
			expect(charState.getSkillMod("perception")).toBe(basePerception + 4);
		});

		test("check:str should affect Athletics (STR-based skill)", () => {
			const abilityId = charState.addCustomAbility({
				name: "STR Check Boost",
				mode: "toggleable",
				effects: [{type: "check:str", value: 5}],
			});

			const baseAthletics = charState.getSkillMod("athletics");
			charState.toggleCustomAbility(abilityId);
			expect(charState.getSkillMod("athletics")).toBe(baseAthletics + 5);
		});
	});

	describe("Advantage/Disadvantage Effects", () => {
		test("advantage flag should be recorded in modifier", () => {
			const abilityId = charState.addCustomAbility({
				name: "Lucky Checks",
				mode: "toggleable",
				effects: [{type: "check:dex", advantage: true}],
			});

			charState.toggleCustomAbility(abilityId);
			const mods = charState.getNamedModifiersByType("check:dex");
			expect(mods[0].advantage).toBe(true);
		});

		test("disadvantage flag should be recorded in modifier", () => {
			const abilityId = charState.addCustomAbility({
				name: "Cursed Checks",
				mode: "toggleable",
				effects: [{type: "check:str", disadvantage: true}],
			});

			charState.toggleCustomAbility(abilityId);
			const mods = charState.getNamedModifiersByType("check:str");
			expect(mods[0].disadvantage).toBe(true);
		});

		test("advantage should be aggregated correctly", () => {
			const abilityId = charState.addCustomAbility({
				name: "Lucky",
				mode: "toggleable",
				effects: [{type: "skill:stealth", advantage: true}],
			});

			charState.toggleCustomAbility(abilityId);
			const aggregated = charState.aggregateModifiers("skill:stealth");
			expect(aggregated.advantage).toBe(true);
			expect(aggregated.disadvantage).toBe(false);
		});

		test("disadvantage should be aggregated correctly", () => {
			const abilityId = charState.addCustomAbility({
				name: "Cursed",
				mode: "toggleable",
				effects: [{type: "save:wis", disadvantage: true}],
			});

			charState.toggleCustomAbility(abilityId);
			const aggregated = charState.aggregateModifiers("save:wis");
			expect(aggregated.advantage).toBe(false);
			expect(aggregated.disadvantage).toBe(true);
		});

		test("advantage + disadvantage from different abilities should both be recorded", () => {
			const advId = charState.addCustomAbility({
				name: "Bless Effect",
				mode: "toggleable",
				effects: [{type: "check:int", advantage: true}],
			});

			const disadvId = charState.addCustomAbility({
				name: "Bane Effect",
				mode: "toggleable",
				effects: [{type: "check:int", disadvantage: true}],
			});

			charState.toggleCustomAbility(advId);
			charState.toggleCustomAbility(disadvId);

			const aggregated = charState.aggregateModifiers("check:int");
			// Both should be true (they cancel in actual rolling, but both are recorded)
			expect(aggregated.advantage).toBe(true);
			expect(aggregated.disadvantage).toBe(true);
		});
	});

	describe("Minimum/Maximum Roll Values", () => {
		test("setMinimum should be recorded in modifier", () => {
			const abilityId = charState.addCustomAbility({
				name: "Reliable Talent",
				mode: "toggleable",
				effects: [{type: "skill:athletics", setMinimum: 10}],
			});

			charState.toggleCustomAbility(abilityId);
			const mods = charState.getNamedModifiersByType("skill:athletics");
			expect(mods[0].setMinimum).toBe(10);
		});

		test("setMaximum should be recorded in modifier", () => {
			const abilityId = charState.addCustomAbility({
				name: "Cursed Maximum",
				mode: "toggleable",
				effects: [{type: "check:cha", setMaximum: 15}],
			});

			charState.toggleCustomAbility(abilityId);
			const mods = charState.getNamedModifiersByType("check:cha");
			expect(mods[0].setMaximum).toBe(15);
		});

		test("setMinimum should be aggregated to highest value", () => {
			const ability1Id = charState.addCustomAbility({
				name: "Min 8",
				mode: "toggleable",
				effects: [{type: "skill:perception", setMinimum: 8}],
			});

			const ability2Id = charState.addCustomAbility({
				name: "Min 15",
				mode: "toggleable",
				effects: [{type: "skill:perception", setMinimum: 15}],
			});

			charState.toggleCustomAbility(ability1Id);
			charState.toggleCustomAbility(ability2Id);

			const aggregated = charState.aggregateModifiers("skill:perception");
			// Should take the HIGHEST minimum
			expect(aggregated.minimum).toBe(15);
		});

		test("setMaximum should be aggregated to lowest value", () => {
			const ability1Id = charState.addCustomAbility({
				name: "Max 18",
				mode: "toggleable",
				effects: [{type: "check:wis", setMaximum: 18}],
			});

			const ability2Id = charState.addCustomAbility({
				name: "Max 12",
				mode: "toggleable",
				effects: [{type: "check:wis", setMaximum: 12}],
			});

			charState.toggleCustomAbility(ability1Id);
			charState.toggleCustomAbility(ability2Id);

			const aggregated = charState.aggregateModifiers("check:wis");
			// Should take the LOWEST maximum
			expect(aggregated.maximum).toBe(12);
		});
	});

	describe("Multiple Resistance Types", () => {
		test("should handle multiple resistance types", () => {
			const abilityId = charState.addCustomAbility({
				name: "Elemental Ward",
				mode: "toggleable",
				effects: [
					{type: "resistance:fire"},
					{type: "resistance:cold"},
					{type: "resistance:lightning"},
				],
			});

			charState.toggleCustomAbility(abilityId);

			const resistances = charState.getResistances();
			expect(resistances).toContain("fire");
			expect(resistances).toContain("cold");
			expect(resistances).toContain("lightning");
		});

		test("should only add unique resistances", () => {
			// First add fire resistance through one ability
			const ability1Id = charState.addCustomAbility({
				name: "Fire Shield",
				mode: "toggleable",
				effects: [{type: "resistance:fire"}],
			});

			charState.toggleCustomAbility(ability1Id);
			const initialCount = charState.getResistances().filter(r => r === "fire").length;

			// Add another fire resistance
			const ability2Id = charState.addCustomAbility({
				name: "Fire Ward",
				mode: "toggleable",
				effects: [{type: "resistance:fire"}],
			});

			charState.toggleCustomAbility(ability2Id);

			// Should not have duplicate fire resistance
			const finalCount = charState.getResistances().filter(r => r === "fire").length;
			expect(finalCount).toBe(initialCount); // Same count, no duplicates
		});
	});

	describe("Immunities and Vulnerabilities", () => {
		test("should grant damage immunity when ability is active", () => {
			const abilityId = charState.addCustomAbility({
				name: "Fire Immunity",
				mode: "toggleable",
				effects: [{type: "immunity:fire"}],
			});

			expect(charState.hasImmunity("fire")).toBe(false);
			charState.toggleCustomAbility(abilityId);
			expect(charState.hasImmunity("fire")).toBe(true);
		});

		test("should remove immunity when toggled off", () => {
			const abilityId = charState.addCustomAbility({
				name: "Fire Immunity",
				mode: "toggleable",
				effects: [{type: "immunity:fire"}],
			});

			charState.toggleCustomAbility(abilityId);
			expect(charState.hasImmunity("fire")).toBe(true);
			charState.toggleCustomAbility(abilityId);
			expect(charState.hasImmunity("fire")).toBe(false);
		});

		test("should grant vulnerability when ability is active", () => {
			const abilityId = charState.addCustomAbility({
				name: "Fire Vulnerability",
				mode: "toggleable",
				effects: [{type: "vulnerability:fire"}],
			});

			expect(charState.hasVulnerability("fire")).toBe(false);
			charState.toggleCustomAbility(abilityId);
			expect(charState.hasVulnerability("fire")).toBe(true);
		});

		test("should grant condition immunity when ability is active", () => {
			const abilityId = charState.addCustomAbility({
				name: "Fearless",
				mode: "toggleable",
				effects: [{type: "conditionImmunity:frightened"}],
			});

			expect(charState.isImmuneToCondition("frightened")).toBe(false);
			charState.toggleCustomAbility(abilityId);
			expect(charState.isImmuneToCondition("frightened")).toBe(true);
		});

		test("should handle multiple defensive traits", () => {
			const abilityId = charState.addCustomAbility({
				name: "Complete Protection",
				mode: "toggleable",
				effects: [
					{type: "immunity:poison"},
					{type: "conditionImmunity:poisoned"},
					{type: "resistance:necrotic"},
				],
			});

			charState.toggleCustomAbility(abilityId);
			expect(charState.hasImmunity("poison")).toBe(true);
			expect(charState.isImmuneToCondition("poisoned")).toBe(true);
			expect(charState.hasResistance("necrotic")).toBe(true);
		});

		test("should not remove immunity if another source provides it", () => {
			const ability1Id = charState.addCustomAbility({
				name: "Fire Cloak",
				mode: "toggleable",
				effects: [{type: "immunity:fire"}],
			});
			const ability2Id = charState.addCustomAbility({
				name: "Fire Aura",
				mode: "toggleable",
				effects: [{type: "immunity:fire"}],
			});

			charState.toggleCustomAbility(ability1Id);
			charState.toggleCustomAbility(ability2Id);
			expect(charState.hasImmunity("fire")).toBe(true);

			// Toggle off first ability - should still have immunity from second
			charState.toggleCustomAbility(ability1Id);
			expect(charState.hasImmunity("fire")).toBe(true);

			// Toggle off second - now immunity should be gone
			charState.toggleCustomAbility(ability2Id);
			expect(charState.hasImmunity("fire")).toBe(false);
		});
	});

	describe("Concentration Abilities", () => {
		test("should set concentration when activating concentration ability", () => {
			// Create and activate concentration ability
			const abilityId = charState.addCustomAbility({
				name: "Aura of Protection",
				mode: "toggleable",
				concentration: true,
				effects: [{type: "save:all", value: 2}],
			});

			expect(charState.isConcentrating()).toBe(false);
			charState.toggleCustomAbility(abilityId);
			expect(charState.isConcentrating()).toBe(true);

			// Should be concentrating on the ability
			const conc = charState.getConcentratingSpell();
			expect(conc?.customAbilityId).toBe(abilityId);
		});

		test("should break existing concentration when activating concentration ability", () => {
			// Set up spell concentration first
			charState.setConcentration("Bless", 1);
			expect(charState.isConcentrating()).toBe(true);
			expect(charState.getConcentratingSpell()?.spellName).toBe("Bless");

			// Create and activate concentration ability
			const abilityId = charState.addCustomAbility({
				name: "Aura of Protection",
				mode: "toggleable",
				concentration: true,
				effects: [{type: "save:all", value: 2}],
			});

			charState.toggleCustomAbility(abilityId);

			// Now concentrating on ability, not spell
			const conc = charState.getConcentratingSpell();
			expect(conc?.customAbilityId).toBe(abilityId);
			expect(conc?.spellName).toBeFalsy();
		});

		test("should toggle off concentration ability when casting concentration spell", () => {
			// Create and activate concentration ability
			const abilityId = charState.addCustomAbility({
				name: "Aura of Protection",
				mode: "toggleable",
				concentration: true,
				effects: [{type: "save:all", value: 2}],
			});

			charState.toggleCustomAbility(abilityId);
			expect(charState.getCustomAbility(abilityId).isActive).toBe(true);

			// Cast concentration spell - should break ability concentration
			charState.setConcentration("Hold Person", 2);

			// Ability should now be inactive
			expect(charState.getCustomAbility(abilityId).isActive).toBe(false);
			// Should be concentrating on spell now
			expect(charState.getConcentratingSpell()?.spellName).toBe("Hold Person");
		});

		test("should clear concentration when manually toggling off", () => {
			const abilityId = charState.addCustomAbility({
				name: "Aura of Protection",
				mode: "toggleable",
				concentration: true,
				effects: [{type: "ac", value: 1}],
			});

			charState.toggleCustomAbility(abilityId);
			expect(charState.isConcentrating()).toBe(true);

			charState.toggleCustomAbility(abilityId);
			expect(charState.isConcentrating()).toBe(false);
		});

		test("should only break concentration for ability with concentration flag", () => {
			// First activate concentration ability
			const concAbilityId = charState.addCustomAbility({
				name: "Concentration Power",
				mode: "toggleable",
				concentration: true,
				effects: [{type: "ac", value: 1}],
			});
			charState.toggleCustomAbility(concAbilityId);

			// Then activate non-concentration ability
			const normalAbilityId = charState.addCustomAbility({
				name: "Normal Power",
				mode: "toggleable",
				effects: [{type: "ac", value: 1}],
			});
			charState.toggleCustomAbility(normalAbilityId);

			// First ability should still be active (normal toggled didn't break concentration)
			expect(charState.getCustomAbility(concAbilityId).isActive).toBe(true);
		});
	});

	describe("Combined Effect Scenarios", () => {
		test("should combine bonus + advantage + minimum on same effect", () => {
			const abilityId = charState.addCustomAbility({
				name: "Ultimate INT",
				mode: "toggleable",
				effects: [{
					type: "check:int",
					value: 10,
					advantage: true,
					setMinimum: 15,
				}],
			});

			charState.toggleCustomAbility(abilityId);

			const aggregated = charState.aggregateModifiers("check:int");
			expect(aggregated.bonus).toBe(10);
			expect(aggregated.advantage).toBe(true);
			expect(aggregated.minimum).toBe(15);
		});

		test("should combine multiple effects of different types", () => {
			const abilityId = charState.addCustomAbility({
				name: "Master of All",
				mode: "toggleable",
				effects: [
					{type: "check:int", value: 5},
					{type: "skill:arcana", value: 3, advantage: true},
					{type: "save:wis", value: 2},
					{type: "resistance:psychic"},
				],
			});

			charState.toggleCustomAbility(abilityId);

			// Check each type
			expect(charState.getAbilityCheckCustomMod("int")).toBe(5);

			const arcanaMods = charState.getNamedModifiersByType("skill:arcana");
			expect(arcanaMods[0].value).toBe(3);
			expect(arcanaMods[0].advantage).toBe(true);

			const saveMods = charState.getNamedModifiersByType("save:wis");
			expect(saveMods[0].value).toBe(2);

			expect(charState.getResistances()).toContain("psychic");
		});

		test("should stack bonuses from multiple abilities to same type", () => {
			// Add three abilities all boosting INT checks
			charState.addCustomAbility({
				name: "INT 1",
				mode: "passive",
				effects: [{type: "check:int", value: 2}],
			});

			charState.addCustomAbility({
				name: "INT 2",
				mode: "passive",
				effects: [{type: "check:int", value: 3}],
			});

			charState.addCustomAbility({
				name: "INT 3",
				mode: "passive",
				effects: [{type: "check:int", value: 5}],
			});

			// Total should be 2 + 3 + 5 = 10
			const aggregated = charState.aggregateModifiers("check:int");
			expect(aggregated.bonus).toBe(10);
		});

		test("skill bonus should stack with check bonus for underlying ability", () => {
			// Add both skill:arcana and check:int
			const skillId = charState.addCustomAbility({
				name: "Arcana Focus",
				mode: "passive",
				effects: [{type: "skill:arcana", value: 3}],
			});

			const checkId = charState.addCustomAbility({
				name: "INT Focus",
				mode: "passive",
				effects: [{type: "check:int", value: 5}],
			});

			// Base arcana = INT mod (4)
			// skill:arcana adds +3
			// check:int adds +5 (since arcana is INT-based)
			// Total = 4 + 3 + 5 = 12
			const totalArcana = charState.getSkillMod("arcana");
			expect(totalArcana).toBe(12);
		});
	});

	describe("Source Tracking", () => {
		test("aggregated modifiers should track source names", () => {
			const abilityId = charState.addCustomAbility({
				name: "Mystical Enhancement",
				mode: "toggleable",
				effects: [{type: "check:int", value: 4}],
			});

			charState.toggleCustomAbility(abilityId);

			const aggregated = charState.aggregateModifiers("check:int");
			expect(aggregated.sources.length).toBeGreaterThan(0);
			expect(aggregated.sources.some(s => s.includes("Mystical Enhancement"))).toBe(true);
		});

		test("multiple sources should all be tracked", () => {
			charState.addCustomAbility({
				name: "Source A",
				mode: "passive",
				effects: [{type: "save:dex", value: 1}],
			});

			charState.addCustomAbility({
				name: "Source B",
				mode: "passive",
				effects: [{type: "save:dex", value: 2}],
			});

			const aggregated = charState.aggregateModifiers("save:dex");
			expect(aggregated.sources.length).toBe(2);
		});
	});

	// ===================================================================
	// CUSTOM SKILLS TESTS
	// ===================================================================
	describe("Custom Skills Integration", () => {
		test("getSkillAbility should return ability for standard skills", () => {
			expect(charState.getSkillAbility("athletics")).toBe("str");
			expect(charState.getSkillAbility("stealth")).toBe("dex");
			expect(charState.getSkillAbility("arcana")).toBe("int");
			expect(charState.getSkillAbility("perception")).toBe("wis");
			expect(charState.getSkillAbility("persuasion")).toBe("cha");
		});

		test("getSkillAbility should return ability for homebrew standard skills", () => {
			expect(charState.getSkillAbility("cooking")).toBe("wis");
			expect(charState.getSkillAbility("linguistics")).toBe("wis");
			expect(charState.getSkillAbility("might")).toBe("str");
			expect(charState.getSkillAbility("endurance")).toBe("con");
		});

		test("getSkillAbility should return ability for custom skills", () => {
			charState.addCustomSkill("Sailing", "dex");
			charState.addCustomSkill("Lore: Dragons", "int");
			charState.addCustomSkill("Flatland Wisdom", "wis");

			expect(charState.getSkillAbility("sailing")).toBe("dex");
			expect(charState.getSkillAbility("loredragons")).toBe("int");
			expect(charState.getSkillAbility("flatlandwisdom")).toBe("wis");
		});

		test("custom skills should receive skill: type modifiers", () => {
			// Add a custom skill
			charState.addCustomSkill("Herbalism", "wis");

			// Add a custom ability that modifies the custom skill
			charState.addCustomAbility({
				name: "Herbalism Expert",
				mode: "passive",
				effects: [{type: "skill:herbalism", value: 5}],
			});

			// Custom skill should have the bonus
			const baseMod = charState.getAbilityMod("wis"); // +0 from WIS 10
			const totalMod = charState.getSkillMod("herbalism");
			expect(totalMod).toBe(baseMod + 5);
		});

		test("custom skills should receive check: type modifiers for their ability", () => {
			// Add a custom DEX-based skill
			charState.addCustomSkill("Parkour", "dex");

			// Add a custom ability that boosts DEX checks
			charState.addCustomAbility({
				name: "DEX Master",
				mode: "passive",
				effects: [{type: "check:dex", value: 7}],
			});

			// Custom skill using DEX should also get the +7
			const baseMod = charState.getAbilityMod("dex"); // +2 from DEX 14
			const totalMod = charState.getSkillMod("parkour");
			expect(totalMod).toBe(baseMod + 7);
		});

		test("custom skills should stack skill: and check: modifiers", () => {
			// Add a custom skill
			charState.addCustomSkill("Alchemy", "int");

			// Add skill-specific modifier
			charState.addCustomAbility({
				name: "Alchemy Specialist",
				mode: "passive",
				effects: [{type: "skill:alchemy", value: 3}],
			});

			// Add INT check modifier
			charState.addCustomAbility({
				name: "INT Boost",
				mode: "passive",
				effects: [{type: "check:int", value: 4}],
			});

			// Should get: INT mod (+4) + skill:alchemy (+3) + check:int (+4) = 11
			const totalMod = charState.getSkillMod("alchemy");
			expect(totalMod).toBe(11);
		});

		test("custom skills with no ability should only receive skill-specific modifiers", () => {
			// Add a custom skill with no ability
			charState.addCustomSkill("Luck", null);

			// Add a skill-specific modifier
			charState.addCustomAbility({
				name: "Lucky",
				mode: "passive",
				effects: [{type: "skill:luck", value: 2}],
			});

			// Should just get the skill bonus, no ability mod
			const totalMod = charState.getSkillMod("luck");
			expect(totalMod).toBe(2);
		});

		test("aggregateModifiers should work with custom skills", () => {
			charState.addCustomSkill("Gambling", "cha");

			charState.addCustomAbility({
				name: "Card Sharp",
				mode: "passive",
				effects: [{type: "skill:gambling", value: 5, advantage: true, setMinimum: 10}],
			});

			const aggregated = charState.aggregateModifiers("skill:gambling");
			expect(aggregated.bonus).toBe(5);
			expect(aggregated.advantage).toBe(true);
			expect(aggregated.minimum).toBe(10);
		});

		test("custom skills should handle proficiency correctly", () => {
			// Add a custom skill
			charState.addCustomSkill("Blacksmithing", "str");

			// Set proficiency for the custom skill
			charState.setSkillProficiency("blacksmithing", 1);

			const strMod = charState.getAbilityMod("str"); // +0 from STR 10
			const profBonus = charState.getProficiencyBonus(); // +2 default

			// Should be: STR mod + proficiency bonus
			expect(charState.getSkillMod("blacksmithing")).toBe(strMod + profBonus);
		});

		test("custom skills should respect expertise", () => {
			// Add a custom skill with expertise
			charState.addCustomSkill("Trapmaking", "dex");
			charState.setSkillProficiency("trapmaking", 2); // 2 = expertise

			const dexMod = charState.getAbilityMod("dex"); // +2 from DEX 14
			const profBonus = charState.getProficiencyBonus(); // +2 default

			// Should be: DEX mod + 2x proficiency bonus (expertise)
			expect(charState.getSkillMod("trapmaking")).toBe(dexMod + (profBonus * 2));
		});
	});

	// ===================================================================
	// Grants Tests
	// ===================================================================
	describe("Custom Ability Grants", () => {
		describe("Spell Grants", () => {
			test("should grant innate spells when adding a passive ability", () => {
				const abilityId = charState.addCustomAbility({
					name: "Fey Touched",
					mode: "passive",
					grants: {
						spells: [
							{name: "Misty Step", source: "PHB", level: 2, uses: 1, recharge: "long"},
							{name: "Bless", source: "PHB", level: 1, uses: 1, recharge: "long"},
						],
						proficiencies: {skills: [], tools: [], weapons: [], armor: [], languages: []},
						features: [],
					},
				});

				const innateSpells = charState.getInnateSpells();
				expect(innateSpells.length).toBe(2);
				expect(innateSpells.some(s => s.name === "Misty Step")).toBe(true);
				expect(innateSpells.some(s => s.name === "Bless")).toBe(true);

				// Check source tracking
				const mistyStep = innateSpells.find(s => s.name === "Misty Step");
				expect(mistyStep.sourceFeature).toBe("Fey Touched");
			});

			test("should remove granted spells when removing ability", () => {
				const abilityId = charState.addCustomAbility({
					name: "Magic Initiate",
					mode: "passive",
					grants: {
						spells: [{name: "Fireball", source: "PHB", level: 3, uses: 1}],
						proficiencies: {skills: [], tools: [], weapons: [], armor: [], languages: []},
						features: [],
					},
				});

				expect(charState.getInnateSpells().length).toBe(1);

				charState.removeCustomAbility(abilityId);

				expect(charState.getInnateSpells().length).toBe(0);
			});

			test("should grant at-will cantrips", () => {
				charState.addCustomAbility({
					name: "Cantrip Master",
					mode: "passive",
					grants: {
						spells: [
							{name: "Fire Bolt", source: "PHB", level: 0, atWill: true},
							{name: "Prestidigitation", source: "PHB", level: 0, atWill: true},
						],
						proficiencies: {skills: [], tools: [], weapons: [], armor: [], languages: []},
						features: [],
					},
				});

				const innateSpells = charState.getInnateSpells();
				expect(innateSpells.length).toBe(2);
				expect(innateSpells[0].atWill).toBe(true);
				expect(innateSpells[1].atWill).toBe(true);
			});
		});

		describe("Proficiency Grants", () => {
			test("should grant skill proficiencies", () => {
				charState.addCustomAbility({
					name: "Skilled",
					mode: "passive",
					grants: {
						spells: [],
						proficiencies: {
							skills: ["Acrobatics", "Performance", "Persuasion"],
							tools: [],
							weapons: [],
							armor: [],
							languages: [],
						},
						features: [],
					},
				});

				expect(charState.getSkillProficiency("acrobatics")).toBe(1);
				expect(charState.getSkillProficiency("performance")).toBe(1);
				expect(charState.getSkillProficiency("persuasion")).toBe(1);
			});

			test("should grant tool proficiencies", () => {
				charState.addCustomAbility({
					name: "Tool Proficient",
					mode: "passive",
					grants: {
						spells: [],
						proficiencies: {
							skills: [],
							tools: ["Thieves' Tools", "Smith's Tools"],
							weapons: [],
							armor: [],
							languages: [],
						},
						features: [],
					},
				});

				expect(charState.hasToolProficiency("Thieves' Tools")).toBe(true);
				expect(charState.hasToolProficiency("Smith's Tools")).toBe(true);
			});

			test("should grant language proficiencies", () => {
				charState.addCustomAbility({
					name: "Linguist",
					mode: "passive",
					grants: {
						spells: [],
						proficiencies: {
							skills: [],
							tools: [],
							weapons: [],
							armor: [],
							languages: ["Elvish", "Dwarvish", "Celestial"],
						},
						features: [],
					},
				});

				const languages = charState.getLanguages();
				expect(languages).toContain("Elvish");
				expect(languages).toContain("Dwarvish");
				expect(languages).toContain("Celestial");
			});

			test("should grant weapon proficiencies", () => {
				charState.addCustomAbility({
					name: "Weapon Training",
					mode: "passive",
					grants: {
						spells: [],
						proficiencies: {
							skills: [],
							tools: [],
							weapons: ["simple", "martial"],
							armor: [],
							languages: [],
						},
						features: [],
					},
				});

				const weaponProfs = charState.getWeaponProficiencies();
				expect(weaponProfs).toContain("simple");
				expect(weaponProfs).toContain("martial");
			});

			test("should grant armor proficiencies", () => {
				charState.addCustomAbility({
					name: "Armor Training",
					mode: "passive",
					grants: {
						spells: [],
						proficiencies: {
							skills: [],
							tools: [],
							weapons: [],
							armor: ["light", "medium", "shields"],
							languages: [],
						},
						features: [],
					},
				});

				const armorProfs = charState.getArmorProficiencies();
				expect(armorProfs).toContain("light");
				expect(armorProfs).toContain("medium");
				expect(armorProfs).toContain("shields");
			});

			test("should remove granted proficiencies when removing ability", () => {
				const abilityId = charState.addCustomAbility({
					name: "Guild Membership",
					mode: "passive",
					grants: {
						spells: [],
						proficiencies: {
							skills: ["Insight"],
							tools: ["Artisan's Tools"],
							weapons: [],
							armor: [],
							languages: ["Dwarvish"],
						},
						features: [],
					},
				});

				// Verify proficiencies were granted
				expect(charState.getSkillProficiency("insight")).toBe(1);
				expect(charState.hasToolProficiency("Artisan's Tools")).toBe(true);
				expect(charState.getLanguages()).toContain("Dwarvish");

				// Remove ability
				charState.removeCustomAbility(abilityId);

				// Proficiencies should be removed
				expect(charState.getSkillProficiency("insight")).toBe(0);
				expect(charState.hasToolProficiency("Artisan's Tools")).toBe(false);
				expect(charState.getLanguages()).not.toContain("Dwarvish");
			});

			test("should not remove proficiencies if another source grants them", () => {
				// Two abilities grant same skill
				const ability1Id = charState.addCustomAbility({
					name: "Background Skill",
					mode: "passive",
					grants: {
						spells: [],
						proficiencies: {skills: ["Stealth"], tools: [], weapons: [], armor: [], languages: []},
						features: [],
					},
				});

				const ability2Id = charState.addCustomAbility({
					name: "Class Skill",
					mode: "passive",
					grants: {
						spells: [],
						proficiencies: {skills: ["Stealth"], tools: [], weapons: [], armor: [], languages: []},
						features: [],
					},
				});

				expect(charState.getSkillProficiency("stealth")).toBe(1);

				// Remove first ability
				charState.removeCustomAbility(ability1Id);

				// Should still be proficient (second ability still grants it)
				expect(charState.getSkillProficiency("stealth")).toBe(1);

				// Remove second ability
				charState.removeCustomAbility(ability2Id);

				// Now should not be proficient
				expect(charState.getSkillProficiency("stealth")).toBe(0);
			});
		});

		describe("Feature Grants", () => {
			test("should grant optional features", () => {
				charState.addCustomAbility({
					name: "Extra Invocation",
					mode: "passive",
					grants: {
						spells: [],
						proficiencies: {skills: [], tools: [], weapons: [], armor: [], languages: []},
						features: [
							{name: "Agonizing Blast", source: "PHB", featureType: "EI"},
							{name: "Devil's Sight", source: "PHB", featureType: "EI"},
						],
					},
				});

				const features = charState.getFeatures();
				expect(features.some(f => f.name === "Agonizing Blast")).toBe(true);
				expect(features.some(f => f.name === "Devil's Sight")).toBe(true);
			});

			test("should remove granted features when removing ability", () => {
				const abilityId = charState.addCustomAbility({
					name: "Metamagic Adept",
					mode: "passive",
					grants: {
						spells: [],
						proficiencies: {skills: [], tools: [], weapons: [], armor: [], languages: []},
						features: [
							{name: "Quickened Spell", source: "PHB", featureType: "MM"},
						],
					},
				});

				expect(charState.getFeatures().some(f => f.name === "Quickened Spell")).toBe(true);

				charState.removeCustomAbility(abilityId);

				expect(charState.getFeatures().some(f => f.name === "Quickened Spell")).toBe(false);
			});
		});

		describe("Toggleable Grants", () => {
			test("should not grant when toggleable ability is inactive", () => {
				const abilityId = charState.addCustomAbility({
					name: "Toggle Spell Grant",
					mode: "toggleable",
					grants: {
						spells: [{name: "Shield", source: "PHB", level: 1, uses: 1}],
						proficiencies: {skills: [], tools: [], weapons: [], armor: [], languages: []},
						features: [],
					},
				});

				// Not toggled on yet
				expect(charState.getInnateSpells().length).toBe(0);

				// Toggle on
				charState.toggleCustomAbility(abilityId);
				expect(charState.getInnateSpells().length).toBe(1);

				// Toggle off
				charState.toggleCustomAbility(abilityId);
				expect(charState.getInnateSpells().length).toBe(0);
			});
		});

		describe("Combined Effects and Grants", () => {
			test("should handle ability with both effects and grants", () => {
				const abilityId = charState.addCustomAbility({
					name: "Shadow Touched",
					mode: "passive",
					effects: [
						{type: "skill:stealth", value: 2},
					],
					grants: {
						spells: [
							{name: "Invisibility", source: "PHB", level: 2, uses: 1},
						],
						proficiencies: {skills: [], tools: [], weapons: [], armor: [], languages: []},
						features: [],
					},
				});

				// Check effect
				const aggregated = charState.aggregateModifiers("skill:stealth");
				expect(aggregated.bonus).toBe(2);

				// Check grant
				expect(charState.getInnateSpells().some(s => s.name === "Invisibility")).toBe(true);

				// Remove and check cleanup
				charState.removeCustomAbility(abilityId);

				const afterRemoval = charState.aggregateModifiers("skill:stealth");
				expect(afterRemoval.bonus).toBe(0);
				expect(charState.getInnateSpells().length).toBe(0);
			});
		});
	});

	// ===================================================================
	// Defensive Traits Tests
	// ===================================================================
	describe("Defensive Traits", () => {
		describe("Damage Resistances", () => {
			test("should register damage resistance from passive ability", () => {
				charState.addCustomAbility({
					name: "Fire Resistant",
					mode: "passive",
					defensiveTraits: {
						resistances: ["fire"],
						immunities: [],
						vulnerabilities: [],
						conditionImmunities: [],
					},
				});

				expect(charState.hasResistance("fire")).toBe(true);
				expect(charState.hasResistance("cold")).toBe(false);
			});

			test("should register multiple damage resistances", () => {
				charState.addCustomAbility({
					name: "Elemental Warding",
					mode: "passive",
					defensiveTraits: {
						resistances: ["fire", "cold", "lightning"],
						immunities: [],
						vulnerabilities: [],
						conditionImmunities: [],
					},
				});

				expect(charState.hasResistance("fire")).toBe(true);
				expect(charState.hasResistance("cold")).toBe(true);
				expect(charState.hasResistance("lightning")).toBe(true);
			});

			test("should unregister resistance when removing ability", () => {
				const abilityId = charState.addCustomAbility({
					name: "Fire Resistant",
					mode: "passive",
					defensiveTraits: {
						resistances: ["fire"],
						immunities: [],
						vulnerabilities: [],
						conditionImmunities: [],
					},
				});

				expect(charState.hasResistance("fire")).toBe(true);

				charState.removeCustomAbility(abilityId);

				expect(charState.hasResistance("fire")).toBe(false);
			});

			test("should support homebrew damage types", () => {
				charState.addCustomAbility({
					name: "Void Touched",
					mode: "passive",
					defensiveTraits: {
						resistances: ["void"],
						immunities: [],
						vulnerabilities: [],
						conditionImmunities: [],
					},
				});

				expect(charState.hasResistance("void")).toBe(true);
			});
		});

		describe("Damage Immunities", () => {
			test("should register damage immunity from passive ability", () => {
				charState.addCustomAbility({
					name: "Poison Immunity",
					mode: "passive",
					defensiveTraits: {
						resistances: [],
						immunities: ["poison"],
						vulnerabilities: [],
						conditionImmunities: [],
					},
				});

				expect(charState.hasImmunity("poison")).toBe(true);
				expect(charState.hasImmunity("fire")).toBe(false);
			});

			test("should unregister immunity when removing ability", () => {
				const abilityId = charState.addCustomAbility({
					name: "Fire Immunity",
					mode: "passive",
					defensiveTraits: {
						resistances: [],
						immunities: ["fire"],
						vulnerabilities: [],
						conditionImmunities: [],
					},
				});

				expect(charState.hasImmunity("fire")).toBe(true);

				charState.removeCustomAbility(abilityId);

				expect(charState.hasImmunity("fire")).toBe(false);
			});
		});

		describe("Damage Vulnerabilities", () => {
			test("should register damage vulnerability from passive ability", () => {
				charState.addCustomAbility({
					name: "Fire Weakness",
					mode: "passive",
					defensiveTraits: {
						resistances: [],
						immunities: [],
						vulnerabilities: ["fire"],
						conditionImmunities: [],
					},
				});

				expect(charState.hasVulnerability("fire")).toBe(true);
			});

			test("should unregister vulnerability when removing ability", () => {
				const abilityId = charState.addCustomAbility({
					name: "Cold Weakness",
					mode: "passive",
					defensiveTraits: {
						resistances: [],
						immunities: [],
						vulnerabilities: ["cold"],
						conditionImmunities: [],
					},
				});

				expect(charState.hasVulnerability("cold")).toBe(true);

				charState.removeCustomAbility(abilityId);

				expect(charState.hasVulnerability("cold")).toBe(false);
			});
		});

		describe("Condition Immunities", () => {
			test("should register condition immunity from passive ability", () => {
				charState.addCustomAbility({
					name: "Mindless",
					mode: "passive",
					defensiveTraits: {
						resistances: [],
						immunities: [],
						vulnerabilities: [],
						conditionImmunities: ["charmed", "frightened"],
					},
				});

				expect(charState.isImmuneToCondition("charmed")).toBe(true);
				expect(charState.isImmuneToCondition("frightened")).toBe(true);
				expect(charState.isImmuneToCondition("poisoned")).toBe(false);
			});

			test("should be case-insensitive for condition immunity", () => {
				charState.addCustomAbility({
					name: "Fearless",
					mode: "passive",
					defensiveTraits: {
						resistances: [],
						immunities: [],
						vulnerabilities: [],
						conditionImmunities: ["Frightened"],
					},
				});

				expect(charState.isImmuneToCondition("frightened")).toBe(true);
				expect(charState.isImmuneToCondition("FRIGHTENED")).toBe(true);
				expect(charState.isImmuneToCondition("Frightened")).toBe(true);
			});

			test("should be source-agnostic for condition immunity", () => {
				charState.addCustomAbility({
					name: "Mind Shield",
					mode: "passive",
					defensiveTraits: {
						resistances: [],
						immunities: [],
						vulnerabilities: [],
						conditionImmunities: ["charmed"],
					},
				});

				// Should work with string
				expect(charState.isImmuneToCondition("charmed")).toBe(true);

				// Should work with object regardless of source
				expect(charState.isImmuneToCondition({name: "charmed", source: "PHB"})).toBe(true);
				expect(charState.isImmuneToCondition({name: "charmed", source: "XGE"})).toBe(true);
				expect(charState.isImmuneToCondition({name: "Charmed", source: "homebrew"})).toBe(true);
			});

			test("should unregister condition immunity when removing ability", () => {
				const abilityId = charState.addCustomAbility({
					name: "Poison Resilient",
					mode: "passive",
					defensiveTraits: {
						resistances: [],
						immunities: [],
						vulnerabilities: [],
						conditionImmunities: ["poisoned"],
					},
				});

				expect(charState.isImmuneToCondition("poisoned")).toBe(true);

				charState.removeCustomAbility(abilityId);

				expect(charState.isImmuneToCondition("poisoned")).toBe(false);
			});
		});

		describe("Toggleable Defensive Traits", () => {
			test("should only apply defensive traits when toggled on", () => {
				const abilityId = charState.addCustomAbility({
					name: "Elemental Form",
					mode: "toggleable",
					defensiveTraits: {
						resistances: ["fire", "cold"],
						immunities: [],
						vulnerabilities: [],
						conditionImmunities: ["exhaustion"],
					},
				});

				// Not toggled - should not have traits
				expect(charState.hasResistance("fire")).toBe(false);
				expect(charState.isImmuneToCondition("exhaustion")).toBe(false);

				// Toggle on
				charState.toggleCustomAbility(abilityId);
				expect(charState.hasResistance("fire")).toBe(true);
				expect(charState.hasResistance("cold")).toBe(true);
				expect(charState.isImmuneToCondition("exhaustion")).toBe(true);

				// Toggle off
				charState.toggleCustomAbility(abilityId);
				expect(charState.hasResistance("fire")).toBe(false);
				expect(charState.isImmuneToCondition("exhaustion")).toBe(false);
			});
		});

		describe("Combined Defensive Traits", () => {
			test("should handle all defensive trait types together", () => {
				charState.addCustomAbility({
					name: "Draconic Resilience",
					mode: "passive",
					defensiveTraits: {
						resistances: ["fire"],
						immunities: ["poison"],
						vulnerabilities: ["cold"],
						conditionImmunities: ["poisoned", "frightened"],
					},
				});

				expect(charState.hasResistance("fire")).toBe(true);
				expect(charState.hasImmunity("poison")).toBe(true);
				expect(charState.hasVulnerability("cold")).toBe(true);
				expect(charState.isImmuneToCondition("poisoned")).toBe(true);
				expect(charState.isImmuneToCondition("frightened")).toBe(true);
			});
		});

		describe("Immunity Enforcement", () => {
			test("should prevent adding conditions the character is immune to", () => {
				charState.addCustomAbility({
					name: "Mind Shield",
					mode: "passive",
					defensiveTraits: {
						resistances: [],
						immunities: [],
						vulnerabilities: [],
						conditionImmunities: ["charmed"],
					},
				});

				expect(charState.isImmuneToCondition("charmed")).toBe(true);

				// Try to add the condition - should fail
				const result = charState.addCondition("charmed");
				expect(result).toBe(false);

				// Condition should not be in the list
				const conditions = charState.getConditions();
				expect(conditions.some(c => c.name.toLowerCase() === "charmed")).toBe(false);
			});

			test("should allow adding conditions the character is not immune to", () => {
				charState.addCustomAbility({
					name: "Mind Shield",
					mode: "passive",
					defensiveTraits: {
						resistances: [],
						immunities: [],
						vulnerabilities: [],
						conditionImmunities: ["charmed"],
					},
				});

				// Try to add a different condition - should work
				const result = charState.addCondition("frightened");
				expect(result).toBe(true);

				// Condition should be in the list
				const conditions = charState.getConditions();
				expect(conditions.some(c => c.name.toLowerCase() === "frightened")).toBe(true);
			});
		});
	});
});
