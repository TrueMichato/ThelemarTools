/**
 * TGTT Combat Methods Survey — Phase D
 *
 * Tests parsing accuracy for all 17 traditions with representative methods,
 * stance-speed integration, subclass tradition auto-granting, and parser edge cases.
 *
 * Traditions: AM, AK, BU, BZ, CJ, EB, GH, MG, MS, RC, RE, SK, SS, TI, TC, UW, UH
 */

import "./setup.js";

let CharacterSheetState;
let state;

beforeAll(async () => {
	CharacterSheetState = (await import("../../../js/charactersheet/charactersheet-state.js")).CharacterSheetState;
});

// =========================================================================
// HELPERS
// =========================================================================

function makeTGTTFighter (level, subclass) {
	state.addClass({
		name: "Fighter",
		source: "TGTT",
		level,
		hitDice: "d10",
		subclass: subclass ? {name: subclass, shortName: subclass, source: "TGTT"} : undefined,
	});
	state.setAbilityBase("str", 16); // +3
	state.setAbilityBase("dex", 14); // +2
	state.setAbilityBase("con", 14); // +2
	state.setAbilityBase("wis", 12); // +1
}

function makeTGTTMonk (level) {
	state.addClass({
		name: "Monk",
		source: "TGTT",
		level,
		hitDice: "d8",
	});
	state.setAbilityBase("dex", 16); // +3
	state.setAbilityBase("wis", 16); // +3
	state.setAbilityBase("str", 10);
}

function addMethod (name, tradition, degree, description) {
	const types = [`CTM:${degree}${tradition}`, `CTM:${tradition}`, "CTM"];
	state.addFeature({
		name,
		source: "TGTT",
		featureType: "Optional Feature",
		optionalFeatureTypes: types,
		description,
	});
}

// =========================================================================
// TRADITION PARSING SURVEY — One representative method per tradition
// =========================================================================

