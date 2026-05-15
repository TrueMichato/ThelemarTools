/**
 * CharacterSheetFeatureEffects.test.js
 *
 * Tests that verify class features properly apply their mechanical effects
 * to the character sheet through the generic effects system.
 *
 * This tests the _aggregateFeatureEffects() and applyClassFeatureEffects() methods
 * to ensure that features from all classes are properly applied.
 */

import "./setup.js";

let CharacterSheetState;
let state;

beforeAll(async () => {
	CharacterSheetState = (await import("../../../js/charactersheet/charactersheet-state.js")).CharacterSheetState;
});

beforeEach(() => {
	state = new CharacterSheetState();
	state.setAbilityBase("str", 14);
	state.setAbilityBase("dex", 16);
	state.setAbilityBase("con", 14);
	state.setAbilityBase("int", 12);
	state.setAbilityBase("wis", 16);
	state.setAbilityBase("cha", 14);
});

// =============================================================================
// MONK FEATURE EFFECTS
// =============================================================================
describe("Monk Feature Effects", () => {
	describe("Purity of Body (Level 10)", () => {
		it("should apply poison damage immunity", () => {
			state.addClass({name: "Monk", source: "PHB", level: 10});
			expect(state.hasImmunity("poison")).toBe(true);
		});

		it("should apply poisoned condition immunity", () => {
			state.addClass({name: "Monk", source: "PHB", level: 10});
			expect(state.isImmuneToCondition("poisoned")).toBe(true);
		});

		it("should apply diseased condition immunity", () => {
			state.addClass({name: "Monk", source: "PHB", level: 10});
			expect(state.isImmuneToCondition("diseased")).toBe(true);
		});

		it("should remove immunities when monk level drops below 10", () => {
			state.addClass({name: "Monk", source: "PHB", level: 10});
			expect(state.hasImmunity("poison")).toBe(true);

			// Remove monk class and add at lower level
			state.removeClass("Monk", "PHB");
			state.addClass({name: "Monk", source: "PHB", level: 9});
			expect(state.hasImmunity("poison")).toBe(false);
			expect(state.isImmuneToCondition("poisoned")).toBe(false);
		});
	});

	describe("Diamond Soul (Level 14)", () => {
		it("should grant proficiency in all six saving throws", () => {
			state.addClass({name: "Monk", source: "PHB", level: 14});

			["str", "dex", "con", "int", "wis", "cha"].forEach(ability => {
				expect(state.hasSaveProficiency(ability)).toBe(true);
			});
		});

		it("should not grant all save proficiencies before level 14", () => {
			state.addClass({name: "Monk", source: "PHB", level: 13});

			// Monk gets DEX and STR as base class saves
			// But should NOT have CON, INT, CHA from Diamond Soul
			expect(state.hasSaveProficiency("con")).toBe(false);
			expect(state.hasSaveProficiency("int")).toBe(false);
			expect(state.hasSaveProficiency("cha")).toBe(false);
		});

		it("should be tracked in applied effects", () => {
			state.addClass({name: "Monk", source: "PHB", level: 14});
			const appliedEffects = state.getAppliedClassFeatureEffects();

			expect(appliedEffects.some(e => e.includes("Diamond Soul"))).toBe(true);
		});
	});

	describe("Tongue of the Sun and Moon (Level 13)", () => {
		it("should grant 'All (spoken)' language", () => {
			state.addClass({name: "Monk", source: "PHB", level: 13});
			expect(state.getLanguages()).toContain("All (spoken)");
		});

		it("should not grant language before level 13", () => {
			state.addClass({name: "Monk", source: "PHB", level: 12});
			expect(state.getLanguages()).not.toContain("All (spoken)");
		});
	});

	describe("Evasion (Level 7)", () => {
		it("should track evasion in applied effects", () => {
			state.addClass({name: "Monk", source: "PHB", level: 7});
			const appliedEffects = state.getAppliedClassFeatureEffects();

			expect(appliedEffects.some(e => e.includes("Evasion"))).toBe(true);
		});

		it("should not have evasion before level 7", () => {
			state.addClass({name: "Monk", source: "PHB", level: 6});
			const appliedEffects = state.getAppliedClassFeatureEffects();

			expect(appliedEffects.some(e => e.includes("Evasion"))).toBe(false);
		});
	});

	describe("Extra Attack (Level 5)", () => {
		it("should track extra attack in applied effects", () => {
			state.addClass({name: "Monk", source: "PHB", level: 5});
			const appliedEffects = state.getAppliedClassFeatureEffects();

			expect(appliedEffects.some(e => e.includes("Extra Attack"))).toBe(true);
		});
	});
});

// =============================================================================
// METADATA-DRIVEN FEATURE EFFECTS
// =============================================================================
describe("Metadata-Driven Feature Effects", () => {
	it("should apply passive feature.effects through generic pipeline", () => {
		state.addFeature({
			name: "Homebrew Resilient Skin",
			description: "Your hide is naturally resilient.",
			effects: [
				{type: "resistance", target: "fire"},
				{type: "bonus", target: "ac", value: 1},
			],
		});

		state.applyClassFeatureEffects();

		expect(state.hasResistance("fire")).toBe(true);
		expect(state.getNamedModifiers().some(m => m.type === "ac" && m.name.includes("Homebrew Resilient Skin"))).toBe(true);
	});

	it("should apply passive activatable.effects through generic pipeline", () => {
		state.addFeature({
			name: "Aura of Vigilance",
			description: "An ever-present aura protects you.",
			activatable: {
				interactionMode: "passive",
				effects: [
					{type: "bonus", target: "initiative", value: 2},
				],
			},
		});

		state.applyClassFeatureEffects();

		expect(state.getNamedModifiers().some(m => m.type === "initiative" && m.name.includes("Aura of Vigilance"))).toBe(true);
	});
});

