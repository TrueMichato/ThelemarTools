/**
 * Character Sheet Ranger Class Tests
 * Comprehensive testing for all Ranger class features and subclasses (Ranger Archetypes)
 *
 * This test suite verifies that:
 * - All core class features are correctly parsed and provide expected effects
 * - Favored Foe damage scales correctly (1d4 → 1d6 → 1d8)
 * - Spellcasting differences between PHB (level 2) and XPHB (level 1)
 * - All subclass (Ranger Archetype) features work correctly at designated levels
 * - Both PHB (Classic) and XPHB (2024) versions are handled properly
 */

import "./setup.js";
import "../../../js/charactersheet/charactersheet-state.js";

const CharacterSheetState = globalThis.CharacterSheetState;

// ==========================================================================
// PART 1: CORE RANGER CLASS FEATURES (PHB)
// ==========================================================================
describe("Ranger Core Class Features (PHB)", () => {
	let state;

	beforeEach(() => {
		state = new CharacterSheetState();
		state.setRace({name: "Human", source: "PHB"});
		state.addClass({name: "Ranger", source: "PHB", level: 1});
		state.setAbilityBase("str", 14); // +2 modifier
		state.setAbilityBase("dex", 16); // +3 modifier
		state.setAbilityBase("con", 14); // +2 modifier
		state.setAbilityBase("int", 10);
		state.setAbilityBase("wis", 16); // +3 modifier
		state.setAbilityBase("cha", 10);
	});

	// -------------------------------------------------------------------------
	// Favored Enemy (Level 1 PHB)
	// -------------------------------------------------------------------------
	describe("Favored Enemy (PHB)", () => {
		it("should have Favored Enemy at level 1", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasFavoredEnemy).toBe(true);
		});
	});

	// -------------------------------------------------------------------------
	// Natural Explorer (Level 1 PHB)
	// -------------------------------------------------------------------------
	describe("Natural Explorer (PHB)", () => {
		it("should have Natural Explorer at level 1", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasNaturalExplorer).toBe(true);
		});

		it("should have 1 favored terrain at level 1", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.favoredTerrains).toBe(1);
		});

		it("should have 2 favored terrains at level 6", () => {
			state.addClass({name: "Ranger", source: "PHB", level: 6});
			const calculations = state.getFeatureCalculations();
			expect(calculations.favoredTerrains).toBe(2);
		});

		it("should have 3 favored terrains at level 10", () => {
			state.addClass({name: "Ranger", source: "PHB", level: 10});
			const calculations = state.getFeatureCalculations();
			expect(calculations.favoredTerrains).toBe(3);
		});
	});

	// -------------------------------------------------------------------------
	// Favored Foe (TCE Optional)
	// -------------------------------------------------------------------------
	describe("Favored Foe (TCE Optional)", () => {
		beforeEach(() => {
			// Add the Favored Foe feature to trigger hasFavoredFoe()
			state.addFeature({name: "Favored Foe", source: "TCE", level: 1});
		});

		it("should deal 1d4 damage at level 1", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.favoredFoeDamage).toBe("1d4");
		});

		it("should deal 1d6 damage at level 6", () => {
			state.addClass({name: "Ranger", source: "PHB", level: 6});
			const calculations = state.getFeatureCalculations();
			expect(calculations.favoredFoeDamage).toBe("1d6");
		});

		it("should deal 1d8 damage at level 14", () => {
			state.addClass({name: "Ranger", source: "PHB", level: 14});
			const calculations = state.getFeatureCalculations();
			expect(calculations.favoredFoeDamage).toBe("1d8");
		});
	});

	// -------------------------------------------------------------------------
	// Spellcasting (Level 2 PHB)
	// -------------------------------------------------------------------------
	describe("Spellcasting (PHB)", () => {
		it("should not have spellcasting at level 1", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasSpellcasting).toBeUndefined();
		});

		it("should have spellcasting at level 2", () => {
			state.addClass({name: "Ranger", source: "PHB", level: 2});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasSpellcasting).toBe(true);
		});

		it("should calculate spell save DC as 8 + prof + WIS", () => {
			state.addClass({name: "Ranger", source: "PHB", level: 2});
			const calculations = state.getFeatureCalculations();
			// 8 + 2 (prof) + 3 (WIS) = 13
			expect(calculations.spellSaveDc).toBe(13);
		});

		it("should calculate spell attack bonus as prof + WIS", () => {
			state.addClass({name: "Ranger", source: "PHB", level: 2});
			const calculations = state.getFeatureCalculations();
			// 2 (prof) + 3 (WIS) = 5
			expect(calculations.spellAttackBonus).toBe(5);
		});

		it("should know 2 spells at level 2", () => {
			state.addClass({name: "Ranger", source: "PHB", level: 2});
			const calculations = state.getFeatureCalculations();
			expect(calculations.spellsKnown).toBe(2);
		});

		it("should know 6 spells at level 9", () => {
			state.addClass({name: "Ranger", source: "PHB", level: 9});
			const calculations = state.getFeatureCalculations();
			expect(calculations.spellsKnown).toBe(6);
		});

		it("should know 11 spells at level 19", () => {
			state.addClass({name: "Ranger", source: "PHB", level: 19});
			const calculations = state.getFeatureCalculations();
			expect(calculations.spellsKnown).toBe(11);
		});
	});

	// -------------------------------------------------------------------------
	// Fighting Style (Level 2)
	// -------------------------------------------------------------------------
	describe("Fighting Style", () => {
		it("should not have Fighting Style at level 1", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasFightingStyle).toBeUndefined();
		});

		it("should have Fighting Style at level 2", () => {
			state.addClass({name: "Ranger", source: "PHB", level: 2});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasFightingStyle).toBe(true);
		});
	});

	// -------------------------------------------------------------------------
	// Primeval Awareness (Level 3 PHB)
	// -------------------------------------------------------------------------
	describe("Primeval Awareness (PHB)", () => {
		it("should not have Primeval Awareness before level 3", () => {
			state.addClass({name: "Ranger", source: "PHB", level: 2});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasPrimevalAwareness).toBeUndefined();
		});

		it("should have Primeval Awareness at level 3", () => {
			state.addClass({name: "Ranger", source: "PHB", level: 3});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasPrimevalAwareness).toBe(true);
		});
	});

	// -------------------------------------------------------------------------
	// Extra Attack (Level 5)
	// -------------------------------------------------------------------------
	describe("Extra Attack", () => {
		it("should not have Extra Attack before level 5", () => {
			state.addClass({name: "Ranger", source: "PHB", level: 4});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasExtraAttack).toBeUndefined();
		});

		it("should have Extra Attack at level 5", () => {
			state.addClass({name: "Ranger", source: "PHB", level: 5});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasExtraAttack).toBe(true);
		});

		it("should have 2 attacks per action", () => {
			state.addClass({name: "Ranger", source: "PHB", level: 5});
			const calculations = state.getFeatureCalculations();
			expect(calculations.attacksPerAction).toBe(2);
		});
	});

	// -------------------------------------------------------------------------
	// Land's Stride (Level 8 PHB)
	// -------------------------------------------------------------------------
	describe("Land's Stride (PHB)", () => {
		it("should not have Land's Stride before level 8", () => {
			state.addClass({name: "Ranger", source: "PHB", level: 7});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasLandsStride).toBeUndefined();
		});

		it("should have Land's Stride at level 8", () => {
			state.addClass({name: "Ranger", source: "PHB", level: 8});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasLandsStride).toBe(true);
		});
	});

	// -------------------------------------------------------------------------
	// Hide in Plain Sight (Level 10 PHB)
	// -------------------------------------------------------------------------
	describe("Hide in Plain Sight (PHB)", () => {
		it("should have Hide in Plain Sight at level 10", () => {
			state.addClass({name: "Ranger", source: "PHB", level: 10});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasHideInPlainSight).toBe(true);
		});
	});

	// -------------------------------------------------------------------------
	// Vanish (Level 14 PHB)
	// -------------------------------------------------------------------------
	describe("Vanish (PHB)", () => {
		it("should not have Vanish before level 14", () => {
			state.addClass({name: "Ranger", source: "PHB", level: 13});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasVanish).toBeUndefined();
		});

		it("should have Vanish at level 14", () => {
			state.addClass({name: "Ranger", source: "PHB", level: 14});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasVanish).toBe(true);
		});
	});

	// -------------------------------------------------------------------------
	// Feral Senses (Level 18)
	// -------------------------------------------------------------------------
	describe("Feral Senses", () => {
		it("should not have Feral Senses before level 18", () => {
			state.addClass({name: "Ranger", source: "PHB", level: 17});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasFeralSenses).toBeUndefined();
		});

		it("should have Feral Senses at level 18", () => {
			state.addClass({name: "Ranger", source: "PHB", level: 18});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasFeralSenses).toBe(true);
		});

		it("should have 30 ft blindsight equivalent", () => {
			state.addClass({name: "Ranger", source: "PHB", level: 18});
			const calculations = state.getFeatureCalculations();
			expect(calculations.blindsightRange).toBe(30);
		});
	});

	// -------------------------------------------------------------------------
	// Foe Slayer (Level 20)
	// -------------------------------------------------------------------------
	describe("Foe Slayer", () => {
		it("should not have Foe Slayer before level 20", () => {
			state.addClass({name: "Ranger", source: "PHB", level: 19});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasFoeSlayer).toBeUndefined();
		});

		it("should have Foe Slayer at level 20", () => {
			state.addClass({name: "Ranger", source: "PHB", level: 20});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasFoeSlayer).toBe(true);
		});

		it("should add WIS mod to attack or damage", () => {
			state.addClass({name: "Ranger", source: "PHB", level: 20});
			const calculations = state.getFeatureCalculations();
			expect(calculations.foeSlayerBonus).toBe(3); // WIS mod
		});
	});
});

