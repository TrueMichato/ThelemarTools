/**
 * Round 15 — 🎲 dice-customization surface polish.
 *
 * Four fixes, all on the single dice header dropdown:
 *   R15-1 the `position: fixed` dropdown clipped at the viewport bottom and
 *         stayed at a stale screen coordinate on scroll → bound by CSS
 *         `max-height`/`overflow-y` and a clamp/flip `positionDropdown()` that
 *         re-tracks the button on scroll/resize.
 *   R15-2 the Special-Effects swatches were split across 3 ragged flex rows →
 *         merged into ONE `flex-wrap` container.
 *   R15-3 a new "Thelemar Dice" theme (+ 4 cohesive companions) registered in
 *         the 3D `THEMES` AND the 2D `_showLegacyDice` `themeColors`.
 *   R15-4 (a) presets prepend (covered in CharacterSheetDicePresets.test.js),
 *         (b) clicking a theme/special-effect swatch must clear the custom-colour
 *             override so the picked theme actually renders.
 *
 * jsdom can't measure real pixels, so the CSS/markup fixes are source-pinned
 * (like CharacterSheetResourceSpeedOverflowCss); the swatch-clears-custom
 * behaviour is exercised against a REAL CharacterSheetState via a byte-faithful
 * replica of the production click handler, plus a source-pin.
 */

import "./setup.js";
import "../../../js/charactersheet/charactersheet-state.js";
import {readFileSync} from "fs";
import {resolve, dirname} from "path";
import {fileURLToPath} from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "../../..");

const CharacterSheetState = globalThis.CharacterSheetState;

const JS_SRC = readFileSync(resolve(REPO_ROOT, "js/charactersheet/charactersheet.js"), "utf8");
const HTML_SRC = readFileSync(resolve(REPO_ROOT, "charactersheet.html"), "utf8");
const CSS_SRC = readFileSync(resolve(REPO_ROOT, "css/charactersheet.css"), "utf8");

/** Inner body of the FIRST CSS rule whose selector exactly matches `selector`. */
function ruleBody (selector) {
	const re = new RegExp(`(^|[\\n}])\\s*${selector.replace(/[.*+?^${}()|[\]\\#-]/g, "\\$&")}\\s*\\{`, "m");
	const m = re.exec(CSS_SRC);
	if (!m) return null;
	const open = CSS_SRC.indexOf("{", m.index);
	const close = CSS_SRC.indexOf("}", open);
	return CSS_SRC.slice(open + 1, close);
}

describe("R15-1 — dropdown is viewport-bounded (CSS)", () => {
	test(".charsheet__dice-dropdown caps height to the viewport and scrolls overflow", () => {
		const body = ruleBody(".charsheet__dice-dropdown");
		expect(body).toBeTruthy();
		expect(body).toMatch(/max-height:\s*calc\(100vh\s*-\s*24px\)/);
		expect(body).toMatch(/overflow-y:\s*auto/);
	});

	test("positionDropdown clamps/flips and re-tracks the button on scroll/resize", () => {
		// Flip-above branch when there's no room below.
		expect(JS_SRC).toContain("const aboveTop = btnRect.top - height - margin;");
		// Scroll listener uses capture so nested scrollers also reposition.
		expect(JS_SRC).toContain(`window.addEventListener("scroll", repositionWhileOpen, true)`);
		expect(JS_SRC).toContain(`window.addEventListener("resize", repositionWhileOpen)`);
		// And both are torn down again (no leak when the dropdown closes).
		expect(JS_SRC).toContain(`window.removeEventListener("scroll", repositionWhileOpen, true)`);
		expect(JS_SRC).toContain(`window.removeEventListener("resize", repositionWhileOpen)`);
	});
});

describe("R15-2 — Special Effects swatches share ONE container (markup)", () => {
	test("there is exactly one Special Effects label and the swatches don't split into ragged rows", () => {
		// Exactly one "Special Effects" group label.
		const labelCount = (HTML_SRC.match(/Special Effects/g) || []).length;
		expect(labelCount).toBe(1);

		// The dice-themes block must hold exactly TWO .charsheet__dice-theme-options
		// rows: the solid-colour "Theme" row + the single merged Special-Effects row.
		const themesBlock = /<div class="charsheet__dice-themes"[\s\S]*?<\/div>\s*<\/div>\s*<div class="charsheet__dice-customize"/.exec(HTML_SRC);
		expect(themesBlock).toBeTruthy();
		const rowCount = (themesBlock[0].match(/charsheet__dice-theme-options/g) || []).length;
		expect(rowCount).toBe(2);
	});

	test("every Special-Effect swatch (incl. R15 themes) is present with its data-theme", () => {
		for (const theme of ["cosmic", "inferno", "frost", "nature", "arcane", "blood", "ocean", "storm", "void", "radiant", "dragon", "astral", "tiger", "toxic", "thelemar", "bone", "obsidian", "jade", "copper"]) {
			expect(HTML_SRC).toContain(`data-theme="${theme}"`);
		}
	});

	test("each new R15 theme has a swatch CSS class", () => {
		for (const theme of ["thelemar", "bone", "obsidian", "jade", "copper"]) {
			expect(CSS_SRC).toContain(`.charsheet__dice-theme-btn--${theme}`);
		}
	});
});

describe("R15-3 — Thelemar + companions registered in the 2D legacy fallback", () => {
	test("_showLegacyDice themeColors include every new R15 theme", () => {
		// Pin within the legacy themeColors object (gradient bg strings keyed by theme).
		for (const theme of ["thelemar", "bone", "obsidian", "jade", "copper"]) {
			expect(JS_SRC).toMatch(new RegExp(`\\b${theme}:\\s*\\{bg:`));
		}
	});

	test("Thelemar's legacy fallback uses the gold number colour", () => {
		expect(JS_SRC).toMatch(/thelemar:\s*\{bg:[^}]*pip:\s*"#d9b257"/);
	});
});

/* ----- R15-4(b) theme swatch clears the custom-colour override -------------- */

// Byte-faithful replica of the production theme-swatch click handler body.
function applyThemeSwatch (state, theme) {
	state.setSetting("diceTheme", theme);
	state.setSetting("diceCustomColor", false);
}

describe("R15-4(b) — picking a theme clears the stuck custom-colour override", () => {
	test("clicking a swatch sets the theme AND turns custom colours off", () => {
		const state = new CharacterSheetState();
		// Player made a custom red die earlier.
		state.setSetting("diceCustomColor", true);
		state.setSetting("diceColor", "#ff0000");
		state.setSetting("diceTheme", "standard");

		// Now they click the green swatch.
		applyThemeSwatch(state, "green");

		const s = state.getSettings();
		expect(s.diceTheme).toBe("green");
		expect(s.diceCustomColor).toBe(false); // override cleared → theme renders
	});

	test("production handler clears diceCustomColor on swatch click", () => {
		// The theme-button click handler must call setSetting("diceCustomColor", false).
		const handler = /this\._state\.setSetting\("diceTheme", theme\);[\s\S]{0,400}?this\._state\.setSetting\("diceCustomColor", false\);/.exec(JS_SRC);
		expect(handler).toBeTruthy();
	});

	test("applying a preset still restores custom colours (preset = explicit choice)", () => {
		// Guard: _applyDicePreset must NOT have been changed to force-clear custom —
		// it restores every captured key, including diceCustomColor.
		expect(JS_SRC).toMatch(/_applyDicePreset \(name\)[\s\S]*?for \(const k of CharacterSheetPage\._DICE_PRESET_KEYS\)[\s\S]*?setSetting\(k, preset\.settings\[k\]/);
	});
});
