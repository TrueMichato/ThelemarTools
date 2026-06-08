/**
 * Druid Resources — module-load wiring regression (round-4 Bug #1).
 *
 * BLOCKER regression from a round-3 PR: opening the sheet in a real browser threw
 *   `charactersheet-druid-resources.js:1 Uncaught SyntaxError: Identifier 'e_' has
 *    already been declared`
 *   `charactersheet.js:157 Failed to init druidResources: ReferenceError:
 *    CharacterSheetDruidResources is not defined`
 * so the Druid Resources button/modal vanished and Wild Shape / Wild Companion /
 * Zodiac Form fell back to the generic active-states list.
 *
 * ROOT CAUSE: `charactersheet-druid-resources.js` was loaded as a CLASSIC deferred
 * `<script>` in charactersheet.html. Classic scripts share ONE top-level lexical
 * scope, and `charactersheet-respec.js` (also classic) already declares
 * `const {e_, ee} = globalThis`. druid-resources' own top-level `const {e_}` was a
 * SECOND classic declaration of `e_` → SyntaxError → the file never parsed →
 * `globalThis.CharacterSheetDruidResources` was never defined → init failed.
 *
 * jsdom imports the file as an ES module (module-scoped `const`), so a behavioral
 * jest test can NOT reproduce the classic-scope collision. The meaningful,
 * runnable guard is therefore STRUCTURAL: assert the file is wired into the app as
 * an ES module (imported by charactersheet.js) and is NOT loaded as a classic
 * (non-module) `<script>` in charactersheet.html. These assertions FAIL on the
 * pre-fix wiring and FAIL again if the classic tag is ever reintroduced.
 */

import fs from "fs";
import path from "path";
import {fileURLToPath} from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../..");
const HTML_PATH = path.join(REPO_ROOT, "charactersheet.html");
const CONTROLLER_PATH = path.join(REPO_ROOT, "js/charactersheet/charactersheet.js");
const MODULE_PATH = path.join(REPO_ROOT, "js/charactersheet/charactersheet-druid-resources.js");

const html = fs.readFileSync(HTML_PATH, "utf8");
const controllerSrc = fs.readFileSync(CONTROLLER_PATH, "utf8");
const moduleSrc = fs.readFileSync(MODULE_PATH, "utf8");

describe("Druid Resources module wiring", () => {
	test("charactersheet-druid-resources.js exports CharacterSheetDruidResources (is an ES module)", () => {
		expect(moduleSrc).toMatch(/export\s*\{[^}]*\bCharacterSheetDruidResources\b[^}]*\}/);
	});

	test("charactersheet.js imports CharacterSheetDruidResources from the module", () => {
		expect(controllerSrc).toMatch(
			/import\s*\{[^}]*\bCharacterSheetDruidResources\b[^}]*\}\s*from\s*["']\.\/charactersheet-druid-resources\.js["']/,
		);
	});

	test("charactersheet.html does NOT load druid-resources as a classic (non-module) script", () => {
		// Find any <script ...> tag that references druid-resources.js.
		const tagRe = /<script\b[^>]*charactersheet-druid-resources\.js[^>]*>/gi;
		const tags = html.match(tagRe) || [];
		for (const tag of tags) {
			// If it is present at all, it must be a module — never a classic script.
			// A classic script is `type="text/javascript"`, `type="application/javascript"`,
			// or has no type attribute. Only `type="module"` is acceptable.
			expect(tag).toMatch(/type\s*=\s*["']module["']/);
		}
	});

	test("charactersheet.html does not declare a classic deferred druid-resources tag", () => {
		// Tightest guard against the exact regressing line.
		expect(html).not.toMatch(
			/<script[^>]*type\s*=\s*["']text\/javascript["'][^>]*charactersheet-druid-resources\.js/i,
		);
	});
});
