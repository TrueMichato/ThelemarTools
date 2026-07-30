/**
 * Custom-item initiative advantage reaches the roll (Bug #4).
 *
 * A custom ring granting "advantage on initiative" surfaced in the modifiers window once equipped,
 * but the initiative ROLL got no advantage: `_rollInitiative` called `_rollD20({event})` with no
 * advantage/disadvantage, silently dropping everything the pipeline knew. The numeric path already
 * worked (it folds into `customModifiers.initiative` → `getInitiative()`); only adv/dis was lost.
 *
 * The fix adds `state.getInitiativeRollMode()` (delegating to `getAdvantageState("initiative")`),
 * which both `_rollInitiative` handlers now feed into `_rollD20`. These tests pin that seam — the
 * exact value the roll handlers consume — plus the aggregate the modifiers window shows, so they
 * can't drift apart again.
 */

import "./setup.js";
import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-customabilities.js";
import "../../../js/charactersheet/charactersheet-combat.js";

const CharacterSheetState = globalThis.CharacterSheetState;
const CharacterSheetCombat = globalThis.CharacterSheetCombat;

function mkState () {
	const state = new CharacterSheetState();
	state.addClass({name: "Fighter", source: "PHB", level: 5});
	state.setAbilityBase("dex", 14); // +2 initiative baseline
	return state;
}

function ring (name, effects) {
	return {
		name,
		source: "Custom",
		_isCustom: true,
		type: "ring",
		weight: 0,
		equipped: true,
		attuned: false,
		quantity: 1,
		effects,
	};
}

describe("Bug #4 — initiative advantage from an equipped custom ring", () => {
	it("an equipped advantage ring sets BOTH the aggregate and the roll-mode seam", () => {
		const state = mkState();
		state.addItem(ring("Ring of Initiative", [{type: "initiative", value: 0, advantage: true}]));

		expect(state.aggregateModifiers("initiative").advantage).toBe(true);
		expect(state.getInitiativeRollMode().advantage).toBe(true);
		expect(state.getInitiativeRollMode().disadvantage).toBe(false);
	});

	it("unequipping the ring drops the advantage from the roll mode", () => {
		const state = mkState();
		state.addItem(ring("Ring of Initiative", [{type: "initiative", value: 0, advantage: true}]));
		const id = state.getItems()[0].id;
		expect(state.getInitiativeRollMode().advantage).toBe(true);

		state.setItemEquipped(id, false);
		expect(state.aggregateModifiers("initiative").advantage).toBe(false);
		expect(state.getInitiativeRollMode().advantage).toBe(false);
	});

	it("a disadvantage ring sets disadvantage on the roll mode", () => {
		const state = mkState();
		state.addItem(ring("Ring of Sluggishness", [{type: "initiative", value: 0, disadvantage: true}]));

		expect(state.getInitiativeRollMode().disadvantage).toBe(true);
		expect(state.getInitiativeRollMode().advantage).toBe(false);
	});

	it("advantage and disadvantage cancel to a normal roll", () => {
		const state = mkState();
		state.addItem(ring("Ring A", [{type: "initiative", value: 0, advantage: true}]));
		state.addItem(ring("Ring B", [{type: "initiative", value: 0, disadvantage: true}]));

		const mode = state.getInitiativeRollMode();
		expect(mode.advantage).toBe(false);
		expect(mode.disadvantage).toBe(false);
	});
});

describe("Bug #4 — numeric initiative bonus is independent of advantage", () => {
	it("a +2 initiative ring raises getInitiative() but does NOT grant advantage", () => {
		const state = mkState();
		const base = state.getInitiative(); // DEX +2
		state.addItem(ring("Ring of Quickness", [{type: "initiative", value: 2}]));

		expect(state.getInitiative()).toBe(base + 2);
		expect(state.getInitiativeRollMode().advantage).toBe(false);
		expect(state.getInitiativeRollMode().disadvantage).toBe(false);
	});

	it("with no initiative effects the roll mode is plain normal", () => {
		const state = mkState();
		expect(state.getInitiativeRollMode()).toEqual({advantage: false, disadvantage: false});
	});
});

describe("Bug #4 — the initiative ROLL HANDLER consumes the mode", () => {
	// The actual bug lived in `_rollInitiative`, which called the d20 roller with no
	// advantage/disadvantage. This guards that regression directly: we invoke the handler with a
	// stubbed `this` and assert the exact adv/dis flags it forwards to rollD20. (Both _rollInitiative
	// handlers — charactersheet.js and charactersheet-combat.js — share this contract; we exercise
	// the synchronous combat one as the representative.)
	function runHandler ({advantage, disadvantage}) {
		let received = null;
		const prevDoc = globalThis.document;
		globalThis.document = {getElementById: () => ({})};
		try {
			const fakeThis = {
				_state: {
					getInitiative: () => 2,
					getInitiativeRollMode: () => ({advantage, disadvantage}),
					getRollBonusDiceFromStates: () => [],
				},
				_page: {
					rollD20: (opts) => { received = opts; return {roll: 13, mode: "normal"}; },
					getModeLabel: () => "",
					pAnimateD20: () => {},
					showDiceResult: () => {},
					formatD20Breakdown: () => "",
				},
				_triggerInitiativeRecovery: () => {},
				// Real implementation — `_rollInitiative` consumes a pending Battle Master
				// check bonus. It only reads `this._pendingBattleMasterCheck`, so binding the
				// real method keeps this exercising production code rather than a fake.
				consumeBattleMasterCheckBonus: CharacterSheetCombat.prototype.consumeBattleMasterCheckBonus,
			};
			CharacterSheetCombat.prototype._rollInitiative.call(fakeThis, /* event */ undefined);
		} finally {
			globalThis.document = prevDoc;
		}
		return received;
	}

	it("forwards advantage from the roll mode into rollD20", () => {
		const opts = runHandler({advantage: true, disadvantage: false});
		expect(opts).not.toBeNull();
		expect(opts.stateAdvantage).toBe(true);
		expect(opts.stateDisadvantage).toBe(false);
	});

	it("forwards disadvantage from the roll mode into rollD20", () => {
		const opts = runHandler({advantage: false, disadvantage: true});
		expect(opts.stateAdvantage).toBe(false);
		expect(opts.stateDisadvantage).toBe(true);
	});

	it("forwards a plain normal roll when the mode is empty", () => {
		const opts = runHandler({advantage: false, disadvantage: false});
		expect(opts.stateAdvantage).toBe(false);
		expect(opts.stateDisadvantage).toBe(false);
	});
});
