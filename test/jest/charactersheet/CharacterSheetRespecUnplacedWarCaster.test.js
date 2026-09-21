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

const CLASS = {
	name: "Test Class",
	source: "TST",
	level: 1,
	hd: {faces: 8},
	classFeatures: [],
};

const WAR_CASTER = {
	name: "War Caster",
	source: "XPHB",
	category: "G",
	ability: [{
		choose: {
			from: ["int", "wis", "cha"],
			count: 1,
			amount: 1,
		},
		max: 20,
	}],
};

function getState ({ability = "wis"} = {}) {
	const state = new CharacterSheetState();
	state.setAbilityBase("int", 10);
	state.setAbilityBase("wis", 12);
	state.setAbilityBase("cha", 19);
	state.addClass(copy(CLASS));
	state.recordLevelChoice({
		level: 1,
		class: {name: CLASS.name, source: CLASS.source},
		choices: {},
	});
	state.addFeat({...copy(WAR_CASTER), choices: ability ? {ability} : null});
	const feat = state._data.feats.find(candidate => candidate.name === WAR_CASTER.name);
	feat.id = "juli-war-caster";
	feat.choices = ability ? {ability} : null;
	feat.appliedEffects = {
		...(feat.appliedEffects || {}),
		abilityDeltas: {},
	};
	for (const modifier of state.getNamedModifiers().filter(candidate => candidate.name === WAR_CASTER.name)) {
		modifier.sourceFeatureId = feat.id;
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
		getFeats: () => [copy(WAR_CASTER)],
		getSpells: () => [],
		getFilteredSpellData: () => [],
		getSkillsList: () => [],
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
			&& decision.selection?.name === WAR_CASTER.name,
	);
}

function getAbilityChild (manifest) {
	const parent = getParent(manifest);
	return manifest.base.decisions.find(decision =>
		decision.meta?.unplacedFeatAbility
			&& decision.parentSemanticKey === parent?.semanticKey,
	);
}

function getWarCaster (state) {
	return state.getFeats().find(feat => feat.name === WAR_CASTER.name && feat.source === WAR_CASTER.source);
}

function getConcentrationModifiers (state) {
	return state.getNamedModifiers().filter(modifier =>
		modifier.name === WAR_CASTER.name && modifier.type === "concentration",
	);
}

function getStubText (element) {
	return [
		element?.textContent || "",
		...(element?.children || []).map(getStubText),
	].filter(Boolean).join(" ");
}

async function stageAbility (respec, ability) {
	const child = getAbilityChild(respec._engine.manifest);
	await respec._engine.stageGraphMutation(child.id, ability, {
		reverseParent: true,
		apply: ({state}) => respec._applyManifestSelectionMechanics(child, ability, child.options, state),
	});
}