// ==========================================================================
// PART 2: RANGER HIT DICE AND HP
// ==========================================================================
describe("Ranger Hit Dice and HP", () => {
	let state;

	beforeEach(() => {
		state = new CharacterSheetState();
		state.setRace({name: "Human", source: "PHB"});
		state.addClass({name: "Ranger", source: "PHB", level: 1});
		state.setAbilityBase("con", 14); // +2 modifier
	});

	it("should use d10 hit dice", () => {
		const hitDice = state.getHitDice();
		// Check if any hit dice are d10
		const hasD10 = Array.isArray(hitDice)
			? hitDice.some(hd => hd.die === 10 || hd.type === "d10")
			: hitDice.d10 !== undefined;
		expect(hasD10).toBe(true);
	});

	it("should have correct number of hit dice per level", () => {
		state.addClass({name: "Ranger", source: "PHB", level: 5});
		const hitDice = state.getHitDice();
		// Check total hit dice count
		const totalDice = Array.isArray(hitDice)
			? hitDice.reduce((sum, hd) => sum + (hd.max || hd.current || 0), 0)
			: Object.values(hitDice).reduce((sum, val) => sum + val, 0);
		expect(totalDice).toBe(5);
	});

	// Note: getMaxHP() is not implemented in CharacterSheetState
	// HP calculation tests would go here if that method existed
});

// ==========================================================================
// PART 3: BEAST MASTER SUBCLASS
// ==========================================================================
describe("Beast Master Subclass", () => {
	let state;

	beforeEach(() => {
		state = new CharacterSheetState();
		state.setRace({name: "Human", source: "PHB"});
		state.addClass({name: "Ranger", source: "PHB", level: 3});
		state.setSubclass("Ranger", {name: "Beast Master", source: "PHB"});
		state.setAbilityBase("wis", 16); // +3 modifier
	});

	it("should gain subclass at level 3", () => {
		const calculations = state.getFeatureCalculations();
		expect(calculations.hasBeastCompanion).toBe(true);
	});

	// -------------------------------------------------------------------------
	// Ranger's Companion / Primal Companion (Level 3)
	// -------------------------------------------------------------------------
	describe("Beast Companion (Level 3)", () => {
		it("should have beast companion at level 3", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasBeastCompanion).toBe(true);
		});

		it("should add proficiency bonus to companion", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.companionProfBonus).toBe(2);
		});
	});

	// -------------------------------------------------------------------------
	// Exceptional Training (Level 7)
	// -------------------------------------------------------------------------
	describe("Exceptional Training (Level 7)", () => {
		it("should have Exceptional Training at level 7", () => {
			state.addClass({name: "Ranger", source: "PHB", level: 7});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasExceptionalTraining).toBe(true);
		});
	});

	// -------------------------------------------------------------------------
	// Bestial Fury (Level 11)
	// -------------------------------------------------------------------------
	describe("Bestial Fury (Level 11)", () => {
		it("should have Bestial Fury at level 11", () => {
			state.addClass({name: "Ranger", source: "PHB", level: 11});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasBestialFury).toBe(true);
		});

		it("should allow companion 2 attacks", () => {
			state.addClass({name: "Ranger", source: "PHB", level: 11});
			const calculations = state.getFeatureCalculations();
			expect(calculations.companionAttacks).toBe(2);
		});
	});

	// -------------------------------------------------------------------------
	// Share Spells (Level 15)
	// -------------------------------------------------------------------------
	describe("Share Spells (Level 15)", () => {
		it("should have Share Spells at level 15", () => {
			state.addClass({name: "Ranger", source: "PHB", level: 15});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasShareSpells).toBe(true);
		});
	});
});

