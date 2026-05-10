/**
 * Coverage for the level-1 optional-feature progression flow in the builder.
 *
 * Bug context (bugs.md): TGTT warlock could not pick Eldritch Invocations at
 * level 1 in the builder, even though `optionalfeatureProgression[0] = 1`.
 * Root cause was that the builder duplicated level-up's gain/prereq logic
 * with weaker checks. Builder now delegates to
 * `CharacterSheetClassUtils.getOptionalFeatureGains` and
 * `CharacterSheetClassUtils.getEligibleOptionalFeatures`. These tests pin
 * that contract.
 */

import "./setup.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-builder.js";

const CharacterSheetClassUtils = globalThis.CharacterSheetClassUtils;
const CharacterSheetBuilder = globalThis.CharacterSheetBuilder;

// ----- Fixtures -----------------------------------------------------------

const TGTT_WARLOCK = {
	name: "Warlock",
	source: "TGTT",
	edition: "one",
	optionalfeatureProgression: [
		{
			name: "Eldritch Invocations",
			featureType: ["EI"],
			progression: [1, 3, 3, 3, 5, 5, 6, 6, 7, 7, 7, 8, 8, 8, 9, 9, 9, 10, 10, 10],
		},
	],
};

const XPHB_WARLOCK = {
	name: "Warlock",
	source: "XPHB",
	edition: "one",
	optionalfeatureProgression: [
		{
			name: "Eldritch Invocations",
			featureType: ["EI"],
			progression: [1, 3, 3, 3, 5, 5, 6, 6, 7, 7, 7, 8, 8, 8, 9, 9, 9, 10, 10, 10],
		},
	],
};

const PHB_WARLOCK = {
	name: "Warlock",
	source: "PHB",
	optionalfeatureProgression: [
		{
			name: "Eldritch Invocations",
			featureType: ["EI"],
			progression: [0, 2, 2, 2, 3, 3, 4, 4, 5, 5, 5, 6, 6, 6, 7, 7, 7, 8, 8, 8],
		},
		{
			name: "Pact Boon",
			featureType: ["PB"],
			progression: {3: 1},
		},
	],
};

const INV_AGONIZING = {
	name: "Agonizing Blast",
	source: "TGTT",
	featureType: ["EI"],
	prerequisite: [{spell: ["eldritch blast#c"]}],
	entries: ["When you cast eldritch blast, add your Charisma modifier to the damage."],
};
const INV_AGONIZING_XPHB = {
	name: "Agonizing Blast",
	source: "XPHB",
	featureType: ["EI"],
	prerequisite: [{spell: ["eldritch blast#c"]}],
	entries: ["XPHB Agonizing Blast."],
};
const INV_DEVIL_SIGHT = {
	name: "Devil's Sight",
	source: "TGTT",
	featureType: ["EI"],
	entries: ["You can see normally in darkness."],
};
const INV_PACT_LOCKED = {
	name: "Eldritch Smite",
	source: "TGTT",
	featureType: ["EI"],
	prerequisite: [{level: 5, pact: "Blade"}],
	entries: ["Pact of the Blade required."],
};
const INV_LEVEL_LOCKED = {
	name: "Lifedrinker",
	source: "TGTT",
	featureType: ["EI"],
	prerequisite: [{level: 12, pact: "Blade"}],
	entries: ["Higher-level invocation."],
};
const INV_REPEATABLE = {
	name: "Eldritch Mind",
	source: "TGTT",
	featureType: ["EI"],
	entries: ["{@i Repeatable.} You may take this multiple times."],
};

const INV_POOL = [
	INV_AGONIZING,
	INV_AGONIZING_XPHB,
	INV_DEVIL_SIGHT,
	INV_PACT_LOCKED,
	INV_LEVEL_LOCKED,
	INV_REPEATABLE,
];

// ----- getOptionalFeatureGains -------------------------------------------

describe("getOptionalFeatureGains — level 1 builder semantics", () => {
	function makeFreshState () {
		return {getFeatures: () => []};
	}

	test("TGTT warlock surfaces 1 Eldritch Invocation gain at level 1", () => {
		const gains = CharacterSheetClassUtils.getOptionalFeatureGains(TGTT_WARLOCK, 0, 1, makeFreshState());
		expect(gains).toHaveLength(1);
		expect(gains[0]).toMatchObject({featureTypes: ["EI"], totalCount: 1, newCount: 1, name: "Eldritch Invocations"});
	});

	test("XPHB warlock surfaces 1 Eldritch Invocation gain at level 1", () => {
		const gains = CharacterSheetClassUtils.getOptionalFeatureGains(XPHB_WARLOCK, 0, 1, makeFreshState());
		expect(gains).toHaveLength(1);
		expect(gains[0].totalCount).toBe(1);
	});

	test("PHB warlock has no invocation gains at level 1", () => {
		const gains = CharacterSheetClassUtils.getOptionalFeatureGains(PHB_WARLOCK, 0, 1, makeFreshState());
		// PHB grants 0 invocations at L1 and Pact Boon does not start until L3.
		expect(gains).toHaveLength(0);
	});

	test("PHB warlock at level 2 surfaces 2 invocations", () => {
		const gains = CharacterSheetClassUtils.getOptionalFeatureGains(PHB_WARLOCK, 1, 2, makeFreshState());
		const ei = gains.find(g => g.featureTypes[0] === "EI");
		expect(ei).toMatchObject({totalCount: 2, newCount: 2});
	});
});

