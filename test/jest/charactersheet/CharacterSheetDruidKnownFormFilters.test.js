/**
 * Druid Known-Form picker — FILTER PREDICATES (Round 26 Bug #2).
 *
 * The "Add known form" Wild Shape picker (`_pAddKnownForm`) renders 100+ candidate
 * Beast cards but previously offered ONLY a free-text name search — no structured
 * source / CR / size / type filters like other 5etools pickers. This round adds
 * those controls, backed by two pure helpers on `CharacterSheetDruidResources`:
 *
 *  - `buildKnownFormFilterOptions(entries)` → the option lists shown in the
 *    select boxes (unique sources, types, sizes ordered T→G, distinct CRs sorted).
 *  - `matchesKnownFormFilters(entry, filters)` → the per-card predicate combining
 *    name search with source / type / size / CR-range constraints (all AND-ed).
 *
 * These are DOM-free, so they are unit-tested directly here. They drive the live
 * card list, so a regression in either silently breaks the visible filtering.
 */

import "./setup.js";

let CharacterSheetDruidResources;

beforeAll(async () => {
	CharacterSheetDruidResources = (await import("../../../js/charactersheet/charactersheet-druid-resources.js")).CharacterSheetDruidResources;
});

/** A small, representative slice of normalized picker entries. */
function makeEntries () {
	return [
		{name: "Wolf", source: "MM", creatureType: "beast", size: "M", crNumber: 0.25},
		{name: "Brown Bear", source: "MM", creatureType: "beast", size: "L", crNumber: 1},
		{name: "Giant Frog", source: "MM", creatureType: "beast", size: "M", crNumber: 0.25},
		{name: "Rat", source: "XMM", creatureType: "beast", size: "T", crNumber: 0},
		{name: "Constrictor Snake", source: "XPHB", creatureType: "beast", size: "L", crNumber: 0.25},
		{name: "Giant Owl", source: "MM", creatureType: "fey", size: "L", crNumber: 0.25},
	];
}

describe("buildKnownFormFilterOptions", () => {
	test("returns unique, sorted sources / types / CRs and size-ordered sizes", () => {
		const opts = CharacterSheetDruidResources.buildKnownFormFilterOptions(makeEntries());
		expect(opts.sources).toEqual(["MM", "XMM", "XPHB"]);
		expect(opts.types).toEqual(["beast", "fey"]);
		// T(0) < M(2) < L(3) — Tiny before Medium before Large regardless of insertion order.
		expect(opts.sizes).toEqual(["T", "M", "L"]);
		expect(opts.crNumbers).toEqual([0, 0.25, 1]);
	});

	test("tolerates empty / missing input", () => {
		expect(CharacterSheetDruidResources.buildKnownFormFilterOptions([])).toEqual({sources: [], types: [], sizes: [], crNumbers: []});
		expect(CharacterSheetDruidResources.buildKnownFormFilterOptions(undefined)).toEqual({sources: [], types: [], sizes: [], crNumbers: []});
	});

	test("ignores blank fields but keeps a real CR of 0", () => {
		const opts = CharacterSheetDruidResources.buildKnownFormFilterOptions([
			{name: "A", source: "", creatureType: "", size: "", crNumber: 0},
			{name: "B", source: "MM", creatureType: "beast", size: "M", crNumber: 0.5},
		]);
		expect(opts.sources).toEqual(["MM"]);
		expect(opts.types).toEqual(["beast"]);
		expect(opts.sizes).toEqual(["M"]);
		expect(opts.crNumbers).toEqual([0, 0.5]);
	});
});

