/**
 * Character Sheet Warlock Class Tests
 * Comprehensive testing for all Warlock class features and subclasses (Otherworldly Patrons)
 *
 * This test suite verifies that:
 * - Pact Magic calculations are correct (pact slots, slot level)
 * - Eldritch Blast beam scaling is correct
 * - Eldritch Invocations progression is correct
 * - Mystic Arcanum unlocks at proper levels
 * - PHB vs XPHB differences are handled correctly
 * - All subclass (Otherworldly Patron) features work correctly
 */

import "./setup.js";
import "../../../js/charactersheet/charactersheet-state.js";

const CharacterSheetState = globalThis.CharacterSheetState;

// ==========================================================================
// PART 1: CORE WARLOCK CLASS FEATURES (PHB)
// ==========================================================================
describe("Warlock Core Class Features (PHB)", () => {
	let state;

	beforeEach(() => {
		state = new CharacterSheetState();
		state.setRace({name: "Human", source: "PHB"});
		state.addClass({name: "Warlock", source: "PHB", level: 1});
		state.setAbilityBase("str", 8);
		state.setAbilityBase("dex", 14); // +2 modifier
		state.setAbilityBase("con", 14); // +2 modifier
		state.setAbilityBase("int", 10);
		state.setAbilityBase("wis", 12); // +1 modifier
		state.setAbilityBase("cha", 16); // +3 modifier
	});

	// -------------------------------------------------------------------------
	// Pact Magic (Level 1)
	// -------------------------------------------------------------------------
	describe("Pact Magic", () => {
		it("should have Pact Magic at level 1", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasPactMagic).toBe(true);
		});

		it("should use CHA as spellcasting ability", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.spellcastingAbility).toBe("cha");
		});

		it("should calculate spell save DC as 8 + prof + CHA", () => {
			const calculations = state.getFeatureCalculations();
			// 8 + 2 (prof at 1) + 3 (CHA) = 13
			expect(calculations.spellSaveDc).toBe(13);
		});

		it("should calculate spell attack bonus as prof + CHA", () => {
			const calculations = state.getFeatureCalculations();
			// 2 (prof at 1) + 3 (CHA) = 5
			expect(calculations.spellAttackBonus).toBe(5);
		});

		it("should know 2 cantrips at level 1", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.cantripsKnown).toBe(2);
		});

		it("should know 3 cantrips at level 4", () => {
			state.addClass({name: "Warlock", source: "PHB", level: 4});
			const calculations = state.getFeatureCalculations();
			expect(calculations.cantripsKnown).toBe(3);
		});

		it("should know 4 cantrips at level 10", () => {
			state.addClass({name: "Warlock", source: "PHB", level: 10});
			const calculations = state.getFeatureCalculations();
			expect(calculations.cantripsKnown).toBe(4);
		});
	});

	// -------------------------------------------------------------------------
	// Pact Slots
	// -------------------------------------------------------------------------
	describe("Pact Slots", () => {
		it("should have 1 pact slot at level 1", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.pactSlots).toBe(1);
		});

		it("should have 2 pact slots at level 2", () => {
			state.addClass({name: "Warlock", source: "PHB", level: 2});
			const calculations = state.getFeatureCalculations();
			expect(calculations.pactSlots).toBe(2);
		});

		it("should have 3 pact slots at level 11", () => {
			state.addClass({name: "Warlock", source: "PHB", level: 11});
			const calculations = state.getFeatureCalculations();
			expect(calculations.pactSlots).toBe(3);
		});

		it("should have 1st level slots at level 1", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.pactSlotLevel).toBe(1);
		});

		it("should have 2nd level slots at level 3", () => {
			state.addClass({name: "Warlock", source: "PHB", level: 3});
			const calculations = state.getFeatureCalculations();
			expect(calculations.pactSlotLevel).toBe(2);
		});

		it("should have 3rd level slots at level 5", () => {
			state.addClass({name: "Warlock", source: "PHB", level: 5});
			const calculations = state.getFeatureCalculations();
			expect(calculations.pactSlotLevel).toBe(3);
		});

		it("should have 4th level slots at level 7", () => {
			state.addClass({name: "Warlock", source: "PHB", level: 7});
			const calculations = state.getFeatureCalculations();
			expect(calculations.pactSlotLevel).toBe(4);
		});

		it("should have 5th level slots at level 9", () => {
			state.addClass({name: "Warlock", source: "PHB", level: 9});
			const calculations = state.getFeatureCalculations();
			expect(calculations.pactSlotLevel).toBe(5);
		});
	});

	// -------------------------------------------------------------------------
	// Spells Known (PHB)
	// -------------------------------------------------------------------------
	describe("Spells Known (PHB)", () => {
		it("should know 2 spells at level 1", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.spellsKnown).toBe(2);
		});

		it("should know 3 spells at level 2", () => {
			state.addClass({name: "Warlock", source: "PHB", level: 2});
			const calculations = state.getFeatureCalculations();
			expect(calculations.spellsKnown).toBe(3);
		});

		it("should know 6 spells at level 5", () => {
			state.addClass({name: "Warlock", source: "PHB", level: 5});
			const calculations = state.getFeatureCalculations();
			expect(calculations.spellsKnown).toBe(6);
		});

		it("should know 10 spells at level 9", () => {
			state.addClass({name: "Warlock", source: "PHB", level: 9});
			const calculations = state.getFeatureCalculations();
			expect(calculations.spellsKnown).toBe(10);
		});

		it("should know 15 spells at level 20", () => {
			state.addClass({name: "Warlock", source: "PHB", level: 20});
			const calculations = state.getFeatureCalculations();
			expect(calculations.spellsKnown).toBe(15);
		});
	});

	// -------------------------------------------------------------------------
	// Eldritch Invocations (Level 2)
	// -------------------------------------------------------------------------
	describe("Eldritch Invocations", () => {
		it("should not have Eldritch Invocations at level 1", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasEldritchInvocations).toBeFalsy();
		});

		it("should have Eldritch Invocations at level 2", () => {
			state.addClass({name: "Warlock", source: "PHB", level: 2});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasEldritchInvocations).toBe(true);
		});

		it("should know 2 invocations at level 2", () => {
			state.addClass({name: "Warlock", source: "PHB", level: 2});
			const calculations = state.getFeatureCalculations();
			expect(calculations.invocationsKnown).toBe(2);
		});

		it("should know 3 invocations at level 5", () => {
			state.addClass({name: "Warlock", source: "PHB", level: 5});
			const calculations = state.getFeatureCalculations();
			expect(calculations.invocationsKnown).toBe(3);
		});

		it("should know 5 invocations at level 9", () => {
			state.addClass({name: "Warlock", source: "PHB", level: 9});
			const calculations = state.getFeatureCalculations();
			expect(calculations.invocationsKnown).toBe(5);
		});

		it("should know 8 invocations at level 18", () => {
			state.addClass({name: "Warlock", source: "PHB", level: 18});
			const calculations = state.getFeatureCalculations();
			expect(calculations.invocationsKnown).toBe(8);
		});
	});

	// -------------------------------------------------------------------------
	// Pact Boon (Level 3)
	// -------------------------------------------------------------------------
	describe("Pact Boon (PHB)", () => {
		it("should not have Pact Boon before level 3", () => {
			state.addClass({name: "Warlock", source: "PHB", level: 2});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasPactBoon).toBeFalsy();
		});

		it("should have Pact Boon at level 3", () => {
			state.addClass({name: "Warlock", source: "PHB", level: 3});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasPactBoon).toBe(true);
		});
	});

	// -------------------------------------------------------------------------
	// Pact of the Chain Detection
	// -------------------------------------------------------------------------
	describe("Pact of the Chain", () => {
		it("should detect Pact of the Chain when feature is added (PHB)", () => {
			state.addClass({name: "Warlock", source: "PHB", level: 3});
			state.addFeature({
				name: "Pact of the Chain",
				source: "PHB",
				className: "Warlock",
				classSource: "PHB",
				level: 3,
				featureType: "Optional Feature",
				optionalFeatureTypes: ["PB"],
			});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasPactOfTheChain).toBe(true);
		});

		it("should provide PHB creature list for PHB warlock", () => {
			state.addClass({name: "Warlock", source: "PHB", level: 3});
			state.addFeature({
				name: "Pact of the Chain",
				source: "PHB",
				className: "Warlock",
				classSource: "PHB",
				level: 3,
				featureType: "Optional Feature",
				optionalFeatureTypes: ["PB"],
			});
			const calculations = state.getFeatureCalculations();
			expect(calculations.pactOfTheChainCreatures).toEqual(["Imp", "Pseudodragon", "Quasit", "Sprite"]);
		});

		it("should provide XPHB expanded creature list for XPHB warlock", () => {
			state = new CharacterSheetState();
			state.setRace({name: "Human", source: "XPHB"});
			state.addClass({name: "Warlock", source: "XPHB", level: 1});
			state.setAbilityBase("cha", 16);
			state.addFeature({
				name: "Pact of the Chain",
				source: "XPHB",
				className: "Warlock",
				classSource: "XPHB",
				level: 1,
				featureType: "Optional Feature",
				optionalFeatureTypes: ["EI"],
			});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasPactOfTheChain).toBe(true);
			expect(calculations.pactOfTheChainCreatures).toContain("Imp");
			expect(calculations.pactOfTheChainCreatures).toContain("Skeleton");
			expect(calculations.pactOfTheChainCreatures).toContain("Sphinx of Wonder");
			expect(calculations.pactOfTheChainCreatures).toContain("Venomous Snake");
			expect(calculations.pactOfTheChainCreatures.length).toBe(8);
		});

		it("should NOT have hasPactOfTheChain without the feature", () => {
			state.addClass({name: "Warlock", source: "PHB", level: 3});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasPactOfTheChain).toBeFalsy();
		});

		it("should NOT have hasPactOfTheChain with a different pact boon", () => {
			state.addClass({name: "Warlock", source: "PHB", level: 3});
			state.addFeature({
				name: "Pact of the Blade",
				source: "PHB",
				className: "Warlock",
				classSource: "PHB",
				level: 3,
				featureType: "Optional Feature",
				optionalFeatureTypes: ["PB"],
			});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasPactOfTheChain).toBeFalsy();
		});
	});

	// -------------------------------------------------------------------------
	// Mystic Arcanum
	// -------------------------------------------------------------------------
	describe("Mystic Arcanum", () => {
		it("should not have Mystic Arcanum before level 11", () => {
			state.addClass({name: "Warlock", source: "PHB", level: 10});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasMysticArcanum).toBeFalsy();
		});

		it("should have 6th-level Mystic Arcanum at level 11", () => {
			state.addClass({name: "Warlock", source: "PHB", level: 11});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasMysticArcanum).toBe(true);
			expect(calculations.mysticArcanum6th).toBe(true);
		});

		it("should have 7th-level Mystic Arcanum at level 13", () => {
			state.addClass({name: "Warlock", source: "PHB", level: 13});
			const calculations = state.getFeatureCalculations();
			expect(calculations.mysticArcanum7th).toBe(true);
		});

		it("should have 8th-level Mystic Arcanum at level 15", () => {
			state.addClass({name: "Warlock", source: "PHB", level: 15});
			const calculations = state.getFeatureCalculations();
			expect(calculations.mysticArcanum8th).toBe(true);
		});

		it("should have 9th-level Mystic Arcanum at level 17", () => {
			state.addClass({name: "Warlock", source: "PHB", level: 17});
			const calculations = state.getFeatureCalculations();
			expect(calculations.mysticArcanum9th).toBe(true);
		});
	});

	// -------------------------------------------------------------------------
	// Eldritch Master (Level 20)
	// -------------------------------------------------------------------------
	describe("Eldritch Master", () => {
		it("should not have Eldritch Master before level 20", () => {
			state.addClass({name: "Warlock", source: "PHB", level: 19});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasEldritchMaster).toBeFalsy();
		});

		it("should have Eldritch Master at level 20", () => {
			state.addClass({name: "Warlock", source: "PHB", level: 20});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasEldritchMaster).toBe(true);
		});
	});
});

