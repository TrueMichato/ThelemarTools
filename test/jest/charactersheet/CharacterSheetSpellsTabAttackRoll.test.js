/**
 * Bug #3b (real root cause) — Spells-tab per-class spell-attack quick-roll.
 *
 * The Round-11 fix only wired the Combat-tab badge. The prominent Spells-tab
 * per-class spell-attack value (`.charsheet__spell-attack`) was never made
 * clickable, so users clicking the obvious number saw nothing happen. The fix
 * adds `_applySpellsTabAttackAffordance` (button semantics) + `_rollSpellsTabAttack`
 * (rolls d20 + that class's flat bonus through the shared animated dispatch).
 *
 * These tests drive the affordance + roll logic on a prototype shell with a
 * fake element and mock `_state` / `_page`.
 */

import "./setup.js";
import "../../../js/charactersheet/charactersheet-spells.js";

const CharacterSheetSpells = globalThis.CharacterSheetSpells;

function makeEl () {
	const set = new Set();
	const listeners = {};
	return {
		title: "",
		style: {},
		_attrs: {},
		classList: {
			add: (...c) => c.forEach(x => set.add(x)),
			contains: (c) => set.has(c),
		},
		setAttribute (k, v) { this._attrs[k] = String(v); },
		getAttribute (k) { return this._attrs[k]; },
		addEventListener (type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
		_fire (type, event = {}) { (listeners[type] || []).slice().forEach(fn => fn(event)); },
		_listeners: listeners,
	};
}

function makePage (forcedRoll = 12) {
	const diceResults = [];
	const rollD20Calls = [];
	return {
		diceResults,
		rollD20Calls,
		rollD20: ({event, mode, isAttack} = {}) => {
			let m = mode;
			if (event?.shiftKey) m = "advantage";
			else if (event?.ctrlKey || event?.metaKey) m = "disadvantage";
			m = m || "normal";
			rollD20Calls.push({mode: m, isAttack});
			return {roll: forcedRoll, roll1: forcedRoll, roll2: forcedRoll, mode: m};
		},
		getModeLabel: (mode) => mode === "advantage" ? " (Advantage)" : mode === "disadvantage" ? " (Disadvantage)" : "",
		formatD20Breakdown: (rr, mod) => `1d20 (${rr.roll}) + ${mod}`,
		showDiceResult: (opts) => { diceResults.push(opts); },
	};
}

function makeState (overrides = {}) {
	return {
		hasAdvantageFromStates: () => false,
		hasDisadvantageFromStates: () => false,
		getBonusFromStates: () => 0,
		getCriticalRange: () => 20,
		...overrides,
	};
}

function makeSpells (state, page) {
	const spells = Object.create(CharacterSheetSpells.prototype);
	spells._state = state;
	spells._page = page;
	return spells;
}

describe("_applySpellsTabAttackAffordance (Bug #3b)", () => {
	test("wires button semantics + clickable class for a finite bonus", () => {
		const spells = makeSpells(makeState(), makePage());
		const el = makeEl();
		spells._applySpellsTabAttackAffordance(el, "Wizard", 7);
		expect(el.classList.contains("charsheet__spell-attack--clickable")).toBe(true);
		expect(el.getAttribute("role")).toBe("button");
		expect(el.getAttribute("tabindex")).toBe("0");
		expect(el.style.cursor).toBe("pointer");
		expect(el.title).toMatch(/Roll spell attack/);
	});

	test("no-op when bonus is not finite (multiclass 'varies')", () => {
		const spells = makeSpells(makeState(), makePage());
		const el = makeEl();
		spells._applySpellsTabAttackAffordance(el, "Wizard", NaN);
		expect(el.classList.contains("charsheet__spell-attack--clickable")).toBe(false);
		expect(el.getAttribute("role")).toBeUndefined();
		expect(el._listeners.click).toBeUndefined();
	});

	test("no-op for a null element", () => {
		const spells = makeSpells(makeState(), makePage());
		expect(() => spells._applySpellsTabAttackAffordance(null, "Wizard", 5)).not.toThrow();
	});

	test("a click rolls d20 + the class bonus through showDiceResult", () => {
		const page = makePage(12);
		const spells = makeSpells(makeState(), page);
		const el = makeEl();
		spells._applySpellsTabAttackAffordance(el, "Wizard", 7);
		el._fire("click", {});
		expect(page.rollD20Calls.length).toBe(1);
		expect(page.rollD20Calls[0].isAttack).toBe(true);
		expect(page.diceResults.length).toBe(1);
		const r = page.diceResults[0];
		expect(r.title).toBe("Wizard Spell Attack");
		expect(r.modifier).toBe(7);
		expect(r.total).toBe(19); // 12 + 7
	});

	test("Enter key triggers the roll (keyboard accessible)", () => {
		const page = makePage(8);
		const spells = makeSpells(makeState(), page);
		const el = makeEl();
		spells._applySpellsTabAttackAffordance(el, "Cleric", 5);
		el._fire("keydown", {key: "Enter", preventDefault () {}});
		expect(page.diceResults.length).toBe(1);
		expect(page.diceResults[0].total).toBe(13);
	});
});

describe("_rollSpellsTabAttack", () => {
	test("nat-20 within crit range flags a Critical Hit", () => {
		const page = makePage(20);
		const spells = makeSpells(makeState({getCriticalRange: () => 20}), page);
		spells._rollSpellsTabAttack({}, "Sorcerer", 6);
		expect(page.diceResults[0].resultNote).toBe("Critical Hit!");
	});

	test("nat-1 flags a Critical Miss", () => {
		const page = makePage(1);
		const spells = makeSpells(makeState(), page);
		spells._rollSpellsTabAttack({}, "Sorcerer", 6);
		expect(page.diceResults[0].resultNote).toBe("Critical Miss!");
	});

	test("active-state advantage feeds the roll mode and label", () => {
		const page = makePage(15);
		const spells = makeSpells(makeState({hasAdvantageFromStates: (k) => k === "attack:spell"}), page);
		spells._rollSpellsTabAttack({}, "Warlock", 9);
		expect(page.rollD20Calls[0].mode).toBe("advantage");
		expect(page.diceResults[0].title).toBe("Warlock Spell Attack (Advantage)");
	});

	test("state attack bonuses stack on top of the class bonus", () => {
		const page = makePage(10);
		const spells = makeSpells(makeState({getBonusFromStates: (k) => k === "attack" ? 2 : 0}), page);
		spells._rollSpellsTabAttack({}, "Wizard", 7);
		expect(page.diceResults[0].modifier).toBe(9); // 7 + 2
		expect(page.diceResults[0].total).toBe(19); // 10 + 9
	});

	test("no-op for a non-finite bonus", () => {
		const page = makePage(10);
		const spells = makeSpells(makeState(), page);
		spells._rollSpellsTabAttack({}, "Wizard", NaN);
		expect(page.diceResults.length).toBe(0);
	});
});
