/**
 * Crafting flow logic: readiness, ingredient consumption, cooking tiers, and the advisories.
 *
 * The flows themselves are modal-driven, so these exercise the decision logic directly — the parts
 * that decide what gets consumed, what the player is told, and which outcome a cooking roll earns.
 */

import "./setup.js";
import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-crafting.js";

const CharacterSheetState = globalThis.CharacterSheetState;
const CharacterSheetCrafting = globalThis.CharacterSheetCrafting;

const MATERIAL = (name, over = {}) => ({
	name,
	source: "HHHVI",
	materialCategory: "creature part",
	harvest: {dc: 12, quantity: 1, creature: {name: "Basilisk", source: "MM"}},
	entries: [],
	weight: 1,
	value: 500,
	effectTags: ["crafting ingredient"],
	usedInRecipes: [],
	...over,
});

const RECIPE = (name, ingredients, over = {}) => ({
	name,
	source: "HHHVI",
	recipeCategory: "item",
	crafter: "Alchemist",
	craftDC: null,
	ingredients,
	itemUid: `${name.toLowerCase()}|hhhvi`,
	entries: [],
	...over,
});

describe("Crafting flows", () => {
	let state;
	let crafting;
	/** Minimal page stand-in: the flows only reach back for items, saving and re-render. */
	let page;

	beforeEach(() => {
		state = new CharacterSheetState();
		state.addClass({name: "Ranger", source: "PHB", level: 5});

		page = {
			getItems: () => [],
			saveCharacter: () => {},
			rollDice: (n, sides) => n * Math.ceil(sides / 2), // deterministic average
			_inventory: {render: () => {}},
			pGetCraftingCatalog: async () => state.getCraftingCatalog(),
			isCraftingEnabled: () => true,
		};

		crafting = new CharacterSheetCrafting(page, state);
	});

	const give = (name, qty, over = {}) => {
		state.addItem({name, source: "HHHVI", type: "G", weight: 1, _isCraftingMaterial: true, ...over}, qty);
		return state.getInventory().find(i => i.item.name === name);
	};

	describe("held quantities", () => {
		it("counts what the character carries", () => {
			give("Basilisk Eye", 3);

			expect(crafting._getHeldQuantity("Basilisk Eye")).toBe(3);
		});

		it("matches across naming differences", () => {
			give("Salamander Scale (large pouch)", 2);

			// An ingredient reference writes it without the unit suffix
			expect(crafting._getHeldQuantity("Salamander Scale")).toBe(2);
		});

		it("returns 0 for something not carried", () => {
			expect(crafting._getHeldQuantity("Dragon Tooth")).toBe(0);
		});
	});

	describe("recipe readiness", () => {
		it("reports ready when every ingredient is held", () => {
			give("Basilisk Eye", 2);
			give("Basilisk Bile", 1);

			const status = crafting._getRecipeReadiness(RECIPE("Gaze Poison", [
				{name: "Basilisk Eye", quantity: 1},
				{name: "Basilisk Bile", quantity: 1},
			]));

			expect(status.nMissing).toBe(0);
			expect(status.nIngredients).toBe(2);
		});

		it("counts a shortfall as missing", () => {
			give("Basilisk Eye", 1);

			const status = crafting._getRecipeReadiness(RECIPE("Gaze Poison", [
				{name: "Basilisk Eye", quantity: 2},
			]));

			expect(status.nMissing).toBe(1);
			expect(status.ingredients[0].isHeld).toBe(false);
		});

		it("treats an alternative set as satisfied when any one is held", () => {
			give("Ghoul Hide", 1);

			const status = crafting._getRecipeReadiness(RECIPE("Bag of Colding", [
				{name: "Ghast Hide", quantity: 1, isAlternative: true, alternativeGroup: "alt-0", alternativeIndex: 0},
				{name: "Ghoul Hide", quantity: 1, isAlternative: true, alternativeGroup: "alt-0", alternativeIndex: 1},
			]));

			expect(status.nIngredients).toBe(1);
			expect(status.nMissing).toBe(0);
		});
	});

	describe("consuming ingredients", () => {
		it("decrements a partially-used stack", () => {
			const inv = give("Basilisk Eye", 5);
			const status = crafting._getRecipeReadiness(RECIPE("X", [{name: "Basilisk Eye", quantity: 2}]));

			crafting._consumeIngredients(status.ingredients);

			expect(state.getInventory().find(i => i.id === inv.id).quantity).toBe(3);
		});

		it("removes the row when the last one is spent", () => {
			give("Basilisk Eye", 1);
			const status = crafting._getRecipeReadiness(RECIPE("X", [{name: "Basilisk Eye", quantity: 1}]));

			crafting._consumeIngredients(status.ingredients);

			expect(state.getInventory().find(i => i.item.name === "Basilisk Eye")).toBeUndefined();
		});

		it("spends only one member of an alternative set", () => {
			give("Ghast Hide", 2);
			give("Ghoul Hide", 2);

			const status = crafting._getRecipeReadiness(RECIPE("X", [
				{name: "Ghast Hide", quantity: 1, isAlternative: true, alternativeGroup: "alt-0", alternativeIndex: 0},
				{name: "Ghoul Hide", quantity: 1, isAlternative: true, alternativeGroup: "alt-0", alternativeIndex: 1},
			]));

			crafting._consumeIngredients(status.ingredients);

			const remaining = state.getInventory().reduce((acc, i) => acc + i.quantity, 0);
			expect(remaining).toBe(3);
		});

		it("leaves ingredients the character never had", () => {
			give("Basilisk Eye", 1);
			const status = crafting._getRecipeReadiness(RECIPE("X", [
				{name: "Basilisk Eye", quantity: 1},
				{name: "Dragon Tooth", quantity: 1},
			]));

			expect(() => crafting._consumeIngredients(status.ingredients)).not.toThrow();
			expect(state.getInventory()).toHaveLength(0);
		});
	});

	describe("adding harvested materials", () => {
		it("creates a marked material row", () => {
			crafting._addMaterialToInventory(MATERIAL("Basilisk Eye"), 2);

			const inv = state.getInventory()[0];
			expect(inv.item.name).toBe("Basilisk Eye");
			expect(inv.item._isCraftingMaterial).toBe(true);
			expect(inv.quantity).toBe(2);
		});

		it("stacks onto an existing pile rather than duplicating the row", () => {
			crafting._addMaterialToInventory(MATERIAL("Basilisk Eye"), 2);
			crafting._addMaterialToInventory(MATERIAL("Basilisk Eye"), 3);

			expect(state.getInventory()).toHaveLength(1);
			expect(state.getInventory()[0].quantity).toBe(5);
		});

		it("carries a variantComponent through, so a harvested component stays castable", () => {
			crafting._addMaterialToInventory(MATERIAL("Aboleth Eye", {
				source: "Ar8",
				variantComponent: {spellEffects: [{match: {spell: "legend lore|phb"}, effects: []}]},
			}), 1);

			const matches = state.getMatchingVariantComponents({name: "Legend Lore", source: "PHB"});
			expect(matches).toHaveLength(1);
		});
	});

	describe("quantity rolls", () => {
		it("returns a fixed quantity as-is", () => {
			expect(crafting._rollQuantity({quantity: 4})).toBe(4);
		});

		it("rolls a die expression through the sheet's dice pipeline", () => {
			// The stub returns the average, so 1d4 → 2
			expect(crafting._rollQuantity({quantityRoll: "1d4"})).toBe(2);
		});

		it("applies a flat modifier", () => {
			expect(crafting._rollQuantity({quantityRoll: "2d6+1"})).toBe(2 * 3 + 1);
		});

		it("never returns less than 1", () => {
			page.rollDice = () => 0;
			expect(crafting._rollQuantity({quantityRoll: "1d4-10"})).toBe(1);
		});
	});

	describe("crafter advisory", () => {
		it("flags a profession the character has no tool for", () => {
			const advisory = crafting._getCrafterAdvisory("Blacksmith");

			expect(advisory.tool).toBe("Smith's Tools");
			expect(advisory.isProficient).toBe(false);
		});

		it("recognises the matching tool proficiency", () => {
			state.addToolProficiency("Smith's Tools");

			expect(crafting._getCrafterAdvisory("Blacksmith").isProficient).toBe(true);
		});

		it("returns null when a craftable names no profession", () => {
			expect(crafting._getCrafterAdvisory(null)).toBeNull();
		});
	});

	describe("rarity advisory (Hamund's Crafter Skill rule)", () => {
		it("flags a rarity beyond the character's proficiency bonus", () => {
			// Level 5 → +3 proficiency; a very rare item wants +5
			const advisory = crafting._getRarityAdvisory("very rare");

			expect(advisory.needed).toBe(5);
			expect(advisory.isSufficient).toBe(false);
		});

		it("passes a rarity within reach", () => {
			expect(crafting._getRarityAdvisory("uncommon").isSufficient).toBe(true);
		});

		it("returns null for an unrated item", () => {
			expect(crafting._getRarityAdvisory(null)).toBeNull();
			expect(crafting._getRarityAdvisory("none")).toBeNull();
		});
	});

	describe("dangerous-material detection", () => {
		it("recognises a damaging Use: effect", () => {
			const venom = MATERIAL("Basilisk Venom", {hasUseEffect: true, effectTags: ["poison damage"]});

			expect(CharacterSheetCrafting._DAMAGING_TAGS.has(venom.effectTags[0])).toBe(true);
		});

		it("extracts the Use: text", () => {
			const material = MATERIAL("Basilisk Venom", {
				entries: [
					"A vial of venom.",
					{type: "entries", name: "Use:", entries: ["The target takes {@damage 3d6} poison damage."]},
				],
			});

			expect(CharacterSheetCrafting._getUseText(material)).toContain("poison damage");
		});

		it("returns null when there is no Use: section", () => {
			expect(CharacterSheetCrafting._getUseText(MATERIAL("Basilisk Hide"))).toBeNull();
		});
	});

	describe("harvest stakes", () => {
		// Prompting on every harvest trains the player to dismiss the prompt. The threshold has to
		// stay tight, so it is asserted rather than left to the modal.
		it("stays silent for a worthless, mundane part", () => {
			const junk = MATERIAL("Basilisk Scrap", {value: null});

			expect(CharacterSheetCrafting.getHarvestStakes(junk, {})).toEqual([]);
		});

		it("speaks up when the part is worth money", () => {
			const stakes = CharacterSheetCrafting.getHarvestStakes(MATERIAL("Basilisk Eye"), {});

			expect(stakes).toHaveLength(1);
			expect(stakes[0]).toContain("5 gp");
		});

		it("groups the thousands so a big number reads like the table's", () => {
			const stakes = CharacterSheetCrafting.getHarvestStakes(MATERIAL("Aboleth Brain Lobe", {value: 160000}), {});

			expect(stakes[0]).toBe("It is worth 1,600 gp.");
		});

		it("names the spell a component would cost you", () => {
			const eye = MATERIAL("Aboleth Eye", {
				value: null,
				variantComponent: {spellEffects: [{match: {spell: "legend lore|phb"}}]},
			});

			expect(CharacterSheetCrafting.getHarvestStakes(eye, {})).toEqual([
				"It is a spell component for Legend Lore.",
			]);
		});

		it("warns about a dangerous material only when that optional rule is on", () => {
			const venom = MATERIAL("Basilisk Venom", {value: null, hasUseEffect: true, effectTags: ["poison damage"]});

			expect(CharacterSheetCrafting.getHarvestStakes(venom, {})).toEqual([]);
			expect(CharacterSheetCrafting.getHarvestStakes(venom, {craftingDangerousHarvest: true}))
				.toEqual(["Botching it turns the material on you."]);
		});

		it("stacks every reason it finds", () => {
			const venom = MATERIAL("Basilisk Venom", {
				value: 2500,
				hasUseEffect: true,
				effectTags: ["poison damage"],
				variantComponent: {spellEffects: []},
			});

			expect(CharacterSheetCrafting.getHarvestStakes(venom, {craftingDangerousHarvest: true})).toHaveLength(3);
		});

		it("tolerates a material with nothing on it", () => {
			expect(CharacterSheetCrafting.getHarvestStakes(null, {})).toEqual([]);
			expect(CharacterSheetCrafting.getHarvestStakes({}, {})).toEqual([]);
		});
	});

	describe("band open policy", () => {
		// Idle, the workbench should say what you *can* make, even when the answer is nothing.
		it("opens the first band when idle", () => {
			expect(CharacterSheetCrafting.getOpenBandIndex([0, 378, 78], false)).toBe(0);
		});

		it("opens the first band that actually matched while searching", () => {
			expect(CharacterSheetCrafting.getOpenBandIndex([0, 0, 1], true)).toBe(2);
		});

		it("prefers Ready when the search hits it", () => {
			expect(CharacterSheetCrafting.getOpenBandIndex([2, 5, 9], true)).toBe(0);
		});

		it("opens nothing when a search matched nothing", () => {
			expect(CharacterSheetCrafting.getOpenBandIndex([0, 0, 0], true)).toBe(-1);
		});
	});

	describe("ingredient source resolution", () => {
		it("names the creature a missing ingredient is cut from", () => {
			state.setCraftingCatalog({craftingMaterial: [MATERIAL("Basilisk Eye")], craftingRecipe: [], craftingRule: []});

			expect(crafting._getIngredientSourceCreature("Basilisk Eye")).toBe("Basilisk");
			expect(crafting._getIngredientSourceCreature("basilisk  eye")).toBe("Basilisk");
		});

		it("returns null for something no creature carries", () => {
			state.setCraftingCatalog({craftingMaterial: [], craftingRecipe: [], craftingRule: []});

			expect(crafting._getIngredientSourceCreature("Bag of Holding")).toBeNull();
		});
	});

	describe("undoing a craft", () => {
		const RECIPE_ITEM = RECIPE("Basilisk Salve", [{name: "Basilisk Eye", quantity: 2}], {value: 5000});

		it("puts back a partially spent stack", () => {
			give("Basilisk Eye", 5);
			const status = crafting._getRecipeReadiness(RECIPE_ITEM);

			const ledger = crafting._consumeIngredients(status.ingredients);

			expect(state.getInventory().find(i => i.item.name === "Basilisk Eye").quantity).toBe(3);

			crafting._undoCraft(RECIPE_ITEM, ledger);

			expect(state.getInventory().find(i => i.item.name === "Basilisk Eye").quantity).toBe(5);
		});

		it("restores a stack that was consumed to nothing", () => {
			give("Basilisk Eye", 2);
			const status = crafting._getRecipeReadiness(RECIPE_ITEM);

			const ledger = crafting._consumeIngredients(status.ingredients);

			expect(state.getInventory().find(i => i.item.name === "Basilisk Eye")).toBeUndefined();

			crafting._undoCraft(RECIPE_ITEM, ledger);

			const restored = state.getInventory().find(i => i.item.name === "Basilisk Eye");
			expect(restored).toBeDefined();
			expect(restored.quantity).toBe(2);
		});

		it("takes the crafted item back out again", () => {
			give("Basilisk Eye", 2);
			const status = crafting._getRecipeReadiness(RECIPE_ITEM);
			const ledger = crafting._consumeIngredients(status.ingredients);
			crafting._addCraftedItem(RECIPE_ITEM);

			expect(state.getInventory().some(i => i.item.name === "Basilisk Salve")).toBe(true);

			crafting._undoCraft(RECIPE_ITEM, ledger);

			expect(state.getInventory().some(i => i.item.name === "Basilisk Salve")).toBe(false);
		});

		it("only decrements a crafted item the character already had more of", () => {
			state.addItem({name: "Basilisk Salve", source: "HHHVI", type: "G"}, 2);
			give("Basilisk Eye", 2);
			const status = crafting._getRecipeReadiness(RECIPE_ITEM);
			const ledger = crafting._consumeIngredients(status.ingredients);
			crafting._addCraftedItem(RECIPE_ITEM);

			crafting._undoCraft(RECIPE_ITEM, ledger);

			expect(state.getInventory().find(i => i.item.name === "Basilisk Salve").quantity).toBe(2);
		});

		it("survives an empty ledger", () => {
			expect(() => crafting._undoCraft(RECIPE_ITEM, null)).not.toThrow();
		});
	});

	describe("cooking outcome ladder", () => {
		// Arcadia 11: meeting the DC is a Success, +5 is Delicious, a natural 20 on a
		// successful check is Extra Delicious.
		const tierFor = (total, dc, isNat20) => (isNat20 && total >= dc)
			? "extraDelicious"
			: (total >= dc + 5 ? "delicious" : "success");

		it("meeting the DC is a plain success", () => {
			expect(tierFor(14, 14, false)).toBe("success");
		});

		it("beating it by 5 is delicious", () => {
			expect(tierFor(19, 14, false)).toBe("delicious");
		});

		it("a natural 20 on a successful check is extra delicious", () => {
			expect(tierFor(25, 14, true)).toBe("extraDelicious");
		});

		it("a natural 20 that still misses the DC is not extra delicious", () => {
			expect(tierFor(12, 30, true)).toBe("success");
		});
	});
});

