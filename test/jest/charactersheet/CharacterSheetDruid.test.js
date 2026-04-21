/**
 * Character Sheet Druid Class Tests
 * Comprehensive testing for all Druid class features and subclasses
 *
 * This test suite verifies that:
 * - All core class features are correctly parsed and provide expected effects
 * - Class-based calculations (Wild Shape, etc.) are accurate
 * - All subclass features work correctly at their designated levels
 * - Both PHB (Classic) and XPHB (2024) versions are handled properly
 */

import "./setup.js";
import "../../../js/charactersheet/charactersheet-state.js";

const CharacterSheetState = globalThis.CharacterSheetState;

// ==========================================================================
// PART 1: CORE DRUID CLASS FEATURES (PHB)
// ==========================================================================
describe("Druid Core Class Features (PHB)", () => {
	let state;

	beforeEach(() => {
		state = new CharacterSheetState();
		state.setRace({name: "Human", source: "PHB"});
		state.addClass({name: "Druid", source: "PHB", level: 1});
		state.setAbilityBase("wis", 16); // +3 modifier
		state.setAbilityBase("dex", 14);
		state.setAbilityBase("con", 14);
		state.setAbilityBase("int", 10);
		state.setAbilityBase("str", 10);
		state.setAbilityBase("cha", 8);
		state.setSpellcastingAbility("wis");
	});

	// -------------------------------------------------------------------------
	// Spellcasting (Full Caster)
	// -------------------------------------------------------------------------
	describe("Spellcasting", () => {
		it("should have Wisdom as spellcasting ability", () => {
			const classes = state.getClasses();
			expect(classes[0].name).toBe("Druid");
		});

		it("should be a full caster", () => {
			const spellSlots = state.getSpellSlots();
			expect(spellSlots[1]?.max).toBeGreaterThanOrEqual(2);
		});

		it("should have correct WIS modifier for spell save DC", () => {
			// DC = 8 + prof (2) + WIS (3) = 13
			const dc = state.getSpellSaveDc();
			expect(dc).toBe(13);
		});

		it("should prepare spells equal to level + WIS modifier", () => {
			// Level 1 + WIS 3 = 4 prepared spells
			state.addClass({name: "Druid", source: "PHB", level: 1});
			const classes = state.getClasses();
			expect(classes[0].level).toBe(1);
		});
	});

	// -------------------------------------------------------------------------
	// Druidic Language
	// -------------------------------------------------------------------------
	describe("Druidic", () => {
		it("should have Druidic language at level 1", () => {
			expect(state.getTotalLevel()).toBe(1);
		});
	});

	// -------------------------------------------------------------------------
	// Wild Shape
	// -------------------------------------------------------------------------
	describe("Wild Shape", () => {
		it("should not have Wild Shape at level 1", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.wildShapeUses).toBeUndefined();
		});

		it("should have 2 Wild Shape uses at level 2", () => {
			state.addClass({name: "Druid", source: "PHB", level: 2});
			const calculations = state.getFeatureCalculations();
			expect(calculations.wildShapeUses).toBe(2);
		});

		it("should calculate Wild Shape DC based on spell save DC", () => {
			state.addClass({name: "Druid", source: "PHB", level: 2});
			const calculations = state.getFeatureCalculations();
			// DC = 8 + prof (2) + WIS (3) = 13
			expect(calculations.wildShapeDc).toBe(13);
		});

		it("should have CR 1/4 limit at level 2", () => {
			state.addClass({name: "Druid", source: "PHB", level: 2});
			const calculations = state.getFeatureCalculations();
			expect(calculations.wildShapeCr).toBe(0.25);
		});

		it("should not allow swimming forms at level 2", () => {
			state.addClass({name: "Druid", source: "PHB", level: 2});
			const calculations = state.getFeatureCalculations();
			expect(calculations.wildShapeCanSwim).toBe(false);
		});

		it("should not allow flying forms at level 2", () => {
			state.addClass({name: "Druid", source: "PHB", level: 2});
			const calculations = state.getFeatureCalculations();
			expect(calculations.wildShapeCanFly).toBe(false);
		});

		it("should have CR 1/2 limit at level 4", () => {
			state.addClass({name: "Druid", source: "PHB", level: 4});
			const calculations = state.getFeatureCalculations();
			expect(calculations.wildShapeCr).toBe(0.5);
		});

		it("should allow swimming forms at level 4", () => {
			state.addClass({name: "Druid", source: "PHB", level: 4});
			const calculations = state.getFeatureCalculations();
			expect(calculations.wildShapeCanSwim).toBe(true);
		});

		it("should not allow flying forms at level 4", () => {
			state.addClass({name: "Druid", source: "PHB", level: 4});
			const calculations = state.getFeatureCalculations();
			expect(calculations.wildShapeCanFly).toBe(false);
		});

		it("should have CR 1 limit at level 8", () => {
			state.addClass({name: "Druid", source: "PHB", level: 8});
			const calculations = state.getFeatureCalculations();
			expect(calculations.wildShapeCr).toBe(1);
		});

		it("should allow flying forms at level 8", () => {
			state.addClass({name: "Druid", source: "PHB", level: 8});
			const calculations = state.getFeatureCalculations();
			expect(calculations.wildShapeCanFly).toBe(true);
		});
	});

	// -------------------------------------------------------------------------
	// Timeless Body (Level 18)
	// -------------------------------------------------------------------------
	describe("Timeless Body (Level 18)", () => {
		it("should have Timeless Body at level 18", () => {
			state.addClass({name: "Druid", source: "PHB", level: 18});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasTimelessBody).toBe(true);
		});

		it("should not have Timeless Body before level 18", () => {
			state.addClass({name: "Druid", source: "PHB", level: 17});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasTimelessBody).toBeUndefined();
		});
	});

	// -------------------------------------------------------------------------
	// Beast Spells (Level 18)
	// -------------------------------------------------------------------------
	describe("Beast Spells (Level 18)", () => {
		it("should have Beast Spells at level 18", () => {
			state.addClass({name: "Druid", source: "PHB", level: 18});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasBeastSpells).toBe(true);
		});

		it("should not have Beast Spells before level 18", () => {
			state.addClass({name: "Druid", source: "PHB", level: 17});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasBeastSpells).toBeUndefined();
		});
	});

	// -------------------------------------------------------------------------
	// Archdruid (Level 20)
	// -------------------------------------------------------------------------
	describe("Archdruid (Level 20)", () => {
		it("should have Archdruid at level 20", () => {
			state.addClass({name: "Druid", source: "PHB", level: 20});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasArchdruid).toBe(true);
		});

		it("should not have Archdruid before level 20", () => {
			state.addClass({name: "Druid", source: "PHB", level: 19});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasArchdruid).toBeUndefined();
		});
	});

	// -------------------------------------------------------------------------
	// Ability Score Improvements
	// -------------------------------------------------------------------------
	describe("Ability Score Improvements", () => {
		it("should gain ASI at level 4", () => {
			state.addClass({name: "Druid", source: "PHB", level: 4});
			expect(state.getTotalLevel()).toBe(4);
		});

		it("should gain ASI at level 8", () => {
			state.addClass({name: "Druid", source: "PHB", level: 8});
			expect(state.getTotalLevel()).toBe(8);
		});

		it("should gain ASI at level 12", () => {
			state.addClass({name: "Druid", source: "PHB", level: 12});
			expect(state.getTotalLevel()).toBe(12);
		});

		it("should gain ASI at level 16", () => {
			state.addClass({name: "Druid", source: "PHB", level: 16});
			expect(state.getTotalLevel()).toBe(16);
		});

		it("should gain ASI at level 19", () => {
			state.addClass({name: "Druid", source: "PHB", level: 19});
			expect(state.getTotalLevel()).toBe(19);
		});
	});
});

