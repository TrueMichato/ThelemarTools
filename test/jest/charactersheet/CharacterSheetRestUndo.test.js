/**
 * Undo an accidental short/long rest (round-44 Bug #8) — MECHANICS.
 *
 * A rest mutates ~15 (short) / ~26 (long) pieces of state, so rather than an
 * inverse-ops undo (fragile) the sheet snapshots the FULL character state via
 * `toJson()` before applying a rest, stashes it transiently on the page
 * (`page._lastRestSnapshot`, session-only — never persisted), and restores it
 * verbatim via `loadFromJson()` when the player clicks "Undo last rest".
 *
 * The Rest module's constructor wires DOM listeners (node env has no document),
 * so we build a prototype instance with an injected state + fake page — exactly
 * the collaborators the undo methods use. The affordance methods are DOM-guarded
 * and therefore no-ops here; this file exercises the capture/restore MECHANICS.
 *
 * Assertions read the character's meaningful, user-visible state via public
 * getters rather than raw `toJson()` deep-equality: `loadFromJson()` legitimately
 * back-fills default fields and recomputes derived values (e.g. `hp.max`), so a
 * raw JSON compare is noisy. The getter-based `fields()` snapshot is the state the
 * player actually cares about round-tripping.
 */

import "./setup.js";

let CharacterSheetState;
let CharacterSheetRest;

beforeAll(async () => {
	CharacterSheetState = (await import("../../../js/charactersheet/charactersheet-state.js")).CharacterSheetState;
	CharacterSheetRest = (await import("../../../js/charactersheet/charactersheet-rest.js")).CharacterSheetRest;
});

/** Build a Rest instance WITHOUT running the DOM-wiring constructor. */
function makeRest (state) {
	const rest = Object.create(CharacterSheetRest.prototype);
	const page = {
		_lastRestSnapshot: null,
		getState: () => state,
		saveCharacter: () => {},
		renderCharacter: () => {},
	};
	rest._state = state;
	rest._page = page;
	return {rest, page};
}

/** A level-5 Wizard with spent HP, slots, hit dice, exhaustion, a condition and temp HP. */
function makeWornCaster () {
	const state = new CharacterSheetState();
	state.addClass({name: "Wizard", source: "XPHB", level: 5});
	state.setAbilityBase("con", 14);
	state.setMaxHp(30);
	state.setHp(9, 30, 4); // current 9, temp 4
	// Spend some spell slots.
	state.setSpellSlots(1, state.getSpellSlotsMax(1), 1);
	state.setSpellSlots(2, state.getSpellSlotsMax(2), 0);
	state.setSpellSlots(3, state.getSpellSlotsMax(3), 0);
	// Spend hit dice.
	state.adjustHitDieCurrent("d6", -3);
	// Exhaustion + a condition.
	state.setExhaustion(2);
	state.addCondition("poisoned");
	return state;
}

/** Curated snapshot of the user-visible state a rest touches, for round-trip asserts. */
function fields (state) {
	const hitDice = state.getHitDiceByType?.() || {};
	return {
		hpCurrent: state.getHp().current,
		hpTemp: state.getHp().temp,
		slots: [1, 2, 3, 4, 5, 6, 7, 8, 9].map(l => state.getSpellSlotsCurrent(l)),
		hitDice: Object.fromEntries(Object.entries(hitDice).map(([k, v]) => [k, v.current])),
		exhaustion: state.getExhaustion(),
		conditions: [...(state.getConditionNames?.() || [])].sort(),
	};
}

