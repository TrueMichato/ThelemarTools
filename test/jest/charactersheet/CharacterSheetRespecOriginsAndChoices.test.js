import "./setup.js";
import fs from "node:fs";
import {jest} from "@jest/globals";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-modal.js";
import "../../../js/charactersheet/charactersheet-progression.js";
import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-respec-engine.js";
const originalElementFactory = globalThis.e_;
function dialogElement (opts) {
	const node = originalElementFactory(opts);
	node.replaceChildren = (...children) => { node._children = []; node._html = ""; node.append(...children); };
	const querySelector = node.querySelector;
	node.querySelector = selector => selector === ".respec-hover-slot"
		? node._respecOptionLabelSlot ||= originalElementFactory({tag: "span"})
		: querySelector(selector);
	return node;
}
globalThis.e_ = dialogElement;
await import("../../../js/charactersheet/charactersheet-respec.js");
globalThis.e_ = originalElementFactory;

const State = globalThis.CharacterSheetState;
const Respec = globalThis.CharacterSheetRespec;
const Utils = globalThis.CharacterSheetClassUtils;
const Progression = globalThis.CharacterSheetProgression;
const clericData = JSON.parse(fs.readFileSync("data/class/class-cleric.json", "utf8"));
const brew = JSON.parse(fs.readFileSync("homebrew/TravelersGuidetoThelemar.json", "utf8"));
const blessed = clericData.classFeature.find(feature => feature.name === "Blessed Strikes" && feature.source === "XPHB");
const fighterData = JSON.parse(fs.readFileSync("data/class/class-fighter.json", "utf8"));
const scores = {str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8};

function workspace (state, overrides = {}) {
	const page = {
		getClasses: () => [{name: "Fighter", source: "PHB", classFeatures: [], hd: {faces: 10}}],
		getClassFeatures: () => [],
		getSubclassFeatures: () => [],
		getOptionalFeatures: () => [],
		getFeats: () => [],
		getSpells: () => [],
		getRaces: () => [],
		getBackgrounds: () => [],
		filterByAllowedSources: values => values,
		saveCharacter: jest.fn().mockResolvedValue(undefined),
		renderCharacter: jest.fn(),
		...overrides,
	};
	const respec = new Respec({state, page});
	respec._engine.begin();
	respec._state = respec._engine.state;
	return respec;
}

function startingState () {
	const state = new State();
	state.addClass({name: "Fighter", source: "PHB", level: 1});
	state.recordLevelChoice({level: 1, class: {name: "Fighter", source: "PHB"}, choices: {}});
	for (const [ability, score] of Object.entries(scores)) state.setAbilityBase(ability, score);
	return state;
}

function nodes (node) {
	return [node, ...(node._children || []).flatMap(nodes)];
}

async function withDialogDom (run) {
	const original = globalThis.e_;
	globalThis.e_ = dialogElement;
	try {
		return await run();
	} finally {
		globalThis.e_ = original;
	}
}

function recordedStartingState () {
	const state = startingState();
	state.setRace({name: "Recorded Species", source: "PHB", speed: 30});
	const page = workspace(state)._page;
	Progression.syncCanonicalDecisions({state,
		page,
		abilityAcquisitionEvidence: {
			creationAbilityScores: scores, creationAbilityMethod: "standard", originEffects: [],
		}});
	return state;
}

function clericWorkspace () {
	const state = new State();
	state.addClass({name: "Cleric", source: "TGTT", level: 7});
	for (let level = 1; level <= 7; ++level) state.recordLevelChoice({level, class: {name: "Cleric", source: "TGTT"}, choices: {}});
	state._data.chosenSubfeatures = [{
		parent: "Blessed Strikes",
		parentSource: "XPHB",
		parentClass: "Cleric",
		parentClassSource: "XPHB",
		level: 7,
		name: "Potent Spellcasting",
		source: "XPHB",
	}];
	state._data.features.push(
		{id: "old-blessed", name: "Potent Spellcasting", source: "XPHB", className: "Cleric", classSource: "XPHB", level: 7, acquisitionLevel: 7, parentFeature: "Blessed Strikes", featureType: "Class", isFeatureOption: true},
		{id: "domain-potent", name: "Potent Spellcasting", source: "TGTT", className: "Cleric", classSource: "TGTT", level: 8},
	);
	state.getLevelHistoryEntry(7).choices.featureChoices = [{featureName: "Blessed Strikes", choice: "Potent Spellcasting", source: "XPHB", acquisitionLevel: 7}];
	return workspace(state, {
		getClasses: () => brew.class,
		getClassFeatures: () => [...clericData.classFeature, ...brew.classFeature],
	});
}

