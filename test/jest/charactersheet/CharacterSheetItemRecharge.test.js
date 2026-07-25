/**
 * Character Sheet Item Charge Recharge — Unit Tests (Round 42, B8)
 *
 * Exercises the canonical `rechargeItemCharges()` operation and its rest/trigger
 * integration. Asserts REAL mechanics: fixed vs dice vs to-full amounts, exactly-once
 * rolling, clamping, no-op suppression, cancel-is-a-no-op, and long/short rest routing.
 */

import "./setup.js";
import {jest} from "@jest/globals";
import "../../../js/charactersheet/charactersheet-state.js";

const CharacterSheetState = globalThis.CharacterSheetState;

/** Add a charged item and return its inventory entry id. */
function addChargedItem (state, {name = "Wand", charges = 7, chargesCurrent = 0, recharge = "dawn", rechargeAmount} = {}) {
	const item = {name, source: "Custom", _isCustom: true, charges, chargesCurrent, recharge};
	if (rechargeAmount !== undefined) item.rechargeAmount = rechargeAmount;
	const before = new Set(state.getItems().map(i => i.id));
	state.addItem(item, 1);
	const added = state.getItems().find(i => !before.has(i.id));
	return added.id;
}

describe("Item Charge Recharge — canonical rechargeItemCharges()", () => {
	let state;
	let randomiseSpy;

	beforeEach(() => {
		state = new CharacterSheetState();
		state.addClass({name: "Wizard", source: "PHB", level: 5});
		// Deterministic dice: every die returns 4 unless a test overrides.
		randomiseSpy = jest.fn(() => 4);
		globalThis.RollerUtil.randomise = randomiseSpy;
	});

	afterEach(() => {
		delete globalThis.RollerUtil.randomise;
	});

	// ---- Fixed amount --------------------------------------------------------
	it("adds a fixed numeric recharge amount, clamped to max", () => {
		const id = addChargedItem(state, {charges: 7, chargesCurrent: 5, rechargeAmount: 5});
		const res = state.rechargeItemCharges(id);
		expect(res.committed).toBe(true);
		expect(res.isDice).toBe(false);
		expect(res.restored).toBe(2); // 5 -> 7, clamped
		expect(res.newCharges).toBe(7);
		expect(state.getItems().find(i => i.id === id).chargesCurrent).toBe(7);
		expect(randomiseSpy).not.toHaveBeenCalled();
	});

	it("parses a fixed amount supplied as a numeric string", () => {
		const id = addChargedItem(state, {charges: 10, chargesCurrent: 2, rechargeAmount: "3"});
		const res = state.rechargeItemCharges(id);
		expect(res.committed).toBe(true);
		expect(res.restored).toBe(3);
		expect(res.newCharges).toBe(5);
		expect(state.getItems().find(i => i.id === id).chargesCurrent).toBe(5);
	});

	it("clamps a supplied rolledAmount above max and never re-rolls", () => {
		const id = addChargedItem(state, {charges: 5, chargesCurrent: 1, rechargeAmount: "1d6"});
		const res = state.rechargeItemCharges(id, {rolledAmount: 99, commit: true});
		expect(res.newCharges).toBe(5); // 1 + 99 -> clamped to max 5
		expect(res.restored).toBe(4);
		expect(res.committed).toBe(true);
		expect(randomiseSpy).not.toHaveBeenCalled();
		expect(state.getItems().find(i => i.id === id).chargesCurrent).toBe(5);
	});

	it("clamps a negative supplied rolledAmount to zero (no-op)", () => {
		const id = addChargedItem(state, {charges: 5, chargesCurrent: 3, rechargeAmount: "1d6"});
		const res = state.rechargeItemCharges(id, {rolledAmount: -4, commit: true});
		expect(res.amount).toBe(0);
		expect(res.didChange).toBe(false);
		expect(res.committed).toBe(false);
		expect(state.getItems().find(i => i.id === id).chargesCurrent).toBe(3);
	});

	// ---- To full -------------------------------------------------------------
	it("recharges to full when rechargeAmount is absent", () => {
		const id = addChargedItem(state, {charges: 6, chargesCurrent: 1, rechargeAmount: undefined});
		const res = state.rechargeItemCharges(id);
		expect(res.committed).toBe(true);
		expect(res.formula).toBe("to full");
		expect(res.newCharges).toBe(6);
		expect(res.restored).toBe(5);
		expect(state.getItems().find(i => i.id === id).chargesCurrent).toBe(6);
	});

	it("recharges to full for 'all' / 'FULL' (case & space insensitive)", () => {
		const idA = addChargedItem(state, {charges: 4, chargesCurrent: 0, rechargeAmount: " all "});
		const resA = state.rechargeItemCharges(idA);
		expect(resA.newCharges).toBe(4);
		expect(resA.committed).toBe(true);
		expect(state.getItems().find(i => i.id === idA).chargesCurrent).toBe(4);
		const idB = addChargedItem(state, {name: "Rod", charges: 4, chargesCurrent: 1, rechargeAmount: "FULL"});
		expect(state.rechargeItemCharges(idB).newCharges).toBe(4);
		expect(state.getItems().find(i => i.id === idB).chargesCurrent).toBe(4);
	});

	// ---- Dice ----------------------------------------------------------------
	it("rolls a dice recharge exactly once (per die) and clamps", () => {
		const id = addChargedItem(state, {charges: 20, chargesCurrent: 0, rechargeAmount: "{@dice 2d6 + 3}"});
		const res = state.rechargeItemCharges(id);
		expect(res.isDice).toBe(true);
		expect(randomiseSpy).toHaveBeenCalledTimes(2); // 2 dice
		expect(randomiseSpy).toHaveBeenNthCalledWith(1, 6); // d6 face size
		expect(randomiseSpy).toHaveBeenNthCalledWith(2, 6);
		expect(res.rolls).toEqual([4, 4]);
		expect(res.amount).toBe(11); // 4 + 4 + 3
		expect(res.newCharges).toBe(11);
		expect(res.committed).toBe(true);
		expect(res.breakdown).toContain("[4, 4]");
		expect(state.getItems().find(i => i.id === id).chargesCurrent).toBe(11);
	});

	it("parses a bare '1d6+4' dice string (no {@dice} wrapper)", () => {
		const id = addChargedItem(state, {charges: 20, chargesCurrent: 0, rechargeAmount: "1d6+4"});
		const res = state.rechargeItemCharges(id);
		expect(res.isDice).toBe(true);
		expect(res.amount).toBe(8); // 4 + 4
	});

	it("clamps a negative dice total to zero (never drains charges)", () => {
		randomiseSpy.mockReturnValue(1);
		const id = addChargedItem(state, {charges: 10, chargesCurrent: 5, rechargeAmount: "1d4-10"});
		const res = state.rechargeItemCharges(id);
		expect(res.amount).toBe(0); // 1 - 10 -> clamped to 0
		expect(res.didChange).toBe(false);
		expect(res.committed).toBe(false);
		expect(state.getItems().find(i => i.id === id).chargesCurrent).toBe(5);
	});

	// ---- Preview / commit (roll once) ---------------------------------------
	it("commit:false previews without mutating (cancel = no-op)", () => {
		const id = addChargedItem(state, {charges: 20, chargesCurrent: 0, rechargeAmount: "2d6+3"});
		const preview = state.rechargeItemCharges(id, {commit: false});
		expect(preview.committed).toBe(false);
		expect(preview.didChange).toBe(true); // would change if committed
		expect(preview.amount).toBe(11);
		expect(state.getItems().find(i => i.id === id).chargesCurrent).toBe(0); // unchanged
	});

	it("reuses a {@dice}-wrapped previewed roll on commit — one RNG cycle total", () => {
		const id = addChargedItem(state, {charges: 20, chargesCurrent: 0, rechargeAmount: "{@dice 2d6 + 3}"});
		const preview = state.rechargeItemCharges(id, {commit: false});
		expect(randomiseSpy).toHaveBeenCalledTimes(2);
		const commit = state.rechargeItemCharges(id, {rolledAmount: preview.amount, commit: true});
		expect(randomiseSpy).toHaveBeenCalledTimes(2); // NO second roll
		expect(commit.committed).toBe(true);
		expect(commit.newCharges).toBe(11);
		expect(state.getItems().find(i => i.id === id).chargesCurrent).toBe(11);
	});

	it("reuses a previewed roll on commit — exactly one RNG cycle total", () => {
		const id = addChargedItem(state, {charges: 20, chargesCurrent: 0, rechargeAmount: "2d6+3"});
		const preview = state.rechargeItemCharges(id, {commit: false});
		expect(randomiseSpy).toHaveBeenCalledTimes(2);
		const commit = state.rechargeItemCharges(id, {rolledAmount: preview.amount, commit: true});
		expect(randomiseSpy).toHaveBeenCalledTimes(2); // NO second roll
		expect(commit.committed).toBe(true);
		expect(commit.newCharges).toBe(11);
	});

	// ---- No-op / edge cases --------------------------------------------------
	it("is a no-op when already at full charges", () => {
		const id = addChargedItem(state, {charges: 5, chargesCurrent: 5, rechargeAmount: "1d6"});
		const res = state.rechargeItemCharges(id);
		expect(res.didChange).toBe(false);
		expect(res.committed).toBe(false);
		expect(res.amount).toBe(0);
		expect(res.restored).toBe(0);
		expect(randomiseSpy).not.toHaveBeenCalled();
		expect(state.getItems().find(i => i.id === id).chargesCurrent).toBe(5);
	});

	it("returns null for an item without charges", () => {
		const before = new Set(state.getItems().map(i => i.id));
		state.addItem({name: "Rope", source: "Custom", _isCustom: true}, 1);
		const id = state.getItems().find(i => !before.has(i.id)).id;
		expect(state.rechargeItemCharges(id)).toBeNull();
	});

	it("treats an unparseable rechargeAmount as a no-op without throwing", () => {
		const id = addChargedItem(state, {charges: 5, chargesCurrent: 1, rechargeAmount: "gibberish"});
		let res;
		expect(() => { res = state.rechargeItemCharges(id); }).not.toThrow();
		expect(res.didChange).toBe(false);
		expect(res.committed).toBe(false);
		expect(res.amount).toBe(0);
		expect(randomiseSpy).not.toHaveBeenCalled();
		expect(state.getItems().find(i => i.id === id).chargesCurrent).toBe(1);
	});

	it("exposes previous as the undo snapshot and stays reversible", () => {
		const id = addChargedItem(state, {charges: 8, chargesCurrent: 2, rechargeAmount: 4});
		const res = state.rechargeItemCharges(id);
		expect(res.previous).toBe(2);
		state.setItemCharges(id, res.previous); // undo
		expect(state.getItems().find(i => i.id === id).chargesCurrent).toBe(2);
	});
});

