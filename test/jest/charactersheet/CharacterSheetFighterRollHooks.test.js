/**
 * S3 #8 / #17 / #7 — roll-handler hook WIRING guards.
 *
 * The post-roll prompt controllers live on the 6.5K-line CharacterSheetPage, which
 * can't be imported under jsdom (top-level `window.addEventListener("load", …)`).
 * Per the repo idiom (see CharacterSheetCombatTabLayout.test.js) we assert the
 * controller SOURCE so the precise mechanics the bugs require can't silently
 * regress, complementing the state-level mechanics tests:
 *   - Tactical Mind REFUNDS exactly the snapshotted use (setSecondWindUsesRemaining(prev)),
 *     NOT restoreSecondWind()/reset-to-max, and is wired into BOTH ability + skill checks.
 *   - Indomitable spends a use (useIndomitable) and adds getIndomitableRerollBonus,
 *     wired into the saving-throw handler.
 *   - Last Ditch Evasion is gated on a Dex save, applies the half-damage helper, and is
 *     wired into the saving-throw handler.
 */

import {readFileSync} from "fs";
import {resolve, dirname} from "path";
import {fileURLToPath} from "url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const src = readFileSync(resolve(REPO_ROOT, "js/charactersheet/charactersheet.js"), "utf8");

const bodyOf = (name) => {
	const m = src.match(new RegExp(`async ${name}\\s*\\([\\s\\S]*?\\n\\t\\}`));
	expect(m).not.toBeNull();
	return m[0];
};

describe("Tactical Mind hook (#8) wiring", () => {
	const body = bodyOf("_pMaybeApplyTacticalMind");

	it("gates on the feature and an available Second Wind use", () => {
		expect(body).toContain("calcs.hasTacticalMind");
		expect(body).toContain("getSecondWindUsesRemaining");
	});

	it("snapshots remaining, spends exactly one use, then REFUNDS that snapshot (not reset-to-max)", () => {
		expect(body).toMatch(/const prevRemaining = this\._state\.getSecondWindUsesRemaining\(\)/);
		expect(body).toContain("setSecondWindUsesRemaining(prevRemaining - 1)");
		expect(body).toContain("setSecondWindUsesRemaining(prevRemaining)");
		// MUST NOT refund by resetting the whole pool.
		expect(body).not.toContain("restoreSecondWind(");
	});

	it("adds a 1d10 and persists", () => {
		expect(body).toContain("1d10");
		expect(body).toContain("_saveCurrentCharacter");
	});

	it("is invoked from BOTH the ability-check and skill-check handlers", () => {
		const ability = src.match(/async _rollAbilityCheck\s*\([\s\S]*?\n\t\}/);
		const skill = src.match(/async _rollSkillCheck\s*\([\s\S]*?\n\t\}/);
		expect(ability).not.toBeNull();
		expect(skill).not.toBeNull();
		expect(ability[0]).toContain("_pMaybeApplyTacticalMind");
		expect(skill[0]).toContain("_pMaybeApplyTacticalMind");
	});
});

describe("Indomitable hook (#17) wiring", () => {
	const body = bodyOf("_pMaybeApplyIndomitable");

	it("gates on the feature + a remaining use, and spends one on opt-in", () => {
		expect(body).toContain("this._state.hasIndomitable");
		expect(body).toContain("getIndomitableRemaining");
		expect(body).toContain("this._state.useIndomitable()");
	});

	it("rerolls the d20 and adds the (2024) reroll bonus to the new total", () => {
		expect(body).toContain("this._rollD20({})");
		expect(body).toContain("getIndomitableRerollBonus");
	});

	it("is invoked from the saving-throw handler", () => {
		const save = src.match(/async _rollSavingThrow\s*\([\s\S]*?\n\t\}/);
		expect(save).not.toBeNull();
		expect(save[0]).toContain("_pMaybeApplyIndomitable");
	});
});

describe("Last Ditch Evasion hook (#7) wiring", () => {
	const body = bodyOf("_pMaybeApplyLastDitchEvasion");

	it("is gated on a Dex save and the tactic flag", () => {
		expect(body).toMatch(/\(ability \|\| ""\)\.toLowerCase\(\) !== "dex"/);
		expect(body).toContain("hasLastDitchEvasion");
	});

	it("applies the half-damage helper (not a zero-damage path)", () => {
		expect(body).toContain("this._state.applyLastDitchEvasion");
		expect(body).toContain("res.halved");
		// The fixed mechanic is half, not "avoid all"/zero.
		expect(body).not.toMatch(/avoid all damage/i);
	});

	it("is invoked from the saving-throw handler", () => {
		const save = src.match(/async _rollSavingThrow\s*\([\s\S]*?\n\t\}/);
		expect(save).not.toBeNull();
		expect(save[0]).toContain("_pMaybeApplyLastDitchEvasion");
	});
});
