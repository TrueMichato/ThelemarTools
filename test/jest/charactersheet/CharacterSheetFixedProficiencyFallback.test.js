import fs from "node:fs";
import {jest} from "@jest/globals";

import "./setup.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-progression.js";
import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-builder.js";
import "../../../js/charactersheet/charactersheet-levelup.js";
import "../../../js/charactersheet/charactersheet-quickbuild.js";
import "../../../js/charactersheet/charactersheet-respec.js";

const CharacterSheetProgression = globalThis.CharacterSheetProgression;
const CharacterSheetRespec = globalThis.CharacterSheetRespec;
const CharacterSheetState = globalThis.CharacterSheetState;
const CharacterSheetBuilder = globalThis.CharacterSheetBuilder;
const CharacterSheetLevelUp = globalThis.CharacterSheetLevelUp;
const CharacterSheetQuickBuild = globalThis.CharacterSheetQuickBuild;

const ARTILLERIST_UID = "Tools of the Trade|Artificer|EFA|Artillerist|EFA|3|EFA";
const REANIMATOR_UID = "Reanimator's Skill Set|Artificer|EFA|Reanimator|RHW|3|RHW";

const artificerData = JSON.parse(fs.readFileSync("data/class/class-artificer.json", "utf8"));
const ARTIFICER_CLASS = artificerData.class.find(cls => cls.name === "Artificer" && cls.source === "EFA");
const ARTILLERIST = artificerData.subclass.find(subclass =>
	subclass.shortName === "Artillerist"
	&& subclass.source === "EFA"
	&& subclass.className === "Artificer"
	&& subclass.classSource === "EFA",
);

let CharacterSheetPage;

beforeAll(async () => {
	globalThis.window = globalThis.window || {
		addEventListener: () => {},
		dispatchEvent: () => {},
		location: {search: ""},
		matchMedia: () => ({matches: false, addEventListener: () => {}}),
	};
	await import("../../../js/charactersheet/charactersheet.js");
	CharacterSheetPage = globalThis.CharacterSheetPage;
});

const makeToolsFeature = (overrides = {}) => ({
	name: "Tools of the Trade",
	source: "EFA",
	className: "Artificer",
	classSource: "EFA",
	subclassShortName: "Artillerist",
	subclassSource: "EFA",
	level: 3,
	description: "You gain proficiency with Woodcarver's Tools. If you already have this proficiency, you gain proficiency with one other type of Artisan's Tools of your choice.",
	...overrides,
});

const makeReanimatorFeature = (overrides = {}) => ({
	name: "Reanimator's Skill Set",
	source: "RHW",
	className: "Artificer",
	classSource: "EFA",
	subclassShortName: "Reanimator",
	subclassSource: "RHW",
	level: 3,
	description: "You gain proficiency with Alchemist's Supplies. If you already have this proficiency, you gain proficiency with one other type of Artisan's Tools of your choice.",
	...overrides,
});

const addArtificerHistory = (state, subclass) => {
	state.addClass({
		name: "Artificer",
		source: "EFA",
		level: 3,
		subclass,
	});
	for (let level = 1; level <= 3; level++) {
		state.recordLevelChoice({
			level,
			class: {name: "Artificer", source: "EFA"},
			classLevel: level,
			choices: level === 3 ? {subclass} : {},
		});
	}
};

const makeProgressionPage = () => {
	return {
		getClasses: () => [ARTIFICER_CLASS],
		getClassFeatures: () => artificerData.classFeature,
		getSubclassFeatures: () => artificerData.subclassFeature,
		getOptionalFeatures: () => artificerData.optionalfeature || [],
		getFeats: () => [],
		getSkillsList: () => [],
		getSpells: () => [],
		getFilteredSpellData: () => [],
	};
};

const copy = value => JSON.parse(JSON.stringify(value));

const makeArtificerState = ({level, subclass = null}) => {
	const state = new CharacterSheetState();
	state.addClass({
		name: ARTIFICER_CLASS.name,
		source: ARTIFICER_CLASS.source,
		level,
		hitDice: copy(ARTIFICER_CLASS.hd),
		casterProgression: ARTIFICER_CLASS.casterProgression,
		spellcastingAbility: ARTIFICER_CLASS.spellcastingAbility,
		preparedSpellsProgression: copy(ARTIFICER_CLASS.preparedSpellsProgression),
		cantripProgression: copy(ARTIFICER_CLASS.cantripProgression),
		subclass: subclass
			? {
				name: subclass.name,
				shortName: subclass.shortName,
				source: subclass.source,
				casterProgression: subclass.casterProgression,
				spellcastingAbility: subclass.spellcastingAbility,
				additionalSpells: copy(subclass.additionalSpells),
			}
			: null,
	});
	for (let characterLevel = 1; characterLevel <= level; characterLevel++) {
		state.recordLevelChoice({
			level: characterLevel,
			class: {name: ARTIFICER_CLASS.name, source: ARTIFICER_CLASS.source},
			classLevel: characterLevel,
			choices: subclass && characterLevel === 3
				? {subclass: {name: subclass.name, shortName: subclass.shortName, source: subclass.source}}
				: {},
			complete: true,
		});
	}
	state.addToolProficiency("Woodcarver's Tools");
	return state;
};