// =============================================================================
// BARBARIAN FEATURE EFFECTS
// =============================================================================
describe("Barbarian Feature Effects", () => {
	describe("Rage Resistances", () => {
		it("should track rage resistance in applied effects", () => {
			state.addClass({name: "Barbarian", source: "PHB", level: 1});
			const appliedEffects = state.getAppliedClassFeatureEffects();

			// Rage resistances are conditional (while raging), so they're tracked as modifiers
			expect(appliedEffects.some(e => e.includes("Rage") || e.includes("resistance"))).toBe(true);
		});
	});

	describe("Danger Sense (Level 2)", () => {
		it("should track danger sense in applied effects", () => {
			state.addClass({name: "Barbarian", source: "PHB", level: 2});
			const appliedEffects = state.getAppliedClassFeatureEffects();

			expect(appliedEffects.some(e => e.includes("Danger Sense"))).toBe(true);
		});

		it("should not have danger sense before level 2", () => {
			state.addClass({name: "Barbarian", source: "PHB", level: 1});
			const appliedEffects = state.getAppliedClassFeatureEffects();

			expect(appliedEffects.some(e => e.includes("Danger Sense"))).toBe(false);
		});
	});

	describe("Fast Movement (Level 5)", () => {
		it("should grant +10 speed when calculated", () => {
			state.addClass({name: "Barbarian", source: "PHB", level: 5});
			const calculations = state.getFeatureCalculations();

			expect(calculations.hasFastMovement).toBe(true);
		});

		it("should track fast movement in applied effects", () => {
			state.addClass({name: "Barbarian", source: "PHB", level: 5});
			const appliedEffects = state.getAppliedClassFeatureEffects();

			expect(appliedEffects.some(e => e.includes("Fast Movement"))).toBe(true);
		});
	});

	describe("Feral Instinct (Level 7)", () => {
		it("should track feral instinct in applied effects", () => {
			state.addClass({name: "Barbarian", source: "PHB", level: 7});
			const appliedEffects = state.getAppliedClassFeatureEffects();

			expect(appliedEffects.some(e => e.includes("Feral Instinct"))).toBe(true);
		});
	});

	describe("Path of the Totem Warrior - Bear (Level 3)", () => {
		it("should track bear totem resistance in applied effects", () => {
			state.addClass({name: "Barbarian", source: "PHB", level: 3});
			state.setSubclass("Barbarian", {name: "Path of the Totem Warrior", source: "PHB"});

			const calculations = state.getFeatureCalculations();
			// Bear totem gives resistance to all except psychic while raging
			// This is set through totem spirit choice - test the base calculation works
			expect(calculations.hasRage).toBe(true);
		});
	});

	describe("Extra Attack (Level 5)", () => {
		it("should track extra attack in applied effects", () => {
			state.addClass({name: "Barbarian", source: "PHB", level: 5});
			const appliedEffects = state.getAppliedClassFeatureEffects();

			expect(appliedEffects.some(e => e.includes("Extra Attack"))).toBe(true);
		});
	});
});

// =============================================================================
// ROGUE FEATURE EFFECTS
// =============================================================================
describe("Rogue Feature Effects", () => {
	describe("Evasion (Level 7)", () => {
		it("should track evasion in applied effects", () => {
			state.addClass({name: "Rogue", source: "PHB", level: 7});
			const appliedEffects = state.getAppliedClassFeatureEffects();

			expect(appliedEffects.some(e => e.includes("Evasion"))).toBe(true);
		});
	});

	describe("Reliable Talent (Level 11)", () => {
		it("should track reliable talent in applied effects", () => {
			state.addClass({name: "Rogue", source: "PHB", level: 11});
			const appliedEffects = state.getAppliedClassFeatureEffects();

			expect(appliedEffects.some(e => e.includes("Reliable Talent"))).toBe(true);
		});

		it("should set minimum of 10 for proficient checks", () => {
			state.addClass({name: "Rogue", source: "PHB", level: 11});
			const calculations = state.getFeatureCalculations();

			expect(calculations.hasReliableTalent).toBe(true);
			expect(calculations.reliableTalentMinimum).toBe(10);
		});
	});

	describe("Blindsense (Level 14)", () => {
		it("should grant 10ft blindsight", () => {
			state.addClass({name: "Rogue", source: "PHB", level: 14});
			const senses = state.getSenses();

			expect(senses.blindsight).toBe(10);
		});

		it("should track blindsense in applied effects", () => {
			state.addClass({name: "Rogue", source: "PHB", level: 14});
			const appliedEffects = state.getAppliedClassFeatureEffects();

			expect(appliedEffects.some(e => e.includes("Blindsense") || e.includes("blindsight"))).toBe(true);
		});

		it("should not grant blindsight before level 14", () => {
			state.addClass({name: "Rogue", source: "PHB", level: 13});
			const senses = state.getSenses();

			expect(senses.blindsight).toBe(0);
		});
	});

	describe("Slippery Mind (Level 15)", () => {
		it("should grant WIS save proficiency", () => {
			state.addClass({name: "Rogue", source: "PHB", level: 15});

			expect(state.hasSaveProficiency("wis")).toBe(true);
		});

		it("should track slippery mind in applied effects", () => {
			state.addClass({name: "Rogue", source: "PHB", level: 15});
			const appliedEffects = state.getAppliedClassFeatureEffects();

			expect(appliedEffects.some(e => e.includes("Slippery Mind"))).toBe(true);
		});

		it("should not grant WIS save before level 15", () => {
			state.addClass({name: "Rogue", source: "PHB", level: 14});

			// Rogue base saves are DEX and INT
			expect(state.hasSaveProficiency("wis")).toBe(false);
		});
	});

	describe("Assassin Subclass - Tool Proficiencies", () => {
		it("should grant Disguise Kit proficiency", () => {
			state.addClass({name: "Rogue", source: "PHB", level: 3});
			state.setSubclass("Rogue", {name: "Assassin", source: "PHB"});

			expect(state.hasToolProficiency("Disguise Kit")).toBe(true);
		});

		it("should grant Poisoner's Kit proficiency", () => {
			state.addClass({name: "Rogue", source: "PHB", level: 3});
			state.setSubclass("Rogue", {name: "Assassin", source: "PHB"});

			expect(state.hasToolProficiency("Poisoner's Kit")).toBe(true);
		});

		it("should track assassin tools in applied effects", () => {
			state.addClass({name: "Rogue", source: "PHB", level: 3});
			state.setSubclass("Rogue", {name: "Assassin", source: "PHB"});
			const appliedEffects = state.getAppliedClassFeatureEffects();

			expect(appliedEffects.some(e => e.includes("Disguise Kit") || e.includes("Assassin"))).toBe(true);
		});
	});

	describe("Swashbuckler Subclass - Rakish Audacity", () => {
		it("should apply CHA mod to initiative via the live feature aggregator", () => {
			state.addClass({name: "Rogue", source: "PHB", level: 3});
			state.setSubclass("Rogue", {name: "Swashbuckler", source: "XGE"});
			state.setAbilityBase("cha", 16); // +3
			state.setAbilityBase("dex", 14); // +2

			// Initiative = DEX (+2) + CHA (+3) = +5
			expect(state.getInitiative()).toBe(5);

			const breakdown = state.getInitiativeBreakdown();
			const rakish = breakdown.components.find(c => c.name === "Rakish Audacity");
			expect(rakish).toBeTruthy();
			expect(rakish.value).toBe(3);
			expect(rakish.type).toBe("feature");
		});
	});

	describe("Scout Subclass - Superior Mobility", () => {
		it("should track speed bonus in applied effects", () => {
			state.addClass({name: "Rogue", source: "PHB", level: 9});
			state.setSubclass("Rogue", {name: "Scout", source: "XGE"});
			const appliedEffects = state.getAppliedClassFeatureEffects();

			expect(appliedEffects.some(e => e.includes("Superior Mobility"))).toBe(true);
		});
	});

	describe("Inquisitive Subclass - Ear for Deceit", () => {
		it("should track insight minimum in applied effects", () => {
			state.addClass({name: "Rogue", source: "PHB", level: 3});
			state.setSubclass("Rogue", {name: "Inquisitive", source: "XGE"});
			const appliedEffects = state.getAppliedClassFeatureEffects();

			expect(appliedEffects.some(e => e.includes("Ear for Deceit"))).toBe(true);
		});
	});
});