describe("Respec starting ability distribution", () => {
	it("offers an editor from the real Base card, even without origin/history evidence", () => {
		const respec = workspace(startingState());
		expect(nodes(respec._renderBaseCard()).some(node => node.dataset?.respecStartingAbilities === "true")).toBe(true);
	});

	it("labels reconstructed history and preserves actual later gains and independent channels through Apply/Undo", async () => {
		const state = startingState();
		state._data.abilities.str = 18;
		state._data.abilityBonuses.str = 2;
		state._data.namedModifiers.push({id: "manual", type: "skill:athletics", value: 1});
		const respec = workspace(state);
		const initial = state.toJson();
		const distribution = respec._engine.getStartingAbilityDistribution();
		expect(distribution.isIncomplete).toBe(true);
		await respec._engine.stageStartingAbilityDistribution({method: "standard", scores});
		expect(respec._state.getAbilityBase("str")).toBe(15);
		expect(respec._state._data.abilityBonuses.str).toBe(2);
		expect(state.toJson()).toEqual(initial);
		await respec._engine.apply();
		expect(state.getAbilityBase("str")).toBe(15);
		expect(state.getNamedModifiers()).toContainEqual(expect.objectContaining({id: "manual"}));
		await respec._engine.undo();
		expect(state.toJson()).toEqual(initial);
	});

	it("keeps actual writer gains, a capped zero, and unknown adjustments through reload and later ASI replacement", async () => {
		const state = recordedStartingState();
		state._data.classes[0].level = 4;
		state.setAbilityBase("dex", 20);
		const acquisition = Utils.applyClassAsi(state, {
			className: "Fighter",
			classSource: "PHB",
			classLevel: 4,
			characterLevel: 4,
			asi: {str: 1, dex: 1},
			grantBoth: state.shouldGrantBothAsiAndFeat(4),
		});
		for (let level = 2; level <= 4; ++level) {
			state.recordLevelChoice({
				level,
				class: {name: "Fighter", source: "PHB"},
				choices: level === 4 ? {asi: {str: 1, dex: 1}} : {},
				...(level === 4 ? {decisions: [acquisition]} : {}),
			});
		}
		const catalogs = {getClasses: () => fighterData.class, getClassFeatures: () => fighterData.classFeature};
		const respec = workspace(state, catalogs);
		const next = {...scores, str: 14, dex: 15};
		await respec._engine.stageStartingAbilityDistribution({method: "standard", scores: next});
		expect(respec._engine.getValidation().blockingErrors.map(issue => ({code: issue.code, message: issue.message}))).toEqual([]);
		expect(respec._state.getAbilityBase("str")).toBe(15);
		expect(respec._state.getAbilityBase("dex")).toBe(21);
		const decision = respec._state.getLevelHistoryEntry(4).decisions.find(row => row.semanticKey === acquisition.semanticKey);
		expect(decision.receipt.effects).toContainEqual(expect.objectContaining({ability: "str", amount: 1, before: 14, after: 15}));
		expect(decision.receipt.effects).toContainEqual(expect.objectContaining({ability: "dex", amount: 0, before: 21, after: 21}));
		await respec._engine.apply();
		const loaded = new State();
		expect(loaded.loadFromJson(state.toJson())).not.toBe(false);
		const reopened = workspace(loaded, catalogs);
		expect(reopened._engine.getStartingAbilityDistribution()).toMatchObject({scores: next, adjustments: {dex: 6}, isIncomplete: false});
		const asi = reopened._engine.manifest.decisions.find(row => row.semanticKey === acquisition.semanticKey);
		expect(reopened._applyImprovementChange(asi, {mode: "asi", asi: {con: 2}})).toBe(true);
		expect(reopened._state.getAbilityBase("str")).toBe(14);
		expect(reopened._state.getAbilityBase("dex")).toBe(21);
		expect(reopened._state.getAbilityBase("con")).toBe(15);
	});

	it.each([
		["standard", {...scores, str: 14}],
		["pointbuy", {...scores, str: 16}],
		["pointbuy", {str: 8, dex: 8, con: 8, int: 8, wis: 8, cha: 8}],
		["manual", {...scores, str: 2}],
		["manual", {...scores, str: 12.5}],
	])("rejects invalid %s distributions atomically", async (method, next) => {
		const respec = workspace(recordedStartingState());
		const before = respec._state.toJson();
		await expect(respec._engine.stageStartingAbilityDistribution({method, scores: next})).rejects.toThrow();
		expect(respec._state.toJson()).toEqual(before);
		expect(respec._engine.isDirty).toBe(false);
	});

	it("supports legal Point Buy and Manual Entry without conflating their baseline and bonuses", async () => {
		const respec = workspace(recordedStartingState());
		respec._state._data.abilityBonuses.con = 2;
		await respec._engine.stageStartingAbilityDistribution({method: "pointbuy", scores});
		await respec._engine.stageStartingAbilityDistribution({method: "manual", scores: {...scores, con: 18}});
		expect(respec._state.getAbilityBase("con")).toBe(18);
		expect(respec._state._data.abilityBonuses.con).toBe(2);
		expect(respec._engine.getStartingAbilityDistribution().method).toBe("manual");
	});

	it("carries unchanged incomplete feat children when only unselected feat eligibility changes", async () => {
		const state = recordedStartingState();
		state._data.classes[0].level = 4;
		const chosen = {name: "Incomplete Scholar", source: "PHB", savingThrowProficiencies: [{choose: {from: ["wis", "cha"], count: 1}}], entries: []};
		const alternative = {name: "Strong Grappler", source: "PHB", prerequisite: [{ability: [{str: 13}]}], entries: []};
		state.addFeat(chosen);
		for (let level = 2; level <= 4; ++level) {
			state.recordLevelChoice({level, class: {name: "Fighter", source: "PHB"}, choices: level === 4 ? {feat: {name: chosen.name, source: chosen.source}} : {}});
		}
		const respec = workspace(state, {getClasses: () => fighterData.class, getClassFeatures: () => fighterData.classFeature, getFeats: () => [chosen, alternative]});
		const feat = respec._engine.manifest.decisions.find(row => row.options.some(option => option.name === alternative.name));
		expect(feat.status).toBe("resolved");
		const oldIssues = respec._engine.getValidation().carriedForwardIssues.map(issue => issue.code).sort();
		expect(oldIssues.length).toBeGreaterThan(0);
		await respec._engine.stageStartingAbilityDistribution({method: "manual", scores: {...scores, str: 12}});
		expect(respec._engine.getDecision(feat.id).options.some(option => option.name === alternative.name)).toBe(false);
		expect(respec._engine.getValidation().blockingErrors).toEqual([]);
		expect(respec._engine.getValidation().carriedForwardIssues.map(issue => issue.code).sort()).toEqual(oldIssues);
		const draft = await respec._createRaceDraft({name: "Strong Species", source: "PHB", speed: 30, ability: [{str: 2}]}, {choices: {}});
		await respec._stageBackgroundDraft(draft, {originType: "race"});
		expect(respec._engine.getDecision(feat.id).options.some(option => option.name === alternative.name)).toBe(true);
		expect(respec._engine.getValidation().blockingErrors).toEqual([]);
		expect(respec._engine.getValidation().carriedForwardIssues.map(issue => issue.code).sort()).toEqual(oldIssues);
	});

	it("does not grandfather a new multiclass prerequisite failure introduced by a starting-score edit", async () => {
		const state = recordedStartingState();
		state.setAbilityBase("cha", 13);
		const paladinData = JSON.parse(fs.readFileSync("data/class/class-paladin.json", "utf8"));
		state.addClass({name: "Paladin", source: "PHB", level: 1});
		state.recordLevelChoice({level: 2, class: {name: "Paladin", source: "PHB"}, choices: {}});
		const respec = workspace(state, {getClasses: () => [...fighterData.class, ...paladinData.class], getClassFeatures: () => [...fighterData.classFeature, ...paladinData.classFeature]});
		expect(respec._engine.getValidation().blockingErrors).toEqual([]);
		const original = state.toJson();
		await respec._engine.stageStartingAbilityDistribution({method: "manual", scores: {...scores, str: 8}});
		expect(respec._engine.getValidation().canApply).toBe(false);
		expect(respec._engine.getValidation().blockingErrors.length).toBeGreaterThan(0);
		await expect(respec._engine.apply()).rejects.toThrow();
		expect(state.toJson()).toEqual(original);
	});

	it("renders actual labelled inputs and reports validation errors without closing or staging", async () => {
		const respec = workspace(recordedStartingState());
		const inner = e_({tag: "div"});
		const close = jest.fn();
		const original = globalThis.CharacterSheetModal.pGetShow;
		globalThis.CharacterSheetModal.pGetShow = async () => ({eleModalInner: inner, doClose: close});
		try {
			await respec._editStartingAbilityDistribution();
			const fields = nodes(inner).filter(node => node.dataset?.startingAbility);
			expect(fields).toHaveLength(6);
			fields[0].value = "18";
			const apply = nodes(inner).find(node => node.textContent === "Stage Starting Scores");
			await apply._handlers.click();
			expect(nodes(inner).some(node => /Standard Array score once/.test(node.textContent || ""))).toBe(true);
			expect(close).not.toHaveBeenCalled();
			expect(respec._engine.isDirty).toBe(false);
		} finally {
			globalThis.CharacterSheetModal.pGetShow = original;
		}
	});

	it("preserves healing and rolls back failed recalculation before dirtying the draft", async () => {
		const respec = workspace(recordedStartingState());
		respec._state.recalculateHp();
		respec._state.setCurrentHp(respec._state.getMaxHp() - 3);
		const previousMax = respec._state.getMaxHp();
		const previousHp = respec._state.getCurrentHp();
		await respec._engine.stageStartingAbilityDistribution({method: "manual", scores: {...scores, con: 18}});
		expect(respec._state.getCurrentHp() - previousHp).toBe(respec._state.getMaxHp() - previousMax);
		const before = respec._state.toJson();
		const recalculate = jest.spyOn(respec._state, "recalculateHp").mockImplementationOnce(() => { throw new Error("failed HP calculation"); });
		await expect(respec._engine.stageStartingAbilityDistribution({method: "manual", scores})).rejects.toThrow("failed HP calculation");
		expect(respec._state.toJson()).toEqual(before);
		recalculate.mockRestore();
		respec._engine.cancel();
		expect(respec._liveState?.getAbilityBase?.("con") || respec._engine._liveState.getAbilityBase("con")).toBe(13);
	});
});

