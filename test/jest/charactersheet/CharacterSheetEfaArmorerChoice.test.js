import "./setup.js";
import fs from "node:fs";
import {jest} from "@jest/globals";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-progression.js";
import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-quickbuild.js";
import "../../../js/charactersheet/charactersheet-levelup.js";
import "../../../js/charactersheet/charactersheet-respec.js";
import "../../../js/charactersheet/charactersheet-respec-engine.js";

const ClassUtils = globalThis.CharacterSheetClassUtils;
const Progression = globalThis.CharacterSheetProgression;
const CharacterSheetState = globalThis.CharacterSheetState;
const CharacterSheetQuickBuild = globalThis.CharacterSheetQuickBuild;
const CharacterSheetLevelUp = globalThis.CharacterSheetLevelUp;
const CharacterSheetRespec = globalThis.CharacterSheetRespec;

const DATA = JSON.parse(fs.readFileSync("data/class/class-artificer.json", "utf8"));
const EFA_CLASS = DATA.class.find(it => it.name === "Artificer" && it.source === "EFA");
const EFA_ARMORER = DATA.subclass.find(it =>
	it.name === "Armorer"
	&& it.source === "EFA"
	&& it.className === "Artificer"
	&& it.classSource === "EFA");
const EFA_ARMOR_MODEL = DATA.subclassFeature.find(it =>
	it.name === "Armor Model"
	&& it.source === "EFA"
	&& it.className === "Artificer"
	&& it.classSource === "EFA"
	&& it.subclassShortName === "Armorer"
	&& it.subclassSource === "EFA"
	&& it.level === 3);
const TCE_ARMOR_MODEL = DATA.subclassFeature.find(it =>
	it.name === "Armor Model"
	&& it.source === "TCE"
	&& it.className === "Artificer"
	&& it.classSource === "TCE");
const EFA_MODEL_NAMES = ["Dreadnaught", "Guardian", "Infiltrator"];
const EFA_MODEL_REFS = EFA_MODEL_NAMES.map(name => `${name}|Artificer|EFA|Armorer|EFA|3|EFA`);

const copy = value => JSON.parse(JSON.stringify(value));

function getPage (state) {
	return {
		_classFeatures: DATA.classFeature,
		_subclassFeatures: DATA.subclassFeature,
		getState: () => state,
		getClasses: () => DATA.class,
		getClassFeatures: () => DATA.classFeature,
		getSubclassFeatures: () => DATA.subclassFeature,
		getOptionalFeatures: () => [],
		getFeats: () => [],
		getSpells: () => [],
		getFilteredSpellData: () => [],
		getSkillsList: () => [],
		filterByAllowedSources: values => values,
		saveCharacter: jest.fn().mockResolvedValue(undefined),
		renderCharacter: jest.fn(),
		_updateTabVisibility: jest.fn(),
		processPendingFeatureChoices: jest.fn().mockResolvedValue(undefined),
	};
}

function getEfaLevelFeatures (level) {
	return ClassUtils.getLevelFeatures(
		EFA_CLASS,
		level,
		level >= 3 ? EFA_ARMORER : null,
		DATA.classFeature,
		DATA.subclassFeature,
	);
}

function getArmorModelGroup () {
	const groups = ClassUtils.getFeatureOptionsForLevel(getEfaLevelFeatures(3), 3, DATA.classFeature);
	return groups.find(group => group.featureName === "Armor Model");
}

function getArmorOption (name) {
	return getArmorModelGroup().options.find(option => option.name === name);
}

function seedEfaArmorerState ({level = 2} = {}) {
	const state = new CharacterSheetState();
	state._data.classes = [{
		name: "Artificer",
		source: "EFA",
		level,
		...(level >= 3 ? {subclass: {
			name: "Armorer",
			shortName: "Armorer",
			source: "EFA",
		}} : {}),
	}];
	for (let classLevel = 1; classLevel <= level; ++classLevel) {
		state.recordLevelChoice({
			level: classLevel,
			class: {name: "Artificer", source: "EFA"},
			classLevel,
			choices: classLevel === 3
				? {subclass: {name: "Armorer", shortName: "Armorer", source: "EFA"}}
				: {},
			complete: true,
		});
	}
	state.setClassFeatureCatalog(DATA.classFeature, DATA.subclassFeature, []);
	return state;
}