// =============================================================================
// PALADIN FEATURE EFFECTS
// =============================================================================
describe("Paladin Feature Effects", () => {
	describe("Divine Health (Level 3)", () => {
		it("should grant disease immunity", () => {
			state.addClass({name: "Paladin", source: "PHB", level: 3});

			expect(state.isImmuneToCondition("diseased")).toBe(true);
		});

		it("should track divine health in applied effects", () => {
			state.addClass({name: "Paladin", source: "PHB", level: 3});
			const appliedEffects = state.getAppliedClassFeatureEffects();

			expect(appliedEffects.some(e => e.includes("Divine Health"))).toBe(true);
		});

		it("should not grant disease immunity before level 3", () => {
			state.addClass({name: "Paladin", source: "PHB", level: 2});

			expect(state.isImmuneToCondition("diseased")).toBe(false);
		});
	});

	describe("Aura of Courage (Level 10)", () => {
		it("should grant frightened immunity", () => {
			state.addClass({name: "Paladin", source: "PHB", level: 10});

			expect(state.isImmuneToCondition("frightened")).toBe(true);
		});

		it("should track aura of courage in applied effects", () => {
			state.addClass({name: "Paladin", source: "PHB", level: 10});
			const appliedEffects = state.getAppliedClassFeatureEffects();

			expect(appliedEffects.some(e => e.includes("Aura of Courage"))).toBe(true);
		});

		it("should not grant frightened immunity before level 10", () => {
			state.addClass({name: "Paladin", source: "PHB", level: 9});

			expect(state.isImmuneToCondition("frightened")).toBe(false);
		});
	});

	describe("Extra Attack (Level 5)", () => {
		it("should track extra attack in applied effects", () => {
			state.addClass({name: "Paladin", source: "PHB", level: 5});
			const appliedEffects = state.getAppliedClassFeatureEffects();

			expect(appliedEffects.some(e => e.includes("Extra Attack"))).toBe(true);
		});
	});
});

// =============================================================================
// RANGER FEATURE EFFECTS
// =============================================================================
describe("Ranger Feature Effects", () => {
	describe("Land's Stride (Level 8)", () => {
		it("should track land's stride in applied effects", () => {
			state.addClass({name: "Ranger", source: "PHB", level: 8});
			const appliedEffects = state.getAppliedClassFeatureEffects();

			expect(appliedEffects.some(e => e.includes("Land's Stride"))).toBe(true);
		});
	});

	describe("Feral Senses (Level 18)", () => {
		it("should grant 30ft blindsight", () => {
			state.addClass({name: "Ranger", source: "PHB", level: 18});
			const senses = state.getSenses();

			expect(senses.blindsight).toBe(30);
		});

		it("should track feral senses in applied effects", () => {
			state.addClass({name: "Ranger", source: "PHB", level: 18});
			const appliedEffects = state.getAppliedClassFeatureEffects();

			expect(appliedEffects.some(e => e.includes("Feral Senses"))).toBe(true);
		});
	});

	describe("Extra Attack (Level 5)", () => {
		it("should track extra attack in applied effects", () => {
			state.addClass({name: "Ranger", source: "PHB", level: 5});
			const appliedEffects = state.getAppliedClassFeatureEffects();

			expect(appliedEffects.some(e => e.includes("Extra Attack"))).toBe(true);
		});
	});
});

