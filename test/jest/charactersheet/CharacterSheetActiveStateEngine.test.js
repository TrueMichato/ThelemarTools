
import "./setup.js";

let CharacterSheetState;
let state;

beforeAll(async () => {
	CharacterSheetState = (await import("../../../js/charactersheet/charactersheet-state.js")).CharacterSheetState;
});

describe("Active State Effects Engine", () => {
	beforeEach(() => {
		state = new CharacterSheetState();
		state.setAbilityBase("str", 14);
		state.setAbilityBase("dex", 14);
		state.setAbilityBase("con", 14);
		state.setAbilityBase("int", 16);
		state.setAbilityBase("wis", 14);
		state.setAbilityBase("cha", 10);
	});

	// ===================================================================
	// SPEED BONUS FROM STATES
	// ===================================================================
	describe("Speed Bonuses from Active States", () => {
		test("Bladesong should add +10 walking speed", () => {
			state.addClass({name: "Wizard", source: "PHB", level: 2, subclass: {name: "Bladesinging"}});
			const baseSpeed = state.getWalkSpeed();
			state.activateState("bladesong");
			const buffedSpeed = state.getWalkSpeed();
			expect(buffedSpeed).toBe(baseSpeed + 10);
		});

		test("Bladesong speed bonus should appear in getSpeed() display string", () => {
			state.addClass({name: "Wizard", source: "PHB", level: 2, subclass: {name: "Bladesinging"}});
			state.activateState("bladesong");
			const speedStr = state.getSpeed();
			// Base walk 30 + 10 = 40
			expect(speedStr).toContain("40 ft.");
		});

		test("getSpeedBonusFromStates should match typed targets like speed:walk", () => {
			state.activateState("bladesong");
			const walkBonus = state.getSpeedBonusFromStates("walk");
			expect(walkBonus).toBe(10);
		});

		test("getSpeedBonusFromStates should match generic speed targets", () => {
			// Add a custom state with generic "speed" target
			state.addActiveState("custom", {
				name: "Haste",
				customEffects: [{type: "bonus", target: "speed", value: 15}],
			});
			const walkBonus = state.getSpeedBonusFromStates("walk");
			expect(walkBonus).toBe(15);
			// Generic speed should also apply to other types
			const flyBonus = state.getSpeedBonusFromStates("fly");
			expect(flyBonus).toBe(15);
		});

		test("typed speed bonus should not affect other speed types", () => {
			state.activateState("bladesong"); // speed:walk only
			const flyBonus = state.getSpeedBonusFromStates("fly");
			expect(flyBonus).toBe(0);
		});

		test("getSpeedByType should include state bonuses", () => {
			state.setSpeed("fly", 60);
			state.addActiveState("custom", {
				name: "Wind Walk",
				customEffects: [{type: "bonus", target: "speed:fly", value: 20}],
			});
			const flySpeed = state.getSpeedByType("fly");
			expect(flySpeed).toBe(80);
		});

		test("speed bonuses should stack from multiple states", () => {
			state.activateState("bladesong"); // +10 walk
			state.addActiveState("custom", {
				name: "Longstrider",
				customEffects: [{type: "bonus", target: "speed", value: 10}],
			});
			const walkBonus = state.getSpeedBonusFromStates("walk");
			expect(walkBonus).toBe(20);
		});

		test("deactivating state should remove speed bonus", () => {
			state.activateState("bladesong");
			expect(state.getSpeedBonusFromStates("walk")).toBe(10);
			state.deactivateState("bladesong");
			expect(state.getSpeedBonusFromStates("walk")).toBe(0);
		});

		test("abilityMod speed bonus should work", () => {
			// INT = 16 → mod +3
			state.addActiveState("custom", {
				name: "Intelligence Speed",
				customEffects: [{type: "bonus", target: "speed:walk", abilityMod: "int"}],
			});
			const bonus = state.getSpeedBonusFromStates("walk");
			expect(bonus).toBe(3);
		});
	});

	// ===================================================================
	// RESISTANCE AGGREGATION
	// ===================================================================
	describe("Resistance Aggregation", () => {
		test("hasResistance should check base resistances", () => {
			state.addResistance("fire");
			expect(state.hasResistance("fire")).toBe(true);
			expect(state.hasResistance("cold")).toBe(false);
		});

		test("hasResistance should check active state resistances (Rage)", () => {
			state.addClass({name: "Barbarian", source: "PHB", level: 1});
			state.activateState("rage");
			expect(state.hasResistance("bludgeoning")).toBe(true);
			expect(state.hasResistance("piercing")).toBe(true);
			expect(state.hasResistance("slashing")).toBe(true);
			expect(state.hasResistance("fire")).toBe(false);
		});

		test("hasResistance should merge both sources", () => {
			state.addResistance("fire"); // base
			state.addClass({name: "Barbarian", source: "PHB", level: 1});
			state.activateState("rage"); // state-based B/P/S
			expect(state.hasResistance("fire")).toBe(true);
			expect(state.hasResistance("bludgeoning")).toBe(true);
		});

		test("getResistances should return combined unique list", () => {
			state.addResistance("fire");
			state.addClass({name: "Barbarian", source: "PHB", level: 1});
			state.activateState("rage");
			const resistances = state.getResistances();
			expect(resistances).toContain("fire");
			expect(resistances).toContain("bludgeoning");
			expect(resistances).toContain("piercing");
			expect(resistances).toContain("slashing");
			expect(resistances.length).toBe(4);
		});

		test("getResistances should deduplicate when same type from both sources", () => {
			state.addResistance("bludgeoning"); // Also from Rage
			state.addClass({name: "Barbarian", source: "PHB", level: 1});
			state.activateState("rage");
			const resistances = state.getResistances();
			const bludgeoningCount = resistances.filter(r => r === "bludgeoning").length;
			expect(bludgeoningCount).toBe(1);
		});

		test("deactivating rage should remove state-based resistances", () => {
			state.addClass({name: "Barbarian", source: "PHB", level: 1});
			state.activateState("rage");
			expect(state.hasResistance("bludgeoning")).toBe(true);
			state.deactivateState("rage");
			expect(state.hasResistance("bludgeoning")).toBe(false);
		});

		test("hasResistanceFromStates should work standalone", () => {
			state.addClass({name: "Barbarian", source: "PHB", level: 1});
			state.activateState("rage");
			expect(state.hasResistanceFromStates("bludgeoning")).toBe(true);
			expect(state.hasResistanceFromStates("fire")).toBe(false);
		});

		test("custom state with resistance effects should work", () => {
			state.addActiveState("custom", {
				name: "Stoneskin",
				customEffects: [
					{type: "resistance", target: "damage:bludgeoning"},
					{type: "resistance", target: "damage:piercing"},
					{type: "resistance", target: "damage:slashing"},
				],
			});
			expect(state.hasResistance("bludgeoning")).toBe(true);
			expect(state.getResistances()).toContain("slashing");
		});
	});

	// ===================================================================
	// IMMUNITY FROM STATES
	// ===================================================================
	describe("Immunity from Active States", () => {
		test("hasImmunity should check base immunities", () => {
			state.addImmunity("poison");
			expect(state.hasImmunity("poison")).toBe(true);
		});

		test("hasImmunityFromStates should detect state-based immunities", () => {
			state.addActiveState("custom", {
				name: "Protection from Poison",
				customEffects: [{type: "immunity", target: "damage:poison"}],
			});
			expect(state.hasImmunityFromStates("poison")).toBe(true);
			expect(state.hasImmunity("poison")).toBe(true);
		});

		test("getImmunities should combine base and state immunities", () => {
			state.addImmunity("fire");
			state.addActiveState("custom", {
				name: "Elemental Shield",
				customEffects: [{type: "immunity", target: "damage:cold"}],
			});
			const immunities = state.getImmunities();
			expect(immunities).toContain("fire");
			expect(immunities).toContain("cold");
		});
	});

	// ===================================================================
	// VULNERABILITY FROM STATES
	// ===================================================================
	describe("Vulnerability from Active States", () => {
		test("hasVulnerability should check base vulnerabilities", () => {
			state.addVulnerability("fire");
			expect(state.hasVulnerability("fire")).toBe(true);
		});

		test("hasVulnerabilityFromStates should detect state-based vulnerabilities", () => {
			state.addActiveState("custom", {
				name: "Cursed",
				customEffects: [{type: "vulnerability", target: "damage:radiant"}],
			});
			expect(state.hasVulnerabilityFromStates("radiant")).toBe(true);
			expect(state.hasVulnerability("radiant")).toBe(true);
		});

		test("getVulnerabilities should combine sources", () => {
			state.addVulnerability("fire");
			state.addActiveState("custom", {
				name: "Weakness",
				customEffects: [{type: "vulnerability", target: "damage:cold"}],
			});
			const vulns = state.getVulnerabilities();
			expect(vulns).toContain("fire");
			expect(vulns).toContain("cold");
		});
	});

	// ===================================================================
	// CONDITION IMMUNITY FROM STATES
	// ===================================================================
	describe("Condition Immunity from Active States", () => {
		test("isImmuneToCondition should check base condition immunities", () => {
			state.addConditionImmunity("charmed");
			expect(state.isImmuneToCondition("charmed")).toBe(true);
		});

		test("hasConditionImmunityFromStates should detect state-based condition immunity", () => {
			state.addActiveState("custom", {
				name: "Heroes' Feast",
				customEffects: [
					{type: "conditionImmunity", target: "frightened"},
					{type: "conditionImmunity", target: "poisoned"},
				],
			});
			expect(state.hasConditionImmunityFromStates("frightened")).toBe(true);
			expect(state.hasConditionImmunityFromStates("poisoned")).toBe(true);
			expect(state.isImmuneToCondition("frightened")).toBe(true);
		});

		test("getConditionImmunities should combine sources", () => {
			state.addConditionImmunity("charmed");
			state.addActiveState("custom", {
				name: "Calm Emotions",
				customEffects: [{type: "conditionImmunity", target: "frightened"}],
			});
			const condImmunities = state.getConditionImmunities();
			expect(condImmunities).toContain("charmed");
			expect(condImmunities).toContain("frightened");
		});
	});

	// ===================================================================
	// EFFECTIVE DEFENSES SUMMARY
	// ===================================================================
	describe("getEffectiveDefenses", () => {
		test("should return combined defenses from all sources", () => {
			state.addResistance("fire");
			state.addImmunity("poison");
			state.addVulnerability("cold");
			state.addConditionImmunity("poisoned");

			state.addClass({name: "Barbarian", source: "PHB", level: 1});
			state.activateState("rage");

			const defenses = state.getEffectiveDefenses();
			expect(defenses.resistances).toContain("fire");
			expect(defenses.resistances).toContain("bludgeoning");
			expect(defenses.immunities).toContain("poison");
			expect(defenses.vulnerabilities).toContain("cold");
			expect(defenses.conditionImmunities).toContain("poisoned");
		});
	});

	// ===================================================================
	// WILD SHAPE — STAT REPLACEMENT
	// ===================================================================
	describe("Wild Shape Stat Replacement", () => {
		const wolfData = {
			name: "Wolf",
			ac: 13,
			hp: {max: 11},
			abilities: {str: 12, dex: 15, con: 12, int: 3, wis: 12, cha: 6},
			speed: {walk: 40},
			senses: ["darkvision 30 ft."],
		};

		beforeEach(() => {
			state.addClass({name: "Druid", source: "PHB", level: 4});
		});

		test("isInWildShape should return false when not transformed", () => {
			expect(state.isInWildShape()).toBe(false);
		});

		test("isInWildShape should return true when transformed", () => {
			state.activateWildShape(wolfData);
			expect(state.isInWildShape()).toBe(true);
		});

		test("physical stats should be replaced with beast stats", () => {
			state.activateWildShape(wolfData);
			expect(state.getAbilityScore("str")).toBe(12); // Wolf's STR
			expect(state.getAbilityScore("dex")).toBe(15); // Wolf's DEX
			expect(state.getAbilityScore("con")).toBe(12); // Wolf's CON
		});

		test("mental stats should remain character's own", () => {
			state.activateWildShape(wolfData);
			expect(state.getAbilityScore("int")).toBe(16); // Character's INT (not wolf's 3)
			expect(state.getAbilityScore("wis")).toBe(14); // Character's WIS
			expect(state.getAbilityScore("cha")).toBe(10); // Character's CHA
		});

		test("ability modifiers should reflect beast's physical scores", () => {
			state.activateWildShape(wolfData);
			expect(state.getAbilityMod("str")).toBe(1); // 12 → +1
			expect(state.getAbilityMod("dex")).toBe(2); // 15 → +2
			expect(state.getAbilityMod("con")).toBe(1); // 12 → +1
			// Mental stats: character's
			expect(state.getAbilityMod("int")).toBe(3); // 16 → +3
		});

		test("deactivating wild shape should restore character stats", () => {
			const originalStr = state.getAbilityScore("str");
			state.activateWildShape(wolfData);
			expect(state.getAbilityScore("str")).toBe(12); // Wolf
			state.deactivateWildShape();
			expect(state.getAbilityScore("str")).toBe(originalStr); // Back to normal
		});

		test("getWildShapeBeastData should return beast data", () => {
			state.activateWildShape(wolfData);
			const data = state.getWildShapeBeastData();
			expect(data.name).toBe("Wolf");
			expect(data.abilities.str).toBe(12);
		});

		test("getWildShapeBeastData should return null when not transformed", () => {
			expect(state.getWildShapeBeastData()).toBeNull();
		});
	});

	// ===================================================================
	// WILD SHAPE — AC REPLACEMENT
	// ===================================================================
	describe("Wild Shape AC Replacement", () => {
		const bearData = {
			name: "Brown Bear",
			ac: 11,
			hp: {max: 34},
			abilities: {str: 19, dex: 10, con: 16, int: 2, wis: 13, cha: 7},
			speed: {walk: 40, climb: 30},
		};

		beforeEach(() => {
			state.addClass({name: "Druid", source: "PHB", level: 4});
		});

		test("AC should use beast's AC in wild shape", () => {
			state.activateWildShape(bearData);
			expect(state.getAc()).toBe(11); // Bear's natural armor
		});

		test("AC should revert to character's AC when wild shape ends", () => {
			const normalAc = state.getAc(); // 10 + DEX(2) = 12
			state.activateWildShape(bearData);
			expect(state.getAc()).toBe(11); // Bear AC
			state.deactivateWildShape();
			expect(state.getAc()).toBe(normalAc); // Back to normal
		});

		test("spell AC bonuses should still apply on top of beast AC", () => {
			state.activateWildShape(bearData);
			// Add a Shield of Faith-like bonus
			state.addActiveState("custom", {
				name: "Shield of Faith",
				customEffects: [{type: "bonus", target: "ac", value: 2}],
			});
			expect(state.getAc()).toBe(13); // Bear 11 + bonus 2
		});

		test("worn armor should be ignored in wild shape", () => {
			// Equip armor
			state._data.ac.armor = {type: "heavy", ac: 18};
			expect(state.getAc()).toBe(18); // Plate armor
			state.activateWildShape(bearData);
			expect(state.getAc()).toBe(11); // Beast AC, not plate
		});
	});

	// ===================================================================
	// WILD SHAPE — HP (2014 PHB Rules)
	// ===================================================================
	describe("Wild Shape HP — 2014 Rules", () => {
		const wolfData = {
			name: "Wolf",
			ac: 13,
			hp: {max: 11},
			abilities: {str: 12, dex: 15, con: 12, int: 3, wis: 12, cha: 6},
			speed: {walk: 40},
		};

		beforeEach(() => {
			// PHB 2014 Druid
			state.addClass({name: "Druid", source: "PHB", level: 4});
		});

		test("should use 2014 edition rules for PHB source", () => {
			expect(state.getWildShapeRulesEdition()).toBe("2014");
		});

		test("should create separate beast HP pool on activation", () => {
			state.activateWildShape(wolfData);
			const wsHp = state.getWildShapeHp();
			expect(wsHp).not.toBeNull();
			expect(wsHp.max).toBe(11);
			expect(wsHp.current).toBe(11);
		});

		test("damageWildShape should reduce beast HP", () => {
			state.activateWildShape(wolfData);
			const result = state.damageWildShape(5);
			expect(result.beastHpLost).toBe(5);
			expect(result.overflowed).toBe(false);
			expect(result.beastDropped).toBe(false);
			expect(state.getWildShapeHp().current).toBe(6);
		});

		test("damageWildShape should overflow to character when beast drops to 0", () => {
			state.setHp(20); // Character at 20 HP
			state.activateWildShape(wolfData); // Wolf has 11 HP
			const result = state.damageWildShape(15); // 4 damage overflows
			expect(result.beastDropped).toBe(true);
			expect(result.overflowDamage).toBe(4);
			expect(result.overflowed).toBe(true);
			// Character should take 4 overflow damage
			expect(state.getCurrentHp()).toBe(16);
			// Should no longer be in wild shape
			expect(state.isInWildShape()).toBe(false);
		});

		test("damageWildShape with exact HP should not overflow", () => {
			state.setHp(20);
			state.activateWildShape(wolfData);
			const result = state.damageWildShape(11);
			expect(result.beastDropped).toBe(true);
			expect(result.overflowDamage).toBe(0);
			expect(state.getCurrentHp()).toBe(20); // No overflow
		});

		test("healWildShape should heal beast HP", () => {
			state.activateWildShape(wolfData);
			state.damageWildShape(7);
			expect(state.getWildShapeHp().current).toBe(4);
			const healed = state.healWildShape(5);
			expect(healed).toBe(5);
			expect(state.getWildShapeHp().current).toBe(9);
		});

		test("healWildShape should not exceed beast max HP", () => {
			state.activateWildShape(wolfData);
			state.damageWildShape(3);
			const healed = state.healWildShape(10);
			expect(healed).toBe(3);
			expect(state.getWildShapeHp().current).toBe(11);
		});

		test("getWildShapeHp should return null when not in wild shape", () => {
			expect(state.getWildShapeHp()).toBeNull();
		});
	});

	// ===================================================================
	// WILD SHAPE — HP (2024 XPHB Rules)
	// ===================================================================
	describe("Wild Shape HP — 2024 Rules", () => {
		const wolfData = {
			name: "Wolf",
			ac: 13,
			hp: {max: 11},
			abilities: {str: 12, dex: 15, con: 12, int: 3, wis: 12, cha: 6},
			speed: {walk: 40},
		};

		beforeEach(() => {
			// XPHB 2024 Druid
			state.addClass({name: "Druid", source: "XPHB", level: 4});
		});

		test("should use 2024 edition rules for XPHB source", () => {
			expect(state.getWildShapeRulesEdition()).toBe("2024");
		});

		test("should grant temp HP on activation (4 × druid level)", () => {
			state.activateWildShape(wolfData);
			// wildShapeTempHp = 4 × 4 = 16
			expect(state.getTempHp()).toBe(16);
		});

		test("should not create a separate beast HP pool", () => {
			state.activateWildShape(wolfData);
			expect(state.getWildShapeHp()).toBeNull();
		});

		test("higher temp HP should take priority", () => {
			state.setTempHp(20); // Existing higher temp HP
			state.activateWildShape(wolfData);
			// 4 × 4 = 16, but 20 > 16, so keep 20
			expect(state.getTempHp()).toBe(20);
		});

		test("wild shape temp HP should override lower existing temp HP", () => {
			state.setTempHp(5); // Existing lower temp HP
			state.activateWildShape(wolfData);
			// 4 × 4 = 16, 16 > 5, so update to 16
			expect(state.getTempHp()).toBe(16);
		});
	});

	// ===================================================================
	// WILD SHAPE — ACTIVATION / DEACTIVATION FLOW
	// ===================================================================
	describe("Wild Shape Activation Flow", () => {
		const wolfData = {
			name: "Wolf",
			ac: 13,
			hp: {max: 11},
			abilities: {str: 12, dex: 15, con: 12, int: 3, wis: 12, cha: 6},
			speed: {walk: 40},
			senses: ["darkvision 30 ft."],
		};

		const bearData = {
			name: "Brown Bear",
			ac: 11,
			hp: {max: 34},
			abilities: {str: 19, dex: 10, con: 16, int: 2, wis: 13, cha: 7},
			speed: {walk: 40, climb: 30},
		};

		beforeEach(() => {
			state.addClass({name: "Druid", source: "PHB", level: 4});
		});

		test("activateWildShape should return a state ID", () => {
			const id = state.activateWildShape(wolfData);
			expect(id).toBeDefined();
			expect(typeof id).toBe("string");
		});

		test("activateWildShape should deactivate existing wild shape first", () => {
			state.activateWildShape(wolfData);
			expect(state.getAbilityScore("str")).toBe(12); // Wolf STR
			state.activateWildShape(bearData);
			expect(state.getAbilityScore("str")).toBe(19); // Bear STR (wolf deactivated)
		});

		test("deactivateWildShape should be safe to call when not in wild shape", () => {
			expect(() => state.deactivateWildShape()).not.toThrow();
		});

		test("wild shape state should have name reflecting beast form", () => {
			state.activateWildShape(wolfData);
			const wsState = state._data.activeStates.find(s => s.stateTypeId === "wildShape" && s.active);
			expect(wsState.name).toContain("Wolf");
		});
	});

	// ===================================================================
	// WILD SHAPE — BESTIARY PARSING
	// ===================================================================
	describe("activateWildShapeFromBestiary", () => {
		beforeEach(() => {
			state.addClass({name: "Druid", source: "PHB", level: 4});
		});

		test("should parse a basic beast from bestiary format", () => {
			const wolfBestiary = {
				name: "Wolf",
				source: "MM",
				size: ["M"],
				type: "beast",
				ac: [{ac: 13, from: ["natural armor"]}],
				hp: {average: 11, formula: "2d8 + 2"},
				speed: {walk: 40},
				str: 12,
				dex: 15,
				con: 12,
				int: 3,
				wis: 12,
				cha: 6,
				skill: {perception: "+3", stealth: "+4"},
				senses: ["darkvision 30 ft."],
				passive: 13,
				trait: [{name: "Pack Tactics", entries: ["Advantage when ally adjacent"]}],
				action: [{name: "Bite", entries: ["{@atk mw} +4 to hit, 2d4+2 piercing"]}],
			};

			state.activateWildShapeFromBestiary(wolfBestiary);

			expect(state.isInWildShape()).toBe(true);
			expect(state.getAbilityScore("str")).toBe(12);
			expect(state.getAbilityScore("dex")).toBe(15);
			expect(state.getAc()).toBe(13);

			const beastData = state.getWildShapeBeastData();
			expect(beastData.name).toBe("Wolf");
			expect(beastData.size).toBe("M");
			expect(beastData.creatureType).toBe("beast");
			expect(beastData.traits.length).toBe(1);
			expect(beastData.actions.length).toBe(1);
		});

		test("should handle numeric AC format", () => {
			const creature = {
				name: "Cat",
				source: "MM",
				ac: 12,
				hp: {average: 2},
				str: 3,
				dex: 15,
				con: 10,
				int: 3,
				wis: 12,
				cha: 7,
			};
			state.activateWildShapeFromBestiary(creature);
			expect(state.getAc()).toBe(12);
		});

		test("should handle missing fields gracefully", () => {
			const minimal = {name: "Blob", str: 10, dex: 10, con: 10, int: 1, wis: 1, cha: 1};
			state.activateWildShapeFromBestiary(minimal);
			expect(state.isInWildShape()).toBe(true);
			expect(state.getAbilityScore("str")).toBe(10);
		});
	});

	// ===================================================================
	// EXISTING EFFECTS REGRESSION TESTS
	// ===================================================================
	describe("Existing Active State Effects — Regression", () => {
		test("Bladesong should add INT to AC", () => {
			state.addClass({name: "Wizard", source: "PHB", level: 2, subclass: {name: "Bladesinging"}});
			const baseAc = state.getAc();
			state.activateState("bladesong");
			// INT = 16 → mod +3
			expect(state.getAc()).toBe(baseAc + 3);
		});

		test("Dodge should grant advantage on DEX saves", () => {
			state.activateState("dodge");
			expect(state.hasAdvantageFromStates("save:dex")).toBe(true);
		});

		test("Prone should add disadvantage on own attacks", () => {
			state.activateState("prone");
			expect(state.hasDisadvantageFromStates("attack")).toBe(true);
		});

		test("Defensive Stance should add +2 AC and disadvantage on attacks", () => {
			const baseAc = state.getAc();
			state.activateState("defensiveStance");
			expect(state.getAc()).toBe(baseAc + 2);
			expect(state.hasDisadvantageFromStates("attack")).toBe(true);
		});

		test("Rage should be exclusive with Bladesong", () => {
			state.addClass({name: "Barbarian", source: "PHB", level: 1});
			state.activateState("bladesong");
			expect(state.isStateTypeActive("bladesong")).toBe(true);
			state.activateState("rage");
			expect(state.isStateTypeActive("rage")).toBe(true);
			expect(state.isStateTypeActive("bladesong")).toBe(false);
		});

		test("Rage should break concentration", () => {
			state.addClass({name: "Barbarian", source: "PHB", level: 1});
			state.setConcentration("Bless", 1);
			expect(state.getConcentration()).not.toBeNull();
			state.activateState("rage");
			expect(state.getConcentration()).toBeNull();
		});

		test("Reckless Attack should grant advantage on melee STR attacks", () => {
			state.activateState("recklessAttack");
			expect(state.hasAdvantageFromStates("attack:melee:str")).toBe(true);
		});

		test("size increase from states should work", () => {
			const baseSize = state.getSize();
			state.addActiveState("custom", {
				name: "Enlarge",
				customEffects: [{type: "sizeIncrease", value: 1}],
			});
			const newSize = state.getSize();
			expect(newSize).not.toBe(baseSize);
		});

		test("extra damage from states should be queryable", () => {
			state.addActiveState("custom", {
				name: "Hex",
				customEffects: [{type: "extraDamage", dice: "1d6", damageType: "necrotic"}],
			});
			const extras = state.getExtraDamageFromStates();
			expect(extras.length).toBe(1);
			expect(extras[0].dice).toBe("1d6");
			expect(extras[0].damageType).toBe("necrotic");
		});

		test("sense bonus from states should be queryable", () => {
			state.addActiveState("custom", {
				name: "Darkvision Spell",
				customEffects: [{type: "sense", target: "darkvision", value: 60}],
			});
			const bonus = state.getSenseBonusFromStates("darkvision");
			expect(bonus).toBe(60);
		});
	});

	// ===================================================================
	// EDGE CASES
	// ===================================================================
	describe("Edge Cases", () => {
		test("getSpeedBonusFromStates should return 0 with no active states", () => {
			expect(state.getSpeedBonusFromStates("walk")).toBe(0);
			expect(state.getSpeedBonusFromStates("fly")).toBe(0);
		});

		test("getResistances should work with no states and no base resistances", () => {
			expect(state.getResistances()).toEqual([]);
		});

		test("getEffectiveDefenses should work with empty data", () => {
			const defenses = state.getEffectiveDefenses();
			expect(defenses.resistances).toEqual([]);
			expect(defenses.immunities).toEqual([]);
			expect(defenses.vulnerabilities).toEqual([]);
			expect(defenses.conditionImmunities).toEqual([]);
		});

		test("wild shape methods should handle missing beast data gracefully", () => {
			expect(state.getWildShapeBeastData()).toBeNull();
			expect(state.getWildShapeHp()).toBeNull();
			expect(() => state.deactivateWildShape()).not.toThrow();
			expect(state.damageWildShape(10).beastHpLost).toBe(0);
			expect(state.healWildShape(10)).toBe(0);
		});

		test("wild shape should handle beast with 0 HP", () => {
			state.addClass({name: "Druid", source: "PHB", level: 4});
			const weakBeast = {
				name: "Tiny Bug",
				ac: 8,
				hp: {max: 1},
				abilities: {str: 1, dex: 1, con: 1, int: 1, wis: 1, cha: 1},
			};
			state.setHp(30);
			state.activateWildShape(weakBeast);
			const result = state.damageWildShape(5);
			expect(result.beastDropped).toBe(true);
			expect(result.overflowDamage).toBe(4);
			expect(state.getCurrentHp()).toBe(26);
		});

		test("isInWildShape should be false after deactivation even with state object remaining", () => {
			state.addClass({name: "Druid", source: "PHB", level: 4});
			state.activateWildShape({
				name: "Cat",
				ac: 12,
				hp: {max: 2},
				abilities: {str: 3, dex: 15, con: 10, int: 3, wis: 12, cha: 7},
			});
			expect(state.isInWildShape()).toBe(true);
			state.deactivateWildShape();
			expect(state.isInWildShape()).toBe(false);
		});
	});
});
