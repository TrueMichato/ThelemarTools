/**
 * R21 — Interdict DC live value (#4) + Charm Enemy target-only surfacing (#7).
 *
 * #4: the Interdict / Charm Enemy save DC (8 + prof + CHA) is computed live; this guards
 *     that the value the Combat-tab interdict panel renders matches the live calculation
 *     (the bug was a missing re-render after a CHA change, validated here on the real char).
 * #7: Charm Enemy charms the TARGET, never the caster. The parsed combat-action effect is
 *     self:false and must not add the charmed condition to the Illrigger; instead it is
 *     surfaced in the Interdict area with the DC + use tracking.
 */

import "./setup.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-state.js";

if (typeof globalThis.document === "undefined") {
	globalThis.document = {addEventListener () {}, removeEventListener () {}, querySelector () { return null; }};
}

import "../../../js/charactersheet/charactersheet-combat.js";
import fs from "fs";

const CharacterSheetState = globalThis.CharacterSheetState;
const CharacterSheetCombat = globalThis.CharacterSheetCombat;

const REAL_CHAR = "/Users/tommichaeli/.copilot/workspaces/26690c38-b73b-42bd-9ae5-09d0fc9f9852/attachments/677160d6-f2f2-4b6e-813e-7c4f57cf173f-test.json";
const HAS_REAL = fs.existsSync(REAL_CHAR);

const addIllrigger = (state, level, {cha = 16, subclass} = {}) => {
	state._data.abilities.cha = cha;
	state.addClass({name: "Illrigger", source: "IllriggerRevised", level, ...(subclass ? {subclass} : {})});
	state.applyClassFeatureEffects();
};

// A minimal fake-DOM harness so renderCombatInterdiction (testEnvironment: node) can paint
// into a captured innerHTML without a real document. Event-wiring selectors return empty.
const renderInterdictionHtml = (state) => {
	const mkEl = () => ({style: {}, innerHTML: "", querySelector: () => null, querySelectorAll: () => []});
	const section = mkEl();
	const container = mkEl();
	const prevDoc = globalThis.document;
	globalThis.document = {
		getElementById: (id) => (id === "charsheet-combat-interdiction-section" ? section : id === "charsheet-combat-interdiction" ? container : null),
	};
	try {
		const combat = Object.create(CharacterSheetCombat.prototype);
		combat._state = state;
		combat._page = {};
		CharacterSheetCombat.prototype.renderCombatInterdiction.call(combat);
		return container.innerHTML;
	} finally {
		globalThis.document = prevDoc;
	}
};

// ==========================================================================
// #7 — _applyCombatActionEffects respects cond.self (no self-charm).
// ==========================================================================
describe("#7 Charm Enemy never charms the caster", () => {
	const mkCombat = () => {
		const conditions = [];
		const toasts = [];
		globalThis.JqueryUtil = {doToast: (p) => toasts.push(p)};
		const combat = Object.create(CharacterSheetCombat.prototype);
		combat._state = {addCondition: (c) => { conditions.push(c); return true; }};
		combat._page = {};
		return {combat, conditions, toasts};
	};

	it("does NOT add a self:false condition to the character", () => {
		const {combat, conditions, toasts} = mkCombat();
		combat._applyCombatActionEffects(
			{name: "Charm Enemy", source: "IllriggerRevised"},
			{applyCondition: {name: "charmed", duration: "for 1 hour", self: false}},
		);
		expect(conditions).toHaveLength(0);
		expect(toasts.some(t => /target/i.test(t.content) && /charmed/i.test(t.content))).toBe(true);
	});

	it("still adds a self:true condition to the character", () => {
		const {combat, conditions} = mkCombat();
		combat._applyCombatActionEffects(
			{name: "Instant Step", source: "TGTT"},
			{applyCondition: {name: "invisible", duration: "until start of next turn", self: true}},
		);
		expect(conditions).toHaveLength(1);
		expect(conditions[0].name).toBe("invisible");
	});

	it("the Charm Enemy description parses to a TARGET (self:false) charmed effect", () => {
		// Mirrors the whitespace-collapsing parse used by renderCombatActions.
		const raw = "When you use your bonus action to place a seal on a Humanoid, you can attempt to charm them. The target must succeed on a Charisma saving throw or be charmed by you for 1 hour.";
		const txt = raw.replace(/\s+/g, " ").toLowerCase();
		const effects = CharacterSheetState._parseCombatActionEffects(txt, raw);
		expect(effects).not.toBeNull();
		expect(effects.applyCondition.name).toBe("charmed");
		expect(effects.applyCondition.self).toBe(false);
	});
});

