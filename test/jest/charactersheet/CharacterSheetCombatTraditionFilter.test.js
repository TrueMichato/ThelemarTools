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

	// Bug 1A: Fighter's L1 Combat Methods feature has an unrestricted main filter
	// (`{@filter combat traditions|combatmethods}`) BUT also includes a "Getting
	// Started" inset whose filters carry `|tradition=Name` (suggestion text).
	// Before the fix, the extractor matched the suggestion filters and locked
	// the pool to {TI, AM}. The fix detects the unrestricted-marker pattern and
	// returns the full 17.
	describe("Bug 1A — unrestricted marker beats inset tradition filters", () => {
		test("Fighter with unrestricted main filter + restricted inset → full list", () => {
			const feature = {
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
						],
					},
					{
						type: "inset",
						name: "Getting Started",
						entries: [
							"As a starting suggestion, consider picking from {@filter Tempered Iron|combatmethods|tradition=Tempered Iron} and {@filter Adamant Mountain|combatmethods|tradition=Adamant Mountain}.",
						],
					},
				],
			};
			const result = ClassUtils.getAvailableTraditionsForClass(
				[], DEGREE_ONLY_PROGRESSION, "Fighter", [feature],
			);
			// Full list — NOT just {TI, AM}.
			expect(result.length).toBe(ClassUtils.getAllTraditions().length);
		});

		test("extractTraditionsFromClassFeature returns empty Set for unrestricted-marker features", () => {
			const feature = {
				name: "Combat Methods",
				source: "TGTT",
				className: "Fighter",
				classSource: "TGTT",
				level: 1,
				entries: [
					{
						type: "list",
						items: [
							"{@b Choose Traditions.} Gain proficiency in two {@filter combat traditions|combatmethods} of your choice.",
						],
					},
					{
						type: "inset",
						name: "Getting Started",
						entries: [
							"Suggestion: {@filter Tempered Iron|combatmethods|tradition=Tempered Iron} and {@filter Adamant Mountain|combatmethods|tradition=Adamant Mountain}.",
						],
					},
				],
			};
			const extracted = ClassUtils.extractTraditionsFromClassFeature("Fighter", 5, [feature]);
			// Unrestricted marker present → caller falls through to full pool.
			expect(extracted instanceof Set).toBe(true);
			expect(extracted.size).toBe(0);
		});

		test("extractTraditionsFromClassFeature returns specific codes for restricted-only features", () => {
			// Mirror Ranger: only `|tradition=Name` filters, no unrestricted marker.
			const feature = makeCombatMethodsFeature("Ranger", [
				"Biting Zephyr",
				"Mirror's Glint",
				"Rapid Current",
				"Razor's Edge",
				"Spirited Steed",
				"Unending Wheel",
			]);
			const extracted = ClassUtils.extractTraditionsFromClassFeature("Ranger", 5, [feature]);
			expect(extracted instanceof Set).toBe(true);
			expect([...extracted].sort()).toEqual(["BZ", "MG", "RC", "RE", "SS", "UW"]);
		});
	});

	// Bug 1B: subclass-choice tradition pool — independent picker beyond the
	// base-class picker. Arcane Archer offers 2-of-4; Champion 2-of-3; Battle
	// Master / Kensei are unrestricted ("any tradition").
	describe("Bug 1B — getSubclassTraditionChoicePool", () => {
		test("Arcane Archer → restricted, 2 from [BZ, RE, UW, UH]", () => {
			const pool = ClassUtils.getSubclassTraditionChoicePool({name: "Arcane Archer"}, "TGTT");
			expect(pool.kind).toBe("restricted");
			expect(pool.pickCount).toBe(2);
			expect([...pool.codes].sort()).toEqual(["BZ", "RE", "UH", "UW"]);
		});

		test("Champion → restricted, 2 from [AM, GH, TI]", () => {
			const pool = ClassUtils.getSubclassTraditionChoicePool({name: "Champion"}, "TGTT");
			expect(pool.kind).toBe("restricted");
			expect(pool.pickCount).toBe(2);
			expect([...pool.codes].sort()).toEqual(["AM", "GH", "TI"]);
		});

		test("Battle Master → unrestricted, 2 of any tradition", () => {
			const pool = ClassUtils.getSubclassTraditionChoicePool({name: "Battle Master"}, "TGTT");
			expect(pool.kind).toBe("unrestricted");
			expect(pool.pickCount).toBe(2);
			expect(pool.codes).toBeNull();
		});

		test("Kensei → unrestricted (Monk subclass)", () => {
			const pool = ClassUtils.getSubclassTraditionChoicePool({name: "Kensei"}, "TGTT");
			expect(pool.kind).toBe("unrestricted");
			expect(pool.pickCount).toBe(1);
		});

		test("Eldritch Knight → none (pre-seeds fixed AK + EB only)", () => {
			// Eldritch Knight has fixed grants, not a choice. Pool helper must
			// return {kind: "none"} so the picker does not render.
			const pool = ClassUtils.getSubclassTraditionChoicePool({name: "Eldritch Knight"}, "TGTT");
			expect(pool.kind).toBe("none");
		});

		test("missing subclass → none", () => {
			const pool = ClassUtils.getSubclassTraditionChoicePool(null, "TGTT");
			expect(pool.kind).toBe("none");
		});

		test("non-TGTT source → none (only TGTT subclasses participate)", () => {
			const pool = ClassUtils.getSubclassTraditionChoicePool({name: "Arcane Archer"}, "XGE");
			expect(pool.kind).toBe("none");
		});
	});

	// Bug 1B: subclass-granted (fixed) tradition map must be complete. Arcane
	// Archer's GRANTS list previously missed Unerring Hawk (UH).
	describe("Bug 1B — getSubclassGrantedTraditions completeness", () => {
		test("Arcane Archer choice entries include UH (Unerring Hawk)", () => {
			const granted = ClassUtils.getSubclassGrantedTraditions({name: "Arcane Archer"}, "TGTT");
			const codes = granted.map(t => t.code).filter(Boolean);
			expect(codes).toContain("UH");
		});

		test("Cavalier grants GH + SS as fixed traditions", () => {
			const granted = ClassUtils.getSubclassGrantedTraditions({name: "Cavalier"}, "TGTT");
			const fixedCodes = granted.filter(t => !t.choice).map(t => t.code);
			expect(fixedCodes).toEqual(expect.arrayContaining(["GH", "SS"]));
		});

		test("Echo Knight grants MG + MS as fixed traditions", () => {
			const granted = ClassUtils.getSubclassGrantedTraditions({name: "Echo Knight"}, "TGTT");
			const fixedCodes = granted.filter(t => !t.choice).map(t => t.code);
			expect(fixedCodes).toEqual(expect.arrayContaining(["MG", "MS"]));
		});

		test("Rune Knight grants AM + TI as fixed traditions", () => {
			const granted = ClassUtils.getSubclassGrantedTraditions({name: "Rune Knight"}, "TGTT");
			const fixedCodes = granted.filter(t => !t.choice).map(t => t.code);
			expect(fixedCodes).toEqual(expect.arrayContaining(["AM", "TI"]));
		});
	});
});
