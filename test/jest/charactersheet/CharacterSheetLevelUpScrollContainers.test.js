/**
 * Regression guard for nested-scroll display bugs on the level-up and
 * quick-build feature pickers (metamagic, invocations, maneuvers, combat
 * traditions, combat methods, feature options).
 *
 * Symptom (pre-fix): each picker list had inline `style="max-height: ...;
 * overflow-y: auto"`, creating a second scroll axis inside an already
 * scrollable accordion / wizard body. With longer lists (e.g. Metamagic at
 * higher levels, Combat Methods, Feat sub-options) the last options were
 * clipped behind the inner scroll container's bottom edge and the
 * "Selected: X/Y" counter was pushed out of view.
 *
 * Fix: collapse to a single scroll axis per surface
 *   - level-up: `.charsheet__levelup-accordion-body` scrolls (65vh)
 *   - quick-build: `.charsheet__quickbuild-content` scrolls
 *
 * Inner picker lists therefore must NOT carry inline `max-height` +
 * `overflow-y` styles. They get visual chrome (border / radius / padding)
 * from the shared `.charsheet__levelup-picker-list` /
 * `.charsheet__quickbuild-picker-list` CSS classes.
 *
 * This test is a source-level guard \u2014 spinning the full jsdom level-up
 * wizard just to assert these styles are absent would be heavy and
 * brittle; the failure mode we're guarding against is "a future edit
 * re-introduces an inline scroll container".
 */

import {readFileSync} from "fs";
import {fileURLToPath} from "url";
import {dirname, resolve} from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..", "..");

function read (rel) {
	return readFileSync(resolve(REPO_ROOT, rel), "utf8");
}

describe("Level-up / Quick-build picker scroll containers", () => {
	const LEVELUP_SRC = read("js/charactersheet/charactersheet-levelup.js");
	const QUICKBUILD_SRC = read("js/charactersheet/charactersheet-quickbuild.js");
	const CSS_SRC = read("css/charactersheet.css");

	// Matches an inline style attribute that combines a `max-height` with
	// an `overflow-y: auto` (or `scroll`). This is the exact pattern that
	// produced the nested-scroll bug.
	const INLINE_NESTED_SCROLL = /style\s*=\s*"[^"]*max-height\s*:\s*[^";]+;[^"]*overflow-y\s*:\s*(?:auto|scroll)[^"]*"/i;

	test("level-up source has no inline nested-scroll picker container", () => {
		// Scan every line that contains a picker-list class \u2014 these are
		// the elements that previously carried inline max-height styles.
		const pickerLineRegex = /charsheet__levelup-(?:opt|tradition|feat-opt)-list/;

		const offenders = [];
		LEVELUP_SRC.split(/\n/).forEach((line, idx) => {
			if (!pickerLineRegex.test(line)) return;
			if (INLINE_NESTED_SCROLL.test(line)) offenders.push(`L${idx + 1}: ${line.trim()}`);
		});

		expect(offenders).toEqual([]);
	});

	test("quick-build combat tradition / method picker lists have no inline scroll", () => {
		// The quickbuild lists are constructed inline (no semantic class
		// in the original markup), so guard the surrounding context by
		// looking at the two call sites we touched. Both should now use
		// the shared `.charsheet__quickbuild-picker-list` class and have
		// no inline `max-height` + `overflow-y` pair anywhere on the line.
		const offenders = [];
		QUICKBUILD_SRC.split(/\n/).forEach((line, idx) => {
			if (!/charsheet__quickbuild-picker-list/.test(line)) return;
			if (INLINE_NESTED_SCROLL.test(line)) offenders.push(`L${idx + 1}: ${line.trim()}`);
		});

		expect(offenders).toEqual([]);
	});

	test("css .charsheet__levelup-opt-list does not declare its own scroll axis", () => {
		// Pull the rule body and assert neither `max-height` nor
		// `overflow-y` is declared on it (the accordion body owns scroll).
		const match = CSS_SRC.match(/\.charsheet__levelup-opt-list\s*\{([\s\S]*?)\}/);
		expect(match).not.toBeNull();
		const body = match[1];
		expect(body).not.toMatch(/max-height\s*:/);
		expect(body).not.toMatch(/overflow-y\s*:/);
	});

	test("css .charsheet__levelup-accordion-body owns the single scroll axis at \u2265 60vh", () => {
		const match = CSS_SRC.match(/\.charsheet__levelup-accordion-body\s*\{([\s\S]*?)\}/);
		expect(match).not.toBeNull();
		const body = match[1];
		expect(body).toMatch(/overflow-y\s*:\s*auto/);
		const mh = body.match(/max-height\s*:\s*(\d+)vh/);
		expect(mh).not.toBeNull();
		expect(parseInt(mh[1], 10)).toBeGreaterThanOrEqual(60);
	});

	test("shared picker-list helper class is defined in css", () => {
		expect(CSS_SRC).toMatch(/\.charsheet__levelup-picker-list/);
		expect(CSS_SRC).toMatch(/\.charsheet__quickbuild-picker-list/);
	});

	test("builder tradition + method picker lists have no inline scroll", () => {
		const BUILDER_SRC = read("js/charactersheet/charactersheet-builder.js");
		const offenders = [];
		BUILDER_SRC.split(/\n/).forEach((line, idx) => {
			if (!/charsheet__builder-(tradition-list|method-list)/.test(line)) return;
			if (INLINE_NESTED_SCROLL.test(line)) offenders.push(`L${idx + 1}: ${line.trim()}`);
		});
		expect(offenders).toEqual([]);
	});

	test("tradition rows use shared class instead of inline cursor across all 3 surfaces", () => {
		const BUILDER_SRC = read("js/charactersheet/charactersheet-builder.js");
		const LEVELUP = read("js/charactersheet/charactersheet-levelup.js");
		const QUICKBUILD = read("js/charactersheet/charactersheet-quickbuild.js");

		// Every tradition row should be tagged with the shared class
		// (cursor / hover / selected styling lives in CSS, not inline).
		expect(BUILDER_SRC).toMatch(/charsheet__tradition-row/);
		expect(LEVELUP).toMatch(/charsheet__tradition-row/);
		expect(QUICKBUILD).toMatch(/charsheet__tradition-row/);
	});

	test("css defines .charsheet__tradition-row with hover + checked affordances", () => {
		expect(CSS_SRC).toMatch(/\.charsheet__tradition-row\b/);
		expect(CSS_SRC).toMatch(/\.charsheet__tradition-row:hover/);
		expect(CSS_SRC).toMatch(/\.charsheet__tradition-row:has\(input:checked\)/);
	});
});