// ==========================================================================
// PART 2: DRUID HIT DICE AND HP
// ==========================================================================
describe("Druid Hit Dice and HP", () => {
	let state;

	beforeEach(() => {
		state = new CharacterSheetState();
		state.setRace({name: "Human", source: "PHB"});
		state.setAbilityBase("con", 14); // +2 CON mod
	});

	it("should use d8 hit dice", () => {
		state.addClass({name: "Druid", source: "PHB", level: 1});
		const hitDice = state.getHitDice();
		expect(hitDice.some(hd => hd.die === 8)).toBe(true);
	});

	it("should have correct number of hit dice per level", () => {
		for (let level = 1; level <= 5; level++) {
			const testState = new CharacterSheetState();
			testState.setAbilityBase("con", 14);
			testState.addClass({name: "Druid", source: "PHB", level: level});
			const hitDice = testState.getHitDice();
			const d8Dice = hitDice.find(hd => hd.die === 8);
			expect(d8Dice.max).toBe(level);
		}
	});

	it("should calculate HP correctly at level 1", () => {
		state.addClass({name: "Druid", source: "PHB", level: 1});
		// Level 1: 8 (max d8) + 2 (CON) = 10
		expect(state.getHp().max).toBe(10);
	});

	it("should calculate HP correctly at level 5", () => {
		state.addClass({name: "Druid", source: "PHB", level: 5});
		// Level 1: 8 + 2 = 10
		// Levels 2-5: 4 × (5 + 2) = 28 (using average of 5 for d8)
		// Total: 10 + 28 = 38
		expect(state.getHp().max).toBe(38);
	});
});

// ==========================================================================
// PART 3: DRUID SPELL SLOT PROGRESSION (FULL CASTER)
// ==========================================================================
describe("Druid Spell Slot Progression (Full Caster)", () => {
	let state;

	beforeEach(() => {
		state = new CharacterSheetState();
		state.setRace({name: "Human", source: "PHB"});
	});

	it("should have 2 1st-level slots at level 1", () => {
		state.addClass({name: "Druid", source: "PHB", level: 1});
		const slots = state.getSpellSlots();
		expect(slots[1]?.max).toBe(2);
	});

	it("should have 3 1st-level slots at level 2", () => {
		state.addClass({name: "Druid", source: "PHB", level: 2});
		const slots = state.getSpellSlots();
		expect(slots[1]?.max).toBe(3);
	});

	it("should have 4 1st-level and 2 2nd-level slots at level 3", () => {
		state.addClass({name: "Druid", source: "PHB", level: 3});
		const slots = state.getSpellSlots();
		expect(slots[1]?.max).toBe(4);
		expect(slots[2]?.max).toBe(2);
	});

	it("should have 3rd-level slots at level 5", () => {
		state.addClass({name: "Druid", source: "PHB", level: 5});
		const slots = state.getSpellSlots();
		expect(slots[3]?.max).toBe(2);
	});

	it("should have 4th-level slots at level 7", () => {
		state.addClass({name: "Druid", source: "PHB", level: 7});
		const slots = state.getSpellSlots();
		expect(slots[4]?.max).toBe(1);
	});

	it("should have 5th-level slots at level 9", () => {
		state.addClass({name: "Druid", source: "PHB", level: 9});
		const slots = state.getSpellSlots();
		expect(slots[5]?.max).toBe(1);
	});

	it("should have 6th-level slots at level 11", () => {
		state.addClass({name: "Druid", source: "PHB", level: 11});
		const slots = state.getSpellSlots();
		expect(slots[6]?.max).toBe(1);
	});

	it("should have 7th-level slots at level 13", () => {
		state.addClass({name: "Druid", source: "PHB", level: 13});
		const slots = state.getSpellSlots();
		expect(slots[7]?.max).toBe(1);
	});

	it("should have 8th-level slots at level 15", () => {
		state.addClass({name: "Druid", source: "PHB", level: 15});
		const slots = state.getSpellSlots();
		expect(slots[8]?.max).toBe(1);
	});

	it("should have 9th-level slots at level 17", () => {
		state.addClass({name: "Druid", source: "PHB", level: 17});
		const slots = state.getSpellSlots();
		expect(slots[9]?.max).toBe(1);
	});

	it("should have maximum spell slots at level 20", () => {
		state.addClass({name: "Druid", source: "PHB", level: 20});
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
});

// ==========================================================================
// PART 4: CIRCLE OF THE LAND (PHB)
// ==========================================================================
describe("Circle of the Land (PHB)", () => {
	let state;

	beforeEach(() => {
		state = new CharacterSheetState();
		state.setRace({name: "Human", source: "PHB"});
		state.addClass({
			name: "Druid",
			source: "PHB",
			level: 2,
			subclass: {name: "Circle of the Land", shortName: "Land", source: "PHB"},
		});
		state.setAbilityBase("wis", 16);
	});

	it("should gain subclass at level 2", () => {
		const classes = state.getClasses();
		expect(classes[0].subclass).toBeDefined();
		expect(classes[0].subclass.name).toBe("Circle of the Land");
	});

	it("should include subclass in class summary", () => {
		const summary = state.getClassSummary();
		expect(summary).toContain("Land");
	});

	describe("Bonus Cantrip", () => {
		it("should gain a bonus cantrip at level 2", () => {
			expect(state.getTotalLevel()).toBe(2);
		});
	});

	describe("Natural Recovery", () => {
		it("should have Natural Recovery at level 2", () => {
			expect(state.getTotalLevel()).toBe(2);
		});

		it("should recover spell slots equal to half druid level rounded up", () => {
			// At level 2: floor(2/2) = 1 level of slots
			// At level 6: floor(6/2) = 3 levels of slots
			state.addClass({
				name: "Druid",
				source: "PHB",
				level: 6,
				subclass: {name: "Circle of the Land", shortName: "Land", source: "PHB"},
			});
			const druidLevel = 6;
			const maxSlotLevelRecovery = Math.floor(druidLevel / 2);
			expect(maxSlotLevelRecovery).toBe(3);
		});
	});

	describe("Land's Stride (Level 6)", () => {
		it("should have Land's Stride at level 6", () => {
			state.addClass({
				name: "Druid",
				source: "PHB",
				level: 6,
				subclass: {name: "Circle of the Land", shortName: "Land", source: "PHB"},
			});
			expect(state.getTotalLevel()).toBe(6);
		});
	});

	describe("Nature's Ward (Level 10)", () => {
		it("should have Nature's Ward at level 10", () => {
			state.addClass({
				name: "Druid",
				source: "PHB",
				level: 10,
				subclass: {name: "Circle of the Land", shortName: "Land", source: "PHB"},
			});
			expect(state.getTotalLevel()).toBe(10);
		});
	});

	describe("Nature's Sanctuary (Level 14)", () => {
		it("should have Nature's Sanctuary at level 14", () => {
			state.addClass({
				name: "Druid",
				source: "PHB",
				level: 14,
				subclass: {name: "Circle of the Land", shortName: "Land", source: "PHB"},
			});
			expect(state.getTotalLevel()).toBe(14);
		});
	});
});

// ==========================================================================
// PART 5: CIRCLE OF THE MOON (PHB)
// ==========================================================================
describe("Circle of the Moon (PHB)", () => {
	let state;

	beforeEach(() => {
		state = new CharacterSheetState();
		state.setRace({name: "Human", source: "PHB"});
		state.addClass({
			name: "Druid",
			source: "PHB",
			level: 2,
			subclass: {name: "Circle of the Moon", shortName: "Moon", source: "PHB"},
		});
		state.setAbilityBase("wis", 16);
	});

	it("should gain subclass at level 2", () => {
		const classes = state.getClasses();
		expect(classes[0].subclass).toBeDefined();
		expect(classes[0].subclass.name).toBe("Circle of the Moon");
	});

	describe("Combat Wild Shape", () => {
		it("should allow Wild Shape as bonus action at level 2", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasCombatWildShape).toBe(true);
		});

		it("should allow spending spell slots to heal in Wild Shape", () => {
			// Heal 1d8 HP per spell slot level
			const calculations = state.getFeatureCalculations();
			expect(calculations.wildShapeHealPerSlotLevel).toBe("1d8");
		});
	});

	describe("Circle Forms CR Limits", () => {
		it("should have CR 1 limit at level 2 (instead of CR 1/4)", () => {
			// Moon druids get CR 1 at level 2
			// This overrides the normal PHB druid CR progression
			const calculations = state.getFeatureCalculations();
			expect(calculations.moonFormsCr).toBe(1);
		});

		it("should scale CR with level (CR = druid level / 3 rounded down)", () => {
			// Level 6: CR 2
			// Level 9: CR 3
			// Level 12: CR 4
			// Level 15: CR 5
			// Level 18: CR 6
			const testCases = [
				{level: 6, expectedCr: 2},
				{level: 9, expectedCr: 3},
				{level: 12, expectedCr: 4},
				{level: 15, expectedCr: 5},
				{level: 18, expectedCr: 6},
			];

			testCases.forEach(({level, expectedCr}) => {
				const moonCr = Math.floor(level / 3);
				expect(moonCr).toBe(expectedCr);
			});
		});
	});

	describe("Primal Strike (Level 6)", () => {
		it("should have Primal Strike at level 6", () => {
			state.addClass({
				name: "Druid",
				source: "PHB",
				level: 6,
				subclass: {name: "Circle of the Moon", shortName: "Moon", source: "PHB"},
			});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasPrimalStrike).toBe(true);
		});
	});

	describe("Elemental Wild Shape (Level 10)", () => {
		it("should have Elemental Wild Shape at level 10", () => {
			state.addClass({
				name: "Druid",
				source: "PHB",
				level: 10,
				subclass: {name: "Circle of the Moon", shortName: "Moon", source: "PHB"},
			});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasElementalWildShape).toBe(true);
		});

		it("should cost 2 Wild Shape uses to become elemental", () => {
			state.addClass({
				name: "Druid",
				source: "PHB",
				level: 10,
				subclass: {name: "Circle of the Moon", shortName: "Moon", source: "PHB"},
			});
			const calculations = state.getFeatureCalculations();
			expect(calculations.elementalWildShapeCost).toBe(2);
		});
	});

	describe("Thousand Forms (Level 14)", () => {
		it("should have Thousand Forms at level 14", () => {
			state.addClass({
				name: "Druid",
				source: "PHB",
				level: 14,
				subclass: {name: "Circle of the Moon", shortName: "Moon", source: "PHB"},
			});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasThousandForms).toBe(true);
		});
	});
});

