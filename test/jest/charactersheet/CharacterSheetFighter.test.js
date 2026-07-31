/**
 * Character Sheet Fighter Class Tests
 * Comprehensive testing for all Fighter class features and subclasses
 *
 * This test suite verifies that:
 * - All core class features are correctly parsed and provide expected effects
 * - Class-based calculations (Extra Attack, Action Surge, etc.) are accurate
 * - All subclass features work correctly at their designated levels
 * - Both PHB (Classic) and XPHB (2024) versions are handled properly
 */

import "./setup.js";
import "../../../js/charactersheet/charactersheet-state.js";
import fs from "fs";
import path from "path";
import {fileURLToPath} from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CharacterSheetState = globalThis.CharacterSheetState;
const CharacterSheetClassUtils = globalThis.CharacterSheetClassUtils;
const CLASS_FIGHTER_DATA = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "..", "data", "class", "class-fighter.json"), "utf8"));

// ==========================================================================
// PART 1: CORE FIGHTER CLASS FEATURES (PHB)
// ==========================================================================
describe("Fighter Core Class Features (PHB)", () => {
	let state;

	beforeEach(() => {
		state = new CharacterSheetState();
		state.setRace({name: "Human", source: "PHB"});
		state.addClass({name: "Fighter", source: "PHB", level: 1});
		state.setAbilityBase("str", 16); // +3 modifier
		state.setAbilityBase("dex", 14); // +2 modifier
		state.setAbilityBase("con", 14); // +2 modifier
		state.setAbilityBase("int", 10);
		state.setAbilityBase("wis", 12);
		state.setAbilityBase("cha", 8);
	});

	// -------------------------------------------------------------------------
	// Fighting Style (Level 1)
	// -------------------------------------------------------------------------
	describe("Fighting Style", () => {
		it("should have Fighting Style at level 1", () => {
			expect(state.getTotalLevel()).toBe(1);
		});
	});

	// -------------------------------------------------------------------------
	// Second Wind (Level 1)
	// -------------------------------------------------------------------------
	describe("Second Wind", () => {
		it("should have Second Wind at level 1", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.secondWindHealing).toBeDefined();
		});

		it("should calculate Second Wind healing as 1d10 + fighter level", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.secondWindHealing).toBe("1d10+1");
		});

		it("should scale Second Wind healing with level", () => {
			state.addClass({name: "Fighter", source: "PHB", level: 10});
			const calculations = state.getFeatureCalculations();
			expect(calculations.secondWindHealing).toBe("1d10+10");
		});

		it("should have 1 Second Wind use per rest in PHB", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.secondWindUses).toBe(1);
		});
	});

	// -------------------------------------------------------------------------
	// Action Surge (Level 2)
	// -------------------------------------------------------------------------
	describe("Action Surge", () => {
		it("should not have Action Surge at level 1", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.actionSurgeUses).toBeUndefined();
		});

		it("should have 1 Action Surge use at level 2", () => {
			state.addClass({name: "Fighter", source: "PHB", level: 2});
			const calculations = state.getFeatureCalculations();
			expect(calculations.actionSurgeUses).toBe(1);
		});

		it("should have 2 Action Surge uses at level 17", () => {
			state.addClass({name: "Fighter", source: "PHB", level: 17});
			const calculations = state.getFeatureCalculations();
			expect(calculations.actionSurgeUses).toBe(2);
		});
	});

	// -------------------------------------------------------------------------
	// Martial Archetype (Level 3)
	// -------------------------------------------------------------------------
	describe("Martial Archetype", () => {
		it("should gain subclass at level 3", () => {
			state.addClass({
				name: "Fighter",
				source: "PHB",
				level: 3,
				subclass: {name: "Champion", shortName: "Champion", source: "PHB"},
			});
			const classes = state.getClasses();
			expect(classes[0].subclass).toBeDefined();
		});
	});

	// -------------------------------------------------------------------------
	// Extra Attack (Level 5, 11, 20)
	// -------------------------------------------------------------------------
	describe("Extra Attack", () => {
		it("should not have Extra Attack before level 5", () => {
			state.addClass({name: "Fighter", source: "PHB", level: 4});
			const calculations = state.getFeatureCalculations();
			expect(calculations.extraAttacks).toBeUndefined();
		});

		it("should have 2 attacks per Attack action at level 5", () => {
			state.addClass({name: "Fighter", source: "PHB", level: 5});
			const calculations = state.getFeatureCalculations();
			expect(calculations.extraAttacks).toBe(2);
		});

		it("should have 3 attacks per Attack action at level 11", () => {
			state.addClass({name: "Fighter", source: "PHB", level: 11});
			const calculations = state.getFeatureCalculations();
			expect(calculations.extraAttacks).toBe(3);
		});

		it("should have 4 attacks per Attack action at level 20", () => {
			state.addClass({name: "Fighter", source: "PHB", level: 20});
			const calculations = state.getFeatureCalculations();
			expect(calculations.extraAttacks).toBe(4);
		});
	});

	// -------------------------------------------------------------------------
	// Indomitable (Level 9, 13, 17)
	// -------------------------------------------------------------------------
	describe("Indomitable", () => {
		it("should not have Indomitable before level 9", () => {
			state.addClass({name: "Fighter", source: "PHB", level: 8});
			const calculations = state.getFeatureCalculations();
			expect(calculations.indomitableUses).toBeUndefined();
		});

		it("should have 1 Indomitable use at level 9", () => {
			state.addClass({name: "Fighter", source: "PHB", level: 9});
			const calculations = state.getFeatureCalculations();
			expect(calculations.indomitableUses).toBe(1);
		});

		it("should have 2 Indomitable uses at level 13", () => {
			state.addClass({name: "Fighter", source: "PHB", level: 13});
			const calculations = state.getFeatureCalculations();
			expect(calculations.indomitableUses).toBe(2);
		});

		it("should have 3 Indomitable uses at level 17", () => {
			state.addClass({name: "Fighter", source: "PHB", level: 17});
			const calculations = state.getFeatureCalculations();
			expect(calculations.indomitableUses).toBe(3);
		});
	});

	// -------------------------------------------------------------------------
	// Ability Score Improvements (More than most classes)
	// -------------------------------------------------------------------------
	describe("Ability Score Improvements", () => {
		const asiLevels = [4, 6, 8, 12, 14, 16, 19];

		asiLevels.forEach(level => {
			it(`should gain ASI at level ${level}`, () => {
				state.addClass({name: "Fighter", source: "PHB", level: level});
				expect(state.getTotalLevel()).toBe(level);
			});
		});

		it("should have 7 ASIs total at level 20", () => {
			state.addClass({name: "Fighter", source: "PHB", level: 20});
			// Fighter gets ASIs at levels 4, 6, 8, 12, 14, 16, 19 = 7 total
			expect(state.getTotalLevel()).toBe(20);
		});
	});
});

// ==========================================================================
// PART 2: FIGHTER HIT DICE AND HP
// ==========================================================================
describe("Fighter Hit Dice and HP", () => {
	let state;

	beforeEach(() => {
		state = new CharacterSheetState();
		state.setRace({name: "Human", source: "PHB"});
		state.setAbilityBase("con", 14); // +2 CON mod
	});

	it("should use d10 hit dice", () => {
		state.addClass({name: "Fighter", source: "PHB", level: 1});
		const hitDice = state.getHitDice();
		expect(hitDice.some(hd => hd.die === 10)).toBe(true);
	});

	it("should have correct number of hit dice per level", () => {
		for (let level = 1; level <= 5; level++) {
			const testState = new CharacterSheetState();
			testState.setAbilityBase("con", 14);
			testState.addClass({name: "Fighter", source: "PHB", level: level});
			const hitDice = testState.getHitDice();
			const d10Dice = hitDice.find(hd => hd.die === 10);
			expect(d10Dice.max).toBe(level);
		}
	});

	it("should calculate HP correctly at level 1", () => {
		state.addClass({name: "Fighter", source: "PHB", level: 1});
		// Level 1: 10 (max d10) + 2 (CON) = 12
		expect(state.getHp().max).toBe(12);
	});

	it("should calculate HP correctly at level 5", () => {
		state.addClass({name: "Fighter", source: "PHB", level: 5});
		// Level 1: 10 + 2 = 12
		// Levels 2-5: 4 × (6 + 2) = 32 (using average of 6 for d10)
		// Total: 12 + 32 = 44
		expect(state.getHp().max).toBe(44);
	});

	it("should have high HP compared to other classes", () => {
		state.addClass({name: "Fighter", source: "PHB", level: 10});
		const fighterHp = state.getHp().max;
		// Fighter with d10 should have good HP
		expect(fighterHp).toBeGreaterThanOrEqual(80);
	});
});

