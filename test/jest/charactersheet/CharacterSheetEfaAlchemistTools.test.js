import "./setup.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-progression.js";

let CharacterSheetState;
const CharacterSheetClassUtils = globalThis.CharacterSheetClassUtils;
const CharacterSheetProgression = globalThis.CharacterSheetProgression;

beforeAll(async () => {
	CharacterSheetState = (await import("../../../js/charactersheet/charactersheet-state.js")).CharacterSheetState;
});

const TOOLS_OF_THE_TRADE = {
	name: "Tools of the Trade",
	source: "EFA",
	className: "Artificer",
	classSource: "EFA",
	subclassShortName: "Alchemist",
	subclassSource: "EFA",
	level: 3,
	isSubclassFeature: true,
	featureType: "Subclass",
	entries: [
		"You gain the following benefits.",
		{
			type: "entries",
			name: "Tool Proficiency",
			entries: [
				"You gain proficiency with {@item Alchemist's Supplies|XPHB} and the {@item Herbalism Kit|XPHB}. If you already have one of these proficiencies, you gain proficiency with one other type of {@item Artisan's Tools|XPHB} of your choice (or with two other types if you have both).",
			],
		},
		{
			type: "entries",
			name: "Potion Crafting",
			entries: [
				"When you brew a potion using the crafting rules in the {@book Dungeon Master's Guide|XDMG|6|Crafting Magic Items}, the amount of time required to craft it is halved.",
			],
		},
	],
};

const addHistory = state => {
	for (let level = 1; level <= 3; ++level) {
		state.recordLevelChoice({
			level,
			class: {name: "Artificer", source: "EFA"},
			choices: {},
			complete: true,
		});
	}
};

const getState = ({preexistingTools = [], source = "EFA"} = {}) => {
	const state = new CharacterSheetState();
	state.addClass({
		name: "Artificer",
		source,
		level: 3,
		subclass: {name: "Alchemist", shortName: "Alchemist", source},
	});
	addHistory(state);
	preexistingTools.forEach(tool => state.addToolProficiency(tool));
	return state;
};

const addFeature = (state, overrides = {}) => {
	state.addFeature({...TOOLS_OF_THE_TRADE, ...overrides});
	return state.getFeatures().find(it => it.name === "Tools of the Trade");
};

