/**
 * Conditional speed-modifier save/load migration (round 5, Bug 9 — Aasimar speed)
 *
 * New-build gating already works (see CharacterSheetAasimarFlight): a base Aasimar
 * has no fly speed because the Heavenly-Wings grant is stored as a DISABLED
 * conditional modifier. BUT `loadFromJson` restores `namedModifiers` verbatim and
 * only re-applies *classFeature*-sourced effects — race text-parsed modifiers are
 * NOT cleared/re-derived. So a character saved BEFORE the conditional-gating fix
 * kept its fly modifier `enabled: true`, and the leak survived the round-trip
 * (base Aasimar showed a permanent fly speed on load). That is the real
 * "still broken" path.
 *
 * FIX: `_migrateConditionalSpeedModifiers()` re-parses each currently-ENABLED
 * speed modifier's source feature on load and disables it if the current
 * definition says the grant is conditional. These tests drive the real
 * serialize → mutate-to-pre-fix → loadFromJson path.
 */

import "./setup.js";
import "../../../js/charactersheet/charactersheet-state.js";

const CharacterSheetState = globalThis.CharacterSheetState;

const AASIMAR_CELESTIAL_REVELATION = "When you reach character level 3, you can transform as a Bonus Action "
	+ "using one of the options below. The transformation lasts for 1 minute or until you end it. "
	+ "Heavenly Wings. Two spectral wings sprout from your back temporarily. Until the transformation ends, "
	+ "you have a Fly Speed equal to your Speed.";

function makeSavedAasimar (walkSpeed = 30) {
	const state = new CharacterSheetState();
	state.setSpeed("walk", walkSpeed);
	state.addFeature({
		name: "Celestial Revelation",
		source: "XPHB",
		featureType: "Species",
		description: AASIMAR_CELESTIAL_REVELATION,
	});
	return state;
}

/** Serialize, then corrupt the fly modifier back to its pre-fix (leaked) shape. */
function makePreFixSaveJson (walkSpeed = 30, {keepConditional = false} = {}) {
	const json = makeSavedAasimar(walkSpeed).toJson();
	const flyMod = json.namedModifiers.find(m => m.type === "speed:fly" && m.equalToWalk);
	expect(flyMod).toBeDefined();
	flyMod.enabled = true; // the leak: enabled at base
	if (!keepConditional) delete flyMod.conditional; // pre-fix saves often lacked it
	return json;
}

describe("Bug 9 — stale conditional fly speed is re-gated on load", () => {
	test("a pre-fix save (fly enabled at base) is healed on load", () => {
		const json = makePreFixSaveJson(30);
		const loaded = new CharacterSheetState();
		loaded.loadFromJson(json);

		const flyMod = loaded._data.namedModifiers.find(m => m.type === "speed:fly" && m.equalToWalk);
		expect(flyMod).toBeDefined();
		expect(flyMod.enabled).toBe(false);
		expect(flyMod.conditional).toBeTruthy();
		expect(loaded.getSpeedByType("fly")).toBe(0);
		expect(loaded.getSpeed()).not.toMatch(/fly/i);
	});

	test("a pre-fix save that kept its conditional but stayed enabled is still disabled", () => {
		const json = makePreFixSaveJson(30, {keepConditional: true});
		const loaded = new CharacterSheetState();
		loaded.loadFromJson(json);
		const flyMod = loaded._data.namedModifiers.find(m => m.type === "speed:fly");
		expect(flyMod.enabled).toBe(false);
		expect(loaded.getSpeedByType("fly")).toBe(0);
	});

	test("after migration the transformation can still be toggled on (fly = walk, tracks walk)", () => {
		const json = makePreFixSaveJson(30);
		const loaded = new CharacterSheetState();
		loaded.loadFromJson(json);
		const flyMod = loaded._data.namedModifiers.find(m => m.type === "speed:fly");
		loaded.toggleNamedModifier(flyMod.id);
		expect(loaded.getSpeedByType("fly")).toBe(30);
		loaded.setSpeed("walk", 40);
		expect(loaded.getSpeedByType("fly")).toBe(40);
	});

	test("migration is idempotent (a clean, correctly-gated save loads unchanged)", () => {
		const cleanJson = makeSavedAasimar(30).toJson();
		const loaded = new CharacterSheetState();
		loaded.loadFromJson(cleanJson);
		const flyMod = loaded._data.namedModifiers.find(m => m.type === "speed:fly");
		expect(flyMod.enabled).toBe(false);
		// Re-saving and re-loading must not change anything.
		const loaded2 = new CharacterSheetState();
		loaded2.loadFromJson(loaded.toJson());
		expect(loaded2._data.namedModifiers.find(m => m.type === "speed:fly").enabled).toBe(false);
		expect(loaded2.getSpeedByType("fly")).toBe(0);
	});
});

describe("Bug 9 — migration does not over-reach", () => {
	test("an unconditional 'speed equal to walk' grant saved enabled stays enabled", () => {
		const state = new CharacterSheetState();
		state.setSpeed("walk", 30);
		state.addFeature({
			name: "Natural Climber",
			source: "TEST",
			featureType: "Species",
			description: "You have a Climbing Speed equal to your walking speed.",
		});
		const json = state.toJson();
		const climbMod = json.namedModifiers.find(m => m.type === "speed:climb");
		expect(climbMod.enabled).toBe(true); // permanent grant, enabled

		const loaded = new CharacterSheetState();
		loaded.loadFromJson(json);
		const reloaded = loaded._data.namedModifiers.find(m => m.type === "speed:climb");
		expect(reloaded.enabled).toBe(true);
		expect(loaded.getSpeedByType("climb")).toBe(30);
	});
});
