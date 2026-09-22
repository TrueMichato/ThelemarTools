import "./setup.js";
import fs from "node:fs";
import path from "node:path";
import {jest} from "@jest/globals";
import "../../../js/parser.js";
import "../../../js/utils.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-progression.js";
import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-levelup.js";
import "../../../js/charactersheet/charactersheet-quickbuild.js";
import "../../../js/charactersheet/charactersheet-respec.js";
import "../../../js/charactersheet/charactersheet-respec-engine.js";

const CharacterSheetClassUtils = globalThis.CharacterSheetClassUtils;
const CharacterSheetLevelUp = globalThis.CharacterSheetLevelUp;
const CharacterSheetProgression = globalThis.CharacterSheetProgression;
const CharacterSheetQuickBuild = globalThis.CharacterSheetQuickBuild;
const CharacterSheetRespec = globalThis.CharacterSheetRespec;
const CharacterSheetState = globalThis.CharacterSheetState;

const copy = value => JSON.parse(JSON.stringify(value));

const ARTIFICER_DATA = JSON.parse(fs.readFileSync(
	path.resolve(process.cwd(), "data/class/class-artificer.json"),
	"utf8",
));
const FEAT_DATA = JSON.parse(fs.readFileSync(
	path.resolve(process.cwd(), "data/feats.json"),
	"utf8",
));

const EFA_ARTIFICER = ARTIFICER_DATA.class.find(cls => cls.name === "Artificer" && cls.source === "EFA");
const TCE_ARTIFICER = ARTIFICER_DATA.class.find(cls => cls.name === "Artificer" && cls.source === "TCE");
const EFA_EPIC_BOON = ARTIFICER_DATA.classFeature.find(feature =>
	feature.name === "Epic Boon"
		&& feature.className === "Artificer"
		&& feature.classSource === "EFA"
		&& feature.level === 19,
);
const BOON_OF_ENERGY_RESISTANCE = FEAT_DATA.feat.find(feat => feat.name === "Boon of Energy Resistance" && feat.source === "XPHB");
const BOON_OF_SPELL_RECALL = FEAT_DATA.feat.find(feat => feat.name === "Boon of Spell Recall" && feat.source === "XPHB");
const QUALIFIED_GENERAL_FEAT = {
	name: "Verified General Feat",
	source: "TST",
	category: "G",
	prerequisite: [{level: 4}],
	entries: ["A qualifying non-Epic-Boon control feat."],
};
const UNQUALIFIED_GENERAL_FEAT = {
	name: "Unqualified General Feat",
	source: "TST",
	category: "G",
	prerequisite: [{level: 4, ability: [{str: 20}]}],
	entries: ["A negative-control feat."],
};
const FEAT_POOL = [
	BOON_OF_ENERGY_RESISTANCE,
	BOON_OF_SPELL_RECALL,
	QUALIFIED_GENERAL_FEAT,
	UNQUALIFIED_GENERAL_FEAT,
].map(copy);
const EFA_EPIC_BOON_UID = "Epic Boon|Artificer|EFA|19|EFA";
const EFA_EPIC_BOON_DECISION_KEY = "artificer|efa:cl19:feat:epic-boon-or-feat:slot0";

function makePage (state, {classes = [EFA_ARTIFICER, TCE_ARTIFICER], classFeatures = ARTIFICER_DATA.classFeature} = {}) {
	return {
		getState: () => state,
		getClasses: () => classes,
		getClassFeatures: () => classFeatures,
		getSubclassFeatures: () => [],
		getOptionalFeatures: () => [],
		getFeats: () => FEAT_POOL,
		getSpells: () => [],
		getFilteredSpellData: () => [],
		getSkillsList: () => [],
		filterByAllowedSources: values => values,
		saveCharacter: jest.fn().mockResolvedValue(undefined),
		renderCharacter: jest.fn(),
		_updateTabVisibility: jest.fn(),
	};
}

function makeArtificerState (level = 18) {
	const state = new CharacterSheetState();
	state.addClass({
		name: "Artificer",
		source: "EFA",
		level,
		casterProgression: EFA_ARTIFICER.casterProgression,
		spellcastingAbility: EFA_ARTIFICER.spellcastingAbility,
	});
	state.setAbilityBase("int", 18);
	state.setAbilityBase("str", 10);
	state.setSpellcastingAbility("int");
	for (let characterLevel = 1; characterLevel <= level; ++characterLevel) {
		state.recordLevelChoice({
			level: characterLevel,
			class: {name: "Artificer", source: "EFA"},
			classLevel: characterLevel,
			choices: {},
		});
	}
	return state;
}

