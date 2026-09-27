import "./setup.js";
import fs from "node:fs";
import path from "node:path";
import {jest} from "@jest/globals";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-progression.js";
import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-respec.js";
import "../../../js/charactersheet/charactersheet-respec-engine.js";

const CharacterSheetState = globalThis.CharacterSheetState;
const CharacterSheetRespec = globalThis.CharacterSheetRespec;

const FIXTURE = JSON.parse(fs.readFileSync(
	path.resolve(process.cwd(), "test/jest/charactersheet/fixtures/respec-juli-minimized.json"),
	"utf8",
));

const FEATURE_ID = "juli-jester-bonus-proficiencies";
const LEGACY_SOURCE = `feature-choice:${FEATURE_ID}`;
const copy = value => JSON.parse(JSON.stringify(value));

function getState ({preserveAcrobaticsExpertise = false} = {}) {
	const data = copy(FIXTURE.state);
	data.race = null;
	data.background = null;
	data.features = [{
		...copy(FIXTURE.catalogs.jesterBonusProficiencies),
		id: FEATURE_ID,
		featureType: "Class",
	}];
	data.feats = [];
	data.namedModifiers = [];
	data.skillProficiencies = {
		performance: 1,
		acrobatics: preserveAcrobaticsExpertise ? 2 : 1,
		persuasion: 0,
	};
	data.pendingFeatureChoices = [];
	data.fulfilledFeatureSkillChoices = ["bonus proficiencies"];
	data.grantedProficiencies = {
		skills: {acrobatics: [LEGACY_SOURCE]},
		tools: {},
		weapons: {},
		armor: {},
		languages: {},
		saves: {},
	};
	data.progressionOwnership = preserveAcrobaticsExpertise
		? {
			version: 1,
			initialized: true,
			values: {
				expertise: {
					acrobatics: {
						value: "acrobatics",
						sources: [],
						preserved: true,
					},
				},
			},
		}
		: {version: 1, initialized: false, values: {}};

	const state = new CharacterSheetState();
	expect(state.loadFromJson(data)).not.toBe(false);
	return state;
}

function getValorState () {
	const state = getState();
	const data = state.toJson();
	const valor = {name: "College of Valor", shortName: "Valor", source: "TGTT-2024"};
	data.classes[0].level = 3;
	data.classes[0].subclass = valor;
	data.levelHistory = data.levelHistory.filter(entry => entry.level <= 3);
	data.levelHistory[2].choices.subclass = valor;
	data.features = [];
	data.skillProficiencies = {performance: 0, acrobatics: 0, persuasion: 0};
	data.grantedProficiencies.skills = {};
	data.fulfilledFeatureSkillChoices = [];
	data.progressionOwnership = {version: 1, initialized: false, values: {}};
	expect(state.loadFromJson(data)).not.toBe(false);
	return state;
}

function getPage (state) {
	const jester = {
		...copy(FIXTURE.catalogs.jester),
		subclassFeatures: ["Bonus Proficiencies|Bard|TGTT|Jesters|TGTT|3"],
		optionalfeatureProgression: [],
	};
	return {
		getState: () => state,
		getClasses: () => [{
			...copy(FIXTURE.catalogs.bard),
			classFeatures: [],
			featProgression: [],
			subclasses: [jester],
		}],
		getClassFeatures: () => [],
		getSubclassFeatures: () => [copy(FIXTURE.catalogs.jesterBonusProficiencies)],
		getOptionalFeatures: () => [],
		getFeats: () => [],
		getSpells: () => [],
		getFilteredSpellData: () => [],
		getSkillsList: () => ["performance", "acrobatics", "persuasion"],
		filterByAllowedSources: values => values,
		saveCharacter: jest.fn().mockResolvedValue(undefined),
		renderCharacter: jest.fn(),
	};
}

function getRespec (state = getState()) {
	const page = getPage(state);
	const respec = new CharacterSheetRespec({page, state});
	respec._engine.begin();
	respec._state = respec._engine.state;
	return {respec, state, page};
}

function getDecision (respec) {
	return respec._engine.manifest.decisions.find(decision =>
		decision.type === "nestedSkill"
		&& decision.provenance?.ownerUid === "bonus proficiencies|tgtt",
	);
}