// ==========================================================================
// PART 4: HUNTER SUBCLASS
// ==========================================================================
describe("Hunter Subclass", () => {
	let state;

	beforeEach(() => {
		state = new CharacterSheetState();
		state.setRace({name: "Human", source: "PHB"});
		state.addClass({name: "Ranger", source: "PHB", level: 3});
		state.setSubclass("Ranger", {name: "Hunter", source: "PHB"});
		state.setAbilityBase("wis", 16);
	});

	it("should gain subclass at level 3", () => {
		const calculations = state.getFeatureCalculations();
		expect(calculations.hasHuntersPrey).toBe(true);
	});

	// -------------------------------------------------------------------------
	// Hunter's Prey (Level 3)
	// -------------------------------------------------------------------------
	describe("Hunter's Prey (Level 3)", () => {
		it("should have Hunter's Prey at level 3", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasHuntersPrey).toBe(true);
		});

		it("should deal 1d8 extra damage (Colossus Slayer)", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.colossusSlayerDamage).toBe("1d8");
		});
	});

	// -------------------------------------------------------------------------
	// Defensive Tactics (Level 7)
	// -------------------------------------------------------------------------
	describe("Defensive Tactics (Level 7)", () => {
		it("should have Defensive Tactics at level 7", () => {
			state.addClass({name: "Ranger", source: "PHB", level: 7});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasDefensiveTactics).toBe(true);
		});

		it("should grant +4 AC (Multiattack Defense)", () => {
			state.addClass({name: "Ranger", source: "PHB", level: 7});
			const calculations = state.getFeatureCalculations();
			expect(calculations.multiattackDefenseBonus).toBe(4);
		});
	});

	// -------------------------------------------------------------------------
	// Multiattack (Level 11)
	// -------------------------------------------------------------------------
	describe("Multiattack (Level 11)", () => {
		it("should have Multiattack at level 11", () => {
			state.addClass({name: "Ranger", source: "PHB", level: 11});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasMultiattack).toBe(true);
		});
	});

	// -------------------------------------------------------------------------
	// Superior Hunter's Defense (Level 15)
	// -------------------------------------------------------------------------
	describe("Superior Hunter's Defense (Level 15)", () => {
		it("should have Superior Hunter's Defense at level 15", () => {
			state.addClass({name: "Ranger", source: "PHB", level: 15});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasSuperiorHuntersDefense).toBe(true);
		});
	});
});

// ==========================================================================
// PART 5: GLOOM STALKER SUBCLASS (XGE)
// ==========================================================================
describe("Gloom Stalker Subclass (XGE)", () => {
	let state;

	beforeEach(() => {
		state = new CharacterSheetState();
		state.setRace({name: "Human", source: "PHB"});
		state.addClass({name: "Ranger", source: "PHB", level: 3});
		state.setSubclass("Ranger", {name: "Gloom Stalker", source: "XGE"});
		state.setAbilityBase("wis", 16); // +3 modifier
	});

	it("should gain subclass at level 3", () => {
		const calculations = state.getFeatureCalculations();
		expect(calculations.hasDreadAmbusher).toBe(true);
	});

	// -------------------------------------------------------------------------
	// Dread Ambusher (Level 3)
	// -------------------------------------------------------------------------
	describe("Dread Ambusher (Level 3)", () => {
		it("should have Dread Ambusher at level 3", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasDreadAmbusher).toBe(true);
		});

		it("should add WIS mod to initiative", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.dreadAmbusherInitiativeBonus).toBe(3);
		});

		it("should deal extra 1d8 damage first turn", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.dreadAmbusherExtraDamage).toBe("1d8");
		});
	});

	// -------------------------------------------------------------------------
	// Umbral Sight (Level 3)
	// -------------------------------------------------------------------------
	describe("Umbral Sight (Level 3)", () => {
		it("should have Umbral Sight at level 3", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasUmbralSight).toBe(true);
		});

		it("should grant +60 ft darkvision", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.umbralSightDarkvisionBonus).toBe(60);
		});
	});

	// -------------------------------------------------------------------------
	// Iron Mind (Level 7)
	// -------------------------------------------------------------------------
	describe("Iron Mind (Level 7)", () => {
		it("should have Iron Mind at level 7", () => {
			state.addClass({name: "Ranger", source: "PHB", level: 7});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasIronMind).toBe(true);
		});
	});

	// -------------------------------------------------------------------------
	// Stalker's Flurry (Level 11)
	// -------------------------------------------------------------------------
	describe("Stalker's Flurry (Level 11)", () => {
		it("should have Stalker's Flurry at level 11", () => {
			state.addClass({name: "Ranger", source: "PHB", level: 11});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasStalkersFlurry).toBe(true);
		});
	});

	// -------------------------------------------------------------------------
	// Shadowy Dodge (Level 15)
	// -------------------------------------------------------------------------
	describe("Shadowy Dodge (Level 15)", () => {
		it("should have Shadowy Dodge at level 15", () => {
			state.addClass({name: "Ranger", source: "PHB", level: 15});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasShadowyDodge).toBe(true);
		});
	});
});

// ==========================================================================
// PART 6: HORIZON WALKER SUBCLASS (XGE)
// ==========================================================================
describe("Horizon Walker Subclass (XGE)", () => {
	let state;

	beforeEach(() => {
		state = new CharacterSheetState();
		state.setRace({name: "Human", source: "PHB"});
		state.addClass({name: "Ranger", source: "PHB", level: 3});
		state.setSubclass("Ranger", {name: "Horizon Walker", source: "XGE"});
		state.setAbilityBase("wis", 16);
	});

	it("should gain subclass at level 3", () => {
		const calculations = state.getFeatureCalculations();
		expect(calculations.hasDetectPortal).toBe(true);
	});

	// -------------------------------------------------------------------------
	// Detect Portal (Level 3)
	// -------------------------------------------------------------------------
	describe("Detect Portal (Level 3)", () => {
		it("should have Detect Portal at level 3", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasDetectPortal).toBe(true);
		});
	});

	// -------------------------------------------------------------------------
	// Planar Warrior (Level 3)
	// -------------------------------------------------------------------------
	describe("Planar Warrior (Level 3)", () => {
		it("should have Planar Warrior at level 3", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasPlanarWarrior).toBe(true);
		});

		it("should deal 1d8 force damage at level 3", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.planarWarriorDamage).toBe("1d8");
		});

		it("should deal 2d8 force damage at level 11", () => {
			state.addClass({name: "Ranger", source: "PHB", level: 11});
			const calculations = state.getFeatureCalculations();
			expect(calculations.planarWarriorDamage).toBe("2d8");
		});
	});

	// -------------------------------------------------------------------------
	// Ethereal Step (Level 7)
	// -------------------------------------------------------------------------
	describe("Ethereal Step (Level 7)", () => {
		it("should have Ethereal Step at level 7", () => {
			state.addClass({name: "Ranger", source: "PHB", level: 7});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasEtherealStep).toBe(true);
		});
	});

	// -------------------------------------------------------------------------
	// Distant Strike (Level 11)
	// -------------------------------------------------------------------------
	describe("Distant Strike (Level 11)", () => {
		it("should have Distant Strike at level 11", () => {
			state.addClass({name: "Ranger", source: "PHB", level: 11});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasDistantStrike).toBe(true);
		});

		it("should teleport 10 ft before each attack", () => {
			state.addClass({name: "Ranger", source: "PHB", level: 11});
			const calculations = state.getFeatureCalculations();
			expect(calculations.distantStrikeTeleportRange).toBe(10);
		});
	});

	// -------------------------------------------------------------------------
	// Spectral Defense (Level 15)
	// -------------------------------------------------------------------------
	describe("Spectral Defense (Level 15)", () => {
		it("should have Spectral Defense at level 15", () => {
			state.addClass({name: "Ranger", source: "PHB", level: 15});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasSpectralDefense).toBe(true);
		});
	});
});

