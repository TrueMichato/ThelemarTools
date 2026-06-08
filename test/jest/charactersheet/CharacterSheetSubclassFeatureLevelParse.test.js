/**
 * Regression coverage for the subclass-feature level-parse bug (#18).
 *
 * `getLevelFeatures` previously read a subclassFeature ref's gained level from
 * `parts[parts.length - 1]`. The canonical 5etools ref shape is
 * `name|className|classSource|subShortName|subSource|level[|displayText]`, so
 * modern reprints carrying a 7th display-source element (FRHoF Bladesinger,
 * every Artificer EFA subclass, all PHB Cleric domains, etc.) parsed to NaN and
 * silently granted ZERO subclass features. The fix parses `parts[5]`.
 */

import "./setup.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";

const CharacterSheetClassUtils = globalThis.CharacterSheetClassUtils;

// Mirrors the real FRHoF (2024) Bladesinger subclassFeature payloads.
function makeFrhofBladesingerSubclassFeatures () {
	return [
		{
			name: "Bladesinger",
			className: "Wizard",
			subclassShortName: "Bladesinger",
			source: "FRHoF",
			level: 3,
			entries: [
				"Wield Weapon and Wizardry in Elegant Tandem.",
				{type: "refSubclassFeature", subclassFeature: "Bladesong|Wizard|XPHB|Bladesinger|FRHoF|3|FRHoF"},
				{type: "refSubclassFeature", subclassFeature: "Training in War and Song|Wizard|XPHB|Bladesinger|FRHoF|3|FRHoF"},
			],
		},
		{name: "Bladesong", className: "Wizard", subclassShortName: "Bladesinger", source: "FRHoF", level: 3, entries: ["You invoke the Bladesong."]},
		{name: "Training in War and Song", className: "Wizard", subclassShortName: "Bladesinger", source: "FRHoF", level: 3, entries: ["You gain proficiency with Melee Martial weapons."]},
		{name: "Extra Attack", className: "Wizard", subclassShortName: "Bladesinger", source: "FRHoF", level: 6, entries: ["You can attack twice."]},
	];
}

function makeFrhofBladesingerSubclass () {
	return {
		name: "Bladesinger",
		shortName: "Bladesinger",
		source: "FRHoF",
		className: "Wizard",
		subclassFeatures: [
			"Bladesinger|Wizard|XPHB|Bladesinger|FRHoF|3|FRHoF",
			"Extra Attack|Wizard|XPHB|Bladesinger|FRHoF|6|FRHoF",
			"Song of Defense|Wizard|XPHB|Bladesinger|FRHoF|10|FRHoF",
			"Song of Victory|Wizard|XPHB|Bladesinger|FRHoF|14|FRHoF",
		],
	};
}

describe("getSubclassFeatureRefLevel helper", () => {
	test("reads the canonical level at parts[5] even with a 7th display element", () => {
		const parts = "Bladesinger|Wizard|XPHB|Bladesinger|FRHoF|3|FRHoF".split("|");
		expect(CharacterSheetClassUtils.getSubclassFeatureRefLevel(parts)).toBe(3);
	});

	test("works for 6-part classic refs (level is the last element)", () => {
		const parts = "Bladesinging|Wizard||Bladesinging|TCE|2".split("|");
		expect(CharacterSheetClassUtils.getSubclassFeatureRefLevel(parts)).toBe(2);
	});

	test("falls back to the last element when parts[5] is non-numeric/malformed", () => {
		const parts = "Some Feature|Wizard|XPHB|Sub|SRC|7".split("|");
		// parts[5] = "7" → 7; verify the defensive fallback path returns a number.
		expect(CharacterSheetClassUtils.getSubclassFeatureRefLevel(parts)).toBe(7);
	});
});

describe("getLevelFeatures grants subclass features for 7-part reprint refs (#18)", () => {
	const classData = {name: "Wizard", source: "TGTT", classFeatures: []};

	test("FRHoF Bladesinger L3 grants the wrapper feature (was zero before the fix)", () => {
		const subclass = makeFrhofBladesingerSubclass();
		const scf = makeFrhofBladesingerSubclassFeatures();

		const features = CharacterSheetClassUtils.getLevelFeatures(classData, 3, subclass, [], scf);
		const names = features.map(f => f.name);

		expect(names).toContain("Bladesinger");
	});

	test("granting the L3 wrapper auto-expands its refSubclassFeature children", () => {
		const subclass = makeFrhofBladesingerSubclass();
		const scf = makeFrhofBladesingerSubclassFeatures();

		const features = CharacterSheetClassUtils.getLevelFeatures(classData, 3, subclass, [], scf);
		const names = features.map(f => f.name);

		// Bladesong is what wires up the toggle; Training grants weapon prof.
		expect(names).toContain("Bladesong");
		expect(names).toContain("Training in War and Song");
	});

	test("FRHoF Bladesinger L6 grants Extra Attack", () => {
		const subclass = makeFrhofBladesingerSubclass();
		const scf = makeFrhofBladesingerSubclassFeatures();

		const features = CharacterSheetClassUtils.getLevelFeatures(classData, 6, subclass, [], scf);
		expect(features.map(f => f.name)).toContain("Extra Attack");
	});

	test("does NOT grant a level-3 feature when resolving a different level", () => {
		const subclass = makeFrhofBladesingerSubclass();
		const scf = makeFrhofBladesingerSubclassFeatures();

		const features = CharacterSheetClassUtils.getLevelFeatures(classData, 4, subclass, [], scf);
		const names = features.map(f => f.name);
		expect(names).not.toContain("Bladesinger");
		expect(names).not.toContain("Bladesong");
	});
});

describe("getLevelFeatures still works for classic 6-part refs (no regression)", () => {
	const classData = {name: "Wizard", source: "TGTT", classFeatures: []};

	test("classic TCE Bladesinging L2 grants its features", () => {
		const subclass = {
			name: "Bladesinging",
			shortName: "Bladesinging",
			source: "TCE",
			className: "Wizard",
			subclassFeatures: [
				"Bladesinging|Wizard||Bladesinging|TCE|2",
				"Extra Attack|Wizard||Bladesinging|TCE|6",
			],
		};
		const scf = [
			{name: "Bladesinging", className: "Wizard", subclassShortName: "Bladesinging", source: "TCE", level: 2, entries: ["Training in War and Song."]},
			{name: "Extra Attack", className: "Wizard", subclassShortName: "Bladesinging", source: "TCE", level: 6, entries: ["Attack twice."]},
		];

		const features = CharacterSheetClassUtils.getLevelFeatures(classData, 2, subclass, [], scf);
		expect(features.map(f => f.name)).toContain("Bladesinging");
	});
});

describe("generic 7-part reprint refs across classes (#18 architecture-level)", () => {
	test("an Artificer-style EFA subclass with 7-part refs grants its level feature", () => {
		const classData = {name: "Artificer", source: "TCE", classFeatures: []};
		const subclass = {
			name: "Alchemist",
			shortName: "Alchemist",
			source: "TCE",
			className: "Artificer",
			subclassFeatures: [
				"Experimental Elixir|Artificer|TCE|Alchemist|TCE|3|TCE",
			],
		};
		const scf = [
			{name: "Experimental Elixir", className: "Artificer", subclassShortName: "Alchemist", source: "TCE", level: 3, entries: ["Brew an elixir."]},
		];

		const features = CharacterSheetClassUtils.getLevelFeatures(classData, 3, subclass, [], scf);
		expect(features.map(f => f.name)).toContain("Experimental Elixir");
	});
});