function analyzeQuickBuildLevel19 (state, page = makePage(state)) {
	const quickBuild = new CharacterSheetQuickBuild(page);
	quickBuild._fromLevel = 18;
	quickBuild._targetLevel = 19;
	quickBuild._classAllocations = [{
		className: "Artificer",
		classSource: "EFA",
		classData: EFA_ARTIFICER,
		currentLevel: 18,
		targetLevel: 19,
	}];
	const analysis = quickBuild._analyzeLevels();
	expect(analysis).toHaveLength(1);
	return {quickBuild, analysis: analysis[0], page};
}

function applyQuickBuildBoon () {
	const state = makeArtificerState(18);
	const page = makePage(state);
	const {quickBuild, analysis} = analyzeQuickBuildLevel19(state, page);
	const selection = {
		mode: "feat",
		feat: copy(BOON_OF_SPELL_RECALL),
		featChoices: {ability: "int"},
		isBoth: false,
	};

	state.getClasses()[0].level = 19;
	quickBuild._selections.asi.Artificer_19 = selection;
	quickBuild._applyAsiOrFeat(selection, {name: "Artificer", source: "EFA"}, 19, EFA_ARTIFICER);
	state.recordLevelChoice(quickBuild._buildHistoryEntry(analysis, "Artificer_19"));
	const manifest = CharacterSheetProgression.syncCanonicalDecisions({page, state});
	const decision = manifest.decisions.find(candidate => candidate.semanticKey === EFA_EPIC_BOON_DECISION_KEY);

	return {state, page, quickBuild, selection, manifest, decision};
}

async function applyLevelUpBoon () {
	const state = makeArtificerState(18);
	const page = makePage(state);
	const levelUp = new CharacterSheetLevelUp(page);
	levelUp._processFeatSpellChoices = jest.fn().mockResolvedValue(undefined);
	const selectedFeat = {
		...copy(BOON_OF_SPELL_RECALL),
		_featChoices: {ability: "int"},
	};

	await levelUp._applyLevelUp({
		classEntry: state.getClasses()[0],
		newLevel: 19,
		asiChoices: {},
		selectedFeat,
		selectedSubclass: null,
		selectedSubclassChoice: null,
		selectedOptionalFeatures: {},
		selectedCombatTraditions: [],
		selectedWeaponMasteries: [],
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
		selectedArtificerPlanDecisions: [],
		selectedKnownSpells: [],
		selectedKnownCantrips: [],
		selectedPreparedSpells: [],
		selectedPreparedCantrips: [],
		stagedSpellSwap: null,
		newFeatures: [copy(EFA_EPIC_BOON)],
		hpMethod: "average",
		classData: EFA_ARTIFICER,
	});
	const decision = state.getLevelHistoryEntry(19).decisions.find(candidate =>
		candidate.semanticKey === EFA_EPIC_BOON_DECISION_KEY,
	);

	return {state, page, levelUp, decision};
}

function expectPersistedBoon (state) {
	const feats = state.getFeats().filter(feat => feat.name === "Boon of Spell Recall" && feat.source === "XPHB");
	expect(feats).toHaveLength(1);
	expect(feats[0]).toMatchObject({
		choices: {ability: "int"},
		appliedEffects: {abilityDeltas: {int: 1}},
	});
	expect(state.getAbilityBase("int")).toBe(19);

	const history = state.getLevelHistoryEntry(19);
	expect(history.choices.feat).toEqual({name: "Boon of Spell Recall", source: "XPHB"});
	expect(history.decisions.filter(decision => decision.semanticKey === EFA_EPIC_BOON_DECISION_KEY)).toEqual([
		expect.objectContaining({
			type: "feat",
			className: "Artificer",
			classSource: "EFA",
			classLevel: 19,
			status: "resolved",
			selection: {name: "Boon of Spell Recall", source: "XPHB"},
		}),
	]);
}