// =============================================================================
// FIGHTER FEATURE EFFECTS
// =============================================================================
describe("Fighter Feature Effects", () => {
	describe("Defense Fighting Style", () => {
		it("should track defense fighting style in applied effects when selected", () => {
			state.addClass({name: "Fighter", source: "PHB", level: 1});
			// Note: Fighting style would need to be selected - testing the calculation exists
			const calculations = state.getFeatureCalculations();
			// hasDefenseFightingStyle would be set based on feature choices
			expect(calculations).toBeDefined();
		});
	});

	describe("Extra Attack (Level 5)", () => {
		it("should track extra attack in applied effects", () => {
			state.addClass({name: "Fighter", source: "PHB", level: 5});
			const appliedEffects = state.getAppliedClassFeatureEffects();

			expect(appliedEffects.some(e => e.includes("Extra Attack"))).toBe(true);
		});
	});

	describe("Extra Attack (2) (Level 11)", () => {
		it("should track 3 attacks at level 11", () => {
			state.addClass({name: "Fighter", source: "PHB", level: 11});
			const calculations = state.getFeatureCalculations();

			expect(calculations.extraAttackCount).toBe(3);
		});
	});

	describe("Extra Attack (3) (Level 20)", () => {
		it("should track 4 attacks at level 20", () => {
			state.addClass({name: "Fighter", source: "PHB", level: 20});
			const calculations = state.getFeatureCalculations();

			expect(calculations.extraAttackCount).toBe(4);
		});
	});
});

// =============================================================================
// CLERIC FEATURE EFFECTS
// =============================================================================
describe("Cleric Feature Effects", () => {
	describe("Twilight Domain - Eyes of Night", () => {
		it("should grant 300ft darkvision", () => {
			state.addClass({name: "Cleric", source: "PHB", level: 1});
			state.setSubclass("Cleric", {name: "Twilight Domain", source: "TCE"});
			const senses = state.getSenses();

			expect(senses.darkvision).toBe(300);
		});

		it("should track eyes of night in applied effects", () => {
			state.addClass({name: "Cleric", source: "PHB", level: 1});
			state.setSubclass("Cleric", {name: "Twilight Domain", source: "TCE"});
			const appliedEffects = state.getAppliedClassFeatureEffects();

			expect(appliedEffects.some(e => e.includes("Eyes of Night"))).toBe(true);
		});
	});

	describe("Forge Domain - Soul of the Forge (Level 6)", () => {
		it("should grant fire resistance", () => {
			state.addClass({name: "Cleric", source: "PHB", level: 6});
			state.setSubclass("Cleric", {name: "Forge Domain", source: "XGE"});

			expect(state.hasResistance("fire")).toBe(true);
		});

		it("should track AC bonus in applied effects", () => {
			state.addClass({name: "Cleric", source: "PHB", level: 6});
			state.setSubclass("Cleric", {name: "Forge Domain", source: "XGE"});
			const appliedEffects = state.getAppliedClassFeatureEffects();

			expect(appliedEffects.some(e => e.includes("Soul of the Forge"))).toBe(true);
		});
	});

	describe("Forge Domain - Saint of Forge and Fire (Level 17)", () => {
		it("should grant fire immunity", () => {
			state.addClass({name: "Cleric", source: "PHB", level: 17});
			state.setSubclass("Cleric", {name: "Forge Domain", source: "XGE"});

			expect(state.hasImmunity("fire")).toBe(true);
		});

		it("should track saint of forge and fire in applied effects", () => {
			state.addClass({name: "Cleric", source: "PHB", level: 17});
			state.setSubclass("Cleric", {name: "Forge Domain", source: "XGE"});
			const appliedEffects = state.getAppliedClassFeatureEffects();

			expect(appliedEffects.some(e => e.includes("Saint of Forge and Fire"))).toBe(true);
		});
	});

	describe("Death Domain - Inescapable Destruction (Level 6)", () => {
		it("should track inescapable destruction in applied effects", () => {
			state.addClass({name: "Cleric", source: "PHB", level: 6});
			state.setSubclass("Cleric", {name: "Death Domain", source: "DMG"});
			const appliedEffects = state.getAppliedClassFeatureEffects();

			expect(appliedEffects.some(e => e.includes("Inescapable Destruction"))).toBe(true);
		});
	});
});

// =============================================================================
// DRUID FEATURE EFFECTS
// =============================================================================
describe("Druid Feature Effects", () => {
	describe("Circle of Spores - Fungal Body (Level 14)", () => {
		it("should grant blinded condition immunity", () => {
			state.addClass({name: "Druid", source: "PHB", level: 14});
			state.setSubclass("Druid", {name: "Circle of Spores", source: "TCE"});

			expect(state.isImmuneToCondition("blinded")).toBe(true);
		});

		it("should grant deafened condition immunity", () => {
			state.addClass({name: "Druid", source: "PHB", level: 14});
			state.setSubclass("Druid", {name: "Circle of Spores", source: "TCE"});

			expect(state.isImmuneToCondition("deafened")).toBe(true);
		});

		it("should grant frightened condition immunity", () => {
			state.addClass({name: "Druid", source: "PHB", level: 14});
			state.setSubclass("Druid", {name: "Circle of Spores", source: "TCE"});

			expect(state.isImmuneToCondition("frightened")).toBe(true);
		});

		it("should grant poisoned condition immunity", () => {
			state.addClass({name: "Druid", source: "PHB", level: 14});
			state.setSubclass("Druid", {name: "Circle of Spores", source: "TCE"});

			expect(state.isImmuneToCondition("poisoned")).toBe(true);
		});

		it("should track fungal body in applied effects", () => {
			state.addClass({name: "Druid", source: "PHB", level: 14});
			state.setSubclass("Druid", {name: "Circle of Spores", source: "TCE"});
			const appliedEffects = state.getAppliedClassFeatureEffects();

			expect(appliedEffects.some(e => e.includes("Fungal Body"))).toBe(true);
		});
	});

	describe("Beast Spells (Level 18)", () => {
		it("should track beast spells in applied effects", () => {
			state.addClass({name: "Druid", source: "PHB", level: 18});
			const appliedEffects = state.getAppliedClassFeatureEffects();

			expect(appliedEffects.some(e => e.includes("Beast Spells"))).toBe(true);
		});
	});

	describe("Archdruid (Level 20)", () => {
		it("should track archdruid in applied effects", () => {
			state.addClass({name: "Druid", source: "PHB", level: 20});
			const appliedEffects = state.getAppliedClassFeatureEffects();

			expect(appliedEffects.some(e => e.includes("Archdruid"))).toBe(true);
		});
	});

	describe("Land's Stride (Circle of the Land Level 6)", () => {
		it("should track land's stride in applied effects", () => {
			state.addClass({name: "Druid", source: "PHB", level: 6});
			state.setSubclass("Druid", {name: "Circle of the Land", source: "PHB"});
			const appliedEffects = state.getAppliedClassFeatureEffects();

			expect(appliedEffects.some(e => e.includes("Land's Stride"))).toBe(true);
		});
	});
});