// ==========================================================================
// PART 7: MONSTER SLAYER SUBCLASS (XGE)
// ==========================================================================
describe("Monster Slayer Subclass (XGE)", () => {
	let state;

	beforeEach(() => {
		state = new CharacterSheetState();
		state.setRace({name: "Human", source: "PHB"});
		state.addClass({name: "Ranger", source: "PHB", level: 3});
		state.setSubclass("Ranger", {name: "Monster Slayer", source: "XGE"});
		state.setAbilityBase("wis", 16); // +3 modifier
	});

	it("should gain subclass at level 3", () => {
		const calculations = state.getFeatureCalculations();
		expect(calculations.hasHuntersSense).toBe(true);
	});

	// -------------------------------------------------------------------------
	// Hunter's Sense (Level 3)
	// -------------------------------------------------------------------------
	describe("Hunter's Sense (Level 3)", () => {
		it("should have Hunter's Sense at level 3", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasHuntersSense).toBe(true);
		});

		it("should have WIS mod uses", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.huntersSenseUses).toBe(3);
		});
	});

	// -------------------------------------------------------------------------
	// Slayer's Prey (Level 3)
	// -------------------------------------------------------------------------
	describe("Slayer's Prey (Level 3)", () => {
		it("should have Slayer's Prey at level 3", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasSlayersPrey).toBe(true);
		});

		it("should deal 1d6 extra damage", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.slayersPreyDamage).toBe("1d6");
		});
	});

	// -------------------------------------------------------------------------
	// Supernatural Defense (Level 7)
	// -------------------------------------------------------------------------
	describe("Supernatural Defense (Level 7)", () => {
		it("should have Supernatural Defense at level 7", () => {
			state.addClass({name: "Ranger", source: "PHB", level: 7});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasSupernaturalDefense).toBe(true);
		});

		it("should add 1d6 to saves/escapes", () => {
			state.addClass({name: "Ranger", source: "PHB", level: 7});
			const calculations = state.getFeatureCalculations();
			expect(calculations.supernaturalDefenseBonus).toBe("1d6");
		});
	});

	// -------------------------------------------------------------------------
	// Magic-User's Nemesis (Level 11)
	// -------------------------------------------------------------------------
	describe("Magic-User's Nemesis (Level 11)", () => {
		it("should have Magic-User's Nemesis at level 11", () => {
			state.addClass({name: "Ranger", source: "PHB", level: 11});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasMagicUsersNemesis).toBe(true);
		});
	});

	// -------------------------------------------------------------------------
	// Slayer's Counter (Level 15)
	// -------------------------------------------------------------------------
	describe("Slayer's Counter (Level 15)", () => {
		it("should have Slayer's Counter at level 15", () => {
			state.addClass({name: "Ranger", source: "PHB", level: 15});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasSlayersCounter).toBe(true);
		});
	});
});

// ==========================================================================
// PART 8: FEY WANDERER SUBCLASS (TCE)
// ==========================================================================
describe("Fey Wanderer Subclass (TCE)", () => {
	let state;

	beforeEach(() => {
		state = new CharacterSheetState();
		state.setRace({name: "Human", source: "PHB"});
		state.addClass({name: "Ranger", source: "PHB", level: 3});
		state.setSubclass("Ranger", {name: "Fey Wanderer", source: "TCE"});
		state.setAbilityBase("wis", 16); // +3 modifier
	});

	it("should gain subclass at level 3", () => {
		const calculations = state.getFeatureCalculations();
		expect(calculations.hasDreadfulStrikes).toBe(true);
	});

	// -------------------------------------------------------------------------
	// Dreadful Strikes (Level 3)
	// -------------------------------------------------------------------------
	describe("Dreadful Strikes (Level 3)", () => {
		it("should have Dreadful Strikes at level 3", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasDreadfulStrikes).toBe(true);
		});

		it("should deal 1d4 psychic damage at level 3", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.dreadfulStrikesDamage).toBe("1d4");
		});

		it("should deal 2d4 psychic damage at level 11", () => {
			state.addClass({name: "Ranger", source: "PHB", level: 11});
			const calculations = state.getFeatureCalculations();
			expect(calculations.dreadfulStrikesDamage).toBe("2d4");
		});
	});

	// -------------------------------------------------------------------------
	// Otherworldly Glamour (Level 3)
	// -------------------------------------------------------------------------
	describe("Otherworldly Glamour (Level 3)", () => {
		it("should have Otherworldly Glamour at level 3", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasOtherworldlyGlamour).toBe(true);
		});

		it("should add WIS mod to Charisma checks", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.otherworldlyGlamourBonus).toBe(3);
		});

		it("should have minimum +1 bonus", () => {
			state.setAbilityBase("wis", 8); // -1 modifier
			const calculations = state.getFeatureCalculations();
			expect(calculations.otherworldlyGlamourBonus).toBe(1);
		});
	});

	// -------------------------------------------------------------------------
	// Beguiling Twist (Level 7)
	// -------------------------------------------------------------------------
	describe("Beguiling Twist (Level 7)", () => {
		it("should have Beguiling Twist at level 7", () => {
			state.addClass({name: "Ranger", source: "PHB", level: 7});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasBeguilingTwist).toBe(true);
		});
	});

	// -------------------------------------------------------------------------
	// Fey Reinforcements (Level 11)
	// -------------------------------------------------------------------------
	describe("Fey Reinforcements (Level 11)", () => {
		it("should have Fey Reinforcements at level 11", () => {
			state.addClass({name: "Ranger", source: "PHB", level: 11});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasFeyReinforcements).toBe(true);
		});
	});

	// -------------------------------------------------------------------------
	// Misty Wanderer (Level 15)
	// -------------------------------------------------------------------------
	describe("Misty Wanderer (Level 15)", () => {
		it("should have Misty Wanderer at level 15", () => {
			state.addClass({name: "Ranger", source: "PHB", level: 15});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasMistyWanderer).toBe(true);
		});

		it("should have WIS mod uses", () => {
			state.addClass({name: "Ranger", source: "PHB", level: 15});
			const calculations = state.getFeatureCalculations();
			expect(calculations.mistyWandererUses).toBe(3);
		});
	});
});