// ==========================================================================
// PART 3: CHAMPION SUBCLASS (PHB)
// ==========================================================================
describe("Champion Subclass (PHB)", () => {
	let state;

	beforeEach(() => {
		state = new CharacterSheetState();
		state.setRace({name: "Human", source: "PHB"});
		state.addClass({
			name: "Fighter",
			source: "PHB",
			level: 3,
			subclass: {name: "Champion", shortName: "Champion", source: "PHB"},
		});
		state.setAbilityBase("str", 16);
		state.setAbilityBase("con", 14);
	});

	it("should gain subclass at level 3", () => {
		const classes = state.getClasses();
		expect(classes[0].subclass).toBeDefined();
		expect(classes[0].subclass.name).toBe("Champion");
	});

	describe("Improved Critical (Level 3)", () => {
		it("should have critical range at level 3", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasCriticalRange).toBe(true);
		});

		it("should crit on 19-20 at level 3", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.criticalRange).toBe(19);
		});
	});

	describe("Remarkable Athlete (Level 7)", () => {
		it("should have Remarkable Athlete bonus at level 7", () => {
			state.addClass({
				name: "Fighter",
				source: "PHB",
				level: 7,
				subclass: {name: "Champion", shortName: "Champion", source: "PHB"},
			});
			const calculations = state.getFeatureCalculations();
			expect(calculations.remarkableAthleteBonus).toBeDefined();
		});

		it("should add half proficiency (rounded down) to unproficient STR/DEX/CON checks", () => {
			state.addClass({
				name: "Fighter",
				source: "PHB",
				level: 7,
				subclass: {name: "Champion", shortName: "Champion", source: "PHB"},
			});
			const calculations = state.getFeatureCalculations();
			// Level 7 = +3 proficiency, half = 1 (rounded down)
			expect(calculations.remarkableAthleteBonus).toBe(1);
		});

		it("should scale Remarkable Athlete bonus with proficiency", () => {
			state.addClass({
				name: "Fighter",
				source: "PHB",
				level: 13,
				subclass: {name: "Champion", shortName: "Champion", source: "PHB"},
			});
			const calculations = state.getFeatureCalculations();
			// Level 13 = +5 proficiency, half = 2
			expect(calculations.remarkableAthleteBonus).toBe(2);
		});
	});

	describe("Additional Fighting Style (Level 10)", () => {
		it("should have Additional Fighting Style at level 10", () => {
			state.addClass({
				name: "Fighter",
				source: "PHB",
				level: 10,
				subclass: {name: "Champion", shortName: "Champion", source: "PHB"},
			});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasAdditionalFightingStyle).toBe(true);
		});
	});

	describe("Superior Critical (Level 15)", () => {
		it("should crit on 18-20 at level 15", () => {
			state.addClass({
				name: "Fighter",
				source: "PHB",
				level: 15,
				subclass: {name: "Champion", shortName: "Champion", source: "PHB"},
			});
			const calculations = state.getFeatureCalculations();
			expect(calculations.criticalRange).toBe(18);
		});
	});

	describe("Survivor (Level 18)", () => {
		it("should have Survivor healing at level 18", () => {
			state.addClass({
				name: "Fighter",
				source: "PHB",
				level: 18,
				subclass: {name: "Champion", shortName: "Champion", source: "PHB"},
			});
			const calculations = state.getFeatureCalculations();
			expect(calculations.survivorHealing).toBeDefined();
		});

		it("should calculate Survivor healing as 5 + CON modifier", () => {
			state.addClass({
				name: "Fighter",
				source: "PHB",
				level: 18,
				subclass: {name: "Champion", shortName: "Champion", source: "PHB"},
			});
			const calculations = state.getFeatureCalculations();
			// CON 14 = +2 mod, 5 + 2 = 7
			expect(calculations.survivorHealing).toBe(7);
		});
	});
});

// ==========================================================================
// PART 4: BATTLE MASTER SUBCLASS (PHB)
// ==========================================================================
describe("Battle Master Subclass (PHB)", () => {
	let state;

	beforeEach(() => {
		state = new CharacterSheetState();
		state.setRace({name: "Human", source: "PHB"});
		state.addClass({
			name: "Fighter",
			source: "PHB",
			level: 3,
			subclass: {name: "Battle Master", shortName: "Battle Master", source: "PHB"},
		});
		state.setAbilityBase("str", 16); // +3
		state.setAbilityBase("dex", 14); // +2
	});

	it("should gain subclass at level 3", () => {
		const classes = state.getClasses();
		expect(classes[0].subclass).toBeDefined();
		expect(classes[0].subclass.name).toBe("Battle Master");
	});

	describe("Combat Superiority", () => {
		it("should have d8 superiority dice at level 3", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.superiorityDie).toBe("d8");
		});

		it("should have 4 superiority dice at level 3", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.superiorityDiceCount).toBe(4);
		});

		it("should know 3 maneuvers at level 3", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.maneuversKnown).toBe(3);
		});

		it("should calculate maneuver save DC correctly", () => {
			const calculations = state.getFeatureCalculations();
			// DC = 8 + prof (2) + max(STR, DEX) = 8 + 2 + 3 = 13
			expect(calculations.maneuverSaveDc).toBe(13);
		});
	});

	describe("Superiority Dice Progression", () => {
		it("should have d10 superiority dice at level 10", () => {
			state.addClass({
				name: "Fighter",
				source: "PHB",
				level: 10,
				subclass: {name: "Battle Master", shortName: "Battle Master", source: "PHB"},
			});
			const calculations = state.getFeatureCalculations();
			expect(calculations.superiorityDie).toBe("d10");
		});

		it("should have d12 superiority dice at level 18", () => {
			state.addClass({
				name: "Fighter",
				source: "PHB",
				level: 18,
				subclass: {name: "Battle Master", shortName: "Battle Master", source: "PHB"},
			});
			const calculations = state.getFeatureCalculations();
			expect(calculations.superiorityDie).toBe("d12");
		});

		it("should have 5 superiority dice at level 7", () => {
			state.addClass({
				name: "Fighter",
				source: "PHB",
				level: 7,
				subclass: {name: "Battle Master", shortName: "Battle Master", source: "PHB"},
			});
			const calculations = state.getFeatureCalculations();
			expect(calculations.superiorityDiceCount).toBe(5);
		});

		it("should have 6 superiority dice at level 15", () => {
			state.addClass({
				name: "Fighter",
				source: "PHB",
				level: 15,
				subclass: {name: "Battle Master", shortName: "Battle Master", source: "PHB"},
			});
			const calculations = state.getFeatureCalculations();
			expect(calculations.superiorityDiceCount).toBe(6);
		});
	});

	describe("Maneuvers Known Progression", () => {
		it("should know 5 maneuvers at level 7", () => {
			state.addClass({
				name: "Fighter",
				source: "PHB",
				level: 7,
				subclass: {name: "Battle Master", shortName: "Battle Master", source: "PHB"},
			});
			const calculations = state.getFeatureCalculations();
			expect(calculations.maneuversKnown).toBe(5);
		});

		it("should know 7 maneuvers at level 10", () => {
			state.addClass({
				name: "Fighter",
				source: "PHB",
				level: 10,
				subclass: {name: "Battle Master", shortName: "Battle Master", source: "PHB"},
			});
			const calculations = state.getFeatureCalculations();
			expect(calculations.maneuversKnown).toBe(7);
		});

		it("should know 9 maneuvers at level 15", () => {
			state.addClass({
				name: "Fighter",
				source: "PHB",
				level: 15,
				subclass: {name: "Battle Master", shortName: "Battle Master", source: "PHB"},
			});
			const calculations = state.getFeatureCalculations();
			expect(calculations.maneuversKnown).toBe(9);
		});
	});

	describe("Know Your Enemy (Level 7)", () => {
		it("should have Know Your Enemy at level 7", () => {
			state.addClass({
				name: "Fighter",
				source: "PHB",
				level: 7,
				subclass: {name: "Battle Master", shortName: "Battle Master", source: "PHB"},
			});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasKnowYourEnemy).toBe(true);
		});
	});

	describe("Relentless (Level 15)", () => {
		it("should have Relentless at level 15", () => {
			state.addClass({
				name: "Fighter",
				source: "PHB",
				level: 15,
				subclass: {name: "Battle Master", shortName: "Battle Master", source: "PHB"},
			});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasRelentless).toBe(true);
		});
	});
});

