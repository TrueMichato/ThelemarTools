/**
 * Speed breakdown itemization (TGTT Ranger round 3, Bug 1)
 *
 * The speed breakdown used to lump every named speed modifier (Rover/Roving, Pursuit, ...)
 * under a single generic "Custom Modifier" line. These tests verify the breakdown now
 * itemizes one component per *named* speed modifier (by mod.name) while keeping a residual
 * "Custom Modifier" row ONLY when the aggregate total diverges from the itemized sum, and
 * that the invariant breakdown.total === getSpeedByType()/getSpeed() always holds.
 */

import "./setup.js";
import "../../../js/charactersheet/charactersheet-state.js";

const CharacterSheetState = globalThis.CharacterSheetState;

describe("Speed breakdown itemization (Bug 1)", () => {
	let state;

	beforeEach(() => {
		state = new CharacterSheetState();
		state.setSpeed("walk", 40);
	});

	function speedComponentNames (type = "walk") {
		return state.getSpeedBreakdown(type).components.map(c => c.name);
	}

	it("itemizes each named walk speed modifier by its own name (no generic lump)", () => {
		state.addNamedModifier({name: "Roving", type: "speed:walk", value: 10, enabled: true});
		state.addNamedModifier({name: "Pursuit (Predator Focus)", type: "speed:walk", value: 10, enabled: true});

		const breakdown = state.getSpeedBreakdown("walk");
		const names = breakdown.components.map(c => c.name);

		expect(names).toContain("Roving");
		expect(names).toContain("Pursuit (Predator Focus)");
		// No residual generic line when itemized sum equals the aggregate
		expect(names).not.toContain("Custom Modifier");
	});

	it("keeps breakdown.total === getSpeedByType() with itemized modifiers", () => {
		state.addNamedModifier({name: "Roving", type: "speed:walk", value: 10, enabled: true});
		state.addNamedModifier({name: "Pursuit (Predator Focus)", type: "speed:walk", value: 10, enabled: true});

		const breakdown = state.getSpeedBreakdown("walk");
		expect(breakdown.total).toBe(state.getSpeedByType("walk"));
		expect(breakdown.total).toBe(60); // base 40 + 10 + 10
	});

	it("itemizes a single named modifier under its name, not 'Custom Modifier'", () => {
		state.addNamedModifier({name: "Roving", type: "speed:walk", value: 10, enabled: true});

		const names = speedComponentNames("walk");
		expect(names).toContain("Roving");
		expect(names).not.toContain("Custom Modifier");
	});

	it("emits a residual 'Custom Modifier' row ONLY when the aggregate diverges from the itemized sum", () => {
		state.addNamedModifier({name: "Roving", type: "speed:walk", value: 10, enabled: true});
		// Simulate an unnamed/manual remainder by bumping the cached aggregate above the
		// itemized sum (10). The residual (+5) must surface so the total stays correct.
		state._data.customModifiers.speed.walk = 15;

		const breakdown = state.getSpeedBreakdown("walk");
		const residual = breakdown.components.find(c => c.name === "Custom Modifier");
		expect(residual).toBeDefined();
		expect(residual.value).toBe(5);
		// Invariant: itemized (Roving +10) + residual (+5) + base 40 === getSpeedByType
		expect(breakdown.total).toBe(state.getSpeedByType("walk"));
		expect(breakdown.total).toBe(55); // base 40 + 15 aggregate
	});

	it("does NOT emit a residual row when there is no remainder", () => {
		state.addNamedModifier({name: "Roving", type: "speed:walk", value: 10, enabled: true});
		const residual = state.getSpeedBreakdown("walk").components.find(c => c.name === "Custom Modifier");
		expect(residual).toBeUndefined();
	});

	it("skips disabled named modifiers in itemization", () => {
		state.addNamedModifier({name: "Roving", type: "speed:walk", value: 10, enabled: true});
		state.addNamedModifier({name: "Pursuit (Predator Focus)", type: "speed:walk", value: 10, enabled: false});

		const names = speedComponentNames("walk");
		expect(names).toContain("Roving");
		expect(names).not.toContain("Pursuit (Predator Focus)");
		expect(state.getSpeedBreakdown("walk").total).toBe(50); // only the enabled +10 applies
	});

	it("does not treat an equalToWalk modifier as an additive 'custom' itemized bonus", () => {
		state.addNamedModifier({name: "Roving Climb", type: "speed:climb", value: 0, enabled: true, equalToWalk: true});
		const customComps = state.getSpeedBreakdown("climb").components.filter(c => c.type === "custom");
		// equalToWalk grants are surfaced as a "= walking speed" floor (type "feature"),
		// never as an additive custom-modifier row.
		expect(customComps).toHaveLength(0);
	});

	it("represents an equalToWalk grant as a named '= walking speed' component and keeps total === getSpeedByType", () => {
		state.addNamedModifier({name: "Roving Climb", type: "speed:climb", value: 0, enabled: true, equalToWalk: true});

		const breakdown = state.getSpeedBreakdown("climb");
		// The grant surfaces under the granting feature's name, never a bare "Custom Modifier"
		expect(breakdown.components.some(c => /Roving Climb/.test(c.name))).toBe(true);
		expect(breakdown.components.some(c => c.name === "Custom Modifier")).toBe(false);
		// Invariant: the breakdown total matches getSpeedByType (walk floor = 40)
		expect(breakdown.total).toBe(state.getSpeedByType("climb"));
		expect(breakdown.total).toBe(40);
	});

	it("itemizes offsetting named modifiers even when they net to zero (no silent disappearance)", () => {
		state.addNamedModifier({name: "Roving", type: "speed:walk", value: 10, enabled: true});
		state.addNamedModifier({name: "Hobbled", type: "speed:walk", value: -10, enabled: true});

		const names = speedComponentNames("walk");
		expect(names).toContain("Roving");
		expect(names).toContain("Hobbled");
		expect(names).not.toContain("Custom Modifier"); // residual is 0
		expect(state.getSpeedBreakdown("walk").total).toBe(state.getSpeedByType("walk"));
		expect(state.getSpeedBreakdown("walk").total).toBe(40); // base 40 +10 -10
	});

	it("itemizes named modifiers for non-walk speed types", () => {
		state.setSpeed("fly", 30);
		state.addNamedModifier({name: "Zephyr Boots", type: "speed:fly", value: 10, enabled: true});

		const breakdown = state.getSpeedBreakdown("fly");
		const names = breakdown.components.map(c => c.name);
		expect(names).toContain("Zephyr Boots");
		expect(names).not.toContain("Custom Modifier");
		expect(breakdown.total).toBe(state.getSpeedByType("fly"));
	});
});