describe("Character Sheet Respec unplaced War Caster ability", () => {
	it("discovers a stable owned child and adopts Juli's exact legacy +1", () => {
		const state = getState();
		const respec = new CharacterSheetRespec({page: getPage(state), state});

		respec._engine.begin();
		const parent = getParent(respec._engine.manifest);
		const child = getAbilityChild(respec._engine.manifest);
		const feat = getWarCaster(respec._engine.state);

		expect(child).toMatchObject({
			characterLevel: null,
			classLevel: null,
			scope: "unplaced",
			type: "nestedAbility",
			status: "resolved",
			selection: "wis",
			options: ["int", "wis", "cha"],
			parentSemanticKey: parent.semanticKey,
			rootSemanticKey: parent.semanticKey,
			meta: {
				unplacedFeatAbility: true,
				featId: "juli-war-caster",
				descriptorRules: {amount: 1, max: 20},
			},
		});
		expect(child.semanticKey).toBe(CharacterSheetProgression.getNestedSemanticKey({
			parentSemanticKey: parent.semanticKey,
			acquisitionKey: "unplaced-feat:war caster|xphb",
			grantKey: "ability",
			occurrence: 0,
			slot: 0,
			identityMode: "opportunity",
		}));
		expect(child.receipt).toEqual(expect.objectContaining({
			sourceDecisionKey: child.semanticKey,
			effects: [expect.objectContaining({
				type: "abilityDelta",
				ability: "wis",
				amount: 1,
				before: 11,
			})],
		}));
		expect(feat.appliedEffects.abilityDeltas).toEqual({wis: 1});
		expect(respec._engine.state.getAbilityBase("wis")).toBe(12);
		expect(getConcentrationModifiers(respec._engine.state)).toHaveLength(1);
		expect(getConcentrationModifiers(respec._engine.state)[0].sourceDecisionKey).toBe(parent.semanticKey);
	});

	it("keeps missing legacy ability evidence incomplete and visible", () => {
		const state = getState({ability: null});
		const respec = new CharacterSheetRespec({page: getPage(state), state});

		respec._engine.begin();
		const child = getAbilityChild(respec._engine.manifest);
		const text = getStubText(respec._renderBaseCard());

		expect(child).toMatchObject({
			selection: null,
			status: "missing",
			required: true,
			receipt: null,
		});
		expect(respec._engine.getValidation().errors).toEqual(expect.arrayContaining([
			expect.objectContaining({decisionId: child.id, code: "decision-missing"}),
		]));
		expect(text).toContain("War Caster");
		expect(text).toContain("Ability: Unknown");
		expect(text).toContain("Choose ability");
		expect(respec._engine.state.getAbilityBase("wis")).toBe(12);
		expect(getWarCaster(respec._engine.state).appliedEffects.abilityDeltas).toEqual({});
	});

	it("treats selecting Wisdom again as a mechanical no-op", async () => {
		const state = getState();
		const respec = new CharacterSheetRespec({page: getPage(state), state});

		respec._engine.begin();
		const parentKey = getParent(respec._engine.manifest).semanticKey;
		await stageAbility(respec, "wis");

		expect(getAbilityChild(respec._engine.manifest).selection).toBe("wis");
		expect(respec._engine.state.getAbilityBase("int")).toBe(10);
		expect(respec._engine.state.getAbilityBase("wis")).toBe(12);
		expect(respec._engine.state.getAbilityBase("cha")).toBe(19);
		expect(getWarCaster(respec._engine.state)).toMatchObject({
			sourceDecisionKey: parentKey,
			choices: {ability: "wis"},
			appliedEffects: {abilityDeltas: {wis: 1}},
		});
		expect(getConcentrationModifiers(respec._engine.state)).toHaveLength(1);
		expect(getConcentrationModifiers(respec._engine.state)[0].sourceDecisionKey).toBe(parentKey);
	});

	it("replaces only the +1 delta through Cancel, Apply/reload, and one-step Undo", async () => {
		const state = getState();
		expect(state.loadFromJson(state.toJson())).not.toBe(false);
		const original = state.toJson();
		const modifierId = getConcentrationModifiers(state)[0].id;
		const page = getPage(state);
		const respec = new CharacterSheetRespec({page, state});

		respec._engine.begin();
		await stageAbility(respec, "int");
		expect(respec._engine.state.getAbilityBase("wis")).toBe(11);
		expect(respec._engine.state.getAbilityBase("int")).toBe(11);
		expect(getConcentrationModifiers(respec._engine.state).map(modifier => modifier.id)).toEqual([modifierId]);
		respec._engine.cancel();
		expect(state.toJson()).toEqual(original);

		respec._engine.begin();
		await stageAbility(respec, "int");
		expect(getAbilityChild(respec._engine.manifest).selection).toBe("int");
		await respec._engine.apply();
		expect(state.getAbilityBase("wis")).toBe(11);
		expect(state.getAbilityBase("int")).toBe(11);
		expect(getWarCaster(state)).toMatchObject({
			id: "juli-war-caster",
			choices: {ability: "int"},
			appliedEffects: {abilityDeltas: {int: 1}},
		});
		expect(getConcentrationModifiers(state).map(modifier => modifier.id)).toEqual([modifierId]);

		const loaded = new CharacterSheetState();
		expect(loaded.loadFromJson(state.toJson())).not.toBe(false);
		const reopened = new CharacterSheetRespec({page: getPage(loaded), state: loaded});
		reopened._engine.begin();
		expect(getAbilityChild(reopened._engine.manifest)).toMatchObject({
			selection: "int",
			status: "resolved",
			characterLevel: null,
			classLevel: null,
		});
		expect(loaded.getAbilityBase("wis")).toBe(11);
		expect(loaded.getAbilityBase("int")).toBe(11);

		respec._engine.begin();
		await stageAbility(respec, "cha");
		await respec._engine.apply();
		expect(state.getAbilityBase("int")).toBe(10);
		expect(state.getAbilityBase("cha")).toBe(20);
		expect(await respec._engine.undo()).toBe(true);
		expect(state.getAbilityBase("wis")).toBe(11);
		expect(state.getAbilityBase("int")).toBe(11);
		expect(state.getAbilityBase("cha")).toBe(19);
		expect(getWarCaster(state)).toMatchObject({
			id: "juli-war-caster",
			choices: {ability: "int"},
			appliedEffects: {abilityDeltas: {int: 1}},
		});
		expect(getConcentrationModifiers(state).map(modifier => modifier.id)).toEqual([modifierId]);
		expect(await respec._engine.undo()).toBe(false);
	});
});
