/**
 * Character Sheet Integration Tests
 * End-to-end tests for full character flows and complex scenarios
 */

import "./setup.js";
import "../../../js/charactersheet/charactersheet-state.js";

const CharacterSheetState = globalThis.CharacterSheetState;

describe("Integration Tests", () => {
	// ==========================================================================
	// Full Character Creation Flows
	// ==========================================================================
	describe("Full Character Creation", () => {
		it("should create a complete level 1 Fighter", () => {
			const state = new CharacterSheetState();

			// Basic info
			state.setBasicInfo({
				name: "Thorin Ironforge",
				race: "Mountain Dwarf",
				background: "Soldier",
			});

			// Ability scores (standard array)
			state.setAbilityBase("str", 15);
			state.setAbilityBase("dex", 12);
			state.setAbilityBase("con", 14);
			state.setAbilityBase("int", 10);
			state.setAbilityBase("wis", 13);
			state.setAbilityBase("cha", 8);

			// Racial bonuses (Mountain Dwarf: +2 STR, +2 CON)
			state.setAbilityBonus("str", 2);
			state.setAbilityBonus("con", 2);

			// Class
			state.addClass({name: "Fighter", source: "PHB", level: 1});

			// Proficiencies
			state.setSkillProficiency("athletics", 1);
			state.setSkillProficiency("intimidation", 1);
			state.setSavingThrowProficiency("str", true);
			state.setSavingThrowProficiency("con", true);
			state.addArmorProficiency("heavy");
			state.addWeaponProficiency("martial");

			// Equipment
			state.addItem({name: "Chain Mail", type: "armor", ac: 16, equipped: true});
			state.addItem({name: "Longsword", type: "weapon", damage: "1d8", damageType: "slashing"});
			state.addItem({name: "Shield", type: "armor", ac: 2, acBonus: 0, equipped: true});

			// Calculate derived values
			state.setMaxHp(12 + state.getAbilityModifier("con")); // d10 + CON

			// Verify character
			expect(state.getBasicInfo().name).toBe("Thorin Ironforge");
			expect(state.getAbilityScore("str")).toBe(17);
			expect(state.getAbilityScore("con")).toBe(16);
			expect(state.getAC()).toBe(18); // Chain mail (16) + Shield (2)
			expect(state.getMaxHp()).toBe(15); // 10 + 3 (CON) + 2 (from max roll)
			expect(state.getProficiencyBonus()).toBe(2);
		});

		it("should create a complete level 1 Wizard", () => {
			const state = new CharacterSheetState();

			state.setBasicInfo({
				name: "Elara Starweaver",
				race: "High Elf",
				background: "Sage",
			});

			// Ability scores
			state.setAbilityBase("str", 8);
			state.setAbilityBase("dex", 14);
			state.setAbilityBase("con", 13);
			state.setAbilityBase("int", 15);
			state.setAbilityBase("wis", 12);
			state.setAbilityBase("cha", 10);

			// High Elf bonuses: +2 DEX, +1 INT
			state.setAbilityBonus("dex", 2);
			state.setAbilityBonus("int", 1);

			state.addClass({name: "Wizard", source: "PHB", level: 1});

			// Spellcasting
			state.setSpellSlots([{level: 1, current: 2, max: 2}]);
			state.addKnownSpell({name: "Magic Missile", level: 1, school: "evocation"});
			state.addKnownSpell({name: "Shield", level: 1, school: "abjuration"});
			state.addKnownSpell({name: "Mage Armor", level: 1, school: "abjuration"});
			state.addCantrip({name: "Fire Bolt", school: "evocation"});
			state.addCantrip({name: "Prestidigitation", school: "transmutation"});
			state.addCantrip({name: "Mage Hand", school: "conjuration"});
			// High Elf bonus cantrip
			state.addCantrip({name: "Light", school: "evocation", source: "racial"});

			// HP
			state.setMaxHp(6 + state.getAbilityModifier("con"));

			// Verify
			expect(state.getAbilityScore("int")).toBe(16);
			expect(state.getSpellSaveDC("Wizard")).toBe(13); // 8 + 2 (prof) + 3 (INT)
			expect(state.getSpellAttackBonus("Wizard")).toBe(5); // 2 (prof) + 3 (INT)
			expect(state.getKnownSpells().length).toBe(3);
			expect(state.getCantrips().length).toBe(4);
		});
	});

	// ==========================================================================
	// Level Progression Flow
	// ==========================================================================
	describe("Level Progression Flow", () => {
		it("should progress a Fighter from level 1 to 5", () => {
			const state = new CharacterSheetState();
			state.setAbilityBase("str", 16);
			state.setAbilityBase("con", 14);
			state.addClass({name: "Fighter", source: "PHB", level: 1});
			state.setMaxHp(12);

			// Level 2: Action Surge
			state.levelUp("Fighter");
			state.addFeature({
				id: "actionSurge",
				name: "Action Surge",
				uses: {current: 1, max: 1},
				recharge: "short",
			});
			expect(state.getTotalLevel()).toBe(2);

			// Level 3: Subclass (Champion)
			state.levelUp("Fighter");
			state.setSubclass("Fighter", {name: "Champion", source: "PHB"});
			state.addFeature({
				id: "improvedCritical",
				name: "Improved Critical",
				description: "Crit on 19-20",
			});
			expect(state.getClasses()[0].subclass.name).toBe("Champion");

			// Level 4: ASI
			state.levelUp("Fighter");
			expect(state.isASILevel("Fighter", 4)).toBe(true);
			state.applyASI("str", 2);
			expect(state.getAbilityScore("str")).toBe(18);

			// Level 5: Extra Attack
			state.levelUp("Fighter");
			expect(state.getTotalLevel()).toBe(5);
			expect(state.getProficiencyBonus()).toBe(3);
			expect(state.getNumberOfAttacks()).toBe(2);
		});

		it("should progress a Wizard from level 1 to 5", () => {
			const state = new CharacterSheetState();
			state.setAbilityBase("int", 16);
			state.addClass({name: "Wizard", source: "PHB", level: 1});
			state.setSpellSlots([{level: 1, current: 2, max: 2}]);

			// Level up to 5
			for (let i = 2; i <= 5; i++) {
				state.levelUp("Wizard");
			}

			// Verify spell slot progression
			const slots = state.getSpellSlots();
			expect(slots[1].max).toBe(4); // 4 1st level slots
			expect(slots[2].max).toBe(3); // 3 2nd level slots
			expect(slots[3].max).toBe(2); // 2 3rd level slots

			// Verify spell save DC increased
			expect(state.getSpellSaveDC("Wizard")).toBe(14); // 8 + 3 (prof) + 3 (INT)
		});
	});

	// ==========================================================================
	// Multiclass Scenarios
	// ==========================================================================
	describe("Multiclass Scenarios", () => {
		it("should handle Fighter 5 / Rogue 3 multiclass", () => {
			const state = new CharacterSheetState();
			state.setAbilityBase("str", 16);
			state.setAbilityBase("dex", 14);
			state.setAbilityBase("con", 14);

			// Start as Fighter
			state.addClass({name: "Fighter", source: "PHB", level: 5});

			// Multiclass into Rogue
			expect(state.meetsMulticlassRequirement("Rogue")).toBe(true);
			state.addClass({name: "Rogue", source: "PHB", level: 3});

			// Verify totals
			expect(state.getTotalLevel()).toBe(8);
			expect(state.getProficiencyBonus()).toBe(3);

			// Verify class features from both
			expect(state.getNumberOfAttacks()).toBe(2); // Fighter 5

			// Verify hit dice
			const hitDice = state.getHitDice();
			expect(hitDice.find(h => h.type === "d10")?.max).toBe(5); // Fighter
			expect(hitDice.find(h => h.type === "d8")?.max).toBe(3); // Rogue
		});

		it("should handle Paladin 6 / Warlock 2 multiclass", () => {
			const state = new CharacterSheetState();
			state.setAbilityBase("str", 16);
			state.setAbilityBase("cha", 14);

			state.addClass({name: "Paladin", source: "PHB", level: 6});
			state.addClass({name: "Warlock", source: "PHB", level: 2});

			// Paladin is half-caster, Warlock has pact magic
			// Multiclass caster level = 3 (Paladin 6/2) + 0 (Warlock doesn't count)
			const casterLevel = state.getMulticlassCasterLevel();
			expect(casterLevel).toBe(3);

			// Pact slots are separate
			state.setPactSlots({current: 2, max: 2, level: 1});
			expect(state.getPactSlots().max).toBe(2);
		});

		it("should handle triple class: Fighter 6 / Wizard 4 / Cleric 2", () => {
			const state = new CharacterSheetState();
			state.setAbilityBase("str", 14);
			state.setAbilityBase("int", 13);
			state.setAbilityBase("wis", 13);

			state.addClass({name: "Fighter", source: "PHB", level: 6});
			state.addClass({name: "Wizard", source: "PHB", level: 4});
			state.addClass({name: "Cleric", source: "PHB", level: 2});

			expect(state.getTotalLevel()).toBe(12);
			expect(state.getProficiencyBonus()).toBe(4);

			// Multiclass caster level: 4 (Wizard) + 2 (Cleric) = 6
			expect(state.getMulticlassCasterLevel()).toBe(6);
		});
	});

	// ==========================================================================
	// Combat Simulation
	// ==========================================================================
	describe("Combat Simulation", () => {
		let state;

		beforeEach(() => {
			state = new CharacterSheetState();
			state.setAbilityBase("str", 18);
			state.setAbilityBase("dex", 14);
			state.setAbilityBase("con", 16);
			state.addClass({name: "Fighter", source: "PHB", level: 5});
			state.setMaxHp(44);
			state.setCurrentHp(44);
			state.setHitDice([{type: "d10", current: 5, max: 5}]);
		});

		it("should track damage through a combat encounter", () => {
			// Round 1: Take 15 damage
			state.takeDamage(15);
			expect(state.getCurrentHp()).toBe(29);

			// Round 2: Take 10 more damage
			state.takeDamage(10);
			expect(state.getCurrentHp()).toBe(19);

			// Round 3: Use Second Wind
			state.addFeature({
				id: "secondWind",
				name: "Second Wind",
				uses: {current: 1, max: 1},
				recharge: "short",
			});
			// Second Wind restores 1d10 + Fighter level
			state.heal(8 + 5); // Assume average roll + level
			expect(state.getCurrentHp()).toBe(32);
		});

		it("should handle going to 0 HP and death saves", () => {
			state.setCurrentHp(5);
			state.takeDamage(10);
			expect(state.getCurrentHp()).toBe(0);
			expect(state.isUnconscious()).toBe(true);

			// Make death saves
			state.makeDeathSave(true); // Success
			state.makeDeathSave(true); // Success
			state.makeDeathSave(false); // Failure
			state.makeDeathSave(true); // Success - stabilized!

			expect(state.isStabilized()).toBe(true);
			expect(state.getDeathSaves().successes).toBe(3);
		});

		it("should handle healing from 0 HP", () => {
			state.setCurrentHp(0);
			state.setDeathSaves({successes: 2, failures: 1});

			state.heal(10);
			expect(state.getCurrentHp()).toBe(10);
			expect(state.isUnconscious()).toBe(false);
			// Death saves should reset
			expect(state.getDeathSaves().successes).toBe(0);
			expect(state.getDeathSaves().failures).toBe(0);
		});

		it("should track temporary HP correctly in combat", () => {
			state.setTempHp(10);
			expect(state.getCurrentHp()).toBe(44);
			expect(state.getTempHp()).toBe(10);

			// Take 15 damage - should consume temp HP first
			state.takeDamage(15);
			expect(state.getTempHp()).toBe(0);
			expect(state.getCurrentHp()).toBe(39);
		});

		it("should handle concentration checks", () => {
			state.setConcentrating({name: "Haste", source: "PHB"});
			expect(state.isConcentrating()).toBe(true);

			// Take damage that requires concentration save
			const damageAmount = 22;
			const dcRequired = Math.max(10, Math.floor(damageAmount / 2));
			expect(dcRequired).toBe(11);

			// Simulate failed concentration save
			state.loseConcentration();
			expect(state.isConcentrating()).toBe(false);
		});
	});

	// ==========================================================================
	// Rest Cycle
	// ==========================================================================
	describe("Rest Cycle", () => {
		let state;

		beforeEach(() => {
			state = new CharacterSheetState();
			state.setAbilityBase("con", 14);
			state.addClass({name: "Fighter", source: "PHB", level: 5});
			state.setMaxHp(44);
			state.setCurrentHp(20);
			state.setHitDice([{type: "d10", current: 2, max: 5}]);
			state.addFeature({
				id: "secondWind",
				name: "Second Wind",
				uses: {current: 0, max: 1},
				recharge: "short",
			});
			state.addFeature({
				id: "actionSurge",
				name: "Action Surge",
				uses: {current: 0, max: 1},
				recharge: "short",
			});
		});

		it("should recover resources on short rest", () => {
			// Spend hit die
			const initialHp = state.getCurrentHp();
			state.spendHitDie("d10");
			expect(state.getCurrentHp()).toBeGreaterThan(initialHp);
			expect(state.getHitDice()[0].current).toBe(1);

			// Short rest restores features but not HP or hit dice
			state.onShortRest();
			expect(state.getFeature("Second Wind").uses.current).toBe(1);
			expect(state.getFeature("Action Surge").uses.current).toBe(1);
		});

		it("should fully recover on long rest", () => {
			state.onLongRest();

			expect(state.getCurrentHp()).toBe(state.getMaxHp());
			// Recover half hit dice rounded up (3 of 5)
			// Started with 2, so 2 + 3 = 5 (capped at max)
			expect(state.getHitDice()[0].current).toBe(5);
			expect(state.getFeature("Second Wind").uses.current).toBe(1);
			expect(state.getFeature("Action Surge").uses.current).toBe(1);
		});
	});

	// ==========================================================================
	// Save/Load Character
	// ==========================================================================
	describe("Save/Load Character", () => {
		it("should serialize and deserialize a complete character", () => {
			const original = new CharacterSheetState();
			original.setBasicInfo({
				name: "Test Character",
				race: "Human",
				background: "Folk Hero",
			});
			original.setAbilityBase("str", 16);
			original.setAbilityBase("dex", 14);
			original.setAbilityBase("con", 14);
			original.setAbilityBase("int", 10);
			original.setAbilityBase("wis", 12);
			original.setAbilityBase("cha", 8);
			original.addClass({name: "Fighter", source: "PHB", level: 5});
			original.setMaxHp(44);
			original.setCurrentHp(30);
			original.addItem({name: "Longsword", type: "weapon", damage: "1d8"});
			original.addFeature({
				id: "secondWind",
				name: "Second Wind",
				uses: {current: 0, max: 1},
			});

			// Serialize
			const json = original.serialize();
			expect(typeof json).toBe("string");

			// Deserialize
			const loaded = CharacterSheetState.deserialize(json);

			// Verify all data preserved
			expect(loaded.getBasicInfo().name).toBe("Test Character");
			expect(loaded.getAbilityScore("str")).toBe(16);
			expect(loaded.getClasses()[0].name).toBe("Fighter");
			expect(loaded.getClasses()[0].level).toBe(5);
			expect(loaded.getMaxHp()).toBe(44);
			expect(loaded.getCurrentHp()).toBe(30);
			expect(loaded.getInventory()).toHaveLength(1);
			expect(loaded.getFeature("Second Wind")).toBeDefined();
		});

		it("should handle missing/corrupted data gracefully", () => {
			const partialJson = JSON.stringify({
				basicInfo: {name: "Partial Character"},
				abilities: {str: 10},
				// Missing most fields
			});

			const loaded = CharacterSheetState.deserialize(partialJson);
			expect(loaded.getBasicInfo().name).toBe("Partial Character");
			// Should have defaults for missing values
			expect(loaded.getAbilityScore("str")).toBe(10);
			expect(loaded.getAbilityScore("dex")).toBe(10); // Default
			expect(loaded.getClasses()).toEqual([]);
			expect(loaded.getMaxHp()).toBe(1);
		});

		it("should version data for future migrations", () => {
			const state = new CharacterSheetState();
			const json = state.serialize();
			const parsed = JSON.parse(json);
			expect(parsed.version).toBeDefined();
		});
	});

	// ==========================================================================
	// Edge Cases
	// ==========================================================================
	describe("Edge Cases", () => {
		let state;

		beforeEach(() => {
			state = new CharacterSheetState();
		});

		it("should handle ability scores at extremes", () => {
			state.setAbilityBase("str", 1);
			expect(state.getAbilityModifier("str")).toBe(-5);

			state.setAbilityBase("str", 30);
			expect(state.getAbilityModifier("str")).toBe(10);
		});

		it("should handle level 20 characters", () => {
			state.addClass({name: "Fighter", source: "PHB", level: 20});
			expect(state.getProficiencyBonus()).toBe(6);
			expect(state.getNumberOfAttacks()).toBe(4);
		});

		it("should handle all 20 levels in different classes", () => {
			state.setAbilityBase("str", 13);
			state.setAbilityBase("dex", 13);
			state.setAbilityBase("con", 13);
			state.setAbilityBase("int", 13);
			state.setAbilityBase("wis", 13);
			state.setAbilityBase("cha", 13);

			state.addClass({name: "Fighter", source: "PHB", level: 5});
			state.addClass({name: "Rogue", source: "PHB", level: 5});
			state.addClass({name: "Wizard", source: "PHB", level: 5});
			state.addClass({name: "Cleric", source: "PHB", level: 5});

			expect(state.getTotalLevel()).toBe(20);
			expect(state.getProficiencyBonus()).toBe(6);
		});

		it("should prevent exceeding level 20 total", () => {
			state.addClass({name: "Fighter", source: "PHB", level: 20});
			const result = state.addClass({name: "Rogue", source: "PHB", level: 1});
			expect(result).toBe(false);
			expect(state.getTotalLevel()).toBe(20);
		});

		it("should handle character with no class", () => {
			// Commoner/NPC scenario
			state.setAbilityBase("str", 10);
			expect(state.getTotalLevel()).toBe(0);
			expect(state.getProficiencyBonus()).toBe(2); // Minimum
		});

		it("should handle massive damage death", () => {
			state.setMaxHp(40);
			state.setCurrentHp(20);

			// Damage exceeds current HP + max HP
			state.takeDamage(60);
			expect(state.isDead()).toBe(true);
		});

		it("should handle negative temp HP scenarios", () => {
			state.setMaxHp(40);
			state.setCurrentHp(40);
			state.setTempHp(10);

			// Can't set negative temp HP
			const result = state.setTempHp(-5);
			expect(result).toBe(false);
			expect(state.getTempHp()).toBe(10);
		});

		it("should handle conflicting AC calculations", () => {
			state.setAbilityBase("dex", 16);
			state.setAbilityBase("con", 14);

			// Add multiple AC options
			state.addItem({name: "Plate Armor", type: "armor", ac: 18, equipped: true});
			// Unarmored defense would be 10 + DEX + CON = 15
			state.addFeature({name: "Unarmored Defense", calculateAC: () => 10 + 3 + 2});

			// Should use best option (Plate)
			expect(state.getAC()).toBe(18);
		});

		it("should handle proficiency with expertise stacking", () => {
			state.addClass({name: "Rogue", source: "PHB", level: 1});
			state.setAbilityBase("dex", 16);
			state.setSkillProficiency("stealth", 1); // Proficient
			state.setSkillExpertise("stealth", true); // Expertise

			// Level 1: proficiency = 2, expertise = 4, DEX = +3
			const stealthBonus = state.getSkillBonus("stealth");
			expect(stealthBonus).toBe(7); // +3 DEX + 4 expertise
		});
	});

	// ==========================================================================
	// Spell Preparation Workflow
	// ==========================================================================
	describe("Spell Preparation Workflow", () => {
		let state;

		beforeEach(() => {
			state = new CharacterSheetState();
			state.setAbilityBase("wis", 16);
			state.addClass({name: "Cleric", source: "PHB", level: 5});
		});

		it("should calculate correct number of prepared spells", () => {
			// Cleric: level + WIS modifier
			const maxPrepared = state.getMaxPreparedSpells("Cleric");
			expect(maxPrepared).toBe(8); // 5 + 3
		});

		it("should track prepared vs known spells", () => {
			state.addKnownSpell({name: "Cure Wounds", level: 1, prepared: true});
			state.addKnownSpell({name: "Bless", level: 1, prepared: true});
			state.addKnownSpell({name: "Guiding Bolt", level: 1, prepared: false});

			const prepared = state.getPreparedSpells();
			expect(prepared.length).toBe(2);
			expect(prepared.some(s => s.name === "Cure Wounds")).toBe(true);
			expect(prepared.some(s => s.name === "Guiding Bolt")).toBe(false);
		});

		it("should include domain spells as always prepared", () => {
			state.setSubclass("Cleric", {name: "Life Domain", source: "PHB"});
			state.addKnownSpell({
				name: "Bless",
				level: 1,
				alwaysPrepared: true,
				source: "domain",
			});

			const prepared = state.getPreparedSpells();
			expect(prepared.some(s => s.name === "Bless" && s.alwaysPrepared)).toBe(true);
		});
	});

	// ==========================================================================
	// Equipment Management
	// ==========================================================================
	describe("Equipment Management", () => {
		let state;

		beforeEach(() => {
			state = new CharacterSheetState();
			state.setAbilityBase("str", 16);
			state.addClass({name: "Fighter", source: "PHB", level: 5});
		});

		it("should track multiple weapon configurations", () => {
			state.addItem({
				id: "weapon1",
				name: "Greatsword",
				type: "weapon",
				damage: "2d6",
				properties: ["heavy", "two-handed"],
			});
			state.addItem({
				id: "weapon2",
				name: "Longsword",
				type: "weapon",
				damage: "1d8",
				properties: ["versatile"],
			});
			state.addItem({
				id: "weapon3",
				name: "Shield",
				type: "armor",
				acBonus: 2,
			});

			// Equip greatsword
			state.equip("weapon1");
			expect(state.getEquippedWeapons()[0].name).toBe("Greatsword");

			// Switch to sword and board
			state.unequip("weapon1");
			state.equip("weapon2");
			state.equip("weapon3");
			const equipped = state.getEquippedItems();
			expect(equipped.some(i => i.name === "Longsword")).toBe(true);
			expect(equipped.some(i => i.name === "Shield")).toBe(true);
		});

		it("should enforce attunement limits", () => {
			state.addItem({id: "item1", name: "Ring of Protection", requiresAttunement: true});
			state.addItem({id: "item2", name: "Cloak of Protection", requiresAttunement: true});
			state.addItem({id: "item3", name: "Amulet of Health", requiresAttunement: true});
			state.addItem({id: "item4", name: "Belt of Giant Strength", requiresAttunement: true});

			state.attune("item1");
			state.attune("item2");
			state.attune("item3");
			const result = state.attune("item4"); // Should fail - max 3

			expect(result).toBe(false);
			expect(state.getAttunedItems().length).toBe(3);
		});

		it("should calculate encumbrance based on carrying capacity", () => {
			// Set to 2024 rules for predictable 15 x STR capacity
			state.setSetting("thelemar_carryWeight", false);
			expect(state.getCarryingCapacity()).toBe(240);

			state.addItem({name: "Plate Armor", weight: 65});
			state.addItem({name: "Greatsword", weight: 6});
			state.addItem({name: "Backpack", weight: 5});
			state.addItem({name: "Rations (10 days)", weight: 20});

			expect(state.getTotalWeight()).toBe(96);
			expect(state.getEncumbranceLevel()).toBe("normal"); // Under 80 lbs (STR * 5)
		});
	});
});