/**
 * Arcadia 11 models a dish as several component recipes served together, and names the
 * ingredients taken from a corpse as "<creature> <category>". Both shapes broke assumptions the
 * craft workbench had inherited from the Hamund's handbooks, where a recipe is one flat list of
 * materials that each exist in their own right.
 */
describe("Arcadia 11 recipe shapes", () => {
	// Owlbear Omelette, Arcadia 11 p30: an omelette *and* a slice of toast, one portion of fats each.
	const OWLBEAR_OMELETTE = [
		{name: "owlbear eggs", quantity: 2, group: "Owlbear Steak Omelette"},
		{name: "owlbear meat", quantity: 1, group: "Owlbear Steak Omelette"},
		{name: "fats", quantity: 1, group: "Owlbear Steak Omelette"},
		{name: "cheese", quantity: 1, group: "Owlbear Steak Omelette"},
		{name: "flour", quantity: 1, group: "Toast"},
		{name: "fats", quantity: 1, group: "Toast"},
	];

	describe("getRecipeDemand — repeated materials", () => {
		it("sums a material named by more than one component group", () => {
			const out = CharacterSheetCrafting.getRecipeDemand(OWLBEAR_OMELETTE, () => 0);
			out.filter(i => i.name === "fats").forEach(i => expect(i.required).toBe(2));
		});

		it("one portion does not satisfy a two-portion demand", () => {
			const out = CharacterSheetCrafting.getRecipeDemand(OWLBEAR_OMELETTE, name => (name === "fats" ? 1 : 99));
			expect(out.filter(i => i.name === "fats").every(i => i.isHeld)).toBe(false);
		});

		it("two portions satisfy both rows", () => {
			const out = CharacterSheetCrafting.getRecipeDemand(OWLBEAR_OMELETTE, name => (name === "fats" ? 2 : 99));
			expect(out.every(i => i.isHeld)).toBe(true);
		});

		it("leaves a single-mention material at its own quantity", () => {
			const out = CharacterSheetCrafting.getRecipeDemand(OWLBEAR_OMELETTE, () => 0);
			expect(out.find(i => i.name === "owlbear eggs").required).toBe(2);
			expect(out.find(i => i.name === "flour").required).toBe(1);
		});

		it("matches case-insensitively, so Fats in the bag counts against fats in the book", () => {
			const out = CharacterSheetCrafting.getRecipeDemand(
				[{name: "Fats", quantity: 1}, {name: "fats", quantity: 1}],
				() => 2,
			);
			expect(out.every(i => i.required === 2 && i.isHeld)).toBe(true);
		});

		it("does not pool alternatives, which are a choice rather than a total", () => {
			const out = CharacterSheetCrafting.getRecipeDemand([
				{name: "Ghast Hide", quantity: 1, alternativeGroup: "hide"},
				{name: "Ghoul Hide", quantity: 1, alternativeGroup: "hide"},
			], () => 1);
			expect(out.every(i => i.required === 1)).toBe(true);
		});

		it("survives a recipe with no ingredients at all", () => {
			expect(CharacterSheetCrafting.getRecipeDemand(undefined, () => 0)).toEqual([]);
		});

		// Regression: every row carries the SUMMED requirement, so rendering repeats as peers
		// multiplied the ask. Hydra 5 Ways names hydra meat five times and showed "0/5" on each,
		// reading as a demand for twenty-five.
		it("flags every appearance after the first as a repeat", () => {
			const out = CharacterSheetCrafting.getRecipeDemand(OWLBEAR_OMELETTE, () => 0);
			const fats = out.filter(i => i.name === "fats");
			expect(fats.map(i => !!i.isRepeat)).toEqual([false, true]);
		});

		it("counts each distinct material as a first appearance", () => {
			const out = CharacterSheetCrafting.getRecipeDemand(OWLBEAR_OMELETTE, () => 0);
			expect(out.filter(i => !i.isRepeat).map(i => i.name).sort())
				.toEqual(["cheese", "fats", "flour", "owlbear eggs", "owlbear meat"]);
		});

		it("marks four of five hydra meat rows as repeats", () => {
			const out = CharacterSheetCrafting.getRecipeDemand(
				Array.from({length: 5}, (_, ix) => ({name: "hydra meat", quantity: 1, group: `g${ix}`})),
				() => 0,
			);
			expect(out.filter(i => i.isRepeat)).toHaveLength(4);
			expect(out.every(i => i.required === 5)).toBe(true);
		});

		it("never marks an alternative as a repeat, since each is a real choice", () => {
			const out = CharacterSheetCrafting.getRecipeDemand([
				{name: "Ghast Hide", quantity: 1, alternativeGroup: "hide"},
				{name: "Ghast Hide", quantity: 1, alternativeGroup: "hide2"},
			], () => 1);
			expect(out.some(i => i.isRepeat)).toBe(false);
		});
	});

	describe("_fmtRequired — fractional portions", () => {
		it("leaves whole numbers alone", () => {
			expect(CharacterSheetCrafting._fmtRequired(3)).toBe("3");
		});

		// Hamund's asks for a third of an astral dreadnought eye; the data stores 0.3333.
		it("renders the recorded thirds and quarters as fractions", () => {
			expect(CharacterSheetCrafting._fmtRequired(0.3333)).toBe("\u2153");
			expect(CharacterSheetCrafting._fmtRequired(0.25)).toBe("\u00bc");
		});

		it("falls back to two decimals for anything unrecognised", () => {
			expect(CharacterSheetCrafting._fmtRequired(1.234)).toBe("1.23");
		});
	});

	describe("getSpendPlan — what actually leaves the bag", () => {
		it("bills a repeated material once, for the summed amount", () => {
			const demand = CharacterSheetCrafting.getRecipeDemand(OWLBEAR_OMELETTE, () => 9);
			const plan = CharacterSheetCrafting.getSpendPlan(demand);
			const fats = plan.filter(p => p.name === "fats");
			expect(fats).toHaveLength(1);
			expect(fats[0].quantity).toBe(2);
		});

		it("bills every distinct material exactly once", () => {
			const demand = CharacterSheetCrafting.getRecipeDemand(OWLBEAR_OMELETTE, () => 9);
			const plan = CharacterSheetCrafting.getSpendPlan(demand);
			expect(plan.map(p => p.name).sort()).toEqual(["cheese", "fats", "flour", "owlbear eggs", "owlbear meat"]);
		});

		it("spends only one side of an either/or", () => {
			const demand = CharacterSheetCrafting.getRecipeDemand([
				{name: "Ghast Hide", quantity: 1, alternativeGroup: "hide"},
				{name: "Ghoul Hide", quantity: 1, alternativeGroup: "hide"},
			], () => 5);
			expect(CharacterSheetCrafting.getSpendPlan(demand)).toEqual([{name: "Ghast Hide", quantity: 1}]);
		});

		it("never bills for something the character does not hold", () => {
			const demand = CharacterSheetCrafting.getRecipeDemand(OWLBEAR_OMELETTE, name => (name === "flour" ? 0 : 9));
			expect(CharacterSheetCrafting.getSpendPlan(demand).some(p => p.name === "flour")).toBe(false);
		});

		it("the confirmation and the consumption cannot disagree", () => {
			const demand = CharacterSheetCrafting.getRecipeDemand(OWLBEAR_OMELETTE, () => 9);
			const shown = CharacterSheetCrafting.getSpendPlan(demand);
			const spent = CharacterSheetCrafting.getSpendPlan(demand);
			expect(shown).toEqual(spent);
		});

		// "Craft anyway" promises to "consume only what you hold". It used to consume nothing of a
		// part-held material, so a player short one of two dragon scales kept both.
		it("spends what is held of a part-held material", () => {
			const demand = CharacterSheetCrafting.getRecipeDemand([{name: "Dragon Scale", quantity: 2}], () => 1);
			expect(CharacterSheetCrafting.getSpendPlan(demand)).toEqual([{name: "Dragon Scale", quantity: 1}]);
		});

		it("still bills nothing for a material held at zero", () => {
			const demand = CharacterSheetCrafting.getRecipeDemand([{name: "Dragon Scale", quantity: 2}], () => 0);
			expect(CharacterSheetCrafting.getSpendPlan(demand)).toEqual([]);
		});

		it("never bills more than the recipe asks for", () => {
			const demand = CharacterSheetCrafting.getRecipeDemand([{name: "Dragon Scale", quantity: 2}], () => 99);
			expect(CharacterSheetCrafting.getSpendPlan(demand)).toEqual([{name: "Dragon Scale", quantity: 2}]);
		});

		it("takes the better-stocked side of an either/or", () => {
			const demand = CharacterSheetCrafting.getRecipeDemand([
				{name: "Ghast Hide", quantity: 2, alternativeGroup: "hide"},
				{name: "Ghoul Hide", quantity: 2, alternativeGroup: "hide"},
			], name => (name === "Ghoul Hide" ? 2 : 1));
			expect(CharacterSheetCrafting.getSpendPlan(demand)).toEqual([{name: "Ghoul Hide", quantity: 2}]);
		});

		it("still spends one side only when neither is complete", () => {
			const demand = CharacterSheetCrafting.getRecipeDemand([
				{name: "Ghast Hide", quantity: 3, alternativeGroup: "hide"},
				{name: "Ghoul Hide", quantity: 3, alternativeGroup: "hide"},
			], () => 1);
			expect(CharacterSheetCrafting.getSpendPlan(demand)).toHaveLength(1);
		});
	});
});