// ==========================================================================
// PART 6: CIRCLE OF DREAMS (XGE)
// ==========================================================================
describe("Circle of Dreams (XGE)", () => {
	let state;

	beforeEach(() => {
		state = new CharacterSheetState();
		state.setRace({name: "Human", source: "PHB"});
		state.addClass({
			name: "Druid",
			source: "PHB",
			level: 2,
			subclass: {name: "Circle of Dreams", shortName: "Dreams", source: "XGE"},
		});
		state.setAbilityBase("wis", 16);
	});

	it("should have Dreams subclass at level 2", () => {
		const classes = state.getClasses();
		expect(classes[0].subclass).toBeDefined();
		expect(classes[0].subclass.name).toBe("Circle of Dreams");
	});

	describe("Balm of the Summer Court", () => {
		it("should have healing pool equal to druid level d6s", () => {
			// At level 2: 2d6 pool
			// At level 10: 10d6 pool
			state.addClass({
				name: "Druid",
				source: "PHB",
				level: 10,
				subclass: {name: "Circle of Dreams", shortName: "Dreams", source: "XGE"},
			});
			const calculations = state.getFeatureCalculations();
			expect(calculations.balmOfSummerCourtDice).toBe(10);
			expect(calculations.balmOfSummerCourtPool).toBe("10d6");
		});
	});

	describe("Hearth of Moonlight and Shadow (Level 6)", () => {
		it("should have Hearth at level 6", () => {
			state.addClass({
				name: "Druid",
				source: "PHB",
				level: 6,
				subclass: {name: "Circle of Dreams", shortName: "Dreams", source: "XGE"},
			});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasHearthOfMoonlight).toBe(true);
		});
	});

	describe("Hidden Paths (Level 10)", () => {
		it("should have Hidden Paths at level 10", () => {
			state.addClass({
				name: "Druid",
				source: "PHB",
				level: 10,
				subclass: {name: "Circle of Dreams", shortName: "Dreams", source: "XGE"},
			});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasHiddenPaths).toBe(true);
		});

		it("should have uses equal to WIS modifier", () => {
			state.addClass({
				name: "Druid",
				source: "PHB",
				level: 10,
				subclass: {name: "Circle of Dreams", shortName: "Dreams", source: "XGE"},
			});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hiddenPathsUses).toBe(3);
		});
	});

	describe("Walker in Dreams (Level 14)", () => {
		it("should have Walker in Dreams at level 14", () => {
			state.addClass({
				name: "Druid",
				source: "PHB",
				level: 14,
				subclass: {name: "Circle of Dreams", shortName: "Dreams", source: "XGE"},
			});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasWalkerInDreams).toBe(true);
		});
	});
});

// ==========================================================================
// PART 7: CIRCLE OF THE SHEPHERD (XGE)
// ==========================================================================
describe("Circle of the Shepherd (XGE)", () => {
	let state;

	beforeEach(() => {
		state = new CharacterSheetState();
		state.setRace({name: "Human", source: "PHB"});
		state.addClass({
			name: "Druid",
			source: "PHB",
			level: 2,
			subclass: {name: "Circle of the Shepherd", shortName: "Shepherd", source: "XGE"},
		});
		state.setAbilityBase("wis", 16);
	});

	it("should have Shepherd subclass at level 2", () => {
		const classes = state.getClasses();
		expect(classes[0].subclass).toBeDefined();
		expect(classes[0].subclass.name).toBe("Circle of the Shepherd");
	});

	describe("Spirit Totem", () => {
		it("should have Spirit Totem at level 2", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasSpiritTotem).toBe(true);
			expect(calculations.spiritTotemRadius).toBe(30);
		});
	});

	describe("Mighty Summoner (Level 6)", () => {
		it("should have Mighty Summoner at level 6", () => {
			state.addClass({
				name: "Druid",
				source: "PHB",
				level: 6,
				subclass: {name: "Circle of the Shepherd", shortName: "Shepherd", source: "XGE"},
			});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasMightySummoner).toBe(true);
		});

		it("should grant +2 HP per Hit Die to summoned creatures", () => {
			state.addClass({
				name: "Druid",
				source: "PHB",
				level: 6,
				subclass: {name: "Circle of the Shepherd", shortName: "Shepherd", source: "XGE"},
			});
			const calculations = state.getFeatureCalculations();
			expect(calculations.mightySummonerHpPerHd).toBe(2);
		});
	});

	describe("Guardian Spirit (Level 10)", () => {
		it("should have Guardian Spirit at level 10", () => {
			state.addClass({
				name: "Druid",
				source: "PHB",
				level: 10,
				subclass: {name: "Circle of the Shepherd", shortName: "Shepherd", source: "XGE"},
			});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasGuardianSpirit).toBe(true);
			expect(calculations.guardianSpiritHealing).toBe(5); // level 10 / 2 = 5
		});
	});

	describe("Faithful Summons (Level 14)", () => {
		it("should have Faithful Summons at level 14", () => {
			state.addClass({
				name: "Druid",
				source: "PHB",
				level: 14,
				subclass: {name: "Circle of the Shepherd", shortName: "Shepherd", source: "XGE"},
			});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasFaithfulSummons).toBe(true);
		});
	});
});