describe("Combat Methods Survey — Tradition Parsing", () => {

	beforeEach(() => {
		state = new CharacterSheetState();
		makeTGTTFighter(5);
		state.addCombatTradition("Adamant Mountain");
	});

	// --- AM: Adamant Mountain ---
	it("AM — should parse action + stamina cost + save type", () => {
		addMethod("Power Strike", "AM", 1,
			"Action (1 Stamina Point). Make a melee weapon attack against a creature within reach.");
		const methods = state.getCombatMethods();
		const m = methods.find(x => x.name === "Power Strike");
		expect(m.tradition).toBe("AM");
		expect(m.degree).toBe(1);
		expect(m.staminaCost).toBe(1);
		expect(m.actionType).toBe("Action");
		expect(m.isStance).toBe(false);
	});

	// --- AK: Arcane Knight ---
	it("AK — should parse bonus action + save", () => {
		addMethod("Eldritch Ward", "AK", 1,
			"Bonus Action (1 Stamina Point). You create a magical ward. A creature that attacks you must make an Intelligence saving throw or lose its reaction.");
		const m = state.getCombatMethods().find(x => x.name === "Eldritch Ward");
		expect(m.tradition).toBe("AK");
		expect(m.degree).toBe(1);
		expect(m.actionType).toBe("Bonus Action");
		expect(m.saveType).toBe("intelligence");
		expect(m.staminaCost).toBe(1);
	});

	// --- BU: Beast Unity ---
	it("BU — should parse stance with speed bonus", () => {
		addMethod("Feral Stance", "BU", 1,
			"Bonus Action (1 Stamina Point). You adopt a primal stance. Your Speed increases by 10 feet. This stance lasts until you end it or are incapacitated.");
		const m = state.getCombatMethods().find(x => x.name === "Feral Stance");
		expect(m.tradition).toBe("BU");
		expect(m.degree).toBe(1);
		expect(m.isStance).toBe(true);
		expect(m.stanceEffects.speedBonus).toBe(10);
	});

	// --- BZ: Biting Zephyr ---
	it("BZ — should parse ranged method with advantage", () => {
		addMethod("Gale Shot", "BZ", 2,
			"Action (2 Stamina Points). You fire a projectile with a normal range of 30 feet and long range of 120 feet. You have advantage on attack rolls made with this method.");
		const m = state.getCombatMethods().find(x => x.name === "Gale Shot");
		expect(m.tradition).toBe("BZ");
		expect(m.degree).toBe(2);
		expect(m.range).toEqual({normal: 30, long: 120});
		expect(m.grantsAdvantage).toBe(true);
		expect(m.staminaCost).toBe(2);
	});

	// --- CJ: Comedic Jabs ---
	it("CJ — should parse bonus action + Wisdom save", () => {
		addMethod("Distracting Quip", "CJ", 1,
			"Bonus Action (1 Stamina Point). You taunt a creature within 30 feet. It must make a Wisdom saving throw or have disadvantage on its next attack.");
		const m = state.getCombatMethods().find(x => x.name === "Distracting Quip");
		expect(m.tradition).toBe("CJ");
		expect(m.degree).toBe(1);
		expect(m.actionType).toBe("Bonus Action");
		expect(m.saveType).toBe("wisdom");
	});

	// --- EB: Eldritch Blackguard ---
	it("EB — should parse Wisdom save from debuff", () => {
		addMethod("Blackguard's Blight", "EB", 1,
			"Bonus Action (1 Stamina Point). It must make a Wisdom save or be unable to gain advantage on attacks.");
		const m = state.getCombatMethods().find(x => x.name === "Blackguard's Blight");
		expect(m.tradition).toBe("EB");
		expect(m.degree).toBe(1);
		expect(m.saveType).toBe("wisdom");
	});

	// --- GH: Gallant Heart ---
	it("GH — should parse reaction + Constitution save", () => {
		addMethod("Shield Wall", "GH", 1,
			"Reaction (1 Stamina Point). When an ally within 5 feet is hit, you impose your shield. The attacker must make a Constitution saving throw or deal no damage.");
		const m = state.getCombatMethods().find(x => x.name === "Shield Wall");
		expect(m.tradition).toBe("GH");
		expect(m.degree).toBe(1);
		expect(m.actionType).toBe("Reaction");
		expect(m.saveType).toBe("constitution");
	});

	// --- MG: Mirror's Glint ---
	it("MG — should parse Charisma save on deception method", () => {
		addMethod("Phantom Feint", "MG", 2,
			"Action (2 Stamina Points). You create an illusory double. A creature attacking you must make a Charisma saving throw or target the illusion instead.");
		const m = state.getCombatMethods().find(x => x.name === "Phantom Feint");
		expect(m.tradition).toBe("MG");
		expect(m.degree).toBe(2);
		expect(m.saveType).toBe("charisma");
	});

	// --- MS: Mist and Shade ---
	it("MS — should parse stance with skill bonus", () => {
		addMethod("Shadow Stance", "MS", 1,
			"Bonus Action (1 Stamina Point). You enter a shadowy stance. You gain a bonus to Dexterity (Stealth) checks equal to your proficiency bonus. This stance lasts until you end it.");
		const m = state.getCombatMethods().find(x => x.name === "Shadow Stance");
		expect(m.tradition).toBe("MS");
		expect(m.isStance).toBe(true);
		expect(m.stanceEffects.skillBonuses).toEqual({stealth: "proficiency"});
	});

	// --- RC: Rapid Current ---
	it("RC — should parse multi-target method", () => {
		addMethod("Whirlwind Strike", "RC", 3,
			"Bonus Action (2 Stamina Points). You make a melee attack against any number of creatures within 5 feet of you.");
		const m = state.getCombatMethods().find(x => x.name === "Whirlwind Strike");
		expect(m.tradition).toBe("RC");
		expect(m.degree).toBe(3);
		expect(m.isMultiTarget).toBe(true);
	});

	// --- RE: Razor's Edge ---
	it("RE — should parse attack modifier with bonus damage", () => {
		addMethod("Precision Cut", "RE", 2,
			"Action (2 Stamina Points). Make a melee weapon attack as part of an attack. On a hit, deal an additional 2d6 damage.");
		const m = state.getCombatMethods().find(x => x.name === "Precision Cut");
		expect(m.tradition).toBe("RE");
		expect(m.degree).toBe(2);
		expect(m.actionType).toBe("Action");
		expect(m.bonusDamage).toEqual({die: "2d6", condition: null});
	});

	// --- SK: Sanguine Knot ---
	it("SK — should parse Constitution save on blood method", () => {
		addMethod("Crimson Bind", "SK", 1,
			"Action (1 Stamina Point). A creature within 15 feet must make a Constitution saving throw or take 1d8 necrotic damage and be restrained until end of your next turn.");
		const m = state.getCombatMethods().find(x => x.name === "Crimson Bind");
		expect(m.tradition).toBe("SK");
		expect(m.degree).toBe(1);
		expect(m.saveType).toBe("constitution");
	});

	// --- SS: Spirited Steed ---
	it("SS — should parse Dexterity save on mounted charge", () => {
		addMethod("Trampling Charge", "SS", 2,
			"Action (2 Stamina Points). While mounted, your steed charges through. Each creature in a line must make a Dexterity saving throw or take 2d8 bludgeoning damage.");
		const m = state.getCombatMethods().find(x => x.name === "Trampling Charge");
		expect(m.tradition).toBe("SS");
		expect(m.degree).toBe(2);
		expect(m.saveType).toBe("dexterity");
	});

	// --- TI: Tempered Iron ---
	it("TI — should parse stance with Athletics bonus", () => {
		addMethod("Wary Stance", "TI", 1,
			"Bonus Action (1 Stamina Point). You gain a bonus to Strength (Athletics) checks equal to your proficiency bonus on saving throws made to resist being moved. This stance lasts until you end it.");
		const m = state.getCombatMethods().find(x => x.name === "Wary Stance");
		expect(m.tradition).toBe("TI");
		expect(m.isStance).toBe(true);
		expect(m.stanceEffects.skillBonuses).toEqual({athletics: "proficiency"});
	});

	// --- TC: Tooth and Claw ---
	it("TC — should parse Strength save on grapple method", () => {
		addMethod("Rending Grasp", "TC", 1,
			"Action (1 Stamina Point). As part of an attack action, you grab a creature. It must make a Strength saving throw or be grappled.");
		const m = state.getCombatMethods().find(x => x.name === "Rending Grasp");
		expect(m.tradition).toBe("TC");
		expect(m.degree).toBe(1);
		expect(m.actionType).toBe("Action");
		expect(m.saveType).toBe("strength");
	});

	// --- UW: Unending Wheel ---
	it("UW — should parse ranged method with bonus weapon die", () => {
		addMethod("Wind Strike", "UW", 4,
			"Action (3 Stamina Points). You use a melee weapon to strike a foe from a distance, giving your attack a normal range of 20 feet and long range of 60 feet. You have advantage on attack rolls. If both attack rolls hit, deal an additional weapon damage die.");
		const m = state.getCombatMethods().find(x => x.name === "Wind Strike");
		expect(m.tradition).toBe("UW");
		expect(m.degree).toBe(4);
		expect(m.range).toEqual({normal: 20, long: 60});
		expect(m.grantsAdvantage).toBe(true);
		expect(m.bonusDamage).toEqual({die: "weapon", condition: "both attacks hit"});
	});

	// --- UH: Unerring Hawk ---
	it("UH — should parse ranged precision method", () => {
		addMethod("Eagle Eye Shot", "UH", 1,
			"Bonus Action (1 Stamina Point). You take careful aim. Your next ranged attack ignores half cover and three-quarters cover.");
		const m = state.getCombatMethods().find(x => x.name === "Eagle Eye Shot");
		expect(m.tradition).toBe("UH");
		expect(m.degree).toBe(1);
		expect(m.actionType).toBe("Bonus Action");
		expect(m.staminaCost).toBe(1);
	});
});

// =========================================================================
// STANCE-SPEED INTEGRATION
// =========================================================================

