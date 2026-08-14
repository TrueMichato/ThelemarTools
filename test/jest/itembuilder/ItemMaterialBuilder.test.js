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
globalThis.RendererMarkdown ||= {get: () => ({render: ({entries}) => entries.join("\n")})};
globalThis.DataUtil ||= {};
globalThis.DataUtil.cleanJson ||= entity => entity;

const {BuilderBase} = await import("../../../js/makebrew/makebrew-builder-base.js");
const {CraftingWorkbenchBuilderBase} = await import("../../../js/makebrew/makebrew-crafting-workbench.js");
const {ItemMaterialBuilder} = await import("../../../js/makebrew/makebrew-item-material.js");
const {PropOrder} = await import("../../../js/utils-proporder.js");

describe("ItemMaterialBuilder", () => {
	test("registers as a separate BuilderBase instance with an independent prop", () => {
		const countBefore = BuilderBase._BUILDERS.length;
		const materialBuilder = new ItemMaterialBuilder();

		expect(materialBuilder).toBeInstanceOf(CraftingWorkbenchBuilderBase);
		expect(BuilderBase._BUILDERS.slice(countBefore)).toEqual([materialBuilder]);
		expect(materialBuilder.prop).toBe("itemMaterial");
		expect(BuilderBase._BUILDERS.filter(it => it === materialBuilder)).toHaveLength(1);
	});

	test("restores normalized canonical state and persistent validation state", () => {
		const builder = new ItemMaterialBuilder();
		builder.setStateFromLoaded({
			s: {
				name: "Restored Crystal",
				source: "HB",
				materialCategory: "crystal",
				effects: "malformed",
				uniqueId: "stable-id",
			},
			d: {
				name: "Restored Crystal",
				source: "HB",
				materialCategory: "crystal",
				effects: [{type: "countsAsMagical", unknown: true}],
				magicCapacityRules: {},
			},
			m: {
				isModified: true,
				isPersisted: false,
				nameOriginal: "Restored Crystal",
				styleHint: "classic",
			},
			w: {
				saveStatus: "Draft restored.",
				validation: {isValid: true, errors: [], warnings: []},
			},
		});

		const saved = builder.getSaveableState();
		expect(saved.s).toEqual(expect.objectContaining({name: "Restored Crystal", uniqueId: "stable-id", effects: []}));
		expect(saved.d.effects).toEqual([{type: "countsAsMagical", unknown: true}]);
		expect(saved.d.magicCapacityRules).toEqual([]);
		expect(saved.w.saveStatus).toBe("Draft restored.");
		expect(saved.w.validation.isValid).toBe(true);
	});

	test("creates a preview-only dispatch entity without persisting __prop", () => {
		const entity = {
			name: "Preview Metal",
			source: "HB",
			materialCategory: "metal",
			uniqueId: "uid",
		};
		const preview = ItemMaterialBuilder.getPreviewEntity("itemMaterial", entity);

		expect(preview).toEqual(expect.objectContaining({...entity, __prop: "itemMaterial"}));
		expect(entity).not.toHaveProperty("__prop");
	});

	test("supports canonical JSON ordering and Markdown export", () => {
		const builder = new ItemMaterialBuilder();
		const entity = {
			name: "Ordered Metal",
			source: "HB",
			materialCategory: "metal",
			entries: ["Description."],
			uniqueId: "ordered-id",
		};

		expect(PropOrder.hasOrder("itemMaterial")).toBe(true);
		expect(PropOrder.hasOrder("craftingMaterial")).toBe(true);
		expect(PropOrder.hasOrder("craftingRecipe")).toBe(true);
		expect(builder._getAsMarkdown(entity)).toContain("## Ordered Metal");
		expect(builder._getAsMarkdown(entity)).toContain("Description.");
	});
});