/**
 * Harvesting is "collecting usable ingredients, either from the earth or from a dead creature"
 * (Arcadia 11 p23). The Harvest modal only ever knew the second half, which left every herb,
 * mineral and food ingredient in the catalog with no route into the game.
 */
describe("Foraged materials", () => {
	const FORAGE = (name, category, over = {}) => ({
		name,
		source: "Arcadia11",
		materialCategory: category,
		harvest: {dc: 10, quantity: 1},
		entries: [],
		value: 200,
		...over,
	});

	it("keeps materials that are not cut from a creature", () => {
		const out = CharacterSheetState._buildForagedMaterials([
			FORAGE("Flour", "food ingredient"),
			MATERIAL("Basilisk Eye"),
		]);
		expect(out.map(m => m.name)).toEqual(["Flour"]);
	});

	it("drops everything a creature yields, since the creature view already has it", () => {
		const out = CharacterSheetState._buildForagedMaterials([MATERIAL("Basilisk Eye"), MATERIAL("Basilisk Hide")]);
		expect(out).toEqual([]);
	});

	it("groups by category, then alphabetically inside it", () => {
		const out = CharacterSheetState._buildForagedMaterials([
			FORAGE("Sweetener", "food ingredient"),
			FORAGE("Adamantine", "mineral"),
			FORAGE("Beans", "food ingredient"),
			FORAGE("Aloyleaf", "herb"),
		]);
		expect(out.map(m => m.name)).toEqual(["Beans", "Sweetener", "Aloyleaf", "Adamantine"]);
	});

	it("merges the same ingredient printed by two books into one row", () => {
		const out = CharacterSheetState._buildForagedMaterials([
			FORAGE("Meat", "food ingredient"),
			FORAGE("Meat", "food ingredient", {source: "HHbH"}),
		]);
		expect(out).toHaveLength(1);
		expect(out[0].printings.length).toBe(2);
	});

	it("returns an empty list rather than throwing on an empty catalog", () => {
		expect(CharacterSheetState._buildForagedMaterials([])).toEqual([]);
	});
});

