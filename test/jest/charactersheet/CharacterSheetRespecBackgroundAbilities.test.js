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

const RACE = {
	name: "Dendulra",
	source: "TGTT",
	ability: [{cha: 2, choose: {from: ["wis", "dex"], count: 1, amount: 1}}],
};

const BACKGROUND = {
	name: "Criminal",
	source: "XPHB",
	ability: [
		{choose: {weighted: {from: ["dex", "con", "int"], weights: [2, 1]}}},
		{choose: {weighted: {from: ["dex", "con", "int"], weights: [1, 1, 1]}}},
	],
};

const CLASS = {
	name: "Test Class",
	source: "TST",
	level: 1,
	hd: {faces: 8},
	classFeatures: [],
};

function getState ({backgroundChoices = {}, backgroundBonuses = {}} = {}) {
	const state = new CharacterSheetState();
	state.addClass(copy(CLASS));
	state.recordLevelChoice({
		level: 1,
		class: {name: CLASS.name, source: CLASS.source},
		choices: {},
	});
	state.setRace(copy(RACE));
	state.setBackground(copy(BACKGROUND));
	state.setBaseRaceUserChoices({
		selectedAbilityChoices: {
			"Dendulra|TGTT": {
				choose_0_0: "dex",
				choose_0_0_amount: 1,
			},
		},
	});
	state.setBaseBackgroundUserChoices(copy(backgroundChoices));
	state.setAbilityBonus("dex", 1);
	state.setAbilityBonus("cha", 2);
	for (const [ability, amount] of Object.entries(backgroundBonuses)) {
		state.setAbilityBonus(ability, state.getAbilityBonus(ability) + amount);
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
		getFeats: () => [],
		getSpells: () => [],
		getFilteredSpellData: () => [],
		getSkillsList: () => [],
		getRaces: () => [copy(RACE)],
		getBackgrounds: () => [copy(BACKGROUND)],
		filterByAllowedSources: values => values,
		saveCharacter: jest.fn().mockResolvedValue(undefined),
		renderCharacter: jest.fn(),
	};
}

function getBackgroundAbilityDecisions (manifest) {
	return manifest.base.decisions.filter(decision =>
		decision.provenance?.ownerType === "background"
			&& decision.meta?.originAbilityDistribution,
	);
}