describe("Combat Methods Survey — Stance Speed Integration", () => {

	beforeEach(() => {
		state = new CharacterSheetState();
		makeTGTTFighter(5);
		state.addCombatTradition("Beast Unity");
	});

	it("should apply stance speed bonus to walk speed", () => {
		addMethod("Feral Stance", "BU", 1,
			"Bonus Action (1 Stamina Point). You adopt a primal stance. Your Speed increases by 10 feet. This stance lasts until you end it or are incapacitated.");

		const baseParts = state.getSpeed();
		state.activateStance("Feral Stance");

		const stanceParts = state.getSpeed();
		// Speed string should show 10 ft more
		const baseWalk = parseInt(baseParts.match(/(\d+)/)[1], 10);
		const stanceWalk = parseInt(stanceParts.match(/(\d+)/)[1], 10);
		expect(stanceWalk).toBe(baseWalk + 10);
	});

	it("should include stance bonus in getWalkSpeed()", () => {
		addMethod("Feral Stance", "BU", 1,
			"Bonus Action (1 Stamina Point). You adopt a primal stance. Your Speed increases by 10 feet. This stance lasts until you end it or are incapacitated.");

		const baseWalk = state.getWalkSpeed();
		state.activateStance("Feral Stance");
		expect(state.getWalkSpeed()).toBe(baseWalk + 10);
	});

	it("should include stance bonus in getSpeedBreakdown()", () => {
		addMethod("Feral Stance", "BU", 1,
			"Bonus Action (1 Stamina Point). You adopt a primal stance. Your Speed increases by 10 feet. This stance lasts until you end it or are incapacitated.");

		state.activateStance("Feral Stance");
		const breakdown = state.getSpeedBreakdown("walk");
		const stateComponent = breakdown.components.find(c => c.type === "state");
		expect(stateComponent).toBeDefined();
		expect(stateComponent.value).toBe(10);
	});

	it("should remove stance speed bonus when deactivated", () => {
		addMethod("Feral Stance", "BU", 1,
			"Bonus Action (1 Stamina Point). You adopt a primal stance. Your Speed increases by 10 feet. This stance lasts until you end it or are incapacitated.");

		const baseWalk = state.getWalkSpeed();
		state.activateStance("Feral Stance");
		expect(state.getWalkSpeed()).toBe(baseWalk + 10);

		state.deactivateStance();
		expect(state.getWalkSpeed()).toBe(baseWalk);
	});

	it("should NOT apply stance speed to non-walk speeds", () => {
		addMethod("Feral Stance", "BU", 1,
			"Bonus Action (1 Stamina Point). You adopt a primal stance. Your Speed increases by 10 feet. This stance lasts until you end it or are incapacitated.");

		state.setSpeed("fly", 30);
		state.activateStance("Feral Stance");
		expect(state.getSpeedByType("fly")).toBe(30);
	});

	it("should resolve proficiency placeholder in stance skill bonuses", () => {
		addMethod("Shadow Stance", "MS", 1,
			"Bonus Action (1 Stamina Point). You enter a shadowy stance. You gain a bonus to Dexterity (Stealth) checks equal to your proficiency bonus. This stance lasts until you end it.");

		state.activateStance("Shadow Stance");
		const calcs = state.getFeatureCalculations();
		expect(calcs.activeStanceEffects.skillBonuses.stealth).toBe(3); // prof at level 5
	});
});

// =========================================================================
// SUBCLASS TRADITION AUTO-GRANTING
// =========================================================================

describe("Combat Methods Survey — Subclass Tradition Granting", () => {

	beforeEach(() => {
		state = new CharacterSheetState();
	});

	it("Warder should auto-grant Tempered Iron + Gallant Heart on applyClassFeatureEffects", () => {
		makeTGTTFighter(3, "Warder");
		state.applyClassFeatureEffects();
		expect(state.hasCombatTradition("Tempered Iron")).toBe(true);
		expect(state.hasCombatTradition("Gallant Heart")).toBe(true);
	});

	it("Warder traditions should appear in getCombatTraditionEntries()", () => {
		makeTGTTFighter(3, "Warder");
		state.applyClassFeatureEffects();
		const entries = state.getCombatTraditionEntries();
		const codes = entries.map(e => e.code);
		expect(codes).toContain("TI");
		expect(codes).toContain("GH");
	});

	it("Warder should enable usesCombatSystem via auto-granted traditions", () => {
		makeTGTTFighter(3, "Warder");
		state.applyClassFeatureEffects();
		expect(state.usesCombatSystem()).toBe(true);
	});

	it("Warder should not duplicate traditions if manually added first", () => {
		makeTGTTFighter(3, "Warder");
		state.addCombatTradition("Tempered Iron");
		state.applyClassFeatureEffects();
		const entries = state.getCombatTraditionEntries();
		const tiCount = entries.filter(e => e.code === "TI").length;
		expect(tiCount).toBe(1);
	});

	it("should clear auto-granted traditions on re-apply", () => {
		makeTGTTFighter(3, "Warder");
		state.applyClassFeatureEffects();
		expect(state.hasCombatTradition("Gallant Heart")).toBe(true);

		// Simulate class change — re-clear and re-apply
		state._data.classes = [];
		state.addClass({
			name: "Fighter",
			source: "TGTT",
			level: 3,
			hitDice: "d10",
			subclass: {name: "Champion", shortName: "Champion", source: "PHB"},
		});
		state.setAbilityBase("str", 16);
		state.setAbilityBase("dex", 14);
		state.applyClassFeatureEffects();
		expect(state.hasCombatTradition("Gallant Heart")).toBe(false);
	});

	it("Warder auto-grant should coexist with manually-chosen traditions", () => {
		makeTGTTFighter(3, "Warder");
		state.addCombatTradition("Adamant Mountain");
		state.addCombatTradition("Rapid Current");
		state.applyClassFeatureEffects();

		expect(state.hasCombatTradition("Adamant Mountain")).toBe(true);
		expect(state.hasCombatTradition("Rapid Current")).toBe(true);
		expect(state.hasCombatTradition("Tempered Iron")).toBe(true);
		expect(state.hasCombatTradition("Gallant Heart")).toBe(true);
	});

	it("Warder L3 should compute hasWarderCombatMethods", () => {
		makeTGTTFighter(3, "Warder");
		const calcs = state.getFeatureCalculations();
		expect(calcs.hasWarderCombatMethods).toBe(true);
		expect(calcs.warderCombatTraditions).toContain("Tempered Iron");
		expect(calcs.warderCombatTraditions).toContain("Gallant Heart");
	});

	it("Warder below L3 should not grant traditions", () => {
		makeTGTTFighter(2);
		state.applyClassFeatureEffects();
		expect(state.hasCombatTradition("Tempered Iron")).toBe(false);
		expect(state.hasCombatTradition("Gallant Heart")).toBe(false);
	});

	// --- Arcane Archer (TGTT) ---
	it("TGTT Arcane Archer should NOT auto-grant Biting Zephyr (player choice)", () => {
		state.addClass({
			name: "Fighter",
			source: "TGTT",
			level: 3,
			hitDice: "d10",
			subclass: {name: "Arcane Archer", shortName: "Arcane Archer", source: "TGTT"},
		});
		state.applyClassFeatureEffects();
		// Arcane Archer chooses 2 from 4 traditions — no auto-grant
		expect(state.hasCombatTradition("Biting Zephyr")).toBe(false);
	});

	it("TGTT Arcane Archer should expose allowed traditions list", () => {
		state.addClass({
			name: "Fighter",
			source: "TGTT",
			level: 3,
			hitDice: "d10",
			subclass: {name: "Arcane Archer", shortName: "Arcane Archer", source: "TGTT"},
		});
		const calcs = state.getFeatureCalculations();
		expect(calcs.arcaneArcherAllowedTraditions).toEqual([
			"Biting Zephyr",
			"Razor's Edge",
			"Unending Wheel",
			"Unerring Hawk",
		]);
	});

	it("TGTT Arcane Archer should set hasArcaneArcherCombatMethods", () => {
		state.addClass({
			name: "Fighter",
			source: "TGTT",
			level: 3,
			hitDice: "d10",
			subclass: {name: "Arcane Archer", shortName: "Arcane Archer", source: "TGTT"},
		});
		const calcs = state.getFeatureCalculations();
		expect(calcs.hasArcaneArcherCombatMethods).toBe(true);
	});

	it("Non-TGTT Arcane Archer should NOT grant Biting Zephyr", () => {
		state.addClass({
			name: "Fighter",
			source: "PHB",
			level: 3,
			hitDice: "d10",
			subclass: {name: "Arcane Archer", shortName: "Arcane Archer", source: "XGE"},
		});
		state.applyClassFeatureEffects();
		expect(state.hasCombatTradition("Biting Zephyr")).toBe(false);
	});

	// --- Way of Mercy (TGTT) ---
	it("TGTT Mercy Monk should auto-grant Sanguine Knot", () => {
		state.addClass({
			name: "Monk",
			source: "TGTT",
			level: 3,
			hitDice: "d8",
			subclass: {name: "Way of Mercy", shortName: "Mercy", source: "TGTT"},
		});
		state.applyClassFeatureEffects();
		expect(state.hasCombatTradition("Sanguine Knot")).toBe(true);
	});

	it("TGTT Mercy Monk should set hasMercyCombatMethods", () => {
		state.addClass({
			name: "Monk",
			source: "TGTT",
			level: 3,
			hitDice: "d8",
			subclass: {name: "Way of Mercy", shortName: "Mercy", source: "TGTT"},
		});
		const calcs = state.getFeatureCalculations();
		expect(calcs.hasMercyCombatMethods).toBe(true);
	});

	it("Non-TGTT Mercy Monk should NOT grant Sanguine Knot", () => {
		state.addClass({
			name: "Monk",
			source: "TCE",
			level: 3,
			hitDice: "d8",
			subclass: {name: "Way of Mercy", shortName: "Mercy", source: "TCE"},
		});
		state.applyClassFeatureEffects();
		expect(state.hasCombatTradition("Sanguine Knot")).toBe(false);
	});
});