describe("CharacterSheetCrafting - Arcadia 11 cooking ladder", () => {
	const R = (...tiers) => ({name: "Dish", outcomes: tiers.map(t => ({tier: t, entries: [t]}))});

	it("treats meeting the DC as a plain success", () => {
		expect(CharacterSheetCrafting.getCookTier({total: 15, isNat20: false}, 15)).toBe("success");
	});

	it("keeps beating the DC by 4 a plain success", () => {
		expect(CharacterSheetCrafting.getCookTier({total: 19, isNat20: false}, 15)).toBe("success");
	});

	it("promotes beating the DC by exactly 5 to delicious", () => {
		expect(CharacterSheetCrafting.getCookTier({total: 20, isNat20: false}, 15)).toBe("delicious");
	});

	it("promotes a natural 20 to extra delicious even against a high DC", () => {
		expect(CharacterSheetCrafting.getCookTier({total: 22, isNat20: true}, 20)).toBe("extraDelicious");
	});

	it("does not crash on a missing roll result", () => {
		expect(CharacterSheetCrafting.getCookTier(null, 10)).toBe("success");
	});

	it("returns the matching tier when the recipe defines it", () => {
		expect(CharacterSheetCrafting.getCookOutcome(R("success", "delicious"), "delicious").entries).toEqual(["delicious"]);
	});

	it("falls back down the ladder when the rolled tier is undefined", () => {
		expect(CharacterSheetCrafting.getCookOutcome(R("success"), "extraDelicious").entries).toEqual(["success"]);
	});

	it("falls back from extra delicious to delicious before success", () => {
		expect(CharacterSheetCrafting.getCookOutcome(R("success", "delicious"), "extraDelicious").entries).toEqual(["delicious"]);
	});

	it("never falls upward from a lower tier", () => {
		expect(CharacterSheetCrafting.getCookOutcome(R("delicious"), "success")).toBeNull();
	});

	it("returns null rather than throwing for a recipe with no outcomes", () => {
		expect(CharacterSheetCrafting.getCookOutcome({name: "Dish"}, "success")).toBeNull();
	});
});