describe("#8 — Undo rest (full-snapshot capture/restore)", () => {
	describe("_captureRestSnapshot", () => {
		it("stores a transient snapshot on the page tagged with the rest type", () => {
			const state = makeWornCaster();
			const {rest, page} = makeRest(state);

			const snap = rest._captureRestSnapshot("short");

			expect(snap).toBeTruthy();
			expect(snap.restType).toBe("short");
			expect(page._lastRestSnapshot).toBe(snap);
			expect(rest.hasRestUndoAvailable()).toBe(true);
		});

		it("captures a deep copy that is independent of later state mutation", () => {
			const state = makeWornCaster();
			const {rest, page} = makeRest(state);

			rest._captureRestSnapshot("short");
			const hpAtCapture = page._lastRestSnapshot.json.hp.current;

			// Mutate the live state AFTER capture — the snapshot must not change.
			state.setHp(1, 30, 0);

			expect(page._lastRestSnapshot.json.hp.current).toBe(hpAtCapture);
			expect(page._lastRestSnapshot.json.hp.current).not.toBe(state.getHp().current);
		});
	});

	describe("Short rest undo round-trip", () => {
		it("restores the full pre-rest state (HP, temp HP, slots, hit dice, exhaustion, conditions)", () => {
			const state = makeWornCaster();
			const {rest} = makeRest(state);

			const before = fields(state);

			// Capture, then simulate a short rest's mutations.
			rest._captureRestSnapshot("short");
			state.heal(10); // some HP back
			state.setHp(state.getHp().current, undefined, 0); // temp cleared
			state.adjustHitDieCurrent("d6", -1); // spent a hit die to heal
			state.setSpellSlots(1, state.getSpellSlotsMax(1), state.getSpellSlotsMax(1)); // arcane recovery

			// Sanity: state actually changed.
			expect(fields(state)).not.toEqual(before);

			const undone = rest._onUndoRest();

			expect(undone).toBe(true);
			expect(fields(state)).toEqual(before);
		});
	});

	describe("Long rest undo round-trip", () => {
		it("restores the full pre-rest state after a long rest's many mutations", () => {
			const state = makeWornCaster();
			const {rest} = makeRest(state);

			const before = fields(state);

			rest._captureRestSnapshot("long");
			// Simulate a long rest: full HP, reset temp, restore all slots, recover
			// hit dice, drop a level of exhaustion, remove a condition.
			state.setHp(state.getMaxHp(), state.getMaxHp(), 0);
			for (let lvl = 1; lvl <= 9; lvl++) {
				const max = state.getSpellSlotsMax(lvl);
				if (max > 0) state.setSpellSlots(lvl, max, max);
			}
			state.adjustHitDieCurrent("d6", 2);
			state.setExhaustion(1);
			state.removeCondition("poisoned");

			expect(fields(state)).not.toEqual(before);

			const undone = rest._onUndoRest();

			expect(undone).toBe(true);
			expect(fields(state)).toEqual(before);
			// Spot-check specific fields survived the round-trip.
			expect(state.getHp().current).toBe(9);
			expect(state.getHp().temp).toBe(4);
			expect(state.getExhaustion()).toBe(2);
			expect(state.getSpellSlotsCurrent(1)).toBe(1);
			expect(state.getSpellSlotsCurrent(2)).toBe(0);
			expect(state.getConditionNames()).toContain("poisoned");
		});
	});

	describe("Undo is single-level and clears after use", () => {
		it("returns true once, then reports no undo available and refuses a second undo", () => {
			const state = makeWornCaster();
			const {rest, page} = makeRest(state);

			rest._captureRestSnapshot("long");
			state.setHp(1, 30, 0);

			expect(rest._onUndoRest()).toBe(true);
			expect(rest.hasRestUndoAvailable()).toBe(false);
			expect(page._lastRestSnapshot).toBeNull();

			// A second undo has nothing to restore and must not change state.
			const stateAfter = fields(state);
			expect(rest._onUndoRest()).toBe(false);
			expect(fields(state)).toEqual(stateAfter);
		});

		it("only remembers the most recent rest (capturing again overwrites the snapshot)", () => {
			const state = makeWornCaster();
			const {rest, page} = makeRest(state);

			rest._captureRestSnapshot("short");
			const firstSnap = page._lastRestSnapshot;

			state.setHp(1, 30, 0);
			const afterFirstMutation = fields(state);

			rest._captureRestSnapshot("long");
			expect(page._lastRestSnapshot).not.toBe(firstSnap);
			expect(page._lastRestSnapshot.restType).toBe("long");

			state.setExhaustion(6);
			rest._onUndoRest();

			// Restores to the SECOND snapshot, not the first.
			expect(fields(state)).toEqual(afterFirstMutation);
		});
	});

	describe("_onUndoRest with no snapshot", () => {
		it("is a safe no-op that returns false", () => {
			const state = makeWornCaster();
			const {rest} = makeRest(state);
			expect(rest.hasRestUndoAvailable()).toBe(false);
			expect(rest._onUndoRest()).toBe(false);
		});
	});
});
