/**
 * S3 — Hellspeaker "Invoke Hell" interdiction boons: activation / roll / lifecycle
 * mechanics (bugs #9 Red Cant, #10 Slippery Ploy, #12 Hellsight).
 *
 * These assert the REAL state-level mechanics that the three boon fixes rely on:
 *   - #9  Red Cant  → `spendSeal()` (the new no-placement seal cost the roll-pipeline
 *                     hook consumes) + the boon-activation seal spend.
 *   - #10 Slippery Ploy → `applyInterdictBoonActivation("Slippery Ploy", …, {target})`
 *                     now creates a REAL tracked seal placement (was a dead seal-spend).
 *   - #12 Hellsight → the `hellsight` active-state invoke→truesight-60 / end→0 lifecycle
 *                     surfaced through `getSenses()`.
 *
 * The DOM event paths the jest string-DOM mock cannot fire — the Red Cant roll prompt
 * (`_pMaybeApplyRedCant` wired into `_rollAbilityCheck`/`_rollSkillCheck`), the Slippery
 * Ploy placement modal (`_pSlipperyPloyPlaceSeal`), and the senses-display refresh on the
 * Hellsight boon toggle — were verified end-to-end in a real headless browser run against
 * the `vaa` fixture (Hochling Illrigger 15 Hellspeaker); see the session evidence.
 */

import "./setup.js";
import "../../../js/charactersheet/charactersheet-state.js";

const CharacterSheetState = globalThis.CharacterSheetState;

const buildIllrigger = (level = 13, {cha = 18} = {}) => {
	const state = new CharacterSheetState();
	state._data.abilities.cha = cha;
	state.addClass({
		name: "Illrigger",
		source: "IllriggerRevised",
		level,
		subclass: {name: "Hellspeaker", shortName: "Hellspeaker", source: "IllriggerRevised"},
	});
	if (state.applyClassFeatureEffects) state.applyClassFeatureEffects();
	return state;
};

// ==========================================================================
// spendSeal — the no-placement seal cost (#9 Red Cant consumes this).
// ==========================================================================
describe("spendSeal — expend seals without placing them", () => {
	it("decrements available seals and returns the amount spent (no placement)", () => {
		const state = buildIllrigger(13);
		const before = state.getSealsAvailable();
		expect(before).toBeGreaterThan(0);

		const spent = state.spendSeal(1);
		expect(spent).toBe(1);
		expect(state.getSealsAvailable()).toBe(before - 1);
		// Crucially, no creature placement is created — Red Cant is a bare cost.
		expect(state.getSealPlacements()).toHaveLength(0);
	});

	it("clamps to the seals available and returns the real amount spent", () => {
		const state = buildIllrigger(13);
		const avail = state.getSealsAvailable();
		const spent = state.spendSeal(avail + 5);
		expect(spent).toBe(avail);
		expect(state.getSealsAvailable()).toBe(0);
	});

	it("returns 0 and is a no-op when no seals remain", () => {
		const state = buildIllrigger(13);
		state.spendSeal(state.getSealsAvailable());
		expect(state.getSealsAvailable()).toBe(0);
		expect(state.spendSeal(1)).toBe(0);
		expect(state.getSealsAvailable()).toBe(0);
	});
});

// ==========================================================================
// #9 Red Cant — the boon's seal-expending activation.
// ==========================================================================
describe("#9 Red Cant — activation expends a seal", () => {
	it("spends exactly one seal and reports the roll floor", () => {
		const state = buildIllrigger(13);
		const before = state.getSealsAvailable();
		const calcs = state.getFeatureCalculations();
		expect(calcs.hasRedCant).toBe(true);
		expect(calcs.redCantFloor).toBe(10);

		const res = state.applyInterdictBoonActivation("Red Cant", calcs);
		expect(res).toBeTruthy();
		expect(res.label).toMatch(/10/);
		expect(state.getSealsAvailable()).toBe(before - 1);
		// A bare cost — never a creature placement.
		expect(state.getSealPlacements()).toHaveLength(0);
	});

	it("canApply gates on seals remaining", () => {
		const state = buildIllrigger(13);
		expect(state.canApplyInterdictBoonActivation("Red Cant")).toBe(true);
		state.spendSeal(state.getSealsAvailable());
		expect(state.canApplyInterdictBoonActivation("Red Cant")).toBe(false);
		// And the activation refuses to over-spend.
		expect(state.applyInterdictBoonActivation("Red Cant")).toBeNull();
	});
});

