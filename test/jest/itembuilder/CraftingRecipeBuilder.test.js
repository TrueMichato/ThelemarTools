import "../charactersheet/setup.js";
import {jest} from "@jest/globals";

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
const {CraftingWorkbenchCore} = await import("../../../js/itembuilder/crafting-workbench-core.js");
const {RenderCrafting} = await import("../../../js/render-crafting.js");
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

	test("models custom attunement text and varies rarity for requirements controls", () => {
		expect(CraftingWorkbenchCore.VOCABULARY.rarities).toContain("varies");
		expect(CraftingRecipeBuilder.getAttunementMode("by a spellcaster")).toBe("custom");

		const entity = {reqAttune: "by a spellcaster"};
		CraftingRecipeBuilder.setAttunementMode(entity, "custom");
		expect(entity.reqAttune).toBe("by a spellcaster");
		CraftingRecipeBuilder.setAttunementMode(entity, "true");
		expect(entity.reqAttune).toBe(true);
		CraftingRecipeBuilder.setAttunementMode(entity, "custom");
		expect(entity.reqAttune).toBe("");
	});

	test("keeps malformed advanced category and rarity errors while falling back review preview", () => {
		const builder = new CraftingRecipeBuilder();
		builder._draft = CraftingWorkbenchCore.normalize("craftingRecipe", {
			name: "Malformed Tonic",
			source: "HB",
			recipeCategory: {value: "potion"},
			rarity: ["rare"],
		});
		const getElement = () => {
			const out = globalThis.e_({});
			out.appendTo = parent => { parent.append(out); return out; };
			out.empty = () => { out._children = []; out._html = ""; return out; };
			out.attr = () => out;
			out.prop = () => out;
			out.txt = value => { out.textContent = value; return out; };
			out.val = () => "";
			out.onn = () => out;
			out.appends = (...children) => { out.append(...children); return out; };
			return out;
		};
		const eeOriginal = globalThis.ee;
		const qqOriginal = String.prototype.qq;
		globalThis.ee = getElement;
		String.prototype.qq ||= function () { return `${this}`; };
		builder._wrpValidation = getElement();
		builder._wrpReview = getElement();
		const renderSpy = jest.spyOn(RenderCrafting, "getRenderedCrafting");

		try {
			expect(() => builder._refreshValidation()).not.toThrow();
			expect(builder._validation.errors).toEqual(expect.arrayContaining([
				expect.objectContaining({field: "recipeCategory"}),
				expect.objectContaining({field: "rarity"}),
			]));
			expect(builder._getDisplayText(builder._draft.recipeCategory, {fallback: "No category", isTitleCase: true})).toBe("No category");
			expect(builder._getDisplayText(builder._draft.rarity, {fallback: "No rarity", isTitleCase: true})).toBe("No rarity");
			expect(() => builder._renderReviewContent()).not.toThrow();
			expect(renderSpy).not.toHaveBeenCalled();
		} finally {
			renderSpy.mockRestore();
			globalThis.ee = eeOriginal;
			if (qqOriginal) String.prototype.qq = qqOriginal;
			else delete String.prototype.qq;
		}
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
