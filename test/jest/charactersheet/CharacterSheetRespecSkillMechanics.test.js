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

const SKILLS = [
	"Animal Handling",
	"Athletics",
	"Engineering",
	"Persuasion",
	"Sleight of Hand",
];

function getState () {
	const state = new CharacterSheetState();
	state.setAbilityBase("con", 20);
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
			ability: "con",
			skills: ["Engineering"],
			expertise: ["Persuasion"],
		},
	});
	const feat = state._data.feats.find(candidate => candidate.name === SKILL_EXPERT.name);
	feat.id = "respec-skill-expert";
	feat.choices = {
		ability: "con",
		skills: ["Engineering"],
		expertise: ["Persuasion"],
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
	state.setSkillProficiency("persuasion", 2);
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

function getRespec (state = getState()) {
	const page = getPage(state);
	const respec = new CharacterSheetRespec({page, state});
	respec._engine.begin();
	respec._state = respec._engine.state;
	return {page, respec, state};
}

async function stageChoice (respec, choiceKey, selection) {
	const decision = getChild(respec._engine.manifest, choiceKey);
	await respec._engine.stageGraphMutation(decision.id, selection, {
		reverseParent: true,
		apply: ({state}) => respec._applyManifestSelectionMechanics(
			decision,
			selection,
			decision.options,
			state,
		),
	});
}

function getProficiencyComponents (state, skill) {
	return state.getSkillBreakdown(skill).components
		.filter(component => component.type === "proficiency");
}

describe("Character Sheet Respec skill mechanics", () => {
	it("stages a spaced skill choice under the canonical mechanical key", async () => {
		const {respec, state: liveState} = getRespec();
		const liveBefore = liveState.toJson();

		await stageChoice(respec, "skills", ["Animal Handling"]);

		expect(respec._engine.state.getSkillProficiency("animalhandling")).toBe(1);
		expect(respec._engine.state.getSkillProficiencies()).not.toHaveProperty("animal handling");
		expect(getProficiencyComponents(respec._engine.state, "animalhandling")).toEqual([
			expect.objectContaining({name: "Proficiency", value: 2}),
		]);
		expect(liveState.toJson()).toEqual(liveBefore);
	});

	it("round-trips a spaced skill and expertise through Cancel, Apply/reload, and Undo", async () => {
		const state = getState();
		const original = state.toJson();
		const page = getPage(state);
		const respec = new CharacterSheetRespec({page, state});

		respec._engine.begin();
		respec._state = respec._engine.state;
		await stageChoice(respec, "skills", ["Animal Handling"]);
		await stageChoice(respec, "expertise", ["Animal Handling"]);
		respec._engine.cancel();
		expect(state.toJson()).toEqual(original);

		respec._engine.begin();
		respec._state = respec._engine.state;
		await stageChoice(respec, "skills", ["Animal Handling"]);
		await stageChoice(respec, "expertise", ["Animal Handling"]);
		await expect(respec._engine.apply()).resolves.toBe(true);
		expect(state.getSkillProficiency("animalhandling")).toBe(2);
		expect(Object.keys(state.getSkillProficiencies())).not.toContain("animal handling");

		const reloaded = new CharacterSheetState();
		expect(reloaded.loadFromJson(state.toJson())).not.toBe(false);
		expect(reloaded.getSkillProficiency("animalhandling")).toBe(2);
		expect(getProficiencyComponents(reloaded, "animalhandling")).toEqual([
			expect.objectContaining({name: "Expertise (2×)", value: 4}),
		]);

		await expect(respec._engine.undo()).resolves.toBe(true);
		expect(state.getSkillProficiency("animalhandling")).toBe(0);
		expect(state.getSkillProficiency("persuasion")).toBe(2);
		expect(state._data.feats.find(feat => feat.id === "respec-skill-expert")?.choices).toEqual({
			ability: "con",
			skills: ["Engineering"],
			expertise: ["Persuasion"],
		});
		expect(respec._engine.canUndo).toBe(false);
	});

	it("keeps a mechanically complete same-choice edit clean", async () => {
		const {respec} = getRespec();
		const before = respec._engine.state.toJson();
		const undoSnapshot = {sentinel: true};
		respec._engine._undoSnapshot = undoSnapshot;

		await stageChoice(respec, "skills", ["Engineering"]);

		expect(respec._engine.isDirty).toBe(false);
		expect(respec._engine.state.toJson()).toEqual(before);
		expect(respec._engine._undoSnapshot).toBe(undoSnapshot);
	});

	it("falls through the same-choice guard when the receipt is missing", async () => {
		const {respec} = getRespec();
		const decision = getChild(respec._engine.manifest, "skills");
		const stored = respec._engine.state.getCharacterBase().decisions.find(candidate =>
			candidate.semanticKey === decision.semanticKey,
		);
		decision.receipt = null;
		stored.receipt = null;

		await stageChoice(respec, "skills", ["Engineering"]);

		expect(respec._engine.isDirty).toBe(true);
		expect(getChild(respec._engine.manifest, "skills").receipt).toEqual(expect.objectContaining({
			sourceDecisionKey: decision.semanticKey,
		}));
		expect(respec._engine.state.getSkillProficiency("engineering")).toBe(1);
	});

	it("normalizes whitespace aliases on load without re-keying custom punctuation", () => {
		const data = new CharacterSheetState().toJson();
		data.skillProficiencies = {
			"animal handling": 1,
			animalhandling: 2,
			"chef's-craft": 1,
		};
		data.grantedProficiencies.skills = {
			"animal handling": ["feature:a"],
			animalhandling: ["feature:b"],
			"chef's-craft": ["feature:custom"],
		};
		data.namedModifiers = [{
			id: "legacy-spaced-skill-modifier",
			name: "Legacy Animal Handling Bonus",
			type: "skill:animal handling",
			value: 1,
			enabled: true,
		}, {
			id: "custom-punctuated-skill-modifier",
			name: "Custom Skill Bonus",
			type: "skill:chef's-craft",
			value: 1,
			enabled: true,
		}];
		data.progressionOwnership = {
			version: 1,
			initialized: true,
			values: {
				skills: {
					"animal handling": {
						value: "Animal Handling",
						sources: ["decision:a"],
						preserved: false,
					},
					animalhandling: {
						value: "animalhandling",
						sources: ["decision:b"],
						preserved: true,
					},
					"chef's-craft": {
						value: "Chef's-Craft",
						sources: ["decision:custom"],
						preserved: false,
					},
				},
			},
		};

		const state = new CharacterSheetState();
		expect(state.loadFromJson(data)).not.toBe(false);

		expect(state.getSkillProficiencies()).toEqual({
			animalhandling: 2,
			"chef's-craft": 1,
		});
		expect(state._data.grantedProficiencies.skills).toEqual({
			animalhandling: ["feature:a", "feature:b"],
			"chef's-craft": ["feature:custom"],
		});
		expect(state._data.namedModifiers.map(modifier => modifier.type)).toEqual([
			"skill:animalhandling",
			"skill:chef's-craft",
		]);
		expect(state._data.progressionOwnership.values.skills).toEqual({
			animalhandling: {
				value: "Animal Handling",
				sources: ["decision:a", "decision:b"],
				preserved: true,
			},
			"chef's-craft": {
				value: "Chef's-Craft",
				sources: ["decision:custom"],
				preserved: false,
			},
		});
		expect(state.loadFromJson(state.toJson())).not.toBe(false);
		expect(state.getSkillProficiencies()).toEqual({
			animalhandling: 2,
			"chef's-craft": 1,
		});
	});

	it("rolls back a synthesized ledger row when staging fails", () => {
		const {respec} = getRespec();
		const decision = getChild(respec._engine.manifest, "skills");
		const base = respec._engine.state.getCharacterBase();
		base.decisions = base.decisions.filter(candidate => candidate.semanticKey !== decision.semanticKey);
		const before = respec._engine.state.toJson();

		expect(() => respec._engine.stageGraphMutation(decision.id, ["Engineering"], {
			apply: () => {
				throw new Error("synthetic failure");
			},
		})).toThrow("synthetic failure");

		expect(respec._engine.state.toJson()).toEqual(before);
	});

	it("uses the canonical key for the skill arm of a skill-or-tool choice", () => {
		const state = new CharacterSheetState();
		state.setSkillProficiency("Animal Handling", 1);
		const decision = {
			type: "nestedSkillTool",
			semanticKey: "test:skill-or-tool",
			selection: [{kind: "skill", value: "Animal Handling"}],
		};
		state.claimProgressionOwnership("skills", "Animal Handling", decision.semanticKey);
		const respec = new CharacterSheetRespec({page: {}, state});
		respec._state = state;

		respec._applyManifestSelectionMechanics(
			decision,
			[{kind: "skill", value: "Sleight of Hand"}],
			[
				{kind: "skill", value: "Animal Handling"},
				{kind: "skill", value: "Sleight of Hand"},
			],
			state,
		);

		expect(state.getSkillProficiency("animalhandling")).toBe(0);
		expect(state.getSkillProficiency("sleightofhand")).toBe(1);
		expect(state.getSkillProficiencies()).toEqual({sleightofhand: 1});
	});

	it("preserves spaced skills supplied by expertise and another progression owner", () => {
		const state = new CharacterSheetState();
		state.setSkillProficiency("Animal Handling", 2);
		const decision = {
			type: "nestedSkill",
			semanticKey: "test:skill-owner",
			selection: ["Animal Handling"],
		};
		state.claimProgressionOwnership("skills", "Animal Handling", decision.semanticKey);
		state.claimProgressionOwnership("skills", "animalhandling", "test:other-owner");
		state.claimProgressionOwnership("expertise", "Animal Handling", "test:expertise-owner");
		const respec = new CharacterSheetRespec({page: {}, state});
		respec._state = state;

		respec._applyManifestSelectionMechanics(
			decision,
			["Sleight of Hand"],
			["Animal Handling", "Sleight of Hand"],
			state,
		);

		expect(state.getSkillProficiency("animalhandling")).toBe(2);
		expect(state.getSkillProficiency("sleightofhand")).toBe(1);
		expect(state._getProgressionOwnershipEntry("skills", "Animal Handling")?.sources).toEqual([
			"test:other-owner",
		]);
		expect(state._getProgressionOwnershipEntry("expertise", "animalhandling")?.sources).toEqual([
			"test:expertise-owner",
		]);
	});
});
