/**
 * BUG 7 — Arcane Recovery status indicator (spells tab)
 * Asserts the DOM-free status helper reflects the feature's uses (feature.uses.current),
 * mirroring the spent-detection logic used by the short-rest menu. Instantiated off the
 * prototype because the Jest env is `node` (no `document`).
 */

import "./setup.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-spells.js";

const CharacterSheetState = globalThis.CharacterSheetState;
const CharacterSheetSpells = globalThis.CharacterSheetSpells;

function makeSpells (state) {
	const mod = Object.create(CharacterSheetSpells.prototype);
	mod._state = state;
	return mod;
}

/** Ensure an Arcane Recovery feature with a uses pool exists on the state. */
function setArcaneRecoveryUses (state, current, max = 1) {
	if (!state._data.features) state._data.features = [];
	let f = state.getFeature("Arcane Recovery");
	if (!f) {
		f = {name: "Arcane Recovery"};
		state._data.features.push(f);
	}
	f.uses = {current, max};
	return f;
}

describe("BUG 7 — Arcane Recovery status", () => {
	it("reports the feature present with the correct name for a Wizard", () => {
		const state = new CharacterSheetState();
		state.addClass({name: "Wizard", source: "PHB", level: 5});
		const mod = makeSpells(state);
		const status = mod._getSlotRecoveryStatus();
		expect(status.hasFeature).toBe(true);
		expect(status.featureName).toBe("Arcane Recovery");
	});

	it("reflects feature.uses.current === 0 as used / unavailable", () => {
		const state = new CharacterSheetState();
		state.addClass({name: "Wizard", source: "PHB", level: 5});
		setArcaneRecoveryUses(state, 0, 1);
		const status = makeSpells(state)._getSlotRecoveryStatus();
		expect(status.used).toBe(true);
		expect(status.available).toBe(false);
	});

	it("reflects feature.uses.current >= 1 as available / not used", () => {
		const state = new CharacterSheetState();
		state.addClass({name: "Wizard", source: "PHB", level: 5});
		setArcaneRecoveryUses(state, 1, 1);
		const status = makeSpells(state)._getSlotRecoveryStatus();
		expect(status.used).toBe(false);
		expect(status.available).toBe(true);
	});

	it("treats a Wizard with no uses pool yet as available (unspent)", () => {
		const state = new CharacterSheetState();
		state.addClass({name: "Wizard", source: "PHB", level: 5});
		const status = makeSpells(state)._getSlotRecoveryStatus();
		expect(status.hasFeature).toBe(true);
		expect(status.available).toBe(true);
		expect(status.used).toBe(false);
	});

	it("reports no feature for a non-caster (Fighter)", () => {
		const state = new CharacterSheetState();
		state.addClass({name: "Fighter", source: "PHB", level: 5});
		const status = makeSpells(state)._getSlotRecoveryStatus();
		expect(status.hasFeature).toBe(false);
		expect(status.featureName).toBeNull();
	});
});