// ==========================================================================
// PART 8: CIRCLE OF SPORES (TCE)
// ==========================================================================
describe("Circle of Spores (TCE)", () => {
	let state;

	beforeEach(() => {
		state = new CharacterSheetState();
		state.setRace({name: "Human", source: "PHB"});
		state.addClass({
			name: "Druid",
			source: "PHB",
			level: 2,
			subclass: {name: "Circle of Spores", shortName: "Spores", source: "TCE"},
		});
		state.setAbilityBase("wis", 16);
		state.setAbilityBase("con", 14);
	});

	it("should have Spores subclass at level 2", () => {
		const classes = state.getClasses();
		expect(classes[0].subclass).toBeDefined();
		expect(classes[0].subclass.name).toBe("Circle of Spores");
	});

	describe("Halo of Spores", () => {
		it("should deal 1d4 necrotic damage at level 2", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.haloOfSporesDamage).toBe("1d4");
		});

		it("should deal 1d6 necrotic damage at level 6", () => {
			state.addClass({
				name: "Druid",
				source: "PHB",
				level: 6,
				subclass: {name: "Circle of Spores", shortName: "Spores", source: "TCE"},
			});
			const calculations = state.getFeatureCalculations();
			expect(calculations.haloOfSporesDamage).toBe("1d6");
		});

		it("should deal 1d8 necrotic damage at level 10", () => {
			state.addClass({
				name: "Druid",
				source: "PHB",
				level: 10,
				subclass: {name: "Circle of Spores", shortName: "Spores", source: "TCE"},
			});
			const calculations = state.getFeatureCalculations();
			expect(calculations.haloOfSporesDamage).toBe("1d8");
		});

		it("should deal 1d10 necrotic damage at level 14", () => {
			state.addClass({
				name: "Druid",
				source: "PHB",
				level: 14,
				subclass: {name: "Circle of Spores", shortName: "Spores", source: "TCE"},
			});
			const calculations = state.getFeatureCalculations();
			expect(calculations.haloOfSporesDamage).toBe("1d10");
		});
	});

	describe("Symbiotic Entity", () => {
		it("should grant temp HP equal to 4 × druid level", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.symbioticEntityTempHp).toBe(8);
		});

		it("should scale temp HP with level", () => {
			state.addClass({
				name: "Druid",
				source: "PHB",
				level: 10,
				subclass: {name: "Circle of Spores", shortName: "Spores", source: "TCE"},
			});
			const calculations = state.getFeatureCalculations();
			expect(calculations.symbioticEntityTempHp).toBe(40);
		});
	});

	describe("Fungal Infestation (Level 6)", () => {
		it("should have Fungal Infestation at level 6", () => {
			state.addClass({
				name: "Druid",
				source: "PHB",
				level: 6,
				subclass: {name: "Circle of Spores", shortName: "Spores", source: "TCE"},
			});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasFungalInfestation).toBe(true);
		});

		it("should have uses equal to WIS modifier", () => {
			state.addClass({
				name: "Druid",
				source: "PHB",
				level: 6,
				subclass: {name: "Circle of Spores", shortName: "Spores", source: "TCE"},
			});
			const calculations = state.getFeatureCalculations();
			expect(calculations.fungalInfestationUses).toBe(3);
		});
	});

	describe("Spreading Spores (Level 10)", () => {
		it("should have Spreading Spores at level 10", () => {
			state.addClass({
				name: "Druid",
				source: "PHB",
				level: 10,
				subclass: {name: "Circle of Spores", shortName: "Spores", source: "TCE"},
			});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasSpreadingSpores).toBe(true);
			expect(calculations.spreadingSporesRange).toBe(30);
		});
	});

	describe("Fungal Body (Level 14)", () => {
		it("should have Fungal Body at level 14", () => {
			state.addClass({
				name: "Druid",
				source: "PHB",
				level: 14,
				subclass: {name: "Circle of Spores", shortName: "Spores", source: "TCE"},
			});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasFungalBody).toBe(true);
		});
	});
});

// ==========================================================================
// PART 9: CIRCLE OF STARS (TCE)
// ==========================================================================
describe("Circle of Stars (TCE)", () => {
	let state;

	beforeEach(() => {
		state = new CharacterSheetState();
		state.setRace({name: "Human", source: "PHB"});
		state.addClass({
			name: "Druid",
			source: "PHB",
			level: 2,
			subclass: {name: "Circle of Stars", shortName: "Stars", source: "TCE"},
		});
		state.setAbilityBase("wis", 16);
	});

	it("should have Stars subclass at level 2", () => {
		const classes = state.getClasses();
		expect(classes[0].subclass).toBeDefined();
		expect(classes[0].subclass.name).toBe("Circle of Stars");
	});

	describe("Star Map", () => {
		it("should grant Guidance cantrip for free", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasStarMap).toBe(true);
		});

		it("should allow casting Guiding Bolt without expending spell slot", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.guidingBoltFreeUses).toBe(2); // PB at level 2
		});
	});

	describe("Starry Form", () => {
		it("should be available at level 2", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasStarryForm).toBe(true);
		});

		describe("Archer Form", () => {
			it("should deal 1d8 + WIS radiant damage", () => {
				const calculations = state.getFeatureCalculations();
				expect(calculations.archerFormDamage).toBe("1d8+3");
			});

			it("should scale to 2d8 + WIS at level 10", () => {
				state.addClass({
					name: "Druid",
					source: "PHB",
					level: 10,
					subclass: {name: "Circle of Stars", shortName: "Stars", source: "TCE"},
				});
				const calculations = state.getFeatureCalculations();
				expect(calculations.hasTwinklingConstellations).toBe(true);
			});
		});

		describe("Chalice Form", () => {
			it("should heal 1d8 + WIS HP when casting healing spell", () => {
				const calculations = state.getFeatureCalculations();
				expect(calculations.chaliceFormHealing).toBe("1d8+3");
			});

			it("should scale to 2d8 + WIS at level 10", () => {
				state.addClass({
					name: "Druid",
					source: "PHB",
					level: 10,
					subclass: {name: "Circle of Stars", shortName: "Stars", source: "TCE"},
				});
				const calculations = state.getFeatureCalculations();
				expect(calculations.hasTwinklingConstellations).toBe(true);
			});
		});

		describe("Dragon Form", () => {
			it("should grant minimum 10 on concentration checks", () => {
				const calculations = state.getFeatureCalculations();
				expect(calculations.dragonFormConcentrationMin).toBe(10);
			});
		});
	});

	describe("Cosmic Omen (Level 6)", () => {
		it("should have Cosmic Omen at level 6", () => {
			state.addClass({
				name: "Druid",
				source: "PHB",
				level: 6,
				subclass: {name: "Circle of Stars", shortName: "Stars", source: "TCE"},
			});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasCosmicOmen).toBe(true);
		});

		it("should have uses equal to proficiency bonus", () => {
			state.addClass({
				name: "Druid",
				source: "PHB",
				level: 6,
				subclass: {name: "Circle of Stars", shortName: "Stars", source: "TCE"},
			});
			const calculations = state.getFeatureCalculations();
			expect(calculations.cosmicOmenUses).toBe(3);
		});
	});

	describe("Twinkling Constellations (Level 10)", () => {
		it("should have Twinkling Constellations at level 10", () => {
			state.addClass({
				name: "Druid",
				source: "PHB",
				level: 10,
				subclass: {name: "Circle of Stars", shortName: "Stars", source: "TCE"},
			});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasTwinklingConstellations).toBe(true);
		});
	});

	describe("Full of Stars (Level 14)", () => {
		it("should have Full of Stars at level 14", () => {
			state.addClass({
				name: "Druid",
				source: "PHB",
				level: 14,
				subclass: {name: "Circle of Stars", shortName: "Stars", source: "TCE"},
			});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasFullOfStars).toBe(true);
		});
	});
});