function expectOneModelEverywhere (state, modelName) {
	const models = state.getFeatures().filter(feature =>
		feature.parentFeature === "Armor Model"
		&& feature.source === "EFA"
		&& EFA_MODEL_NAMES.includes(feature.name));
	expect(models).toHaveLength(1);
	expect(models[0].name).toBe(modelName);

	expect(state.getChosenSubfeatures().filter(record =>
		record.parent === "Armor Model"
		&& record.parentSource === "EFA"
		&& record.parentClass === "Artificer"
		&& record.parentClassSource === "EFA"
		&& record.level === 3,
	)).toEqual([
		expect.objectContaining({name: modelName, source: "EFA"}),
	]);

	const history = state.getLevelHistoryEntry(3);
	expect(history.choices.featureChoices.filter(choice => choice.featureName === "Armor Model")).toEqual([
		expect.objectContaining({
			choice: modelName,
			source: "EFA",
			acquisitionLevel: 3,
			ref: `${modelName}|Artificer|EFA|Armorer|EFA|3|EFA`,
			type: "subclassFeature",
		}),
	]);
	expect(history.choices.replayData.featureChoices.filter(choice => choice.parentFeature === "Armor Model")).toEqual([
		expect.objectContaining({name: modelName, source: "EFA", acquisitionLevel: 3}),
	]);

	const decision = history.decisions.find(item =>
		item.type === "featureChoice" && item.sourceKey === "Armor Model");
	expect(decision).toMatchObject({
		status: "resolved",
		required: true,
		count: 1,
		selection: [expect.objectContaining({choice: modelName, source: "EFA"})],
	});
	expect(decision.receipt?.effects).toEqual(expect.arrayContaining([
		expect.objectContaining({
			type: "materialized",
			features: [expect.objectContaining({name: modelName, source: "EFA"})],
		}),
	]));
}

describe("EFA Armorer Armor Model data and discovery", () => {
	it("defines one required three-option group without changing the TCE feature", () => {
		const optionsEntries = EFA_ARMOR_MODEL.entries.filter(entry => entry?.type === "options");
		expect(optionsEntries).toHaveLength(1);
		expect(optionsEntries[0].count).toBe(1);
		expect(optionsEntries[0].entries.map(entry => entry.subclassFeature)).toEqual(EFA_MODEL_REFS);
		expect(EFA_ARMOR_MODEL.entries.slice(0, 3)).toEqual([
			expect.stringContaining("choose one of the following armor models"),
			expect.stringContaining("special weapon"),
			expect.stringContaining("Short Rest"),
		]);

		expect(TCE_ARMOR_MODEL).toBeTruthy();
		expect(TCE_ARMOR_MODEL.entries.some(entry => entry?.type === "options")).toBe(false);
	});

	it("discovers exactly one required group and does not auto-materialize its refs", () => {
		const group = getArmorModelGroup();
		expect(group).toMatchObject({featureName: "Armor Model", featureSource: "EFA", count: 1});
		expect(group.options.map(option => option.name)).toEqual(EFA_MODEL_NAMES);
		expect(group.options.map(option => option.ref)).toEqual(EFA_MODEL_REFS);

		const level3 = getEfaLevelFeatures(3);
		expect(level3.some(feature => feature.name === "Armor Model" && feature.source === "EFA")).toBe(true);
		expect(level3.filter(feature => EFA_MODEL_NAMES.includes(feature.name))).toEqual([]);
	});

	it("does not expose Armor Model in the standard level-1 Builder feature set", () => {
		const level1 = getEfaLevelFeatures(1);
		expect(ClassUtils.getFeatureOptionsForLevel(level1, 1, DATA.classFeature)
			.some(group => group.featureName === "Armor Model")).toBe(false);
	});
});

