import fs from "node:fs";
import {jest} from "@jest/globals";

import "./setup.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-progression.js";
import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-builder.js";
import "../../../js/charactersheet/charactersheet-levelup.js";
import "../../../js/charactersheet/charactersheet-quickbuild.js";
import "../../../js/charactersheet/charactersheet-respec-engine.js";
import "../../../js/charactersheet/charactersheet-respec.js";

const CharacterSheetBuilder = globalThis.CharacterSheetBuilder;
const CharacterSheetClassUtils = globalThis.CharacterSheetClassUtils;
const CharacterSheetLevelUp = globalThis.CharacterSheetLevelUp;
const CharacterSheetProgression = globalThis.CharacterSheetProgression;
const CharacterSheetQuickBuild = globalThis.CharacterSheetQuickBuild;
const CharacterSheetRespec = globalThis.CharacterSheetRespec;
const CharacterSheetState = globalThis.CharacterSheetState;
const CharacterSheetRespecEngine = globalThis.CharacterSheetRespecEngine;

const ARTIFICER_DATA = JSON.parse(fs.readFileSync("data/class/class-artificer.json", "utf8"));
const XPHB_SPELLS = JSON.parse(fs.readFileSync("data/spells/spells-xphb.json", "utf8")).spell;
const EFA_ARTIFICER = ARTIFICER_DATA.class.find(cls => cls.name === "Artificer" && cls.source === "EFA");
const REANIMATOR = ARTIFICER_DATA.subclass.find(subclass =>
	subclass.name === "Reanimator"
	&& subclass.source === "RHW"
	&& subclass.className === "Artificer"
	&& subclass.classSource === "EFA",
);
const SKILL_SET = ARTIFICER_DATA.subclassFeature.find(feature =>
	feature.name === "Reanimator's Skill Set"
	&& feature.source === "RHW"
	&& feature.className === "Artificer"
	&& feature.classSource === "EFA"
	&& feature.subclassShortName === "Reanimator"
	&& feature.subclassSource === "RHW"
	&& feature.level === 3,
);
const REANIMATOR_LEVEL_THREE_FEATURES = CharacterSheetClassUtils.getLevelFeatures(
	EFA_ARTIFICER,
	3,
	REANIMATOR,
	ARTIFICER_DATA.classFeature,
	ARTIFICER_DATA.subclassFeature,
);

const OWNER_UID = "Reanimator's Skill Set|Artificer|EFA|Reanimator|RHW|3|RHW";
const R2A_SKILL_SET_UID = "Reanimator's Skill Set|Artificer|EFA|Reanimator|RHW|3";
const PARENT_SEMANTIC_KEY = CharacterSheetProgression.getSemanticKey({
	className: "Artificer",
	classSource: "EFA",
	classLevel: 3,
	type: "subclass",
	sourceKey: "subclass",
	slot: 0,
});

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

const copy = value => JSON.parse(JSON.stringify(value));

const subclassSnapshot = (subclass = REANIMATOR, overrides = {}) => ({
	name: subclass.name,
	shortName: subclass.shortName,
	source: subclass.source,
	casterProgression: subclass.casterProgression,
	spellcastingAbility: subclass.spellcastingAbility,
	additionalSpells: copy(subclass.additionalSpells || []),
	...overrides,
});

const artificerClassEntry = (level, {subclass = level >= 3 ? REANIMATOR : null, classSource = "EFA"} = {}) => ({
	name: "Artificer",
	source: classSource,
	level,
	hitDice: copy(EFA_ARTIFICER.hd),
	casterProgression: EFA_ARTIFICER.casterProgression,
	spellcastingAbility: EFA_ARTIFICER.spellcastingAbility,
	preparedSpellsProgression: copy(EFA_ARTIFICER.preparedSpellsProgression),
	cantripProgression: copy(EFA_ARTIFICER.cantripProgression),
	subclass: subclass ? subclassSnapshot(subclass) : null,
});

function recordHistory (state, {fighterLevels = 0, artificerLevel = 3, subclass = REANIMATOR} = {}) {
	for (let level = 1; level <= fighterLevels; level++) {
		state.recordLevelChoice({
			level,
			class: {name: "Fighter", source: "PHB"},
			classLevel: level,
			choices: {},
			complete: true,
		});
	}
	for (let classLevel = 1; classLevel <= artificerLevel; classLevel++) {
		state.recordLevelChoice({
			level: fighterLevels + classLevel,
			class: {name: "Artificer", source: "EFA"},
			classLevel,
			choices: subclass && classLevel === 3
				? {subclass: {name: subclass.name, shortName: subclass.shortName, source: subclass.source}}
				: {},
			complete: true,
		});
	}
}

