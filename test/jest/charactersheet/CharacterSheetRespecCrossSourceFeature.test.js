import "./setup.js";
import fs from "node:fs";
import path from "node:path";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-progression.js";
import "../../../js/charactersheet/charactersheet-state.js";

const CharacterSheetState = globalThis.CharacterSheetState;
const CharacterSheetClassUtils = globalThis.CharacterSheetClassUtils;
const read = file => JSON.parse(fs.readFileSync(path.resolve(process.cwd(), file), "utf8"));
const cleric = read("data/class/class-cleric.json");
const tgtt = read("homebrew/TravelersGuidetoThelemar.json");
const catalogs = {
	classFeatures: [...cleric.classFeature, ...tgtt.classFeature],
	subclassFeatures: [],
	optionalFeatures: [],
};
const divineOrder = cleric.classFeature.find(feature => feature.name === "Divine Order" && feature.source === "XPHB");
const options = CharacterSheetClassUtils.findFeatureOptions(divineOrder, 1, catalogs.classFeatures)[0].options;

function makeState () {
	const state = new CharacterSheetState();
	const data = state.toJson();
	data.classes = [{name: "Cleric", source: "TGTT", level: 1}];
	data.levelHistory = [{
		level: 1,
		class: {name: "Cleric", source: "TGTT"},
		choices: {
			featureChoices: [{
				featureName: "Divine Order",
				choice: "Protector",
				source: "XPHB",
				acquisitionLevel: 1,
				ref: "Protector|Cleric|XPHB|1|XPHB",
				type: "classFeature",
			}],
		},
	}];
	data.features = [
		{
			id: "tgtt-protector",
			name: "Protector",
			source: "XPHB",
			className: "Cleric",
			classSource: "TGTT",
			level: 1,
			acquisitionLevel: 1,
			parentFeature: "Divine Order",
			isFeatureOption: true,
		},
		{
			id: "other-protector",
			name: "Protector",
			source: "XPHB",
			className: "Cleric",
			classSource: "XPHB",
			level: 1,
			acquisitionLevel: 1,
			parentFeature: "Divine Order",
			isFeatureOption: true,
		},
	];
	data.chosenSubfeatures = [
		{parent: "Divine Order", parentSource: "XPHB", parentClass: "Cleric", parentClassSource: "TGTT", level: 1, name: "Protector", source: "XPHB"},
		{parent: "Divine Order", parentSource: "XPHB", parentClass: "Cleric", parentClassSource: "XPHB", level: 1, name: "Protector", source: "XPHB"},
	];
	expect(state.loadFromJson(data)).not.toBe(false);
	return state;
}

function replace (state, name, oldChoice = "Protector") {
	return CharacterSheetClassUtils.replaceStructuredFeatureChoice({
		state,
		characterLevel: 1,
		classLevel: 1,
		className: "Cleric",
		classSource: "TGTT",
		parentFeature: "Divine Order",
		parentSource: "XPHB",
		oldChoice: {...state.getLevelHistoryEntry(1).choices.featureChoices[0], choice: oldChoice},
		newOption: options.find(option => option.name === name),
		catalogs,
		persistHistory: true,
		recalculate: false,
	});
}