describe("EFA Armorer Armor Model acquisition flows", () => {
	it("Level Up to Artificer 3 persists exactly one model in runtime, history, replay, and the canonical ledger", async () => {
		const state = seedEfaArmorerState({level: 2});
		const page = getPage(state);
		const levelUp = new CharacterSheetLevelUp(page);
		const classEntry = state.getClasses()[0];
		const guardian = getArmorOption("Guardian");

		await levelUp._applyLevelUp({
			classEntry,
			newLevel: 3,
			asiChoices: null,
			selectedFeat: null,
			selectedSubclass: EFA_ARMORER,
			selectedSubclassChoice: null,
			selectedOptionalFeatures: null,
			selectedCombatTraditions: null,
			selectedWeaponMasteries: null,
			selectedFeatureOptions: {"Armor Model_EFA": [guardian]},
			selectedClassFeatProgression: null,
			selectedExpertise: null,
			selectedLanguages: null,
			languageGrants: [],
			forkedTongueLevelUpPick: null,
			selectedScholarSkill: null,
			selectedSpellbookSpells: [],
			selectedSpellMasterySpells: [],
			selectedSignatureSpells: [],
			selectedKnownSpells: [],
			selectedKnownCantrips: [],
			selectedPreparedSpells: [],
			selectedPreparedCantrips: [],
			stagedSpellSwap: null,
			newFeatures: getEfaLevelFeatures(3),
			hpMethod: "average",
			classData: EFA_CLASS,
		});

		expectOneModelEverywhere(state, "Guardian");
		expect(page.saveCharacter).toHaveBeenCalledTimes(1);
	});

	it("Quick Build to Artificer 3 uses the same transaction and persistence shape", () => {
		const state = seedEfaArmorerState({level: 3});
		const page = getPage(state);
		const quickBuild = new CharacterSheetQuickBuild(page);
		const group = getArmorModelGroup();
		const infiltrator = getArmorOption("Infiltrator");
		const analysis = {
			characterLevel: 3,
			classLevel: 3,
			className: "Artificer",
			classSource: "EFA",
			featureOptions: [group],
			optionalFeatureGains: [],
			classFeatProgressionGains: [],
			expertiseGrants: [],
			languageGrants: [],
			hasAsi: false,
			isScholarLevel: false,
			needsSubclass: true,
		};
		quickBuild._levelAnalysis = [analysis];
		quickBuild._selections.featureOptions = {
			"Artificer_3_Armor Model": [infiltrator],
		};
		quickBuild._selections.subclasses = {"Artificer_EFA": EFA_ARMORER};
		quickBuild._selections.subclassChoices = {};
		quickBuild._selections.optionalFeatures = {};
		quickBuild._selections.classFeatProgression = {};
		quickBuild._selections.expertise = {};
		quickBuild._selections.languages = {};
		quickBuild._selections.asi = {};
		quickBuild._selections.hpRolls = {};

		quickBuild._applyFeatureOptionsForLevel(analysis);
		state.recordLevelChoice(quickBuild._buildHistoryEntry(analysis, "Artificer_3"));
		Progression.syncCanonicalDecisions({page, state});

		expectOneModelEverywhere(state, "Infiltrator");
	});
});

describe("EFA Armorer Armor Model replacement", () => {
	it("Respec atomically replaces model state, history, replay, and receipt through reload", async () => {
		const state = seedEfaArmorerState({level: 3});
		const page = getPage(state);
		const group = getArmorModelGroup();
		const guardian = getArmorOption("Guardian");
		ClassUtils.replaceStructuredFeatureChoice({
			state,
			page,
			characterLevel: 3,
			classLevel: 3,
			className: "Artificer",
			classSource: "EFA",
			subclassName: "Armorer",
			subclassShortName: "Armorer",
			subclassSource: "EFA",
			parentFeature: "Armor Model",
			parentSource: "EFA",
			choiceIndex: 0,
			newOption: guardian,
			catalogs: {
				classFeatures: DATA.classFeature,
				subclassFeatures: DATA.subclassFeature,
				optionalFeatures: [],
			},
			persistHistory: true,
			syncCanonical: true,
		});
		expectOneModelEverywhere(state, "Guardian");

		const respec = new CharacterSheetRespec({page, state});
		respec._engine.begin();
		respec._state = respec._engine.state;
		const history = respec._state.getLevelHistoryEntry(3);
		await respec._applyFeatureChoiceChange(
			3,
			history,
			0,
			history.choices.featureChoices[0],
			group.options.find(option => option.name === "Dreadnaught"),
		);
		expectOneModelEverywhere(respec._state, "Dreadnaught");
		const reloaded = new CharacterSheetState();
		reloaded.setClassFeatureCatalog(DATA.classFeature, DATA.subclassFeature, []);
		expect(reloaded.loadFromJson(copy(respec._state.toJson()))).not.toBe(false);
		reloaded.setClassFeatureCatalog(DATA.classFeature, DATA.subclassFeature, []);
		expectOneModelEverywhere(reloaded, "Dreadnaught");
	});
});

