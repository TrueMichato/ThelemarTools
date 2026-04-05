import "./setup.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-state.js";

const CharacterSheetState = globalThis.CharacterSheetState;
const CharacterSheetClassUtils = globalThis.CharacterSheetClassUtils;

/**
 * Mock full spell database entries for enrichment tests.
 */
const MOCK_SPELLS = [
	{
		name: "Mage Hand",
		source: "PHB",
		level: 0,
		school: "C",
		time: [{number: 1, unit: "action"}],
		range: {type: "point", distance: {type: "feet", amount: 30}},
		duration: [{type: "timed", duration: {type: "minute", amount: 1}}],
		components: {v: true, s: true},
		entries: ["A spectral hand appears..."],
	},
	{
		name: "Mage Hand",
		source: "XPHB",
		level: 0,
		school: "C",
		time: [{number: 1, unit: "action"}],
		range: {type: "point", distance: {type: "feet", amount: 30}},
		duration: [{type: "timed", duration: {type: "minute", amount: 1}}],
		components: {v: true, s: true},
		entries: ["A spectral hand appears..."],
	},
	{
		name: "Misty Step",
		source: "PHB",
		level: 2,
		school: "C",
		time: [{number: 1, unit: "bonus"}],
		range: {type: "point", distance: {type: "self"}},
		duration: [{type: "instant"}],
		components: {v: true},
		entries: ["Briefly surrounded by silvery mist..."],
	},
	{
		name: "Shield",
		source: "PHB",
		level: 1,
		school: "A",
		time: [{number: 1, unit: "reaction"}],
		range: {type: "point", distance: {type: "self"}},
		duration: [{type: "timed", duration: {type: "round", amount: 1}}],
		components: {v: true, s: true},
		entries: ["An invisible barrier of magical force..."],
		meta: {ritual: false},
	},
	{
		name: "Invisibility",
		source: "PHB",
		level: 2,
		school: "I",
		time: [{number: 1, unit: "action"}],
		range: {type: "point", distance: {type: "touch"}},
		duration: [{type: "timed", duration: {type: "hour", amount: 1}, concentration: true}],
		components: {v: true, s: true, m: "an eyelash encased in gum arabic"},
		entries: ["A creature you touch becomes invisible..."],
	},
];

// ============================================================
// SpellGrantParser tests
// ============================================================