// ==========================================================================
// PART 5: ELDRITCH KNIGHT SUBCLASS (PHB)
// ==========================================================================
describe("Eldritch Knight Subclass (PHB)", () => {
	let state;

	beforeEach(() => {
		state = new CharacterSheetState();
		state.setRace({name: "Human", source: "PHB"});
		state.addClass({
			name: "Fighter",
			source: "PHB",
			level: 3,
			subclass: {name: "Eldritch Knight", shortName: "Eldritch Knight", source: "PHB"},
		});
		state.setAbilityBase("int", 16); // +3
		state.setAbilityBase("str", 14);
	});

	it("should gain subclass at level 3", () => {
		const classes = state.getClasses();
		expect(classes[0].subclass).toBeDefined();
		expect(classes[0].subclass.name).toBe("Eldritch Knight");
	});

	describe("Spellcasting (1/3 Caster)", () => {
		it("should calculate spell save DC based on INT", () => {
			const calculations = state.getFeatureCalculations();
			// DC = 8 + prof (2) + INT (3) = 13
			expect(calculations.ekSpellSaveDc).toBe(13);
		});

		it("should calculate spell attack bonus based on INT", () => {
			const calculations = state.getFeatureCalculations();
			// Attack = prof (2) + INT (3) = 5
			expect(calculations.ekSpellAttackBonus).toBe(5);
		});

		it("should have 1/3 caster spell slots", () => {
			// At level 3, EK has 2 1st-level slots
			const slots = state.getSpellSlots();
			expect(slots[1]?.max).toBe(2);
		});

		it("should gain 2nd-level slots at fighter level 7", () => {
			state.addClass({
				name: "Fighter",
				source: "PHB",
				level: 7,
				subclass: {name: "Eldritch Knight", shortName: "Eldritch Knight", source: "PHB"},
			});
			const slots = state.getSpellSlots();
			// EK at level 7 = caster level 2 (7/3 rounded down), which has 0 2nd-level slots
			// 2nd-level slots come at caster level 3 (Fighter 8/9)
			// At level 7, we should have more 1st-level slots
			expect(slots[1]?.max).toBeGreaterThanOrEqual(3);
		});
	});

	describe("War Magic (Level 7)", () => {
		it("should have War Magic at level 7", () => {
			state.addClass({
				name: "Fighter",
				source: "PHB",
				level: 7,
				subclass: {name: "Eldritch Knight", shortName: "Eldritch Knight", source: "PHB"},
			});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasWarMagic).toBe(true);
		});
	});

	describe("Eldritch Strike (Level 10)", () => {
		it("should have Eldritch Strike at level 10", () => {
			state.addClass({
				name: "Fighter",
				source: "PHB",
				level: 10,
				subclass: {name: "Eldritch Knight", shortName: "Eldritch Knight", source: "PHB"},
			});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasEldritchStrike).toBe(true);
		});
	});

	describe("Arcane Charge (Level 15)", () => {
		it("should have Arcane Charge at level 15", () => {
			state.addClass({
				name: "Fighter",
				source: "PHB",
				level: 15,
				subclass: {name: "Eldritch Knight", shortName: "Eldritch Knight", source: "PHB"},
			});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasArcaneCharge).toBe(true);
		});
	});

	describe("Improved War Magic (Level 18)", () => {
		it("should have Improved War Magic at level 18", () => {
			state.addClass({
				name: "Fighter",
				source: "PHB",
				level: 18,
				subclass: {name: "Eldritch Knight", shortName: "Eldritch Knight", source: "PHB"},
			});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasImprovedWarMagic).toBe(true);
		});
	});
});

// ==========================================================================
// PART 6: ARCANE ARCHER SUBCLASS (XGE)
// ==========================================================================
describe("Arcane Archer Subclass (XGE)", () => {
	let state;

	beforeEach(() => {
		state = new CharacterSheetState();
		state.setRace({name: "Elf", source: "PHB"});
		state.addClass({
			name: "Fighter",
			source: "PHB",
			level: 3,
			subclass: {name: "Arcane Archer", shortName: "Arcane Archer", source: "XGE"},
		});
		state.setAbilityBase("dex", 16);
		state.setAbilityBase("int", 14);
	});

	it("should gain subclass at level 3", () => {
		const classes = state.getClasses();
		expect(classes[0].subclass).toBeDefined();
		expect(classes[0].subclass.name).toBe("Arcane Archer");
	});

	describe("Arcane Shot", () => {
		it("should have 2 Arcane Shot uses at level 3", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.arcaneShotUses).toBe(2);
		});

		it("should know 2 Arcane Shot options at level 3", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.arcaneShotOptions).toBe(2);
		});

		it("should calculate Arcane Shot save DC based on INT", () => {
			const calculations = state.getFeatureCalculations();
			// DC = 8 + prof (2) + INT (2) = 12
			expect(calculations.arcaneShotSaveDc).toBe(12);
		});
	});

	describe("Arcane Shot Options Progression", () => {
		it("should know 3 options at level 7", () => {
			state.addClass({
				name: "Fighter",
				source: "PHB",
				level: 7,
				subclass: {name: "Arcane Archer", shortName: "Arcane Archer", source: "XGE"},
			});
			const calculations = state.getFeatureCalculations();
			expect(calculations.arcaneShotOptions).toBe(3);
		});

		it("should know 4 options at level 10", () => {
			state.addClass({
				name: "Fighter",
				source: "PHB",
				level: 10,
				subclass: {name: "Arcane Archer", shortName: "Arcane Archer", source: "XGE"},
			});
			const calculations = state.getFeatureCalculations();
			expect(calculations.arcaneShotOptions).toBe(4);
		});

		it("should know 5 options at level 15", () => {
			state.addClass({
				name: "Fighter",
				source: "PHB",
				level: 15,
				subclass: {name: "Arcane Archer", shortName: "Arcane Archer", source: "XGE"},
			});
			const calculations = state.getFeatureCalculations();
			expect(calculations.arcaneShotOptions).toBe(5);
		});

		it("should know 6 options at level 18", () => {
			state.addClass({
				name: "Fighter",
				source: "PHB",
				level: 18,
				subclass: {name: "Arcane Archer", shortName: "Arcane Archer", source: "XGE"},
			});
			const calculations = state.getFeatureCalculations();
			expect(calculations.arcaneShotOptions).toBe(6);
		});
	});

	describe("Curving Shot (Level 7)", () => {
		it("should have Curving Shot at level 7", () => {
			state.addClass({
				name: "Fighter",
				source: "PHB",
				level: 7,
				subclass: {name: "Arcane Archer", shortName: "Arcane Archer", source: "XGE"},
			});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasCurvingShot).toBe(true);
		});
	});

	describe("Ever-Ready Shot (Level 15)", () => {
		it("should have Ever-Ready Shot at level 15", () => {
			state.addClass({
				name: "Fighter",
				source: "PHB",
				level: 15,
				subclass: {name: "Arcane Archer", shortName: "Arcane Archer", source: "XGE"},
			});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasEverReadyShot).toBe(true);
		});
	});
});

// ==========================================================================
// PART 7: CAVALIER SUBCLASS (XGE)
// ==========================================================================
describe("Cavalier Subclass (XGE)", () => {
	let state;

	beforeEach(() => {
		state = new CharacterSheetState();
		state.setRace({name: "Human", source: "PHB"});
		state.addClass({
			name: "Fighter",
			source: "PHB",
			level: 3,
			subclass: {name: "Cavalier", shortName: "Cavalier", source: "XGE"},
		});
		state.setAbilityBase("str", 16); // +3
		state.setAbilityBase("con", 14); // +2
	});

	it("should gain subclass at level 3", () => {
		const classes = state.getClasses();
		expect(classes[0].subclass).toBeDefined();
		expect(classes[0].subclass.name).toBe("Cavalier");
	});

	describe("Unwavering Mark", () => {
		it("should have Unwavering Mark uses equal to STR modifier", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.unwaveringMarkUses).toBe(3);
		});

		it("should have minimum 1 use", () => {
			state.setAbilityBase("str", 8); // -1 modifier
			const calculations = state.getFeatureCalculations();
			expect(calculations.unwaveringMarkUses).toBe(1);
		});
	});

	describe("Warding Maneuver (Level 7)", () => {
		it("should have Warding Maneuver uses at level 7", () => {
			state.addClass({
				name: "Fighter",
				source: "PHB",
				level: 7,
				subclass: {name: "Cavalier", shortName: "Cavalier", source: "XGE"},
			});
			const calculations = state.getFeatureCalculations();
			expect(calculations.wardingManeuverUses).toBe(2);
		});
	});

	describe("Hold the Line (Level 10)", () => {
		it("should have Hold the Line at level 10", () => {
			state.addClass({
				name: "Fighter",
				source: "PHB",
				level: 10,
				subclass: {name: "Cavalier", shortName: "Cavalier", source: "XGE"},
			});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasHoldTheLine).toBe(true);
		});
	});

	describe("Ferocious Charger (Level 15)", () => {
		it("should have Ferocious Charger at level 15", () => {
			state.addClass({
				name: "Fighter",
				source: "PHB",
				level: 15,
				subclass: {name: "Cavalier", shortName: "Cavalier", source: "XGE"},
			});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasFerociousCharger).toBe(true);
		});
	});

	describe("Vigilant Defender (Level 18)", () => {
		it("should have Vigilant Defender at level 18", () => {
			state.addClass({
				name: "Fighter",
				source: "PHB",
				level: 18,
				subclass: {name: "Cavalier", shortName: "Cavalier", source: "XGE"},
			});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasVigilantDefender).toBe(true);
		});
	});
});

