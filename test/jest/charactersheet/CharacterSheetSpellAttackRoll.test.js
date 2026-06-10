/**
 * Bug #3b — Combat-tab "Spell Attack" badge quick-roll.
 *
 * The spell-attack badge (#charsheet-combat-spell-attack) must roll d20 + the
 * character's spell attack bonus, mirroring the weapon `_rollAttack` path:
 * advantage/disadvantage (from active states + shift/ctrl), crit/fumble notes,
 * and the shared `_page.showDiceResult` animation + toast path.
 *
 * These tests drive `_rollSpellAttack` / `_getSpellAttackRollInfo` /
 * `_applySpellAttackRollAffordance` on a `CharacterSheetCombat` prototype shell
 * with mock `_state` + `_page`, so they exercise the real roll logic without the
 * full page bootstrap.
 */

import "./setup.js";
import "../../../js/charactersheet/charactersheet-combat.js";

const CharacterSheetCombat = globalThis.CharacterSheetCombat;

function makePage (forcedRoll) {
	const rollD20Calls = [];
	const diceResults = [];
	return {
		rollD20Calls,
		diceResults,
		// Mirror the real legacy rollD20 path: shift→advantage, ctrl/meta→disadvantage
		// override the passed state mode; otherwise the state mode (or "normal") stands.
		rollD20: ({event, mode, isAttack} = {}) => {
			let m = mode;
			if (event?.shiftKey) m = "advantage";
			else if (event?.ctrlKey || event?.metaKey) m = "disadvantage";
			m = m || "normal";
			rollD20Calls.push({event, mode: m, isAttack});
			return {roll: forcedRoll, roll1: forcedRoll, roll2: forcedRoll, mode: m, thelemar_critBonus: 0};
		},
		getModeLabel: (mode) => mode === "advantage" ? " (Advantage)" : mode === "disadvantage" ? " (Disadvantage)" : "",
		formatD20Breakdown: (rollResult, modifier) => `1d20 (${rollResult.roll}) + ${modifier}`,
		showDiceResult: (opts) => { diceResults.push(opts); },
	};
}

function makeState (overrides = {}) {
	return {
		getFeatureCalculations: () => ({}),
		getSpellcastingClassBreakdown: () => [],
		getSpellAttackBonus: () => 5,
		hasAdvantageFromStates: () => false,
		hasDisadvantageFromStates: () => false,
		getBonusFromStates: () => 0,
		getCriticalRange: () => 20,
		...overrides,
	};
}

function makeCombat (state, page) {
	const combat = Object.create(CharacterSheetCombat.prototype);
	combat._state = state;
	combat._page = page;
	return combat;
}

// Lightweight stand-in for the badge element (tests run in the node environment;
// jsdom is not installed). Implements only the surface `_applySpellAttackRollAffordance` uses.
function makeFakeEl (initialTitle = "") {
	const classes = new Set();
	const attrs = {};
	return {
		title: initialTitle,
		style: {cursor: ""},
		classList: {
			toggle: (n, force) => { if (force) classes.add(n); else classes.delete(n); },
			remove: (n) => classes.delete(n),
			add: (n) => classes.add(n),
			contains: (n) => classes.has(n),
		},
		setAttribute: (k, v) => { attrs[k] = String(v); },
		removeAttribute: (k) => { delete attrs[k]; },
		getAttribute: (k) => (k in attrs ? attrs[k] : null),
	};
}

