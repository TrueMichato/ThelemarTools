/**
 * Bug 12 regression — Hover routing for class/subclass features and
 * subclass links must resolve to the CANONICAL classSource, not the
 * homebrew copy source. For TGTT Wizard + Chronurgy Magic the Wizard
 * data lives at source=TGTT but the underlying Chronurgy subclass
 * features all carry classSource="PHB" — using the storedClass.source
 * leak produces unresolvable hashes like
 * `chronal%20shift_wizard_tgtt_chronurgy_egw_2_egw`.
 */
import "./setup.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";

const CharacterSheetClassUtils = globalThis.CharacterSheetClassUtils;

describe("resolveSubclassHoverSources (Bug 12)", () => {
	test("prefers explicit classSource on the subclass entry", () => {
		const subclass = {
			name: "Chronurgy Magic",
			source: "EGW",
			className: "Wizard",
			classSource: "PHB",
			shortName: "Chronurgy",
		};
		const out = CharacterSheetClassUtils.resolveSubclassHoverSources(subclass, []);
		expect(out.classSource).toBe("PHB");
		expect(out.source).toBe("EGW");
		expect(out.className).toBe("Wizard");
		expect(out.shortName).toBe("Chronurgy");
	});

	test("looks up classSource from loaded subclass data when stored subclass is missing it", () => {
		const storedSubclass = {name: "Chronurgy Magic", source: "EGW"};
		const loadedSubclasses = [
			{name: "School of Abjuration", source: "PHB", className: "Wizard", classSource: "PHB", shortName: "Abjuration"},
			{name: "Chronurgy Magic", source: "EGW", className: "Wizard", classSource: "PHB", shortName: "Chronurgy"},
		];
		const out = CharacterSheetClassUtils.resolveSubclassHoverSources(storedSubclass, loadedSubclasses);
		expect(out.classSource).toBe("PHB");
		expect(out.shortName).toBe("Chronurgy");
		expect(out.className).toBe("Wizard");
	});

	test("does NOT leak storedClass.source (TGTT) into classSource when canonical data is available", () => {
		const storedSubclass = {name: "Chronurgy Magic", source: "EGW"};
		const storedClass = {name: "Wizard", source: "TGTT"};
		const loadedSubclasses = [
			{name: "Chronurgy Magic", source: "EGW", className: "Wizard", classSource: "PHB", shortName: "Chronurgy"},
		];
		const out = CharacterSheetClassUtils.resolveSubclassHoverSources(storedSubclass, loadedSubclasses, storedClass);
		// The hover hash uses classSource — must be the CANONICAL "PHB", not "TGTT".
		expect(out.classSource).toBe("PHB");
	});

	test("falls back to storedClass.source only when nothing better is known", () => {
		const storedSubclass = {name: "Bespoke Mystery", source: "BREW"};
		const storedClass = {name: "Wizard", source: "TGTT"};
		const out = CharacterSheetClassUtils.resolveSubclassHoverSources(storedSubclass, [], storedClass);
		expect(out.classSource).toBe("TGTT");
		expect(out.source).toBe("BREW");
	});

	test("falls back to PHB when no class info at all", () => {
		const out = CharacterSheetClassUtils.resolveSubclassHoverSources({name: "Mystery", source: "X"}, []);
		expect(out.classSource).toBe("PHB");
	});
});

describe("resolveFeatureHoverSources for subclass features (Bug 12)", () => {
	test("respects explicit feature.classSource (canonical) even when storedClass is homebrew", () => {
		// Chronal Shift in canonical data has classSource="PHB"
		const feature = {
			name: "Chronal Shift",
			className: "Wizard",
			classSource: "PHB",
			source: "EGW",
			subclassName: "Chronurgy Magic",
			subclassSource: "EGW",
			featureType: "Class",
			level: 2,
		};
		const storedClass = {name: "Wizard", source: "TGTT"};
		const out = CharacterSheetClassUtils.resolveFeatureHoverSources(feature, storedClass);
		expect(out.classSource).toBe("PHB");
		expect(out.featureSource).toBe("EGW");
	});
});
