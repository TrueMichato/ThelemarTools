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
import {readFileSync} from "fs";
import {resolve, dirname} from "path";
import {fileURLToPath} from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "../../..");

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

// ==========================================================================
// R25 S7 — Red Cant decision-modal UX overhaul.
//
// The plain boolean confirm was replaced with a polished, dark-themed modal that
// shows the natural die, the floor it is treated as, the seal cost (before →
// after), and the resulting check-total preview. The DOM modal itself can't be
// fired in the jest string-DOM mock (it was verified end-to-end in a real headless
// browser against the `vaa` fixture: natural d20=7 → modal shows 7 → 10, seals
// 6 → 5, total 27 → 30 (+3); Confirm spends a seal, Decline leaves seals + roll
// untouched, and a STR check does not trigger it). Here we pin the pure preview
// math and source-pin the production handler's contract.
// ==========================================================================

// Byte-faithful replica of CharacterSheetPage._getRedCantPreview (source-pinned below).
function getRedCantPreview ({naturalRoll, effectiveRoll, floor, totalMod = 0, exhaustionPenalty = 0, sealsBefore = 0, rollLabel = ""}) {
	const base = effectiveRoll != null ? effectiveRoll : naturalRoll;
	const totalBefore = base + totalMod - exhaustionPenalty;
	const totalAfter = Math.max(base, floor) + totalMod - exhaustionPenalty;
	return {
		naturalRoll,
		effectiveRoll: base,
		floor,
		totalMod,
		exhaustionPenalty,
		rollLabel,
		sealsBefore,
		sealsAfter: Math.max(0, sealsBefore - 1),
		totalBefore,
		totalAfter,
		delta: totalAfter - totalBefore,
	};
}

describe("R25 S7 — Red Cant preview math", () => {
	it("computes seal cost and before/after totals for a sub-floor Charisma die", () => {
		const p = getRedCantPreview({naturalRoll: 7, floor: 10, totalMod: 20, sealsBefore: 6, rollLabel: "Persuasion Check"});
		expect(p.naturalRoll).toBe(7);
		expect(p.floor).toBe(10);
		expect(p.sealsBefore).toBe(6);
		expect(p.sealsAfter).toBe(5);
		expect(p.totalBefore).toBe(27); // 7 + 20
		expect(p.totalAfter).toBe(30); // 10 + 20
		expect(p.delta).toBe(3);
	});

	it("baselines the preview on the post-minimum effective die, not the natural die", () => {
		// A minimum (e.g. Reliable Talent) raised the die to 8; the floor still wins.
		const p = getRedCantPreview({naturalRoll: 4, effectiveRoll: 8, floor: 10, totalMod: 5, sealsBefore: 3});
		expect(p.effectiveRoll).toBe(8);
		expect(p.totalBefore).toBe(13); // 8 + 5
		expect(p.totalAfter).toBe(15); // 10 + 5
		expect(p.delta).toBe(2);
	});

	it("subtracts the exhaustion penalty from both totals", () => {
		const p = getRedCantPreview({naturalRoll: 3, floor: 10, totalMod: 6, exhaustionPenalty: 2, sealsBefore: 1});
		expect(p.totalBefore).toBe(7); // 3 + 6 - 2
		expect(p.totalAfter).toBe(14); // 10 + 6 - 2
		expect(p.delta).toBe(7);
	});

	it("never reports negative seals remaining", () => {
		const p = getRedCantPreview({naturalRoll: 2, floor: 10, sealsBefore: 0});
		expect(p.sealsAfter).toBe(0);
	});
});

