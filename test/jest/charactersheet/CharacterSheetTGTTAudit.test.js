/**
 * TGTT Class/Subclass Audit Tests
 *
 * Tests for:
 * - Phase A: Missing tradition auto-grants (Shackled, Five Animals, Jesters)
 * - Phase B: Missing toggle states (rhythmicStep, craneParry)
 * - Phase C: Incomplete features (Stormborn fly speed, Temporal Manipulation DC)
 * - Phase D: Arcane Archer tradition fix (restricted list, no auto-grant)
 * - Phase E: Warder edge cases
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

function makeTGTTMonk (level, subclassShortName) {
	state.addClass({
		name: "Monk",
		source: "TGTT",
		level,
		hitDice: "d8",
		subclass: subclassShortName ? {name: `Way of ${subclassShortName}`, shortName: subclassShortName, source: "TGTT"} : undefined,
	});
	state.setAbilityBase("dex", 16); // +3
	state.setAbilityBase("wis", 16); // +3
}

function makeTGTTFighter (level, subclassShortName) {
	state.addClass({
		name: "Fighter",
		source: "TGTT",
		level,
		hitDice: "d10",
		subclass: subclassShortName ? {name: subclassShortName, shortName: subclassShortName, source: "TGTT"} : undefined,
	});
	state.setAbilityBase("str", 16); // +3
	state.setAbilityBase("dex", 14); // +2
	state.setAbilityBase("con", 14); // +2
}

function makeTGTTBard (level, subclassShortName) {
	state.addClass({
		name: "Bard",
		source: "TGTT",
		level,
		hitDice: "d8",
		subclass: subclassShortName ? {name: subclassShortName, shortName: subclassShortName, source: "TGTT"} : undefined,
	});
	state.setAbilityBase("cha", 16); // +3
}

function makeTGTTCleric (level, subclassShortName) {
	state.addClass({
		name: "Cleric",
		source: "TGTT",
		level,
		hitDice: "d8",
		subclass: subclassShortName ? {name: subclassShortName, shortName: subclassShortName, source: "TGTT"} : undefined,
	});
	state.setAbilityBase("wis", 16); // +3
}

function makeTGTTWarder (level) {
	state.addClass({
		name: "Fighter",
		source: "TGTT",
		level,
		hitDice: "d10",
		subclass: {name: "Warder", shortName: "Warder", source: "TGTT"},
	});
	state.setAbilityBase("str", 16); // +3
	state.setAbilityBase("con", 14); // +2
	state.setAbilityBase("wis", 12); // +1
}

// =========================================================================
// PHASE A: TRADITION AUTO-GRANTS
// =========================================================================

describe("TGTT Tradition Auto-Grants", () => {
	beforeEach(() => {
		state = new CharacterSheetState();
	});

	// --- Shackled Monk ---
	it("Shackled Monk should auto-grant Unending Wheel tradition", () => {
		makeTGTTMonk(3, "Shackled");
		state.applyClassFeatureEffects();
		expect(state.hasCombatTradition("Unending Wheel")).toBe(true);
	});

	it("Shackled Monk should set hasShackledCombatMethods flag", () => {
		makeTGTTMonk(3, "Shackled");
		const calcs = state.getFeatureCalculations();
		expect(calcs.hasShackledCombatMethods).toBe(true);
	});

	it("Non-Shackled Monk should NOT get Unending Wheel", () => {
		makeTGTTMonk(3, "Mercy");
		state.applyClassFeatureEffects();
		expect(state.hasCombatTradition("Unending Wheel")).toBe(false);
	});

	// --- Five Animals Monk ---
	it("Five Animals Monk should auto-grant Tooth and Claw tradition", () => {
		makeTGTTMonk(3, "Five Animals");
		state.applyClassFeatureEffects();
		expect(state.hasCombatTradition("Tooth and Claw")).toBe(true);
	});

	it("Five Animals Monk should set hasFiveAnimalsCombatMethods flag", () => {
		makeTGTTMonk(3, "Five Animals");
		const calcs = state.getFeatureCalculations();
		expect(calcs.hasFiveAnimalsCombatMethods).toBe(true);
	});

	it("Non-Five-Animals Monk should NOT get Tooth and Claw", () => {
		makeTGTTMonk(3, "Shackled");
		state.applyClassFeatureEffects();
		expect(state.hasCombatTradition("Tooth and Claw")).toBe(false);
	});

	// --- College of Jesters Bard ---
	it("College of Jesters should auto-grant Comedic Jabs tradition", () => {
		makeTGTTBard(3, "College of Jesters");
		state.applyClassFeatureEffects();
		expect(state.hasCombatTradition("Comedic Jabs")).toBe(true);
	});

	it("College of Jesters should set hasJesterCombatMethods flag", () => {
		makeTGTTBard(3, "College of Jesters");
		const calcs = state.getFeatureCalculations();
		expect(calcs.hasJesterCombatMethods).toBe(true);
	});

	it("Non-Jester Bard should NOT get Comedic Jabs", () => {
		makeTGTTBard(3, "College of Surrealism");
		state.applyClassFeatureEffects();
		expect(state.hasCombatTradition("Comedic Jabs")).toBe(false);
	});

	// --- Cross-subclass isolation ---
	it("Shackled Monk should NOT get Tooth and Claw or Comedic Jabs", () => {
		makeTGTTMonk(3, "Shackled");
		state.applyClassFeatureEffects();
		expect(state.hasCombatTradition("Tooth and Claw")).toBe(false);
		expect(state.hasCombatTradition("Comedic Jabs")).toBe(false);
	});

	it("_subclassGrantedTraditions should list correct source strings", () => {
		makeTGTTMonk(3, "Shackled");
		const calcs = state.getFeatureCalculations();
		const traditions = calcs._subclassGrantedTraditions;
		expect(traditions).toBeDefined();
		expect(traditions.length).toBeGreaterThanOrEqual(1);
		const uwEntry = traditions.find(t => t.tradition === "Unending Wheel");
		expect(uwEntry).toBeDefined();
		expect(uwEntry.source).toContain("Shackled");
	});
});

// =========================================================================
// PHASE B: TOGGLE STATES
// =========================================================================

describe("TGTT Toggle States — ACTIVE_STATE_TYPES", () => {
	it("rhythmicStep should exist in ACTIVE_STATE_TYPES", () => {
		const type = CharacterSheetState.ACTIVE_STATE_TYPES.rhythmicStep;
		expect(type).toBeDefined();
		expect(type.id).toBe("rhythmicStep");
		expect(type.requiresSubclass).toBe("The Shackled");
	});

	it("rhythmicStep should have correct AC effect (CHA mod)", () => {
		const type = CharacterSheetState.ACTIVE_STATE_TYPES.rhythmicStep;
		const acEffect = type.effects.find(e => e.target === "ac");
		expect(acEffect).toBeDefined();
		expect(acEffect.type).toBe("bonus");
		expect(acEffect.abilityMod).toBe("cha");
	});

	it("rhythmicStep should cost 2 ki and use bonus action", () => {
		const type = CharacterSheetState.ACTIVE_STATE_TYPES.rhythmicStep;
		expect(type.resourceCost).toBe(2);
		expect(type.activationAction).toBe("bonus");
		expect(type.resourceName).toBe("Ki Points");
	});

	it("rhythmicStep should grant DEX save advantage and Acrobatics advantage", () => {
		const type = CharacterSheetState.ACTIVE_STATE_TYPES.rhythmicStep;
		const dexSave = type.effects.find(e => e.target === "save:dex");
		expect(dexSave).toBeDefined();
		expect(dexSave.type).toBe("advantage");
		const acrobatics = type.effects.find(e => e.target === "skill:acrobatics");
		expect(acrobatics).toBeDefined();
		expect(acrobatics.type).toBe("advantage");
	});

	it("craneParry should exist in ACTIVE_STATE_TYPES", () => {
		const type = CharacterSheetState.ACTIVE_STATE_TYPES.craneParry;
		expect(type).toBeDefined();
		expect(type.id).toBe("craneParry");
		expect(type.requiresSubclass).toBe("Five Animals");
	});

	it("craneParry should have +2 AC effect", () => {
		const type = CharacterSheetState.ACTIVE_STATE_TYPES.craneParry;
		const acEffect = type.effects.find(e => e.target === "ac");
		expect(acEffect).toBeDefined();
		expect(acEffect.type).toBe("bonus");
		expect(acEffect.value).toBe(2);
	});

	it("craneParry should cost 1 ki and use reaction", () => {
		const type = CharacterSheetState.ACTIVE_STATE_TYPES.craneParry;
		expect(type.resourceCost).toBe(1);
		expect(type.activationAction).toBe("reaction");
		expect(type.resourceName).toBe("Ki Points");
	});

	it("craneParry duration should be until start of next turn", () => {
		const type = CharacterSheetState.ACTIVE_STATE_TYPES.craneParry;
		expect(type.duration).toBe("Until start of next turn");
	});
});

// =========================================================================
// PHASE C: INCOMPLETE FEATURES
// =========================================================================

describe("TGTT Incomplete Feature Fixes", () => {
	beforeEach(() => {
		state = new CharacterSheetState();
	});

	// --- Tempest Stormborn ---
	it("Tempest Cleric L17 should have stormFlySpeed", () => {
		makeTGTTCleric(17, "Tempest Domain");
		const calcs = state.getFeatureCalculations();
		expect(calcs.hasStormborn).toBe(true);
		expect(calcs.stormFlySpeed).toBeDefined();
		expect(calcs.stormFlySpeed).toBeGreaterThan(0);
	});

	it("Tempest Cleric below L17 should NOT have stormFlySpeed", () => {
		makeTGTTCleric(16, "Tempest Domain");
		const calcs = state.getFeatureCalculations();
		expect(calcs.hasStormborn).toBeUndefined();
		expect(calcs.stormFlySpeed).toBeUndefined();
	});

	it("Tempest Stormborn fly speed should match walking speed", () => {
		makeTGTTCleric(17, "Tempest Domain");
		const walkSpeed = state.getSpeed("walk") || 30;
		const calcs = state.getFeatureCalculations();
		expect(calcs.stormFlySpeed).toBe(walkSpeed);
	});

	// --- Time Domain Temporal Manipulation ---
	it("Time Domain Cleric L3 should have temporalManipulationDc", () => {
		makeTGTTCleric(3, "Time Domain");
		const calcs = state.getFeatureCalculations();
		expect(calcs.hasTemporalManipulation).toBe(true);
		expect(calcs.temporalManipulationDc).toBeDefined();
	});

	it("Time Domain Temporal Manipulation DC should equal 8 + prof + WIS", () => {
		makeTGTTCleric(3, "Time Domain");
		state.setAbilityBase("wis", 16); // +3
		const calcs = state.getFeatureCalculations();
		// L3: prof = 2, WIS mod = 3 → DC = 8 + 2 + 3 = 13
		expect(calcs.temporalManipulationDc).toBe(13);
	});

	it("Time Domain DC should scale with proficiency", () => {
		makeTGTTCleric(9, "Time Domain");
		state.setAbilityBase("wis", 16); // +3
		const calcs = state.getFeatureCalculations();
		// L9: prof = 4, WIS mod = 3 → DC = 8 + 4 + 3 = 15
		expect(calcs.temporalManipulationDc).toBe(15);
	});
});

// =========================================================================
// PHASE D: ARCANE ARCHER TRADITION FIX
// =========================================================================

describe("TGTT Arcane Archer Tradition Fix", () => {
	beforeEach(() => {
		state = new CharacterSheetState();
	});

	it("TGTT Arcane Archer should NOT auto-grant any tradition", () => {
		makeTGTTFighter(3, "Arcane Archer");
		state.applyClassFeatureEffects();
		expect(state.hasCombatTradition("Biting Zephyr")).toBe(false);
		expect(state.hasCombatTradition("Razor's Edge")).toBe(false);
		expect(state.hasCombatTradition("Unending Wheel")).toBe(false);
		expect(state.hasCombatTradition("Unerring Hawk")).toBe(false);
	});

	it("should expose arcaneArcherAllowedTraditions with 4 options", () => {
		makeTGTTFighter(3, "Arcane Archer");
		const calcs = state.getFeatureCalculations();
		expect(calcs.arcaneArcherAllowedTraditions).toBeDefined();
		expect(calcs.arcaneArcherAllowedTraditions).toHaveLength(4);
	});

	it("allowed traditions should include all 4 correct traditions", () => {
		makeTGTTFighter(3, "Arcane Archer");
		const calcs = state.getFeatureCalculations();
		expect(calcs.arcaneArcherAllowedTraditions).toContain("Biting Zephyr");
		expect(calcs.arcaneArcherAllowedTraditions).toContain("Razor's Edge");
		expect(calcs.arcaneArcherAllowedTraditions).toContain("Unending Wheel");
		expect(calcs.arcaneArcherAllowedTraditions).toContain("Unerring Hawk");
	});

	it("non-TGTT Arcane Archer should NOT have allowed traditions", () => {
		state.addClass({
			name: "Fighter",
			source: "PHB",
			level: 3,
			hitDice: "d10",
			subclass: {name: "Arcane Archer", shortName: "Arcane Archer", source: "XGE"},
		});
		const calcs = state.getFeatureCalculations();
		expect(calcs.arcaneArcherAllowedTraditions).toBeUndefined();
	});
});

// =========================================================================
// PHASE E: WARDER EDGE CASES
// =========================================================================

describe("TGTT Warder Edge Cases", () => {
	beforeEach(() => {
		state = new CharacterSheetState();
	});

	// --- Tradition auto-grants ---
	it("Warder L3 should auto-grant Tempered Iron", () => {
		makeTGTTWarder(3);
		state.applyClassFeatureEffects();
		expect(state.hasCombatTradition("Tempered Iron")).toBe(true);
	});

	it("Warder L3 should auto-grant Gallant Heart", () => {
		makeTGTTWarder(3);
		state.applyClassFeatureEffects();
		expect(state.hasCombatTradition("Gallant Heart")).toBe(true);
	});

	it("Warder should NOT grant unrelated traditions", () => {
		makeTGTTWarder(3);
		state.applyClassFeatureEffects();
		expect(state.hasCombatTradition("Biting Zephyr")).toBe(false);
		expect(state.hasCombatTradition("Sanguine Knot")).toBe(false);
		expect(state.hasCombatTradition("Unending Wheel")).toBe(false);
	});

	// --- Bond range progression ---
	it("Warder L3 should have warderBondRange of 30", () => {
		makeTGTTWarder(3);
		const calcs = state.getFeatureCalculations();
		expect(calcs.hasWarderBond).toBe(true);
		expect(calcs.warderBondRange).toBe(30);
	});

	it("Warder L7 should have warderBondRange of 60", () => {
		makeTGTTWarder(7);
		const calcs = state.getFeatureCalculations();
		expect(calcs.warderBondRange).toBe(60);
	});

	it("Warder L6 should still have warderBondRange of 30", () => {
		makeTGTTWarder(6);
		const calcs = state.getFeatureCalculations();
		expect(calcs.warderBondRange).toBe(30);
	});

	// --- Level progression ---
	it("Warder L3 should have bodyguard and combat methods", () => {
		makeTGTTWarder(3);
		const calcs = state.getFeatureCalculations();
		expect(calcs.hasBodyguard).toBe(true);
		expect(calcs.bodyguardRange).toBe(15);
		expect(calcs.hasWarderCombatMethods).toBe(true);
	});

	it("Warder L7 should have Warding Senses", () => {
		makeTGTTWarder(7);
		const calcs = state.getFeatureCalculations();
		expect(calcs.hasWardingSenses).toBe(true);
		expect(calcs.wardingSensesUses).toBeGreaterThan(0);
	});

	it("Warder L10 should have Warding Blow and advantage on STR/DEX", () => {
		makeTGTTWarder(10);
		const calcs = state.getFeatureCalculations();
		expect(calcs.hasWardingBlow).toBe(true);
		expect(calcs.hasStrSaveAdvantage).toBe(true);
		expect(calcs.hasDexSaveAdvantage).toBe(true);
		expect(calcs.hasStrDexSkillAdvantageIfProficient).toBe(true);
	});

	it("Warder L15 should have Warder's Duty and Telepathic Bond", () => {
		makeTGTTWarder(15);
		const calcs = state.getFeatureCalculations();
		expect(calcs.hasWardersDuty).toBe(true);
		expect(calcs.hasTelepathicBond).toBe(true);
		expect(calcs.telepathicBondRange).toBe(60);
	});

	it("Warder L18 should have Perfect Sync", () => {
		makeTGTTWarder(18);
		const calcs = state.getFeatureCalculations();
		expect(calcs.hasPerfectSync).toBe(true);
	});

	it("Warder L9 should NOT have L10 features", () => {
		makeTGTTWarder(9);
		const calcs = state.getFeatureCalculations();
		expect(calcs.hasWardingBlow).toBeUndefined();
		expect(calcs.hasAdvOnStrDexSaves).toBeUndefined();
	});

	it("Warder L14 should NOT have L15 features", () => {
		makeTGTTWarder(14);
		const calcs = state.getFeatureCalculations();
		expect(calcs.hasWardersDuty).toBeUndefined();
		expect(calcs.hasPermanentTelepathicBond).toBeUndefined();
	});
});