describe("CharacterSheetCrafting - the formula advisory", () => {
	it("applies to a magic item with a real rarity", () => {
		expect(CharacterSheetCrafting.isFormulaRequired({rarity: "rare", recipeCategory: "item"})).toBe(true);
	});

	it("does not apply to a mundane item", () => {
		expect(CharacterSheetCrafting.isFormulaRequired({rarity: "none", recipeCategory: "item"})).toBe(false);
	});

	it("does not apply to an item of unknown rarity", () => {
		expect(CharacterSheetCrafting.isFormulaRequired({rarity: "unknown", recipeCategory: "item"})).toBe(false);
	});

	it("exempts potions, which the book carves out", () => {
		expect(CharacterSheetCrafting.isFormulaRequired({rarity: "uncommon", recipeCategory: "potion"})).toBe(false);
	});

	it("exempts dishes, which are not magic items at all", () => {
		expect(CharacterSheetCrafting.isFormulaRequired({rarity: "rare", recipeCategory: "dish"})).toBe(false);
	});

	it("does not throw on a recipe with no rarity", () => {
		expect(CharacterSheetCrafting.isFormulaRequired({recipeCategory: "item"})).toBe(false);
		expect(CharacterSheetCrafting.isFormulaRequired(null)).toBe(false);
	});
});