describe("Spell-attack quick roll (#3b)", () => {
	describe("_rollSpellAttack — basic roll", () => {
		it("rolls d20 + spell attack bonus and shows the result", () => {
			const page = makePage(12);
			const combat = makeCombat(makeState({getSpellAttackBonus: () => 7}), page);
			const event = {};

			combat._rollSpellAttack(event);

			expect(page.rollD20Calls).toHaveLength(1);
			// Forwards the event (so Shift/Ctrl reach rollD20) and flags it as an attack
			// so the Thelemar Nat1/Nat20 check/save rule never leaks into the breakdown.
			expect(page.rollD20Calls[0].event).toBe(event);
			expect(page.rollD20Calls[0].isAttack).toBe(true);
			expect(page.diceResults).toHaveLength(1);
			const res = page.diceResults[0];
			expect(res.modifier).toBe(7);
			expect(res.total).toBe(19); // 12 + 7
			expect(res.roll).toBe(12);
			expect(res.title).toBe("Spell Attack");
			expect(res.subtitle).toContain("1d20 (12) + 7");
		});

		it("does not double-apply proficiency/ability (uses the getter value verbatim)", () => {
			const page = makePage(10);
			// getSpellAttackBonus already folds prof + ability + item/custom bonuses.
			const combat = makeCombat(makeState({getSpellAttackBonus: () => 4}), page);
			combat._rollSpellAttack({});
			expect(page.diceResults[0].modifier).toBe(4);
		});
	});

	describe("advantage / disadvantage", () => {
		it("honors advantage from active states (attack:spell)", () => {
			const page = makePage(15);
			const combat = makeCombat(makeState({
				hasAdvantageFromStates: (t) => t === "attack:spell",
			}), page);

			combat._rollSpellAttack({});

			expect(page.rollD20Calls[0].mode).toBe("advantage");
			expect(page.diceResults[0].title).toContain("(Advantage)");
		});

		it("honors a generic 'attack' advantage state", () => {
			const page = makePage(15);
			const combat = makeCombat(makeState({
				hasAdvantageFromStates: (t) => t === "attack",
			}), page);
			combat._rollSpellAttack({});
			expect(page.rollD20Calls[0].mode).toBe("advantage");
		});

		it("honors disadvantage from active states", () => {
			const page = makePage(8);
			const combat = makeCombat(makeState({
				hasDisadvantageFromStates: (t) => t === "attack:spell",
			}), page);

			combat._rollSpellAttack({});

			expect(page.rollD20Calls[0].mode).toBe("disadvantage");
			expect(page.diceResults[0].title).toContain("(Disadvantage)");
		});

		it("honors advantage from a Shift-click", () => {
			const page = makePage(15);
			const combat = makeCombat(makeState(), page);
			combat._rollSpellAttack({shiftKey: true});
			expect(page.rollD20Calls[0].mode).toBe("advantage");
		});

		it("honors disadvantage from a Ctrl-click", () => {
			const page = makePage(5);
			const combat = makeCombat(makeState(), page);
			combat._rollSpellAttack({ctrlKey: true});
			expect(page.rollD20Calls[0].mode).toBe("disadvantage");
		});

		it("lets a Shift-click override a disadvantage state (→ advantage)", () => {
			const page = makePage(15);
			const combat = makeCombat(makeState({
				hasDisadvantageFromStates: () => true,
			}), page);
			combat._rollSpellAttack({shiftKey: true});
			expect(page.rollD20Calls[0].mode).toBe("advantage");
		});

		it("lets a Ctrl-click override an advantage state (→ disadvantage)", () => {
			const page = makePage(5);
			const combat = makeCombat(makeState({
				hasAdvantageFromStates: () => true,
			}), page);
			combat._rollSpellAttack({ctrlKey: true});
			expect(page.rollD20Calls[0].mode).toBe("disadvantage");
		});

		it("cancels to normal when state advantage and disadvantage both apply", () => {
			const page = makePage(11);
			const combat = makeCombat(makeState({
				hasAdvantageFromStates: () => true,
				hasDisadvantageFromStates: () => true,
			}), page);
			combat._rollSpellAttack({});
			expect(page.rollD20Calls[0].mode).toBe("normal");
		});
	});

	describe("state numeric attack bonuses", () => {
		it("adds generic + spell-specific 'attack' state bonuses on top of the spell bonus", () => {
			const page = makePage(10);
			const combat = makeCombat(makeState({
				getSpellAttackBonus: () => 6,
				getBonusFromStates: (t) => (t === "attack" ? 2 : t === "attack:spell" ? 1 : 0),
			}), page);

			combat._rollSpellAttack({});

			expect(page.diceResults[0].modifier).toBe(9); // 6 + 2 + 1
			expect(page.diceResults[0].total).toBe(19); // 10 + 9
		});
	});

	describe("crit / fumble notes", () => {
		it("flags a critical hit on a natural 20", () => {
			const page = makePage(20);
			const combat = makeCombat(makeState(), page);
			combat._rollSpellAttack({});
			expect(page.diceResults[0].resultClass).toBe("charsheet__dice-result-total--crit");
			expect(page.diceResults[0].resultNote).toBe("Critical Hit!");
		});

		it("respects an expanded critical range", () => {
			const page = makePage(19);
			const combat = makeCombat(makeState({getCriticalRange: () => 19}), page);
			combat._rollSpellAttack({});
			expect(page.diceResults[0].resultNote).toBe("Critical Hit!");
		});

		it("flags a critical miss on a natural 1", () => {
			const page = makePage(1);
			const combat = makeCombat(makeState(), page);
			combat._rollSpellAttack({});
			expect(page.diceResults[0].resultClass).toBe("charsheet__dice-result-total--fumble");
			expect(page.diceResults[0].resultNote).toBe("Critical Miss!");
		});
	});

	describe("edge cases — no flat roll", () => {
		it("does not roll for Gambler spellcasting (dice formula); toasts instead", () => {
			const page = makePage(10);
			const toasts = [];
			const orig = globalThis.JqueryUtil.doToast;
			const combat = makeCombat(makeState({
				getFeatureCalculations: () => ({hasGamblerSpellcasting: true, gamblerSpellAttackFormula: "1d8"}),
			}), page);

			try {
				globalThis.JqueryUtil.doToast = (t) => toasts.push(t);
				combat._rollSpellAttack({});
			} finally {
				globalThis.JqueryUtil.doToast = orig;
			}

			expect(page.diceResults).toHaveLength(0);
			expect(page.rollD20Calls).toHaveLength(0);
			expect(toasts).toHaveLength(1);
		});

		it("does not roll when multiclass classes disagree (Varies); toasts instead", () => {
			const page = makePage(10);
			const toasts = [];
			const orig = globalThis.JqueryUtil.doToast;
			const combat = makeCombat(makeState({
				getSpellcastingClassBreakdown: () => [
					{className: "Wizard", attackBonus: 7},
					{className: "Cleric", attackBonus: 5},
				],
				getSpellAttackBonus: () => 7,
			}), page);

			try {
				globalThis.JqueryUtil.doToast = (t) => toasts.push(t);
				combat._rollSpellAttack({});
			} finally {
				globalThis.JqueryUtil.doToast = orig;
			}

			expect(page.diceResults).toHaveLength(0);
			expect(toasts).toHaveLength(1);
		});

		it("rolls a single agreed multiclass bonus from the breakdown", () => {
			const page = makePage(10);
			const combat = makeCombat(makeState({
				getSpellcastingClassBreakdown: () => [
					{className: "Wizard", attackBonus: 6},
					{className: "Artificer", attackBonus: 6},
				],
				// Even if the global getter differs, the agreed breakdown value wins.
				getSpellAttackBonus: () => 99,
			}), page);

			combat._rollSpellAttack({});

			expect(page.diceResults).toHaveLength(1);
			expect(page.diceResults[0].modifier).toBe(6);
		});

		it("does not roll when there is no spellcasting ability (null bonus)", () => {
			const page = makePage(10);
			const combat = makeCombat(makeState({getSpellAttackBonus: () => null}), page);
			combat._rollSpellAttack({});
			expect(page.diceResults).toHaveLength(0);
		});
	});

	describe("_getSpellAttackRollInfo", () => {
		it("reports a single-class flat bonus", () => {
			const combat = makeCombat(makeState({getSpellAttackBonus: () => 5}), makePage(10));
			expect(combat._getSpellAttackRollInfo()).toEqual({bonus: 5, varies: false, gambler: false});
		});

		it("reports varies for disagreeing multiclass casters", () => {
			const combat = makeCombat(makeState({
				getSpellcastingClassBreakdown: () => [{attackBonus: 7}, {attackBonus: 5}],
			}), makePage(10));
			expect(combat._getSpellAttackRollInfo()).toEqual({bonus: null, varies: true, gambler: false});
		});

		it("reports gambler when spellcasting uses a dice formula", () => {
			const combat = makeCombat(makeState({
				getFeatureCalculations: () => ({hasGamblerSpellcasting: true}),
			}), makePage(10));
			expect(combat._getSpellAttackRollInfo()).toEqual({bonus: null, varies: false, gambler: true});
		});
	});

	describe("_applySpellAttackRollAffordance", () => {
		let el;
		beforeEach(() => {
			el = makeFakeEl();
		});

		it("makes the badge interactive when a flat bonus is rollable", () => {
			const combat = makeCombat(makeState({getSpellAttackBonus: () => 5}), makePage(10));
			combat._applySpellAttackRollAffordance(el);
			expect(el.classList.contains("charsheet__spell-attack--clickable")).toBe(true);
			expect(el.getAttribute("role")).toBe("button");
			expect(el.getAttribute("tabindex")).toBe("0");
			expect(el.style.cursor).toBe("pointer");
			expect(el.title).toContain("Roll spell attack");
		});

		it("preserves an existing multiclass breakdown title while adding the roll hint", () => {
			const combat = makeCombat(makeState({
				getSpellcastingClassBreakdown: () => [{className: "Wizard", attackBonus: 6}, {className: "Artificer", attackBonus: 6}],
			}), makePage(10));
			el.title = "Wizard: +6 • Artificer: +6";
			combat._applySpellAttackRollAffordance(el);
			expect(el.title).toContain("Wizard: +6");
			expect(el.title).toContain("Roll spell attack");
		});

		it("removes interactivity when not rollable (Varies)", () => {
			const combat = makeCombat(makeState({
				getSpellcastingClassBreakdown: () => [{attackBonus: 7}, {attackBonus: 5}],
			}), makePage(10));
			el.classList.add("charsheet__spell-attack--clickable");
			el.setAttribute("role", "button");
			el.setAttribute("tabindex", "0");
			el.style.cursor = "pointer";
			combat._applySpellAttackRollAffordance(el);
			expect(el.classList.contains("charsheet__spell-attack--clickable")).toBe(false);
			expect(el.getAttribute("role")).toBeNull();
			expect(el.getAttribute("tabindex")).toBeNull();
			expect(el.style.cursor).toBe("");
		});

		it("clears the roll affordance when a caster becomes non-rollable (rollable → Varies)", () => {
			// Single-class (rollable) first…
			let breakdown = [];
			const state = makeState({
				getSpellAttackBonus: () => 5,
				getSpellcastingClassBreakdown: () => breakdown,
			});
			const combat = makeCombat(state, makePage(10));
			combat._applySpellAttackRollAffordance(el);
			expect(el.classList.contains("charsheet__spell-attack--clickable")).toBe(true);

			// …then multiclass disagreement makes it non-rollable; affordance must clear.
			breakdown = [{attackBonus: 7}, {attackBonus: 5}];
			combat._applySpellAttackRollAffordance(el);
			expect(el.classList.contains("charsheet__spell-attack--clickable")).toBe(false);
			expect(el.style.cursor).toBe("");
		});
	});
});
