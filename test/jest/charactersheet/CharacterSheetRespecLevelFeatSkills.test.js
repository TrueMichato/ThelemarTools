import "./setup.js";
import fs from "node:fs";
import {jest} from "@jest/globals";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-progression.js";
import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-respec-engine.js";
import "../../../js/charactersheet/charactersheet-respec.js";

const CharacterSheetRespec = globalThis.CharacterSheetRespec;
const CharacterSheetState = globalThis.CharacterSheetState;
const copy = value => JSON.parse(JSON.stringify(value));
const SKILL_EXPERT = JSON.parse(fs.readFileSync("data/feats.json", "utf8")).feat
	.find(feat => feat.name === "Skill Expert" && feat.source === "XPHB");

const CHAMPION = {
	name: "Champion",
	shortName: "Champion",
	source: "XPHB",
	className: "Fighter",
	classSource: "XPHB",
};
const FIGHTER = {
	name: "Fighter",
	source: "XPHB",
	level: 4,
	hd: {number: 1, faces: 10},
	subclass: CHAMPION,
	subclasses: [CHAMPION],
	classFeatures: [[], [], [], ["Ability Score Improvement|Fighter|XPHB|4"]],
};
const OLD_FEAT = {name: "Old Feat", source: "TST", category: "G"};
const SKILLS = ["Athletics", "Deception", "Stealth", "Persuasion"];

function getFixture ({classic = false, asi = false} = {}) {
	const state = new CharacterSheetState();
	if (classic) state.setSetting("thelemar_asiFeat", false);
	state.setAbilityBase("str", 16);
	state.setAbilityBase("dex", 14);
	state.setAbilityBase("cha", 10);
	const champion = classic ? {...CHAMPION, source: "PHB", classSource: "PHB"} : CHAMPION;
	const fighter = classic
		? {
			...FIGHTER,
			source: "PHB",
			subclass: champion,
			subclasses: [champion],
			classFeatures: [[], [], [], ["Ability Score Improvement|Fighter|PHB|4"]],
		}
		: FIGHTER;
	state.addClass(copy(fighter));
	state.addSkillProficiency("athletics");
	for (let level = 1; level <= 4; level++) {
		state.recordLevelChoice({
			level,
			class: {name: fighter.name, source: fighter.source},
			choices: level === 4
				? classic
					? asi ? {asi: {str: 2}} : {feat: {name: OLD_FEAT.name, source: OLD_FEAT.source}}
					: {asi: {str: 2}, feat: {name: OLD_FEAT.name, source: OLD_FEAT.source}}
				: level === 3 ? {subclass: copy(champion)} : {},
		});
	}
	if (!asi) state.addFeat(copy(OLD_FEAT));
	const page = {
		getState: () => state,
		getClasses: () => [copy(fighter)],
		getClassFeatures: () => [],
		getSubclassFeatures: () => [],
		getOptionalFeatures: () => [],
		getFeats: () => [copy(OLD_FEAT), copy(SKILL_EXPERT)],
		getSpells: () => [],
		getFilteredSpellData: () => [],
		getSkillsList: () => [...SKILLS],
		getRaces: () => [],
		getBackgrounds: () => [],
		filterByAllowedSources: values => values,
		saveCharacter: jest.fn().mockResolvedValue(undefined),
		renderCharacter: jest.fn(),
	};
	const respec = new CharacterSheetRespec({page, state});
	respec._engine.begin();
	respec._state = respec._engine.state;
	return {respec, state, page};
}

function getChild (respec, type) {
	return respec._engine.manifest.decisions.find(decision =>
		decision.type === type
			&& decision.characterLevel === 4
			&& decision.provenance?.ownerUid === "skill expert|xphb",
	);
}

function stageFeat (respec, choices = {skills: ["stealth"], expertise: ["athletics"], ability: "con"}) {
	const parent = respec._engine.manifest.decisions.find(decision =>
		decision.characterLevel === 4 && decision.type === "feat",
	);
	expect(parent).toBeDefined();
	expect(respec._applyImprovementChange(parent, {
		mode: "feat",
		feat: {...copy(SKILL_EXPERT), choices: copy(choices)},
		featChoices: copy(choices),
	})).toBe(true);
	return parent;
}

async function stageChild (respec, type, selection) {
	const child = getChild(respec, type);
	expect(child).toBeDefined();
	await respec._engine.stageGraphMutation(child.id, selection, {
		reverseParent: true,
		apply: ({state}) => respec._applyManifestSelectionMechanics(child, selection, child.options, state),
	});
}