// =========================================================================
// PARSER EDGE CASES
// =========================================================================

describe("Combat Methods Survey — Parser Edge Cases", () => {

	beforeEach(() => {
		state = new CharacterSheetState();
		makeTGTTFighter(5);
		state.addCombatTradition("AM");
	});

	it("should handle multi-point stamina cost", () => {
		addMethod("Grand Slam", "AM", 5,
			"Action (5 Stamina Points). A massive overhead strike that hits all creatures in a 15-foot cone.");
		const m = state.getCombatMethods().find(x => x.name === "Grand Slam");
		expect(m.staminaCost).toBe(5);
		expect(m.degree).toBe(5);
	});

	it("should handle method with no stamina cost", () => {
		addMethod("Basic Counter", "AM", 1,
			"Reaction. When a creature misses you with a melee attack, you can make one melee weapon attack against it.");
		const m = state.getCombatMethods().find(x => x.name === "Basic Counter");
		expect(m.staminaCost).toBe(0);
		expect(m.actionType).toBe("Reaction");
	});

	it("should handle proficiency-capped multi-target", () => {
		addMethod("Fan of Blades", "AM", 3,
			"Action (3 Stamina Points). You attack any number of creatures within reach, up to your proficiency bonus.");
		const m = state.getCombatMethods().find(x => x.name === "Fan of Blades");
		expect(m.isMultiTarget).toBe(true);
		expect(m.maxTargets).toBe("proficiency");
	});

	it("should handle per-subsequent-hit bonus damage", () => {
		addMethod("Cascade Strike", "RC", 4,
			"Action (3 Stamina Points). Make a melee weapon attack against any number of creatures within 10 feet. Each subsequent hit deals an additional 1d6 damage per subsequent hit.");
		const m = state.getCombatMethods().find(x => x.name === "Cascade Strike");
		expect(m.isMultiTarget).toBe(true);
		expect(m.bonusDamage).toEqual({die: "1d6", condition: "per subsequent hit"});
	});

	it("should handle stance with difficult terrain ignore", () => {
		addMethod("Mountain Roots", "AM", 2,
			"Bonus Action (1 Stamina Point). You root yourself. You can ignore the first 10 feet of difficult terrain each turn. This stance lasts until you end it.");
		const m = state.getCombatMethods().find(x => x.name === "Mountain Roots");
		expect(m.isStance).toBe(true);
		expect(m.stanceEffects.otherEffects).toEqual([
			{type: "ignoreDifficultTerrain", amount: 10},
		]);
	});

	it("should handle method with 'as part of an attack' action type", () => {
		addMethod("Trip Attack", "TI", 1,
			"As part of an attack (1 Stamina Point), you attempt to trip the creature. It must make a Strength saving throw.");
		const m = state.getCombatMethods().find(x => x.name === "Trip Attack");
		expect(m.actionType).toBe("Attack");
		expect(m.saveType).toBe("strength");
	});

	it("should correctly extract 3-letter tradition codes", () => {
		// Some traditions could potentially have 3-letter codes
		state.addFeature({
			name: "Test Method",
			source: "TGTT",
			featureType: "Optional Feature",
			optionalFeatureTypes: ["CTM:2ABC", "CTM:ABC", "CTM"],
			description: "Action (1 Stamina Point). Test.",
		});
		const m = state.getCombatMethods().find(x => x.name === "Test Method");
		expect(m.tradition).toBe("ABC");
		expect(m.degree).toBe(2);
	});

	it("should handle method with only bare tradition type", () => {
		state.addFeature({
			name: "Bare Tradition",
			source: "TGTT",
			featureType: "Optional Feature",
			optionalFeatureTypes: ["CTM:AM", "CTM"],
			description: "Action. A basic attack.",
		});
		const m = state.getCombatMethods().find(x => x.name === "Bare Tradition");
		expect(m.tradition).toBe("AM");
		expect(m.degree).toBe(0);
	});
});

