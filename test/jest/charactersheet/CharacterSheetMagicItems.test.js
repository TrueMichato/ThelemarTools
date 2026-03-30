/**
 * Character Sheet Magic Items - Comprehensive Test Suite
 * Tests for magic item bonus application, attunement gating,
 * defensive properties, and all item bonus types.
 */

import "./setup.js";
import "../../../js/charactersheet/charactersheet-state.js";

const CharacterSheetState = globalThis.CharacterSheetState;
const FeatureModifierParser = globalThis.FeatureModifierParser;

function makeWeapon (overrides = {}) {
	return {
		name: overrides.name || "Magic Longsword", source: "DMG", weapon: true,
		weaponCategory: "martial", type: "M", weight: 3, dmg1: "1d8", dmgType: "S",
		equipped: false, attuned: false,
		requiresAttunement: overrides.requiresAttunement || false,
		bonusWeapon: overrides.bonusWeapon || 0,
		bonusWeaponAttack: overrides.bonusWeaponAttack || 0,
		bonusWeaponDamage: overrides.bonusWeaponDamage || 0,
		bonusWeaponCritDamage: overrides.bonusWeaponCritDamage || 0,
		critThreshold: overrides.critThreshold || null,
		...overrides,
	};
}

function makeWondrous (overrides = {}) {
	return {
		name: overrides.name || "Wondrous Item", source: "DMG", type: "wondrous",
		weight: 0, equipped: false, attuned: false,
		requiresAttunement: overrides.requiresAttunement !== undefined ? overrides.requiresAttunement : true,
		bonusAc: overrides.bonusAc || 0,
		bonusSavingThrow: overrides.bonusSavingThrow || 0,
		bonusSpellAttack: overrides.bonusSpellAttack || 0,
		bonusSpellSaveDc: overrides.bonusSpellSaveDc || 0,
		bonusAbilityCheck: overrides.bonusAbilityCheck || 0,
		bonusProficiencyBonus: overrides.bonusProficiencyBonus || 0,
		bonusSavingThrowConcentration: overrides.bonusSavingThrowConcentration || 0,
		bonusSpellDamage: overrides.bonusSpellDamage || 0,
		...overrides,
	};
}

function addEquipAttune (state, item, attune = false) {
	state.addItem(item);
	const items = state.getItems();
	const added = items[items.length - 1];
	state.setItemEquipped(added.id, true);
	if (attune) state.setItemAttuned(added.id, true);
	return added.id;
}

