import fs from "node:fs";
import "./setup.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-progression.js";
import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-respec-engine.js";
import "../../../js/charactersheet/charactersheet-respec.js";
import "../../../js/charactersheet/charactersheet-builder.js";

const {CharacterSheetBuilder, CharacterSheetClassUtils, CharacterSheetProgression, CharacterSheetRespec, CharacterSheetRespecEngine, CharacterSheetState} = globalThis;
const rogueData = JSON.parse(fs.readFileSync("data/class/class-rogue.json", "utf8"));
const classes = rogueData.class.filter(cls => cls.name === "Rogue" && ["PHB", "XPHB"].includes(cls.source));
const features = rogueData.classFeature.filter(feature => feature.className === "Rogue" && ["PHB", "XPHB"].includes(feature.classSource));
const standardLanguages = ["Common", "Dwarvish", "Elvish", "Giant", "Gnomish", "Goblin", "Halfling", "Orc"];

function makePage () {
	return {
		getClasses: () => classes,
		getClassFeatures: () => features,
		getSubclassFeatures: () => [],
		getOptionalFeatures: () => [],
		getFeats: () => [],
		getSkillsList: () => ["Acrobatics", "Deception", "Perception", "Stealth"],
		getSpells: () => [],
		getFilteredSpellData: () => [],
		renderCharacter: () => {},
		saveCharacter: async () => {},
	};
}

function buildRogue ({source = "XPHB", language = "Elvish"} = {}) {
	const page = makePage();
	const state = new CharacterSheetState();
	state.setClassFeatureCatalog(features, [], []);
	const builder = Object.create(CharacterSheetBuilder.prototype);
	builder.resetSelections();
	builder._page = page;
	builder._state = state;
	builder._selectedClass = classes.find(cls => cls.source === source);
	builder._selectedSkills = ["Acrobatics", "Deception", "Perception", "Stealth"];
	builder._selectedExpertise = ["Acrobatics", "Stealth"];
	builder._selectedClassFeatureLanguages = language ? [language] : [];
	builder._selectedWeaponMasteries = ["Dagger|XPHB", "Shortbow|XPHB"];
	builder._currentStep = 3;
	builder._applyCurrentStep();
	return {builder, page, state};
}

function getLanguageDecision (state, page) {
	return CharacterSheetProgression.buildManifest({page, state}).decisions.find(decision =>
		decision.type === "languages" && decision.sourceKey === "Thieves' Cant",
	);
}

function openLegacyDraft ({language = "Elvish", prepare = () => {}} = {}) {
	const {page, state} = buildRogue({language});
	prepare(state);
	const legacy = state.toJson();
	delete legacy.levelHistory[0].choices.languages;
	legacy.levelHistory[0].decisions = [];
	state.loadFromJson(legacy);
	const respec = new CharacterSheetRespec({page, state});
	respec._state = respec._engine.begin();
	return {page, state, respec};
}

function stageLanguage (respec, language, legacyLanguageResolution = null) {
	const decision = respec._engine.manifest.decisions.find(it =>
		it.type === "languages" && it.sourceKey === "Thieves' Cant",
	);
	return respec._engine.stageGraphMutation(decision.id, [language], {
		reverseParent: true,
		...(legacyLanguageResolution ? {legacyLanguageResolution} : {}),
		apply: ({state}) => respec._applyManifestSelectionMechanics(decision, [language], decision.options, state),
	});
}