async function stageSkillChoice (respec, skill) {
	const decision = getDecision(respec);
	await respec._engine.stageGraphMutation(decision.id, [skill], {
		reverseParent: true,
		apply: ({state}) => respec._applyManifestSelectionMechanics(
			decision,
			[skill],
			decision.options,
			state,
		),
	});
	return getDecision(respec);
}

const stagePersuasion = respec => stageSkillChoice(respec, "persuasion");

async function stageValor (respec) {
	const history = respec._engine.state.getLevelHistory().find(entry => entry.level === 3);
	await respec._engine.stageCandidateMutation(async ({state}) => {
		respec._state = state;
		await respec._applySubclassChange(
			3,
			history,
			history.choices.subclass,
			{name: "College of Valor", shortName: "Valor", source: "TGTT-2024", subclassFeatures: []},
		);
	});
}

async function stageJester (respec, afterAdd = () => {}) {
	const history = respec._engine.state.getLevelHistory().find(entry => entry.level === 3);
	const jester = respec._page.getClasses()[0].subclasses[0];
	await respec._engine.stageCandidateMutation(async ({state}) => {
		respec._state = state;
		await respec._applySubclassChange(3, history, history.choices.subclass, jester);
		afterAdd(state);
	});
}

function isolateUnrelatedBlockers (respec, decision) {
	const validation = respec._engine.getValidation();
	expect(validation.errors.some(error => error.decisionId === decision.id)).toBe(false);
	for (const candidate of respec._engine.manifest.decisions) {
		if (candidate.semanticKey !== decision.semanticKey && candidate.status !== "resolved") {
			candidate.status = "resolved";
		}
	}
}