const makeDeferred = () => {
	let resolve;
	const promise = new Promise(resolvePromise => {
		resolve = resolvePromise;
	});
	return {promise, resolve};
};

const flushAsyncWork = async () => {
	await Promise.resolve();
	await new Promise(resolve => setImmediate(resolve));
};

const makeSurfacePage = (state, pickerPromise) => {
	const page = Object.create(CharacterSheetPage.prototype);
	Object.assign(page, {
		_state: state,
		_classFeatures: artificerData.classFeature,
		_subclassFeatures: artificerData.subclassFeature,
		_pPickFeatureChoice: jest.fn(() => pickerPromise),
		getState: () => state,
		getClasses: () => [ARTIFICER_CLASS],
		getClassFeatures: () => artificerData.classFeature,
		getSubclassFeatures: () => artificerData.subclassFeature,
		getOptionalFeatures: () => artificerData.optionalfeature || [],
		getFeats: () => [],
		getSkillsList: () => [],
		getSpells: () => [],
		getFilteredSpellData: () => [],
		filterByAllowedSources: values => values,
		_spells: {processPendingSpellChoices: jest.fn(async () => {})},
		saveCharacter: jest.fn(async () => {}),
		renderCharacter: jest.fn(),
		_updateTabVisibility: jest.fn(),
		showDiceResult: jest.fn(),
		pAnimateDamageDice: jest.fn(async () => {}),
	});
	return page;
};

const makeBuilderSurface = pickerPromise => {
	const state = makeArtificerState({level: 3, subclass: ARTILLERIST});
	expect(state.addFeature(makeToolsFeature({isSubclassFeature: true, subclassName: ARTILLERIST.name}))).toBe(true);
	const page = makeSurfacePage(state, pickerPromise);
	const builder = Object.create(CharacterSheetBuilder.prototype);
	Object.assign(builder, {
		_state: state,
		_page: page,
		_quickBuildTargetLevel: 1,
		_selectedClass: null,
		_selectedSubclass: null,
		_divineSoulAffinity: null,
	});
	return {
		state,
		page,
		run: () => builder._finishCharacterCore(),
	};
};

const makeLevelUpSurface = pickerPromise => {
	const state = makeArtificerState({level: 2});
	const page = makeSurfacePage(state, pickerPromise);
	const levelUp = Object.create(CharacterSheetLevelUp.prototype);
	Object.assign(levelUp, {
		_state: state,
		_page: page,
		_selectedFeatureSkillChoices: {},
	});
	return {
		state,
		page,
		run: () => levelUp._applyLevelUp({
			classEntry: state.getClasses()[0],
			newLevel: 3,
			asiChoices: {},
			selectedFeat: null,
			selectedSubclass: ARTILLERIST,
			selectedSubclassChoice: null,
			selectedOptionalFeatures: {},
			selectedCombatTraditions: null,
			selectedWeaponMasteries: null,
			selectedFeatureOptions: {},
			selectedClassFeatProgression: [],
			selectedExpertise: {},
			selectedLanguages: {},
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
			newFeatures: [makeToolsFeature({isSubclassFeature: true, subclassName: ARTILLERIST.name})],
			hpMethod: "average",
			classData: ARTIFICER_CLASS,
		}),
	};
};

