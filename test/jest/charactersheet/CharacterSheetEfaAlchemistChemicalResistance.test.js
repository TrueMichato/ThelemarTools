import "./setup.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-state.js";

const CharacterSheetState = globalThis.CharacterSheetState;

function makeState ({
	classSource = "EFA",
	subclassName = "Alchemist",
	subclassSource = "EFA",
	level = 15,
} = {}) {
	const state = new CharacterSheetState();
	state.addClass({
		name: "Artificer",
		source: classSource,
		level,
		subclass: subclassName
			? {name: subclassName, shortName: subclassName, source: subclassSource}
			: null,
	});
	return state;
}

function expectChemicalResistance (state, expected) {
	expect(state.hasResistance("acid")).toBe(expected);
	expect(state.hasResistance("poison")).toBe(expected);
	expect(state.isImmuneToCondition("poisoned")).toBe(expected);
}

describe("EFA Alchemist Chemical Resistance", () => {
	it("applies all three level-15 defenses through the shared passive-effect pipeline", () => {
		const state = makeState();

		expect(state.getFeatureCalculations().hasEfaAlchemistChemicalResistance).toBe(true);
		expectChemicalResistance(state, true);
		expect(state.getDefenseBreakdown().resistances).toEqual(expect.arrayContaining([
			expect.objectContaining({type: "acid", source: "Class feature"}),
			expect.objectContaining({type: "poison", source: "Class feature"}),
		]));
	});

	it("gates the defenses by exact level, class source, subclass source, and subclass", () => {
		expectChemicalResistance(makeState({level: 14}), false);
		expectChemicalResistance(makeState({subclassSource: "TCE"}), false);
		expectChemicalResistance(makeState({classSource: "TCE", subclassSource: "TCE"}), false);
		expectChemicalResistance(makeState({subclassName: "Armorer"}), false);
	});

	it("round-trips derived defenses without persisting duplicate mechanic state", () => {
		const original = makeState();
		const saved = original.toJson();
		const loaded = new CharacterSheetState();
		loaded.loadFromJson(saved);

		expectChemicalResistance(loaded, true);
		expect(loaded.getResistances().filter(type => type === "acid")).toHaveLength(1);
		expect(loaded.getResistances().filter(type => type === "poison")).toHaveLength(1);
		expect(loaded.getConditionImmunities().filter(condition => condition === "poisoned")).toHaveLength(1);
	});

	it("removes only the EFA-owned defenses when the parent class is removed", () => {
		const state = makeState();
		state.addResistance("fire");
		state.addConditionImmunity("charmed");

		state.removeClass("Artificer", "EFA");

		expectChemicalResistance(state, false);
		expect(state.hasResistance("fire")).toBe(true);
		expect(state.isImmuneToCondition("charmed")).toBe(true);
	});
});
