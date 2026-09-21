import "./setup.js";
import {jest} from "@jest/globals";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-progression.js";
import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-respec-engine.js";
import "../../../js/charactersheet/charactersheet-respec.js";

const CharacterSheetRespec = globalThis.CharacterSheetRespec;
const CharacterSheetState = globalThis.CharacterSheetState;

const copy = value => JSON.parse(JSON.stringify(value));

const CLASS = {
	name: "Test Class",
	source: "TST",
	level: 2,
	hd: {faces: 8},
	classFeatures: [],
};

const SKILL_EXPERT = {
	name: "Skill Expert",
	source: "XPHB",
	category: "G",
	ability: [{
		choose: {
			from: ["str", "dex", "con", "int", "wis", "cha"],
			count: 1,
			amount: 1,
		},
		max: 20,
	}],
	skillProficiencies: [{any: 1}],
	expertise: [{anyProficientSkill: 1}],
};

const SKILLS = ["Athletics", "Deception", "Engineering", "Persuasion", "Stealth"];

function getState ({independentSelections = false, missing = []} = {}) {
	const state = new CharacterSheetState();
	state.setAbilityBase("con", 20);
	state.setAbilityBase("int", 10);
	state.setAbilityBase("wis", 12);
	state.addClass(copy(CLASS));
	for (let level = 1; level <= 2; ++level) {
		state.recordLevelChoice({
			level,
			class: {name: CLASS.name, source: CLASS.source},
			choices: {},
		});
	}
	state.addFeat({
		...copy(SKILL_EXPERT),
		choices: {
			ability: missing.includes("ability") ? null : "con",
			skills: missing.includes("skills") ? [] : ["Engineering"],
			expertise: missing.includes("expertise") ? [] : ["persuasion"],
		},
	});
	const feat = state._data.feats.find(candidate => candidate.name === SKILL_EXPERT.name);
	feat.id = "juli-skill-expert";
	feat.choices = {
		ability: missing.includes("ability") ? null : "con",
		skills: missing.includes("skills") ? [] : ["Engineering"],
		expertise: missing.includes("expertise") ? [] : ["persuasion"],
	};
	feat.appliedEffects = {
		abilityDeltas: {},
		skillProficiencies: {},
		saveProficienciesAdded: [],
		toolProficienciesAdded: [],
		languagesAdded: [],
		spellsAdded: [],
		innateSpellsAdded: [],
		immunitiesAdded: [],
		conditionImmunitiesAdded: [],
	};
	state._data.progressionOwnership = {version: 1, initialized: false, values: {}};
	state.setSkillProficiency("engineering", independentSelections ? 1 : 0);
	state.setSkillProficiency("persuasion", 2);
	state.setSkillProficiency("athletics", 1);
	state.setSkillProficiency("deception", 2);
	state._trackGrantedProficiency("skills", "athletics", "independent-athletics");
	state._trackGrantedProficiency("skills", "deception", "independent-deception");
	if (independentSelections) {
		state._trackGrantedProficiency("skills", "engineering", "independent-engineering");
		state._trackGrantedProficiency("skills", "persuasion", "independent-persuasion");
	}
	return state;
}

function getPage (state) {
	return {
		getState: () => state,
		getClasses: () => [copy(CLASS)],
		getClassFeatures: () => [],
		getSubclassFeatures: () => [],
		getOptionalFeatures: () => [],
		getFeats: () => [copy(SKILL_EXPERT)],
		getSpells: () => [],
		getFilteredSpellData: () => [],
		getSkillsList: () => [...SKILLS],
		getRaces: () => [],
		getBackgrounds: () => [],
		filterByAllowedSources: values => values,
		saveCharacter: jest.fn().mockResolvedValue(undefined),
		renderCharacter: jest.fn(),
	};
}

function getParent (manifest) {
	return manifest.base.decisions.find(decision =>
		decision.meta?.unplacedFeat
			&& decision.selection?.name === SKILL_EXPERT.name,
	);
}

function getChild (manifest, choiceKey) {
	const parent = getParent(manifest);
	return manifest.base.decisions.find(decision =>
		decision.meta?.unplacedFeatChoice
			&& decision.meta?.featChoiceKey === choiceKey
			&& decision.rootSemanticKey === parent?.semanticKey,
	);
}

function getFeat (state) {
	return state._data.feats.find(feat => feat.name === SKILL_EXPERT.name && feat.source === SKILL_EXPERT.source);
}

function getStubText (element) {
	return [
		element?.textContent || "",
		...(element?.children || []).map(getStubText),
	].filter(Boolean).join(" ");
}

async function stageChoice (respec, choiceKey, selection) {
	const child = getChild(respec._engine.manifest, choiceKey);
	await respec._engine.stageGraphMutation(child.id, selection, {
		reverseParent: true,
		apply: ({state}) => respec._applyManifestSelectionMechanics(child, selection, child.options, state),
	});
}