const makeMulticlassLevelUpSurface = pickerPromise => {
	const state = new CharacterSheetState();
	state.addClass({
		name: "Fighter",
		source: "PHB",
		level: 5,
		hitDice: {number: 1, faces: 10},
	});
	state.addClass({
		name: ARTIFICER_CLASS.name,
		source: ARTIFICER_CLASS.source,
		level: 2,
		hitDice: copy(ARTIFICER_CLASS.hd),
		casterProgression: ARTIFICER_CLASS.casterProgression,
		spellcastingAbility: ARTIFICER_CLASS.spellcastingAbility,
		preparedSpellsProgression: copy(ARTIFICER_CLASS.preparedSpellsProgression),
		cantripProgression: copy(ARTIFICER_CLASS.cantripProgression),
		subclass: null,
	});
	for (let characterLevel = 1; characterLevel <= 5; characterLevel++) {
		state.recordLevelChoice({
			level: characterLevel,
			class: {name: "Fighter", source: "PHB"},
			classLevel: characterLevel,
			choices: {},
			complete: true,
		});
	}
	for (let classLevel = 1; classLevel <= 2; classLevel++) {
		state.recordLevelChoice({
			level: 5 + classLevel,
			class: {name: "Artificer", source: "EFA"},
			classLevel,
			choices: {},
			complete: true,
		});
	}
	state.addToolProficiency("Woodcarver's Tools");

	const page = makeSurfacePage(state, pickerPromise);
	const levelUp = Object.create(CharacterSheetLevelUp.prototype);
	Object.assign(levelUp, {
		_state: state,
		_page: page,
		_selectedFeatureSkillChoices: {},
	});
	return {
		state,
		page,
		run: () => levelUp._applyLevelUp({
			classEntry: state.getClasses().find(cls => cls.name === "Artificer" && cls.source === "EFA"),
			newLevel: 3,
			asiChoices: {},
			selectedFeat: null,
			selectedSubclass: ARTILLERIST,
			selectedSubclassChoice: null,
			selectedOptionalFeatures: {},
			selectedCombatTraditions: null,
			selectedWeaponMasteries: null,
			selectedFeatureOptions: {},
			selectedClassFeatProgression: [],
			selectedExpertise: {},
			selectedLanguages: {},
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
			newFeatures: [makeToolsFeature({isSubclassFeature: true, subclassName: ARTILLERIST.name})],
			hpMethod: "average",
			classData: ARTIFICER_CLASS,
		}),
	};
};

const makeQuickBuildSelections = () => ({
	subclasses: {"Artificer_EFA": ARTILLERIST},
	subclassChoices: {},
	asi: {},
	optionalFeatures: {},
	featureOptions: {},
	classFeatProgression: {},
	expertise: {},
	languages: {},
	scholarSkill: null,
	spellbookSpells: [],
	spellMasterySpells: [],
	signatureSpells: [],
	knownSpells: [],
	knownCantrips: [],
	preparedSpells: [],
	preparedCantrips: [],
	hpMethod: "average",
	hpRolls: {},
	weaponMasteries: null,
	_combatTraditions: null,
	_subclassChoiceTraditions: null,
});

const makeQuickBuildSurface = pickerPromise => {
	const state = makeArtificerState({level: 2});
	const page = makeSurfacePage(state, pickerPromise);
	const quickBuild = Object.create(CharacterSheetQuickBuild.prototype);
	const feature = makeToolsFeature({isSubclassFeature: true, subclassName: ARTILLERIST.name});
	Object.assign(quickBuild, {
		_state: state,
		_page: page,
		_fromLevel: 2,
		_targetLevel: 3,
		_classAllocations: [{
			className: "Artificer",
			classSource: "EFA",
			classData: ARTIFICER_CLASS,
		}],
		_selections: makeQuickBuildSelections(),
		_levelAnalysis: [{
			characterLevel: 3,
			className: "Artificer",
			classSource: "EFA",
			classLevel: 3,
			classData: ARTIFICER_CLASS,
			features: [],
			needsSubclass: true,
			hasAsi: false,
			optionalFeatureGains: [],
			featureOptions: [],
			classFeatProgressionGains: [],
			expertiseGrants: [],
			languageGrants: [],
			isScholarLevel: false,
		}],
		_getQuickBuildFeatSelectionIssues: () => [],
		_getLevelFeatures: jest.fn((_classData, level) => level === 3 ? [feature] : []),
		_buildHistoryEntry: analysis => ({
			level: analysis.characterLevel,
			class: {name: analysis.className, source: analysis.classSource},
			classLevel: analysis.classLevel,
			choices: {
				subclass: {
					name: ARTILLERIST.name,
					shortName: ARTILLERIST.shortName,
					source: ARTILLERIST.source,
				},
			},
			complete: true,
		}),
	});
	return {
		state,
		page,
		run: () => quickBuild._applyQuickBuildInner(),
	};
};

const SURFACES = [
	["Builder", makeBuilderSurface],
	["Level Up", makeLevelUpSurface],
	["Quick Build", makeQuickBuildSurface],
];

