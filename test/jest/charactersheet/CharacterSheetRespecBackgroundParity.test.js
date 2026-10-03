import "./setup.js";
import {jest} from "@jest/globals";
import fs from "node:fs";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-progression.js";
import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-respec-engine.js";
import "../../../js/charactersheet/charactersheet-respec.js";

const {CharacterSheetState: State, CharacterSheetRespec: Respec, CharacterSheetClassUtils: Utils} = globalThis;
const backgrounds = JSON.parse(fs.readFileSync(new URL("../../../data/backgrounds.json", import.meta.url))).background;
const feats = JSON.parse(fs.readFileSync(new URL("../../../data/feats.json", import.meta.url))).feat;
const cls = {name: "Test", source: "TST", hd: {faces: 8}, classFeatures: []};
const oldBackground = {name: "Old", source: "TST", skillProficiencies: [{history: true}], toolProficiencies: [{"thieves' tools": true}], languageProficiencies: [{dwarvish: true}]};
const variable = {
	name: "Scholar",
	source: "TGTT",
	skillProficiencies: [{choose: {from: ["arcana", "religion", "insight"], count: 2}}],
	toolProficiencies: [{anyArtisansTool: 1}],
	languageProficiencies: [{anyStandard: 2}],
	feats: [{anyFromCategory: {category: ["O"], count: 1}}],
};
const originFeat = {name: "Studious", source: "TGTT", category: "O", toolProficiencies: [{choose: {from: ["Forgery Kit", "Disguise Kit"], count: 1}}]};
const otherFeat = {name: "Observant", source: "TST", category: "O", languageProficiencies: [{choose: {from: ["Elvish", "Gnomish"], count: 1}}]};

function fixture ({race = {name: "Elf", source: "PHB", ability: [{dex: 2}]}, background = oldBackground} = {}) {
	Parser.LANGUAGES_STANDARD = ["Common", "Elvish", "Dwarvish", "Gnomish"];
	Parser.LANGUAGES_ALL = [...Parser.LANGUAGES_STANDARD, "Abyssal"];
	const state = new State();
	state.addClass({...cls, level: 1});
	state.recordLevelChoice({level: 1, class: {name: cls.name, source: cls.source}, choices: {}});
	state.setRace(race);
	state.setBackground(background);
	state.setAbilityBonus("dex", race.ability ? 2 : 0);
	state.setAbilityBonus("cha", 4);
	if (!race.ability && !background.ability) {
		state.setBaseBackgroundUserChoices({selectedAbilityBonuses: {bg_0: "dex", bg_0_weight: 2, bg_1: "con", bg_1_weight: 1}});
		state.setAbilityBonus("dex", 2);
		state.setAbilityBonus("con", 1);
	}
	state.addSkillProficiency("history");
	state.addToolProficiency("Thieves' Tools");
	state.addLanguage("Dwarvish");
	state.addLanguage("Abyssal");
	state.addItem({name: "Keepsake", source: "TST", type: "G"});
	const page = {
		getState: () => state,
		getClasses: () => [cls],
		getClassFeatures: () => [],
		getSubclassFeatures: () => [],
		getOptionalFeatures: () => [],
		getSkillsList: () => [],
		getSpells: () => [],
		getFilteredSpellData: () => [],
		getFeats: () => [originFeat, otherFeat, ...feats],
		getRaces: () => [race],
		getBackgrounds: () => [oldBackground, variable, ...backgrounds],
		filterByAllowedSources: values => values,
		saveCharacter: jest.fn().mockResolvedValue(),
		renderCharacter: jest.fn(),
	};
	state.loadFromJson(state.toJson());
	const respec = new Respec({page, state});
	respec._engine.begin();
	respec._state = respec._engine.state;
	return {state, page, respec};
}

async function choose (draft, type, values, predicate = () => true) {
	const decision = draft._engine.manifest.base.decisions.find(candidate => candidate.type === type && predicate(candidate));
	expect(decision).toBeDefined();
	const selection = decision.count === 1 ? values[0] : values;
	return draft._engine.stageGraphMutation(decision.id, selection, {
		reverseParent: true,
		apply: ({state}) => draft._applyManifestSelectionMechanics(decision, selection, decision.options, state),
	});
}