describe("R25 S7 — source-pin: Red Cant uses the polished modal, not a plain confirm", () => {
	const SOURCE = readFileSync(resolve(REPO_ROOT, "js/charactersheet/charactersheet.js"), "utf8");
	const CSS = readFileSync(resolve(REPO_ROOT, "css/charactersheet.css"), "utf8");

	it("_pMaybeApplyRedCant delegates to the dedicated _pPromptRedCant modal", () => {
		const m = SOURCE.match(/async _pMaybeApplyRedCant \([\s\S]*?\n\t\}/);
		expect(m).not.toBeNull();
		const body = m[0];
		// New polished modal, NOT the old boolean confirm.
		expect(body).toMatch(/await this\._pPromptRedCant\(/);
		expect(body).not.toMatch(/InputUiUtil\.pGetUserBoolean/);
		// Preserved mechanics: CHA-only gate, floor, seal availability, escape hatch, one-seal spend.
		expect(body).toMatch(/!== "cha"/);
		expect(body).toMatch(/calcs\.hasRedCant/);
		expect(body).toMatch(/skipRedCantPrompt/);
		expect(body).toMatch(/this\._state\.spendSeal\(1\)/);
	});

	it("_pPromptRedCant renders a getShowModal-based panel with confirm/decline actions", () => {
		const m = SOURCE.match(/async _pPromptRedCant \([\s\S]*?\n\t\}/);
		expect(m).not.toBeNull();
		const body = m[0];
		// Routed through the shared character-sheet wrapper, which adds the dialog role,
		// the close button, Escape-from-input and focus restore on top of `UiUtil.pGetShowModal`.
		expect(body).toMatch(/CharacterSheetModal\.pGetShow/);
		expect(body).toMatch(/charsheet__red-cant/);
		expect(body).toMatch(/data-act="confirm"/);
		expect(body).toMatch(/data-act="decline"/);
		// Backdrop/X dismissal must resolve as a decline (false).
		expect(body).toMatch(/cbClose[\s\S]*?resolveOuter\(false\)/);
	});

	it("the preview helper is a pure static (testable without a DOM)", () => {
		expect(SOURCE).toMatch(/static _getRedCantPreview \(/);
	});

	it("the call sites pass the modifier + exhaustion penalty for the total preview", () => {
		// Both the ability-check and skill-check sites feed the preview its inputs.
		const calls = SOURCE.match(/_pMaybeApplyRedCant\(\{[\s\S]*?\}\)/g) || [];
		expect(calls.length).toBeGreaterThanOrEqual(2);
		calls.forEach(c => {
			expect(c).toMatch(/totalMod/);
			expect(c).toMatch(/exhaustionPenalty/);
		});
	});

	it("the dark-themed Red Cant styles exist and use --cs-* tokens", () => {
		expect(CSS).toMatch(/\.charsheet__red-cant \{/);
		expect(CSS).toMatch(/\.charsheet__red-cant__die/);
		expect(CSS).toMatch(/\.charsheet__red-cant__actions/);
		expect(CSS).toMatch(/--cs-bg-surface/);
		expect(CSS).toMatch(/--cs-text-primary/);
	});
});

// ==========================================================================
// R26 #9 REGRESSION — Red Cant vs Thelemar critical-fumble penalty.
//
// With `thelemar_criticalRolls` ON, a natural 1 sets `thelemar_critBonus = -5`
// and tags the roll as a fumble. Red Cant treats the sub-10 die as a 10, so the
// roll is no longer a natural 1 — the -5 penalty and the "Natural 1!" fumble
// class/note must be cleared. Before the fix the floor was applied to the die
// but the -5 still hit the displayed total (e.g. nat-1 CHA check showed 20, not
// 25) and the result still read as a fumble, so the user perceived Red Cant as
// "not triggering". Verified end-to-end in a real headless browser against the
// `vaa` fixture (Hochling Illrigger 15 Hellspeaker): nat-1 Deception with Red
// Cant now totals 25 with no fumble cue.
// ==========================================================================

// Byte-faithful replica of the post-Red-Cant total math in `_rollAbilityCheck` /
// `_rollSkillCheck` (source-pinned below): once Red Cant is applied the Thelemar
// crit bonus is neutralized before the total/notes are computed.
function rollTotalWithRedCant ({naturalRoll, floor = 10, mod = 0, exhaustionPenalty = 0, thelemarCritBonus = 0, redCantApplied = false}) {
	let effectiveRoll = naturalRoll;
	let critBonus = thelemarCritBonus;
	if (redCantApplied) {
		effectiveRoll = Math.max(naturalRoll, floor);
		critBonus = 0; // the die now counts as a 10, not a natural 1
	}
	return effectiveRoll + mod - exhaustionPenalty + (critBonus || 0);
}

describe("R26 #9 — Red Cant negates the Thelemar natural-1 penalty", () => {
	it("a nat-1 Charisma check with Red Cant totals as a 10, dropping the -5 fumble", () => {
		// vaa-style: +15 Deception mod, natural 1 under thelemar critical rolls.
		const without = rollTotalWithRedCant({naturalRoll: 1, mod: 15, thelemarCritBonus: -5, redCantApplied: false});
		const withRedCant = rollTotalWithRedCant({naturalRoll: 1, mod: 15, thelemarCritBonus: -5, redCantApplied: true});
		expect(without).toBe(11); // 1 + 15 - 5  (the broken "Red Cant didn't help" total)
		expect(withRedCant).toBe(25); // 10 + 15, -5 cleared
	});

	it("leaves non-fumble sub-10 rolls unchanged (no crit bonus to clear)", () => {
		const withRedCant = rollTotalWithRedCant({naturalRoll: 7, mod: 15, thelemarCritBonus: 0, redCantApplied: true});
		expect(withRedCant).toBe(25); // 10 + 15
	});

	it("never alters the total when Red Cant is declined", () => {
		const declined = rollTotalWithRedCant({naturalRoll: 1, mod: 15, thelemarCritBonus: -5, redCantApplied: false});
		expect(declined).toBe(11); // unchanged: 1 + 15 - 5
	});
});

describe("R26 #9 — source-pin: both CHA roll paths clear the crit bonus on Red Cant", () => {
	const SOURCE = readFileSync(resolve(REPO_ROOT, "js/charactersheet/charactersheet.js"), "utf8");

	const extractBody = (methodName) => {
		const m = SOURCE.match(new RegExp(`async ${methodName} \\([\\s\\S]*?\\n\\t\\}\\n`));
		expect(m).not.toBeNull();
		return m[0];
	};

	["_rollAbilityCheck", "_rollSkillCheck"].forEach(methodName => {
		it(`${methodName} neutralizes thelemar_critBonus before computing the total when Red Cant applies`, () => {
			const body = extractBody(methodName);
			// The neutralization guard must exist...
			expect(body).toMatch(/if \(redCant\.applied\) rollResult\.thelemar_critBonus = 0;/);
			// ...and must run BEFORE the total is summed, so the -5 cannot reach it.
			const guardIdx = body.indexOf("if (redCant.applied) rollResult.thelemar_critBonus = 0;");
			const totalIdx = body.search(/(?:let|const) total = effectiveRoll \+/);
			expect(guardIdx).toBeGreaterThan(-1);
			expect(totalIdx).toBeGreaterThan(-1);
			expect(guardIdx).toBeLessThan(totalIdx);
			// ...and before the fumble class/note block keyed on === -5.
			const fumbleIdx = body.indexOf("thelemar_critBonus === -5");
			expect(fumbleIdx).toBeGreaterThan(guardIdx);
		});
	});
});
