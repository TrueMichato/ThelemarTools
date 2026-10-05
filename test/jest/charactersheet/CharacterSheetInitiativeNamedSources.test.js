import "./setup.js";
import fs from "node:fs";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-state.js";

const State = globalThis.CharacterSheetState;
const feats = JSON.parse(fs.readFileSync("data/feats.json", "utf8")).feat;
const alert = source => JSON.parse(JSON.stringify(feats.find(feat => feat.name === "Alert" && feat.source === source)));
const names = state => state.getInitiativeBreakdown().components.map(row => row.name);

describe("initiative attribution of existing named effects", () => {
	test.each([["PHB", 5], ["XPHB", 3]])("real Alert|%s keeps its existing bonus and names its exact owner", (source, value) => {
		const state = new State();
		state.addClass({name: "Fighter", source: "XPHB", level: 5});
		state.setAbilityBase("dex", 14);
		expect(state.addFeat(alert(source))).toBe(true);
		const owned = state.getFeats()[0];
		expect(state.getNamedModifiers().filter(mod => mod.type === "initiative")).toHaveLength(1);
		const before = state.serialize();
		const breakdown = state.getInitiativeBreakdown();
		expect(breakdown.components.filter(row => row.name === "Alert")).toEqual([
			expect.objectContaining({value, sourceFeatureId: owned.id, sourceType: "feat", source, isCanonical: false}),
		]);
		expect(names(state)).not.toContain("Custom Modifier");
		expect(state.getInitiative()).toBe(2 + value);
		expect(breakdown.total).toBe(2 + value);
		expect(breakdown.canonical).toBe(2);
		expect(state.serialize()).toBe(before);
	});

	test("XPHB PB changes live and survives reload/removal without another registration", () => {
		const state = new State();
		state.addClass({name: "Fighter", source: "XPHB", level: 4});
		state.addFeat(alert("XPHB"));
		const id = state.getFeats()[0].id;
		expect(state.getInitiativeBreakdown().components.find(row => row.name === "Alert").value).toBe(2);
		expect(state.levelUp("Fighter")).toBe(true);
		expect(state.getInitiativeBreakdown().components.find(row => row.name === "Alert").value).toBe(3);
		const loaded = State.deserialize(state.serialize());
		expect(loaded.getInitiative()).toBe(3);
		expect(loaded.getInitiativeBreakdown().components.filter(row => row.name === "Alert")).toHaveLength(1);
		loaded.removeFeat(id, "XPHB");
		expect(loaded.getInitiative()).toBe(0);
		expect(names(loaded)).not.toContain("Alert");
	});

	test("preserves disabled flags and names offsetting contributions at a zero aggregate", () => {
		const state = new State();
		const first = state.addNamedModifier({name: "Quick", type: "initiative", value: 2});
		state.addNamedModifier({name: "Slow", type: "initiative", value: -2});
		state.addNamedModifier({name: "Dormant", type: "initiative", value: 10, enabled: false});
		expect(state.getCustomModifier("initiative")).toBe(0);
		expect(state.getInitiativeBreakdown().components.map(row => [row.name, row.value])).toEqual([["Quick", 2], ["Slow", -2]]);
		state.toggleNamedModifier(first);
		expect(state.getInitiativeBreakdown().components.map(row => [row.name, row.value])).toEqual([["Slow", -2]]);
	});

	test("reconciles a genuine custom residual and preserves exhaustion and canonical totals", () => {
		const state = new State();
		state.setAbilityBase("dex", 14);
		state.addFeat(alert("PHB"));
		state.setCustomModifier("initiative", 6);
		state.setSetting("exhaustionRules", "2024");
		state.setExhaustion(1);
		const breakdown = state.getInitiativeBreakdown();
		expect(breakdown.components.map(row => [row.name, row.value]))
			.toEqual([["DEX modifier", 2], ["Alert", 5], ["Custom Modifier", 1], ["Exhaustion", -2]]);
		expect(breakdown.canonical).toBe(2);
		expect(breakdown.total).toBe(6);
		expect(breakdown.total).toBe(state.getInitiative() - state._getExhaustionD20Penalty());
	});

	test("uses the existing effective resolver for per-level/PB/live-ability contributions", () => {
		const state = new State();
		state.addClass({name: "Fighter", source: "XPHB", level: 5});
		state.setAbilityBase("wis", 16);
		state.addNamedModifier({name: "Practice", type: "initiative", value: 1, perLevel: true});
		state.addNamedModifier({name: "Awareness", type: "initiative", value: 0, abilityMod: "wis", proficiencyBonus: true});
		expect(state.getInitiativeBreakdown().components.map(row => [row.name, row.value]))
			.toEqual([["Practice", 5], ["Awareness", 6]]);
		expect(state.getInitiativeBreakdown().total).toBe(state.getInitiative());
	});

	test("names only unconditional contributing channels and preserves conditional opt-in mechanics", () => {
		const state = new State();
		state.addNamedModifier({name: "Every Check", type: "check:all", value: 1});
		state.addNamedModifier({name: "Every Roll", type: "d20:all", value: 2});
		state.addNamedModifier({name: "Conditional", type: "initiative", value: 3, conditional: "while hidden", enabled: false});
		state.addNamedModifier({name: "Advantage Only", type: "initiative:advantage", value: 1});
		const before = state.serialize();
		expect(state.getInitiativeBreakdown().components.map(row => [row.name, row.value]))
			.toEqual([["Every Check", 1], ["Every Roll", 2]]);
		expect(state.aggregateModifiers("initiative").conditionalsAvailable).toEqual([
			expect.objectContaining({name: "Conditional", bonus: 3}),
		]);
		expect(state.getInitiativeBreakdown().total).toBe(3);
		expect(state.serialize()).toBe(before);
	});
});
