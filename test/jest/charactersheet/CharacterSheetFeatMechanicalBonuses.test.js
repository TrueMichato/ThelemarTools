import "./setup.js";
import "../../../js/charactersheet/charactersheet-state.js";

const CharacterSheetState = globalThis.CharacterSheetState;

function makeDraconicSorcerer ({source, level, subclassName}) {
	const state = new CharacterSheetState();
	state.setAbilityBase("dex", 14);
	state.setAbilityBase("cha", 20);
	state.addClass({
		name: "Sorcerer",
		source,
		level,
		subclass: {name: subclassName, source},
	});
	return state;
}

describe("Draconic Resilience AC", () => {
	test.each([
		["PHB", 1, "Draconic Bloodline", 15],
		["XPHB", 3, "Draconic Sorcery", 17],
		["TGTT", 3, "Draconic Sorcery", 17],
	])("%s uses its published unarmored formula", (source, level, subclassName, expected) => {
		const state = makeDraconicSorcerer({source, level, subclassName});

		expect(state.getFeatureCalculations().draconicResilienceAc).toBe(expected);
		expect(state.getAc()).toBe(expected);
		expect(state.getAcBreakdown().total).toBe(expected);
	});

	test.each([
		["PHB", 1, "Draconic Bloodline"],
		["XPHB", 3, "Draconic Sorcery"],
		["TGTT", 3, "Draconic Sorcery"],
	])("%s formula is suppressed by equipped body armor", (source, level, subclassName) => {
		const state = makeDraconicSorcerer({source, level, subclassName});
		state.setArmor({name: "Leather Armor", ac: 11, type: "light"});

		expect(state.getAc()).toBe(13);
		expect(state.getAcBreakdown().total).toBe(13);
	});

	it("selects the best formula when multiclassed with Barbarian or Monk", () => {
		const barbarian = makeDraconicSorcerer({source: "XPHB", level: 3, subclassName: "Draconic Sorcery"});
		barbarian.setAbilityBase("con", 22);
		barbarian.addClass({name: "Barbarian", source: "PHB", level: 1});
		expect(barbarian.getAc()).toBe(18);
		expect(barbarian.getAcBreakdown().total).toBe(18);

		const monk = makeDraconicSorcerer({source: "XPHB", level: 3, subclassName: "Draconic Sorcery"});
		monk.setAbilityBase("wis", 22);
		monk.addClass({name: "Monk", source: "PHB", level: 1});
		expect(monk.getAc()).toBe(18);
		expect(monk.getAcBreakdown().total).toBe(18);
	});

	it("preserves the edition-specific formula across save and reload", () => {
		const state = makeDraconicSorcerer({source: "XPHB", level: 3, subclassName: "Draconic Sorcery"});
		const restored = new CharacterSheetState();
		restored.loadFromJson(state.toJson());

		expect(restored.getAc()).toBe(17);
		expect(restored.getAcBreakdown().total).toBe(17);
	});
});

describe("Speedy walking speed", () => {
	it("applies through every public walking-speed reader and breakdown", () => {
		const state = new CharacterSheetState();
		state.addFeat({name: "Speedy", source: "XPHB"});

		expect(state.getWalkSpeed()).toBe(40);
		expect(state.getSpeedByType("walk")).toBe(40);
		expect(state.getSpeed()).toContain("40 ft.");
		expect(state.getSpeedBreakdown("walk").total).toBe(40);
	});

	it("stacks with Mobile and reverses when removed", () => {
		const state = new CharacterSheetState();
		state.addFeat({name: "Mobile", source: "PHB"});
		state.addFeat({name: "Speedy", source: "XPHB"});

		expect(state.getWalkSpeed()).toBe(50);
		state.removeFeat("Speedy", "XPHB");
		expect(state.getWalkSpeed()).toBe(40);
		state.removeFeat("Mobile", "PHB");
		expect(state.getWalkSpeed()).toBe(30);
	});

	it("survives save and reload without doubling", () => {
		const state = new CharacterSheetState();
		state.addFeat({name: "Speedy", source: "XPHB"});
		const restored = new CharacterSheetState();
		restored.loadFromJson(state.toJson());

		expect(restored.getWalkSpeed()).toBe(40);
		expect(restored.getSpeedBreakdown("walk").total).toBe(40);
	});
});