const expectPendingSurfaceTransaction = ({state, page}) => {
	expect(page._pPickFeatureChoice).toHaveBeenCalledTimes(1);
	expect(page.saveCharacter).not.toHaveBeenCalled();
	expect(page._pPickFeatureChoice.mock.calls[0][0]).toMatchObject({
		featureUid: ARTILLERIST_UID,
		kind: "tool",
		level: 3,
		characterLevel: 3,
	});
	expect(state.getFeatures().filter(feature =>
		CharacterSheetState.getSourceAwareFeatureUid(feature) === ARTILLERIST_UID)).toHaveLength(1);
	expect(state.getFixedProficiencyFallbackTransaction(ARTILLERIST_UID)).toMatchObject({
		mode: "fallback",
		status: "pending",
		selection: null,
	});
};

const expectNoResolvedFallbackDecision = state => {
	expect(state.hasToolProficiency("Smith's Tools")).toBe(false);
	expect(state.getPendingFeatureChoices().filter(choice => choice.featureUid === ARTILLERIST_UID)).toHaveLength(1);
	expect(state.getLevelHistory().flatMap(entry => entry.decisions || [])
		.filter(decision => decision.provenance?.ownerUid === ARTILLERIST_UID)
		.every(decision => decision.status === "missing" && decision.selection == null)).toBe(true);
};

const expectResolvedFallbackDecision = state => {
	expect(state.hasToolProficiency("Smith's Tools")).toBe(true);
	expect(state.getPendingFeatureChoices().filter(choice => choice.featureUid === ARTILLERIST_UID)).toHaveLength(0);
	const transaction = state.getFixedProficiencyFallbackTransaction(ARTILLERIST_UID);
	expect(transaction).toMatchObject({
		mode: "fallback",
		status: "resolved",
		selection: "Smith's Tools",
	});
	const decision = state.getLevelHistory()[2].decisions.find(candidate =>
		candidate.provenance?.ownerUid === ARTILLERIST_UID);
	expect(decision).toMatchObject({
		type: "nestedTool",
		selection: "Smith's Tools",
		characterLevel: 3,
		provenance: {
			ownerUid: ARTILLERIST_UID,
		},
	});
	expect(transaction.decisionSemanticKey).toBe(decision.semanticKey);
};

