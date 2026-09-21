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

function getState ({skipped = false} = {}) {
	const data = copy(FIXTURE.state);
	data.race = null;
	data.background = null;
	data.characterBase = {v: 1, raceUserChoices: {}, backgroundUserChoices: {}, decisions: []};
	data.features = [];
	data.namedModifiers = [];
	data.levelHistory.find(entry => entry.level === 13).choices = {};
	if (skipped) {
		data.feats = [];
		data.abilities.con = 14;
		data.levelHistory.find(entry => entry.level === 19).choices = {};
	} else {
		const semanticKey = "bard|tgtt:cl19:feat:epic-boon-or-feat:slot0";
		data.levelHistory.find(entry => entry.level === 19).decisions = [{
			id: `${semanticKey}@level-19`,
			semanticKey,
			characterLevel: 19,
			className: "Bard",
			classSource: "TGTT",
			classLevel: 19,
			type: "feat",
			label: "Epic Boon or Qualifying Feat",
			sourceKey: "epic-boon-or-feat",
			slot: 0,
			required: true,
			count: 1,
			selection: {mode: "asi", legacyAsi: {con: 2}},
			status: "invalid",
			meta: {},
			scope: "level",
			parentSemanticKey: null,
			rootSemanticKey: semanticKey,
			depth: 0,
			provenance: null,
			receipt: {version: 1, sourceDecisionKey: semanticKey, effects: []},
		}];
	}
	const state = new CharacterSheetState();
	expect(state.loadFromJson(data)).not.toBe(false);
	return state;
}