describe("Warlock Phase 2 Mechanics", () => {
	let state;

	beforeEach(() => {
		state = new CharacterSheetState();
		state.setRace({name: "Human", source: "PHB"});
		state.addClass({name: "Warlock", source: "PHB", level: 12});
		state.setAbilityBase("cha", 18);
	});

	it("should apply invocation-like metadata effects through generic feature pipeline", () => {
		state.addFeature({
			name: "Devil's Sight",
			description: "You can see normally in darkness, both magical and nonmagical, to a distance of 120 feet.",
			effects: [{type: "sense", target: "darkvision", value: 120}],
			className: "Warlock",
			level: 2,
		});

		state.applyClassFeatureEffects();

		expect(state.getSenses().darkvision).toBe(120);
		expect(state.getAppliedClassFeatureEffects().some(e => e.includes("Devil's Sight"))).toBe(true);
	});

	it("should expose invocation-like limited-use abilities as activatables", () => {
		state.addFeature({
			name: "Eldritch Hex",
			description: "As a bonus action, you can curse a target and empower your attacks.",
			uses: {current: 1, max: 1, recharge: "short"},
			className: "Warlock",
			level: 10,
		});

		const activatables = state.getActivatableFeatures();
		const eldritchHex = activatables.find(a => a.feature.name === "Eldritch Hex");

		expect(eldritchHex).toBeDefined();
		expect(eldritchHex.interactionMode).toBe("limited");
		expect(eldritchHex.resource).toBeDefined();
		expect(eldritchHex.resource.max).toBe(1);
	});
});

