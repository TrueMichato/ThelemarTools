/**
 * Round 19 — Illrigger Infernal Conduit spend mechanic.
 *
 * Infernal Conduit (level 6) grants a pool of d10s (already COUNTED in the calc block).
 * This round adds the spend/interaction mechanic. As an action you touch a creature, spend
 * one or more dice, the target makes a CON save vs the interdict DC, then choose:
 *   - Invigorate: target heals (fail: full roll, success: half); YOU take the full roll as
 *     necrotic damage regardless of save (unpreventable; 0 HP → unconscious & stabilized).
 *   - Devour: target takes necrotic (fail: full, success: half); YOU heal the damage dealt.
 *     On a FAILED save at L11+, the target also gains 1 level of exhaustion.
 * The pool recovers on a LONG rest only.
 *
 * spendInfernalConduitDice uses a deterministic average roll (n * (die+1)/2 = n*5 for d10)
 * for headless test stability, overridable via opts.roll. Only the SELF-side HP swing is
 * applied to the sheet; target numbers are returned for the player/DM.
 */

import "./setup.js";
import "../../../js/charactersheet/charactersheet-state.js";

const CharacterSheetState = globalThis.CharacterSheetState;

const ILL = {name: "Illrigger", source: "IllriggerRevised"};

function makeIllrigger (level = 6, abilities = {}) {
	const state = new CharacterSheetState();
	const ab = {str: 10, dex: 12, con: 16, int: 10, wis: 10, cha: 18, ...abilities};
	Object.entries(ab).forEach(([k, v]) => state.setAbilityBase(k, v));
	state.addClass({...ILL, level});
	state.setMaxHp(60);
	state.setCurrentHp(60);
	return state;
}

describe("Infernal Conduit — pool availability", () => {
	it("does not exist before level 6", () => {
		const state = makeIllrigger(5);
		expect(state.hasInfernalConduit()).toBe(false);
		expect(state.getInfernalConduitMax()).toBe(0);
		expect(state.getInfernalConduitAvailable()).toBe(0);
	});

	it("seeds the pool to the level-scaled max at level 6 (3 d10s)", () => {
		const state = makeIllrigger(6);
		expect(state.hasInfernalConduit()).toBe(true);
		expect(state.getInfernalConduitMax()).toBe(3);
		expect(state.getInfernalConduitDie()).toBe(10);
		expect(state.getInfernalConduitAvailable()).toBe(3);
	});

	it("scales the pool with level (5 d10s at level 9)", () => {
		const state = makeIllrigger(9);
		expect(state.getInfernalConduitMax()).toBe(5);
		expect(state.getInfernalConduitAvailable()).toBe(5);
	});

	it("reports Touch range by default", () => {
		expect(makeIllrigger(6).getInfernalConduitRange()).toBe("Touch");
	});
});

describe("Infernal Conduit — spending dice depletes the pool", () => {
	it("decrements available dice and clamps the spend to what's left", () => {
		const state = makeIllrigger(6); // 3 dice
		const res = state.spendInfernalConduitDice(2, "devour", {saveResult: "success"});
		expect(res.diceSpent).toBe(2);
		expect(state.getInfernalConduitAvailable()).toBe(1);

		// Asking for more than remaining is clamped to the remaining count.
		const res2 = state.spendInfernalConduitDice(5, "devour", {saveResult: "success"});
		expect(res2.diceSpent).toBe(1);
		expect(state.getInfernalConduitAvailable()).toBe(0);

		// Nothing left → null.
		expect(state.spendInfernalConduitDice(1, "devour")).toBeNull();
	});
});