describe("fixed proficiency with fallback transaction", () => {
	test("publishes exact source-aware registrations, including mixed class/subclass sources", () => {
		expect(CharacterSheetState.getFixedProficiencyFallbackDefinition(makeToolsFeature())).toMatchObject({
			ownerUid: ARTILLERIST_UID,
			fixedProficiency: "Woodcarver's Tools",
			fallbackCatalog: "artisan",
		});
		expect(CharacterSheetState.getFixedProficiencyFallbackDefinition(makeReanimatorFeature())).toMatchObject({
			ownerUid: REANIMATOR_UID,
			owner: {
				classSource: "EFA",
				subclassSource: "RHW",
			},
			fixedProficiency: "Alchemist's Supplies",
		});
		expect(CharacterSheetState.getFixedProficiencyFallbackDefinition({
			...makeToolsFeature(),
			source: "HB",
		})).toBeNull();
	});

	test("grants the fixed proficiency when it was not owned before acquisition", () => {
		const state = new CharacterSheetState();
		state.addFeature(makeToolsFeature());

		expect(state.getFixedProficiencyFallbackTransaction(ARTILLERIST_UID)).toMatchObject({
			ownerUid: ARTILLERIST_UID,
			mode: "fixed",
			status: "resolved",
			selection: "Woodcarver's Tools",
			grantSource: `fixed-proficiency-fallback:${ARTILLERIST_UID.toLowerCase()}`,
		});
		expect(state.hasToolProficiency("Woodcarver's Tools")).toBe(true);
		expect(state.getPendingFeatureChoices().filter(choice => choice.featureUid === ARTILLERIST_UID)).toHaveLength(0);

		const feature = state.getFeatures().find(candidate => candidate.name === "Tools of the Trade");
		state.removeFeature(feature.id);
		expect(state.hasToolProficiency("Woodcarver's Tools")).toBe(false);
		expect(state.getFixedProficiencyFallbackTransaction(ARTILLERIST_UID)).toBeNull();
	});

	test("evaluates prior proficiency before the feature grant and persists the fallback", () => {
		const state = new CharacterSheetState();
		addArtificerHistory(state, {name: "Artillerist", shortName: "Artillerist", source: "EFA"});
		state.addToolProficiency("Woodcarver's Tools");
		state.addFeature(makeToolsFeature());

		const [choice] = state.getPendingFeatureChoices().filter(candidate => candidate.featureUid === ARTILLERIST_UID);
		expect(state.getFixedProficiencyFallbackTransaction(ARTILLERIST_UID)).toMatchObject({
			mode: "fallback",
			status: "pending",
			selection: null,
		});
		expect(choice).toMatchObject({
			featureUid: ARTILLERIST_UID,
			featureClassSource: "EFA",
			featureSubclassSource: "EFA",
			kind: "tool",
			level: 3,
			characterLevel: 3,
		});
		expect(choice.options).not.toContain("Woodcarver's Tools");
		expect(state.fulfillFeatureChoice(choice.id, "Smith's Tools")).toBe(true);
		expect(state.hasToolProficiency("Smith's Tools")).toBe(true);
		expect(state.getFixedProficiencyFallbackTransaction(ARTILLERIST_UID)).toMatchObject({
			mode: "fallback",
			status: "resolved",
			selection: "Smith's Tools",
		});
		const decision = state.getLevelHistory()[2].decisions.find(candidate =>
			candidate.provenance?.ownerUid === ARTILLERIST_UID);
		expect(decision).toMatchObject({
			type: "nestedTool",
			selection: "Smith's Tools",
			provenance: {
				ownerUid: ARTILLERIST_UID,
				identityMode: "opportunity",
			},
		});
	});

	test("supports the mixed-source Reanimator owner without deriving subclass source from EFA", () => {
		const state = new CharacterSheetState();
		addArtificerHistory(state, {name: "Reanimator", shortName: "Reanimator", source: "RHW"});
		state.addToolProficiency("Alchemist's Supplies");
		state.addFeature(makeReanimatorFeature());

		const [choice] = state.getPendingFeatureChoices().filter(candidate => candidate.featureUid === REANIMATOR_UID);
		expect(choice).toMatchObject({
			featureUid: REANIMATOR_UID,
			featureClassSource: "EFA",
			featureSubclass: "Reanimator",
			featureSubclassSource: "RHW",
		});
		expect(state.fulfillFeatureChoice(choice.id, "Weaver's Tools")).toBe(true);
		expect(state.getFixedProficiencyFallbackTransaction(REANIMATOR_UID)).toMatchObject({
			owner: {
				classSource: "EFA",
				subclassSource: "RHW",
			},
			selection: "Weaver's Tools",
		});
	});

	test("isolates same-label cross-source owners and preserves overlapping grants on exact removal", () => {
		const state = new CharacterSheetState();
		state.addFeature(makeToolsFeature());
		state.addFeature({
			...makeToolsFeature(),
			source: "HB",
			className: "Inventor",
			classSource: "HB",
			subclassShortName: "Cannoneer",
			subclassSource: "HB",
		});
		const hb = state.getFeatures().find(feature => feature.source === "HB");
		state.addPendingFeatureChoice({
			featureName: hb.name,
			featureId: hb.id,
			featureSource: hb.source,
			kind: "tool",
			options: ["Mason's Tools", "Weaver's Tools"],
		});
		expect(state.getFeatures().filter(feature => feature.name === "Tools of the Trade")).toHaveLength(2);

		const efa = state.getFeatures().find(feature => feature.source === "EFA");
		state.removeFeature(efa.id);
		expect(state.hasToolProficiency("Woodcarver's Tools")).toBe(true);
		expect(state.getFeatures().find(feature => feature.source === "HB")).toBeTruthy();
		expect(state.getPendingFeatureChoices().filter(choice => choice.featureId === hb.id)).toHaveLength(1);
		expect(state.getFixedProficiencyFallbackTransaction(ARTILLERIST_UID)).toBeNull();
	});

	test("removes only the exact fallback owner and preserves the pre-acquisition proficiency", () => {
		const state = new CharacterSheetState();
		state.addToolProficiency("Woodcarver's Tools");
		state.addFeature(makeToolsFeature());
		const [choice] = state.getPendingFeatureChoices().filter(candidate => candidate.featureUid === ARTILLERIST_UID);
		state.fulfillFeatureChoice(choice.id, "Smith's Tools");

		const feature = state.getFeatures().find(candidate => candidate.name === "Tools of the Trade");
		state.removeFeature(feature.id);

		expect(state.hasToolProficiency("Woodcarver's Tools")).toBe(true);
		expect(state.hasToolProficiency("Smith's Tools")).toBe(false);
		expect(state.getPendingFeatureChoices().filter(candidate => candidate.featureUid === ARTILLERIST_UID)).toHaveLength(0);
		expect(state.getLevelHistory().flatMap(entry => entry.decisions || [])
			.filter(decision => decision.provenance?.ownerUid === ARTILLERIST_UID)).toHaveLength(0);
	});
});

