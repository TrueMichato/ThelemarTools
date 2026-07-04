/**
 * Character Sheet — Tempest Domain (Cleric) feature wiring tests.
 *
 * Regression coverage for the three Tempest calculation flags that used to be SET in
 * getFeatureCalculations but never consumed (hasWrathOfTheStorm / hasDestructiveWrath /
 * hasThunderboltStrike). They are now emitted as standardized effect objects by the CLERIC
 * block of _aggregateCalculationBasedEffects, so every downstream surface can read them.
 */

import "./setup.js";
import "../../../js/charactersheet/charactersheet-state.js";

const CharacterSheetState = globalThis.CharacterSheetState;

function mkTempest (level, {wis = 16} = {}) {
	const state = new CharacterSheetState();
	state.setAbilityBase("wis", wis);
	state.addClass({
		name: "Cleric",
		source: "PHB",
		level,
		subclass: {name: "Tempest Domain", shortName: "Tempest", source: "PHB"},
	});
	return state;
}

function tempestEffects (state) {
	const calcs = state.getFeatureCalculations();
	return state._aggregateFeatureEffects(calcs);
}

describe("Tempest Domain — feature wiring", () => {
	describe("Wrath of the Storm (L1)", () => {
		it("emits a reaction effect with WIS-mod uses and long-rest recharge", () => {
			const state = mkTempest(1, {wis: 16}); // WIS 16 => +3
			const effects = tempestEffects(state);
			const wrath = effects.find(e => e.type === "reaction" && e.name === "Wrath of the Storm");
			expect(wrath).toBeTruthy();
			expect(wrath.damage).toBe("2d8");
			expect(wrath.damageTypes).toEqual(expect.arrayContaining(["lightning", "thunder"]));
			expect(wrath.uses).toBe(3);
			expect(wrath.recharge).toBe("long");
			expect(wrath.source).toBe("Tempest Domain");
		});

		it("uses a minimum of one use even with a non-positive WIS modifier", () => {
			const state = mkTempest(1, {wis: 8}); // WIS 8 => -1, min 1
			const wrath = tempestEffects(state).find(e => e.type === "reaction" && e.name === "Wrath of the Storm");
			expect(wrath).toBeTruthy();
			expect(wrath.uses).toBe(1);
		});
	});

	describe("Destructive Wrath (L2)", () => {
		it("is not present before level 2", () => {
			const effects = tempestEffects(mkTempest(1));
			expect(effects.find(e => e.type === "channelDivinityOption" && e.name === "Destructive Wrath")).toBeFalsy();
		});

		it("emits a Channel-Divinity option that consumes Channel Divinity (no parallel resource)", () => {
			const state = mkTempest(2);
			const opt = tempestEffects(state).find(e => e.type === "channelDivinityOption" && e.name === "Destructive Wrath");
			expect(opt).toBeTruthy();
			expect(opt.consumes).toBe("Channel Divinity");
			// Must NOT mint a parallel "Destructive Wrath" use pool — it spends Channel Divinity.
			const parallel = (state._data.resources || []).find(r => r.name === "Destructive Wrath");
			expect(parallel).toBeFalsy();
		});
	});

	describe("Thunderbolt Strike (L6)", () => {
		it("is not present before level 6", () => {
			const effects = tempestEffects(mkTempest(2));
			expect(effects.find(e => e.type === "pushRider" && e.name === "Thunderbolt Strike")).toBeFalsy();
		});

		it("emits a push rider (10 ft, Large or smaller) keyed off lightning damage", () => {
			const rider = tempestEffects(mkTempest(6)).find(e => e.type === "pushRider" && e.name === "Thunderbolt Strike");
			expect(rider).toBeTruthy();
			expect(rider.push).toBe(10);
			expect(rider.trigger).toBe("lightning damage");
			expect(rider.targetSize).toBe("Large or smaller");
		});
	});

	it("still emits the previously-working Stormborn + proficiency effects", () => {
		const effects = tempestEffects(mkTempest(17));
		expect(effects.find(e => e.type === "speed" && e.source === "Stormborn")).toBeTruthy();
		expect(effects.find(e => e.type === "weaponProficiency" && e.source === "Tempest Domain")).toBeTruthy();
		expect(effects.find(e => e.type === "armorProficiency" && e.source === "Tempest Domain")).toBeTruthy();
	});

	it("does not break applyClassFeatureEffects (inert effect types are ignored)", () => {
		const state = mkTempest(6);
		expect(() => state.applyClassFeatureEffects()).not.toThrow();
	});
});