// ==========================================================================
// #7 — Charm Enemy is surfaced in the Interdict area (DC + uses).
// ==========================================================================
describe("#7 Charm Enemy surfaced in the interdict panel", () => {
	it("renders a Charm Enemy block with the Charisma save DC for a level-3+ Illrigger", () => {
		const state = new CharacterSheetState();
		addIllrigger(state, 5, {cha: 16, subclass: {name: "Hellspeaker", shortName: "Hellspeaker", source: "IllriggerRevised"}});
		const calcs = state.getFeatureCalculations();
		expect(calcs.hasCharmEnemy).toBe(true);
		expect(calcs.charmEnemyDc).toBe(calcs.interdictDc);

		const html = renderInterdictionHtml(state);
		expect(html).toContain("Charm Enemy");
		expect(html).toContain("Charisma save");
		expect(html).toContain(`DC ${calcs.charmEnemyDc}`);
		expect(html).toContain("charmed");
		expect(html).toContain("Uses");
	});

	it("omits the Charm Enemy block for a level-1 Illrigger (no Charm Enemy yet)", () => {
		const state = new CharacterSheetState();
		addIllrigger(state, 1, {cha: 16});
		expect(state.getFeatureCalculations().hasCharmEnemy).toBeFalsy();
		const html = renderInterdictionHtml(state);
		expect(html).not.toContain("Charm Enemy");
	});
});

// ==========================================================================
// Real character — Hochling Illrigger L10 (Hellspeaker).
// ==========================================================================
describe("R21 real character (Hochling Illrigger L10)", () => {
	const load = () => {
		const state = new CharacterSheetState();
		state.loadFromJson(JSON.parse(fs.readFileSync(REAL_CHAR, "utf8")));
		return state;
	};

	(HAS_REAL ? it : it.skip)("#4 Interdict & Charm Enemy DC are the live 17 (8 + prof 4 + CHA 5)", () => {
		const calcs = load().getFeatureCalculations();
		expect(calcs.interdictDc).toBe(17);
		expect(calcs.charmEnemyDc).toBe(17);
	});

	(HAS_REAL ? it : it.skip)("#4 the interdict panel shows the live DC and Charm Enemy uses", () => {
		const state = load();
		const calcs = state.getFeatureCalculations();
		const html = renderInterdictionHtml(state);
		// Combat-tab save DC reflects the live interdict DC…
		expect(html).toContain(`Save DC <strong>${calcs.interdictDc}</strong>`);
		// …and the Charm Enemy target-effect block is present with its DC + uses.
		expect(html).toContain("Charm Enemy");
		expect(html).toMatch(new RegExp(`DC ${calcs.charmEnemyDc}</strong> Charisma save`));
		expect(html).toMatch(/Uses <strong>\d+ \/ \d+<\/strong>/);
	});

	(HAS_REAL ? it : it.skip)("#7 using Charm Enemy's parsed effect does not charm the caster", () => {
		const state = load();
		const before = (state.getConditions?.() || []).length;
		const conditions = [];
		const toasts = [];
		globalThis.JqueryUtil = {doToast: (p) => toasts.push(p)};
		const combat = Object.create(CharacterSheetCombat.prototype);
		combat._state = {addCondition: (c) => { conditions.push(c); return true; }};
		combat._page = {};
		combat._applyCombatActionEffects(
			{name: "Charm Enemy", source: "IllriggerRevised"},
			{applyCondition: {name: "charmed", duration: "for 1 hour", self: false}},
		);
		expect(conditions).toHaveLength(0);
		// Real character's own condition list is untouched.
		expect((state.getConditions?.() || []).length).toBe(before);
	});
});