// =========================================================================
// DEGREE PROGRESSION ACROSS CLASSES
// =========================================================================

describe("Combat Methods Survey — Degree Progression", () => {

	beforeEach(() => {
		state = new CharacterSheetState();
	});

	const degreeCases = [
		{cls: "Fighter", levels: [{l: 1, d: 1}, {l: 4, d: 2}, {l: 8, d: 3}, {l: 12, d: 4}, {l: 16, d: 5}]},
		{cls: "Barbarian", levels: [{l: 2, d: 1}, {l: 5, d: 2}, {l: 9, d: 3}, {l: 12, d: 4}, {l: 17, d: 5}]},
		{cls: "Ranger", levels: [{l: 2, d: 1}, {l: 5, d: 2}, {l: 9, d: 3}, {l: 13, d: 4}, {l: 17, d: 5}]},
		{cls: "Monk", levels: [{l: 2, d: 1}, {l: 4, d: 2}, {l: 8, d: 3}, {l: 13, d: 4}, {l: 17, d: 5}]},
		{cls: "Paladin", levels: [{l: 2, d: 1}, {l: 7, d: 2}, {l: 13, d: 3}, {l: 19, d: 4}]},
		{cls: "Rogue", levels: [{l: 2, d: 1}, {l: 7, d: 2}, {l: 13, d: 3}, {l: 19, d: 4}]},
	];

	for (const {cls, levels} of degreeCases) {
		for (const {l, d} of levels) {
			it(`${cls} L${l} should have degree ${d}`, () => {
				state.addClass({name: cls, source: "TGTT", level: l, hitDice: "d10"});
				state.addCombatTradition("AM");
				expect(state.getMethodDegreeAccess()).toBe(d);
			});
		}
	}

	it("Fighter L3 should have degree 1 (between breakpoints)", () => {
		state.addClass({name: "Fighter", source: "TGTT", level: 3, hitDice: "d10"});
		state.addCombatTradition("AM");
		expect(state.getMethodDegreeAccess()).toBe(1);
	});

	it("non-TGTT class should have degree 0", () => {
		state.addClass({name: "Fighter", source: "PHB", level: 10, hitDice: "d10"});
		expect(state.getMethodDegreeAccess()).toBe(0);
	});
});

// =========================================================================
// COMBAT METHOD DC CALCULATION
// =========================================================================

describe("Combat Methods Survey — DC Calculation", () => {

	beforeEach(() => {
		state = new CharacterSheetState();
	});

	it("should use max(STR, DEX) for standard DC", () => {
		makeTGTTFighter(5);
		state.addCombatTradition("AM");
		state.applyClassFeatureEffects();
		const calcs = state.getFeatureCalculations();
		// DC = 8 + prof(3) + STR(3) = 14  (STR 16 > DEX 14)
		expect(calcs.combatMethodDc).toBe(14);
	});

	it("Monk should use max(STR, DEX, WIS) with +1 base", () => {
		makeTGTTMonk(5);
		state.addCombatTradition("RC");
		state.applyClassFeatureEffects();
		const calcs = state.getFeatureCalculations();
		// DC = 9 + prof(3) + WIS(3) = 15  (WIS 16 = DEX 16 > STR 10)
		expect(calcs.combatMethodDc).toBe(15);
		expect(calcs.monkCombatMethodDcBonus).toBe(true);
	});
});

// =========================================================================
// EXERTION POOL
// =========================================================================

describe("Combat Methods Survey — Stamina Pool", () => {

	beforeEach(() => {
		state = new CharacterSheetState();
		makeTGTTFighter(5);
		state.addCombatTradition("AM");
	});

	it("should have stamina max = 2 × prof", () => {
		state.ensureStaminaInitialized();
		expect(state.getStaminaMax()).toBe(6); // prof 3 × 2
	});

	it("should spend stamina for method use", () => {
		state.ensureStaminaInitialized();
		addMethod("Power Strike", "AM", 1,
			"Action (2 Stamina Points). Make a melee weapon attack.");
		const result = state.useCombatMethod("Power Strike");
		expect(result).toBe(true);
		expect(state.getStaminaCurrent()).toBe(4); // 6 - 2
	});

	it("should fail on insufficient stamina", () => {
		state.ensureStaminaInitialized();
		addMethod("Grand Slam", "AM", 5,
			"Action (5 Stamina Points). A massive overhead strike.");
		// Spend down to 1
		state.spendStamina(5);
		const result = state.useCombatMethod("Grand Slam");
		expect(result).toBe(false);
		expect(state.getStaminaCurrent()).toBe(1); // unchanged
	});

	it("should auto-activate stance on use", () => {
		state.ensureStaminaInitialized();
		addMethod("Heavy Stance", "AM", 1,
			"Bonus Action (1 Stamina Point). You enter a heavily-braced stance. This stance lasts until you end it.");
		state.useCombatMethod("Heavy Stance");
		expect(state.getActiveStance()).toBe("Heavy Stance");
	});
});

// =========================================================================
// STANCE ACTIVATION BRIDGE — activateStance/deactivateStance ↔ activeStates
// =========================================================================

