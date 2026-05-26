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