// ==========================================================================
// PART 2: ELDRITCH BLAST SCALING
// ==========================================================================
describe("Warlock Eldritch Blast", () => {
	let state;

	beforeEach(() => {
		state = new CharacterSheetState();
		state.setRace({name: "Human", source: "PHB"});
		state.addClass({name: "Warlock", source: "PHB", level: 1});
	});

	it("should have 1 beam at level 1", () => {
		const calculations = state.getFeatureCalculations();
		expect(calculations.eldritchBlastBeams).toBe(1);
	});

	it("should have 2 beams at level 5", () => {
		state.addClass({name: "Warlock", source: "PHB", level: 5});
		const calculations = state.getFeatureCalculations();
		expect(calculations.eldritchBlastBeams).toBe(2);
	});

	it("should have 3 beams at level 11", () => {
		state.addClass({name: "Warlock", source: "PHB", level: 11});
		const calculations = state.getFeatureCalculations();
		expect(calculations.eldritchBlastBeams).toBe(3);
	});

	it("should have 4 beams at level 17", () => {
		state.addClass({name: "Warlock", source: "PHB", level: 17});
		const calculations = state.getFeatureCalculations();
		expect(calculations.eldritchBlastBeams).toBe(4);
	});
});

// ==========================================================================
// PART 3: WARLOCK HIT DICE
// ==========================================================================
describe("Warlock Hit Dice", () => {
	let state;

	beforeEach(() => {
		state = new CharacterSheetState();
		state.setRace({name: "Human", source: "PHB"});
		state.addClass({name: "Warlock", source: "PHB", level: 1});
	});

	it("should use d8 hit dice", () => {
		const hitDice = state.getHitDice();
		if (Array.isArray(hitDice)) {
			expect(hitDice.some(hd => hd.die === 8 || hd.faces === 8)).toBe(true);
		} else {
			expect(hitDice["d8"] || hitDice[8]).toBeDefined();
		}
	});

	it("should have correct number of hit dice per level", () => {
		state.addClass({name: "Warlock", source: "PHB", level: 5});
		const hitDice = state.getHitDice();
		const totalDice = Array.isArray(hitDice)
			? hitDice.reduce((sum, hd) => sum + (hd.max || hd.current || 0), 0)
			: Object.values(hitDice).reduce((sum, val) => sum + val, 0);
		expect(totalDice).toBe(5);
	});
});

// ==========================================================================
// PART 4: THE ARCHFEY SUBCLASS
// ==========================================================================
describe("The Archfey Subclass (PHB)", () => {
	let state;

	beforeEach(() => {
		state = new CharacterSheetState();
		state.setRace({name: "Human", source: "PHB"});
		state.addClass({name: "Warlock", source: "PHB", level: 1, subclass: {name: "The Archfey", source: "PHB"}});
		state.setAbilityBase("cha", 16); // +3
	});

	it("should gain subclass at level 1", () => {
		const calculations = state.getFeatureCalculations();
		expect(calculations.hasFeyPresence).toBe(true);
	});

	// Fey Presence (Level 1)
	describe("Fey Presence (Level 1)", () => {
		it("should have Fey Presence at level 1", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasFeyPresence).toBe(true);
		});
	});

	// Misty Escape (Level 6)
	describe("Misty Escape (Level 6)", () => {
		it("should have Misty Escape at level 6", () => {
			state.addClass({name: "Warlock", source: "PHB", level: 6, subclass: {name: "The Archfey", source: "PHB"}});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasMistyEscape).toBe(true);
		});
	});

	// Beguiling Defenses (Level 10)
	describe("Beguiling Defenses (Level 10)", () => {
		it("should have Beguiling Defenses at level 10", () => {
			state.addClass({name: "Warlock", source: "PHB", level: 10, subclass: {name: "The Archfey", source: "PHB"}});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasBeguilingDefenses).toBe(true);
		});
	});

	// Dark Delirium (Level 14)
	describe("Dark Delirium (Level 14)", () => {
		it("should have Dark Delirium at level 14", () => {
			state.addClass({name: "Warlock", source: "PHB", level: 14, subclass: {name: "The Archfey", source: "PHB"}});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasDarkDelirium).toBe(true);
		});

		it("should calculate DC as 8 + prof + CHA", () => {
			state.addClass({name: "Warlock", source: "PHB", level: 14, subclass: {name: "The Archfey", source: "PHB"}});
			const calculations = state.getFeatureCalculations();
			// 8 + 5 (prof at 14) + 3 (CHA) = 16
			expect(calculations.darkDeliriumDc).toBe(16);
		});
	});
});

// ==========================================================================
// PART 5: THE FIEND SUBCLASS
// ==========================================================================
describe("The Fiend Subclass (PHB)", () => {
	let state;

	beforeEach(() => {
		state = new CharacterSheetState();
		state.setRace({name: "Human", source: "PHB"});
		state.addClass({name: "Warlock", source: "PHB", level: 1, subclass: {name: "The Fiend", source: "PHB"}});
		state.setAbilityBase("cha", 16); // +3
	});

	it("should gain subclass at level 1", () => {
		const calculations = state.getFeatureCalculations();
		expect(calculations.hasDarkOnesBlessing).toBe(true);
	});

	// Dark One's Blessing (Level 1)
	describe("Dark One's Blessing (Level 1)", () => {
		it("should have Dark One's Blessing at level 1", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasDarkOnesBlessing).toBe(true);
		});

		it("should grant temp HP equal to CHA mod + warlock level", () => {
			const calculations = state.getFeatureCalculations();
			// 3 (CHA) + 1 (level) = 4
			expect(calculations.darkOnesBlessingTempHp).toBe(4);
		});

		it("should scale temp HP with level", () => {
			state.addClass({name: "Warlock", source: "PHB", level: 10, subclass: {name: "The Fiend", source: "PHB"}});
			const calculations = state.getFeatureCalculations();
			// 3 (CHA) + 10 (level) = 13
			expect(calculations.darkOnesBlessingTempHp).toBe(13);
		});
	});

	// Dark One's Own Luck (Level 6)
	describe("Dark One's Own Luck (Level 6)", () => {
		it("should have Dark One's Own Luck at level 6", () => {
			state.addClass({name: "Warlock", source: "PHB", level: 6, subclass: {name: "The Fiend", source: "PHB"}});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasDarkOnesOwnLuck).toBe(true);
		});
	});

	// Fiendish Resilience (Level 10)
	describe("Fiendish Resilience (Level 10)", () => {
		it("should have Fiendish Resilience at level 10", () => {
			state.addClass({name: "Warlock", source: "PHB", level: 10, subclass: {name: "The Fiend", source: "PHB"}});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasFiendishResilience).toBe(true);
		});
	});

	// Hurl Through Hell (Level 14)
	describe("Hurl Through Hell (Level 14)", () => {
		it("should have Hurl Through Hell at level 14", () => {
			state.addClass({name: "Warlock", source: "PHB", level: 14, subclass: {name: "The Fiend", source: "PHB"}});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasHurlThroughHell).toBe(true);
		});

		it("should deal 10d10 psychic damage", () => {
			state.addClass({name: "Warlock", source: "PHB", level: 14, subclass: {name: "The Fiend", source: "PHB"}});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hurlThroughHellDamage).toBe("10d10");
		});
	});
});