// ==========================================================================
// #10 Slippery Ploy — activation now PLACES a real, tracked seal.
// ==========================================================================
describe("#10 Slippery Ploy — places a real seal on the attacker", () => {
	it("creates a tracked placement on the supplied target and spends a seal", () => {
		const state = buildIllrigger(13);
		const before = state.getSealsAvailable();
		expect(state.getSealPlacements()).toHaveLength(0);

		const res = state.applyInterdictBoonActivation("Slippery Ploy", null, {target: "Goblin Archer"});
		expect(res).toBeTruthy();
		expect(res.placement).toBeTruthy();
		expect(res.placement.target).toBe("Goblin Archer");
		expect(res.label).toMatch(/Goblin Archer/);

		// A real placement now exists and the creature is interdicted.
		const placements = state.getSealPlacements();
		expect(placements).toHaveLength(1);
		expect(placements[0].target).toBe("Goblin Archer");
		expect(placements[0].count).toBe(1);
		expect(state.isInterdicted("Goblin Archer")).toBe(true);
		// One seal left the pool to fund the placement.
		expect(state.getSealsAvailable()).toBe(before - 1);
	});

	it("defaults to a generic target label when none is supplied (headless callers)", () => {
		const state = buildIllrigger(13);
		const res = state.applyInterdictBoonActivation("Slippery Ploy");
		expect(res).toBeTruthy();
		expect(res.placement.target).toBe("Attacker");
		expect(state.isInterdicted("Attacker")).toBe(true);
	});

	it("surfaces the Charisma save DC in the activation label", () => {
		const state = buildIllrigger(13);
		const calcs = state.getFeatureCalculations();
		const res = state.applyInterdictBoonActivation("Slippery Ploy", calcs, {target: "Ogre"});
		expect(res.label).toMatch(new RegExp(`DC ${calcs.interdictDc}\\b`));
	});

	it("canApply gates on seals remaining", () => {
		const state = buildIllrigger(13);
		expect(state.canApplyInterdictBoonActivation("Slippery Ploy")).toBe(true);
		state.spendSeal(state.getSealsAvailable());
		expect(state.canApplyInterdictBoonActivation("Slippery Ploy")).toBe(false);
		expect(state.applyInterdictBoonActivation("Slippery Ploy", null, {target: "Goblin"})).toBeNull();
		expect(state.getSealPlacements()).toHaveLength(0);
	});
});

// ==========================================================================
// #12 Hellsight — invoke→truesight-60 / end→0 lifecycle via getSenses().
// ==========================================================================
describe("#12 Hellsight — truesight lifecycle through getSenses()", () => {
	it("invoking grants truesight 60 and ending removes it", () => {
		const state = buildIllrigger(13);
		expect(state.getSenses().truesight).toBe(0);

		state.activateState("hellsight");
		expect(state.getSenses().truesight).toBe(60);

		state.deactivateState("hellsight");
		expect(state.getSenses().truesight).toBe(0);
	});

	it("ending Hellsight does not strip a truesight granted by another source", () => {
		const state = buildIllrigger(13);
		state._data.senses = {...(state._data.senses || {}), truesight: 30};
		state.activateState("hellsight");
		// State's 60 wins over the innate 30 while active.
		expect(state.getSenses().truesight).toBe(60);
		state.deactivateState("hellsight");
		// Falls back to the innate 30, not 0.
		expect(state.getSenses().truesight).toBe(30);
	});
});
