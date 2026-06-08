/**
 * Round-5 #5 — Subclass hover RESOLUTION (not just hash construction).
 *
 * Many character-sheet subclass hovers threw "Failed to load renderable content"
 * because the sheet queried the DataLoader hover cache with the *class* source
 * (e.g. "TGTT") while subclasses are cached under their own *subclass* source
 * (e.g. "TGTT-2024") — the exact key the standard `{@subclass}` renderer uses.
 *
 * These tests exercise the REAL pipeline end-to-end:
 *   1. register a loaded subclass with the real `DataLoader._pCache_addToCache`
 *      (the same mechanism `_registerLoadedHoverEntities` uses), then
 *   2. build the hover target with `CharacterSheetClassUtils.buildSubclassHoverTarget`,
 *      and assert `DataLoader.getFromCache(page, source, hash)` returns the entity.
 *
 * A regression guard asserts the entity MISSES when queried under the class
 * source — pinning the source-alignment fix.
 */

import "./setup.js";
import "../../../js/parser.js";
import "../../../js/utils.js";
import "../../../js/hist.js";
import "../../../js/utils-dataloader.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";

const UrlUtil = globalThis.UrlUtil;
const DataLoader = globalThis.DataLoader;
const CharacterSheetClassUtils = globalThis.CharacterSheetClassUtils;

beforeAll(() => {
	// Partition helpers are consulted only for LIST caches; stub them so any
	// incidental reference during cache ops resolves to "not a known partition".
	globalThis.PrereleaseUtil = globalThis.PrereleaseUtil || {hasSourceJson: () => false, getCacheIteration: () => 0};
	globalThis.BrewUtil2 = globalThis.BrewUtil2 || {hasSourceJson: () => false, getCacheIteration: () => 0};
});

/** Mirror `_registerLoadedHoverEntities`: seed the cache from loaded arrays. */
function registerSubclasses (subclasses) {
	DataLoader._pCache_addToCache({
		allDataMerged: {subclass: subclasses},
		propAllowlist: new Set(["subclass"]),
	});
}

/** A subclass entity as it lives in `this._subclasses` (brew-merged, copy-resolved). */
function makeSubclass ({name, shortName, source, className, classSource}) {
	return {
		name,
		shortName: shortName || name,
		source,
		className,
		classSource,
		subclassFeatures: [],
	};
}

// name → {stored character ref, loaded entity}. Stored ref mimics `cls.subclass`.
const FIXTURES = [
	{
		label: "Banneret (Fighter) — subclass source differs from class source",
		entity: makeSubclass({name: "Banneret", source: "TGTT-2024", className: "Fighter", classSource: "TGTT"}),
		stored: {name: "Banneret", source: "TGTT-2024", className: "Fighter", classSource: "TGTT", shortName: "Banneret"},
		classSource: "TGTT",
	},
	{
		label: "Hunter (Ranger) — TGTT-2024 subclass on TGTT class",
		entity: makeSubclass({name: "Hunter", source: "TGTT-2024", className: "Ranger", classSource: "TGTT"}),
		stored: {name: "Hunter", source: "TGTT-2024", className: "Ranger", classSource: "TGTT", shortName: "Hunter"},
		classSource: "TGTT",
	},
	{
		label: "Circle of the Zodiac (Druid) — TGTT subclass on XPHB class",
		entity: makeSubclass({name: "Circle of the Zodiac", shortName: "Zodiac", source: "TGTT", className: "Druid", classSource: "XPHB"}),
		stored: {name: "Circle of the Zodiac", source: "TGTT", className: "Druid", classSource: "XPHB", shortName: "Zodiac"},
		classSource: "XPHB",
	},
	{
		label: "Bladesinging (Wizard) — TGTT-2014 subclass on TGTT class",
		entity: makeSubclass({name: "Bladesinging", source: "TGTT-2014", className: "Wizard", classSource: "TGTT"}),
		stored: {name: "Bladesinging", source: "TGTT-2014", className: "Wizard", classSource: "TGTT", shortName: "Bladesinging"},
		classSource: "TGTT",
	},
];

describe("buildSubclassHoverTarget — DataLoader resolution under the subclass source", () => {
	for (const fx of FIXTURES) {
		describe(fx.label, () => {
			beforeAll(() => registerSubclasses([fx.entity]));

			test("hash equals the canonical URL_TO_HASH_BUILDER['subclass'] hash", () => {
				const target = CharacterSheetClassUtils.buildSubclassHoverTarget(fx.stored, {allSubclasses: [fx.entity]});
				expect(target.hash).toBe(UrlUtil.URL_TO_HASH_BUILDER["subclass"](fx.entity));
			});

			test("target uses the SUBCLASS source and the classes page", () => {
				const target = CharacterSheetClassUtils.buildSubclassHoverTarget(fx.stored, {allSubclasses: [fx.entity]});
				expect(target.page).toBe(UrlUtil.PG_CLASSES);
				expect(target.source).toBe(fx.entity.source);
			});

			test("DataLoader.getFromCache resolves the entity at the built target", () => {
				const target = CharacterSheetClassUtils.buildSubclassHoverTarget(fx.stored, {allSubclasses: [fx.entity]});
				const resolved = DataLoader.getFromCache(target.page, target.source, target.hash);
				expect(resolved).toBeTruthy();
				expect(resolved.name).toBe(fx.entity.name);
				expect(resolved.source).toBe(fx.entity.source);
			});

			test("regression guard: querying under the CLASS source MISSES", () => {
				const target = CharacterSheetClassUtils.buildSubclassHoverTarget(fx.stored, {allSubclasses: [fx.entity]});
				// Only meaningful when the two sources actually differ.
				if (fx.classSource === fx.entity.source) return;
				const missed = DataLoader.getFromCache(target.page, fx.classSource, target.hash);
				expect(missed).toBeFalsy();
			});
		});
	}

	test("falls back to a synthetic descriptor when the entity isn't loaded", () => {
		const stored = {name: "Phantom", source: "ZZZ", className: "Rogue", classSource: "PHB", shortName: "Phantom"};
		const target = CharacterSheetClassUtils.buildSubclassHoverTarget(stored, {allSubclasses: []});
		expect(target.page).toBe(UrlUtil.PG_CLASSES);
		expect(target.source).toBe("ZZZ");
		expect(target.hash).toBe(UrlUtil.URL_TO_HASH_BUILDER["subclass"](stored));
	});

	test("recovers className/classSource/shortName from the loaded pool when the stored ref is sparse", () => {
		const entity = makeSubclass({name: "Hunter", source: "TGTT-2024", className: "Ranger", classSource: "TGTT"});
		registerSubclasses([entity]);
		// Character only stored {name, source} (the common sparse shape).
		const sparse = {name: "Hunter", source: "TGTT-2024"};
		const target = CharacterSheetClassUtils.buildSubclassHoverTarget(sparse, {allSubclasses: [entity]});
		expect(target.source).toBe("TGTT-2024");
		expect(target.hash).toBe(UrlUtil.URL_TO_HASH_BUILDER["subclass"](entity));
		const resolved = DataLoader.getFromCache(target.page, target.source, target.hash);
		expect(resolved).toBeTruthy();
		expect(resolved.name).toBe("Hunter");
	});
});
