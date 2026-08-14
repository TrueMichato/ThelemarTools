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
});
