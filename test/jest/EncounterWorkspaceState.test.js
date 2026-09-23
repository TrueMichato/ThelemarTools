import {jest} from "@jest/globals";
import {
	EncounterWorkspaceState,
	EncounterWorkspaceStore,
	pResolveSavedBestiaryItem,
} from "../../js/encounterworkspace/encounterworkspace-state.js";

const getMonster = (name = "Goblin") => ({
	name,
	source: "MM",
	cr: "1/4",
	hp: {average: 7, formula: "2d6"},
	action: [{name: "Scimitar", entries: ["Hit."]}],
});

const getList = (items = []) => ({name: "Goblin Ambush", saveId: "saved-list-1", items});
const getUid = () => {
	let ix = 0;
	return () => `encounter-${++ix}`;
};

const getStorage = () => {
	const values = new Map();
	return {
		values,
		pGetForPage: jest.fn(async (key, {page}) => values.get(`${key}_${page}`)),
		pSetForPage: jest.fn(async (key, value, {page}) => values.set(`${key}_${page}`, value)),
	};
};

describe("Encounter Workspace working copy", () => {
	it("uses the saved-list resolver with the exact count and scaling hash", async () => {
		const original = globalThis.ListUtil;
		const urlUtil = globalThis.UrlUtil;
		globalThis.ListUtil = {
			pGetSublistEntities_fromHover: jest.fn(async ({exportedSublist}) => [{
				entity: {...getMonster(), cr: "2", _scaledCr: 2},
				count: Number(exportedSublist.items[0].c),
			}]),
		};
		globalThis.UrlUtil = {PG_BESTIARY: "bestiary.html"};
		try {
			const item = {h: "goblin_mm", c: "2", customHashId: "goblin__mm__2__"};
			const result = await pResolveSavedBestiaryItem(item);
			expect(result.entity.cr).toBe("2");
			expect(globalThis.ListUtil.pGetSublistEntities_fromHover).toHaveBeenCalledWith({
				exportedSublist: {items: [item]},
				page: "bestiary.html",
			});
		} finally {
			globalThis.ListUtil = original;
			globalThis.UrlUtil = urlUtil;
		}
	});

	it("expands counted and scaled duplicates into unique IDs and independent frozen snapshots", async () => {
		const source = getMonster();
		const items = [
			{h: "goblin_mm", c: "2"},
			{h: "goblin_mm", c: 1, customhashid: "goblin__mm__2__"},
		];
		const seen = [];
		const result = await EncounterWorkspaceState.pFromSavedList({
			exportedSublist: getList(items),
			fnUid: getUid(),
			pResolveItem: async item => {
				seen.push(item);
				return {entity: item.customhashid ? {...source, cr: "2", _scaledCr: 2} : source};
			},
		});
		expect(seen).toEqual(items);
		expect(result.instances.map(it => it.id)).toEqual(["encounter-1", "encounter-2", "encounter-3"]);
		expect(result.instances.map(it => it.monster.cr)).toEqual(["1/4", "1/4", "2"]);
		expect(result.instances[2].customHashId).toBe("goblin__mm__2__");
		expect(result.selectedIds).toEqual(result.instances.map(it => it.id));
		expect(result.instances[0].monster).not.toBe(result.instances[1].monster);
		expect(result.instances[0].monster.action).not.toBe(result.instances[1].monster.action);
		source.action[0].entries[0] = "Source changed";
		expect(result.instances[0].monster.action[0].entries[0]).toBe("Hit.");
		expect(Object.isFrozen(result.instances[0].monster.action[0])).toBe(true);
	});

	it("loads resolvable entries while reporting missing sources, scaling failures, and invalid counts", async () => {
		const state = await EncounterWorkspaceState.pFromSavedList({
			exportedSublist: getList([
				{h: "goblin_mm", c: 2},
				{h: "missing_homebrew", c: 1},
				{h: "goblin_mm", c: 1, customHashId: "invalid-scale"},
				{h: "bad_count", c: -1},
			]),
			pResolveItem: async item => {
				if (item.h === "missing_homebrew") return null;
				if (item.customHashId) throw new Error("Unsupported scaling context");
				return {entity: getMonster()};
			},
			fnUid: getUid(),
		});
		expect(state.instances).toHaveLength(2);
		expect(state.omissions).toEqual([
			{hash: "missing_homebrew", reason: "Creature or source not available"},
			{hash: "goblin_mm", reason: "Unsupported scaling context"},
			{hash: "bad_count", reason: "Invalid or unsupported count: -1"},
		]);
	});

	it("keeps a named empty roster and omissions across reload without needing source data", async () => {
		const storage = getStorage();
		const store = new EncounterWorkspaceStore({storage});
		const empty = await EncounterWorkspaceState.pFromSavedList({
			exportedSublist: getList([{h: "removed_source", c: 3}]),
			pResolveItem: async () => null,
		});
		await store.pSave(empty);
		const restored = await store.pLoad();
		expect(restored.sourceList.name).toBe("Goblin Ambush");
		expect(restored.instances).toEqual([]);
		expect(restored.omissions).toEqual([{hash: "removed_source", reason: "Creature or source not available"}]);
		expect(storage.pSetForPage).toHaveBeenCalledWith("encounterWorkspaceState", expect.anything(), {page: "encounterworkspace.html"});
		expect(storage.pSetForPage).not.toHaveBeenCalledWith("listSaveManager", expect.anything(), {page: "bestiary.html"});
	});

	it("reports an oversized count instead of partially expanding an entry", async () => {
		const resolve = jest.fn(async () => ({entity: getMonster()}));
		const state = await EncounterWorkspaceState.pFromSavedList({
			exportedSublist: getList([{h: "too_many_mm", c: 1001}, {h: "goblin_mm", c: 1}]),
			pResolveItem: resolve,
			fnUid: getUid(),
		});
		expect(state.instances).toHaveLength(1);
		expect(state.omissions).toEqual([{hash: "too_many_mm", reason: "Invalid or unsupported count: 1001"}]);
		expect(resolve).toHaveBeenCalledTimes(1);
	});

	it("persists individual target choices, leaving other instances untouched", async () => {
		const store = new EncounterWorkspaceStore({storage: getStorage()});
		const state = await EncounterWorkspaceState.pFromSavedList({
			exportedSublist: getList([{h: "goblin_mm", c: 2}]),
			pResolveItem: async () => ({entity: getMonster()}),
			fnUid: getUid(),
		});
		await store.pSave(EncounterWorkspaceState.withTarget(state, {id: "encounter-1", isSelected: false}));
		const restored = await store.pLoad();
		expect(restored.selectedIds).toEqual(["encounter-2"]);
		expect(restored.instances.map(it => it.id)).toEqual(["encounter-1", "encounter-2"]);
		expect(Object.isFrozen(restored.instances[0].monster)).toBe(true);
	});

	it("confirms before replacing even an empty encounter; cancellation never writes", async () => {
		const storage = getStorage();
		const store = new EncounterWorkspaceStore({storage});
		const current = await EncounterWorkspaceState.pFromSavedList({exportedSublist: getList()});
		const pConfirm = jest.fn(async () => false);
		const pResolveItem = jest.fn();
		const unchanged = await store.pReplace({
			currentState: current,
			exportedSublist: {name: "Other saved list", saveId: "save-2", items: [{h: "new_mm"}]},
			pConfirm,
			pResolveItem,
		});
		expect(unchanged).toBe(current);
		expect(pConfirm).toHaveBeenCalledTimes(1);
		expect(pResolveItem).not.toHaveBeenCalled();
		expect(storage.pSetForPage).not.toHaveBeenCalled();

		const replaced = await store.pReplace({
			currentState: current,
			exportedSublist: {name: "Other saved list", saveId: "save-2", items: []},
			pConfirm: async () => true,
		});
		expect(replaced.sourceList.name).toBe("Other saved list");
		expect(replaced.instances).toEqual([]);
	});

	it("does not accept invalid or unsupported persisted data, or silently erase it", async () => {
		const storage = getStorage();
		const store = new EncounterWorkspaceStore({storage});
		storage.values.set("encounterWorkspaceState_encounterworkspace.html", {version: 2, instances: []});
		await expect(store.pLoad()).rejects.toThrow(/unsupported version/);
		expect(storage.pSetForPage).not.toHaveBeenCalled();
		await expect(store.pSave({
			...EncounterWorkspaceState.getEmpty(),
			instances: [{id: "same", hash: "goblin_mm", monster: getMonster()}, {id: "same", hash: "goblin_mm", monster: getMonster()}],
		})).rejects.toThrow(/invalid monster instance/);
		expect(storage.pSetForPage).not.toHaveBeenCalled();
	});

	it("preserves the current state when saving the replacement fails", async () => {
		const storage = getStorage();
		storage.pSetForPage.mockRejectedValue(new Error("Storage unavailable"));
		const store = new EncounterWorkspaceStore({storage});
		const current = EncounterWorkspaceState.getEmpty();
		await expect(store.pReplace({currentState: current, exportedSublist: getList(), pConfirm: async () => true}))
			.rejects.toThrow("Storage unavailable");
		expect(current).toEqual(EncounterWorkspaceState.getEmpty());
	});
});
