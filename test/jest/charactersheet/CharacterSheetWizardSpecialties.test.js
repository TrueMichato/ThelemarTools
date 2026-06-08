/**
 * Wizard Specialties surfacing (#17) — TGTT Wizard subclass-style specialty picker.
 *
 * TGTT "Specialties" is a class feature at Wizard L4/8/12/16/20: an `options`
 * picker (choose 1 specialty per tier). The L4 feature defines the 8-option
 * pool; higher tiers re-offer the SAME pool via a `{@classFeature Specialties|
 * Wizard|TGTT|4}` text reference ("gain another"). These tests lock in that
 * `findFeatureOptions` surfaces all 8 options at every tier — the mechanism the
 * Builder / LevelUp / QuickBuild pickers rely on to present specialty choices.
 */

import "./setup.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";

const CharacterSheetClassUtils = globalThis.CharacterSheetClassUtils;

const SPECIALTY_NAMES = [
	"Abjuration Specialty", "Conjuration Specialty", "Divination Specialty",
	"Enchantment Specialty", "Evocation Specialty", "Illusion Specialty",
	"Necromancy Specialty", "Transmutation Specialty",
];

// L4 feature: defines the 8-option pool.
function makeSpecialtiesL4 () {
	return {
		name: "Specialties",
		className: "Wizard",
		source: "TGTT",
		level: 4,
		entries: [
			"Choose one of the following specialties:",
			{
				type: "options",
				count: 1,
				entries: SPECIALTY_NAMES.map(n => ({
					type: "refClassFeature",
					classFeature: `${n}|Wizard|TGTT|4`,
				})),
			},
		],
	};
}

// Higher tier: re-offers the L4 pool via a text reference.
function makeSpecialtiesTier (level) {
	return {
		name: "Specialties",
		className: "Wizard",
		source: "TGTT",
		level,
		entries: [
			`You gain another specialty from {@classFeature Specialties|Wizard|TGTT|4}.`,
		],
	};
}

describe("Wizard Specialties surfacing (#17)", () => {
	const l4 = makeSpecialtiesL4();
	// classFeatures must contain the L4 feature so text-ref tiers can resolve it.
	const classFeatures = [l4];

	test("L4 Specialties surfaces all 8 options", () => {
		const results = CharacterSheetClassUtils.findFeatureOptions(l4, 4, classFeatures);
		expect(results).toHaveLength(1);
		expect(results[0].count).toBe(1);
		expect(results[0].options.map(o => o.name).sort()).toEqual([...SPECIALTY_NAMES].sort());
	});

	test.each([8, 12, 16, 20])("L%i Specialties re-offers the same 8-option pool via text reference", (level) => {
		const tier = makeSpecialtiesTier(level);
		const results = CharacterSheetClassUtils.findFeatureOptions(tier, level, classFeatures);

		// The text-reference handler resolves the L4 pool.
		expect(results.length).toBeGreaterThanOrEqual(1);
		const allOptionNames = results.flatMap(r => r.options.map(o => o.name)).sort();
		expect(allOptionNames).toEqual([...SPECIALTY_NAMES].sort());
	});

	test("an unrelated {@classFeature} reference without 'gain another' wording is NOT treated as a re-offer", () => {
		const feature = {
			name: "Specialties",
			className: "Wizard",
			source: "TGTT",
			level: 8,
			entries: ["See {@classFeature Specialties|Wizard|TGTT|4} for details."],
		};
		const results = CharacterSheetClassUtils.findFeatureOptions(feature, 8, classFeatures);
		expect(results).toHaveLength(0);
	});

	test("getFeatureOptionsForLevel exposes the Specialties picker for the level's features", () => {
		const features = [{name: "Specialties", source: "TGTT", className: "Wizard", level: 4, entries: l4.entries}];
		const all = CharacterSheetClassUtils.getFeatureOptionsForLevel(features, 4, classFeatures);
		const specialty = all.find(o => o.featureName === "Specialties");
		expect(specialty).toBeTruthy();
		expect(specialty.options.map(o => o.name).sort()).toEqual([...SPECIALTY_NAMES].sort());
	});
});
