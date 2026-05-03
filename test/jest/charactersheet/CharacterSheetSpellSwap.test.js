import "./setup.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";

const CharacterSheetClassUtils = globalThis.CharacterSheetClassUtils;

// ==========================================================================
// getSpellSwapCount — known-caster spell swap eligibility
// ==========================================================================
describe("getSpellSwapCount", () => {
	describe("known-casters get 1 swap at level 2+", () => {
		const knownCasters = ["Sorcerer", "Bard", "Ranger", "Warlock"];

		knownCasters.forEach(className => {
			it(`${className} at level 2 should return 1`, () => {
				expect(CharacterSheetClassUtils.getSpellSwapCount(className, "PHB", 2)).toBe(1);
			});

			it(`${className} at level 10 should return 1`, () => {
				expect(CharacterSheetClassUtils.getSpellSwapCount(className, "PHB", 10)).toBe(1);
			});

			it(`${className} at level 20 should return 1`, () => {
				expect(CharacterSheetClassUtils.getSpellSwapCount(className, "PHB", 20)).toBe(1);
			});
		});
	});

	describe("known-casters at level 1 get 0 swaps", () => {
		it("Sorcerer at level 1 should return 0", () => {
			expect(CharacterSheetClassUtils.getSpellSwapCount("Sorcerer", "PHB", 1)).toBe(0);
		});

		it("Bard at level 1 should return 0", () => {
			expect(CharacterSheetClassUtils.getSpellSwapCount("Bard", "PHB", 1)).toBe(0);
		});
	});

	describe("prepared casters get 0 swaps (they swap freely on Spells tab)", () => {
		const preparedCasters = ["Wizard", "Cleric", "Druid", "Paladin", "Artificer"];

		preparedCasters.forEach(className => {
			it(`${className} at level 5 should return 0`, () => {
				expect(CharacterSheetClassUtils.getSpellSwapCount(className, "PHB", 5)).toBe(0);
			});
		});
	});

	describe("2024 sources work the same", () => {
		it("Sorcerer XPHB at level 3 should return 1", () => {
			expect(CharacterSheetClassUtils.getSpellSwapCount("Sorcerer", "XPHB", 3)).toBe(1);
		});

		it("Bard TGTT at level 4 should return 1", () => {
			expect(CharacterSheetClassUtils.getSpellSwapCount("Bard", "TGTT", 4)).toBe(1);
		});
	});

	describe("non-caster classes get 0 swaps", () => {
		it("Fighter at level 5 should return 0", () => {
			expect(CharacterSheetClassUtils.getSpellSwapCount("Fighter", "PHB", 5)).toBe(0);
		});

		it("Barbarian at level 10 should return 0", () => {
			expect(CharacterSheetClassUtils.getSpellSwapCount("Barbarian", "PHB", 10)).toBe(0);
		});
	});
});