describe("matchesKnownFormFilters", () => {
	const wolf = {name: "Wolf", source: "MM", creatureType: "beast", size: "M", crNumber: 0.25};

	test("no constraints → everything passes", () => {
		const all = {needle: "", source: "__all__", type: "__all__", size: "__all__", crMin: null, crMax: null};
		expect(makeEntries().every(e => CharacterSheetDruidResources.matchesKnownFormFilters(e, all))).toBe(true);
	});

	test("free-text name search is case-insensitive and substring", () => {
		expect(CharacterSheetDruidResources.matchesKnownFormFilters(wolf, {needle: "wol"})).toBe(true);
		expect(CharacterSheetDruidResources.matchesKnownFormFilters(wolf, {needle: "WOLF"})).toBe(true);
		expect(CharacterSheetDruidResources.matchesKnownFormFilters(wolf, {needle: "bear"})).toBe(false);
	});

	test("source filter — only matching source passes; sentinel means any", () => {
		const mmOnly = makeEntries().filter(e => CharacterSheetDruidResources.matchesKnownFormFilters(e, {source: "MM"}));
		expect(mmOnly.map(e => e.name).sort()).toEqual(["Brown Bear", "Giant Frog", "Giant Owl", "Wolf"]);
		expect(CharacterSheetDruidResources.matchesKnownFormFilters(wolf, {source: "__all__"})).toBe(true);
	});

	test("creature-type filter excludes non-matching types", () => {
		const beasts = makeEntries().filter(e => CharacterSheetDruidResources.matchesKnownFormFilters(e, {type: "beast"}));
		expect(beasts.find(e => e.name === "Giant Owl")).toBeUndefined();
		expect(beasts).toHaveLength(5);
	});

	test("size filter narrows to one size class", () => {
		const large = makeEntries().filter(e => CharacterSheetDruidResources.matchesKnownFormFilters(e, {size: "L"}));
		expect(large.map(e => e.name).sort()).toEqual(["Brown Bear", "Constrictor Snake", "Giant Owl"]);
	});

	test("CR range is inclusive on both ends", () => {
		const leOne = makeEntries().filter(e => CharacterSheetDruidResources.matchesKnownFormFilters(e, {crMax: 1}));
		expect(leOne).toHaveLength(6); // all of them
		const leQuarter = makeEntries().filter(e => CharacterSheetDruidResources.matchesKnownFormFilters(e, {crMax: 0.25}));
		expect(leQuarter.find(e => e.name === "Brown Bear")).toBeUndefined(); // CR 1 excluded
		expect(leQuarter).toHaveLength(5);
		const exactlyQuarter = makeEntries().filter(e => CharacterSheetDruidResources.matchesKnownFormFilters(e, {crMin: 0.25, crMax: 0.25}));
		expect(exactlyQuarter.map(e => e.name).sort()).toEqual(["Constrictor Snake", "Giant Frog", "Giant Owl", "Wolf"]);
		expect(CharacterSheetDruidResources.matchesKnownFormFilters(wolf, {crMin: 0.5})).toBe(false);
	});

	test("missing crNumber is treated as CR 0 for range checks", () => {
		const noCr = {name: "Mystery", source: "MM", creatureType: "beast", size: "M"};
		expect(CharacterSheetDruidResources.matchesKnownFormFilters(noCr, {crMax: 0})).toBe(true);
		expect(CharacterSheetDruidResources.matchesKnownFormFilters(noCr, {crMin: 0.25})).toBe(false);
	});

	test("filters AND together (source + size + CR + search combine)", () => {
		const combined = {needle: "giant", source: "MM", size: "L", crMin: 0, crMax: 1, type: "fey"};
		const res = makeEntries().filter(e => CharacterSheetDruidResources.matchesKnownFormFilters(e, combined));
		expect(res.map(e => e.name)).toEqual(["Giant Owl"]); // only Giant Owl is MM + Large + fey + "giant"
	});

	test("guards: null entry → false; null filters → passes", () => {
		expect(CharacterSheetDruidResources.matchesKnownFormFilters(null, {})).toBe(false);
		expect(CharacterSheetDruidResources.matchesKnownFormFilters(wolf, null)).toBe(true);
	});
});
