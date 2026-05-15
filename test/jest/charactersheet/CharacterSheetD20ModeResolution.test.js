/**
 * Character Sheet d20 Mode Resolution - Unit Tests
 *
 * Verifies CharacterSheetClassUtils.resolveD20Mode — the pure helper that combines
 * passive state advantage/disadvantage with event-key modifiers (Shift = adv,
 * Ctrl/Cmd = disadv) and resolves to a single d20 mode per RAW (adv + disadv = normal).
 *
 * The original bug: a Nyuidj with passive Wis-save advantage (Dual Mind) who pressed
 * Ctrl to add disadvantage rolled with disadvantage instead of canceling to a normal
 * roll. Symmetric cases (passive disadv + Shift) had the same defect.
 */

import "./setup.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";

const CharacterSheetClassUtils = globalThis.CharacterSheetClassUtils;

const ev = (keys = {}) => ({shiftKey: false, ctrlKey: false, metaKey: false, ...keys});

describe("CharacterSheetClassUtils.resolveD20Mode", () => {
	it("returns 'normal' with no state and no event", () => {
		expect(CharacterSheetClassUtils.resolveD20Mode()).toBe("normal");
		expect(CharacterSheetClassUtils.resolveD20Mode({})).toBe("normal");
	});

	it("returns 'advantage' for state advantage only", () => {
		expect(CharacterSheetClassUtils.resolveD20Mode({stateAdvantage: true})).toBe("advantage");
	});

	it("returns 'disadvantage' for state disadvantage only", () => {
		expect(CharacterSheetClassUtils.resolveD20Mode({stateDisadvantage: true})).toBe("disadvantage");
	});

	it("returns 'normal' when state advantage and disadvantage both present (cancellation)", () => {
		expect(CharacterSheetClassUtils.resolveD20Mode({stateAdvantage: true, stateDisadvantage: true})).toBe("normal");
	});

	it("returns 'advantage' for shift key only", () => {
		expect(CharacterSheetClassUtils.resolveD20Mode({event: ev({shiftKey: true})})).toBe("advantage");
	});

	it("returns 'disadvantage' for ctrl key only", () => {
		expect(CharacterSheetClassUtils.resolveD20Mode({event: ev({ctrlKey: true})})).toBe("disadvantage");
	});

	it("treats meta key (Mac Cmd) as disadvantage like ctrl", () => {
		expect(CharacterSheetClassUtils.resolveD20Mode({event: ev({metaKey: true})})).toBe("disadvantage");
	});

	// ─── The Nyuidj bug ───────────────────────────────────────────────
	it("cancels passive state advantage when user presses ctrl (Nyuidj fix)", () => {
		expect(CharacterSheetClassUtils.resolveD20Mode({
			stateAdvantage: true,
			event: ev({ctrlKey: true}),
		})).toBe("normal");
	});

	it("cancels passive state advantage when user presses meta/cmd (Mac, Nyuidj fix)", () => {
		expect(CharacterSheetClassUtils.resolveD20Mode({
			stateAdvantage: true,
			event: ev({metaKey: true}),
		})).toBe("normal");
	});

	// ─── Symmetric case: passive disadvantage + Shift ─────────────────
	it("cancels passive state disadvantage when user presses shift", () => {
		expect(CharacterSheetClassUtils.resolveD20Mode({
			stateDisadvantage: true,
			event: ev({shiftKey: true}),
		})).toBe("normal");
	});

	// ─── Stacking cases ───────────────────────────────────────────────
	it("stays 'advantage' when state advantage and shift agree", () => {
		expect(CharacterSheetClassUtils.resolveD20Mode({
			stateAdvantage: true,
			event: ev({shiftKey: true}),
		})).toBe("advantage");
	});

	it("stays 'disadvantage' when state disadvantage and ctrl agree", () => {
		expect(CharacterSheetClassUtils.resolveD20Mode({
			stateDisadvantage: true,
			event: ev({ctrlKey: true}),
		})).toBe("disadvantage");
	});

	// ─── Three-way: both state sides + event ──────────────────────────
	it("cancels when both state sides are set even with no event", () => {
		expect(CharacterSheetClassUtils.resolveD20Mode({
			stateAdvantage: true,
			stateDisadvantage: true,
			event: null,
		})).toBe("normal");
	});

	it("cancels when state advantage + state disadvantage + shift (still cancels)", () => {
		expect(CharacterSheetClassUtils.resolveD20Mode({
			stateAdvantage: true,
			stateDisadvantage: true,
			event: ev({shiftKey: true}),
		})).toBe("normal");
	});

	// ─── Defensive: falsy / explicit false ────────────────────────────
	it("treats explicit false the same as omitted", () => {
		expect(CharacterSheetClassUtils.resolveD20Mode({
			stateAdvantage: false,
			stateDisadvantage: false,
		})).toBe("normal");
	});

	it("ignores other event keys (alt, etc.)", () => {
		expect(CharacterSheetClassUtils.resolveD20Mode({event: ev({altKey: true})})).toBe("normal");
	});
});
