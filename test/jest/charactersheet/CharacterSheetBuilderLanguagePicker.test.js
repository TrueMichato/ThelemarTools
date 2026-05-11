/**
 * Regression / UX guard for the builder's race & subrace language picker.
 *
 * Bug: the race language step rendered a flat checkbox list with no search,
 * no selection summary, and weak visual affordance — making picks tedious on
 * homebrew sets that expose many languages.
 *
 * Fix: `_renderLanguageCheckboxGroup` now emits a search input, a pill-grid
 * layout, an "x/n selected — names" summary chip, and CSS-driven disabled
 * + hover + checked affordances.
 *
 * Source-level guards are sufficient here — the failure mode this test
 * defends against is "a future edit drops the search input or reverts to the
 * flat checkbox markup". Spinning the full jsdom builder UI to exercise
 * a typed query would be heavy and brittle.
 */

import {readFileSync} from "fs";
import {fileURLToPath} from "url";
import {dirname, resolve} from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..", "..");
const read = (rel) => readFileSync(resolve(REPO_ROOT, rel), "utf8");

const BUILDER_SRC = read("js/charactersheet/charactersheet-builder.js");
const CSS_SRC = read("css/charactersheet.css");

describe("Builder race/subrace language picker — search + pill grid", () => {
	describe("Shared helper emits search + summary + pill grid", () => {
		test("`_renderLanguageCheckboxGroup` renders a search input", () => {
			// Grab the helper body and check for the search input wrapper +
			// the input element itself.
			const helperMatch = BUILDER_SRC.match(
				/_renderLanguageCheckboxGroup[\s\S]*?\n\t\}\n/,
			);
			expect(helperMatch).not.toBeNull();
			const body = helperMatch[0];
			expect(body).toMatch(/charsheet__builder-lang-search\b/);
			expect(body).toMatch(/charsheet__builder-lang-search-input/);
			expect(body).toMatch(/placeholder="Search languages\.\.\."/);
		});

		test("`_renderLanguageCheckboxGroup` renders a selection summary chip", () => {
			const helperMatch = BUILDER_SRC.match(
				/_renderLanguageCheckboxGroup[\s\S]*?\n\t\}\n/,
			);
			const body = helperMatch[0];
			expect(body).toMatch(/charsheet__builder-lang-summary\b/);
			expect(body).toMatch(/lang-sel-count/);
		});

		test("`_renderLanguageCheckboxGroup` uses pill-grid layout instead of flat checkbox row", () => {
			const helperMatch = BUILDER_SRC.match(
				/_renderLanguageCheckboxGroup[\s\S]*?\n\t\}\n/,
			);
			const body = helperMatch[0];
			expect(body).toMatch(/charsheet__builder-lang-grid\b/);
			expect(body).toMatch(/charsheet__builder-lang-pill\b/);
			// The old flat-checkbox class must be gone.
			expect(body).not.toMatch(/charsheet__builder-lang-checkbox\b/);
			expect(body).not.toMatch(/charsheet__builder-lang-group-items\b/);
		});

		test("disables un-checked pills once maxCount reached", () => {
			const helperMatch = BUILDER_SRC.match(
				/_renderLanguageCheckboxGroup[\s\S]*?\n\t\}\n/,
			);
			const body = helperMatch[0];
			expect(body).toMatch(/charsheet__builder-lang-pill--disabled/);
			expect(body).toMatch(/atMax/);
		});
	});

	describe("Race + subrace renderers delegate to the shared helper", () => {
		test("`_renderRacialLanguageChoice` calls `_renderLanguageCheckboxGroup`", () => {
			// Grab the function start line + the next ~120 lines and assert the
			// delegation call appears in that window.
			const startIdx = BUILDER_SRC.indexOf("_renderRacialLanguageChoice (");
			expect(startIdx).toBeGreaterThan(-1);
			const window = BUILDER_SRC.slice(startIdx, startIdx + 6000);
			expect(window).toMatch(/this\._renderLanguageCheckboxGroup\(/);
		});

		test("`_renderSubraceLanguageChoice` calls `_renderLanguageCheckboxGroup`", () => {
			const startIdx = BUILDER_SRC.indexOf("_renderSubraceLanguageChoice (");
			expect(startIdx).toBeGreaterThan(-1);
			const window = BUILDER_SRC.slice(startIdx, startIdx + 6000);
			expect(window).toMatch(/this\._renderLanguageCheckboxGroup\(/);
		});
	});

	describe("CSS contract", () => {
		test(".charsheet__builder-lang-grid is defined", () => {
			expect(CSS_SRC).toMatch(/\.charsheet__builder-lang-grid\s*\{/);
		});

		test(".charsheet__builder-lang-pill has hover + :has(input:checked) affordances", () => {
			expect(CSS_SRC).toMatch(/\.charsheet__builder-lang-pill\s*\{/);
			expect(CSS_SRC).toMatch(/\.charsheet__builder-lang-pill:hover/);
			expect(CSS_SRC).toMatch(/\.charsheet__builder-lang-pill:has\(input:checked\)/);
		});

		test(".charsheet__builder-lang-pill--disabled and --hidden classes exist", () => {
			expect(CSS_SRC).toMatch(/\.charsheet__builder-lang-pill--disabled\s*\{/);
			expect(CSS_SRC).toMatch(/\.charsheet__builder-lang-pill--hidden\s*\{/);
		});

		test("legacy `.charsheet__builder-lang-checkbox` is gone", () => {
			expect(CSS_SRC).not.toMatch(/\.charsheet__builder-lang-checkbox\b/);
		});
	});
});