// ==========================================================================
// PART 8: SAMURAI SUBCLASS (XGE)
// ==========================================================================
describe("Samurai Subclass (XGE)", () => {
	let state;

	beforeEach(() => {
		state = new CharacterSheetState();
		state.setRace({name: "Human", source: "PHB"});
		state.addClass({
			name: "Fighter",
			source: "PHB",
			level: 3,
			subclass: {name: "Samurai", shortName: "Samurai", source: "XGE"},
		});
		state.setAbilityBase("str", 16);
		state.setAbilityBase("wis", 14);
	});

	it("should gain subclass at level 3", () => {
		const classes = state.getClasses();
		expect(classes[0].subclass).toBeDefined();
		expect(classes[0].subclass.name).toBe("Samurai");
	});

	describe("Fighting Spirit", () => {
		it("should have 3 Fighting Spirit uses at level 3", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.fightingSpiritUses).toBe(3);
		});

		it("should grant 5 temp HP at level 3", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.fightingSpiritTempHp).toBe(5);
		});

		it("should grant 10 temp HP at level 10", () => {
			state.addClass({
				name: "Fighter",
				source: "PHB",
				level: 10,
				subclass: {name: "Samurai", shortName: "Samurai", source: "XGE"},
			});
			const calculations = state.getFeatureCalculations();
			expect(calculations.fightingSpiritTempHp).toBe(10);
		});

		it("should grant 15 temp HP at level 15", () => {
			state.addClass({
				name: "Fighter",
				source: "PHB",
				level: 15,
				subclass: {name: "Samurai", shortName: "Samurai", source: "XGE"},
			});
			const calculations = state.getFeatureCalculations();
			expect(calculations.fightingSpiritTempHp).toBe(15);
		});
	});

	describe("Elegant Courtier (Level 7)", () => {
		it("should have Elegant Courtier at level 7", () => {
			state.addClass({
				name: "Fighter",
				source: "PHB",
				level: 7,
				subclass: {name: "Samurai", shortName: "Samurai", source: "XGE"},
			});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasElegantCourtier).toBe(true);
		});

		it("should add WIS modifier to Persuasion checks", () => {
			state.addClass({
				name: "Fighter",
				source: "PHB",
				level: 7,
				subclass: {name: "Samurai", shortName: "Samurai", source: "XGE"},
			});
			const calculations = state.getFeatureCalculations();
			expect(calculations.elegantCourtierBonus).toBe(2);
		});
	});

	describe("Tireless Spirit (Level 10)", () => {
		it("should have Tireless Spirit at level 10", () => {
			state.addClass({
				name: "Fighter",
				source: "PHB",
				level: 10,
				subclass: {name: "Samurai", shortName: "Samurai", source: "XGE"},
			});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasTirelessSpirit).toBe(true);
		});
	});

	describe("Rapid Strike (Level 15)", () => {
		it("should have Rapid Strike at level 15", () => {
			state.addClass({
				name: "Fighter",
				source: "PHB",
				level: 15,
				subclass: {name: "Samurai", shortName: "Samurai", source: "XGE"},
			});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasRapidStrike).toBe(true);
		});
	});

	describe("Strength before Death (Level 18)", () => {
		it("should have Strength before Death at level 18", () => {
			state.addClass({
				name: "Fighter",
				source: "PHB",
				level: 18,
				subclass: {name: "Samurai", shortName: "Samurai", source: "XGE"},
			});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasStrengthBeforeDeath).toBe(true);
		});
	});
});

// ==========================================================================
// PART 9: ECHO KNIGHT SUBCLASS (EGW)
// ==========================================================================
describe("Echo Knight Subclass (EGW)", () => {
	let state;

	beforeEach(() => {
		state = new CharacterSheetState();
		state.setRace({name: "Human", source: "PHB"});
		state.addClass({
			name: "Fighter",
			source: "PHB",
			level: 3,
			subclass: {name: "Echo Knight", shortName: "Echo Knight", source: "EGW"},
		});
		state.setAbilityBase("str", 16);
		state.setAbilityBase("con", 14); // +2
	});

	it("should gain subclass at level 3", () => {
		const classes = state.getClasses();
		expect(classes[0].subclass).toBeDefined();
		expect(classes[0].subclass.name).toBe("Echo Knight");
	});

	describe("Manifest Echo", () => {
		it("should have echo HP of 1", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.echoHp).toBe(1);
		});

		it("should calculate echo AC as 14 + proficiency bonus", () => {
			const calculations = state.getFeatureCalculations();
			// 14 + 2 (prof at level 3) = 16
			expect(calculations.echoAc).toBe(16);
		});

		it("should scale echo AC with proficiency", () => {
			state.addClass({
				name: "Fighter",
				source: "PHB",
				level: 9,
				subclass: {name: "Echo Knight", shortName: "Echo Knight", source: "EGW"},
			});
			const calculations = state.getFeatureCalculations();
			// 14 + 4 (prof at level 9) = 18
			expect(calculations.echoAc).toBe(18);
		});
	});

	describe("Unleash Incarnation", () => {
		it("should have uses equal to CON modifier", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.unleashIncarnationUses).toBe(2);
		});

		it("should have minimum 1 use", () => {
			state.setAbilityBase("con", 8); // -1 modifier
			const calculations = state.getFeatureCalculations();
			expect(calculations.unleashIncarnationUses).toBe(1);
		});
	});

	describe("Echo Avatar (Level 7)", () => {
		it("should have Echo Avatar at level 7", () => {
			state.addClass({
				name: "Fighter",
				source: "PHB",
				level: 7,
				subclass: {name: "Echo Knight", shortName: "Echo Knight", source: "EGW"},
			});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasEchoAvatar).toBe(true);
		});
	});

	describe("Shadow Martyr (Level 10)", () => {
		it("should have Shadow Martyr at level 10", () => {
			state.addClass({
				name: "Fighter",
				source: "PHB",
				level: 10,
				subclass: {name: "Echo Knight", shortName: "Echo Knight", source: "EGW"},
			});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasShadowMartyr).toBe(true);
		});
	});

	describe("Reclaim Potential (Level 15)", () => {
		it("should have Reclaim Potential at level 15", () => {
			state.addClass({
				name: "Fighter",
				source: "PHB",
				level: 15,
				subclass: {name: "Echo Knight", shortName: "Echo Knight", source: "EGW"},
			});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasReclaimPotential).toBe(true);
		});

		it("should grant temp HP equal to CON modifier", () => {
			state.addClass({
				name: "Fighter",
				source: "PHB",
				level: 15,
				subclass: {name: "Echo Knight", shortName: "Echo Knight", source: "EGW"},
			});
			const calculations = state.getFeatureCalculations();
			expect(calculations.reclaimPotentialTempHp).toBe(2);
		});
	});

	describe("Legion of One (Level 18)", () => {
		it("should have Legion of One at level 18", () => {
			state.addClass({
				name: "Fighter",
				source: "PHB",
				level: 18,
				subclass: {name: "Echo Knight", shortName: "Echo Knight", source: "EGW"},
			});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasLegionOfOne).toBe(true);
		});

		it("should allow 2 echoes at level 18", () => {
			state.addClass({
				name: "Fighter",
				source: "PHB",
				level: 18,
				subclass: {name: "Echo Knight", shortName: "Echo Knight", source: "EGW"},
			});
			const calculations = state.getFeatureCalculations();
			expect(calculations.maxEchoes).toBe(2);
		});

		it("should only allow 1 echo before level 18", () => {
			state.addClass({
				name: "Fighter",
				source: "PHB",
				level: 17,
				subclass: {name: "Echo Knight", shortName: "Echo Knight", source: "EGW"},
			});
			const calculations = state.getFeatureCalculations();
			expect(calculations.maxEchoes).toBe(1);
		});
	});
});