describe("Respec origin receipt normalization", () => {
	it("does not broaden legacy background tool validity while repairing race language evidence", () => {
		const state = startingState();
		state.setBackground({name: "Legacy Crafter", source: "PHB", toolProficiencies: [{choose: {from: ["Retired Kit", "Thieves' Tools"], count: 1}}]});
		state.setBaseBackgroundUserChoices({selectedTools: ["Retired Kit"]});
		state.addToolProficiency("Retired Kit");
		const respec = workspace(state);
		const before = respec._engine.manifest.base.decisions.find(decision => decision.type === "nestedTool");
		expect(before.status).toBe("resolved");
		respec._state._data.background.toolProficiencies[0].choose.from = ["Thieves' Tools"];
		respec._engine.refreshManifest();
		const after = respec._engine.manifest.base.decisions.find(decision => decision.semanticKey === before.semanticKey);
		expect(after.selection).toEqual(before.selection);
		expect(after.status).toBe("resolved");
		expect(respec._state.hasToolProficiency("Retired Kit")).toBe(true);
	});

	const race = {
		name: "Grouped Languages",
		source: "TGTT",
		speed: 30,
		languageProficiencies: [
			{choose: {from: ["common", "elvish"], count: 1}},
			{choose: {from: ["dwarvish", "gnomish", "halfling"], count: 2}},
		],
	};

	it("normalizes each exact grouped race choice and never passes an object to language teardown", async () => {
		const state = startingState();
		state.setRace(race);
		state.setBaseRaceUserChoices({selectedLanguages: {0: ["Elvish"], 1: ["Dwarvish", "Gnomish"]}});
		for (const language of ["Elvish", "Dwarvish", "Gnomish", "Sylvan"]) state.addLanguage(language);
		const page = workspace(state)._page;
		Progression.syncCanonicalDecisions({page, state});
		for (const choice of state.getCharacterBase().decisions.filter(decision => decision.type === "nestedLanguage")) {
			choice.selection = {0: ["Elvish"], 1: ["Dwarvish", "Gnomish"]};
			choice.receipt.effects = [{type: "ownership", ownership: [{type: "languages", value: choice.selection}]}];
		}
		const respec = workspace(state, {getRaces: () => [race]});
		const choices = respec._engine.manifest.base.decisions.filter(decision => decision.type === "nestedLanguage");
		expect(choices.map(choice => choice.selection)).toEqual([["Elvish"], ["Dwarvish", "Gnomish"]]);
		expect(choices.flatMap(choice => choice.receipt.effects.flatMap(effect => effect.ownership || []).map(value => value.value))).toEqual(["Elvish", "Dwarvish", "Gnomish"]);
		expect(respec._state.getCharacterBase().decisions.filter(decision => decision.type === "nestedLanguage").map(choice => choice.selection))
			.toEqual([["Elvish"], ["Dwarvish", "Gnomish"]]);
		const before = respec._state.toJson();
		const cancelled = await respec._createRaceDraft({name: "New Species", source: "PHB", speed: 30}, {choices: {}});
		expect(cancelled._state.getLanguages()).toContain("Sylvan");
		expect(cancelled._state.getLanguages()).not.toContain("Elvish");
		expect(respec._state.toJson()).toEqual(before);
		await respec._stageBackgroundDraft(cancelled, {originType: "race"});
		await respec._engine.apply();
		expect(state.getRaceName()).toBe("New Species");
		const loaded = new State();
		loaded.loadFromJson(state.toJson());
		expect(loaded.getLanguages()).toContain("Sylvan");
		expect(loaded.getLanguages()).not.toContain("Gnomish");
		await respec._engine.undo();
		expect(state.getRaceName()).toBe(race.name);
		expect(state.getLanguages()).toEqual(expect.arrayContaining(["Elvish", "Dwarvish", "Gnomish", "Sylvan"]));
	});

	it("preserves non-origin ability bonuses when replacing a species", () => {
		const state = startingState();
		state.setRace({name: "Old", source: "PHB", ability: [{str: 2}]});
		state._data.abilityBonuses = {...state._data.abilityBonuses, str: 5, dex: 1};
		state.addNamedModifier({id: "manual-strength", name: "Manual Strength", source: "Manual", type: "ability:str", value: 5, enabled: true});
		state._data.directAbilityBonuses = {str: 7};
		const respec = workspace(state);
		respec._applyRaceChange({choices: {}}, {name: "New", source: "PHB", ability: [{con: 2}]});
		expect(respec._state._data.abilityBonuses).toMatchObject({str: 3, dex: 1, con: 2});
		expect(respec._state._data.customModifiers.abilityScores.str).toBe(5);
		expect(respec._state._data.directAbilityBonuses.str).toBe(7);
		expect(respec._state.getAbilityBonus("str")).toBe(15);
	});

	it("preserves a language with independently overlapping background ownership", async () => {
		const state = startingState();
		state.setRace(race);
		state.setBaseRaceUserChoices({selectedLanguages: {0: ["Elvish"], 1: ["Dwarvish", "Gnomish"]}});
		state.setBackground({name: "Linguist", source: "PHB", languageProficiencies: [{elvish: true}]});
		for (const language of ["Elvish", "Dwarvish", "Gnomish"]) state.addLanguage(language);
		Progression.syncCanonicalDecisions({state, page: workspace(state)._page});
		for (const decision of state.getCharacterBase().decisions.filter(row => row.type === "nestedLanguage" && row.provenance.ownerType === "race")) {
			decision.receipt.effects = [{type: "ownership", ownership: decision.selection.map(value => ({type: "languages", value}))}];
		}
		const respec = workspace(state);
		const draft = await respec._createRaceDraft({name: "New Species", source: "PHB", speed: 30}, {choices: {}});
		await respec._stageBackgroundDraft(draft, {originType: "race"});
		await respec._engine.apply();
		expect(state.getLanguages()).toContain("Elvish");
		expect(state.getLanguages()).not.toContain("Dwarvish");
		expect(state.getLanguages()).not.toContain("Gnomish");
	});

	it("preserves unreceipted legacy languages rather than inferring their ownership from the species name", async () => {
		const state = startingState();
		state.setRace(race);
		state.setBaseRaceUserChoices({selectedLanguages: {0: ["Elvish"], 1: ["Dwarvish", "Gnomish"]}});
		for (const language of ["Elvish", "Dwarvish", "Gnomish"]) state.addLanguage(language);
		const original = state.toJson();
		const respec = workspace(state);
		const draft = await respec._createRaceDraft({name: "New Species", source: "PHB", speed: 30}, {choices: {}});
		await respec._stageBackgroundDraft(draft, {originType: "race"});
		await respec._engine.apply();
		expect(state.getLanguages()).toEqual(expect.arrayContaining(["Elvish", "Dwarvish", "Gnomish"]));
		await respec._engine.undo();
		expect(state.toJson()).toEqual(original);
	});

	it("requires matching selection and receipt evidence before excluding legacy race fallback ownership", () => {
		const state = startingState();
		state.setRace(race);
		state.setBaseRaceUserChoices({selectedLanguages: {0: ["Elvish"]}});
		state.addLanguage("Elvish");
		const semanticKey = "origin:race:grouped languages|tgtt:language";
		const decision = {
			type: "nestedLanguage",
			semanticKey,
			selection: ["Dwarvish"],
			provenance: {ownerType: "race", ownerUid: "grouped languages|tgtt"},
			receipt: {version: 1, sourceDecisionKey: semanticKey, effects: [{type: "ownership", ownership: [{type: "languages", value: "Elvish"}]}]},
		};
		const fallback = () => state._getNonProgressionOwnershipKeys({base: {decisions: [decision]}}).languages;
		expect(fallback().has(state._getProgressionOwnershipKey("languages", "Elvish"))).toBe(true);
		decision.selection = {0: ["Elvish"]};
		expect(fallback().has(state._getProgressionOwnershipKey("languages", "Elvish"))).toBe(true);
		decision.selection = ["Elvish"];
		expect(fallback().has(state._getProgressionOwnershipKey("languages", "Elvish"))).toBe(false);
		decision.receipt.sourceDecisionKey = "other";
		expect(fallback().has(state._getProgressionOwnershipKey("languages", "Elvish"))).toBe(true);
	});

	it("keeps origin creation evidence through a replacement and exposes all new weighted choices", async () => {
		const respec = workspace(recordedStartingState());
		const replacement = {name: "Weighted Species", source: "TGTT", speed: 30, ability: [{choose: {weighted: {from: Parser.ABIL_ABVS, weights: [2, 1, 1]}}}]};
		const draft = await respec._createRaceDraft(replacement, {choices: {}});
		const choices = draft._engine.manifest.base.decisions.filter(decision => decision.type === "nestedAbility");
		expect(choices).toHaveLength(1);
		expect(choices[0].count).toBe(3);
		expect(choices.every(choice => choice.required)).toBe(true);
		await expect(respec._stageBackgroundDraft(draft, {originType: "race"})).rejects.toThrow();
		for (const choice of choices) {
			await draft._engine.stageGraphMutation(choice.id, ["str", "dex", "con"], {
				reverseParent: true,
				apply: ({state}) => draft._applyManifestSelectionMechanics(choice, ["str", "dex", "con"], choice.options, state),
			});
		}
		await respec._stageBackgroundDraft(draft, {originType: "race"});
		expect(respec._engine.getValidation().blockingErrors.map(issue => ({code: issue.code, message: issue.message}))).toEqual([]);
		expect(respec._state._data.abilityBonuses).toMatchObject({str: 2, dex: 1, con: 1});
		expect(respec._engine.getStartingAbilityDistribution()).toMatchObject({scores, isIncomplete: false});
		for (const picks of [["wis", "int", "cha"], ["con", "str", "dex"]]) {
			const nextDraft = await respec._createRaceDraft(replacement, {choices: {}});
			const decision = nextDraft._engine.manifest.base.decisions.find(row => row.type === "nestedAbility");
			await nextDraft._engine.stageGraphMutation(decision.id, picks, {
				reverseParent: true,
				apply: ({state}) => nextDraft._applyManifestSelectionMechanics(decision, picks, decision.options, state),
			});
			await respec._stageBackgroundDraft(nextDraft, {originType: "race"});
			expect(respec._state._data.abilityBonuses).toEqual(Object.fromEntries(Parser.ABIL_ABVS.map(ability => [ability, [2, 1, 1][picks.indexOf(ability)] || 0])));
			const receipt = respec._state.getCharacterBase().decisions.find(row => row.type === "nestedAbility").receipt;
			expect(receipt.effects.filter(effect => effect.type === "abilityBonusDelta").map(effect => effect.amount)).toEqual([2, 1, 1]);
		}
		const decision = respec._engine.manifest.base.decisions.find(row => row.type === "nestedAbility");
		const beforeRejected = respec._state.toJson();
		expect(() => respec._engine.stageGraphMutation(decision.id, ["str", "str", "dex"])).toThrow(/different ability/);
		expect(respec._state.toJson()).toEqual(beforeRejected);
		await respec._engine.apply();
		const loaded = new State();
		loaded.loadFromJson(respec._engine._liveState.toJson());
		const reopened = workspace(loaded);
		expect(reopened._state._data.abilityBonuses).toMatchObject({con: 2, str: 1, dex: 1, wis: 0});
		expect(reopened._engine.getStartingAbilityDistribution().scores).toEqual(scores);
		expect(reopened._engine.manifest.base.decisions.find(row => row.type === "nestedAbility").selection).toEqual(["con", "str", "dex"]);
	});

	it("rejects a stale inner species draft without losing another staged edit", async () => {
		const respec = workspace(recordedStartingState());
		const draft = await respec._createRaceDraft({name: "Other Species", source: "PHB", speed: 30}, {choices: {}});
		await respec._engine.stageStartingAbilityDistribution({method: "manual", scores: {...scores, str: 18}});
		await expect(respec._stageBackgroundDraft(draft, {originType: "race"})).rejects.toThrow(/draft changed/);
		expect(respec._state.getAbilityBase("str")).toBe(18);
		expect(respec._state.getRaceName()).toBe("Recorded Species");
	});

	it("selects exactly one authored Goblin distribution and reverses it once when switching branches", async () => {
		const respec = workspace(recordedStartingState());
		const goblin = {
			name: "Goblin",
			source: "TGTT",
			speed: 30,
			ability: [2, 3].map(count => ({choose: {weighted: {from: Parser.ABIL_ABVS, weights: count === 2 ? [2, 1] : [1, 1, 1]}}})),
		};
		const draft = await respec._createRaceDraft(goblin, {choices: {}});
		const stage = async (decision, selection) => draft._engine.stageGraphMutation(decision.id, selection, {
			reverseParent: true,
			apply: ({state}) => draft._applyManifestSelectionMechanics(decision, selection, decision.options, state),
		});
		for (const [modeIndex, picks] of [[0, ["str", "dex"]], [1, ["wis", "int", "cha"]], [0, ["con", "str"]]]) {
			const distribution = draft._engine.manifest.base.decisions.find(row => row.meta?.originAbilityDistribution && row.type === "nestedConfiguration");
			expect(draft._engine.manifest.base.decisions.filter(row => row.type === "nestedAbility" && !row.meta?.originAbilityDistribution)).toEqual([]);
			await stage(distribution, distribution.options.find(mode => mode.modeIndex === modeIndex));
			const children = draft._engine.manifest.base.decisions.filter(row => row.type === "nestedAbility");
			expect(children).toHaveLength(picks.length);
			for (let ix = 0; ix < children.length; ++ix) await stage(children[ix], picks[ix]);
			expect(draft._state._data.abilityBonuses).toEqual(Object.fromEntries(Parser.ABIL_ABVS.map(ability => [ability, modeIndex === 0 ? [2, 1][picks.indexOf(ability)] || 0 : picks.includes(ability) ? 1 : 0])));
		}
		await respec._stageBackgroundDraft(draft, {originType: "race"});
		await respec._engine.apply();
		const loaded = new State();
		loaded.loadFromJson(respec._engine._liveState.toJson());
		const reopened = workspace(loaded);
		expect(reopened._engine.manifest.base.decisions.find(row => row.meta?.originAbilityDistribution && row.type === "nestedConfiguration").selection.modeIndex).toBe(0);
		expect(reopened._state._data.abilityBonuses).toMatchObject({con: 2, str: 1, wis: 0});
	});

	it("reverses only the chosen fixed species branch and preserves unrelated bonuses", async () => {
		const respec = workspace(recordedStartingState());
		respec._state.setAbilityBonus("str", 3);
		const species = {name: "Fixed Alternatives", source: "PHB", speed: 30, ability: [{str: 2}, {dex: 2}]};
		const draft = await respec._createRaceDraft(species, {choices: {}});
		const distribution = draft._engine.manifest.base.decisions.find(row => row.meta?.originAbilityDistribution && row.type === "nestedConfiguration");
		await draft._engine.stageGraphMutation(distribution.id, distribution.options[0], {
			reverseParent: true,
			apply: ({state}) => draft._applyManifestSelectionMechanics(distribution, distribution.options[0], distribution.options, state),
		});
		expect(draft._state._data.abilityBonuses).toMatchObject({str: 5, dex: 0});
		await respec._stageBackgroundDraft(draft, {originType: "race"});
		const replacement = await respec._createRaceDraft({name: "Other", source: "PHB", speed: 30}, {choices: {}});
		await respec._stageBackgroundDraft(replacement, {originType: "race"});
		expect(respec._state._data.abilityBonuses).toMatchObject({str: 3, dex: 0});
		const unknown = startingState();
		unknown.setRace(species);
		unknown.setAbilityBonus("str", 5);
		const ambiguous = workspace(unknown);
		const before = ambiguous._state.toJson();
		await expect(ambiguous._createRaceDraft({name: "Other", source: "PHB", speed: 30}, {choices: {}})).rejects.toThrow(/without a recorded selected branch/);
		expect(ambiguous._state.toJson()).toEqual(before);
	});

	it("exposes newly applicable background ability obligations inside the species draft", async () => {
		const state = recordedStartingState();
		state.setRace({name: "Old Species", source: "PHB", speed: 30, ability: [{str: 2}]});
		state.setAbilityBonus("str", 2);
		state.setBackground({name: "Modern Background",
			source: "XPHB",
			ability: [
				{choose: {weighted: {from: Parser.ABIL_ABVS, weights: [2, 1]}}},
				{choose: {weighted: {from: Parser.ABIL_ABVS, weights: [1, 1, 1]}}},
			]});
		const respec = workspace(state);
		const draft = await respec._createRaceDraft({name: "Modern Species", source: "XPHB", speed: 30}, {choices: {}});
		const distribution = respec._getBackgroundDraftDecisions(draft, {originType: "race"}).find(row => row.meta?.originAbilityDistribution && row.type === "nestedConfiguration");
		expect(distribution.provenance.ownerType).toBe("background");
		await expect(respec._stageBackgroundDraft(draft, {originType: "race"})).rejects.toThrow();
		const stage = async (decision, selection) => draft._engine.stageGraphMutation(decision.id, selection, {
			reverseParent: true,
			apply: ({state: candidate}) => draft._applyManifestSelectionMechanics(decision, selection, decision.options, candidate),
		});
		await stage(distribution, distribution.options[0]);
		const children = respec._getBackgroundDraftDecisions(draft, {originType: "race"}).filter(row => row.type === "nestedAbility");
		expect(children).toHaveLength(2);
		await stage(children[0], "wis");
		await stage(children[1], "con");
		await respec._stageBackgroundDraft(draft, {originType: "race"});
		expect(respec._state._data.abilityBonuses).toMatchObject({str: 0, wis: 2, con: 1});
		expect(respec._engine.getValidation().blockingErrors).toEqual([]);
	});

	it("[S2 production dependency] removes an exact-owner constructed active Child state without deleting independent initiative", async () => {
		const state = startingState();
		const child = brew.race.find(row => row.name === "Child of the Empire" && row.source === "TGTT");
		const trait = child.entries.find(row => row.name === "Dauntless Heritage");
		state.setRace(child);
		state.addFeature(Utils.buildFeatureStateObject({...trait, source: "TGTT"}, {featureType: "Species"}));
		const feature = state.getFeatures().find(row => row.name === trait.name && row.source === "TGTT");
		const owned = state.activateState("custom", {name: feature.name, sourceFeatureId: feature.id, customEffects: [{type: "bonus", target: "initiative", value: 2}]});
		const independent = {id: "independent-initiative", name: feature.name, source: "Manual", type: "initiative", value: 3};
		state.addNamedModifier(independent);
		const otherState = state.activateState("custom", {name: feature.name, customEffects: [{type: "bonus", target: "initiative", value: 1}]});
		const before = state.toJson();
		const respec = workspace(state);
		const draft = await respec._createRaceDraft({name: "Replacement Species", source: "PHB", speed: 30}, {choices: {}});
		await respec._stageBackgroundDraft(draft, {originType: "race"});
		expect(respec._state._data.activeStates.some(row => row.id === owned)).toBe(false);
		expect(respec._state._data.activeStates.some(row => row.id === otherState)).toBe(true);
		expect(respec._state.getNamedModifiers()).toContainEqual(expect.objectContaining({id: independent.id, value: 3}));
		expect(state.toJson()).toEqual(before);
		await respec._engine.apply();
		const loaded = new State();
		loaded.loadFromJson(state.toJson());
		expect(loaded._data.activeStates.some(row => row.id === owned)).toBe(false);
		expect(loaded._data.activeStates.some(row => row.id === otherState)).toBe(true);
		expect(loaded.getNamedModifiers()).toContainEqual(expect.objectContaining({id: independent.id}));
		await respec._engine.undo();
		expect(state.toJson()).toEqual(before);
	});
});