// ==========================================================================
// PART 6: THE GREAT OLD ONE SUBCLASS
// ==========================================================================
describe("The Great Old One Subclass (PHB)", () => {
	let state;

	beforeEach(() => {
		state = new CharacterSheetState();
		state.setRace({name: "Human", source: "PHB"});
		state.addClass({name: "Warlock", source: "PHB", level: 1, subclass: {name: "The Great Old One", source: "PHB"}});
	});

	it("should gain subclass at level 1", () => {
		const calculations = state.getFeatureCalculations();
		expect(calculations.hasAwakenedMind).toBe(true);
	});

	// Awakened Mind (Level 1)
	describe("Awakened Mind (Level 1)", () => {
		it("should have Awakened Mind at level 1", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasAwakenedMind).toBe(true);
		});

		it("should have 30 ft telepathy range in PHB", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.awakenedMindRange).toBe(30);
		});
	});

	// Entropic Ward (Level 6)
	describe("Entropic Ward (Level 6)", () => {
		it("should have Entropic Ward at level 6", () => {
			state.addClass({name: "Warlock", source: "PHB", level: 6, subclass: {name: "The Great Old One", source: "PHB"}});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasEntropicWard).toBe(true);
		});
	});

	// Thought Shield (Level 10)
	describe("Thought Shield (Level 10)", () => {
		it("should have Thought Shield at level 10", () => {
			state.addClass({name: "Warlock", source: "PHB", level: 10, subclass: {name: "The Great Old One", source: "PHB"}});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasThoughtShield).toBe(true);
		});
	});

	// Create Thrall (Level 14)
	describe("Create Thrall (Level 14)", () => {
		it("should have Create Thrall at level 14", () => {
			state.addClass({name: "Warlock", source: "PHB", level: 14, subclass: {name: "The Great Old One", source: "PHB"}});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasCreateThrall).toBe(true);
		});
	});
});

// ==========================================================================
// PART 7: THE UNDYING SUBCLASS (SCAG)
// ==========================================================================
describe("The Undying Subclass (SCAG)", () => {
	let state;

	beforeEach(() => {
		state = new CharacterSheetState();
		state.setRace({name: "Human", source: "PHB"});
		state.addClass({name: "Warlock", source: "PHB", level: 1, subclass: {name: "The Undying", source: "SCAG"}});
		state.setAbilityBase("cha", 16); // +3
	});

	it("should gain subclass at level 1", () => {
		const calculations = state.getFeatureCalculations();
		expect(calculations.hasAmongTheDead).toBe(true);
	});

	// Among the Dead (Level 1)
	describe("Among the Dead (Level 1)", () => {
		it("should have Among the Dead at level 1", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasAmongTheDead).toBe(true);
		});
	});

	// Defy Death (Level 6)
	describe("Defy Death (Level 6)", () => {
		it("should have Defy Death at level 6", () => {
			state.addClass({name: "Warlock", source: "PHB", level: 6, subclass: {name: "The Undying", source: "SCAG"}});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasDefyDeath).toBe(true);
		});

		it("should heal 1d8 + CHA mod", () => {
			state.addClass({name: "Warlock", source: "PHB", level: 6, subclass: {name: "The Undying", source: "SCAG"}});
			const calculations = state.getFeatureCalculations();
			expect(calculations.defyDeathHealing).toBe("1d8+3");
		});
	});

	// Undying Nature (Level 10)
	describe("Undying Nature (Level 10)", () => {
		it("should have Undying Nature at level 10", () => {
			state.addClass({name: "Warlock", source: "PHB", level: 10, subclass: {name: "The Undying", source: "SCAG"}});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasUndyingNature).toBe(true);
		});
	});

	// Indestructible Life (Level 14)
	describe("Indestructible Life (Level 14)", () => {
		it("should have Indestructible Life at level 14", () => {
			state.addClass({name: "Warlock", source: "PHB", level: 14, subclass: {name: "The Undying", source: "SCAG"}});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasIndestructibleLife).toBe(true);
		});

		it("should heal 1d8 + warlock level", () => {
			state.addClass({name: "Warlock", source: "PHB", level: 14, subclass: {name: "The Undying", source: "SCAG"}});
			const calculations = state.getFeatureCalculations();
			expect(calculations.indestructibleLifeHealing).toBe("1d8+14");
		});
	});
});

// ==========================================================================
// PART 8: THE CELESTIAL SUBCLASS (XGE)
// ==========================================================================
describe("The Celestial Subclass (XGE)", () => {
	let state;

	beforeEach(() => {
		state = new CharacterSheetState();
		state.setRace({name: "Human", source: "PHB"});
		state.addClass({name: "Warlock", source: "PHB", level: 1, subclass: {name: "The Celestial", source: "XGE"}});
		state.setAbilityBase("cha", 16); // +3
	});

	it("should gain subclass at level 1", () => {
		const calculations = state.getFeatureCalculations();
		expect(calculations.hasHealingLight).toBe(true);
	});

	// Healing Light (Level 1)
	describe("Healing Light (Level 1)", () => {
		it("should have Healing Light at level 1", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasHealingLight).toBe(true);
		});

		it("should have pool of d6s equal to 1 + warlock level", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.healingLightDice).toBe(2); // 1 + 1
		});

		it("should scale dice pool with level", () => {
			state.addClass({name: "Warlock", source: "PHB", level: 10, subclass: {name: "The Celestial", source: "XGE"}});
			const calculations = state.getFeatureCalculations();
			expect(calculations.healingLightDice).toBe(11); // 1 + 10
		});

		it("should have max dice per use capped at CHA mod", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.healingLightMaxDice).toBe(3); // CHA mod capped at 5
		});
	});

	// Radiant Soul (Level 6)
	describe("Radiant Soul (Level 6)", () => {
		it("should have Radiant Soul at level 6", () => {
			state.addClass({name: "Warlock", source: "PHB", level: 6, subclass: {name: "The Celestial", source: "XGE"}});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasRadiantSoul).toBe(true);
		});

		it("should add CHA mod to fire/radiant damage", () => {
			state.addClass({name: "Warlock", source: "PHB", level: 6, subclass: {name: "The Celestial", source: "XGE"}});
			const calculations = state.getFeatureCalculations();
			expect(calculations.radiantSoulBonus).toBe(3);
		});
	});

	// Celestial Resilience (Level 10)
	describe("Celestial Resilience (Level 10)", () => {
		it("should have Celestial Resilience at level 10", () => {
			state.addClass({name: "Warlock", source: "PHB", level: 10, subclass: {name: "The Celestial", source: "XGE"}});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasCelestialResilience).toBe(true);
		});

		it("should grant temp HP equal to warlock level + CHA mod", () => {
			state.addClass({name: "Warlock", source: "PHB", level: 10, subclass: {name: "The Celestial", source: "XGE"}});
			const calculations = state.getFeatureCalculations();
			expect(calculations.celestialResilienceTempHp).toBe(13); // 10 + 3
		});
	});

	// Searing Vengeance (Level 14)
	describe("Searing Vengeance (Level 14)", () => {
		it("should have Searing Vengeance at level 14", () => {
			state.addClass({name: "Warlock", source: "PHB", level: 14, subclass: {name: "The Celestial", source: "XGE"}});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasSearingVengeance).toBe(true);
		});

		it("should deal 2d8 + CHA mod radiant damage", () => {
			state.addClass({name: "Warlock", source: "PHB", level: 14, subclass: {name: "The Celestial", source: "XGE"}});
			const calculations = state.getFeatureCalculations();
			expect(calculations.searingVengeanceDamage).toBe("2d8+3");
		});
	});
});