describe("Respec level-owned feat skill and expertise", () => {
	it("discovers and edits Skill Expert beneath a classic PHB Fighter's ASI-or-feat choice", async () => {
		const {respec, state, page} = getFixture({classic: true});
		const parent = respec._engine.manifest.decisions.find(decision =>
			decision.characterLevel === 4 && decision.type === "asiOrFeat");
		expect(parent).toMatchObject({
			selection: {mode: "feat", feat: {name: OLD_FEAT.name, source: OLD_FEAT.source}},
		});
		const choices = {skills: ["stealth"], expertise: ["stealth"], ability: "con"};
		expect(respec._applyImprovementChange(parent, {
			mode: "feat",
			feat: {...copy(SKILL_EXPERT), choices: copy(choices)},
			featChoices: copy(choices),
		})).toBe(true);
		expect(getChild(respec, "nestedSkill")).toMatchObject({
			parentSemanticKey: parent.semanticKey,
			selection: ["stealth"],
			status: "resolved",
		});
		expect(getChild(respec, "nestedExpertise")).toMatchObject({
			parentSemanticKey: parent.semanticKey,
			selection: ["stealth"],
			status: "resolved",
		});
		expect(state.getSkillProficiency("stealth")).toBe(0);
		await stageChild(respec, "nestedSkill", ["deception"]);
		expect(getChild(respec, "nestedExpertise")).toMatchObject({
			selection: ["stealth"],
			status: "invalid",
		});
		expect(getChild(respec, "nestedExpertise").options).toContain("deception");
		expect(respec._engine.getValidation().isValid).toBe(false);
		await stageChild(respec, "nestedExpertise", ["deception"]);
		const candidate = respec._engine.state;
		expect(respec._engine.manifest.decisions.find(decision => decision.semanticKey === parent.semanticKey).selection)
			.toMatchObject({mode: "feat", feat: {name: "Skill Expert", source: "XPHB"}});
		expect(candidate.getSkillProficiency("deception")).toBe(2);
		expect(candidate.getSkillProficiency("stealth")).toBe(0);
		expect(candidate.getSkillBreakdown("deception").total - state.getSkillBreakdown("deception").total).toBe(4);
		expect(candidate.getFeats().find(feat => feat.name === "Skill Expert").appliedEffects.skillProficiencies)
			.toEqual({deception: {before: 0, after: 2}});
		expect(state.getSkillProficiency("deception")).toBe(0);
		expect(respec._engine.getValidation().errors).toEqual([]);
		await expect(respec._engine.apply()).resolves.toBe(true);
		expect(state.getSkillProficiency("deception")).toBe(2);
		const reloaded = new CharacterSheetState();
		expect(reloaded.loadFromJson(state.toJson())).not.toBe(false);
		const reopened = new CharacterSheetRespec({page: {...page, getState: () => reloaded}, state: reloaded});
		reopened._engine.begin();
		expect(getChild(reopened, "nestedSkill").selection).toEqual(["deception"]);
		expect(getChild(reopened, "nestedExpertise").selection).toEqual(["deception"]);
		await expect(respec._engine.undo()).resolves.toBe(true);
		expect(state.getSkillProficiency("deception")).toBe(0);
		expect(state.getFeats().some(feat => feat.name === OLD_FEAT.name)).toBe(true);
	});

	it("leaves a classic Fighter's ASI choice free of feat children", () => {
		const {respec} = getFixture({classic: true, asi: true});
		const parent = respec._engine.manifest.decisions.find(decision =>
			decision.characterLevel === 4 && decision.type === "asiOrFeat");
		expect(parent).toMatchObject({selection: {mode: "asi", asi: {str: 2}}});
		expect(respec._engine.manifest.decisions.filter(decision =>
			decision.parentSemanticKey === parent.semanticKey && decision.scope === "nested",
		)).toEqual([]);
		expect(getChild(respec, "nestedSkill")).toBeUndefined();
	});

	it("discovers the actual Skill Expert selections after a real improvement transaction", () => {
		const {respec, state} = getFixture();
		const liveBefore = state.toJson();
		const parent = stageFeat(respec);
		const skill = getChild(respec, "nestedSkill");
		const expertise = getChild(respec, "nestedExpertise");

		expect(skill).toMatchObject({
			parentSemanticKey: parent.semanticKey,
			selection: ["stealth"],
			status: "resolved",
		});
		expect(expertise).toMatchObject({
			parentSemanticKey: parent.semanticKey,
			selection: ["athletics"],
			status: "resolved",
		});
		expect(respec._engine.getValidation().errors).toEqual([]);
		expect(state.toJson()).toEqual(liveBefore);
	});

	it("replaces a feat-owned skill without leaving its recorded grant behind", async () => {
		const {respec, state} = getFixture();
		const original = state.toJson();
		stageFeat(respec);
		await stageChild(respec, "nestedSkill", ["deception"]);

		const candidate = respec._engine.state;
		const feat = candidate.getFeats().find(it => it.name === "Skill Expert");
		expect(candidate.getSkillProficiency("stealth")).toBe(0);
		expect(candidate.getSkillProficiency("deception")).toBe(1);
		expect(candidate.getSkillProficiency("athletics")).toBe(2);
		expect(feat.choices.skills).toEqual(["deception"]);
		expect(feat.appliedEffects.skillProficiencies).not.toHaveProperty("stealth");
		expect(feat.appliedEffects.skillProficiencies.deception).toMatchObject({before: 0, after: 1});
		expect(candidate.getSkillBreakdown("deception").total - state.getSkillBreakdown("deception").total).toBe(2);
		expect(state.toJson()).toEqual(original);
		expect(respec._engine.getValidation().errors).toEqual([]);
		await expect(respec._engine.apply()).resolves.toBe(true);
		expect(state.getSkillMod("deception")).toBe(candidate.getSkillBreakdown("deception").total);
		expect(state.getSkillProficiency("stealth")).toBe(0);
		await expect(respec._engine.undo()).resolves.toBe(true);
		expect(state.getSkillProficiency("deception")).toBe(0);
		expect(state.getSkillProficiency("athletics")).toBe(1);
		expect(state.getFeats().map(it => it.name)).toContain(OLD_FEAT.name);
		expect(state.getFeats().map(it => it.name)).not.toContain(SKILL_EXPERT.name);
		expect(state.getSkillBreakdown("deception").total).toBe(0);
	});

	it("invalidates and repairs expertise dependent on this feat's chosen proficiency", async () => {
		const {respec, state, page} = getFixture();
		stageFeat(respec, {
			skills: ["stealth"],
			expertise: ["stealth"],
			ability: "con",
			unknownChoice: {option: "keep me"},
		});
		expect(getChild(respec, "nestedExpertise").options).toContain("stealth");
		await stageChild(respec, "nestedSkill", ["deception"]);
		const dependent = getChild(respec, "nestedExpertise");
		expect(dependent.selection).toEqual(["stealth"]);
		expect(dependent.options).toContain("deception");
		expect(dependent.options).not.toContain("stealth");
		expect(dependent.status).toBe("invalid");
		expect(respec._engine.getValidation().isValid).toBe(false);
		await expect(respec._engine.apply()).rejects.toThrow(/resolve .* required respec item/i);
		expect(state.getSkillProficiency("stealth")).toBe(0);

		await stageChild(respec, "nestedExpertise", ["deception"]);
		const candidate = respec._engine.state;
		const feat = candidate.getFeats().find(it => it.name === "Skill Expert");
		expect(candidate.getSkillProficiency("stealth")).toBe(0);
		expect(candidate.getSkillProficiency("deception")).toBe(2);
		expect(feat.choices).toMatchObject({
			skills: ["deception"],
			expertise: ["deception"],
			unknownChoice: {option: "keep me"},
		});
		expect(feat.appliedEffects.skillProficiencies).toEqual({deception: {before: 0, after: 2}});
		expect(respec._engine.getValidation().errors).toEqual([]);
		respec._engine.cancel();
		expect(state.getSkillProficiency("deception")).toBe(0);

		respec._engine.begin();
		respec._state = respec._engine.state;
		stageFeat(respec, {skills: ["stealth"], expertise: ["stealth"], ability: "con"});
		await stageChild(respec, "nestedSkill", ["deception"]);
		await stageChild(respec, "nestedExpertise", ["deception"]);
		await respec._engine.apply();
		const reloaded = new CharacterSheetState();
		expect(reloaded.loadFromJson(state.toJson())).not.toBe(false);
		const reopened = new CharacterSheetRespec({page: {...page, getState: () => reloaded}, state: reloaded});
		reopened._engine.begin();
		expect(reloaded.getSkillProficiency("deception")).toBe(2);
		expect(reloaded.getSkillBreakdown("deception").components).toEqual(expect.arrayContaining([
			expect.objectContaining({type: "proficiency", name: "Expertise (2×)", value: 4}),
		]));
		expect(getChild(reopened, "nestedSkill").selection).toEqual(["deception"]);
		expect(getChild(reopened, "nestedExpertise").selection).toEqual(["deception"]);
		await respec._engine.undo();
		expect(state.getSkillProficiency("deception")).toBe(0);
	});

	it("retains another source's overlapping skill and expertise", async () => {
		const {respec} = getFixture();
		stageFeat(respec);
		const candidate = respec._engine.state;
		candidate._trackGrantedProficiency("skills", "stealth", "manual-overlap");
		candidate._getProgressionOwnershipEntry("skills", "stealth", {isCreate: true}).preserved = true;
		candidate._getProgressionOwnershipEntry("expertise", "athletics", {isCreate: true}).preserved = true;
		await stageChild(respec, "nestedSkill", ["deception"]);
		await stageChild(respec, "nestedExpertise", ["deception"]);
		expect(candidate.getSkillProficiency("stealth")).toBe(1);
		expect(candidate.getSkillProficiency("athletics")).toBe(2);
		expect(candidate.getSkillProficiency("deception")).toBe(2);
	});

	it("later replacing Skill Expert removes only its updated feat receipt", async () => {
		const {respec} = getFixture();
		stageFeat(respec);
		await stageChild(respec, "nestedSkill", ["deception"]);
		const parent = respec._engine.manifest.decisions.find(it =>
			it.type === "feat" && it.characterLevel === 4);
		expect(respec._applyImprovementChange(parent, {
			mode: "feat",
			feat: copy(OLD_FEAT),
			featChoices: {},
		})).toBe(true);
		const candidate = respec._engine.state;
		expect(candidate.getSkillProficiency("stealth")).toBe(0);
		expect(candidate.getSkillProficiency("deception")).toBe(0);
		expect(candidate.getSkillProficiency("athletics")).toBe(1);
		expect(respec._engine.getValidation().errors).toEqual([]);
	});

	it("rejects an ambiguous old feat receipt without touching the candidate or live skills", async () => {
		const {respec, state} = getFixture();
		stageFeat(respec);
		const candidate = respec._engine.state;
		delete candidate._data.feats.find(feat => feat.name === "Skill Expert").appliedEffects;
		respec._engine.refreshManifest();
		expect(getChild(respec, "nestedSkill").status).toBe("invalid");
		expect(getChild(respec, "nestedExpertise").status).toBe("invalid");
		expect(respec._engine.getValidation().errors).toEqual(expect.arrayContaining([
			expect.objectContaining({message: expect.stringMatching(/saved feat does not prove which grant it owns/i)}),
		]));
		await expect(respec._engine.apply()).rejects.toThrow(/resolve .* required respec item/i);
		const beforeCandidate = candidate.getSkillProficiencies();
		const beforeLive = state.toJson();
		await expect(stageChild(respec, "nestedSkill", ["deception"]))
			.rejects.toThrow(/does not prove which grant it owns/i);
		expect(respec._engine.state.getSkillProficiencies()).toEqual(beforeCandidate);
		expect(state.toJson()).toEqual(beforeLive);
	});

	it("blocks replacing a legacy level feat without proof of its skill grants", () => {
		const {respec, state} = getFixture();
		stageFeat(respec);
		const candidate = respec._engine.state;
		delete candidate._data.feats.find(feat => feat.name === "Skill Expert").appliedEffects;
		const beforeCandidate = candidate.getSkillProficiencies();
		const beforeLive = state.toJson();
		const decision = respec._engine.manifest.decisions.find(it =>
			it.type === "feat" && it.characterLevel === 4);

		expect(respec._applyImprovementChange(decision, {
			mode: "feat",
			feat: copy(OLD_FEAT),
			featChoices: {},
		})).toBe(false);
		expect(respec._engine.state.getSkillProficiencies()).toEqual(beforeCandidate);
		expect(respec._engine.state.getFeats().map(feat => feat.name)).toContain("Skill Expert");
		expect(state.toJson()).toEqual(beforeLive);
	});

	it("does not invent a missing skill choice on a loaded legacy feat", async () => {
		const {respec, state, page} = getFixture();
		stageFeat(respec);
		await respec._engine.apply();
		const save = state.toJson();
		const feat = save.feats.find(it => it.name === "Skill Expert");
		delete feat.choices.skills;
		delete feat.appliedEffects;
		const loaded = new CharacterSheetState();
		expect(loaded.loadFromJson(save)).not.toBe(false);
		const oldSaveRespec = new CharacterSheetRespec({page: {...page, getState: () => loaded}, state: loaded});
		oldSaveRespec._engine.begin();
		oldSaveRespec._state = oldSaveRespec._engine.state;
		const before = loaded.toJson();
		const originalChoice = oldSaveRespec._engine.state.getFeats().find(it => it.name === "Skill Expert").choices;

		await expect(stageChild(oldSaveRespec, "nestedSkill", ["deception"]))
			.rejects.toThrow(/saved skills choice is incomplete/i);
		expect(oldSaveRespec._engine.state.getFeats().find(it => it.name === "Skill Expert").choices).toEqual(originalChoice);
		expect(loaded.toJson()).toEqual(before);
		expect(oldSaveRespec._engine.getValidation().errors).toEqual(expect.arrayContaining([
			expect.objectContaining({message: expect.stringMatching(/saved feat does not prove which grant it owns/i)}),
		]));
	});
});