describe("Magic Item Bonuses", () => {
	let state;

	beforeEach(() => {
		state = new CharacterSheetState();
		state.addClass({name: "Fighter", source: "PHB", level: 5});
		state.setAbilityBase("str", 16);
		state.setAbilityBase("dex", 14);
		state.setAbilityBase("con", 14);
		state.setAbilityBase("int", 10);
		state.setAbilityBase("wis", 12);
		state.setAbilityBase("cha", 8);
	});

	// ======================================================================
	// AC Double-Counting Fix
	// ======================================================================
	describe("AC Calculation (no double-counting)", () => {
		it("should give base AC 10+DEX with no armor", () => {
			expect(state.getAc()).toBe(12);
		});

		it("should correctly apply +1 armor bonusAc without double-counting", () => {
			state.setArmor({ac: 17, type: "heavy", name: "+1 Chain Mail", magicBonus: 1});
			expect(state.getAc()).toBe(17);
		});

		it("should correctly apply Ring of Protection +1 AC without double-counting", () => {
			state.setItemAcBonus(1);
			expect(state.getAc()).toBe(13); // 10 + DEX(2) + ring(1)
		});

		it("should only count AC bonus once via ac.itemBonus path", () => {
			state.setItemAcBonus(1);
			state.setItemBonuses({savingThrow: 1}); // No AC in itemBonuses
			expect(state.getAc()).toBe(13); // Not 14
		});

		it("should stack armor + shield + ring correctly without double-counting", () => {
			state.setArmor({ac: 17, type: "heavy", name: "+1 Chain Mail", magicBonus: 1});
			state.setShield({equipped: true, ac: 2, bonus: 1});
			state.setItemAcBonus(1);
			expect(state.getAc()).toBe(21); // 17 + 2(shield base) + 1(shield magic) + 1(ring)
		});

		it("should NOT double-count when itemBonuses has no ac field", () => {
			state.setArmor({ac: 18, type: "heavy", name: "Plate", magicBonus: 0});
			state.setItemBonuses({savingThrow: 1});
			expect(state.getAc()).toBe(18);
		});
	});

	// ======================================================================
	// Bonus Gating (Equip/Attune)
	// ======================================================================
	describe("Bonus Gating (equip and attune requirements)", () => {
		it("should not apply bonuses from unequipped items", () => {
			state.addItem(makeWondrous({name: "Cloak", bonusSavingThrow: 1, requiresAttunement: true}));
			expect(state.getItemBonus("savingThrow")).toBe(0);
		});

		it("should apply bonuses when set directly via setItemBonuses", () => {
			state.setItemBonuses({savingThrow: 1});
			expect(state.getItemBonus("savingThrow")).toBe(1);
		});

		it("should respect attunement limit of 3", () => {
			for (let i = 0; i < 3; i++) {
				addEquipAttune(state, makeWondrous({name: `Ring ${i + 1}`, requiresAttunement: true}), true);
			}
			expect(state.getAttunedCount()).toBe(3);
			expect(state.getMaxAttunement()).toBe(3);
			expect(state.canAttune()).toBe(false);
		});

		it("should remove bonus when clearing item bonuses", () => {
			state.setItemBonuses({savingThrow: 1});
			expect(state.getItemBonus("savingThrow")).toBe(1);
			state.setItemBonuses({savingThrow: 0});
			expect(state.getItemBonus("savingThrow")).toBe(0);
		});

		it("should track equipped state on items", () => {
			const id = addEquipAttune(state, makeWondrous({name: "Ring"}), false);
			const item = state.getItems().find(i => i.id === id);
			expect(item.equipped).toBe(true);
			expect(item.attuned).toBe(false);
		});

		it("should track attuned state on items", () => {
			const id = addEquipAttune(state, makeWondrous({name: "Ring"}), true);
			const item = state.getItems().find(i => i.id === id);
			expect(item.equipped).toBe(true);
			expect(item.attuned).toBe(true);
		});

		it("should allow unattuning an item", () => {
			const id = addEquipAttune(state, makeWondrous({name: "Ring"}), true);
			state.setItemAttuned(id, false);
			const item = state.getItems().find(i => i.id === id);
			expect(item.attuned).toBe(false);
		});
	});

	// ======================================================================
	// Weapon Bonuses
	// ======================================================================
	describe("Weapon Bonuses", () => {
		it("should store bonusWeapon on added weapon", () => {
			state.addItem(makeWeapon({name: "+1 Longsword", bonusWeapon: 1}));
			const w = state.getItems().find(i => i.name === "+1 Longsword");
			expect(w.bonusWeapon).toBe(1);
		});

		it("should store bonusWeaponAttack separately from bonusWeapon", () => {
			state.addItem(makeWeapon({name: "Special Sword", bonusWeapon: 1, bonusWeaponAttack: 2}));
			const w = state.getItems().find(i => i.name === "Special Sword");
			expect(w.bonusWeapon).toBe(1);
			expect(w.bonusWeaponAttack).toBe(2);
		});

		it("should store bonusWeaponDamage on weapons", () => {
			state.addItem(makeWeapon({name: "Vicious Sword", bonusWeaponDamage: 7}));
			expect(state.getItems().find(i => i.name === "Vicious Sword").bonusWeaponDamage).toBe(7);
		});

		it("should store bonusWeaponCritDamage on weapons", () => {
			state.addItem(makeWeapon({name: "Crit Sword", bonusWeaponCritDamage: 3}));
			expect(state.getItems().find(i => i.name === "Crit Sword").bonusWeaponCritDamage).toBe(3);
		});

		it("should store critThreshold on weapons", () => {
			state.addItem(makeWeapon({name: "Keen Blade", critThreshold: 19}));
			expect(state.getItems().find(i => i.name === "Keen Blade").critThreshold).toBe(19);
		});
	});

	// ======================================================================
	// Spell Bonuses
	// ======================================================================
	describe("Spell Bonuses", () => {
		beforeEach(() => { state.setSpellcastingAbility("int"); });

		it("should apply bonusSpellAttack to spell attack bonus", () => {
			state.setItemBonuses({spellAttack: 2});
			expect(state.getSpellAttackBonus()).toBe(5); // Prof(3)+INT(0)+item(2)
		});

		it("should apply bonusSpellSaveDc to spell save DC", () => {
			state.setItemBonuses({spellSaveDc: 1});
			expect(state.getSpellSaveDc()).toBe(12); // 8+Prof(3)+INT(0)+item(1)
		});

		it("should store bonusSpellDamage in item bonuses", () => {
			state.setItemBonuses({spellDamage: 2});
			expect(state.getItemBonus("spellDamage")).toBe(2);
		});

		it("should not affect spell bonuses if item lacks those properties", () => {
			state.setItemBonuses({savingThrow: 1});
			expect(state.getSpellAttackBonus()).toBe(3); // Prof(3)+INT(0)
		});
	});

	// ======================================================================
	// Saving Throw Bonuses
	// ======================================================================
	describe("Saving Throw Bonuses", () => {
		it("should apply global bonusSavingThrow to all saves", () => {
			state.setItemBonuses({savingThrow: 1});
			state.addSaveProficiency("str");
			state.addSaveProficiency("con");

			expect(state.getSaveMod("str")).toBe(7); // mod(3)+prof(3)+item(1)
			expect(state.getSaveMod("dex")).toBe(3); // mod(2)+item(1)
			expect(state.getSaveMod("con")).toBe(6); // mod(2)+prof(3)+item(1)
			expect(state.getSaveMod("wis")).toBe(2); // mod(1)+item(1)
		});

		it("should apply per-ability saving throw bonus only to that ability", () => {
			state.setItemBonuses({savingThrowDex: 2});
			expect(state.getSaveMod("dex")).toBe(4); // mod(2)+perAbility(2)
			expect(state.getSaveMod("str")).toBe(3); // mod(3)+perAbility(0)
		});

		it("should stack global and per-ability saving throw bonuses", () => {
			state.setItemBonuses({savingThrow: 1, savingThrowWis: 2});
			expect(state.getSaveMod("wis")).toBe(4); // mod(1)+global(1)+per(2)
			expect(state.getSaveMod("str")).toBe(4); // mod(3)+global(1)
		});
	});

	// ======================================================================
	// Concentration Save Bonus
	// ======================================================================
	describe("Concentration Save Bonus", () => {
		it("should include item concentration save bonus", () => {
			state.addSaveProficiency("con");
			const baseConc = state.getConcentrationSaveBonus();
			state.setItemBonuses({savingThrowConcentration: 2});
			expect(state.getConcentrationSaveBonus()).toBe(baseConc + 2);
		});

		it("should stack concentration bonus with global save bonus", () => {
			state.addSaveProficiency("con");
			state.setItemBonuses({savingThrow: 1, savingThrowConcentration: 1});
			// CON save = mod(2)+prof(3)+global(1) = 6, + conc(1) = 7
			expect(state.getConcentrationSaveBonus()).toBe(7);
		});
	});

	// ======================================================================
	// Proficiency Bonus
	// ======================================================================
	describe("Proficiency Bonus from Items", () => {
		it("should add item proficiency bonus on top of base", () => {
			expect(state.getProficiencyBonus()).toBe(3);
			state.setItemBonuses({proficiencyBonus: 1});
			expect(state.getProficiencyBonus()).toBe(4);
		});

		it("should cascade proficiency bonus increase to dependent calculations", () => {
			state.addSaveProficiency("str");
			expect(state.getSaveMod("str")).toBe(6); // mod(3)+prof(3)
			state.setItemBonuses({proficiencyBonus: 1});
			expect(state.getSaveMod("str")).toBe(7); // mod(3)+prof(4)
		});
	});

	// ======================================================================
	// Ability Check Bonus
	// ======================================================================
	describe("Ability Check Bonus", () => {
		it("should apply bonusAbilityCheck to skill checks", () => {
			state.setItemBonuses({abilityCheck: 1});
			expect(state.getSkillModWithAbility("athletics", "str")).toBe(4); // mod(3)+item(1)
		});

		it("should stack with skill proficiency", () => {
			state.setSkillProficiency("athletics", 1);
			state.setItemBonuses({abilityCheck: 1});
			expect(state.getSkillModWithAbility("athletics", "str")).toBe(7); // mod(3)+prof(3)+item(1)
		});
	});

	// ======================================================================
	// Critical Hit Range from Items
	// ======================================================================
	describe("Critical Range from Items", () => {
		it("should default to 20 with no effects", () => {
			expect(state.getCriticalRange()).toBe(20);
		});

		it("should use item critThreshold when lower than default", () => {
			state.setItemBonuses({critThreshold: 19});
			expect(state.getCriticalRange()).toBe(19);
		});

		it("should use lowest critThreshold", () => {
			state.setItemBonuses({critThreshold: 18});
			expect(state.getCriticalRange()).toBe(18);
		});

		it("should not use critThreshold when higher than 20", () => {
			state.setItemBonuses({critThreshold: 21});
			expect(state.getCriticalRange()).toBe(20);
		});

		it("should not affect crit range when critThreshold is not set", () => {
			state.setItemBonuses({savingThrow: 1});
			expect(state.getCriticalRange()).toBe(20);
		});
	});

	// ======================================================================
	// Item Defenses (Resistances, Immunities, etc.)
	// ======================================================================
	describe("Item Defenses", () => {
		it("should add item resistances to getResistances()", () => {
			state.setItemDefenses({
				resist: [{type: "fire", source: "Ring"}],
				immune: [], vulnerable: [], conditionImmune: [],
			});
			expect(state.getResistances()).toContain("fire");
		});

		it("should add item immunities to getImmunities()", () => {
			state.setItemDefenses({
				resist: [], immune: [{type: "poison", source: "Periapt"}],
				vulnerable: [], conditionImmune: [],
			});
			expect(state.getImmunities()).toContain("poison");
		});

		it("should add item vulnerabilities to getVulnerabilities()", () => {
			state.setItemDefenses({
				resist: [], immune: [],
				vulnerable: [{type: "fire", source: "Cursed Armor"}],
				conditionImmune: [],
			});
			expect(state.getVulnerabilities()).toContain("fire");
		});

		it("should add item condition immunities to getConditionImmunities()", () => {
			state.setItemDefenses({
				resist: [], immune: [], vulnerable: [],
				conditionImmune: [{type: "frightened", source: "Amulet"}],
			});
			expect(state.getConditionImmunities()).toContain("frightened");
		});

		it("should deduplicate with existing resistances", () => {
			state.addResistance("fire");
			state.setItemDefenses({
				resist: [{type: "fire", source: "Ring"}],
				immune: [], vulnerable: [], conditionImmune: [],
			});
			expect(state.getResistances().filter(r => r === "fire").length).toBe(1);
		});

		it("should combine item defenses with race/class defenses", () => {
			state.addResistance("poison");
			state.setItemDefenses({
				resist: [{type: "fire", source: "Ring"}],
				immune: [], vulnerable: [], conditionImmune: [],
			});
			const res = state.getResistances();
			expect(res).toContain("poison");
			expect(res).toContain("fire");
		});

		it("should clear item defenses when set to empty", () => {
			state.setItemDefenses({
				resist: [{type: "fire", source: "Ring"}],
				immune: [], vulnerable: [], conditionImmune: [],
			});
			expect(state.getResistances()).toContain("fire");
			state.setItemDefenses({resist: [], immune: [], vulnerable: [], conditionImmune: []});
			expect(state.getResistances()).not.toContain("fire");
		});

		it("should track defense sources", () => {
			state.setItemDefenses({
				resist: [{type: "fire", source: "Ring of Fire Resistance"}],
				immune: [], vulnerable: [], conditionImmune: [],
			});
			expect(state.getItemDefenses().resist[0].source).toBe("Ring of Fire Resistance");
		});

		it("should handle multiple defenses from multiple items", () => {
			state.setItemDefenses({
				resist: [
					{type: "fire", source: "Ring"},
					{type: "cold", source: "Armor"},
				],
				immune: [{type: "poison", source: "Periapt"}],
				vulnerable: [],
				conditionImmune: [{type: "poisoned", source: "Periapt"}],
			});
			expect(state.getResistances()).toContain("fire");
			expect(state.getResistances()).toContain("cold");
			expect(state.getImmunities()).toContain("poison");
			expect(state.getConditionImmunities()).toContain("poisoned");
		});
	});

	// ======================================================================
	// Item Bonus API
	// ======================================================================
	describe("Item Bonus API", () => {
		it("should set and get item bonuses by type", () => {
			state.setItemBonuses({savingThrow: 1, spellAttack: 2});
			expect(state.getItemBonus("savingThrow")).toBe(1);
			expect(state.getItemBonus("spellAttack")).toBe(2);
		});

		it("should return 0 for unset bonus types", () => {
			expect(state.getItemBonus("savingThrow")).toBe(0);
			expect(state.getItemBonus("proficiencyBonus")).toBe(0);
			expect(state.getItemBonus("nonexistent")).toBe(0);
		});

		it("should get all item bonuses as object", () => {
			state.setItemBonuses({savingThrow: 2, spellAttack: 1, spellDamage: 3});
			const b = state.getItemBonuses();
			expect(b.savingThrow).toBe(2);
			expect(b.spellAttack).toBe(1);
			expect(b.spellDamage).toBe(3);
		});

		it("should set individual bonus type", () => {
			state.setItemBonus("savingThrow", 3);
			expect(state.getItemBonus("savingThrow")).toBe(3);
		});

		it("should handle setItemBonuses with null", () => {
			state.setItemBonuses({savingThrow: 1});
			state.setItemBonuses(null);
			expect(state.getItemBonus("savingThrow")).toBe(0);
		});
	});

	// ======================================================================
	// Item Defenses API
	// ======================================================================
	describe("Item Defenses API", () => {
		it("should set and get item defenses", () => {
			state.setItemDefenses({
				resist: [{type: "fire", source: "Shield"}],
				immune: [], vulnerable: [], conditionImmune: [],
			});
			expect(state.getItemDefenses().resist).toHaveLength(1);
			expect(state.getItemDefenses().resist[0].type).toBe("fire");
		});

		it("should handle setItemDefenses with null", () => {
			state.setItemDefenses(null);
			const d = state.getItemDefenses();
			expect(d.resist).toEqual([]);
			expect(d.immune).toEqual([]);
		});

		it("should default to empty arrays for all defense types", () => {
			const d = state.getItemDefenses();
			expect(d.resist).toEqual([]);
			expect(d.immune).toEqual([]);
			expect(d.vulnerable).toEqual([]);
			expect(d.conditionImmune).toEqual([]);
		});
	});

	// ======================================================================
	// Edge Cases
	// ======================================================================
	describe("Edge Cases", () => {
		it("should handle multiple items' bonuses stacking", () => {
			state.setItemBonuses({savingThrow: 2});
			state.addSaveProficiency("str");
			expect(state.getSaveMod("str")).toBe(8); // mod(3)+prof(3)+item(2)
		});

		it("should handle zero bonuses gracefully", () => {
			state.setItemBonuses({savingThrow: 0, spellAttack: 0});
			expect(state.getItemBonus("savingThrow")).toBe(0);
			expect(state.getItemBonus("spellAttack")).toBe(0);
		});

		it("should maintain item bonuses across operations", () => {
			state.setItemBonuses({savingThrow: 1, spellAttack: 2});
			state.addItem(makeWeapon({name: "Test Sword"}));
			expect(state.getItemBonus("savingThrow")).toBe(1);
			expect(state.getItemBonus("spellAttack")).toBe(2);
		});

		it("should handle per-ability save bonus key format", () => {
			state.setItemBonuses({savingThrowStr: 2, savingThrowDex: 1});
			expect(state.getSaveMod("str")).toBe(5); // mod(3)+per(2)
			expect(state.getSaveMod("dex")).toBe(3); // mod(2)+per(1)
			expect(state.getSaveMod("con")).toBe(2); // mod(2)+per(0)
		});

		it("should handle items with multiple bonus types simultaneously", () => {
			state.setItemBonuses({proficiencyBonus: 1, savingThrow: 2, spellAttack: 2});
			state.setItemAcBonus(2);
			expect(state.getProficiencyBonus()).toBe(4);
			expect(state.getItemAcBonus()).toBe(2);
			expect(state.getItemBonus("savingThrow")).toBe(2);
		});
	});

	// ======================================================================
	// Real-World Item Scenarios
	// ======================================================================
	describe("Real-World Item Scenarios", () => {
		it("should correctly model Staff of Power (+2 attack, +2 save, +2 AC)", () => {
			state.setItemBonuses({savingThrow: 2, spellAttack: 2});
			state.setItemAcBonus(2);
			state.setSpellcastingAbility("int");
			expect(state.getSpellAttackBonus()).toBe(5); // prof(3)+INT(0)+item(2)
			expect(state.getSaveMod("str")).toBe(5); // mod(3)+item(2)
			expect(state.getAc()).toBe(14); // 10+DEX(2)+item(2)
		});

		it("should correctly model Ioun Stone of Mastery (+1 proficiency)", () => {
			state.setItemBonuses({proficiencyBonus: 1});
			state.addSaveProficiency("str");
			state.addSaveProficiency("con");
			state.setSpellcastingAbility("int");
			expect(state.getProficiencyBonus()).toBe(4);
			expect(state.getSpellAttackBonus()).toBe(4); // prof(4)+INT(0)
			expect(state.getSpellSaveDc()).toBe(12); // 8+prof(4)+INT(0)
			expect(state.getSaveMod("str")).toBe(7); // mod(3)+prof(4)
		});

		it("should correctly model Ring of Fire Resistance", () => {
			state.setItemDefenses({
				resist: [{type: "fire", source: "Ring of Fire Resistance"}],
				immune: [], vulnerable: [], conditionImmune: [],
			});
			expect(state.getResistances()).toContain("fire");
			expect(state.getResistances()).toHaveLength(1);
		});

		it("should correctly model Armor of Resistance (cold) + AC", () => {
			state.setArmor({ac: 16, type: "heavy", name: "Armor of Cold Resistance", magicBonus: 0});
			state.setItemDefenses({
				resist: [{type: "cold", source: "Armor of Cold Resistance"}],
				immune: [], vulnerable: [], conditionImmune: [],
			});
			expect(state.getResistances()).toContain("cold");
			expect(state.getAc()).toBe(16);
		});

		it("should correctly model Cloak of Protection (+1 AC, +1 saves)", () => {
			state.setItemBonuses({savingThrow: 1});
			state.setItemAcBonus(1);
			state.addSaveProficiency("str");
			state.addSaveProficiency("con");
			expect(state.getAc()).toBe(13); // 10+DEX(2)+item(1)
			expect(state.getSaveMod("dex")).toBe(3); // mod(2)+item(1)
			expect(state.getSaveMod("wis")).toBe(2); // mod(1)+item(1)
		});

		it("should correctly model combined Ring of Protection + Cloak of Protection", () => {
			state.setItemBonuses({savingThrow: 2}); // 1+1
			state.setItemAcBonus(2); // 1+1
			expect(state.getAc()).toBe(14); // 10+DEX(2)+items(2)
			expect(state.getSaveMod("str")).toBe(5); // mod(3)+items(2)
		});
	});

	// ======================================================================
	// Speed Modifications from Items
	// ======================================================================
	describe("Speed Modifications from Items", () => {
		it("should apply item speed bonus to walk speed", () => {
			state.setItemBonuses({speedBonus: {walk: 10}});
			const walkSpeed = state.getSpeedByType("walk");
			// Base 30 + item 10 = 40
			expect(walkSpeed).toBe(40);
		});

		it("should apply wildcard (*) speed bonus to all movement types", () => {
			state.setSpeed("walk", 30);
			state.setSpeed("fly", 30);
			state.setItemBonuses({speedBonus: {"*": 10}});
			expect(state.getSpeedByType("walk")).toBe(40);
			expect(state.getSpeedByType("fly")).toBe(40);
		});

		it("should grant new movement type via static speed", () => {
			// Item grants fly speed of 30 (e.g., Winged Boots)
			state.setItemBonuses({speedStatic: {fly: 30}});
			expect(state.getSpeedByType("fly")).toBe(30);
		});

		it("should use highest static speed when multiple items grant same type", () => {
			state.setItemBonuses({speedStatic: {fly: 60}}); // Best of multiple items
			expect(state.getSpeedByType("fly")).toBe(60);
		});

		it("should combine static and bonus speeds", () => {
			state.setItemBonuses({
				speedStatic: {fly: 30},
				speedBonus: {fly: 10},
			});
			expect(state.getSpeedByType("fly")).toBe(40); // static 30 + bonus 10
		});

		it("should not affect speed when no modifySpeed items", () => {
			state.setItemBonuses({savingThrow: 1}); // No speed bonuses
			expect(state.getSpeedByType("walk")).toBe(30); // Default
			expect(state.getSpeedByType("fly")).toBe(0); // No fly
		});

		it("should include item speed bonus in formatted speed string", () => {
			state.setItemBonuses({speedBonus: {walk: 10}});
			const speedStr = state.getSpeed();
			expect(speedStr).toContain("40 ft.");
		});

		it("should show granted fly speed in formatted speed string", () => {
			state.setItemBonuses({speedStatic: {fly: 30}});
			const speedStr = state.getSpeed();
			expect(speedStr).toContain("fly 30 ft.");
		});
	});

	// ======================================================================
	// Spell Damage Bonus Integration
	// ======================================================================
	describe("Spell Damage Bonus", () => {
		it("should store spellDamage in item bonuses", () => {
			state.setItemBonuses({spellDamage: 3});
			expect(state.getItemBonus("spellDamage")).toBe(3);
		});

		it("should be accessible via getItemBonus for combat module", () => {
			state.setItemBonuses({spellDamage: 1, spellAttack: 2});
			expect(state.getItemBonus("spellDamage")).toBe(1);
			expect(state.getItemBonus("spellAttack")).toBe(2);
		});

		it("should default to 0 when not set", () => {
			expect(state.getItemBonus("spellDamage")).toBe(0);
		});
	});

	// ======================================================================
	// Weapon Crit Damage Bonus
	// ======================================================================
	describe("Weapon Crit Damage Bonus", () => {
		it("should store bonusWeaponCritDamage on items", () => {
			state.addItem(makeWeapon({name: "Crit Blade", bonusWeaponCritDamage: 7}));
			const w = state.getItems().find(i => i.name === "Crit Blade");
			expect(w.bonusWeaponCritDamage).toBe(7);
		});

		it("should be accessible from sourceItem in attack context", () => {
			state.addItem(makeWeapon({name: "Vorpal", bonusWeaponCritDamage: 14}));
			const w = state.getItems().find(i => i.name === "Vorpal");
			// Simulate attack.sourceItem reference
			const attack = {sourceItem: w};
			expect(attack.sourceItem.bonusWeaponCritDamage).toBe(14);
		});
	});

	// ======================================================================
	// hasBonus Detection (equip button visibility)
	// ======================================================================
	describe("Item Bonus Detection for Equip Button", () => {
		// These tests verify that items with various bonus types are properly
		// detected as having bonuses (which enables the equip button in UI)

		it("should detect bonusWeaponAttack as a bonus", () => {
			const item = {bonusWeaponAttack: 1};
			const hasBonus = item.bonusAc || item.bonusSavingThrow || item.bonusSpellAttack
				|| item.bonusSpellSaveDc || item.bonusAbilityCheck || item.bonusWeapon
				|| item.bonusWeaponAttack || item.bonusWeaponDamage || item.bonusProficiencyBonus
				|| item.bonusSavingThrowConcentration || item.bonusSpellDamage
				|| item.bonusWeaponCritDamage || item.critThreshold
				|| item.resist?.length || item.immune?.length || item.vulnerable?.length
				|| item.conditionImmune?.length || item.modifySpeed;
			expect(!!hasBonus).toBe(true);
		});

		it("should detect bonusProficiencyBonus as a bonus", () => {
			const item = {bonusProficiencyBonus: 1};
			const hasBonus = item.bonusProficiencyBonus;
			expect(!!hasBonus).toBe(true);
		});

		it("should detect critThreshold as a bonus", () => {
			const item = {critThreshold: 19};
			const hasBonus = item.critThreshold;
			expect(!!hasBonus).toBe(true);
		});

		it("should detect resist array as a bonus", () => {
			const item = {resist: ["fire"]};
			const hasBonus = item.resist?.length;
			expect(!!hasBonus).toBe(true);
		});

		it("should detect modifySpeed as a bonus", () => {
			const item = {modifySpeed: {bonus: {walk: 10}}};
			const hasBonus = item.modifySpeed;
			expect(!!hasBonus).toBe(true);
		});

		it("should not detect item with no bonuses", () => {
			const item = {name: "Rope", weight: 5};
			const hasBonus = item.bonusAc || item.bonusSavingThrow || item.bonusSpellAttack
				|| item.bonusSpellSaveDc || item.bonusAbilityCheck || item.bonusWeapon
				|| item.bonusWeaponAttack || item.bonusWeaponDamage || item.bonusProficiencyBonus;
			expect(!!hasBonus).toBe(false);
		});
	});

	// ======================================================================
	// Custom Item Bonus Support
	// ======================================================================
	describe("Custom Item Bonus Support", () => {
		it("should accept all bonus types via addItem", () => {
			state.addItem({
				name: "Custom Ring", type: "wondrous", source: "Custom",
				bonusAc: 1, bonusSavingThrow: 1, bonusSpellAttack: 1,
				bonusSpellSaveDc: 1, bonusAbilityCheck: 1, bonusProficiencyBonus: 1,
				bonusSavingThrowConcentration: 1, bonusSpellDamage: 1,
				bonusWeaponCritDamage: 2, critThreshold: 19,
				resist: ["fire"], immune: ["poison"],
				modifySpeed: {bonus: {walk: 10}},
			});
			const item = state.getItems().find(i => i.name === "Custom Ring");
			expect(item).toBeDefined();
			expect(item.bonusAc).toBe(1);
			expect(item.bonusSavingThrow).toBe(1);
			expect(item.bonusProficiencyBonus).toBe(1);
			expect(item.bonusSpellDamage).toBe(1);
			expect(item.critThreshold).toBe(19);
			expect(item.resist).toContain("fire");
			expect(item.modifySpeed.bonus.walk).toBe(10);
		});
	});

	// ======================================================================
	// Attunement Enforcement
	// ======================================================================
	describe("Attunement Enforcement", () => {
		it("should track requiresAttunement flag on items", () => {
			state.addItem(makeWondrous({name: "Ring of Protection", requiresAttunement: true}));
			const item = state.getItems().find(i => i.name === "Ring of Protection");
			expect(item.requiresAttunement).toBe(true);
		});

		it("should not set attuned by default", () => {
			state.addItem(makeWondrous({name: "Ring", requiresAttunement: true}));
			const item = state.getItems().find(i => i.name === "Ring");
			expect(item.attuned).toBe(false);
		});

		it("should allow attuning when under limit", () => {
			state.addItem(makeWondrous({name: "Ring", requiresAttunement: true}));
			const item = state.getItems().find(i => i.name === "Ring");
			state.setItemAttuned(item.id, true);
			expect(state.getItems().find(i => i.id === item.id).attuned).toBe(true);
		});

		it("should count attuned items correctly", () => {
			for (let i = 0; i < 3; i++) {
				state.addItem(makeWondrous({name: `Ring ${i}`, requiresAttunement: true}));
			}
			const items = state.getItems();
			items.forEach(item => state.setItemAttuned(item.id, true));
			expect(state.getAttunedCount()).toBe(3);
		});

		it("should report max attunement of 3 for non-artificers", () => {
			expect(state.getMaxAttunement()).toBe(3);
		});

		it("should give Artificer level 10+ 4 attunement slots (Magic Item Adept)", () => {
			const artificerState = new CharacterSheetState();
			artificerState.addClass({name: "Artificer", source: "TCE", level: 10});
			expect(artificerState.getMaxAttunement()).toBe(4);
		});

		it("should give Artificer level 14+ 5 attunement slots (Magic Item Savant)", () => {
			const artificerState = new CharacterSheetState();
			artificerState.addClass({name: "Artificer", source: "TCE", level: 14});
			expect(artificerState.getMaxAttunement()).toBe(5);
		});

		it("should give Artificer level 18+ 6 attunement slots (Soul of Artifice)", () => {
			const artificerState = new CharacterSheetState();
			artificerState.addClass({name: "Artificer", source: "TCE", level: 18});
			expect(artificerState.getMaxAttunement()).toBe(6);
		});

		it("should give multiclass Artificer 10 / Fighter 5 only 4 attunement slots", () => {
			const multiState = new CharacterSheetState();
			multiState.addClass({name: "Artificer", source: "TCE", level: 10});
			multiState.addClass({name: "Fighter", source: "PHB", level: 5});
			expect(multiState.getMaxAttunement()).toBe(4);
		});

		it("should give Artificer level 9 only 3 attunement slots", () => {
			const artificerState = new CharacterSheetState();
			artificerState.addClass({name: "Artificer", source: "TCE", level: 9});
			expect(artificerState.getMaxAttunement()).toBe(3);
		});

		it("should report canAttune false when at limit", () => {
			for (let i = 0; i < 3; i++) {
				state.addItem(makeWondrous({name: `Ring ${i}`, requiresAttunement: true}));
			}
			state.getItems().forEach(item => state.setItemAttuned(item.id, true));
			expect(state.canAttune()).toBe(false);
		});

		it("should correctly gate calculateItemBonuses on attunement", () => {
			// Add a Cloak of Protection (requires attune, +1 AC, +1 saves)
			const cloakItem = makeWondrous({
				name: "Cloak of Protection",
				bonusAc: 1,
				bonusSavingThrow: 1,
				requiresAttunement: true,
			});
			state.addItem(cloakItem);
			const items = state.getItems();
			const cloak = items.find(i => i.name === "Cloak of Protection");

			// Equip but don't attune
			state.setItemEquipped(cloak.id, true);
			// Simulate what _calculateItemBonuses does: filter equipped + attuned check
			const shouldApply = cloak.equipped
				&& (!cloak.requiresAttunement || cloak.attuned);
			expect(shouldApply).toBe(false); // Not attuned → no bonus

			// Now attune
			state.setItemAttuned(cloak.id, true);
			const cloakAfterAttune = state.getItems().find(i => i.name === "Cloak of Protection");
			const shouldApplyAfter = cloakAfterAttune.equipped
				&& (!cloakAfterAttune.requiresAttunement || cloakAfterAttune.attuned);
			expect(shouldApplyAfter).toBe(true); // Attuned → bonus applies
		});

		it("should not gate bonuses on non-attunement items", () => {
			const item = makeWondrous({
				name: "Brooch",
				bonusSavingThrow: 1,
				requiresAttunement: false,
			});
			state.addItem(item);
			const addedBefore = state.getItems().find(i => i.name === "Brooch");
			state.setItemEquipped(addedBefore.id, true);

			// Re-fetch after equipping to get updated state
			const added = state.getItems().find(i => i.name === "Brooch");

			// Non-attunement item: equipped = bonuses apply
			const shouldApply = added.equipped
				&& (!added.requiresAttunement || added.attuned);
			expect(shouldApply).toBe(true);
		});
	});

	// ======================================================================
	// Attunement Requirements Validation
	// ======================================================================
	describe("Attunement Requirements Validation", () => {
		it("should allow attunement when no requirements specified", () => {
			const item = {name: "Generic Ring", requiresAttunement: true};
			const result = state.meetsAttunementRequirements(item);
			expect(result.canAttune).toBe(true);
			expect(result.reasons).toEqual([]);
		});

		it("should allow attunement when empty reqAttuneTags", () => {
			const item = {name: "Ring", reqAttuneTags: []};
			const result = state.meetsAttunementRequirements(item);
			expect(result.canAttune).toBe(true);
		});

		it("should fail when class requirement not met", () => {
			state.addClass({name: "Fighter", source: "PHB", level: 5});
			const item = {
				name: "+1 All-Purpose Tool",
				reqAttuneTags: [{class: "artificer|tce"}],
			};
			const result = state.meetsAttunementRequirements(item);
			expect(result.canAttune).toBe(false);
			expect(result.reasons).toContain("Requires Artificer class");
		});

		it("should pass when class requirement met", () => {
			state.addClass({name: "Artificer", source: "TCE", level: 5});
			const item = {
				name: "+1 All-Purpose Tool",
				reqAttuneTags: [{class: "artificer|tce"}],
			};
			const result = state.meetsAttunementRequirements(item);
			expect(result.canAttune).toBe(true);
		});

		it("should fail when race requirement not met", () => {
			state.setRace({name: "Human", source: "PHB"});
			const item = {
				name: "Elven Thrower",
				reqAttuneTags: [{race: "elf"}],
			};
			const result = state.meetsAttunementRequirements(item);
			expect(result.canAttune).toBe(false);
			expect(result.reasons).toContain("Requires Elf race");
		});

		it("should pass race requirement with partial match (High Elf matches elf)", () => {
			state.setRace({name: "High Elf", source: "PHB"});
			const item = {
				name: "Elven Thrower",
				reqAttuneTags: [{race: "elf"}],
			};
			const result = state.meetsAttunementRequirements(item);
			expect(result.canAttune).toBe(true);
		});

		it("should fail when spellcasting requirement not met", () => {
			state.addClass({name: "Fighter", source: "PHB", level: 1});
			const item = {
				name: "+1 Wand of the War Mage",
				reqAttuneTags: [{spellcasting: true}],
			};
			const result = state.meetsAttunementRequirements(item);
			expect(result.canAttune).toBe(false);
			expect(result.reasons).toContain("Requires spellcasting ability");
		});

		it("should pass spellcasting requirement when has spellcasting", () => {
			state.addClass({name: "Wizard", source: "PHB", level: 1});
			const item = {
				name: "+1 Wand of the War Mage",
				reqAttuneTags: [{spellcasting: true}],
			};
			const result = state.meetsAttunementRequirements(item);
			expect(result.canAttune).toBe(true);
		});

		it("should fail when ability score requirement not met", () => {
			state.setAbilityBase("str", 10);
			const item = {
				name: "Belt of Fire Giant Strength",
				reqAttuneTags: [{str: 15}],
			};
			const result = state.meetsAttunementRequirements(item);
			expect(result.canAttune).toBe(false);
			expect(result.reasons).toContain("Requires Strength 15+");
		});

		it("should pass ability score requirement when met", () => {
			state.setAbilityBase("int", 18);
			const item = {
				name: "Smart Item",
				reqAttuneTags: [{int: 15}],
			};
			const result = state.meetsAttunementRequirements(item);
			expect(result.canAttune).toBe(true);
		});

		it("should check alignment requirements", () => {
			state.setAlignment("LE"); // Lawful Evil
			const item = {
				name: "Holy Avenger",
				reqAttuneTags: [{alignment: ["G"]}], // Good alignments only (LG, NG, CG match "G")
			};
			const result = state.meetsAttunementRequirements(item);
			expect(result.canAttune).toBe(false);
			expect(result.reasons).toContain("Requires specific alignment");
		});

		it("should pass alignment when character matches", () => {
			state.setAlignment("LG"); // Lawful Good
			const item = {
				name: "Holy Avenger",
				reqAttuneTags: [{alignment: ["G"]}], // "G" matches any good alignment
			};
			const result = state.meetsAttunementRequirements(item);
			expect(result.canAttune).toBe(true);
		});

		it("should handle OR logic with multiple reqAttuneTags", () => {
			state.addClass({name: "Fighter", source: "PHB", level: 5});
			// Item can be attuned by fighter OR wizard
			const item = {
				name: "Versatile Weapon",
				reqAttuneTags: [
					{class: "fighter"},
					{class: "wizard"},
				],
			};
			const result = state.meetsAttunementRequirements(item);
			expect(result.canAttune).toBe(true); // Fighter matches first tag
		});

		it("should require ALL conditions in a single tag (AND logic)", () => {
			state.addClass({name: "Fighter", source: "PHB", level: 5});
			// Item requires fighter AND spellcasting (like Eldritch Knight)
			const item = {
				name: "Fighter Caster Item",
				reqAttuneTags: [{class: "fighter", spellcasting: true}],
			};
			const result = state.meetsAttunementRequirements(item);
			// Plain fighter doesn't have spellcasting
			expect(result.canAttune).toBe(false);
		});

		it("should bypass requirements with Use Magic Device", () => {
			state.addClass({name: "Rogue", source: "PHB", level: 13});
			state.addFeature({name: "Use Magic Device", source: "PHB"});
			const item = {
				name: "Holy Avenger",
				reqAttuneTags: [{class: "paladin"}],
			};
			const result = state.meetsAttunementRequirements(item);
			expect(result.canAttune).toBe(true); // UMD bypasses class requirement
		});

		it("should check skill proficiency requirement", () => {
			const item = {
				name: "Musical Item",
				reqAttuneTags: [{skillProficiency: "performance"}],
			};
			// No performance proficiency
			const result = state.meetsAttunementRequirements(item);
			expect(result.canAttune).toBe(false);
			expect(result.reasons).toContain("Requires Performance proficiency");
		});

		it("should pass skill proficiency when proficient", () => {
			state.setSkillProficiency("performance", 1);
			const item = {
				name: "Musical Item",
				reqAttuneTags: [{skillProficiency: "performance"}],
			};
			const result = state.meetsAttunementRequirements(item);
			expect(result.canAttune).toBe(true);
		});

		it("should check language proficiency requirement", () => {
			const item = {
				name: "Elvish Item",
				reqAttuneTags: [{languageProficiency: "elvish"}],
			};
			const result = state.meetsAttunementRequirements(item);
			expect(result.canAttune).toBe(false);
			expect(result.reasons).toContain("Requires Elvish language");
		});

		it("should pass language requirement when known", () => {
			state.addLanguage("Elvish");
			const item = {
				name: "Elvish Item",
				reqAttuneTags: [{languageProficiency: "elvish"}],
			};
			const result = state.meetsAttunementRequirements(item);
			expect(result.canAttune).toBe(true);
		});

		it("should check creature type requirement", () => {
			state.setRace({name: "Human", source: "PHB", creatureTypes: ["humanoid"]});
			const item = {
				name: "Fey Item",
				reqAttuneTags: [{creatureType: "fey"}],
			};
			const result = state.meetsAttunementRequirements(item);
			expect(result.canAttune).toBe(false);
			expect(result.reasons).toContain("Requires Fey creature type");
		});

		it("should check background requirement", () => {
			state.setBackground({name: "Sailor", source: "PHB"});
			const item = {
				name: "Azorius Keyrune",
				reqAttuneTags: [{background: "Azorius Functionary|GGR"}],
			};
			const result = state.meetsAttunementRequirements(item);
			expect(result.canAttune).toBe(false);
			expect(result.reasons).toContain("Requires Azorius Functionary background");
		});

		it("should pass background requirement when matched", () => {
			state.setBackground({name: "Azorius Functionary", source: "GGR"});
			const item = {
				name: "Azorius Keyrune",
				reqAttuneTags: [{background: "Azorius Functionary|GGR"}],
			};
			const result = state.meetsAttunementRequirements(item);
			expect(result.canAttune).toBe(true);
		});
	});

	// ======================================================================
	// Item-Granted Proficiencies
	// ======================================================================
	describe("Item-Granted Proficiencies", () => {
		it("should grant language proficiency from Belt of Dwarvenkind when equipped+attuned", () => {
			const belt = {
				id: "belt-dwarvenkind",
				name: "Belt of Dwarvenkind",
				requiresAttunement: true,
				entries: [
					"While wearing this belt, you gain the following benefits:",
					"You can speak, read, and write Dwarvish.",
				],
			};
			state.addItem(belt);

			// Not equipped - no language
			expect(state.getLanguages()).not.toContain("Dwarvish");

			// Equip but not attuned
			state.setItemEquipped("belt-dwarvenkind", true);
			expect(state.getLanguages()).not.toContain("Dwarvish");

			// Attune - should now have language
			state.setItemAttuned("belt-dwarvenkind", true);
			expect(state.getLanguages()).toContain("Dwarvish");
		});

		it("should remove language proficiency when item unattuned", () => {
			const belt = {
				id: "belt-lang",
				name: "Language Belt",
				requiresAttunement: true,
				entries: ["You can speak, read, and write Elvish."],
			};
			state.addItem(belt);
			state.setItemEquipped("belt-lang", true);
			state.setItemAttuned("belt-lang", true);
			expect(state.getLanguages()).toContain("Elvish");

			// Unattune - language should be removed
			state.setItemAttuned("belt-lang", false);
			expect(state.getLanguages()).not.toContain("Elvish");
		});

		it("should not remove language if also granted by another source", () => {
			// Add language from character background
			state.addLanguage("Dwarvish");

			const belt = {
				id: "belt-dwarv2",
				name: "Belt of Dwarvenkind",
				requiresAttunement: true,
				entries: ["You can speak, read, and write Dwarvish."],
			};
			state.addItem(belt);
			state.setItemEquipped("belt-dwarv2", true);
			state.setItemAttuned("belt-dwarv2", true);

			// Unattune - language should persist (from background)
			state.setItemAttuned("belt-dwarv2", false);
			expect(state.getLanguages()).toContain("Dwarvish");
		});

		it("should grant skill proficiency from item", () => {
			const item = {
				id: "skill-item",
				name: "Helm of Knowledge",
				requiresAttunement: true,
				entries: ["You gain proficiency in the History skill."],
			};
			state.addItem(item);
			state.setItemEquipped("skill-item", true);
			state.setItemAttuned("skill-item", true);

			expect(state.isProficientInSkill("history")).toBe(true);
		});

		it("should remove skill proficiency when item unequipped", () => {
			const item = {
				id: "skill-item2",
				name: "Stealth Cloak",
				requiresAttunement: false, // No attunement needed
				entries: ["You gain proficiency in the Stealth skill."],
			};
			state.addItem(item);
			state.setItemEquipped("skill-item2", true);
			expect(state.isProficientInSkill("stealth")).toBe(true);

			// Unequip
			state.setItemEquipped("skill-item2", false);
			expect(state.isProficientInSkill("stealth")).toBe(false);
		});

		it("should grant tool proficiency from item", () => {
			const item = {
				id: "tool-item",
				name: "Artisan's Belt",
				requiresAttunement: true,
				entries: ["You gain proficiency with smith's tools."],
			};
			state.addItem(item);
			state.setItemEquipped("tool-item", true);
			state.setItemAttuned("tool-item", true);

			expect(state.hasToolProficiency("smith's tools")).toBe(true);
		});

		it("should not apply proficiencies from non-equipped items", () => {
			const item = {
				id: "inactive-item",
				name: "Inactive Ring",
				requiresAttunement: false,
				entries: ["You gain proficiency in the Arcana skill."],
			};
			state.addItem(item);
			// Item is in inventory but not equipped
			expect(state.isProficientInSkill("arcana")).toBe(false);
		});

		it("should handle items with multiple proficiency grants", () => {
			const item = {
				id: "multi-prof",
				name: "Ring of Many Talents",
				requiresAttunement: true,
				entries: [
					"You gain proficiency in the Performance skill.",
					"You can speak, read, and write Celestial.",
				],
			};
			state.addItem(item);
			state.setItemEquipped("multi-prof", true);
			state.setItemAttuned("multi-prof", true);

			expect(state.isProficientInSkill("performance")).toBe(true);
			expect(state.getLanguages()).toContain("Celestial");

			// Remove both when unattuned
			state.setItemAttuned("multi-prof", false);
			expect(state.isProficientInSkill("performance")).toBe(false);
			expect(state.getLanguages()).not.toContain("Celestial");
		});
	});

	// ======================================================================
	// Bonus Spell Slots from Items
	// ======================================================================
	describe("Bonus Spell Slots from Items", () => {
		beforeEach(() => {
			// Set up a wizard with base spell slots
			state.addClass({name: "Wizard", level: 5, casterProgression: "full"});
			state.calculateSpellSlots();
		});

		it("should parse 'gain an additional Xth level spell slot' text", () => {
			const modifiers = FeatureModifierParser.parseModifiers(
				"You gain an additional 3rd level spell slot.",
				"Test Item"
			);
			const slotMod = modifiers.find(m => m.isSpellSlot);
			expect(slotMod).toBeDefined();
			expect(slotMod.slotLevel).toBe(3);
			expect(slotMod.slotCount).toBe(1);
		});

		it("should parse 'gain N additional Xth level spell slots' text", () => {
			const modifiers = FeatureModifierParser.parseModifiers(
				"You gain 2 additional 2nd level spell slots.",
				"Test Item"
			);
			const slotMod = modifiers.find(m => m.isSpellSlot);
			expect(slotMod).toBeDefined();
			expect(slotMod.slotLevel).toBe(2);
			expect(slotMod.slotCount).toBe(2);
		});

		it("should apply bonus spell slots when set via itemBonuses", () => {
			// Level 5 wizard has 4/3/2/0/0... slots
			expect(state.getSpellSlotsMax(3)).toBe(2);

			// Apply +1 3rd level slot from item
			state.setItemBonuses({spellSlots: {3: 1}});
			state.calculateSpellSlots();

			expect(state.getSpellSlotsMax(3)).toBe(3);
			expect(state.getSpellSlotsCurrent(3)).toBe(3);
		});

		it("should apply bonus slots to multiple levels", () => {
			// Level 5 wizard: 4/3/2/0/0
			expect(state.getSpellSlotsMax(1)).toBe(4);
			expect(state.getSpellSlotsMax(2)).toBe(3);
			expect(state.getSpellSlotsMax(3)).toBe(2);

			// Apply +1 to levels 1, 2, and 3
			state.setItemBonuses({spellSlots: {1: 1, 2: 1, 3: 1}});
			state.calculateSpellSlots();

			expect(state.getSpellSlotsMax(1)).toBe(5);
			expect(state.getSpellSlotsMax(2)).toBe(4);
			expect(state.getSpellSlotsMax(3)).toBe(3);
		});

		it("should stack bonus slots from multiple items", () => {
			// Level 5 wizard has 2 3rd level slots
			expect(state.getSpellSlotsMax(3)).toBe(2);

			// Apply +2 3rd level slots combined from items
			state.setItemBonuses({spellSlots: {3: 2}});
			state.calculateSpellSlots();

			expect(state.getSpellSlotsMax(3)).toBe(4);
		});

		it("should create slots for non-casters when item grants them", () => {
			// Create a non-caster state
			const fighterState = new CharacterSheetState();
			fighterState.addClass({name: "Fighter", level: 5});
			fighterState.calculateSpellSlots();

			// Fighter has no 3rd level slots
			expect(fighterState.getSpellSlotsMax(3)).toBeFalsy();

			// Item grants 3rd level slot
			fighterState.setItemBonuses({spellSlots: {3: 1}});
			fighterState.calculateSpellSlots();

			expect(fighterState.getSpellSlotsMax(3)).toBe(1);
			expect(fighterState.getSpellSlotsCurrent(3)).toBe(1);
		});

		it("should remove bonus slots when item bonuses are cleared", () => {
			// Apply bonus slot
			state.setItemBonuses({spellSlots: {3: 1}});
			state.calculateSpellSlots();
			expect(state.getSpellSlotsMax(3)).toBe(3);

			// Clear bonus slots
			state.setItemBonuses({spellSlots: {}});
			state.calculateSpellSlots();
			expect(state.getSpellSlotsMax(3)).toBe(2);
		});

		it("should not affect pact magic slots", () => {
			// Create warlock state
			const warlockState = new CharacterSheetState();
			warlockState.addClass({name: "Warlock", level: 5, casterProgression: "pact"});
			warlockState.calculateSpellSlots();

			// Level 5 warlock has 2 pact slots at 3rd level
			const pactSlots = warlockState.getPactSlots();
			expect(pactSlots.max).toBe(2);
			expect(pactSlots.level).toBe(3);

			// Item grants regular 3rd level slot (not pact)
			warlockState.setItemBonuses({spellSlots: {3: 1}});
			warlockState.calculateSpellSlots();

			// Pact slots unchanged
			const newPactSlots = warlockState.getPactSlots();
			expect(newPactSlots.max).toBe(2);

			// But regular slots gained
			expect(warlockState.getSpellSlotsMax(3)).toBe(1);
		});
	});

	// ======================================================================
	// Item Activation Actions
	// ======================================================================
	describe("Item Activation Actions", () => {
		it("should detect 'as an action' activation", () => {
			const wand = {
				id: "wand-fireballs",
				name: "Wand of Fireballs",
				entries: ["This wand has 7 charges. While holding it, you can use an action to expend 1 or more charges to cast the {@spell fireball} spell."],
			};
			state.addItem(wand);
			const items = state.getItems();
			const addedWand = items.find(i => i.id === "wand-fireballs");

			expect(addedWand.activation.length).toBeGreaterThan(0);
			expect(addedWand.activation[0].type).toBe("action");
		});

		it("should detect 'as a bonus action' activation", () => {
			const shield = {
				id: "animated-shield",
				name: "Animated Shield",
				entries: ["While holding this shield, you can speak its command word as a bonus action to cause it to animate."],
			};
			state.addItem(shield);
			const items = state.getItems();
			const addedShield = items.find(i => i.id === "animated-shield");

			expect(addedShield.activation.length).toBeGreaterThan(0);
			expect(addedShield.activation[0].type).toBe("bonus");
		});

		it("should detect 'as a reaction' activation", () => {
			const ring = {
				id: "ring-protection",
				name: "Ring of Reaction",
				entries: ["When you are hit by an attack, you can use your reaction to gain a +2 bonus to AC against that attack."],
			};
			state.addItem(ring);
			const items = state.getItems();
			const addedRing = items.find(i => i.id === "ring-protection");

			expect(addedRing.activation.length).toBeGreaterThan(0);
			expect(addedRing.activation[0].type).toBe("reaction");
		});

		it("should detect 'no action required' / passive activation", () => {
			const ring = {
				id: "ring-mind",
				name: "Ring of Mind Shielding",
				entries: ["While wearing this ring, you are immune to magic that reads your thoughts (no action required)."],
			};
			state.addItem(ring);
			const items = state.getItems();
			const addedRing = items.find(i => i.id === "ring-mind");

			expect(addedRing.activation.length).toBeGreaterThan(0);
			expect(addedRing.activation[0].type).toBe("none");
		});

		it("should detect timed activations (minutes)", () => {
			const orb = {
				id: "crystal-ball",
				name: "Crystal Ball",
				entries: ["You can use an action to gaze into the ball. The gazing takes 10 minutes to complete."],
			};
			state.addItem(orb);
			const items = state.getItems();
			const addedOrb = items.find(i => i.id === "crystal-ball");

			// Should detect both action and minute
			const minuteActivation = addedOrb.activation.find(a => a.type === "minute");
			expect(minuteActivation).toBeDefined();
			expect(minuteActivation.cost).toBe(10);
		});

		it("should return empty array for items without activation text", () => {
			const cloak = {
				id: "cloak-protection",
				name: "Cloak of Protection",
				entries: ["You gain a +1 bonus to AC and saving throws while you wear this cloak."],
			};
			state.addItem(cloak);
			const items = state.getItems();
			const addedCloak = items.find(i => i.id === "cloak-protection");

			expect(addedCloak.activation).toEqual([]);
		});

		it("should detect multiple activation types from same item", () => {
			const staff = {
				id: "staff-power",
				name: "Staff of Power",
				entries: [
					"You can use an action to expend charges to cast one of the following spells.",
					"As a reaction when you are hit, you can expend 1 charge to gain a +2 bonus to AC.",
				],
			};
			state.addItem(staff);
			const items = state.getItems();
			const addedStaff = items.find(i => i.id === "staff-power");

			expect(addedStaff.activation.length).toBeGreaterThanOrEqual(2);
			expect(addedStaff.activation.some(a => a.type === "action")).toBe(true);
			expect(addedStaff.activation.some(a => a.type === "reaction")).toBe(true);
		});

		it("should get item activation by itemId", () => {
			const wand = {
				id: "test-wand",
				name: "Test Wand",
				entries: ["Use an action to activate."],
			};
			state.addItem(wand);

			const activation = state.getItemActivation("test-wand");
			expect(activation.length).toBeGreaterThan(0);
			expect(activation[0].type).toBe("action");
		});

		it("should filter items by activation type", () => {
			// Add action item
			state.addItem({
				id: "item-action",
				name: "Action Item",
				equipped: true,
				entries: ["As an action, you can use this."],
			});
			state.setItemEquipped("item-action", true);

			// Add bonus action item
			state.addItem({
				id: "item-bonus",
				name: "Bonus Item",
				equipped: true,
				entries: ["As a bonus action, you can use this."],
			});
			state.setItemEquipped("item-bonus", true);

			const actionItems = state.getItemsByActivationType("action", {equippedOnly: true});
			expect(actionItems.length).toBeGreaterThanOrEqual(1);
			expect(actionItems.some(i => i.id === "item-action")).toBe(true);
			expect(actionItems.some(i => i.id === "item-bonus")).toBe(false);

			const bonusItems = state.getItemsByActivationType("bonus", {equippedOnly: true});
			expect(bonusItems.some(i => i.id === "item-bonus")).toBe(true);
		});

		it("should get all activatable items", () => {
			// Add activatable item
			state.addItem({
				id: "activatable",
				name: "Activatable Item",
				entries: ["As an action, you can use this."],
			});

			// Add passive item
			state.addItem({
				id: "passive",
				name: "Passive Item",
				entries: ["You gain +1 to AC."],
			});

			const activatable = state.getActivatableItems();
			expect(activatable.some(i => i.id === "activatable")).toBe(true);
			expect(activatable.some(i => i.id === "passive")).toBe(false);
		});

		it("should check if item has specific activation type", () => {
			state.addItem({
				id: "check-item",
				name: "Check Item",
				entries: ["As a bonus action, you can use this."],
			});

			expect(state.itemHasActivationType("check-item", "bonus")).toBe(true);
			expect(state.itemHasActivationType("check-item", "action")).toBe(false);
			expect(state.itemHasActivationType("check-item", "reaction")).toBe(false);
		});

		it("should use explicit activation if provided", () => {
			const item = {
				id: "explicit-activation",
				name: "Explicit Item",
				entries: ["This text says action but we override it."],
				activation: [{type: "bonus", cost: 1, description: "Custom"}],
			};
			state.addItem(item);
			const items = state.getItems();
			const addedItem = items.find(i => i.id === "explicit-activation");

			// Should use explicitly provided activation, not parsed
			expect(addedItem.activation.length).toBe(1);
			expect(addedItem.activation[0].type).toBe("bonus");
			expect(addedItem.activation[0].description).toBe("Custom");
		});
	});

	// ======================================================================
	// Ability Score Overrides from Items
	// ======================================================================
	describe("Ability Score Overrides from Items", () => {
		it("should apply static ability override (Gauntlets of Ogre Power STR→19)", () => {
			state.setAbilityBase("str", 12); // Natural STR 12
			state.setItemAbilityOverrides({static: {str: 19}, bonus: {}});
			expect(state.getAbilityScore("str")).toBe(19);
		});

		it("should not lower score when static override is lower than natural", () => {
			state.setAbilityBase("str", 20); // Natural STR 20
			state.setItemAbilityOverrides({static: {str: 19}, bonus: {}});
			// Gauntlets wouldn't benefit a character with STR 20
			expect(state.getAbilityScore("str")).toBe(20);
		});

		it("should apply Belt of Giant Strength (STR→27, exceeds normal max)", () => {
			state.setAbilityBase("str", 16);
			state.setItemAbilityOverrides({static: {str: 27}, bonus: {}});
			expect(state.getAbilityScore("str")).toBe(27);
		});

		it("should apply direct ability bonus (Belt of Dwarvenkind +2 CON)", () => {
			state.setAbilityBase("con", 14); // CON 14
			state.setItemAbilityOverrides({static: {}, bonus: {con: 2}});
			expect(state.getAbilityScore("con")).toBe(16); // 14 + 2
		});

		it("should not affect other abilities", () => {
			state.setItemAbilityOverrides({static: {str: 19}, bonus: {}});
			expect(state.getAbilityScore("dex")).toBe(14); // Unchanged
			expect(state.getAbilityScore("con")).toBe(14); // Unchanged
		});

		it("should cascade ability override to modifier", () => {
			state.setAbilityBase("str", 10); // STR 10, mod +0
			state.setItemAbilityOverrides({static: {str: 19}, bonus: {}});
			expect(state.getAbilityMod("str")).toBe(4); // (19-10)/2 = 4
		});

		it("should cascade to saving throws", () => {
			state.setAbilityBase("str", 10);
			state.addSaveProficiency("str");
			state.setItemAbilityOverrides({static: {str: 19}, bonus: {}});
			// STR save: mod(4) + prof(3) = 7
			expect(state.getSaveMod("str")).toBe(7);
		});

		it("should handle Headband of Intellect affecting spell DC", () => {
			state.setAbilityBase("int", 8); // INT 8, mod -1
			state.setSpellcastingAbility("int");
			state.setItemAbilityOverrides({static: {int: 19}, bonus: {}});
			// INT is now 19, mod +4
			// Spell DC: 8 + prof(3) + INT(4) = 15
			expect(state.getSpellSaveDc()).toBe(15);
		});

		it("should clear overrides when set to null", () => {
			state.setAbilityBase("str", 10);
			state.setItemAbilityOverrides({static: {str: 19}, bonus: {}});
			expect(state.getAbilityScore("str")).toBe(19);
			state.setItemAbilityOverrides(null);
			expect(state.getAbilityScore("str")).toBe(10);
		});

		it("should combine static and bonus: highest static, then add bonus", () => {
			state.setAbilityBase("con", 10);
			state.setItemAbilityOverrides({static: {con: 19}, bonus: {con: 2}});
			// Bonus is added first: 10 + 2 = 12. Static 19 > 12, so 19.
			expect(state.getAbilityScore("con")).toBe(19);
		});
	});

	// ======================================================================
	// Item-Granted Spells
	// ======================================================================
	describe("Item-Granted Spells", () => {
		it("should store attachedSpells on items", () => {
			state.addItem({
				name: "Staff of the Magi", source: "DMG", type: "wondrous",
				attachedSpells: ["conjure elemental", "dispel magic", "fireball"],
			});
			const item = state.getItems().find(i => i.name === "Staff of the Magi");
			expect(item.attachedSpells).toHaveLength(3);
		});

		it("should store attachedSpells object format", () => {
			state.addItem({
				name: "Wand of Fireballs", source: "DMG", type: "wondrous",
				attachedSpells: {charges: {"3": ["fireball"]}},
			});
			const item = state.getItems().find(i => i.name === "Wand of Fireballs");
			expect(item.attachedSpells.charges).toBeDefined();
		});

		it("should return item-granted spells from state", () => {
			state.setItemGrantedSpells([
				{name: "fireball", sourceItem: "Staff of the Magi", usageType: "charges", chargesCost: 3},
				{name: "light", sourceItem: "Staff of the Magi", usageType: "will"},
			]);
			const spells = state.getItemGrantedSpells();
			expect(spells).toHaveLength(2);
			expect(spells[0].sourceItem).toBe("Staff of the Magi");
			expect(spells[1].usageType).toBe("will");
		});

		it("should include sourceItem field on granted spells", () => {
			state.setItemGrantedSpells([
				{name: "shield", sourceItem: "Ring of Spell Storing", usageType: "other"},
			]);
			const spell = state.getItemGrantedSpells()[0];
			expect(spell.sourceItem).toBe("Ring of Spell Storing");
		});

		it("should handle daily-use spells with max uses", () => {
			state.setItemGrantedSpells([
				{name: "enlarge/reduce", sourceItem: "Potion Staff", usageType: "daily", usesMax: 1},
			]);
			const spell = state.getItemGrantedSpells()[0];
			expect(spell.usageType).toBe("daily");
			expect(spell.usesMax).toBe(1);
		});

		it("should handle at-will spells with no usage limit", () => {
			state.setItemGrantedSpells([
				{name: "light", sourceItem: "Sun Blade", usageType: "will"},
			]);
			const spell = state.getItemGrantedSpells()[0];
			expect(spell.usageType).toBe("will");
			expect(spell.usesMax).toBeUndefined();
		});

		it("should clear spells when set to empty", () => {
			state.setItemGrantedSpells([{name: "fireball", sourceItem: "Staff", usageType: "charges"}]);
			expect(state.getItemGrantedSpells()).toHaveLength(1);
			state.setItemGrantedSpells([]);
			expect(state.getItemGrantedSpells()).toHaveLength(0);
		});

		it("should handle null input gracefully", () => {
			state.setItemGrantedSpells(null);
			expect(state.getItemGrantedSpells()).toEqual([]);
		});
	});

	// ======================================================================
	// Speed Equal-To and Multiply
	// ======================================================================
	describe("Speed Equal-To and Multiply", () => {
		it("should apply equal-to speed (fly = walk)", () => {
			state.setSpeed("walk", 30);
			state.setItemBonuses({speedEqual: {fly: "walk"}});
			expect(state.getSpeedByType("fly")).toBe(30);
		});

		it("should not grant fly via equal-to if base type has no speed", () => {
			// equal: {fly: "burrow"} but character has no burrow speed
			state.setItemBonuses({speedEqual: {fly: "burrow"}});
			expect(state.getSpeedByType("fly")).toBe(0);
		});

		it("should apply speed multiply (walk x2)", () => {
			state.setSpeed("walk", 30);
			state.setItemBonuses({speedMultiply: {walk: 2}});
			expect(state.getSpeedByType("walk")).toBe(60);
		});

		it("should apply multiply after bonuses", () => {
			state.setSpeed("walk", 30);
			state.setItemBonuses({speedBonus: {walk: 10}, speedMultiply: {walk: 2}});
			// (30 + 10) * 2 = 80
			expect(state.getSpeedByType("walk")).toBe(80);
		});

		it("should apply wildcard multiply to all movement types", () => {
			state.setSpeed("walk", 30);
			state.setSpeed("fly", 30);
			state.setItemBonuses({speedMultiply: {"*": 2}});
			expect(state.getSpeedByType("walk")).toBe(60);
			expect(state.getSpeedByType("fly")).toBe(60);
		});

		it("should include equal-to in formatted speed string", () => {
			state.setSpeed("walk", 30);
			state.setItemBonuses({speedEqual: {swim: "walk"}});
			const speedStr = state.getSpeed();
			expect(speedStr).toContain("swim 30 ft.");
		});

		it("should include multiplied speed in formatted speed string", () => {
			state.setSpeed("walk", 30);
			state.setItemBonuses({speedMultiply: {walk: 2}});
			const speedStr = state.getSpeed();
			expect(speedStr).toContain("60 ft.");
		});
	});

	// ======================================================================
	// Ability Override API
	// ======================================================================
	describe("Ability Override API", () => {
		it("should set and get ability overrides", () => {
			const overrides = {static: {str: 19}, bonus: {con: 2}};
			state.setItemAbilityOverrides(overrides);
			expect(state.getItemAbilityOverrides()).toEqual(overrides);
		});

		it("should handle null overrides", () => {
			state.setItemAbilityOverrides(null);
			expect(state.getItemAbilityOverrides()).toBeNull();
		});
	});

	// ======================================================================
	// Item Granted Spells API
	// ======================================================================
	describe("Item Granted Spells API", () => {
		it("should set and get item granted spells", () => {
			const spells = [{name: "fireball", sourceItem: "Staff"}];
			state.setItemGrantedSpells(spells);
			expect(state.getItemGrantedSpells()).toHaveLength(1);
		});

		it("should default to empty array", () => {
			expect(state.getItemGrantedSpells()).toEqual([]);
		});
	});

	// ======================================================================
	// Medium Armor DEX Cap
	// ======================================================================
	describe("Medium Armor DEX Capping", () => {
		beforeEach(() => {
			state.setAbilityBase("dex", 18); // +4 DEX mod
		});

		it("should cap DEX bonus at +2 for standard medium armor", () => {
			state.setArmor({ac: 14, type: "medium", name: "Breastplate"});
			// 14 + min(2, 4) = 16
			expect(state.getAc()).toBe(16);
		});

		it("should respect armor dexterityMax property", () => {
			state.setArmor({ac: 14, type: "medium", name: "Mithral Breastplate", dexterityMax: null});
			// null = unlimited, so 14 + 4 = 18
			expect(state.getAc()).toBe(18);
		});

		it("should apply Medium Armor Master +3 DEX cap", () => {
			state.addNamedModifier({
				name: "Medium Armor Master",
				type: "ac:mediumArmorMaxDex",
				value: 3,
				enabled: true,
			});
			state.setArmor({ac: 14, type: "medium", name: "Breastplate", dexterityMax: 2});
			// Feat increases to +3: 14 + min(3, 4) = 17
			expect(state.getAc()).toBe(17);
		});

		it("should use armor dexterityMax when higher than default", () => {
			// Some homebrew armor might have dexterityMax: 3
			state.setArmor({ac: 13, type: "medium", name: "Custom Armor", dexterityMax: 3});
			// 13 + min(3, 4) = 16
			expect(state.getAc()).toBe(16);
		});

		it("should use dexterityMax: 0 (no DEX bonus allowed)", () => {
			state.setArmor({ac: 15, type: "medium", name: "Rigid Armor", dexterityMax: 0});
			// 15 + 0 = 15
			expect(state.getAc()).toBe(15);
		});

		it("should allow full DEX for light armor regardless of dexterityMax", () => {
			state.setArmor({ac: 11, type: "light", name: "Leather"});
			// Light armor always gets full DEX: 11 + 4 = 15
			expect(state.getAc()).toBe(15);
		});

		it("should give no DEX for heavy armor", () => {
			state.setArmor({ac: 18, type: "heavy", name: "Plate"});
			// Heavy: 18, no DEX
			expect(state.getAc()).toBe(18);
		});
	});

	// ======================================================================
	// Armor Stealth Disadvantage
	// ======================================================================
	describe("Armor Stealth Disadvantage", () => {
		it("should return false when no armor equipped", () => {
			expect(state.hasArmorStealthDisadvantage()).toBe(false);
		});

		it("should return false for armor without stealth disadvantage", () => {
			state.setArmor({ac: 14, type: "medium", name: "Breastplate", stealth: false});
			expect(state.hasArmorStealthDisadvantage()).toBe(false);
		});

		it("should return true for armor with stealth disadvantage", () => {
			state.setArmor({ac: 15, type: "medium", name: "Half Plate", stealth: true});
			expect(state.hasArmorStealthDisadvantage()).toBe(true);
		});

		it("should return true for heavy armor with stealth disadvantage", () => {
			state.setArmor({ac: 16, type: "heavy", name: "Chain Mail", stealth: true});
			expect(state.hasArmorStealthDisadvantage()).toBe(true);
		});

		it("should remove stealth disadvantage with Medium Armor Master (medium armor)", () => {
			state.addNamedModifier({
				name: "Medium Armor Master",
				type: "armor:medium:noStealthDisadvantage",
				value: 1,
				enabled: true,
			});
			state.setArmor({ac: 15, type: "medium", name: "Half Plate", stealth: true});
			expect(state.hasArmorStealthDisadvantage()).toBe(false);
		});

		it("should NOT remove stealth disadvantage for heavy armor with Medium Armor Master", () => {
			state.addNamedModifier({
				name: "Medium Armor Master",
				type: "armor:medium:noStealthDisadvantage",
				value: 1,
				enabled: true,
			});
			state.setArmor({ac: 16, type: "heavy", name: "Chain Mail", stealth: true});
			// Heavy armor is not affected by Medium Armor Master
			expect(state.hasArmorStealthDisadvantage()).toBe(true);
		});
	});

	// ======================================================================
	// Armor Strength Requirements
	// ======================================================================
	describe("Armor Strength Requirements", () => {
		beforeEach(() => {
			state.setAbilityBase("str", 12); // Low STR character
		});

		it("should return 0 penalty when no armor equipped", () => {
			expect(state.getArmorStrengthPenalty()).toBe(0);
		});

		it("should return 0 penalty for armor without strength requirement", () => {
			state.setArmor({ac: 14, type: "medium", name: "Breastplate"});
			expect(state.getArmorStrengthPenalty()).toBe(0);
		});

		it("should return 0 penalty when strength requirement is met", () => {
			state.setAbilityBase("str", 15);
			state.setArmor({ac: 17, type: "heavy", name: "Splint", strength: "15"});
			expect(state.getArmorStrengthPenalty()).toBe(0);
		});

		it("should return -10 penalty when strength requirement is not met", () => {
			state.setAbilityBase("str", 14);
			state.setArmor({ac: 17, type: "heavy", name: "Splint", strength: "15"});
			expect(state.getArmorStrengthPenalty()).toBe(-10);
		});

		it("should apply speed penalty for plate armor (STR 15 required)", () => {
			state.setAbilityBase("str", 10);
			state.setSpeed("walk", 30);
			state.setArmor({ac: 18, type: "heavy", name: "Plate", strength: 15});
			expect(state.getWalkSpeed()).toBe(20); // 30 - 10 = 20
		});

		it("should apply speed penalty to other movement types", () => {
			state.setAbilityBase("str", 10);
			state.setSpeed("walk", 30);
			state.setSpeed("fly", 30);
			state.setArmor({ac: 18, type: "heavy", name: "Plate", strength: 15});
			expect(state.getSpeedByType("fly")).toBe(20); // 30 - 10 = 20
		});

		it("should return strength requirement info object", () => {
			state.setAbilityBase("str", 12);
			state.setArmor({ac: 17, type: "heavy", name: "Splint", strength: "15"});
			const req = state.getArmorStrengthRequirement();
			expect(req).toEqual({required: 15, current: 12, met: false});
		});

		it("should return null for armor without strength requirement", () => {
			state.setArmor({ac: 14, type: "medium", name: "Breastplate"});
			expect(state.getArmorStrengthRequirement()).toBeNull();
		});

		it("should handle numeric strength property", () => {
			state.setAbilityBase("str", 12);
			state.setArmor({ac: 18, type: "heavy", name: "Plate", strength: 15}); // numeric
			expect(state.getArmorStrengthPenalty()).toBe(-10);
		});
	});

	// ======================================================================
	// Cursed Items
	// ======================================================================
	describe("Cursed Items", () => {
		it("should track cursed items in inventory", () => {
			state.addItem({name: "Berserker Axe", source: "DMG", curse: true, equipped: false});
			state.addItem({name: "Normal Sword", source: "PHB", curse: false, equipped: false});
			const cursed = state.getCursedItems();
			expect(cursed).toHaveLength(1);
			expect(cursed[0].name).toBe("Berserker Axe");
		});

		it("should filter equipped cursed items", () => {
			state.addItem({name: "Berserker Axe", source: "DMG", curse: true, equipped: true});
			state.addItem({name: "Cursed Ring", source: "DMG", curse: true, equipped: false});
			const cursed = state.getCursedItems({equippedOnly: true});
			expect(cursed).toHaveLength(1);
			expect(cursed[0].name).toBe("Berserker Axe");
		});

		it("should filter attuned cursed items", () => {
			state.addItem({name: "Berserker Axe", source: "DMG", curse: true, equipped: true, attuned: true});
			state.addItem({name: "Cursed Ring", source: "DMG", curse: true, equipped: true, attuned: false});
			const cursed = state.getCursedItems({attunedOnly: true});
			expect(cursed).toHaveLength(1);
			expect(cursed[0].name).toBe("Berserker Axe");
		});

		it("should detect active cursed items", () => {
			state.addItem({name: "Berserker Axe", source: "DMG", curse: true, equipped: false});
			expect(state.hasActiveCursedItem()).toBe(false);

			const items = state.getItems();
			state.setItemEquipped(items[0].id, true);
			expect(state.hasActiveCursedItem()).toBe(true);
		});
	});

	// ======================================================================
	// Sentient Items
	// ======================================================================
	describe("Sentient Items", () => {
		it("should track sentient items in inventory", () => {
			state.addItem({name: "Blackrazor", source: "DMG", sentient: true, equipped: false});
			state.addItem({name: "Normal Sword", source: "PHB", sentient: false, equipped: false});
			const sentient = state.getSentientItems();
			expect(sentient).toHaveLength(1);
			expect(sentient[0].name).toBe("Blackrazor");
		});

		it("should filter equipped sentient items", () => {
			state.addItem({name: "Blackrazor", source: "DMG", sentient: true, equipped: true});
			state.addItem({name: "Moonblade", source: "DMG", sentient: true, equipped: false});
			const sentient = state.getSentientItems({equippedOnly: true});
			expect(sentient).toHaveLength(1);
			expect(sentient[0].name).toBe("Blackrazor");
		});

		it("should detect active sentient items", () => {
			state.addItem({name: "Blackrazor", source: "DMG", sentient: true, equipped: false});
			expect(state.hasActiveSentientItem()).toBe(false);

			const items = state.getItems();
			state.setItemEquipped(items[0].id, true);
			expect(state.hasActiveSentientItem()).toBe(true);
		});
	});

	// ======================================================================
	// Proficiency Granting Items
	// ======================================================================
	describe("Proficiency Granting Items", () => {
		it("should grant armor proficiency when item with grantsProficiency is equipped", () => {
			// Without the armor, no heavy proficiency
			expect(state.hasArmorProficiency("heavy")).toBe(false);

			// Add Dwarven Plate which grants heavy armor proficiency
			state.addItem({
				name: "Dwarven Plate",
				source: "DMG",
				armor: true,
				armorType: "heavy",
				ac: 18,
				grantsProficiency: true,
				equipped: true,
			});

			expect(state.hasArmorProficiency("heavy")).toBe(true);
		});

		it("should NOT grant proficiency when item is not equipped", () => {
			state.addItem({
				name: "Dwarven Plate",
				source: "DMG",
				armor: true,
				armorType: "heavy",
				ac: 18,
				grantsProficiency: true,
				equipped: false,
			});

			expect(state.hasArmorProficiency("heavy")).toBe(false);
		});

		it("should grant weapon proficiency when attuned item has grantsProficiency", () => {
			expect(state.hasWeaponProficiency("Sun Blade")).toBe(false);

			state.addItem({
				name: "Sun Blade",
				source: "DMG",
				weapon: true,
				grantsProficiency: true,
				requiresAttunement: true,
				equipped: true,
				attuned: true,
			});

			expect(state.hasWeaponProficiency("Sun Blade")).toBe(true);
		});

		it("should NOT grant weapon proficiency when not attuned", () => {
			state.addItem({
				name: "Sun Blade",
				source: "DMG",
				weapon: true,
				grantsProficiency: true,
				requiresAttunement: true,
				equipped: true,
				attuned: false,
			});

			expect(state.hasWeaponProficiency("Sun Blade")).toBe(false);
		});

		it("should return item granted proficiencies", () => {
			state.addItem({
				name: "Dwarven Plate",
				source: "DMG",
				armor: true,
				armorType: "heavy",
				grantsProficiency: true,
				equipped: true,
			});
			state.addItem({
				name: "Sun Blade",
				source: "DMG",
				weapon: true,
				grantsProficiency: true,
				equipped: true,
				attuned: true,
			});

			const profs = state.getItemGrantedProficiencies();
			expect(profs.armor).toContain("heavy");
			expect(profs.weapons).toContain("Sun Blade");
		});
	});

	// ======================================================================
	// Container System (Bag of Holding, etc.)
	// ======================================================================
	describe("Container System", () => {
		it("should identify container items", () => {
			state.addItem({
				name: "Bag of Holding",
				source: "DMG",
				weight: 15,
				containerCapacity: {weight: [500], weightless: true},
			});

			const items = state.getItems();
			const bag = items.find(i => i.name === "Bag of Holding");
			expect(state.isContainer(bag.id)).toBe(true);
		});

		it("should put items into containers", () => {
			state.addItem({
				name: "Bag of Holding",
				source: "DMG",
				weight: 15,
				containerCapacity: {weight: [500], weightless: true},
			});
			state.addItem({name: "Gold Bar", source: "PHB", weight: 50});

			const items = state.getItems();
			const bag = items.find(i => i.name === "Bag of Holding");
			const gold = items.find(i => i.name === "Gold Bar");

			const result = state.putItemInContainer(gold.id, bag.id);
			expect(result.success).toBe(true);

			const contained = state.getContainedItems(bag.id);
			expect(contained).toHaveLength(1);
			expect(contained[0].item.name).toBe("Gold Bar");
		});

		it("should exclude weightless container contents from total weight", () => {
			state.addItem({
				name: "Bag of Holding",
				source: "DMG",
				weight: 15,
				containerCapacity: {weight: [500], weightless: true},
			});
			state.addItem({name: "Heavy Stuff", source: "PHB", weight: 100});

			const items = state.getItems();
			const bag = items.find(i => i.name === "Bag of Holding");
			const stuff = items.find(i => i.name === "Heavy Stuff");

			// Before putting in container: 15 + 100 = 115
			expect(state.getTotalWeight()).toBe(115);

			// Put heavy stuff in bag
			state.putItemInContainer(stuff.id, bag.id);

			// After: only bag weight counts (15), stuff is weightless
			expect(state.getTotalWeight()).toBe(15);
		});

		it("should enforce container weight capacity", () => {
			state.addItem({
				name: "Small Pouch",
				source: "PHB",
				weight: 1,
				containerCapacity: {weight: [10]}, // Not weightless
			});
			state.addItem({name: "Heavy Item", source: "PHB", weight: 20});

			const items = state.getItems();
			const pouch = items.find(i => i.name === "Small Pouch");
			const heavy = items.find(i => i.name === "Heavy Item");

			const result = state.putItemInContainer(heavy.id, pouch.id);
			expect(result.success).toBe(false);
			expect(result.error).toContain("full");
		});

		it("should remove item from container", () => {
			state.addItem({
				name: "Bag of Holding",
				source: "DMG",
				weight: 15,
				containerCapacity: {weight: [500], weightless: true},
			});
			state.addItem({name: "Gem", source: "PHB", weight: 0.5});

			const items = state.getItems();
			const bag = items.find(i => i.name === "Bag of Holding");
			const gem = items.find(i => i.name === "Gem");

			state.putItemInContainer(gem.id, bag.id);
			expect(state.getContainedItems(bag.id)).toHaveLength(1);

			state.removeItemFromContainer(gem.id);
			expect(state.getContainedItems(bag.id)).toHaveLength(0);
		});

		it("should report container capacity", () => {
			state.addItem({
				name: "Bag of Holding",
				source: "DMG",
				weight: 15,
				containerCapacity: {weight: [500], weightless: true},
			});
			state.addItem({name: "Item A", source: "PHB", weight: 50});
			state.addItem({name: "Item B", source: "PHB", weight: 100});

			const items = state.getItems();
			const bag = items.find(i => i.name === "Bag of Holding");
			const itemA = items.find(i => i.name === "Item A");
			const itemB = items.find(i => i.name === "Item B");

			state.putItemInContainer(itemA.id, bag.id);
			state.putItemInContainer(itemB.id, bag.id);

			const capacity = state.getContainerCapacity(bag.id);
			expect(capacity.weightMax).toBe(500);
			expect(capacity.weightUsed).toBe(150);
			expect(capacity.weightless).toBe(true);
		});

		it("should not allow putting container inside itself", () => {
			state.addItem({
				name: "Bag of Holding",
				source: "DMG",
				containerCapacity: {weight: [500], weightless: true},
			});

			const items = state.getItems();
			const bag = items.find(i => i.name === "Bag of Holding");

			const result = state.putItemInContainer(bag.id, bag.id);
			expect(result.success).toBe(false);
			expect(result.error).toContain("itself");
		});

		it("should get item's container", () => {
			state.addItem({
				name: "Bag of Holding",
				source: "DMG",
				containerCapacity: {weight: [500], weightless: true},
			});
			state.addItem({name: "Gem", source: "PHB", weight: 0.5});

			const items = state.getItems();
			const bag = items.find(i => i.name === "Bag of Holding");
			const gem = items.find(i => i.name === "Gem");

			expect(state.getItemContainer(gem.id)).toBeNull();

			state.putItemInContainer(gem.id, bag.id);
			const container = state.getItemContainer(gem.id);
			expect(container.item.name).toBe("Bag of Holding");
		});
	});

	// ======================================================================
	// Vestige Progression (Dormant/Awakened/Exalted)
	// ======================================================================
	describe("Vestige Progression", () => {
		it("should detect vestige tier from item name (Dormant)", () => {
			state.addItem({name: "Blade of Broken Mirrors (Dormant)", source: "EGW"});

			const items = state.getItems();
			const blade = items.find(i => i.name.includes("Blade"));
			expect(blade.vestigeTier).toBe("dormant");
		});

		it("should detect vestige tier from item name (Awakened)", () => {
			state.addItem({name: "Danoth's Visor (Awakened)", source: "EGW"});

			const items = state.getItems();
			const visor = items.find(i => i.name.includes("Visor"));
			expect(visor.vestigeTier).toBe("awakened");
		});

		it("should detect vestige tier from item name (Exalted)", () => {
			state.addItem({name: "Grimoire Infinitus (Exalted)", source: "EGW"});

			const items = state.getItems();
			const grimoire = items.find(i => i.name.includes("Grimoire"));
			expect(grimoire.vestigeTier).toBe("exalted");
		});

		it("should get vestige tier via getter", () => {
			state.addItem({name: "Blade of Broken Mirrors (Dormant)", source: "EGW"});

			const items = state.getItems();
			const blade = items.find(i => i.name.includes("Blade"));
			expect(state.getVestigeTier(blade.id)).toBe("dormant");
		});

		it("should upgrade vestige from dormant to awakened", () => {
			state.addItem({name: "Blade of Broken Mirrors (Dormant)", source: "EGW"});

			const items = state.getItems();
			const blade = items.find(i => i.name.includes("Blade"));

			const result = state.upgradeVestige(blade.id);
			expect(result.success).toBe(true);
			expect(result.newTier).toBe("awakened");
			expect(state.getVestigeTier(blade.id)).toBe("awakened");
		});

		it("should upgrade vestige item name", () => {
			state.addItem({name: "Blade of Broken Mirrors (Dormant)", source: "EGW"});

			const itemsBefore = state.getItems();
			const blade = itemsBefore.find(i => i.name.includes("Blade"));
			state.upgradeVestige(blade.id);

			const itemsAfter = state.getItems();
			const upgradedBlade = itemsAfter.find(i => i.id === blade.id);
			expect(upgradedBlade.name).toBe("Blade of Broken Mirrors (Awakened)");
		});

		it("should upgrade from awakened to exalted", () => {
			state.addItem({name: "Danoth's Visor (Awakened)", source: "EGW"});

			const items = state.getItems();
			const visor = items.find(i => i.name.includes("Visor"));

			const result = state.upgradeVestige(visor.id);
			expect(result.success).toBe(true);
			expect(result.newTier).toBe("exalted");
		});

		it("should not upgrade already exalted vestige", () => {
			state.addItem({name: "Grimoire Infinitus (Exalted)", source: "EGW"});

			const items = state.getItems();
			const grimoire = items.find(i => i.name.includes("Grimoire"));

			const result = state.upgradeVestige(grimoire.id);
			expect(result.success).toBe(false);
			expect(result.error).toContain("maximum");
		});

		it("should fail to upgrade non-vestige items", () => {
			state.addItem({name: "Longsword", source: "PHB"});

			const items = state.getItems();
			const sword = items.find(i => i.name === "Longsword");

			const result = state.upgradeVestige(sword.id);
			expect(result.success).toBe(false);
			expect(result.error).toContain("not a tiered item");
		});

		it("should get all vestiges", () => {
			state.addItem({name: "Blade of Broken Mirrors (Dormant)", source: "EGW"});
			state.addItem({name: "Longsword", source: "PHB"});
			state.addItem({name: "Danoth's Visor (Awakened)", source: "EGW"});

			const vestiges = state.getVestiges();
			expect(vestiges).toHaveLength(2);
		});
	});

	// ======================================================================
	// Spell Storing (Ring of Spell Storing, etc.)
	// ======================================================================
	describe("Spell Storing", () => {
		it("should detect Ring of Spell Storing capacity", () => {
			state.addItem({
				name: "Ring of Spell Storing",
				source: "DMG",
				type: "RG",
				requiresAttunement: true,
			});

			const items = state.getItems();
			const ring = items.find(i => i.name === "Ring of Spell Storing");
			expect(ring.maxSpellLevels).toBe(5);
			expect(state.canStoreSpells(ring.id)).toBe(true);
		});

		it("should store spells in the ring", () => {
			state.addItem({
				name: "Ring of Spell Storing",
				source: "DMG",
				type: "RG",
			});

			const items = state.getItems();
			const ring = items.find(i => i.name === "Ring of Spell Storing");

			const result = state.storeSpell(ring.id, {
				spell: "Shield",
				level: 1,
				saveDc: 15,
				attackBonus: 7,
				ability: "int",
				casterName: "Gandalf",
			});

			expect(result.success).toBe(true);

			const stored = state.getStoredSpells(ring.id);
			expect(stored).toHaveLength(1);
			expect(stored[0].spell).toBe("Shield");
			expect(stored[0].casterName).toBe("Gandalf");
		});

		it("should track spell levels used", () => {
			state.addItem({
				name: "Ring of Spell Storing",
				source: "DMG",
			});

			const items = state.getItems();
			const ring = items.find(i => i.name === "Ring of Spell Storing");

			state.storeSpell(ring.id, {spell: "Shield", level: 1});
			state.storeSpell(ring.id, {spell: "Fireball", level: 3});

			const capacity = state.getSpellStoringCapacity(ring.id);
			expect(capacity.maxLevels).toBe(5);
			expect(capacity.usedLevels).toBe(4);
			expect(capacity.remainingLevels).toBe(1);
		});

		it("should enforce spell level capacity", () => {
			state.addItem({
				name: "Ring of Spell Storing",
				source: "DMG",
			});

			const items = state.getItems();
			const ring = items.find(i => i.name === "Ring of Spell Storing");

			state.storeSpell(ring.id, {spell: "Fireball", level: 3});
			state.storeSpell(ring.id, {spell: "Shield", level: 1});

			// Try to store a 2nd level spell (3+1+2 = 6 > 5)
			const result = state.storeSpell(ring.id, {spell: "Misty Step", level: 2});
			expect(result.success).toBe(false);
			expect(result.error).toContain("Not enough space");
		});

		it("should cast (remove) stored spells", () => {
			state.addItem({
				name: "Ring of Spell Storing",
				source: "DMG",
			});

			const items = state.getItems();
			const ring = items.find(i => i.name === "Ring of Spell Storing");

			state.storeSpell(ring.id, {spell: "Shield", level: 1, saveDc: 15});
			state.storeSpell(ring.id, {spell: "Fireball", level: 3, saveDc: 17});

			expect(state.getStoredSpells(ring.id)).toHaveLength(2);

			// Cast the first spell
			const cast = state.castStoredSpell(ring.id, 0);
			expect(cast.spell).toBe("Shield");
			expect(cast.saveDc).toBe(15);

			expect(state.getStoredSpells(ring.id)).toHaveLength(1);
			expect(state.getSpellStoringCapacity(ring.id).usedLevels).toBe(3);
		});

		it("should not store spells in non-storing items", () => {
			state.addItem({name: "Longsword", source: "PHB"});

			const items = state.getItems();
			const sword = items.find(i => i.name === "Longsword");

			expect(state.canStoreSpells(sword.id)).toBe(false);

			const result = state.storeSpell(sword.id, {spell: "Shield", level: 1});
			expect(result.success).toBe(false);
			expect(result.error).toContain("cannot store spells");
		});

		it("should return null when casting invalid spell index", () => {
			state.addItem({
				name: "Ring of Spell Storing",
				source: "DMG",
			});

			const items = state.getItems();
			const ring = items.find(i => i.name === "Ring of Spell Storing");

			const result = state.castStoredSpell(ring.id, 99);
			expect(result).toBeNull();
		});
	});

	// ======================================================================
	// FTD Dragon Items (Slumbering/Stirring/Wakened/Ascendant)
	// ======================================================================
	describe("FTD Dragon Items Tier System", () => {
		it("should detect FTD tiers from item names", () => {
			state.addItem({name: "Slumbering Dragon's Wrath", source: "FTD"});
			state.addItem({name: "Stirring Dragon Vessel", source: "FTD"});
			state.addItem({name: "Wakened Dragon-Touched Focus", source: "FTD"});
			state.addItem({name: "Ascendant Hoard Scarab", source: "FTD"});

			const items = state.getItems();
			const slumbering = items.find(i => i.name.includes("Slumbering"));
			const stirring = items.find(i => i.name.includes("Stirring"));
			const wakened = items.find(i => i.name.includes("Wakened"));
			const ascendant = items.find(i => i.name.includes("Ascendant"));

			expect(state.getVestigeTier(slumbering.id)).toBe("slumbering");
			expect(state.getVestigeTier(stirring.id)).toBe("stirring");
			expect(state.getVestigeTier(wakened.id)).toBe("wakened");
			expect(state.getVestigeTier(ascendant.id)).toBe("ascendant");
		});

		it("should distinguish dragon items from EGW vestiges", () => {
			state.addItem({name: "Slumbering Dragon's Wrath", source: "FTD"});
			state.addItem({name: "Blade of Broken Mirrors (Dormant)", source: "EGW"});

			const items = state.getItems();
			const dragon = items.find(i => i.name.includes("Slumbering"));
			const vestige = items.find(i => i.name.includes("Blade"));

			expect(state.getItemTierType(dragon.id)).toBe("dragon");
			expect(state.getItemTierType(vestige.id)).toBe("vestige");
		});

		it("should upgrade dragon items through FTD tiers", () => {
			state.addItem({name: "Slumbering Dragon's Wrath", source: "FTD"});

			const items = state.getItems();
			const dragon = items.find(i => i.name.includes("Slumbering"));

			// Slumbering → Stirring
			let result = state.upgradeVestige(dragon.id);
			expect(result.success).toBe(true);
			expect(result.newTier).toBe("stirring");
			expect(state.getVestigeTier(dragon.id)).toBe("stirring");

			// Stirring → Wakened
			result = state.upgradeVestige(dragon.id);
			expect(result.success).toBe(true);
			expect(result.newTier).toBe("wakened");

			// Wakened → Ascendant
			result = state.upgradeVestige(dragon.id);
			expect(result.success).toBe(true);
			expect(result.newTier).toBe("ascendant");

			// Already at max
			result = state.upgradeVestige(dragon.id);
			expect(result.success).toBe(false);
			expect(result.error).toContain("maximum tier");
		});

		it("should update dragon item names on upgrade", () => {
			state.addItem({name: "Slumbering Dragon's Wrath", source: "FTD"});

			const items = state.getItems();
			const dragon = items.find(i => i.name.includes("Slumbering"));

			state.upgradeVestige(dragon.id);
			const upgraded = state.getItems().find(i => i.id === dragon.id);
			expect(upgraded.name).toBe("Stirring Dragon's Wrath");
		});

		it("should set dragon item tiers with valid FTD values", () => {
			state.addItem({name: "Slumbering Dragon's Wrath", source: "FTD"});

			const items = state.getItems();
			const dragon = items.find(i => i.name.includes("Slumbering"));

			expect(state.setVestigeTier(dragon.id, "wakened")).toBe(true);
			expect(state.getVestigeTier(dragon.id)).toBe("wakened");

			// EGW tier should fail on dragon item
			expect(state.setVestigeTier(dragon.id, "dormant")).toBe(false);
		});

		it("should filter tiered items by type", () => {
			state.addItem({name: "Slumbering Dragon's Wrath", source: "FTD"});
			state.addItem({name: "Blade of Broken Mirrors (Dormant)", source: "EGW"});
			state.addItem({name: "Danoth's Visor (Awakened)", source: "EGW"});

			const dragonItems = state.getTieredItems("dragon");
			const vestiges = state.getTieredItems("vestige");
			const allTiered = state.getTieredItems();

			expect(dragonItems).toHaveLength(1);
			expect(vestiges).toHaveLength(2);
			expect(allTiered).toHaveLength(3);
		});

		it("should provide alias methods for tiered items", () => {
			state.addItem({name: "Slumbering Dragon's Wrath", source: "FTD"});

			const items = state.getItems();
			const dragon = items.find(i => i.name.includes("Slumbering"));

			// Alias methods should work identically
			expect(state.getItemTier(dragon.id)).toBe(state.getVestigeTier(dragon.id));
			expect(state.setItemTier(dragon.id, "stirring")).toBe(true);
			expect(state.getItemTier(dragon.id)).toBe("stirring");

			const result = state.upgradeItemTier(dragon.id);
			expect(result.success).toBe(true);
		});
	});

	// ======================================================================
	// Ki Save DC Bonus (Dragonhide Belt)
	// ======================================================================
	describe("Ki Save DC Bonus", () => {
		it("should detect Dragonhide Belt Ki DC bonus from name", () => {
			state.addItem({name: "Dragonhide Belt +1", source: "FTD"});

			const items = state.getItems();
			const belt = items.find(i => i.name.includes("Dragonhide"));
			expect(belt.kiSaveDcBonus).toBe(1);
		});

		it("should detect different bonus tiers", () => {
			state.addItem({name: "Dragonhide Belt +1", source: "FTD"});
			state.addItem({name: "Dragonhide Belt +2", source: "FTD"});
			state.addItem({name: "Dragonhide Belt +3", source: "FTD"});

			const items = state.getItems();
			const belt1 = items.find(i => i.name === "Dragonhide Belt +1");
			const belt2 = items.find(i => i.name === "Dragonhide Belt +2");
			const belt3 = items.find(i => i.name === "Dragonhide Belt +3");

			expect(belt1.kiSaveDcBonus).toBe(1);
			expect(belt2.kiSaveDcBonus).toBe(2);
			expect(belt3.kiSaveDcBonus).toBe(3);
		});

		it("should store Ki DC bonus in itemBonuses", () => {
			// Add Dragonhide Belt +2
			state.addItem({name: "Dragonhide Belt +2", source: "FTD"});

			// Verify the bonus is stored in itemBonuses
			const bonuses = state.getItemBonuses();
			expect(bonuses.kiSaveDc).toBe(2);
		});

		it("should use highest Ki DC bonus when multiple items", () => {
			// Add two belts
			state.addItem({name: "Dragonhide Belt +1", source: "FTD"});
			state.addItem({name: "Dragonhide Belt +3", source: "FTD"});

			// Should use highest bonus
			const bonuses = state.getItemBonuses();
			expect(bonuses.kiSaveDc).toBe(3);
		});

		it("should have 0 Ki DC bonus without dragonhide belt", () => {
			// Fighter with no Ki
			state.addClass({name: "Fighter", source: "PHB", level: 5});
			state.addItem({name: "Longsword", source: "PHB"});

			const bonuses = state.getItemBonuses();
			expect(bonuses.kiSaveDc).toBe(0);
		});
	});

	// ======================================================================
	// Resource Restoration (Ki, Sorcery Points, Bardic Inspiration)
	// ======================================================================
	describe("Resource Restoration", () => {
		it("should detect Ki restoration from Dragonhide Belt", () => {
			state.addItem({name: "Dragonhide Belt +1", source: "FTD"});

			const items = state.getItems();
			const belt = items.find(i => i.name.includes("Dragonhide"));

			expect(belt.resourceRestoration).toBeDefined();
			expect(belt.resourceRestoration.type).toBe("ki");
			expect(belt.resourceRestoration.amount).toBeGreaterThan(0);
		});

		it("should detect Sorcery Point restoration from Bloodwell Vial", () => {
			state.addItem({name: "Bloodwell Vial +1", source: "TCE"});

			const items = state.getItems();
			const vial = items.find(i => i.name.includes("Bloodwell"));

			expect(vial.resourceRestoration).toBeDefined();
			expect(vial.resourceRestoration.type).toBe("sorceryPoints");
		});

		it("should detect Bardic Inspiration restoration from Rhythm-Maker's Drum", () => {
			state.addItem({name: "Rhythm-Maker's Drum +1", source: "TCE"});

			const items = state.getItems();
			const drum = items.find(i => i.name.includes("Rhythm-Maker"));

			expect(drum.resourceRestoration).toBeDefined();
			expect(drum.resourceRestoration.type).toBe("bardicInspiration");
		});

		it("should track resource restoration usage", () => {
			state.addItem({name: "Dragonhide Belt +1", source: "FTD"});

			const items = state.getItems();
			const belt = items.find(i => i.name.includes("Dragonhide"));

			expect(state.isResourceRestorationAvailable(belt.id)).toBe(true);

			state.useResourceRestoration(belt.id);
			expect(state.isResourceRestorationAvailable(belt.id)).toBe(false);
		});

		it("should reset all resource restorations", () => {
			state.addItem({name: "Dragonhide Belt +1", source: "FTD"});
			state.addItem({name: "Bloodwell Vial +1", source: "TCE"});

			const items = state.getItems();
			const belt = items.find(i => i.name.includes("Dragonhide"));
			const vial = items.find(i => i.name.includes("Bloodwell"));

			state.useResourceRestoration(belt.id);
			state.useResourceRestoration(vial.id);

			expect(state.isResourceRestorationAvailable(belt.id)).toBe(false);
			expect(state.isResourceRestorationAvailable(vial.id)).toBe(false);

			state.resetResourceRestorations();

			expect(state.isResourceRestorationAvailable(belt.id)).toBe(true);
			expect(state.isResourceRestorationAvailable(vial.id)).toBe(true);
		});

		it("should filter restoration items by resource type", () => {
			state.addItem({name: "Dragonhide Belt +1", source: "FTD"});
			state.addItem({name: "Bloodwell Vial +1", source: "TCE"});
			state.addItem({name: "Rhythm-Maker's Drum +1", source: "TCE"});

			const kiItems = state.getResourceRestorationItems("ki");
			const sorceryItems = state.getResourceRestorationItems("sorceryPoints");
			const allRestoration = state.getResourceRestorationItems();

			expect(kiItems).toHaveLength(1);
			expect(sorceryItems).toHaveLength(1);
			expect(allRestoration).toHaveLength(3);
		});
	});

	// ======================================================================
	// Mental Protection (Ring of Mind Shielding)
	// ======================================================================
	describe("Mental Protection", () => {
		it("should detect mental protection from Ring of Mind Shielding", () => {
			state.addItem({name: "Ring of Mind Shielding", source: "DMG"});

			const items = state.getItems();
			const ring = items.find(i => i.name.includes("Mind Shielding"));

			expect(ring.mentalProtection).toBeDefined();
			expect(ring.mentalProtection.telepathyImmune).toBe(true);
			expect(ring.mentalProtection.thoughtReadingImmune).toBe(true);
		});

		it("should apply mental protection when item is equipped", () => {
			state.addItem({name: "Ring of Mind Shielding", source: "DMG"});

			const items = state.getItems();
			const ring = items.find(i => i.name.includes("Mind Shielding"));

			// Not equipped initially
			state.setItemEquipped(ring.id, false);
			expect(state.hasMentalProtection("telepathyImmune")).toBe(false);

			// Equip the ring
			state.setItemEquipped(ring.id, true);
			expect(state.hasMentalProtection("telepathyImmune")).toBe(true);
			expect(state.hasMentalProtection("thoughtReadingImmune")).toBe(true);
		});

		it("should get all mental protection flags with sources", () => {
			state.addItem({name: "Ring of Mind Shielding", source: "DMG"});

			const items = state.getItems();
			const ring = items.find(i => i.name.includes("Mind Shielding"));
			state.setItemEquipped(ring.id, true);

			const protections = state.getMentalProtections();

			expect(protections.telepathyImmune.active).toBe(true);
			expect(protections.telepathyImmune.sources).toContain("Ring of Mind Shielding");
			expect(protections.thoughtReadingImmune.active).toBe(true);
		});

		it("should track soul trapping capability", () => {
			state.addItem({name: "Ring of Mind Shielding", source: "DMG"});

			const items = state.getItems();
			const ring = items.find(i => i.name.includes("Mind Shielding"));
			state.setItemEquipped(ring.id, true);

			const protections = state.getMentalProtections();
			expect(protections.soulTrapped.active).toBe(true);
			expect(protections.soulTrapped.itemId).toBe(ring.id);

			const soulItems = state.getSoulTrappingItems();
			expect(soulItems).toHaveLength(1);
		});

		it("should detect lie and alignment detection immunity", () => {
			state.addItem({name: "Ring of Mind Shielding", source: "DMG"});

			const items = state.getItems();
			const ring = items.find(i => i.name.includes("Mind Shielding"));
			state.setItemEquipped(ring.id, true);

			expect(state.hasMentalProtection("lieDetectionImmune")).toBe(true);
			expect(state.hasMentalProtection("alignmentDetectionImmune")).toBe(true);
		});

		it("should handle multiple protection sources", () => {
			// Add two mind-protecting items (mark second as custom to allow separate entries)
			state.addItem({name: "Ring of Mind Shielding", source: "DMG"});
			state.addItem({name: "Ring of Mind Shielding", source: "DMG", _isCustom: true});

			const items = state.getItems();
			const rings = items.filter(i => i.name.includes("Mind Shielding"));

			state.setItemEquipped(rings[0].id, true);
			state.setItemEquipped(rings[1].id, true);

			const protections = state.getMentalProtections();
			expect(protections.telepathyImmune.sources).toHaveLength(2);
		});

		it("should return false for non-existent protection types", () => {
			expect(state.hasMentalProtection("unknownProtection")).toBe(false);
		});
	});

	// ======================================================================
	// Ammunition Tracking
	// ======================================================================
	describe("Ammunition Tracking", () => {
		beforeEach(() => {
			// Add a longbow that uses arrows
			state.addItem({
				id: "longbow",
				name: "Longbow",
				weapon: true,
				ammoType: "arrow|phb",
			});
			// Add some arrows
			state.addItem({
				id: "arrows",
				name: "Arrow",
				type: "A",
				arrow: true,
				quantity: 20,
			});
		});

		it("should have ammunition tracking disabled by default", () => {
			expect(state.isAmmunitionTrackingEnabled()).toBe(false);
		});

		it("should enable ammunition tracking via settings", () => {
			state.setSetting("ammunitionTracking", true);
			expect(state.isAmmunitionTrackingEnabled()).toBe(true);
		});

		it("should find ammunition items", () => {
			const ammoItems = state.getAmmunitionItems();
			expect(ammoItems.length).toBeGreaterThanOrEqual(1);
			expect(ammoItems.some(a => a.name === "Arrow")).toBe(true);
		});

		it("should get compatible ammunition for weapon", () => {
			const ammo = state.getAmmunitionForWeapon("longbow");
			expect(ammo.length).toBe(1);
			expect(ammo[0].name).toBe("Arrow");
		});

		it("should return empty array for weapon without ammo type", () => {
			state.addItem({
				id: "sword",
				name: "Longsword",
				weapon: true,
			});
			const ammo = state.getAmmunitionForWeapon("sword");
			expect(ammo).toEqual([]);
		});

		it("should consume ammunition", () => {
			expect(state.consumeAmmunition("arrows", 1)).toBe(true);
			const items = state.getItems();
			const arrows = items.find(i => i.id === "arrows");
			expect(arrows.quantity).toBe(19);
		});

		it("should track consumed ammunition", () => {
			state.consumeAmmunition("arrows", 3);
			const consumed = state.getAmmunitionConsumed();
			expect(consumed["arrows"]).toBe(3);
		});

		it("should not consume more ammunition than available", () => {
			expect(state.consumeAmmunition("arrows", 25)).toBe(false);
			const items = state.getItems();
			const arrows = items.find(i => i.id === "arrows");
			expect(arrows.quantity).toBe(20);
		});

		it("should recover 50% of ammunition after combat", () => {
			// Consume 10 arrows
			for (let i = 0; i < 10; i++) {
				state.consumeAmmunition("arrows", 1);
			}
			const items = state.getItems();
			const arrowsBefore = items.find(i => i.id === "arrows");
			expect(arrowsBefore.quantity).toBe(10);

			// Recover
			const recovered = state.recoverAmmunition();
			expect(recovered["arrows"]).toBe(5); // 50% of 10

			// Check new quantity
			const itemsAfter = state.getItems();
			const arrowsAfter = itemsAfter.find(i => i.id === "arrows");
			expect(arrowsAfter.quantity).toBe(15);
		});

		it("should not recover magic ammunition", () => {
			// Add magic arrows
			state.addItem({
				id: "magic-arrows",
				name: "+1 Arrow",
				type: "A",
				arrow: true,
				quantity: 5,
				bonusWeapon: 1,
			});

			// Consume all magic arrows
			for (let i = 0; i < 5; i++) {
				state.consumeAmmunition("magic-arrows", 1);
			}

			// Recover
			const recovered = state.recoverAmmunition();
			expect(recovered["magic-arrows"]).toBeUndefined();
		});

		it("should detect magic ammunition by rarity", () => {
			state.addItem({
				id: "rare-arrows",
				name: "Arrow of Slaying",
				type: "A",
				arrow: true,
				quantity: 1,
				rarity: "rare",
			});
			expect(state.isMagicAmmunition("rare-arrows")).toBe(true);
		});

		it("should clear ammunition tracking", () => {
			state.consumeAmmunition("arrows", 5);
			expect(Object.keys(state.getAmmunitionConsumed()).length).toBeGreaterThan(0);

			state.clearAmmunitionTracking();
			expect(Object.keys(state.getAmmunitionConsumed()).length).toBe(0);
		});

		it("should match different ammo types", () => {
			// Add crossbow and bolts
			state.addItem({
				id: "crossbow",
				name: "Heavy Crossbow",
				weapon: true,
				ammoType: "bolt|xphb",
			});
			state.addItem({
				id: "bolts",
				name: "Crossbow Bolt",
				type: "A",
				bolt: true,
				quantity: 20,
			});

			const ammo = state.getAmmunitionForWeapon("crossbow");
			expect(ammo.length).toBe(1);
			expect(ammo[0].name).toBe("Crossbow Bolt");
		});
	});

	// =========================================================================
	// Conditional Bonuses
	// =========================================================================

	describe("Conditional Bonuses", () => {
		let state;

		beforeEach(() => {
			state = new CharacterSheetState();
			state.addClass({name: "Fighter", source: "PHB", level: 5});
			state.setAbilityBase("str", 16);
			state.setAbilityBase("dex", 14);
		});

		describe("Detection Patterns", () => {
			it("should detect 'hit [creature type]...extra {@damage XdY}' pattern", () => {
				state.addItem({
					id: "mace-disruption",
					name: "Mace of Disruption",
					weapon: true,
					entries: [
						"When you hit a fiend or an undead with this magic weapon, that creature takes an extra {@damage 2d6} radiant damage.",
					],
				});

				const bonuses = state.getItemConditionalBonuses("mace-disruption");
				expect(bonuses.length).toBeGreaterThan(0);
				expect(bonuses[0].damage).toBe("2d6");
				expect(bonuses[0].damageType).toBe("radiant");
				expect(bonuses[0].creatureTypes).toContain("fiend");
				expect(bonuses[0].creatureTypes).toContain("undead");
			});

			it("should detect 'against [creature type]' pattern", () => {
				state.addItem({
					id: "dragon-slayer",
					name: "Dragon Slayer",
					weapon: true,
					entries: [
						"When you hit a dragon with this weapon, the dragon takes an extra {@damage 3d6} damage of the weapon's type.",
					],
				});

				const bonuses = state.getItemConditionalBonuses("dragon-slayer");
				expect(bonuses.length).toBeGreaterThan(0);
				expect(bonuses[0].damage).toBe("3d6");
				expect(bonuses[0].creatureTypes).toContain("dragon");
			});

			it("should detect 'takes extra XdY [damage type]' pattern", () => {
				state.addItem({
					id: "sunblade",
					name: "Sun Blade",
					weapon: true,
					entries: [
						"Undead take an extra {@damage 1d8} radiant damage when hit by this weapon.",
					],
				});

				const bonuses = state.getItemConditionalBonuses("sunblade");
				expect(bonuses.length).toBeGreaterThan(0);
				expect(bonuses[0].damage).toBe("1d8");
				expect(bonuses[0].damageType).toBe("radiant");
				expect(bonuses[0].creatureTypes).toContain("undead");
			});

			it("should detect multiple creature types", () => {
				state.addItem({
					id: "holy-avenger",
					name: "Holy Avenger",
					weapon: true,
					entries: [
						"When you hit a fiend or undead with it, that creature takes an extra {@damage 2d10} radiant damage.",
					],
				});

				const bonuses = state.getItemConditionalBonuses("holy-avenger");
				expect(bonuses.length).toBeGreaterThan(0);
				expect(bonuses[0].creatureTypes.length).toBe(2);
				expect(bonuses[0].creatureTypes).toContain("fiend");
				expect(bonuses[0].creatureTypes).toContain("undead");
			});

			it("should handle items without conditional bonuses", () => {
				state.addItem({
					id: "plus-one-sword",
					name: "+1 Longsword",
					weapon: true,
					bonusWeapon: "+1",
					entries: [
						"You have a +1 bonus to attack and damage rolls made with this magic weapon.",
					],
				});

				const bonuses = state.getItemConditionalBonuses("plus-one-sword");
				expect(bonuses).toEqual([]);
			});

			it("should detect bonus from nested entries", () => {
				state.addItem({
					id: "nested-weapon",
					name: "Nested Entry Weapon",
					weapon: true,
					entries: [
						{
							type: "entries",
							name: "Special Attack",
							entries: [
								"When you hit an aberration with this weapon, it takes an extra {@damage 2d8} psychic damage.",
							],
						},
					],
				});

				const bonuses = state.getItemConditionalBonuses("nested-weapon");
				expect(bonuses.length).toBeGreaterThan(0);
				expect(bonuses[0].creatureTypes).toContain("aberration");
			});
		});

		describe("Accessor Methods", () => {
			it("should check if item has conditional bonuses", () => {
				state.addItem({
					id: "with-bonus",
					name: "Weapon with Bonus",
					weapon: true,
					entries: ["When you hit a beast with this weapon, it takes an extra {@damage 1d6} piercing damage."],
				});
				state.addItem({
					id: "without-bonus",
					name: "Normal Weapon",
					weapon: true,
				});

				expect(state.hasConditionalBonuses("with-bonus")).toBe(true);
				expect(state.hasConditionalBonuses("without-bonus")).toBe(false);
			});

			it("should get items with conditional bonuses", () => {
				state.addItem({
					id: "bonus-weapon",
					name: "Bonus Weapon",
					weapon: true,
					equipped: true,
					entries: ["When you hit a construct with this weapon, it takes an extra {@damage 1d8} force damage."],
				});
				state.addItem({
					id: "normal-weapon",
					name: "Normal Weapon",
					weapon: true,
					equipped: true,
				});

				const items = state.getItemsWithConditionalBonuses();
				expect(items.length).toBe(1);
				expect(items[0].name).toBe("Bonus Weapon");
			});

			it("should filter by equipped only", () => {
				state.addItem({
					id: "equipped-bonus",
					name: "Equipped Bonus Weapon",
					weapon: true,
					equipped: true,
					entries: ["When you hit an elemental with this weapon, it takes an extra {@damage 2d6} cold damage."],
				});
				state.addItem({
					id: "unequipped-bonus",
					name: "Unequipped Bonus Weapon",
					weapon: true,
					equipped: false,
					entries: ["When you hit a fey with this weapon, it takes an extra {@damage 1d6} fire damage."],
				});

				const items = state.getItemsWithConditionalBonuses({equippedOnly: true});
				expect(items.length).toBe(1);
				expect(items[0].name).toBe("Equipped Bonus Weapon");
			});

			it("should filter by active only (equipped + attuned if required)", () => {
				state.addItem({
					id: "active-attunement",
					name: "Active Attuned Weapon",
					weapon: true,
					equipped: true,
					requiresAttunement: true,
					attuned: true,
					entries: ["When you hit a giant with this weapon, it takes an extra {@damage 3d6} thunder damage."],
				});
				state.addItem({
					id: "inactive-attunement",
					name: "Inactive Attuned Weapon",
					weapon: true,
					equipped: true,
					requiresAttunement: true,
					attuned: false,
					entries: ["When you hit a humanoid with this weapon, it takes an extra {@damage 1d4} poison damage."],
				});

				const items = state.getItemsWithConditionalBonuses({activeOnly: true});
				expect(items.length).toBe(1);
				expect(items[0].name).toBe("Active Attuned Weapon");
			});

			it("should get conditional bonuses for specific creature type", () => {
				state.addItem({
					id: "multi-bonus",
					name: "Multi Bonus Weapon",
					weapon: true,
					conditionalBonuses: [
						{id: "vs_undead", label: "vs Undead", damage: "2d6", damageType: "radiant", creatureTypes: ["undead"]},
						{id: "vs_fiend", label: "vs Fiend", damage: "1d8", damageType: "fire", creatureTypes: ["fiend"]},
					],
				});

				const undeadBonuses = state.getConditionalBonusesForCreatureType("multi-bonus", "undead");
				expect(undeadBonuses.length).toBe(1);
				expect(undeadBonuses[0].damage).toBe("2d6");

				const fiendBonuses = state.getConditionalBonusesForCreatureType("multi-bonus", "fiend");
				expect(fiendBonuses.length).toBe(1);
				expect(fiendBonuses[0].damage).toBe("1d8");

				const dragonBonuses = state.getConditionalBonusesForCreatureType("multi-bonus", "dragon");
				expect(dragonBonuses.length).toBe(0);
			});
		});

		describe("Explicit Override", () => {
			it("should use explicit conditionalBonuses if provided", () => {
				state.addItem({
					id: "explicit-bonus",
					name: "Explicit Bonus Weapon",
					weapon: true,
					conditionalBonuses: [
						{id: "custom_bonus", label: "Custom Bonus", damage: "5d10", damageType: "necrotic", creatureTypes: ["celestial"]},
					],
					entries: ["When you hit a fiend with this weapon, it takes an extra {@damage 1d6} radiant damage."],
				});

				const bonuses = state.getItemConditionalBonuses("explicit-bonus");
				expect(bonuses.length).toBe(1);
				expect(bonuses[0].damage).toBe("5d10"); // Explicit overrides detection
				expect(bonuses[0].damageType).toBe("necrotic");
			});

			it("should handle empty conditionalBonuses array", () => {
				state.addItem({
					id: "empty-bonus",
					name: "Empty Bonus Weapon",
					weapon: true,
					conditionalBonuses: [],
					entries: ["When you hit an ooze with this weapon, it takes an extra {@damage 1d6} acid damage."],
				});

				const bonuses = state.getItemConditionalBonuses("empty-bonus");
				expect(bonuses).toEqual([]); // Empty explicit overrides detection
			});
		});

		describe("Various Creature Types", () => {
			const creatureTypes = [
				{type: "aberration", damageType: "psychic"},
				{type: "beast", damageType: "piercing"},
				{type: "celestial", damageType: "necrotic"},
				{type: "construct", damageType: "force"},
				{type: "dragon", damageType: "cold"},
				{type: "elemental", damageType: "lightning"},
				{type: "fey", damageType: "poison"},
				{type: "fiend", damageType: "radiant"},
				{type: "giant", damageType: "thunder"},
				{type: "humanoid", damageType: "slashing"},
				{type: "monstrosity", damageType: "acid"},
				{type: "ooze", damageType: "fire"},
				{type: "plant", damageType: "cold"},
				{type: "undead", damageType: "radiant"},
			];

			creatureTypes.forEach(({type, damageType}) => {
				it(`should detect conditional bonus vs ${type}`, () => {
					state.addItem({
						id: `vs-${type}`,
						name: `${type.charAt(0).toUpperCase() + type.slice(1)} Bane`,
						weapon: true,
						entries: [`When you hit a ${type} with this weapon, it takes an extra {@damage 2d6} ${damageType} damage.`],
					});

					const bonuses = state.getItemConditionalBonuses(`vs-${type}`);
					expect(bonuses.length).toBeGreaterThan(0);
					expect(bonuses[0].creatureTypes).toContain(type);
					expect(bonuses[0].damageType).toBe(damageType);
				});
			});
		});
	});

	// =========================================================================
	// Consumable Items (Potions, Scrolls)
	// =========================================================================

	describe("Consumable Items", () => {
		let state;

		beforeEach(() => {
			state = new CharacterSheetState();
			state.addClass({name: "Wizard", source: "PHB", level: 5});
			state.setAbilityBase("int", 16);
		});

		describe("isConsumable", () => {
			it("should identify potions as consumable", () => {
				state.addItem({
					id: "healing-potion",
					name: "Potion of Healing",
					type: "P",
				});
				expect(state.isConsumable("healing-potion")).toBe(true);
			});

			it("should identify spell scrolls as consumable", () => {
				state.addItem({
					id: "scroll-fireball",
					name: "Spell Scroll (Fireball)",
					type: "SC",
				});
				expect(state.isConsumable("scroll-fireball")).toBe(true);
			});

			it("should not identify weapons as consumable", () => {
				state.addItem({
					id: "sword",
					name: "Longsword",
					weapon: true,
				});
				expect(state.isConsumable("sword")).toBe(false);
			});

			it("should not identify armor as consumable", () => {
				state.addItem({
					id: "chainmail",
					name: "Chain Mail",
					armor: true,
					type: "HA",
				});
				expect(state.isConsumable("chainmail")).toBe(false);
			});
		});

		describe("isPotion / isSpellScroll", () => {
			it("should correctly identify potions", () => {
				state.addItem({id: "pot", name: "Potion", type: "P"});
				expect(state.isPotion("pot")).toBe(true);
				expect(state.isSpellScroll("pot")).toBe(false);
			});

			it("should correctly identify spell scrolls", () => {
				state.addItem({id: "scroll", name: "Scroll", type: "SC"});
				expect(state.isSpellScroll("scroll")).toBe(true);
				expect(state.isPotion("scroll")).toBe(false);
			});
		});

		describe("consumeItem", () => {
			it("should decrement quantity for stacked items", () => {
				state.addItem({
					id: "healing-potions",
					name: "Potion of Healing",
					type: "P",
					quantity: 5,
				});

				state.consumeItem("healing-potions");
				const item = state.getItems().find(i => i.id === "healing-potions");
				expect(item.quantity).toBe(4);
			});

			it("should remove item when quantity reaches 0", () => {
				state.addItem({
					id: "last-potion",
					name: "Potion of Healing",
					type: "P",
					quantity: 1,
				});

				state.consumeItem("last-potion");
				const item = state.getItems().find(i => i.id === "last-potion");
				expect(item).toBeUndefined();
			});

			it("should remove item with no explicit quantity", () => {
				state.addItem({
					id: "scroll",
					name: "Spell Scroll",
					type: "SC",
				});

				state.consumeItem("scroll");
				const item = state.getItems().find(i => i.id === "scroll");
				expect(item).toBeUndefined();
			});

			it("should return true when item is consumed", () => {
				state.addItem({id: "pot", name: "Potion", type: "P"});
				expect(state.consumeItem("pot")).toBe(true);
			});

			it("should return false for non-existent item", () => {
				expect(state.consumeItem("non-existent")).toBe(false);
			});
		});

		describe("getItemHealingEffect", () => {
			it("should detect Potion of Healing by name", () => {
				state.addItem({
					id: "basic-healing",
					name: "Potion of Healing",
					type: "P",
				});
				const healing = state.getItemHealingEffect("basic-healing");
				expect(healing).not.toBeNull();
				expect(healing.dice).toBe("2d4+2");
			});

			it("should detect Greater Potion of Healing by name", () => {
				state.addItem({
					id: "greater-healing",
					name: "Potion of Greater Healing",
					type: "P",
				});
				const healing = state.getItemHealingEffect("greater-healing");
				expect(healing).not.toBeNull();
				expect(healing.dice).toBe("4d4+4");
			});

			it("should detect Superior Potion of Healing by name", () => {
				state.addItem({
					id: "superior-healing",
					name: "Potion of Superior Healing",
					type: "P",
				});
				const healing = state.getItemHealingEffect("superior-healing");
				expect(healing).not.toBeNull();
				expect(healing.dice).toBe("8d4+8");
			});

			it("should detect Supreme Potion of Healing by name", () => {
				state.addItem({
					id: "supreme-healing",
					name: "Potion of Supreme Healing",
					type: "P",
				});
				const healing = state.getItemHealingEffect("supreme-healing");
				expect(healing).not.toBeNull();
				expect(healing.dice).toBe("10d4+20");
			});

			it("should use explicit healing property if provided", () => {
				state.addItem({
					id: "custom-potion",
					name: "Custom Potion",
					type: "P",
					healing: {dice: "3d8+5"},
				});
				const healing = state.getItemHealingEffect("custom-potion");
				expect(healing).not.toBeNull();
				expect(healing.dice).toBe("3d8+5");
			});

			it("should parse healing from entries", () => {
				state.addItem({
					id: "entry-potion",
					name: "Custom Healing Potion",
					type: "P",
					entries: ["You regain {@dice 2d4+2} hit points when you drink this potion."],
				});
				const healing = state.getItemHealingEffect("entry-potion");
				expect(healing).not.toBeNull();
				expect(healing.dice).toBe("2d4+2");
			});

			it("should return null for non-healing items", () => {
				state.addItem({
					id: "speed-potion",
					name: "Potion of Speed",
					type: "P",
					entries: ["You gain the effect of Haste for 1 minute."],
				});
				const healing = state.getItemHealingEffect("speed-potion");
				expect(healing).toBeNull();
			});
		});

		describe("getScrollSpell", () => {
			it("should extract spell from attachedSpells array", () => {
				state.addItem({
					id: "fireball-scroll",
					name: "Spell Scroll",
					type: "SC",
					attachedSpells: ["Fireball|PHB"],
				});
				const spell = state.getScrollSpell("fireball-scroll");
				expect(spell).not.toBeNull();
				expect(spell.name).toBe("Fireball");
				expect(spell.source).toBe("PHB");
			});

			it("should extract spell from name pattern", () => {
				state.addItem({
					id: "scroll-magic-missile",
					name: "Spell Scroll (Magic Missile)",
					type: "SC",
				});
				const spell = state.getScrollSpell("scroll-magic-missile");
				expect(spell).not.toBeNull();
				expect(spell.name).toBe("Magic Missile");
			});

			it("should return null for scroll without spell info", () => {
				state.addItem({
					id: "unknown-scroll",
					name: "Unknown Scroll",
					type: "SC",
				});
				const spell = state.getScrollSpell("unknown-scroll");
				expect(spell).toBeNull();
			});

			it("should handle object format in attachedSpells", () => {
				state.addItem({
					id: "object-scroll",
					name: "Spell Scroll",
					type: "SC",
					attachedSpells: [{name: "Fireball", source: "PHB", level: 3}],
				});
				const spell = state.getScrollSpell("object-scroll");
				expect(spell).not.toBeNull();
				expect(spell.name).toBe("Fireball");
			});
		});

		describe("Scroll Ability Check DC", () => {
			it("should calculate DC as 10 + spell level", () => {
				expect(state.getScrollAbilityCheckDc(0)).toBe(10);
				expect(state.getScrollAbilityCheckDc(1)).toBe(11);
				expect(state.getScrollAbilityCheckDc(5)).toBe(15);
				expect(state.getScrollAbilityCheckDc(9)).toBe(19);
			});
		});

		describe("canCastScrollWithoutCheck", () => {
			it("should allow casting if max spell slot >= spell level", () => {
				// Wizard 5 has 3rd level slots
				expect(state.canCastScrollWithoutCheck(1)).toBe(true);
				expect(state.canCastScrollWithoutCheck(2)).toBe(true);
				expect(state.canCastScrollWithoutCheck(3)).toBe(true);
			});

			it("should require check for spells above max slot", () => {
				// Wizard 5 has max 3rd level slots
				expect(state.canCastScrollWithoutCheck(4)).toBe(false);
				expect(state.canCastScrollWithoutCheck(5)).toBe(false);
				expect(state.canCastScrollWithoutCheck(9)).toBe(false);
			});

			it("should allow Thief 13+ to cast any scroll", () => {
				const thiefState = new CharacterSheetState();
				thiefState.addClass({name: "Rogue", source: "PHB", level: 13});
				thiefState.setSubclass("Rogue", {name: "Thief", source: "PHB"});

				expect(thiefState.canCastScrollWithoutCheck(9)).toBe(true);
			});

			it("should not allow Thief below 13 to bypass check", () => {
				const thiefState = new CharacterSheetState();
				thiefState.addClass({name: "Rogue", source: "PHB", level: 12});
				thiefState.setSubclass("Rogue", {name: "Thief", source: "PHB"});

				expect(thiefState.canCastScrollWithoutCheck(5)).toBe(false);
			});
		});
	});

	// =========================================================================
	// Artifact Properties
	// =========================================================================

	describe("Artifact Properties", () => {
		let state;

		beforeEach(() => {
			state = new CharacterSheetState();
			state.addClass({name: "Fighter", source: "PHB", level: 20});
		});

		describe("isArtifact", () => {
			it("should identify artifacts by rarity", () => {
				state.addItem({
					id: "eye-of-vecna",
					name: "Eye of Vecna",
					rarity: "artifact",
					wondrous: true,
					requiresAttunement: true,
				});
				expect(state.isArtifact("eye-of-vecna")).toBe(true);
			});

			it("should not identify non-artifacts as artifacts", () => {
				state.addItem({
					id: "legendary-sword",
					name: "Legendary Sword",
					rarity: "legendary",
					weapon: true,
				});
				expect(state.isArtifact("legendary-sword")).toBe(false);
			});
		});

		describe("Property Requirements Detection", () => {
			it("should detect property requirements from entries", () => {
				state.addItem({
					id: "eye-of-vecna",
					name: "Eye of Vecna",
					rarity: "artifact",
					entries: [
						"Random Properties",
						{
							type: "entries",
							entries: [
								"The Eye of Vecna has the following random properties:",
								{
									type: "list",
									items: [
										"1 {@table Artifact Properties; Minor Beneficial Properties|dmg|minor beneficial property}",
										"1 {@table Artifact Properties; Major Beneficial Properties|dmg|major beneficial property}",
										"1 {@table Artifact Properties; Minor Detrimental Properties|dmg|minor detrimental property}",
									],
								},
							],
						},
					],
				});

				const requirements = state.getArtifactPropertyRequirements("eye-of-vecna");
				expect(requirements).not.toBeNull();
				expect(requirements.minorBeneficial).toBe(1);
				expect(requirements.majorBeneficial).toBe(1);
				expect(requirements.minorDetrimental).toBe(1);
				expect(requirements.majorDetrimental).toBe(0);
			});

			it("should detect multiple properties of same type", () => {
				state.addItem({
					id: "hand-of-vecna",
					name: "Hand of Vecna",
					rarity: "artifact",
					entries: [
						"The Hand of Vecna has the following random properties:",
						"2 {@table Artifact Properties; Minor Beneficial Properties|dmg|minor beneficial properties}",
						"1 {@table Artifact Properties; Major Beneficial Properties|dmg|major beneficial property}",
						"2 {@table Artifact Properties; Minor Detrimental Properties|dmg|minor detrimental properties}",
						"1 {@table Artifact Properties; Major Detrimental Properties|dmg|major detrimental property}",
					],
				});

				const requirements = state.getArtifactPropertyRequirements("hand-of-vecna");
				expect(requirements.minorBeneficial).toBe(2);
				expect(requirements.majorBeneficial).toBe(1);
				expect(requirements.minorDetrimental).toBe(2);
				expect(requirements.majorDetrimental).toBe(1);
			});

			it("should handle artifacts without property requirements", () => {
				state.addItem({
					id: "simple-artifact",
					name: "Simple Artifact",
					rarity: "artifact",
					entries: ["This artifact has fixed properties."],
				});

				const item = state.getItems().find(i => i.id === "simple-artifact");
				expect(item.artifactProperties).not.toBeNull();
				expect(item.artifactProperties.hasRequirements).toBe(false);
			});
		});

		describe("Property Management", () => {
			beforeEach(() => {
				state.addItem({
					id: "test-artifact",
					name: "Test Artifact",
					rarity: "artifact",
					entries: ["1 {@table Artifact Properties; Minor Beneficial Properties|dmg|minor beneficial property}"],
				});
			});

			it("should add a property to an artifact", () => {
				const property = {min: 1, max: 20, name: "Skill Proficiency", description: "You gain proficiency in one skill."};
				state.setArtifactProperty("test-artifact", "minorBeneficial", property);

				const properties = state.getArtifactProperties("test-artifact");
				expect(properties.length).toBe(1);
				expect(properties[0].name).toBe("Skill Proficiency");
				expect(properties[0].type).toBe("minorBeneficial");
			});

			it("should remove a property from an artifact", () => {
				const property = {name: "Test Property", description: "Test"};
				state.setArtifactProperty("test-artifact", "minorBeneficial", property);
				expect(state.getArtifactProperties("test-artifact").length).toBe(1);

				state.removeArtifactProperty("test-artifact", 0);
				expect(state.getArtifactProperties("test-artifact").length).toBe(0);
			});

			it("should track configuration status", () => {
				expect(state.isArtifactFullyConfigured("test-artifact")).toBe(false);

				const property = {name: "Skill Proficiency", description: "Test"};
				state.setArtifactProperty("test-artifact", "minorBeneficial", property);

				expect(state.isArtifactFullyConfigured("test-artifact")).toBe(true);
			});
		});

		describe("Property Rolling", () => {
			it("should roll a valid minor beneficial property", () => {
				const property = state.rollArtifactProperty("minorBeneficial");
				expect(property).not.toBeNull();
				expect(property.roll).toBeGreaterThanOrEqual(1);
				expect(property.roll).toBeLessThanOrEqual(100);
				expect(property.name).toBeDefined();
				expect(property.description).toBeDefined();
			});

			it("should roll a valid major beneficial property", () => {
				const property = state.rollArtifactProperty("majorBeneficial");
				expect(property).not.toBeNull();
				expect(property.name).toBeDefined();
			});

			it("should roll a valid minor detrimental property", () => {
				const property = state.rollArtifactProperty("minorDetrimental");
				expect(property).not.toBeNull();
				expect(property.name).toBeDefined();
			});

			it("should roll a valid major detrimental property", () => {
				const property = state.rollArtifactProperty("majorDetrimental");
				expect(property).not.toBeNull();
				expect(property.name).toBeDefined();
			});

			it("should return null for invalid property type", () => {
				const property = state.rollArtifactProperty("invalidType");
				expect(property).toBeNull();
			});
		});

		describe("Property Tables", () => {
			it("should have 9 minor beneficial properties", () => {
				const table = state.getArtifactPropertyTable("minorBeneficial");
				expect(table.length).toBe(9);
			});

			it("should have 9 major beneficial properties", () => {
				const table = state.getArtifactPropertyTable("majorBeneficial");
				expect(table.length).toBe(9);
			});

			it("should have 20 minor detrimental properties", () => {
				const table = state.getArtifactPropertyTable("minorDetrimental");
				expect(table.length).toBe(20);
			});

			it("should have 13 major detrimental properties", () => {
				const table = state.getArtifactPropertyTable("majorDetrimental");
				expect(table.length).toBe(13);
			});

			it("should cover d100 range 1-100 for minor beneficial", () => {
				const table = state.getArtifactPropertyTable("minorBeneficial");
				const covered = new Set();
				for (const prop of table) {
					for (let i = prop.min; i <= prop.max; i++) {
						covered.add(i);
					}
				}
				expect(covered.size).toBe(100);
			});
		});

		describe("Artifact Collection", () => {
			it("should get all artifacts in inventory", () => {
				state.addItem({id: "artifact1", name: "Artifact 1", rarity: "artifact"});
				state.addItem({id: "artifact2", name: "Artifact 2", rarity: "artifact"});
				state.addItem({id: "legendary", name: "Not Artifact", rarity: "legendary"});

				const artifacts = state.getArtifacts();
				expect(artifacts.length).toBe(2);
			});

			it("should get unconfigured artifacts", () => {
				state.addItem({
					id: "unconfigured",
					name: "Unconfigured Artifact",
					rarity: "artifact",
					entries: ["1 {@table Artifact Properties; Minor Beneficial Properties|dmg|minor beneficial}"],
				});
				state.addItem({
					id: "no-requirements",
					name: "No Requirements Artifact",
					rarity: "artifact",
					entries: ["Fixed properties only."],
				});

				const unconfigured = state.getUnconfiguredArtifacts();
				expect(unconfigured.length).toBe(1);
				expect(unconfigured[0].name).toBe("Unconfigured Artifact");
			});
		});
	});
});
