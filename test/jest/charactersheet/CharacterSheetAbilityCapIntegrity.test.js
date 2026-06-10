/**
 * Ability Score Cap Integrity Tests
 *
 * Covers two regressions:
 *
 *  #5 — A "increase up to a maximum of N" grant must NEVER LOWER a score that is
 *       already at or above the cap. The legacy `Math.min(cap, current + amount)`
 *       clamp silently dropped a 22 down to 20 when a "+1, max 20" feat/ASI was
 *       applied. The fix routes every positive apply path through
 *       `CharacterSheetClassUtils.capAbilityIncrease`, and bakes the same
 *       no-lower rule into the canonical state helpers `applyASI` /
 *       `increaseAbility`.
 *
 *  #4 — `_recalculateCustomModifiers()` used to CLEAR the ability-score maps up
 *       front and repopulate them in a loop, so any `getAbilityScore` read during
 *       the loop saw base-only values. The fix builds the maps into temps and
 *       swaps them in atomically at the end. Also pins `_renderAbilities()` to
 *       paint REAL scores instead of a literal `10` placeholder.
 */

import "./setup.js";
import {readFileSync} from "fs";
import {resolve, dirname} from "path";
import {fileURLToPath} from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "../../..");

let CharacterSheetState;
let CharacterSheetClassUtils;

beforeAll(async () => {
	CharacterSheetState = (await import("../../../js/charactersheet/charactersheet-state.js")).CharacterSheetState;
	CharacterSheetClassUtils = (await import("../../../js/charactersheet/charactersheet-class-utils.js")).CharacterSheetClassUtils;
});

describe("Bug #5 — capAbilityIncrease never lowers a score", () => {
	describe("CharacterSheetClassUtils.capAbilityIncrease", () => {
		it("is a no-op when the score already exceeds the cap (22 + 1/max20 -> 22)", () => {
			expect(CharacterSheetClassUtils.capAbilityIncrease(22, 1, 20)).toBe(22);
		});

		it("is a no-op when the score is exactly at the cap (20 + 1/max20 -> 20)", () => {
			expect(CharacterSheetClassUtils.capAbilityIncrease(20, 1, 20)).toBe(20);
		});

		it("preserves a far-over-cap score (24 + 2/max20 -> 24)", () => {
			expect(CharacterSheetClassUtils.capAbilityIncrease(24, 2, 20)).toBe(24);
		});

		it("still caps a legitimate increase at the maximum (18 + 2/max20 -> 20)", () => {
			expect(CharacterSheetClassUtils.capAbilityIncrease(18, 2, 20)).toBe(20);
		});

		it("applies a normal below-cap increase (18 + 1/max20 -> 19)", () => {
			expect(CharacterSheetClassUtils.capAbilityIncrease(18, 1, 20)).toBe(19);
		});

		it("partially clamps when the increase would overshoot (19 + 2/max20 -> 20)", () => {
			expect(CharacterSheetClassUtils.capAbilityIncrease(19, 2, 20)).toBe(20);
		});

		it("honors a custom cap (16 + 2/max24 -> 18, and 23 + 1/max24 -> 24)", () => {
			expect(CharacterSheetClassUtils.capAbilityIncrease(16, 2, 24)).toBe(18);
			expect(CharacterSheetClassUtils.capAbilityIncrease(23, 1, 24)).toBe(24);
		});

		it("never lowers even with a custom cap (26 + 1/max24 -> 26)", () => {
			expect(CharacterSheetClassUtils.capAbilityIncrease(26, 1, 24)).toBe(26);
		});
	});

	describe("state.applyASI (canonical helper)", () => {
		let state;
		beforeEach(() => { state = new CharacterSheetState(); });

		it("does not lower a base already above the cap", () => {
			state.setAbilityBase("str", 22);
			state.applyASI("str", 1, 20);
			expect(state.getAbilityBase("str")).toBe(22);
		});

		it("still caps a legitimate increase at the maximum", () => {
			state.setAbilityBase("str", 18);
			state.applyASI("str", 2, 20);
			expect(state.getAbilityBase("str")).toBe(20);
		});

		it("applies a normal below-cap increase", () => {
			state.setAbilityBase("dex", 14);
			state.applyASI("dex", 2, 20);
			expect(state.getAbilityBase("dex")).toBe(16);
		});
	});

	describe("state.increaseAbility (canonical helper)", () => {
		let state;
		beforeEach(() => { state = new CharacterSheetState(); });

		it("does not lower a base already above the cap", () => {
			state.setAbilityBase("con", 22);
			state.increaseAbility("con", 1, 20);
			expect(state.getAbilityBase("con")).toBe(22);
		});

		it("caps a legitimate increase at 20", () => {
			state.setAbilityBase("con", 19);
			state.increaseAbility("con", 2, 20);
			expect(state.getAbilityBase("con")).toBe(20);
		});
	});

	describe("CharacterSheetClassUtils.applyFeatBonuses", () => {
		let state;
		beforeEach(() => { state = new CharacterSheetState(); });

		it("a static '+1, max 20' feat applied to a 22 leaves it 22 (no drop to 20)", () => {
			state.setAbilityBase("str", 22);
			const feat = {name: "Test Feat", source: "HB", ability: [{str: 1, max: 20}]};
			CharacterSheetClassUtils.applyFeatBonuses(state, feat);
			expect(state.getAbilityBase("str")).toBe(22);
		});

		it("a static '+1, max 20' feat still raises an 18 to 19", () => {
			state.setAbilityBase("wis", 18);
			const feat = {name: "Test Feat", source: "HB", ability: [{wis: 1, max: 20}]};
			CharacterSheetClassUtils.applyFeatBonuses(state, feat);
			expect(state.getAbilityBase("wis")).toBe(19);
		});
	});
});

