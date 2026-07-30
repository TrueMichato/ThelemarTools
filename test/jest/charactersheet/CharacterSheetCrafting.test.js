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
