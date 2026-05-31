/**
 * Hover-link source resolution for class / subclass features.
 *
 * Regression coverage for the Bladesinger hover bug: when a saved subclass
 * feature has `classSource` undefined and `source` set to the SUBCLASS source
 * (e.g. "TCE" for Bladesinging), the hover-hash builder must use the stored
 * class's source ("PHB" for Wizard) for the class-source slot — not
 * `feature.source` — otherwise the resulting hash points at a non-existent
 * `wizard_tce` class and the tooltip errors out with
 * "Failed to load renderable content".
 *
 * Canonical hash (verified in `search/index.json`) is e.g.
 *   bladesong_wizard_phb_bladesinging_tce_2_tce
 */

import "./setup.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import {jest} from "@jest/globals";

const CharacterSheetClassUtils = globalThis.CharacterSheetClassUtils;

describe("CharacterSheetClassUtils.resolveFeatureHoverSources", () => {
	const storedWizardPhb = {name: "Wizard", source: "PHB"};
	const storedWarlockTgtt = {name: "Warlock", source: "TGTT"};

	describe("subclass features with missing classSource (legacy saves)", () => {
		// Each of the four Bladesinger features the bug report flagged.
		const bladesingerFeatures = [
			"Bladesong",
			"Bladesinging",
			"Bladesinger Styles",
			"Training in War and Song (Bladesinging)",
		];

		test.each(bladesingerFeatures)(
			"%s — resolves class source to PHB, not TCE",
			(name) => {
				const feature = {
					name,
					className: "Wizard",
					// classSource intentionally absent — older saves did not store it
					subclassName: "Bladesinging",
					subclassShortName: "Bladesinging",
					subclassSource: "TCE",
					source: "TCE", // subclass source, NOT class source
					level: 2,
					isSubclassFeature: true,
				};

				const {classSource, featureSource} =
					CharacterSheetClassUtils.resolveFeatureHoverSources(feature, storedWizardPhb);

				expect(classSource).toBe("PHB");
				expect(featureSource).toBe("TCE");
			},
		);

		test("falls back to XPHB when neither feature.classSource nor storedClass is available", () => {
			const feature = {
				name: "Mystery Subclass Feature",
				className: "Wizard",
				subclassShortName: "Bladesinging",
				source: "TCE",
				level: 2,
				isSubclassFeature: true,
			};

			const {classSource} = CharacterSheetClassUtils.resolveFeatureHoverSources(feature, null);

			expect(classSource).toBe("XPHB");
		});
	});

	describe("subclass features with explicit classSource", () => {
		test("preserves a correctly-set classSource", () => {
			const feature = {
				name: "Bladesong",
				className: "Wizard",
				classSource: "PHB",
				subclassName: "Bladesinging",
				subclassShortName: "Bladesinging",
				subclassSource: "TCE",
				source: "TCE",
				level: 2,
				isSubclassFeature: true,
			};

			const {classSource, featureSource} =
				CharacterSheetClassUtils.resolveFeatureHoverSources(feature, storedWizardPhb);

			expect(classSource).toBe("PHB");
			expect(featureSource).toBe("TCE");
		});
	});

	describe("class (non-subclass) features", () => {
		test("uses feature.classSource when set", () => {
			const feature = {
				name: "Action Surge",
				className: "Fighter",
				classSource: "PHB",
				source: "PHB",
				level: 2,
			};

			const {classSource} = CharacterSheetClassUtils.resolveFeatureHoverSources(
				feature,
				{name: "Fighter", source: "PHB"},
			);
			expect(classSource).toBe("PHB");
		});

		test("falls back to official feature.source when classSource is missing", () => {
			const feature = {
				name: "Action Surge",
				className: "Fighter",
				source: "PHB",
				level: 2,
			};

			const {classSource} = CharacterSheetClassUtils.resolveFeatureHoverSources(
				feature,
				{name: "Fighter", source: "PHB"},
			);
			expect(classSource).toBe("PHB");
		});

		test("homebrew class referencing an official feature — prefers the official source", () => {
			// TGTT Warlock storing an XPHB feature (e.g. Magical Cunning).
			const feature = {
				name: "Magical Cunning",
				className: "Warlock",
				classSource: "TGTT",
				source: "XPHB",
				level: 2,
			};

			const {classSource, featureSource} =
				CharacterSheetClassUtils.resolveFeatureHoverSources(feature, storedWarlockTgtt);

			expect(classSource).toBe("XPHB");
			expect(featureSource).toBe("XPHB");
		});

		test("homebrew class with homebrew feature — keeps the homebrew class source", () => {
			const feature = {
				name: "Custom TGTT Feature",
				className: "Warlock",
				classSource: "TGTT",
				source: "TGTT",
				level: 1,
			};

			const {classSource} = CharacterSheetClassUtils.resolveFeatureHoverSources(
				feature,
				storedWarlockTgtt,
			);
			expect(classSource).toBe("TGTT");
		});
	});
});