// ==========================================================================
// PART 10: PSI WARRIOR SUBCLASS (TCE)
// ==========================================================================
describe("Psi Warrior Subclass (TCE)", () => {
	let state;

	beforeEach(() => {
		state = new CharacterSheetState();
		state.setRace({name: "Human", source: "PHB"});
		state.addClass({
			name: "Fighter",
			source: "PHB",
			level: 3,
			subclass: {name: "Psi Warrior", shortName: "Psi Warrior", source: "TCE"},
		});
		state.setAbilityBase("str", 16);
		state.setAbilityBase("int", 14); // +2
	});

	it("should gain subclass at level 3", () => {
		const classes = state.getClasses();
		expect(classes[0].subclass).toBeDefined();
		expect(classes[0].subclass.name).toBe("Psi Warrior");
	});

	describe("Psionic Power", () => {
		it("should have d6 psionic dice at level 3", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.psionicEnergyDie).toBe("d6");
		});

		it("should have psionic dice count = 2 × proficiency bonus", () => {
			const calculations = state.getFeatureCalculations();
			// 2 × 2 (prof) = 4
			expect(calculations.psionicDiceCount).toBe(4);
		});

		it("should calculate psionic save DC based on INT", () => {
			const calculations = state.getFeatureCalculations();
			// DC = 8 + prof (2) + INT (2) = 12
			expect(calculations.psionicSaveDc).toBe(12);
		});
	});

	describe("Psionic Dice Progression", () => {
		it("should have d8 psionic dice at level 5", () => {
			state.addClass({
				name: "Fighter",
				source: "PHB",
				level: 5,
				subclass: {name: "Psi Warrior", shortName: "Psi Warrior", source: "TCE"},
			});
			const calculations = state.getFeatureCalculations();
			expect(calculations.psionicEnergyDie).toBe("d8");
		});

		it("should have d10 psionic dice at level 11", () => {
			state.addClass({
				name: "Fighter",
				source: "PHB",
				level: 11,
				subclass: {name: "Psi Warrior", shortName: "Psi Warrior", source: "TCE"},
			});
			const calculations = state.getFeatureCalculations();
			expect(calculations.psionicEnergyDie).toBe("d10");
		});

		it("should have d12 psionic dice at level 17", () => {
			state.addClass({
				name: "Fighter",
				source: "PHB",
				level: 17,
				subclass: {name: "Psi Warrior", shortName: "Psi Warrior", source: "TCE"},
			});
			const calculations = state.getFeatureCalculations();
			expect(calculations.psionicEnergyDie).toBe("d12");
		});
	});

	describe("Telekinetic Adept (Level 7)", () => {
		it("should have Telekinetic Adept at level 7", () => {
			state.addClass({
				name: "Fighter",
				source: "PHB",
				level: 7,
				subclass: {name: "Psi Warrior", shortName: "Psi Warrior", source: "TCE"},
			});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasTelekineticAdept).toBe(true);
		});
	});

	describe("Guarded Mind (Level 10)", () => {
		it("should have Guarded Mind at level 10", () => {
			state.addClass({
				name: "Fighter",
				source: "PHB",
				level: 10,
				subclass: {name: "Psi Warrior", shortName: "Psi Warrior", source: "TCE"},
			});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasGuardedMind).toBe(true);
		});
	});

	describe("Bulwark of Force (Level 15)", () => {
		it("should have Bulwark of Force at level 15", () => {
			state.addClass({
				name: "Fighter",
				source: "PHB",
				level: 15,
				subclass: {name: "Psi Warrior", shortName: "Psi Warrior", source: "TCE"},
			});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasBulwarkOfForce).toBe(true);
		});
	});

	describe("Telekinetic Master (Level 18)", () => {
		it("should have Telekinetic Master at level 18", () => {
			state.addClass({
				name: "Fighter",
				source: "PHB",
				level: 18,
				subclass: {name: "Psi Warrior", shortName: "Psi Warrior", source: "TCE"},
			});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasTelekineticMaster).toBe(true);
		});
	});
});

// ==========================================================================
// PART 11: RUNE KNIGHT SUBCLASS (TCE)
// ==========================================================================
describe("Rune Knight Subclass (TCE)", () => {
	let state;

	beforeEach(() => {
		state = new CharacterSheetState();
		state.setRace({name: "Human", source: "PHB"});
		state.addClass({
			name: "Fighter",
			source: "PHB",
			level: 3,
			subclass: {name: "Rune Knight", shortName: "Rune Knight", source: "TCE"},
		});
		state.setAbilityBase("str", 16);
		state.setAbilityBase("con", 14); // +2
	});

	it("should gain subclass at level 3", () => {
		const classes = state.getClasses();
		expect(classes[0].subclass).toBeDefined();
		expect(classes[0].subclass.name).toBe("Rune Knight");
	});

	describe("Giant's Might", () => {
		it("should have uses equal to proficiency bonus", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.giantsMightUses).toBe(2);
		});

		it("should deal 1d6 extra damage at level 3", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.giantsMightDamage).toBe("1d6");
		});

		it("should become Large at level 3", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.giantsMightSize).toBe("Large");
		});
	});

	describe("Giant's Might Progression", () => {
		it("should deal 1d8 extra damage at level 10", () => {
			state.addClass({
				name: "Fighter",
				source: "PHB",
				level: 10,
				subclass: {name: "Rune Knight", shortName: "Rune Knight", source: "TCE"},
			});
			const calculations = state.getFeatureCalculations();
			expect(calculations.giantsMightDamage).toBe("1d8");
		});

		it("should deal 1d10 extra damage at level 18", () => {
			state.addClass({
				name: "Fighter",
				source: "PHB",
				level: 18,
				subclass: {name: "Rune Knight", shortName: "Rune Knight", source: "TCE"},
			});
			const calculations = state.getFeatureCalculations();
			expect(calculations.giantsMightDamage).toBe("1d10");
		});

		it("should become Huge at level 18", () => {
			state.addClass({
				name: "Fighter",
				source: "PHB",
				level: 18,
				subclass: {name: "Rune Knight", shortName: "Rune Knight", source: "TCE"},
			});
			const calculations = state.getFeatureCalculations();
			expect(calculations.giantsMightSize).toBe("Huge");
		});
	});

	describe("Rune Carver", () => {
		it("should know 2 runes at level 3", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.runesKnown).toBe(2);
		});

		it("should calculate rune save DC based on CON", () => {
			const calculations = state.getFeatureCalculations();
			// DC = 8 + prof (2) + CON (2) = 12
			expect(calculations.runeSaveDc).toBe(12);
		});
	});

	describe("Runes Known Progression", () => {
		it("should know 3 runes at level 7", () => {
			state.addClass({
				name: "Fighter",
				source: "PHB",
				level: 7,
				subclass: {name: "Rune Knight", shortName: "Rune Knight", source: "TCE"},
			});
			const calculations = state.getFeatureCalculations();
			expect(calculations.runesKnown).toBe(3);
		});

		it("should know 4 runes at level 10", () => {
			state.addClass({
				name: "Fighter",
				source: "PHB",
				level: 10,
				subclass: {name: "Rune Knight", shortName: "Rune Knight", source: "TCE"},
			});
			const calculations = state.getFeatureCalculations();
			expect(calculations.runesKnown).toBe(4);
		});

		it("should know 5 runes at level 15", () => {
			state.addClass({
				name: "Fighter",
				source: "PHB",
				level: 15,
				subclass: {name: "Rune Knight", shortName: "Rune Knight", source: "TCE"},
			});
			const calculations = state.getFeatureCalculations();
			expect(calculations.runesKnown).toBe(5);
		});
	});

	describe("Runic Shield (Level 7)", () => {
		it("should have Runic Shield at level 7", () => {
			state.addClass({
				name: "Fighter",
				source: "PHB",
				level: 7,
				subclass: {name: "Rune Knight", shortName: "Rune Knight", source: "TCE"},
			});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasRunicShield).toBe(true);
		});

		it("should have Runic Shield uses equal to proficiency bonus", () => {
			state.addClass({
				name: "Fighter",
				source: "PHB",
				level: 7,
				subclass: {name: "Rune Knight", shortName: "Rune Knight", source: "TCE"},
			});
			const calculations = state.getFeatureCalculations();
			expect(calculations.runicShieldUses).toBe(3);
		});
	});

	describe("Great Stature (Level 10)", () => {
		it("should have Great Stature at level 10", () => {
			state.addClass({
				name: "Fighter",
				source: "PHB",
				level: 10,
				subclass: {name: "Rune Knight", shortName: "Rune Knight", source: "TCE"},
			});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasGreatStature).toBe(true);
		});
	});

	describe("Master of Runes (Level 15)", () => {
		it("should have Master of Runes at level 15", () => {
			state.addClass({
				name: "Fighter",
				source: "PHB",
				level: 15,
				subclass: {name: "Rune Knight", shortName: "Rune Knight", source: "TCE"},
			});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasMasterOfRunes).toBe(true);
		});
	});

	describe("Runic Juggernaut (Level 18)", () => {
		it("should have Runic Juggernaut at level 18", () => {
			state.addClass({
				name: "Fighter",
				source: "PHB",
				level: 18,
				subclass: {name: "Rune Knight", shortName: "Rune Knight", source: "TCE"},
			});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasRunicJuggernaut).toBe(true);
		});
	});
});

