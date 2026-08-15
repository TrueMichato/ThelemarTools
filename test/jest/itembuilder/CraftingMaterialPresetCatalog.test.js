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
globalThis.DataUtil ||= {};
globalThis.DataUtil.cleanJson ||= entity => entity;

const {getCraftingMaterialPresetCatalog} = await import("../../../js/makebrew/makebrew-crafting-material.js");

describe("crafting material preset catalog", () => {
	test("merges site, Brew, and Arcadia presets without cross-source collisions", () => {
		const rows = getCraftingMaterialPresetCatalog({
			siteMaterials: [{name: "Moon Salt", source: "SITE"}],
			brewMaterials: [
				{name: "Moon Salt", source: "BREW"},
				{name: "moon salt", source: "brew"},
			],
			arcadiaItems: [{name: "Aboleth Eye", source: "Ar8"}],
		});

		expect(rows).toEqual([
			{kind: "material", entity: {name: "Moon Salt", source: "SITE"}},
			{kind: "material", entity: {name: "Moon Salt", source: "BREW"}},
			{kind: "arcadia", entity: {name: "Aboleth Eye", source: "Ar8"}},
		]);
	});
});
