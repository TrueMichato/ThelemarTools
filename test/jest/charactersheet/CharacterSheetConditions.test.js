/**
 * Character Sheet Conditions - Unit Tests
 * Tests for condition handling, effects application, and verification against official conditions
 */

import "./setup.js";
import "../../../js/charactersheet/charactersheet-state.js";

const CharacterSheetState = globalThis.CharacterSheetState;

// =============================================================================
// Official Conditions from 5e
// =============================================================================
const OFFICIAL_CONDITIONS_2024 = [
	{name: "Blinded", source: "XPHB"},
	{name: "Charmed", source: "XPHB"},
	{name: "Deafened", source: "XPHB"},
	{name: "Exhaustion", source: "XPHB"},
	{name: "Frightened", source: "XPHB"},
	{name: "Grappled", source: "XPHB"},
	{name: "Incapacitated", source: "XPHB"},
	{name: "Invisible", source: "XPHB"},
	{name: "Paralyzed", source: "XPHB"},
	{name: "Petrified", source: "XPHB"},
	{name: "Poisoned", source: "XPHB"},
	{name: "Prone", source: "XPHB"},
	{name: "Restrained", source: "XPHB"},
	{name: "Stunned", source: "XPHB"},
	{name: "Unconscious", source: "XPHB"},
];

const OFFICIAL_CONDITIONS_2014 = [
	{name: "Blinded", source: "PHB"},
	{name: "Charmed", source: "PHB"},
	{name: "Deafened", source: "PHB"},
	{name: "Exhaustion", source: "PHB"},
	{name: "Frightened", source: "PHB"},
	{name: "Grappled", source: "PHB"},
	{name: "Incapacitated", source: "PHB"},
	{name: "Invisible", source: "PHB"},
	{name: "Paralyzed", source: "PHB"},
	{name: "Petrified", source: "PHB"},
	{name: "Poisoned", source: "PHB"},
	{name: "Prone", source: "PHB"},
	{name: "Restrained", source: "PHB"},
	{name: "Stunned", source: "PHB"},
	{name: "Unconscious", source: "PHB"},
];

// Additional conditions from various sources
const ADDITIONAL_CONDITIONS = [
	{name: "Slowed", source: "XPHB"}, // 2024 addition
	{name: "Silenced", source: "HB"}, // Common homebrew
];

