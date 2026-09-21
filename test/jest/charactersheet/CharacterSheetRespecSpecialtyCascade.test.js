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

const copy = value => JSON.parse(JSON.stringify(value));

function getState () {
	const state = new CharacterSheetState();
	expect(state.loadFromJson(copy(FIXTURE.state))).not.toBe(false);
	return state;
}

function getPage (state) {
	return {
		getState: () => state,
		getClasses: () => [{
			...copy(FIXTURE.catalogs.bard),
			featProgression: [],
		}],
		getClassFeatures: () => [
			copy(FIXTURE.catalogs.specialties),
			copy(FIXTURE.catalogs.showoff),
			copy(FIXTURE.catalogs.townie),
		],
		getSubclassFeatures: () => [],
		getOptionalFeatures: () => [],
		getFeats: () => [],
		getSpells: () => [],
		getFilteredSpellData: () => [],
		getSkillsList: () => ["stealth", "intimidation", "acrobatics", "persuasion"],
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

function getSpecialtyParent (respec) {
	return respec._engine.manifest.decisions.find(decision =>
		decision.type === "featureChoice"
		&& decision.label === "Specialties"
		&& Number(decision.characterLevel) === 13,
	);
}

function getSkillBonusChild (respec, ownerName) {
	return respec._engine.manifest.decisions.find(decision =>
		decision.type === "nestedSkillBonus"
		&& decision.provenance?.ownerUid === `${ownerName.toLowerCase()}|tgtt`,
	);
}

async function stageTownieParent (respec) {
	const parent = getSpecialtyParent(respec);
	const townie = parent.options.find(option => option.name === "Townie");
	const history = respec._state.getLevelHistoryEntry(13);
	const oldChoice = history.choices.featureChoices[0];
	await respec._applyFeatureChoiceChange(13, history, 0, oldChoice, townie);
	return {
		parent: getSpecialtyParent(respec),
		child: getSkillBonusChild(respec, "Townie"),
	};
}

async function selectTownieSkill (respec, skill = "intimidation") {
	const decision = getSkillBonusChild(respec, "Townie");
	await respec._engine.stageGraphMutation(decision.id, skill, {
		reverseParent: true,
		apply: ({state}) => respec._applyManifestSelectionMechanics(
			decision,
			skill,
			decision.options,
			state,
		),
	});
	return getSkillBonusChild(respec, "Townie");
}

describe("Character Sheet Respec Specialty dependency cascade", () => {
	it("removes Showoff, creates a required Townie child, and blocks Apply until it is completed", async () => {
		const {respec, state: liveState} = getRespec();
		const showoffChild = getSkillBonusChild(respec, "Showoff");
		const removeFeature = jest.spyOn(respec._state, "removeFeature");

		const {parent, child} = await stageTownieParent(respec);

		expect(parent.selection).toEqual([
			expect.objectContaining({choice: "Townie", source: "TGTT"}),
		]);
		expect(child).toMatchObject({
			status: "missing",
			selection: null,
			parentSemanticKey: parent.semanticKey,
			rootSemanticKey: parent.semanticKey,
		});
		expect(child.semanticKey).not.toBe(showoffChild.semanticKey);
		expect(removeFeature).toHaveBeenCalledTimes(1);
		expect(respec._state.getFeatures().some(feature => feature.name === "Showoff")).toBe(false);
		expect(respec._state.getFeatures().some(feature => feature.name === "Townie")).toBe(true);
		expect(respec._state.getNamedModifiers().some(modifier => /Showoff/i.test(modifier.name))).toBe(false);
		expect(respec._engine.getValidation()).toMatchObject({
			isValid: false,
			errors: [expect.objectContaining({decisionId: child.id})],
		});
		await expect(respec._engine.apply()).rejects.toThrow("Resolve 1 required Respec item");

		expect(liveState.getFeatures().some(feature => feature.name === "Showoff")).toBe(true);
		expect(liveState.getNamedModifiers()).toEqual(expect.arrayContaining([
			expect.objectContaining({id: "fixture-showoff-stealth", type: "skill:stealth"}),
		]));
	});

	it("Cancel discards a completed Showoff to Townie cascade", async () => {
		const {respec, state: liveState} = getRespec();
		await stageTownieParent(respec);
		await selectTownieSkill(respec);

		respec._engine.cancel();

		expect(liveState.getFeatures().some(feature => feature.name === "Showoff")).toBe(true);
		expect(liveState.getFeatures().some(feature => feature.name === "Townie")).toBe(false);
		expect(liveState.getNamedModifiers().some(modifier => modifier.type === "skill:intimidation")).toBe(false);
		expect(liveState.getNamedModifiers()).toEqual(expect.arrayContaining([
			expect.objectContaining({id: "fixture-showoff-stealth", type: "skill:stealth"}),
		]));
	});

	it("persists one Townie-owned child through reload and Undo restores Showoff", async () => {
		const {respec, state: liveState, page} = getRespec();
		await stageTownieParent(respec);
		const decision = await selectTownieSkill(respec);

		expect(respec._engine.getValidation().isValid).toBe(true);
		expect(respec._state.getNamedModifiers().filter(modifier =>
			modifier.sourceDecisionKey === decision.semanticKey,
		)).toEqual([
			expect.objectContaining({
				name: "Townie (Intimidation)",
				type: "skill:intimidation",
				proficiencyBonus: true,
			}),
		]);
		expect(respec._state.getNamedModifiers().some(modifier => /Showoff/i.test(modifier.name))).toBe(false);

		await expect(respec._engine.apply()).resolves.toBe(true);
		expect(page.saveCharacter).toHaveBeenCalledTimes(1);

		const reloaded = new CharacterSheetState();
		expect(reloaded.loadFromJson(copy(liveState.toJson()))).not.toBe(false);
		const reopened = new CharacterSheetRespec({page: getPage(reloaded), state: reloaded});
		reopened._engine.begin();
		const reopenedDecision = getSkillBonusChild(reopened, "Townie");
		expect(reopenedDecision).toMatchObject({
			semanticKey: decision.semanticKey,
			status: "resolved",
			selection: "intimidation",
		});
		expect(reopened._engine.state.getNamedModifiers().filter(modifier =>
			modifier.sourceDecisionKey === decision.semanticKey,
		)).toHaveLength(1);

		await expect(respec._engine.undo()).resolves.toBe(true);
		expect(liveState.getFeatures().some(feature => feature.name === "Showoff")).toBe(true);
		expect(liveState.getFeatures().some(feature => feature.name === "Townie")).toBe(false);
		const restored = liveState.getNamedModifiers().filter(modifier => /Showoff/i.test(modifier.name));
		expect(restored).toEqual([
			expect.objectContaining({
				id: "fixture-showoff-stealth",
				type: "skill:stealth",
				proficiencyBonus: true,
			}),
		]);
		expect(restored[0].sourceDecisionKey).toBeUndefined();
	});
});
