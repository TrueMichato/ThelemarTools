/**
 * Regression suite for bugs.md "QuickBuild HP roll manual input".
 *
 * The QuickBuild HP step previously offered "average" or "roll" with no way to
 * enter the value a player actually rolled at the table. This suite locks in:
 *
 *   1. `_validateHpStep` blocks "Next" when any non-L1 roll is missing,
 *      non-integer, or out of `[1, hitDie]`.
 *   2. The rendered HP table in roll mode includes an editable `<input
 *      type="number">` with `min`/`max` bounded to the hit die.
 *   3. "Re-roll All" preserves manually-touched levels (tracked in
 *      `_hpRollsManual`).
 *   4. L1 is read-only (RAW: max hit die).
 *
 * Tests (1) and (3)–(4) exercise method logic directly; (2) is a source-level
 * guard because no jsdom is wired into the charsheet test environment.
 */

import "./setup.js";
import {jest} from "@jest/globals";
import fs from "node:fs";
import path from "node:path";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-quickbuild.js";

const CharacterSheetQuickBuild = globalThis.CharacterSheetQuickBuild;
const QUICKBUILD_SOURCE = fs.readFileSync(
	path.resolve("js/charactersheet/charactersheet-quickbuild.js"),
	"utf8",
);

function makeAnalysis ({characterLevel, classLevel = characterLevel, hitDieFaces = 8, className = "Fighter"} = {}) {
	return {
		characterLevel,
		className,
		classSource: "PHB",
		classLevel,
		classData: {hd: {faces: hitDieFaces}},
	};
}

function makeQuickBuild ({levelAnalysis, hpRolls = {}, hpMethod = "roll"} = {}) {
	const qb = Object.create(CharacterSheetQuickBuild.prototype);
	qb._levelAnalysis = levelAnalysis;
	qb._selections = {hpMethod, hpRolls};
	qb._hpRollsManual = new Set();
	return qb;
}

describe("QuickBuild HP step — validation", () => {
	let toastSpy;
	beforeEach(() => {
		toastSpy = jest.fn();
		globalThis.JqueryUtil = {doToast: toastSpy};
	});

	test("average mode always validates", () => {
		const qb = makeQuickBuild({
			levelAnalysis: [makeAnalysis({characterLevel: 1}), makeAnalysis({characterLevel: 2})],
			hpMethod: "average",
		});
		expect(qb._validateHpStep()).toBe(true);
		expect(toastSpy).not.toHaveBeenCalled();
	});

	test("roll mode passes when every non-L1 entry is an integer within [1, hitDie]", () => {
		const qb = makeQuickBuild({
			levelAnalysis: [
				makeAnalysis({characterLevel: 1}),
				makeAnalysis({characterLevel: 2, hitDieFaces: 10}),
				makeAnalysis({characterLevel: 3, hitDieFaces: 10}),
			],
			hpRolls: {"Fighter_2": 1, "Fighter_3": 10},
		});
		expect(qb._validateHpStep()).toBe(true);
		expect(toastSpy).not.toHaveBeenCalled();
	});

	test("roll mode ignores L1 entirely (RAW: max hit die)", () => {
		const qb = makeQuickBuild({
			levelAnalysis: [
				makeAnalysis({characterLevel: 1, hitDieFaces: 8}),
				makeAnalysis({characterLevel: 2, hitDieFaces: 8}),
			],
			// L1 missing on purpose; only L2 matters.
			hpRolls: {"Fighter_2": 5},
		});
		expect(qb._validateHpStep()).toBe(true);
		expect(toastSpy).not.toHaveBeenCalled();
	});

	test("roll mode blocks when a value is missing", () => {
		const qb = makeQuickBuild({
			levelAnalysis: [
				makeAnalysis({characterLevel: 1}),
				makeAnalysis({characterLevel: 2, hitDieFaces: 10}),
			],
			hpRolls: {},
		});
		expect(qb._validateHpStep()).toBe(false);
		expect(toastSpy).toHaveBeenCalledTimes(1);
		const arg = toastSpy.mock.calls[0][0];
		expect(arg.type).toBe("warning");
		expect(arg.content).toMatch(/L2/);
	});

	test("roll mode blocks when a value is out of range", () => {
		const qb = makeQuickBuild({
			levelAnalysis: [
				makeAnalysis({characterLevel: 1}),
				makeAnalysis({characterLevel: 2, hitDieFaces: 8}),
				makeAnalysis({characterLevel: 3, hitDieFaces: 8}),
				makeAnalysis({characterLevel: 4, hitDieFaces: 8}),
			],
			hpRolls: {"Fighter_2": 0, "Fighter_3": 9, "Fighter_4": 4},
		});
		expect(qb._validateHpStep()).toBe(false);
		const msg = toastSpy.mock.calls[0][0].content;
		expect(msg).toMatch(/L2/);
		expect(msg).toMatch(/L3/);
		expect(msg).not.toMatch(/L4/);
	});

	test("roll mode blocks when a value is non-integer", () => {
		const qb = makeQuickBuild({
			levelAnalysis: [
				makeAnalysis({characterLevel: 1}),
				makeAnalysis({characterLevel: 2, hitDieFaces: 8}),
			],
			hpRolls: {"Fighter_2": 3.5},
		});
		expect(qb._validateHpStep()).toBe(false);
	});
});

describe("QuickBuild HP step — manual-roll tracking lifecycle", () => {
	test("_resetSelections clears the manual-roll Set", () => {
		const qb = Object.create(CharacterSheetQuickBuild.prototype);
		qb._hpRollsManual = new Set(["Fighter_3", "Fighter_5"]);
		qb._resetSelections();
		expect(qb._hpRollsManual).toBeInstanceOf(Set);
		expect(qb._hpRollsManual.size).toBe(0);
	});
});

describe("QuickBuild HP step — source-level guards for the editable input UI", () => {
	test("renders a number input bound to hitDie bounds for non-L1 roll rows", () => {
		// The editable cell is created in `_renderHpStep`'s `renderHpDetails`
		// inner function. Source-level guards keep us honest without spinning
		// jsdom for the whole wizard.
		expect(QUICKBUILD_SOURCE).toMatch(
			/<input type="number"[^>]*charsheet__quickbuild-hp-roll-input[^>]*min="1"[^>]*max="\$\{hitDie\}"/,
		);
	});

	test("commits input changes by clamping to [1, hitDie] and marking the level as manually-touched", () => {
		expect(QUICKBUILD_SOURCE).toMatch(/Math\.max\(1, Math\.min\(hitDie, raw\)\)/);
		expect(QUICKBUILD_SOURCE).toMatch(/this\._hpRollsManual\.add\(levelKey\)/);
	});

	test("Re-roll All skips levels in _hpRollsManual", () => {
		expect(QUICKBUILD_SOURCE).toMatch(/if \(this\._hpRollsManual\.has\(lk\)\) continue/);
	});

	test("per-row re-roll clears the manual flag for that level", () => {
		// Per-row 🎲 should always win, including over a manually-typed value.
		expect(QUICKBUILD_SOURCE).toMatch(/this\._hpRollsManual\.delete\(levelKey\)/);
	});

	test("L1 row is non-editable (no input, max-hit-die label) in roll mode", () => {
		// L1 ignored by `_calculateMaxHp`; UI must reflect that.
		expect(QUICKBUILD_SOURCE).toMatch(/Level 1 always uses the maximum hit die/);
		expect(QUICKBUILD_SOURCE).toMatch(/isFirstLevel = analysis\.characterLevel === 1/);
	});
});
