import {jest} from "@jest/globals";

import "./setup.js";
import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-crafting.js";

const CharacterSheetState = globalThis.CharacterSheetState;
const CharacterSheetCrafting = globalThis.CharacterSheetCrafting;

if (!String.prototype.qq) {
	Object.defineProperty(String.prototype, "qq", {
		configurable: true,
		value () { return `${this}`; },
	});
}

const ARMOR_RECIPE = {
	name: "Plate Armor",
	source: "PHB",
	recipeCategory: "item",
	itemUid: "plate armor|phb",
	itemType: "HA",
	value: 20_000,
	ingredients: [],
	entries: [],
};

const MAGIC_ARMOR_RECIPE = {
	...ARMOR_RECIPE,
	name: "Dragonplate Armor",
	source: "COMCRAF",
	itemUid: "dragonplate armor|comcraf",
	rarity: "very rare",
};

const addEfaArmorer = (state, {level = 3, classSource = "EFA", subclassSource = "EFA", subclassName = "Armorer"} = {}) => {
	state.addClass({
		name: "Artificer",
		source: classSource,
		level,
		subclass: {
			name: subclassName,
			shortName: subclassName,
			source: subclassSource,
			className: "Artificer",
			classSource,
		},
	});
};

const calculate = (state, {
	recipe = ARMOR_RECIPE,
	item = {name: recipe.name, source: recipe.source, type: recipe.itemType},
	baseWorkweeks = 4,
	quantity = 1,
} = {}) => state.getCraftingTimeCalculation({baseWorkweeks, quantity, recipe, item});

