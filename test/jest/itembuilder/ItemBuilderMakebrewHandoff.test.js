import "../charactersheet/setup.js";
import {jest} from "@jest/globals";
import {readFileSync} from "node:fs";

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
globalThis.StorageUtil.syncGet ||= () => null;
globalThis.StorageUtil.syncSet ||= () => {};
globalThis.Parser.getPropDisplayName ||= prop => prop;
globalThis.Parser.sourceJsonToFull ||= source => source;
globalThis.RendererMarkdown ||= {
	item: {getCompactRenderedString: item => item.name},
	get: () => ({render: value => JSON.stringify(value)}),
};
globalThis.Renderer.item ||= {
	pGetFluff: async () => null,
	getCompactRenderedString: item => item.name,
};
globalThis.DataUtil ||= {};
globalThis.DataUtil.cleanJson ||= entity => entity;
globalThis.BrewUtil2 ||= {};

const {ItemBuilderCore} = await import("../../../js/itembuilder/itembuilder-core.js");
const {BuilderUi} = await import("../../../js/makebrew/makebrew-builderui.js");
const {ItemBuilder, pConsumeItemBuilderHandoff} = await import("../../../js/makebrew/makebrew-item.js");

describe("Makebrew ItemBuilder Quick Forge handoff", () => {
	test("selects Item mode and consumes storage only once", async () => {
		let stored = {
			version: 1,
			draft: {item: {name: "One Shot", source: "HB", type: "W"}},
		};
		const storage = {
			pGet: jest.fn(async () => stored),
			pRemove: jest.fn(async () => {
				stored = null;
			}),
		};
		const ui = {pSetActiveBuilderById: jest.fn(async () => {})};
		const builder = {setStateFromHandoffResult: jest.fn()};

		await expect(pConsumeItemBuilderHandoff({ui, builder, storage})).resolves.toEqual(expect.objectContaining({status: "success"}));
		expect(ui.pSetActiveBuilderById).toHaveBeenCalledWith("itemBuilder");
		expect(builder.setStateFromHandoffResult).toHaveBeenCalledTimes(1);

		await expect(pConsumeItemBuilderHandoff({ui, builder, storage})).resolves.toEqual({status: "empty"});
		expect(ui.pSetActiveBuilderById).toHaveBeenCalledTimes(1);
		expect(builder.setStateFromHandoffResult).toHaveBeenCalledTimes(1);
	});

	test("restores the complete draft with a new ID and saves only local builder state", () => {
		const doSaveDebounced = jest.fn();
		const persistBrew = jest.fn();
		BrewUtil2.pPersistEditableBrewEntity = persistBrew;
		const uidOriginal = CryptUtil.uid;
		CryptUtil.uid = jest.fn(() => "new-makebrew-id");
		const builder = new ItemBuilder();
		builder.ui = {
			source: "HB",
			allSources: ["HB"],
			doSaveDebounced,
		};
		builder.renderInput = jest.fn();
		builder.renderOutput = jest.fn();
		builder._catalogs = {
			items: [{name: "Longsword", source: "PHB", type: "M", dmg1: "1d8"}],
			materials: [{name: "Starsteel", source: "TGTT", appliesTo: ["weapon"], entries: ["Material."]}],
			upgrades: [
				{name: "Balanced", source: "TCAH", upgradeType: ["WU:1"], entries: ["Upgrade."]},
				{name: "Journey", source: "TGTT", upgradeType: ["GS:R"], entries: ["Gemstone."]},
			],
		};
		const draft = {
			preset: {name: "Longsword", source: "PHB"},
			material: {name: "Starsteel", source: "TGTT"},
			upgrades: [{name: "Balanced", source: "TCAH"}],
			gemstone: {name: "Journey", source: "TGTT"},
			item: {
				name: "Restored Blade",
				source: "HB",
				type: "M",
				entries: ["Advanced item text."],
				bonusAc: 2,
				uniqueId: "old-panel-id",
			},
		};

		try {
			builder.setStateFromHandoffResult({status: "success", draft});
			const saved = builder.getSaveableState();
			expect(saved.d).toEqual(expect.objectContaining({
				preset: draft.preset,
				material: draft.material,
				upgrades: draft.upgrades,
				gemstone: draft.gemstone,
				item: expect.objectContaining({
					name: "Restored Blade",
					entries: ["Advanced item text."],
					bonusAc: 2,
					uniqueId: "new-makebrew-id",
				}),
			}));
			expect(saved.s.uniqueId).toBe("new-makebrew-id");
			expect(saved.m).toEqual(expect.objectContaining({isModified: true, isPersisted: false}));
			expect(builder._saveStatus).toMatch(/restored/i);
			expect(builder.renderInput).toHaveBeenCalledTimes(1);
			expect(builder.renderOutput).toHaveBeenCalledTimes(1);
			expect(doSaveDebounced).toHaveBeenCalledTimes(1);
			expect(persistBrew).not.toHaveBeenCalled();
		} finally {
			CryptUtil.uid = uidOriginal;
		}
	});

	test("surfaces malformed handoff cleanup guidance without replacing the local draft", () => {
		const builder = new ItemBuilder();
		builder.ui = {source: "HB", allSources: ["HB"], doSaveDebounced: jest.fn()};
		builder.renderInput = jest.fn();
		builder.renderOutput = jest.fn();
		const originalName = builder.__state.name;

		builder.setStateFromHandoffResult({
			status: "error",
			message: "Quick Forge handoff ignored. Return to the DM Screen and try again.",
		});

		expect(builder.__state.name).toBe(originalName);
		expect(builder._saveStatus).toMatch(/try again/i);
		expect(builder.renderInput).toHaveBeenCalledTimes(1);
	});

	test("loads and renders a canonical boolean-focus item without lossy conversion", async () => {
		const items = JSON.parse(readFileSync(new URL("../../../data/items.json", import.meta.url))).item;
		const ruby = items.find(it => it.name === "Ruby of the War Mage" && it.source === "XDMG");
		const builder = new ItemBuilder();
		builder.ui = {source: "HB", allSources: ["HB"], doSaveDebounced: jest.fn()};
		builder._catalogs.items = [ruby];
		builder.renderInput = jest.fn();
		builder.renderOutput = jest.fn();

		await builder.pHandleLoadExistingData(ruby);

		expect(builder._draft.item.focus).toBe(true);
		expect(builder.__state.focus).toBe(true);
		const boolSpy = jest.spyOn(BuilderUi, "getStateIptBoolean").mockReturnValue({appendTo: jest.fn()});
		const stringsSpy = jest.spyOn(BuilderUi, "getStateIptStringArray").mockReturnValue({appendTo: jest.fn()});
		const eeOriginal = globalThis.ee;
		globalThis.ee = () => ({appendTo: jest.fn()});
		try {
			expect(() => builder._renderSpellcastingFocus({wrp: {}, cb: jest.fn()})).not.toThrow();
			expect(boolSpy).toHaveBeenCalledWith(
				"Universal Spellcasting Focus",
				expect.any(Function),
				{isUniversal: true},
				{nullable: false},
				"isUniversal",
			);
			expect(stringsSpy).not.toHaveBeenCalled();
			expect(ItemBuilderCore.serialize(ItemBuilderCore.fromItem(builder.__state), builder._catalogs).focus).toBe(true);
		} finally {
			globalThis.ee = eeOriginal;
			boolSpy.mockRestore();
			stringsSpy.mockRestore();
		}
	});

	test("synchronizes a pending debounced field before immediate Save persistence", async () => {
		jest.useFakeTimers();
		const debounceOriginal = MiscUtil.debounce;
		MiscUtil.debounce = fn => {
			let timerId = null;
			const debounced = (...args) => timerId = setTimeout(() => fn(...args), 33);
			debounced.cancel = () => clearTimeout(timerId);
			return debounced;
		};
		const persist = jest.fn(async () => {});
		BrewUtil2.pPersistEditableBrewEntity = persist;
		const builder = new ItemBuilder();
		builder.ui = {source: "HB", allSources: ["HB"], doSaveDebounced: jest.fn()};
		builder.renderOutput = jest.fn();
		builder._catalogs = {
			items: [{name: "Longsword", source: "PHB", type: "M", dmg1: "1d8"}],
			materials: [],
			upgrades: [{name: "Balanced", source: "TCAH", upgradeType: ["WU:1"], entries: ["Upgrade."]}],
		};
		builder._draft = ItemBuilderCore.applyPreset(
			ItemBuilderCore.createDraft({source: "HB"}),
			builder._catalogs.items[0],
			{source: "HB"},
		);
		builder._draft.upgrades = [{name: "Balanced", source: "TCAH"}];
		builder._draft.item.name = "Before";
		builder.__state = {...ItemBuilderCore.serialize(builder._draft, builder._catalogs), uniqueId: "item-id"};
		builder.__meta = {isModified: true, isPersisted: true, nameOriginal: "Before"};
		builder._state = builder.__state;
		builder._meta = builder.__meta;
		const cb = builder._getCb();
		builder._cbCache = cb;

		try {
			builder._draft.item.name = "After";
			cb();
			await builder.pDoHandleClickSaveBrew();

			expect(persist).toHaveBeenCalledTimes(1);
			expect(persist).toHaveBeenCalledWith("item", expect.objectContaining({name: "After", uniqueId: "item-id"}));
			expect(persist.mock.calls[0][1]).toEqual(expect.objectContaining({
				baseItem: "Longsword|PHB",
				appliedUpgrades: [{name: "Balanced", source: "TCAH"}],
				dmg1: "1d8",
			}));
			expect(persist.mock.calls[0][1]).not.toHaveProperty("bonusWeaponAttack");
			expect(persist.mock.calls[0][1].entries || []).not.toContainEqual(expect.objectContaining({name: expect.stringMatching(/^Item Builder:/)}));
			jest.runOnlyPendingTimers();
			expect(persist).toHaveBeenCalledTimes(1);
			expect(builder._meta.isModified).toBe(false);
		} finally {
			MiscUtil.debounce = debounceOriginal;
			jest.useRealTimers();
		}
	});

	test("projects Markdown render and downloads while keeping JSON data canonical", async () => {
		const builder = new ItemBuilder();
		builder.ui = {source: "HB", allSources: ["HB"], doSaveDebounced: jest.fn(), _getJsonOutputTemplate: () => ({})};
		builder._catalogs = {
			items: [{name: "Longsword", source: "PHB", type: "M", weapon: true, dmg1: "1d8"}],
			materials: [{name: "Starsteel", source: "TGTT", appliesTo: ["weapon"], damage: 1, entries: ["Material."]}],
			upgrades: [{name: "Balanced", source: "TCAH", upgradeType: ["WU:1"], entries: ["Upgrade."]}],
		};
		const draft = ItemBuilderCore.applyPreset(ItemBuilderCore.createDraft({source: "HB"}), builder._catalogs.items[0], {source: "HB"});
		draft.item.name = "Markdown Blade";
		draft.material = {name: "Starsteel", source: "TGTT"};
		draft.upgrades = [{name: "Balanced", source: "TCAH"}];
		const canonical = {...ItemBuilderCore.serialize(draft, builder._catalogs), uniqueId: "markdown-id"};
		builder._draft = draft;
		builder.__state = canonical;

		const markdownRendererOriginal = RendererMarkdown.item.getCompactRenderedString;
		const markdownExportOriginal = RendererMarkdown.exporting?.pGetMarkdownDoc;
		const getEntityOriginal = BrewUtil2.pGetEditableBrewEntity;
		const sourceToFullOriginal = BrewUtil2.sourceJsonToFull;
		const cleanFilenameOriginal = DataUtil.getCleanFilename;
		const userDownloadOriginal = DataUtil.userDownload;
		const userDownloadTextOriginal = DataUtil.userDownloadText;
		RendererMarkdown.item.getCompactRenderedString = jest.fn(item => JSON.stringify(item));
		RendererMarkdown.exporting ||= {};
		RendererMarkdown.exporting.pGetMarkdownDoc = jest.fn(async ({ents}) => JSON.stringify(ents));
		BrewUtil2.pGetEditableBrewEntity = jest.fn(async () => canonical);
		BrewUtil2.sourceJsonToFull = source => source;
		DataUtil.getCleanFilename = value => value;
		DataUtil.userDownload = jest.fn();
		DataUtil.userDownloadText = jest.fn();
		builder._pGetBrewEntitiesCurrentSource = jest.fn(async () => [canonical]);

		try {
			const rendered = JSON.parse(builder._getAsMarkdown(canonical));
			expect(rendered).toEqual(expect.objectContaining({dmg1: "1d10", bonusWeaponAttack: 1}));
			expect(rendered.entries).toEqual(expect.arrayContaining([
				expect.objectContaining({name: "Item Builder: Material - Starsteel"}),
				expect.objectContaining({name: "Item Builder: Upgrade - Balanced"}),
			]));

			await builder.pHandleClick_downloadMarkdownUniqueId("markdown-id");
			expect(JSON.parse(DataUtil.userDownloadText.mock.calls[0][1])).toEqual(expect.objectContaining({
				dmg1: "1d10",
				bonusWeaponAttack: 1,
			}));

			await builder.pDoHandleClickDownloadMarkdown();
			expect(JSON.parse(DataUtil.userDownloadText.mock.calls[1][1])[0]).toEqual(expect.objectContaining({
				dmg1: "1d10",
				bonusWeaponAttack: 1,
			}));

			await builder.pHandleClick_downloadJsonUniqueId("markdown-id");
			const jsonItem = DataUtil.userDownload.mock.calls[0][1].item[0];
			expect(jsonItem).toEqual(expect.objectContaining({
				dmg1: "1d8",
				material: {name: "Starsteel", source: "TGTT"},
				appliedUpgrades: [{name: "Balanced", source: "TCAH"}],
			}));
			expect(jsonItem).not.toHaveProperty("bonusWeaponAttack");
			expect(jsonItem.entries || []).not.toContainEqual(expect.objectContaining({name: expect.stringMatching(/^Item Builder:/)}));
		} finally {
			RendererMarkdown.item.getCompactRenderedString = markdownRendererOriginal;
			if (markdownExportOriginal) RendererMarkdown.exporting.pGetMarkdownDoc = markdownExportOriginal;
			else delete RendererMarkdown.exporting.pGetMarkdownDoc;
			BrewUtil2.pGetEditableBrewEntity = getEntityOriginal;
			BrewUtil2.sourceJsonToFull = sourceToFullOriginal;
			DataUtil.getCleanFilename = cleanFilenameOriginal;
			DataUtil.userDownload = userDownloadOriginal;
			DataUtil.userDownloadText = userDownloadTextOriginal;
		}
	});
});