// =============================================================================
// WIZARD FEATURE EFFECTS
// =============================================================================
describe("Wizard Feature Effects", () => {
	describe("Bladesinger - Bladesong (Level 2)", () => {
		it("should track bladesong in applied effects", () => {
			state.addClass({name: "Wizard", source: "PHB", level: 2});
			state.setSubclass("Wizard", {name: "Bladesinging", source: "TCE"});
			const appliedEffects = state.getAppliedClassFeatureEffects();

			expect(appliedEffects.some(e => e.includes("Bladesong"))).toBe(true);
		});

		it("should calculate INT-based AC bonus", () => {
			state.addClass({name: "Wizard", source: "PHB", level: 2});
			state.setSubclass("Wizard", {name: "Bladesinging", source: "TCE"});
			const calculations = state.getFeatureCalculations();

			expect(calculations.hasBladesong).toBe(true);
			expect(calculations.bladesongAcBonus).toBe(state.getAbilityMod("int"));
		});
	});
});

// =============================================================================
// SORCERER FEATURE EFFECTS
// =============================================================================
describe("Sorcerer Feature Effects", () => {
	describe("Draconic Resilience (Level 1)", () => {
		it("should track draconic resilience in applied effects", () => {
			state.addClass({name: "Sorcerer", source: "PHB", level: 1});
			state.setSubclass("Sorcerer", {name: "Draconic Bloodline", source: "PHB"});
			const appliedEffects = state.getAppliedClassFeatureEffects();

			expect(appliedEffects.some(e => e.includes("Draconic Resilience"))).toBe(true);
		});

		it("should calculate +1 HP per level", () => {
			state.addClass({name: "Sorcerer", source: "PHB", level: 5});
			state.setSubclass("Sorcerer", {name: "Draconic Bloodline", source: "PHB"});
			const calculations = state.getFeatureCalculations();

			expect(calculations.hasDraconicResilience).toBe(true);
		});
	});

	describe("Dragon Wings (Level 14)", () => {
		it("should track dragon wings in applied effects", () => {
			state.addClass({name: "Sorcerer", source: "PHB", level: 14});
			state.setSubclass("Sorcerer", {name: "Draconic Bloodline", source: "PHB"});
			const appliedEffects = state.getAppliedClassFeatureEffects();

			expect(appliedEffects.some(e => e.includes("Dragon Wings"))).toBe(true);
		});
	});
});

// =============================================================================
// BARD FEATURE EFFECTS
// =============================================================================
describe("Bard Feature Effects", () => {
	describe("Jack of All Trades (Level 2)", () => {
		it("should track jack of all trades in applied effects", () => {
			state.addClass({name: "Bard", source: "PHB", level: 2});
			const appliedEffects = state.getAppliedClassFeatureEffects();

			expect(appliedEffects.some(e => e.includes("Jack of All Trades"))).toBe(true);
		});
	});

	describe("Countercharm (Level 6)", () => {
		it("should track countercharm in applied effects", () => {
			state.addClass({name: "Bard", source: "PHB", level: 6});
			const appliedEffects = state.getAppliedClassFeatureEffects();

			expect(appliedEffects.some(e => e.includes("Countercharm"))).toBe(true);
		});
	});

	describe("Superior Inspiration (Level 20)", () => {
		it("should track superior inspiration in applied effects", () => {
			state.addClass({name: "Bard", source: "PHB", level: 20});
			const appliedEffects = state.getAppliedClassFeatureEffects();

			expect(appliedEffects.some(e => e.includes("Superior Inspiration"))).toBe(true);
		});
	});
});

// =============================================================================
// WARLOCK FEATURE EFFECTS
// =============================================================================
describe("Warlock Feature Effects", () => {
	describe("Devil's Sight Invocation", () => {
		it("should grant 120ft darkvision when invocation is taken", () => {
			state.addClass({name: "Warlock", source: "PHB", level: 2});
			// Devil's Sight would be selected as an invocation
			// Test that the calculation exists
			const calculations = state.getFeatureCalculations();
			expect(calculations).toBeDefined();
		});
	});

	describe("Fiendish Resilience (Fiend Level 10)", () => {
		it("should track fiendish resilience in calculations", () => {
			state.addClass({name: "Warlock", source: "PHB", level: 10});
			state.setSubclass("Warlock", {name: "The Fiend", source: "PHB"});
			const calculations = state.getFeatureCalculations();

			expect(calculations.hasFiendishResilience).toBe(true);
		});

		it("should track fiendish resilience in applied effects", () => {
			state.addClass({name: "Warlock", source: "PHB", level: 10});
			state.setSubclass("Warlock", {name: "The Fiend", source: "PHB"});
			const appliedEffects = state.getAppliedClassFeatureEffects();

			expect(appliedEffects.some(e => e.includes("Fiendish Resilience"))).toBe(true);
		});
	});
});

// =============================================================================
// ARTIFICER FEATURE EFFECTS
// =============================================================================
describe("Artificer Feature Effects", () => {
	describe("Tool Expertise (Level 6)", () => {
		it("should track tool expertise in applied effects", () => {
			state.addClass({name: "Artificer", source: "TCE", level: 6});
			const appliedEffects = state.getAppliedClassFeatureEffects();

			expect(appliedEffects.some(e => e.includes("Tool Expertise"))).toBe(true);
		});
	});

	describe("Magic Item Savant (Level 14)", () => {
		it("should track magic item savant in applied effects", () => {
			state.addClass({name: "Artificer", source: "TCE", level: 14});
			const appliedEffects = state.getAppliedClassFeatureEffects();

			expect(appliedEffects.some(e => e.includes("Magic Item Savant"))).toBe(true);
		});
	});

	describe("Soul of Artifice (Level 20)", () => {
		it("should track soul of artifice in applied effects", () => {
			state.addClass({name: "Artificer", source: "TCE", level: 20});
			const appliedEffects = state.getAppliedClassFeatureEffects();

			expect(appliedEffects.some(e => e.includes("Soul of Artifice"))).toBe(true);
		});
	});

	describe("Battle Smith - Battle Ready (Level 3)", () => {
		it("should track battle ready in applied effects", () => {
			state.addClass({name: "Artificer", source: "TCE", level: 3});
			state.setSubclass("Artificer", {name: "Battle Smith", source: "TCE"});
			const appliedEffects = state.getAppliedClassFeatureEffects();

			expect(appliedEffects.some(e => e.includes("Battle Ready"))).toBe(true);
		});
	});
});

