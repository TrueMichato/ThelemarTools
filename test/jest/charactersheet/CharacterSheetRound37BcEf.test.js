/**
 * ROUND 37 — Bladesinger classification, reading speed, Inspiring Leader,
 * combat-tab consumables.
 *
 * Bug #5 (Bladesong double-surfaces): Bladesong is a persistent active-state
 *   TOGGLE, but it ALSO satisfied the action-economy heuristic and surfaced a
 *   second time in the combat "Abilities" list. The list filter now drops any
 *   feature whose `detectActivatableFeature(...).isToggle` is true — pinned here
 *   by asserting Bladesong detects as a toggle (the load-bearing predicate).
 *
 * Bug #6 (Song of Defense): it was detected as a reaction; it is actually an
 *   on-demand ABILITY (spend a Wizard spell slot to reduce damage by 5× slot
 *   level, gated on Bladesong). Pinned by the classification override + the
 *   non-toggle ability activation info.
 *
 * Bug #8 (Inspiring Leader): the feat grants temp HP = level + CHA mod (PHB) /
 *   level + higher of WIS/CHA (XPHB), once per short/long rest. Pins the temp-HP
 *   formula (PHB vs XPHB vs floor) and the addFeat per-rest use synthesis.
 *
 * Bug #10 (Reading Speed): TGTT "Reading Books" — (1 + INT mod × 2) × 30 pages
 *   per hour, floored at 1. Pins the formula + clamp.
 */

import "./setup.js";

import "../../../js/charactersheet/charactersheet-state.js";

const CharacterSheetState = globalThis.CharacterSheetState;

describe("R37 Bug #5 — Bladesong is a toggle (hidden from the Abilities list)", () => {
	test("detectActivatableFeature(Bladesong) reports isToggle:true", () => {
		const bladesong = {
			name: "Bladesong",
			description: "You can invoke an ancient elven magic called the Bladesong as a bonus action.",
		};
		const info = CharacterSheetState.detectActivatableFeature(bladesong);
		expect(info).toBeTruthy();
		expect(info.isToggle).toBe(true);
	});
});

describe("R37 Bug #6 — Song of Defense classifies as an on-demand ability", () => {
	test("classification override maps 'song of defense' → 'ability'", () => {
		expect(CharacterSheetState.FEATURE_CLASSIFICATION_OVERRIDES["song of defense"]).toBe("ability");
	});

	test("detectActivatableFeature(Song of Defense) is a non-toggle ability", () => {
		const sod = {
			name: "Song of Defense",
			description: "While your Bladesong is active, you can expend a spell slot to reduce damage taken.",
		};
		const info = CharacterSheetState.detectActivatableFeature(sod);
		expect(info).toBeTruthy();
		expect(info.isToggle).toBe(false);
	});
});

describe("R37 Bug #8 — Inspiring Leader temp HP + use synthesis", () => {
	/** @type {*} */
	let state;
	beforeEach(() => {
		state = Object.create(CharacterSheetState.prototype);
		state.getTotalLevel = () => 5;
		const mods = {cha: 1, wis: 4};
		state.getAbilityMod = (ab) => mods[ab] ?? 0;
	});

	test("PHB: level + CHA mod", () => {
		expect(state.getInspiringLeaderTempHp({source: "PHB"})).toBe(6); // 5 + 1
	});

	test("XPHB: level + higher of WIS/CHA", () => {
		expect(state.getInspiringLeaderTempHp({source: "XPHB"})).toBe(9); // 5 + max(1,4)
	});

	test("floored at level when the modifier is negative", () => {
		state.getAbilityMod = () => -3;
		expect(state.getInspiringLeaderTempHp({source: "PHB"})).toBe(5); // max(5, 5-3)
	});

	test("addFeat synthesizes a per-short-rest use for Inspiring Leader", () => {
		const real = new CharacterSheetState();
		real.addFeat({name: "Inspiring Leader", source: "PHB", description: "You can spend 10 minutes inspiring your companions."});
		const feat = real.getFeats().find(f => f.name === "Inspiring Leader");
		expect(feat).toBeTruthy();
		expect(feat.uses).toBeTruthy();
		expect(feat.uses.max).toBe(1);
		expect(feat.uses.current).toBe(1);
		expect(feat.uses.recharge).toBe("short");
		// A linked resource is created so the Resources panel tracks it.
		expect(real.getResources().some(r => r.name === "Inspiring Leader")).toBe(true);
	});
});

describe("R37 Bug #10 — Reading Speed (TGTT)", () => {
	/** @type {*} */
	let state;
	beforeEach(() => { state = Object.create(CharacterSheetState.prototype); });

	test("(1 + INT mod ÷ 2) × 30 for a positive modifier", () => {
		state.getAbilityMod = () => 3;
		expect(state.getReadingSpeed()).toBe(75); // (1 + 1.5) × 30
	});

	test("baseline 30 at INT mod 0", () => {
		state.getAbilityMod = () => 0;
		expect(state.getReadingSpeed()).toBe(30);
	});

	test("clamped to 1 (never 0/negative) for a low INT", () => {
		state.getAbilityMod = () => -4;
		expect(state.getReadingSpeed()).toBe(1); // (1 - 2) × 30 = -30 → 1
	});
});
