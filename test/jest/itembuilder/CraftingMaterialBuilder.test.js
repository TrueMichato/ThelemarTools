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
const {CraftingMaterialBuilder} = await import("../../../js/makebrew/makebrew-crafting-material.js");

describe("CraftingMaterialBuilder", () => {
	test("registers one separate BuilderBase instance with the craftingMaterial prop", () => {
		const countBefore = BuilderBase._BUILDERS.length;
		const builder = new CraftingMaterialBuilder();

		expect(builder).toBeInstanceOf(CraftingWorkbenchBuilderBase);
		expect(BuilderBase._BUILDERS.slice(countBefore)).toEqual([builder]);
		expect(builder.prop).toBe("craftingMaterial");
		expect(BuilderBase._BUILDERS.filter(it => it === builder)).toHaveLength(1);
	});

	test("restores normalized canonical state and persistent validation state", () => {
		const builder = new CraftingMaterialBuilder();
		builder.setStateFromLoaded({
			s: {
				name: "Restored Component",
				source: "HB",
				materialCategory: "spell component",
				usedInRecipes: [{name: "Generated"}],
				uniqueId: "stable-id",
			},
			d: {
				name: "Restored Component",
				source: "HB",
				materialCategory: "spell component",
				variantComponent: {
					uses: {},
					spellEffects: [{match: {any: true}, effects: [{type: "noSlot", expert: true}]}],
				},
			},
			m: {
				isModified: true,
				isPersisted: false,
				nameOriginal: "Restored Component",
				styleHint: "classic",
			},
			w: {
				saveStatus: "Draft restored.",
				validation: {isValid: true, errors: [], warnings: []},
			},
		});

		const saved = builder.getSaveableState();
		expect(saved.s).toEqual(expect.objectContaining({name: "Restored Component", uniqueId: "stable-id"}));
		expect(saved.s).not.toHaveProperty("usedInRecipes");
		expect(saved.d.variantComponent.uses).toEqual([]);
		expect(saved.d.variantComponent.spellEffects[0].effects).toEqual([{type: "noSlot", expert: true}]);
		expect(saved.w.saveStatus).toBe("Draft restored.");
		expect(saved.w.validation.isValid).toBe(true);
	});

	test("copies an Arcadia preset without mutating it and retains the homebrew source", () => {
		const preset = {
			name: "Aboleth Eye",
			source: "Ar8",
			page: 15,
			value: 2500,
			weight: 0.5,
			rarity: "unknown",
			entries: ["Reference text."],
			uniqueId: "reference-id",
			variantComponent: {
				harvestDC: 17,
				harvestQuantity: "3 eyes",
				harvestSource: "Aboleth",
				harvestTime: "15 minutes",
				spellEffects: [{match: {spell: "legend lore|phb"}, effects: [{type: "text", text: "More lore."}]}],
			},
		};
		const snapshot = structuredClone(preset);
		const draft = CraftingMaterialBuilder.getDraftFromArcadiaPreset(preset, {source: "MYHB"});

		expect(preset).toEqual(snapshot);
		expect(draft).toEqual(expect.objectContaining({
			name: "Aboleth Eye",
			source: "MYHB",
			page: 15,
			materialCategory: "spell component",
			harvest: {
				dc: 17,
				quantity: 3,
				quantityUnit: "eyes",
				time: "15 minutes",
				creature: {name: "Aboleth"},
			},
			value: 2500,
			weight: 0.5,
			entries: ["Reference text."],
			spells: [{name: "legend lore", source: "phb"}],
			variantComponent: snapshot.variantComponent,
		}));
		expect(draft).not.toHaveProperty("uniqueId");
	});

	test("loads the read-only Arcadia catalog and deduplicates identities case-insensitively", async () => {
		const loadRawJSON = globalThis.DataUtil.loadRawJSON;
		let loadedUrl = null;
		globalThis.DataUtil.loadRawJSON = async url => {
			loadedUrl = url;
			return {
				item: [
					{name: "Aboleth Eye", source: "Ar8"},
					{name: "aboleth eye", source: "ar8"},
					{name: "Basilisk Eye", source: "Ar8"},
				],
			};
		};
		const builder = new CraftingMaterialBuilder();

		await builder._pInit();

		expect(loadedUrl).toBe("data/items-variant-components-ar8.json");
		expect(builder._arcadiaCatalog.map(it => it.name)).toEqual(["Aboleth Eye", "Basilisk Eye"]);
		globalThis.DataUtil.loadRawJSON = loadRawJSON;
	});

	test("creates a preview-only dispatch entity without persisting __prop", () => {
		const entity = {
			name: "Preview Component",
			source: "HB",
			materialCategory: "spell component",
			uniqueId: "uid",
		};
		const preview = CraftingMaterialBuilder.getPreviewEntity("craftingMaterial", entity);

		expect(preview).toEqual(expect.objectContaining({...entity, __prop: "craftingMaterial"}));
		expect(entity).not.toHaveProperty("__prop");

		const invalidPreview = CraftingMaterialBuilder.getPreviewEntity("craftingMaterial", {...entity, name: ""});
		expect(invalidPreview.name).toBe("Unnamed Crafting Material");
	});
});