function addIndependentToolFeature (state, tool, {
	name = `${tool} Training`,
	source = "HB",
	className,
	classSource,
	subclassShortName,
	subclassSource,
} = {}) {
	state.addFeature({
		name,
		source,
		className,
		classSource,
		subclassShortName,
		subclassSource,
		level: 1,
		toolProficiencies: [tool],
		description: "Independent tool training.",
	});
}

function ingestAuthoritativeLevelThreeFeatures (state) {
	state.setClassFeatureCatalog(
		ARTIFICER_DATA.classFeature,
		ARTIFICER_DATA.subclassFeature,
		ARTIFICER_DATA.optionalfeature || [],
	);
	CharacterSheetClassUtils.dedupAndBuildFeatures(
		REANIMATOR_LEVEL_THREE_FEATURES,
		[],
		{className: "Artificer", classSource: "EFA", level: 3},
	).forEach(feature => state.addFeature(feature));
	state.reconcileSubclassFeatureEntries();
}

function makeState ({
	artificerLevel = 3,
	fighterLevels = 0,
	subclass = artificerLevel >= 3 ? REANIMATOR : null,
	independentTools = [],
	ingest = artificerLevel >= 3 && !!subclass,
} = {}) {
	const state = new CharacterSheetState();
	state.setSpellData(XPHB_SPELLS);
	if (fighterLevels) {
		state.addClass({
			name: "Fighter",
			source: "PHB",
			level: fighterLevels,
			hitDice: {number: 1, faces: 10},
		});
	}
	state.addClass(artificerClassEntry(artificerLevel, {subclass}));
	recordHistory(state, {fighterLevels, artificerLevel, subclass});
	independentTools.forEach(tool => addIndependentToolFeature(state, tool));
	if (ingest) ingestAuthoritativeLevelThreeFeatures(state);
	return state;
}

function getExactFeature (state) {
	return state.getFeatures().find(feature =>
		CharacterSheetState.getSourceAwareFeatureUid(feature) === OWNER_UID);
}

function getExactChoice (state) {
	return state.getPendingFeatureChoices().find(choice => choice.featureUid === OWNER_UID);
}

function getExactDecision (state) {
	return state.getLevelHistory().flatMap(entry => entry.decisions || [])
		.find(decision => decision.provenance?.ownerUid === OWNER_UID);
}

function getR2bAtomicState (state) {
	const data = state.toJson();
	const exactDecision = getExactDecision(state);
	return {
		artificerSubclass: data.classes.find(cls =>
			cls.name === "Artificer" && cls.source === "EFA")?.subclass || null,
		exactFeatures: data.features.filter(feature =>
			feature.className === "Artificer"
				&& feature.classSource === "EFA"
				&& (feature.subclassShortName || feature.subclassName) === "Reanimator"
				&& feature.subclassSource === "RHW"),
		transaction: data.fixedProficiencyFallbacks?.[OWNER_UID.toLowerCase()] || null,
		exactDecision: exactDecision ? {
			id: exactDecision.id,
			semanticKey: exactDecision.semanticKey,
			characterLevel: exactDecision.characterLevel,
			className: exactDecision.className,
			classSource: exactDecision.classSource,
			classLevel: exactDecision.classLevel,
			type: exactDecision.type,
			label: exactDecision.label,
			sourceKey: exactDecision.sourceKey,
			slot: exactDecision.slot,
			required: exactDecision.required,
			count: exactDecision.count,
			selection: exactDecision.selection,
			status: exactDecision.status,
			options: exactDecision.options,
			scope: exactDecision.scope,
			parentSemanticKey: exactDecision.parentSemanticKey,
			rootSemanticKey: exactDecision.rootSemanticKey,
			depth: exactDecision.depth,
			provenance: exactDecision.provenance,
		} : null,
		exactChoice: getExactChoice(state) || null,
		fulfilledFeatureToolChoices: (data.fulfilledFeatureToolChoices || [])
			.filter(key => key === `uid:${OWNER_UID.toLowerCase()}`),
		toolProficiencies: data.toolProficiencies,
		grantedToolProficiencies: data.grantedProficiencies?.tools || {},
		progressionToolOwnership: data.progressionOwnership?.values?.tools || {},
	};
}