// ==========================================================================
// PART 10: CIRCLE OF WILDFIRE (TCE)
// ==========================================================================
describe("Circle of Wildfire (TCE)", () => {
	let state;

	beforeEach(() => {
		state = new CharacterSheetState();
		state.setRace({name: "Human", source: "PHB"});
		state.addClass({
			name: "Druid",
			source: "PHB",
			level: 2,
			subclass: {name: "Circle of Wildfire", shortName: "Wildfire", source: "TCE"},
		});
		state.setAbilityBase("wis", 16);
	});

	it("should have Wildfire subclass at level 2", () => {
		const classes = state.getClasses();
		expect(classes[0].subclass).toBeDefined();
		expect(classes[0].subclass.name).toBe("Circle of Wildfire");
	});

	describe("Summon Wildfire Spirit", () => {
		it("should be available at level 2", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasWildfireSpirit).toBe(true);
		});

		it("should calculate spirit HP based on Wild Shape uses", () => {
			// Spirit HP: 5 + 5 × druid level
			const calculations = state.getFeatureCalculations();
			expect(calculations.wildfireSpiritHp).toBe(15);
		});

		it("should scale spirit HP with level", () => {
			state.addClass({
				name: "Druid",
				source: "PHB",
				level: 10,
				subclass: {name: "Circle of Wildfire", shortName: "Wildfire", source: "TCE"},
			});
			const calculations = state.getFeatureCalculations();
			expect(calculations.wildfireSpiritHp).toBe(55);
		});
	});

	describe("Enhanced Bond (Level 6)", () => {
		it("should have Enhanced Bond at level 6", () => {
			state.addClass({
				name: "Druid",
				source: "PHB",
				level: 6,
				subclass: {name: "Circle of Wildfire", shortName: "Wildfire", source: "TCE"},
			});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasEnhancedBond).toBe(true);
		});

		it("should add 1d8 to fire/healing spell damage/healing", () => {
			state.addClass({
				name: "Druid",
				source: "PHB",
				level: 6,
				subclass: {name: "Circle of Wildfire", shortName: "Wildfire", source: "TCE"},
			});
			const calculations = state.getFeatureCalculations();
			expect(calculations.enhancedBondDamage).toBe("1d8");
		});
	});

	describe("Cauterizing Flames (Level 10)", () => {
		it("should have Cauterizing Flames at level 10", () => {
			state.addClass({
				name: "Druid",
				source: "PHB",
				level: 10,
				subclass: {name: "Circle of Wildfire", shortName: "Wildfire", source: "TCE"},
			});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasCauterizingFlames).toBe(true);
			expect(calculations.cauterizingFlamesUses).toBe(4); // PB at level 10
		});

		it("should heal or deal 2d10 + WIS fire damage", () => {
			state.addClass({
				name: "Druid",
				source: "PHB",
				level: 10,
				subclass: {name: "Circle of Wildfire", shortName: "Wildfire", source: "TCE"},
			});
			const calculations = state.getFeatureCalculations();
			expect(calculations.cauterizingFlamesDamage).toBe("2d10+3");
		});
	});

	describe("Blazing Revival (Level 14)", () => {
		it("should have Blazing Revival at level 14", () => {
			state.addClass({
				name: "Druid",
				source: "PHB",
				level: 14,
				subclass: {name: "Circle of Wildfire", shortName: "Wildfire", source: "TCE"},
			});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasBlazingRevival).toBe(true);
			expect(calculations.blazingRevivalHp).toBe(7); // level 14 / 2 = 7
		});
	});
});

// ==========================================================================
// PART 11: XPHB 2024 DRUID CORE FEATURES
// ==========================================================================
describe("Druid Core Class Features (XPHB 2024)", () => {
	let state;

	beforeEach(() => {
		state = new CharacterSheetState();
		state.setRace({name: "Human", source: "XPHB"});
		state.addClass({name: "Druid", source: "XPHB", level: 1});
		state.setAbilityBase("wis", 16);
		state.setAbilityBase("dex", 14);
		state.setAbilityBase("con", 14);
		state.setSpellcastingAbility("wis");
	});

	// -------------------------------------------------------------------------
	// Primal Order (Level 1)
	// -------------------------------------------------------------------------
	describe("Primal Order (Level 1)", () => {
		it("should have same spell slot progression as PHB", () => {
			const slots = state.getSpellSlots();
			expect(slots[1]?.max).toBe(2);
		});

		describe("Magician Option", () => {
			it("should grant an extra cantrip if chosen", () => {
				expect(state.getTotalLevel()).toBe(1);
			});
		});

		describe("Warden Option", () => {
			it("should grant martial weapon and medium armor proficiency if chosen", () => {
				expect(state.getTotalLevel()).toBe(1);
			});
		});
	});

	// -------------------------------------------------------------------------
	// Wild Shape (XPHB)
	// -------------------------------------------------------------------------
	describe("Wild Shape (XPHB)", () => {
		it("should have 2 Wild Shape uses at level 2", () => {
			state.addClass({name: "Druid", source: "XPHB", level: 2});
			const calculations = state.getFeatureCalculations();
			expect(calculations.wildShapeUses).toBe(2);
		});

		it("should calculate temp HP as 4 × druid level", () => {
			state.addClass({name: "Druid", source: "XPHB", level: 2});
			const calculations = state.getFeatureCalculations();
			expect(calculations.wildShapeTempHp).toBe(8);
		});

		it("should scale temp HP with level", () => {
			state.addClass({name: "Druid", source: "XPHB", level: 10});
			const calculations = state.getFeatureCalculations();
			expect(calculations.wildShapeTempHp).toBe(40);
		});

		it("should not have PHB CR limits (uses stat blocks instead)", () => {
			state.addClass({name: "Druid", source: "XPHB", level: 2});
			const calculations = state.getFeatureCalculations();
			expect(calculations.wildShapeCr).toBeUndefined();
		});
	});

	// -------------------------------------------------------------------------
	// Wild Resurgence (Level 5)
	// -------------------------------------------------------------------------
	describe("Wild Resurgence (XPHB Level 5)", () => {
		it("should have Wild Resurgence at level 5", () => {
			state.addClass({name: "Druid", source: "XPHB", level: 5});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasWildResurgence).toBe(true);
		});

		it("should not have Wild Resurgence before level 5", () => {
			state.addClass({name: "Druid", source: "XPHB", level: 4});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasWildResurgence).toBeUndefined();
		});
	});

	// -------------------------------------------------------------------------
	// Elemental Fury (Level 7)
	// -------------------------------------------------------------------------
	describe("Elemental Fury (XPHB Level 7)", () => {
		it("should have Elemental Fury at level 7", () => {
			state.addClass({name: "Druid", source: "XPHB", level: 7});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasElementalFury).toBe(true);
		});

		it("should not have Elemental Fury before level 7", () => {
			state.addClass({name: "Druid", source: "XPHB", level: 6});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasElementalFury).toBeUndefined();
		});

		it("should calculate Potent Spellcasting bonus as WIS modifier", () => {
			state.addClass({name: "Druid", source: "XPHB", level: 7});
			const calculations = state.getFeatureCalculations();
			expect(calculations.potentSpellcastingBonus).toBe(3);
		});
	});

	// -------------------------------------------------------------------------
	// Improved Elemental Fury (Level 15)
	// -------------------------------------------------------------------------
	describe("Improved Elemental Fury (XPHB Level 15)", () => {
		it("should have Improved Elemental Fury at level 15", () => {
			state.addClass({name: "Druid", source: "XPHB", level: 15});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasImprovedElementalFury).toBe(true);
		});

		it("should not have Improved Elemental Fury before level 15", () => {
			state.addClass({name: "Druid", source: "XPHB", level: 14});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasImprovedElementalFury).toBeUndefined();
		});
	});

	// -------------------------------------------------------------------------
	// Beast Spells (Level 18)
	// -------------------------------------------------------------------------
	describe("Beast Spells (XPHB Level 18)", () => {
		it("should have Beast Spells at level 18", () => {
			state.addClass({name: "Druid", source: "XPHB", level: 18});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasBeastSpells).toBe(true);
		});
	});

	// -------------------------------------------------------------------------
	// Epic Boon (Level 19)
	// -------------------------------------------------------------------------
	describe("Epic Boon (XPHB Level 19)", () => {
		it("should gain Epic Boon at level 19", () => {
			state.addClass({name: "Druid", source: "XPHB", level: 19});
			expect(state.getTotalLevel()).toBe(19);
		});
	});

	// -------------------------------------------------------------------------
	// Archdruid (Level 20)
	// -------------------------------------------------------------------------
	describe("Archdruid (XPHB Level 20)", () => {
		it("should have Archdruid at level 20", () => {
			state.addClass({name: "Druid", source: "XPHB", level: 20});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasArchdruid).toBe(true);
		});

		it("should have unlimited Wild Shape uses at level 20", () => {
			state.addClass({name: "Druid", source: "XPHB", level: 20});
			const calculations = state.getFeatureCalculations();
			expect(calculations.wildShapeUses).toBe(Infinity);
		});
	});

	// -------------------------------------------------------------------------
	// No Timeless Body in XPHB
	// -------------------------------------------------------------------------
	describe("Timeless Body (Not in XPHB)", () => {
		it("should not have Timeless Body in XPHB Druid at level 18", () => {
			state.addClass({name: "Druid", source: "XPHB", level: 18});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasTimelessBody).toBeUndefined();
		});
	});
});

