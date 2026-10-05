import "./setup.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-item-utils.js";
import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-inventory.js";

const State = globalThis.CharacterSheetState;
const Inventory = globalThis.CharacterSheetInventory;
const item = (name, extra = {}) => ({id: name, name, source: "DMG", equipped: true, ...extra});
const sum = rows => rows.reduce((total, row) => total + (row.amount || 0), 0);
const project = (state, items) => {
	const inventory = Object.create(Inventory.prototype);
	inventory._state = state;
	const overrides = inventory._getItemAbilityOverrides(items);
	state.setItemAbilityOverrides(overrides);
	return overrides;
};

describe("item ability source projection at the inventory producer", () => {
	test("retains actual additive item names and signed stacking, without mutating inputs", () => {
		const state = new State();
		const items = [item("Strength Charm", {ability: {str: 2}}), item("Cursed Ring", {ability: {str: -1}})];
		const before = JSON.stringify(items);
		const overrides = project(state, items);
		expect(overrides.bonus).toEqual({str: 1});
		expect(overrides.sources.bonus.str.map(source => [source.itemId, source.name, source.amount]))
			.toEqual([["Strength Charm", "Strength Charm", 2], ["Cursed Ring", "Cursed Ring", -1]]);
		const breakdown = state.getAbilityScoreBreakdown("str");
		expect(breakdown.components.filter(row => row.source === "item").map(row => [row.label, row.amount]))
			.toEqual([["Strength Charm", 2], ["Cursed Ring", -1]]);
		expect(sum(breakdown.components)).toBe(11);
		expect(JSON.stringify(items)).toBe(before);
	});

	test("excludes unequipped, unattuned, and unrelated item names", () => {
		const state = new State();
		project(state, [
			item("Active Charm", {ability: {str: 2}}),
			item("Packed Charm", {equipped: false, ability: {str: 4}}),
			item("Dormant Belt", {requiresAttunement: true, attuned: false, ability: {static: {str: 25}}}),
			item("Wisdom Charm", {ability: {wis: 2}}),
			item("Plain Ring"),
		]);
		expect(state.getAbilityScoreBreakdown("str").components.filter(row => row.source.startsWith("item")))
			.toEqual([{source: "item", label: "Active Charm", amount: 2}]);
		expect(state.getAbilityScore("str")).toBe(12);
	});

	test("names only the highest applicable static winner, with its actual stage delta", () => {
		const state = new State();
		state.setAbilityBase("str", 14);
		const overrides = project(state, [
			item("Gauntlets of Ogre Power", {ability: {static: {str: 19}}}),
			item("Belt of Hill Giant Strength", {ability: {static: {str: 21}}}),
			item("Strength Charm", {ability: {str: 2}}),
		]);
		expect(overrides.static).toEqual({str: 21});
		expect(overrides.sources.static.str.name).toBe("Belt of Hill Giant Strength");
		expect(state.getAbilityBonusBreakdown("str").contributions).toEqual([
			{source: "item", label: "Strength Charm", amount: 2},
			{source: "itemStatic", label: "Belt of Hill Giant Strength (set score)", amount: 5},
		]);
		expect(sum(state.getAbilityScoreBreakdown("str").components)).toBe(21);
		state.setAbilityBase("str", 23);
		expect(state.getAbilityBonusBreakdown("str").contributions).toEqual([{source: "item", label: "Strength Charm", amount: 2}]);
	});

	test("keeps the first highest static source on ties", () => {
		const state = new State();
		project(state, [item("First Headband", {ability: {static: {int: 19}}}), item("Second Headband", {ability: {static: {int: 19}}})]);
		expect(state.getAbilityBonusBreakdown("int").contributions)
			.toEqual([{source: "itemStatic", label: "First Headband (set score)", amount: 9}]);
	});

	test("uses selected ability choices alongside direct bonuses from the same item", () => {
		const state = new State();
		const overrides = project(state, [item("Chosen Charm", {
			ability: {str: 1, choose: [{from: ["str", "dex"], amount: 2}]},
			selectedAbilityChoices: [{ability: "str", amount: 2}, {ability: "dex", amount: "1"}, {ability: "unknown", amount: 2}],
		})]);
		expect(overrides.bonus).toEqual({str: 3, dex: 1});
		expect(state.getAbilityBonusBreakdown("str").contributions)
			.toEqual([{source: "item", label: "Chosen Charm", amount: 3}]);
	});

	test("preserves structured precedence and item-local passive prose fallback", () => {
		const state = new State();
		project(state, [
			item("Structured Charm", {ability: {str: 2, static: {int: 19}}, entries: ["While wearing this charm, you gain +5 to your Strength score. Your Intelligence score is 25."]}),
			item("Prose Bracelet", {entries: ["While wearing this bracelet, you gain +1 to your Strength score."]}),
			item("Activated Charm", {entries: ["As a bonus action, your Strength score increases by 4 for 1 minute."]}),
		]);
		expect(state.getAbilityBonusBreakdown("str").contributions).toEqual([
			{source: "item", label: "Structured Charm", amount: 2},
			{source: "item", label: "Prose Bracelet", amount: 1},
		]);
		expect(state.getAbilityBonusBreakdown("int").contributions)
			.toEqual([{source: "itemStatic", label: "Structured Charm (set score)", amount: 9}]);
	});

	test("retains numeric cancellation and caps as separate stages", () => {
		const state = new State();
		state.setAbilityBase("str", 19);
		state.setSetting("enforceAbilityScoreCap", true);
		project(state, [item("Strong Charm", {ability: {str: 3}}), item("Weak Charm", {ability: {str: -1}})]);
		const breakdown = state.getAbilityBonusBreakdown("str");
		expect(breakdown.contributions.map(row => [row.label, row.amount]))
			.toEqual([["Strong Charm", 3], ["Weak Charm", -1], ["Ability Score Cap", -1]]);
		expect(sum(breakdown.contributions)).toBe(breakdown.bonus);
		expect(sum(state.getAbilityScoreBreakdown("str").components)).toBe(20);
		project(state, [item("Strong Charm", {ability: {str: 1}}), item("Weak Charm", {ability: {str: -1}})]);
		expect(state.getAbilityBonusBreakdown("str").contributions.map(row => row.amount)).toEqual([1, -1]);
	});

	test("recomputes names on normal inventory refresh, equip/attune changes, removal and reload", () => {
		const state = new State();
		state.addItem({name: "Headband of Intellect", source: "DMG", ability: {static: {int: 19}}, requiresAttunement: true, equipped: true});
		const id = state.getItems()[0].id;
		const inventory = Object.create(Inventory.prototype);
		inventory._state = state;
		const refresh = () => inventory._updateItemBonuses(inventory._state.getItems());
		refresh();
		expect(state.getAbilityScore("int")).toBe(10);
		state.setItemAttuned(id, true);
		refresh();
		expect(state.getAbilityBonusBreakdown("int").contributions[0].label).toBe("Headband of Intellect (set score)");
		const before = state.serialize();
		state.getAbilityScoreBreakdown("int");
		expect(state.serialize()).toBe(before);
		const loaded = State.deserialize(before);
		inventory._state = loaded;
		refresh();
		expect(loaded.getAbilityScoreBreakdown("int")).toEqual(state.getAbilityScoreBreakdown("int"));
		loaded.setItemEquipped(id, false);
		refresh();
		expect(loaded.getAbilityBonusBreakdown("int").contributions).toEqual([]);
		loaded.removeItem(id);
		refresh();
		expect(loaded.getItemAbilityOverrides()).toBeNull();
	});

	test("keeps legacy aggregate-only payloads factual and numerically reconciled", () => {
		const state = new State();
		state.setItemAbilityOverrides({bonus: {str: 2}, static: {str: 19}});
		expect(state.getAbilityBonusBreakdown("str").contributions).toEqual([
			{source: "item", label: "Item", amount: 2},
			{source: "itemStatic", label: "Item (set score)", amount: 7},
		]);
		expect(sum(state.getAbilityScoreBreakdown("str").components)).toBe(19);
	});
});