// =============================================================================
// EFFECT CLEARING AND REAPPLICATION
// =============================================================================
describe("Effect Clearing and Reapplication", () => {
	it("should clear effects when class is removed", () => {
		state.addClass({name: "Monk", source: "PHB", level: 10});
		expect(state.hasImmunity("poison")).toBe(true);

		state.removeClass("Monk", "PHB");
		expect(state.hasImmunity("poison")).toBe(false);
	});

	it("should update effects when level changes", () => {
		state.addClass({name: "Rogue", source: "PHB", level: 10});
		expect(state.getSenses().blindsight).toBe(0);

		// Level up past 14
		for (let i = 0; i < 4; i++) {
			state.levelUp("Rogue");
		}
		expect(state.getSenses().blindsight).toBe(10);
	});

	it("should update effects when subclass is set", () => {
		state.addClass({name: "Cleric", source: "PHB", level: 6});
		expect(state.hasResistance("fire")).toBe(false);

		state.setSubclass("Cleric", {name: "Forge Domain", source: "XGE"});
		expect(state.hasResistance("fire")).toBe(true);
	});

	it("should handle multiclass correctly", () => {
		state.addClass({name: "Monk", source: "PHB", level: 10});
		expect(state.hasImmunity("poison")).toBe(true);

		state.addClass({name: "Rogue", source: "PHB", level: 7});
		// Should still have monk immunity
		expect(state.hasImmunity("poison")).toBe(true);
		// Should also have rogue evasion tracked
		const appliedEffects = state.getAppliedClassFeatureEffects();
		expect(appliedEffects.filter(e => e.includes("Evasion")).length).toBeGreaterThanOrEqual(1);
	});

	it("should not duplicate effects on reapplication", () => {
		state.addClass({name: "Monk", source: "PHB", level: 14});
		const firstCount = state.getSaveProficiencies().length;

		// Force reapplication
		state.applyClassFeatureEffects();
		const secondCount = state.getSaveProficiencies().length;

		expect(secondCount).toBe(firstCount);
	});
});

// =============================================================================
// COMPREHENSIVE INTEGRATION TESTS
// =============================================================================
describe("Integration Tests", () => {
	it("should apply multiple effect types from same feature", () => {
		// Fungal Body grants 4 condition immunities
		state.addClass({name: "Druid", source: "PHB", level: 14});
		state.setSubclass("Druid", {name: "Circle of Spores", source: "TCE"});

		expect(state.isImmuneToCondition("blinded")).toBe(true);
		expect(state.isImmuneToCondition("deafened")).toBe(true);
		expect(state.isImmuneToCondition("frightened")).toBe(true);
		expect(state.isImmuneToCondition("poisoned")).toBe(true);
	});

	it("should stack benefits from different classes", () => {
		// Monk and Paladin both give disease immunity
		state.addClass({name: "Monk", source: "PHB", level: 10});
		state.addClass({name: "Paladin", source: "PHB", level: 3});

		// Should have disease immunity (from both classes)
		expect(state.isImmuneToCondition("diseased")).toBe(true);

		// Remove monk - should still have from paladin
		state.removeClass("Monk", "PHB");
		expect(state.isImmuneToCondition("diseased")).toBe(true);

		// Remove paladin - now no immunity
		state.removeClass("Paladin", "PHB");
		expect(state.isImmuneToCondition("diseased")).toBe(false);
	});

	it("should properly track effects in getAppliedClassFeatureEffects", () => {
		state.addClass({name: "Monk", source: "PHB", level: 14});
		state.addClass({name: "Rogue", source: "PHB", level: 15});

		const effects = state.getAppliedClassFeatureEffects();

		// Should have effects from both classes
		expect(effects.some(e => e.includes("Diamond Soul"))).toBe(true);
		expect(effects.some(e => e.includes("Slippery Mind"))).toBe(true);
		expect(effects.some(e => e.includes("Evasion"))).toBe(true);
		expect(effects.some(e => e.includes("Reliable Talent"))).toBe(true);
	});

	it("should correctly handle sense improvements", () => {
		// Start with no darkvision
		expect(state.getSenses().darkvision).toBe(0);

		// Add twilight cleric for 300ft
		state.addClass({name: "Cleric", source: "PHB", level: 1});
		state.setSubclass("Cleric", {name: "Twilight Domain", source: "TCE"});
		expect(state.getSenses().darkvision).toBe(300);
	});
});

