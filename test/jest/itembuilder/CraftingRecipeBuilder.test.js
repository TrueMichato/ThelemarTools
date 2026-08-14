import "../charactersheet/setup.js";

globalThis.MiscUtil.throttle ||= fn => fn;
globalThis.MiscUtil.debounce ||= fn => fn;
globalThis.SortUtil ||= new Proxy({
	ascSort: (a, b) => `${a}`.localeCompare(`${b}`),
	ascSortLower: (a, b) => `${a}`.toLowerCase().localeCompare(`${b}`.toLowerCase()),
}, {
	get: (target, prop) => target[prop] || target.ascSort,
});
globalThis.BaseComponent ||= class {};
globalThis.ProxyBase ||= class {
	_getProxy (namespace, object) { return object; }
	_resetHooks () {}
	_addHook () { return () => {}; }
};
globalThis.TabUiUtil ||= {decorate: () => {}};
globalThis.CryptUtil ||= {uid: () => "generated-id"};
globalThis.StorageUtil.syncGet ||= () => null;
globalThis.StorageUtil.syncSet ||= () => {};
globalThis.Parser.getPropDisplayName ||= prop => prop;
globalThis.Parser.sourceJsonToFull ||= source => source;
globalThis.Parser.sourceJsonToAbv ||= source => source;
globalThis.RendererMarkdown ||= {get: () => ({render: ({entries}) => entries.join("\n")})};
globalThis.DataUtil ||= {};
globalThis.DataUtil.cleanJson ||= entity => entity;
globalThis.BrewUtil2 ||= {};

const {PropOrder} = await import("../../../js/utils-proporder.js");
const {BuilderBase} = await import("../../../js/makebrew/makebrew-builder-base.js");
const {CraftingWorkbenchBuilderBase} = await import("../../../js/makebrew/makebrew-crafting-workbench.js");
const {CraftingRecipeBuilder} = await import("../../../js/makebrew/makebrew-crafting-recipe.js");

describe("CraftingRecipeBuilder", () => {
	test("registers a separate BuilderBase instance and declares the complete recipe stages", () => {
		const countBefore = BuilderBase._BUILDERS.length;
		const builder = new CraftingRecipeBuilder();

		expect(builder).toBeInstanceOf(CraftingWorkbenchBuilderBase);
		expect(BuilderBase._BUILDERS.slice(countBefore)).toEqual([builder]);
		expect(builder.prop).toBe("craftingRecipe");
		expect(builder._getStageDefinitions().map(it => it.name)).toEqual([
			"Base",
			"Craft Requirements",
			"Ingredients",
			"Outcomes & Description",
			"Review & Save",
		]);
	});

	test("restores canonical recipe state, selected references, and persistent validation", () => {
		const builder = new CraftingRecipeBuilder();
		builder._materialCatalog = [{name: "Mithril", source: "TGTT"}];
		builder.setStateFromLoaded({
			s: {
				name: "Restored Blade",
				source: "HB",
				recipeCategory: "item",
				ingredients: [{name: "Mithril", uid: "mithril|tgtt", isAlternative: false, isInferred: true}],
				effectTags: ["generated"],
				uniqueId: "stable-id",
			},
			d: {
				name: "Restored Blade",
				source: "HB",
				recipeCategory: "item",
				ingredients: [{name: "Mithril", uid: "mithril|tgtt"}],
				outcomes: "bad",
			},
			m: {
				isModified: true,
				isPersisted: false,
				nameOriginal: "Restored Blade",
				styleHint: "classic",
			},
			w: {
				saveStatus: "Draft restored.",
				validation: {isValid: true, errors: [], warnings: []},
			},
		});

		const saved = builder.getSaveableState();
		expect(saved.s).toEqual(expect.objectContaining({
			name: "Restored Blade",
			ingredients: [{name: "Mithril", _materialRef: "mithril|tgtt"}],
			uniqueId: "stable-id",
		}));
		expect(saved.s).not.toHaveProperty("effectTags");
		expect(saved.d.ingredients[0]._materialRef).toBe("mithril|tgtt");
		expect(saved.d.outcomes).toEqual([]);
		expect(saved.w.saveStatus).toBe("Draft restored.");
		expect(saved.w.validation.isValid).toBe(true);
	});

	test("creates preview-only dispatch data without persisting __prop", () => {
		const entity = {
			name: "Preview Pie",
			source: "HB",
			recipeCategory: "dish",
			value: 125,
		};
		const preview = CraftingRecipeBuilder.getPreviewEntity("craftingRecipe", entity);

		expect(preview).toEqual({...entity, ingredients: [], outcomes: [], entries: [], __prop: "craftingRecipe"});
		expect(entity).not.toHaveProperty("__prop");
	});

	test("material catalog loader merges generated and installed Brew without duplicate identities", async () => {
		const generated = {
			craftingMaterial: [
				{name: "Mithril", source: "TGTT", marker: "generated"},
				{name: "Moonwater", source: "HB"},
			],
			craftingRecipe: [{name: "Pie", source: "HB"}],
		};
		const brew = {
			craftingMaterial: [
				{name: "mithril", source: "tgtt", marker: "brew duplicate"},
				{name: "Dragon Salt", source: "HB"},
			],
			craftingRecipe: [
				{name: "pie", source: "hb"},
				{name: "Tonic", source: "HB"},
			],
		};
		const originalLoader = globalThis.DataUtil.craftingMaterial;
		const originalBrewLoader = globalThis.BrewUtil2.pGetBrewProcessed;
		globalThis.DataUtil.craftingMaterial = {loadJSON: async () => generated};
		globalThis.BrewUtil2.pGetBrewProcessed = async () => brew;
		const builder = new CraftingRecipeBuilder();

		await builder._pInit();

		expect(builder._materialCatalog).toEqual([
			{name: "Mithril", source: "TGTT", marker: "generated"},
			{name: "Moonwater", source: "HB"},
			{name: "Dragon Salt", source: "HB"},
		]);
		expect(builder._recipeCatalog.map(it => it.name)).toEqual(["Pie", "Tonic"]);
		globalThis.DataUtil.craftingMaterial = originalLoader;
		globalThis.BrewUtil2.pGetBrewProcessed = originalBrewLoader;
	});

	test("shared PropOrder and Markdown exports accept serialized recipes", () => {
		const builder = new CraftingRecipeBuilder();
		const entity = {
			name: "Ordered Pie",
			source: "HB",
			recipeCategory: "dish",
			crafter: "Cook",
			value: 250,
			entries: ["A pie."],
			ingredients: [{name: "Flour", quantity: 1}],
			uniqueId: "pie-id",
		};
		const markdown = builder._getAsMarkdown(entity);

		expect(PropOrder.hasOrder("craftingRecipe")).toBe(true);
		expect(markdown).toContain("## Ordered Pie");
		expect(markdown).toContain("\"recipeCategory\": \"dish\"");
		expect(markdown).toContain("\"value\": 250");
	});
});
