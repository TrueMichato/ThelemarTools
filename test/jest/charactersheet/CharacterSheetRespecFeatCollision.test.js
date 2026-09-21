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
	repeatable: false,
};

const INSPIRING_LEADER = {
	name: "Inspiring Leader",
	source: "XPHB",
	category: "G",
	repeatable: false,
};

const CRIMINAL = {
	name: "Criminal",
	source: "XPHB",
	feats: [{"alert|xphb": true}],
};

const SUBCLASS = {
	name: "Test College",
	shortName: "Test College",
	source: "TST",
	className: "Test Bard",
	classSource: "TST",
};

const CLASS = {
	name: "Test Bard",
	source: "TST",
	level: 4,
	hd: {faces: 8},
	subclass: copy(SUBCLASS),
	subclasses: [copy(SUBCLASS)],
	classFeatures: [
		[],
		[],
		[],
		["Ability Score Improvement|Test Bard|TST|4"],
	],
};

function getState () {
	const state = new CharacterSheetState();
	state.setAbilityBase("dex", 14);
	state.setAbilityBase("cha", 16);
	state.addClass(copy(CLASS));
	for (let level = 1; level <= 4; level++) {
		state.recordLevelChoice({
			level,
			class: {name: CLASS.name, source: CLASS.source},
			choices: level === 4
				? {
					asi: {cha: 2},
					feat: {name: ALERT.name, source: ALERT.source},
				}
				: level === 3
					? {subclass: copy(SUBCLASS)}
					: {},
		});
	}
	state.setBackground(copy(CRIMINAL));
	state.addFeat(copy(ALERT));
	expect(state.loadFromJson(state.toJson())).not.toBe(false);
	return state;
}

