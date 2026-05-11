/**
 * Regression / contract test for combat tradition filtering.
 *
 * Bug: every non-Fighter TGTT class (Ranger, Rogue, Monk, Paladin, Barbarian)
 * was being offered all 17 combat traditions in the builder / level-up /
 * quick-build pickers, because `getAvailableTraditionsForClass` short-circuited
 * on the degree-only `CTM:1..5` codes in `optionalfeatureProgression` before
 * trying the class-feature text extraction.
 *
 * Fix: prefer extraction first; degree-only "unrestricted" is only used when
 * extraction yields nothing (i.e. Fighter, whose feature has no tradition=
 * filter tags).
 *
 * This test exercises `CharacterSheetClassUtils.getAvailableTraditionsForClass`
 * directly with synthetic class-feature objects shaped like the TGTT data.
 */

import "../../../js/parser.js";
import "../../../js/utils.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";

const ClassUtils = globalThis.CharacterSheetClassUtils;

const DEGREE_ONLY_PROGRESSION = ["CTM:1", "CTM:2", "CTM:3", "CTM:4", "CTM:5"];

function makeCombatMethodsFeature (className, traditionNames) {
	// Mirror the TGTT data shape: a class feature with a list of entries
	// where one entry contains the `{@filter ...|combatmethods|tradition=Name}`
	// markers we want extracted.
	const filterTags = traditionNames
		.map(n => `{@filter ${n}|combatmethods|tradition=${n}}`)
		.join(", ");
	return {
		name: "Combat Methods",
		source: "TGTT",
		className,
		classSource: "TGTT",
		level: 2,
		entries: [
			"Lorem ipsum.",
			{
				type: "list",
				items: [
					`{@b Choose Traditions.} Gain proficiency in two combat traditions from ${filterTags}. Learn two methods.`,
					"{@b Set the DC.} ...",
				],
			},
		],
	};
}

function makeFighterFeature () {
	// Fighter's text uses a generic combat-traditions filter with NO
	// `tradition=Name` parameter; extraction should return nothing.
	return {
		name: "Combat Methods",
		source: "TGTT",
		className: "Fighter",
		classSource: "TGTT",
		level: 1,
		entries: [
			"Your 1st-level training unlocks tactical methods.",
			{
				type: "list",
				items: [
					"{@b Choose Traditions.} Gain proficiency in two {@filter combat traditions|combatmethods} of your choice and learn three methods.",
					"{@b Set the DC.} ...",
				],
			},
		],
	};
}

function codesOf (result) {
	return result.map(t => t.code).sort();
}

describe("Combat tradition filtering — getAvailableTraditionsForClass", () => {
	describe("Non-Fighter TGTT classes use class-feature extraction", () => {
		test("Ranger → 6 traditions (BZ, MG, RC, RE, SS, UW)", () => {
			const feature = makeCombatMethodsFeature("Ranger", [
				"Biting Zephyr",
				"Mirror's Glint",
				"Rapid Current",
				"Razor's Edge",
				"Spirited Steed",
				"Unending Wheel",
			]);
			const result = ClassUtils.getAvailableTraditionsForClass(
				[], DEGREE_ONLY_PROGRESSION, "Ranger", [feature],
			);
			expect(codesOf(result)).toEqual(["BZ", "MG", "RC", "RE", "SS", "UW"]);
		});

		test("Rogue → 3 traditions (BZ, MS, RC)", () => {
			const feature = makeCombatMethodsFeature("Rogue", [
				"Biting Zephyr",
				"Mist and Shade",
				"Rapid Current",
			]);
			const result = ClassUtils.getAvailableTraditionsForClass(
				[], DEGREE_ONLY_PROGRESSION, "Rogue", [feature],
			);
			expect(codesOf(result)).toEqual(["BZ", "MS", "RC"]);
		});

		test("Monk → 4 traditions (MG, RC, RE, UW)", () => {
			const feature = makeCombatMethodsFeature("Monk", [
				"Mirror's Glint",
				"Rapid Current",
				"Razor's Edge",
				"Unending Wheel",
			]);
			const result = ClassUtils.getAvailableTraditionsForClass(
				[], DEGREE_ONLY_PROGRESSION, "Monk", [feature],
			);
			expect(codesOf(result)).toEqual(["MG", "RC", "RE", "UW"]);
		});

		test("Paladin → 3 traditions (SK, SS, TI)", () => {
			const feature = makeCombatMethodsFeature("Paladin", [
				"Sanguine Knot",
				"Spirited Steed",
				"Tempered Iron",
			]);
			const result = ClassUtils.getAvailableTraditionsForClass(
				[], DEGREE_ONLY_PROGRESSION, "Paladin", [feature],
			);
			expect(codesOf(result)).toEqual(["SK", "SS", "TI"]);
		});

		test("Barbarian → 5 traditions (AM, MG, RC, TI, TC)", () => {
			const feature = makeCombatMethodsFeature("Barbarian", [
				"Adamant Mountain",
				"Mirror's Glint",
				"Rapid Current",
				"Tempered Iron",
				"Tooth and Claw",
			]);
			const result = ClassUtils.getAvailableTraditionsForClass(
				[], DEGREE_ONLY_PROGRESSION, "Barbarian", [feature],
			);
			expect(codesOf(result)).toEqual(["AM", "MG", "RC", "TC", "TI"]);
		});
	});

	describe("Fighter still receives all 17 traditions (extraction empty)", () => {
		test("Fighter feature text has no tradition= filters → full list", () => {
			const feature = makeFighterFeature();
			const result = ClassUtils.getAvailableTraditionsForClass(
				[], DEGREE_ONLY_PROGRESSION, "Fighter", [feature],
			);
			// Sanity check against the canonical full list — don't hard-code 17/18.
			expect(result.length).toBe(ClassUtils.getAllTraditions().length);
			expect(result.length).toBeGreaterThanOrEqual(17);
		});
	});

	describe("Tradition-specific progression codes override extraction", () => {
		test("CTM:1AM,CTM:2RC → exactly AM + RC, ignoring feature text", () => {
			// Even with a feature that lists 6 traditions, an explicit
			// progression takes precedence.
			const feature = makeCombatMethodsFeature("SomeHomebrew", [
				"Biting Zephyr",
				"Mirror's Glint",
				"Rapid Current",
				"Razor's Edge",
				"Spirited Steed",
				"Unending Wheel",
			]);
			const result = ClassUtils.getAvailableTraditionsForClass(
				[], ["CTM:1AM", "CTM:2RC"], "SomeHomebrew", [feature],
			);
			expect(codesOf(result)).toEqual(["AM", "RC"]);
		});
	});

	describe("Edge cases", () => {
		test("no progression + no feature → falls back to allFeatures pool", () => {
			// Should not throw; an empty fallback pool yields empty result.
			const result = ClassUtils.getAvailableTraditionsForClass(
				[], [], "UnknownClass", [],
			);
			expect(Array.isArray(result)).toBe(true);
		});

		test("degree-only + no className → returns all traditions", () => {
			const result = ClassUtils.getAvailableTraditionsForClass(
				[], DEGREE_ONLY_PROGRESSION, null, [],
			);
			expect(result.length).toBe(ClassUtils.getAllTraditions().length);
		});
	});
});
