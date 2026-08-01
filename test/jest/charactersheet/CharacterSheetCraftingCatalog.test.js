/**
 * Crafting catalog indexing, and the twin-merge rule.
 *
 * The source books disagree about the same physical object: an Aboleth Eye is a spell component in
 * Arcadia 8 (DC 17, ×3, 0.5 lb) and a 375 gp creature part in Hamund's (DC 20, ×1, 45 lb) that
 * crafts a Lens of Forgotten History. The player owns one eye, so the catalog must collapse those
 * into a single logical material — with Arcadia 8 owning identity, weight and `variantComponent`,
 * and the twin contributing only what Arcadia 8 lacks.
 *
 * Getting the weight rule wrong would silently rewrite a character's encumbrance, so it is asserted
 * explicitly.
 */

import "./setup.js";
import "../../../js/charactersheet/charactersheet-state.js";

const CharacterSheetState = globalThis.CharacterSheetState;

const ABOLETH_EYE_AR8 = {
	name: "Aboleth Eye",
	source: "Ar8",
	page: 15,
	materialCategory: "spell component",
	harvest: {dc: 17, quantity: 3, time: "15 minutes", creature: {name: "Aboleth", source: "MM"}, creatureType: "aberration", cr: 10},
	entries: ["An eye harvested from an aboleth."],
	weight: 0.5,
	effectTags: ["crafting ingredient", "spell component"],
	usedInRecipes: [],
	spells: [{name: "legend lore", source: "phb"}],
	variantComponent: {harvestDC: 17, spellEffects: [{match: {spell: "legend lore|phb"}, effects: []}]},
	hasMechanicalEffect: true,
};

const ABOLETH_EYE_HHHVI = {
	name: "Aboleth Eye",
	source: "HHHVI",
	page: 8,
	materialCategory: "creature part",
	harvest: {dc: 20, quantity: 1, creature: {name: "Aboleth", source: "MM"}, creatureType: "aberration", cr: 10},
	entries: ["Larger than a normal creature's head."],
	hasUseEffect: false,
	value: 37500,
	weight: 45,
	effectTags: ["crafting ingredient", "trade good"],
	usedInRecipes: [{name: "Lens of Forgotten History", source: "HHHVI", uid: "lens of forgotten history|hhhvi"}],
	hasMechanicalEffect: false,
};

const BASILISK_EYE = {
	name: "Basilisk Eye",
	source: "HHHVI",
	materialCategory: "creature part",
	harvest: {dc: 10, quantity: 2, creature: {name: "Basilisk", source: "MM"}, creatureType: "monstrosity", cr: 3},
	entries: [],
	value: 200,
	weight: 1,
	effectTags: ["crafting ingredient"],
	usedInRecipes: [{name: "Basilisk Gaze Poison", source: "HHHVI", uid: "basilisk gaze poison|hhhvi"}],
};

const SALAMANDER_SCALE = {
	name: "Salamander Scale (large pouch)",
	source: "HHHVI",
	materialCategory: "creature part",
	harvest: {dc: 14, quantity: 1, creature: {name: "Salamander", source: "MM"}},
	entries: [],
	value: 5000,
	weight: 2,
	effectTags: ["crafting ingredient"],
	usedInRecipes: [],
};

const LENS = {
	name: "Lens of Forgotten History",
	source: "HHHVI",
	recipeCategory: "item",
	crafter: "Artificer",
	craftDC: null,
	rarity: "very rare",
	ingredients: [{name: "Aboleth Eye", quantity: 1, uid: "aboleth eye|hhhvi"}],
	itemUid: "lens of forgotten history|hhhvi",
	entries: [],
	effectTags: ["grants spell"],
};

const CATALOG = {
	craftingMaterial: [ABOLETH_EYE_AR8, ABOLETH_EYE_HHHVI, BASILISK_EYE, SALAMANDER_SCALE],
	craftingRecipe: [LENS],
	craftingRule: [{name: "Optional Rule: Carcass Degradation", source: "HHHVI", ruleCategory: "harvesting", entries: []}],
};