function getSnapshot (state) {
	const feat = getFeat(state);
	return {
		abilities: {
			con: state.getAbilityBase("con"),
			int: state.getAbilityBase("int"),
			wis: state.getAbilityBase("wis"),
		},
		skills: Object.fromEntries(["athletics", "deception", "engineering", "persuasion", "stealth"]
			.map(skill => [skill, state.getSkillProficiency(skill)])),
		feat: {
			id: feat.id,
			owner: feat.sourceDecisionKey || null,
			choices: copy(feat.choices),
			appliedEffects: copy(feat.appliedEffects),
		},
	};
}

describe("Character Sheet Respec unplaced Skill Expert choices", () => {
	it("discovers stable dependent children and adopts Juli's exact evidence", () => {
		const state = getState();
		const respec = new CharacterSheetRespec({page: getPage(state), state});

		respec._engine.begin();
		const parent = getParent(respec._engine.manifest);
		const ability = getChild(respec._engine.manifest, "ability");
		const skill = getChild(respec._engine.manifest, "skills");
		const expertise = getChild(respec._engine.manifest, "expertise");
		const candidate = respec._engine.state;

		expect([ability, skill, expertise]).toEqual([
			expect.objectContaining({
				type: "nestedAbility",
				selection: "con",
				scope: "unplaced",
				characterLevel: null,
				classLevel: null,
				parentSemanticKey: parent.semanticKey,
				rootSemanticKey: parent.semanticKey,
			}),
			expect.objectContaining({
				type: "nestedSkill",
				selection: ["Engineering"],
				scope: "unplaced",
				characterLevel: null,
				classLevel: null,
				parentSemanticKey: parent.semanticKey,
				rootSemanticKey: parent.semanticKey,
			}),
			expect.objectContaining({
				type: "nestedExpertise",
				selection: ["persuasion"],
				scope: "unplaced",
				characterLevel: null,
				classLevel: null,
				parentSemanticKey: parent.semanticKey,
				rootSemanticKey: parent.semanticKey,
				meta: expect.objectContaining({dependsOnSemanticKeys: [skill.semanticKey]}),
			}),
		]);
		expect(new Set([ability.semanticKey, skill.semanticKey, expertise.semanticKey]).size).toBe(3);
		const normalizedSkillOptions = skill.options.map(value => String(value).toLowerCase().replace(/\s+/g, ""));
		expect(normalizedSkillOptions).toEqual(expect.arrayContaining(["engineering", "stealth"]));
		expect(normalizedSkillOptions).not.toEqual(expect.arrayContaining(["athletics", "deception"]));
		expect(expertise.options).toEqual(expect.arrayContaining(["athletics", "engineering", "persuasion"]));
		expect(expertise.options).not.toContain("deception");

		expect(candidate.getAbilityBase("con")).toBe(20);
		expect(candidate.getSkillProficiency("engineering")).toBe(1);
		expect(candidate.getSkillProficiency("persuasion")).toBe(2);
		expect(ability.receipt.effects[0]).toMatchObject({type: "abilityDelta", ability: "con", amount: 1, before: 19});
		expect(skill.receipt.effects[0]).toMatchObject({
			type: "ownership",
			ownership: [{type: "skills", value: "Engineering"}],
		});
		expect(expertise.receipt.effects[0]).toMatchObject({
			type: "ownership",
			ownership: [{type: "expertise", value: "persuasion"}],
		});
		expect(getFeat(candidate)).toMatchObject({
			id: "juli-skill-expert",
			sourceDecisionKey: parent.semanticKey,
			appliedEffects: {
				abilityDeltas: {con: 1},
				skillProficiencies: {
					engineering: {before: 0, after: 1},
					persuasion: {before: 1, after: 2},
				},
			},
		});
		const text = getStubText(respec._renderBaseCard());
		expect(text).toContain("Change ability");
		expect(text).toContain("Change skill");
		expect(text).toContain("Change expertise");
	});

	it("keeps missing evidence required instead of guessing", () => {
		const state = getState({missing: ["skills", "expertise"]});
		state.setSkillProficiency("persuasion", 1);
		const respec = new CharacterSheetRespec({page: getPage(state), state});

		respec._engine.begin();
		const skill = getChild(respec._engine.manifest, "skills");
		const expertise = getChild(respec._engine.manifest, "expertise");

		expect(skill).toMatchObject({selection: null, status: "missing", required: true, receipt: null});
		expect(expertise).toMatchObject({selection: null, status: "missing", required: true, receipt: null});
		expect(respec._engine.getValidation().errors).toEqual(expect.arrayContaining([
			expect.objectContaining({decisionId: skill.id, code: "decision-missing"}),
			expect.objectContaining({decisionId: expertise.id, code: "decision-missing"}),
		]));
	});

	it("supports exact no-op edits without score or proficiency drift", async () => {
		const state = getState();
		const respec = new CharacterSheetRespec({page: getPage(state), state});

		respec._engine.begin();
		await stageChoice(respec, "ability", "con");
		await stageChoice(respec, "skills", ["Engineering"]);
		await stageChoice(respec, "expertise", ["persuasion"]);

		expect(getSnapshot(respec._engine.state)).toMatchObject({
			abilities: {con: 20, int: 10, wis: 12},
			skills: {engineering: 1, persuasion: 2},
			feat: {
				id: "juli-skill-expert",
				choices: {
					ability: "con",
					skills: ["Engineering"],
					expertise: ["persuasion"],
				},
			},
		});
		expect(respec._engine.getValidation().isValid).toBe(true);
	});

	it("updates expertise eligibility after the staged proficiency choice", async () => {
		const state = getState();
		const respec = new CharacterSheetRespec({page: getPage(state), state});

		respec._engine.begin();
		await stageChoice(respec, "expertise", ["Engineering"]);
		expect(respec._engine.state.getSkillProficiency("engineering")).toBe(2);
		await stageChoice(respec, "skills", ["Stealth"]);

		const invalidExpertise = getChild(respec._engine.manifest, "expertise");
		expect(invalidExpertise.selection).toEqual(["Engineering"]);
		expect(invalidExpertise.options).toContain("stealth");
		expect(invalidExpertise.options).not.toContain("engineering");
		expect(invalidExpertise.status).toBe("invalid");
		expect(respec._engine.getValidation().isValid).toBe(false);
		await expect(respec._engine.apply()).rejects.toThrow(/resolve .* required respec item/i);

		await stageChoice(respec, "expertise", ["Stealth"]);
		expect(respec._engine.getValidation().isValid).toBe(true);
		expect(respec._engine.state.getSkillProficiency("engineering")).toBe(0);
		expect(respec._engine.state.getSkillProficiency("stealth")).toBe(2);
	});

	it("preserves independently granted proficiency and expertise", async () => {
		const state = getState({independentSelections: true});
		const respec = new CharacterSheetRespec({page: getPage(state), state});

		respec._engine.begin();
		expect(getChild(respec._engine.manifest, "skills").status).toBe("invalid");
		expect(getChild(respec._engine.manifest, "expertise").status).toBe("invalid");
		await stageChoice(respec, "skills", ["Stealth"]);
		await stageChoice(respec, "expertise", ["Stealth"]);

		expect(respec._engine.state.getSkillProficiency("engineering")).toBe(1);
		expect(respec._engine.state.getSkillProficiency("persuasion")).toBe(2);
		expect(respec._engine.state.getSkillProficiency("stealth")).toBe(2);
		expect(respec._engine.getValidation().isValid).toBe(true);
	});

	it("round-trips all three choices through Cancel, Apply/reload, and Undo", async () => {
		const state = getState();
		expect(state.loadFromJson(state.toJson())).not.toBe(false);
		const original = state.toJson();
		const page = getPage(state);
		const respec = new CharacterSheetRespec({page, state});

		respec._engine.begin();
		await stageChoice(respec, "ability", "int");
		await stageChoice(respec, "skills", ["Stealth"]);
		await stageChoice(respec, "expertise", ["Stealth"]);
		respec._engine.cancel();
		expect(state.toJson()).toEqual(original);

		respec._engine.begin();
		await stageChoice(respec, "ability", "int");
		await stageChoice(respec, "skills", ["Stealth"]);
		await stageChoice(respec, "expertise", ["Stealth"]);
		await respec._engine.apply();
		expect(getSnapshot(state)).toMatchObject({
			abilities: {con: 19, int: 11, wis: 12},
			skills: {engineering: 0, persuasion: 1, stealth: 2},
			feat: {
				id: "juli-skill-expert",
				choices: {
					ability: "int",
					skills: ["Stealth"],
					expertise: ["Stealth"],
				},
			},
		});

		const loaded = new CharacterSheetState();
		expect(loaded.loadFromJson(state.toJson())).not.toBe(false);
		const reopened = new CharacterSheetRespec({page: getPage(loaded), state: loaded});
		reopened._engine.begin();
		expect(getChild(reopened._engine.manifest, "ability").selection).toBe("int");
		expect(getChild(reopened._engine.manifest, "skills").selection).toEqual(["Stealth"]);
		expect(getChild(reopened._engine.manifest, "expertise").selection).toEqual(["Stealth"]);
		expect(getSnapshot(loaded)).toMatchObject({
			abilities: {con: 19, int: 11},
			skills: {engineering: 0, persuasion: 1, stealth: 2},
		});

		respec._engine.begin();
		await stageChoice(respec, "expertise", ["persuasion"]);
		await respec._engine.apply();
		expect(state.getSkillProficiency("persuasion")).toBe(2);
		expect(state.getSkillProficiency("stealth")).toBe(1);
		expect(getFeat(state).appliedEffects.skillProficiencies).toMatchObject({
			persuasion: {before: 1, after: 2},
			stealth: {before: 0, after: 1},
		});
		expect(await respec._engine.undo()).toBe(true);
		expect(getSnapshot(state)).toMatchObject({
			abilities: {con: 19, int: 11},
			skills: {persuasion: 1, stealth: 2},
			feat: {
				id: "juli-skill-expert",
				choices: {
					ability: "int",
					skills: ["Stealth"],
					expertise: ["Stealth"],
				},
			},
		});
		expect(getFeat(state).appliedEffects.skillProficiencies).toEqual({
			stealth: {before: 0, after: 2},
		});
		expect(await respec._engine.undo()).toBe(false);
	});
});
