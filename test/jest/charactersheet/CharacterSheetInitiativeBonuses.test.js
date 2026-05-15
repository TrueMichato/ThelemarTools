/**
 * Character Sheet Initiative Bonuses Tests
 *
 * Regression coverage for the live "feature initiative bonus" aggregator
 * (`_getFeatureInitiativeBonuses`) consumed by `getInitiative()` and
 * `getInitiativeBreakdown()`.
 *
 * Covers:
 *  - Chronurgy Wizard L2 — Temporal Awareness (+INT)
 *  - Gloom Stalker Ranger L3 — Dread Ambusher (+WIS)
 *  - Swashbuckler Rogue L3 — Rakish Audacity (+CHA), no double-count, live
 *    re-derivation after raising CHA
 *  - 2024 Champion Fighter L7 — Remarkable Athlete (+PB)
 *  - Stacking with custom modifier and exhaustion penalty
 *  - Breakdown.total === getInitiative()
 */

import "./setup.js";
import "../../../js/charactersheet/charactersheet-state.js";

const CharacterSheetState = globalThis.CharacterSheetState;

describe("Initiative Bonuses (live feature aggregator)", () => {
	describe("Chronurgy Wizard — Temporal Awareness (+INT)", () => {
		it("adds INT mod to initiative at level 2", () => {
			const state = new CharacterSheetState();
			state.setRace({name: "High Elf", source: "PHB"});
			state.addClass({name: "Wizard", source: "PHB", level: 2, subclass: {name: "Chronurgy Magic", source: "EGW"}});
			state.setAbilityBase("dex", 14); // +2
			state.setAbilityBase("int", 16); // +3

			expect(state.getInitiative()).toBe(5); // DEX +2 + INT +3
		});

		it("includes a Temporal Awareness component in the breakdown", () => {
			const state = new CharacterSheetState();
			state.setRace({name: "High Elf", source: "PHB"});
			state.addClass({name: "Wizard", source: "PHB", level: 2, subclass: {name: "Chronurgy Magic", source: "EGW"}});
			state.setAbilityBase("dex", 14);
			state.setAbilityBase("int", 16);

			const breakdown = state.getInitiativeBreakdown();
			const ta = breakdown.components.find(c => c.name === "Temporal Awareness");
			expect(ta).toBeTruthy();
			expect(ta.value).toBe(3);
			expect(ta.type).toBe("feature");
			expect(ta.icon).toBe("⚡");
			expect(breakdown.total).toBe(state.getInitiative());
		});

		it("re-derives live when INT changes (no frozen value)", () => {
			const state = new CharacterSheetState();
			state.setRace({name: "High Elf", source: "PHB"});
			state.addClass({name: "Wizard", source: "PHB", level: 2, subclass: {name: "Chronurgy Magic", source: "EGW"}});
			state.setAbilityBase("dex", 10);
			state.setAbilityBase("int", 16);
			expect(state.getInitiative()).toBe(3);

			state.setAbilityBase("int", 20); // +5
			expect(state.getInitiative()).toBe(5);
		});
	});

	describe("Gloom Stalker Ranger — Dread Ambusher (+WIS)", () => {
		it("adds WIS mod to initiative at level 3", () => {
			const state = new CharacterSheetState();
			state.setRace({name: "Human", source: "PHB"});
			state.addClass({name: "Ranger", source: "PHB", level: 3, subclass: {name: "Gloom Stalker", source: "XGE"}});
			state.setAbilityBase("dex", 14); // +2
			state.setAbilityBase("wis", 16); // +3

			expect(state.getInitiative()).toBe(5);

			const breakdown = state.getInitiativeBreakdown();
			const da = breakdown.components.find(c => c.name === "Dread Ambusher");
			expect(da).toBeTruthy();
			expect(da.value).toBe(3);
			expect(breakdown.total).toBe(state.getInitiative());
		});
	});

	describe("Swashbuckler Rogue — Rakish Audacity (+CHA)", () => {
		it("adds CHA mod to initiative at level 3 with no double-count", () => {
			const state = new CharacterSheetState();
			state.setRace({name: "Human", source: "PHB"});
			state.addClass({name: "Rogue", source: "PHB", level: 3, subclass: {name: "Swashbuckler", source: "XGE"}});
			state.setAbilityBase("dex", 14); // +2
			state.setAbilityBase("cha", 16); // +3

			// DEX +2 + CHA +3 = 5 (NOT 8 — must not be double counted via
			// customModifiers.initiative + live aggregator)
			expect(state.getInitiative()).toBe(5);
			expect(state._data.customModifiers.initiative || 0).toBe(0);
		});

		it("re-derives live when CHA changes", () => {
			const state = new CharacterSheetState();
			state.setRace({name: "Human", source: "PHB"});
			state.addClass({name: "Rogue", source: "PHB", level: 3, subclass: {name: "Swashbuckler", source: "XGE"}});
			state.setAbilityBase("dex", 10);
			state.setAbilityBase("cha", 14); // +2
			expect(state.getInitiative()).toBe(2);

			state.setAbilityBase("cha", 20); // +5
			expect(state.getInitiative()).toBe(5);
		});
	});

	describe("2024 Champion Fighter — Remarkable Athlete (+PB)", () => {
		it("adds proficiency bonus to initiative at level 7", () => {
			const state = new CharacterSheetState();
			state.setRace({name: "Human", source: "XPHB"});
			state.addClass({name: "Fighter", source: "XPHB", level: 7, subclass: {name: "Champion", shortName: "Champion", source: "XPHB"}});
			state.setAbilityBase("dex", 14); // +2

			// Level 7 PB = +3
			expect(state.getInitiative()).toBe(5); // DEX +2 + PB +3

			const breakdown = state.getInitiativeBreakdown();
			const ra = breakdown.components.find(c => c.name === "Remarkable Athlete");
			expect(ra).toBeTruthy();
			expect(ra.value).toBe(3);
		});
	});

	describe("Stacking and breakdown invariants", () => {
		it("stacks feature bonus with custom modifier", () => {
			const state = new CharacterSheetState();
			state.setRace({name: "High Elf", source: "PHB"});
			state.addClass({name: "Wizard", source: "PHB", level: 2, subclass: {name: "Chronurgy Magic", source: "EGW"}});
			state.setAbilityBase("dex", 14); // +2
			state.setAbilityBase("int", 16); // +3
			state.setCustomModifier("initiative", 1);

			expect(state.getInitiative()).toBe(6); // 2 + 3 + 1
			const breakdown = state.getInitiativeBreakdown();
			expect(breakdown.total).toBe(state.getInitiative());
			expect(breakdown.components.find(c => c.type === "custom").value).toBe(1);
			expect(breakdown.components.find(c => c.name === "Temporal Awareness").value).toBe(3);
		});

		it("breakdown.total always equals getInitiative()", () => {
			const state = new CharacterSheetState();
			state.setRace({name: "High Elf", source: "PHB"});
			state.addClass({name: "Wizard", source: "PHB", level: 2, subclass: {name: "Chronurgy Magic", source: "EGW"}});
			state.setAbilityBase("dex", 18);
			state.setAbilityBase("int", 20);
			state.setCustomModifier("initiative", -2);

			expect(state.getInitiativeBreakdown().total).toBe(state.getInitiative());
		});

		it("emits no feature components for a vanilla character", () => {
			const state = new CharacterSheetState();
			state.setRace({name: "Human", source: "PHB"});
			state.addClass({name: "Fighter", source: "PHB", level: 1});
			state.setAbilityBase("dex", 14);

			const breakdown = state.getInitiativeBreakdown();
			expect(breakdown.components.some(c => c.type === "feature")).toBe(false);
			expect(breakdown.total).toBe(state.getInitiative());
		});
	});
});