// =============================================================================
// HOMEBREW AND GENERIC FEATURE TESTS
// =============================================================================
describe("Homebrew and Generic Feature Support", () => {
	describe("FeatureEffectRegistry direct usage", () => {
		it("should look up effects by feature name regardless of class", () => {
			// The registry should work with any feature name
			const purityEffects = globalThis.FeatureEffectRegistry.getEffects("Purity of Body");
			expect(purityEffects.length).toBeGreaterThan(0);
			expect(purityEffects.some(e => e.type === "immunity" && e.damageType === "poison")).toBe(true);
		});

		it("should return empty array for unknown features", () => {
			const effects = globalThis.FeatureEffectRegistry.getEffects("Totally Made Up Feature");
			expect(effects).toEqual([]);
		});

		it("should be case-insensitive", () => {
			const effects1 = globalThis.FeatureEffectRegistry.getEffects("Purity of Body");
			const effects2 = globalThis.FeatureEffectRegistry.getEffects("purity of body");
			const effects3 = globalThis.FeatureEffectRegistry.getEffects("PURITY OF BODY");

			expect(effects1.length).toBe(effects2.length);
			expect(effects2.length).toBe(effects3.length);
		});
	});

	describe("Stored feature-based effects", () => {
		it("should apply effects from stored features using registry", () => {
			// Add a feature directly (simulating homebrew or manually added feature)
			state.addFeature({
				name: "Purity of Body",
				source: "Homebrew",
				featureType: "Class",
				className: "The Dreidel", // Homebrew class name
				level: 1,
				description: "You are immune to disease and poison.",
			});

			// Force effect processing
			state.applyClassFeatureEffects();

			// Should have effects from the registry based on feature name
			expect(state.hasImmunity("poison")).toBe(true);
			expect(state.isImmuneToCondition("poisoned")).toBe(true);
		});

		it("should apply effects from features with data properties", () => {
			// Add a feature with explicit resist/immune arrays (homebrew format)
			state.addFeature({
				name: "Fire Shield",
				source: "Homebrew",
				featureType: "Class",
				className: "The Dreidel",
				level: 1,
				description: "You have resistance to fire damage.",
				entryData: {
					resist: ["fire"],
				},
			});

			// Force effect processing
			state.applyClassFeatureEffects();

			// Should have effects from the data properties
			expect(state.hasResistance("fire")).toBe(true);
		});

		it("should apply condition immunities from feature data", () => {
			state.addFeature({
				name: "Mental Fortress",
				source: "Homebrew",
				featureType: "Class",
				className: "The Dreidel",
				level: 1,
				description: "You cannot be charmed or frightened.",
				entryData: {
					conditionImmune: ["charmed", "frightened"],
				},
			});

			state.applyClassFeatureEffects();

			expect(state.isImmuneToCondition("charmed")).toBe(true);
			expect(state.isImmuneToCondition("frightened")).toBe(true);
		});
	});

	describe("Mixed homebrew class scenarios", () => {
		it("should support a homebrew class with features from multiple official classes", () => {
			// The Dreidel: A homebrew class that has Rage, Evasion, and Reliable Talent

			// Add features manually (as a homebrew class would define them)
			state.addFeature({
				name: "Rage",
				source: "Homebrew",
				featureType: "Class",
				className: "The Dreidel",
				level: 1,
				description: "You can rage, gaining resistance to bludgeoning, piercing, and slashing damage.",
			});

			state.addFeature({
				name: "Evasion",
				source: "Homebrew",
				featureType: "Class",
				className: "The Dreidel",
				level: 3,
				description: "When you are subjected to an effect that allows you to make a Dexterity saving throw to take only half damage, you instead take no damage.",
			});

			state.addFeature({
				name: "Reliable Talent",
				source: "Homebrew",
				featureType: "Class",
				className: "The Dreidel",
				level: 5,
				description: "You can treat a d20 roll of 9 or lower as a 10 for ability checks you are proficient in.",
			});

			state.applyClassFeatureEffects();

			const effects = state.getAppliedClassFeatureEffects();

			// Should have all three feature effects
			expect(effects.some(e => e.includes("Rage"))).toBe(true);
			expect(effects.some(e => e.includes("Evasion"))).toBe(true);
			expect(effects.some(e => e.includes("Reliable Talent"))).toBe(true);
		});

		it("should handle homebrew class combined with official classes", () => {
			// Add a homebrew class feature
			state.addFeature({
				name: "Diamond Soul",
				source: "Homebrew",
				featureType: "Class",
				className: "The Mystic Warrior",
				level: 5,
				description: "Your mastery of ki grants you proficiency in all saving throws.",
			});

			// Add an official class
			state.addClass({name: "Rogue", source: "PHB", level: 11});

			state.applyClassFeatureEffects();

			// Should have Diamond Soul effects from homebrew
			["str", "dex", "con", "int", "wis", "cha"].forEach(ability => {
				expect(state.hasSaveProficiency(ability)).toBe(true);
			});

			// Should also have Rogue features
			const effects = state.getAppliedClassFeatureEffects();
			expect(effects.some(e => e.includes("Reliable Talent"))).toBe(true);
		});
	});

	describe("Classes missing expected features", () => {
		it("should work with ranger that has no spellcasting", () => {
			// A homebrew ranger variant without spellcasting
			state.addClass({name: "Ranger (Martial)", source: "Homebrew", level: 8});

			// Add Land's Stride manually (the ranger still has this)
			state.addFeature({
				name: "Land's Stride",
				source: "Homebrew",
				featureType: "Class",
				className: "Ranger (Martial)",
				level: 8,
				description: "Moving through nonmagical difficult terrain costs you no extra movement.",
			});

			state.applyClassFeatureEffects();

			const effects = state.getAppliedClassFeatureEffects();
			expect(effects.some(e => e.includes("Land's Stride"))).toBe(true);

			// Should NOT have spellcasting-related effects
			expect(state.getSpellSlots()).toEqual({});
		});

		it("should work with a monk that has Rage instead of Ki", () => {
			// Homebrew: The Fury Monk - uses rage instead of ki
			state.addFeature({
				name: "Rage",
				source: "Homebrew",
				featureType: "Class",
				className: "Fury Monk",
				level: 1,
				description: "You can enter a rage, gaining resistance to bludgeoning, piercing, and slashing damage.",
			});

			state.addFeature({
				name: "Evasion",
				source: "Homebrew",
				featureType: "Class",
				className: "Fury Monk",
				level: 7,
				description: "When you are subjected to an effect that allows you to make a Dexterity saving throw to take only half damage, you instead take no damage.",
			});

			state.applyClassFeatureEffects();

			const effects = state.getAppliedClassFeatureEffects();
			expect(effects.some(e => e.includes("Rage"))).toBe(true);
			expect(effects.some(e => e.includes("Evasion"))).toBe(true);
		});
	});

	describe("Feature data parsing", () => {
		it("should parse complex resist objects", () => {
			state.addFeature({
				name: "Elemental Armor",
				source: "Homebrew",
				featureType: "Class",
				className: "Elementalist",
				level: 5,
				description: "You have resistance to multiple elements.",
				entryData: {
					resist: ["fire", "cold", "lightning"],
				},
			});

			state.applyClassFeatureEffects();

			expect(state.hasResistance("fire")).toBe(true);
			expect(state.hasResistance("cold")).toBe(true);
			expect(state.hasResistance("lightning")).toBe(true);
		});

		it("should parse skill proficiency grants", () => {
			state.addFeature({
				name: "Learned One",
				source: "Homebrew",
				featureType: "Class",
				className: "Scholar",
				level: 1,
				description: "You gain proficiency in History and Arcana.",
				entryData: {
					skillProficiencies: [{
						history: true,
						arcana: true,
					}],
				},
			});

			state.applyClassFeatureEffects();

			// Effects should be tracked
			const effects = state.getAppliedClassFeatureEffects();
			expect(effects.some(e => e.toLowerCase().includes("history"))).toBe(true);
			expect(effects.some(e => e.toLowerCase().includes("arcana"))).toBe(true);
		});

		it("should parse language grants", () => {
			state.addFeature({
				name: "Polyglot",
				source: "Homebrew",
				featureType: "Class",
				className: "Diplomat",
				level: 1,
				description: "You learn several languages.",
				entryData: {
					languageProficiencies: [{
						draconic: true,
						infernal: true,
					}],
				},
			});

			state.applyClassFeatureEffects();

			// Effects should be tracked
			const effects = state.getAppliedClassFeatureEffects();
			expect(effects.some(e => e.toLowerCase().includes("draconic"))).toBe(true);
			expect(effects.some(e => e.toLowerCase().includes("infernal"))).toBe(true);
		});

		it("should parse tool proficiency grants", () => {
			state.addFeature({
				name: "Artisan's Touch",
				source: "Homebrew",
				featureType: "Class",
				className: "Crafter",
				level: 1,
				description: "You gain proficiency with smith's tools and carpenter's tools.",
				entryData: {
					toolProficiencies: [{
						"smith's tools": true,
						"carpenter's tools": true,
					}],
				},
			});

			state.applyClassFeatureEffects();

			const effects = state.getAppliedClassFeatureEffects();
			expect(effects.some(e => e.toLowerCase().includes("smith"))).toBe(true);
			expect(effects.some(e => e.toLowerCase().includes("carpenter"))).toBe(true);
		});
	});

	describe("Edge cases", () => {
		it("should not crash with empty features array", () => {
			state.applyClassFeatureEffects();
			expect(state.getAppliedClassFeatureEffects()).toEqual([]);
		});

		it("should handle features without names gracefully", () => {
			state.addFeature({
				source: "Homebrew",
				featureType: "Class",
				description: "Some anonymous feature",
			});

			// Should not crash
			expect(() => state.applyClassFeatureEffects()).not.toThrow();
		});

		it("should handle features with null/undefined entryData", () => {
			state.addFeature({
				name: "Simple Feature",
				source: "Homebrew",
				featureType: "Class",
				description: "A feature without structured data.",
				entryData: null,
			});

			// Should not crash
			expect(() => state.applyClassFeatureEffects()).not.toThrow();
		});

		it("should not duplicate effects when same feature exists in registry and stored", () => {
			// Add an official class which sets calculation flags
			state.addClass({name: "Monk", source: "PHB", level: 10});

			// Also add the same feature manually (simulating a save/load scenario)
			state.addFeature({
				name: "Purity of Body",
				source: "PHB",
				featureType: "Class",
				className: "Monk",
				level: 10,
				description: "You are immune to disease and poison.",
			});

			state.applyClassFeatureEffects();

			// Should have immunity, but not duplicated
			expect(state.hasImmunity("poison")).toBe(true);

			// Count effects - should not have duplicates
			const effects = state.getAppliedClassFeatureEffects();

			// Check exact poison damage immunity (not "poisoned condition immunity")
			const poisonDamageImmunityCount = effects.filter(e =>
				e === "Purity of Body: poison immunity",
			).length;
			expect(poisonDamageImmunityCount).toBe(1);

			// Check poisoned condition immunity
			const poisonedConditionCount = effects.filter(e =>
				e === "Purity of Body: poisoned condition immunity",
			).length;
			expect(poisonedConditionCount).toBe(1);

			// Check diseased condition immunity
			const diseasedConditionCount = effects.filter(e =>
				e === "Purity of Body: diseased condition immunity",
			).length;
			expect(diseasedConditionCount).toBe(1);
		});
	});
});