describe("SpellGrantParser", () => {
	let SpellGrantParser;

	beforeAll(() => {
		// SpellGrantParser is not exported on globalThis; access it through
		// the state module internals. It's used by _processFeatureSpells.
		// We test it indirectly through addFeat / _processFeatureSpells.
	});

	describe("Cantrip level detection (#c suffix)", () => {
		let state;

		beforeEach(() => {
			state = new CharacterSheetState();
		});

		test("Telekinetic (TCE) adds Mage Hand as cantrip, not level 1 spell", () => {
			state.addFeat({
				name: "Telekinetic",
				source: "TCE",
				additionalSpells: [{
					ability: "inherit",
					known: {"_": ["mage hand#c"]},
				}],
			});

			const cantrips = state.getCantrips();
			const spellsKnown = state.getSpellsKnown();

			// Should be in cantrips
			const mageHandCantrip = cantrips.find(c => c.name === "Mage Hand");
			expect(mageHandCantrip).toBeTruthy();
			expect(mageHandCantrip.sourceFeature).toBe("Telekinetic");

			// Should NOT be in spellsKnown
			const mageHandSpell = spellsKnown.find(s => s.name === "Mage Hand");
			expect(mageHandSpell).toBeFalsy();
		});

		test("Telekinetic (XPHB) adds Mage Hand as cantrip with correct source", () => {
			state.addFeat({
				name: "Telekinetic",
				source: "XPHB",
				additionalSpells: [{
					ability: "inherit",
					known: {"_": ["mage hand|xphb#c"]},
				}],
			});

			const cantrips = state.getCantrips();
			const mageHand = cantrips.find(c => c.name === "Mage Hand");
			expect(mageHand).toBeTruthy();
			expect(mageHand.source).toBe("XPHB");
			expect(mageHand.sourceFeature).toBe("Telekinetic");
		});

		test("Multiple cantrips from known block are all added as cantrips", () => {
			state.addFeat({
				name: "TestFeat",
				source: "TEST",
				additionalSpells: [{
					ability: "int",
					known: {"_": ["mage hand#c", "light#c"]},
				}],
			});

			const cantrips = state.getCantrips();
			expect(cantrips.find(c => c.name === "Mage Hand")).toBeTruthy();
			expect(cantrips.find(c => c.name === "Light")).toBeTruthy();

			// None in spellsKnown
			const spellsKnown = state.getSpellsKnown();
			expect(spellsKnown.find(s => s.name === "Mage Hand")).toBeFalsy();
			expect(spellsKnown.find(s => s.name === "Light")).toBeFalsy();
		});
	});

	describe("Innate spell parsing", () => {
		let state;

		beforeEach(() => {
			state = new CharacterSheetState();
		});

		test("Fey Touched adds Misty Step as innate 1/day spell", () => {
			state.addFeat({
				name: "Fey Touched",
				source: "TCE",
				additionalSpells: [{
					ability: "inherit",
					innate: {
						"_": {
							daily: {
								"1e": ["misty step"],
							},
						},
					},
				}],
			});

			const innateSpells = state.getInnateSpells();
			const mistyStep = innateSpells.find(s => s.name === "Misty Step");
			expect(mistyStep).toBeTruthy();
			expect(mistyStep.sourceFeature).toBe("Fey Touched");
			expect(mistyStep.atWill).toBe(false);
			expect(mistyStep.uses).toEqual({current: 1, max: 1});
			expect(mistyStep.recharge).toBe("long");
		});

		test("Shadow Touched adds Invisibility as innate 1/day spell", () => {
			state.addFeat({
				name: "Shadow Touched",
				source: "TCE",
				additionalSpells: [{
					ability: "inherit",
					innate: {
						"_": {
							daily: {
								"1e": ["invisibility"],
							},
						},
					},
				}],
			});

			const innateSpells = state.getInnateSpells();
			const invisibility = innateSpells.find(s => s.name === "Invisibility");
			expect(invisibility).toBeTruthy();
			expect(invisibility.uses).toEqual({current: 1, max: 1});
			expect(invisibility.recharge).toBe("long");
		});
	});

	describe("Mixed known + innate (Magic Initiate pattern)", () => {
		let state;

		beforeEach(() => {
			state = new CharacterSheetState();
		});

		test("feat with both known cantrips and innate daily spell", () => {
			state.addFeat({
				name: "Magic Initiate",
				source: "TEST",
				additionalSpells: [{
					ability: "cha",
					known: {"_": ["mage hand#c"]},
					innate: {
						"_": {
							daily: {"1": ["shield"]},
						},
					},
				}],
			});

			// Cantrip in cantripsKnown
			const cantrips = state.getCantrips();
			expect(cantrips.find(c => c.name === "Mage Hand")).toBeTruthy();

			// Shield as innate 1/day
			const innateSpells = state.getInnateSpells();
			const shield = innateSpells.find(s => s.name === "Shield");
			expect(shield).toBeTruthy();
			expect(shield.uses).toEqual({current: 1, max: 1});
		});
	});

	describe("Non-cantrip known spells stay in spellsKnown", () => {
		let state;

		beforeEach(() => {
			state = new CharacterSheetState();
		});

		test("known spell without #c suffix is added at its natural level", () => {
			state.addFeat({
				name: "TestFeat",
				source: "TEST",
				additionalSpells: [{
					ability: "int",
					known: {"_": ["shield"]},
				}],
			});

			const spellsKnown = state.getSpellsKnown();
			const shield = spellsKnown.find(s => s.name === "Shield");
			expect(shield).toBeTruthy();
			expect(shield.level).toBe(1); // default level when not specified
		});
	});
});

// ============================================================
// Spell metadata enrichment tests
// ============================================================