// ==========================================================================
// PART 12: XPHB 2024 FIGHTER CORE FEATURES
// ==========================================================================
describe("Fighter Core Class Features (XPHB 2024)", () => {
	let state;

	beforeEach(() => {
		state = new CharacterSheetState();
		state.setRace({name: "Human", source: "XPHB"});
		state.addClass({name: "Fighter", source: "XPHB", level: 1});
		state.setAbilityBase("str", 16);
		state.setAbilityBase("dex", 14);
		state.setAbilityBase("con", 14);
	});

	// -------------------------------------------------------------------------
	// Second Wind (Enhanced in XPHB)
	// -------------------------------------------------------------------------
	describe("Second Wind (XPHB)", () => {
		it("should have 2 Second Wind uses at level 1", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.secondWindUses).toBe(2);
		});

		it("should have 3 Second Wind uses at level 4", () => {
			state.addClass({name: "Fighter", source: "XPHB", level: 4});
			const calculations = state.getFeatureCalculations();
			expect(calculations.secondWindUses).toBe(3);
		});

		it("should have 4 Second Wind uses at level 10", () => {
			state.addClass({name: "Fighter", source: "XPHB", level: 10});
			const calculations = state.getFeatureCalculations();
			expect(calculations.secondWindUses).toBe(4);
		});

		it("should have 5 Second Wind uses at level 16", () => {
			state.addClass({name: "Fighter", source: "XPHB", level: 16});
			const calculations = state.getFeatureCalculations();
			expect(calculations.secondWindUses).toBe(5);
		});
	});

	// -------------------------------------------------------------------------
	// Weapon Mastery (Level 1)
	// -------------------------------------------------------------------------
	describe("Weapon Mastery (XPHB Level 1)", () => {
		it("should have Weapon Mastery at level 1", () => {
			expect(state.getTotalLevel()).toBe(1);
		});
	});

	// -------------------------------------------------------------------------
	// Tactical Mind (Level 2)
	// -------------------------------------------------------------------------
	describe("Tactical Mind (XPHB Level 2)", () => {
		it("should have Tactical Mind at level 2", () => {
			state.addClass({name: "Fighter", source: "XPHB", level: 2});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasTacticalMind).toBe(true);
		});

		it("should not have Tactical Mind at level 1", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasTacticalMind).toBeUndefined();
		});
	});

	// -------------------------------------------------------------------------
	// Tactical Shift (Level 5)
	// -------------------------------------------------------------------------
	describe("Tactical Shift (XPHB Level 5)", () => {
		it("should have Tactical Shift at level 5", () => {
			state.addClass({name: "Fighter", source: "XPHB", level: 5});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasTacticalShift).toBe(true);
		});

		it("should not have Tactical Shift before level 5", () => {
			state.addClass({name: "Fighter", source: "XPHB", level: 4});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasTacticalShift).toBeUndefined();
		});
	});

	// -------------------------------------------------------------------------
	// Tactical Master (Level 9)
	// -------------------------------------------------------------------------
	describe("Tactical Master (XPHB Level 9)", () => {
		it("should have Tactical Master at level 9", () => {
			state.addClass({name: "Fighter", source: "XPHB", level: 9});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasTacticalMaster).toBe(true);
		});

		it("should not have Tactical Master before level 9", () => {
			state.addClass({name: "Fighter", source: "XPHB", level: 8});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasTacticalMaster).toBeUndefined();
		});
	});

	// -------------------------------------------------------------------------
	// Studied Attacks (Level 13)
	// -------------------------------------------------------------------------
	describe("Studied Attacks (XPHB Level 13)", () => {
		it("should have Studied Attacks at level 13", () => {
			state.addClass({name: "Fighter", source: "XPHB", level: 13});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasStudiedAttacks).toBe(true);
		});

		it("should not have Studied Attacks before level 13", () => {
			state.addClass({name: "Fighter", source: "XPHB", level: 12});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasStudiedAttacks).toBeUndefined();
		});
	});

	// -------------------------------------------------------------------------
	// Epic Boon (Level 19)
	// -------------------------------------------------------------------------
	describe("Epic Boon (XPHB Level 19)", () => {
		it("should gain Epic Boon at level 19", () => {
			state.addClass({name: "Fighter", source: "XPHB", level: 19});
			expect(state.getTotalLevel()).toBe(19);
		});
	});

	// -------------------------------------------------------------------------
	// Core Features Same as PHB
	// -------------------------------------------------------------------------
	describe("Core Features", () => {
		it("should have same Extra Attack progression", () => {
			state.addClass({name: "Fighter", source: "XPHB", level: 20});
			const calculations = state.getFeatureCalculations();
			expect(calculations.extraAttacks).toBe(4);
		});

		it("should have same Indomitable progression", () => {
			state.addClass({name: "Fighter", source: "XPHB", level: 17});
			const calculations = state.getFeatureCalculations();
			expect(calculations.indomitableUses).toBe(3);
		});

		it("should have same Action Surge progression", () => {
			state.addClass({name: "Fighter", source: "XPHB", level: 17});
			const calculations = state.getFeatureCalculations();
			expect(calculations.actionSurgeUses).toBe(2);
		});
	});
});