describe("EFA Armorer Armor Model legacy migration", () => {
	function getLegacySave (modelNames) {
		const features = [
			{
				id: "efa-armor-model-parent",
				name: "Armor Model",
				source: "EFA",
				className: "Artificer",
				classSource: "EFA",
				subclassShortName: "Armorer",
				subclassSource: "EFA",
				level: 3,
				entries: copy(EFA_ARMOR_MODEL.entries),
				isSubclassFeature: true,
			},
			...modelNames.map(name => ({
				id: `legacy-${name.toLowerCase()}`,
				...copy(DATA.subclassFeature.find(feature =>
					feature.name === name
					&& feature.source === "EFA"
					&& feature.className === "Artificer"
					&& feature.classSource === "EFA"
					&& feature.subclassShortName === "Armorer"
					&& feature.subclassSource === "EFA"
					&& feature.level === 3)),
				isSubclassFeature: true,
			})),
		];
		return {
			classes: [{
				name: "Artificer",
				source: "EFA",
				level: 3,
				subclass: {name: "Armorer", shortName: "Armorer", source: "EFA"},
			}],
			features,
			levelHistory: [1, 2, 3].map(classLevel => ({
				level: classLevel,
				class: {name: "Artificer", source: "EFA"},
				classLevel,
				choices: {},
				complete: true,
			})),
		};
	}

	it("adopts one exact legacy EFA model into every durable store", () => {
		const state = new CharacterSheetState();
		expect(state.loadFromJson(getLegacySave(["Guardian"]))).not.toBe(false);
		state.setClassFeatureCatalog(DATA.classFeature, DATA.subclassFeature, []);

		expectOneModelEverywhere(state, "Guardian");
		expect(state.getPendingFeatureChoices().filter(choice => choice.featureName === "Armor Model")).toEqual([]);
	});

	it.each([
		["zero models", []],
		["multiple models", EFA_MODEL_NAMES],
	])("turns %s into one required pending decision without auto-grants", (_label, modelNames) => {
		const state = new CharacterSheetState();
		expect(state.loadFromJson(getLegacySave(modelNames))).not.toBe(false);

		expect(state.getFeatures().filter(feature =>
			feature.source === "EFA" && EFA_MODEL_NAMES.includes(feature.name))).toEqual([]);
		expect(state.getChosenSubfeatures().filter(record =>
			record.parent === "Armor Model" && record.parentSource === "EFA")).toEqual([]);

		const pending = state.getPendingFeatureChoices().filter(choice =>
			choice.featureName === "Armor Model"
			&& choice.featureSource === "EFA"
			&& choice.featureClass === "Artificer"
			&& choice.featureClassSource === "EFA");
		expect(pending).toHaveLength(1);
		expect(pending[0]).toMatchObject({
			kind: "subfeature",
			count: 1,
			level: 3,
			characterLevel: 3,
			sourceDecisionKey: "artificer|efa:cl3:featurechoice:armor-model:slot0",
		});
		expect(pending[0].options.map(option => option.ref)).toEqual(EFA_MODEL_REFS);

		const history = state.getLevelHistoryEntry(3);
		expect(history.choices.featureChoices || []).toEqual([]);
		expect(history.choices.replayData.featureChoices || []).toEqual([]);
		expect(history.decisions.find(decision => decision.sourceKey === "Armor Model")).toMatchObject({
			type: "featureChoice",
			required: true,
			count: 1,
			selection: null,
			status: "missing",
			receipt: null,
		});
		expect(history.complete).toBe(false);
	});

	it("does not touch TCE Armorers or same-named TCE feature state", () => {
		const save = {
			classes: [{
				name: "Artificer",
				source: "TCE",
				level: 3,
				subclass: {name: "Armorer", shortName: "Armorer", source: "TCE"},
			}],
			features: [{
				id: "tce-guardian",
				name: "Guardian",
				source: "TCE",
				className: "Artificer",
				classSource: "TCE",
				subclassShortName: "Armorer",
				subclassSource: "TCE",
				level: 3,
			}],
			chosenSubfeatures: [{
				parent: "Armor Model",
				parentSource: "TCE",
				parentClass: "Artificer",
				parentClassSource: "TCE",
				level: 3,
				name: "Guardian",
				source: "TCE",
			}],
		};
		const state = new CharacterSheetState();
		expect(state.loadFromJson(copy(save))).not.toBe(false);

		expect(state.getFeatures()).toEqual(expect.arrayContaining([
			expect.objectContaining({id: "tce-guardian", name: "Guardian", source: "TCE"}),
		]));
		expect(state.getChosenSubfeatures()).toEqual(save.chosenSubfeatures);
		expect(state.getPendingFeatureChoices().filter(choice => choice.featureName === "Armor Model")).toEqual([]);
	});
});
