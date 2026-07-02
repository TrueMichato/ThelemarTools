/**
 * Character Sheet — World Tree Vitality combat UI (R40 #8)
 *
 * Drives the REAL `renderCombatVitality()` combat-tab renderer and the `_rollLifeGivingForce`
 * dice helper (no live DOM — a document stub of `e_` elements, matching the pattern used by
 * other combat renderer tests). Asserts:
 *  - The section is hidden for a character without Vitality of the Tree.
 *  - A World Tree barbarian sees the Vitality Surge summary (Temp HP = barbarian level).
 *  - The Life-Giving Force roller/reminder only appears while Rage is active, and shows Xd6
 *    where X is the Rage Damage bonus.
 *  - `_rollLifeGivingForce(X)` rolls exactly X d6 and sums them.
 */

import "./setup.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-state.js";

// charactersheet-combat.js wires document listeners at construction; provide a minimal
// document so the module imports cleanly (overridden per-test).
if (typeof globalThis.document === "undefined") {
	globalThis.document = {addEventListener () {}, removeEventListener () {}, querySelector () { return null; }};
}

import "../../../js/charactersheet/charactersheet-combat.js";

const CharacterSheetState = globalThis.CharacterSheetState;
const CharacterSheetCombat = globalThis.CharacterSheetCombat;

/** getElementById returns a fresh `e_` stub per id (innerHTML/style are readable). */
const makeDocStub = () => {
	const els = new Map();
	return {
		_els: els,
		getElementById (id) {
			if (!els.has(id)) els.set(id, globalThis.e_({outer: `<div></div>`}));
			return els.get(id);
		},
		addEventListener () {},
		removeEventListener () {},
		querySelector () { return null; },
	};
};

function makeWorldTreeCombat (level, {rageActive = false} = {}) {
	const state = new CharacterSheetState();
	state.setRace({name: "Human", source: "XPHB"});
	state.addClass({
		name: "Barbarian",
		source: "XPHB",
		level,
		subclass: {name: "Path of the World Tree", shortName: "World Tree", source: "XPHB"},
	});
	state.setAbilityBase("str", 16);
	state.setAbilityBase("con", 15);
	if (rageActive) state.activateState("rage");

	const combat = Object.create(CharacterSheetCombat.prototype);
	combat._state = state;
	combat._page = {rollDice: (n, sides) => n * sides}; // deterministic stub
	return {state, combat};
}

function sectionHtml (combat, doc) {
	globalThis.document = doc;
	combat.renderCombatVitality();
	return {
		section: doc.getElementById("charsheet-combat-vitality-section"),
		container: doc.getElementById("charsheet-combat-vitality"),
	};
}

describe("renderCombatVitality — visibility gate", () => {
	it("hides the section for a non-World-Tree character", () => {
		const state = new CharacterSheetState();
		state.addClass({name: "Barbarian", source: "XPHB", level: 6, subclass: {name: "Path of the Berserker", source: "XPHB"}});
		const combat = Object.create(CharacterSheetCombat.prototype);
		combat._state = state;
		combat._page = {rollDice: () => 0};
		const doc = makeDocStub();
		const {section, container} = sectionHtml(combat, doc);
		expect(section.style.display).toBe("none");
		expect(container.innerHTML).toBe("");
	});

	it("shows the section for a World Tree barbarian (L3+)", () => {
		const {combat} = makeWorldTreeCombat(6);
		const {section, container} = sectionHtml(combat, makeDocStub());
		expect(section.style.display).not.toBe("none");
		expect(container.innerHTML).toContain("Vitality Surge");
	});
});

describe("renderCombatVitality — Vitality Surge summary", () => {
	it("states Temp HP equal to the barbarian level", () => {
		const {combat} = makeWorldTreeCombat(6);
		const {container} = sectionHtml(combat, makeDocStub());
		// Surge value == barbarian level (6), rendered in the summary.
		expect(container.innerHTML).toContain("Barbarian level (6)");
	});
});

describe("renderCombatVitality — Life-Giving Force reminder/roller", () => {
	it("does not show the round-start reminder or roll button when not raging", () => {
		const {combat} = makeWorldTreeCombat(6, {rageActive: false});
		const {container} = sectionHtml(combat, makeDocStub());
		expect(container.innerHTML).not.toContain("charsheet__combat-vitality-roll");
		expect(container.innerHTML).toContain("Activate Rage to use");
	});

	it("shows the reminder and an Xd6 roll button while raging (2d6 at L6)", () => {
		const {combat} = makeWorldTreeCombat(6, {rageActive: true});
		const {container} = sectionHtml(combat, makeDocStub());
		expect(container.innerHTML).toContain("charsheet__combat-vitality-roll");
		expect(container.innerHTML).toContain("2d6");
		expect(container.innerHTML).toContain("Round-start reminder");
		expect(container.innerHTML.toLowerCase()).toContain("vanish");
	});

	it("shows 4d6 while raging at L16", () => {
		const {combat} = makeWorldTreeCombat(16, {rageActive: true});
		const {container} = sectionHtml(combat, makeDocStub());
		expect(container.innerHTML).toContain("4d6");
	});
});

describe("_rollLifeGivingForce — Xd6 dice math", () => {
	it("rolls exactly X d6 and sums them", () => {
		const combat = Object.create(CharacterSheetCombat.prototype);
		const calls = [];
		combat._page = {rollDice: (n, sides) => { calls.push([n, sides]); return 4; }};

		const res = combat._rollLifeGivingForce(3);
		expect(calls).toHaveLength(3); // exactly rageDamage rolls
		expect(calls.every(([n, sides]) => n === 1 && sides === 6)).toBe(true); // each a single d6
		expect(res.rolls).toEqual([4, 4, 4]);
		expect(res.total).toBe(12);
	});

	it("rolls nothing for a zero bonus", () => {
		const combat = Object.create(CharacterSheetCombat.prototype);
		combat._page = {rollDice: () => 6};
		const res = combat._rollLifeGivingForce(0);
		expect(res.rolls).toEqual([]);
		expect(res.total).toBe(0);
	});
});