describe("Bug #4 — _recalculateCustomModifiers is atomic", () => {
	let state;
	beforeEach(() => { state = new CharacterSheetState(); });

	it("getAbilityScore reflects an ability modifier after recalc", () => {
		state.setAbilityBase("str", 15);
		state.addNamedModifier({name: "Belt", type: "ability:str", value: 2});
		expect(state.getAbilityScore("str")).toBe(17);
	});

	it("never exposes base-only ability scores mid-recalc", () => {
		state.setAbilityBase("str", 15);
		// Seed the live ability-score map (str -> +2) so a consistent read is 17.
		state.addNamedModifier({name: "Belt", type: "ability:str", value: 2});
		expect(state.getAbilityScore("str")).toBe(17);

		// Capture what getAbilityScore returns WHILE the recalc loop is running.
		// With the atomic fix the previous map stays live until the swap at the end,
		// so a mid-loop read sees 17. The pre-fix code cleared the map up front and
		// would have leaked the base-only value of 15.
		let midFlightScore = null;
		const orig = state._getNamedModifierEffectiveValue.bind(state);
		state._getNamedModifierEffectiveValue = (mod) => {
			if (midFlightScore == null) midFlightScore = state.getAbilityScore("str");
			return orig(mod);
		};

		state._recalculateCustomModifiers();

		expect(midFlightScore).toBe(17);
		// And the final value is still correct after the atomic swap.
		expect(state.getAbilityScore("str")).toBe(17);
	});

	it("fully REPLACES the ability map so stale keys cannot survive a recalc", () => {
		state.setAbilityBase("str", 15);
		const id = state.addNamedModifier({name: "Belt", type: "ability:str", value: 2});
		expect(state.getAbilityScore("str")).toBe(17);

		// Disable the modifier and recalc: the str entry must be gone, not merged.
		state.toggleNamedModifier(id);
		state._recalculateCustomModifiers();
		expect(state.getAbilityScore("str")).toBe(15);
	});
});

describe("Bug #4 — _renderAbilities paints real scores (source pin)", () => {
	let source;
	beforeAll(() => {
		source = readFileSync(resolve(REPO_ROOT, "js/charactersheet/charactersheet.js"), "utf8");
	});

	it("_renderAbilities reads real scores/mods instead of a literal 10/+0 placeholder", () => {
		const match = source.match(/_renderAbilities\s*\(\)\s*\{[\s\S]*?\n\t\}/);
		expect(match).not.toBeNull();
		const body = match[0];
		expect(body).toMatch(/getAbilityScore\(abl\)/);
		expect(body).toMatch(/getAbilityMod\(abl\)/);
		// The old hard-coded placeholder markup must be gone.
		expect(body).not.toMatch(/-score">10</);
		expect(body).not.toMatch(/-mod">\+0</);
	});

	it("_updateAllCalculations follows _renderAbilities with _renderAbilityScores", () => {
		const match = source.match(/_updateAllCalculations\s*\(\)\s*\{[\s\S]*?\n\t\}/);
		expect(match).not.toBeNull();
		const body = match[0];
		const idxAbilities = body.indexOf("this._renderAbilities()");
		const idxScores = body.indexOf("this._renderAbilityScores()");
		expect(idxAbilities).toBeGreaterThanOrEqual(0);
		expect(idxScores).toBeGreaterThan(idxAbilities);
	});
});