describe("Rogue language ownership across Builder and Respec", () => {
	const oldLanguagesAll = Parser.LANGUAGES_ALL;
	beforeAll(() => { Parser.LANGUAGES_ALL = standardLanguages; });
	afterAll(() => {
		if (oldLanguagesAll === undefined) delete Parser.LANGUAGES_ALL;
		else Parser.LANGUAGES_ALL = oldLanguagesAll;
	});

	it("records the ordinary XPHB Builder Class-step language as an exact choice after save/reload", () => {
		const {page, state} = buildRogue();
		expect(state.getLanguages()).toEqual(["Thieves' Cant", "Elvish"]);
		expect(state.getLevelHistoryEntry(1).choices.languages).toEqual([
			{featureName: "Thieves' Cant", language: "Elvish"},
		]);
		CharacterSheetProgression.syncCanonicalDecisions({page, state});
		const saved = state.toJson();
		const reloaded = new CharacterSheetState();
		reloaded.setClassFeatureCatalog(features, [], []);
		expect(reloaded.loadFromJson(saved)).not.toBe(false);
		expect(reloaded.getLanguages()).toEqual(["Thieves' Cant", "Elvish"]);
		expect(getLanguageDecision(reloaded, page)).toMatchObject({
			className: "Rogue",
			classSource: "XPHB",
			classLevel: 1,
			required: true,
			status: "resolved",
			selection: ["Elvish"],
		});
	});

	it("replaces a newly built Rogue's class language without retaining the old choice", async () => {
		const {page, state} = buildRogue();
		const reloaded = new CharacterSheetState();
		reloaded.setClassFeatureCatalog(features, [], []);
		reloaded.loadFromJson(state.toJson());
		const respec = new CharacterSheetRespec({page, state: reloaded});
		respec._state = respec._engine.begin();
		expect(respec._engine.manifest.decisions.find(it => it.type === "languages")).toMatchObject({
			status: "resolved", selection: ["Elvish"],
		});
		stageLanguage(respec, "Goblin");
		expect(respec._state.getLanguages()).toEqual(["Thieves' Cant", "Goblin"]);
		expect(reloaded.getLanguages()).toEqual(["Thieves' Cant", "Elvish"]);
		await respec._engine.apply();
		const saved = new CharacterSheetState();
		saved.setClassFeatureCatalog(features, [], []);
		saved.loadFromJson(reloaded.toJson());
		expect(saved.getLanguages()).toEqual(["Thieves' Cant", "Goblin"]);
		expect(getLanguageDecision(saved, page).selection).toEqual(["Goblin"]);
	});

	it("treats PHB Thieves' Cant as fixed-only rather than requiring a second language", () => {
		const phbFeature = features.find(feature => feature.name === "Thieves' Cant" && feature.classSource === "PHB");
		expect(CharacterSheetClassUtils.findLanguageGrantsInFeature(phbFeature)).toEqual({
			count: 0,
			autoLanguages: ["Thieves' Cant"],
		});
		const {page, state} = buildRogue({source: "PHB", language: null});
		expect(state.getLanguages()).toEqual(["Thieves' Cant"]);
		expect(state.getLevelHistoryEntry(1).choices.languages).toBeUndefined();
		expect(getLanguageDecision(state, page)).toBeUndefined();
	});

	it.each([
		["race", state => state.setRace({name: "Elf", source: "XPHB", languageProficiencies: [{elvish: true}]})],
		["background", state => state.setBaseBackgroundUserChoices({selectedLanguages: [{language: "Elvish"}]})],
		["feat", state => state._data.feats.push({id: "linguist", name: "Linguist", source: "PHB", appliedEffects: {languagesAdded: ["Elvish"]}})],
	])("keeps an independent %s language when revisiting Builder's Class step", (owner, prepare) => {
		const {builder, state} = buildRogue();
		prepare(state);
		builder._selectedClass = classes.find(cls => cls.source === "PHB");
		builder._selectedClassFeatureLanguages = [];
		builder._applyCurrentStep();
		expect(state.getLanguages()).toEqual(["Elvish", "Thieves' Cant"]);
		expect(state.getLevelHistoryEntry(1).choices.languages).toBeUndefined();
	});

	it("removes only the previous class language after canonical decisions have been saved", () => {
		const {builder, page, state} = buildRogue();
		CharacterSheetProgression.syncCanonicalDecisions({page, state});
		const ownerKey = getLanguageDecision(state, page).semanticKey;
		state.claimProgressionOwnership("languages", "Elvish", ownerKey);
		expect(state._getProgressionOwnershipEntry("languages", "Elvish").sources).toContain(ownerKey);
		builder._selectedClass = classes.find(cls => cls.source === "PHB");
		builder._selectedClassFeatureLanguages = [];
		builder._applyCurrentStep();
		expect(state.getLanguages()).toEqual(["Thieves' Cant"]);
	});

	it("does not silently add a second extra language to a legacy Rogue with no owner", () => {
		const {state, respec} = openLegacyDraft();
		const candidate = respec._state;
		const decision = respec._engine.manifest.decisions.find(it => it.type === "languages" && it.sourceKey === "Thieves' Cant");
		expect(decision).toMatchObject({status: "missing", selection: null});
		expect(candidate.getLanguages()).toEqual(["Thieves' Cant", "Elvish"]);
		expect(respec._engine.getValidation().errors).toEqual(expect.arrayContaining([
			expect.objectContaining({decisionId: decision.id, message: expect.stringMatching(/Elvish.*Repair.*attribute/i)}),
		]));
		expect(() => stageLanguage(respec, "Goblin")).toThrow(/attribute|confirm|unattributed/i);
		expect(candidate.getLanguages()).toEqual(["Thieves' Cant", "Elvish"]);
		expect(state.getLanguages()).toEqual(["Thieves' Cant", "Elvish"]);
	});

	it.each([
		["attribute", "Elvish", ["Thieves' Cant", "Elvish"]],
		["independent", "Goblin", ["Thieves' Cant", "Elvish", "Goblin"]],
	])("requires explicit %s resolution when a missing choice retains a stale Rogue owner", (mode, selection, expected) => {
		const {page, state} = buildRogue();
		CharacterSheetProgression.syncCanonicalDecisions({page, state});
		const key = getLanguageDecision(state, page).semanticKey;
		state.initializeProgressionOwnership(CharacterSheetProgression.buildManifest({page, state}));
		expect(state._getProgressionOwnershipEntry("languages", "Elvish").sources).toContain(key);
		const legacy = state.toJson();
		delete legacy.levelHistory[0].choices.languages;
		legacy.levelHistory[0].decisions = [];
		state.loadFromJson(legacy);
		const respec = new CharacterSheetRespec({page, state});
		respec._state = respec._engine.begin();
		expect(respec._engine.manifest.decisions.find(it => it.semanticKey === key).status).toBe("missing");
		expect(respec._state._getProgressionOwnershipEntry("languages", "Elvish").sources).toContain(key);
		expect(() => stageLanguage(respec, "Goblin")).toThrow(/confirm/i);
		stageLanguage(respec, selection, {mode});
		expect(respec._state.getLanguages()).toEqual(expected);
		expect(respec._state._getProgressionOwnershipEntry("languages", "Elvish")).toMatchObject({
			preserved: mode === "independent",
			sources: mode === "independent" ? [] : [key],
		});
	});

	it("attributes an existing legacy language by explicit choice, then replaces only that owner after reload", async () => {
		const {page, state, respec} = openLegacyDraft();
		const key = respec._engine.manifest.decisions.find(it => it.type === "languages").semanticKey;
		stageLanguage(respec, "Elvish", {mode: "attribute"});
		expect(respec._state.getLanguages()).toEqual(["Thieves' Cant", "Elvish"]);
		expect(state.getLanguages()).toEqual(["Thieves' Cant", "Elvish"]);
		expect(respec._state._getProgressionOwnershipEntry("languages", "Elvish")).toMatchObject({
			preserved: false,
			sources: [key],
		});
		expect(respec._engine.getValidation().errors).toEqual([]);
		await respec._engine.apply();

		const saved = new CharacterSheetState();
		saved.setClassFeatureCatalog(features, [], []);
		saved.loadFromJson(state.toJson());
		expect(getLanguageDecision(saved, page)).toMatchObject({
			status: "resolved", selection: ["Elvish"], semanticKey: key,
		});
		const reopened = new CharacterSheetRespec({page, state: saved});
		reopened._state = reopened._engine.begin();
		expect(reopened._engine.manifest.decisions.find(it => it.semanticKey === key)).toMatchObject({
			status: "resolved", selection: ["Elvish"],
		});
		stageLanguage(reopened, "Goblin");
		expect(reopened._state.getLanguages()).toEqual(["Thieves' Cant", "Goblin"]);
		expect(saved.getLanguages()).toEqual(["Thieves' Cant", "Elvish"]);
		await reopened._engine.apply();
		expect(saved.getLanguages()).toEqual(["Thieves' Cant", "Goblin"]);
		await reopened._engine.undo();
		expect(saved.getLanguages()).toEqual(["Thieves' Cant", "Elvish"]);
		expect(getLanguageDecision(saved, page).selection).toEqual(["Elvish"]);
	});

	it("allows a new language only after confirming the legacy unowned language is independent", async () => {
		const {page, state, respec} = openLegacyDraft();
		expect(() => stageLanguage(respec, "Elvish", {mode: "independent"})).toThrow(/attribute|confirm/i);
		expect(() => stageLanguage(respec, "Goblin", {mode: "attribute"})).toThrow(/attribute|confirm/i);
		stageLanguage(respec, "Goblin", {mode: "independent"});
		expect(respec._state.getLanguages()).toEqual(["Thieves' Cant", "Elvish", "Goblin"]);
		expect(respec._state._getProgressionOwnershipEntry("languages", "Elvish").preserved).toBe(true);
		expect(state.getLanguages()).toEqual(["Thieves' Cant", "Elvish"]);
		expect(respec._engine.getValidation().errors).toEqual([]);
		await respec._engine.apply();
		const reopened = new CharacterSheetRespec({page, state});
		reopened._state = reopened._engine.begin();
		stageLanguage(reopened, "Orc");
		expect(reopened._state.getLanguages()).toEqual(["Thieves' Cant", "Elvish", "Orc"]);
	});

	it("preserves an explicitly overlapping independent grant when the attributed Rogue choice changes", () => {
		const {respec} = openLegacyDraft();
		stageLanguage(respec, "Elvish", {mode: "attribute", alsoIndependent: true});
		expect(respec._state._getProgressionOwnershipEntry("languages", "Elvish").preserved).toBe(true);
		stageLanguage(respec, "Goblin");
		expect(respec._state.getLanguages()).toEqual(["Thieves' Cant", "Elvish", "Goblin"]);
	});

	it.each([
		["race", state => state.setRace({name: "Elf", source: "XPHB", languageProficiencies: [{elvish: true}]})],
		["background", state => state.setBaseBackgroundUserChoices({selectedLanguages: [{language: "Elvish"}]})],
		["feat", state => state._data.feats.push({id: "linguist", name: "Linguist", source: "PHB", appliedEffects: {languagesAdded: ["Elvish"]}})],
	])("preserves a proven %s language while repairing a missing Rogue choice", (owner, prepare) => {
		const {respec} = openLegacyDraft({prepare});
		const decision = respec._engine.manifest.decisions.find(it => it.type === "languages");
		expect(decision.status).toBe("missing");
		stageLanguage(respec, "Goblin");
		expect(respec._state.getLanguages()).toEqual(["Thieves' Cant", "Elvish", "Goblin"]);
		expect(respec._state._getProgressionOwnershipEntry("languages", "Elvish").preserved).toBe(true);
		stageLanguage(respec, "Orc");
		expect(respec._state.getLanguages()).toEqual(["Thieves' Cant", "Elvish", "Orc"]);
	});

	it("repairs an intentionally unselected XPHB language without inventing a prior owner", () => {
		const {state, respec} = openLegacyDraft({language: null});
		expect(state.getLanguages()).toEqual(["Thieves' Cant"]);
		expect(respec._engine.manifest.decisions.find(it => it.type === "languages").status).toBe("missing");
		stageLanguage(respec, "Elvish");
		expect(respec._state.getLanguages()).toEqual(["Thieves' Cant", "Elvish"]);
		expect(state.getLanguages()).toEqual(["Thieves' Cant"]);
	});
});