function resolveFallback (state, tool = "Smith's Tools") {
	const choice = getExactChoice(state);
	expect(choice).toBeTruthy();
	expect(state.fulfillFeatureChoice(choice.id, tool)).toBe(true);
	return state.getFixedProficiencyFallbackTransaction(OWNER_UID);
}

function expectPendingFallback (state, {characterLevel = 3} = {}) {
	const transaction = state.getFixedProficiencyFallbackTransaction(OWNER_UID);
	const choice = getExactChoice(state);
	expect(transaction).toMatchObject({
		ownerUid: OWNER_UID,
		owner: {
			featureName: "Reanimator's Skill Set",
			featureSource: "RHW",
			className: "Artificer",
			classSource: "EFA",
			subclassShortName: "Reanimator",
			subclassSource: "RHW",
			level: 3,
		},
		mode: "fallback",
		status: "pending",
		selection: null,
		characterLevel,
		sourceDecisionKey: PARENT_SEMANTIC_KEY,
	});
	expect(choice).toMatchObject({
		featureUid: OWNER_UID,
		fixedProficiencyFallbackOwnerUid: OWNER_UID,
		featureSource: "RHW",
		featureClass: "Artificer",
		featureClassSource: "EFA",
		featureSubclass: "Reanimator",
		featureSubclassSource: "RHW",
		level: 3,
		characterLevel,
		kind: "tool",
		sourceDecisionKey: PARENT_SEMANTIC_KEY,
	});
	expect(choice.options).not.toContain("Alchemist's Supplies");
	return {transaction, choice};
}

function expectResolvedFallback (state, tool = "Smith's Tools", {characterLevel = 3} = {}) {
	const transaction = state.getFixedProficiencyFallbackTransaction(OWNER_UID);
	const decision = getExactDecision(state);
	expect(transaction).toMatchObject({
		ownerUid: OWNER_UID,
		mode: "fallback",
		status: "resolved",
		selection: tool,
		characterLevel,
		sourceDecisionKey: PARENT_SEMANTIC_KEY,
		decisionSemanticKey: decision.semanticKey,
	});
	expect(decision).toMatchObject({
		type: "nestedTool",
		className: "Artificer",
		classSource: "EFA",
		classLevel: 3,
		characterLevel,
		selection: tool,
		parentSemanticKey: PARENT_SEMANTIC_KEY,
		rootSemanticKey: PARENT_SEMANTIC_KEY,
		provenance: {
			ownerUid: OWNER_UID,
			acquisitionKey: OWNER_UID,
			sourcePath: OWNER_UID,
		},
	});
	expect(state.hasToolProficiency(tool)).toBe(true);
	expect(state.hasFulfilledFeatureToolChoice({featureUid: OWNER_UID})).toBe(true);
	expect(getExactChoice(state)).toBeUndefined();
	return {transaction, decision};
}

function makeProgressionPage (state, pickerPromise = Promise.resolve(null)) {
	const page = Object.create(CharacterSheetPage.prototype);
	Object.assign(page, {
		_state: state,
		_classes: [EFA_ARTIFICER],
		_classFeatures: ARTIFICER_DATA.classFeature,
		_subclassFeatures: ARTIFICER_DATA.subclassFeature,
		_pPickFeatureChoice: jest.fn(() => pickerPromise),
		getState: () => state,
		getClasses: () => [EFA_ARTIFICER],
		getClassFeatures: () => ARTIFICER_DATA.classFeature,
		getSubclassFeatures: () => ARTIFICER_DATA.subclassFeature,
		getOptionalFeatures: () => ARTIFICER_DATA.optionalfeature || [],
		getFeats: () => [],
		getSkillsList: () => [],
		getSpells: () => XPHB_SPELLS,
		getFilteredSpellData: () => XPHB_SPELLS,
		filterByAllowedSources: values => values,
		_spells: {processPendingSpellChoices: jest.fn(async () => {})},
		saveCharacter: jest.fn(async () => {}),
		renderCharacter: jest.fn(),
		_updateTabVisibility: jest.fn(),
		showDiceResult: jest.fn(),
		pAnimateDamageDice: jest.fn(async () => {}),
	});
	return page;
}

function makeDeferred () {
	let resolve;
	const promise = new Promise(resolvePromise => {
		resolve = resolvePromise;
	});
	return {promise, resolve};
}

async function flushAsyncWork () {
	await Promise.resolve();
	await new Promise(resolve => setImmediate(resolve));
}

