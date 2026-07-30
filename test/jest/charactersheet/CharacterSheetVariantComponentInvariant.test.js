/**
 * Variant-component casting invariant.
 *
 * Crafting adds materials to the same inventory the cast picker reads, and re-homes items into new
 * display categories. Both are safe only because casting resolves components purely from
 * `item.variantComponent` — it never consults a category, an item type, or a type tag.
 *
 * These tests lock that in. If a future change makes casting depend on categorisation, or makes
 * crafting consume materials through a store of its own, they fail here rather than silently in a
 * player's session.
 */

import "./setup.js";
import "../../../js/charactersheet/charactersheet-state.js";

const CharacterSheetState = globalThis.CharacterSheetState;

/** The real Arcadia 8 Aboleth Eye: a spell component that is *also* a crafting material. */
const ABOLETH_EYE = {
	name: "Aboleth Eye",
	source: "Ar8",
	type: "G",
	rarity: "unknown",
	weight: 0.5,
	variantComponent: {
		harvestDC: 17,
		harvestQuantity: 3,
		harvestSource: "Aboleth",
		harvestTime: "15 minutes",
		spellEffects: [
			{
				match: {spell: "legend lore|phb"},
				description: "Learn about an additional person, place, or object of legendary importance.",
				effects: [{type: "text", text: "Learn about an additional person, place, or object of legendary importance."}],
			},
		],
	},
};

/** A component matched by damage type rather than by spell name. */
const MINDKILLER_BRAIN = {
	name: "Piece of Mindkiller Brain",
	source: "Ar8",
	type: "G",
	variantComponent: {
		spellEffects: [
			{
				match: {damageType: "psychic"},
				description: "Damage die +1 step, +2 dice.",
				effects: [{type: "dieSizeIncrease", steps: 1, maxDie: "d12"}],
			},
		],
	},
};

/** Thelemar's distilled dragon's blood — matches *any* spell. */
const DISTILLED_BLOOD = {
	name: "Distilled Dragon's Blood (Ancient)",
	source: "TGTT",
	type: "G",
	variantComponent: {
		usesPerCasting: 4,
		spellEffects: [
			{
				match: {any: true},
				description: "Choose 4 of the Twelve Uses.",
				effects: [{type: "text", text: "Choose four of the Twelve Uses."}],
			},
		],
	},
};

/** An ordinary crafting material: no `variantComponent`, so never castable. */
const BASILISK_BILE = {
	name: "Basilisk Bile (2 vials)",
	source: "HHHVI",
	type: "G",
	weight: 1,
	value: 1200,
	_isCraftingMaterial: true,
};

const LEGEND_LORE = {name: "Legend Lore", source: "PHB", level: 5};
const VICIOUS_MOCKERY = {name: "Vicious Mockery", source: "PHB", level: 0};

describe("Variant component casting invariant", () => {
	let state;

	beforeEach(() => {
		state = new CharacterSheetState();
		state.addClass({name: "Wizard", source: "PHB", level: 9});
	});

	const addItem = (item, qty = 1) => {
		state.addItem({...item}, qty);
		return state.getInventory().find(inv => inv.item.name === item.name);
	};

	describe("resolution ignores categorisation", () => {
		it("matches a component by spell name", () => {
			addItem(ABOLETH_EYE, 3);

			const matches = state.getMatchingVariantComponents(LEGEND_LORE);

			expect(matches).toHaveLength(1);
			expect(matches[0].invItem.item.name).toBe("Aboleth Eye");
		});

		it("matches a component by damage type", () => {
			addItem(MINDKILLER_BRAIN, 1);

			const matches = state.getMatchingVariantComponents(VICIOUS_MOCKERY, {damageInflict: ["psychic"]});

			expect(matches).toHaveLength(1);
			expect(matches[0].invItem.item.name).toBe("Piece of Mindkiller Brain");
		});

		it("matches an `any` component against any spell", () => {
			addItem(DISTILLED_BLOOD, 1);

			expect(state.getMatchingVariantComponents(LEGEND_LORE)).toHaveLength(1);
			expect(state.getMatchingVariantComponents(VICIOUS_MOCKERY)).toHaveLength(1);
		});

		it("never matches a plain crafting material", () => {
			addItem(BASILISK_BILE, 5);

			expect(state.getMatchingVariantComponents(LEGEND_LORE)).toHaveLength(0);
		});

		it("resolves regardless of the item's type or category fields", () => {
			// Deliberately hostile: strip and scramble everything a categoriser would key off
			addItem({...ABOLETH_EYE, type: undefined, rarity: undefined, wondrous: true}, 1);

			expect(state.getMatchingVariantComponents(LEGEND_LORE)).toHaveLength(1);
		});
	});

	describe("crafting materials do not disturb casting", () => {
		it("still matches components after materials are added to inventory", () => {
			addItem(ABOLETH_EYE, 3);
			addItem(BASILISK_BILE, 4);
			addItem({name: "Aarakocra Feathers (small pouch)", source: "HHHVI", type: "G", weight: 2, _isCraftingMaterial: true}, 10);

			const matches = state.getMatchingVariantComponents(LEGEND_LORE);

			expect(matches).toHaveLength(1);
			expect(matches[0].invItem.item.name).toBe("Aboleth Eye");
		});

		it("still matches components after a craft consumes an unrelated material", () => {
			const eye = addItem(ABOLETH_EYE, 3);
			const bile = addItem(BASILISK_BILE, 2);

			// A craft consuming an unrelated ingredient
			state.setItemQuantity(bile.id, 1);

			const matches = state.getMatchingVariantComponents(LEGEND_LORE);
			expect(matches).toHaveLength(1);
			expect(matches[0].invItem.id).toBe(eye.id);
			expect(matches[0].invItem.quantity).toBe(3);
		});
	});

	describe("a dual-role item shares one stack", () => {
		it("decrements the cast picker when a craft consumes it", () => {
			const eye = addItem(ABOLETH_EYE, 3);

			expect(state.getMatchingVariantComponents(LEGEND_LORE)[0].invItem.quantity).toBe(3);

			// Crafting a Lens of Forgotten History consumes one Aboleth Eye — through the same
			// inventory API the cast picker reads, so there is nothing to keep in sync.
			state.setItemQuantity(eye.id, 2);

			const after = state.getMatchingVariantComponents(LEGEND_LORE);
			expect(after).toHaveLength(1);
			expect(after[0].invItem.quantity).toBe(2);
		});

		it("stops offering the component once the last one is consumed", () => {
			const eye = addItem(ABOLETH_EYE, 1);

			state.setItemQuantity(eye.id, 0);

			expect(state.getMatchingVariantComponents(LEGEND_LORE)).toHaveLength(0);
		});
	});

	describe("getVariantComponentEffects", () => {
		it("returns the matching effect for a dual-role item", () => {
			const eye = addItem(ABOLETH_EYE, 3);

			const effect = state.getVariantComponentEffects(eye.id, LEGEND_LORE);

			expect(effect).not.toBeNull();
			expect(effect.match.spell).toBe("legend lore|phb");
		});

		it("returns null for a spell the component does not enhance", () => {
			const eye = addItem(ABOLETH_EYE, 3);

			expect(state.getVariantComponentEffects(eye.id, VICIOUS_MOCKERY)).toBeNull();
		});

		it("returns the effect for an `any` component regardless of spell", () => {
			const blood = addItem(DISTILLED_BLOOD, 1);

			expect(state.getVariantComponentEffects(blood.id, LEGEND_LORE)).not.toBeNull();
			expect(state.getVariantComponentEffects(blood.id, VICIOUS_MOCKERY)).not.toBeNull();
		});
	});
});
