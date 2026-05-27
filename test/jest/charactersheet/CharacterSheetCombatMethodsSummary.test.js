/**
 * Class-aware Combat Methods summary blurb.
 *
 * Regression coverage for the Monk-specific text bug: QuickBuild/LevelUp/Builder
 * showed the generic "8 + PB + STR/DEX" Method DC formula for every class, but
 * the runtime DC calc in `charactersheet-state.js` uses 9 + PB + STR/DEX/WIS for
 * TGTT Monks and supports Focus-for-Stamina substitution; TGTT Paladins can
 * convert spell slots to stamina; Hexblade/Bladesinger may substitute spell DC.
 *
 * Fix: `getCombatMethodsSystemSummary({className, classSource, subclassName})`
 * tailors the DC and resource bullets to the supplied class. No-arg call keeps
 * the original generic blurb (backward compatible).
 */

import "./setup.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import fs from "fs";
import path from "path";
import {fileURLToPath} from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CharacterSheetClassUtils = globalThis.CharacterSheetClassUtils;

describe("getCombatMethodsSystemSummary — backward-compatible default", () => {
	test("no-arg call returns the generic blurb", () => {
		const html = CharacterSheetClassUtils.getCombatMethodsSystemSummary();
		expect(html).toContain("8 + proficiency bonus + STR or DEX modifier");
		expect(html).toContain("pool = 2× your proficiency bonus");
		// No class-specific notes leak in
		expect(html).not.toMatch(/Wisdom|WIS modifier/);
		expect(html).not.toContain("Focus Points");
		expect(html).not.toContain("spell save DC");
		expect(html).not.toContain("sacrifice a spell slot");
	});

	test("empty object behaves the same as no-arg", () => {
		const a = CharacterSheetClassUtils.getCombatMethodsSystemSummary();
		const b = CharacterSheetClassUtils.getCombatMethodsSystemSummary({});
		expect(b).toBe(a);
	});

	test("unknown class returns the generic blurb", () => {
		const html = CharacterSheetClassUtils.getCombatMethodsSystemSummary({className: "Wizard", classSource: "PHB"});
		expect(html).toContain("8 + proficiency bonus + STR or DEX modifier");
		expect(html).not.toContain("Focus Points");
		expect(html).not.toContain("spell save DC");
	});
});

describe("getCombatMethodsSystemSummary — Monk", () => {
	test("TGTT Monk uses 9 + PB + STR/DEX/WIS and mentions Focus", () => {
		const html = CharacterSheetClassUtils.getCombatMethodsSystemSummary({className: "Monk", classSource: "TGTT"});
		expect(html).toContain("9 + proficiency bonus");
		expect(html).toContain("WIS modifier");
		expect(html).toContain("Focus Points");
		// Generic Monk formula must NOT appear
		expect(html).not.toContain("8 + proficiency bonus");
	});

	test("non-TGTT Monk keeps the standard DC but still surfaces Focus", () => {
		// The runtime DC bonus is TGTT-only, but `canUseFocusForStamina` is
		// source-agnostic — so the Focus note still applies.
		const html = CharacterSheetClassUtils.getCombatMethodsSystemSummary({className: "Monk", classSource: "PHB"});
		expect(html).toContain("8 + proficiency bonus + STR or DEX");
		expect(html).toContain("Focus Points");
		expect(html).not.toContain("9 + proficiency bonus");
		expect(html).not.toContain("WIS modifier");
	});

	test("case-insensitive class name", () => {
		const html = CharacterSheetClassUtils.getCombatMethodsSystemSummary({className: "monk", classSource: "TGTT"});
		expect(html).toContain("9 + proficiency bonus");
		expect(html).toContain("Focus Points");
	});
});

describe("getCombatMethodsSystemSummary — Paladin", () => {
	test("TGTT Paladin mentions spell save DC and spell-slot conversion", () => {
		const html = CharacterSheetClassUtils.getCombatMethodsSystemSummary({className: "Paladin", classSource: "TGTT"});
		expect(html).toContain("spell save DC");
		expect(html).toContain("sacrifice a spell slot");
		expect(html).toContain("8 + proficiency bonus + STR or DEX");
	});

	test("non-TGTT Paladin falls back to generic blurb", () => {
		const html = CharacterSheetClassUtils.getCombatMethodsSystemSummary({className: "Paladin", classSource: "XPHB"});
		expect(html).toContain("8 + proficiency bonus + STR or DEX");
		expect(html).not.toContain("spell save DC");
		expect(html).not.toContain("sacrifice a spell slot");
	});
});

