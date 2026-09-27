import "./setup.js";
import fs from "node:fs";
import {jest} from "@jest/globals";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-progression.js";
import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-respec.js";
import "../../../js/charactersheet/charactersheet-respec-engine.js";

const CharacterSheetClassUtils = globalThis.CharacterSheetClassUtils;
const CharacterSheetProgression = globalThis.CharacterSheetProgression;
const CharacterSheetState = globalThis.CharacterSheetState;
const CharacterSheetRespec = globalThis.CharacterSheetRespec;
let CharacterSheetPage;
let savedWindow;
let savedDocument;
let savedCreate;
const brew = JSON.parse(fs.readFileSync(
	new URL("../../../homebrew/TravelersGuidetoThelemar.json", import.meta.url),
	"utf8",
));
const barbarian = brew.class.find(cls => cls.name === "Barbarian" && cls.source === "TGTT");
const classData = {
	...barbarian,
	classFeatures: barbarian.classFeatures.filter(ref => typeof ref === "string"
		&& /^Specialties\|Barbarian\|TGTT\|(?:1|6)$/.test(ref)),
	startingProficiencies: {},
	optionalfeatureProgression: [],
	featProgression: [],
};
const copy = value => JSON.parse(JSON.stringify(value));

beforeAll(async () => {
	savedWindow = globalThis.window;
	savedDocument = globalThis.document;
	savedCreate = globalThis.e_;
	globalThis.e_ = (...args) => {
		const element = savedCreate(...args);
		element.querySelector = () => savedCreate({});
		return element;
	};
	globalThis.window = {
		addEventListener: () => {},
		dispatchEvent: () => {},
		location: {search: ""},
		matchMedia: () => ({matches: false, addEventListener: () => {}}),
	};
	globalThis.document = {
		querySelector: () => null,
		querySelectorAll: () => [],
		getElementById: () => null,
		addEventListener: () => {},
		body: {classList: {add () {}, remove () {}}},
	};
	await import("../../../js/charactersheet/charactersheet.js");
	CharacterSheetPage = globalThis.CharacterSheetPage;
});

afterAll(() => {
	globalThis.window = savedWindow;
	globalThis.document = savedDocument;
	globalThis.e_ = savedCreate;
});

afterEach(() => jest.restoreAllMocks());

function getOption (name, level) {
	const wrapper = brew.classFeature.find(feature =>
		feature.name === "Specialties"
		&& feature.className === "Barbarian"
		&& feature.classSource === "TGTT"
		&& feature.level === level);
	const option = CharacterSheetClassUtils.findFeatureOptions(wrapper, level, brew.classFeature)
		.flatMap(group => group.options)
		.find(option => option.name === name);
	if (!option) throw new Error(`No ${name} Specialty at level ${level}`);
	return option;
}

function makeState ({complete = false} = {}) {
	const state = new CharacterSheetState();
	state.addClass({name: "Barbarian", source: "TGTT", level: 6});
	state.setAbilityBase("str", 14);
	state.setAbilityBase("dex", 14);
	const masteryPicks = ["Longsword|XPHB", "Battleaxe|XPHB", "Greataxe|XPHB"];
	const subclass = {name: "Path of the Chained Fury", shortName: "Chained Fury", source: "TGTT"};
	if (complete) {
		state.getClasses()[0].subclass = subclass;
		state.setWeaponMasteries(masteryPicks);
	}
	for (let level = 1; level <= 6; ++level) {
		const name = {1: "Unyielding Might", 6: "Lead the Pack"}[level];
		const choices = {};
		if (name) {
			const option = getOption(name, level);
			const semanticKey = CharacterSheetProgression.getSemanticKey({
				className: "Barbarian",
				classSource: "TGTT",
				classLevel: level,
				type: "featureChoice",
				sourceKey: "Specialties",
				slot: 0,
			});
			const feature = CharacterSheetClassUtils.materializeFeatureOption(option, {
				className: "Barbarian",
				classSource: "TGTT",
				acquisitionLevel: level,
				parentFeature: "Specialties",
				catalogs: {classFeatures: brew.classFeature, subclassFeatures: brew.subclassFeature},
			});
			state.addFeature(feature, {sourceDecisionKey: semanticKey});
			choices.featureChoices = [{
				featureName: "Specialties",
				choice: name,
				source: "TGTT",
				acquisitionLevel: level,
				ref: option.ref,
				type: "classFeature",
			}];
		}
		if (complete && level === 1) choices.weaponMasteries = masteryPicks.slice(0, 2);
		if (complete && level === 3) choices.subclass = subclass;
		if (complete && level === 4) choices.weaponMasteries = masteryPicks;
		state.recordLevelChoice({
			level,
			class: {name: "Barbarian", source: "TGTT"},
			choices,
		});
	}
	state.applyClassFeatureEffects();
	return state;
}

