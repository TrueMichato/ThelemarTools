/**
 * Aasimar innate-flight bug (round 4, Bug 7)
 *
 * Aasimar (XPHB) grant a Fly Speed equal to their Speed ONLY via the level-3
 * "Celestial Revelation → Heavenly Wings" transformation:
 *   "Until the transformation ends, you have a Fly Speed equal to your Speed."
 *
 * Previously the equal-to-walk grant parsed from that text was added as an
 * ALWAYS-ENABLED named modifier, so a base (un-transformed) Aasimar wrongly
 * showed a flying speed. The fix makes the grant a conditional modifier
 * (disabled by default, toggled on while the transformation mode is active),
 * consistent with every other conditional/mode-gated modifier on the sheet.
 *
 * These tests assert at the state/speed-computation layer (display-agnostic):
 *   - base Aasimar has NO fly speed,
 *   - enabling the mode grants fly = walk (and it tracks walk speed),
 *   - disabling the mode removes it,
 *   - non-transformation equal-to-walk grants are unaffected (still enabled).
 */

import "./setup.js";
import "../../../js/charactersheet/charactersheet-state.js";

const CharacterSheetState = globalThis.CharacterSheetState;

// Tag-stripped form of the real XPHB Aasimar "Celestial Revelation" text (incl. the
// Heavenly Wings option). Mirrors what the feature description carries at runtime.
const AASIMAR_CELESTIAL_REVELATION = "When you reach character level 3, you can transform as a Bonus Action "
	+ "using one of the options below (choose the option each time you transform). The transformation lasts "
	+ "for 1 minute or until you end it (no action required). Once you transform, you can't do so again until "
	+ "you finish a Long Rest. Here are the transformation options: Heavenly Wings. Two spectral wings sprout "
	+ "from your back temporarily. Until the transformation ends, you have a Fly Speed equal to your Speed.";

function makeAasimar (walkSpeed = 30) {
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

function flyMod (state) {
	return (state._data.namedModifiers || []).find(m => m.type === "speed:fly" && m.equalToWalk);
}

describe("Aasimar flight is mode-gated (Bug 7)", () => {
	it("creates the Heavenly Wings fly grant as a DISABLED conditional modifier", () => {
		const state = makeAasimar(30);
		const mod = flyMod(state);
		expect(mod).toBeDefined();
		expect(mod.enabled).toBe(false);
		expect(mod.conditional).toBeTruthy();
		expect(mod.conditional).toMatch(/transformation ends/i);
	});

	it("base (un-transformed) Aasimar has NO fly speed", () => {
		const state = makeAasimar(30);
		expect(state.getSpeedByType("fly")).toBe(0);
		// And it must not leak into the formatted speed string used by the overview line.
		expect(state.getSpeed()).not.toMatch(/fly/i);
	});

	it("activating the transformation grants fly speed equal to walking speed", () => {
		const state = makeAasimar(30);
		state.toggleNamedModifier(flyMod(state).id);
		expect(state.getSpeedByType("fly")).toBe(30);
		expect(state.getSpeed()).toMatch(/fly 30 ft\./);
	});

	it("the granted fly speed tracks the current walking speed while active", () => {
		const state = makeAasimar(30);
		state.toggleNamedModifier(flyMod(state).id);
		expect(state.getSpeedByType("fly")).toBe(30);
		state.setSpeed("walk", 40);
		expect(state.getSpeedByType("fly")).toBe(40);
	});

	it("deactivating the transformation removes the fly speed again", () => {
		const state = makeAasimar(30);
		const id = flyMod(state).id;
		state.toggleNamedModifier(id); // on
		expect(state.getSpeedByType("fly")).toBe(30);
		state.toggleNamedModifier(id); // off
		expect(state.getSpeedByType("fly")).toBe(0);
	});

	it("surfaces no fly component in the speed breakdown until the mode is active", () => {
		const state = makeAasimar(30);
		expect(state.getSpeedBreakdown("fly").total).toBe(0);
		state.toggleNamedModifier(flyMod(state).id);
		const bd = state.getSpeedBreakdown("fly");
		expect(bd.total).toBe(30);
		// Invariant: breakdown total mirrors getSpeedByType.
		expect(bd.total).toBe(state.getSpeedByType("fly"));
	});
});

describe("Conditional gating does not regress unconditional equal-to-walk grants", () => {
	it("a plain 'climbing speed equal to your walking speed' grant stays ENABLED at base", () => {
		const state = new CharacterSheetState();
		state.setSpeed("walk", 30);
		state.addFeature({
			name: "Natural Climber",
			source: "TEST",
			featureType: "Species",
			description: "You have a Climbing Speed equal to your walking speed.",
		});
		const mod = (state._data.namedModifiers || []).find(m => m.type === "speed:climb");
		expect(mod).toBeDefined();
		expect(mod.enabled).toBe(true);
		expect(state.getSpeedByType("climb")).toBe(30);
	});

	it("keeps a permanent grant enabled even when a SEPARATE transformation grant is gated", () => {
		// A feature that grants BOTH a permanent climb speed and a transformation-only fly speed.
		// The permanent climb must stay enabled; only the transformation fly must be gated off.
		const state = new CharacterSheetState();
		state.setSpeed("walk", 30);
		state.addFeature({
			name: "Mixed Grant",
			source: "TEST",
			featureType: "Species",
			description: "You have a Climbing Speed equal to your walking speed. "
				+ "When you reach level 3 you can transform. Until the transformation ends, "
				+ "you have a Fly Speed equal to your Speed.",
		});
		const climbMod = (state._data.namedModifiers || []).find(m => m.type === "speed:climb");
		const flyModifier = (state._data.namedModifiers || []).find(m => m.type === "speed:fly");
		expect(climbMod.enabled).toBe(true);
		expect(flyModifier.enabled).toBe(false);
		expect(state.getSpeedByType("climb")).toBe(30);
		expect(state.getSpeedByType("fly")).toBe(0);
	});
});