async function completeVariable (draft) {
	await choose(draft, "nestedSkill", ["arcana", "religion"]);
	await choose(draft, "nestedTool", ["Smith's Tools"], decision => decision.provenance.ownerType === "background");
	await choose(draft, "nestedLanguage", ["Common", "Elvish"]);
	await choose(draft, "nestedFeat", [{name: originFeat.name, source: originFeat.source}]);
	await choose(draft, "nestedTool", ["Forgery Kit"], decision => decision.provenance.ownerType !== "background");
}

describe("Background replacement uses the complete origin graph", () => {
	it("discovers real PHB and XPHB background required families with exact category counts", async () => {
		const {respec} = fixture();
		const acolyte = backgrounds.find(background => background.name === "Acolyte" && background.source === "PHB");
		const draft = await respec._createBackgroundDraft(acolyte, {choices: {}});
		expect(draft._engine.manifest.base.decisions).toEqual(expect.arrayContaining([
			expect.objectContaining({type: "nestedLanguage", count: 2, required: true, status: "missing"}),
		]));
		const criminal = backgrounds.find(background => background.name === "Criminal" && background.source === "XPHB");
		const modern = await fixture({race: {name: "Dwarf", source: "XPHB"}}).respec._createBackgroundDraft(criminal, {choices: {}});
		expect(modern._engine.manifest.base.decisions).toEqual(expect.arrayContaining([
			expect.objectContaining({type: "nestedConfiguration", meta: expect.objectContaining({originAbilityDistribution: true})}),
			expect.objectContaining({type: "nestedFeat", selection: {name: "Alert", source: "XPHB"}}),
		]));
		expect(modern._state.getFeats().filter(feat => feat.name === "Alert")).toHaveLength(1);
	});

	it.each([
		["languageProficiencies", {anyStandard: 2}, "language", 2, "Common"],
		["toolProficiencies", {anyArtisansTool: 2}, "tool", 2, "Smith's Tools"],
		["toolProficiencies", {anyMusicalInstrument: 1}, "tool", 1, "Lute"],
		["skillProficiencies", {any: 2}, "skill", 2, "arcana"],
	])("expands %s %j into canonical options", (field, definition, kind, count, expected) => {
		fixture();
		const descriptors = Utils.getChoiceDescriptors({name: "Test", [field]: [definition]});
		const descriptor = descriptors.find(candidate => candidate.kind === kind);
		expect(descriptor.count).toBe(count);
		expect(descriptor.options).toContain(expected);
	});

	it("requires selectable skills, tools, languages, origin feats and the selected feat's children", async () => {
		const {respec, state} = fixture();
		const live = state.toJson();
		const draft = await respec._createBackgroundDraft(variable, {choices: {}});
		expect(respec._getBackgroundDraftIssues(draft)).toHaveLength(4);
		await expect(respec._stageBackgroundDraft(draft)).rejects.toThrow();
		await completeVariable(draft);
		expect(respec._getBackgroundDraftIssues(draft)).toEqual([]);
		await respec._stageBackgroundDraft(draft);
		expect(state.toJson()).toEqual(live);
		expect(respec._state.getSkillProficiency("history")).toBe(0);
		expect(respec._state.getSkillProficiency("arcana")).toBe(1);
		expect(respec._state.getSkillProficiency("religion")).toBe(1);
		expect(respec._state.hasToolProficiency("Thieves' Tools")).toBe(false);
		expect(respec._state.hasToolProficiency("Smith's Tools")).toBe(true);
		expect(respec._state.hasToolProficiency("Forgery Kit")).toBe(true);
		expect(respec._state.getLanguages()).not.toContain("Dwarvish");
		expect(respec._state.getLanguages()).toContain("Abyssal");
		expect(respec._state.getAbilityBonus("cha")).toBe(4);
		expect(respec._state.getAbilityBonus("dex")).toBe(2);
		expect(respec._state.getItems()).toHaveLength(1);
		respec._engine.cancel();
		expect(state.toJson()).toEqual(live);
	});

	it("discovers canonical fixed origin feat versions and every authored nested spell choice", async () => {
		const {respec, page} = fixture({race: {name: "Dwarf", source: "XPHB"}});
		const parent = feats.find(feat => feat.name === "Magic Initiate" && feat.source === "XPHB");
		const version = parent._versions.find(feat => feat.name === "Magic Initiate; Wizard");
		const dataUtil = globalThis.DataUtil;
		globalThis.DataUtil = {...dataUtil, generic: {getVersions: jest.fn(() => [{...parent, ...version}])}};
		const spells = [
			{name: "Mage Hand", source: "XPHB", level: 0},
			{name: "Light", source: "XPHB", level: 0},
			{name: "Shield", source: "XPHB", level: 1},
		];
		page.getSpells = () => spells;
		page.getFilteredSpellData = () => spells;
		try {
			const sage = backgrounds.find(background => background.name === "Sage" && background.source === "XPHB");
			const draft = await respec._createBackgroundDraft(sage, {choices: {}});
			const fixed = draft._engine.manifest.base.decisions.find(decision => decision.meta?.fixedOriginGrant);
			expect(fixed.selection).toEqual({name: "Magic Initiate; Wizard", source: "XPHB"});
			expect(globalThis.DataUtil.generic.getVersions).toHaveBeenCalledWith(expect.objectContaining({name: "Magic Initiate", __prop: "feat"}));
			const children = draft._engine.manifest.base.decisions.filter(decision => decision.parentSemanticKey === fixed.semanticKey);
			expect(children.map(decision => decision.type)).toEqual(expect.arrayContaining(["nestedCantrip", "nestedSpell"]));
			expect(children.filter(decision => ["nestedCantrip", "nestedSpell"].includes(decision.type))
				.every(decision => decision.required && decision.status === "missing")).toBe(true);
			expect(respec._getBackgroundDraftIssues(draft).length).toBeGreaterThan(2);
			await expect(respec._stageBackgroundDraft(draft)).rejects.toThrow();
		} finally {
			globalThis.DataUtil = dataUtil;
		}
	});

	it("preserves independently owned overlap and exact ledger through Apply, reload and Undo", async () => {
		const {respec, state, page} = fixture();
		state.claimProgressionOwnership("languages", "Dwarvish", "manual:language");
		state._getProgressionOwnershipEntry("languages", "Dwarvish").preserved = true;
		state._data.progressionOwnership.initialized = true;
		respec._engine.begin();
		respec._state = respec._engine.state;
		const original = state.toJson();
		const draft = await respec._createBackgroundDraft(variable, {choices: {}});
		await completeVariable(draft);
		await respec._stageBackgroundDraft(draft);
		await respec._engine.apply();
		expect(state.getLanguages()).toContain("Dwarvish");
		expect(state.getLanguages()).toContain("Abyssal");
		expect(state.getBackground()).toEqual(variable);
		expect(state.getFeats()).toEqual([expect.objectContaining({name: "Studious", source: "TGTT", sourceDecisionKey: expect.stringContaining("base:background:")})]);
		const loaded = new State();
		loaded.loadFromJson(state.toJson());
		const reopened = new Respec({page: {...page, getState: () => loaded}, state: loaded});
		reopened._engine.begin();
		expect(reopened._engine.getValidation().errors).toEqual([]);
		expect(reopened._engine.manifest.base.decisions.filter(decision => decision.required).every(decision => decision.status === "resolved")).toBe(true);
		await respec._engine.undo();
		expect(state.toJson()).toEqual(original);
	});

	it("repairs the same background and clears an abandoned feat branch instead of retaining old children", async () => {
		const {respec} = fixture({background: variable});
		const draft = await respec._createBackgroundDraft(variable, {choices: {}});
		await completeVariable(draft);
		const before = draft._engine.manifest.base.decisions.filter(decision => decision.provenance.ownerUid === "studious|tgtt");
		await choose(draft, "nestedFeat", [{name: otherFeat.name, source: otherFeat.source}]);
		expect(draft._state.hasToolProficiency("Forgery Kit")).toBe(false);
		expect(draft._state.getFeats().map(feat => feat.name)).toEqual(["Observant"]);
		expect(draft._engine.manifest.base.decisions.some(decision => before.some(old => old.semanticKey === decision.semanticKey))).toBe(false);
		expect(respec._getBackgroundDraftIssues(draft)).toEqual([expect.objectContaining({code: "decision-missing"})]);
		await choose(draft, "nestedLanguage", ["Gnomish"], decision => decision.provenance.ownerType !== "background");
		expect(respec._getBackgroundDraftIssues(draft)).toEqual([]);
	});

	it("replaces weighted background ability deltas without changing unrelated bonuses", async () => {
		const {respec} = fixture({race: {name: "Dwarf", source: "XPHB"}});
		const criminal = backgrounds.find(background => background.name === "Criminal" && background.source === "XPHB");
		const draft = await respec._createBackgroundDraft(criminal, {choices: {}});
		const mode = draft._engine.manifest.base.decisions.find(decision => decision.meta.originAbilityDistribution && decision.type === "nestedConfiguration");
		await choose(draft, "nestedConfiguration", [mode.options[0]]);
		await choose(draft, "nestedAbility", ["dex"], decision => decision.slot === 0);
		await choose(draft, "nestedAbility", ["con"], decision => decision.slot === 1);
		expect(draft._state.getAbilityBonus("dex")).toBe(2);
		expect(draft._state.getAbilityBonus("con")).toBe(1);
		expect(draft._state.getAbilityBonus("cha")).toBe(4);
		expect(respec._getBackgroundDraftIssues(draft)).toEqual([]);
	});

	it("replaces only the fixed background origin channel, preserving named/direct bonuses through Cancel, Apply and Undo", async () => {
		const old = {name: "Fixed Old", source: "TST", ability: [{str: 2}]};
		const next = {name: "Fixed New", source: "TST", ability: [{con: 1}]};
		const {state, respec} = fixture({race: {name: "Dwarf", source: "XPHB"}, background: old});
		state.setAbilityBonus("str", 2);
		state.addNamedModifier({name: "Independent Strength", type: "ability:str", value: 1});
		state.addAbilityBonus("str", 1);
		respec._engine.begin();
		respec._state = respec._engine.state;
		const original = state.toJson();
		expect(state.getAbilityBonus("str")).toBe(4);
		expect(state.getAbilityScore("str")).toBe(14);
		const cancelled = await respec._createBackgroundDraft(next, {choices: {}});
		expect(cancelled._state.getAbilityBonus("str")).toBe(2);
		expect(cancelled._state.toJson().abilityBonuses.str).toBe(0);
		cancelled._engine.cancel();
		expect(state.toJson()).toEqual(original);
		expect(respec._state.getAbilityBonus("str")).toBe(4);
		const draft = await respec._createBackgroundDraft(next, {choices: {}});
		await respec._stageBackgroundDraft(draft);
		await respec._engine.apply();
		expect(state.getAbilityScore("str")).toBe(12);
		expect(state.getAbilityScore("con")).toBe(11);
		expect(state.toJson()).toMatchObject({
			abilityBonuses: {str: 0, con: 1},
			directAbilityBonuses: {str: 1},
			customModifiers: {abilityScores: {str: 1}},
		});
		expect(state.getNamedModifiers()).toContainEqual(expect.objectContaining({name: "Independent Strength", value: 1}));
		await respec._engine.undo();
		expect(state.toJson()).toEqual(original);
		expect(state.getAbilityScore("str")).toBe(14);
	});

	it("does not subtract all authored fixed alternatives when the applied branch cannot be proven", async () => {
		const old = {name: "Legacy Alternatives", source: "TST", ability: [{str: 2}, {dex: 2}]};
		const {state, respec} = fixture({race: {name: "Dwarf", source: "XPHB"}, background: old});
		state.setAbilityBonus("str", 2);
		state.setAbilityBonus("dex", 0);
		respec._engine.begin();
		respec._state = respec._engine.state;
		const original = state.toJson();
		await expect(respec._createBackgroundDraft(oldBackground, {choices: {}})).rejects.toThrow(/fixed ability alternatives without a recorded selected branch/);
		expect(state.toJson()).toEqual(original);
		expect(respec._state.getAbilityBonus("str")).toBe(2);
		expect(respec._state.getAbilityBonus("dex")).toBe(0);
	});
});