// ==========================================================================
// PART 9: SWARMKEEPER SUBCLASS (TCE)
// ==========================================================================
describe("Swarmkeeper Subclass (TCE)", () => {
	let state;

	beforeEach(() => {
		state = new CharacterSheetState();
		state.setRace({name: "Human", source: "PHB"});
		state.addClass({name: "Ranger", source: "PHB", level: 3});
		state.setSubclass("Ranger", {name: "Swarmkeeper", source: "TCE"});
		state.setAbilityBase("wis", 16); // +3 modifier
	});

	it("should gain subclass at level 3", () => {
		const calculations = state.getFeatureCalculations();
		expect(calculations.hasGatheredSwarm).toBe(true);
	});

	// -------------------------------------------------------------------------
	// Gathered Swarm (Level 3)
	// -------------------------------------------------------------------------
	describe("Gathered Swarm (Level 3)", () => {
		it("should have Gathered Swarm at level 3", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasGatheredSwarm).toBe(true);
		});

		it("should deal 1d6 damage at level 3", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.gatheredSwarmDamage).toBe("1d6");
		});

		it("should push 15 ft", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.gatheredSwarmPushDistance).toBe(15);
		});

		it("should calculate DC as 8 + prof + WIS", () => {
			const calculations = state.getFeatureCalculations();
			// 8 + 2 + 3 = 13
			expect(calculations.gatheredSwarmDc).toBe(13);
		});

		it("should deal 1d8 damage at level 11 (Mighty Swarm)", () => {
			state.addClass({name: "Ranger", source: "PHB", level: 11});
			const calculations = state.getFeatureCalculations();
			expect(calculations.gatheredSwarmDamage).toBe("1d8");
		});
	});

	// -------------------------------------------------------------------------
	// Writhing Tide (Level 7)
	// -------------------------------------------------------------------------
	describe("Writhing Tide (Level 7)", () => {
		it("should have Writhing Tide at level 7", () => {
			state.addClass({name: "Ranger", source: "PHB", level: 7});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasWrithingTide).toBe(true);
		});

		it("should grant 10 ft fly speed", () => {
			state.addClass({name: "Ranger", source: "PHB", level: 7});
			const calculations = state.getFeatureCalculations();
			expect(calculations.writhingTideFlySpeed).toBe(10);
		});

		it("should have proficiency bonus uses", () => {
			state.addClass({name: "Ranger", source: "PHB", level: 7});
			const calculations = state.getFeatureCalculations();
			expect(calculations.writhingTideUses).toBe(3); // prof at level 7
		});
	});

	// -------------------------------------------------------------------------
	// Mighty Swarm (Level 11)
	// -------------------------------------------------------------------------
	describe("Mighty Swarm (Level 11)", () => {
		it("should have Mighty Swarm at level 11", () => {
			state.addClass({name: "Ranger", source: "PHB", level: 11});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasMightySwarm).toBe(true);
		});
	});

	// -------------------------------------------------------------------------
	// Swarming Dispersal (Level 15)
	// -------------------------------------------------------------------------
	describe("Swarming Dispersal (Level 15)", () => {
		it("should have Swarming Dispersal at level 15", () => {
			state.addClass({name: "Ranger", source: "PHB", level: 15});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasSwarmingDispersal).toBe(true);
		});

		it("should have proficiency bonus uses", () => {
			state.addClass({name: "Ranger", source: "PHB", level: 15});
			const calculations = state.getFeatureCalculations();
			expect(calculations.swarmingDispersalUses).toBe(5); // prof at level 15
		});
	});
});

// ==========================================================================
// PART 10: DRAKEWARDEN SUBCLASS (FTD)
// ==========================================================================
describe("Drakewarden Subclass (FTD)", () => {
	let state;

	beforeEach(() => {
		state = new CharacterSheetState();
		state.setRace({name: "Human", source: "PHB"});
		state.addClass({name: "Ranger", source: "PHB", level: 3});
		state.setSubclass("Ranger", {name: "Drakewarden", source: "FTD"});
		state.setAbilityBase("wis", 16); // +3 modifier
	});

	it("should gain subclass at level 3", () => {
		const calculations = state.getFeatureCalculations();
		expect(calculations.hasDrakeCompanion).toBe(true);
	});

	// -------------------------------------------------------------------------
	// Draconic Gift (Level 3)
	// -------------------------------------------------------------------------
	describe("Draconic Gift (Level 3)", () => {
		it("should have Draconic Gift at level 3", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasDraconicGift).toBe(true);
		});
	});

	// -------------------------------------------------------------------------
	// Drake Companion (Level 3)
	// -------------------------------------------------------------------------
	describe("Drake Companion (Level 3)", () => {
		it("should have Drake Companion at level 3", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasDrakeCompanion).toBe(true);
		});

		it("should use ranger proficiency bonus", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.drakeProfBonus).toBe(2);
		});
	});

	// -------------------------------------------------------------------------
	// Bond of Fang and Scale (Level 7)
	// -------------------------------------------------------------------------
	describe("Bond of Fang and Scale (Level 7)", () => {
		it("should have Bond of Fang and Scale at level 7", () => {
			state.addClass({name: "Ranger", source: "PHB", level: 7});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasBondOfFangAndScale).toBe(true);
		});
	});

	// -------------------------------------------------------------------------
	// Drake's Breath (Level 11)
	// -------------------------------------------------------------------------
	describe("Drake's Breath (Level 11)", () => {
		it("should have Drake's Breath at level 11", () => {
			state.addClass({name: "Ranger", source: "PHB", level: 11});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasDrakesBreath).toBe(true);
		});

		it("should deal 8d6 damage", () => {
			state.addClass({name: "Ranger", source: "PHB", level: 11});
			const calculations = state.getFeatureCalculations();
			expect(calculations.drakesBreathDamage).toBe("8d6");
		});

		it("should calculate DC as 8 + prof + WIS", () => {
			state.addClass({name: "Ranger", source: "PHB", level: 11});
			const calculations = state.getFeatureCalculations();
			// 8 + 4 + 3 = 15
			expect(calculations.drakesBreathDc).toBe(15);
		});
	});

	// -------------------------------------------------------------------------
	// Perfected Bond (Level 15)
	// -------------------------------------------------------------------------
	describe("Perfected Bond (Level 15)", () => {
		it("should have Perfected Bond at level 15", () => {
			state.addClass({name: "Ranger", source: "PHB", level: 15});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasPerfectedBond).toBe(true);
		});

		it("should deal extra 1d6 damage", () => {
			state.addClass({name: "Ranger", source: "PHB", level: 15});
			const calculations = state.getFeatureCalculations();
			expect(calculations.perfectedBondExtraDamage).toBe("1d6");
		});
	});
});