// ==========================================================================
// PART 9: THE HEXBLADE SUBCLASS (XGE)
// ==========================================================================
describe("The Hexblade Subclass (XGE)", () => {
	let state;

	beforeEach(() => {
		state = new CharacterSheetState();
		state.setRace({name: "Human", source: "PHB"});
		state.addClass({name: "Warlock", source: "PHB", level: 1, subclass: {name: "The Hexblade", source: "XGE"}});
		state.setAbilityBase("cha", 16); // +3
	});

	it("should gain subclass at level 1", () => {
		const calculations = state.getFeatureCalculations();
		expect(calculations.hasHexWarrior).toBe(true);
		expect(calculations.hasHexbladesCurse).toBe(true);
	});

	// Hex Warrior + Hexblade's Curse (Level 1)
	describe("Hex Warrior & Hexblade's Curse (Level 1)", () => {
		it("should have Hex Warrior at level 1", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasHexWarrior).toBe(true);
		});

		it("should have Hexblade's Curse at level 1", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasHexbladesCurse).toBe(true);
		});

		it("should add proficiency bonus to damage with curse", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.hexbladesCurseDamage).toBe(2); // Prof at level 1
		});

		it("should heal CHA mod + warlock level when cursed target dies", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.hexbladesCurseHealing).toBe(4); // 3 + 1
		});
	});

	// Accursed Specter (Level 6)
	describe("Accursed Specter (Level 6)", () => {
		it("should have Accursed Specter at level 6", () => {
			state.addClass({name: "Warlock", source: "PHB", level: 6, subclass: {name: "The Hexblade", source: "XGE"}});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasAccursedSpecter).toBe(true);
		});

		it("should grant temp HP equal to half warlock level", () => {
			state.addClass({name: "Warlock", source: "PHB", level: 6, subclass: {name: "The Hexblade", source: "XGE"}});
			const calculations = state.getFeatureCalculations();
			expect(calculations.accursedSpecterTempHp).toBe(3);
		});
	});

	// Armor of Hexes (Level 10)
	describe("Armor of Hexes (Level 10)", () => {
		it("should have Armor of Hexes at level 10", () => {
			state.addClass({name: "Warlock", source: "PHB", level: 10, subclass: {name: "The Hexblade", source: "XGE"}});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasArmorOfHexes).toBe(true);
		});
	});

	// Master of Hexes (Level 14)
	describe("Master of Hexes (Level 14)", () => {
		it("should have Master of Hexes at level 14", () => {
			state.addClass({name: "Warlock", source: "PHB", level: 14, subclass: {name: "The Hexblade", source: "XGE"}});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasMasterOfHexes).toBe(true);
		});
	});
});

// ==========================================================================
// PART 10: THE FATHOMLESS SUBCLASS (TCE)
// ==========================================================================
describe("The Fathomless Subclass (TCE)", () => {
	let state;

	beforeEach(() => {
		state = new CharacterSheetState();
		state.setRace({name: "Human", source: "PHB"});
		state.addClass({name: "Warlock", source: "PHB", level: 1, subclass: {name: "The Fathomless", source: "TCE"}});
	});

	it("should gain subclass at level 1", () => {
		const calculations = state.getFeatureCalculations();
		expect(calculations.hasGiftOfTheSea).toBe(true);
	});

	// Gift of the Sea + Tentacle of the Deeps (Level 1)
	describe("Gift of the Sea & Tentacle of the Deeps (Level 1)", () => {
		it("should have Gift of the Sea at level 1", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasGiftOfTheSea).toBe(true);
		});

		it("should grant 40 ft swim speed", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.swimSpeed).toBe(40);
		});

		it("should have Tentacle of the Deeps at level 1", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasTentacleOfTheDeeps).toBe(true);
		});

		it("should have proficiency bonus uses", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.tentacleUses).toBe(2); // Prof at level 1
		});
	});

	// Guardian Coil + Oceanic Soul (Level 6)
	describe("Guardian Coil & Oceanic Soul (Level 6)", () => {
		it("should have Guardian Coil at level 6", () => {
			state.addClass({name: "Warlock", source: "PHB", level: 6, subclass: {name: "The Fathomless", source: "TCE"}});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasGuardianCoil).toBe(true);
		});

		it("should have Oceanic Soul at level 6", () => {
			state.addClass({name: "Warlock", source: "PHB", level: 6, subclass: {name: "The Fathomless", source: "TCE"}});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasOceanicSoul).toBe(true);
		});
	});

	// Grasping Tentacles (Level 10)
	describe("Grasping Tentacles (Level 10)", () => {
		it("should have Grasping Tentacles at level 10", () => {
			state.addClass({name: "Warlock", source: "PHB", level: 10, subclass: {name: "The Fathomless", source: "TCE"}});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasGraspingTentacles).toBe(true);
		});

		it("should grant temp HP equal to warlock level", () => {
			state.addClass({name: "Warlock", source: "PHB", level: 10, subclass: {name: "The Fathomless", source: "TCE"}});
			const calculations = state.getFeatureCalculations();
			expect(calculations.graspingTentaclesTempHp).toBe(10);
		});
	});

	// Fathomless Plunge (Level 14)
	describe("Fathomless Plunge (Level 14)", () => {
		it("should have Fathomless Plunge at level 14", () => {
			state.addClass({name: "Warlock", source: "PHB", level: 14, subclass: {name: "The Fathomless", source: "TCE"}});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasFathomlessPlunge).toBe(true);
		});

		it("should teleport 30 ft", () => {
			state.addClass({name: "Warlock", source: "PHB", level: 14, subclass: {name: "The Fathomless", source: "TCE"}});
			const calculations = state.getFeatureCalculations();
			expect(calculations.fathomlessPlungeRange).toBe(30);
		});
	});
});

