/**
 * Roving / equal-to-walk speed tests (TGTT Ranger round 2, Bug 1)
 *
 * Verifies that "equal to your Speed" clauses (e.g. Ranger's Roving) grant climb/swim
 * speeds generically through the named-modifier pipeline, that those speeds surface even
 * when the base speed of that type is 0, that they update with walking speed, that they
 * tear down cleanly on feature removal, and that an innate speed of the same type survives
 * an add/remove cycle. Also unit-tests the dedicated equal-to-walk clause parser.
 */

import "./setup.js";
import "../../../js/charactersheet/charactersheet-state.js";

const CharacterSheetState = globalThis.CharacterSheetState;
const FeatureModifierParser = globalThis.FeatureModifierParser;

const ROVING_TEXT = "Your Speed increases by 10 feet while you aren't wearing Heavy armor. You also have a Climb Speed and a Swim Speed equal to your Speed.";

describe("Roving / equal-to-walk speeds (Bug 1)", () => {
	let state;

	beforeEach(() => {
		state = new CharacterSheetState();
		state.setSpeed("walk", 30);
	});

	describe("Roving feature (conjoined climb + swim equal to Speed)", () => {
		beforeEach(() => {
			state.addFeature({
				name: "Roving",
				source: "XPHB",
				className: "Ranger",
				description: ROVING_TEXT,
			});
		});

		it("grants both climb and swim speeds equal to walking speed", () => {
			// walk gets the +10 from Roving (no heavy armor) -> 40
			expect(state.getSpeed("walk")).toBe(40);
			expect(state.getSpeed("climb")).toBe(40);
			expect(state.getSpeed("swim")).toBe(40);
		});

		it("surfaces climb and swim in the formatted overview string", () => {
			const formatted = state.getSpeed();
			expect(formatted).toMatch(/climb \d+ ft\./);
			expect(formatted).toMatch(/swim \d+ ft\./);
		});

		it("updates climb and swim when walking speed changes", () => {
			state.setSpeed("walk", 40); // base 40 + 10 Roving = 50
			expect(state.getSpeed("walk")).toBe(50);
			expect(state.getSpeed("climb")).toBe(50);
			expect(state.getSpeed("swim")).toBe(50);
		});

		it("does NOT emit a self-referential walk modifier", () => {
			const walkEqualMods = state.getNamedModifiers().filter(m => m.type === "speed:walk" && m.equalToWalk);
			expect(walkEqualMods).toHaveLength(0);
		});

		it("reverts climb and swim to none when the feature is removed", () => {
			state.removeFeature("Roving", "XPHB");
			expect(state.getSpeed("climb")).toBe(0);
			expect(state.getSpeed("swim")).toBe(0);
			// walk reverts to the base (the +10 Roving bonus is gone too)
			expect(state.getSpeed("walk")).toBe(30);
		});
	});

	describe("innate speed survives Roving add/remove", () => {
		it("keeps an innate climb speed after Roving is removed", () => {
			state.setSpeed("climb", 20); // innate climb (e.g. from race)
			expect(state.getSpeed("climb")).toBe(20);

			state.addFeature({
				name: "Roving",
				source: "XPHB",
				className: "Ranger",
				description: ROVING_TEXT,
			});
			// Roving raises climb to match walking speed (40)
			expect(state.getSpeed("climb")).toBe(40);

			state.removeFeature("Roving", "XPHB");
			// innate climb 20 must survive — not clobbered to 0 or stuck at 40
			expect(state.getSpeed("climb")).toBe(20);
		});
	});

	describe("equal-to-walk clause parser unit", () => {
		it("emits two equalToWalk modifiers (climb + swim) for the conjoined phrasing", () => {
			const mods = FeatureModifierParser.parseModifiers(ROVING_TEXT, "Roving");
			const equalMods = mods.filter(m => m.equalToWalk);
			const types = equalMods.map(m => m.type).sort();
			expect(types).toEqual(["speed:climb", "speed:swim"]);
		});

		it("never emits a speed:walk self-modifier from 'equal to your Speed'", () => {
			const mods = FeatureModifierParser.parseModifiers(ROVING_TEXT, "Roving");
			expect(mods.some(m => m.type === "speed:walk" && m.equalToWalk)).toBe(false);
		});

		it("still parses the legacy single 'gain a swimming speed equal to your walking speed' phrasing", () => {
			const text = "You gain a swimming speed equal to your walking speed.";
			const mods = FeatureModifierParser.parseModifiers(text, "Amphibious");
			const equalMods = mods.filter(m => m.equalToWalk);
			expect(equalMods.map(m => m.type)).toEqual(["speed:swim"]);
		});

		it("parses a fly clause without grabbing climb/swim", () => {
			const text = "You have a flying speed equal to your walking speed.";
			const mods = FeatureModifierParser.parseModifiers(text, "Winged");
			const equalMods = mods.filter(m => m.equalToWalk);
			expect(equalMods.map(m => m.type)).toEqual(["speed:fly"]);
		});
	});
});