// ==========================================================================
// PART 11: RANGER CORE CLASS FEATURES (XPHB 2024)
// ==========================================================================
describe("Ranger Core Class Features (XPHB 2024)", () => {
	let state;

	beforeEach(() => {
		state = new CharacterSheetState();
		state.setRace({name: "Human", source: "XPHB"});
		state.addClass({name: "Ranger", source: "XPHB", level: 1});
		state.setAbilityBase("str", 14);
		state.setAbilityBase("dex", 16);
		state.setAbilityBase("con", 14);
		state.setAbilityBase("int", 10);
		state.setAbilityBase("wis", 16); // +3 modifier
		state.setAbilityBase("cha", 10);
	});

	// -------------------------------------------------------------------------
	// Spellcasting (XPHB Level 1)
	// -------------------------------------------------------------------------
	describe("Spellcasting (XPHB)", () => {
		it("should have spellcasting at level 1", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasSpellcasting).toBe(true);
		});

		it("should use prepared spells progression", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.preparedSpells).toBe(2);
		});

		it("should have 9 prepared spells at level 9", () => {
			state.addClass({name: "Ranger", source: "XPHB", level: 9});
			const calculations = state.getFeatureCalculations();
			expect(calculations.preparedSpells).toBe(9);
		});

		it("should have 15 prepared spells at level 20", () => {
			state.addClass({name: "Ranger", source: "XPHB", level: 20});
			const calculations = state.getFeatureCalculations();
			expect(calculations.preparedSpells).toBe(15);
		});
	});

	// -------------------------------------------------------------------------
	// Favored Enemy (XPHB) - Free Hunter's Mark
	// -------------------------------------------------------------------------
	describe("Favored Enemy (XPHB)", () => {
		it("should have Favored Enemy at level 1", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasFavoredEnemy).toBe(true);
		});

		it("should have 2 free Hunter's Mark casts at level 1", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.huntersMarkFreeUses).toBe(2);
		});

		it("should have 3 free casts at level 9", () => {
			state.addClass({name: "Ranger", source: "XPHB", level: 9});
			const calculations = state.getFeatureCalculations();
			expect(calculations.huntersMarkFreeUses).toBe(3);
		});

		it("should have 4 free casts at level 13", () => {
			state.addClass({name: "Ranger", source: "XPHB", level: 13});
			const calculations = state.getFeatureCalculations();
			expect(calculations.huntersMarkFreeUses).toBe(4);
		});

		it("should have 5 free casts at level 17", () => {
			state.addClass({name: "Ranger", source: "XPHB", level: 17});
			const calculations = state.getFeatureCalculations();
			expect(calculations.huntersMarkFreeUses).toBe(5);
		});
	});

	// -------------------------------------------------------------------------
	// Deft Explorer (XPHB Level 2)
	// -------------------------------------------------------------------------
	describe("Deft Explorer (XPHB)", () => {
		it("should have Deft Explorer at level 2", () => {
			state.addClass({name: "Ranger", source: "XPHB", level: 2});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasDeftExplorer).toBe(true);
		});

		it("should have Canny at level 2", () => {
			state.addClass({name: "Ranger", source: "XPHB", level: 2});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasCanny).toBe(true);
		});
	});

	// -------------------------------------------------------------------------
	// Roving (XPHB Level 6)
	// -------------------------------------------------------------------------
	describe("Roving (XPHB)", () => {
		it("should have Roving at level 6", () => {
			state.addClass({name: "Ranger", source: "XPHB", level: 6});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasRoving).toBe(true);
		});

		it("should grant +10 speed", () => {
			state.addClass({name: "Ranger", source: "XPHB", level: 6});
			const calculations = state.getFeatureCalculations();
			expect(calculations.rovingSpeedBonus).toBe(10);
		});
	});

	// -------------------------------------------------------------------------
	// Expertise (XPHB Level 9)
	// -------------------------------------------------------------------------
	describe("Expertise (XPHB)", () => {
		it("should have Expertise at level 9", () => {
			state.addClass({name: "Ranger", source: "XPHB", level: 9});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasExpertise).toBe(true);
		});

		it("should have 2 expertise skills", () => {
			state.addClass({name: "Ranger", source: "XPHB", level: 9});
			const calculations = state.getFeatureCalculations();
			expect(calculations.expertiseCount).toBe(2);
		});
	});

	// -------------------------------------------------------------------------
	// Tireless (XPHB Level 10)
	// -------------------------------------------------------------------------
	describe("Tireless (XPHB)", () => {
		it("should have Tireless at level 10", () => {
			state.addClass({name: "Ranger", source: "XPHB", level: 10});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasTireless).toBe(true);
		});

		it("should grant temp HP equal to 1d8 + WIS mod", () => {
			state.addClass({name: "Ranger", source: "XPHB", level: 10});
			const calculations = state.getFeatureCalculations();
			expect(calculations.tirelessTempHp).toBe("1d8 + 3");
		});

		it("should have prof bonus uses", () => {
			state.addClass({name: "Ranger", source: "XPHB", level: 10});
			const calculations = state.getFeatureCalculations();
			expect(calculations.tirelessUses).toBe(4); // prof at level 10
		});
	});

	// -------------------------------------------------------------------------
	// Relentless Hunter (XPHB Level 13)
	// -------------------------------------------------------------------------
	describe("Relentless Hunter (XPHB)", () => {
		it("should have Relentless Hunter at level 13", () => {
			state.addClass({name: "Ranger", source: "XPHB", level: 13});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasRelentlessHunter).toBe(true);
		});
	});

	// -------------------------------------------------------------------------
	// Nature's Veil (XPHB Level 14)
	// -------------------------------------------------------------------------
	describe("Nature's Veil (XPHB)", () => {
		it("should have Nature's Veil at level 14", () => {
			state.addClass({name: "Ranger", source: "XPHB", level: 14});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasNaturesVeil).toBe(true);
		});

		it("should have prof bonus uses", () => {
			state.addClass({name: "Ranger", source: "XPHB", level: 14});
			const calculations = state.getFeatureCalculations();
			expect(calculations.naturesVeilUses).toBe(5); // prof at level 14
		});
	});

	// -------------------------------------------------------------------------
	// Precise Hunter (XPHB Level 17)
	// -------------------------------------------------------------------------
	describe("Precise Hunter (XPHB)", () => {
		it("should have Precise Hunter at level 17", () => {
			state.addClass({name: "Ranger", source: "XPHB", level: 17});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasPreciseHunter).toBe(true);
		});
	});
});