describe("CharacterSheetConditions", () => {
	let state;

	beforeEach(() => {
		state = new CharacterSheetState();
		// Set up a basic character for testing
		state.setName("Test Character");
		// Set ability scores using individual setAbilityBase calls
		state.setAbilityBase("str", 14);
		state.setAbilityBase("dex", 16);
		state.setAbilityBase("con", 14);
		state.setAbilityBase("int", 10);
		state.setAbilityBase("wis", 12);
		state.setAbilityBase("cha", 8);
		state.addClass({name: "Fighter", source: "XPHB", level: 5});
	});

	// ==========================================================================
	// Basic Condition Management
	// ==========================================================================
	describe("Basic Condition Management", () => {
		it("should add a condition", () => {
			state.addCondition({name: "Blinded", source: "XPHB"});
			expect(state.hasCondition("Blinded")).toBe(true);
		});

		it("should add a condition with string format (legacy)", () => {
			state.addCondition("Poisoned");
			expect(state.hasCondition("Poisoned")).toBe(true);
		});

		it("should remove a condition", () => {
			state.addCondition({name: "Blinded", source: "XPHB"});
			state.removeCondition({name: "Blinded", source: "XPHB"});
			expect(state.hasCondition("Blinded")).toBe(false);
		});

		it("should not add duplicate conditions", () => {
			state.addCondition({name: "Blinded", source: "XPHB"});
			state.addCondition({name: "Blinded", source: "XPHB"});
			const conditions = state.getConditions();
			const blindedCount = conditions.filter(c => c.name === "Blinded").length;
			expect(blindedCount).toBe(1);
		});

		it("should allow same condition from different sources", () => {
			state.addCondition({name: "Blinded", source: "XPHB"});
			state.addCondition({name: "Blinded", source: "PHB"});
			const conditions = state.getConditions();
			const blindedCount = conditions.filter(c => c.name === "Blinded").length;
			expect(blindedCount).toBe(2);
		});

		it("should clear all conditions", () => {
			state.addCondition({name: "Blinded", source: "XPHB"});
			state.addCondition({name: "Poisoned", source: "XPHB"});
			state.addCondition({name: "Frightened", source: "XPHB"});
			state.clearConditions();
			expect(state.getConditions()).toEqual([]);
		});

		it("should get condition names for backward compatibility", () => {
			state.addCondition({name: "Blinded", source: "XPHB"});
			state.addCondition({name: "Poisoned", source: "XPHB"});
			const names = state.getConditionNames();
			expect(names).toContain("Blinded");
			expect(names).toContain("Poisoned");
		});

		it("should check for condition exact match (name + source)", () => {
			state.addCondition({name: "Blinded", source: "XPHB"});
			expect(state.hasConditionExact("Blinded", "XPHB")).toBe(true);
			expect(state.hasConditionExact("Blinded", "PHB")).toBe(false);
		});
	});

	// ==========================================================================
	// Official 2024 Conditions - Effect Definitions Exist
	// ==========================================================================
	describe("Official 2024 Conditions - Effect Definitions", () => {
		OFFICIAL_CONDITIONS_2024.forEach(condition => {
			it(`should have effect definition for ${condition.name}`, () => {
				const effects = CharacterSheetState.getConditionEffects(condition.name);
				// Exhaustion is handled separately, but should still have a definition
				expect(effects).not.toBeNull();
				expect(effects.name).toBe(condition.name);
				expect(effects.icon).toBeDefined();
			});
		});
	});

	// ==========================================================================
	// Official 2014 Conditions - Effect Definitions Exist
	// ==========================================================================
	describe("Official 2014 Conditions - Effect Definitions", () => {
		OFFICIAL_CONDITIONS_2014.forEach(condition => {
			it(`should have effect definition for ${condition.name} (2014)`, () => {
				const effects = CharacterSheetState.getConditionEffects(condition.name);
				expect(effects).not.toBeNull();
				expect(effects.name).toBe(condition.name);
			});
		});
	});

	// ==========================================================================
	// Condition Effects - Blinded
	// ==========================================================================
	describe("Blinded Condition Effects", () => {
		beforeEach(() => {
			state.addCondition({name: "Blinded", source: "XPHB"});
		});

		it("should create an active state for Blinded", () => {
			const conditionStates = state.getConditionStates();
			expect(conditionStates.length).toBeGreaterThan(0);
			expect(conditionStates.some(s => s.conditionName === "Blinded")).toBe(true);
		});

		it("should have disadvantage on attack effects", () => {
			const effects = state.getActiveStateEffects();
			const attackDisadvantage = effects.find(e => e.type === "disadvantage" && e.target === "attack");
			expect(attackDisadvantage).toBeDefined();
		});

		it("should have advantage on attacks against effects", () => {
			const effects = state.getActiveStateEffects();
			const attacksAgainstAdvantage = effects.find(e => e.type === "advantage" && e.target === "attacksAgainst");
			expect(attacksAgainstAdvantage).toBeDefined();
		});

		it("should have auto-fail sight checks effect", () => {
			const effects = state.getActiveStateEffects();
			const autoFailSight = effects.find(e => e.type === "autoFail" && e.target === "check:sight");
			expect(autoFailSight).toBeDefined();
		});

		it("should remove effects when condition is removed", () => {
			state.removeCondition({name: "Blinded", source: "XPHB"});
			const conditionStates = state.getConditionStates();
			expect(conditionStates.some(s => s.conditionName === "Blinded")).toBe(false);
		});
	});

	// ==========================================================================
	// Condition Effects - Grappled
	// ==========================================================================
	describe("Grappled Condition Effects", () => {
		beforeEach(() => {
			state.addCondition({name: "Grappled", source: "XPHB"});
		});

		it("should set speed to 0", () => {
			const effects = state.getActiveStateEffects();
			const speedZero = effects.find(e => e.type === "setSpeed" && e.value === 0);
			expect(speedZero).toBeDefined();
		});

		it("should affect speed multiplier", () => {
			const multiplier = state.getSpeedMultiplierFromConditions();
			expect(multiplier).toBe(0);
		});
	});

	// ==========================================================================
	// Condition Effects - Paralyzed
	// ==========================================================================
	describe("Paralyzed Condition Effects", () => {
		beforeEach(() => {
			state.addCondition({name: "Paralyzed", source: "XPHB"});
		});

		it("should set incapacitated", () => {
			expect(state.isIncapacitated()).toBe(true);
		});

		it("should set speed to 0", () => {
			const effects = state.getActiveStateEffects();
			const speedZero = effects.find(e => e.type === "setSpeed" && e.value === 0);
			expect(speedZero).toBeDefined();
		});

		it("should auto-fail STR saves", () => {
			const effects = state.getActiveStateEffects();
			const autoFailStr = effects.find(e => e.type === "autoFail" && e.target === "save:str");
			expect(autoFailStr).toBeDefined();
		});

		it("should auto-fail DEX saves", () => {
			const effects = state.getActiveStateEffects();
			const autoFailDex = effects.find(e => e.type === "autoFail" && e.target === "save:dex");
			expect(autoFailDex).toBeDefined();
		});

		it("should have advantage on attacks against", () => {
			const effects = state.getActiveStateEffects();
			const attacksAgainstAdvantage = effects.find(e => e.type === "advantage" && e.target === "attacksAgainst");
			expect(attacksAgainstAdvantage).toBeDefined();
		});

		it("should check for auto-fail with helper method", () => {
			expect(state.hasAutoFailFromConditions("save:str")).toBe(true);
			expect(state.hasAutoFailFromConditions("save:dex")).toBe(true);
			expect(state.hasAutoFailFromConditions("save:wis")).toBe(false);
		});
	});

	// ==========================================================================
	// Condition Effects - Poisoned
	// ==========================================================================
	describe("Poisoned Condition Effects", () => {
		beforeEach(() => {
			state.addCondition({name: "Poisoned", source: "XPHB"});
		});

		it("should have disadvantage on attack rolls", () => {
			const effects = state.getActiveStateEffects();
			const attackDisadvantage = effects.find(e => e.type === "disadvantage" && e.target === "attack");
			expect(attackDisadvantage).toBeDefined();
		});

		it("should have disadvantage on ability checks", () => {
			const effects = state.getActiveStateEffects();
			const checkDisadvantage = effects.find(e => e.type === "disadvantage" && e.target === "check");
			expect(checkDisadvantage).toBeDefined();
		});
	});

	// ==========================================================================
	// Condition Effects - Prone
	// ==========================================================================
	describe("Prone Condition Effects", () => {
		beforeEach(() => {
			state.addCondition({name: "Prone", source: "XPHB"});
		});

		it("should have disadvantage on attack rolls", () => {
			const effects = state.getActiveStateEffects();
			const attackDisadvantage = effects.find(e => e.type === "disadvantage" && e.target === "attack");
			expect(attackDisadvantage).toBeDefined();
		});

		it("should have advantage on melee attacks against", () => {
			const effects = state.getActiveStateEffects();
			const meleeAdvantage = effects.find(e => e.type === "advantage" && e.target === "meleeAttacksAgainst");
			expect(meleeAdvantage).toBeDefined();
		});

		it("should have disadvantage on ranged attacks against", () => {
			const effects = state.getActiveStateEffects();
			const rangedDisadvantage = effects.find(e => e.type === "disadvantage" && e.target === "rangedAttacksAgainst");
			expect(rangedDisadvantage).toBeDefined();
		});
	});

	// ==========================================================================
	// Condition Effects - Restrained
	// ==========================================================================
	describe("Restrained Condition Effects", () => {
		beforeEach(() => {
			state.addCondition({name: "Restrained", source: "XPHB"});
		});

		it("should set speed to 0", () => {
			const multiplier = state.getSpeedMultiplierFromConditions();
			expect(multiplier).toBe(0);
		});

		it("should have disadvantage on attack rolls", () => {
			const effects = state.getActiveStateEffects();
			const attackDisadvantage = effects.find(e => e.type === "disadvantage" && e.target === "attack");
			expect(attackDisadvantage).toBeDefined();
		});

		it("should have advantage on attacks against", () => {
			const effects = state.getActiveStateEffects();
			const attacksAgainstAdvantage = effects.find(e => e.type === "advantage" && e.target === "attacksAgainst");
			expect(attacksAgainstAdvantage).toBeDefined();
		});

		it("should have disadvantage on DEX saves", () => {
			const effects = state.getActiveStateEffects();
			const dexSaveDisadvantage = effects.find(e => e.type === "disadvantage" && e.target === "save:dex");
			expect(dexSaveDisadvantage).toBeDefined();
		});
	});

	// ==========================================================================
	// Condition Effects - Stunned
	// ==========================================================================
	describe("Stunned Condition Effects", () => {
		beforeEach(() => {
			state.addCondition({name: "Stunned", source: "XPHB"});
		});

		it("should set incapacitated", () => {
			expect(state.isIncapacitated()).toBe(true);
		});

		it("should set speed to 0", () => {
			const multiplier = state.getSpeedMultiplierFromConditions();
			expect(multiplier).toBe(0);
		});

		it("should auto-fail STR and DEX saves", () => {
			expect(state.hasAutoFailFromConditions("save:str")).toBe(true);
			expect(state.hasAutoFailFromConditions("save:dex")).toBe(true);
		});
	});

	// ==========================================================================
	// Condition Effects - Unconscious
	// ==========================================================================
	describe("Unconscious Condition Effects", () => {
		beforeEach(() => {
			state.addCondition({name: "Unconscious", source: "XPHB"});
		});

		it("should set incapacitated", () => {
			expect(state.isIncapacitated()).toBe(true);
		});

		it("should set speed to 0", () => {
			const multiplier = state.getSpeedMultiplierFromConditions();
			expect(multiplier).toBe(0);
		});

		it("should auto-fail STR and DEX saves", () => {
			expect(state.hasAutoFailFromConditions("save:str")).toBe(true);
			expect(state.hasAutoFailFromConditions("save:dex")).toBe(true);
		});

		it("should have advantage on attacks against", () => {
			const effects = state.getActiveStateEffects();
			const attacksAgainstAdvantage = effects.find(e => e.type === "advantage" && e.target === "attacksAgainst");
			expect(attacksAgainstAdvantage).toBeDefined();
		});
	});

	// ==========================================================================
	// Condition Effects - Invisible
	// ==========================================================================
	describe("Invisible Condition Effects", () => {
		beforeEach(() => {
			state.addCondition({name: "Invisible", source: "XPHB"});
		});

		it("should have advantage on attack rolls", () => {
			const effects = state.getActiveStateEffects();
			const attackAdvantage = effects.find(e => e.type === "advantage" && e.target === "attack");
			expect(attackAdvantage).toBeDefined();
		});

		it("should have disadvantage on attacks against", () => {
			const effects = state.getActiveStateEffects();
			const attacksAgainstDisadvantage = effects.find(e => e.type === "disadvantage" && e.target === "attacksAgainst");
			expect(attacksAgainstDisadvantage).toBeDefined();
		});
	});

	// ==========================================================================
	// Condition Effects - Petrified
	// ==========================================================================
	describe("Petrified Condition Effects", () => {
		beforeEach(() => {
			state.addCondition({name: "Petrified", source: "XPHB"});
		});

		it("should set incapacitated", () => {
			expect(state.isIncapacitated()).toBe(true);
		});

		it("should have resistance to all damage", () => {
			const effects = state.getActiveStateEffects();
			const resistance = effects.find(e => e.type === "resistance" && e.target === "damage:all");
			expect(resistance).toBeDefined();
		});

		it("should have immunity to poison damage", () => {
			const effects = state.getActiveStateEffects();
			const poisonImmunity = effects.find(e => e.type === "immunity" && e.target === "damage:poison");
			expect(poisonImmunity).toBeDefined();
		});
	});

	// ==========================================================================
	// Condition Effects - Frightened
	// ==========================================================================
	describe("Frightened Condition Effects", () => {
		beforeEach(() => {
			state.addCondition({name: "Frightened", source: "XPHB"});
		});

		it("should have conditional disadvantage on attacks", () => {
			const effects = state.getActiveStateEffects();
			const attackDisadvantage = effects.find(e =>
				e.type === "disadvantage"
				&& e.target === "attack"
				&& e.condition,
			);
			expect(attackDisadvantage).toBeDefined();
		});

		it("should have conditional disadvantage on checks", () => {
			const effects = state.getActiveStateEffects();
			const checkDisadvantage = effects.find(e =>
				e.type === "disadvantage"
				&& e.target === "check"
				&& e.condition,
			);
			expect(checkDisadvantage).toBeDefined();
		});
	});

	// ==========================================================================
	// Condition Effects - Charmed
	// ==========================================================================
	describe("Charmed Condition Effects", () => {
		beforeEach(() => {
			state.addCondition({name: "Charmed", source: "XPHB"});
		});

		it("should have a note about not attacking charmer", () => {
			const effects = state.getActiveStateEffects();
			const note = effects.find(e => e.type === "note");
			expect(note).toBeDefined();
			expect(note.value).toMatch(/cannot attack|charmer/i);
		});
	});

	// ==========================================================================
	// Condition Effects - Incapacitated
	// ==========================================================================
	describe("Incapacitated Condition Effects", () => {
		beforeEach(() => {
			state.addCondition({name: "Incapacitated", source: "XPHB"});
		});

		it("should have a note about not taking actions", () => {
			const effects = state.getActiveStateEffects();
			const note = effects.find(e => e.type === "note");
			expect(note).toBeDefined();
			expect(note.value).toMatch(/actions|reactions/i);
		});
	});

	// ==========================================================================
	// Condition Effects - Deafened
	// ==========================================================================
	describe("Deafened Condition Effects", () => {
		beforeEach(() => {
			state.addCondition({name: "Deafened", source: "XPHB"});
		});

		it("should auto-fail hearing checks", () => {
			const effects = state.getActiveStateEffects();
			const autoFailHearing = effects.find(e => e.type === "autoFail" && e.target === "check:hearing");
			expect(autoFailHearing).toBeDefined();
		});
	});

	// ==========================================================================
	// Multiple Conditions
	// ==========================================================================
	describe("Multiple Conditions", () => {
		it("should stack effects from multiple conditions", () => {
			state.addCondition({name: "Blinded", source: "XPHB"});
			state.addCondition({name: "Poisoned", source: "XPHB"});

			const effects = state.getActiveStateEffects();

			// Both should add disadvantage on attacks (counts once but from both sources)
			const attackDisadvantages = effects.filter(e => e.type === "disadvantage" && e.target === "attack");
			expect(attackDisadvantages.length).toBeGreaterThanOrEqual(2);
		});

		it("should combine speed-reducing conditions", () => {
			state.addCondition({name: "Grappled", source: "XPHB"});
			state.addCondition({name: "Restrained", source: "XPHB"});

			// Both set speed to 0
			const multiplier = state.getSpeedMultiplierFromConditions();
			expect(multiplier).toBe(0);
		});

		it("should combine incapacitating conditions", () => {
			state.addCondition({name: "Paralyzed", source: "XPHB"});
			state.addCondition({name: "Stunned", source: "XPHB"});

			expect(state.isIncapacitated()).toBe(true);
		});

		it("should remove only the specified condition", () => {
			state.addCondition({name: "Blinded", source: "XPHB"});
			state.addCondition({name: "Poisoned", source: "XPHB"});
			state.addCondition({name: "Frightened", source: "XPHB"});

			state.removeCondition({name: "Poisoned", source: "XPHB"});

			expect(state.hasCondition("Blinded")).toBe(true);
			expect(state.hasCondition("Poisoned")).toBe(false);
			expect(state.hasCondition("Frightened")).toBe(true);
		});
	});

	// ==========================================================================
	// Set Conditions (Batch Update)
	// ==========================================================================
	describe("Set Conditions (Batch Update)", () => {
		it("should replace all conditions", () => {
			state.addCondition({name: "Blinded", source: "XPHB"});
			state.addCondition({name: "Poisoned", source: "XPHB"});

			state.setConditions([
				{name: "Grappled", source: "XPHB"},
				{name: "Restrained", source: "XPHB"},
			]);

			expect(state.hasCondition("Blinded")).toBe(false);
			expect(state.hasCondition("Poisoned")).toBe(false);
			expect(state.hasCondition("Grappled")).toBe(true);
			expect(state.hasCondition("Restrained")).toBe(true);
		});

		it("should preserve existing conditions that are in new set", () => {
			state.addCondition({name: "Blinded", source: "XPHB"});
			state.addCondition({name: "Poisoned", source: "XPHB"});

			state.setConditions([
				{name: "Blinded", source: "XPHB"}, // Keep
				{name: "Grappled", source: "XPHB"}, // Add
			]);

			expect(state.hasCondition("Blinded")).toBe(true);
			expect(state.hasCondition("Poisoned")).toBe(false);
			expect(state.hasCondition("Grappled")).toBe(true);
		});
	});

	// ==========================================================================
	// Slowed Condition (2024)
	// ==========================================================================
	describe("Slowed Condition (2024)", () => {
		beforeEach(() => {
			state.addCondition({name: "Slowed", source: "XPHB"});
		});

		it("should have effect definition for Slowed", () => {
			const effects = CharacterSheetState.getConditionEffects("Slowed");
			expect(effects).not.toBeNull();
		});

		it("should halve speed (0.5 multiplier)", () => {
			const effects = state.getActiveStateEffects();
			const speedMultiplier = effects.find(e => e.type === "speedMultiplier");
			expect(speedMultiplier).toBeDefined();
			expect(speedMultiplier.value).toBe(0.5);
		});

		it("should have -2 to AC", () => {
			const effects = state.getActiveStateEffects();
			const acPenalty = effects.find(e => e.type === "bonus" && e.target === "ac" && e.value === -2);
			expect(acPenalty).toBeDefined();
		});

		it("should have -2 to DEX saves", () => {
			const effects = state.getActiveStateEffects();
			const dexSavePenalty = effects.find(e => e.type === "bonus" && e.target === "save:dex" && e.value === -2);
			expect(dexSavePenalty).toBeDefined();
		});
	});

	// ==========================================================================
	// Custom/Homebrew Conditions
	// ==========================================================================
	describe("Custom/Homebrew Conditions", () => {
		it("should register a custom condition", () => {
			CharacterSheetState.registerCustomCondition("Weakened", {
				name: "Weakened",
				icon: "💔",
				description: "Deals half damage",
				effects: [
					{type: "damageMultiplier", target: "all", value: 0.5},
				],
				source: "HB",
			});

			const effects = CharacterSheetState.getConditionEffects("Weakened");
			expect(effects).not.toBeNull();
			expect(effects.name).toBe("Weakened");
			expect(effects.icon).toBe("💔");
		});

		it("should apply custom condition effects", () => {
			CharacterSheetState.registerCustomCondition("Hexed", {
				name: "Hexed",
				icon: "🔮",
				description: "Disadvantage on ability checks of a chosen type",
				effects: [
					{type: "disadvantage", target: "check:str"},
				],
				source: "HB",
			});

			state.addCondition({name: "Hexed", source: "HB"});

			const conditionStates = state.getConditionStates();
			expect(conditionStates.some(s => s.conditionName === "Hexed")).toBe(true);
		});

		it("should handle unknown conditions gracefully", () => {
			// Adding an unknown condition should not throw
			expect(() => {
				state.addCondition({name: "TotallyMadeUp", source: "HB"});
			}).not.toThrow();

			// Condition should still be tracked
			expect(state.hasCondition("TotallyMadeUp")).toBe(true);
		});
	});

	// ==========================================================================
	// Condition State Integration
	// ==========================================================================
	describe("Condition State Integration", () => {
		it("should create condition states with proper structure", () => {
			state.addCondition({name: "Blinded", source: "XPHB"});

			const conditionStates = state.getConditionStates();
			expect(conditionStates.length).toBeGreaterThan(0);

			const blindedState = conditionStates.find(s => s.conditionName === "Blinded");
			expect(blindedState).toBeDefined();
			expect(blindedState.isCondition).toBe(true);
			expect(blindedState.conditionSource).toBe("XPHB");
			expect(blindedState.active).toBe(true);
		});

		it("should include condition effects in active state effects", () => {
			state.addCondition({name: "Blinded", source: "XPHB"});

			const effects = state.getActiveStateEffects();
			expect(effects.length).toBeGreaterThan(0);
		});

		it("should distinguish between condition states and other active states", () => {
			state.addCondition({name: "Blinded", source: "XPHB"});

			// Add a non-condition active state
			state.addActiveState("dodge", {name: "Dodging"});

			const conditionStates = state.getConditionStates();
			const allActiveStates = state.getActiveStates();

			// Condition states should only include conditions
			expect(conditionStates.every(s => s.isCondition)).toBe(true);

			// All active states should include both
			expect(allActiveStates.length).toBeGreaterThan(conditionStates.length);
		});
	});

	// ==========================================================================
	// Condition Normalization
	// ==========================================================================
	describe("Condition Normalization", () => {
		it("should normalize string conditions to object format", () => {
			state.addCondition("Blinded");
			const conditions = state.getConditions();
			expect(conditions[0]).toEqual({name: "Blinded", source: "XPHB"});
		});

		it("should handle case-insensitive condition checks", () => {
			state.addCondition({name: "Blinded", source: "XPHB"});
			expect(state.hasCondition("blinded")).toBe(true);
			expect(state.hasCondition("BLINDED")).toBe(true);
			expect(state.hasCondition("Blinded")).toBe(true);
		});

		it("should remove conditions case-insensitively", () => {
			state.addCondition({name: "Blinded", source: "XPHB"});
			state.removeCondition({name: "blinded", source: "XPHB"});
			expect(state.hasCondition("Blinded")).toBe(false);
		});
	});

	// ==========================================================================
	// All Official Conditions Integration Test
	// ==========================================================================
	describe("All Official Conditions Integration", () => {
		it("should be able to add all official 2024 conditions", () => {
			OFFICIAL_CONDITIONS_2024.forEach(condition => {
				state.addCondition(condition);
			});

			const conditions = state.getConditions();
			expect(conditions.length).toBe(OFFICIAL_CONDITIONS_2024.length);
		});

		it("should be able to clear all conditions and verify state is clean", () => {
			OFFICIAL_CONDITIONS_2024.forEach(condition => {
				state.addCondition(condition);
			});

			state.clearConditions();

			expect(state.getConditions().length).toBe(0);
			expect(state.getConditionStates().length).toBe(0);
		});

		it("every official condition should have defined effects", () => {
			const missingEffects = [];

			OFFICIAL_CONDITIONS_2024.forEach(condition => {
				const effects = CharacterSheetState.getConditionEffects(condition.name);
				if (!effects) {
					missingEffects.push(condition.name);
				}
			});

			expect(missingEffects).toEqual([]);
		});
	});

	// ==========================================================================
	// Exhaustion (Special Handling)
	// ==========================================================================
	describe("Exhaustion Condition (Special Handling)", () => {
		it("should have Exhaustion in condition effects for tracking", () => {
			const effects = CharacterSheetState.getConditionEffects("Exhaustion");
			expect(effects).not.toBeNull();
			expect(effects.name).toBe("Exhaustion");
		});

		it("should note that exhaustion is handled separately", () => {
			const effects = CharacterSheetState.getConditionEffects("Exhaustion");
			// Exhaustion has empty effects array because it's tracked via levels
			expect(effects.effects).toBeDefined();
		});

		it("should track exhaustion levels separately from conditions", () => {
			state.setExhaustion(3);
			expect(state.getExhaustion()).toBe(3);

			// Adding exhaustion as a condition should still work for tracking
			state.addCondition({name: "Exhaustion", source: "XPHB"});
			expect(state.hasCondition("Exhaustion")).toBe(true);

			// But levels are tracked separately
			expect(state.getExhaustion()).toBe(3);
		});
	});

	// ==========================================================================
	// Condition Effects on Character Stats
	// ==========================================================================
	describe("Condition Effects on Character Stats", () => {
		it("should affect speed calculation with Grappled", () => {
			// First check normal speed
			const baseSpeed = state.getWalkSpeed();
			expect(baseSpeed).toBeGreaterThan(0);

			// Add grappled
			state.addCondition({name: "Grappled", source: "XPHB"});

			// Speed multiplier should be 0
			const multiplier = state.getSpeedMultiplierFromConditions();
			expect(multiplier).toBe(0);
		});

		it("should stack speed effects from multiple conditions", () => {
			// Add multiple speed-reducing conditions
			state.addCondition({name: "Grappled", source: "XPHB"});
			state.addCondition({name: "Restrained", source: "XPHB"});

			// Both set speed to 0, result should still be 0
			const multiplier = state.getSpeedMultiplierFromConditions();
			expect(multiplier).toBe(0);
		});

		it("should get speed bonus from active states", () => {
			// Add an active state with speed bonus (like some features)
			state.addActiveState("custom", {
				name: "Test Speed State",
				customEffects: [{type: "bonus", target: "speed", value: 10}],
			});

			const speedBonus = state.getSpeedBonusFromStates();
			expect(speedBonus).toBe(10);
		});

		it("should correctly identify auto-fail for saves", () => {
			// No conditions - no auto-fails
			expect(state.hasAutoFailFromConditions("save:str")).toBe(false);
			expect(state.hasAutoFailFromConditions("save:dex")).toBe(false);

			// Add paralyzed
			state.addCondition({name: "Paralyzed", source: "XPHB"});

			// Now should auto-fail STR and DEX
			expect(state.hasAutoFailFromConditions("save:str")).toBe(true);
			expect(state.hasAutoFailFromConditions("save:dex")).toBe(true);
			// But not other saves
			expect(state.hasAutoFailFromConditions("save:con")).toBe(false);
			expect(state.hasAutoFailFromConditions("save:wis")).toBe(false);
		});

		it("should correctly track incapacitated status", () => {
			// No conditions
			expect(state.isIncapacitated()).toBe(false);

			// Add incapacitating condition
			state.addCondition({name: "Stunned", source: "XPHB"});
			expect(state.isIncapacitated()).toBe(true);

			// Remove it
			state.removeCondition({name: "Stunned", source: "XPHB"});
			expect(state.isIncapacitated()).toBe(false);
		});
	});

	// ==========================================================================
	// Condition Parsing from Entries
	// ==========================================================================
	describe("Condition Parsing from Entries", () => {
		it("should parse speed 0 from condition text", () => {
			const conditionData = {
				name: "TestCondition",
				entries: ["Your speed is 0."],
			};

			const parsed = CharacterSheetState.parseConditionFromEntries(conditionData);
			const speedZero = parsed.effects.find(e => e.type === "setSpeed" && e.value === 0);
			expect(speedZero).toBeDefined();
		});

		it("should parse disadvantage on attacks from condition text", () => {
			const conditionData = {
				name: "TestCondition",
				entries: ["Your attack rolls have disadvantage."],
			};

			const parsed = CharacterSheetState.parseConditionFromEntries(conditionData);
			const attackDisadvantage = parsed.effects.find(e => e.type === "disadvantage" && e.target === "attack");
			expect(attackDisadvantage).toBeDefined();
		});

		it("should parse advantage on attacks against from condition text", () => {
			const conditionData = {
				name: "TestCondition",
				entries: ["Attack rolls against you have advantage."],
			};

			const parsed = CharacterSheetState.parseConditionFromEntries(conditionData);
			const attacksAgainstAdvantage = parsed.effects.find(e => e.type === "advantage" && e.target === "attacksAgainst");
			expect(attacksAgainstAdvantage).toBeDefined();
		});

		it("should parse auto-fail STR and DEX saves from condition text", () => {
			const conditionData = {
				name: "TestCondition",
				entries: ["You automatically fail Strength and Dexterity saving throws."],
			};

			const parsed = CharacterSheetState.parseConditionFromEntries(conditionData);
			const autoFailStr = parsed.effects.find(e => e.type === "autoFail" && e.target === "save:str");
			const autoFailDex = parsed.effects.find(e => e.type === "autoFail" && e.target === "save:dex");
			expect(autoFailStr).toBeDefined();
			expect(autoFailDex).toBeDefined();
		});

		it("should parse disadvantage on ability checks from condition text", () => {
			const conditionData = {
				name: "TestCondition",
				entries: ["You have disadvantage on ability checks."],
			};

			const parsed = CharacterSheetState.parseConditionFromEntries(conditionData);
			const checkDisadvantage = parsed.effects.find(e => e.type === "disadvantage" && e.target === "check");
			expect(checkDisadvantage).toBeDefined();
		});

		it("should parse halved speed from condition text", () => {
			const conditionData = {
				name: "TestCondition",
				entries: ["Your speed is halved."],
			};

			const parsed = CharacterSheetState.parseConditionFromEntries(conditionData);
			const speedHalved = parsed.effects.find(e => e.type === "speedMultiplier" && e.value === 0.5);
			expect(speedHalved).toBeDefined();
		});
	});

	// ==========================================================================
	// Homebrew Condition Support
	// ==========================================================================
	describe("Homebrew Condition Support", () => {
		it("should support registering conditions from homebrew sources", () => {
			// Note: "Dazed" is now a built-in TGTT condition, so we test with a custom name
			CharacterSheetState.registerCustomCondition("Bewildered", {
				name: "Bewildered",
				icon: "😵",
				description: "You can take only one Action or Bonus Action on your turn.",
				effects: [
					{type: "note", value: "Can take only one Action or Bonus Action per turn"},
				],
				source: "HB",
			});

			const effects = CharacterSheetState.getConditionEffects("Bewildered");
			expect(effects).not.toBeNull();
			expect(effects.source).toBe("HB");
		});

		it("should support conditions with complex effects", () => {
			CharacterSheetState.registerCustomCondition("Marked", {
				name: "Marked",
				icon: "🎯",
				description: "Attacks against you have advantage, you have disadvantage on attacks against other targets",
				effects: [
					{type: "advantage", target: "attacksAgainst"},
					{type: "disadvantage", target: "attack", condition: "against targets other than the marker"},
				],
				source: "HB",
			});

			state.addCondition({name: "Marked", source: "HB"});

			const effects = state.getActiveStateEffects();
			const attacksAgainstAdvantage = effects.find(e => e.type === "advantage" && e.target === "attacksAgainst");
			expect(attacksAgainstAdvantage).toBeDefined();
		});

		it("should not override built-in conditions", () => {
			// Try to register a condition with same name as built-in
			CharacterSheetState.registerCustomCondition("Blinded", {
				name: "Blinded",
				icon: "🙈",
				description: "Homebrew blinded",
				effects: [{type: "note", value: "Homebrew effect"}],
				source: "HB",
			});

			// getConditionEffects should return built-in first
			const effects = CharacterSheetState.getConditionEffects("Blinded");
			expect(effects.icon).toBe("👁️‍🗨️"); // Built-in icon, not homebrew
		});

		it("should track homebrew conditions separately by source", () => {
			CharacterSheetState.registerCustomCondition("Cursed", {
				name: "Cursed",
				icon: "☠️",
				description: "A homebrew curse",
				effects: [{type: "disadvantage", target: "check"}],
				source: "MyHomebrew",
			});

			state.addCondition({name: "Cursed", source: "MyHomebrew"});

			// Should have the condition
			expect(state.hasCondition("Cursed")).toBe(true);

			// Should have exact match with source
			const conditions = state.getConditions();
			const cursed = conditions.find(c => c.name === "Cursed");
			expect(cursed).toBeDefined();
		});
	});

	// ==========================================================================
	// Silenced Condition (Common Homebrew/Variant)
	// ==========================================================================
	describe("Silenced Condition", () => {
		beforeEach(() => {
			state.addCondition({name: "Silenced", source: "HB"});
		});

		it("should have effect definition for Silenced", () => {
			const effects = CharacterSheetState.getConditionEffects("Silenced");
			expect(effects).not.toBeNull();
		});

		it("should have a note about verbal components", () => {
			const effects = state.getActiveStateEffects();
			const note = effects.find(e => e.type === "note");
			expect(note).toBeDefined();
		});

		it("should have cantCast restriction for verbal spells", () => {
			const effects = state.getActiveStateEffects();
			const cantCast = effects.find(e => e.type === "cantCast" && e.target === "verbal");
			expect(cantCast).toBeDefined();
		});
	});

	// ==========================================================================
	// Condition Icon and Display
	// ==========================================================================
	describe("Condition Icons and Display", () => {
		it("each condition should have a unique icon", () => {
			const icons = new Set();

			OFFICIAL_CONDITIONS_2024.forEach(condition => {
				const def = CharacterSheetState.getConditionEffects(condition.name);
				if (def) {
					icons.add(def.icon);
				}
			});

			// Most conditions should have unique icons (some may share)
			expect(icons.size).toBeGreaterThan(10);
		});

		it("each condition should have a description", () => {
			OFFICIAL_CONDITIONS_2024.forEach(condition => {
				const def = CharacterSheetState.getConditionEffects(condition.name);
				if (def && condition.name !== "Exhaustion") {
					expect(def.description).toBeDefined();
					expect(def.description.length).toBeGreaterThan(0);
				}
			});
		});
	});

	// ==========================================================================
	// TGTT (Traveler's Guide to Thelemar) Conditions
	// ==========================================================================
	describe("TGTT Conditions", () => {
		describe("Dazed Condition (TGTT-specific)", () => {
			it("should have definition for Dazed", () => {
				const def = CharacterSheetState.getConditionEffects("Dazed");
				expect(def).toBeDefined();
				expect(def.name).toBe("Dazed");
				expect(def.source).toBe("TGTT");
			});

			it("should include action economy restriction note", () => {
				const def = CharacterSheetState.getConditionEffects("Dazed");
				const notes = def.effects.filter(e => e.type === "note");
				expect(notes.some(n => n.value.includes("Move or Action"))).toBe(true);
			});

			it("should include no bonus actions note", () => {
				const def = CharacterSheetState.getConditionEffects("Dazed");
				const notes = def.effects.filter(e => e.type === "note");
				expect(notes.some(n => n.value.includes("Bonus Action"))).toBe(true);
			});

			it("should include no reactions note", () => {
				const def = CharacterSheetState.getConditionEffects("Dazed");
				const notes = def.effects.filter(e => e.type === "note");
				expect(notes.some(n => n.value.includes("Reaction"))).toBe(true);
			});

			it("should apply Dazed effects when added", () => {
				state.addCondition({name: "Dazed", source: "TGTT"});
				expect(state.hasCondition("Dazed")).toBe(true);

				const effects = state.getActiveStateEffects();
				const actionEconomy = effects.find(e => e.type === "actionEconomy");
				expect(actionEconomy).toBeDefined();
			});
		});

		describe("Choked Condition (TGTT-specific)", () => {
			it("should have definition for Choked", () => {
				const def = CharacterSheetState.getConditionEffects("Choked");
				expect(def).toBeDefined();
				expect(def.name).toBe("Choked");
				expect(def.source).toBe("TGTT");
			});

			it("should include verbal spell constraint", () => {
				const def = CharacterSheetState.getConditionEffects("Choked");
				const verbalConstraint = def.effects.find(e => e.type === "verbalConstraint");
				expect(verbalConstraint).toBeDefined();
				expect(verbalConstraint.value).toBe("check");
			});

			it("should include breath holding note", () => {
				const def = CharacterSheetState.getConditionEffects("Choked");
				const notes = def.effects.filter(e => e.type === "note");
				expect(notes.some(n => n.value.includes("breath") || n.value.includes("Breath"))).toBe(true);
			});

			it("should apply Choked effects when added", () => {
				state.addCondition({name: "Choked", source: "TGTT"});
				expect(state.hasCondition("Choked")).toBe(true);

				const effects = state.getActiveStateEffects();
				const verbalConstraint = effects.find(e => e.type === "verbalConstraint");
				expect(verbalConstraint).toBeDefined();
			});
		});

		describe("TGTT Grappled (with somatic constraint)", () => {
			it("should use TGTT version when source is TGTT", () => {
				const def = CharacterSheetState.getConditionEffects("Grappled", "TGTT");
				expect(def).toBeDefined();
				expect(def.source).toBe("TGTT");
			});

			it("should include somatic spell constraint", () => {
				const def = CharacterSheetState.getConditionEffects("Grappled", "TGTT");
				const somaticConstraint = def.effects.find(e => e.type === "somaticConstraint");
				expect(somaticConstraint).toBeDefined();
				expect(somaticConstraint.value).toBe("check");
			});

			it("should still set speed to 0", () => {
				const def = CharacterSheetState.getConditionEffects("Grappled", "TGTT");
				const setSpeed = def.effects.find(e => e.type === "setSpeed");
				expect(setSpeed).toBeDefined();
				expect(setSpeed.value).toBe(0);
			});

			it("should apply TGTT effects when added with TGTT source", () => {
				state.addCondition({name: "Grappled", source: "TGTT"});

				const effects = state.getActiveStateEffects();
				const somaticConstraint = effects.find(e => e.type === "somaticConstraint");
				expect(somaticConstraint).toBeDefined();
			});
		});

		describe("TGTT Restrained (with somatic ban)", () => {
			it("should use TGTT version when source is TGTT", () => {
				const def = CharacterSheetState.getConditionEffects("Restrained", "TGTT");
				expect(def).toBeDefined();
				expect(def.source).toBe("TGTT");
			});

			it("should ban somatic spells entirely", () => {
				const def = CharacterSheetState.getConditionEffects("Restrained", "TGTT");
				const somaticConstraint = def.effects.find(e => e.type === "somaticConstraint");
				expect(somaticConstraint).toBeDefined();
				expect(somaticConstraint.value).toBe("banned");
			});

			it("should include all standard restrained effects", () => {
				const def = CharacterSheetState.getConditionEffects("Restrained", "TGTT");

				const setSpeed = def.effects.find(e => e.type === "setSpeed");
				expect(setSpeed).toBeDefined();

				const attackDisadv = def.effects.find(e => e.type === "disadvantage" && e.target === "attack");
				expect(attackDisadv).toBeDefined();

				const dexSaveDisadv = def.effects.find(e => e.type === "disadvantage" && e.target === "save:dex");
				expect(dexSaveDisadv).toBeDefined();
			});
		});

		describe("TGTT Frightened (with verbal constraint)", () => {
			it("should use TGTT version when source is TGTT", () => {
				const def = CharacterSheetState.getConditionEffects("Frightened", "TGTT");
				expect(def).toBeDefined();
				expect(def.source).toBe("TGTT");
			});

			it("should include verbal spell constraint", () => {
				const def = CharacterSheetState.getConditionEffects("Frightened", "TGTT");
				const verbalConstraint = def.effects.find(e => e.type === "verbalConstraint");
				expect(verbalConstraint).toBeDefined();
				expect(verbalConstraint.value).toBe("check");
			});
		});

		describe("TGTT Poisoned (with concentration disadvantage)", () => {
			it("should use TGTT version when source is TGTT", () => {
				const def = CharacterSheetState.getConditionEffects("Poisoned", "TGTT");
				expect(def).toBeDefined();
				expect(def.source).toBe("TGTT");
			});

			it("should include concentration save disadvantage", () => {
				const def = CharacterSheetState.getConditionEffects("Poisoned", "TGTT");
				const concDisadv = def.effects.find(e =>
					e.type === "disadvantage" && e.target?.includes("concentration"),
				);
				expect(concDisadv).toBeDefined();
			});

			it("should still have attack and check disadvantage", () => {
				const def = CharacterSheetState.getConditionEffects("Poisoned", "TGTT");
				const attackDisadv = def.effects.find(e => e.type === "disadvantage" && e.target === "attack");
				const checkDisadv = def.effects.find(e => e.type === "disadvantage" && e.target === "check");
				expect(attackDisadv).toBeDefined();
				expect(checkDisadv).toBeDefined();
			});
		});

		describe("TGTT Slowed (different from 2024)", () => {
			it("should use TGTT version when source is TGTT", () => {
				const def = CharacterSheetState.getConditionEffects("Slowed", "TGTT");
				expect(def).toBeDefined();
				expect(def.source).toBe("TGTT");
			});

			it("should give attacks against advantage (not AC penalty like 2024)", () => {
				const def = CharacterSheetState.getConditionEffects("Slowed", "TGTT");
				const attacksAgainstAdv = def.effects.find(e =>
					e.type === "advantage" && e.target === "attacksAgainst",
				);
				expect(attacksAgainstAdv).toBeDefined();

				// Should NOT have the 2024-style AC penalty
				const acPenalty = def.effects.find(e =>
					e.type === "bonus" && e.target === "ac",
				);
				expect(acPenalty).toBeUndefined();
			});

			it("should have speed multiplier and DEX save disadvantage", () => {
				const def = CharacterSheetState.getConditionEffects("Slowed", "TGTT");
				const speedMult = def.effects.find(e => e.type === "speedMultiplier");
				const dexSaveDisadv = def.effects.find(e =>
					e.type === "disadvantage" && e.target === "save:dex",
				);
				expect(speedMult).toBeDefined();
				expect(dexSaveDisadv).toBeDefined();
			});
		});

		describe("TGTT Hidden (with combat advantages)", () => {
			it("should have definition for Hidden", () => {
				const def = CharacterSheetState.getConditionEffects("Hidden", "TGTT");
				expect(def).toBeDefined();
			});

			it("should grant attack advantage", () => {
				const def = CharacterSheetState.getConditionEffects("Hidden", "TGTT");
				const attackAdv = def.effects.find(e =>
					e.type === "advantage" && e.target === "attack",
				);
				expect(attackAdv).toBeDefined();
			});

			it("should grant disadvantage on attacks against", () => {
				const def = CharacterSheetState.getConditionEffects("Hidden", "TGTT");
				const attacksAgainstDisadv = def.effects.find(e =>
					e.type === "disadvantage" && e.target === "attacksAgainst",
				);
				expect(attacksAgainstDisadv).toBeDefined();
			});
		});

		describe("TGTT Undetected", () => {
			it("should have definition for Undetected", () => {
				const def = CharacterSheetState.getConditionEffects("Undetected");
				expect(def).toBeDefined();
				expect(def.name).toBe("Undetected");
			});
		});

		describe("Source-based condition selection", () => {
			it("should use standard Grappled when source is not TGTT", () => {
				const standardDef = CharacterSheetState.getConditionEffects("Grappled");
				const tgttDef = CharacterSheetState.getConditionEffects("Grappled", "TGTT");

				// Standard should not have somatic constraint
				const standardSomatic = standardDef.effects.find(e => e.type === "somaticConstraint");
				expect(standardSomatic).toBeUndefined();

				// TGTT should have somatic constraint
				const tgttSomatic = tgttDef.effects.find(e => e.type === "somaticConstraint");
				expect(tgttSomatic).toBeDefined();
			});

			it("should use standard Slowed when source is not TGTT", () => {
				const standardDef = CharacterSheetState.getConditionEffects("Slowed");
				const tgttDef = CharacterSheetState.getConditionEffects("Slowed", "TGTT");

				// Standard 2024 Slowed has AC penalty
				const standardAcBonus = standardDef.effects.find(e =>
					e.type === "bonus" && e.target === "ac",
				);
				expect(standardAcBonus).toBeDefined();

				// TGTT Slowed has advantage on attacks against
				const tgttAttacksAgainst = tgttDef.effects.find(e =>
					e.type === "advantage" && e.target === "attacksAgainst",
				);
				expect(tgttAttacksAgainst).toBeDefined();
			});
		});
	});
});
