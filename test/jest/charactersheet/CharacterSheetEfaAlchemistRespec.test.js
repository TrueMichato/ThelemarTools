import "./setup.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-progression.js";
import "../../../js/charactersheet/charactersheet-respec.js";

let CharacterSheetState;
let CharacterSheetRespec;

beforeAll(async () => {
	CharacterSheetState = (await import("../../../js/charactersheet/charactersheet-state.js")).CharacterSheetState;
	CharacterSheetRespec = globalThis.CharacterSheetRespec;
});

const TOOLS_OF_THE_TRADE = {
	name: "Tools of the Trade",
	source: "EFA",
	className: "Artificer",
	classSource: "EFA",
	subclassShortName: "Alchemist",
	subclassSource: "EFA",
	level: 3,
	entries: [
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

const ALCHEMIST = {
	name: "Alchemist",
	shortName: "Alchemist",
	source: "EFA",
	subclassFeatures: ["Tools of the Trade|Artificer|EFA|Alchemist|EFA|3|EFA"],
};
const ARTILLERIST = {
	name: "Artillerist",
	shortName: "Artillerist",
	source: "EFA",
	subclassFeatures: [],
};

const makeRespec = state => {
	const respec = Object.create(CharacterSheetRespec.prototype);
	respec._state = state;
	respec._page = {
		getSubclassFeatures: () => [TOOLS_OF_THE_TRADE],
		getClassFeatures: () => [],
		getClasses: () => state.getClasses(),
		filterByAllowedSources: arr => arr,
	};
	respec._$timeline = null;
	respec._$legacyBadge = null;
	return respec;
};

const makeState = () => {
	const state = new CharacterSheetState();
	state.addClass({
		name: "Artificer",
		source: "EFA",
		level: 3,
		subclass: {name: "Alchemist", shortName: "Alchemist", source: "EFA"},
	});
	for (let level = 1; level <= 3; ++level) {
		state.recordLevelChoice({
			level,
			class: {name: "Artificer", source: "EFA"},
			choices: level === 3 ? {subclass: ALCHEMIST} : {},
			complete: true,
		});
	}
	state.addToolProficiency("Alchemist's Supplies");
	state.addToolProficiency("Herbalism Kit");
	state.addFeature({...TOOLS_OF_THE_TRADE, isSubclassFeature: true, featureType: "Subclass"});
	const [choice] = state.getPendingFeatureChoices();
	state.fulfillFeatureChoice(choice.id, ["Smith's Tools", "Tinker's Tools"]);
	return state;
};

describe("EFA Alchemist respec lifecycle", () => {
	test("replaces the exact progression-owned tool pair and synchronizes runtime feature metadata", () => {
		const state = makeState();
		const respec = makeRespec(state);
		const decision = state.getLevelHistory()
			.flatMap(entry => entry.decisions || [])
			.find(it => it.type === "nestedTool");

		respec._applyManifestSelectionMechanics(
			decision,
			["Mason's Tools", "Potter's Tools"],
			["Mason's Tools", "Potter's Tools"],
		);

		expect(state.hasToolProficiency("Smith's Tools")).toBe(false);
		expect(state.hasToolProficiency("Tinker's Tools")).toBe(false);
		expect(state.hasToolProficiency("Mason's Tools")).toBe(true);
		expect(state.hasToolProficiency("Potter's Tools")).toBe(true);
		const feature = state.getFeatures().find(it => it.name === "Tools of the Trade");
		expect(feature._conditionalToolGrant.selections).toEqual(["Mason's Tools", "Potter's Tools"]);
		expect(feature.choices.tools).toEqual(["Mason's Tools", "Potter's Tools"]);
	});

	test("removes source-owned fixed/replacement effects and replays acquisition-time duplicate choices", async () => {
		const state = makeState();
		const respec = makeRespec(state);
		const history = state.getLevelHistory().find(it => it.level === 3);

		await respec._applySubclassChange(3, history, ALCHEMIST, ARTILLERIST);

		expect(state.hasToolProficiency("Alchemist's Supplies")).toBe(true);
		expect(state.hasToolProficiency("Herbalism Kit")).toBe(true);
		expect(state.hasToolProficiency("Smith's Tools")).toBe(false);
		expect(state.hasToolProficiency("Tinker's Tools")).toBe(false);
		expect(state.getCraftingTimeModifiers({recipe: {recipeCategory: "potion"}})).toEqual([]);

		await respec._applySubclassChange(3, history, ARTILLERIST, ALCHEMIST);

		const feature = state.getFeatures().find(it => it.name === "Tools of the Trade");
		expect(feature._conditionalToolGrant.acquisitionFacts).toEqual({
			"Alchemist's Supplies|XPHB": true,
			"Herbalism Kit|XPHB": true,
		});
		expect(state.getPendingFeatureChoices()).toEqual([
			expect.objectContaining({kind: "tool", count: 2, unique: true}),
		]);
		expect(state.getCraftingTimeModifiers({recipe: {recipeCategory: "potion"}})).toEqual([
			expect.objectContaining({multiplier: 0.5}),
		]);
	});
});