describe("CharacterSheetClassUtils._isHoverOfficialSource", () => {
	test("recognises core 5e source codes (case-insensitive)", () => {
		const isOfficial = CharacterSheetClassUtils._isHoverOfficialSource;
		for (const src of ["PHB", "XPHB", "TCE", "XGE", "DMG", "MM"]) {
			expect(isOfficial(src)).toBe(true);
			expect(isOfficial(src.toLowerCase())).toBe(true);
		}
	});

	test("rejects homebrew sources", () => {
		const isOfficial = CharacterSheetClassUtils._isHoverOfficialSource;
		expect(isOfficial("TGTT")).toBe(false);
		expect(isOfficial("HB")).toBe(false);
		expect(isOfficial(null)).toBe(false);
		expect(isOfficial(undefined)).toBe(false);
		expect(isOfficial("")).toBe(false);
	});
});

describe("CharacterSheetClassUtils.resolveCanonicalFeatureHoverSources (Bug 12 / Phase 5.5a)", () => {
	// TGTT Wizard with the Chronurgy Magic (EGW) subclass: the subclass feature
	// `Chronal Shift` is referenced via `refSubclassFeature` with parts[2]=""
	// so `getLevelFeatures` resolves classSource → "TGTT". The canonical feature
	// is at classSource=PHB, subclassSource=EGW. Without this fallback the hover
	// hash leaks the homebrew class source and the tooltip fails to load.
	const storedTgttWizard = {name: "Wizard", source: "TGTT"};

	test("subclass feature falls back to canonical match in loaded subclassFeatures", () => {
		const feature = {
			name: "Chronal Shift",
			className: "Wizard",
			classSource: "TGTT",
			subclassName: "Chronurgy Magic",
			subclassShortName: "Chronurgy",
			subclassSource: "EGW",
			source: "EGW",
			level: 2,
			isSubclassFeature: true,
		};

		const loadedSubclassFeatures = [{
			name: "Chronal Shift",
			className: "Wizard",
			classSource: "PHB",
			subclassShortName: "Chronurgy",
			subclassSource: "EGW",
			source: "EGW",
			level: 2,
		}];

		const out = CharacterSheetClassUtils.resolveCanonicalFeatureHoverSources(
			feature,
			storedTgttWizard,
			{classFeatures: [], subclassFeatures: loadedSubclassFeatures},
		);

		expect(out.classSource).toBe("PHB");
		expect(out.featureSource).toBe("EGW");
		expect(out.subclassSource).toBe("EGW");
	});

	test("class feature falls back to canonical match in loaded classFeatures (TGTT Warlock → XPHB)", () => {
		const feature = {
			name: "Magical Cunning",
			className: "Warlock",
			classSource: "TGTT",
			source: "TGTT",
			level: 2,
			featureType: "Class",
		};

		const loadedClassFeatures = [{
			name: "Magical Cunning",
			className: "Warlock",
			classSource: "XPHB",
			source: "XPHB",
			level: 2,
		}];

		const out = CharacterSheetClassUtils.resolveCanonicalFeatureHoverSources(
			feature,
			{name: "Warlock", source: "TGTT"},
			{classFeatures: loadedClassFeatures, subclassFeatures: []},
		);

		expect(out.classSource).toBe("XPHB");
		expect(out.featureSource).toBe("XPHB");
	});

	test("returns resolveFeatureHoverSources result unchanged when classSource is already official", () => {
		const feature = {
			name: "Bladesong",
			className: "Wizard",
			subclassShortName: "Bladesinging",
			subclassSource: "TCE",
			source: "TCE",
			level: 2,
			isSubclassFeature: true,
		};

		const out = CharacterSheetClassUtils.resolveCanonicalFeatureHoverSources(
			feature,
			{name: "Wizard", source: "PHB"},
			{classFeatures: [], subclassFeatures: []},
		);

		// resolveFeatureHoverSources already resolves classSource → PHB for this case.
		// The canonical lookup is a no-op (and subclassSource is null because we didn't
		// search loaded features).
		expect(out.classSource).toBe("PHB");
		expect(out.featureSource).toBe("TCE");
		expect(out.subclassSource).toBeNull();
	});

	test("returns degraded but valid result when no canonical match exists", () => {
		const feature = {
			name: "Made-up Wizard Subclass Feature",
			className: "Wizard",
			classSource: "TGTT",
			subclassName: "Made-up",
			subclassShortName: "Made-up",
			subclassSource: "HB",
			source: "HB",
			level: 2,
			isSubclassFeature: true,
		};

		const out = CharacterSheetClassUtils.resolveCanonicalFeatureHoverSources(
			feature,
			storedTgttWizard,
			{classFeatures: [], subclassFeatures: []},
		);

		// No canonical match found — preserves the input classSource (still TGTT)
		// and returns null subclassSource. Callers fall back to feature.subclassSource.
		expect(out.classSource).toBe("TGTT");
		expect(out.featureSource).toBe("HB");
		expect(out.subclassSource).toBeNull();
	});
});

