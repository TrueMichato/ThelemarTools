import {CraftingWorkbenchCore} from "../../../js/itembuilder/crafting-workbench-core.js";

describe("CraftingWorkbenchCore", () => {
	test.each([
		["itemMaterial", {name: "Darkmetal", source: "TGTT", materialCategory: "metal"}],
		["craftingMaterial", {name: "Aboleth Eye", source: "Ar8", materialCategory: "spell component"}],
		["craftingRecipe", {name: "Basilisk Burgers", source: "Arcadia11", recipeCategory: "dish"}],
	])("normalizes, validates, and serializes %s", (prop, entity) => {
		const draft = CraftingWorkbenchCore.createDraft(prop, {entity: {...entity, uniqueId: "stable-id", expertField: {kept: true}}});
		const validation = CraftingWorkbenchCore.validate(prop, draft);
		const serialized = CraftingWorkbenchCore.serialize(prop, draft);

		expect(validation.isValid).toBe(true);
		expect(serialized).toEqual(expect.objectContaining({
			...entity,
			uniqueId: "stable-id",
			expertField: {kept: true},
		}));
	});

	test.each([
		["itemMaterial", {effects: "bad", magicCapacityRules: {}, entries: false, degradation: []}, ["effects", "magicCapacityRules", "entries"]],
		["craftingMaterial", {entries: {}, effectTags: false, variantComponent: {spellEffects: "bad"}}, ["entries", "effectTags"]],
		["craftingRecipe", {ingredients: "bad", outcomes: [{tier: "success", entries: {}}], componentGroups: null}, ["ingredients", "componentGroups"]],
	])("normalizes malformed %s collections safely", (prop, malformed, emptyProps) => {
		const draft = CraftingWorkbenchCore.createDraft(prop, {source: "HB", entity: malformed});
		for (const emptyProp of emptyProps) expect(draft[emptyProp]).toEqual([]);
		expect(() => CraftingWorkbenchCore.validate(prop, draft)).not.toThrow();
		expect(() => CraftingWorkbenchCore.serialize(prop, draft)).not.toThrow();
	});

	test("deduplicates case-insensitive name/source identities", () => {
		expect(CraftingWorkbenchCore.dedupe([
			{name: "Mithril", source: "TGTT", marker: 1},
			{name: "mithril", source: "tgtt", marker: 2},
			{name: "Mithril", source: "ALT", marker: 3},
		])).toEqual([
			{name: "Mithril", source: "TGTT", marker: 1},
			{name: "Mithril", source: "ALT", marker: 3},
		]);
	});

	test("preserves copper-piece values without conversion", () => {
		const material = CraftingWorkbenchCore.createDraft("craftingMaterial", {
			entity: {name: "Ore", source: "HB", materialCategory: "mineral", value: 1500},
		});
		const recipe = CraftingWorkbenchCore.createDraft("craftingRecipe", {
			entity: {name: "Blade", source: "HB", recipeCategory: "item", value: 875},
		});
		expect(CraftingWorkbenchCore.serialize("craftingMaterial", material).value).toBe(1500);
		expect(CraftingWorkbenchCore.serialize("craftingRecipe", recipe).value).toBe(875);
	});

	test("round-trips ingredient alternatives", () => {
		const entity = {
			name: "Hide Armor",
			source: "HB",
			recipeCategory: "item",
			ingredients: [
				{name: "Ghast Hide", quantity: 1, isAlternative: true, alternativeGroup: "alt-0", alternativeIndex: 0},
				{name: "Ghoul Hide", quantity: 1, isAlternative: true, alternativeGroup: "alt-0", alternativeIndex: 1, expert: "kept"},
			],
		};
		expect(CraftingWorkbenchCore.serialize("craftingRecipe", entity).ingredients).toEqual(entity.ingredients);
	});

	test("round-trips nested variant component matches and effects", () => {
		const variantComponent = {
			harvestDC: 17,
			spellEffects: [{
				match: {damageType: "psychic", expertMatch: {level: 3}},
				description: "Strengthens the spell.",
				effects: [
					{type: "dieSizeIncrease", steps: 1, maxDie: "d12"},
					{type: "bonusDice", count: 3, expertEffect: true},
				],
				expertSpellEffect: "kept",
			}],
		};
		const entity = {
			name: "Aboleth Eye",
			source: "Ar8",
			materialCategory: "spell component",
			variantComponent,
		};
		expect(CraftingWorkbenchCore.serialize("craftingMaterial", entity).variantComponent).toEqual(variantComponent);
	});

	test("omits workbench-only state and preview prop while preserving canonical unknowns", () => {
		const serialized = CraftingWorkbenchCore.serialize("itemMaterial", {
			name: "Test",
			source: "HB",
			materialCategory: "metal",
			uniqueId: "uid",
			__prop: "itemMaterial",
			_ui: {tab: 2},
			unknownCanonical: {nested: true},
		});
		expect(serialized).toEqual(expect.objectContaining({uniqueId: "uid", unknownCanonical: {nested: true}}));
		expect(serialized).not.toHaveProperty("__prop");
		expect(serialized).not.toHaveProperty("_ui");
	});

	test("row helpers are pure and preserve unknown row fields", () => {
		const rows = [{type: "note", text: "One", unknown: true}];
		const added = CraftingWorkbenchCore.addRow(rows, {type: "bonusAc", value: 1});
		const updated = CraftingWorkbenchCore.updateRow(added, 0, {text: "Updated"});
		const moved = CraftingWorkbenchCore.moveRow(updated, 0, 1);
		const removed = CraftingWorkbenchCore.removeRow(moved, 0);

		expect(rows).toEqual([{type: "note", text: "One", unknown: true}]);
		expect(removed).toEqual([{type: "note", text: "Updated", unknown: true}]);
	});
});