describe("Combat Methods Survey — Stance Activation Bridge", () => {

	beforeEach(() => {
		state = new CharacterSheetState();
		makeTGTTFighter(5);
		state.addCombatTradition("Mirror's Glint");
		state.addCombatTradition("Mist and Shade");
	});

	it("should apply stance skill bonus when activated via activateStance()", () => {
		addMethod("Wary Stance", "MG", 1,
			"Bonus Action (1 Stamina Point). You gain a bonus to Wisdom (Insight) checks equal to your proficiency bonus. This stance lasts until you end it.");

		state.activateStance("Wary Stance");
		const calcs = state.getFeatureCalculations();
		expect(calcs.stanceSkillBonuses?.insight).toBe(3); // prof bonus at level 5
	});

	it("should clear stance skill bonus on deactivateStance()", () => {
		addMethod("Wary Stance", "MG", 1,
			"Bonus Action (1 Stamina Point). You gain a bonus to Wisdom (Insight) checks equal to your proficiency bonus. This stance lasts until you end it.");

		state.activateStance("Wary Stance");
		expect(state.getFeatureCalculations().stanceSkillBonuses?.insight).toBe(3);

		state.deactivateStance();
		const calcs = state.getFeatureCalculations();
		expect(calcs.stanceSkillBonuses).toBeUndefined();
	});

	it("should NOT double-count stance skill bonus via getSkillBonusFromStates()", () => {
		addMethod("Iron Stance", "TI", 1,
			"Bonus Action (1 Stamina Point). You gain a bonus to Strength (Athletics) checks equal to your proficiency bonus. This stance lasts until you end it.");

		// Activate stance — this sets _data.activeStance
		state.activateStance("Iron Stance");

		// Also simulate what the UI does — add as active state with parsed effects
		state.addActiveState("combatStance", {
			name: "Iron Stance",
			description: "Bonus Action (1 Stamina Point). You gain a bonus to Strength (Athletics) checks equal to your proficiency bonus. This stance lasts until you end it.",
			customEffects: [{type: "bonus", target: "check:str:athletics", useProficiency: true}],
		});

		// getSkillBonusFromStates should skip combatStance effects
		const stateBonus = state.getSkillBonusFromStates("athletics", "str");
		expect(stateBonus).toBe(0); // filtered out — stance system is authoritative

		// But the stance system itself should provide the bonus
		const calcs = state.getFeatureCalculations();
		expect(calcs.stanceSkillBonuses?.athletics).toBe(3);
	});

	it("should NOT double-count stance save bonus via getSaveBonusFromStates()", () => {
		addMethod("Guard Stance", "TI", 1,
			"Bonus Action (1 Stamina Point). You gain a bonus equal to your proficiency bonus on saving throws made to resist being moved. This stance lasts until you end it.");

		state.activateStance("Guard Stance");

		// Simulate UI adding as active state
		state.addActiveState("combatStance", {
			name: "Guard Stance",
			customEffects: [{type: "bonus", target: "save:resist-movement", useProficiency: true}],
		});

		// getSaveBonusFromStates should skip combatStance effects
		const stateBonus = state.getSaveBonusFromStates("str");
		expect(stateBonus).toBe(0);
	});
});

// =========================================================================
// PASSIVE BONUS PARSING & APPLICATION
// =========================================================================