describe("fixed proficiency fallback migration and progression surfaces", () => {
	test("loads resolved fallback provenance idempotently", () => {
		const state = new CharacterSheetState();
		addArtificerHistory(state, {name: "Artillerist", shortName: "Artillerist", source: "EFA"});
		state.addToolProficiency("Woodcarver's Tools");
		state.addFeature(makeToolsFeature());
		const [choice] = state.getPendingFeatureChoices().filter(candidate => candidate.featureUid === ARTILLERIST_UID);
		state.fulfillFeatureChoice(choice.id, "Smith's Tools");

		const restored = new CharacterSheetState();
		expect(restored.loadFromJson(state.toJson())).not.toBe(false);
		const first = restored.getFixedProficiencyFallbackTransaction(ARTILLERIST_UID);
		expect(first).toMatchObject({mode: "fallback", status: "resolved", selection: "Smith's Tools"});
		expect(restored.hasToolProficiency("Smith's Tools")).toBe(true);
		expect(restored.getPendingFeatureChoices().filter(candidate => candidate.featureUid === ARTILLERIST_UID)).toHaveLength(0);

		expect(restored.loadFromJson(restored.toJson())).not.toBe(false);
		expect(restored.getFixedProficiencyFallbackTransaction(ARTILLERIST_UID)).toEqual(first);
		expect(restored._data.grantedProficiencies.tools[
			CharacterSheetState.normalizeToolKey("Smith's Tools")
		].filter(source => source === first.grantSource)).toHaveLength(1);
	});

	test("preserves accepted fixed markers and leaves markerless ownership ambiguous", () => {
		const acceptedFixed = new CharacterSheetState();
		acceptedFixed.addFeature(makeToolsFeature());
		const fixedSave = acceptedFixed.toJson();
		delete fixedSave.fixedProficiencyFallbacks;
		const fixedFeature = fixedSave.features.find(feature => feature.name === "Tools of the Trade");
		delete fixedFeature._fixedProficiencyFallbackOwnerUid;
		fixedFeature._sourceAwareFeatureUid = ARTILLERIST_UID;
		fixedFeature._requiresArtisanToolReplacement = false;

		const restoredFixed = new CharacterSheetState();
		restoredFixed.loadFromJson(fixedSave);
		expect(restoredFixed.getFixedProficiencyFallbackTransaction(ARTILLERIST_UID)).toMatchObject({
			mode: "fixed",
			status: "resolved",
			selection: "Woodcarver's Tools",
		});
		expect(restoredFixed.getPendingFeatureChoices().filter(choice => choice.featureUid === ARTILLERIST_UID)).toHaveLength(0);

		const markerlessSave = acceptedFixed.toJson();
		delete markerlessSave.fixedProficiencyFallbacks;
		const markerlessFeature = markerlessSave.features.find(feature => feature.name === "Tools of the Trade");
		delete markerlessFeature._fixedProficiencyFallbackOwnerUid;
		delete markerlessFeature._sourceAwareFeatureUid;
		delete markerlessFeature._requiresArtisanToolReplacement;
		markerlessSave.pendingFeatureChoices = [];
		markerlessSave.fulfilledFeatureToolChoices = [];
		markerlessSave.grantedProficiencies.tools = {};

		const ambiguous = new CharacterSheetState();
		ambiguous.loadFromJson(markerlessSave);
		expect(ambiguous.getFixedProficiencyFallbackTransaction(ARTILLERIST_UID)).toMatchObject({
			mode: "fallback",
			status: "pending",
			selection: null,
		});
		expect(ambiguous.getPendingFeatureChoices().filter(choice => choice.featureUid === ARTILLERIST_UID)).toHaveLength(1);
	});

	test("adopts an accepted exact-owner fallback decision without guessing by label", () => {
		const state = new CharacterSheetState();
		addArtificerHistory(state, {name: "Artillerist", shortName: "Artillerist", source: "EFA"});
		state.addToolProficiency("Woodcarver's Tools");
		state.addFeature(makeToolsFeature());
		const [choice] = state.getPendingFeatureChoices().filter(candidate => candidate.featureUid === ARTILLERIST_UID);
		state.fulfillFeatureChoice(choice.id, "Smith's Tools");
		const legacy = state.toJson();
		delete legacy.fixedProficiencyFallbacks;
		const feature = legacy.features.find(candidate => candidate.name === "Tools of the Trade");
		delete feature._fixedProficiencyFallbackOwnerUid;
		feature._sourceAwareFeatureUid = ARTILLERIST_UID;
		feature._requiresArtisanToolReplacement = true;

		const restored = new CharacterSheetState();
		restored.loadFromJson(legacy);
		expect(restored.getFixedProficiencyFallbackTransaction(ARTILLERIST_UID)).toMatchObject({
			mode: "fallback",
			status: "resolved",
			selection: "Smith's Tools",
			characterLevel: 3,
		});
		expect(restored.getPendingFeatureChoices().filter(candidate => candidate.featureUid === ARTILLERIST_UID)).toHaveLength(0);
		expect(restored.hasToolProficiency("Smith's Tools")).toBe(true);
	});

	test("the shared tool picker returns the selected tool name", async () => {
		const page = Object.create(CharacterSheetPage.prototype);
		let clickOption;
		const modalInner = {
			innerHTML: "",
			querySelectorAll: () => [{
				addEventListener: (_eventName, handler) => {
					clickOption = handler;
				},
				getAttribute: () => "0",
			}],
			querySelector: () => ({addEventListener: () => {}}),
		};
		const modalSpy = jest.spyOn(globalThis.CharacterSheetModal, "pGetShow").mockResolvedValue({
			eleModalInner: modalInner,
			doClose: jest.fn(),
		});

		const selectionPromise = page._pPickFeatureChoice({
			id: "tool-choice",
			featureName: "Tools of the Trade",
			kind: "tool",
			options: ["Smith's Tools"],
		});
		await flushAsyncWork();
		clickOption();

		await expect(selectionPromise).resolves.toBe("Smith's Tools");
		modalSpy.mockRestore();
	});

	test("surfaces and edits the exact fallback at level 3 through Respec", () => {
		const state = new CharacterSheetState();
		addArtificerHistory(state, {name: "Reanimator", shortName: "Reanimator", source: "RHW"});
		state.addToolProficiency("Alchemist's Supplies");
		state.addFeature(makeReanimatorFeature());

		const manifest = CharacterSheetProgression.buildManifest({
			page: makeProgressionPage(),
			state,
		});
		const decision = manifest.decisions.find(candidate =>
			candidate.type === "nestedTool"
				&& candidate.provenance?.ownerUid === REANIMATOR_UID);
		expect(decision).toMatchObject({
			characterLevel: 3,
			className: "Artificer",
			classSource: "EFA",
			status: "missing",
			required: true,
			provenance: {
				ownerUid: REANIMATOR_UID,
				acquisitionKey: REANIMATOR_UID,
			},
		});

		const respec = Object.create(CharacterSheetRespec.prototype);
		respec._state = state;
		respec._applyDecisionMechanicsProficiencies(decision, ["Smith's Tools"], decision.options, state);
		expect(state.getFixedProficiencyFallbackTransaction(REANIMATOR_UID)).toMatchObject({
			status: "resolved",
			selection: "Smith's Tools",
			decisionSemanticKey: decision.semanticKey,
		});
		expect(state.hasToolProficiency("Smith's Tools")).toBe(true);

		decision.selection = ["Smith's Tools"];
		decision.status = "resolved";
		state.initializeProgressionOwnership({decisions: [decision]});
		respec._applyDecisionMechanicsProficiencies(decision, ["Weaver's Tools"], decision.options, state);
		expect(state.hasToolProficiency("Smith's Tools")).toBe(false);
		expect(state.hasToolProficiency("Weaver's Tools")).toBe(true);
		expect(state.getFixedProficiencyFallbackTransaction(REANIMATOR_UID).selection).toBe("Weaver's Tools");
	});

	test("Respec replacement preserves a same-value proficiency owned by another exact feature", () => {
		const state = new CharacterSheetState();
		addArtificerHistory(state, {name: "Artillerist", shortName: "Artillerist", source: "EFA"});
		state.addToolProficiency("Woodcarver's Tools");
		state.addFeature(makeToolsFeature());
		const [choice] = state.getPendingFeatureChoices().filter(candidate => candidate.featureUid === ARTILLERIST_UID);
		state.fulfillFeatureChoice(choice.id, "Smith's Tools");
		state.addFeature({
			name: "Smith Training",
			source: "HB",
			className: "Inventor",
			classSource: "HB",
			level: 3,
			toolProficiencies: ["Smith's Tools"],
			description: "Independent tool training.",
		});

		const decision = state.getLevelHistory()[2].decisions.find(candidate =>
			candidate.provenance?.ownerUid === ARTILLERIST_UID);
		const respec = Object.create(CharacterSheetRespec.prototype);
		respec._state = state;
		respec._applyDecisionMechanicsProficiencies(decision, ["Weaver's Tools"], [
			"Smith's Tools",
			"Weaver's Tools",
		], state);

		expect(state.hasToolProficiency("Smith's Tools")).toBe(true);
		expect(state.hasToolProficiency("Weaver's Tools")).toBe(true);
		expect(state.getFixedProficiencyFallbackTransaction(ARTILLERIST_UID).selection).toBe("Weaver's Tools");
	});
});