function makeBuilderSurface (pickerPromise) {
	const state = makeState({independentTools: ["Alchemist's Supplies", "Brewer's Supplies"]});
	const page = makeProgressionPage(state, pickerPromise);
	const builder = Object.create(CharacterSheetBuilder.prototype);
	Object.assign(builder, {
		_state: state,
		_page: page,
		_quickBuildTargetLevel: 1,
		_selectedClass: null,
		_selectedSubclass: null,
		_divineSoulAffinity: null,
	});
	return {state, page, run: () => builder._finishCharacterCore()};
}

function makeLevelUpSurface (pickerPromise, {fighterLevels = 0} = {}) {
	const state = makeState({
		artificerLevel: 2,
		fighterLevels,
		subclass: null,
		independentTools: ["Alchemist's Supplies", "Brewer's Supplies"],
		ingest: false,
	});
	const page = makeProgressionPage(state, pickerPromise);
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
			selectedSubclass: REANIMATOR,
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
			newFeatures: REANIMATOR_LEVEL_THREE_FEATURES,
			hpMethod: "average",
			classData: EFA_ARTIFICER,
		}),
	};
}

const makeQuickBuildSelections = () => ({
	subclasses: {"Artificer_EFA": REANIMATOR},
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

function makeQuickBuildSurface (pickerPromise) {
	const state = makeState({
		artificerLevel: 2,
		subclass: null,
		independentTools: ["Alchemist's Supplies", "Brewer's Supplies"],
		ingest: false,
	});
	const page = makeProgressionPage(state, pickerPromise);
	const quickBuild = Object.create(CharacterSheetQuickBuild.prototype);
	Object.assign(quickBuild, {
		_state: state,
		_page: page,
		_fromLevel: 2,
		_targetLevel: 3,
		_classAllocations: [{
			className: "Artificer",
			classSource: "EFA",
			classData: EFA_ARTIFICER,
		}],
		_selections: makeQuickBuildSelections(),
		_levelAnalysis: [{
			characterLevel: 3,
			className: "Artificer",
			classSource: "EFA",
			classLevel: 3,
			classData: EFA_ARTIFICER,
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
		_getLevelFeatures: jest.fn((_classData, level) => level === 3 ? REANIMATOR_LEVEL_THREE_FEATURES : []),
		_buildHistoryEntry: analysis => ({
			level: analysis.characterLevel,
			class: {name: analysis.className, source: analysis.classSource},
			classLevel: analysis.classLevel,
			choices: {
				subclass: {
					name: REANIMATOR.name,
					shortName: REANIMATOR.shortName,
					source: REANIMATOR.source,
				},
			},
			complete: true,
		}),
	});
	return {state, page, run: () => quickBuild._applyQuickBuildInner()};
}

const SURFACES = [
	["Builder", makeBuilderSurface],
	["Level Up", makeLevelUpSurface],
	["Quick Build", makeQuickBuildSurface],
];

function resolveFixtureOnlyRespecDecisions (engine) {
	for (const decision of engine.manifest.decisions) decision.status = "resolved";
	expect(engine.getValidation().errors).toEqual([]);
}

function makeRespecPage (state) {
	return {
		getState: () => state,
		getClasses: () => [EFA_ARTIFICER],
		getClassFeatures: () => ARTIFICER_DATA.classFeature,
		getSubclassFeatures: () => ARTIFICER_DATA.subclassFeature,
		getOptionalFeatures: () => ARTIFICER_DATA.optionalfeature || [],
		getFeats: () => [],
		getSkillsList: () => [],
		getSpells: () => XPHB_SPELLS,
		getFilteredSpellData: () => XPHB_SPELLS,
		saveCharacter: jest.fn().mockResolvedValue(undefined),
		renderCharacter: jest.fn(),
	};
}

function makeResolvedFallbackState () {
	const state = makeState({independentTools: ["Alchemist's Supplies"]});
	resolveFallback(state, "Smith's Tools");
	return state;
}

describe("RHW Reanimator R2b authoritative ingestion", () => {
	it("registers the exact mixed-source owner from authoritative data", () => {
		expect(SKILL_SET).toBeTruthy();
		expect(CharacterSheetState.getSourceAwareFeatureUid(SKILL_SET)).toBe(OWNER_UID);
		expect(CharacterSheetState.getFixedProficiencyFallbackDefinition(SKILL_SET)).toMatchObject({
			ownerUid: OWNER_UID,
			owner: {
				name: "Reanimator's Skill Set",
				source: "RHW",
				className: "Artificer",
				classSource: "EFA",
				subclassShortName: "Reanimator",
				subclassSource: "RHW",
				level: 3,
			},
			fixedProficiency: "Alchemist's Supplies",
			fallbackCatalog: "artisan",
		});
	});

	it("direct authoritative ingestion grants fixed mode with exact provenance", () => {
		const state = makeState({ingest: false});
		expect(state.addFeature(copy(SKILL_SET))).toBe(true);

		const feature = getExactFeature(state);
		const transaction = state.getFixedProficiencyFallbackTransaction(OWNER_UID);
		expect(feature).toMatchObject({
			_sourceAwareFeatureUid: OWNER_UID,
			_fixedProficiencyFallbackOwnerUid: OWNER_UID,
			_requiresArtisanToolReplacement: false,
		});
		expect(transaction).toMatchObject({
			ownerUid: OWNER_UID,
			mode: "fixed",
			status: "resolved",
			fixedProficiency: "Alchemist's Supplies",
			selection: "Alchemist's Supplies",
			characterLevel: 3,
			featureId: feature.id,
			sourceDecisionKey: PARENT_SEMANTIC_KEY,
			decisionSemanticKey: null,
		});
		expect(state.hasToolProficiency("Alchemist's Supplies")).toBe(true);
		expect(state._data.grantedProficiencies.tools[
			CharacterSheetState.normalizeToolKey("Alchemist's Supplies")
		]).toEqual([transaction.grantSource]);
		expect(getExactChoice(state)).toBeUndefined();
	});

	it("captures fallback acquisition before prose parsing and excludes owned tools", () => {
		const state = makeState({
			independentTools: ["Alchemist's Supplies", "Brewer's Supplies"],
		});
		const {choice} = expectPendingFallback(state);

		expect(choice.options).not.toContain("Brewer's Supplies");
		expect(choice.options).toContain("Smith's Tools");
		resolveFallback(state, "Smith's Tools");
		expectResolvedFallback(state);
	});

	it("is source-isolated from TCE, wrong-subclass-source, and name-only data", () => {
		const variants = [
			{...copy(SKILL_SET), classSource: "TCE"},
			{...copy(SKILL_SET), subclassSource: "TST"},
			{
				name: "Reanimator's Skill Set",
				entries: copy(SKILL_SET.entries),
			},
		];
		for (const feature of variants) {
			const state = new CharacterSheetState();
			state.addFeature(feature);
			expect(state.getFixedProficiencyFallbackTransaction(feature)).toBeNull();
			expect(state.getToolProficiencies()).toEqual([]);
			expect(state.getPendingFeatureChoices()).toEqual([]);
		}

		const tceState = makeState({subclass: null, ingest: false});
		tceState.getClasses()[0].source = "TCE";
		tceState.getClasses()[0].subclass = subclassSnapshot(REANIMATOR);
		expect(tceState.getFeatureCalculations()).not.toHaveProperty("reanimatorsTools");

		const wrongSubclassState = makeState({subclass: null, ingest: false});
		wrongSubclassState.getClasses()[0].subclass = subclassSnapshot(REANIMATOR, {source: "TST"});
		expect(wrongSubclassState.getFeatureCalculations()).not.toHaveProperty("reanimatorsTools");
	});

	it("reconciles and reloads without duplicate grants, choices, or decisions", () => {
		const state = makeResolvedFallbackState();
		for (let i = 0; i < 3; i++) {
			state.reconcileSubclassFeatureEntries();
			state.applyClassFeatureEffects();
		}
		const before = state.getFixedProficiencyFallbackTransaction(OWNER_UID);
		expect(state.getFeatures().filter(feature =>
			CharacterSheetState.getSourceAwareFeatureUid(feature) === OWNER_UID)).toHaveLength(1);
		expect(state.getPendingFeatureChoices().filter(choice => choice.featureUid === OWNER_UID)).toHaveLength(0);
		expect(state.getLevelHistory().flatMap(entry => entry.decisions || [])
			.filter(decision => decision.provenance?.ownerUid === OWNER_UID)).toHaveLength(1);
		expect(state._data.grantedProficiencies.tools[
			CharacterSheetState.normalizeToolKey("Smith's Tools")
		].filter(source => source === before.grantSource)).toHaveLength(1);

		const loaded = new CharacterSheetState();
		loaded.setSpellData(XPHB_SPELLS);
		expect(loaded.loadFromJson(copy(state.toJson()))).not.toBe(false);
		expect(loaded.getFixedProficiencyFallbackTransaction(OWNER_UID)).toEqual(before);
		expectResolvedFallback(loaded);
	});

	it("migrates an exact-owner resolved fallback without adopting labels", () => {
		const state = makeResolvedFallbackState();
		const legacy = copy(state.toJson());
		delete legacy.fixedProficiencyFallbacks;
		const feature = legacy.features.find(candidate =>
			CharacterSheetState.getSourceAwareFeatureUid(candidate) === OWNER_UID);
		delete feature._fixedProficiencyFallbackOwnerUid;
		feature._sourceAwareFeatureUid = OWNER_UID;
		feature._requiresArtisanToolReplacement = true;

		const restored = new CharacterSheetState();
		restored.setSpellData(XPHB_SPELLS);
		expect(restored.loadFromJson(legacy)).not.toBe(false);
		expectResolvedFallback(restored);

		const wrongLabel = copy(legacy);
		wrongLabel.features = wrongLabel.features.map(candidate =>
			candidate.name === "Reanimator's Skill Set"
				? {...candidate, source: "TST", subclassSource: "TST"}
				: candidate);
		delete wrongLabel.fixedProficiencyFallbacks;
		const isolated = new CharacterSheetState();
		isolated.setSpellData(XPHB_SPELLS);
		expect(isolated.loadFromJson(wrongLabel)).not.toBe(false);
		expect(isolated.getFixedProficiencyFallbackTransaction(OWNER_UID)).toBeNull();
	});

	it("tears down only the exact owner and preserves independent and wrong-source grants", () => {
		const state = makeResolvedFallbackState();
		addIndependentToolFeature(state, "Smith's Tools", {
			name: "Reanimator's Skill Set",
			source: "TST",
			className: "Artificer",
			classSource: "EFA",
			subclassShortName: "Reanimator",
			subclassSource: "TST",
		});
		const beforeFeatureCount = state.getFeatures().length;
		state.removeFeature(getExactFeature(state).id);

		expect(state.getFixedProficiencyFallbackTransaction(OWNER_UID)).toBeNull();
		expect(state.hasToolProficiency("Alchemist's Supplies")).toBe(true);
		expect(state.hasToolProficiency("Smith's Tools")).toBe(true);
		expect(getExactDecision(state)).toBeUndefined();
		expect(getExactChoice(state)).toBeUndefined();
		expect(state.getFeatures()).toHaveLength(beforeFeatureCount - 1);
		expect(state.getFeatures()).toEqual(expect.arrayContaining([
			expect.objectContaining({name: "Reanimator's Skill Set", source: "TST"}),
		]));
	});
});

describe("RHW Reanimator R2b live calculation descriptor", () => {
	it("reports fixed, pending, and resolved generic transaction state without mutation", () => {
		const fixed = makeState();
		const fixedBefore = JSON.stringify(fixed.toJson());
		expect(fixed.getFeatureCalculations().reanimatorsTools).toEqual({
			featureUid: R2A_SKILL_SET_UID,
			ownerUid: OWNER_UID,
			requiredProficiency: "Alchemist's Supplies|XPHB",
			mode: "fixed",
			status: "resolved",
			fixedProficiency: "Alchemist's Supplies",
			selection: "Alchemist's Supplies",
			pending: false,
			resolved: true,
		});
		expect(JSON.stringify(fixed.toJson())).toBe(fixedBefore);

		const fallback = makeState({independentTools: ["Alchemist's Supplies"]});
		expect(fallback.getFeatureCalculations().reanimatorsTools).toMatchObject({
			ownerUid: OWNER_UID,
			mode: "fallback",
			status: "pending",
			fixedProficiency: "Alchemist's Supplies",
			selection: null,
			pending: true,
			resolved: false,
		});
		resolveFallback(fallback, "Smith's Tools");
		expect(fallback.getFeatureCalculations().reanimatorsTools).toMatchObject({
			mode: "fallback",
			status: "resolved",
			selection: "Smith's Tools",
			pending: false,
			resolved: true,
		});
	});
});

describe.each(SURFACES)("%s RHW Reanimator R2b picker integration", (_surfaceName, makeSurface) => {
	let originalDelay;

	beforeEach(() => {
		originalDelay = globalThis.MiscUtil.pDelay;
		globalThis.MiscUtil.pDelay = jest.fn(async () => {});
	});

	afterEach(() => {
		if (originalDelay) globalThis.MiscUtil.pDelay = originalDelay;
		else delete globalThis.MiscUtil.pDelay;
	});

	it("awaits the shared picker and leaves cancellation pending", async () => {
		const deferred = makeDeferred();
		const harness = makeSurface(deferred.promise);
		const operation = harness.run();
		await flushAsyncWork();

		expect(harness.page._pPickFeatureChoice).toHaveBeenCalledTimes(1);
		expect(harness.page.saveCharacter).not.toHaveBeenCalled();
		const choice = harness.page._pPickFeatureChoice.mock.calls[0][0];
		expect(choice).toMatchObject({
			featureUid: OWNER_UID,
			featureClassSource: "EFA",
			featureSubclassSource: "RHW",
			kind: "tool",
		});
		expect(choice.options).not.toContain("Alchemist's Supplies");
		expect(choice.options).not.toContain("Brewer's Supplies");
		expectPendingFallback(harness.state);

		deferred.resolve(null);
		await operation;

		expectPendingFallback(harness.state);
		expect(harness.state.hasToolProficiency("Smith's Tools")).toBe(false);
		expect(getExactDecision(harness.state)?.status).not.toBe("resolved");
	});

	it("persists the shared picker selection and exact progression receipt", async () => {
		const deferred = makeDeferred();
		const harness = makeSurface(deferred.promise);
		const operation = harness.run();
		await flushAsyncWork();

		deferred.resolve("Smith's Tools");
		await operation;

		expectResolvedFallback(harness.state);
		expect(harness.page.saveCharacter).toHaveBeenCalled();
	});
});

describe("RHW Reanimator R2b multiclass provenance", () => {
	let originalDelay;

	beforeEach(() => {
		originalDelay = globalThis.MiscUtil.pDelay;
		globalThis.MiscUtil.pDelay = jest.fn(async () => {});
	});

	afterEach(() => {
		if (originalDelay) globalThis.MiscUtil.pDelay = originalDelay;
		else delete globalThis.MiscUtil.pDelay;
	});

	it("records Fighter 5 / Artificer 3 acquisition at character level 8", async () => {
		const deferred = makeDeferred();
		const harness = makeLevelUpSurface(deferred.promise, {fighterLevels: 5});
		const operation = harness.run();
		await flushAsyncWork();

		expectPendingFallback(harness.state, {characterLevel: 8});
		deferred.resolve("Smith's Tools");
		await operation;

		expectResolvedFallback(harness.state, "Smith's Tools", {characterLevel: 8});
		expect(harness.state.getLevelHistory().find(entry => entry.level === 3).decisions
			.filter(decision => decision.provenance?.ownerUid === OWNER_UID)).toHaveLength(0);
	});
});

describe("RHW Reanimator R2b Respec atomicity", () => {
	it("edits in the candidate, Cancel discards it, Apply persists it, and Undo restores exact state", async () => {
		const liveState = makeResolvedFallbackState();
		const before = JSON.stringify(getR2bAtomicState(liveState));
		const page = makeRespecPage(liveState);
		const engine = new CharacterSheetRespecEngine({page, state: liveState});
		const respec = Object.create(CharacterSheetRespec.prototype);
		respec._engine = engine;

		engine.begin();
		let decision = engine.manifest.decisions.find(candidate =>
			candidate.type === "nestedTool" && candidate.provenance?.ownerUid === OWNER_UID);
		respec._state = engine.state;
		await engine.stageGraphMutation(decision.id, ["Weaver's Tools"], {
			reverseParent: true,
			apply: ({state}) => respec._applyDecisionMechanicsProficiencies(
				decision,
				["Weaver's Tools"],
				decision.options,
				state,
			),
		});
		expect(engine.state.getFixedProficiencyFallbackTransaction(OWNER_UID).selection).toBe("Weaver's Tools");
		expect(liveState.getFixedProficiencyFallbackTransaction(OWNER_UID).selection).toBe("Smith's Tools");
		engine.cancel();
		expect(JSON.stringify(getR2bAtomicState(liveState))).toBe(before);

		engine.begin();
		decision = engine.manifest.decisions.find(candidate =>
			candidate.type === "nestedTool" && candidate.provenance?.ownerUid === OWNER_UID);
		respec._state = engine.state;
		await engine.stageGraphMutation(decision.id, ["Weaver's Tools"], {
			reverseParent: true,
			apply: ({state}) => respec._applyDecisionMechanicsProficiencies(
				decision,
				["Weaver's Tools"],
				decision.options,
				state,
			),
		});
		resolveFixtureOnlyRespecDecisions(engine);
		await expect(engine.apply()).resolves.toBe(true);
		expect(liveState.getFixedProficiencyFallbackTransaction(OWNER_UID)).toMatchObject({
			status: "resolved",
			selection: "Weaver's Tools",
		});
		expect(liveState.hasToolProficiency("Smith's Tools")).toBe(false);
		expect(liveState.hasToolProficiency("Weaver's Tools")).toBe(true);

		await expect(engine.undo()).resolves.toBe(true);
		expect(JSON.stringify(getR2bAtomicState(liveState))).toBe(before);
	});

	it("applies exact removal and Undo restores the transaction, decision, and grants byte-for-byte", async () => {
		const liveState = makeResolvedFallbackState();
		addIndependentToolFeature(liveState, "Smith's Tools", {
			name: "Wrong-Source Reanimator Tool",
			source: "TST",
		});
		const before = JSON.stringify(getR2bAtomicState(liveState));
		const page = makeRespecPage(liveState);
		const engine = new CharacterSheetRespecEngine({page, state: liveState});

		engine.begin();
		const candidate = engine.state;
		candidate.getFeatures()
			.filter(feature =>
				feature.className === "Artificer"
				&& feature.classSource === "EFA"
				&& (feature.subclassShortName || feature.subclassName) === "Reanimator"
				&& feature.subclassSource === "RHW")
			.forEach(feature => candidate.removeFeature(feature.id));
		candidate.getClasses().find(cls => cls.name === "Artificer" && cls.source === "EFA").subclass = null;
		candidate.applyClassFeatureEffects();
		engine.markDirty();
		resolveFixtureOnlyRespecDecisions(engine);

		await expect(engine.apply()).resolves.toBe(true);
		expect(liveState.getFixedProficiencyFallbackTransaction(OWNER_UID)).toBeNull();
		expect(getExactDecision(liveState)).toBeUndefined();
		expect(liveState.hasToolProficiency("Alchemist's Supplies")).toBe(true);
		expect(liveState.hasToolProficiency("Smith's Tools")).toBe(true);

		await expect(engine.undo()).resolves.toBe(true);
		expect(JSON.stringify(getR2bAtomicState(liveState))).toBe(before);
	});

	it("rolls a failed Apply back byte-for-byte across transaction, progression, and proficiency state", async () => {
		const liveState = makeResolvedFallbackState();
		const before = JSON.stringify(getR2bAtomicState(liveState));
		const page = makeRespecPage(liveState);
		page.saveCharacter.mockRejectedValueOnce(new Error("save failed"));
		const engine = new CharacterSheetRespecEngine({page, state: liveState});
		const respec = Object.create(CharacterSheetRespec.prototype);
		respec._engine = engine;

		engine.begin();
		const decision = engine.manifest.decisions.find(candidate =>
			candidate.type === "nestedTool" && candidate.provenance?.ownerUid === OWNER_UID);
		respec._state = engine.state;
		await engine.stageGraphMutation(decision.id, ["Weaver's Tools"], {
			reverseParent: true,
			apply: ({state}) => respec._applyDecisionMechanicsProficiencies(
				decision,
				["Weaver's Tools"],
				decision.options,
				state,
			),
		});
		resolveFixtureOnlyRespecDecisions(engine);

		await expect(engine.apply()).rejects.toThrow("save failed");
		expect(JSON.stringify(getR2bAtomicState(liveState))).toBe(before);
		expect(liveState.getFixedProficiencyFallbackTransaction(OWNER_UID).selection).toBe("Smith's Tools");
		expect(getExactDecision(liveState).selection).toBe("Smith's Tools");
		expect(liveState.hasToolProficiency("Smith's Tools")).toBe(true);
		expect(liveState.hasToolProficiency("Weaver's Tools")).toBe(false);
	});
});

describe("RHW Reanimator R2b scope boundary", () => {
	it("keeps Facilitated Revival non-executable and adds no execution method", () => {
		const state = makeState({artificerLevel: 15});
		expect(state.getRhwFacilitatedRevivalBoundary()).toMatchObject({
			available: true,
			executable: false,
			reason: "pendingSharedToolContract",
		});
		expect(state.pUseRhwFacilitatedRevival).toBeUndefined();
	});
});
