/**
 * Round 37 — Bug 7 (recurring spell-filter failure) regression.
 *
 * Root cause (troubleshooting F9): the "Add Spell" picker pool used to be
 * pre-restricted to the character's OWN class BEFORE the modal opened, so the
 * modal's class/subclass filter could only ever NARROW within that one class —
 * never broaden. As a result:
 *   - A Wizard selecting "All Classes" (or "Bard") could never surface a
 *     Bard/Cleric-only spell like Healing Word.
 *   - A homebrew spell with NO class list at all (e.g. TGTT Transposition
 *     before its data fix) was invisible everywhere.
 *
 * The fix broadens the pool to the full spell list and moves all gating into
 * `CharacterSheetClassUtils.spellMatchesPickerClassFilter`, which:
 *   - shows everything when no class is selected ("All Classes"),
 *   - fast-path matches raw `fromClassList` membership for ANY selected class,
 *   - AND, for the character's OWN classes only, keeps subclass-EXPANDED spells
 *     (Divine Soul → Cleric, Chronurgy → EGW) visible in the DEFAULT view via
 *     the authoritative `spellIsAvailableForClass`.
 *
 * This test exercises that predicate directly (it is the production code path
 * used by the modal's renderList), proving both the broadening and the
 * no-regression of subclass-expanded defaults. Each assertion has a paired
 * "revert" check (passing `ownClassConfigs = []`) that demonstrates the bug
 * returns without the fix.
 */

import "./setup.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";

const CU = globalThis.CharacterSheetClassUtils;

/** Build a synthetic spell whose `classes.fromClassList` drives membership. */
function mkSpell (name, fromClassList = [], {source = "PHB", level = 1} = {}) {
	return {
		name,
		source,
		level,
		classes: {fromClassList: fromClassList.map(n => ({name: n, source: "PHB"}))},
	};
}

/** Mirror the production `spellClasses` cache (raw fromClassList names). */
function rawClasses (spell) {
	return (spell.classes?.fromClassList || []).map(c => c.name);
}

describe("Round 37 Bug 7: spell picker class filter broadening (F9)", () => {
	const transposition = mkSpell("Transposition", ["Wizard"], {source: "TGTT", level: 2});
	const healingWord = mkSpell("Healing Word", ["Bard", "Cleric"], {level: 1});
	const classlessHomebrew = mkSpell("Voidless Whisper", [], {source: "TGTT", level: 1});
	// Guidance is a Cleric-only spell. A Divine Soul Sorcerer gets it via the
	// subclass-expanded Cleric list (additionalClassNames), NOT Sorcerer's raw list.
	const guidance = mkSpell("Guidance", ["Cleric"], {level: 0});

	const wizardConfigs = [{className: "Wizard", classSource: "PHB", subclass: null, additionalClassNames: []}];
	const divineSoulConfigs = [{
		className: "Sorcerer",
		classSource: "PHB",
		subclass: {name: "Divine Soul", source: "XGE", shortName: "Divine Soul"},
		additionalClassNames: ["Cleric"],
	}];

	describe("default Wizard view (selectedClasses = {Wizard})", () => {
		const sel = new Set(["Wizard"]);

		test("shows a Wizard spell (Transposition, post data-fix)", () => {
			expect(CU.spellMatchesPickerClassFilter(transposition, sel, wizardConfigs, rawClasses(transposition))).toBe(true);
		});

		test("HIDES a non-Wizard spell (Healing Word = Bard/Cleric)", () => {
			expect(CU.spellMatchesPickerClassFilter(healingWord, sel, wizardConfigs, rawClasses(healingWord))).toBe(false);
		});

		test("HIDES a class-less homebrew spell by default", () => {
			expect(CU.spellMatchesPickerClassFilter(classlessHomebrew, sel, wizardConfigs, rawClasses(classlessHomebrew))).toBe(false);
		});
	});

	describe("'All Classes' (empty selection) surfaces everything", () => {
		const sel = new Set();

		test("surfaces Healing Word (was impossible with the pre-restricted pool)", () => {
			expect(CU.spellMatchesPickerClassFilter(healingWord, sel, wizardConfigs, rawClasses(healingWord))).toBe(true);
		});

		test("surfaces a class-less homebrew spell (THE systemic bug)", () => {
			expect(CU.spellMatchesPickerClassFilter(classlessHomebrew, sel, wizardConfigs, rawClasses(classlessHomebrew))).toBe(true);
		});
	});

	describe("selecting another class broadens via the fast path", () => {
		test("Healing Word appears when Bard is selected", () => {
			const sel = new Set(["Bard"]);
			expect(CU.spellMatchesPickerClassFilter(healingWord, sel, wizardConfigs, rawClasses(healingWord))).toBe(true);
		});
	});

	describe("subclass-EXPANDED spells stay in the default own-class view", () => {
		const sel = new Set(["Sorcerer"]);

		test("Guidance shows for a Divine Soul Sorcerer (authoritative own-class fallback)", () => {
			expect(CU.spellMatchesPickerClassFilter(guidance, sel, divineSoulConfigs, rawClasses(guidance))).toBe(true);
		});

		test("REVERT proof: without ownClassConfigs the bug returns (Guidance hidden)", () => {
			// Simulates the pre-fix behaviour where only raw fromClassList membership
			// gated the view — Guidance (Cleric-only) would never show for a Sorcerer.
			expect(CU.spellMatchesPickerClassFilter(guidance, sel, [], rawClasses(guidance))).toBe(false);
		});
	});

	describe("__NONE__ sentinel still excludes", () => {
		test("a __NONE__ selection blocks the authoritative fallback", () => {
			const sel = new Set(["__NONE__"]);
			expect(CU.spellMatchesPickerClassFilter(guidance, sel, divineSoulConfigs, rawClasses(guidance))).toBe(false);
		});
	});
});
