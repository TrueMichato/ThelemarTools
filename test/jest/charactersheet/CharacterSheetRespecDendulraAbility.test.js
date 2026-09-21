import "./setup.js";
import fs from "node:fs";
import path from "node:path";
import {jest} from "@jest/globals";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-progression.js";
import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-respec.js";
import "../../../js/charactersheet/charactersheet-respec-engine.js";

const CharacterSheetProgression = globalThis.CharacterSheetProgression;
const CharacterSheetState = globalThis.CharacterSheetState;
const CharacterSheetRespec = globalThis.CharacterSheetRespec;

const FIXTURE = JSON.parse(fs.readFileSync(
	path.resolve(process.cwd(), "test/jest/charactersheet/fixtures/respec-juli-minimized.json"),
	"utf8",
));

const copy = value => JSON.parse(JSON.stringify(value));

function getState () {
	const data = copy(FIXTURE.state);
	data.race = copy(FIXTURE.catalogs.dendulra);
	data.background = null;
	data.features = [];
	data.namedModifiers = [];
	data.abilityBonuses = {str: 0, dex: 2, con: 0, int: 0, wis: 0, cha: 1};
	const entityKey = CharacterSheetProgression.getOriginSemanticKey({
		originType: "race",
		originUid: "dendulra|tgtt",
		grantKey: "entity",
	});
	const abilityKey = CharacterSheetProgression.getOriginSemanticKey({
		originType: "race",
		originUid: "dendulra|tgtt",
		grantKey: "race.ability[0]",
		slot: 0,
	});
	data.characterBase = {
		v: 1,
		raceUserChoices: {
			selectedAbilityChoices: {
				"Dendulra|TGTT": {
					choose_0_0: "dex",
					choose_0_0_amount: 1,
				},
			},
		},
		backgroundUserChoices: {},
		decisions: [
			{
				id: `${entityKey}@level-0`,
				semanticKey: entityKey,
				characterLevel: 0,
				className: "Base",
				classSource: "",
				classLevel: 0,
				type: "originRace",
				label: "Species",
				sourceKey: "base:race",
				slot: 0,
				required: true,
				count: 1,
				options: [],
				selection: {name: "Dendulra", source: "TGTT"},
				status: "resolved",
				meta: {},
				scope: "origin",
				parentSemanticKey: null,
				rootSemanticKey: entityKey,
				depth: 0,
				provenance: null,
				receipt: {version: 1, sourceDecisionKey: entityKey, effects: []},
			},
			{
				id: `${abilityKey}@level-0`,
				semanticKey: abilityKey,
				characterLevel: 0,
				className: "Base",
				classSource: "",
				classLevel: 0,
				type: "nestedAbility",
				label: "ability[0]",
				sourceKey: "race.ability[0]",
				slot: 0,
				required: true,
				count: 1,
				options: [],
				selection: null,
				status: "missing",
				meta: {descriptorRules: {amount: 1}},
				scope: "origin",
				parentSemanticKey: entityKey,
				rootSemanticKey: entityKey,
				depth: 1,
				provenance: {
					ownerType: "race",
					ownerUid: "dendulra|tgtt",
					grantKind: "ability",
					grantKey: "race.ability[0]",
					sourcePath: "race.ability[0]",
					occurrence: 0,
					pickSlot: 0,
				},
				receipt: null,
			},
		],
	};
	const state = new CharacterSheetState();
	expect(state.loadFromJson(data)).not.toBe(false);
	return state;
}

