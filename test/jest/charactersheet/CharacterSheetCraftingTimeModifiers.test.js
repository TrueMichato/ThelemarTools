import fs from "node:fs";
import {jest} from "@jest/globals";

import "./setup.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-crafting.js";

const CharacterSheetState = globalThis.CharacterSheetState;
const CharacterSheetCrafting = globalThis.CharacterSheetCrafting;
const CRAFTING_DATA = JSON.parse(fs.readFileSync("data/crafting.json", "utf8"));
const CRAFTING_RECIPES = CRAFTING_DATA.craftingRecipe;

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

const REAL_ARMOR_RECIPE = CRAFTING_RECIPES.find(recipe => recipe.name === "+1 Dusk Armor" && recipe.source === "HHHVI");
const REAL_POTION_RECIPE = CRAFTING_RECIPES.find(recipe => recipe.name === "Dra-gone Paste" && recipe.source === "HHHVI");
const REAL_AMMUNITION_RECIPE = CRAFTING_RECIPES.find(recipe => recipe.name === "+1 Dragon Arrow" && recipe.source === "HHHVI");
const REAL_MELEE_WEAPON_RECIPE = CRAFTING_RECIPES.find(recipe => recipe.name === "Chain of Command" && recipe.source === "HHHVI");
const REAL_RANGED_WEAPON_RECIPE = CRAFTING_RECIPES.find(recipe => recipe.name === "Demon Cannon" && recipe.source === "HHHVIII");
const REAL_UNCOMMON_POTION_RECIPE = CRAFTING_RECIPES.find(recipe =>
	recipe.recipeCategory === "potion"
	&& recipe.rarity === "uncommon"
	&& recipe.value == null,
);
const REAL_DISH_RECIPE = CRAFTING_RECIPES.find(recipe => recipe.recipeCategory === "dish");
const REAL_MATERIAL = CRAFTING_DATA.craftingMaterial[0];

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