describe("Combat Methods Survey — Passive Bonus Parsing", () => {

	beforeEach(() => {
		state = new CharacterSheetState();
		makeTGTTFighter(5);
		state.addCombatTradition("Mirror's Glint");
	});

	it("should parse passive bonus from stance description", () => {
		addMethod("Wary Stance", "MG", 1,
			"Bonus Action (1 Stamina Point). You gain a bonus to Wisdom (Insight) checks equal to your proficiency bonus, and your passive Wisdom (Insight) score increases by 3. This stance lasts until you end it.");

		const methods = state.getCombatMethods();
		const wary = methods.find(m => m.name === "Wary Stance");
		expect(wary.stanceEffects.passiveBonuses).toEqual({insight: 3});
	});

	it("should parse passive bonus alongside skill bonus", () => {
		addMethod("Wary Stance", "MG", 1,
			"Bonus Action (1 Stamina Point). You gain a bonus to Wisdom (Insight) checks equal to your proficiency bonus, and your passive Wisdom (Insight) score increases by 3. This stance lasts until you end it.");

		const methods = state.getCombatMethods();
		const wary = methods.find(m => m.name === "Wary Stance");
		expect(wary.stanceEffects.skillBonuses).toEqual({insight: "proficiency"});
		expect(wary.stanceEffects.passiveBonuses).toEqual({insight: 3});
	});

	it("should apply passive bonus to getPassiveScore() when stance is active", () => {
		addMethod("Wary Stance", "MG", 1,
			"Bonus Action (1 Stamina Point). You gain a bonus to Wisdom (Insight) checks equal to your proficiency bonus, and your passive Wisdom (Insight) score increases by 3. This stance lasts until you end it.");

		const basePassive = state.getPassiveScore("insight");

		state.activateStance("Wary Stance");
		const activePassive = state.getPassiveScore("insight");

		// Should include: +3 passive bonus + proficiency bonus (3) from skill
		expect(activePassive).toBe(basePassive + 3 + 3);
	});

	it("should remove passive bonus from getPassiveScore() when stance deactivated", () => {
		addMethod("Wary Stance", "MG", 1,
			"Bonus Action (1 Stamina Point). You gain a bonus to Wisdom (Insight) checks equal to your proficiency bonus, and your passive Wisdom (Insight) score increases by 3. This stance lasts until you end it.");

		const basePassive = state.getPassiveScore("insight");

		state.activateStance("Wary Stance");
		expect(state.getPassiveScore("insight")).toBe(basePassive + 3 + 3);

		state.deactivateStance();
		expect(state.getPassiveScore("insight")).toBe(basePassive);
	});

	it("should include stancePassiveBonuses in feature calculations", () => {
		addMethod("Wary Stance", "MG", 1,
			"Bonus Action (1 Stamina Point). You gain a bonus to Wisdom (Insight) checks equal to your proficiency bonus, and your passive Wisdom (Insight) score increases by 3. This stance lasts until you end it.");

		state.activateStance("Wary Stance");
		const calcs = state.getFeatureCalculations();
		expect(calcs.stancePassiveBonuses).toEqual({insight: 3});
	});

	it("should NOT include stancePassiveBonuses when no stance is active", () => {
		addMethod("Wary Stance", "MG", 1,
			"Bonus Action (1 Stamina Point). You gain a bonus to Wisdom (Insight) checks equal to your proficiency bonus, and your passive Wisdom (Insight) score increases by 3. This stance lasts until you end it.");

		const calcs = state.getFeatureCalculations();
		expect(calcs.stancePassiveBonuses).toBeUndefined();
	});

	it("should handle stance with no passive bonus", () => {
		addMethod("Shadow Stance", "MS", 1,
			"Bonus Action (1 Stamina Point). You enter a shadowy stance. You gain a bonus to Dexterity (Stealth) checks equal to your proficiency bonus. This stance lasts until you end it.");

		state.activateStance("Shadow Stance");
		const calcs = state.getFeatureCalculations();
		expect(calcs.stancePassiveBonuses).toBeUndefined();
		expect(calcs.stanceSkillBonuses?.stealth).toBe(3);
	});

	it("should parse multiple skill bonuses from a single stance (Deceptive Stance)", () => {
		addMethod("Deceptive Stance", "CJ", 1,
			"Bonus Action (1 Stamina Point). You adopt a deceptively passive stance. While in this stance during combat, you gain a bonus to Dexterity (Sleight of Hand) and Charisma (Deception) checks equal to your proficiency bonus. This stance lasts until you end it.");

		const methods = state.getCombatMethods();
		const deceptive = methods.find(m => m.name === "Deceptive Stance");
		expect(deceptive.isStance).toBe(true);
		expect(deceptive.stanceEffects.skillBonuses).toEqual({
			sleightofhand: "proficiency",
			deception: "proficiency",
		});
	});

	it("should apply both skill bonuses when Deceptive Stance is active", () => {
		addMethod("Deceptive Stance", "CJ", 1,
			"Bonus Action (1 Stamina Point). You adopt a deceptively passive stance. While in this stance during combat, you gain a bonus to Dexterity (Sleight of Hand) and Charisma (Deception) checks equal to your proficiency bonus. This stance lasts until you end it.");

		state.activateStance("Deceptive Stance");
		const calcs = state.getFeatureCalculations();
		expect(calcs.stanceSkillBonuses?.sleightofhand).toBe(3);
		expect(calcs.stanceSkillBonuses?.deception).toBe(3);
	});

	it("should parse stance effects from HTML-rendered descriptions", () => {
		// Simulate production: description contains rendered HTML from Renderer.get().render()
		state.addFeature({
			name: "Wary Stance",
			source: "TGTT",
			featureType: "Optional Feature",
			optionalFeatureTypes: ["CTM:1MG", "CTM:MG", "CTM"],
			description: '<b>Bonus Action (1 Stamina Point)</b>. As a bonus action, you adopt a keenly observant stance. While in this stance, you gain a bonus to Wisdom (Insight) checks equal to your proficiency bonus, and your passive Wisdom (Insight) score increases by 3. This stance lasts until you are <a href="#">incapacitated</a> or use a bonus action to end it.',
		});

		state.activateStance("Wary Stance");
		const calcs = state.getFeatureCalculations();
		expect(calcs.stanceSkillBonuses?.insight).toBe(3);
		expect(calcs.stancePassiveBonuses?.insight).toBe(3);
	});

	it("should parse multi-skill stance from HTML-rendered descriptions", () => {
		state.addFeature({
			name: "Deceptive Stance",
			source: "TGTT",
			featureType: "Optional Feature",
			optionalFeatureTypes: ["CTM:1CJ", "CTM:CJ", "CTM"],
			description: '<b>Bonus Action (1 Stamina Point)</b>. As a bonus action, you adopt a deceptively passive stance. While in this stance during combat, you gain a bonus to Dexterity (<span class="skill-link">Sleight of Hand</span>) and Charisma (<span class="skill-link">Deception</span>) checks equal to your proficiency bonus. This stance lasts until you are <a href="#">incapacitated</a> or use a bonus action to end it.',
		});

		state.activateStance("Deceptive Stance");
		const calcs = state.getFeatureCalculations();
		expect(calcs.stanceSkillBonuses?.sleightofhand).toBe(3);
		expect(calcs.stanceSkillBonuses?.deception).toBe(3);
	});
});

// =========================================================================
// METHOD CATEGORY CLASSIFICATION
// =========================================================================

describe("Combat Methods Survey — Method Category Classification", () => {
	beforeEach(() => {
		state = new CharacterSheetState();
		makeTGTTFighter(5);
		state.addCombatTradition("Unending Wheel");
	});

	it("should classify Wounding Strike as weaponModifier", () => {
		addMethod("Wounding Strike", "UW", 1,
			"Bonus Action (2 Stamina Points). Choose a weapon. If you hit with your next attack roll using the chosen weapon against a living creature, you deliver a wound that deals 1d4 ongoing damage.");
		const methods = state.getCombatMethods();
		const m = methods.find(x => x.name === "Wounding Strike");
		expect(m.methodCategory).toBe("weaponModifier");
	});

	it("should classify stances as stance category", () => {
		addMethod("Wary Stance", "MG", 1,
			"Bonus Action (1 Stamina Point). You adopt a keenly observant stance. While in this stance, you gain a bonus. This stance lasts until you end it.");
		const methods = state.getCombatMethods();
		const m = methods.find(x => x.name === "Wary Stance");
		expect(m.methodCategory).toBe("stance");
	});

	it("should classify healing methods as selfHeal", () => {
		addMethod("Catch Your Breath", "AM", 1,
			"Bonus Action (1 Stamina Point). You regain hit points equal to 1d6 + your proficiency bonus + your Constitution modifier.");
		const methods = state.getCombatMethods();
		const m = methods.find(x => x.name === "Catch Your Breath");
		expect(m.methodCategory).toBe("selfHeal");
	});

	it("should classify reaction methods as reaction", () => {
		addMethod("Deflect Strike", "UW", 2,
			"Reaction (1 Stamina Point). When hit by a melee attack, reduce the damage by your proficiency bonus d6.");
		const methods = state.getCombatMethods();
		const m = methods.find(x => x.name === "Deflect Strike");
		expect(m.methodCategory).toBe("reaction");
	});

	it("should classify AC buff methods as acBuff", () => {
		addMethod("Warding Wield", "AM", 2,
			"Bonus Action (1 Stamina Point). Your AC increases by 2 until the start of your next turn.");
		const methods = state.getCombatMethods();
		const m = methods.find(x => x.name === "Warding Wield");
		expect(m.methodCategory).toBe("acBuff");
	});

	it("should default unknown methods to instant", () => {
		addMethod("Unknown Method", "AM", 1,
			"Action (1 Stamina Point). You do something mysterious.");
		const methods = state.getCombatMethods();
		const m = methods.find(x => x.name === "Unknown Method");
		expect(m.methodCategory).toBe("instant");
	});
});

