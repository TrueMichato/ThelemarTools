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
const SHARED_SRC = readFileSync(resolve(__dirname, "../../../js/charactersheet/charactersheet-class-utils.js"), "utf8");
const SHARED_PICKER = SHARED_SRC.match(/static renderFeatAbilityChoices \([\s\S]*?\n\t\}/)[0];

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
		test("`_renderFeatAbilityButtons` passes pending scores and the authored spec to the shared picker", () => {
			const delegated = LEVELUP_SRC.match(/_renderFeatAbilityButtons \([\s\S]*?\n\t\}/)[0];
			expect(delegated).toMatch(/CharacterSheetClassUtils\.renderFeatAbilityChoices/);
			expect(delegated).toMatch(/spec:\s*abilityChoiceSpec/);
			expect(delegated).toMatch(/pendingScores/);
		});

		test("shared picker computes capped from the pending score and selected option's cap", () => {
			expect(SHARED_PICKER).toMatch(/pendingScores\?\.\[ability\]\s*\?\?\s*state\.getAbilityScore\(ability\)/);
			expect(SHARED_PICKER).toMatch(/const\s+capped\s*=\s*score\s*>=\s*option\.max/);
		});

		test("shared picker disables capped unselected abilities but allows deselection", () => {
			expect(SHARED_PICKER).toMatch(/button\.disabled\s*=\s*!selected\s*&&\s*\(capped/);
		});

		test("shared picker stores only the selected mode's allocation", () => {
			expect(SHARED_PICKER).toMatch(/choices\.ability\s*=\s*option\.count\s*===\s*1/);
			expect(SHARED_PICKER).toMatch(/choices\.abilityOption\s*=\s*Number\(select\.value\);\s*choices\.ability\s*=\s*null/);
		});

		test("shared picker caps the preview via capAbilityIncrease (no-lower, not a raw Math.min)", () => {
			expect(SHARED_PICKER).toMatch(/CharacterSheetClassUtils\.capAbilityIncrease\(score,\s*option\.amount,\s*option\.max\)/);
		});
	});
});