describe("getCombatMethodsSystemSummary — Hexblade Warlock / Bladesinging Wizard", () => {
	test("Warlock + Hexblade subclass mentions spell save DC", () => {
		const html = CharacterSheetClassUtils.getCombatMethodsSystemSummary({className: "Warlock", classSource: "PHB", subclassName: "Hexblade"});
		expect(html).toContain("spell save DC");
		expect(html).toContain("8 + proficiency bonus + STR or DEX");
		// Paladin-specific spell-slot conversion must NOT leak in
		expect(html).not.toContain("sacrifice a spell slot");
	});

	test("Warlock + 'The Hexblade' (alt naming) also matches", () => {
		const html = CharacterSheetClassUtils.getCombatMethodsSystemSummary({className: "Warlock", classSource: "PHB", subclassName: "The Hexblade"});
		expect(html).toContain("spell save DC");
	});

	test("Wizard + Bladesinging subclass mentions spell save DC", () => {
		const html = CharacterSheetClassUtils.getCombatMethodsSystemSummary({className: "Wizard", classSource: "PHB", subclassName: "Bladesinging"});
		expect(html).toContain("spell save DC");
		expect(html).not.toContain("sacrifice a spell slot");
	});

	test("Wizard + 'Bladesinger' (alt naming) also matches", () => {
		const html = CharacterSheetClassUtils.getCombatMethodsSystemSummary({className: "Wizard", classSource: "PHB", subclassName: "Bladesinger"});
		expect(html).toContain("spell save DC");
	});

	test("Warlock without Hexblade does NOT get the spell-DC note", () => {
		const html = CharacterSheetClassUtils.getCombatMethodsSystemSummary({className: "Warlock", classSource: "PHB", subclassName: "Fiend"});
		expect(html).toContain("8 + proficiency bonus + STR or DEX");
		expect(html).not.toContain("spell save DC");
	});

	test("Wizard without Bladesinging does NOT get the spell-DC note", () => {
		const html = CharacterSheetClassUtils.getCombatMethodsSystemSummary({className: "Wizard", classSource: "PHB", subclassName: "Evocation"});
		expect(html).toContain("8 + proficiency bonus + STR or DEX");
		expect(html).not.toContain("spell save DC");
	});

	test("Warlock with no subclass yet (QuickBuild before subclass step) — no spell-DC note", () => {
		const html = CharacterSheetClassUtils.getCombatMethodsSystemSummary({className: "Warlock", classSource: "PHB"});
		expect(html).toContain("8 + proficiency bonus + STR or DEX");
		expect(html).not.toContain("spell save DC");
	});
});

describe("getCombatMethodsSystemSummary — shared bullets are preserved", () => {
	test("every variant still mentions Traditions and Degrees", () => {
		const variants = [
			CharacterSheetClassUtils.getCombatMethodsSystemSummary(),
			CharacterSheetClassUtils.getCombatMethodsSystemSummary({className: "Monk", classSource: "TGTT"}),
			CharacterSheetClassUtils.getCombatMethodsSystemSummary({className: "Paladin", classSource: "TGTT"}),
			CharacterSheetClassUtils.getCombatMethodsSystemSummary({className: "Warlock", classSource: "PHB", subclassName: "Hexblade"}),
		];
		variants.forEach(html => {
			expect(html).toContain("Traditions");
			expect(html).toContain("degrees");
		});
	});
});

describe("Source-level guards: call sites pass class context", () => {
	const readSrc = (rel) => fs.readFileSync(path.resolve(__dirname, "../../../", rel), "utf8");

	test("QuickBuild _renderCombatMethodsOptFeature passes className/classSource/subclassName", () => {
		const src = readSrc("js/charactersheet/charactersheet-quickbuild.js");
		expect(src).toMatch(/getCombatMethodsSystemSummary\(\{[^}]*className:\s*gain\.className[^}]*classSource:\s*gain\.classSource[^}]*subclassName:\s*subclass\?\.name[^}]*\}\)/);
		// Must NOT regress to the no-arg call
		expect(src).not.toMatch(/getCombatMethodsSystemSummary\(\)/);
	});

	test("LevelUp Combat Methods gain block passes className/classSource/subclassName", () => {
		const src = readSrc("js/charactersheet/charactersheet-levelup.js");
		expect(src).toMatch(/getCombatMethodsSystemSummary\(\{[^}]*className:\s*classData\?\.name[^}]*classSource:\s*classData\?\.source[^}]*subclassName:\s*classData\?\.subclass\?\.name[^}]*\}\)/);
		expect(src).not.toMatch(/getCombatMethodsSystemSummary\(\)/);
	});

	test("Builder _renderCombatMethodsSelection passes className/classSource/subclassName", () => {
		const src = readSrc("js/charactersheet/charactersheet-builder.js");
		expect(src).toMatch(/getCombatMethodsSystemSummary\(\{[^}]*className:\s*cls\?\.name[^}]*classSource:\s*cls\?\.source[^}]*subclassName:\s*this\._selectedSubclass\?\.name[^}]*\}\)/);
		expect(src).not.toMatch(/getCombatMethodsSystemSummary\(\)/);
	});
});