function getPage (state) {
	return {
		getState: () => state,
		getClasses: () => [copy(CLASS)],
		getClassFeatures: () => [],
		getSubclassFeatures: () => [],
		getOptionalFeatures: () => [],
		getFeats: () => [copy(ALERT), copy(INSPIRING_LEADER)],
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

function getRespec (state = getState()) {
	const page = getPage(state);
	const respec = new CharacterSheetRespec({page, state});
	respec._engine.begin();
	respec._state = respec._engine.state;
	return {respec, state, page};
}

function getFixedAlertDecision (respec) {
	return respec._engine.manifest.base.decisions.find(decision =>
		decision.type === "nestedFeat"
			&& decision.meta?.fixedOriginGrant
			&& decision.selection?.name === ALERT.name,
	);
}

function getLevelFourFeatDecision (respec) {
	return respec._engine.manifest.decisions.find(decision =>
		decision.type === "feat"
			&& Number(decision.characterLevel) === 4,
	);
}

function getArtifactCounts (state) {
	return {
		alertFeats: state.getFeats().filter(feat =>
			feat.name === ALERT.name && feat.source === ALERT.source,
		).length,
		alertModifiers: state.getNamedModifiers().filter(modifier =>
			modifier.name === ALERT.name && modifier.type === "initiative",
		).length,
		inspiringLeaderFeats: state.getFeats().filter(feat =>
			feat.name === INSPIRING_LEADER.name && feat.source === INSPIRING_LEADER.source,
		).length,
		inspiringLeaderResources: state.getResources().filter(resource =>
			resource.name === INSPIRING_LEADER.name,
		).length,
	};
}

function stageInspiringLeader (respec) {
	const decision = getLevelFourFeatDecision(respec);
	expect(respec._applyImprovementChange(decision, {
		mode: "feat",
		feat: copy(INSPIRING_LEADER),
		featChoices: {},
	})).toBe(true);
	return getLevelFourFeatDecision(respec);
}

describe("Character Sheet Respec non-repeatable feat collision", () => {
	it("documents both Alert opportunities and marks the duplicate level choice repairable", () => {
		const {respec, state: liveState} = getRespec();
		const fixed = getFixedAlertDecision(respec);
		const levelFour = getLevelFourFeatDecision(respec);
		const candidateAlert = respec._state.getFeats().find(feat => feat.name === ALERT.name);

		expect(fixed).toMatchObject({
			status: "resolved",
			selection: {name: ALERT.name, source: ALERT.source},
		});
		expect(levelFour).toMatchObject({
			status: "invalid",
			selection: {name: ALERT.name, source: ALERT.source},
			meta: {
				nonRepeatableFeatConflict: {
					feat: {name: ALERT.name, source: ALERT.source},
					ownerDecisionKey: fixed.semanticKey,
				},
			},
		});
		expect(levelFour.options).not.toEqual(expect.arrayContaining([
			expect.objectContaining({name: ALERT.name, source: ALERT.source}),
		]));
		expect(levelFour.options).toEqual(expect.arrayContaining([
			expect.objectContaining({name: INSPIRING_LEADER.name, source: INSPIRING_LEADER.source}),
		]));
		expect(respec._engine.getValidation().issues).toEqual(expect.arrayContaining([
			expect.objectContaining({
				decisionId: levelFour.id,
				message: expect.stringContaining("already granted"),
			}),
		]));
		expect(candidateAlert).toMatchObject({
			isOriginFeat: true,
			backgroundName: CRIMINAL.name,
			sourceDecisionKey: fixed.semanticKey,
		});
		expect(getArtifactCounts(respec._state)).toEqual({
			alertFeats: 1,
			alertModifiers: 1,
			inspiringLeaderFeats: 0,
			inspiringLeaderResources: 0,
		});
		expect(liveState.getFeats()[0].sourceDecisionKey).toBeUndefined();
	});

	it("rejects selecting a non-repeatable feat already owned by another opportunity", () => {
		const {respec} = getRespec();
		const decision = getLevelFourFeatDecision(respec);
		const before = respec._state.toJson();

		expect(respec._applyImprovementChange(decision, {
			mode: "feat",
			feat: copy(ALERT),
			featChoices: {},
		})).toBe(false);
		expect(respec._state.toJson()).toEqual(before);
		expect(getArtifactCounts(respec._state)).toEqual({
			alertFeats: 1,
			alertModifiers: 1,
			inspiringLeaderFeats: 0,
			inspiringLeaderResources: 0,
		});
	});

	it("replaces only the invalid level choice through Cancel, Apply/reload, and Undo", async () => {
		const {respec, state, page} = getRespec();
		const original = state.toJson();
		const fixedKey = getFixedAlertDecision(respec).semanticKey;

		let levelFour = stageInspiringLeader(respec);
		expect(levelFour).toMatchObject({
			status: "resolved",
			selection: {name: INSPIRING_LEADER.name, source: INSPIRING_LEADER.source},
		});
		expect(getArtifactCounts(respec._state)).toEqual({
			alertFeats: 1,
			alertModifiers: 1,
			inspiringLeaderFeats: 1,
			inspiringLeaderResources: 1,
		});
		expect(respec._state.getFeats().find(feat => feat.name === ALERT.name)).toMatchObject({
			sourceDecisionKey: fixedKey,
			isOriginFeat: true,
			backgroundName: CRIMINAL.name,
		});
		expect(respec._state.getFeats().find(feat => feat.name === INSPIRING_LEADER.name)).toMatchObject({
			sourceDecisionKey: levelFour.semanticKey,
		});
		expect(respec._state.getResources().find(resource => resource.name === INSPIRING_LEADER.name)).toMatchObject({
			sourceDecisionKey: levelFour.semanticKey,
		});
		expect(getArtifactCounts(state)).toEqual({
			alertFeats: 1,
			alertModifiers: 1,
			inspiringLeaderFeats: 0,
			inspiringLeaderResources: 0,
		});
		respec._engine.cancel();
		expect(state.toJson()).toEqual(original);

		respec._engine.begin();
		respec._state = respec._engine.state;
		stageInspiringLeader(respec);
		expect(respec._engine.getValidation().isValid).toBe(true);
		await respec._engine.apply();
		expect(state.getLevelHistoryEntry(4).choices.feat).toEqual({
			name: INSPIRING_LEADER.name,
			source: INSPIRING_LEADER.source,
		});
		expect(getArtifactCounts(state)).toEqual({
			alertFeats: 1,
			alertModifiers: 1,
			inspiringLeaderFeats: 1,
			inspiringLeaderResources: 1,
		});

		const loaded = new CharacterSheetState();
		expect(loaded.loadFromJson(state.toJson())).not.toBe(false);
		const reopened = new CharacterSheetRespec({page: getPage(loaded), state: loaded});
		reopened._engine.begin();
		reopened._state = reopened._engine.state;
		expect(getLevelFourFeatDecision(reopened)).toMatchObject({
			status: "resolved",
			selection: {name: INSPIRING_LEADER.name, source: INSPIRING_LEADER.source},
		});
		expect(getArtifactCounts(reopened._state)).toEqual({
			alertFeats: 1,
			alertModifiers: 1,
			inspiringLeaderFeats: 1,
			inspiringLeaderResources: 1,
		});

		expect(await respec._engine.undo()).toBe(true);
		expect(state.toJson()).toEqual(original);
		expect(getArtifactCounts(state)).toEqual({
			alertFeats: 1,
			alertModifiers: 1,
			inspiringLeaderFeats: 0,
			inspiringLeaderResources: 0,
		});
		expect(await respec._engine.undo()).toBe(false);
	});
});