describe("CharacterSheetClassUtils.normalizePgClassesHashInput (Bug 12 / Phase 5.5b)", () => {
	// Minimal fake class/subclass data — only the fields the helper reads.
	const allClasses = [
		{name: "Wizard", source: "TGTT"},
		{name: "Wizard", source: "PHB"},
		{name: "Sorcerer", source: "TGTT"},
	];
	const allSubclasses = [
		{name: "Chronurgy Magic", source: "TGTT-2014", className: "Wizard", classSource: "TGTT"},
		{name: "Chronurgy Magic", source: "EGW", className: "Wizard", classSource: "PHB"},
		{name: "Bladesinging", source: "TCE", className: "Wizard", classSource: "PHB"},
	];

	beforeEach(() => {
		// Reset the one-time warn set between tests so warning behavior is observable.
		if (CharacterSheetClassUtils._pgClassesWarnSet) {
			CharacterSheetClassUtils._pgClassesWarnSet.clear();
		}
	});

	test("known class passes through unchanged", () => {
		const out = CharacterSheetClassUtils.normalizePgClassesHashInput(
			{name: "Wizard", source: "TGTT"},
			{allClasses, allSubclasses},
		);
		expect(out.name).toBe("Wizard");
		expect(out.source).toBe("TGTT");
		expect(out.wasNormalized).toBe(false);
	});

	test("known subclass in class slot gets substituted to parent class", () => {
		const out = CharacterSheetClassUtils.normalizePgClassesHashInput(
			{name: "Chronurgy Magic", source: "TGTT-2014"},
			{allClasses, allSubclasses},
		);
		// Should rewrite to the parent class (Wizard) using the subclass's classSource (TGTT).
		expect(out.name).toBe("Wizard");
		expect(out.source).toBe("TGTT");
		expect(out.wasNormalized).toBe(true);
	});

	test("unknown name+source (neither class nor subclass) passes through unchanged", () => {
		const out = CharacterSheetClassUtils.normalizePgClassesHashInput(
			{name: "Made-Up Class", source: "HB"},
			{allClasses, allSubclasses},
		);
		expect(out.name).toBe("Made-Up Class");
		expect(out.source).toBe("HB");
		expect(out.wasNormalized).toBe(false);
	});

	test("missing/empty input is a safe no-op", () => {
		const outNull = CharacterSheetClassUtils.normalizePgClassesHashInput(null, {allClasses, allSubclasses});
		expect(outNull.wasNormalized).toBe(false);
		const outEmpty = CharacterSheetClassUtils.normalizePgClassesHashInput({}, {allClasses, allSubclasses});
		expect(outEmpty.wasNormalized).toBe(false);
	});

	test("missing data registries do not throw", () => {
		expect(() => CharacterSheetClassUtils.normalizePgClassesHashInput(
			{name: "Chronurgy Magic", source: "TGTT-2014"},
			{},
		)).not.toThrow();
		expect(() => CharacterSheetClassUtils.normalizePgClassesHashInput(
			{name: "Chronurgy Magic", source: "TGTT-2014"},
			{allClasses: null, allSubclasses: undefined},
		)).not.toThrow();
	});

	test("one-time warning fires only once per unique (name|source)", () => {
		const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
		try {
			// First call — should warn.
			CharacterSheetClassUtils.normalizePgClassesHashInput(
				{name: "Chronurgy Magic", source: "TGTT-2014"},
				{allClasses, allSubclasses},
			);
			const callsAfterFirst = warnSpy.mock.calls.length;
			expect(callsAfterFirst).toBeGreaterThanOrEqual(1);
			// Second call — same key, should NOT add another warning.
			CharacterSheetClassUtils.normalizePgClassesHashInput(
				{name: "Chronurgy Magic", source: "TGTT-2014"},
				{allClasses, allSubclasses},
			);
			expect(warnSpy.mock.calls.length).toBe(callsAfterFirst);
			// Different key — should warn again.
			CharacterSheetClassUtils.normalizePgClassesHashInput(
				{name: "Bladesinging", source: "TCE"},
				{allClasses, allSubclasses},
			);
			expect(warnSpy.mock.calls.length).toBeGreaterThan(callsAfterFirst);
		} finally {
			warnSpy.mockRestore();
		}
	});
});