describe("Respec Blessed Strikes acquisition", () => {
	it("discovers the existing acquisition shape without making Cunning Strike an acquisition", () => {
		expect(Utils.findFeatureOptions(blessed, 7, clericData.classFeature)[0]).toMatchObject({count: 1});
		const cunning = JSON.parse(fs.readFileSync("data/class/class-rogue.json", "utf8")).classFeature
			.find(feature => feature.name === "Cunning Strike" && feature.source === "XPHB");
		expect(Utils.findFeatureOptions(cunning, 5, [])).toEqual([]);
	});

	it("exposes the TGTT-owned cross-source opportunity and keeps a domain grant outside its option", () => {
		const state = new State();
		state.addClass({name: "Cleric", source: "TGTT", level: 7});
		for (let level = 1; level <= 7; ++level) state.recordLevelChoice({level, class: {name: "Cleric", source: "TGTT"}, choices: {}});
		state._data.chosenSubfeatures = [{
			parent: "Blessed Strikes",
			parentSource: "XPHB",
			parentClass: "Cleric",
			parentClassSource: "XPHB",
			level: 7,
			name: "Potent Spellcasting",
			source: "XPHB",
		}];
		state._data.features.push({id: "domain-potent", name: "Potent Spellcasting", source: "TGTT", className: "Cleric", classSource: "TGTT", level: 8});
		const respec = workspace(state, {
			getClasses: () => brew.class,
			getClassFeatures: () => [...clericData.classFeature, ...brew.classFeature],
		});
		const decision = respec._engine.manifest.decisions.find(row => row.type === "featureChoice" && row.label === "Blessed Strikes");
		expect(decision).toMatchObject({classSource: "TGTT", status: "resolved"});
		expect(respec._state.getChosenBlessedStrikesOption({classSource: "TGTT"})).toBe("Potent Spellcasting");
		respec._state._data.chosenSubfeatures.push({
			parent: "Blessed Strikes",
			parentSource: "XPHB",
			parentClass: "Cleric",
			parentClassSource: "TGTT",
			level: 7,
			name: "Divine Strike",
			source: "XPHB",
		});
		expect(respec._state.getChosenBlessedStrikesOption({classSource: "TGTT"})).toBeNull();
	});

	it("swaps repeatedly with exactly one durable option, scoped pending cleanup, Apply/Undo and reload", async () => {
		const respec = clericWorkspace();
		const state = respec._engine._liveState;
		const original = state.toJson();
		respec._state.addPendingFeatureChoice({
			featureName: "Blessed Strikes", featureSource: "XPHB", featureClass: "Cleric", featureClassSource: "XPHB", level: 7, kind: "subfeature", options: [{name: "Divine Strike"}, {name: "Potent Spellcasting"}],
		});
		respec._state.addPendingFeatureChoice({
			featureName: "Blessed Strikes", featureSource: "PHB", featureClass: "Other", featureClassSource: "PHB", level: 7, kind: "subfeature", options: [{name: "Divine Strike"}, {name: "Potent Spellcasting"}],
		});
		for (const name of ["Divine Strike", "Potent Spellcasting", "Divine Strike"]) {
			const decision = respec._engine.manifest.decisions.find(row => row.type === "featureChoice" && row.label === "Blessed Strikes");
			const history = respec._state.getLevelHistoryEntry(7);
			await respec._applyFeatureChoiceChange(7, history, 0, history.choices.featureChoices[0],
				decision.options.find(option => option.name === name));
			expect(respec._state.getChosenBlessedStrikesOption({classSource: "TGTT"})).toBe(name);
			expect(respec._state.getChosenSubfeatures().filter(record => record.parent === "Blessed Strikes")).toHaveLength(1);
			expect(respec._state.getFeatures().filter(feature => feature.parentFeature === "Blessed Strikes")).toHaveLength(1);
			expect(respec._state.getFeatures().find(feature => feature.parentFeature === "Blessed Strikes")).toMatchObject({
				name,
				source: "XPHB",
				className: "Cleric",
				classSource: "TGTT",
				level: 7,
				acquisitionLevel: 7,
				featureType: "Class",
				isFeatureOption: true,
				parentFeature: "Blessed Strikes",
				sourceDecisionKey: decision.semanticKey,
			});
			expect(respec._state.getChosenSubfeatures().find(record => record.parent === "Blessed Strikes")).toMatchObject({
				name,
				source: "XPHB",
				parentSource: "XPHB",
				parentClass: "Cleric",
				parentClassSource: "TGTT",
				level: 7,
				characterLevel: 7,
				sourceDecisionKey: decision.semanticKey,
			});
			expect(respec._state.getFeatures().some(feature => feature.id === "domain-potent")).toBe(true);
			expect(respec._state.getLevelHistoryEntry(7).choices.featureChoices[0].choice).toBe(name);
		}
		expect(respec._state.getPendingFeatureChoices().some(choice => choice.featureClass === "Cleric" && choice.featureName === "Blessed Strikes")).toBe(false);
		expect(respec._state.getPendingFeatureChoices().some(choice => choice.featureClass === "Other")).toBe(true);
		expect(state.toJson()).toEqual(original);
		await respec._engine.apply();
		const loaded = new State();
		loaded.loadFromJson(state.toJson());
		const reopened = workspace(loaded, {getClasses: () => brew.class, getClassFeatures: () => [...clericData.classFeature, ...brew.classFeature]});
		expect(reopened._state.getChosenBlessedStrikesOption({classSource: "TGTT"})).toBe("Divine Strike");
		await respec._engine.undo();
		expect(state.toJson()).toEqual(original);
	});

	it("offers both options through the literal legacy dialog fallback", async () => {
		const respec = clericWorkspace();
		delete respec._state.getLevelHistoryEntry(7).choices.featureChoices;
		await withDialogDom(async () => {
			const inner = e_({tag: "div"});
			const history = respec._state.getLevelHistoryEntry(7);
			const editable = respec._getEditableChoices(7, history).find(choice => choice.label === "Blessed Strikes");
			await respec._editFeatureChoice(7, respec._state.getLevelHistoryEntry(7),
				editable, null, {inlineHost: inner});
			const options = nodes(inner).filter(node => node._handlers?.click && node.outerHTML?.includes("charsheet__respec-feat-item"));
			expect(options).toHaveLength(2);
			expect(nodes(inner).some(node => /No source-qualified options/.test(node.textContent || ""))).toBe(false);
			await options.find(option => /Divine Strike/.test(option._respecOptionLabelSlot?.innerHTML || option._respecOptionLabelSlot?.textContent))._handlers.click();
			await nodes(inner).find(node => node.textContent === "Apply Changes")._handlers.click();
			expect(respec._state.getChosenBlessedStrikesOption({classSource: "TGTT"})).toBe("Divine Strike");
			expect(respec._state.getLevelHistoryEntry(7).choices.featureChoices[0].choice).toBe("Divine Strike");
		});
	});

	it("keeps missing-owner modern calls and ambiguous compatibility calls unresolved", () => {
		const state = new State();
		state._recordChosenSubfeature({parent: "Blessed Strikes", parentSource: "XPHB", level: 7, name: "Divine Strike", source: "XPHB"});
		expect(state.getChosenBlessedStrikesOption()).toBe("Divine Strike");
		expect(state.getChosenBlessedStrikesOption({classSource: "TGTT"})).toBeNull();
		state._recordChosenSubfeature({parent: "Blessed Strikes", parentSource: "XPHB", level: 7, name: "Potent Spellcasting", source: "XPHB"});
		expect(state.getChosenBlessedStrikesOption()).toBeNull();
		state._data.chosenSubfeatures = [];
		state._data.features.push({name: "Potent Spellcasting", source: "TGTT", className: "Cleric", classSource: "TGTT", level: 8});
		expect(state.getChosenBlessedStrikesOption()).toBeNull();
	});

	it.each(["XPHB", undefined])("rejects foreign modern records on a classic chassis with parent source %s", parentSource => {
		const state = new State();
		state.addClass({name: "Cleric", source: "PHB", level: 8});
		state._recordChosenSubfeature({parent: "Blessed Strikes", parentSource, level: 7, name: "Divine Strike", source: "XPHB"});
		expect(state.getChosenBlessedStrikesOption({classSource: "PHB"})).toBeNull();
		expect(state.getChosenBlessedStrikesOption()).toBeNull();
	});

	it("does not resolve an inactive acquisition on a below-level modern Cleric owner", () => {
		const state = new State();
		state.addClass({name: "Cleric", source: "XPHB", level: 6});
		state._recordChosenSubfeature({parent: "Blessed Strikes", parentSource: "XPHB", parentClass: "Cleric", parentClassSource: "XPHB", level: 7, name: "Divine Strike", source: "XPHB"});
		expect(state.getChosenBlessedStrikesOption({classSource: "XPHB"})).toBeNull();
		expect(state.getChosenBlessedStrikesOption()).toBeNull();
		state._data.classes[0].level = 7;
		expect(state.getChosenBlessedStrikesOption({classSource: "XPHB"})).toBe("Divine Strike");
		state._data.classes[0].level = 0;
		expect(state.getChosenBlessedStrikesOption({classSource: "XPHB"})).toBeNull();
	});

	it("does not adopt a foreign chosen record on the live TGTT acquisition owner", () => {
		const state = clericWorkspace()._state;
		state._data.classes[0].level = 14;
		state._data.chosenSubfeatures = [];
		state._data.features = state._data.features.filter(feature => feature.parentFeature !== "Blessed Strikes");
		state._recordChosenSubfeature({parent: "Blessed Strikes", parentSource: "XPHB", parentClass: "Cleric", parentClassSource: "TST", level: 7, name: "Potent Spellcasting", source: "XPHB"});
		expect(state.getChosenBlessedStrikesOption({classSource: "TGTT"})).toBeNull();
		expect(state.getChosenBlessedStrikesOption()).toBeNull();
		state._data.chosenSubfeatures[0].parentClassSource = "TGTT";
		expect(state.getChosenBlessedStrikesOption({classSource: "TGTT"})).toBe("Potent Spellcasting");
	});

	it("does not adopt a foreign stored option when chosen records are absent", () => {
		const state = clericWorkspace()._state;
		state._data.classes[0].level = 14;
		state._data.chosenSubfeatures = [];
		state._data.features = state._data.features.filter(feature => feature.parentFeature !== "Blessed Strikes");
		const potent = clericData.classFeature.find(feature => feature.name === "Potent Spellcasting" && feature.source === "XPHB" && feature.level === 7);
		state._data.features.push({...potent, id: "foreign-stored-option", classSource: "TST", parentFeature: "Blessed Strikes", isFeatureOption: true});
		expect(state.getChosenBlessedStrikesOption({classSource: "TGTT"})).toBeNull();
		expect(state.getChosenBlessedStrikesOption()).toBeNull();
		state._data.features.find(feature => feature.id === "foreign-stored-option").classSource = "TGTT";
		expect(state.getChosenBlessedStrikesOption({classSource: "TGTT"})).toBe("Potent Spellcasting");
	});
});