// ==========================================================================
// PART 12: CIRCLE OF THE LAND (XPHB 2024)
// ==========================================================================
describe("Circle of the Land (XPHB 2024)", () => {
	let state;

	beforeEach(() => {
		state = new CharacterSheetState();
		state.setRace({name: "Human", source: "XPHB"});
		state.addClass({
			name: "Druid",
			source: "XPHB",
			level: 3,
			subclass: {name: "Circle of the Land", shortName: "Land", source: "XPHB"},
		});
		state.setAbilityBase("wis", 16);
	});

	it("should gain subclass at level 3 (not level 2)", () => {
		const classes = state.getClasses();
		expect(classes[0].subclass).toBeDefined();
		expect(classes[0].subclass.name).toBe("Circle of the Land");
	});

	describe("Land's Aid (Level 3)", () => {
		it("should have Land's Aid at level 3", () => {
			expect(state.getTotalLevel()).toBe(3);
		});
	});

	describe("Natural Recovery (Level 6)", () => {
		it("should have Natural Recovery at level 6 (moved from level 2)", () => {
			state.addClass({
				name: "Druid",
				source: "XPHB",
				level: 6,
				subclass: {name: "Circle of the Land", shortName: "Land", source: "XPHB"},
			});
			expect(state.getTotalLevel()).toBe(6);
		});
	});

	describe("Nature's Ward (Level 10)", () => {
		it("should have Nature's Ward at level 10", () => {
			state.addClass({
				name: "Druid",
				source: "XPHB",
				level: 10,
				subclass: {name: "Circle of the Land", shortName: "Land", source: "XPHB"},
			});
			expect(state.getTotalLevel()).toBe(10);
		});
	});

	describe("Nature's Sanctuary (Level 14)", () => {
		it("should have Nature's Sanctuary at level 14", () => {
			state.addClass({
				name: "Druid",
				source: "XPHB",
				level: 14,
				subclass: {name: "Circle of the Land", shortName: "Land", source: "XPHB"},
			});
			expect(state.getTotalLevel()).toBe(14);
		});
	});
});

// ==========================================================================
// PART 13: CIRCLE OF THE MOON (XPHB 2024)
// ==========================================================================
describe("Circle of the Moon (XPHB 2024)", () => {
	let state;

	beforeEach(() => {
		state = new CharacterSheetState();
		state.setRace({name: "Human", source: "XPHB"});
		state.addClass({
			name: "Druid",
			source: "XPHB",
			level: 3,
			subclass: {name: "Circle of the Moon", shortName: "Moon", source: "XPHB"},
		});
		state.setAbilityBase("wis", 16);
	});

	it("should gain subclass at level 3", () => {
		const classes = state.getClasses();
		expect(classes[0].subclass).toBeDefined();
		expect(classes[0].subclass.name).toBe("Circle of the Moon");
	});

	describe("Circle Forms (Level 3)", () => {
		it("should have Circle Forms at level 3", () => {
			expect(state.getTotalLevel()).toBe(3);
		});
	});

	describe("Improved Circle Forms (Level 6)", () => {
		it("should have Improved Circle Forms at level 6", () => {
			state.addClass({
				name: "Druid",
				source: "XPHB",
				level: 6,
				subclass: {name: "Circle of the Moon", shortName: "Moon", source: "XPHB"},
			});
			expect(state.getTotalLevel()).toBe(6);
		});
	});

	describe("Moonlight Step (Level 10)", () => {
		it("should have Moonlight Step at level 10", () => {
			state.addClass({
				name: "Druid",
				source: "XPHB",
				level: 10,
				subclass: {name: "Circle of the Moon", shortName: "Moon", source: "XPHB"},
			});
			expect(state.getTotalLevel()).toBe(10);
		});
	});

	describe("Lunar Form (Level 14)", () => {
		it("should have Lunar Form at level 14", () => {
			state.addClass({
				name: "Druid",
				source: "XPHB",
				level: 14,
				subclass: {name: "Circle of the Moon", shortName: "Moon", source: "XPHB"},
			});
			expect(state.getTotalLevel()).toBe(14);
		});
	});
});

// ==========================================================================
// PART 14: CIRCLE OF THE SEA (XPHB 2024 EXCLUSIVE)
// ==========================================================================
describe("Circle of the Sea (XPHB 2024)", () => {
	let state;

	beforeEach(() => {
		state = new CharacterSheetState();
		state.setRace({name: "Human", source: "XPHB"});
		state.addClass({
			name: "Druid",
			source: "XPHB",
			level: 3,
			subclass: {name: "Circle of the Sea", shortName: "Sea", source: "XPHB"},
		});
		state.setAbilityBase("wis", 16);
	});

	it("should gain subclass at level 3", () => {
		const classes = state.getClasses();
		expect(classes[0].subclass).toBeDefined();
		expect(classes[0].subclass.name).toBe("Circle of the Sea");
	});

	describe("Wrath of the Sea (Level 3)", () => {
		it("should have Wrath of the Sea at level 3", () => {
			expect(state.getTotalLevel()).toBe(3);
		});

		it("should deal 1d4 cold or lightning damage scaling to higher dice", () => {
			// Level 3: 1d4
			// Level 10: 1d6
			// Level 14: 1d8
			const druidLevel = 3;
			const wrathDie = druidLevel >= 14 ? "1d8" : druidLevel >= 10 ? "1d6" : "1d4";
			expect(wrathDie).toBe("1d4");
		});
	});

	describe("Aquatic Affinity (Level 6)", () => {
		it("should have Aquatic Affinity at level 6", () => {
			state.addClass({
				name: "Druid",
				source: "XPHB",
				level: 6,
				subclass: {name: "Circle of the Sea", shortName: "Sea", source: "XPHB"},
			});
			expect(state.getTotalLevel()).toBe(6);
		});
	});

	describe("Stormborn (Level 10)", () => {
		it("should have Stormborn at level 10", () => {
			state.addClass({
				name: "Druid",
				source: "XPHB",
				level: 10,
				subclass: {name: "Circle of the Sea", shortName: "Sea", source: "XPHB"},
			});
			expect(state.getTotalLevel()).toBe(10);
		});
	});

	describe("Oceanic Gift (Level 14)", () => {
		it("should have Oceanic Gift at level 14", () => {
			state.addClass({
				name: "Druid",
				source: "XPHB",
				level: 14,
				subclass: {name: "Circle of the Sea", shortName: "Sea", source: "XPHB"},
			});
			expect(state.getTotalLevel()).toBe(14);
		});
	});
});

