/**
 * Regression guard for the ASI ↔ Half-Feat score-sync bug in QuickBuild.
 *
 * QuickBuild's "ASI + Feat" path (level 4 under TGTT rules) already
 * recomputes `featScores = _computeRunningScoresWithCurrentASI(...)` on
 * every ASI tick before re-rendering the feat selector, so the bug from
 * the level-up wizard does NOT reproduce here. This spec locks that
 * behaviour in place:
 *   1. `_computeRunningScoresWithCurrentASI` correctly folds the in-step
 *      ASI choices into the running scores.
 *   2. The `isBoth` branch of `renderAsiContent` derives `featScores`
 *      from that helper before calling `_renderFeatSelector`.
 *   3. ASI +/- buttons trigger a re-render of the feat section (via
 *      `renderAsiContent`) when `isBoth` is true.
 *   4. Half-feat ability buttons disable themselves at the score cap,
 *      mirroring the level-up wizard.
 */

import {readFileSync} from "fs";
import {fileURLToPath} from "url";
import {dirname, resolve} from "path";

import "./setup.js";
import "../../../js/charactersheet/charactersheet-state.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const QUICKBUILD_PATH = resolve(__dirname, "../../../js/charactersheet/charactersheet-quickbuild.js");
const QUICKBUILD_SRC = readFileSync(QUICKBUILD_PATH, "utf8");

await import("../../../js/charactersheet/charactersheet-quickbuild.js");
const CharacterSheetQuickBuild = globalThis.CharacterSheetQuickBuild;

function makeQuickBuild () {
	const mockState = {getAbilityScore: () => 10};
	const mockPage = {getState: () => mockState, filterByAllowedSources: a => a, getFeats: () => []};
	const qb = new CharacterSheetQuickBuild(mockPage);
	return qb;
}

describe("QuickBuild ASI ↔ Half-Feat score sync", () => {
	describe("`_computeRunningScoresWithCurrentASI`", () => {
		test("folds in-step ASI increases into the running scores", () => {
			const qb = makeQuickBuild();
			const running = {str: 15, dex: 13, con: 14, int: 10, wis: 10, cha: 8};
			const sel = {abilityChoices: {str: 2}};

			const out = qb._computeRunningScoresWithCurrentASI(running, sel);

			expect(out.str).toBe(17);
			expect(out.dex).toBe(13);
			expect(running.str).toBe(15); // does not mutate input
		});

		test("returns a copy of running scores when no ASI choices are pending", () => {
			const qb = makeQuickBuild();
			const running = {str: 15, dex: 13, con: 14, int: 10, wis: 10, cha: 8};
			const sel = {abilityChoices: {}};

			const out = qb._computeRunningScoresWithCurrentASI(running, sel);

			expect(out).toEqual(running);
			expect(out).not.toBe(running);
		});

		test("handles selections with no abilityChoices field", () => {
			const qb = makeQuickBuild();
			const running = {str: 15, dex: 13, con: 14, int: 10, wis: 10, cha: 8};
			const out = qb._computeRunningScoresWithCurrentASI(running, {});
			expect(out).toEqual(running);
		});

		test("sums multiple ability bumps in the same step", () => {
			const qb = makeQuickBuild();
			const running = {str: 15, dex: 13, con: 14, int: 10, wis: 10, cha: 8};
			const sel = {abilityChoices: {str: 1, dex: 1}};

			const out = qb._computeRunningScoresWithCurrentASI(running, sel);

			expect(out.str).toBe(16);
			expect(out.dex).toBe(14);
		});
	});

	describe("Source-level guards", () => {
		test("isBoth branch of renderAsiContent derives featScores from `_computeRunningScoresWithCurrentASI`", () => {
			// The pattern: `const featScores = isBoth ? this._computeRunningScoresWithCurrentASI(...) : runningScores;`
			expect(QUICKBUILD_SRC).toMatch(
				/featScores\s*=\s*isBoth\s*\?\s*this\._computeRunningScoresWithCurrentASI\(runningScores,\s*sel\)\s*:\s*runningScores/,
			);
		});

		test("isBoth branch wires `onFeatAbilityChanged` to also recompute ASI display", () => {
			// When isBoth, picking a feat ability should re-render the ASI grid
			// so the "new" column shows feat-bonus contribution.
			expect(QUICKBUILD_SRC).toMatch(
				/onFeatAbilityChanged\s*=\s*isBoth\s*\?\s*\(\)\s*=>\s*\{\s*renderAsiContent\(\);\s*reRenderFrom\(idx\s*\+\s*1\)/,
			);
		});

		test("ASI +/- handler re-renders the entire AsiContent when isBoth (so feat scores stay fresh)", () => {
			// In renderAsiContent, the onAsiChanged callback when isBoth must call renderAsiContent() again.
			expect(QUICKBUILD_SRC).toMatch(
				/onAsiChanged\s*=\s*isBoth\s*\?\s*\(\)\s*=>\s*\{\s*renderAsiContent\(\);\s*reRenderFrom\(idx\s*\+\s*1\)/,
			);
		});

		test("half-feat ability buttons disable when at the score cap", () => {
			// Guard for the cap-20 affordance ported from the level-up wizard.
			expect(QUICKBUILD_SRC).toMatch(/const\s+cap\s*=\s*choices\.ability\.max\s*\|\|\s*20/);
			expect(QUICKBUILD_SRC).toMatch(/const\s+isCapped\s*=\s*currentScore\s*>=\s*cap/);
			expect(QUICKBUILD_SRC).toMatch(/if\s*\(isCapped\)\s*return;/);
		});
	});
});