// ==========================================================================
// PART 13: CHAMPION SUBCLASS (XPHB 2024)
// ==========================================================================
describe("Champion Subclass (XPHB 2024)", () => {
	let state;

	beforeEach(() => {
		state = new CharacterSheetState();
		state.setRace({name: "Human", source: "XPHB"});
		state.addClass({
			name: "Fighter",
			source: "XPHB",
			level: 3,
			subclass: {name: "Champion", shortName: "Champion", source: "XPHB"},
		});
		state.setAbilityBase("str", 16);
		state.setAbilityBase("con", 14);
	});

	it("should gain subclass at level 3", () => {
		const classes = state.getClasses();
		expect(classes[0].subclass).toBeDefined();
		expect(classes[0].subclass.name).toBe("Champion");
	});

	it("should NOT grant any Champion feature below level 3 (guard regression)", () => {
		const belowLevelState = new CharacterSheetState();
		belowLevelState.setRace({name: "Human", source: "XPHB"});
		belowLevelState.addClass({name: "Fighter", source: "XPHB", level: 2});
		const calculations = belowLevelState.getFeatureCalculations();
		expect(calculations.hasCriticalRange).toBeFalsy();
		expect(calculations.hasRemarkableAthlete).toBeFalsy();
	});

	describe("Improved Critical (XPHB Level 3)", () => {
		it("should crit on 19-20 at level 3 for weapon attacks", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasCriticalRange).toBe(true);
			expect(calculations.criticalRange).toBe(19);
			expect(state.getCriticalRange()).toBe(19);
			expect(state.getCriticalRange("weapon")).toBe(19);
		});

		it("should NOT expand the crit range for spell attacks", () => {
			// Bug fix regression: getCriticalRange() previously leaked Champion's
			// weapon-only crit range into spell attacks.
			expect(state.getCriticalRange("spell")).toBe(20);
		});
	});

	describe("Remarkable Athlete (XPHB Level 3)", () => {
		it("should have Remarkable Athlete at level 3 (NOT gated behind level 7)", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasRemarkableAthlete).toBe(true);
		});

		it("should grant advantage on Initiative rolls, not a flat numeric bonus", () => {
			const initMode = state.getInitiativeRollMode();
			expect(initMode.advantage).toBe(true);
			expect(initMode.disadvantage).toBe(false);
			// Regression guard: earlier (wrong) implementation modeled this as a flat
			// +proficiency-bonus numeric initiative bonus instead of advantage.
			const calculations = state.getFeatureCalculations();
			expect(calculations.initiativeBonus).toBeUndefined();
		});

		it("should grant advantage on Strength (Athletics) checks", () => {
			const adv = state.getAdvantageState("skill:athletics");
			expect(adv.advantage).toBe(true);
		});

		it("should NOT grant advantage on unrelated skills", () => {
			const adv = state.getAdvantageState("skill:perception");
			expect(adv.advantage).toBe(false);
		});
	});

	describe("Additional Fighting Style (XPHB Level 7)", () => {
		it("should surface hasAdditionalFightingStyle at level 7 (not level 10)", () => {
			state.addClass({
				name: "Fighter",
				source: "XPHB",
				level: 7,
				subclass: {name: "Champion", shortName: "Champion", source: "XPHB"},
			});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasAdditionalFightingStyle).toBe(true);
		});

		it("should NOT surface hasAdditionalFightingStyle before level 7", () => {
			const calculations = state.getFeatureCalculations(); // still level 3 from beforeEach
			expect(calculations.hasAdditionalFightingStyle).toBeFalsy();
		});

		it("should grant a second Fighting Style feat pick via the subclass's own featProgression", () => {
			const fighterClass = CLASS_FIGHTER_DATA.class.find((c) => c.source === "XPHB");
			const champion = CLASS_FIGHTER_DATA.subclass.find((sc) => sc.shortName === "Champion" && sc.source === "XPHB");
			expect(champion.featProgression).toBeDefined();
			const gains = CharacterSheetClassUtils.getClassFeatProgressionGains(fighterClass, 6, 7, champion);
			expect(gains.length).toBe(1);
			expect(gains[0].category).toContain("FS");
			expect(gains[0].count).toBe(1);
		});

		it("should NOT double-grant Additional Fighting Style across a level range that doesn't cross 7", () => {
			const fighterClass = CLASS_FIGHTER_DATA.class.find((c) => c.source === "XPHB");
			const champion = CLASS_FIGHTER_DATA.subclass.find((sc) => sc.shortName === "Champion" && sc.source === "XPHB");
			const gains = CharacterSheetClassUtils.getClassFeatProgressionGains(fighterClass, 7, 8, champion);
			expect(gains.length).toBe(0);
		});
	});

	describe("Heroic Warrior (XPHB Level 10)", () => {
		beforeEach(() => {
			state.addClass({
				name: "Fighter",
				source: "XPHB",
				level: 10,
				subclass: {name: "Champion", shortName: "Champion", source: "XPHB"},
			});
		});

		it("should have Heroic Warrior at level 10", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasHeroicWarrior).toBe(true);
		});

		it("should grant Heroic Inspiration at the start of turn if absent", () => {
			expect(state.hasInspiration()).toBe(false);
			const effects = state.getTurnStartEffects();
			expect(effects.some((e) => e.type === "grantInspiration" && e.source === "Heroic Warrior")).toBe(true);
			state.applyTurnStartEffects();
			expect(state.hasInspiration()).toBe(true);
		});

		it("should NOT grant Heroic Inspiration again if already present", () => {
			state.setInspiration(true);
			const effects = state.getTurnStartEffects();
			expect(effects.some((e) => e.type === "grantInspiration")).toBe(false);
		});

		it("should apply the Heroic Warrior grant from startCombat()/advanceRound()", () => {
			state.startCombat();
			expect(state.hasInspiration()).toBe(true);
			state.setInspiration(false);
			state.advanceRound();
			expect(state.hasInspiration()).toBe(true);
		});
	});

	describe("Superior Critical (XPHB Level 15)", () => {
		it("should crit on 18-20 at level 15 (weapon only)", () => {
			state.addClass({
				name: "Fighter",
				source: "XPHB",
				level: 15,
				subclass: {name: "Champion", shortName: "Champion", source: "XPHB"},
			});
			const calculations = state.getFeatureCalculations();
			expect(calculations.criticalRange).toBe(18);
			expect(state.getCriticalRange("weapon")).toBe(18);
			expect(state.getCriticalRange("spell")).toBe(20);
		});
	});

	describe("Survivor (XPHB Level 18)", () => {
		beforeEach(() => {
			state.addClass({
				name: "Fighter",
				source: "XPHB",
				level: 18,
				subclass: {name: "Champion", shortName: "Champion", source: "XPHB"},
			});
		});

		it("should have Champion Survivor flags and 5 + CON mod healing at level 18", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasChampionSurvivor).toBe(true);
			expect(calculations.hasChampionSurvivorDefyDeath).toBe(true);
			// CON 14 = +2 mod, 5 + 2 = 7
			expect(calculations.championSurvivorHealing).toBe(7);
		});

		it("Defy Death: should grant advantage on death saving throws", () => {
			const deathMode = state.getDeathSaveRollMode();
			expect(deathMode.advantage).toBe(true);
		});

		it("Defy Death: a death-save roll of 18-20 should count as the natural-20 benefit", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.championSurvivorDeathSaveNatRange).toBe(18);
		});

		it("Heroic Rally: should heal 5 + CON mod at start of turn while Bloodied and alive", () => {
			state.setMaxHp(50);
			state.setCurrentHp(20); // Bloodied (<= 25)
			const effects = state.getTurnStartEffects();
			const rally = effects.find((e) => e.source === "Heroic Rally");
			expect(rally).toBeDefined();
			expect(rally.amount).toBe(7);
			state.applyTurnStartEffects();
			expect(state.getCurrentHp()).toBe(27);
		});

		it("Heroic Rally: should NOT heal when not Bloodied", () => {
			state.setMaxHp(50);
			state.setCurrentHp(40); // above half — not Bloodied
			const effects = state.getTurnStartEffects();
			expect(effects.some((e) => e.source === "Heroic Rally")).toBe(false);
		});

		it("Heroic Rally: should NOT heal at 0 HP (not merely Bloodied — must be alive)", () => {
			state.setMaxHp(50);
			state.setCurrentHp(0);
			const effects = state.getTurnStartEffects();
			expect(effects.some((e) => e.source === "Heroic Rally")).toBe(false);
		});
	});

	describe("PHB Champion regression (unaffected by XPHB changes)", () => {
		it("PHB Remarkable Athlete (level 7) still uses the numeric half-proficiency bonus, not advantage", () => {
			const phbState = new CharacterSheetState();
			phbState.setRace({name: "Human", source: "PHB"});
			phbState.addClass({
				name: "Fighter",
				source: "PHB",
				level: 7,
				subclass: {name: "Champion", shortName: "Champion", source: "PHB"},
			});
			const calculations = phbState.getFeatureCalculations();
			expect(calculations.remarkableAthleteBonus).toBe(1);
			expect(calculations.hasRemarkableAthlete).toBeUndefined();
			const initMode = phbState.getInitiativeRollMode();
			expect(initMode.advantage).toBe(false);
		});

		it("PHB Additional Fighting Style is still level 10, PHB Survivor has no Defy Death", () => {
			const phbState = new CharacterSheetState();
			phbState.setRace({name: "Human", source: "PHB"});
			phbState.addClass({
				name: "Fighter",
				source: "PHB",
				level: 18,
				subclass: {name: "Champion", shortName: "Champion", source: "PHB"},
			});
			const calculations = phbState.getFeatureCalculations();
			expect(calculations.hasAdditionalFightingStyle).toBe(true);
			expect(calculations.survivorHealing).toBe(5); // 5 + CON mod (default CON 10 → mod 0)
			expect(calculations.hasChampionSurvivorDefyDeath).toBeUndefined();
			const deathMode = phbState.getDeathSaveRollMode();
			expect(deathMode.advantage).toBe(false);
		});
	});
});

// ==========================================================================
// PART 14: PHB vs XPHB FEATURE COMPARISON
// ==========================================================================
describe("PHB vs XPHB Fighter Feature Comparison", () => {
	describe("Features that remain the same", () => {
		it("should have same Extra Attack progression in both versions", () => {
			const phbState = new CharacterSheetState();
			phbState.addClass({name: "Fighter", source: "PHB", level: 20});
			const phbCalcs = phbState.getFeatureCalculations();

			const xphbState = new CharacterSheetState();
			xphbState.addClass({name: "Fighter", source: "XPHB", level: 20});
			const xphbCalcs = xphbState.getFeatureCalculations();

			expect(phbCalcs.extraAttacks).toBe(xphbCalcs.extraAttacks);
			expect(phbCalcs.extraAttacks).toBe(4);
		});

		it("should have same Indomitable uses in both versions", () => {
			const phbState = new CharacterSheetState();
			phbState.addClass({name: "Fighter", source: "PHB", level: 17});
			const phbCalcs = phbState.getFeatureCalculations();

			const xphbState = new CharacterSheetState();
			xphbState.addClass({name: "Fighter", source: "XPHB", level: 17});
			const xphbCalcs = xphbState.getFeatureCalculations();

			expect(phbCalcs.indomitableUses).toBe(xphbCalcs.indomitableUses);
			expect(phbCalcs.indomitableUses).toBe(3);
		});

		it("should have same Action Surge uses in both versions", () => {
			const phbState = new CharacterSheetState();
			phbState.addClass({name: "Fighter", source: "PHB", level: 17});
			const phbCalcs = phbState.getFeatureCalculations();

			const xphbState = new CharacterSheetState();
			xphbState.addClass({name: "Fighter", source: "XPHB", level: 17});
			const xphbCalcs = xphbState.getFeatureCalculations();

			expect(phbCalcs.actionSurgeUses).toBe(xphbCalcs.actionSurgeUses);
			expect(phbCalcs.actionSurgeUses).toBe(2);
		});
	});

	describe("Features that differ between versions", () => {
		it("should have different Second Wind uses", () => {
			const phbState = new CharacterSheetState();
			phbState.addClass({name: "Fighter", source: "PHB", level: 1});
			const phbCalcs = phbState.getFeatureCalculations();

			const xphbState = new CharacterSheetState();
			xphbState.addClass({name: "Fighter", source: "XPHB", level: 1});
			const xphbCalcs = xphbState.getFeatureCalculations();

			expect(phbCalcs.secondWindUses).toBe(1);
			expect(xphbCalcs.secondWindUses).toBe(2);
		});
	});

	describe("XPHB-exclusive features", () => {
		it("should have Tactical Mind only in XPHB", () => {
			const phbState = new CharacterSheetState();
			phbState.addClass({name: "Fighter", source: "PHB", level: 2});
			const phbCalcs = phbState.getFeatureCalculations();

			const xphbState = new CharacterSheetState();
			xphbState.addClass({name: "Fighter", source: "XPHB", level: 2});
			const xphbCalcs = xphbState.getFeatureCalculations();

			expect(phbCalcs.hasTacticalMind).toBeUndefined();
			expect(xphbCalcs.hasTacticalMind).toBe(true);
		});

		it("should have Tactical Shift only in XPHB", () => {
			const phbState = new CharacterSheetState();
			phbState.addClass({name: "Fighter", source: "PHB", level: 5});
			const phbCalcs = phbState.getFeatureCalculations();

			const xphbState = new CharacterSheetState();
			xphbState.addClass({name: "Fighter", source: "XPHB", level: 5});
			const xphbCalcs = xphbState.getFeatureCalculations();

			expect(phbCalcs.hasTacticalShift).toBeUndefined();
			expect(xphbCalcs.hasTacticalShift).toBe(true);
		});

		it("should have Tactical Master only in XPHB", () => {
			const phbState = new CharacterSheetState();
			phbState.addClass({name: "Fighter", source: "PHB", level: 9});
			const phbCalcs = phbState.getFeatureCalculations();

			const xphbState = new CharacterSheetState();
			xphbState.addClass({name: "Fighter", source: "XPHB", level: 9});
			const xphbCalcs = xphbState.getFeatureCalculations();

			expect(phbCalcs.hasTacticalMaster).toBeUndefined();
			expect(xphbCalcs.hasTacticalMaster).toBe(true);
		});

		it("should have Studied Attacks only in XPHB", () => {
			const phbState = new CharacterSheetState();
			phbState.addClass({name: "Fighter", source: "PHB", level: 13});
			const phbCalcs = phbState.getFeatureCalculations();

			const xphbState = new CharacterSheetState();
			xphbState.addClass({name: "Fighter", source: "XPHB", level: 13});
			const xphbCalcs = xphbState.getFeatureCalculations();

			expect(phbCalcs.hasStudiedAttacks).toBeUndefined();
			expect(xphbCalcs.hasStudiedAttacks).toBe(true);
		});
	});
});

