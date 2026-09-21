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

function getShowoffChild (respec) {
	return respec._engine.manifest.decisions.find(decision =>
		decision.type === "nestedSkillBonus"
		&& decision.provenance?.ownerUid === "showoff|tgtt",
	);
}

async function stageIntimidation (respec) {
	const decision = getShowoffChild(respec);
	await respec._engine.stageGraphMutation(decision.id, "intimidation", {
		reverseParent: true,
		apply: ({state}) => respec._applyManifestSelectionMechanics(
			decision,
			"intimidation",
			decision.options,
			state,
		),
	});
	return getShowoffChild(respec);
}

describe("Character Sheet Respec Specialty skill-bonus mechanics", () => {
	it("adopts Juli's exact legacy Showoff modifier and replaces only its selected skill", async () => {
		const {respec, state: liveState} = getRespec();
		const decision = getShowoffChild(respec);

		expect(decision).toMatchObject({
			status: "resolved",
			selection: "stealth",
		});
		expect(respec._state.getNamedModifiers()).toEqual(expect.arrayContaining([
			expect.objectContaining({
				id: "fixture-showoff-stealth",
				type: "skill:stealth",
				sourceDecisionKey: decision.semanticKey,
			}),
		]));

		const updated = await stageIntimidation(respec);

		expect(updated.semanticKey).toBe(decision.semanticKey);
		expect(updated).toMatchObject({status: "resolved", selection: "intimidation"});
		expect(respec._state.getSkillProficiency("stealth")).toBe(1);
		expect(respec._state.getSkillProficiency("intimidation")).toBe(1);
		expect(respec._state.getNamedModifiers().filter(modifier =>
			modifier.sourceDecisionKey === decision.semanticKey,
		)).toEqual([
			expect.objectContaining({
				name: "Showoff (Intimidation)",
				type: "skill:intimidation",
				proficiencyBonus: true,
			}),
		]);
		expect(respec._state.getNamedModifiers().filter(modifier =>
			modifier.type === "skill:stealth" && /Showoff/i.test(modifier.name),
		)).toEqual([]);
		const liveShowoff = liveState.getNamedModifiers().find(modifier => modifier.id === "fixture-showoff-stealth");
		expect(liveShowoff).toMatchObject({type: "skill:stealth", proficiencyBonus: true});
		expect(liveShowoff.sourceDecisionKey).toBeUndefined();
	});

	it("Cancel discards a staged Showoff skill replacement", async () => {
		const {respec, state: liveState} = getRespec();
		await stageIntimidation(respec);

		respec._engine.cancel();

		expect(liveState.getNamedModifiers()).toEqual(expect.arrayContaining([
			expect.objectContaining({id: "fixture-showoff-stealth", type: "skill:stealth"}),
		]));
		expect(liveState.getNamedModifiers().some(modifier => modifier.type === "skill:intimidation")).toBe(false);
	});

	it("Apply persists the owned modifier through reload and Undo restores the legacy Showoff state", async () => {
		const {respec, state: liveState, page} = getRespec();
		const decision = await stageIntimidation(respec);

		expect(respec._engine.getValidation().isValid).toBe(true);
		await expect(respec._engine.apply()).resolves.toBe(true);
		expect(page.saveCharacter).toHaveBeenCalledTimes(1);

		const reloaded = new CharacterSheetState();
		expect(reloaded.loadFromJson(copy(liveState.toJson()))).not.toBe(false);
		const reopened = new CharacterSheetRespec({page: getPage(reloaded), state: reloaded});
		reopened._engine.begin();
		const reopenedDecision = getShowoffChild(reopened);
		expect(reopenedDecision).toMatchObject({
			semanticKey: decision.semanticKey,
			status: "resolved",
			selection: "intimidation",
		});
		expect(reopened._engine.state.getNamedModifiers()).toEqual(expect.arrayContaining([
			expect.objectContaining({
				type: "skill:intimidation",
				proficiencyBonus: true,
				sourceDecisionKey: decision.semanticKey,
			}),
		]));

		await expect(respec._engine.undo()).resolves.toBe(true);
		const restoredShowoff = liveState.getNamedModifiers().filter(modifier => /Showoff/i.test(modifier.name));
		expect(restoredShowoff).toEqual([
			expect.objectContaining({
				id: "fixture-showoff-stealth",
				type: "skill:stealth",
				proficiencyBonus: true,
			}),
		]);
		expect(restoredShowoff[0].sourceDecisionKey).toBeUndefined();
		expect(liveState.getSkillProficiency("stealth")).toBe(1);
		expect(liveState.getSkillProficiency("intimidation")).toBe(1);
	});
});