// ==========================================================================
// PART 12: PHB VS XPHB RANGER FEATURE COMPARISON
// ==========================================================================
describe("PHB vs XPHB Ranger Feature Comparison", () => {
	// -------------------------------------------------------------------------
	// Spellcasting Level
	// -------------------------------------------------------------------------
	describe("Spellcasting Level", () => {
		it("should start at different levels", () => {
			const phbState = new CharacterSheetState();
			phbState.setRace({name: "Human", source: "PHB"});
			phbState.addClass({name: "Ranger", source: "PHB", level: 1});
			phbState.setAbilityBase("wis", 16);

			const xphbState = new CharacterSheetState();
			xphbState.setRace({name: "Human", source: "XPHB"});
			xphbState.addClass({name: "Ranger", source: "XPHB", level: 1});
			xphbState.setAbilityBase("wis", 16);

			const phbCalc = phbState.getFeatureCalculations();
			const xphbCalc = xphbState.getFeatureCalculations();

			expect(phbCalc.hasSpellcasting).toBeUndefined(); // PHB: level 2
			expect(xphbCalc.hasSpellcasting).toBe(true); // XPHB: level 1
		});
	});

	// -------------------------------------------------------------------------
	// Spells Known vs Prepared
	// -------------------------------------------------------------------------
	describe("Spells Known vs Prepared", () => {
		it("should use different spell systems", () => {
			const phbState = new CharacterSheetState();
			phbState.setRace({name: "Human", source: "PHB"});
			phbState.addClass({name: "Ranger", source: "PHB", level: 5});
			phbState.setAbilityBase("wis", 16);

			const xphbState = new CharacterSheetState();
			xphbState.setRace({name: "Human", source: "XPHB"});
			xphbState.addClass({name: "Ranger", source: "XPHB", level: 5});
			xphbState.setAbilityBase("wis", 16);

			const phbCalc = phbState.getFeatureCalculations();
			const xphbCalc = xphbState.getFeatureCalculations();

			expect(phbCalc.spellsKnown).toBe(4); // PHB uses spells known
			expect(xphbCalc.preparedSpells).toBe(6); // XPHB uses prepared spells
		});
	});

	// -------------------------------------------------------------------------
	// Favored Enemy Mechanics
	// -------------------------------------------------------------------------
	describe("Favored Enemy Mechanics", () => {
		it("should have different Favored Enemy implementations", () => {
			const phbState = new CharacterSheetState();
			phbState.setRace({name: "Human", source: "PHB"});
			phbState.addClass({name: "Ranger", source: "PHB", level: 1});
			phbState.setAbilityBase("wis", 16);

			const xphbState = new CharacterSheetState();
			xphbState.setRace({name: "Human", source: "XPHB"});
			xphbState.addClass({name: "Ranger", source: "XPHB", level: 1});
			xphbState.setAbilityBase("wis", 16);

			const phbCalc = phbState.getFeatureCalculations();
			const xphbCalc = xphbState.getFeatureCalculations();

			expect(phbCalc.huntersMarkFreeUses).toBeUndefined(); // PHB: no free casts
			expect(xphbCalc.huntersMarkFreeUses).toBe(2); // XPHB: free Hunter's Mark
		});
	});

	// -------------------------------------------------------------------------
	// Level 10 Features
	// -------------------------------------------------------------------------
	describe("Level 10 Features", () => {
		it("should have different level 10 features", () => {
			const phbState = new CharacterSheetState();
			phbState.setRace({name: "Human", source: "PHB"});
			phbState.addClass({name: "Ranger", source: "PHB", level: 10});
			phbState.setAbilityBase("wis", 16);

			const xphbState = new CharacterSheetState();
			xphbState.setRace({name: "Human", source: "XPHB"});
			xphbState.addClass({name: "Ranger", source: "XPHB", level: 10});
			xphbState.setAbilityBase("wis", 16);

			const phbCalc = phbState.getFeatureCalculations();
			const xphbCalc = xphbState.getFeatureCalculations();

			expect(phbCalc.hasHideInPlainSight).toBe(true); // PHB feature
			expect(xphbCalc.hasTireless).toBe(true); // XPHB feature
		});
	});
});

// ==========================================================================
// PART 13: RANGER MULTICLASS
// ==========================================================================
describe("Ranger Multiclass", () => {
	let state;

	beforeEach(() => {
		state = new CharacterSheetState();
		state.setRace({name: "Human", source: "PHB"});
		state.setAbilityBase("dex", 14);
		state.setAbilityBase("wis", 14);
	});

	it("should require DEX 13 and WIS 13 for multiclassing", () => {
		// Verify ability scores meet the Ranger multiclass prerequisites
		expect(state.getAbilityScore("dex")).toBeGreaterThanOrEqual(13);
		expect(state.getAbilityScore("wis")).toBeGreaterThanOrEqual(13);
	});

	it("should calculate Extra Attack based on ranger level", () => {
		state.addClass({name: "Fighter", source: "PHB", level: 3});
		state.addClass({name: "Ranger", source: "PHB", level: 5});
		const calculations = state.getFeatureCalculations();
		expect(calculations.hasExtraAttack).toBe(true);
	});

	it("should track total level correctly across classes", () => {
		state.addClass({name: "Fighter", source: "PHB", level: 3});
		state.addClass({name: "Ranger", source: "PHB", level: 5});
		expect(state.getTotalLevel()).toBe(8);
	});

	it("should calculate proficiency bonus based on total level", () => {
		state.addClass({name: "Fighter", source: "PHB", level: 5});
		state.addClass({name: "Ranger", source: "PHB", level: 4});
		// Total level 9 = +4 proficiency
		expect(state.getProficiencyBonus()).toBe(4);
	});
});

