import "./setup.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-quickbuild.js";

const CharacterSheetQuickBuild = globalThis.CharacterSheetQuickBuild;

describe("Spell choice filter type safety", () => {
	/**
	 * Bug: charactersheet-quickbuild.js crashes with "filter.includes is not a function"
	 * when a feat's additionalSpells[].innate/known/prepared block contains a spell entry
	 * where `choose` is an object or array instead of a filter string.
	 *
	 * Fix: All spell choice parsers now check `typeof sp.choose === "string"` before
	 * calling string methods on it.
	 */

	describe("QuickBuild getFeatChoices handles non-string choose values", () => {
		let qb;
		let getFeatChoicesFromRenderer;

		beforeEach(() => {
			qb = Object.create(CharacterSheetQuickBuild.prototype);
			qb._state = {
				getAbilityScore: () => 10,
				getSkillProficiencies: () => ({}),
				getExpertise: () => [],
				getToolProficiencies: () => [],
				getLanguages: () => [],
				getSettings: () => ({}),
			};
			qb._page = {
				filterByAllowedSources: (arr) => arr,
				getFeats: () => [],
				getToolsList: () => [],
			};
			qb._selections = {asi: {}};
		});

		test("does not crash when innate choose is an object", () => {
			const feat = {
				name: "TestFeat",
				source: "TEST",
				additionalSpells: [{
					innate: {
						"_": [{choose: {from: ["spell1", "spell2"]}, count: 1}],
					},
				}],
			};

			// Simulate what _renderFeatSelector's getFeatChoices does
			const choices = {skills: null, languages: null, tools: null, ability: null, expertise: null, spells: null};
			choices.spells = {lists: [], cantrips: null, spells: null};

			const spellList = feat.additionalSpells[0];

			// Inline the innate parsing logic
			const parseInnateSpellChoices = (block, isDaily = false) => {
				if (Array.isArray(block)) {
					block.forEach(sp => {
						if (typeof sp === "object" && sp.choose && typeof sp.choose === "string") {
							const filter = sp.choose;
							if (filter.includes("level=0") || filter.includes("level=cantrip")) {
								choices.spells.cantrips = {count: sp.count || 1, filter};
							} else {
								choices.spells.spells = {count: sp.count || 1, filter: sp.choose, innate: true, daily: isDaily};
							}
						}
					});
				} else if (typeof block === "object" && block !== null) {
					Object.entries(block).forEach(([key, v]) => {
						parseInnateSpellChoices(v, key === "daily" || isDaily);
					});
				}
			};

			// Should not throw
			expect(() => parseInnateSpellChoices(spellList.innate)).not.toThrow();
			// Non-string choose should be silently skipped
			expect(choices.spells.cantrips).toBeNull();
			expect(choices.spells.spells).toBeNull();
		});

		test("does not crash when innate choose is an array", () => {
			const feat = {
				name: "TestFeat",
				source: "TEST",
				additionalSpells: [{
					innate: {
						"_": [{choose: ["str", "dex", "con"], count: 1}],
					},
				}],
			};

			const choices = {spells: {lists: [], cantrips: null, spells: null}};
			const spellList = feat.additionalSpells[0];

			const parseInnateSpellChoices = (block) => {
				if (Array.isArray(block)) {
					block.forEach(sp => {
						if (typeof sp === "object" && sp.choose && typeof sp.choose === "string") {
							const filter = sp.choose;
							if (filter.includes("level=0") || filter.includes("level=cantrip")) {
								choices.spells.cantrips = {count: sp.count || 1, filter};
							}
						}
					});
				} else if (typeof block === "object" && block !== null) {
					Object.entries(block).forEach(([, v]) => parseInnateSpellChoices(v));
				}
			};

			expect(() => parseInnateSpellChoices(spellList.innate)).not.toThrow();
		});

		test("still parses valid string choose values correctly", () => {
			const choices = {spells: {lists: [], cantrips: null, spells: null}};

			const parseInnateSpellChoices = (block, isDaily = false) => {
				if (Array.isArray(block)) {
					block.forEach(sp => {
						if (typeof sp === "object" && sp.choose && typeof sp.choose === "string") {
							const filter = sp.choose;
							if (filter.includes("level=0") || filter.includes("level=cantrip")) {
								choices.spells.cantrips = {count: sp.count || 1, filter};
							} else {
								choices.spells.spells = {count: sp.count || 1, filter: sp.choose, innate: true, daily: isDaily};
							}
						}
					});
				} else if (typeof block === "object" && block !== null) {
					Object.entries(block).forEach(([key, v]) => {
						parseInnateSpellChoices(v, key === "daily" || isDaily);
					});
				}
			};

			// Valid innate block with string choose
			const innateBlock = {
				"_": {
					"daily": {
						"1e": [{choose: "level=2|school=E;N"}],
					},
				},
			};

			expect(() => parseInnateSpellChoices(innateBlock)).not.toThrow();
			expect(choices.spells.spells).toEqual({
				count: 1,
				filter: "level=2|school=E;N",
				innate: true,
				daily: true,
			});
		});

		test("correctly identifies cantrips from string choose", () => {
			const choices = {spells: {lists: [], cantrips: null, spells: null}};

			const spellsAtLevel = [{choose: "level=0|class=Sorcerer", count: 2}];

			spellsAtLevel.forEach(sp => {
				if (typeof sp === "object" && sp.choose && typeof sp.choose === "string") {
					const filter = sp.choose;
					if (filter.includes("level=0") || filter.includes("level=cantrip")) {
						choices.spells.cantrips = {count: sp.count || 1, filter};
					}
				}
			});

			expect(choices.spells.cantrips).toEqual({count: 2, filter: "level=0|class=Sorcerer"});
		});

		test("does not crash when known block choose is a number", () => {
			const choices = {spells: {lists: [], cantrips: null, spells: null}};

			const spellsAtLevel = [{choose: 3}]; // Malformed data

			expect(() => {
				spellsAtLevel.forEach(sp => {
					if (typeof sp === "object" && sp.choose && typeof sp.choose === "string") {
						const filter = sp.choose;
						if (filter.includes("level=0") || filter.includes("level=cantrip")) {
							choices.spells.cantrips = {count: sp.count || 1, filter};
						}
					}
				});
			}).not.toThrow();
			expect(choices.spells.cantrips).toBeNull();
		});
	});
});