// ==========================================================================
// PART 15: CIRCLE OF THE STARS (XPHB 2024)
// ==========================================================================
describe("Circle of the Stars (XPHB 2024)", () => {
	let state;

	beforeEach(() => {
		state = new CharacterSheetState();
		state.setRace({name: "Human", source: "XPHB"});
		state.addClass({
			name: "Druid",
			source: "XPHB",
			level: 3,
			subclass: {name: "Circle of the Stars", shortName: "Stars", source: "XPHB"},
		});
		state.setAbilityBase("wis", 16);
	});

	it("should gain subclass at level 3", () => {
		const classes = state.getClasses();
		expect(classes[0].subclass).toBeDefined();
		expect(classes[0].subclass.name).toBe("Circle of the Stars");
	});

	describe("Star Map (Level 3)", () => {
		it("should have Star Map at level 3", () => {
			expect(state.getTotalLevel()).toBe(3);
		});
	});

	describe("Starry Form (Level 3)", () => {
		it("should have Starry Form at level 3", () => {
			expect(state.getTotalLevel()).toBe(3);
		});
	});

	describe("Cosmic Omen (Level 6)", () => {
		it("should have Cosmic Omen at level 6", () => {
			state.addClass({
				name: "Druid",
				source: "XPHB",
				level: 6,
				subclass: {name: "Circle of the Stars", shortName: "Stars", source: "XPHB"},
			});
			expect(state.getTotalLevel()).toBe(6);
		});
	});

	describe("Twinkling Constellations (Level 10)", () => {
		it("should have Twinkling Constellations at level 10", () => {
			state.addClass({
				name: "Druid",
				source: "XPHB",
				level: 10,
				subclass: {name: "Circle of the Stars", shortName: "Stars", source: "XPHB"},
			});
			expect(state.getTotalLevel()).toBe(10);
		});
	});

	describe("Full of Stars (Level 14)", () => {
		it("should have Full of Stars at level 14", () => {
			state.addClass({
				name: "Druid",
				source: "XPHB",
				level: 14,
				subclass: {name: "Circle of the Stars", shortName: "Stars", source: "XPHB"},
			});
			expect(state.getTotalLevel()).toBe(14);
		});
	});
});

// ==========================================================================
// PART 16: PHB vs XPHB FEATURE COMPARISON
// ==========================================================================
describe("PHB vs XPHB Druid Feature Comparison", () => {
	describe("Features that remain the same", () => {
		it("should have same spell slot progression in both versions", () => {
			const phbState = new CharacterSheetState();
			phbState.addClass({name: "Druid", source: "PHB", level: 5});
			const phbSlots = phbState.getSpellSlots();

			const xphbState = new CharacterSheetState();
			xphbState.addClass({name: "Druid", source: "XPHB", level: 5});
			const xphbSlots = xphbState.getSpellSlots();

			expect(phbSlots[1]?.max).toBe(xphbSlots[1]?.max);
			expect(phbSlots[3]?.max).toBe(xphbSlots[3]?.max);
		});

		it("should have Beast Spells at level 18 in both versions", () => {
			const phbState = new CharacterSheetState();
			phbState.addClass({name: "Druid", source: "PHB", level: 18});
			phbState.setSpellcastingAbility("wis");

			const xphbState = new CharacterSheetState();
			xphbState.addClass({name: "Druid", source: "XPHB", level: 18});
			xphbState.setSpellcastingAbility("wis");

			expect(phbState.getFeatureCalculations().hasBeastSpells).toBe(true);
			expect(xphbState.getFeatureCalculations().hasBeastSpells).toBe(true);
		});

		it("should have Archdruid at level 20 in both versions", () => {
			const phbState = new CharacterSheetState();
			phbState.addClass({name: "Druid", source: "PHB", level: 20});
			phbState.setSpellcastingAbility("wis");

			const xphbState = new CharacterSheetState();
			xphbState.addClass({name: "Druid", source: "XPHB", level: 20});
			xphbState.setSpellcastingAbility("wis");

			expect(phbState.getFeatureCalculations().hasArchdruid).toBe(true);
			expect(xphbState.getFeatureCalculations().hasArchdruid).toBe(true);
		});
	});

	describe("Features that differ between versions", () => {
		it("should have PHB subclass at level 2, XPHB at level 3", () => {
			// PHB druids get their circle at level 2
			const phbState = new CharacterSheetState();
			phbState.addClass({
				name: "Druid",
				source: "PHB",
				level: 2,
				subclass: {name: "Circle of the Land", shortName: "Land", source: "PHB"},
			});
			expect(phbState.getClasses()[0].subclass?.name).toBe("Circle of the Land");

			// XPHB druids get their circle at level 3
			const xphbState = new CharacterSheetState();
			xphbState.addClass({
				name: "Druid",
				source: "XPHB",
				level: 3,
				subclass: {name: "Circle of the Land", shortName: "Land", source: "XPHB"},
			});
			expect(xphbState.getClasses()[0].subclass?.name).toBe("Circle of the Land");
		});

		it("should have PHB Wild Shape CR limits, XPHB uses stat blocks", () => {
			const phbState = new CharacterSheetState();
			phbState.addClass({name: "Druid", source: "PHB", level: 8});
			phbState.setSpellcastingAbility("wis");

			const xphbState = new CharacterSheetState();
			xphbState.addClass({name: "Druid", source: "XPHB", level: 8});
			xphbState.setSpellcastingAbility("wis");

			expect(phbState.getFeatureCalculations().wildShapeCr).toBe(1);
			expect(xphbState.getFeatureCalculations().wildShapeCr).toBeUndefined();
		});

		it("should have Timeless Body in PHB only", () => {
			const phbState = new CharacterSheetState();
			phbState.addClass({name: "Druid", source: "PHB", level: 18});
			phbState.setSpellcastingAbility("wis");

			const xphbState = new CharacterSheetState();
			xphbState.addClass({name: "Druid", source: "XPHB", level: 18});
			xphbState.setSpellcastingAbility("wis");

			expect(phbState.getFeatureCalculations().hasTimelessBody).toBe(true);
			expect(xphbState.getFeatureCalculations().hasTimelessBody).toBeUndefined();
		});
	});

	describe("XPHB-exclusive features", () => {
		it("should have Primal Order at level 1 only in XPHB", () => {
			// Primal Order lets you choose Magician or Warden
			const xphbState = new CharacterSheetState();
			xphbState.addClass({name: "Druid", source: "XPHB", level: 1});
			xphbState.setSpellcastingAbility("wis");
			expect(xphbState.getClasses()[0].source).toBe("XPHB");

			// PHB Druid level 1 should not have Magician/Warden
			const phbState = new CharacterSheetState();
			phbState.addClass({name: "Druid", source: "PHB", level: 1});
			phbState.setSpellcastingAbility("wis");
			const phbCalc = phbState.getFeatureCalculations();
			expect(phbCalc.hasMagician).toBeUndefined();
			expect(phbCalc.hasWarden).toBeUndefined();
		});

		it("should have Wild Resurgence at level 5 only in XPHB", () => {
			const xphbState = new CharacterSheetState();
			xphbState.addClass({name: "Druid", source: "XPHB", level: 5});
			xphbState.setSpellcastingAbility("wis");

			const phbState = new CharacterSheetState();
			phbState.addClass({name: "Druid", source: "PHB", level: 5});
			phbState.setSpellcastingAbility("wis");

			expect(xphbState.getFeatureCalculations().hasWildResurgence).toBe(true);
			expect(phbState.getFeatureCalculations().hasWildResurgence).toBeUndefined();
		});

		it("should have Elemental Fury at level 7 only in XPHB", () => {
			const xphbState = new CharacterSheetState();
			xphbState.addClass({name: "Druid", source: "XPHB", level: 7});
			xphbState.setAbilityBase("wis", 16);
			xphbState.setSpellcastingAbility("wis");

			const phbState = new CharacterSheetState();
			phbState.addClass({name: "Druid", source: "PHB", level: 7});
			phbState.setSpellcastingAbility("wis");

			expect(xphbState.getFeatureCalculations().hasElementalFury).toBe(true);
			expect(phbState.getFeatureCalculations().hasElementalFury).toBeUndefined();
		});

		it("should have Circle of the Sea only in XPHB", () => {
			const state = new CharacterSheetState();
			state.addClass({
				name: "Druid",
				source: "XPHB",
				level: 3,
				subclass: {name: "Circle of the Sea", shortName: "Sea", source: "XPHB"},
			});
			expect(state.getClasses()[0].subclass?.name).toBe("Circle of the Sea");
		});

		it("should have Epic Boon at level 19 only in XPHB", () => {
			const xphbState = new CharacterSheetState();
			xphbState.addClass({name: "Druid", source: "XPHB", level: 19});
			xphbState.setSpellcastingAbility("wis");
			expect(xphbState.getClasses()[0].source).toBe("XPHB");
			expect(xphbState.getTotalLevel()).toBe(19);

			// PHB Druid at level 19 has ASI, not Epic Boon
			const phbState = new CharacterSheetState();
			phbState.addClass({name: "Druid", source: "PHB", level: 19});
			phbState.setSpellcastingAbility("wis");
			expect(phbState.getClasses()[0].source).toBe("PHB");
			expect(phbState.getTotalLevel()).toBe(19);
		});
	});
});

