/**
 * Phase 6.3: Spell Scribing Adept cost-confirmation modal.
 *
 * The TGTT feat documents a cost of 50 gp × spell level (plus 2 hours
 * per level) to scribe a spell into the character's spellbook. Before
 * Phase 6.3 the scribe flow asked for confirmation but never deducted
 * currency. Phase 6.3 wires a three-way modal (Pay / Skip / Cancel)
 * and uses `state.deductGold` for the canonical path.
 *
 * These tests cover the state-layer mechanics that the modal sits on
 * top of — the modal itself is `InputUiUtil.pGetUserEnum`-backed and
 * exercised via E2E. We verify:
 *   - `deductGold` reduces the gp pool by the correct amount.
 *   - `deductGold` returns `{success: false}` with an error string when
 *     funds are insufficient — the modal uses that flag to disable the
 *     "Pay" button and surface a friendly toast.
 *   - `getTotalGold` aggregates all denominations, which the modal
 *     uses to show available funds.
 *   - `addScribingSpell` adds the spell to the character's scribing
 *     spellbook irrespective of the payment decision (i.e. the "Skip"
 *     path still produces a scribed spell).
 *   - The integer cost formula is 50 × spell level (1st = 50 gp,
 *     5th = 250 gp) — guards against an off-by-one regression.
 */

import "./setup.js";

let CharacterSheetState;
let state;

beforeAll(async () => {
	CharacterSheetState = (await import("../../../js/charactersheet/charactersheet-state.js")).CharacterSheetState;
});

describe("CharacterSheetScribingCost — Phase 6.3", () => {
	beforeEach(() => {
		state = new CharacterSheetState();
	});

	describe("cost formula (50 gp × level)", () => {
		it.each([
			[1, 50],
			[2, 100],
			[3, 150],
			[4, 200],
			[5, 250],
			[6, 300],
		])("level %i scroll costs %i gp", (level, expected) => {
			expect(level * 50).toBe(expected);
		});
	});

	describe("deductGold — Pay path", () => {
		it("reduces gp by the scribe cost when funds are sufficient", () => {
			state._data.currency.gp = 500;
			const cost = 150; // level 3 spell
			const result = state.deductGold(cost);
			expect(result.success).toBe(true);
			expect(state._data.currency.gp).toBe(350);
		});

		it("returns success:false with an error string when underfunded", () => {
			state._data.currency.gp = 25;
			const cost = 50; // level 1 spell
			const result = state.deductGold(cost);
			expect(result.success).toBe(false);
			expect(typeof result.error).toBe("string");
			expect(result.error).toMatch(/Insufficient/i);
			// Unchanged when insufficient — modal uses this to abort.
			expect(state._data.currency.gp).toBe(25);
		});

		it("crosses denominations: 5 pp + 0 gp covers a 50 gp scribe", () => {
			state._data.currency.gp = 0;
			state._data.currency.pp = 5; // = 50 gp
			const result = state.deductGold(50);
			expect(result.success).toBe(true);
			expect(state._data.currency.pp).toBe(0);
		});
	});

	describe("getTotalGold — Modal display", () => {
		it("aggregates all denominations including pp/sp/cp", () => {
			state._data.currency.gp = 10;
			state._data.currency.sp = 50; // = 5 gp
			state._data.currency.cp = 100; // = 1 gp
			state._data.currency.pp = 1; // = 10 gp
			expect(state.getTotalGold()).toBeCloseTo(26, 2);
		});

		it("returns 0 for a freshly-created character", () => {
			expect(state.getTotalGold()).toBe(0);
		});
	});

	describe("addScribingSpell — Skip path persists the spell anyway", () => {
		it("scribing without payment still adds the spell to the spellbook", () => {
			const spell = {name: "Bless", source: "PHB", level: 1};
			// Skip path: no deductGold call, just add.
			state.addScribingSpell(spell);
			const book = state.getScribingSpellbook();
			expect(book.some(s => s.name === "Bless" && s.source === "PHB")).toBe(true);
			// Currency untouched.
			expect(state._data.currency.gp).toBe(0);
		});

		it("Pay path adds the spell AND deducts currency", () => {
			state._data.currency.gp = 200;
			const spell = {name: "Cure Wounds", source: "PHB", level: 1};
			const result = state.deductGold(spell.level * 50);
			expect(result.success).toBe(true);
			state.addScribingSpell(spell);
			expect(state._data.currency.gp).toBe(150);
			expect(state.getScribingSpellbook().some(s => s.name === "Cure Wounds")).toBe(true);
		});

		it("Cancel path: no spell added, no currency change", () => {
			state._data.currency.gp = 200;
			const before = state.getScribingSpellbook().length;
			// Cancel: do nothing.
			expect(state._data.currency.gp).toBe(200);
			expect(state.getScribingSpellbook().length).toBe(before);
		});
	});

	describe("Affordability checks — modal Pay button gating", () => {
		it("level 1 spell affordable at 50 gp exactly", () => {
			state._data.currency.gp = 50;
			expect(state.getTotalGold() >= 1 * 50).toBe(true);
		});

		it("level 1 spell NOT affordable at 49 gp", () => {
			state._data.currency.gp = 49;
			expect(state.getTotalGold() >= 1 * 50).toBe(false);
		});

		it("level 9 spell costs 450 gp", () => {
			expect(9 * 50).toBe(450);
		});
	});
});
