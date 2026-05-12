/**
 * Regression guard for the ASI ↔ Half-Feat score-sync bug.
 *
 * Bug: in the level-up wizard at a level granting BOTH an ASI and a feat
 * (TGTT level-4 rule), if the user adjusted the ASI grid *before* picking
 * a half-feat (a feat with `ability.choose`), the feat's ability buttons
 * rendered with the **stale base** "current → new" labels rather than the
 * post-ASI pending scores. The reverse order (feat first, ASI second)
 * already worked via `_refreshFeatAbilityChoices`.
 *
 * Fix: at both feat-click handlers (regular + epic boon) the wizard now
 * calls `_refreshFeatAbilityChoices()` after the initial
 * `_renderFeatChoicesUI(...)` so the just-rendered (stale) buttons get
 * swapped for ones using pending ASI scores.
 *
 * Additionally, half-feat ability buttons disable themselves when the
 * pending score is already at the cap (20 by default), matching the
 * existing "+ disabled at 20" behaviour on the ASI grid.
 *
 * This file uses source-level guards (no jsdom available in this repo).
 */

import {readFileSync} from "fs";
import {fileURLToPath} from "url";
import {dirname, resolve} from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const LEVELUP_PATH = resolve(__dirname, "../../../js/charactersheet/charactersheet-levelup.js");
const LEVELUP_SRC = readFileSync(LEVELUP_PATH, "utf8");

describe("Level-up ASI ↔ Half-Feat score sync", () => {
	describe("Feat-click handlers refresh ability buttons with pending ASI", () => {
		test("regular feat click handler calls `_refreshFeatAbilityChoices` after `_renderFeatChoicesUI`", () => {
			const m = LEVELUP_SRC.match(
				/this\._renderFeatChoicesUI\(feat,\s*choices,\s*featChoicesContainer,\s*\(\)\s*=>\s*\{\s*_refreshAsiDisplays\(\);\s*\}\);[\s\S]{0,200}?_refreshFeatAbilityChoices\(\)/,
			);
			expect(m).not.toBeNull();
		});

		test("epic boon click handler calls `_refreshFeatAbilityChoices` after `_renderFeatChoicesUI`", () => {
			const m = LEVELUP_SRC.match(
				/this\._renderFeatChoicesUI\(boon,\s*boonChoices,\s*featChoicesContainer,\s*\(\)\s*=>\s*\{\s*_refreshAsiDisplays\(\);\s*\}\);[\s\S]{0,200}?_refreshFeatAbilityChoices\(\)/,
			);
			expect(m).not.toBeNull();
		});

		test("`_refreshFeatAbilityChoices` is defined and computes pending scores from `asiValues`", () => {
			// Ensure the helper that does the actual swap still exists and reads asiValues
			// (so the refresh call sites above are not silently no-ops).
			expect(LEVELUP_SRC).toMatch(/const\s+_refreshFeatAbilityChoices\s*=/);
			const helper = LEVELUP_SRC.match(/const\s+_refreshFeatAbilityChoices\s*=\s*\(\)\s*=>\s*\{[\s\S]*?\n\t\t\};/);
			expect(helper).not.toBeNull();
			expect(helper[0]).toMatch(/asiValues/);
			expect(helper[0]).toMatch(/this\._renderFeatAbilityButtons\([\s\S]*?pendingScores/);
		});
	});

	describe("Half-feat ability buttons honour score cap", () => {
		test("`_renderFeatAbilityButtons` derives the cap from `abilityChoiceSpec.max` (defaults to 20)", () => {
			expect(LEVELUP_SRC).toMatch(/const\s+cap\s*=\s*abilityChoiceSpec\.max\s*\|\|\s*20/);
		});

		test("`_renderFeatAbilityButtons` computes `isCapped` from `currentScore >= cap`", () => {
			expect(LEVELUP_SRC).toMatch(/const\s+isCapped\s*=\s*currentScore\s*>=\s*cap/);
		});

		test("`_renderFeatAbilityButtons` renders the button with a `disabled` attribute when capped", () => {
			expect(LEVELUP_SRC).toMatch(/isCapped\s*\?\s*`disabled\s+title="Already at maximum/);
		});

		test("`_renderFeatAbilityButtons` short-circuits click handler when `isCapped`", () => {
			const click = LEVELUP_SRC.match(/btn\.addEventListener\("click",\s*\(\)\s*=>\s*\{\s*if\s*\(isCapped\)\s*return;[\s\S]{0,300}?_featChoices\.ability/);
			expect(click).not.toBeNull();
		});

		test("`_renderFeatAbilityButtons` uses cap variable (not hardcoded 20) in the Math.min", () => {
			expect(LEVELUP_SRC).toMatch(/Math\.min\(cap,\s*currentScore\s*\+\s*amount\)/);
		});
	});
});