// ----- getEligibleOptionalFeatures ---------------------------------------

describe("getEligibleOptionalFeatures — level-1 builder prereq filter", () => {
	const baseCtx = {
		classes: [{name: "Warlock", source: "TGTT", level: 1}],
		totalLevel: 1,
		existingFeatures: [],
		cantrips: [{name: "Eldritch Blast"}],
		spells: [],
	};

	test("returns only EI options that pass prereqs", () => {
		const out = CharacterSheetClassUtils.getEligibleOptionalFeatures(INV_POOL, {
			featureTypes: ["EI"],
			prereqContext: baseCtx,
		});
		const selectable = out.filter(o => o._selectable).map(o => o.name);

		// Agonizing Blast (TGTT + XPHB copies) should be selectable since the
		// caller is a warlock with the Eldritch Blast cantrip.
		expect(selectable).toEqual(expect.arrayContaining(["Agonizing Blast", "Devil's Sight", "Eldritch Mind"]));

		// Pact-locked and level-locked options should NOT be selectable at L1.
		expect(selectable).not.toContain("Eldritch Smite");
		expect(selectable).not.toContain("Lifedrinker");
	});

	test("level-locked invocation still appears with prereq reasons (annotated, not selectable)", () => {
		const out = CharacterSheetClassUtils.getEligibleOptionalFeatures(INV_POOL, {
			featureTypes: ["EI"],
			prereqContext: baseCtx,
		});
		const lifedrinker = out.find(o => o.name === "Lifedrinker");
		expect(lifedrinker).toBeTruthy();
		expect(lifedrinker._selectable).toBe(false);
		expect(lifedrinker._meetsPrereqs).toBe(false);
		expect(lifedrinker._prereqReasons.length).toBeGreaterThan(0);
	});

	test("repeatable invocations stay selectable after one pick", () => {
		const out = CharacterSheetClassUtils.getEligibleOptionalFeatures(INV_POOL, {
			featureTypes: ["EI"],
			prereqContext: baseCtx,
			alreadyKnown: [{name: "Eldritch Mind", source: "TGTT"}],
		});
		const repeat = out.find(o => o.name === "Eldritch Mind");
		expect(repeat._alreadyKnown).toBe(true);
		expect(repeat._timesKnown).toBe(1);
		expect(repeat._repeatable).toBe(true);
		expect(repeat._selectable).toBe(true);
	});

	test("non-repeatable invocations become unselectable after being picked once", () => {
		const out = CharacterSheetClassUtils.getEligibleOptionalFeatures(INV_POOL, {
			featureTypes: ["EI"],
			prereqContext: baseCtx,
			alreadyKnown: [{name: "Devil's Sight", source: "TGTT"}],
		});
		const ds = out.find(o => o.name === "Devil's Sight");
		expect(ds._alreadyKnown).toBe(true);
		expect(ds._repeatable).toBe(false);
		expect(ds._selectable).toBe(false);
	});

	test("returns [] for an empty pool or empty featureTypes", () => {
		expect(CharacterSheetClassUtils.getEligibleOptionalFeatures([], {featureTypes: ["EI"], prereqContext: baseCtx})).toEqual([]);
		expect(CharacterSheetClassUtils.getEligibleOptionalFeatures(INV_POOL, {featureTypes: [], prereqContext: baseCtx})).toEqual([]);
	});
});

// ----- Builder validation ------------------------------------------------

describe("CharacterSheetBuilder._validateOptionalFeatureSelections — TGTT warlock L1", () => {
	function makeBuilder ({selected = {}, classData = TGTT_WARLOCK} = {}) {
		const builder = Object.create(CharacterSheetBuilder.prototype);
		builder._selectedClass = classData;
		builder._selectedOptionalFeatures = selected;
		builder._selectedCombatTraditions = [];
		builder._state = {getFeatures: () => []};
		builder._page = {
			getClassFeatures: () => [],
			getOptionalFeatures: () => INV_POOL,
		};
		return builder;
	}

	test("blocks advance when no Eldritch Invocation has been chosen", () => {
		const builder = makeBuilder({selected: {EI: []}});
		const result = builder._validateOptionalFeatureSelections(TGTT_WARLOCK);
		expect(result.valid).toBe(false);
		expect(result.message).toMatch(/Eldritch Invocations/);
	});

	test("passes once 1 Eldritch Invocation is chosen", () => {
		const builder = makeBuilder({selected: {EI: [INV_DEVIL_SIGHT]}});
		const result = builder._validateOptionalFeatureSelections(TGTT_WARLOCK);
		expect(result.valid).toBe(true);
	});

	test("passes for PHB warlock at L1 (no invocation slot to fill)", () => {
		const builder = makeBuilder({selected: {}, classData: PHB_WARLOCK});
		const result = builder._validateOptionalFeatureSelections(PHB_WARLOCK);
		expect(result.valid).toBe(true);
	});

	test("class without optionalfeatureProgression validates trivially", () => {
		const cls = {name: "Fighter", source: "PHB"};
		const builder = makeBuilder({selected: {}, classData: cls});
		expect(builder._validateOptionalFeatureSelections(cls).valid).toBe(true);
	});
});