describe("Character Sheet Respec Jester Bonus Proficiencies", () => {
	it("adopts Juli's exact legacy Acrobatics choice without treating fixed Performance as selectable", () => {
		const {respec, state: liveState} = getRespec();
		const decision = getDecision(respec);

		expect(decision).toMatchObject({
			label: "Bonus Proficiencies",
			status: "resolved",
			selection: "acrobatics",
			options: ["acrobatics", "persuasion"],
		});
		expect(decision.receipt?.effects).toEqual([
			{
				type: "ownership",
				ownership: [{type: "skills", value: "acrobatics"}],
			},
		]);
		expect(respec._state.getSkillProficiency("performance")).toBe(1);
		expect(respec._state._data.grantedProficiencies.skills.acrobatics).toBeUndefined();
		expect(liveState._data.grantedProficiencies.skills.acrobatics).toEqual([LEGACY_SOURCE]);
	});

	it("reconfigures only the selectable proficiency from Acrobatics to Persuasion", async () => {
		const {respec, state: liveState} = getRespec();
		const semanticKey = getDecision(respec).semanticKey;
		const decision = await stagePersuasion(respec);

		expect(decision).toMatchObject({semanticKey, status: "resolved", selection: ["persuasion"]});
		expect(decision.receipt?.effects).toEqual([
			{
				type: "ownership",
				ownership: [{type: "skills", value: "persuasion"}],
			},
		]);
		expect(respec._state.getSkillProficiency("performance")).toBe(1);
		expect(respec._state.getSkillProficiency("acrobatics")).toBe(0);
		expect(respec._state.getSkillProficiency("persuasion")).toBe(1);
		expect(liveState.getSkillProficiency("acrobatics")).toBe(1);
		expect(liveState.getSkillProficiency("persuasion")).toBe(0);
	});

	it("retires the old subclass feature and its choice when history lacks the subclass short name", async () => {
		const {respec, state: liveState} = getRespec();
		const original = liveState.toJson();
		const candidate = respec._engine.state;
		const history = candidate.getLevelHistory().find(entry => entry.level === 3);
		const oldSubclass = history.choices.subclass;
		expect(oldSubclass).toEqual({name: "College of Jesters", source: "TGTT"});
		expect(candidate.getFeatures().some(feature => feature.id === FEATURE_ID)).toBe(true);

		await stageValor(respec);

		expect(candidate.getFeatures().some(feature => feature.id === FEATURE_ID)).toBe(false);
		expect(getDecision(respec)).toBeUndefined();
		expect(candidate.getSkillProficiency("acrobatics")).toBe(0);
		expect(candidate.getSkillProficiency("performance")).toBe(1);
		expect(liveState.toJson()).toEqual(original);
	});

	it("stages a new subclass's required skill child without leaving an orphaned pending choice", async () => {
		const {respec, state: liveState} = getRespec(getValorState());
		const original = liveState.toJson();
		await stageJester(respec);

		const child = getDecision(respec);
		expect(child).toMatchObject({status: "missing", required: true});
		expect(child.provenance.ownerUid).toBe("bonus proficiencies|tgtt");
		expect(respec._state.getPendingFeatureChoices()
			.some(choice => choice.featureName === "Bonus Proficiencies")).toBe(false);
		expect(liveState.toJson()).toEqual(original);
	});

	it("rejects a new skill prompt not matched by the exact feature decision, even with a valid parent key", async () => {
		const {respec, state: liveState} = getRespec(getValorState());
		const before = {
			subclass: copy(respec._state.getClasses()[0].subclass),
			features: copy(respec._state.getFeatures()),
			skills: respec._state.getSkillProficiencies(),
		};
		const liveBefore = liveState.toJson();
		const parentKey = respec._engine.manifest.decisions.find(decision => decision.type === "subclass")?.semanticKey;
		expect(parentKey).toBeTruthy();

		await expect(stageJester(respec, candidate => {
			const feature = candidate.getFeatures().find(it => it.name === "Bonus Proficiencies");
			candidate.addPendingFeatureChoice({
				featureId: feature.id,
				featureName: feature.name,
				kind: "skill",
				options: ["arcana", "history"],
				sourceDecisionKey: parentKey,
			});
		})).rejects.toThrow(/unrepresented pending choice.*Bonus Proficiencies/i);
		expect(respec._state.getClasses()[0].subclass).toEqual(before.subclass);
		expect(respec._state.getFeatures()).toEqual(before.features);
		expect(respec._state.getSkillProficiencies()).toEqual(before.skills);
		expect(liveState.toJson()).toEqual(liveBefore);
	});

	it("rejects a matching skill prompt attributed to an unrelated decision", async () => {
		const {respec: control} = getRespec(getValorState());
		await stageJester(control);
		const child = getDecision(control);
		const {respec} = getRespec(getValorState());
		const unrelatedKey = control._engine.manifest.decisions.find(decision =>
			![child.semanticKey, child.parentSemanticKey, child.rootSemanticKey].includes(decision.semanticKey))?.semanticKey;
		expect(unrelatedKey).toBeTruthy();

		await expect(stageJester(respec, candidate => {
			const feature = candidate.getFeatures().find(it => it.name === "Bonus Proficiencies");
			const pending = candidate.getPendingFeatureChoices().find(choice => choice.featureId === feature.id);
			expect(pending).toBeDefined();
			pending.sourceDecisionKey = unrelatedKey;
		})).rejects.toThrow(/unrepresented pending choice.*Bonus Proficiencies/i);
		expect(respec._state.getClasses()[0].subclass.shortName).toBe("Valor");
		expect(respec._engine.isDirty).toBe(false);
	});

	it("rejects a same-named skill prompt from another subclass source", async () => {
		const {respec, state: liveState} = getRespec(getValorState());
		const liveBefore = liveState.toJson();
		const parentKey = respec._engine.manifest.decisions.find(decision => decision.type === "subclass").semanticKey;

		await expect(stageJester(respec, candidate => {
			candidate._data.features.push({
				...copy(FIXTURE.catalogs.jesterBonusProficiencies),
				id: "other-subclass-bonus",
				subclassShortName: "Valor",
				subclassSource: "TGTT-2024",
			});
			candidate.addPendingFeatureChoice({
				featureId: "other-subclass-bonus",
				featureName: "Bonus Proficiencies",
				kind: "skill",
				options: ["acrobatics", "persuasion"],
				sourceDecisionKey: parentKey,
			});
		})).rejects.toThrow(/unrepresented pending choice.*Bonus Proficiencies/i);
		expect(respec._state.getFeatures().some(feature => feature.id === "other-subclass-bonus")).toBe(false);
		expect(liveState.toJson()).toEqual(liveBefore);
	});

	it("uses the matching class catalog when a legacy class entry also lacks the short name", async () => {
		const state = getState();
		state._data.classes[0].subclass = {name: "College of Jesters", source: "TGTT"};
		const {respec} = getRespec(state);

		await stageValor(respec);

		expect(respec._state.getFeatures().some(feature => feature.id === FEATURE_ID)).toBe(false);
		expect(respec._state.getSkillProficiency("acrobatics")).toBe(0);
	});

	it("preserves independent skill owners and a same-named feature in another class", async () => {
		const state = getState();
		state._trackGrantedProficiency("skills", "acrobatics", "base");
		state._data.features.push({
			...copy(FIXTURE.catalogs.jesterBonusProficiencies),
			id: "cleric-bonus-proficiencies",
			className: "Cleric",
			subclassShortName: "Lust",
			subclassSource: "TGTT",
			isSubclassFeature: true,
		});
		const {respec} = getRespec(state);

		await stageValor(respec);

		expect(respec._state.getFeatures().map(feature => feature.id)).toContain("cleric-bonus-proficiencies");
		expect(respec._state.getFeatures().map(feature => feature.id)).not.toContain(FEATURE_ID);
		expect(respec._state.getSkillProficiency("acrobatics")).toBe(1);
		expect(respec._state._getProgressionOwnershipEntry("skills", "acrobatics")).toMatchObject({
			sources: [],
			preserved: true,
		});
	});

	it("keeps a different subclass source's overlapping skill and same-named feature", async () => {
		const state = getState();
		state._data.features.push({
			...copy(FIXTURE.catalogs.jesterBonusProficiencies),
			id: "other-source-bonus",
			source: "TGTT-2024",
			subclassSource: "TGTT-2024",
		});
		state._trackGrantedProficiency("skills", "acrobatics", "feature-choice:other-source-bonus");
		const {respec} = getRespec(state);

		await stageValor(respec);

		expect(respec._state.getFeatures().map(feature => feature.id)).toContain("other-source-bonus");
		expect(respec._state.getFeatures().map(feature => feature.id)).not.toContain(FEATURE_ID);
		expect(respec._state.getSkillProficiency("acrobatics")).toBe(1);
		expect(respec._state._data.grantedProficiencies.skills.acrobatics)
			.toContain("feature-choice:other-source-bonus");
	});

	it("does not claim an untracked legacy skill as the Jester's choice", async () => {
		const state = getState();
		state._data.grantedProficiencies.skills = {};
		const {respec} = getRespec(state);
		expect(getDecision(respec)?.status).toBe("missing");
		expect(getDecision(respec)?.selection).toBeNull();

		await stageValor(respec);

		expect(respec._state.getFeatures().some(feature => feature.id === FEATURE_ID)).toBe(false);
		expect(respec._state.getSkillProficiency("acrobatics")).toBe(1);
		expect(respec._state._getProgressionOwnershipEntry("skills", "acrobatics")).toMatchObject({
			sources: [],
			preserved: true,
		});
	});

	it("rejects conflicting exact catalog short names without changing the candidate", async () => {
		const state = getState();
		state._data.classes[0].subclass = {name: "College of Jesters", source: "TGTT"};
		const {respec} = getRespec(state);
		const bard = getPage(state).getClasses()[0];
		const jester = bard.subclasses[0];
		respec._page.getClasses = () => [{
			...bard,
			subclasses: [jester, {...jester, shortName: "Different Jesters"}],
		}];
		const getSkillAndFeatureState = candidate => ({
			classes: copy(candidate.getClasses()),
			features: copy(candidate.getFeatures()),
			skills: candidate.getSkillProficiencies(),
			ownership: copy(candidate._data.progressionOwnership),
		});
		const before = getSkillAndFeatureState(respec._state);
		const liveBefore = state.toJson();

		await expect(stageValor(respec)).rejects.toThrow(/class and catalog disagree about the short name/i);
		expect(getSkillAndFeatureState(respec._state)).toEqual(before);
		expect(state.toJson()).toEqual(liveBefore);
	});

	it("blocks a legacy short-name-only feature when neither the class nor catalog identifies its owner", async () => {
		const state = getState();
		state._data.classes[0].subclass = {name: "College of Jesters", source: "TGTT"};
		const {respec} = getRespec(state);
		const bard = getPage(state).getClasses()[0];
		respec._page.getClasses = () => [{...bard, subclasses: []}];
		const before = {
			features: copy(respec._state.getFeatures()),
			skills: respec._state.getSkillProficiencies(),
		};

		await expect(stageValor(respec)).rejects.toThrow(/short name missing.*Restore the exact subclass identity/i);
		expect(respec._state.getFeatures()).toEqual(before.features);
		expect(respec._state.getSkillProficiencies()).toEqual(before.skills);
		expect(state.getSkillProficiency("acrobatics")).toBe(1);
	});

	it("preserves Juli's independent Acrobatics expertise when the owned proficiency moves", async () => {
		const {respec} = getRespec(getState({preserveAcrobaticsExpertise: true}));
		await stagePersuasion(respec);

		expect(respec._state.getSkillProficiency("performance")).toBe(1);
		expect(respec._state.getSkillProficiency("acrobatics")).toBe(2);
		expect(respec._state.getSkillProficiency("persuasion")).toBe(1);
	});

	it("moves the same feature choice repeatedly without accumulating old owner grants", async () => {
		const {respec, state: liveState} = getRespec();
		const liveBefore = liveState.toJson();
		const semanticKey = getDecision(respec).semanticKey;
		for (const [skill, oldSkill] of [
			["persuasion", "acrobatics"],
			["acrobatics", "persuasion"],
			["persuasion", "acrobatics"],
		]) {
			const decision = await stageSkillChoice(respec, skill);
			expect(decision).toMatchObject({semanticKey, status: "resolved", selection: [skill]});
			expect(respec._state.getSkillProficiency(skill)).toBe(1);
			expect(respec._state.getSkillProficiency(oldSkill)).toBe(0);
			expect(respec._state._getProgressionOwnershipEntry("skills", skill).sources)
				.toEqual([semanticKey]);
			expect(respec._state._getProgressionOwnershipEntry("skills", oldSkill)?.sources || [])
				.not.toContain(semanticKey);
		}
		expect(liveState.toJson()).toEqual(liveBefore);
	});

	it("Cancel discards a staged Jester proficiency replacement", async () => {
		const {respec, state: liveState} = getRespec();
		await stagePersuasion(respec);

		respec._engine.cancel();

		expect(liveState.getSkillProficiency("performance")).toBe(1);
		expect(liveState.getSkillProficiency("acrobatics")).toBe(1);
		expect(liveState.getSkillProficiency("persuasion")).toBe(0);
		expect(liveState._data.grantedProficiencies.skills.acrobatics).toEqual([LEGACY_SOURCE]);
	});

	it("Apply/reload persists Persuasion and one-step Undo restores Juli's Acrobatics choice", async () => {
		const {respec, state: liveState, page} = getRespec();
		const decision = await stagePersuasion(respec);

		isolateUnrelatedBlockers(respec, decision);
		expect(respec._engine.getValidation().errors).toEqual([]);
		await expect(respec._engine.apply()).resolves.toBe(true);
		expect(page.saveCharacter).toHaveBeenCalledTimes(1);

		const reloaded = new CharacterSheetState();
		expect(reloaded.loadFromJson(copy(liveState.toJson()))).not.toBe(false);
		const reopened = new CharacterSheetRespec({page: getPage(reloaded), state: reloaded});
		reopened._engine.begin();
		expect(getDecision(reopened)).toMatchObject({
			semanticKey: decision.semanticKey,
			status: "resolved",
			selection: ["persuasion"],
		});
		expect(reopened._engine.state.getSkillProficiency("performance")).toBe(1);
		expect(reopened._engine.state.getSkillProficiency("acrobatics")).toBe(0);
		expect(reopened._engine.state.getSkillProficiency("persuasion")).toBe(1);

		await expect(respec._engine.undo()).resolves.toBe(true);
		expect(liveState.getSkillProficiency("performance")).toBe(1);
		expect(liveState.getSkillProficiency("acrobatics")).toBe(1);
		expect(liveState.getSkillProficiency("persuasion")).toBe(0);
		expect(liveState._data.grantedProficiencies.skills.acrobatics).toEqual([LEGACY_SOURCE]);
	});
});