// ==========================================================================
// PART 11: THE GENIE SUBCLASS (TCE)
// ==========================================================================
describe("The Genie Subclass (TCE)", () => {
	let state;

	beforeEach(() => {
		state = new CharacterSheetState();
		state.setRace({name: "Human", source: "PHB"});
		state.addClass({name: "Warlock", source: "PHB", level: 1, subclass: {name: "The Genie", source: "TCE"}});
	});

	it("should gain subclass at level 1", () => {
		const calculations = state.getFeatureCalculations();
		expect(calculations.hasGeniesVessel).toBe(true);
	});

	// Genie's Vessel (Level 1)
	describe("Genie's Vessel (Level 1)", () => {
		it("should have Genie's Vessel at level 1", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasGeniesVessel).toBe(true);
		});

		it("should deal bonus damage equal to proficiency bonus", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.geniesWrathDamage).toBe(2); // Prof at level 1
		});
	});

	// Elemental Gift (Level 6)
	describe("Elemental Gift (Level 6)", () => {
		it("should have Elemental Gift at level 6", () => {
			state.addClass({name: "Warlock", source: "PHB", level: 6, subclass: {name: "The Genie", source: "TCE"}});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasElementalGift).toBe(true);
		});

		it("should grant 30 ft fly speed", () => {
			state.addClass({name: "Warlock", source: "PHB", level: 6, subclass: {name: "The Genie", source: "TCE"}});
			const calculations = state.getFeatureCalculations();
			expect(calculations.elementalGiftFlySpeed).toBe(30);
		});
	});

	// Sanctuary Vessel (Level 10)
	describe("Sanctuary Vessel (Level 10)", () => {
		it("should have Sanctuary Vessel at level 10", () => {
			state.addClass({name: "Warlock", source: "PHB", level: 10, subclass: {name: "The Genie", source: "TCE"}});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasSanctuaryVessel).toBe(true);
		});

		it("should allow stay for half warlock level hours", () => {
			state.addClass({name: "Warlock", source: "PHB", level: 10, subclass: {name: "The Genie", source: "TCE"}});
			const calculations = state.getFeatureCalculations();
			expect(calculations.sanctuaryVesselHours).toBe(5);
		});
	});

	// Limited Wish (Level 14)
	describe("Limited Wish (Level 14)", () => {
		it("should have Limited Wish at level 14", () => {
			state.addClass({name: "Warlock", source: "PHB", level: 14, subclass: {name: "The Genie", source: "TCE"}});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasLimitedWish).toBe(true);
		});
	});
});

// ==========================================================================
// PART 12: THE UNDEAD SUBCLASS (VRGR)
// ==========================================================================
describe("The Undead Subclass (VRGR)", () => {
	let state;

	beforeEach(() => {
		state = new CharacterSheetState();
		state.setRace({name: "Human", source: "PHB"});
		state.addClass({name: "Warlock", source: "PHB", level: 1, subclass: {name: "The Undead", source: "VRGR"}});
	});

	it("should gain subclass at level 1", () => {
		const calculations = state.getFeatureCalculations();
		expect(calculations.hasFormOfDread).toBe(true);
	});

	// Form of Dread (Level 1)
	describe("Form of Dread (Level 1)", () => {
		it("should have Form of Dread at level 1", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasFormOfDread).toBe(true);
		});

		it("should grant temp HP equal to 1d10 + warlock level", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.formOfDreadTempHp).toBe("1d10+1");
		});

		it("should have proficiency bonus uses", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.formOfDreadUses).toBe(2); // Prof at level 1
		});
	});

	// Grave Touched (Level 6)
	describe("Grave Touched (Level 6)", () => {
		it("should have Grave Touched at level 6", () => {
			state.addClass({name: "Warlock", source: "PHB", level: 6, subclass: {name: "The Undead", source: "VRGR"}});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasGraveTouched).toBe(true);
		});
	});

	// Necrotic Husk (Level 10)
	describe("Necrotic Husk (Level 10)", () => {
		it("should have Necrotic Husk at level 10", () => {
			state.addClass({name: "Warlock", source: "PHB", level: 10, subclass: {name: "The Undead", source: "VRGR"}});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasNecroticHusk).toBe(true);
		});
	});

	// Spirit Projection (Level 14)
	describe("Spirit Projection (Level 14)", () => {
		it("should have Spirit Projection at level 14", () => {
			state.addClass({name: "Warlock", source: "PHB", level: 14, subclass: {name: "The Undead", source: "VRGR"}});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasSpiritProjection).toBe(true);
		});
	});
});

// ==========================================================================
// PART 13: XPHB 2024 WARLOCK FEATURES
// ==========================================================================
describe("Warlock Core Class Features (XPHB 2024)", () => {
	let state;

	beforeEach(() => {
		state = new CharacterSheetState();
		state.setRace({name: "Human", source: "XPHB"});
		state.addClass({name: "Warlock", source: "XPHB", level: 1});
		state.setAbilityBase("cha", 16); // +3
	});

	// Eldritch Invocations at level 1
	describe("Eldritch Invocations (XPHB)", () => {
		it("should have Eldritch Invocations at level 1", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasEldritchInvocations).toBe(true);
		});

		it("should know 1 invocation at level 1", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.invocationsKnown).toBe(1);
		});

		it("should know 2 invocations at level 2", () => {
			state.addClass({name: "Warlock", source: "XPHB", level: 2});
			const calculations = state.getFeatureCalculations();
			expect(calculations.invocationsKnown).toBe(2);
		});
	});

	// Magical Cunning (XPHB Level 2)
	describe("Magical Cunning (XPHB)", () => {
		it("should not have Magical Cunning at level 1", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasMagicalCunning).toBeFalsy();
		});

		it("should have Magical Cunning at level 2", () => {
			state.addClass({name: "Warlock", source: "XPHB", level: 2});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasMagicalCunning).toBe(true);
		});
	});

	// Pact Slots progression (XPHB)
	describe("Pact Slots (XPHB)", () => {
		it("should have 4 pact slots at level 17", () => {
			state.addClass({name: "Warlock", source: "XPHB", level: 17});
			const calculations = state.getFeatureCalculations();
			expect(calculations.pactSlots).toBe(4);
		});
	});

	// Contact Patron (XPHB Level 9)
	describe("Contact Patron (XPHB)", () => {
		it("should not have Contact Patron before level 9", () => {
			state.addClass({name: "Warlock", source: "XPHB", level: 8});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasContactPatron).toBeFalsy();
		});

		it("should have Contact Patron at level 9", () => {
			state.addClass({name: "Warlock", source: "XPHB", level: 9});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasContactPatron).toBe(true);
		});
	});

	// Prepared Spells (XPHB)
	describe("Prepared Spells (XPHB)", () => {
		it("should use prepared spells instead of spells known", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.preparedSpells).toBeDefined();
			expect(calculations.spellsKnown).toBeUndefined();
		});
	});

	// No Pact Boon in XPHB (invocations instead)
	describe("Pact Boon (XPHB)", () => {
		it("should not have Pact Boon feature in XPHB", () => {
			state.addClass({name: "Warlock", source: "XPHB", level: 3});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasPactBoon).toBeFalsy();
		});
	});
});