describe("Feat spell metadata enrichment", () => {
	let state;

	beforeEach(() => {
		state = new CharacterSheetState();
	});

	test("cantrip is enriched with metadata when allSpells provided", () => {
		state.addFeat({
			name: "Telekinetic",
			source: "TCE",
			additionalSpells: [{
				ability: "inherit",
				known: {"_": ["mage hand#c"]},
			}],
		}, {allSpells: MOCK_SPELLS});

		const cantrips = state.getCantrips();
		const mageHand = cantrips.find(c => c.name === "Mage Hand");
		expect(mageHand).toBeTruthy();
		expect(mageHand.school).toBe("C");
		expect(mageHand.castingTime).toBeTruthy();
		expect(mageHand.range).toBeTruthy();
		expect(mageHand.components).toBeTruthy();
		expect(mageHand.duration).toBeTruthy();
	});

	test("XPHB cantrip is enriched from correct source entry", () => {
		state.addFeat({
			name: "Telekinetic",
			source: "XPHB",
			additionalSpells: [{
				ability: "inherit",
				known: {"_": ["mage hand|xphb#c"]},
			}],
		}, {allSpells: MOCK_SPELLS});

		const cantrips = state.getCantrips();
		const mageHand = cantrips.find(c => c.name === "Mage Hand" && c.source === "XPHB");
		expect(mageHand).toBeTruthy();
		expect(mageHand.school).toBe("C");
	});

	test("innate spell is enriched with metadata when allSpells provided", () => {
		state.addFeat({
			name: "Fey Touched",
			source: "TCE",
			additionalSpells: [{
				ability: "inherit",
				innate: {
					"_": {
						daily: {"1e": ["misty step"]},
					},
				},
			}],
		}, {allSpells: MOCK_SPELLS});

		const innateSpells = state.getInnateSpells();
		const mistyStep = innateSpells.find(s => s.name === "Misty Step");
		expect(mistyStep).toBeTruthy();
		expect(mistyStep.school).toBe("C");
		expect(mistyStep.castingTime).toBeTruthy();
		expect(mistyStep.range).toBeTruthy();
		expect(mistyStep.sourceFeature).toBe("Fey Touched");
		// Should still have uses tracking
		expect(mistyStep.uses).toEqual({current: 1, max: 1});
		expect(mistyStep.recharge).toBe("long");
	});

	test("known leveled spell is enriched with metadata when allSpells provided", () => {
		state.addFeat({
			name: "TestFeat",
			source: "TEST",
			additionalSpells: [{
				ability: "int",
				known: {"_": ["shield"]},
			}],
		}, {allSpells: MOCK_SPELLS});

		const spellsKnown = state.getSpellsKnown();
		const shield = spellsKnown.find(s => s.name === "Shield");
		expect(shield).toBeTruthy();
		expect(shield.level).toBe(1);
		expect(shield.school).toBe("A");
		expect(shield.castingTime).toBeTruthy();
		expect(shield.range).toBeTruthy();
	});

	test("graceful degradation without allSpells (sparse storage)", () => {
		state.addFeat({
			name: "Telekinetic",
			source: "TCE",
			additionalSpells: [{
				ability: "inherit",
				known: {"_": ["mage hand#c"]},
			}],
		}); // No allSpells

		const cantrips = state.getCantrips();
		const mageHand = cantrips.find(c => c.name === "Mage Hand");
		expect(mageHand).toBeTruthy();
		// Still works, just without enrichment
		expect(mageHand.sourceFeature).toBe("Telekinetic");
		expect(mageHand.source).toBe("PHB");
	});
});

// ============================================================
// Migration tests
// ============================================================

describe("_migrateSpells cantrip migration", () => {
	test("level 0 spells in spellsKnown are moved to cantripsKnown", () => {
		const state = new CharacterSheetState();

		// Simulate old save with a cantrip in spellsKnown at level 0
		state._data.spellcasting.spellsKnown.push({
			id: "test-1",
			name: "Mage Hand",
			source: "PHB",
			level: 0,
			sourceFeature: "Telekinetic",
		});

		state._migrateSpells();

		const spellsKnown = state.getSpellsKnown();
		const cantrips = state.getCantrips();

		expect(spellsKnown.find(s => s.name === "Mage Hand")).toBeFalsy();
		expect(cantrips.find(c => c.name === "Mage Hand")).toBeTruthy();
	});

	test("misplaced cantrip at level 1 with feat sourceFeature is migrated", () => {
		const state = new CharacterSheetState();

		// Simulate old save with Mage Hand at level 1 (the old bug)
		state._data.spellcasting.spellsKnown.push({
			id: "test-2",
			name: "Mage Hand",
			source: "PHB",
			level: 1,
			sourceFeature: "Telekinetic",
		});

		state._migrateSpells();

		const spellsKnown = state.getSpellsKnown();
		const cantrips = state.getCantrips();

		expect(spellsKnown.find(s => s.name === "Mage Hand")).toBeFalsy();
		expect(cantrips.find(c => c.name === "Mage Hand")).toBeTruthy();
		expect(cantrips.find(c => c.name === "Mage Hand").sourceFeature).toBe("Telekinetic");
	});

	test("non-cantrip level 1 spell is NOT migrated", () => {
		const state = new CharacterSheetState();

		state._data.spellcasting.spellsKnown.push({
			id: "test-3",
			name: "Shield",
			source: "PHB",
			level: 1,
			sourceFeature: "Fey Touched",
		});

		state._migrateSpells();

		const spellsKnown = state.getSpellsKnown();
		expect(spellsKnown.find(s => s.name === "Shield")).toBeTruthy();
	});

	test("does not duplicate cantrip if already in cantripsKnown", () => {
		const state = new CharacterSheetState();

		// Already correctly in cantrips
		state._data.spellcasting.cantripsKnown.push({
			id: "existing-1",
			name: "Mage Hand",
			source: "PHB",
			sourceFeature: "Telekinetic",
		});

		// Also incorrectly in spellsKnown
		state._data.spellcasting.spellsKnown.push({
			id: "test-4",
			name: "Mage Hand",
			source: "PHB",
			level: 0,
			sourceFeature: "Telekinetic",
		});

		state._migrateSpells();

		const cantrips = state.getCantrips();
		const mageHands = cantrips.filter(c => c.name === "Mage Hand");
		expect(mageHands).toHaveLength(1); // Only the existing one, no duplicate
	});
});