// =========================================================================
// WEAPON MODIFIER PARSING
// =========================================================================

describe("Combat Methods Survey — Weapon Modifier Parsing", () => {
	beforeEach(() => {
		state = new CharacterSheetState();
		makeTGTTFighter(5);
		state.addCombatTradition("Unending Wheel");
	});

	it("should parse ongoing damage dice from Wounding Strike", () => {
		addMethod("Wounding Strike", "UW", 1,
			"Bonus Action (2 Stamina Points). Choose a weapon. If you hit with your next attack roll using the chosen weapon against a living creature, you deliver a wound that deals 1d4 ongoing damage.");
		const methods = state.getCombatMethods();
		const m = methods.find(x => x.name === "Wounding Strike");
		expect(m.ongoingDamage).toBe("1d4");
	});

	it("should parse ongoing save type from Wounding Strike description", () => {
		addMethod("Wounding Strike", "UW", 1,
			"Bonus Action (2 Stamina Points). Choose a weapon. If you hit with your next attack roll, you deliver a wound that deals 1d4 ongoing damage. At the start of each of the wounded creature's turns, it makes a Constitution saving throw, ending the effect on itself on a success.");
		const methods = state.getCombatMethods();
		const m = methods.find(x => x.name === "Wounding Strike");
		expect(m.ongoingSaveType).toBe("constitution");
	});

	it("should parse alternative end condition (Medicine check)", () => {
		addMethod("Wounding Strike", "UW", 1,
			"Bonus Action (2 Stamina Points). If you hit with your next attack roll, it deals 1d4 ongoing damage. A creature within 5 feet can use an action to make a Medicine check against your method DC, ending the ongoing damage on a success.");
		const methods = state.getCombatMethods();
		const m = methods.find(x => x.name === "Wounding Strike");
		expect(m.alternativeEndCheck).toBe("medicine");
	});

	it("should not parse ongoing damage for non-weapon-modifier methods", () => {
		addMethod("Power Strike", "AM", 1,
			"Action (1 Stamina Point). Make a melee weapon attack against a creature within reach.");
		const methods = state.getCombatMethods();
		const m = methods.find(x => x.name === "Power Strike");
		expect(m.ongoingDamage).toBeUndefined();
	});
});

// =========================================================================
// ACTIVE COMBAT METHOD EFFECTS — STATE MANAGEMENT
// =========================================================================

describe("Combat Methods Survey — Active Method Effects State", () => {
	beforeEach(() => {
		state = new CharacterSheetState();
		makeTGTTFighter(5);
	});

	it("should activate a combat method effect", () => {
		state.activateCombatMethodEffect({
			name: "Wounding Strike",
			weaponId: "atk-1",
			weaponName: "Longsword",
			ongoingDamage: "1d4",
			ongoingSaveType: "constitution",
			saveDc: 14,
		});
		const effects = state.getActiveCombatMethodEffects();
		expect(effects).toHaveLength(1);
		expect(effects[0].name).toBe("Wounding Strike");
		expect(effects[0].weaponName).toBe("Longsword");
		expect(effects[0].ongoingDamage).toBe("1d4");
		expect(effects[0].saveDc).toBe(14);
	});

	it("should deactivate a combat method effect by id", () => {
		state.activateCombatMethodEffect({
			name: "Wounding Strike",
			weaponId: "atk-1",
			weaponName: "Longsword",
			ongoingDamage: "1d4",
			ongoingSaveType: "constitution",
			saveDc: 14,
		});
		const effects = state.getActiveCombatMethodEffects();
		expect(effects).toHaveLength(1);
		state.deactivateCombatMethodEffect(effects[0].id);
		expect(state.getActiveCombatMethodEffects()).toHaveLength(0);
	});

	it("should replace existing effect on same weapon", () => {
		state.activateCombatMethodEffect({
			name: "Wounding Strike",
			weaponId: "atk-1",
			weaponName: "Longsword",
			ongoingDamage: "1d4",
			ongoingSaveType: "constitution",
			saveDc: 14,
		});
		state.activateCombatMethodEffect({
			name: "Greater Wound",
			weaponId: "atk-1",
			weaponName: "Longsword",
			ongoingDamage: "2d4",
			ongoingSaveType: "constitution",
			saveDc: 16,
		});
		const effects = state.getActiveCombatMethodEffects();
		expect(effects).toHaveLength(1);
		expect(effects[0].name).toBe("Greater Wound");
		expect(effects[0].ongoingDamage).toBe("2d4");
	});

	it("should allow effects on different weapons simultaneously", () => {
		state.activateCombatMethodEffect({
			name: "Wounding Strike",
			weaponId: "atk-1",
			weaponName: "Longsword",
			ongoingDamage: "1d4",
			ongoingSaveType: "constitution",
			saveDc: 14,
		});
		state.activateCombatMethodEffect({
			name: "Wounding Strike",
			weaponId: "atk-2",
			weaponName: "Shortsword",
			ongoingDamage: "1d4",
			ongoingSaveType: "constitution",
			saveDc: 14,
		});
		expect(state.getActiveCombatMethodEffects()).toHaveLength(2);
	});

	it("should clear all combat method effects", () => {
		state.activateCombatMethodEffect({name: "A", weaponId: "1", weaponName: "W1", ongoingDamage: "1d4", saveDc: 14});
		state.activateCombatMethodEffect({name: "B", weaponId: "2", weaponName: "W2", ongoingDamage: "1d6", saveDc: 14});
		expect(state.getActiveCombatMethodEffects()).toHaveLength(2);
		state.clearCombatMethodEffects();
		expect(state.getActiveCombatMethodEffects()).toHaveLength(0);
	});

	it("should persist effects through save/load cycle", () => {
		state.activateCombatMethodEffect({
			name: "Wounding Strike",
			weaponId: "atk-1",
			weaponName: "Longsword",
			ongoingDamage: "1d4",
			ongoingSaveType: "constitution",
			saveDc: 14,
		});
		const json = state.toJson();
		const loaded = new CharacterSheetState();
		loaded.loadFromJson(json);
		const effects = loaded.getActiveCombatMethodEffects();
		expect(effects).toHaveLength(1);
		expect(effects[0].name).toBe("Wounding Strike");
		expect(effects[0].ongoingDamage).toBe("1d4");
	});
});