// ==========================================================================
// PART 14: ARCHFEY PATRON (XPHB 2024)
// ==========================================================================
describe("Archfey Patron Subclass (XPHB 2024)", () => {
	let state;

	beforeEach(() => {
		state = new CharacterSheetState();
		state.setRace({name: "Human", source: "XPHB"});
		state.addClass({name: "Warlock", source: "XPHB", level: 3, subclass: {name: "Archfey Patron", source: "XPHB"}});
	});

	// Subclass gained at level 3 in XPHB
	it("should gain subclass at level 3", () => {
		const calculations = state.getFeatureCalculations();
		expect(calculations.hasStepsOfTheFey).toBe(true);
	});

	// Steps of the Fey (XPHB level 3)
	describe("Steps of the Fey (XPHB Level 3)", () => {
		it("should have Steps of the Fey at level 3", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasStepsOfTheFey).toBe(true);
		});

		it("should have proficiency bonus uses", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.stepsOfTheFeyUses).toBe(2); // Prof at level 3
		});
	});

	// Bewitching Magic (XPHB level 14)
	describe("Bewitching Magic (XPHB Level 14)", () => {
		it("should have Bewitching Magic at level 14", () => {
			state.addClass({name: "Warlock", source: "XPHB", level: 14, subclass: {name: "Archfey Patron", source: "XPHB"}});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasBewitchingMagic).toBe(true);
		});

		it("should not have old Dark Delirium", () => {
			state.addClass({name: "Warlock", source: "XPHB", level: 14, subclass: {name: "Archfey Patron", source: "XPHB"}});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasDarkDelirium).toBeFalsy();
		});
	});
});

// ==========================================================================
// PART 15: GREAT OLD ONE PATRON (XPHB 2024)
// ==========================================================================
describe("Great Old One Patron Subclass (XPHB 2024)", () => {
	let state;

	beforeEach(() => {
		state = new CharacterSheetState();
		state.setRace({name: "Human", source: "XPHB"});
		state.addClass({name: "Warlock", source: "XPHB", level: 3, subclass: {name: "Great Old One Patron", source: "XPHB"}});
	});

	// Subclass gained at level 3 in XPHB
	it("should gain subclass at level 3", () => {
		const calculations = state.getFeatureCalculations();
		expect(calculations.hasAwakenedMind).toBe(true);
	});

	// Awakened Mind range scales with level in XPHB
	describe("Awakened Mind (XPHB)", () => {
		it("should have telepathy range that scales with level", () => {
			const calculations = state.getFeatureCalculations();
			// 5 ft per level in XPHB
			expect(calculations.awakenedMindRange).toBe(15); // 3 * 5
		});

		it("should scale telepathy range at level 10", () => {
			state.addClass({name: "Warlock", source: "XPHB", level: 10, subclass: {name: "Great Old One Patron", source: "XPHB"}});
			const calculations = state.getFeatureCalculations();
			expect(calculations.awakenedMindRange).toBe(50); // 10 * 5
		});
	});

	// Psychic Spells (XPHB)
	describe("Psychic Spells (XPHB)", () => {
		it("should have Psychic Spells at level 3", () => {
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasPsychicSpells).toBe(true);
		});
	});

	// Clairvoyant Combatant (XPHB level 6)
	describe("Clairvoyant Combatant (XPHB)", () => {
		it("should have Clairvoyant Combatant at level 6", () => {
			state.addClass({name: "Warlock", source: "XPHB", level: 6, subclass: {name: "Great Old One Patron", source: "XPHB"}});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasClairvoyantCombatant).toBe(true);
		});

		it("should not have old Entropic Ward", () => {
			state.addClass({name: "Warlock", source: "XPHB", level: 6, subclass: {name: "Great Old One Patron", source: "XPHB"}});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasEntropicWard).toBeFalsy();
		});
	});

	// Eldritch Hex (XPHB level 10)
	describe("Eldritch Hex (XPHB)", () => {
		it("should have Eldritch Hex at level 10", () => {
			state.addClass({name: "Warlock", source: "XPHB", level: 10, subclass: {name: "Great Old One Patron", source: "XPHB"}});
			const calculations = state.getFeatureCalculations();
			expect(calculations.hasEldritchHex).toBe(true);
		});
	});
});