describe("EFA Artificer level 19 Epic Boon data contract", () => {
	test("authoritative data uses the exact source-qualified five-part UID and qualifying-feat text", () => {
		expect(EFA_ARTIFICER.classFeatures).toContain(EFA_EPIC_BOON_UID);
		expect(EFA_EPIC_BOON).toMatchObject({
			name: "Epic Boon",
			source: "EFA",
			className: "Artificer",
			classSource: "EFA",
			level: 19,
		});
		expect(EFA_EPIC_BOON.entries.join(" ")).toContain("Epic Boon feat or another feat of your choice for which you qualify");
		expect(EFA_EPIC_BOON.entries.join(" ")).toContain("{@feat Boon of Energy Resistance|XPHB} is recommended");
	});

	test("the five-part class-feature fallback requires the exact class identity and level", () => {
		const withOnlyRef = uid => ({
			...copy(EFA_ARTIFICER),
			classFeatures: [uid],
			featProgression: [],
		});

		expect(CharacterSheetClassUtils.getImprovementOpportunity(withOnlyRef(EFA_EPIC_BOON_UID), 19)).toMatchObject({
			kind: "feat",
			source: "classFeature",
			allowsAnyQualifyingFeat: true,
		});
		expect(CharacterSheetClassUtils.getImprovementOpportunity(withOnlyRef("Epic Boon|Artificer|EFA|18|EFA"), 19)).toBeNull();
		expect(CharacterSheetClassUtils.getImprovementOpportunity(withOnlyRef("Epic Boon|Wizard|EFA|19|EFA"), 19)).toBeNull();
		expect(CharacterSheetClassUtils.getImprovementOpportunity(withOnlyRef("Epic Boon|Artificer|TCE|19|EFA"), 19)).toBeNull();
		expect(CharacterSheetClassUtils.getImprovementOpportunity(withOnlyRef("Epic Boon|Artificer|EFA|19|EFA|extra"), 19)).toBeNull();
	});

	test("wrong level and TCE Artificer retain their non-EFA semantics", () => {
		expect(CharacterSheetClassUtils.getImprovementOpportunity(EFA_ARTIFICER, 18)).toBeNull();
		expect(CharacterSheetClassUtils.getImprovementOpportunity(TCE_ARTIFICER, 19)).toMatchObject({
			kind: "asiOrFeat",
			source: "classFeature",
			categories: [],
		});
	});
});

describe("EFA Artificer level 19 generic Level Up and Quick Build surfacing", () => {
	test("both flows surface the same feat-only improvement and exact EFA feature", async () => {
		const levelUpState = makeArtificerState(18);
		const levelUpPage = makePage(levelUpState);
		const levelUp = new CharacterSheetLevelUp(levelUpPage);
		levelUp._pShowLevelUpModal = jest.fn().mockResolvedValue(undefined);

		await levelUp._doLevelUp(levelUpState.getClasses()[0]);
		expect(levelUp._pShowLevelUpModal).toHaveBeenCalledTimes(1);
		const levelUpArgs = levelUp._pShowLevelUpModal.mock.calls[0][0];
		expect(levelUpArgs.improvement).toEqual({
			kind: "feat",
			label: "Epic Boon or Qualifying Feat",
			categories: ["EB"],
			allowsAnyQualifyingFeat: true,
			source: "featProgression",
		});
		expect(levelUpArgs.newFeatures).toEqual(expect.arrayContaining([
			expect.objectContaining({
				name: "Epic Boon",
				source: "EFA",
				className: "Artificer",
				classSource: "EFA",
				level: 19,
			}),
		]));

		const quickBuildState = makeArtificerState(18);
		const {analysis} = analyzeQuickBuildLevel19(quickBuildState);
		expect(analysis.improvement).toEqual(levelUpArgs.improvement);
		expect(analysis.features).toEqual(expect.arrayContaining([
			expect.objectContaining({
				name: "Epic Boon",
				source: "EFA",
				className: "Artificer",
				classSource: "EFA",
				level: 19,
			}),
		]));
	});

	test("the generic qualification filter offers Epic Boons and legal general feats only", () => {
		const state = makeArtificerState(19);
		const eligible = CharacterSheetClassUtils.getEligibleFeats(FEAT_POOL, state, {
			totalLevel: 19,
			featCatalog: FEAT_POOL,
		});
		expect(eligible.map(feat => feat.name)).toEqual([
			"Boon of Energy Resistance",
			"Boon of Spell Recall",
			"Verified General Feat",
		]);

		const decision = CharacterSheetProgression.buildManifest({
			page: makePage(state),
			state,
		}).decisions.find(candidate => candidate.semanticKey === EFA_EPIC_BOON_DECISION_KEY);
		expect(decision.options.map(feat => feat.name)).toEqual([
			"Boon of Energy Resistance",
			"Boon of Spell Recall",
			"Verified General Feat",
		]);
	});
});

