/**
 * Tests for Spell Scribing Adept feat (TGTT).
 *
 * The Spell Scribing Adept feat from Traveler's Guide to Thelemar allows:
 * - Choose a class (Bard, Sorcerer, or Warlock) to create a scribing spellbook
 * - Start with 2 1st-level spells from that class's spell list
 * - Memorize one spell after a long rest (10 min studying)
 * - Memorized spell is cast using spell slots, with CHA as casting ability
 * - Max spell level = ceil(class level / 2)
 * - Copy new spells: 2 hrs/level, 50 gp/level
 */

import "./setup.js";

let CharacterSheetState;
let state;

beforeAll(async () => {
	CharacterSheetState = (await import("../../../js/charactersheet/charactersheet-state.js")).CharacterSheetState;
});

describe("Spell Scribing Adept", () => {
	beforeEach(() => {
		state = new CharacterSheetState();
	});

	// =========================================================================
	// HELPERS
	// =========================================================================

	const createBardWithFeat = (level = 4) => {
		state.addClass({
			name: "Bard",
			source: "PHB",
			level,
			subclass: null,
		});
		state.addFeat({
			name: "Spell Scribing Adept",
			source: "TGTT",
			choices: {scribingClass: "Bard"},
		});
	};

	const createSorcererWithFeat = (level = 4) => {
		state.addClass({
			name: "Sorcerer",
			source: "PHB",
			level,
			subclass: null,
		});
		state.addFeat({
			name: "Spell Scribing Adept",
			source: "TGTT",
			choices: {scribingClass: "Sorcerer"},
		});
	};

	const createWarlockWithFeat = (level = 4) => {
		state.addClass({
			name: "Warlock",
			source: "PHB",
			level,
			subclass: null,
		});
		state.addFeat({
			name: "Spell Scribing Adept",
			source: "TGTT",
			choices: {scribingClass: "Warlock"},
		});
	};

	const makeSpell = (name, level, source = "PHB") => ({
		id: `${name}|${source}`,
		name,
		source,
		level,
		school: "V",
		castingTime: "1 action",
		range: "60 feet",
		duration: "Instantaneous",
		components: "V, S",
	});

	// =========================================================================
	// STATE: SCRIBING CLASS
	// =========================================================================

	describe("Scribing class", () => {
		test("should set scribing class when feat is added with choices", () => {
			createBardWithFeat();
			expect(state.getScribingClass()).toBe("Bard");
		});

		test("should set scribing class for Sorcerer", () => {
			createSorcererWithFeat();
			expect(state.getScribingClass()).toBe("Sorcerer");
		});

		test("should set scribing class for Warlock", () => {
			createWarlockWithFeat();
			expect(state.getScribingClass()).toBe("Warlock");
		});

		test("should read scribing class from _featChoices too", () => {
			state.addClass({name: "Bard", source: "PHB", level: 4});
			state.addFeat({
				name: "Spell Scribing Adept",
				source: "TGTT",
				_featChoices: {scribingClass: "Bard"},
			});
			expect(state.getScribingClass()).toBe("Bard");
		});

		test("should return null when feat not added", () => {
			expect(state.getScribingClass()).toBeNull();
		});

		test("should queue 2 pending scribing picks when feat is added", () => {
			createBardWithFeat();
			expect(state.getPendingScribingPicks()).toBe(2);
		});
	});

	// =========================================================================
	// STATE: SCRIBING SPELLBOOK
	// =========================================================================

	describe("Scribing spellbook", () => {
		test("should start empty", () => {
			createBardWithFeat();
			expect(state.getScribingSpellbook()).toEqual([]);
		});

		test("should add a spell to the spellbook", () => {
			createBardWithFeat();
			const spell = makeSpell("Healing Word", 1);
			const result = state.addScribingSpell(spell);
			expect(result).toBe(true);
			expect(state.getScribingSpellbook()).toHaveLength(1);
			expect(state.getScribingSpellbook()[0].name).toBe("Healing Word");
		});

		test("should not add duplicate spells", () => {
			createBardWithFeat();
			const spell = makeSpell("Healing Word", 1);
			state.addScribingSpell(spell);
			const result = state.addScribingSpell(spell);
			expect(result).toBe(false);
			expect(state.getScribingSpellbook()).toHaveLength(1);
		});

		test("should remove a spell by id", () => {
			createBardWithFeat();
			const spell = makeSpell("Healing Word", 1);
			state.addScribingSpell(spell);
			const book = state.getScribingSpellbook();
			state.removeScribingSpell(book[0].id);
			expect(state.getScribingSpellbook()).toHaveLength(0);
		});

		test("should remove a spell by name|source", () => {
			createBardWithFeat();
			state.addScribingSpell(makeSpell("Healing Word", 1));
			state.removeScribingSpell("Healing Word|PHB");
			expect(state.getScribingSpellbook()).toHaveLength(0);
		});

		test("should add multiple spells", () => {
			createBardWithFeat();
			state.addScribingSpell(makeSpell("Healing Word", 1));
			state.addScribingSpell(makeSpell("Thunderwave", 1));
			state.addScribingSpell(makeSpell("Shatter", 2));
			expect(state.getScribingSpellbook()).toHaveLength(3);
		});

		test("should return a copy of the spellbook (immutable)", () => {
			createBardWithFeat();
			state.addScribingSpell(makeSpell("Healing Word", 1));
			const book1 = state.getScribingSpellbook();
			const book2 = state.getScribingSpellbook();
			expect(book1).not.toBe(book2);
			expect(book1).toEqual(book2);
		});
	});

	// =========================================================================
	// STATE: MEMORIZATION
	// =========================================================================

	describe("Memorization", () => {
		test("should return null when no spell memorized", () => {
			createBardWithFeat();
			expect(state.getScribingMemorizedSpell()).toBeNull();
		});

		test("should memorize a spell from the spellbook", () => {
			createBardWithFeat();
			const spell = makeSpell("Healing Word", 1);
			state.addScribingSpell(spell);
			const book = state.getScribingSpellbook();
			state.setScribingMemorizedSpell(book[0].id);
			const memo = state.getScribingMemorizedSpell();
			expect(memo).not.toBeNull();
			expect(memo.name).toBe("Healing Word");
		});

		test("should add memorized spell to spells known", () => {
			createBardWithFeat();
			state.addScribingSpell(makeSpell("Healing Word", 1));
			const book = state.getScribingSpellbook();
			state.setScribingMemorizedSpell(book[0].id);
			const known = state.getSpells();
			const memoKnown = known.find(s => s.sourceFeature === "Spell Scribing Adept (Memorized)");
			expect(memoKnown).toBeDefined();
			expect(memoKnown.name).toBe("Healing Word");
			expect(memoKnown.alwaysPrepared).toBe(true);
		});

		test("should replace previous memorized spell when memorizing a new one", () => {
			createBardWithFeat();
			state.addScribingSpell(makeSpell("Healing Word", 1));
			state.addScribingSpell(makeSpell("Thunderwave", 1));
			const book = state.getScribingSpellbook();

			state.setScribingMemorizedSpell(book[0].id);
			let known = state.getSpells();
			expect(known.filter(s => s.sourceFeature === "Spell Scribing Adept (Memorized)")).toHaveLength(1);
			expect(known.find(s => s.sourceFeature === "Spell Scribing Adept (Memorized)").name).toBe("Healing Word");

			state.setScribingMemorizedSpell(book[1].id);
			known = state.getSpells();
			expect(known.filter(s => s.sourceFeature === "Spell Scribing Adept (Memorized)")).toHaveLength(1);
			expect(known.find(s => s.sourceFeature === "Spell Scribing Adept (Memorized)").name).toBe("Thunderwave");
		});

		test("should clear memorized spell", () => {
			createBardWithFeat();
			state.addScribingSpell(makeSpell("Healing Word", 1));
			const book = state.getScribingSpellbook();
			state.setScribingMemorizedSpell(book[0].id);
			state.clearScribingMemorizedSpell();
			expect(state.getScribingMemorizedSpell()).toBeNull();
			const known = state.getSpells();
			expect(known.filter(s => s.sourceFeature === "Spell Scribing Adept (Memorized)")).toHaveLength(0);
		});

		test("should clear memorization if memorized spell is removed from spellbook", () => {
			createBardWithFeat();
			state.addScribingSpell(makeSpell("Healing Word", 1));
			const book = state.getScribingSpellbook();
			state.setScribingMemorizedSpell(book[0].id);
			state.removeScribingSpell(book[0].id);
			expect(state.getScribingMemorizedSpell()).toBeNull();
		});

		test("memorized spell should use the scribing class as sourceClass", () => {
			createBardWithFeat();
			state.addScribingSpell(makeSpell("Healing Word", 1));
			const book = state.getScribingSpellbook();
			state.setScribingMemorizedSpell(book[0].id);
			const known = state.getSpells();
			const memoKnown = known.find(s => s.sourceFeature === "Spell Scribing Adept (Memorized)");
			expect(memoKnown.sourceClass).toBe("Bard");
		});
	});

	// =========================================================================
	// STATE: MAX SPELL LEVEL
	// =========================================================================

	describe("Max spell level", () => {
		test("should be 0 when no scribing class set", () => {
			expect(state.getScribingMaxSpellLevel()).toBe(0);
		});

		test("should be ceil(classLevel / 2) for Bard L1", () => {
			createBardWithFeat(1);
			expect(state.getScribingMaxSpellLevel()).toBe(1); // ceil(1/2) = 1
		});

		test("should be ceil(classLevel / 2) for Bard L2", () => {
			createBardWithFeat(2);
			expect(state.getScribingMaxSpellLevel()).toBe(1); // ceil(2/2) = 1
		});

		test("should be ceil(classLevel / 2) for Bard L4", () => {
			createBardWithFeat(4);
			expect(state.getScribingMaxSpellLevel()).toBe(2); // ceil(4/2) = 2
		});

		test("should be ceil(classLevel / 2) for Bard L5", () => {
			createBardWithFeat(5);
			expect(state.getScribingMaxSpellLevel()).toBe(3); // ceil(5/2) = 3
		});

		test("should be ceil(classLevel / 2) for Bard L10", () => {
			createBardWithFeat(10);
			expect(state.getScribingMaxSpellLevel()).toBe(5); // ceil(10/2) = 5
		});

		test("should be capped at 9", () => {
			createBardWithFeat(20);
			expect(state.getScribingMaxSpellLevel()).toBe(9); // min(9, ceil(20/2)=10) = 9
		});
	});

	// =========================================================================
	// FEATURE CALCULATIONS
	// =========================================================================

	describe("Feature calculations", () => {
		test("should detect hasSpellScribingAdept when feat is present", () => {
			createBardWithFeat();
			const calcs = state.getFeatureCalculations();
			expect(calcs.hasSpellScribingAdept).toBe(true);
		});

		test("should not detect hasSpellScribingAdept without the feat", () => {
			state.addClass({name: "Bard", source: "PHB", level: 4});
			const calcs = state.getFeatureCalculations();
			expect(calcs.hasSpellScribingAdept).toBeFalsy();
		});

		test("should report scribing class in calcs", () => {
			createBardWithFeat();
			const calcs = state.getFeatureCalculations();
			expect(calcs.scribingClass).toBe("Bard");
		});

		test("should report spellbook count in calcs", () => {
			createBardWithFeat();
			state.addScribingSpell(makeSpell("Healing Word", 1));
			state.addScribingSpell(makeSpell("Thunderwave", 1));
			const calcs = state.getFeatureCalculations();
			expect(calcs.scribingSpellbookCount).toBe(2);
		});

		test("should report max spell level in calcs", () => {
			createBardWithFeat(6);
			const calcs = state.getFeatureCalculations();
			expect(calcs.scribingMaxSpellLevel).toBe(3); // ceil(6/2) = 3
		});

		test("should report copy cost in calcs", () => {
			createBardWithFeat();
			const calcs = state.getFeatureCalculations();
			expect(calcs.scribingCopyGoldPerLevel).toBe(50);
			expect(calcs.scribingCopyHoursPerLevel).toBe(2);
		});

		test("should report memorized spell in calcs", () => {
			createBardWithFeat();
			state.addScribingSpell(makeSpell("Healing Word", 1));
			const book = state.getScribingSpellbook();
			state.setScribingMemorizedSpell(book[0].id);
			const calcs = state.getFeatureCalculations();
			expect(calcs.scribingMemorizedSpell).toBeDefined();
			expect(calcs.scribingMemorizedSpell.name).toBe("Healing Word");
		});
	});

	// =========================================================================
	// PENDING SCRIBING PICKS
	// =========================================================================

	describe("Pending scribing picks", () => {
		test("should start at 0 without feat", () => {
			expect(state.getPendingScribingPicks()).toBe(0);
		});

		test("should be 2 after adding feat", () => {
			createBardWithFeat();
			expect(state.getPendingScribingPicks()).toBe(2);
		});

		test("should decrement when set", () => {
			createBardWithFeat();
			state.setPendingScribingPicks(1);
			expect(state.getPendingScribingPicks()).toBe(1);
			state.setPendingScribingPicks(0);
			expect(state.getPendingScribingPicks()).toBe(0);
		});
	});

	// =========================================================================
	// FEAT REMOVAL CLEANUP
	// =========================================================================

	describe("Feat removal cleanup", () => {
		test("should clear scribing class on feat removal", () => {
			createBardWithFeat();
			expect(state.getScribingClass()).toBe("Bard");
			state.removeFeat("Spell Scribing Adept", "TGTT");
			expect(state.getScribingClass()).toBeNull();
		});

		test("should clear scribing spellbook on feat removal", () => {
			createBardWithFeat();
			state.addScribingSpell(makeSpell("Healing Word", 1));
			state.addScribingSpell(makeSpell("Thunderwave", 1));
			expect(state.getScribingSpellbook()).toHaveLength(2);
			state.removeFeat("Spell Scribing Adept", "TGTT");
			expect(state.getScribingSpellbook()).toHaveLength(0);
		});

		test("should clear memorized spell on feat removal", () => {
			createBardWithFeat();
			state.addScribingSpell(makeSpell("Healing Word", 1));
			const book = state.getScribingSpellbook();
			state.setScribingMemorizedSpell(book[0].id);
			expect(state.getScribingMemorizedSpell()).not.toBeNull();
			state.removeFeat("Spell Scribing Adept", "TGTT");
			expect(state.getScribingMemorizedSpell()).toBeNull();
		});

		test("should remove memorized spell from spells known on feat removal", () => {
			createBardWithFeat();
			state.addScribingSpell(makeSpell("Healing Word", 1));
			const book = state.getScribingSpellbook();
			state.setScribingMemorizedSpell(book[0].id);
			const knownBefore = state.getSpells();
			expect(knownBefore.some(s => s.sourceFeature === "Spell Scribing Adept (Memorized)")).toBe(true);

			state.removeFeat("Spell Scribing Adept", "TGTT");
			const knownAfter = state.getSpells();
			expect(knownAfter.some(s => s.sourceFeature === "Spell Scribing Adept (Memorized)")).toBe(false);
		});
	});

	// =========================================================================
	// MULTICLASS INTERACTIONS
	// =========================================================================

	describe("Multiclass interactions", () => {
		test("should use chosen class level for max spell level, not total level", () => {
			state.addClass({name: "Bard", source: "PHB", level: 4});
			state.addClass({name: "Fighter", source: "PHB", level: 6});
			state.addFeat({
				name: "Spell Scribing Adept",
				source: "TGTT",
				choices: {scribingClass: "Bard"},
			});
			// Bard level is 4, total level is 10
			// Max spell level = ceil(4/2) = 2
			expect(state.getScribingMaxSpellLevel()).toBe(2);
		});

		test("should not interfere with Wizard spellbook", () => {
			state.addClass({name: "Wizard", source: "PHB", level: 5});
			state.addClass({name: "Bard", source: "PHB", level: 3});
			state.addFeat({
				name: "Spell Scribing Adept",
				source: "TGTT",
				choices: {scribingClass: "Bard"},
			});

			// Add a spell to scribing spellbook
			state.addScribingSpell(makeSpell("Healing Word", 1));

			// Add a regular spell (Wizard spellbook)
			state.addSpell({name: "Shield", source: "PHB", level: 1, inSpellbook: true});

			// They should be separate
			expect(state.getScribingSpellbook()).toHaveLength(1);
			expect(state.getScribingSpellbook()[0].name).toBe("Healing Word");
			const known = state.getSpells();
			expect(known.some(s => s.name === "Shield")).toBe(true);
		});
	});

	// =========================================================================
	// SAVE / LOAD
	// =========================================================================

	describe("Save and load", () => {
		test("should persist scribing data through save/load cycle", () => {
			createBardWithFeat();
			state.addScribingSpell(makeSpell("Healing Word", 1));
			state.addScribingSpell(makeSpell("Thunderwave", 1));
			const book = state.getScribingSpellbook();
			state.setScribingMemorizedSpell(book[0].id);

			const json = state.toJson();
			const state2 = new CharacterSheetState();
			state2.loadFromJson(json);

			expect(state2.getScribingClass()).toBe("Bard");
			expect(state2.getScribingSpellbook()).toHaveLength(2);
			expect(state2.getScribingMemorizedSpell()).not.toBeNull();
			expect(state2.getScribingMemorizedSpell().name).toBe("Healing Word");
		});

		test("should handle loading old saves without scribing data", () => {
			// Simulate old save without scribing fields
			const state2 = new CharacterSheetState();
			const json = state2.toJson();
			// The spellcasting object won't have scribing fields explicitly,
			// but loadFromJson spreads defaults so they should be present
			const state3 = new CharacterSheetState();
			state3.loadFromJson(json);
			expect(state3.getScribingClass()).toBeNull();
			expect(state3.getScribingSpellbook()).toEqual([]);
			expect(state3.getScribingMemorizedSpell()).toBeNull();
			expect(state3.getPendingScribingPicks()).toBe(0);
		});
	});
});