describe("Character Sheet Respec background ability distributions", () => {
	it("records absent legacy evidence as one required incomplete mode without guessing children", () => {
		const state = getState();
		const manifest = CharacterSheetProgression.buildManifest({page: getPage(state), state});
		const decisions = getBackgroundAbilityDecisions(manifest);

		expect(decisions).toHaveLength(1);
		expect(decisions[0]).toMatchObject({
			type: "nestedConfiguration",
			required: true,
			status: "missing",
			selection: null,
			count: 1,
		});
		expect(decisions[0].options).toEqual([
			expect.objectContaining({weights: [2, 1]}),
			expect.objectContaining({weights: [1, 1, 1]}),
		]);
		expect(manifest.isComplete).toBe(false);
	});

	it.each([
		{
			label: "+2/+1",
			selectedAbilityBonuses: {
				bg_0: "dex",
				bg_0_weight: 2,
				bg_1: "con",
				bg_1_weight: 1,
			},
			backgroundBonuses: {dex: 2, con: 1},
			expectedAmounts: [2, 1],
			expectedSelections: ["dex", "con"],
		},
		{
			label: "+1/+1/+1",
			selectedAbilityBonuses: {
				bg_0: "dex",
				bg_0_weight: 1,
				bg_1: "con",
				bg_1_weight: 1,
				bg_2: "int",
				bg_2_weight: 1,
			},
			backgroundBonuses: {dex: 1, con: 1, int: 1},
			expectedAmounts: [1, 1, 1],
			expectedSelections: ["dex", "con", "int"],
		},
	])("models $label as one parent with weighted dependent children", ({
		selectedAbilityBonuses,
		backgroundBonuses,
		expectedAmounts,
		expectedSelections,
	}) => {
		const state = getState({
			backgroundChoices: {selectedAbilityBonuses},
			backgroundBonuses,
		});
		const manifest = CharacterSheetProgression.buildManifest({page: getPage(state), state});
		const [parent, ...children] = getBackgroundAbilityDecisions(manifest);

		expect(parent).toMatchObject({
			type: "nestedConfiguration",
			status: "resolved",
			selection: expect.objectContaining({weights: expectedAmounts}),
		});
		expect(children).toHaveLength(expectedAmounts.length);
		expect(children.map(child => child.type)).toEqual(expectedAmounts.map(() => "nestedAbility"));
		expect(children.map(child => child.meta.descriptorRules.amount)).toEqual(expectedAmounts);
		expect(children.map(child => child.selection)).toEqual(expectedSelections);
		expect(children.every(child => child.parentSemanticKey === parent.semanticKey)).toBe(true);
		expect(new Set(children.map(child => child.semanticKey)).size).toBe(children.length);
	});

	it("marks duplicate ability assignments invalid", () => {
		const state = getState({
			backgroundChoices: {
				selectedAbilityBonuses: {
					bg_0: "dex",
					bg_0_weight: 2,
					bg_1: "dex",
					bg_1_weight: 1,
				},
			},
			backgroundBonuses: {dex: 3},
		});
		const manifest = CharacterSheetProgression.buildManifest({page: getPage(state), state});
		const children = getBackgroundAbilityDecisions(manifest).filter(decision => decision.type === "nestedAbility");

		expect(children.map(child => child.status)).toEqual(["invalid", "invalid"]);
		expect(manifest.isComplete).toBe(false);
	});

	it("surfaces incomplete background ability history on the Base card", () => {
		const state = getState();
		const respec = new CharacterSheetRespec({page: getPage(state), state});
		respec._engine.begin();
		respec._state = respec._engine.state;

		const card = respec._renderBaseCard();
		const descendants = [];
		const collect = element => {
			for (const child of element?._children || []) {
				descendants.push(child);
				collect(child);
			}
		};
		collect(card);
		const repair = descendants.find(element => element?.dataset?.respecBackgroundAbilityRepair);

		expect(repair?.textContent).toContain("Background ability choices are incomplete");
	});

	it("replaces dependent children and exact deltas when the distribution mode changes", async () => {
		const state = getState({
			backgroundChoices: {
				selectedAbilityBonuses: {
					bg_0: "dex",
					bg_0_weight: 2,
					bg_1: "con",
					bg_1_weight: 1,
				},
			},
			backgroundBonuses: {dex: 2, con: 1, wis: 4},
		});
		const respec = new CharacterSheetRespec({page: getPage(state), state});
		respec._engine.begin();
		respec._state = respec._engine.state;
		const oldChildren = getBackgroundAbilityDecisions(respec._engine.manifest)
			.filter(decision => decision.type === "nestedAbility")
			.map(decision => decision.semanticKey);

		await respec._stageSameBackgroundAbilityChoices({
			selectedAbilityBonuses: {
				bg_0: "dex",
				bg_0_weight: 1,
				bg_1: "con",
				bg_1_weight: 1,
				bg_2: "int",
				bg_2_weight: 1,
			},
		});

		const decisions = getBackgroundAbilityDecisions(respec._engine.manifest);
		const children = decisions.filter(decision => decision.type === "nestedAbility");
		expect(children).toHaveLength(3);
		expect(children.map(decision => decision.meta.descriptorRules.amount)).toEqual([1, 1, 1]);
		expect(children.every(decision => !oldChildren.includes(decision.semanticKey))).toBe(true);
		expect(respec._state.getAbilityBonus("dex")).toBe(2);
		expect(respec._state.getAbilityBonus("con")).toBe(1);
		expect(respec._state.getAbilityBonus("int")).toBe(1);
		expect(respec._state.getAbilityBonus("wis")).toBe(4);
		expect(respec._state.getAbilityBonus("cha")).toBe(2);
		expect(respec._engine.getValidation().errors).toEqual([]);
	});

	it("repairs exact source-owned bonuses with Cancel, Apply/reload, and one-step Undo", async () => {
		const state = getState();
		expect(state.loadFromJson(state.toJson())).not.toBe(false);
		const page = getPage(state);
		const respec = new CharacterSheetRespec({page, state});
		const original = state.toJson();
		const selections = {
			selectedAbilityBonuses: {
				bg_0: "dex",
				bg_0_weight: 2,
				bg_1: "con",
				bg_1_weight: 1,
			},
		};

		respec._engine.begin();
		respec._state = respec._engine.state;
		await respec._stageSameBackgroundAbilityChoices(selections);
		expect(respec._state.getAbilityBonus("dex")).toBe(3);
		expect(respec._state.getAbilityBonus("con")).toBe(1);
		expect(respec._state.getAbilityBonus("cha")).toBe(2);
		respec._engine.cancel();
		expect(state.toJson()).toEqual(original);

		respec._engine.begin();
		respec._state = respec._engine.state;
		await respec._stageSameBackgroundAbilityChoices(selections);
		expect(respec._engine.getValidation().errors).toEqual([]);
		await respec._engine.apply();
		expect(state.getAbilityBonus("dex")).toBe(3);
		expect(state.getAbilityBonus("con")).toBe(1);
		expect(state.getAbilityBonus("cha")).toBe(2);

		const loaded = new CharacterSheetState();
		expect(loaded.loadFromJson(state.toJson())).not.toBe(false);
		const reopened = new CharacterSheetRespec({page: getPage(loaded), state: loaded});
		reopened._engine.begin();
		const decisions = getBackgroundAbilityDecisions(reopened._engine.manifest);
		expect(decisions.map(decision => decision.status)).toEqual(["resolved", "resolved", "resolved"]);
		expect(loaded.getBaseBackgroundUserChoices().selectedAbilityBonuses).toEqual(selections.selectedAbilityBonuses);
		expect(loaded.getAbilityBonus("dex")).toBe(3);
		expect(loaded.getAbilityBonus("con")).toBe(1);
		expect(loaded.getAbilityBonus("cha")).toBe(2);

		expect(await respec._engine.undo()).toBe(true);
		expect(state.toJson()).toEqual(original);
		expect(await respec._engine.undo()).toBe(false);
	});
});
