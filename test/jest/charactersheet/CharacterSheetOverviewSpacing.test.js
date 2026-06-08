/**
 * Overview / Combat stat-row spacing regression tests.
 *
 * Bug #10d: several Overview/Combat panels rendered adjacent values flush with
 * no separator — "10/5ft.LONG", "400lb.PUSH/DRAG/LIFT",
 * "Method DC: 15Stamina Pool: 8", "Save DC: 15Attack: +7Ability: Wisdom".
 *
 * Root cause was NOT JS string concatenation: every producer emits separate,
 * well-formed spans (the jump/carry numbers are written as `textContent` of
 * number-only spans; the unit/label are static markup). The run-together came
 * from the markup relying on Bootstrap-style spacing utility classes
 * (`mr-3`, `ml-1`, …) that this fork's loaded stylesheets do not define, so
 * they are no-ops. The fix restores the intended inter-element spacing at the
 * component level in css/charactersheet.css.
 *
 * Because the breakage lived purely in computed CSS (the DOM/markup was always
 * correct), a jsdom assertion on the rendered spans would be false-green — it
 * passes whether or not the gap exists. The meaningful, runnable regression
 * guard here is therefore to assert the stylesheet actually declares the
 * spacing. These assertions FAIL on the pre-fix stylesheet (the rules did not
 * exist) and FAIL again if the rules are later removed or zeroed.
 */

import fs from "fs";
import path from "path";
import {fileURLToPath} from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CSS_PATH = path.resolve(__dirname, "../../../css/charactersheet.css");
const css = fs.readFileSync(CSS_PATH, "utf8");

// These target rules contain no nested braces, so a flat split is sufficient.
const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(m => ({sel: m[1].trim(), body: m[2]}));

function rulesMatching (selectorSubstring) {
	return rules.filter(r => r.sel.includes(selectorSubstring));
}

function declaredValue (body, prop) {
	const m = body.match(new RegExp(`(?:^|;|\\n)\\s*${prop}\\s*:\\s*([^;]+)`, "i"));
	return m ? m[1].trim() : null;
}

function isPositiveLength (value) {
	if (!value) return false;
	const m = value.match(/^([\d.]+)\s*(em|rem|px|%)$/);
	return !!m && parseFloat(m[1]) > 0;
}

// A rule among `selectorSubstring` matches declares `prop` as a positive length.
function hasPositiveSpacing (selectorSubstring, prop) {
	return rulesMatching(selectorSubstring)
		.some(r => isPositiveLength(declaredValue(r.body, prop)));
}

describe("Overview/Combat stat-row spacing (bug #10d regression)", () => {
	it("separates the jump/carry value-unit from its trailing label", () => {
		// "10/5 ft. LONG" / "400 lb. PUSH/DRAG/LIFT" — spacing on the unit/label
		// only (not the whole flex row) so the "10/5" ratio stays tight.
		expect(
			hasPositiveSpacing(".charsheet__physical-stat-item > .charsheet__physical-stat-unit", "margin-left"),
		).toBe(true);
		expect(
			hasPositiveSpacing(".charsheet__physical-stat-item > .charsheet__physical-stat-label", "margin-left"),
		).toBe(true);
	});

	it("separates adjacent Combat Methods mini-stats", () => {
		// "Method DC: 15  Stamina Pool: 8"
		expect(hasPositiveSpacing("charsheet-combat-methods-stats", "margin-right")).toBe(true);
	});

	it("separates the spellcasting Save DC / Attack / Ability stats", () => {
		// "Save DC: 15  Attack: +7  Ability: Wisdom"
		expect(hasPositiveSpacing(".charsheet__spell-stats", "column-gap")).toBe(true);
	});

	it("uses font-relative (em) gaps so spacing scales with the text size", () => {
		// The whole bug class was fixed-size spacing not tracking [data-textsize];
		// the restored gaps are em-based so they grow with the chosen text size.
		const unitRule = rulesMatching(".charsheet__physical-stat-item > .charsheet__physical-stat-unit")[0];
		expect(unitRule).toBeTruthy();
		expect(declaredValue(unitRule.body, "margin-left")).toMatch(/em$/);
	});
});