const addEfaBattleSmith = (state, {level = 3, classSource = "EFA", subclassSource = "EFA", subclassName = "Battle Smith"} = {}) => {
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

const addEfaAlchemist = (state, {classSource = "EFA", subclassSource = "EFA", featureSource = "EFA"} = {}) => {
	state.addClass({
		name: "Artificer",
		source: classSource,
		level: 3,
		subclass: {
			name: "Alchemist",
			shortName: "Alchemist",
			source: subclassSource,
			className: "Artificer",
			classSource,
		},
	});
	state.addFeature({
		name: "Tools of the Trade",
		source: featureSource,
		className: "Artificer",
		classSource,
		subclassShortName: "Alchemist",
		subclassSource,
		level: 3,
		isSubclassFeature: true,
		featureType: "Subclass",
		entries: [
			"You gain proficiency with {@item Alchemist's Supplies|XPHB} and the {@item Herbalism Kit|XPHB}. If you already have one of these proficiencies, you gain proficiency with one other type of {@item Artisan's Tools|XPHB} of your choice (or with two other types if you have both).",
		],
	});
	return state.getFeatures().find(feature => feature.name === "Tools of the Trade");
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

	describe("EFA Battle Smith weapon crafting", () => {
		it.each([
			["melee", REAL_MELEE_WEAPON_RECIPE, "M"],
			["ranged", REAL_RANGED_WEAPON_RECIPE, "R"],
		])("halves the value-less XDMG baseline for a real %s weapon recipe", (_label, recipe, itemType) => {
			expect(recipe).toMatchObject({itemType, recipeCategory: "item"});
			expect(recipe).not.toHaveProperty("value");

			const state = new CharacterSheetState();
			addEfaBattleSmith(state);
			const result = state.getCraftingTimeCalculation({recipe});

			expect(result.isSupported).toBe(true);
			expect(result.baselineSource).toMatchObject({
				type: "xdmg-rarity",
				source: "XDMG",
				page: 221,
				isConsumable: false,
			});
			expect(result.effectiveWorkweeks).toBe(result.baselineWorkweeks * 0.5);
			expect(result.sourceBreakdown).toEqual([{
				id: "efa-battle-smith-tools-of-the-trade-weapon-crafting",
				name: "Tools of the Trade",
				source: "EFA",
				uid: "Tools of the Trade|Artificer|EFA|Battle Smith|EFA|3|EFA",
				multiplier: 0.5,
			}]);
		});

		it.each([
			["armor", ARMOR_RECIPE, {type: "HA"}],
			["potion", {...ARMOR_RECIPE, recipeCategory: "potion", itemType: "P"}, {type: "P"}],
			["adventuring gear", {...ARMOR_RECIPE, itemType: "G"}, {type: "G"}],
		])("leaves nonweapon %s crafting unchanged", (_label, recipe, item) => {
			const state = new CharacterSheetState();
			addEfaBattleSmith(state);

			const result = calculate(state, {recipe, item});

			expect(result.effectiveWorkweeks).toBe(4);
			expect(result.sourceBreakdown).toEqual([]);
		});

		it("keeps ammunition on the XDMG consumable baseline without treating it as a weapon", () => {
			const state = new CharacterSheetState();
			addEfaBattleSmith(state);

			const result = state.getCraftingTimeCalculation({recipe: REAL_AMMUNITION_RECIPE});

			expect(result.baselineWorkweeks).toBe(1);
			expect(result.effectiveWorkweeks).toBe(1);
			expect(result.baselineSource).toMatchObject({
				type: "xdmg-rarity",
				isConsumable: true,
			});
			expect(result.sourceBreakdown).toEqual([]);
		});

		it.each([
			["below level 3", {level: 2}],
			["TCE class and subclass", {classSource: "TCE", subclassSource: "TCE"}],
			["EFA class with TCE subclass", {classSource: "EFA", subclassSource: "TCE"}],
			["TCE class with EFA subclass", {classSource: "TCE", subclassSource: "EFA"}],
			["another EFA subclass", {subclassName: "Alchemist"}],
		])("isolates the descriptor from %s", (_label, options) => {
			const state = new CharacterSheetState();
			addEfaBattleSmith(state, options);

			expect(state.getCraftingTimeCalculation({recipe: REAL_MELEE_WEAPON_RECIPE}).multiplier).toBe(1);
		});

		it("composes quantity and other generic descriptors before applying the stable product", () => {
			const state = new CharacterSheetState();
			addEfaBattleSmith(state);
			const battleSmithModifier = state.getFeatureCalculations().craftingTimeModifiers[0];
			const generalWeaponModifier = {
				id: "test-general-weapon-crafting",
				owner: {kind: "feature", name: "General Weapon Crafting", source: "TST", uid: "General Weapon Crafting|TST"},
				multiplier: 0.8,
				filter: {itemTypes: ["M", "R"]},
			};
			jest.spyOn(state, "getFeatureCalculations").mockReturnValue({
				craftingTimeModifiers: [battleSmithModifier, generalWeaponModifier],
			});

			const result = state.getCraftingTimeCalculation({
				baseWorkweeks: 10,
				quantity: 3,
				recipe: REAL_MELEE_WEAPON_RECIPE,
			});

			expect(result.baselineWorkweeks).toBe(30);
			expect(result.multiplier).toBeCloseTo(0.4);
			expect(result.effectiveWorkweeks).toBeCloseTo(12);
			expect(result.sourceBreakdown.map(it => it.id)).toEqual([
				"efa-battle-smith-tools-of-the-trade-weapon-crafting",
				"test-general-weapon-crafting",
			]);
		});

		it("re-derives the exact descriptor after save/load", () => {
			const original = new CharacterSheetState();
			addEfaBattleSmith(original);
			const restored = new CharacterSheetState();
			restored.loadFromJson(original.toJson());

			expect(restored.getCraftingTimeCalculation({recipe: REAL_RANGED_WEAPON_RECIPE}))
				.toEqual(original.getCraftingTimeCalculation({recipe: REAL_RANGED_WEAPON_RECIPE}));
			expect(restored.toJson()).not.toHaveProperty("craftingTimeModifiers");
		});
	});

	describe("source-grounded crafting baselines", () => {
		it("returns an explicit result for every generated typed armor and potion recipe", () => {
			const armorRecipes = CRAFTING_RECIPES.filter(recipe => ["LA", "MA", "HA"].includes(recipe.itemType?.split("|")[0]));
			const potionRecipes = CRAFTING_RECIPES.filter(recipe => recipe.recipeCategory === "potion");
			expect(armorRecipes).toHaveLength(40);
			expect(potionRecipes).toHaveLength(69);
			expect([...armorRecipes, ...potionRecipes].every(recipe => recipe.value == null)).toBe(true);

			const state = new CharacterSheetState();
			for (const recipe of [...armorRecipes, ...potionRecipes]) {
				const result = state.getCraftingTimeCalculation({recipe});
				expect(result).not.toBeNull();
				if (["common", "uncommon", "rare", "very rare", "legendary"].includes(recipe.rarity)) {
					expect(result.isSupported).toBe(true);
					expect(result.baselineWorkweeks).toBeGreaterThan(0);
				} else {
					expect(result.isSupported).toBe(false);
					expect(result.reason).toContain("XDMG p. 221 has no duration");
				}
			}
		});

		it.each([
			["common", 1],
			["uncommon", 2],
			["rare", 10],
			["very rare", 25],
			["legendary", 50],
		])("uses the XDMG armor baseline for %s recipes", (rarity, expectedWorkweeks) => {
			const state = new CharacterSheetState();
			const result = state.getCraftingTimeCalculation({
				recipe: {...REAL_ARMOR_RECIPE, rarity},
			});

			expect(result.isSupported).toBe(true);
			expect(result.baselineWorkweeks).toBe(expectedWorkweeks);
			expect(result.effectiveWorkweeks).toBe(expectedWorkweeks);
			expect(result.baselineSource).toMatchObject({
				type: "xdmg-rarity",
				source: "XDMG",
				page: 221,
				rarity,
				isConsumable: false,
			});
		});

		it.each([
			["common", 0.5],
			["uncommon", 1],
			["rare", 5],
			["very rare", 12.5],
			["legendary", 25],
		])("applies the XDMG consumable footnote to %s potions", (rarity, expectedWorkweeks) => {
			const state = new CharacterSheetState();
			const result = state.getCraftingTimeCalculation({
				recipe: {...REAL_POTION_RECIPE, rarity},
			});

			expect(result.isSupported).toBe(true);
			expect(result.baselineWorkweeks).toBe(expectedWorkweeks);
			expect(result.effectiveWorkweeks).toBe(expectedWorkweeks);
			expect(result.baselineSource).toMatchObject({
				type: "xdmg-rarity",
				source: "XDMG",
				page: 221,
				rarity,
				isConsumable: true,
			});
		});

		it("halves the uncommon baseline for a real generated ammunition recipe", () => {
			expect(REAL_AMMUNITION_RECIPE).toMatchObject({
				recipeCategory: "item",
				itemType: "A",
				rarity: "uncommon",
			});
			expect(REAL_AMMUNITION_RECIPE).not.toHaveProperty("value");

			const result = new CharacterSheetState().getCraftingTimeCalculation({recipe: REAL_AMMUNITION_RECIPE});

			expect(result.isSupported).toBe(true);
			expect(result.baselineWorkweeks).toBe(1);
			expect(result.effectiveWorkweeks).toBe(1);
			expect(result.baselineSource).toMatchObject({
				type: "xdmg-rarity",
				rarity: "uncommon",
				isConsumable: true,
			});
		});

		it("projects AF ammunition into the same non-scroll consumable rule", () => {
			const result = new CharacterSheetState().getCraftingTimeCalculation({
				recipe: {...REAL_AMMUNITION_RECIPE, name: "Synthetic Firearm Ammunition", itemType: "AF"},
			});

			expect(result.isSupported).toBe(true);
			expect(result.baselineWorkweeks).toBe(1);
			expect(result.baselineSource.isConsumable).toBe(true);
		});

		it("does not halve the baseline for ordinary gear", () => {
			const result = new CharacterSheetState().getCraftingTimeCalculation({
				recipe: {name: "Ordinary Magic Gear", recipeCategory: "item", itemType: "G", rarity: "uncommon"},
			});

			expect(result.isSupported).toBe(true);
			expect(result.baselineWorkweeks).toBe(2);
			expect(result.baselineSource.isConsumable).toBe(false);
		});

		it("keeps Spell Scrolls on their separate unsupported scribing path", () => {
			const result = new CharacterSheetState().getCraftingTimeCalculation({
				recipe: {name: "Spell Scroll", recipeCategory: "item", itemType: "SC", rarity: "uncommon"},
			});

			expect(result.isSupported).toBe(false);
			expect(result.reason).toContain("Spell Scrolls use the separate XPHB scribing table");
			expect(result.sourceBreakdown).toEqual([]);
			expect(result.modifiers).toEqual([]);
		});

		it("preserves explicit and value-derived precedence over the rarity fallback", () => {
			const state = new CharacterSheetState();
			const recipe = {...REAL_ARMOR_RECIPE, rarity: "legendary", value: 20_000};

			const valueDerived = state.getCraftingTimeCalculation({recipe});
			expect(valueDerived.baselineWorkweeks).toBe(4);
			expect(valueDerived.baselineSource.type).toBe("value");

			const explicit = state.getCraftingTimeCalculation({baseWorkweeks: 3, recipe});
			expect(explicit.baselineWorkweeks).toBe(3);
			expect(explicit.baselineSource.type).toBe("explicit");
		});

		it.each([
			["dish", REAL_DISH_RECIPE, "recipe category \"dish\""],
			["material", REAL_MATERIAL, "recipe category \"unknown\""],
		])("returns a clear unsupported result for an unrelated %s", (_label, recipe, expectedReason) => {
			const result = new CharacterSheetState().getCraftingTimeCalculation({recipe});

			expect(result.isSupported).toBe(false);
			expect(result.reason).toContain(expectedReason);
			expect(result).not.toHaveProperty("effectiveWorkweeks");
		});

		it("returns a clear unsupported result for unrecognized magic-item rarities", () => {
			const result = new CharacterSheetState().getCraftingTimeCalculation({
				recipe: {...REAL_ARMOR_RECIPE, rarity: "artifact"},
			});

			expect(result.isSupported).toBe(false);
			expect(result.reason).toContain("XDMG p. 221 has no duration for rarity \"artifact\"");
		});
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

		expect(restored.getCraftingTimeCalculation({recipe: REAL_ARMOR_RECIPE}))
			.toEqual(original.getCraftingTimeCalculation({recipe: REAL_ARMOR_RECIPE}));
		expect(restored.toJson()).not.toHaveProperty("craftingTimeModifiers");
	});

	it("drops the modifier immediately when its source class is removed", () => {
		const state = new CharacterSheetState();
		addEfaArmorer(state);
		expect(state.getCraftingTimeCalculation({recipe: REAL_ARMOR_RECIPE}).effectiveWorkweeks).toBe(5);

		state.removeClass("Artificer", "EFA");

		expect(state.getCraftingTimeCalculation({recipe: REAL_ARMOR_RECIPE}).effectiveWorkweeks).toBe(10);
	});

	it("halves a real generated value-less armor recipe", () => {
		expect(REAL_ARMOR_RECIPE).toMatchObject({itemType: "HA", rarity: "rare"});
		expect(REAL_ARMOR_RECIPE).not.toHaveProperty("value");

		const state = new CharacterSheetState();
		addEfaArmorer(state);
		const result = state.getCraftingTimeCalculation({recipe: REAL_ARMOR_RECIPE});

		expect(result.baselineWorkweeks).toBe(10);
		expect(result.effectiveWorkweeks).toBe(5);
		expect(result.sourceBreakdown[0].uid).toBe("Tools of the Trade|Artificer|EFA|Armorer|EFA|3|EFA");
	});

	it("halves a real generated value-less potion recipe for the exact EFA Alchemist feature", () => {
		expect(REAL_UNCOMMON_POTION_RECIPE).toMatchObject({recipeCategory: "potion", rarity: "uncommon"});
		expect(REAL_UNCOMMON_POTION_RECIPE).not.toHaveProperty("value");

		const state = new CharacterSheetState();
		addEfaAlchemist(state);
		const result = state.getCraftingTimeCalculation({recipe: REAL_UNCOMMON_POTION_RECIPE});

		expect(result.baselineWorkweeks).toBe(1);
		expect(result.effectiveWorkweeks).toBe(0.5);
		expect(result.multiplier).toBe(0.5);
		expect(result.sourceBreakdown).toEqual([expect.objectContaining({
			id: "efa-alchemist-tools-of-the-trade-potion-crafting",
			uid: "Tools of the Trade|Artificer|EFA|Alchemist|EFA|3|EFA",
		})]);
	});

	it("leaves a real generated item recipe unchanged for the EFA Alchemist", () => {
		const state = new CharacterSheetState();
		addEfaAlchemist(state);
		const result = state.getCraftingTimeCalculation({recipe: REAL_ARMOR_RECIPE});

		expect(result.baselineWorkweeks).toBe(10);
		expect(result.effectiveWorkweeks).toBe(10);
		expect(result.sourceBreakdown).toEqual([]);
	});

	it("drops the Alchemist modifier when the exact source feature is removed", () => {
		const state = new CharacterSheetState();
		const feature = addEfaAlchemist(state);
		expect(state.getCraftingTimeCalculation({recipe: REAL_UNCOMMON_POTION_RECIPE}).effectiveWorkweeks).toBe(0.5);

		state.removeFeature(feature.id);

		expect(state.getCraftingTimeCalculation({recipe: REAL_UNCOMMON_POTION_RECIPE}).effectiveWorkweeks).toBe(1);
	});

	it.each([
		["TCE class", {classSource: "TCE"}],
		["TCE subclass", {subclassSource: "TCE"}],
		["TCE same-named feature", {featureSource: "TCE"}],
	])("does not apply the Alchemist modifier for a %s", (_label, sources) => {
		const state = new CharacterSheetState();
		addEfaAlchemist(state, sources);

		const result = state.getCraftingTimeCalculation({recipe: REAL_UNCOMMON_POTION_RECIPE});
		expect(result.baselineWorkweeks).toBe(1);
		expect(result.effectiveWorkweeks).toBe(1);
		expect(result.sourceBreakdown).toEqual([]);
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
		state.addItem({name: "Young Shadow Dragon Scale", source: "HHHVI", type: "G", _isCraftingMaterial: true}, 1);

		const page = {
			getItems: () => [{name: "+1 Dusk Armor", source: "HHHVI", type: "HA", rarity: "rare"}],
			saveCharacter: jest.fn(),
			_inventory: {render: jest.fn()},
		};
		const crafting = new CharacterSheetCrafting(page, state);
		const modal = jest.spyOn(crafting, "_pThreeWay")
			.mockResolvedValueOnce("primary")
			.mockResolvedValueOnce("primary");

		await crafting.pCommitCraft(REAL_ARMOR_RECIPE, null);

		const confirmationHtml = modal.mock.calls[0][0].html;
		const outcomeHtml = modal.mock.calls[1][0].html;
		for (const html of [confirmationHtml, outcomeHtml]) {
			expect(html).toContain("5 workweeks");
			expect(html).toContain("baseline");
			expect(html).toContain("10 workweeks");
			expect(html).toContain("XDMG p. 221");
			expect(html).toContain("Rare magic item");
			expect(html).toContain("Tools of the Trade [EFA] \u00d70.5");
		}
	});

	it("renders one shared fractional Alchemist duration in confirmation and committed outcome", async () => {
		const state = new CharacterSheetState();
		addEfaAlchemist(state);

		const page = {
			getItems: () => [{
				name: REAL_UNCOMMON_POTION_RECIPE.name,
				source: REAL_UNCOMMON_POTION_RECIPE.source,
				type: REAL_UNCOMMON_POTION_RECIPE.itemType || "P",
				rarity: REAL_UNCOMMON_POTION_RECIPE.rarity,
			}],
			saveCharacter: jest.fn(),
			_inventory: {render: jest.fn()},
		};
		const crafting = new CharacterSheetCrafting(page, state);
		const modal = jest.spyOn(crafting, "_pThreeWay")
			.mockResolvedValueOnce("secondary")
			.mockResolvedValueOnce("primary");

		await crafting.pCommitCraft(REAL_UNCOMMON_POTION_RECIPE, null);

		const confirmationHtml = modal.mock.calls[0][0].html;
		const outcomeHtml = modal.mock.calls[1][0].html;
		for (const html of [confirmationHtml, outcomeHtml]) {
			expect(html).toContain("½ workweeks");
			expect(html).toContain("baseline");
			expect(html).toContain("1 workweek");
			expect(html).toContain("XDMG p. 221");
			expect(html).toContain("Tools of the Trade [EFA] \u00d70.5");
		}
	});

	it("surfaces the same unsupported reason in preview and outcome instead of returning null", () => {
		const state = new CharacterSheetState();
		const page = {getItems: () => []};
		const crafting = new CharacterSheetCrafting(page, state);
		const recipe = {name: "Mystery Dish", source: "TST", recipeCategory: "dish", rarity: "rare"};

		const result = crafting._getCraftingTime(recipe);
		expect(result).not.toBeNull();
		expect(result.isSupported).toBe(false);

		const preview = CharacterSheetCrafting._getCraftingTimeListItems(result);
		const outcome = CharacterSheetCrafting._getCraftingTimeOutcomeText(result);
		expect(preview).toContain(result.reason);
		expect(outcome).toContain(result.reason);
	});
});
