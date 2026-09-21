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

async function stagePersuasion (respec) {
	const decision = getDecision(respec);
	await respec._engine.stageGraphMutation(decision.id, ["persuasion"], {
		reverseParent: true,
		apply: ({state}) => respec._applyManifestSelectionMechanics(
			decision,
			["persuasion"],
			decision.options,
			state,
		),
	});
	return getDecision(respec);
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

	it("preserves Juli's independent Acrobatics expertise when the owned proficiency moves", async () => {
		const {respec} = getRespec(getState({preserveAcrobaticsExpertise: true}));
		await stagePersuasion(respec);

		expect(respec._state.getSkillProficiency("performance")).toBe(1);
		expect(respec._state.getSkillProficiency("acrobatics")).toBe(2);
		expect(respec._state.getSkillProficiency("persuasion")).toBe(1);
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