describe("Character Sheet crafting-time modifiers", () => {
	afterEach(() => jest.restoreAllMocks());

	it("keeps baseline armor crafting time without a contributing feature", () => {
		const result = calculate(new CharacterSheetState());

		expect(result.baselineWorkweeks).toBe(4);
		expect(result.effectiveWorkweeks).toBe(4);
		expect(result.multiplier).toBe(1);
		expect(result.sourceBreakdown).toEqual([]);
	});

	it("halves armor crafting time for an EFA Armorer at level 3", () => {
		const state = new CharacterSheetState();
		addEfaArmorer(state);

		const result = calculate(state);

		expect(result.effectiveWorkweeks).toBe(2);
		expect(result.multiplier).toBe(0.5);
		expect(result.sourceBreakdown).toEqual([{
			id: "efa-armorer-tools-of-the-trade-armor-crafting",
			name: "Tools of the Trade",
			source: "EFA",
			uid: "Tools of the Trade|Artificer|EFA|Armorer|EFA|3|EFA",
			multiplier: 0.5,
		}]);
	});

	it("uses the same armor taxonomy for magic armor", () => {
		const state = new CharacterSheetState();
		addEfaArmorer(state);

		const result = calculate(state, {
			recipe: MAGIC_ARMOR_RECIPE,
			item: null,
		});

		expect(result.effectiveWorkweeks).toBe(2);
		expect(result.sourceBreakdown[0].name).toBe("Tools of the Trade");
	});

	it.each([
		["weapon", {recipeCategory: "item", itemType: "M"}, {type: "M"}],
		["potion", {recipeCategory: "potion", itemType: "P"}, {type: "P"}],
		["adventuring gear", {recipeCategory: "item", itemType: "G"}, {type: "G"}],
		["shield", {recipeCategory: "item", itemType: "S"}, {type: "S"}],
	])("leaves %s crafting time unchanged", (_label, recipeOver, item) => {
		const state = new CharacterSheetState();
		addEfaArmorer(state);

		const result = calculate(state, {recipe: {...ARMOR_RECIPE, ...recipeOver}, item});

		expect(result.effectiveWorkweeks).toBe(4);
		expect(result.sourceBreakdown).toEqual([]);
	});

	it.each([
		["below level 3", {level: 2}],
		["TCE class and subclass", {classSource: "TCE", subclassSource: "TCE"}],
		["EFA class with TCE subclass", {classSource: "EFA", subclassSource: "TCE"}],
		["another EFA subclass", {subclassName: "Alchemist"}],
	])("isolates the contribution from %s", (_label, options) => {
		const state = new CharacterSheetState();
		addEfaArmorer(state, options);

		expect(calculate(state).multiplier).toBe(1);
	});

	it("composes quantity before applying the feature multiplier", () => {
		const state = new CharacterSheetState();
		addEfaArmorer(state);

		const result = calculate(state, {baseWorkweeks: 4, quantity: 3});

		expect(result.baselineWorkweeks).toBe(12);
		expect(result.effectiveWorkweeks).toBe(6);
	});

	it("derives the modifier after save/load without persisting duplicate mechanic state", () => {
		const original = new CharacterSheetState();
		addEfaArmorer(original);

		const restored = new CharacterSheetState();
		restored.loadFromJson(original.toJson());

		expect(calculate(restored)).toEqual(calculate(original));
		expect(restored.toJson()).not.toHaveProperty("craftingTimeModifiers");
	});

	it("drops the modifier immediately when its source class is removed", () => {
		const state = new CharacterSheetState();
		addEfaArmorer(state);
		expect(calculate(state).multiplier).toBe(0.5);

		state.removeClass("Artificer", "EFA");

		expect(calculate(state).multiplier).toBe(1);
	});

	it("lets a second generic descriptor target potions without Armorer-specific code", () => {
		const state = new CharacterSheetState();
		addEfaArmorer(state);
		const armorerModifier = state.getFeatureCalculations().craftingTimeModifiers[0];
		const potionModifier = {
			id: "test-alchemist-tools-of-the-trade-potions",
			owner: {
				kind: "subclassFeature",
				name: "Tools of the Trade",
				source: "EFA",
				uid: "Tools of the Trade|Artificer|EFA|Alchemist|EFA|3|EFA",
			},
			multiplier: 0.5,
			filter: {recipeCategories: ["potion"]},
		};
		jest.spyOn(state, "getFeatureCalculations").mockReturnValue({
			craftingTimeModifiers: [armorerModifier, potionModifier],
		});

		const result = calculate(state, {
			recipe: {...ARMOR_RECIPE, recipeCategory: "potion", itemType: "P"},
			item: {type: "P"},
		});

		expect(result.multiplier).toBe(0.5);
		expect(result.sourceBreakdown.map(it => it.uid)).toEqual([potionModifier.owner.uid]);
	});

	it("composes matching descriptors in stable id order", () => {
		const state = new CharacterSheetState();
		const modifiers = [
			{
				id: "z-half",
				owner: {kind: "feature", name: "Z Half", source: "TST", uid: "Z Half|TST"},
				multiplier: 0.5,
				filter: {recipeCategories: ["potion"]},
			},
			{
				id: "a-four-fifths",
				owner: {kind: "feature", name: "A Four Fifths", source: "TST", uid: "A Four Fifths|TST"},
				multiplier: 0.8,
				filter: {recipeCategories: ["potion"]},
			},
		];
		jest.spyOn(state, "getFeatureCalculations").mockReturnValue({craftingTimeModifiers: modifiers});

		const result = calculate(state, {
			recipe: {...ARMOR_RECIPE, recipeCategory: "potion", itemType: "P"},
			item: {type: "P"},
			baseWorkweeks: 10,
		});

		expect(result.multiplier).toBeCloseTo(0.4);
		expect(result.effectiveWorkweeks).toBeCloseTo(4);
		expect(result.sourceBreakdown.map(it => it.id)).toEqual(["a-four-fifths", "z-half"]);
	});

	it("rejects zero/invalid durations and modifier values explicitly", () => {
		const state = new CharacterSheetState();
		expect(() => calculate(state, {baseWorkweeks: 0})).toThrow(RangeError);
		expect(() => calculate(state, {quantity: 0})).toThrow(RangeError);

		jest.spyOn(state, "getFeatureCalculations").mockReturnValue({
			craftingTimeModifiers: [{
				id: "invalid-zero",
				owner: {kind: "feature", name: "Invalid", source: "TST", uid: "Invalid|TST"},
				multiplier: 0,
				filter: {recipeCategories: ["item"]},
			}],
		});
		expect(() => calculate(state)).toThrow(RangeError);
	});

	it("rejects duplicate descriptor ids instead of double-applying them", () => {
		const state = new CharacterSheetState();
		const duplicate = {
			id: "duplicate-id",
			owner: {kind: "feature", name: "Duplicate", source: "TST", uid: "Duplicate|TST"},
			multiplier: 0.5,
			filter: {itemTypes: ["HA"]},
		};
		jest.spyOn(state, "getFeatureCalculations").mockReturnValue({
			craftingTimeModifiers: [duplicate, {...duplicate, owner: {...duplicate.owner, uid: "Other Duplicate|TST"}}],
		});

		expect(() => calculate(state)).toThrow(TypeError);
	});

	it("renders the same effective time and source in confirmation and outcome", async () => {
		const state = new CharacterSheetState();
		addEfaArmorer(state);
		state.addItem({name: "Dragon Bone", source: "COMCRAF", type: "G", _isCraftingMaterial: true}, 1);

		const page = {
			getItems: () => [{name: "Dragonplate Armor", source: "COMCRAF", type: "HA", rarity: "very rare"}],
			saveCharacter: jest.fn(),
			_inventory: {render: jest.fn()},
		};
		const crafting = new CharacterSheetCrafting(page, state);
		const modal = jest.spyOn(crafting, "_pThreeWay")
			.mockResolvedValueOnce("primary")
			.mockResolvedValueOnce("primary");
		const recipe = {
			...MAGIC_ARMOR_RECIPE,
			ingredients: [{name: "Dragon Bone", quantity: 1}],
		};

		await crafting.pCommitCraft(recipe, null);

		const confirmationHtml = modal.mock.calls[0][0].html;
		const outcomeHtml = modal.mock.calls[1][0].html;
		for (const html of [confirmationHtml, outcomeHtml]) {
			expect(html).toContain("2 workweeks");
			expect(html).toContain("baseline");
			expect(html).toContain("4 workweeks");
			expect(html).toContain("Tools of the Trade [EFA] \u00d70.5");
		}
	});
});