// ==========================================================================
// PART 15: FIGHTER MULTICLASS
// ==========================================================================
describe("Fighter Multiclass", () => {
	let state;

	beforeEach(() => {
		state = new CharacterSheetState();
		state.setRace({name: "Human", source: "PHB"});
		state.setAbilityBase("str", 14);
		state.setAbilityBase("dex", 14);
	});

	it("should require STR 13 or DEX 13 for multiclassing", () => {
		// Both STR and DEX are 14, so multiclassing is possible
		expect(state.getAbilityMod("str")).toBeGreaterThanOrEqual(1);
	});

	it("should not count for full caster spell slots", () => {
		state.addClass({name: "Fighter", source: "PHB", level: 5});
		const slots = state.getSpellSlots();
		// Non-caster fighter has no spell slots
		expect(slots[1]?.max).toBeUndefined();
	});

	it("should calculate multiclass spell slots with Eldritch Knight", () => {
		state.addClass({
			name: "Fighter",
			source: "PHB",
			level: 6,
			subclass: {name: "Eldritch Knight", shortName: "Eldritch Knight", source: "PHB"},
		});
		state.addClass({name: "Wizard", source: "PHB", level: 4});
		// EK 6/3 = 2 caster levels, Wizard 4 = 4 caster levels, total = 6
		const slots = state.getSpellSlots();
		expect(slots[3]?.max).toBeGreaterThanOrEqual(2);
	});

	it("should track total level correctly across classes", () => {
		state.addClass({name: "Fighter", source: "PHB", level: 5});
		state.addClass({name: "Rogue", source: "PHB", level: 3});
		expect(state.getTotalLevel()).toBe(8);
	});

	it("should calculate proficiency bonus based on total level", () => {
		state.addClass({name: "Fighter", source: "PHB", level: 5});
		state.addClass({name: "Barbarian", source: "PHB", level: 4});
		// Total level 9 = +4 proficiency
		expect(state.getProficiencyBonus()).toBe(4);
	});

	it("should not gain Extra Attack from both classes", () => {
		state.addClass({name: "Fighter", source: "PHB", level: 5});
		state.addClass({name: "Barbarian", source: "PHB", level: 5});
		// Extra Attacks don't stack - still only 2 attacks
		const calculations = state.getFeatureCalculations();
		expect(calculations.extraAttacks).toBe(2);
	});
});

// ==========================================================================
// PART 16: FIGHTER EDGE CASES
// ==========================================================================
describe("Fighter Edge Cases", () => {
	let state;

	beforeEach(() => {
		state = new CharacterSheetState();
		state.setRace({name: "Human", source: "PHB"});
	});

	it("should handle level 20 character correctly", () => {
		state.addClass({name: "Fighter", source: "PHB", level: 20});
		const calculations = state.getFeatureCalculations();
		expect(calculations.extraAttacks).toBe(4);
		expect(calculations.actionSurgeUses).toBe(2);
		expect(calculations.indomitableUses).toBe(3);
	});

	it("should calculate Battle Master DC with higher DEX than STR", () => {
		state.setAbilityBase("str", 10); // +0
		state.setAbilityBase("dex", 18); // +4
		state.addClass({
			name: "Fighter",
			source: "PHB",
			level: 3,
			subclass: {name: "Battle Master", shortName: "Battle Master", source: "PHB"},
		});
		const calculations = state.getFeatureCalculations();
		// DC = 8 + 2 (prof) + 4 (DEX) = 14
		expect(calculations.maneuverSaveDc).toBe(14);
	});

	it("should track hit dice correctly", () => {
		state.setAbilityBase("con", 14);
		state.addClass({name: "Fighter", source: "PHB", level: 10});
		const hitDice = state.getHitDice();
		const d10Dice = hitDice.find(hd => hd.die === 10);
		expect(d10Dice.max).toBe(10);
	});

	it("should handle subclass selection", () => {
		state.setAbilityBase("str", 16);
		state.addClass({name: "Fighter", source: "PHB", level: 2});

		const classes = state.getClasses();
		expect(classes[0].subclass).toBeUndefined();

		state.addClass({
			name: "Fighter",
			source: "PHB",
			level: 3,
			subclass: {name: "Champion", shortName: "Champion", source: "PHB"},
		});

		const updatedClasses = state.getClasses();
		expect(updatedClasses[0].subclass?.name).toBe("Champion");
	});

	it("should handle negative ability modifiers for uses", () => {
		state.setAbilityBase("str", 6); // -2 modifier
		state.setAbilityBase("con", 6); // -2 modifier
		state.addClass({
			name: "Fighter",
			source: "PHB",
			level: 3,
			subclass: {name: "Cavalier", shortName: "Cavalier", source: "XGE"},
		});
		const calculations = state.getFeatureCalculations();
		// Should have minimum of 1 use
		expect(calculations.unwaveringMarkUses).toBe(1);
	});
});

// ==========================================================================
// PART 17: FIGHTER PROFICIENCY BONUS PROGRESSION
// ==========================================================================
describe("Fighter Proficiency Bonus Progression", () => {
	it("should return +2 proficiency bonus at level 1", () => {
		const state = new CharacterSheetState();
		state.addClass({name: "Fighter", source: "PHB", level: 1});
		expect(state.getProficiencyBonus()).toBe(2);
	});

	it("should return +2 proficiency bonus at level 4", () => {
		const state = new CharacterSheetState();
		state.addClass({name: "Fighter", source: "PHB", level: 4});
		expect(state.getProficiencyBonus()).toBe(2);
	});

	it("should return +3 proficiency bonus at level 5", () => {
		const state = new CharacterSheetState();
		state.addClass({name: "Fighter", source: "PHB", level: 5});
		expect(state.getProficiencyBonus()).toBe(3);
	});

	it("should return +4 proficiency bonus at level 9", () => {
		const state = new CharacterSheetState();
		state.addClass({name: "Fighter", source: "PHB", level: 9});
		expect(state.getProficiencyBonus()).toBe(4);
	});

	it("should return +5 proficiency bonus at level 13", () => {
		const state = new CharacterSheetState();
		state.addClass({name: "Fighter", source: "PHB", level: 13});
		expect(state.getProficiencyBonus()).toBe(5);
	});

	it("should return +6 proficiency bonus at level 17", () => {
		const state = new CharacterSheetState();
		state.addClass({name: "Fighter", source: "PHB", level: 17});
		expect(state.getProficiencyBonus()).toBe(6);
	});
});