describe.each(SURFACES)("%s fixed proficiency fallback integration", (_surfaceName, makeSurface) => {
	let originalDelay;

	beforeEach(() => {
		originalDelay = globalThis.MiscUtil.pDelay;
		globalThis.MiscUtil.pDelay = jest.fn(async () => {});
	});

	afterEach(() => {
		if (originalDelay) globalThis.MiscUtil.pDelay = originalDelay;
		else delete globalThis.MiscUtil.pDelay;
	});

	test("awaits the shared picker and keeps cancellation pending without a selected grant or resolved decision", async () => {
		const deferred = makeDeferred();
		const harness = makeSurface(deferred.promise);
		const operation = harness.run();
		await flushAsyncWork();

		expectPendingSurfaceTransaction(harness);
		expectNoResolvedFallbackDecision(harness.state);

		deferred.resolve(null);
		await operation;

		expectNoResolvedFallbackDecision(harness.state);
		expect(harness.state.getFixedProficiencyFallbackTransaction(ARTILLERIST_UID)).toMatchObject({
			status: "pending",
			selection: null,
		});
		expect(harness.page.saveCharacter).toHaveBeenCalledTimes(1);
	});

	test("awaits the shared picker and persists the resolved exact-owner grant and decision", async () => {
		const deferred = makeDeferred();
		const harness = makeSurface(deferred.promise);
		const operation = harness.run();
		await flushAsyncWork();

		expectPendingSurfaceTransaction(harness);
		expectNoResolvedFallbackDecision(harness.state);

		deferred.resolve("Smith's Tools");
		await operation;

		expectResolvedFallbackDecision(harness.state);
		expect(harness.page.saveCharacter).toHaveBeenCalledTimes(2);
	});
});