function getPage (state) {
	const bard = copy(FIXTURE.catalogs.bard);
	bard.classFeatures = ["Epic Boon|Bard|TGTT|19"];
	return {
		getState: () => state,
		getClasses: () => [bard],
		getClassFeatures: () => [],
		getSubclassFeatures: () => [],
		getOptionalFeatures: () => [],
		getFeats: () => [
			copy(FIXTURE.catalogs.boon),
			copy(FIXTURE.catalogs.replacementFeat),
			copy(FIXTURE.catalogs.spellRecallBoon),
		],
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

function getBoonParent (respec) {
	return respec._engine.manifest.decisions.find(decision =>
		decision.type === "feat"
		&& decision.meta?.improvement?.kind === "feat"
		&& Number(decision.characterLevel) === 19,
	);
}

function getBoonAbilityChild (respec) {
	const parent = getBoonParent(respec);
	return respec._engine.manifest.decisions.find(decision =>
		decision.type === "nestedAbility"
		&& decision.parentSemanticKey === parent?.semanticKey,
	);
}

function stageBoon (respec, feat, ability = null) {
	const parent = getBoonParent(respec);
	const didApply = respec._applyImprovementChange(parent, {
		mode: "feat",
		feat: copy(feat),
		featChoices: ability ? {ability} : {},
	});
	expect(didApply).toBe(true);
	return getBoonParent(respec);
}

function stageBoonAbility (respec, ability) {
	const decision = getBoonAbilityChild(respec);
	respec._engine.stageGraphMutation(decision.id, ability, {
		reverseParent: true,
		apply: ({state}) => respec._applyManifestSelectionMechanics(
			decision,
			ability,
			decision.options,
			state,
		),
	});
	return getBoonAbilityChild(respec);
}

describe("Character Sheet Respec Epic Boon reconciliation", () => {
	it("adopts Juli's orphan Dimensional Travel boon and replaces the invalid ASI with one exact ability delta", () => {
		const {respec, state: liveState} = getRespec();
		const parent = getBoonParent(respec);
		const child = getBoonAbilityChild(respec);
		const candidateFeat = respec._state.getFeats().find(feat => feat.name === "Boon of Dimensional Travel");

		expect(parent).toMatchObject({
			status: "resolved",
			selection: {name: "Boon of Dimensional Travel", source: "XPHB"},
		});
		expect(child).toMatchObject({
			status: "resolved",
			selection: "con",
			parentSemanticKey: parent.semanticKey,
		});
		expect(respec._state.getAbilityBase("con")).toBe(15);
		expect(candidateFeat).toMatchObject({
			sourceDecisionKey: parent.semanticKey,
			choices: {ability: "con"},
			appliedEffects: {abilityDeltas: {con: 1}},
		});
		expect(respec._state.getLevelHistoryEntry(19).choices).toMatchObject({
			feat: {name: "Boon of Dimensional Travel", source: "XPHB"},
		});
		expect(respec._state.getLevelHistoryEntry(19).choices.asi).toBeUndefined();
		expect(respec._state.getLevelHistoryEntry(19).decisions.find(decision =>
			decision.semanticKey === parent.semanticKey,
		)).toMatchObject({
			status: "resolved",
			selection: {name: "Boon of Dimensional Travel", source: "XPHB"},
		});
		expect(liveState.getAbilityBase("con")).toBe(16);
		expect(liveState.getFeats()[0].sourceDecisionKey).toBeUndefined();

		const reloaded = new CharacterSheetState();
		expect(reloaded.loadFromJson(copy(respec._state.toJson()))).not.toBe(false);
		const reopened = new CharacterSheetRespec({page: getPage(reloaded), state: reloaded});
		reopened._engine.begin();
		expect(getBoonParent(reopened)).toMatchObject({
			status: "resolved",
			selection: {name: "Boon of Dimensional Travel", source: "XPHB"},
		});
		expect(reopened._engine.state.getAbilityBase("con")).toBe(15);
	});

	it("treats selecting the already adopted boon and ability as an exact no-op", () => {
		const {respec} = getRespec();
		const before = copy(respec._state.toJson());

		stageBoon(respec, FIXTURE.catalogs.boon, "con");

		expect(respec._state.toJson()).toEqual(before);
		expect(respec._engine.isDirty).toBe(false);
	});

	it("replaces the adopted boon with exactly one source-owned boon and one ability delta", () => {
		const {respec, state: liveState} = getRespec();

		const parent = stageBoon(respec, FIXTURE.catalogs.spellRecallBoon, "cha");
		const child = getBoonAbilityChild(respec);
		const candidateFeats = respec._state.getFeats().filter(feat => /^Boon of /i.test(feat.name));

		expect(candidateFeats).toEqual([
			expect.objectContaining({
				name: "Boon of Spell Recall",
				sourceDecisionKey: parent.semanticKey,
				choices: {ability: "cha"},
				appliedEffects: expect.objectContaining({abilityDeltas: {cha: 1}}),
			}),
		]);
		expect(child).toMatchObject({status: "resolved", selection: "cha"});
		expect(child.receipt?.effects).toEqual([
			expect.objectContaining({type: "abilityDelta", ability: "cha", amount: 1, before: 18}),
		]);
		expect(respec._state.getAbilityBase("con")).toBe(14);
		expect(respec._state.getAbilityBase("cha")).toBe(19);
		expect(liveState.getFeats().map(feat => feat.name)).toEqual(["Boon of Dimensional Travel"]);

		respec._engine.cancel();
		expect(liveState.getAbilityBase("con")).toBe(16);
		expect(liveState.getAbilityBase("cha")).toBe(18);
		expect(liveState.getFeats().map(feat => feat.name)).toEqual(["Boon of Dimensional Travel"]);
	});

	it("persists a boon replacement through reload and Undo restores Juli's exact legacy boon state", async () => {
		const {respec, state: liveState, page} = getRespec();
		stageBoon(respec, FIXTURE.catalogs.spellRecallBoon, "cha");

		expect(respec._engine.getValidation().isValid).toBe(true);
		await expect(respec._engine.apply()).resolves.toBe(true);
		expect(page.saveCharacter).toHaveBeenCalledTimes(1);

		const reloaded = new CharacterSheetState();
		expect(reloaded.loadFromJson(copy(liveState.toJson()))).not.toBe(false);
		const reopened = new CharacterSheetRespec({page: getPage(reloaded), state: reloaded});
		reopened._engine.begin();
		expect(getBoonParent(reopened)).toMatchObject({
			status: "resolved",
			selection: {name: "Boon of Spell Recall", source: "XPHB"},
		});
		expect(getBoonAbilityChild(reopened)).toMatchObject({status: "resolved", selection: "cha"});
		expect(reopened._engine.state.getFeats().filter(feat => /^Boon of /i.test(feat.name))).toHaveLength(1);
		expect(reopened._engine.state.getAbilityBase("con")).toBe(14);
		expect(reopened._engine.state.getAbilityBase("cha")).toBe(19);

		await expect(respec._engine.undo()).resolves.toBe(true);
		expect(liveState.getFeats().map(feat => feat.name)).toEqual(["Boon of Dimensional Travel"]);
		expect(liveState.getFeats()[0].sourceDecisionKey).toBeUndefined();
		expect(liveState.getAbilityBase("con")).toBe(16);
		expect(liveState.getAbilityBase("cha")).toBe(18);
	});

	it("surfaces a skipped boon as a required parent and ability child before Apply", async () => {
		const {respec, state: liveState, page} = getRespec(getState({skipped: true}));
		expect(getBoonParent(respec)).toMatchObject({status: "missing", selection: null});
		expect(getBoonAbilityChild(respec)).toBeUndefined();

		stageBoon(respec, FIXTURE.catalogs.spellRecallBoon);
		const missingChild = getBoonAbilityChild(respec);
		expect(missingChild).toMatchObject({status: "missing", selection: null});
		expect(respec._engine.getValidation().isValid).toBe(false);
		await expect(respec._engine.apply()).rejects.toThrow("Resolve 1 required Respec item");

		const resolvedChild = stageBoonAbility(respec, "cha");
		expect(resolvedChild).toMatchObject({status: "resolved", selection: "cha"});
		expect(respec._state.getAbilityBase("cha")).toBe(19);
		expect(respec._state.getFeats()).toEqual([
			expect.objectContaining({
				name: "Boon of Spell Recall",
				choices: {ability: "cha"},
				appliedEffects: expect.objectContaining({abilityDeltas: {cha: 1}}),
			}),
		]);

		await expect(respec._engine.apply()).resolves.toBe(true);
		expect(page.saveCharacter).toHaveBeenCalledTimes(1);
		const reloaded = new CharacterSheetState();
		expect(reloaded.loadFromJson(copy(liveState.toJson()))).not.toBe(false);
		const reopened = new CharacterSheetRespec({page: getPage(reloaded), state: reloaded});
		reopened._engine.begin();
		expect(getBoonParent(reopened)).toMatchObject({status: "resolved"});
		expect(getBoonAbilityChild(reopened)).toMatchObject({status: "resolved", selection: "cha"});
	});
});
