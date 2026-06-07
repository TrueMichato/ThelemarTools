/**
 * Feature-option hover resolution (TGTT Ranger Specialties).
 *
 * Regression coverage for: hovering specialties like "Poisons and Antidotes"
 * threw `Failed to load renderable content for: page="classfeatures.html"
 * hash="poisons%20and%20antidotes_ranger_tgtt_2_tgtt"`. These specialties are
 * stored as `classFeature`-typed features flagged `isFeatureOption`/
 * `parentFeature: "Specialties"` — inline picks that do NOT exist as standalone
 * entities in the loadable classfeatures.html data pool, so the canonical hash
 * 404s. They DO carry their own `entries`, so the fix renders a local inline
 * hover from those instead.
 *
 * The decision + builder live in CharacterSheetClassUtils so they're unit
 * testable; the page's `_getFeatureHoverLink` and the Features tab both delegate.
 */

import "./setup.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";

const CharacterSheetClassUtils = globalThis.CharacterSheetClassUtils;

// A real Ranger specialty as stored on the character (Lunaria).
const specialty = {
	name: "Poisons and Antidotes",
	source: "TGTT",
	className: "Ranger",
	classSource: "TGTT",
	level: 2,
	featureType: "Class",
	isFeatureOption: true,
	parentFeature: "Specialties",
	entries: [
		"Once per long rest, after 1 hour of searching with a DC 10 Wisdom (Survival) check, spend 10 minutes to create 3 doses of basic poison.",
	],
};

// A genuine standalone class feature that DOES live in the data pool.
const realFeature = {
	name: "Extra Attack",
	className: "Ranger",
	classSource: "PHB",
	level: 5,
	featureType: "Class",
};

const pool = {
	classFeatures: [
		{name: "Extra Attack", className: "Ranger", classSource: "PHB", source: "PHB", level: 5},
		{name: "Primal Focus", className: "Ranger", classSource: "TGTT", source: "TGTT", level: 1},
	],
	subclassFeatures: [
		{name: "Hunter's Prey", className: "Ranger", classSource: "PHB", subclassShortName: "Hunter", subclassSource: "PHB", source: "PHB", level: 3},
	],
};

describe("findLoadedFeatureEntity — canonical-vs-local routing", () => {
	test("feature-option specialty is NOT found in the pool (→ local hover)", () => {
		expect(CharacterSheetClassUtils.findLoadedFeatureEntity(specialty, pool)).toBeUndefined();
	});

	test("a real standalone class feature IS found (→ canonical hash hover)", () => {
		const found = CharacterSheetClassUtils.findLoadedFeatureEntity(realFeature, pool);
		expect(found).toBeTruthy();
		expect(found.name).toBe("Extra Attack");
	});

	test("matches case-insensitively on name and class", () => {
		const found = CharacterSheetClassUtils.findLoadedFeatureEntity(
			{name: "extra attack", className: "ranger", level: 5}, pool,
		);
		expect(found).toBeTruthy();
	});

	test("subclass feature matches via subclass short-name + level", () => {
		const found = CharacterSheetClassUtils.findLoadedFeatureEntity(
			{name: "Hunter's Prey", className: "Ranger", subclassShortName: "Hunter", isSubclassFeature: true, level: 3},
			pool,
		);
		expect(found).toBeTruthy();
	});

	test("level mismatch is treated as not-found (canonical hash would 404)", () => {
		expect(CharacterSheetClassUtils.findLoadedFeatureEntity(
			{name: "Extra Attack", className: "Ranger", level: 11}, pool,
		)).toBeUndefined();
	});

	test("level compares numerically — a string-typed level still matches the pool", () => {
		// Stored saves can carry `level` as a string; it must not false-negative a
		// real loadable feature into the local-hover path.
		const found = CharacterSheetClassUtils.findLoadedFeatureEntity(
			{name: "Extra Attack", className: "Ranger", level: "5"}, pool,
		);
		expect(found).toBeTruthy();
		expect(found.name).toBe("Extra Attack");
	});

	test("returns undefined for features without name/className", () => {
		expect(CharacterSheetClassUtils.findLoadedFeatureEntity({}, pool)).toBeUndefined();
		expect(CharacterSheetClassUtils.findLoadedFeatureEntity({name: "X"}, pool)).toBeUndefined();
	});
});

describe("buildLocalFeatureHoverLink — inline hover from stored entries", () => {
	let origGetInlineHover;
	beforeEach(() => {
		origGetInlineHover = globalThis.Renderer.hover?.getInlineHover;
		globalThis.Renderer.hover = globalThis.Renderer.hover || {};
		globalThis.Renderer.hover.getInlineHover = (entry) => ({
			html: `data-vet-entry="${JSON.stringify(entry).replace(/"/g, "&quot;")}"`,
		});
	});
	afterEach(() => {
		globalThis.Renderer.hover.getInlineHover = origGetInlineHover;
	});

	test("builds a span with the feature name and an inline-hover marker (no classfeatures hash)", () => {
		const html = CharacterSheetClassUtils.buildLocalFeatureHoverLink(specialty);
		expect(html).toContain("Poisons and Antidotes");
		expect(html).toContain("data-vet-entry");
		expect(html).toContain("ve-help-subtle");
		// Crucially, it must NOT point at the unresolvable class-feature page.
		expect(html).not.toContain("classfeatures.html");
		expect(html).not.toContain("data-vet-page");
	});

	test("passes the feature's own entries to the renderer", () => {
		const seen = [];
		globalThis.Renderer.hover.getInlineHover = (entry) => {
			seen.push(entry);
			return {html: ""};
		};
		CharacterSheetClassUtils.buildLocalFeatureHoverLink(specialty);
		expect(seen).toHaveLength(1);
		expect(seen[0].type).toBe("entries");
		expect(seen[0].name).toBe("Poisons and Antidotes");
		expect(seen[0].entries).toEqual(specialty.entries);
	});

	test("returns null when the feature has no entries (caller falls back to plain name)", () => {
		expect(CharacterSheetClassUtils.buildLocalFeatureHoverLink({name: "X", entries: []})).toBeNull();
		expect(CharacterSheetClassUtils.buildLocalFeatureHoverLink({name: "X"})).toBeNull();
	});
});