describe("Crafting catalog", () => {
	let state;

	beforeEach(() => {
		state = new CharacterSheetState();
		state.setCraftingCatalog(CATALOG);
	});

	describe("indexing", () => {
		it("exposes the raw arrays", () => {
			const catalog = state.getCraftingCatalog();

			expect(catalog.materials).toHaveLength(4);
			expect(catalog.recipes).toHaveLength(1);
			expect(catalog.rules).toHaveLength(1);
		});

		it("indexes craftables by uid", () => {
			expect(state.getCraftingCatalog().recipesByUid.get("lens of forgotten history|hhhvi").crafter).toBe("Artificer");
		});

		it("returns null before a catalog is loaded", () => {
			expect(new CharacterSheetState().getCraftingCatalog()).toBeNull();
		});
	});

	describe("name normalisation", () => {
		it("drops a packaging suffix but keeps the material", () => {
			const key = CharacterSheetState.normaliseMaterialKey("Salamander Scale (large pouch)");

			expect(key).toBe("salamander scale");
			expect(CharacterSheetState.normaliseMaterialKey("SALAMANDER  SCALE")).toBe(key);
			expect(CharacterSheetState.normaliseMaterialKey("Basilisk Bile (2 vials)")).toBe("basilisk bile");
		});

		it("keeps an identity-bearing qualifier", () => {
			// An age tier is a different material at a different price; packaging is not
			expect(CharacterSheetState.normaliseMaterialKey("Dragon Blood (Ancient)")).toBe("dragon blood ancient");
			expect(CharacterSheetState.normaliseMaterialKey("Dragon Hide (CR 21-24)")).toBe("dragon hide cr 21 24");
		});

		it("resolves an ingredient reference to the material despite a unit suffix", () => {
			expect(state.getCraftingMaterialByName("Salamander Scale").name).toBe("Salamander Scale (large pouch)");
		});

		it("returns null for an unknown material", () => {
			expect(state.getCraftingMaterialByName("Nonexistent Widget")).toBeNull();
		});
	});

	describe("twin merge", () => {
		it("collapses the two Aboleth Eyes into one logical material", () => {
			const merged = state.getCraftingMaterialByName("Aboleth Eye");

			expect(merged).not.toBeNull();
			expect(merged.printings).toHaveLength(2);
			expect(merged.twins).toEqual([{name: "Aboleth Eye", source: "HHHVI"}]);
		});

		it("gives Arcadia 8 precedence over identity and weight", () => {
			const merged = state.getCraftingMaterialByName("Aboleth Eye");

			expect(merged.source).toBe("Ar8");
			// 0.5 lb, NOT Hamund's 45 lb — applying the twin's weight would rewrite encumbrance
			expect(merged.weight).toBe(0.5);
			expect(merged.materialCategory).toBe("spell component");
			expect(merged.harvest.dc).toBe(17);
		});

		it("keeps Arcadia 8's variantComponent so casting is unaffected", () => {
			const merged = state.getCraftingMaterialByName("Aboleth Eye");

			expect(merged.variantComponent.spellEffects[0].match.spell).toBe("legend lore|phb");
			expect(merged.spells).toEqual([{name: "legend lore", source: "phb"}]);
		});

		it("adopts the twin's value, which Arcadia 8 lacks", () => {
			expect(state.getCraftingMaterialByName("Aboleth Eye").value).toBe(37500);
		});

		it("adopts the twin's craftables", () => {
			const merged = state.getCraftingMaterialByName("Aboleth Eye");

			expect(merged.usedInRecipes).toHaveLength(1);
			expect(merged.usedInRecipes[0].uid).toBe("lens of forgotten history|hhhvi");
		});

		it("unions the effect tags from every printing", () => {
			expect(state.getCraftingMaterialByName("Aboleth Eye").effectTags)
				.toEqual(["crafting ingredient", "spell component", "trade good"]);
		});

		it("surfaces each printing's own figures for disclosure, unapplied", () => {
			const hamunds = state.getCraftingMaterialByName("Aboleth Eye").printings.find(p => p.source === "HHHVI");

			expect(hamunds.weight).toBe(45);
			expect(hamunds.value).toBe(37500);
			expect(hamunds.harvestDc).toBe(20);
		});

		it("leaves a material with no twin alone", () => {
			const basilisk = state.getCraftingMaterialByName("Basilisk Eye");

			expect(basilisk.twins).toEqual([]);
			expect(basilisk.printings).toHaveLength(1);
			expect(basilisk.weight).toBe(1);
		});
	});

	describe("harvestables by creature", () => {
		// The player owns one eye, so the Harvest modal must offer one row for it — not one row
		// per book that happens to describe it. The books' disagreements ride along as printings.
		it("collapses the twins into one row, carrying both printings", () => {
			const parts = state.getHarvestablesForCreature("Aboleth");

			expect(parts).toHaveLength(1);
			expect(parts[0].source).toBe("Ar8");
			expect(parts[0].printings.map(pr => `${pr.source}:${pr.harvestDc}`)).toEqual(["Ar8:17", "HHHVI:20"]);
		});

		it("is case-insensitive", () => {
			expect(state.getHarvestablesForCreature("aboleth")).toHaveLength(1);
		});

		it("returns an empty list for a creature with nothing to harvest", () => {
			expect(state.getHarvestablesForCreature("Commoner")).toEqual([]);
			expect(state.getHarvestablesForCreature(null)).toEqual([]);
		});
	});
});