describe("EFA Artificer level 19 persistence and stable decision identity", () => {
	test("Level Up and Quick Build commit the same semantic feat decision", async () => {
		const levelUpResult = await applyLevelUpBoon();
		const quickBuildResult = applyQuickBuildBoon();

		expectPersistedBoon(levelUpResult.state);
		expectPersistedBoon(quickBuildResult.state);
		expect(levelUpResult.decision).toMatchObject({
			semanticKey: EFA_EPIC_BOON_DECISION_KEY,
			type: "feat",
			selection: {name: "Boon of Spell Recall", source: "XPHB"},
			status: "resolved",
		});
		expect(levelUpResult.decision.semanticKey).toBe(quickBuildResult.decision.semanticKey);
	});

	test("Quick Build commits once and replay cannot duplicate the feat or ability effect", () => {
		const {state, page, quickBuild, selection, decision} = applyQuickBuildBoon();
		expect(decision).toMatchObject({
			semanticKey: EFA_EPIC_BOON_DECISION_KEY,
			type: "feat",
			label: "Epic Boon or Qualifying Feat",
			selection: {name: "Boon of Spell Recall", source: "XPHB"},
			status: "resolved",
		});
		expectPersistedBoon(state);

		quickBuild._applyAsiOrFeat(selection, {name: "Artificer", source: "EFA"}, 19, EFA_ARTIFICER);
		CharacterSheetProgression.syncCanonicalDecisions({page, state});
		expectPersistedBoon(state);
		expect(state.getLevelHistoryEntry(19).decisions.filter(candidate =>
			candidate.semanticKey === EFA_EPIC_BOON_DECISION_KEY,
		)).toHaveLength(1);
	});

	test("toJson/loadFromJson and public serialize/deserialize preserve the exact feat ledger", () => {
		const {state} = applyQuickBuildBoon();

		const loaded = new CharacterSheetState();
		expect(loaded.loadFromJson(copy(state.toJson()))).not.toBe(false);
		expectPersistedBoon(loaded);

		const deserialized = CharacterSheetState.deserialize(state.serialize());
		expectPersistedBoon(deserialized);
		expect(deserialized.getLevelHistoryEntry(19).decisions[0].semanticKey).toBe(
			loaded.getLevelHistoryEntry(19).decisions[0].semanticKey,
		);
	});
});

describe("EFA Artificer level 19 Respec replay safety", () => {
	test("the generic feat decision edits to another qualifying feat and replays as an exact no-op", () => {
		const {state} = applyQuickBuildBoon();
		const minimalEfa = {
			name: "Artificer",
			source: "EFA",
			edition: "one",
			hd: copy(EFA_ARTIFICER.hd),
			classFeatures: [EFA_EPIC_BOON_UID],
			featProgression: copy(EFA_ARTIFICER.featProgression),
		};
		const page = makePage(state, {
			classes: [minimalEfa],
			classFeatures: [EFA_EPIC_BOON],
		});
		const respec = new CharacterSheetRespec({page, state});
		respec._engine.begin();
		respec._state = respec._engine.state;

		const decision = respec._engine.manifest.decisions.find(candidate =>
			candidate.semanticKey === EFA_EPIC_BOON_DECISION_KEY,
		);
		expect(decision).toMatchObject({
			status: "resolved",
			selection: {name: "Boon of Spell Recall", source: "XPHB"},
		});

		expect(respec._applyImprovementChange(decision, {
			mode: "feat",
			feat: copy(QUALIFIED_GENERAL_FEAT),
			featChoices: {},
		})).toBe(true);
		const afterFirstEdit = copy(respec._state.toJson());
		expect(respec._state.getFeats()).toEqual([
			expect.objectContaining({
				name: "Verified General Feat",
				source: "TST",
				sourceDecisionKey: EFA_EPIC_BOON_DECISION_KEY,
			}),
		]);
		expect(respec._state.getAbilityBase("int")).toBe(18);
		expect(respec._state.getLevelHistoryEntry(19).choices.feat).toEqual({
			name: "Verified General Feat",
			source: "TST",
		});

		const refreshed = respec._engine.manifest.decisions.find(candidate =>
			candidate.semanticKey === EFA_EPIC_BOON_DECISION_KEY,
		);
		expect(respec._applyImprovementChange(refreshed, {
			mode: "feat",
			feat: copy(QUALIFIED_GENERAL_FEAT),
			featChoices: {},
		})).toBe(true);
		expect(respec._state.toJson()).toEqual(afterFirstEdit);
		const reloaded = CharacterSheetState.deserialize(respec._state.serialize());
		expect(reloaded.getFeats()).toHaveLength(1);
		expect(reloaded.getFeats()[0]).toMatchObject({
			name: "Verified General Feat",
			source: "TST",
			sourceDecisionKey: EFA_EPIC_BOON_DECISION_KEY,
		});
		expect(reloaded.getLevelHistoryEntry(19).decisions).toEqual(expect.arrayContaining([
			expect.objectContaining({
				semanticKey: EFA_EPIC_BOON_DECISION_KEY,
				status: "resolved",
				selection: {name: "Verified General Feat", source: "TST"},
			}),
		]));
	});
});