describe("CharacterSheetClassUtils.resolveFullSubclass (Bug 5 / Phase 5.2)", () => {
	// Fixture: a fake Wizard classData with full Chronurgy Magic and Divine Soul-ish
	// subclasses carrying the lazy properties picker code needs (`additionalSpells`).
	const chronurgyFull = {
		name: "Chronurgy Magic",
		shortName: "Chronurgy",
		source: "EGW",
		className: "Wizard",
		classSource: "PHB",
		additionalSpells: [
			{
				expanded: {
					"1": {all: "source=EGW"},
				},
			},
		],
		subclassFeatures: ["Chronurgy Magic|Wizard||Chronurgy|EGW|2"],
	};
	const bladesingerFull = {
		name: "Bladesinging",
		shortName: "Bladesinging",
		source: "TCE",
		className: "Wizard",
		classSource: "PHB",
		additionalSpells: [
			{
				expanded: {
					"3": {all: "level=1|class=Wizard"},
				},
			},
		],
	};
	const classDataWizard = {
		name: "Wizard",
		source: "PHB",
		subclasses: [chronurgyFull, bladesingerFull],
	};

	const divineSoulFull = {
		name: "Divine Soul",
		shortName: "Divine Soul",
		source: "XGE",
		className: "Sorcerer",
		classSource: "PHB",
		additionalSpells: [
			{
				known: {
					_: {
						daily: {
							"1e": ["cure wounds"],
						},
					},
				},
			},
		],
	};
	const classDataSorcerer = {
		name: "Sorcerer",
		source: "PHB",
		subclasses: [divineSoulFull],
	};

	it("returns null when the stored subclass is null", () => {
		expect(CharacterSheetClassUtils.resolveFullSubclass(null, classDataWizard)).toBeNull();
		expect(CharacterSheetClassUtils.resolveFullSubclass(undefined, classDataWizard)).toBeNull();
	});

	it("returns the input unchanged when classData has no subclasses array", () => {
		const shallow = {name: "Chronurgy Magic", source: "EGW"};
		expect(CharacterSheetClassUtils.resolveFullSubclass(shallow, null)).toBe(shallow);
		expect(CharacterSheetClassUtils.resolveFullSubclass(shallow, {name: "Wizard"})).toBe(shallow);
		expect(CharacterSheetClassUtils.resolveFullSubclass(shallow, {name: "Wizard", subclasses: []})).toBe(shallow);
	});

	it("fast-path: returns the full subclass unchanged when it already has additionalSpells", () => {
		const resolved = CharacterSheetClassUtils.resolveFullSubclass(chronurgyFull, classDataWizard);
		expect(resolved).toBe(chronurgyFull);
	});

	it("fast-path: returns full subclass unchanged when it has subclassFeatures", () => {
		const fullByFeatures = {name: "Other", source: "X", subclassFeatures: ["whatever"]};
		expect(CharacterSheetClassUtils.resolveFullSubclass(fullByFeatures, classDataWizard)).toBe(fullByFeatures);
	});

	it("resolves shallow Chronurgy ref to the full subclass with additionalSpells", () => {
		const shallow = {name: "Chronurgy Magic", source: "EGW"};
		const resolved = CharacterSheetClassUtils.resolveFullSubclass(shallow, classDataWizard);
		expect(resolved).toBe(chronurgyFull);
		expect(resolved.additionalSpells).toBeDefined();
	});

	it("resolves shallow Divine Soul ref to the full subclass with additionalSpells", () => {
		const shallow = {name: "Divine Soul", source: "XGE"};
		const resolved = CharacterSheetClassUtils.resolveFullSubclass(shallow, classDataSorcerer);
		expect(resolved).toBe(divineSoulFull);
		expect(resolved.additionalSpells).toBeDefined();
	});

	it("resolves shallow Bladesinging ref to full subclass", () => {
		const shallow = {name: "Bladesinging", source: "TCE"};
		const resolved = CharacterSheetClassUtils.resolveFullSubclass(shallow, classDataWizard);
		expect(resolved).toBe(bladesingerFull);
	});

	it("matches name case-insensitively", () => {
		const shallow = {name: "chronurgy magic", source: "EGW"};
		const resolved = CharacterSheetClassUtils.resolveFullSubclass(shallow, classDataWizard);
		expect(resolved).toBe(chronurgyFull);
	});

	it("name-only fallback: legacy save without source still resolves", () => {
		const shallow = {name: "Chronurgy Magic"};
		const resolved = CharacterSheetClassUtils.resolveFullSubclass(shallow, classDataWizard);
		expect(resolved).toBe(chronurgyFull);
	});

	it("name-only fallback when source mismatch (e.g. brew source rename)", () => {
		const shallow = {name: "Chronurgy Magic", source: "SOMEOTHERBREW"};
		// Exact (name+source) fails, but name-only fallback finds it.
		const resolved = CharacterSheetClassUtils.resolveFullSubclass(shallow, classDataWizard);
		expect(resolved).toBe(chronurgyFull);
	});

	it("returns the shallow input when name is missing and unresolvable", () => {
		const shallow = {source: "EGW"};
		const resolved = CharacterSheetClassUtils.resolveFullSubclass(shallow, classDataWizard);
		expect(resolved).toBe(shallow);
	});

	it("returns the shallow input when no subclass matches by name at all", () => {
		const shallow = {name: "Nonexistent Subclass", source: "XGE"};
		const resolved = CharacterSheetClassUtils.resolveFullSubclass(shallow, classDataWizard);
		expect(resolved).toBe(shallow);
	});
});