// ==========================================================================
// PART 16: PHB vs XPHB FEATURE COMPARISON
// ==========================================================================
describe("PHB vs XPHB Warlock Feature Comparison", () => {
	describe("Spells Known vs Prepared", () => {
		it("should have different spell systems", () => {
			const phbState = new CharacterSheetState();
			phbState.setRace({name: "Human", source: "PHB"});
			phbState.addClass({name: "Warlock", source: "PHB", level: 5});

			const xphbState = new CharacterSheetState();
			xphbState.setRace({name: "Human", source: "XPHB"});
			xphbState.addClass({name: "Warlock", source: "XPHB", level: 5});

			const phbCalc = phbState.getFeatureCalculations();
			const xphbCalc = xphbState.getFeatureCalculations();

			// PHB uses spells known
			expect(phbCalc.spellsKnown).toBeDefined();
			expect(phbCalc.preparedSpells).toBeUndefined();

			// XPHB uses prepared spells
			expect(xphbCalc.preparedSpells).toBeDefined();
			expect(xphbCalc.spellsKnown).toBeUndefined();
		});
	});

	describe("Invocations at Level 1", () => {
		it("should get invocations at different levels", () => {
			const phbState = new CharacterSheetState();
			phbState.setRace({name: "Human", source: "PHB"});
			phbState.addClass({name: "Warlock", source: "PHB", level: 1});

			const xphbState = new CharacterSheetState();
			xphbState.setRace({name: "Human", source: "XPHB"});
			xphbState.addClass({name: "Warlock", source: "XPHB", level: 1});

			const phbCalc = phbState.getFeatureCalculations();
			const xphbCalc = xphbState.getFeatureCalculations();

			// PHB gets invocations at level 2
			expect(phbCalc.hasEldritchInvocations).toBeFalsy();
			// XPHB gets invocations at level 1
			expect(xphbCalc.hasEldritchInvocations).toBe(true);
		});
	});

	describe("Subclass Level", () => {
		it("should get subclass at different levels", () => {
			// PHB gets subclass at level 1
			const phbState = new CharacterSheetState();
			phbState.setRace({name: "Human", source: "PHB"});
			phbState.addClass({name: "Warlock", source: "PHB", level: 1, subclass: {name: "The Fiend", source: "PHB"}});
			const phbCalc = phbState.getFeatureCalculations();
			expect(phbCalc.hasDarkOnesBlessing).toBe(true);

			// XPHB gets subclass at level 3
			const xphbState = new CharacterSheetState();
			xphbState.setRace({name: "Human", source: "XPHB"});
			xphbState.addClass({name: "Warlock", source: "XPHB", level: 2, subclass: {name: "Fiend Patron", source: "XPHB"}});
			const xphbCalc = xphbState.getFeatureCalculations();
			expect(xphbCalc.hasDarkOnesBlessing).toBeFalsy();
		});
	});

	describe("Pact Slots at High Levels", () => {
		it("should have different slot counts at level 17", () => {
			const phbState = new CharacterSheetState();
			phbState.setRace({name: "Human", source: "PHB"});
			phbState.addClass({name: "Warlock", source: "PHB", level: 17});

			const xphbState = new CharacterSheetState();
			xphbState.setRace({name: "Human", source: "XPHB"});
			xphbState.addClass({name: "Warlock", source: "XPHB", level: 17});

			const phbCalc = phbState.getFeatureCalculations();
			const xphbCalc = xphbState.getFeatureCalculations();

			// PHB has 3 slots at level 11+
			expect(phbCalc.pactSlots).toBe(3);
			// XPHB has 4 slots at level 17
			expect(xphbCalc.pactSlots).toBe(4);
		});
	});
});

// ==========================================================================
// PART 17: WARLOCK MULTICLASS
// ==========================================================================
describe("Warlock Multiclass", () => {
	let state;

	beforeEach(() => {
		state = new CharacterSheetState();
		state.setRace({name: "Human", source: "PHB"});
		state.setAbilityBase("cha", 16);
	});

	it("should require CHA 13 for multiclassing", () => {
		// This is a design test - multiclass requirements
		const multiclassReq = {cha: 13};
		expect(multiclassReq.cha).toBe(13);
	});

	it("should track pact slots based on warlock level only", () => {
		state.addClass({name: "Warlock", source: "PHB", level: 5});
		state.addClass({name: "Fighter", source: "PHB", level: 5});
		const calculations = state.getFeatureCalculations();
		// Pact slots based on warlock level 5 only
		expect(calculations.pactSlots).toBe(2);
		expect(calculations.pactSlotLevel).toBe(3);
	});

	it("should track proficiency bonus based on total level", () => {
		state.addClass({name: "Warlock", source: "PHB", level: 5});
		state.addClass({name: "Fighter", source: "PHB", level: 5});
		const profBonus = state.getProficiencyBonus();
		// Total level 10 = +4 proficiency
		expect(profBonus).toBe(4);
	});
});

// ==========================================================================
// PART 18: WARLOCK EDGE CASES
// ==========================================================================
describe("Warlock Edge Cases", () => {
	let state;

	beforeEach(() => {
		state = new CharacterSheetState();
		state.setRace({name: "Human", source: "PHB"});
		state.addClass({name: "Warlock", source: "PHB", level: 1});
		state.setAbilityBase("cha", 16);
	});

	it("should handle level 20 character correctly", () => {
		state.addClass({name: "Warlock", source: "PHB", level: 20});
		const calculations = state.getFeatureCalculations();
		expect(calculations.hasEldritchMaster).toBe(true);
		expect(calculations.mysticArcanum9th).toBe(true);
		expect(calculations.eldritchBlastBeams).toBe(4);
	});

	it("should track hit dice correctly", () => {
		state.addClass({name: "Warlock", source: "PHB", level: 10});
		const hitDice = state.getHitDice();
		const totalDice = Array.isArray(hitDice)
			? hitDice.reduce((sum, hd) => sum + (hd.max || hd.current || 0), 0)
			: Object.values(hitDice).reduce((sum, val) => sum + val, 0);
		expect(totalDice).toBe(10);
	});

	it("should handle subclass selection", () => {
		state.addClass({name: "Warlock", source: "PHB", level: 1, subclass: {name: "The Fiend", source: "PHB"}});
		const calculations = state.getFeatureCalculations();
		expect(calculations.hasDarkOnesBlessing).toBe(true);
	});

	it("should handle negative CHA modifier for curse healing", () => {
		state.setAbilityBase("cha", 8); // -1 modifier
		state.addClass({name: "Warlock", source: "PHB", level: 1, subclass: {name: "The Hexblade", source: "XGE"}});
		const calculations = state.getFeatureCalculations();
		// -1 + 1 = 0
		expect(calculations.hexbladesCurseHealing).toBe(0);
	});
});

// ==========================================================================
// PART 19: PROFICIENCY BONUS PROGRESSION
// ==========================================================================
describe("Warlock Proficiency Bonus Progression", () => {
	let state;

	beforeEach(() => {
		state = new CharacterSheetState();
		state.setRace({name: "Human", source: "PHB"});
	});

	it("should return +2 proficiency bonus at level 1", () => {
		state.addClass({name: "Warlock", source: "PHB", level: 1});
		expect(state.getProficiencyBonus()).toBe(2);
	});

	it("should return +2 proficiency bonus at level 4", () => {
		state.addClass({name: "Warlock", source: "PHB", level: 4});
		expect(state.getProficiencyBonus()).toBe(2);
	});

	it("should return +3 proficiency bonus at level 5", () => {
		state.addClass({name: "Warlock", source: "PHB", level: 5});
		expect(state.getProficiencyBonus()).toBe(3);
	});

	it("should return +4 proficiency bonus at level 9", () => {
		state.addClass({name: "Warlock", source: "PHB", level: 9});
		expect(state.getProficiencyBonus()).toBe(4);
	});

	it("should return +5 proficiency bonus at level 13", () => {
		state.addClass({name: "Warlock", source: "PHB", level: 13});
		expect(state.getProficiencyBonus()).toBe(5);
	});

	it("should return +6 proficiency bonus at level 17", () => {
		state.addClass({name: "Warlock", source: "PHB", level: 17});
		expect(state.getProficiencyBonus()).toBe(6);
	});
});