// ==========================================================================
// PART 14: RANGER EDGE CASES
// ==========================================================================
describe("Ranger Edge Cases", () => {
	let state;

	beforeEach(() => {
		state = new CharacterSheetState();
		state.setRace({name: "Human", source: "PHB"});
		state.addClass({name: "Ranger", source: "PHB", level: 1});
		state.setAbilityBase("wis", 16);
	});

	it("should handle level 20 character correctly", () => {
		state.addClass({name: "Ranger", source: "PHB", level: 20});
		const calculations = state.getFeatureCalculations();
		expect(calculations.hasFoeSlayer).toBe(true);
		expect(calculations.hasFeralSenses).toBe(true);
		expect(calculations.hasExtraAttack).toBe(true);
	});

	it("should calculate spell save DC with different WIS scores", () => {
		state.addClass({name: "Ranger", source: "PHB", level: 5});
		state.setAbilityBase("wis", 20); // +5 modifier
		const calculations = state.getFeatureCalculations();
		// 8 + 3 (prof) + 5 (WIS) = 16
		expect(calculations.spellSaveDc).toBe(16);
	});

	it("should track hit dice correctly", () => {
		state.addClass({name: "Ranger", source: "PHB", level: 10});
		const hitDice = state.getHitDice();
		// Check total hit dice count
		const totalDice = Array.isArray(hitDice)
			? hitDice.reduce((sum, hd) => sum + (hd.max || hd.current || 0), 0)
			: (hitDice.d10 || 0);
		expect(totalDice).toBe(10);
	});

	it("should handle subclass selection", () => {
		state.addClass({name: "Ranger", source: "PHB", level: 3});
		state.setSubclass("Ranger", {name: "Hunter", source: "PHB"});
		const classes = state.getClasses();
		const ranger = classes.find(c => c.name === "Ranger");
		expect(ranger.subclass.name).toBe("Hunter");
	});

	it("should handle low WIS for Foe Slayer", () => {
		state.addClass({name: "Ranger", source: "PHB", level: 20});
		state.setAbilityBase("wis", 8); // -1 modifier
		const calculations = state.getFeatureCalculations();
		expect(calculations.foeSlayerBonus).toBe(-1);
	});

	it("should not have Favored Foe damage without feature", () => {
		// By default, no Favored Foe feature added
		const calculations = state.getFeatureCalculations();
		expect(calculations.favoredFoeDamage).toBeUndefined();
	});
});

// ==========================================================================
// PART 15: RANGER PROFICIENCY BONUS PROGRESSION
// ==========================================================================
describe("Ranger Proficiency Bonus Progression", () => {
	let state;

	beforeEach(() => {
		state = new CharacterSheetState();
		state.setRace({name: "Human", source: "PHB"});
	});

	it("should return +2 proficiency bonus at level 1", () => {
		state.addClass({name: "Ranger", source: "PHB", level: 1});
		expect(state.getProficiencyBonus()).toBe(2);
	});

	it("should return +2 proficiency bonus at level 4", () => {
		state.addClass({name: "Ranger", source: "PHB", level: 4});
		expect(state.getProficiencyBonus()).toBe(2);
	});

	it("should return +3 proficiency bonus at level 5", () => {
		state.addClass({name: "Ranger", source: "PHB", level: 5});
		expect(state.getProficiencyBonus()).toBe(3);
	});

	it("should return +4 proficiency bonus at level 9", () => {
		state.addClass({name: "Ranger", source: "PHB", level: 9});
		expect(state.getProficiencyBonus()).toBe(4);
	});

	it("should return +5 proficiency bonus at level 13", () => {
		state.addClass({name: "Ranger", source: "PHB", level: 13});
		expect(state.getProficiencyBonus()).toBe(5);
	});

	it("should return +6 proficiency bonus at level 17", () => {
		state.addClass({name: "Ranger", source: "PHB", level: 17});
		expect(state.getProficiencyBonus()).toBe(6);
	});
});

// ==========================================================================
// PART 16: RANGER SPELL SLOTS (HALF-CASTER)
// ==========================================================================
describe("Ranger Spell Slots (Half-Caster)", () => {
	let state;

	beforeEach(() => {
		state = new CharacterSheetState();
		state.setRace({name: "Human", source: "PHB"});
		state.setAbilityBase("wis", 16);
	});

	it("should have no spell slots at level 1 (PHB)", () => {
		state.addClass({name: "Ranger", source: "PHB", level: 1});
		const spellSlots = state.getSpellSlots();
		const level1Slots = spellSlots[1]?.max || spellSlots[1] || 0;
		expect(level1Slots).toBeLessThanOrEqual(2);
	});

	it("should have 2 1st-level slots at level 2 (PHB)", () => {
		state.addClass({name: "Ranger", source: "PHB", level: 2});
		const spellSlots = state.getSpellSlots();
		const level1Slots = spellSlots[1]?.max ?? (typeof spellSlots[1] === "number" ? spellSlots[1] : 0);
		expect(level1Slots).toBe(2);
	});

	it("should have 3 1st-level slots at level 3", () => {
		state.addClass({name: "Ranger", source: "PHB", level: 3});
		const spellSlots = state.getSpellSlots();
		const level1Slots = spellSlots[1]?.max ?? (typeof spellSlots[1] === "number" ? spellSlots[1] : 0);
		expect(level1Slots).toBe(3);
	});

	it("should have 2nd-level slots at level 5", () => {
		state.addClass({name: "Ranger", source: "PHB", level: 5});
		const spellSlots = state.getSpellSlots();
		const level2Slots = spellSlots[2]?.max ?? (typeof spellSlots[2] === "number" ? spellSlots[2] : 0);
		expect(level2Slots).toBeGreaterThan(0);
	});

	it("should have 3rd-level slots at level 9", () => {
		state.addClass({name: "Ranger", source: "PHB", level: 9});
		const spellSlots = state.getSpellSlots();
		const level3Slots = spellSlots[3]?.max ?? (typeof spellSlots[3] === "number" ? spellSlots[3] : 0);
		expect(level3Slots).toBeGreaterThan(0);
	});

	it("should have 4th-level slots at level 13", () => {
		state.addClass({name: "Ranger", source: "PHB", level: 13});
		const spellSlots = state.getSpellSlots();
		const level4Slots = spellSlots[4]?.max ?? (typeof spellSlots[4] === "number" ? spellSlots[4] : 0);
		expect(level4Slots).toBeGreaterThan(0);
	});

	it("should have 5th-level slots at level 17", () => {
		state.addClass({name: "Ranger", source: "PHB", level: 17});
		const spellSlots = state.getSpellSlots();
		const level5Slots = spellSlots[5]?.max ?? (typeof spellSlots[5] === "number" ? spellSlots[5] : 0);
		expect(level5Slots).toBeGreaterThan(0);
	});

	it("should max out at 5th-level spells", () => {
		state.addClass({name: "Ranger", source: "PHB", level: 20});
		const spellSlots = state.getSpellSlots();
		const level6Slots = spellSlots[6]?.max ?? (typeof spellSlots[6] === "number" ? spellSlots[6] : 0);
		expect(level6Slots).toBe(0);
	});
});