function getPage (state) {
	return {
		getState: () => state,
		getClasses: () => [{
			...copy(FIXTURE.catalogs.bard),
			classFeatures: [],
			featProgression: [],
		}],
		getClassFeatures: () => [],
		getSubclassFeatures: () => [],
		getOptionalFeatures: () => [],
		getFeats: () => [],
		getSpells: () => [],
		getFilteredSpellData: () => [],
		getSkillsList: () => [],
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

function getAbilityDecision (respec) {
	return respec._engine.manifest.base.decisions.find(decision =>
		decision.type === "nestedAbility"
		&& decision.provenance?.ownerUid === "dendulra|tgtt"
		&& decision.provenance?.sourcePath === "race.ability[0]",
	);
}

async function stageWisdom (respec) {
	const decision = getAbilityDecision(respec);
	await respec._engine.stageGraphMutation(decision.id, "wis", {
		reverseParent: true,
		apply: ({state}) => respec._applyManifestSelectionMechanics(
			decision,
			"wis",
			decision.options,
			state,
		),
	});
	return getAbilityDecision(respec);
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

describe("Character Sheet Respec Dendulra ability choice", () => {
	it("discovers and source-owns Juli's nested legacy Dendulra Dexterity bonus", () => {
		const {respec, state: liveState} = getRespec();
		const decision = getAbilityDecision(respec);

		expect(decision).toMatchObject({
			status: "resolved",
			selection: "dex",
			options: ["wis", "dex"],
		});
		expect(decision.receipt?.effects).toEqual([
			expect.objectContaining({
				type: "abilityBonusDelta",
				sourceDecisionKey: decision.semanticKey,
				ability: "dex",
				before: 1,
				amount: 1,
			}),
		]);
		expect(respec._state._data.abilityBonuses).toMatchObject({dex: 2, wis: 0, cha: 1});
		expect(liveState.getCharacterBase().decisions.find(item =>
			item.semanticKey === decision.semanticKey,
		)).toMatchObject({status: "missing", selection: null, receipt: null});
	});

	it("reconfigures Dexterity to Wisdom without changing base scores or unrelated bonuses", async () => {
		const {respec, state: liveState} = getRespec();
		const baseDexterity = respec._state.getAbilityBase("dex");
		const baseWisdom = respec._state.getAbilityBase("wis");
		const decision = await stageWisdom(respec);

		expect(decision).toMatchObject({status: "resolved", selection: "wis"});
		expect(decision.receipt?.effects).toEqual([
			expect.objectContaining({
				type: "abilityBonusDelta",
				ability: "wis",
				before: 0,
				amount: 1,
			}),
		]);
		expect(respec._state._data.abilityBonuses).toMatchObject({dex: 1, wis: 1, cha: 1});
		expect(respec._state.getAbilityBase("dex")).toBe(baseDexterity);
		expect(respec._state.getAbilityBase("wis")).toBe(baseWisdom);
		expect(respec._state.getBaseRaceUserChoices()).toMatchObject({
			selectedAbilityChoices: {
				"Dendulra|TGTT": {
					choose_0_0: "wis",
					choose_0_0_amount: 1,
				},
			},
		});
		expect(liveState._data.abilityBonuses).toMatchObject({dex: 2, wis: 0, cha: 1});
	});

	it("routes the same-species editor through the owned child instead of rebuilding Dendulra", async () => {
		const {respec} = getRespec();

		await expect(respec._stageSameRaceAbilityChoices({
			selectedAbilityChoices: {rc_0: "wis", rc_0_weight: 1},
		})).resolves.toBe(true);

		expect(getAbilityDecision(respec)).toMatchObject({status: "resolved", selection: "wis"});
		expect(respec._state._data.abilityBonuses).toMatchObject({dex: 1, wis: 1, cha: 1});
		expect(respec._state.getRace()).toMatchObject({name: "Dendulra", source: "TGTT"});
	});

	it("Cancel discards a staged Dendulra ability replacement", async () => {
		const {respec, state: liveState} = getRespec();
		await stageWisdom(respec);

		respec._engine.cancel();

		expect(liveState._data.abilityBonuses).toMatchObject({dex: 2, wis: 0, cha: 1});
		expect(liveState.getBaseRaceUserChoices().selectedAbilityChoices["Dendulra|TGTT"].choose_0_0).toBe("dex");
	});

	it("Apply/reload persists Wisdom and one-step Undo restores Juli's Dexterity choice", async () => {
		const {respec, state: liveState, page} = getRespec();
		const decision = await stageWisdom(respec);

		isolateUnrelatedBlockers(respec, decision);
		expect(respec._engine.getValidation().errors).toEqual([]);
		await expect(respec._engine.apply()).resolves.toBe(true);
		expect(page.saveCharacter).toHaveBeenCalledTimes(1);

		const reloaded = new CharacterSheetState();
		expect(reloaded.loadFromJson(copy(liveState.toJson()))).not.toBe(false);
		const reopened = new CharacterSheetRespec({page: getPage(reloaded), state: reloaded});
		reopened._engine.begin();
		expect(getAbilityDecision(reopened)).toMatchObject({
			semanticKey: decision.semanticKey,
			status: "resolved",
			selection: "wis",
		});
		expect(reopened._engine.state._data.abilityBonuses).toMatchObject({dex: 1, wis: 1, cha: 1});

		await expect(respec._engine.undo()).resolves.toBe(true);
		expect(liveState._data.abilityBonuses).toMatchObject({dex: 2, wis: 0, cha: 1});
		expect(liveState.getBaseRaceUserChoices().selectedAbilityChoices["Dendulra|TGTT"].choose_0_0).toBe("dex");
	});
});
