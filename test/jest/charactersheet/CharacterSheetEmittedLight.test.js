/**
 * CS-BUG-036 — light SHED by an active state must be a real, aggregated,
 * player-visible effect, not dead `getFeatureCalculations()` metadata.
 *
 * Before this suite, Sun Soul's Sun Shield and Light Domain's Corona of Light
 * both computed `*BrightLightRange` / `*DimLightRange` calculations that no
 * renderer and no state consumer ever read, so activating either produced no
 * observable light on the sheet.
 *
 * These tests assert the generic `{type: "light"}` active-state effect and the
 * `getEmittedLight()` aggregator — NOT `getFeatureCalculations()`. Asserting
 * the calculation is exactly what let the bug hide: the calculation was always
 * correct.
 */
import "./setup.js";
import "../../../js/charactersheet/charactersheet-state.js";

const CharacterSheetState = globalThis.CharacterSheetState;

function getSunSoulState (level = 17) {
	const state = new CharacterSheetState();
	state.addClass({
		name: "Monk",
		source: "PHB",
		level,
		subclass: {name: "Way of the Sun Soul", shortName: "Sun Soul", source: "XGE"},
	});
	state.setAbilityBase("wis", 16);
	return state;
}

function getLightClericState (level = 6) {
	const state = new CharacterSheetState();
	state.addClass({
		name: "Cleric",
		source: "XPHB",
		level,
		subclass: {name: "Light Domain", shortName: "Light", source: "XPHB"},
	});
	state.setAbilityBase("wis", 16);
	return state;
}

describe("Emitted light aggregation (CS-BUG-036)", () => {
	it("reports no emitted light on a character with nothing lit", () => {
		const state = getSunSoulState();
		expect(state.getEmittedLight()).toEqual({brightRange: 0, dimRange: 0, sources: []});
	});

	it("declares Sun Shield's light as a real active-state effect", () => {
		const effects = CharacterSheetState.ACTIVE_STATE_TYPES.sunShield.effects;
		expect(effects).toEqual(expect.arrayContaining([
			expect.objectContaining({type: "light", brightRange: 30, dimRange: 60}),
		]));
	});

	it("surfaces Sun Shield's light through getActiveStateEffects with its stateTypeId", () => {
		const state = getSunSoulState();
		state.activateState("sunShield");
		const light = state.getActiveStateEffects()
			.find(e => e.type === "light" && e.stateTypeId === "sunShield");
		expect(light).toBeTruthy();
		expect(light.brightRange).toBe(30);
		expect(light.dimRange).toBe(60);
	});

	it("aggregates Sun Shield into getEmittedLight and names the source", () => {
		const state = getSunSoulState();
		state.activateState("sunShield");
		expect(state.getEmittedLight()).toEqual({
			brightRange: 30,
			dimRange: 60,
			sources: ["Sun Shield"],
		});
	});

	it("stops emitting light once the state is deactivated", () => {
		const state = getSunSoulState();
		state.activateState("sunShield");
		expect(state.getEmittedLight().brightRange).toBe(30);
		state.deactivateState("sunShield");
		expect(state.getEmittedLight()).toEqual({brightRange: 0, dimRange: 0, sources: []});
	});

	it("declares and aggregates Corona of Light (60 ft bright, 90 ft dim total)", () => {
		const state = getLightClericState();
		state.activateState("coronaOfLight");
		expect(state.getEmittedLight()).toEqual({
			brightRange: 60,
			dimRange: 90,
			sources: ["Corona of Light"],
		});
	});

	it("does not stack light — the brightest single source wins in each band", () => {
		const state = getSunSoulState();
		state.activateState("sunShield");
		state.activateState("coronaOfLight");
		const light = state.getEmittedLight();
		// Corona is brighter in both bands; Sun Shield must not add to it.
		expect(light.brightRange).toBe(60);
		expect(light.dimRange).toBe(90);
		expect(light.sources).toEqual(expect.arrayContaining(["Sun Shield", "Corona of Light"]));
	});

	it("floors the dim radius at the bright radius so dim never sits inside bright", () => {
		const state = getSunSoulState();
		state.addActiveState("custom", {
			name: "Malformed Lantern",
			customEffects: [{type: "light", brightRange: 40, dimRange: 10}],
		});
		const light = state.getEmittedLight();
		expect(light.brightRange).toBe(40);
		expect(light.dimRange).toBe(40);
	});

	it("ignores a light effect with no usable ranges", () => {
		const state = getSunSoulState();
		state.addActiveState("custom", {
			name: "Unlit",
			customEffects: [{type: "light", brightRange: 0, dimRange: 0}],
		});
		expect(state.getEmittedLight()).toEqual({brightRange: 0, dimRange: 0, sources: []});
	});

	it("summarizes light in the shared effect summary", () => {
		const summary = CharacterSheetState.summarizeEffects(
			CharacterSheetState.ACTIVE_STATE_TYPES.sunShield.effects,
		);
		expect(summary).toContain("Sheds 30 ft bright light, 60 ft dim light");
		// The pre-existing retaliation summary must survive alongside it.
		expect(summary).toContain("5 + WIS mod radiant damage");
	});

	it("keeps the light ranges consistent with the feature calculations", () => {
		const state = getSunSoulState();
		const calc = state.getFeatureCalculations();
		state.activateState("sunShield");
		const light = state.getEmittedLight();
		// The calculations were always correct — the bug was that nothing read
		// them. Pin the two together so they cannot drift apart again.
		expect(light.brightRange).toBe(calc.sunShieldBrightLightRange);
		expect(light.dimRange).toBe(calc.sunShieldDimLightRange);
	});
});