describe("Infernal Conduit — Invigorate (heal ally, self necrotic)", () => {
	it("on a failed save: target heals the full roll, you take the full roll", () => {
		const state = makeIllrigger(6);
		const res = state.spendInfernalConduitDice(2, "invigorate", {saveResult: "fail"});
		// Deterministic: 2 d10 average = 2 * 5 = 10.
		expect(res.total).toBe(10);
		expect(res.effect).toBe("invigorate");
		expect(res.targetHpDelta).toBe(10); // target heals full
		expect(res.selfHpDelta).toBe(-10); // you take full necrotic
		expect(state.getCurrentHp()).toBe(50); // 60 - 10
	});

	it("on a successful save: target heals half, you still take the full roll", () => {
		const state = makeIllrigger(6);
		const res = state.spendInfernalConduitDice(2, "invigorate", {saveResult: "success"});
		expect(res.targetHpDelta).toBe(5); // half
		expect(res.selfHpDelta).toBe(-10); // still full
		expect(state.getCurrentHp()).toBe(50);
	});

	it("self necrotic that reaches 0 HP → unconscious and stabilized", () => {
		const state = makeIllrigger(6);
		state.setMaxHp(8);
		state.setCurrentHp(8);
		const res = state.spendInfernalConduitDice(2, "invigorate", {saveResult: "fail"}); // 10 necrotic
		expect(res.selfDroppedToZero).toBe(true);
		expect(state.getCurrentHp()).toBe(0);
		expect(state.isStabilized()).toBe(true);
	});
});

describe("Infernal Conduit — Devour (drain enemy, self heal)", () => {
	it("on a failed save: target takes the full roll, you heal that amount", () => {
		const state = makeIllrigger(6);
		state.setCurrentHp(40); // room to heal
		const res = state.spendInfernalConduitDice(2, "devour", {saveResult: "fail"});
		expect(res.total).toBe(10);
		expect(res.targetHpDelta).toBe(-10); // target takes full
		expect(res.selfHpDelta).toBe(10); // you heal full
		expect(state.getCurrentHp()).toBe(50); // 40 + 10
	});

	it("on a successful save: target takes half, you heal that half", () => {
		const state = makeIllrigger(6);
		state.setCurrentHp(40);
		const res = state.spendInfernalConduitDice(2, "devour", {saveResult: "success"});
		expect(res.targetHpDelta).toBe(-5);
		expect(res.selfHpDelta).toBe(5);
		expect(state.getCurrentHp()).toBe(45);
	});

	it("does NOT apply exhaustion before level 11", () => {
		const state = makeIllrigger(6);
		expect(state.hasInfernalConduitImprovement()).toBe(false);
		const res = state.spendInfernalConduitDice(2, "devour", {saveResult: "fail"});
		expect(res.appliesExhaustion).toBe(false);
	});

	it("applies exhaustion at level 11+ on a FAILED save only", () => {
		const state = makeIllrigger(11);
		expect(state.hasInfernalConduitImprovement()).toBe(true);
		const fail = state.spendInfernalConduitDice(1, "devour", {saveResult: "fail"});
		expect(fail.appliesExhaustion).toBe(true);
		const success = state.spendInfernalConduitDice(1, "devour", {saveResult: "success"});
		expect(success.appliesExhaustion).toBe(false);
	});
});

describe("Infernal Conduit — explicit roll override", () => {
	it("uses opts.roll when provided (UI passes the real dice total)", () => {
		const state = makeIllrigger(6);
		state.setCurrentHp(30);
		const res = state.spendInfernalConduitDice(2, "devour", {saveResult: "fail", roll: 17});
		expect(res.total).toBe(17);
		expect(res.targetHpDelta).toBe(-17);
		expect(res.selfHpDelta).toBe(17);
	});
});

describe("Infernal Conduit — long-rest restore", () => {
	it("restoreInfernalConduit refills the pool to max", () => {
		const state = makeIllrigger(9); // 5 dice
		state.spendInfernalConduitDice(3, "devour", {saveResult: "success"});
		expect(state.getInfernalConduitAvailable()).toBe(2);
		state.restoreInfernalConduit();
		expect(state.getInfernalConduitAvailable()).toBe(5);
	});
});