describe("multiclass fixed proficiency fallback acquisition provenance", () => {
	let originalDelay;

	beforeEach(() => {
		originalDelay = globalThis.MiscUtil.pDelay;
		globalThis.MiscUtil.pDelay = jest.fn(async () => {});
	});

	afterEach(() => {
		if (originalDelay) globalThis.MiscUtil.pDelay = originalDelay;
		else delete globalThis.MiscUtil.pDelay;
	});

	test("records Artificer 3 at character level 8 under the exact subclass parent", async () => {
		const deferred = makeDeferred();
		const harness = makeMulticlassLevelUpSurface(deferred.promise);
		const operation = harness.run();
		await flushAsyncWork();

		const parentSemanticKey = CharacterSheetProgression.getSemanticKey({
			className: "Artificer",
			classSource: "EFA",
			classLevel: 3,
			type: "subclass",
			sourceKey: "subclass",
			slot: 0,
		});
		expect(harness.state.getTotalLevel()).toBe(8);
		expect(harness.state.getFixedProficiencyFallbackTransaction(ARTILLERIST_UID)).toMatchObject({
			characterLevel: 8,
			sourceDecisionKey: parentSemanticKey,
			status: "pending",
		});
		expect(harness.page._pPickFeatureChoice.mock.calls[0][0]).toMatchObject({
			characterLevel: 8,
			sourceDecisionKey: parentSemanticKey,
			featureUid: ARTILLERIST_UID,
		});

		deferred.resolve("Smith's Tools");
		await operation;

		const levelEight = harness.state.getLevelHistory().find(entry => entry.level === 8);
		const parentDecision = levelEight.decisions.find(decision => decision.semanticKey === parentSemanticKey);
		const fallbackDecision = levelEight.decisions.find(decision =>
			decision.provenance?.ownerUid === ARTILLERIST_UID);
		expect(parentDecision).toMatchObject({
			characterLevel: 8,
			className: "Artificer",
			classSource: "EFA",
			classLevel: 3,
			type: "subclass",
			selection: {name: ARTILLERIST.name, source: ARTILLERIST.source},
		});
		expect(fallbackDecision).toMatchObject({
			characterLevel: 8,
			className: "Artificer",
			classSource: "EFA",
			classLevel: 3,
			type: "nestedTool",
			selection: "Smith's Tools",
			parentSemanticKey,
			rootSemanticKey: parentSemanticKey,
			provenance: {
				ownerUid: ARTILLERIST_UID,
				acquisitionKey: ARTILLERIST_UID,
				sourcePath: ARTILLERIST_UID,
			},
		});
		expect(harness.state.getLevelHistory().find(entry => entry.level === 3).decisions
			.filter(decision => decision.provenance?.ownerUid === ARTILLERIST_UID)).toHaveLength(0);
	});
});