function getPage (state) {
	return {
		getState: () => state,
		getClasses: () => [copy(classData)],
		getClassFeatures: () => brew.classFeature,
		getSubclassFeatures: () => brew.subclassFeature,
		getOptionalFeatures: () => [],
		getFeats: () => [],
		getSpells: () => [],
		getFilteredSpellData: () => [],
		getSkillsList: () => ["Might", "Athletics", "Acrobatics", "Endurance"],
		filterByAllowedSources: values => values,
		saveCharacter: jest.fn().mockResolvedValue(undefined),
		renderCharacter: jest.fn(),
	};
}

function getRespec (state = makeState()) {
	const page = getPage(state);
	const respec = new CharacterSheetRespec({page, state});
	respec._engine.begin();
	respec._state = respec._engine.state;
	return {respec, state, page};
}

async function replaceSpecialty (respec, level, name) {
	const history = respec._state.getLevelHistoryEntry(level);
	const oldChoice = history.choices.featureChoices[0];
	await respec._applyFeatureChoiceChange(level, history, 0, oldChoice, getOption(name, level));
}

async function rollFixedSkill (state, skill) {
	const page = Object.create(CharacterSheetPage.prototype);
	page._state = state;
	page._combat = null;
	page._getExhaustionPenalty = () => 0;
	page._rollD20 = () => ({roll: 10, mode: "normal", thelemar_critBonus: 0});
	page._pMaybeApplyRedCant = async ({effectiveRoll}) => ({effectiveRoll, applied: false, note: ""});
	page._pMaybeApplyFortuneIntervention = async ({effectiveRoll}) => ({effectiveRoll, note: ""});
	page._pMaybeApplyTacticalMind = async () => {};
	page.pAnimateD20 = async () => {};
	page._showDiceResult = jest.fn();
	return (await page._rollSkillCheck(skill, skill[0].toUpperCase() + skill.slice(1), null)).total;
}