describe("Respec cross-source class feature ownership", () => {
	it("replaces the TGTT-owned XPHB option without changing its definition or another owner's feature", () => {
		const state = makeState();
		state._data.resources.push({id: "other-protector-resource", name: "Protector", featureId: "other-protector", current: 1, max: 1});
		state._data.namedModifiers.push({id: "other-protector-modifier", name: "Protector", sourceFeatureId: "other-protector", type: "skill:arcana", value: 1});
		const result = replace(state, "Thaumaturge");
		expect(result.feature).toMatchObject({
			name: "Thaumaturge",
			source: "XPHB",
			className: "Cleric",
			classSource: "TGTT",
			ref: "Thaumaturge|Cleric|XPHB|1|XPHB",
		});
		expect(state.getFeatures()).toEqual(expect.arrayContaining([
			expect.objectContaining({id: "other-protector", classSource: "XPHB"}),
			expect.objectContaining({name: "Thaumaturge", classSource: "TGTT"}),
		]));
		expect(state.getFeatures().some(feature => feature.id === "tgtt-protector")).toBe(false);
		expect(state._data.resources).toEqual(expect.arrayContaining([expect.objectContaining({id: "other-protector-resource"})]));
		expect(state.getNamedModifiers()).toEqual(expect.arrayContaining([expect.objectContaining({id: "other-protector-modifier"})]));
		expect(state._data.chosenSubfeatures).toEqual(expect.arrayContaining([
			expect.objectContaining({parentClassSource: "XPHB", name: "Protector"}),
			expect.objectContaining({parentClassSource: "TGTT", name: "Thaumaturge"}),
		]));
		expect(state._data.chosenSubfeatures.some(choice => choice.parentClassSource === "TGTT" && choice.name === "Protector")).toBe(false);
		expect(state.getLevelHistoryEntry(1).choices).toMatchObject({
			featureChoices: [expect.objectContaining({choice: "Thaumaturge", source: "XPHB"})],
			replayData: {featureChoices: [expect.objectContaining({name: "Thaumaturge", source: "XPHB", classSource: "TGTT"})]},
		});
	});

	it("rolls back a failed materialization without changing either owner or the history", () => {
		const state = makeState();
		const before = state.toJson();
		const addFeature = state.addFeature;
		state.addFeature = () => { throw new Error("Feature materialization failed"); };
		try {
			expect(() => replace(state, "Thaumaturge")).toThrow("Feature materialization failed");
		} finally {
			state.addFeature = addFeature;
		}
		expect(state.toJson()).toEqual(before);
	});

	it("reclaims an old definition-bound feature only when the active class is its unique owner", () => {
		const state = makeState();
		state._data.features = state._data.features
			.filter(feature => feature.id !== "other-protector")
			.map(feature => ({...feature, classSource: "XPHB", ref: "Protector|Cleric|XPHB|1|XPHB"}));
		state._data.features.push({
			id: "other-owner",
			name: "Protector",
			source: "XPHB",
			className: "Paladin",
			classSource: "XPHB",
			acquisitionLevel: 1,
			parentFeature: "Divine Order",
		});

		replace(state, "Thaumaturge");

		expect(state.getFeatures().some(feature => feature.id === "tgtt-protector")).toBe(false);
		expect(state.getFeatures()).toEqual(expect.arrayContaining([
			expect.objectContaining({id: "other-owner", className: "Paladin"}),
			expect.objectContaining({name: "Thaumaturge", classSource: "TGTT"}),
		]));
	});

	it("removes only the chosen owner's legacy feature when both owners lack IDs", () => {
		const state = makeState();
		state._data.features = state._data.features.map(({id, ...feature}) => feature);
		state._data.resources.push({id: "unowned-resource", name: "Unrelated Resource", current: 1, max: 1});
		state._data.attacks.push({id: "unowned-attack", name: "Unrelated Attack"});
		state._data.activeStates.push({id: "unowned-state", type: "rage"});

		replace(state, "Thaumaturge");

		expect(state.getFeatures().filter(feature => feature.name === "Protector")).toEqual([
			expect.objectContaining({classSource: "XPHB", source: "XPHB"}),
		]);
		expect(state.getFeatures()).toEqual(expect.arrayContaining([
			expect.objectContaining({name: "Thaumaturge", classSource: "TGTT"}),
		]));
		expect(state._data.resources).toEqual(expect.arrayContaining([expect.objectContaining({id: "unowned-resource"})]));
		expect(state._data.attacks).toEqual(expect.arrayContaining([expect.objectContaining({id: "unowned-attack"})]));
		expect(state._data.activeStates).toEqual(expect.arrayContaining([expect.objectContaining({id: "unowned-state"})]));
	});
});
