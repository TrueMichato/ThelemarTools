import "../../js/tgtt-filter.js";

describe("TgttFilterModalUI", () => {
	it("only recognizes dedicated spell search modal titles for TGTT filter injection", () => {
		expect(TgttFilterModalUI.isSpellFilterModalTitle("Filter/Search for Spells")).toBe(true);
		expect(TgttFilterModalUI.isSpellFilterModalTitle("Filter/Search for Spell")).toBe(true);
		expect(TgttFilterModalUI.isSpellFilterModalTitle("Attribute Fireball")).toBe(false);
		expect(TgttFilterModalUI.isSpellFilterModalTitle("Add Fireball?")).toBe(false);
	});
});