if (process.env.CS_PRIVATE_REPRO_SAVE) {
	describe("Externally supplied legacy save", () => {
		it("imports and replaces species, starting scores and Blessed Strikes without tracked private fixtures", async () => {
			const allClasses = [...fs.readdirSync("data/class")].filter(file => /^class-.*\.json$/.test(file))
				.flatMap(file => JSON.parse(fs.readFileSync(`data/class/${file}`, "utf8")));
			const spells = [...fs.readdirSync("data/spells")].filter(file => /^spells-.*\.json$/.test(file))
				.flatMap(file => JSON.parse(fs.readFileSync(`data/spells/${file}`, "utf8")).spell || []).concat(brew.spell || []);
			const classes = allClasses.flatMap(data => data.class || []).concat(brew.class || []);
			const state = new State();
			state.setSpellData(spells);
			state.setClassCatalog(classes);
			const input = JSON.parse(fs.readFileSync(process.env.CS_PRIVATE_REPRO_SAVE, "utf8"));
			const originalCantrips = new Set(input.spellcasting.cantripsKnown.map(Progression.getEntityUid));
			expect(state.loadFromJson(input)).not.toBe(false);
			expect(state.getCantripsKnown().length).toBe(originalCantrips.size);
			expect(state.getCantripsKnown().every(spell => originalCantrips.has(Progression.getEntityUid(spell)))).toBe(true);
			const raceData = JSON.parse(fs.readFileSync("data/races.json", "utf8"));
			const catalogs = {
				getClasses: () => classes,
				getClassFeatures: () => allClasses.flatMap(data => data.classFeature || []).concat(brew.classFeature || []),
				getSubclassFeatures: () => allClasses.flatMap(data => data.subclassFeature || []).concat(brew.subclassFeature || []),
				getOptionalFeatures: () => JSON.parse(fs.readFileSync("data/optionalfeatures.json", "utf8")).optionalfeature.concat(brew.optionalfeature || []),
				getRaces: () => [...raceData.race, ...brew.race],
				getFeats: () => JSON.parse(fs.readFileSync("data/feats.json", "utf8")).feat.concat(brew.feat || []),
				getSpells: () => spells,
			};
			const respec = workspace(state, catalogs);
			const original = state.toJson();
			const start = respec._engine.getStartingAbilityDistribution();
			expect(start.isIncomplete).toBe(false);
			const next = {...start.scores, str: start.scores.dex, dex: start.scores.str};
			await respec._engine.stageStartingAbilityDistribution({method: "standard", scores: next});
			const oldBase = original.abilities;
			expect(respec._engine.getValidation().blockingErrors.map(issue => ({code: issue.code, message: issue.message, stage: "starting scores"}))).toEqual([]);
			expect(respec._state.getAbilityBase("str")).toBe(oldBase.str + next.str - start.scores.str);
			expect(respec._state._data.abilityBonuses).toEqual(original.abilityBonuses);
			respec._engine.cancel();
			expect(JSON.stringify(state.toJson()) === JSON.stringify(original)).toBe(true);
			respec._engine.begin();
			respec._state = respec._engine.state;
			await respec._engine.stageStartingAbilityDistribution({method: "standard", scores: next});
			const draft = await respec._createRaceDraft({name: "Replacement Species", source: "PHB", speed: 30}, {choices: {}});
			await respec._stageBackgroundDraft(draft, {originType: "race"});
			expect(respec._engine.getValidation().blockingErrors.map(issue => ({code: issue.code, message: issue.message, stage: "species"}))).toEqual([]);
			expect(respec._engine.getStartingAbilityDistribution().scores).toEqual(next);
			const history = respec._state.getLevelHistoryEntry(7);
			const decision = respec._engine.manifest.decisions.find(row => row.label === "Blessed Strikes" && row.type === "featureChoice");
			const editable = respec._getEditableChoices(7, history).find(choice => choice.label === "Blessed Strikes");
			expect(editable).toBeDefined();
			const oldChoice = history.choices.featureChoices[editable.index] || decision.selection[0];
			await respec._applyFeatureChoiceChange(7, history, editable.index, oldChoice,
				decision.options.find(option => option.name === "Divine Strike"));
			expect(respec._state.getChosenBlessedStrikesOption({classSource: "TGTT"})).toBe("Divine Strike");
			expect(JSON.stringify(state.toJson()) === JSON.stringify(original)).toBe(true);
			expect(respec._engine.getValidation().blockingErrors.map(issue => ({code: issue.code, message: issue.message}))).toEqual([]);
			await respec._engine.apply();
			expect(state.getRaceName()).toBe("Replacement Species");
			expect(state.getCantripsKnown().length).toBe(originalCantrips.size);
			expect(state.getCantripsKnown().every(spell => originalCantrips.has(Progression.getEntityUid(spell)))).toBe(true);
			const loaded = new State();
			loaded.setSpellData(spells);
			loaded.setClassCatalog(classes);
			expect(loaded.loadFromJson(state.toJson())).not.toBe(false);
			const reopened = workspace(loaded, catalogs);
			expect(reopened._state.getChosenBlessedStrikesOption({classSource: "TGTT"})).toBe("Divine Strike");
			expect(reopened._engine.getStartingAbilityDistribution().scores).toEqual(next);
			expect(reopened._state.getCantripsKnown().length).toBe(originalCantrips.size);
			expect(reopened._state.getCantripsKnown().every(spell => originalCantrips.has(Progression.getEntityUid(spell)))).toBe(true);
			await respec._engine.undo();
			expect(JSON.stringify(state.toJson()) === JSON.stringify(original)).toBe(true);
		});
	});
}