describe("Crafting catalog against the real generated data", () => {
	let state;

	beforeAll(async () => {
		const {readFileSync} = await import("fs");
		state = new CharacterSheetState();
		state.setCraftingCatalog(JSON.parse(readFileSync("data/crafting.json", "utf-8")));
	});

	it("indexes the whole catalog", () => {
		const catalog = state.getCraftingCatalog();

		expect(catalog.materials.length).toBeGreaterThan(1800);
		expect(catalog.recipes.length).toBeGreaterThan(400);
		expect(catalog.materialsByKey.size).toBeGreaterThan(1500);
	});

	it("merges the real Aboleth Eye with Arcadia 8 winning", () => {
		const merged = state.getCraftingMaterialByName("Aboleth Eye");

		expect(merged.source).toBe("Ar8");
		expect(merged.weight).toBe(0.5);
		expect(merged.twins.some(t => t.source === "HHHVI")).toBe(true);
		expect(merged.usedInRecipes.some(r => r.name === "Lens of Forgotten History")).toBe(true);
	});

	it("finds Thelemar's own components", () => {
		const shard = state.getCraftingMaterialByName("Marilith Blade Shard");

		expect(shard.source).toBe("TGTT");
		expect(shard.harvest.dc).toBe(17);
		expect(shard.harvest.creature.name).toBe("Marilith");
	});

	describe("the Twelve Uses of Dragon's Blood", () => {
		const TIERS = [
			["Distilled Dragon's Blood (Wyrmling)", 1, 50000],
			["Distilled Dragon's Blood (Young)", 2, 150000],
			["Distilled Dragon's Blood (Adult)", 3, 500000],
			["Distilled Dragon's Blood (Ancient)", 4, 1500000],
		];

		it.each(TIERS)("%s carries all twelve uses, invoking %i, at %i cp", (name, perCasting, value) => {
			const blood = state.getCraftingMaterialByName(name);

			expect(blood.source).toBe("TGTT");
			expect(blood.value).toBe(value);
			expect(blood.variantComponent.uses).toHaveLength(12);
			expect(blood.variantComponent.usesPerCasting).toBe(perCasting);
		});

		it("names the twelve in canonical order", () => {
			const uses = state.getCraftingMaterialByName("Distilled Dragon's Blood (Ancient)").variantComponent.uses;

			expect(uses.map(u => u.name)).toEqual([
				"Far-Flung", "Enduring", "Encompassing", "Manifold",
				"Searing", "Warding", "Quickening", "Subtle",
				"Piercing", "Tenacious", "Reliable", "Sanguine",
			]);
		});

		it("gives every use a stable key and a rules entry", () => {
			const uses = state.getCraftingMaterialByName("Distilled Dragon's Blood (Young)").variantComponent.uses;

			uses.forEach(use => {
				expect(typeof use.key).toBe("string");
				expect(use.key).not.toHaveLength(0);
				expect(use.entry).toEqual(expect.any(String));
			});
			expect(new Set(uses.map(u => u.key)).size).toBe(12);
		});

		it("matches any spell, since the uses are not element-bound", () => {
			const blood = state.getCraftingMaterialByName("Distilled Dragon's Blood (Adult)");

			expect(blood.variantComponent.spellEffects[0].match).toEqual({any: true});
		});

		it("leaves Arcadia 8's raw Dragon Blood untouched", () => {
			// The raw blood is the narrow, undistilled form — it must keep its damage-type match
			const raw = state.getCraftingMaterialByName("Dragon Blood (Ancient)");

			expect(raw.source).toBe("Ar8");
			expect(raw.variantComponent.uses).toBeUndefined();
		});

		it("keeps each age tier a distinct material", () => {
			// Age qualifiers are identity, not packaging — collapsing them would price a
			// wyrmling's vial like an ancient's
			const keys = ["Wyrmling", "Young", "Adult", "Ancient"]
				.map(age => CharacterSheetState.normaliseMaterialKey(`Distilled Dragon's Blood (${age})`));

			expect(new Set(keys).size).toBe(4);
		});

		it("is documented by a canonical rule, not only a conversion note", () => {
			const rule = state.getCraftingCatalog().rules.find(r => r.name === "The Twelve Uses of Dragon's Blood");

			expect(rule).toBeDefined();
			expect(rule.source).toBe("TGTT");
			expect(rule.ruleCategory).toBe("components");
		});
	});

	it("groups a real creature's harvestables", () => {
		const parts = state.getHarvestablesForCreature("Aboleth");

		expect(parts.length).toBeGreaterThan(5);
		// No two rows are the same physical part
		const keys = parts.map(p => CharacterSheetState.normaliseMaterialKey(p.name));
		expect(new Set(keys).size).toBe(keys.length);
	});

	it("leads with what is worth the trouble, and sinks what cannot be rolled", () => {
		const parts = state.getHarvestablesForCreature("Aboleth");

		// Rollable parts first — a row with no recorded DC is a reference entry, not an action
		const ixFirstUnrollable = parts.findIndex(p => p.harvest?.dc == null);
		if (ixFirstUnrollable !== -1) {
			expect(parts.slice(ixFirstUnrollable).every(p => p.harvest?.dc == null)).toBe(true);
		}

		// Then by value, descending, so the decision the player is actually making reads first
		const rollable = parts.filter(p => p.harvest?.dc != null && p.value != null);
		const values = rollable.map(p => p.value);
		expect([...values].sort((a, b) => b - a)).toEqual(values);
	});
});