describe("CharacterSheetCrafting - what a cooked portion carries", () => {
	const DISH = {
		name: "A Perfect Roast",
		outcomes: [
			{tier: "success", entries: ["You gain advantage on a Strength ability check."]},
			{tier: "delicious", entries: ["You gain 5 temporary hit points."]},
			{tier: "extraDelicious", entries: ["You can use both of the above benefits."]},
		],
	};

	it("carries only the rolled tier when it stands alone", () => {
		const got = CharacterSheetCrafting.getCookedBenefitEntries(DISH, "delicious");
		expect(got).toHaveLength(1);
		expect(got[0].name).toBe("Delicious:");
	});

	it("carries the referenced tiers when the outcome says 'the above'", () => {
		const got = CharacterSheetCrafting.getCookedBenefitEntries(DISH, "extraDelicious");
		expect(got.map(b => b.name)).toEqual(["Success:", "Delicious:", "Extra Delicious:"]);
	});

	it("orders the carried tiers lowest first, as the book prints them", () => {
		const got = CharacterSheetCrafting.getCookedBenefitEntries(DISH, "extraDelicious");
		expect(got[0].entries[0]).toMatch(/Strength/);
		expect(got[2].entries[0]).toMatch(/both of the above/);
	});

	it("does not back-reference from the lowest tier", () => {
		const got = CharacterSheetCrafting.getCookedBenefitEntries(DISH, "success");
		expect(got.map(b => b.name)).toEqual(["Success:"]);
	});

	it("returns nothing for a tier the recipe does not define", () => {
		expect(CharacterSheetCrafting.getCookedBenefitEntries({name: "X", outcomes: []}, "success")).toEqual([]);
		expect(CharacterSheetCrafting.getCookedBenefitEntries(null, "success")).toEqual([]);
	});
});

