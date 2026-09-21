import "./setup.js";
import {jest} from "@jest/globals";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-progression.js";
import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-respec-engine.js";
import "../../../js/charactersheet/charactersheet-respec.js";

const CharacterSheetProgression = globalThis.CharacterSheetProgression;
const CharacterSheetRespec = globalThis.CharacterSheetRespec;
const CharacterSheetState = globalThis.CharacterSheetState;

const copy = value => JSON.parse(JSON.stringify(value));

const ALERT = {
	name: "Alert",
	source: "XPHB",
	category: "O",
};

const CRIMINAL = {
	name: "Criminal",
	source: "XPHB",
	feats: [{"alert|xphb": true}],
};

const CLASS = {
	name: "Test Class",
	source: "TST",
	level: 1,
	hd: {faces: 8},
	classFeatures: [],
};

function getState ({owned = false} = {}) {
	const state = new CharacterSheetState();
	state.setAbilityBase("dex", 14);
	state.addClass(copy(CLASS));
	state.recordLevelChoice({
		level: 1,
		class: {name: CLASS.name, source: CLASS.source},
		choices: {},
	});
	state.setBackground(copy(CRIMINAL));
	const sourceDecisionKey = owned
		? CharacterSheetProgression.getFixedOriginFeatSemanticKey({
			originType: "background",
			originUid: "criminal|xphb",
			featName: "Alert",
			featSource: "XPHB",
		})
		: null;
	state.addFeat(copy(ALERT), sourceDecisionKey ? {sourceDecisionKey} : {});
	return state;
}

function getPage (state) {
	return {
		getState: () => state,
		getClasses: () => [copy(CLASS)],
		getClassFeatures: () => [],
		getSubclassFeatures: () => [],
		getOptionalFeatures: () => [],
		getFeats: () => [copy(ALERT)],
		getSpells: () => [],
		getFilteredSpellData: () => [],
		getSkillsList: () => [],
		getRaces: () => [],
		getBackgrounds: () => [copy(CRIMINAL)],
		filterByAllowedSources: values => values,
		saveCharacter: jest.fn().mockResolvedValue(undefined),
		renderCharacter: jest.fn(),
	};
}

function getFixedAlertDecision (manifest) {
	return manifest.base.decisions.find(decision =>
		decision.type === "nestedFeat"
			&& decision.meta?.fixedOriginGrant
			&& decision.selection?.name === "Alert",
	);
}

function getAlertCounts (state) {
	return {
		feats: state.getFeats().filter(feat => feat.name === "Alert" && feat.source === "XPHB").length,
		modifiers: state.getNamedModifiers().filter(modifier => modifier.name === "Alert" && modifier.type === "initiative").length,
	};
}

describe("Character Sheet Respec fixed background feat ownership", () => {
	it("discovers Criminal Alert as a fixed origin child without assigning a level", () => {
		const state = getState();
		const manifest = CharacterSheetProgression.buildManifest({page: getPage(state), state});
		const decision = getFixedAlertDecision(manifest);
		const background = manifest.base.decisions.find(candidate => candidate.type === "originBackground");

		expect(decision).toMatchObject({
			scope: "origin",
			characterLevel: 0,
			classLevel: 0,
			required: true,
			status: "resolved",
			selection: {name: "Alert", source: "XPHB"},
			parentSemanticKey: background.semanticKey,
			meta: {fixedOriginGrant: true},
		});
		expect(decision.options).toEqual([expect.objectContaining({name: "Alert", source: "XPHB"})]);
		expect(state.getFeats()[0].level).toBeUndefined();
	});

	it("stamps newly applied Criminal Alert with the same stable owner and stays idempotent", () => {
		const state = new CharacterSheetState();
		state.setBackground(copy(CRIMINAL));
		const expectedKey = CharacterSheetProgression.getFixedOriginFeatSemanticKey({
			originType: "background",
			originUid: "criminal|xphb",
			featName: "Alert",
			featSource: "XPHB",
		});

		expect(state.applyBackgroundFeats()).toBe(1);
		expect(state.applyBackgroundFeats()).toBe(0);
		expect(state.getOriginFeat()).toMatchObject({
			name: "Alert",
			source: "XPHB",
			isOriginFeat: true,
			backgroundName: "Criminal",
			sourceDecisionKey: expectedKey,
		});
		expect(getAlertCounts(state)).toEqual({feats: 1, modifiers: 1});
	});

	it("adopts Juli-style unowned Alert in place with a materialized receipt", () => {
		const state = getState();
		const initiative = state.getInitiative();
		const alertId = state.getFeats()[0].id;
		const respec = new CharacterSheetRespec({page: getPage(state), state});

		respec._engine.begin();
		const feat = respec._engine.state.getFeats().find(candidate => candidate.id === alertId);
		const decision = getFixedAlertDecision(respec._engine.manifest);

		expect(feat).toMatchObject({
			id: alertId,
			isOriginFeat: true,
			backgroundName: "Criminal",
			sourceDecisionKey: decision.semanticKey,
		});
		expect(decision.receipt).toEqual(expect.objectContaining({
			sourceDecisionKey: decision.semanticKey,
			effects: expect.arrayContaining([
				expect.objectContaining({
					type: "materialized",
					feats: [expect.objectContaining({id: alertId, name: "Alert", source: "XPHB"})],
				}),
			]),
		}));
		expect(getAlertCounts(respec._engine.state)).toEqual({feats: 1, modifiers: 1});
		expect(respec._engine.state.getInitiative()).toBe(initiative);
	});

	it("preserves one Alert through unrelated Cancel, Apply/reload, and one-step Undo", async () => {
		const state = getState();
		expect(state.loadFromJson(state.toJson())).not.toBe(false);
		const page = getPage(state);
		const respec = new CharacterSheetRespec({page, state});
		const original = state.toJson();
		const initiative = state.getInitiative();

		respec._engine.begin();
		await respec._engine.stageCandidateMutation(({state: candidate}) => candidate.setAlignment("CG"));
		expect(getAlertCounts(respec._engine.state)).toEqual({feats: 1, modifiers: 1});
		respec._engine.cancel();
		expect(state.toJson()).toEqual(original);
		expect(getAlertCounts(state)).toEqual({feats: 1, modifiers: 1});

		respec._engine.begin();
		await respec._engine.stageCandidateMutation(({state: candidate}) => candidate.setAlignment("CG"));
		await respec._engine.apply();
		expect(state.getAlignment()).toBe("CG");
		expect(getAlertCounts(state)).toEqual({feats: 1, modifiers: 1});
		expect(state.getInitiative()).toBe(initiative);

		const loaded = new CharacterSheetState();
		expect(loaded.loadFromJson(state.toJson())).not.toBe(false);
		const reopened = new CharacterSheetRespec({page: getPage(loaded), state: loaded});
		reopened._engine.begin();
		const decision = getFixedAlertDecision(reopened._engine.manifest);
		expect(decision.receipt).not.toBeNull();
		expect(getAlertCounts(reopened._engine.state)).toEqual({feats: 1, modifiers: 1});
		expect(reopened._engine.state.getInitiative()).toBe(initiative);

		expect(await respec._engine.undo()).toBe(true);
		expect(state.toJson()).toEqual(original);
		expect(getAlertCounts(state)).toEqual({feats: 1, modifiers: 1});
		expect(state.getInitiative()).toBe(initiative);
		expect(await respec._engine.undo()).toBe(false);
	});
});