describe("Item Charge Recharge — static helpers", () => {
	it("getItemRechargeFormula covers fixed / dice / to-full", () => {
		expect(CharacterSheetState.getItemRechargeFormula({rechargeAmount: 3})).toBe("3");
		expect(CharacterSheetState.getItemRechargeFormula({rechargeAmount: "{@dice 1d6 + 1}"})).toBe("1d6 + 1");
		expect(CharacterSheetState.getItemRechargeFormula({rechargeAmount: "all"})).toBe("to full");
		expect(CharacterSheetState.getItemRechargeFormula({})).toBe("to full");
	});

	it("itemRechargesOnRest maps periods to rest types", () => {
		const mk = recharge => ({charges: 3, recharge});
		for (const p of ["restLong", "dawn", "dusk", "midnight"]) {
			expect(CharacterSheetState.itemRechargesOnRest(mk(p), "long")).toBe(true);
			expect(CharacterSheetState.itemRechargesOnRest(mk(p), "short")).toBe(false);
		}
		expect(CharacterSheetState.itemRechargesOnRest(mk("restShort"), "short")).toBe(true);
		expect(CharacterSheetState.itemRechargesOnRest(mk("restShort"), "long")).toBe(false);
		expect(CharacterSheetState.itemRechargesOnRest({recharge: "dawn"}, "long")).toBe(false); // no charges
		expect(CharacterSheetState.itemRechargesOnRest(mk("dawn"), "elsewhere")).toBe(false); // unknown restType
	});
});