describe("Respec TGTT Barbarian Specialty ownership", () => {
	it("replaces Lead the Pack without deleting an independent same-named Athletics bonus", async () => {
		const state = makeState();
		const manualId = state.addNamedModifier({
			name: "Lead the Pack",
			type: "skill:athletics",
			value: 1,
			enabled: true,
		});
		const oldFeature = state.getFeatures().find(feature => feature.name === "Lead the Pack");
		expect(state.getNamedModifiers().filter(modifier => modifier.sourceFeatureId === oldFeature.id)
			.map(modifier => modifier.type).sort()).toEqual(["skill:acrobatics", "skill:athletics"]);
		const liveBefore = state.toJson();
		const {respec} = getRespec(state);
		expect(["might", "athletics", "acrobatics"].map(skill => respec._state.getSkillBreakdown(skill).total))
			.toEqual([5, 6, 5]);

		await replaceSpecialty(respec, 6, "Path of Drowning Springs");

		expect(["might", "athletics", "acrobatics"].map(skill => respec._state.getSkillBreakdown(skill).total))
			.toEqual([5, 3, 2]);
		expect(respec._state.getNamedModifiers()).toEqual(expect.arrayContaining([
			expect.objectContaining({id: manualId, name: "Lead the Pack", type: "skill:athletics", value: 1}),
		]));
		expect(respec._state.getNamedModifiers().some(modifier => modifier.sourceFeatureId === oldFeature.id)).toBe(false);
		expect(respec._state.getSkillBreakdown("athletics").components).toContainEqual(expect.objectContaining({
			name: "Lead the Pack",
			value: 1,
		}));
		expect(respec._engine.getValidation().warnings).toEqual(expect.arrayContaining([
			expect.objectContaining({
				code: "unattributed-specialty-modifier",
				message: expect.stringContaining("athletics"),
			}),
		]));
		expect(await rollFixedSkill(respec._state, "athletics")).toBe(13);
		expect(await rollFixedSkill(respec._state, "acrobatics")).toBe(12);
		expect(await rollFixedSkill(respec._state, "might")).toBe(15);
		expect(state.toJson()).toEqual(liveBefore);
	});

	it("retires only Unyielding Might's Might bonus while leaving level 6 and independent grants intact", async () => {
		const state = makeState();
		const legacyId = state.addNamedModifier({name: "Unyielding Might", type: "skill:might", value: 2});
		const level6 = state.getFeatures().find(feature => feature.name === "Lead the Pack");
		state.addNamedModifier({
			name: "Battle Training",
			type: "skill:athletics",
			value: 1,
		});
		const {respec} = getRespec(state);
		expect(["might", "athletics", "acrobatics"].map(skill => respec._state.getSkillMod(skill)))
			.toEqual([7, 6, 5]);

		await replaceSpecialty(respec, 1, "Mark of the Wilderness");

		expect(["might", "athletics", "acrobatics"].map(skill => respec._state.getSkillMod(skill)))
			.toEqual([4, 6, 5]);
		expect(respec._state.getNamedModifiers()).toEqual(expect.arrayContaining([
			expect.objectContaining({id: legacyId, name: "Unyielding Might", value: 2}),
			expect.objectContaining({name: "Battle Training", type: "skill:athletics", value: 1}),
			expect.objectContaining({sourceFeatureId: level6.id, type: "skill:athletics", proficiencyBonus: true}),
		]));
		expect(respec._engine.getValidation().warnings).toEqual(expect.arrayContaining([
			expect.objectContaining({code: "unattributed-specialty-modifier", message: expect.stringContaining("might")}),
		]));
		expect(await rollFixedSkill(respec._state, "might")).toBe(14);
		expect(await rollFixedSkill(respec._state, "athletics")).toBe(16);
	});

	it("preserves a same-named modifier owned by a different feature without an ambiguous-owner warning", async () => {
		const state = makeState();
		const owner = state.getFeatures().find(feature => feature.name === "Unyielding Might");
		const retainedId = state.addNamedModifier({
			name: "Lead the Pack",
			type: "skill:athletics",
			value: 1,
			sourceDecisionKey: owner.sourceDecisionKey,
		});
		const {respec} = getRespec(state);

		await replaceSpecialty(respec, 6, "Path of Drowning Springs");

		expect(respec._state.getSkillBreakdown("athletics").total).toBe(3);
		expect(respec._state.getNamedModifiers()).toEqual(expect.arrayContaining([
			expect.objectContaining({id: retainedId, sourceDecisionKey: owner.sourceDecisionKey}),
		]));
		expect(respec._engine.getValidation().warnings.some(issue => issue.code === "unattributed-specialty-modifier")).toBe(false);
	});

	it("retires a legacy bonus linked by parent decision key but not feature ID", async () => {
		const state = makeState();
		const owner = state.getFeatures().find(feature => feature.name === "Lead the Pack");
		const linkedId = state.addNamedModifier({
			name: "Lead the Pack",
			type: "skill:athletics",
			value: 1,
			sourceDecisionKey: owner.sourceDecisionKey,
		});
		const {respec} = getRespec(state);
		expect(respec._state.getSkillMod("athletics")).toBe(6);

		await replaceSpecialty(respec, 6, "Path of Drowning Springs");

		expect(respec._state.getSkillMod("athletics")).toBe(2);
		expect(respec._state.getNamedModifiers().some(modifier => modifier.id === linkedId)).toBe(false);
		expect(respec._engine.getValidation().warnings.some(issue => issue.code === "unattributed-specialty-modifier")).toBe(false);
	});

	it("preserves and warns about disabled legacy grants without applying them to rolls", async () => {
		const state = makeState();
		const disabledId = state.addNamedModifier({
			name: "Lead the Pack",
			type: "skill:acrobatics",
			value: 5,
			enabled: false,
		});
		const {respec} = getRespec(state);

		await replaceSpecialty(respec, 6, "Path of Drowning Springs");

		expect(respec._state.getSkillMod("acrobatics")).toBe(2);
		expect(respec._state.getNamedModifiers()).toEqual(expect.arrayContaining([
			expect.objectContaining({id: disabledId, enabled: false}),
		]));
		expect(respec._engine.getValidation().warnings).toEqual(expect.arrayContaining([
			expect.objectContaining({
				code: "unattributed-specialty-modifier",
				message: expect.stringContaining("acrobatics (currently disabled)"),
			}),
		]));
	});

	it("does not double an unlinked legacy PB bonus when loading the original Specialty", async () => {
		const state = makeState({complete: true});
		const owner = state.getFeatures().find(feature => feature.name === "Lead the Pack");
		const legacy = state.getNamedModifiers().find(modifier =>
			modifier.sourceFeatureId === owner.id && modifier.type === "skill:athletics");
		delete legacy.sourceFeatureId;
		state._recalculateCustomModifiers();
		expect(state.getSkillMod("athletics")).toBe(5);

		const {respec} = getRespec(state);
		expect(respec._state.getSkillMod("athletics")).toBe(5);
		await replaceSpecialty(respec, 6, "Path of Drowning Springs");
		expect(respec._state.getSkillMod("athletics")).toBe(5);
		expect(respec._engine.getValidation().warnings).toEqual(expect.arrayContaining([
			expect.objectContaining({code: "unattributed-specialty-modifier"}),
		]));
		expect(respec._engine.getValidation().errors).toEqual([]);
		await respec._engine.apply();
		const reloaded = new CharacterSheetState();
		expect(reloaded.loadFromJson(copy(state.toJson()))).not.toBe(false);
		expect(reloaded.getSkillMod("athletics")).toBe(5);
	});

	it("does not collapse a separately owned PB bonus when an identical orphan also exists", async () => {
		const state = makeState();
		const originalFeature = state.getFeatures().find(feature => feature.name === "Lead the Pack");
		const orphanId = state.addNamedModifier({
			name: "Lead the Pack",
			type: "skill:athletics",
			value: "proficiency",
			sourceType: "classFeature",
			sourceFeatureId: "unresolved-legacy-feature",
		});
		expect(state.getSkillMod("athletics")).toBe(8);
		const {respec} = getRespec(state);
		expect(respec._state.getSkillMod("athletics")).toBe(8);

		await replaceSpecialty(respec, 6, "Path of Drowning Springs");

		expect(respec._state.getSkillMod("athletics")).toBe(5);
		expect(respec._state.getNamedModifiers().some(modifier => modifier.sourceFeatureId === originalFeature.id)).toBe(false);
		expect(respec._state.getNamedModifiers()).toEqual(expect.arrayContaining([
			expect.objectContaining({id: orphanId, proficiencyBonus: true}),
		]));
		expect(respec._engine.getValidation().warnings).toEqual(expect.arrayContaining([
			expect.objectContaining({code: "unattributed-specialty-modifier"}),
		]));
	});

	it("does not guess ownership when a legacy choice has no matching materialized feature in the candidate", async () => {
		const state = makeState({complete: true});
		const missingFeature = state.getFeatures().find(feature => feature.name === "Lead the Pack");
		state._data.features = state._data.features.filter(feature => feature !== missingFeature);
		state.removeModifiersByFeature(missingFeature.id);
		const orphanId = state.addNamedModifier({
			name: "Lead the Pack",
			type: "skill:athletics",
			value: 2,
			sourceFeatureId: "unresolved-legacy-feature",
			sourceType: "classFeature",
		});
		const {respec} = getRespec(state);
		const migratedFeature = respec._state.getFeatures().find(feature => feature.name === "Lead the Pack");
		if (migratedFeature) {
			respec._state._data.features = respec._state._data.features.filter(feature => feature !== migratedFeature);
			respec._state.removeModifiersByFeature(migratedFeature.id);
		}
		expect(respec._state.getSkillMod("athletics")).toBe(4);

		await replaceSpecialty(respec, 6, "Path of Drowning Springs");

		expect(respec._state.getSkillMod("athletics")).toBe(4);
		expect(respec._state.getNamedModifiers()).toEqual(expect.arrayContaining([
			expect.objectContaining({id: orphanId, sourceFeatureId: "unresolved-legacy-feature"}),
		]));
		expect(respec._engine.getValidation().warnings).toEqual(expect.arrayContaining([
			expect.objectContaining({code: "unattributed-specialty-modifier"}),
		]));
		expect(respec._engine.getValidation().errors).toEqual([]);
		await expect(respec._engine.apply()).resolves.toBe(true);
		const reloaded = new CharacterSheetState();
		expect(reloaded.loadFromJson(copy(state.toJson()))).not.toBe(false);
		expect(reloaded.getSkillMod("athletics")).toBe(4);
		expect(reloaded.getNamedModifiers()).toEqual(expect.arrayContaining([
			expect.objectContaining({id: orphanId, sourceFeatureId: "unresolved-legacy-feature"}),
		]));
	});

	it("supports replacing and restoring the level-6 choice without multiplying owned bonuses", async () => {
		const {respec} = getRespec();
		await replaceSpecialty(respec, 6, "Path of Drowning Springs");
		expect(["might", "athletics", "acrobatics"].map(skill => respec._state.getSkillMod(skill)))
			.toEqual([5, 2, 2]);
		expect(respec._engine.getValidation().warnings.some(issue => issue.code === "unattributed-specialty-modifier")).toBe(false);

		await replaceSpecialty(respec, 6, "Lead the Pack");
		expect(["might", "athletics", "acrobatics"].map(skill => respec._state.getSkillMod(skill)))
			.toEqual([5, 5, 5]);
		expect(respec._state.getNamedModifiers().filter(modifier =>
			modifier.name === "Lead the Pack" && modifier.type.startsWith("skill:"),
		).map(modifier => modifier.type).sort()).toEqual(["skill:acrobatics", "skill:athletics"]);
	});

	it("rolls back a failed stage and Cancel without touching the live character", async () => {
		const {respec, state} = getRespec();
		const liveBefore = state.toJson();
		const draftBefore = respec._state.toJson();
		const originalManifest = copy(respec._engine.manifest);
		jest.spyOn(respec._state, "addFeature").mockImplementationOnce(() => {
			throw new Error("Feature materialization failed");
		});

		await expect(replaceSpecialty(respec, 6, "Path of Drowning Springs"))
			.rejects.toThrow("Feature materialization failed");
		const withoutGeneratedModifierIds = data => ({
			...data,
			namedModifiers: data.namedModifiers.map(({id, ...modifier}) => modifier),
		});
		expect(withoutGeneratedModifierIds(respec._state.toJson())).toEqual(withoutGeneratedModifierIds(draftBefore));
		expect(respec._state.getFeatures().map(feature => feature.id))
			.toEqual(draftBefore.features.map(feature => feature.id));
		expect(respec._engine.manifest).toEqual(originalManifest);
		expect(state.toJson()).toEqual(liveBefore);

		jest.restoreAllMocks();
		await replaceSpecialty(respec, 6, "Path of Drowning Springs");
		respec._engine.cancel();
		expect(state.toJson()).toEqual(liveBefore);
	});

	it("allows Apply with an ambiguous legacy warning; failed save, Undo, and reload keep each owner isolated", async () => {
		const state = makeState({complete: true});
		const independentId = state.addNamedModifier({name: "Lead the Pack", type: "skill:athletics", value: 1});
		const before = state.toJson();
		const oldFeature = state.getFeatures().find(feature => feature.name === "Lead the Pack");
		const {respec, page} = getRespec(state);
		await replaceSpecialty(respec, 6, "Path of Drowning Springs");
		const validation = respec._engine.getValidation();
		expect(validation.warnings).toEqual(expect.arrayContaining([
			expect.objectContaining({code: "unattributed-specialty-modifier"}),
		]));
		expect(validation.errors).toEqual([]);
		const candidate = respec._state.toJson();
		page.saveCharacter.mockRejectedValueOnce(new Error("Save unavailable"));

		await expect(respec._engine.apply()).rejects.toThrow("Save unavailable");
		expect(state.toJson()).toEqual(before);
		expect(state.getLevelHistoryEntry(6).choices.featureChoices[0].choice).toBe("Lead the Pack");
		expect(state.getFeatures()).toEqual(expect.arrayContaining([expect.objectContaining({id: oldFeature.id})]));
		expect(state.getSkillMod("athletics")).toBe(6);
		expect(state.getSkillMod("acrobatics")).toBe(5);
		expect(state.getNamedModifiers()).toEqual(expect.arrayContaining([expect.objectContaining({id: independentId})]));
		expect(respec._state.toJson()).toEqual(candidate);
		expect(respec._engine.canUndo).toBe(false);

		await expect(respec._engine.apply()).resolves.toBe(true);
		expect(page.saveCharacter).toHaveBeenCalledTimes(2);
		expect(state.getSkillMod("athletics")).toBe(3);
		expect(state.getNamedModifiers()).toEqual(expect.arrayContaining([expect.objectContaining({id: independentId})]));

		const reloaded = new CharacterSheetState();
		expect(reloaded.loadFromJson(copy(state.toJson()))).not.toBe(false);
		expect(reloaded.getSkillMod("athletics")).toBe(3);
		const reopened = new CharacterSheetRespec({page: getPage(reloaded), state: reloaded});
		reopened._engine.begin();
		expect(reopened._engine.getValidation().warnings.some(issue => issue.code === "unattributed-specialty-modifier")).toBe(false);
		expect(reloaded.getLevelHistoryEntry(6).choices.featureChoices[0].choice).toBe("Path of Drowning Springs");

		const afterApply = state.toJson();
		page.saveCharacter.mockRejectedValueOnce(new Error("Undo save unavailable"));
		await expect(respec._engine.undo()).rejects.toThrow("Undo save unavailable");
		expect(state.toJson()).toEqual(afterApply);
		expect(respec._engine.canUndo).toBe(true);

		await expect(respec._engine.undo()).resolves.toBe(true);
		expect(state.getSkillMod("athletics")).toBe(6);
		expect(state.getSkillMod("acrobatics")).toBe(5);
		expect(state.getLevelHistoryEntry(6).choices.featureChoices[0].choice).toBe("Lead the Pack");
		expect(state.getFeatures()).toEqual(expect.arrayContaining([expect.objectContaining({id: oldFeature.id})]));
		expect(state.getNamedModifiers()).toEqual(expect.arrayContaining([expect.objectContaining({id: independentId})]));
	});

	it("blocks Apply for a genuinely missing subclass even when the preserved bonus is only a warning", async () => {
		const state = makeState();
		state.addNamedModifier({name: "Lead the Pack", type: "skill:athletics", value: 1});
		const {respec} = getRespec(state);
		await replaceSpecialty(respec, 6, "Path of Drowning Springs");
		const validation = respec._engine.getValidation();
		expect(validation.warnings).toEqual(expect.arrayContaining([
			expect.objectContaining({code: "unattributed-specialty-modifier"}),
		]));
		expect(validation.errors).toEqual(expect.arrayContaining([
			expect.objectContaining({code: "decision-missing", message: "Barbarian Subclass is missing."}),
		]));
		await expect(respec._engine.apply()).rejects.toThrow(/Resolve \d+ required Respec items? before applying/);
		expect(state.getSkillMod("athletics")).toBe(6);
	});
});