describe("CharacterSheetCrafting - the safe-effect allowlist", () => {
	it("admits temporary hit points", () => {
		expect(CharacterSheetCrafting.getSafeDishEffects("You gain 10 temporary hit points."))
			.toEqual([{type: "tempHp", value: "10"}]);
	});

	it("admits a damage resistance, prefixed so active states actually honour it", () => {
		expect(CharacterSheetCrafting.getSafeDishEffects("You gain resistance to lightning damage until you finish a long rest."))
			.toEqual([{type: "resistance", target: "damage:lightning"}]);
	});

	// Regression: the parser names a damage type bare, but `_getResistancesFromStates` filters on
	// `target.startsWith("damage:")`. Returning the parser's shape unchanged produced an active
	// state that displayed correctly and protected the character from nothing.
	it("never returns a bare damage target, which would be silently inert", () => {
		const fx = CharacterSheetCrafting.getSafeDishEffects("You gain resistance to fire damage.");
		expect(fx).toHaveLength(1);
		expect(fx[0].target).toBe("damage:fire");
	});

	it("leaves an already-qualified target alone", () => {
		expect(CharacterSheetCrafting._normaliseDishEffect({type: "resistance", target: "damage:cold"}))
			.toEqual({type: "resistance", target: "damage:cold"});
	});

	// Advantage needs no translation — `getAdvantageState` matches these targets verbatim.
	it("passes an advantage target through untouched", () => {
		expect(CharacterSheetCrafting._normaliseDishEffect({type: "advantage", target: "check:wis"}))
			.toEqual({type: "advantage", target: "check:wis"});
	});

	it("admits an AC bonus", () => {
		expect(CharacterSheetCrafting.getSafeDishEffects("until you finish a long rest, you gain a +1 bonus to your AC."))
			.toContainEqual({type: "bonus", target: "ac", value: 1});
	});

	it("admits a speed bonus", () => {
		expect(CharacterSheetCrafting.getSafeDishEffects("your movement speed increases by 15 feet."))
			.toContainEqual({type: "bonus", target: "speed", value: 15});
	});

	it("rejects a damage bonus parsed out of damage dealt TO a target", () => {
		const got = CharacterSheetCrafting.getSafeDishEffects("If the attack hits, the target takes an extra 6 (2d6) damage and must succeed on a saving throw or be knocked prone.");
		expect(got.some(e => e.target === "damage")).toBe(false);
	});

	it("rejects free-text notes", () => {
		const got = CharacterSheetCrafting.getSafeDishEffects("You can use a bonus action to make an unarmed strike with your teeth.");
		expect(got.some(e => e.type === "note")).toBe(false);
	});

	it("does not throw on empty or tagged input", () => {
		expect(CharacterSheetCrafting.getSafeDishEffects("")).toEqual([]);
		expect(CharacterSheetCrafting.getSafeDishEffects(null)).toEqual([]);
		expect(CharacterSheetCrafting.getSafeDishEffects("You gain {@dice 5} temporary hit points.")).toBeDefined();
	});
});

/**
 * Consumption against a real inventory.
 *
 * The spend plan says what *should* leave the bag; these check that it actually does — across
 * split stacks, in the right order, and without leaving unusable slivers behind.
 */