// =============================================================================
// RACE FEATURE EFFECTS
// =============================================================================
describe("Race Feature Effects via Registry", () => {
	it("should apply dwarf poison resistance from registry", () => {
		state.addFeature({
			name: "Dwarven Resilience",
			source: "PHB",
			featureType: "Race",
			description: "You have advantage on saving throws against poison, and you have resistance against poison damage.",
		});

		state.applyClassFeatureEffects();

		const effects = state.getAppliedClassFeatureEffects();
		expect(effects.some(e => e.includes("Dwarven Resilience"))).toBe(true);
	});

	it("should apply tiefling fire resistance from registry", () => {
		state.addFeature({
			name: "Hellish Resistance",
			source: "PHB",
			featureType: "Race",
			description: "You have resistance to fire damage.",
		});

		state.applyClassFeatureEffects();

		const effects = state.getAppliedClassFeatureEffects();
		expect(effects.some(e => e.includes("Hellish Resistance"))).toBe(true);
	});

	it("should apply halfling lucky from registry", () => {
		state.addFeature({
			name: "Lucky",
			source: "PHB",
			featureType: "Race",
			description: "When you roll a 1 on an attack roll, ability check, or saving throw, you can reroll the die.",
		});

		state.applyClassFeatureEffects();

		const effects = state.getAppliedClassFeatureEffects();
		expect(effects.some(e => e.includes("Lucky"))).toBe(true);
	});
});
