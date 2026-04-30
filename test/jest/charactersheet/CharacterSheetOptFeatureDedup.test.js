import "./setup.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";

const CharacterSheetClassUtils = globalThis.CharacterSheetClassUtils;

describe("deduplicateOptFeaturesByEdition", () => {
	const mockFeatures = [
		{name: "Agonizing Blast", source: "PHB", featureType: ["EI"]},
		{name: "Agonizing Blast", source: "XPHB", featureType: ["EI"]},
		{name: "Agonizing Blast", source: "TGTT", featureType: ["EI"]},
		{name: "Eldritch Spear", source: "PHB", featureType: ["EI"]},
		{name: "Eldritch Spear", source: "XPHB", featureType: ["EI"]},
		{name: "Thirsting Blade", source: "PHB", featureType: ["EI"]},
		{name: "Custom Invocation", source: "MyHomebrew", featureType: ["EI"]},
		{name: "Another Custom", source: "OtherBrew", featureType: ["EI"]},
	];

	describe("with showAll = false (default, deduplicated)", () => {
		it("should prefer TGTT over XPHB over PHB for same-named features", () => {
			const result = CharacterSheetClassUtils.deduplicateOptFeaturesByEdition(mockFeatures);
			const agonizing = result.filter(f => f.name === "Agonizing Blast");
			expect(agonizing.length).toBe(1);
			expect(agonizing[0].source).toBe("TGTT");
		});

		it("should prefer XPHB over PHB when no TGTT version exists", () => {
			const result = CharacterSheetClassUtils.deduplicateOptFeaturesByEdition(mockFeatures);
			const spear = result.filter(f => f.name === "Eldritch Spear");
			expect(spear.length).toBe(1);
			expect(spear[0].source).toBe("XPHB");
		});

		it("should keep PHB version when no higher-priority version exists", () => {
			const result = CharacterSheetClassUtils.deduplicateOptFeaturesByEdition(mockFeatures);
			const thirsting = result.filter(f => f.name === "Thirsting Blade");
			expect(thirsting.length).toBe(1);
			expect(thirsting[0].source).toBe("PHB");
		});

		it("should keep homebrew features from unknown sources", () => {
			const result = CharacterSheetClassUtils.deduplicateOptFeaturesByEdition(mockFeatures);
			expect(result.some(f => f.name === "Custom Invocation")).toBe(true);
			expect(result.some(f => f.name === "Another Custom")).toBe(true);
		});

		it("should return correct total count (5 unique names)", () => {
			const result = CharacterSheetClassUtils.deduplicateOptFeaturesByEdition(mockFeatures);
			expect(result.length).toBe(5);
		});
	});

	describe("with showAll = true (no deduplication)", () => {
		it("should return all features without deduplication", () => {
			const result = CharacterSheetClassUtils.deduplicateOptFeaturesByEdition(mockFeatures, {showAll: true});
			expect(result.length).toBe(8);
		});

		it("should include all source versions of the same feature", () => {
			const result = CharacterSheetClassUtils.deduplicateOptFeaturesByEdition(mockFeatures, {showAll: true});
			const agonizing = result.filter(f => f.name === "Agonizing Blast");
			expect(agonizing.length).toBe(3);
		});
	});

	describe("edge cases", () => {
		it("should handle empty array", () => {
			const result = CharacterSheetClassUtils.deduplicateOptFeaturesByEdition([]);
			expect(result).toEqual([]);
		});

		it("should handle null/undefined input", () => {
			expect(CharacterSheetClassUtils.deduplicateOptFeaturesByEdition(null)).toBeNull();
			expect(CharacterSheetClassUtils.deduplicateOptFeaturesByEdition(undefined)).toBeUndefined();
		});

		it("should handle features without source field", () => {
			const features = [
				{name: "Test Feature", featureType: ["EI"]},
				{name: "Test Feature", source: "PHB", featureType: ["EI"]},
			];
			const result = CharacterSheetClassUtils.deduplicateOptFeaturesByEdition(features);
			// PHB has priority 2, no-source gets priority 100, so PHB wins
			expect(result.length).toBe(1);
			expect(result[0].source).toBe("PHB");
		});

		it("should be case-insensitive for name matching", () => {
			const features = [
				{name: "Agonizing Blast", source: "PHB", featureType: ["EI"]},
				{name: "agonizing blast", source: "XPHB", featureType: ["EI"]},
			];
			const result = CharacterSheetClassUtils.deduplicateOptFeaturesByEdition(features);
			expect(result.length).toBe(1);
			expect(result[0].source).toBe("XPHB");
		});

		it("should keep features from new official sources that have no duplicates", () => {
			const features = [
				{name: "New Book Feature", source: "FTD", featureType: ["EI"]},
				{name: "Another New One", source: "SCC", featureType: ["MV:B"]},
			];
			const result = CharacterSheetClassUtils.deduplicateOptFeaturesByEdition(features);
			expect(result.length).toBe(2);
		});
	});

	describe("backward compatibility", () => {
		it("filterOptFeaturesByEdition should still work (deprecated wrapper)", () => {
			const result = CharacterSheetClassUtils.filterOptFeaturesByEdition(mockFeatures, "TGTT");
			// Should now deduplicate instead of filtering by source
			expect(result.length).toBe(5);
			expect(result.some(f => f.name === "Custom Invocation")).toBe(true);
		});
	});
});