describe("EFA Alchemist Tools of the Trade", () => {
	test("uses a reusable conditional-tool parser for the single-fixed-tool wording shared by other subclasses", () => {
		const state = getState({preexistingTools: ["Smith's Tools"]});
		const grant = CharacterSheetClassUtils.getConditionalToolProficiencyGrant({
			entries: [
				"You gain proficiency with {@item Smith's Tools|XPHB}. If you already have this tool proficiency, you gain proficiency with one other type of {@item Artisan's Tools|XPHB} of your choice.",
			],
		}, state);

		expect(grant).toMatchObject({
			fixedGrants: ["Smith's Tools|XPHB"],
			acquisitionFacts: {"Smith's Tools|XPHB": true},
			requiredCount: 1,
		});
	});

	test("grants both fixed tools with no replacement when neither proficiency was duplicated", () => {
		const state = getState();
		const feature = addFeature(state);

		expect(state.getToolProficiencies()).toEqual(expect.arrayContaining([
			"Alchemist's Supplies",
			"Herbalism Kit",
		]));
		expect(state.getPendingFeatureChoices()).toHaveLength(0);
		expect(feature._conditionalToolGrant).toMatchObject({
			requiredCount: 0,
			acquisitionFacts: {
				"Alchemist's Supplies|XPHB": false,
				"Herbalism Kit|XPHB": false,
			},
			receipt: {
				source: `feature:${feature.id}`,
				requiredReplacementCount: 0,
			},
		});

		state.removeFeature(feature.id);
		expect(state.hasToolProficiency("Alchemist's Supplies")).toBe(false);
		expect(state.hasToolProficiency("Herbalism Kit")).toBe(false);
	});

	test("captures one duplicate, persists one canonical array choice, and preserves the pre-existing tool on removal", () => {
		const state = getState({preexistingTools: ["Alchemist's Supplies"]});
		const feature = addFeature(state);
		const [choice] = state.getPendingFeatureChoices();

		expect(choice.count).toBe(1);
		expect(choice.options).not.toEqual(expect.arrayContaining(["Alchemist's Supplies", "Herbalism Kit"]));
		expect(state.fulfillFeatureChoice(choice.id, {name: "Smith's Tools", source: "XPHB"})).toBe(true);
		expect(feature._conditionalToolGrant.selections).toEqual(["Smith's Tools"]);
		expect(feature.choices.tools).toEqual(["Smith's Tools"]);

		const decision = state.getLevelHistory()
			.flatMap(entry => entry.decisions || [])
			.find(it => it.type === "nestedTool");
		expect(decision.selection).toEqual(["Smith's Tools"]);
		expect(JSON.stringify(decision)).not.toContain("[object Object]");

		state.removeFeature(feature.id);
		expect(state.hasToolProficiency("Alchemist's Supplies")).toBe(true);
		expect(state.hasToolProficiency("Herbalism Kit")).toBe(false);
		expect(state.hasToolProficiency("Smith's Tools")).toBe(false);
	});

	test("requires exactly two unique legal replacement tools when both fixed tools were duplicated", () => {
		const state = getState({preexistingTools: ["Alchemist's Supplies", "Herbalism Kit"]});
		const feature = addFeature(state);
		const [choice] = state.getPendingFeatureChoices();

		expect(choice.count).toBe(2);
		expect(choice.unique).toBe(true);
		expect(state.fulfillFeatureChoice(choice.id, ["Smith's Tools", "Smith's Tools"])).toBe(false);
		expect(state.getPendingFeatureChoices()).toHaveLength(1);
		expect(state.fulfillFeatureChoice(choice.id, [{name: "Smith's Tools"}, "Tinker's Tools|XPHB"])).toBe(true);

		expect(feature._conditionalToolGrant.selections).toEqual(["Smith's Tools", "Tinker's Tools"]);
		expect(state.hasToolProficiency("Smith's Tools")).toBe(true);
		expect(state.hasToolProficiency("Tinker's Tools")).toBe(true);
		const decision = state.getLevelHistory()
			.flatMap(entry => entry.decisions || [])
			.find(it => it.type === "nestedTool");
		expect(decision.selection).toEqual(["Smith's Tools", "Tinker's Tools"]);
		expect(decision.receipt.effects).toEqual([{
			type: "ownership",
			ownership: [
				{type: "tools", value: "Smith's Tools"},
				{type: "tools", value: "Tinker's Tools"},
			],
		}]);
		expect(state._data.grantedProficiencies.tools["smith's tools"]).toBeUndefined();
		expect(state._data.grantedProficiencies.tools["tinker's tools"]).toBeUndefined();
		const acquisitionKey = CharacterSheetProgression.getAcquisitionKey({
			ownerType: "subclassFeature",
			ownerUid: CharacterSheetProgression.getEntityUid(feature),
			classLevel: 3,
			sourcePath: feature.name,
			occurrence: 0,
		});
		expect(decision.semanticKey).toBe(CharacterSheetProgression.getNestedSemanticKey({
			parentSemanticKey: null,
			acquisitionKey,
			grantKey: "conditionalToolGrant.tools",
			identityMode: "opportunity",
		}));
	});

	test("emits one stable opportunity descriptor with the exact array selection for progression/respec", () => {
		const state = getState({preexistingTools: ["Alchemist's Supplies", "Herbalism Kit"]});
		addFeature(state);
		const [choice] = state.getPendingFeatureChoices();
		state.fulfillFeatureChoice(choice.id, ["Smith's Tools", "Tinker's Tools"]);
		const feature = state.getFeatures().find(it => it.name === "Tools of the Trade");

		const [descriptor] = CharacterSheetClassUtils.getChoiceDescriptors(feature, {state});
		expect(descriptor).toMatchObject({
			kind: "tool",
			count: 2,
			grantKey: "conditionalToolGrant.tools",
			rules: {
				identityMode: "opportunity",
				selectedValues: ["Smith's Tools", "Tinker's Tools"],
			},
		});
	});

	test("repairs an unresolved pending replacement from feature acquisition metadata after reload-like loss", () => {
		const state = getState({preexistingTools: ["Herbalism Kit"]});
		addFeature(state);
		state._data.pendingFeatureChoices = [];

		const [choice] = state.getPendingFeatureChoices();
		expect(choice).toMatchObject({
			kind: "tool",
			count: 1,
			unique: true,
			grantKey: "conditionalToolGrant.tools",
		});
	});

	test("preserves resolved array-valued tool metadata and does not requeue after save/load", () => {
		const original = getState({preexistingTools: ["Alchemist's Supplies", "Herbalism Kit"]});
		addFeature(original);
		const [choice] = original.getPendingFeatureChoices();
		original.fulfillFeatureChoice(choice.id, ["Smith's Tools", "Tinker's Tools"]);

		const restored = new CharacterSheetState();
		restored.loadFromJson(original.toJson());

		const feature = restored.getFeatures().find(it => it.name === "Tools of the Trade");
		expect(feature._conditionalToolGrant.selections).toEqual(["Smith's Tools", "Tinker's Tools"]);
		expect(feature.choices.tools).toEqual(["Smith's Tools", "Tinker's Tools"]);
		expect(restored.getPendingFeatureChoices()).toEqual([]);
		expect(restored.getLevelHistory()
			.flatMap(entry => entry.decisions || [])
			.find(it => it.type === "nestedTool")?.selection)
			.toEqual(["Smith's Tools", "Tinker's Tools"]);
	});

	test("replays acquisition facts after removal instead of retaining stale duplicate counts", () => {
		const state = getState({preexistingTools: ["Alchemist's Supplies"]});
		const firstFeature = addFeature(state);
		const [firstChoice] = state.getPendingFeatureChoices();
		state.fulfillFeatureChoice(firstChoice.id, "Smith's Tools");
		state.removeFeature(firstFeature.id);
		expect(state.getLevelHistory()
			.flatMap(entry => entry.decisions || [])
			.some(it => it.type === "nestedTool"))
			.toBe(false);

		const replayedFeature = addFeature(state);
		const [replayedChoice] = state.getPendingFeatureChoices();
		expect(replayedFeature._conditionalToolGrant.acquisitionFacts).toEqual({
			"Alchemist's Supplies|XPHB": true,
			"Herbalism Kit|XPHB": false,
		});
		expect(replayedFeature._conditionalToolGrant.selections).toEqual([]);
		expect(replayedChoice.count).toBe(1);
		expect(state.hasToolProficiency("Smith's Tools")).toBe(false);
	});

	test("does not activate the EFA rule for a TCE Alchemist feature", () => {
		const state = getState({source: "TCE"});
		const feature = addFeature(state, {
			source: "TCE",
			classSource: "TCE",
			subclassSource: "TCE",
		});

		expect(feature._conditionalToolGrant).toBeUndefined();
		expect(state.getToolProficiencies()).toEqual([]);
		expect(state.getPendingFeatureChoices()).toEqual([]);
		expect(state.getFeatureCalculations().craftingTimeModifiers || []).toEqual([]);
	});

	test("exposes an exact-source potion-only crafting modifier while the feature is active", () => {
		const state = getState();
		const feature = addFeature(state);

		expect(state.getCraftingTimeModifiers({recipe: {recipeCategory: "potion"}})).toEqual([expect.objectContaining({
			id: "efa-alchemist-tools-of-the-trade-potion-crafting",
			multiplier: 0.5,
			owner: expect.objectContaining({
				uid: "Tools of the Trade|Artificer|EFA|Alchemist|EFA|3|EFA",
			}),
		})]);
		expect(state.getCraftingTimeModifiers({recipe: {recipeCategory: "item"}})).toEqual([]);

		state.removeFeature(feature.id);
		expect(state.getCraftingTimeModifiers({recipe: {recipeCategory: "potion"}})).toEqual([]);
	});
});