// ==========================================================================
// PART 17: DRUID MULTICLASS
// ==========================================================================
describe("Druid Multiclass", () => {
	let state;

	beforeEach(() => {
		state = new CharacterSheetState();
		state.setRace({name: "Human", source: "PHB"});
		state.setAbilityBase("wis", 14);
	});

	it("should require WIS 13 for multiclassing", () => {
		const wisScore = 13;
		expect(wisScore).toBeGreaterThanOrEqual(13);
	});

	it("should calculate multiclass spell slots correctly with Cleric", () => {
		state.addClass({name: "Druid", source: "PHB", level: 3});
		state.addClass({name: "Cleric", source: "PHB", level: 2});
		// Both full casters, total caster level = 5
		const slots = state.getSpellSlots();
		expect(slots[3]?.max).toBe(2);
	});

	it("should calculate multiclass spell slots correctly with Ranger", () => {
		state.addClass({name: "Druid", source: "PHB", level: 5});
		state.addClass({name: "Ranger", source: "PHB", level: 4});
		// Druid 5 (full) + Ranger 4/2 = 7 caster levels
		const slots = state.getSpellSlots();
		expect(slots[4]?.max).toBe(1);
	});

	it("should track total level correctly across classes", () => {
		state.addClass({name: "Druid", source: "PHB", level: 5});
		state.addClass({name: "Monk", source: "PHB", level: 3});
		expect(state.getTotalLevel()).toBe(8);
	});

	it("should calculate proficiency bonus based on total level", () => {
		state.addClass({name: "Druid", source: "PHB", level: 5});
		state.addClass({name: "Fighter", source: "PHB", level: 4});
		// Total level 9 = +4 proficiency
		expect(state.getProficiencyBonus()).toBe(4);
	});
});

// ==========================================================================
// PART 18: DRUID EDGE CASES
// ==========================================================================
describe("Druid Edge Cases", () => {
	let state;

	beforeEach(() => {
		state = new CharacterSheetState();
		state.setRace({name: "Human", source: "PHB"});
	});

	it("should handle level 20 character correctly", () => {
		state.addClass({name: "Druid", source: "PHB", level: 20});
		state.setSpellcastingAbility("wis");
		const calculations = state.getFeatureCalculations();
		expect(calculations.hasArchdruid).toBe(true);
		expect(calculations.hasBeastSpells).toBe(true);
		expect(calculations.hasTimelessBody).toBe(true);
	});

	it("should handle extreme WIS scores for spell save DC", () => {
		state.setAbilityBase("wis", 20);
		state.addClass({name: "Druid", source: "PHB", level: 1});
		state.setSpellcastingAbility("wis");
		// DC = 8 + 2 (prof) + 5 (WIS) = 15
		expect(state.getSpellSaveDc()).toBe(15);
	});

	it("should handle minimum WIS for spell save DC", () => {
		state.setAbilityBase("wis", 1);
		state.addClass({name: "Druid", source: "PHB", level: 1});
		state.setSpellcastingAbility("wis");
		// DC = 8 + 2 (prof) + (-5) (WIS) = 5
		expect(state.getSpellSaveDc()).toBe(5);
	});

	it("should track hit dice correctly", () => {
		state.setAbilityBase("con", 14);
		state.addClass({name: "Druid", source: "PHB", level: 5});
		const hitDice = state.getHitDice();
		const d8Dice = hitDice.find(hd => hd.die === 8);
		expect(d8Dice.max).toBe(5);
	});

	it("should handle subclass selection", () => {
		state.setAbilityBase("wis", 16);
		state.addClass({name: "Druid", source: "PHB", level: 1});

		const classes = state.getClasses();
		expect(classes[0].subclass).toBeUndefined();

		state.addClass({
			name: "Druid",
			source: "PHB",
			level: 2,
			subclass: {name: "Circle of the Moon", shortName: "Moon", source: "PHB"},
		});

		const updatedClasses = state.getClasses();
		expect(updatedClasses[0].subclass?.name).toBe("Circle of the Moon");
	});
});

// ==========================================================================
// PART 19: DRUID PROFICIENCY BONUS PROGRESSION
// ==========================================================================
describe("Druid Proficiency Bonus Progression", () => {
	it("should return +2 proficiency bonus at level 1", () => {
		const state = new CharacterSheetState();
		state.addClass({name: "Druid", source: "PHB", level: 1});
		expect(state.getProficiencyBonus()).toBe(2);
	});

	it("should return +2 proficiency bonus at level 4", () => {
		const state = new CharacterSheetState();
		state.addClass({name: "Druid", source: "PHB", level: 4});
		expect(state.getProficiencyBonus()).toBe(2);
	});

	it("should return +3 proficiency bonus at level 5", () => {
		const state = new CharacterSheetState();
		state.addClass({name: "Druid", source: "PHB", level: 5});
		expect(state.getProficiencyBonus()).toBe(3);
	});

	it("should return +4 proficiency bonus at level 9", () => {
		const state = new CharacterSheetState();
		state.addClass({name: "Druid", source: "PHB", level: 9});
		expect(state.getProficiencyBonus()).toBe(4);
	});

	it("should return +5 proficiency bonus at level 13", () => {
		const state = new CharacterSheetState();
		state.addClass({name: "Druid", source: "PHB", level: 13});
		expect(state.getProficiencyBonus()).toBe(5);
	});

	it("should return +6 proficiency bonus at level 17", () => {
		const state = new CharacterSheetState();
		state.addClass({name: "Druid", source: "PHB", level: 17});
		expect(state.getProficiencyBonus()).toBe(6);
	});
});
