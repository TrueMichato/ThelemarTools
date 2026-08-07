/**
 * Regression tests for the auto-fill button-grid label classifier.
 *
 * `_fillButtonGrids` handles the feat sub-choice grids the wizard renders with no
 * `Selected: n/max` counter to key off — the label alone supplies the count. Two
 * label shapes matter and they are deliberately handled by *separate* regexes:
 *
 *   • Counted picks ("Choose 2 skills:") — `_RE_CHOOSE` reads the digit.
 *   • A 2024 origin/half-feat's mandatory +1 ("Choose ability to increase by 1:")
 *     carries no leading digit, so it is matched by `_RE_CHOOSE_ABILITY` and
 *     treated as a single pick.
 *
 * The tempting "just match any 'Choose …' label" broadening was tried and
 * reverted twice: it swallows the skill / tool / language sub-choices, which have
 * their own dedicated picker buckets, and autofills their overrides out from under
 * them. These tests lock in that the ability regex fires only for ability labels
 * and never for skill/tool/language ones, so a future edit can't silently
 * re-broaden it.
 */

import "../../../js/charactersheet/charactersheet-spawn-autofill.js";

const CharacterSheetSpawnAutoFill = globalThis.CharacterSheetSpawnAutoFill;

/** Mirror of `_fillButtonGrids`'s wantCount decision for a given label. */
const wantCountFor = (labelTxt) => {
	const m = CharacterSheetSpawnAutoFill._RE_CHOOSE.exec(labelTxt);
	return m
		? Number(m[1])
		: (CharacterSheetSpawnAutoFill._RE_CHOOSE_ABILITY.test(labelTxt) ? 1 : null);
};

describe("CharacterSheetSpawnAutoFill button-grid label classifier", () => {
	describe("counted labels read their digit", () => {
		it.each([
			["Choose 2 skills:", 2],
			["Choose 1 tool:", 1],
			["Choose 3 languages:", 3],
		])("%s → %i", (label, count) => {
			expect(wantCountFor(label)).toBe(count);
		});
	});

	describe("a feat's mandatory ability bump is a single pick even with no digit", () => {
		it.each([
			"Choose ability to increase by 1:",
			"Choose an ability to increase:",
			"Choose a ability score to increase by 1", // half-feat phrasing, sloppy article
			"Choose abilities to increase",
		])("%s → 1", (label) => {
			expect(wantCountFor(label)).toBe(1);
		});
	});

	describe("skill / tool / language sub-choices are NOT intercepted", () => {
		// These have dedicated picker buckets; matching them here would autofill
		// their overrides away. They must fall through (null) so the routed
		// featureChoice handlers own them.
		it.each([
			"Choose a skill:",
			"Choose an additional skill",
			"Choose a tool proficiency:",
			"Choose a language:",
			"Choose an instrument",
		])("%s → null", (label) => {
			expect(wantCountFor(label)).toBeNull();
		});
	});

	it("the counted regex does not swallow the digitless ability label", () => {
		// `_RE_CHOOSE` demands `choose <digits>`; the ability label has none, so it
		// must miss and defer to `_RE_CHOOSE_ABILITY`. If it ever matched, the "by 1"
		// suffix would be misread.
		expect(CharacterSheetSpawnAutoFill._RE_CHOOSE.exec("Choose ability to increase by 1:")).toBeNull();
	});
});