describe("Item Charge Recharge — rest & trigger integration", () => {
	let state;

	beforeEach(() => {
		state = new CharacterSheetState();
		state.addClass({name: "Wizard", source: "PHB", level: 5});
		globalThis.RollerUtil.randomise = jest.fn(() => 4);
	});

	afterEach(() => {
		delete globalThis.RollerUtil.randomise;
	});

	it("onLongRest recharges restLong/dawn/dusk/midnight items via canonical path", () => {
		const idDawn = addChargedItem(state, {name: "Dawnwand", charges: 7, chargesCurrent: 0, recharge: "dawn", rechargeAmount: "1d6+1"});
		const idLong = addChargedItem(state, {name: "Longrod", charges: 5, chargesCurrent: 1, recharge: "restLong", rechargeAmount: 3});
		const idShort = addChargedItem(state, {name: "Shortstaff", charges: 4, chargesCurrent: 0, recharge: "restShort", rechargeAmount: 2});

		state.onLongRest();

		expect(state.getItems().find(i => i.id === idDawn).chargesCurrent).toBe(5); // 4 + 1
		expect(state.getItems().find(i => i.id === idLong).chargesCurrent).toBe(4); // 1 + 3
		expect(state.getItems().find(i => i.id === idShort).chargesCurrent).toBe(0); // untouched by long rest
	});

	it("onShortRest recharges only restShort items", () => {
		const idShort = addChargedItem(state, {name: "Shortstaff", charges: 4, chargesCurrent: 0, recharge: "restShort", rechargeAmount: 2});
		const idDawn = addChargedItem(state, {name: "Dawnwand", charges: 7, chargesCurrent: 0, recharge: "dawn", rechargeAmount: 3});

		state.onShortRest();

		expect(state.getItems().find(i => i.id === idShort).chargesCurrent).toBe(2);
		expect(state.getItems().find(i => i.id === idDawn).chargesCurrent).toBe(0);
	});

	it("_rechargeItems (via onDusk) recharges dusk items and is idempotent at full", () => {
		const id = addChargedItem(state, {charges: 6, chargesCurrent: 0, recharge: "dusk", rechargeAmount: 6});
		state.onDusk();
		expect(state.getItems().find(i => i.id === id).chargesCurrent).toBe(6);
		// Second dusk: already full → no change.
		state.onDusk();
		expect(state.getItems().find(i => i.id === id).chargesCurrent).toBe(6);
	});

	it("onMidnight recharges midnight items only", () => {
		const idMid = addChargedItem(state, {name: "Midwand", charges: 5, chargesCurrent: 1, recharge: "midnight", rechargeAmount: 2});
		const idDawn = addChargedItem(state, {name: "Dawnwand", charges: 5, chargesCurrent: 0, recharge: "dawn", rechargeAmount: 2});
		state.onMidnight();
		expect(state.getItems().find(i => i.id === idMid).chargesCurrent).toBe(3);
		expect(state.getItems().find(i => i.id === idDawn).chargesCurrent).toBe(0);
	});

	it("onNewRound recharges per-round items only", () => {
		const idRound = addChargedItem(state, {name: "Roundring", charges: 3, chargesCurrent: 0, recharge: "round", rechargeAmount: 1});
		const idDawn = addChargedItem(state, {name: "Dawnwand", charges: 5, chargesCurrent: 0, recharge: "dawn", rechargeAmount: 2});
		state.onNewRound();
		expect(state.getItems().find(i => i.id === idRound).chargesCurrent).toBe(1);
		expect(state.getItems().find(i => i.id === idDawn).chargesCurrent).toBe(0);
	});
});