describe("Metamagic Adept Sorcery Points", () => {
	it("adds to a Sorcerer's calculation and pool, then removes its own capacity without refunding spent points", () => {
		const state = new CharacterSheetState();
		state.addClass({name: "Sorcerer", source: "PHB", level: 5});
		state.addFeat({name: "Metamagic Adept", source: "TCE"});

		expect(state.getFeatureCalculations().sorceryPoints).toBe(7);
		expect(state.getSorceryPoints()).toEqual({current: 7, max: 7});

		expect(state.useSorceryPoint(3)).toBe(true);
		expect(state.getSorceryPoints()).toEqual({current: 4, max: 7});

		state.removeFeat("Metamagic Adept", "TCE");
		expect(state.getFeatureCalculations().sorceryPoints).toBe(5);
		expect(state.getSorceryPoints()).toEqual({current: 2, max: 5});
	});

	it("creates and removes a standalone pool for a non-Sorcerer", () => {
		const state = new CharacterSheetState();
		state.addClass({name: "Wizard", source: "PHB", level: 5});
		state.addFeat({name: "Metamagic Adept", source: "TCE"});

		expect(state.getSorceryPoints()).toEqual({current: 2, max: 2});
		expect(state.useSorceryPoint()).toBe(true);
		expect(state.getSorceryPoints()).toEqual({current: 1, max: 2});

		state.removeFeat("Metamagic Adept", "TCE");
		expect(state.getSorceryPoints()).toEqual({current: 0, max: 0});
		expect(state.getResources().some(resource => resource.name === "Sorcery Points")).toBe(false);
	});

	it("preserves spent points across save and reload without double-applying the feat", () => {
		const state = new CharacterSheetState();
		state.addClass({name: "Sorcerer", source: "PHB", level: 5});
		state.addFeat({name: "Metamagic Adept", source: "TCE"});
		state.useSorceryPoint(3);

		const restored = new CharacterSheetState();
		restored.loadFromJson(state.toJson());

		expect(restored.getFeatureCalculations().sorceryPoints).toBe(7);
		expect(restored.getSorceryPoints()).toEqual({current: 4, max: 7});
	});

	it("migrates an old save that has the feat but not its applied resource bonus", () => {
		const state = new CharacterSheetState();
		state.addClass({name: "Sorcerer", source: "PHB", level: 5});
		state.addFeat({name: "Metamagic Adept", source: "TCE"});
		const json = state.toJson();
		const resource = json.resources.find(it => it.name === "Sorcery Points");
		delete resource._featMaxBonusApplied;
		resource.current = 2;
		resource.max = 5;

		const restored = new CharacterSheetState();
		restored.loadFromJson(json);

		expect(restored.getSorceryPoints()).toEqual({current: 4, max: 7});
	});

	it("does not change Sorcery Points for unrelated feats", () => {
		const state = new CharacterSheetState();
		state.addClass({name: "Sorcerer", source: "PHB", level: 5});
		state.addFeat({name: "Speedy", source: "XPHB"});

		expect(state.getFeatureCalculations().sorceryPoints).toBe(5);
		expect(state.getSorceryPoints()).toEqual({current: 5, max: 5});
	});

	it("preserves explicit pool overrides while applying and removing only the feat delta", () => {
		const state = new CharacterSheetState();
		state.addClass({name: "Sorcerer", source: "PHB", level: 5});
		state.addFeat({name: "Metamagic Adept", source: "TCE"});
		state.setSorceryPoints({current: 1, max: 3});

		expect(state.getSorceryPoints()).toEqual({current: 1, max: 3});
		state.removeFeat("Metamagic Adept", "TCE");
		expect(state.getSorceryPoints()).toEqual({current: 0, max: 1});
	});
});