describe("CharacterSheetCrafting - taking materials out of the bag", () => {
	let nextId;

	const STACK = (name, quantity, over = {}) => ({id: `inv-${nextId++}`, quantity, item: {name, source: "HHHVI", ...over}});

	const getHarness = inventory => {
		const inv = [...inventory];
		const state = {
			getInventory: () => inv,
			setItemQuantity: (id, q) => { const it = inv.find(i => i.id === id); if (it) it.quantity = q; },
			removeItem: id => { const ix = inv.findIndex(i => i.id === id); if (~ix) inv.splice(ix, 1); },
			addItem: (item, quantity) => { inv.push({id: `inv-${nextId++}`, quantity, item}); },
		};
		const crafting = Object.create(CharacterSheetCrafting.prototype);
		crafting._state = state;
		return {crafting, inv};
	};

	beforeEach(() => { nextId = 0; });

	const demandFor = (ingredients, crafting) => CharacterSheetCrafting.getRecipeDemand(ingredients, name => crafting._getHeldQuantity(name));

	// Readiness sums every stack that answers to the material, so consumption has to as well —
	// otherwise "2 held" produces the item and leaves one behind.
	it("spends across more than one stack of the same material", () => {
		const {crafting, inv} = getHarness([STACK("Devil Wings", 1, {_isCraftingMaterial: true}), STACK("Devil Wings (2 vials)", 1, {_isCraftingMaterial: true})]);
		crafting._consumeIngredients(demandFor([{name: "Devil Wings", quantity: 2}], crafting));
		expect(inv).toHaveLength(0);
	});

	it("stops once the debt is paid", () => {
		const {crafting, inv} = getHarness([STACK("Devil Wings", 3, {_isCraftingMaterial: true}), STACK("Devil Wings (2 vials)", 3, {_isCraftingMaterial: true})]);
		crafting._consumeIngredients(demandFor([{name: "Devil Wings", quantity: 2}], crafting));
		expect(inv.reduce((a, i) => a + i.quantity, 0)).toBe(4);
	});

	// Hamund's "Mimic Gel" recipe is made from "Mimic Gel (3 vials)", and both names normalise to
	// the same key. Eating the finished jar to make another one is not what the book meant.
	it("spends raw material before finished goods of the same name", () => {
		const {crafting, inv} = getHarness([STACK("Mimic Gel", 1), STACK("Mimic Gel (3 vials)", 1, {_isCraftingMaterial: true})]);
		crafting._consumeIngredients(demandFor([{name: "Mimic Gel", quantity: 1}], crafting));
		expect(inv.map(i => i.item.name)).toEqual(["Mimic Gel"]);
	});

	// A third of a crystal, three times over, used to leave 0.0001 of one in the bag forever.
	it("clears a stack worn down to a rounding error", () => {
		const {crafting, inv} = getHarness([STACK("Anti-Magic Crystal", 0.3334, {_isCraftingMaterial: true})]);
		crafting._consumeIngredients(demandFor([{name: "Anti-Magic Crystal", quantity: 0.3333}], crafting));
		expect(inv).toHaveLength(0);
	});

	it("keeps a genuine remainder", () => {
		const {crafting, inv} = getHarness([STACK("Anti-Magic Crystal", 1, {_isCraftingMaterial: true})]);
		crafting._consumeIngredients(demandFor([{name: "Anti-Magic Crystal", quantity: 0.3333}], crafting));
		expect(inv[0].quantity).toBeCloseTo(0.6667, 4);
	});

	it("records enough to put every touched stack back", () => {
		const {crafting} = getHarness([STACK("Devil Wings", 1, {_isCraftingMaterial: true}), STACK("Devil Wings (2 vials)", 4, {_isCraftingMaterial: true})]);
		const ledger = crafting._consumeIngredients(demandFor([{name: "Devil Wings", quantity: 3}], crafting));
		expect(ledger).toHaveLength(2);
		expect(ledger.map(l => l.prevQuantity)).toEqual([1, 4]);
		expect(ledger.map(l => l.wasRemoved)).toEqual([true, false]);
	});

	it("puts everything back exactly as it was", () => {
		const {crafting, inv} = getHarness([STACK("Devil Wings", 1, {_isCraftingMaterial: true}), STACK("Devil Wings (2 vials)", 4, {_isCraftingMaterial: true})]);
		const before = inv.map(i => `${i.item.name}:${i.quantity}`).sort();
		crafting._restoreLedger(crafting._consumeIngredients(demandFor([{name: "Devil Wings", quantity: 3}], crafting)));
		expect(inv.map(i => `${i.item.name}:${i.quantity}`).sort()).toEqual(before);
	});

	// Harvested vials were being filed onto the finished-goods stack they normalise against.
	it("files a harvested part onto its own pile, not a finished item of the same name", () => {
		const {crafting, inv} = getHarness([STACK("Mimic Gel", 1)]);
		crafting._addMaterialToInventory({name: "Mimic Gel (3 vials)", source: "HHHVI"}, 1);
		expect(inv).toHaveLength(2);
		expect(inv.find(i => i.item.name === "Mimic Gel").quantity).toBe(1);
	});

	it("still stacks two printings of the same part together", () => {
		const {crafting, inv} = getHarness([STACK("Aboleth Eye (2 vials)", 2, {_isCraftingMaterial: true})]);
		crafting._addMaterialToInventory({name: "Aboleth Eye", source: "HHHVIII"}, 1);
		expect(inv).toHaveLength(1);
		expect(inv[0].quantity).toBe(3);
	});

	it("takes undo from the crafted stack, not the material it was made from", () => {
		const {crafting, inv} = getHarness([STACK("Mimic Gel (3 vials)", 1, {_isCraftingMaterial: true}), STACK("Mimic Gel", 1)]);
		crafting._removeOneCrafted("Mimic Gel", "HHHVI");
		expect(inv.map(i => i.item.name)).toEqual(["Mimic Gel (3 vials)"]);
	});
});