// ============================================================
// addInnateSpell enrichment fields
// ============================================================

describe("addInnateSpell stores enrichment fields", () => {
	test("stores school, castingTime, range, etc. when provided", () => {
		const state = new CharacterSheetState();

		state.addInnateSpell({
			name: "Misty Step",
			source: "PHB",
			level: 2,
			school: "C",
			atWill: false,
			uses: 1,
			recharge: "long",
			sourceFeature: "Fey Touched",
			castingTime: "1 bonus action",
			range: "Self",
			duration: "Instantaneous",
			components: "V",
			concentration: false,
			ritual: false,
		});

		const innateSpells = state.getInnateSpells();
		const mistyStep = innateSpells.find(s => s.name === "Misty Step");
		expect(mistyStep).toBeTruthy();
		expect(mistyStep.school).toBe("C");
		expect(mistyStep.castingTime).toBe("1 bonus action");
		expect(mistyStep.range).toBe("Self");
		expect(mistyStep.duration).toBe("Instantaneous");
		expect(mistyStep.components).toBe("V");
		expect(mistyStep.concentration).toBe(false);
		expect(mistyStep.ritual).toBe(false);
	});

	test("defaults enrichment fields when not provided", () => {
		const state = new CharacterSheetState();

		state.addInnateSpell({
			name: "Shield",
			source: "PHB",
			level: 1,
			atWill: false,
			uses: 1,
			recharge: "long",
			sourceFeature: "Test",
		});

		const innateSpells = state.getInnateSpells();
		const shield = innateSpells.find(s => s.name === "Shield");
		expect(shield).toBeTruthy();
		expect(shield.castingTime).toBe("");
		expect(shield.range).toBe("");
		expect(shield.concentration).toBe(false);
	});
});

// ============================================================
// buildInnateSpellStateObject
// ============================================================

describe("CharacterSheetClassUtils.buildInnateSpellStateObject", () => {
	test("builds enriched innate spell from raw spell data", () => {
		const rawSpell = MOCK_SPELLS.find(s => s.name === "Misty Step");
		const result = CharacterSheetClassUtils.buildInnateSpellStateObject(rawSpell, {
			sourceFeature: "Fey Touched",
			atWill: false,
			uses: 1,
			recharge: "long",
		});

		expect(result.name).toBe("Misty Step");
		expect(result.source).toBe("PHB");
		expect(result.level).toBe(2);
		expect(result.school).toBe("C");
		expect(result.atWill).toBe(false);
		expect(result.uses).toBe(1);
		expect(result.recharge).toBe("long");
		expect(result.sourceFeature).toBe("Fey Touched");
		expect(result.castingTime).toBeTruthy();
		expect(result.range).toBeTruthy();
		expect(result.components).toBeTruthy();
		expect(result.duration).toBeTruthy();
	});

	test("at-will innate spell has correct flags", () => {
		const rawSpell = MOCK_SPELLS.find(s => s.name === "Mage Hand" && s.source === "PHB");
		const result = CharacterSheetClassUtils.buildInnateSpellStateObject(rawSpell, {
			sourceFeature: "Test Race",
			atWill: true,
		});

		expect(result.atWill).toBe(true);
		expect(result.uses).toBeUndefined();
		expect(result.recharge).toBe("long"); // default
	});
});
