
import "./setup.js"; // Import first to set up mocks

let CharacterSheetState;
let state;

beforeAll(async () => {
	CharacterSheetState = (await import("../../../js/charactersheet/charactersheet-state.js")).CharacterSheetState;
});

describe("Character Sheet Companions", () => {
	beforeEach(() => {
		state = new CharacterSheetState();
		state.setAbilityBase("str", 16);
		state.setAbilityBase("dex", 14);
		state.setAbilityBase("con", 14);
		state.setAbilityBase("int", 16); // High INT for artificer
		state.setAbilityBase("wis", 14); // Good WIS for ranger
		state.setAbilityBase("cha", 10);
	});

	// ===================================================================
	// COMPANION TYPES
	// ===================================================================
	describe("Companion Types", () => {
		test("should define all companion type constants", () => {
			expect(CharacterSheetState.COMPANION_TYPES.BEAST_COMPANION).toBe("beast_companion");
			expect(CharacterSheetState.COMPANION_TYPES.DRAKE).toBe("drake");
			expect(CharacterSheetState.COMPANION_TYPES.STEEL_DEFENDER).toBe("steel_defender");
			expect(CharacterSheetState.COMPANION_TYPES.FAMILIAR).toBe("familiar");
			expect(CharacterSheetState.COMPANION_TYPES.WILD_SHAPE).toBe("wild_shape");
			expect(CharacterSheetState.COMPANION_TYPES.SUMMON).toBe("summon");
			expect(CharacterSheetState.COMPANION_TYPES.MOUNT).toBe("mount");
			expect(CharacterSheetState.COMPANION_TYPES.INFERNAL).toBe("infernal");
			expect(CharacterSheetState.COMPANION_TYPES.CUSTOM).toBe("custom");
		});
	});

	// ===================================================================
	// DATA MODEL — Default State
	// ===================================================================
	describe("Data Model", () => {
		test("should initialize with empty companions array", () => {
			expect(state._data.companions).toBeDefined();
			expect(Array.isArray(state._data.companions)).toBe(true);
			expect(state._data.companions.length).toBe(0);
		});

		test("getCompanions should return empty array initially", () => {
			expect(state.getCompanions()).toEqual([]);
		});
	});

	// ===================================================================
	// ADD COMPANION
	// ===================================================================
	describe("addCompanion", () => {
		test("should add a basic companion", () => {
			const id = state.addCompanion({
				name: "Wolf",
				type: "beast_companion",
				origin: "Beast Master",
			});

			expect(id).toBeDefined();
			const companions = state.getCompanions();
			expect(companions.length).toBe(1);
			expect(companions[0].name).toBe("Wolf");
			expect(companions[0].type).toBe("beast_companion");
		});

		test("should assign unique IDs", () => {
			const id1 = state.addCompanion({name: "Wolf", type: "beast_companion"});
			const id2 = state.addCompanion({name: "Cat", type: "familiar"});
			expect(id1).not.toBe(id2);
		});

		test("should set default ability scores to 10", () => {
			state.addCompanion({name: "Custom Pet", type: "custom"});
			const companion = state.getCompanions()[0];
			expect(companion.abilities.str).toBe(10);
			expect(companion.abilities.dex).toBe(10);
			expect(companion.abilities.con).toBe(10);
			expect(companion.abilities.int).toBe(10);
			expect(companion.abilities.wis).toBe(10);
			expect(companion.abilities.cha).toBe(10);
		});

		test("should accept custom ability scores", () => {
			state.addCompanion({
				name: "Wolf",
				type: "beast_companion",
				abilities: {str: 14, dex: 15, con: 13, int: 3, wis: 12, cha: 6},
			});
			const companion = state.getCompanions()[0];
			expect(companion.abilities.str).toBe(14);
			expect(companion.abilities.int).toBe(3);
		});

		test("should set HP correctly", () => {
			state.addCompanion({
				name: "Wolf",
				type: "beast_companion",
				hp: {max: 11, current: 11},
			});
			const companion = state.getCompanions()[0];
			expect(companion.hp.max).toBe(11);
			expect(companion.hp.current).toBe(11);
			expect(companion.hp.temp).toBe(0);
		});

		test("should default HP current to max if not specified", () => {
			state.addCompanion({
				name: "Wolf",
				type: "beast_companion",
				hp: {max: 20},
			});
			const companion = state.getCompanions()[0];
			expect(companion.hp.current).toBe(20);
		});

		test("should set speed correctly", () => {
			state.addCompanion({
				name: "Eagle",
				type: "familiar",
				speed: {walk: 10, fly: 60},
			});
			const companion = state.getCompanions()[0];
			expect(companion.speed.walk).toBe(10);
			expect(companion.speed.fly).toBe(60);
			expect(companion.speed.swim).toBe(0);
		});

		test("should start active by default", () => {
			state.addCompanion({name: "Wolf", type: "beast_companion"});
			expect(state.getCompanions()[0].active).toBe(true);
		});

		test("should start with empty conditions", () => {
			state.addCompanion({name: "Wolf", type: "beast_companion"});
			expect(state.getCompanions()[0].conditions).toEqual([]);
		});

		test("should use character proficiency bonus by default", () => {
			state.addClass({name: "Ranger", source: "PHB", level: 5});
			state.addCompanion({name: "Wolf", type: "beast_companion"});
			const companion = state.getCompanions()[0];
			expect(companion.profBonus).toBe(state.getProficiencyBonus());
		});

		test("should accept custom proficiency bonus", () => {
			state.addCompanion({name: "Wolf", type: "beast_companion", profBonus: 4});
			expect(state.getCompanions()[0].profBonus).toBe(4);
		});

		test("should store defenses", () => {
			state.addCompanion({
				name: "Steel Defender",
				type: "steel_defender",
				immunities: ["poison"],
				conditionImmunities: ["charmed", "exhaustion", "poisoned"],
			});
			const companion = state.getCompanions()[0];
			expect(companion.immunities).toContain("poison");
			expect(companion.conditionImmunities).toContain("charmed");
			expect(companion.conditionImmunities.length).toBe(3);
		});

		test("should store stat block entries (traits, actions, reactions)", () => {
			state.addCompanion({
				name: "Wolf",
				type: "beast_companion",
				traits: [{name: "Pack Tactics", entries: ["Advantage when ally is near"]}],
				actions: [{name: "Bite", entries: ["{@atk mw} +4 to hit, 2d4+2 piercing"]}],
			});
			const companion = state.getCompanions()[0];
			expect(companion.traits.length).toBe(1);
			expect(companion.traits[0].name).toBe("Pack Tactics");
			expect(companion.actions.length).toBe(1);
			expect(companion.actions[0].name).toBe("Bite");
		});

		test("should set concentration linked flag", () => {
			state.addCompanion({
				name: "Summoned Beast",
				type: "summon",
				concentrationLinked: true,
			});
			expect(state.getCompanions()[0].concentrationLinked).toBe(true);
		});
	});

	// ===================================================================
	// GET COMPANION
	// ===================================================================
	describe("getCompanion", () => {
		test("should retrieve by ID", () => {
			const id = state.addCompanion({name: "Wolf", type: "beast_companion"});
			const companion = state.getCompanion(id);
			expect(companion).toBeDefined();
			expect(companion.name).toBe("Wolf");
		});

		test("should return null for invalid ID", () => {
			expect(state.getCompanion("nonexistent")).toBeNull();
		});
	});

	// ===================================================================
	// GET COMPANIONS BY TYPE
	// ===================================================================
	describe("getCompanionsByType", () => {
		test("should filter by type", () => {
			state.addCompanion({name: "Wolf", type: "beast_companion"});
			state.addCompanion({name: "Cat", type: "familiar"});
			state.addCompanion({name: "Hawk", type: "familiar"});

			const familiars = state.getCompanionsByType("familiar");
			expect(familiars.length).toBe(2);
			expect(familiars.every(c => c.type === "familiar")).toBe(true);
		});
	});

	// ===================================================================
	// GET ACTIVE COMPANIONS
	// ===================================================================
	describe("getActiveCompanions", () => {
		test("should only return active companions", () => {
			const id1 = state.addCompanion({name: "Wolf", type: "beast_companion"});
			state.addCompanion({name: "Cat", type: "familiar", active: false});

			const actives = state.getActiveCompanions();
			expect(actives.length).toBe(1);
			expect(actives[0].name).toBe("Wolf");
		});
	});

	// ===================================================================
	// REMOVE COMPANION
	// ===================================================================
	describe("removeCompanion", () => {
		test("should remove by ID", () => {
			const id = state.addCompanion({name: "Wolf", type: "beast_companion"});
			expect(state.getCompanions().length).toBe(1);

			const result = state.removeCompanion(id);
			expect(result).toBe(true);
			expect(state.getCompanions().length).toBe(0);
		});

		test("should return false for nonexistent ID", () => {
			expect(state.removeCompanion("nonexistent")).toBe(false);
		});

		test("should not affect other companions", () => {
			const id1 = state.addCompanion({name: "Wolf", type: "beast_companion"});
			const id2 = state.addCompanion({name: "Cat", type: "familiar"});

			state.removeCompanion(id1);
			expect(state.getCompanions().length).toBe(1);
			expect(state.getCompanions()[0].name).toBe("Cat");
		});
	});

	// ===================================================================
	// REMOVE COMPANIONS BY TYPE
	// ===================================================================
	describe("removeCompanionsByType", () => {
		test("should remove all companions of a type", () => {
			state.addCompanion({name: "Cat", type: "familiar"});
			state.addCompanion({name: "Owl", type: "familiar"});
			state.addCompanion({name: "Wolf", type: "beast_companion"});

			const removed = state.removeCompanionsByType("familiar");
			expect(removed).toBe(2);
			expect(state.getCompanions().length).toBe(1);
			expect(state.getCompanions()[0].name).toBe("Wolf");
		});
	});

	// ===================================================================
	// UPDATE COMPANION
	// ===================================================================
	describe("updateCompanion", () => {
		test("should update top-level fields", () => {
			const id = state.addCompanion({name: "Wolf", type: "beast_companion", ac: 13});
			state.updateCompanion(id, {ac: 15, customName: "Fangs"});

			const companion = state.getCompanion(id);
			expect(companion.ac).toBe(15);
			expect(companion.customName).toBe("Fangs");
		});

		test("should merge nested objects (abilities, hp, speed)", () => {
			const id = state.addCompanion({
				name: "Wolf",
				type: "beast_companion",
				abilities: {str: 14, dex: 15, con: 13, int: 3, wis: 12, cha: 6},
			});

			state.updateCompanion(id, {abilities: {str: 16}});
			const companion = state.getCompanion(id);
			expect(companion.abilities.str).toBe(16);
			expect(companion.abilities.dex).toBe(15); // Preserved
		});

		test("should not change ID", () => {
			const id = state.addCompanion({name: "Wolf", type: "beast_companion"});
			state.updateCompanion(id, {id: "hacked"});

			const companion = state.getCompanion(id);
			expect(companion.id).toBe(id);
		});

		test("should return false for nonexistent companion", () => {
			expect(state.updateCompanion("nonexistent", {ac: 20})).toBe(false);
		});
	});

	// ===================================================================
	// COMPANION NAMING
	// ===================================================================
	describe("Naming", () => {
		test("should set custom name", () => {
			const id = state.addCompanion({name: "Wolf", type: "beast_companion"});
			state.setCompanionName(id, "Shadow");
			expect(state.getCompanion(id).customName).toBe("Shadow");
		});

		test("getCompanionDisplayName should prefer customName", () => {
			const id = state.addCompanion({name: "Wolf", type: "beast_companion", customName: "Shadow"});
			expect(state.getCompanionDisplayName(id)).toBe("Shadow");
		});

		test("getCompanionDisplayName should fall back to name", () => {
			const id = state.addCompanion({name: "Wolf", type: "beast_companion"});
			expect(state.getCompanionDisplayName(id)).toBe("Wolf");
		});

		test("getCompanionDisplayName should return empty for invalid ID", () => {
			expect(state.getCompanionDisplayName("nonexistent")).toBe("");
		});
	});

	// ===================================================================
	// COMPANION HP MANAGEMENT
	// ===================================================================
	describe("HP Management", () => {
		let companionId;

		beforeEach(() => {
			companionId = state.addCompanion({
				name: "Wolf",
				type: "beast_companion",
				hp: {max: 20, current: 20, temp: 0},
			});
		});

		test("setCompanionHp should set current HP", () => {
			state.setCompanionHp(companionId, 15);
			expect(state.getCompanion(companionId).hp.current).toBe(15);
		});

		test("setCompanionHp should not exceed max", () => {
			state.setCompanionHp(companionId, 30);
			expect(state.getCompanion(companionId).hp.current).toBe(20);
		});

		test("setCompanionHp should not go below 0", () => {
			state.setCompanionHp(companionId, -5);
			expect(state.getCompanion(companionId).hp.current).toBe(0);
		});

		test("damageCompanion should reduce HP", () => {
			const result = state.damageCompanion(companionId, 7);
			expect(result.hpLost).toBe(7);
			expect(state.getCompanion(companionId).hp.current).toBe(13);
		});

		test("damageCompanion should absorb from temp HP first", () => {
			state.setCompanionTempHp(companionId, 5);
			const result = state.damageCompanion(companionId, 8);

			expect(result.tempAbsorbed).toBe(5);
			expect(result.hpLost).toBe(3);
			expect(state.getCompanion(companionId).hp.temp).toBe(0);
			expect(state.getCompanion(companionId).hp.current).toBe(17);
		});

		test("damageCompanion should report droppedToZero", () => {
			const result = state.damageCompanion(companionId, 25);
			expect(result.droppedToZero).toBe(true);
			expect(state.getCompanion(companionId).hp.current).toBe(0);
		});

		test("healCompanion should restore HP", () => {
			state.setCompanionHp(companionId, 10);
			const healed = state.healCompanion(companionId, 5);
			expect(healed).toBe(5);
			expect(state.getCompanion(companionId).hp.current).toBe(15);
		});

		test("healCompanion should not exceed max", () => {
			state.setCompanionHp(companionId, 18);
			const healed = state.healCompanion(companionId, 10);
			expect(healed).toBe(2);
			expect(state.getCompanion(companionId).hp.current).toBe(20);
		});

		test("setCompanionTempHp should take higher value", () => {
			state.setCompanionTempHp(companionId, 5);
			expect(state.getCompanion(companionId).hp.temp).toBe(5);

			state.setCompanionTempHp(companionId, 3);
			expect(state.getCompanion(companionId).hp.temp).toBe(5); // Keeps higher

			state.setCompanionTempHp(companionId, 8);
			expect(state.getCompanion(companionId).hp.temp).toBe(8); // Takes higher
		});

		test("fullHealCompanion should restore to max and clear conditions", () => {
			state.setCompanionHp(companionId, 5);
			state.setCompanionTempHp(companionId, 3);
			state.addCompanionCondition(companionId, "poisoned");

			state.fullHealCompanion(companionId);
			const companion = state.getCompanion(companionId);
			expect(companion.hp.current).toBe(20);
			expect(companion.hp.temp).toBe(0);
			expect(companion.conditions.length).toBe(0);
		});
	});

	// ===================================================================
	// COMPANION CONDITIONS
	// ===================================================================
	describe("Conditions", () => {
		let companionId;

		beforeEach(() => {
			companionId = state.addCompanion({name: "Wolf", type: "beast_companion"});
		});

		test("should add a condition", () => {
			state.addCompanionCondition(companionId, "poisoned");
			expect(state.getCompanionConditions(companionId)).toContain("poisoned");
		});

		test("should not duplicate conditions", () => {
			state.addCompanionCondition(companionId, "poisoned");
			state.addCompanionCondition(companionId, "poisoned");
			expect(state.getCompanionConditions(companionId).length).toBe(1);
		});

		test("should remove a condition", () => {
			state.addCompanionCondition(companionId, "poisoned");
			state.addCompanionCondition(companionId, "frightened");
			state.removeCompanionCondition(companionId, "poisoned");
			expect(state.getCompanionConditions(companionId)).toEqual(["frightened"]);
		});

		test("should return empty array for invalid companion", () => {
			expect(state.getCompanionConditions("nonexistent")).toEqual([]);
		});
	});

	// ===================================================================
	// TOGGLE ACTIVE (SUMMON/DISMISS)
	// ===================================================================
	describe("Toggle Active", () => {
		test("should toggle active state", () => {
			const id = state.addCompanion({name: "Wolf", type: "beast_companion"});
			expect(state.getCompanion(id).active).toBe(true);

			const newState = state.toggleCompanion(id);
			expect(newState).toBe(false);
			expect(state.getCompanion(id).active).toBe(false);

			const restoredState = state.toggleCompanion(id);
			expect(restoredState).toBe(true);
		});
	});

	// ===================================================================
	// CONCENTRATION-LINKED COMPANIONS
	// ===================================================================
	describe("Concentration Linking", () => {
		test("should dismiss concentration-linked companions when concentration breaks", () => {
			state.addClass({name: "Wizard", source: "PHB", level: 5});

			// Add a concentration-linked summon
			const id = state.addCompanion({
				name: "Summoned Beast",
				type: "summon",
				concentrationLinked: true,
			});

			// Start concentrating on a spell
			state._data.concentrating = {spellName: "Summon Beast", spellLevel: 2};

			// Break concentration
			state.breakConcentration();

			// Companion should be dismissed (active = false)
			expect(state.getCompanion(id).active).toBe(false);
		});

		test("should not dismiss non-concentration companions", () => {
			const id1 = state.addCompanion({name: "Summoned Beast", type: "summon", concentrationLinked: true});
			const id2 = state.addCompanion({name: "Wolf", type: "beast_companion", concentrationLinked: false});

			state._data.concentrating = {spellName: "Summon Beast", spellLevel: 2};
			state.breakConcentration();

			expect(state.getCompanion(id1).active).toBe(false); // Dismissed
			expect(state.getCompanion(id2).active).toBe(true); // Not affected
		});

		test("should report correct count of dismissed companions", () => {
			state.addCompanion({name: "Summon A", type: "summon", concentrationLinked: true});
			state.addCompanion({name: "Summon B", type: "summon", concentrationLinked: true});
			state.addCompanion({name: "Wolf", type: "beast_companion"});

			const dismissed = state.dismissConcentrationCompanions();
			expect(dismissed).toBe(2);
		});
	});

	// ===================================================================
	// COMPANION ABILITY CALCULATIONS
	// ===================================================================
	describe("Ability Calculations", () => {
		let companionId;

		beforeEach(() => {
			companionId = state.addCompanion({
				name: "Wolf",
				type: "beast_companion",
				abilities: {str: 14, dex: 15, con: 13, int: 3, wis: 12, cha: 6},
				saveProficiencies: ["dex", "con"],
				skillProficiencies: {perception: 1, stealth: 2},
				profBonus: 3,
			});
		});

		test("should calculate ability modifiers", () => {
			expect(state.getCompanionAbilityMod(companionId, "str")).toBe(2); // 14 → +2
			expect(state.getCompanionAbilityMod(companionId, "dex")).toBe(2); // 15 → +2
			expect(state.getCompanionAbilityMod(companionId, "int")).toBe(-4); // 3 → -4
			expect(state.getCompanionAbilityMod(companionId, "wis")).toBe(1); // 12 → +1
		});

		test("should calculate save modifiers with proficiency", () => {
			// DEX save (proficient): 2 + 3 = 5
			expect(state.getCompanionSaveMod(companionId, "dex")).toBe(5);
			// CON save (proficient): 1 + 3 = 4
			expect(state.getCompanionSaveMod(companionId, "con")).toBe(4);
			// STR save (not proficient): 2
			expect(state.getCompanionSaveMod(companionId, "str")).toBe(2);
		});

		test("should calculate skill modifiers with proficiency", () => {
			// Perception (proficient, WIS-based): 1 + 3 = 4
			expect(state.getCompanionSkillMod(companionId, "perception")).toBe(4);
			// Stealth (expertise, DEX-based): 2 + 6 = 8
			expect(state.getCompanionSkillMod(companionId, "stealth")).toBe(8);
			// Athletics (not proficient, STR-based): 2
			expect(state.getCompanionSkillMod(companionId, "athletics")).toBe(2);
		});
	});

	// ===================================================================
	// STEEL DEFENDER — Battle Smith Artificer
	// ===================================================================
	describe("Steel Defender", () => {
		test("should calculate HP based on artificer level and INT", () => {
			// INT mod = +3 (16 INT)
			state.addClass({name: "Artificer",
				source: "TCE",
				level: 5,
				subclass: {name: "battle smith"}});

			const id = state.addCompanion({
				name: "Steel Defender",
				type: "steel_defender",
				hp: {max: 1}, // Will be recalculated
				ac: 15,
			});

			state.recalculateCompanion(id);
			const companion = state.getCompanion(id);

			// HP = 2 + INT mod (3) + 5 × level (5) = 2 + 3 + 25 = 30
			expect(companion.hp.max).toBe(30);
		});

		test("should scale HP when level increases", () => {
			state.addClass({name: "Artificer",
				source: "TCE",
				level: 5,
				subclass: {name: "battle smith"}});

			const id = state.addCompanion({
				name: "Steel Defender",
				type: "steel_defender",
				hp: {max: 30, current: 30},
			});

			// Level up to 10
			state.addClass({name: "Artificer",
				source: "TCE",
				level: 10,
				subclass: {name: "battle smith"}});

			const companion = state.getCompanion(id);
			// HP = 2 + 3 + 5 × 10 = 55
			expect(companion.hp.max).toBe(55);
		});

		test("should cap current HP at new max if max decreased", () => {
			state.addClass({name: "Artificer",
				source: "TCE",
				level: 5,
				subclass: {name: "battle smith"}});

			const id = state.addCompanion({
				name: "Steel Defender",
				type: "steel_defender",
				hp: {max: 100, current: 100}, // Overly high
			});

			state.recalculateCompanion(id);
			// HP = 30, current should be capped
			expect(state.getCompanion(id).hp.current).toBe(30);
		});
	});

	// ===================================================================
	// BEAST COMPANION — Beast Master Ranger
	// ===================================================================
	describe("Beast Companion", () => {
		test("should calculate HP based on ranger level", () => {
			state.addClass({name: "Ranger",
				source: "PHB",
				level: 5,
				subclass: {name: "Beast Master"}});

			const id = state.addCompanion({
				name: "Primal Companion",
				type: "beast_companion",
				hp: {max: 1},
			});

			state.recalculateCompanion(id);
			// HP = 5 + 5 × ranger level (5) = 30
			expect(state.getCompanion(id).hp.max).toBe(30);
		});

		test("should use character proficiency bonus", () => {
			state.addClass({name: "Ranger",
				source: "PHB",
				level: 5,
				subclass: {name: "Beast Master"}});

			const id = state.addCompanion({name: "Wolf", type: "beast_companion"});
			state.recalculateCompanion(id);

			expect(state.getCompanion(id).profBonus).toBe(state.getProficiencyBonus());
		});
	});

	// ===================================================================
	// DRAKE COMPANION — Drakewarden Ranger
	// ===================================================================
	describe("Drake Companion", () => {
		test("should calculate HP based on ranger level", () => {
			state.addClass({name: "Ranger",
				source: "PHB",
				level: 7,
				subclass: {name: "Drakewarden"}});

			const id = state.addCompanion({
				name: "Drake",
				type: "drake",
				hp: {max: 1},
			});

			state.recalculateCompanion(id);
			// HP = 5 + 5 × 7 = 40
			expect(state.getCompanion(id).hp.max).toBe(40);
		});

		test("should gain fly speed at level 7 (Bond of Fang and Scale)", () => {
			state.addClass({name: "Ranger",
				source: "PHB",
				level: 7,
				subclass: {name: "Drakewarden"}});

			const id = state.addCompanion({name: "Drake", type: "drake"});
			state.recalculateCompanion(id);

			expect(state.getCompanion(id).speed.fly).toBe(40);
		});

		test("should become Large at level 15 (Perfected Bond)", () => {
			state.addClass({name: "Ranger",
				source: "PHB",
				level: 15,
				subclass: {name: "Drakewarden"}});

			const id = state.addCompanion({name: "Drake", type: "drake"});
			state.recalculateCompanion(id);

			expect(state.getCompanion(id).size).toBe("L");
		});
	});

	// ===================================================================
	// FAMILIAR — Animal Accomplice Wizard
	// ===================================================================
	describe("Familiar (Animal Accomplice)", () => {
		test("should calculate HP and INT based on wizard level", () => {
			state.addClass({name: "Wizard",
				source: "TGTT",
				level: 6,
				subclass: {name: "Order of the Animal Accomplice"}});

			const id = state.addCompanion({name: "Cat", type: "familiar"});
			state.recalculateCompanion(id);

			const companion = state.getCompanion(id);
			// HP = 3 × wizard level = 18
			expect(companion.hp.max).toBe(18);
			// INT = 8 + profBonus (3) = 11
			expect(companion.abilities.int).toBe(11);
		});
	});

	// ===================================================================
	// BESTIARY CONVERSION
	// ===================================================================
	describe("addCompanionFromBestiary", () => {
		test("should convert a basic creature stat block", () => {
			const wolfData = {
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
				senses: ["darkvision 60 ft."],
				passive: 13,
				languages: [],
				trait: [{name: "Pack Tactics", entries: ["Advantage when ally within 5 ft."]}],
				action: [{name: "Bite", entries: ["{@atk mw} +4 to hit, reach 5 ft. {@hit 4} 2d4+2 piercing"]}],
			};

			const id = state.addCompanionFromBestiary(wolfData, "beast_companion", "Beast Master");
			const companion = state.getCompanion(id);

			expect(companion.name).toBe("Wolf");
			expect(companion.source).toBe("MM");
			expect(companion.ac).toBe(13);
			expect(companion.hp.max).toBe(11);
			expect(companion.speed.walk).toBe(40);
			expect(companion.abilities.str).toBe(12);
			expect(companion.abilities.dex).toBe(15);
			expect(companion.size).toBe("M");
			expect(companion.creatureType).toBe("beast");
			expect(companion.senses).toContain("darkvision 60 ft.");
			expect(companion.passive).toBe(13);
			expect(companion.traits.length).toBe(1);
			expect(companion.actions.length).toBe(1);
			expect(companion.attacks.length).toBe(1); // Parsed from actions
			expect(companion.skillProficiencies.perception).toBe(1);
		});

		test("should handle special HP formulas (scaler companions)", () => {
			const steelDefenderData = {
				name: "Steel Defender",
				source: "TCE",
				type: "construct",
				ac: [{special: "15 (natural armor)"}],
				hp: {special: "2 + your Intelligence modifier + five times your artificer level"},
				speed: {walk: 40},
				str: 14,
				dex: 12,
				con: 14,
				int: 4,
				wis: 10,
				cha: 6,
				save: {dex: "+1 plus PB", con: "+2 plus PB"},
				immune: ["poison"],
				conditionImmune: ["charmed", "exhaustion", "poisoned"],
			};

			state.addClass({name: "Artificer",
				source: "TCE",
				level: 5,
				subclass: {name: "battle smith"}});

			const id = state.addCompanionFromBestiary(
				steelDefenderData,
				"steel_defender",
				"Battle Smith",
			);

			const companion = state.getCompanion(id);
			expect(companion.type).toBe("steel_defender");
			expect(companion.immunities).toContain("poison");
			expect(companion.conditionImmunities.length).toBe(3);
			expect(companion.saveProficiencies).toContain("dex");
			expect(companion.saveProficiencies).toContain("con");
			// HP should be recalculated: 2 + 3 + 25 = 30
			expect(companion.hp.max).toBe(30);
		});

		test("should handle numeric AC values", () => {
			const id = state.addCompanionFromBestiary(
				{name: "Cat", source: "MM", ac: 12, hp: {average: 2}, str: 3, dex: 15, con: 10, int: 3, wis: 12, cha: 7},
				"familiar",
				"Find Familiar",
			);
			expect(state.getCompanion(id).ac).toBe(12);
		});

		test("should set concentration linked via options", () => {
			const id = state.addCompanionFromBestiary(
				{name: "Summoned Beast", source: "TCE", hp: {average: 30}, str: 18, dex: 11, con: 16, int: 4, wis: 14, cha: 5},
				"summon",
				"Summon Beast",
				{concentrationLinked: true},
			);
			expect(state.getCompanion(id).concentrationLinked).toBe(true);
		});

		test("should set custom name via options", () => {
			const id = state.addCompanionFromBestiary(
				{name: "Cat", source: "MM", hp: {average: 2}, str: 3, dex: 15, con: 10, int: 3, wis: 12, cha: 7},
				"familiar",
				"Find Familiar",
				{customName: "Whiskers"},
			);
			expect(state.getCompanionDisplayName(id)).toBe("Whiskers");
		});
	});

	// ===================================================================
	// REST INTEGRATION
	// ===================================================================
	describe("Rest Integration", () => {
		test("long rest should restore companion HP and clear conditions", () => {
			const id = state.addCompanion({
				name: "Wolf",
				type: "beast_companion",
				hp: {max: 20, current: 5},
			});
			state.addCompanionCondition(id, "poisoned");

			state.restCompanions("long");

			const companion = state.getCompanion(id);
			expect(companion.hp.current).toBe(20);
			expect(companion.conditions.length).toBe(0);
		});

		test("long rest should reduce companion exhaustion", () => {
			const id = state.addCompanion({name: "Wolf", type: "beast_companion"});
			state.getCompanion(id).exhaustion = 2;

			state.restCompanions("long");
			expect(state.getCompanion(id).exhaustion).toBe(1);
		});

		test("short rest should not auto-heal companions", () => {
			const id = state.addCompanion({
				name: "Wolf",
				type: "beast_companion",
				hp: {max: 20, current: 10},
			});

			state.restCompanions("short");
			expect(state.getCompanion(id).hp.current).toBe(10); // Unchanged
		});

		test("onLongRest should restore companions", () => {
			state.addClass({name: "Ranger", source: "PHB", level: 5});
			const id = state.addCompanion({
				name: "Wolf",
				type: "beast_companion",
				hp: {max: 20, current: 5},
			});

			state.onLongRest();
			expect(state.getCompanion(id).hp.current).toBe(20);
		});
	});

	// ===================================================================
	// RECALCULATION ON LEVEL UP
	// ===================================================================
	describe("Level Up Recalculation", () => {
		test("addClass should trigger companion recalculation", () => {
			state.addClass({name: "Artificer",
				source: "TCE",
				level: 3,
				subclass: {name: "battle smith"}});

			const id = state.addCompanion({
				name: "Steel Defender",
				type: "steel_defender",
				hp: {max: 1, current: 1},
			});
			state.recalculateCompanion(id);
			const hpAtL3 = state.getCompanion(id).hp.max; // 2 + 3 + 15 = 20

			// Level up triggers recalculation
			state.addClass({name: "Artificer",
				source: "TCE",
				level: 8,
				subclass: {name: "battle smith"}});

			const hpAtL8 = state.getCompanion(id).hp.max; // 2 + 3 + 40 = 45
			expect(hpAtL8).toBeGreaterThan(hpAtL3);
			expect(hpAtL8).toBe(45);
		});
	});

	// ===================================================================
	// RECALCULATE ALL COMPANIONS
	// ===================================================================
	describe("recalculateAllCompanions", () => {
		test("should recalculate all companions", () => {
			state.addClass({name: "Ranger",
				source: "PHB",
				level: 5,
				subclass: {name: "Drakewarden"}});

			const id1 = state.addCompanion({name: "Drake", type: "drake", hp: {max: 1}});
			const id2 = state.addCompanion({name: "Wolf", type: "beast_companion", hp: {max: 1}});

			state.recalculateAllCompanions();

			// Both should have been recalculated
			expect(state.getCompanion(id1).hp.max).toBe(30); // 5 + 5×5
			expect(state.getCompanion(id1).profBonus).toBe(state.getProficiencyBonus());
		});
	});

	// ===================================================================
	// MULTIPLE COMPANIONS
	// ===================================================================
	describe("Multiple Companions", () => {
		test("should support multiple companions simultaneously", () => {
			state.addCompanion({name: "Wolf", type: "beast_companion"});
			state.addCompanion({name: "Cat", type: "familiar"});
			state.addCompanion({name: "Drake", type: "drake"});

			expect(state.getCompanions().length).toBe(3);
		});

		test("should track HP independently", () => {
			const id1 = state.addCompanion({name: "Wolf", type: "beast_companion", hp: {max: 20, current: 20}});
			const id2 = state.addCompanion({name: "Cat", type: "familiar", hp: {max: 2, current: 2}});

			state.damageCompanion(id1, 10);
			expect(state.getCompanion(id1).hp.current).toBe(10);
			expect(state.getCompanion(id2).hp.current).toBe(2); // Unaffected
		});

		test("should track conditions independently", () => {
			const id1 = state.addCompanion({name: "Wolf", type: "beast_companion"});
			const id2 = state.addCompanion({name: "Cat", type: "familiar"});

			state.addCompanionCondition(id1, "poisoned");
			expect(state.getCompanionConditions(id1)).toContain("poisoned");
			expect(state.getCompanionConditions(id2)).toEqual([]);
		});
	});

	// ===================================================================
	// _getClassLevel HELPER
	// ===================================================================
	describe("_getClassLevel", () => {
		test("should return class level", () => {
			state.addClass({name: "Ranger", source: "PHB", level: 7});
			expect(state._getClassLevel("Ranger")).toBe(7);
		});

		test("should be case-insensitive", () => {
			state.addClass({name: "Ranger", source: "PHB", level: 7});
			expect(state._getClassLevel("ranger")).toBe(7);
		});

		test("should return 0 for non-existent class", () => {
			expect(state._getClassLevel("Paladin")).toBe(0);
		});
	});

	// ===================================================================
	// EDGE CASES
	// ===================================================================
	describe("Edge Cases", () => {
		test("methods should handle null companion gracefully", () => {
			state.setCompanionHp("nonexistent", 10); // No error
			expect(state.damageCompanion("nonexistent", 10).hpLost).toBe(0);
			expect(state.healCompanion("nonexistent", 10)).toBe(0);
			state.setCompanionTempHp("nonexistent", 10); // No error
			state.fullHealCompanion("nonexistent"); // No error
			state.addCompanionCondition("nonexistent", "poisoned"); // No error
			state.removeCompanionCondition("nonexistent", "poisoned"); // No error
			expect(state.getCompanionAbilityMod("nonexistent", "str")).toBe(0);
			expect(state.getCompanionSaveMod("nonexistent", "str")).toBe(0);
			expect(state.getCompanionSkillMod("nonexistent", "perception")).toBe(0);
		});

		test("recalculateCompanion should handle nonexistent companion", () => {
			state.recalculateCompanion("nonexistent"); // Should not throw
		});

		test("should handle companion with missing fields", () => {
			const id = state.addCompanion({name: "Minimal", type: "custom"});
			const companion = state.getCompanion(id);
			expect(companion.hp.max).toBe(1);
			expect(companion.ac).toBe(10);
			expect(companion.speed.walk).toBe(30);
		});

		test("getCompanions should return a copy, not a reference", () => {
			state.addCompanion({name: "Wolf", type: "beast_companion"});
			const companions = state.getCompanions();
			companions.push({name: "Fake"});
			expect(state.getCompanions().length).toBe(1); // Original unchanged
		});
	});
});
