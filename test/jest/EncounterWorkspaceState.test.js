import {jest} from "@jest/globals";
import {
	EncounterWorkspaceState,
	EncounterWorkspaceStore,
	pResolveSavedBestiaryItem,
} from "../../js/encounterworkspace/encounterworkspace-state.js";
import {
	getEncounterIsUndead,
	getEncounterModifierForPreset,
} from "../../js/encounterworkspace/encounterworkspace-effects.js";

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

	it("changes only selected instance conditions and keeps identical monsters independent across reload", async () => {
		const storage = getStorage();
		const store = new EncounterWorkspaceStore({storage});
		const initial = await EncounterWorkspaceState.pFromSavedList({
			exportedSublist: getList([{h: "goblin_mm", c: 2}]),
			pResolveItem: async () => ({entity: getMonster()}),
			fnUid: getUid(),
		});
		const oneSelected = EncounterWorkspaceState.withTarget(initial, {id: "encounter-2", isSelected: false});
		const poisoned = EncounterWorkspaceState.withConditions(oneSelected, {condition: " Poisoned ", isAdd: true});
		expect(oneSelected.instances.map(it => it.conditions)).toEqual([[], []]);
		expect(poisoned.instances.map(it => it.conditions)).toEqual([["poisoned"], []]);
		expect(poisoned.selectedIds).toEqual(["encounter-1"]);
		const secondPoisoned = EncounterWorkspaceState.withConditions(poisoned, {condition: "poisoned", isAdd: true, targetIds: ["encounter-2"]});
		expect(secondPoisoned.selectedIds).toEqual(["encounter-1"]);
		expect(secondPoisoned.instances.map(it => it.conditions)).toEqual([["poisoned"], ["poisoned"]]);
		const removed = EncounterWorkspaceState.withConditions(secondPoisoned, {condition: "poisoned", isAdd: false});
		await store.pSave(removed);
		const restored = await store.pLoad();
		expect(restored.version).toBe(4);
		expect(restored.instances.map(it => it.conditions)).toEqual([[], ["poisoned"]]);
		expect(restored.instances.map(it => it.areaNotes)).toEqual([[], []]);
		expect(restored.instances.map(it => it.modifiers)).toEqual([[], []]);
		expect(restored.instances[0].monster).toEqual(initial.instances[0].monster);
		expect(Object.isFrozen(restored.instances[0].monster.action[0])).toBe(true);
		expect(storage.pSetForPage).toHaveBeenCalledWith("encounterWorkspaceState", expect.anything(), {page: "encounterworkspace.html"});
		expect(storage.pSetForPage).not.toHaveBeenCalledWith("listSaveManager", expect.anything(), {page: "bestiary.html"});
	});

	it("migrates v1 and v2 saves without writes, then preserves conditions absent from the source catalog", async () => {
		const storage = getStorage();
		const store = new EncounterWorkspaceStore({storage});
		const state = await EncounterWorkspaceState.pFromSavedList({
			exportedSublist: getList([{h: "goblin_mm", c: 1}]),
			pResolveItem: async () => ({entity: getMonster()}),
			fnUid: getUid(),
		});
		const legacy = structuredClone(state);
		legacy.version = 1;
		delete legacy.instances[0].conditions;
		storage.values.set("encounterWorkspaceState_encounterworkspace.html", legacy);
		const loaded = await store.pLoad();
		expect(loaded.version).toBe(4);
		expect(loaded.instances[0].conditions).toEqual([]);
		expect(loaded.instances[0].areaNotes).toEqual([]);
		expect(loaded.instances[0].modifiers).toEqual([]);
		expect(storage.pSetForPage).not.toHaveBeenCalled();
		const conditioned = EncounterWorkspaceState.withConditions(loaded, {condition: "Dreambound", isAdd: true});
		await store.pSave(conditioned);
		expect((await store.pLoad()).instances[0].conditions).toEqual(["dreambound"]);

		const v2 = structuredClone(conditioned);
		v2.version = 2;
		delete v2.instances[0].areaNotes;
		delete v2.instances[0].modifiers;
		storage.values.set("encounterWorkspaceState_encounterworkspace.html", v2);
		storage.pSetForPage.mockClear();
		const upgraded = await store.pLoad();
		expect(upgraded).toMatchObject({version: 4, selectedIds: state.selectedIds, omissions: state.omissions, sourceList: state.sourceList});
		expect(upgraded.instances[0]).toMatchObject({conditions: ["dreambound"], areaNotes: [], modifiers: []});
		expect(storage.pSetForPage).not.toHaveBeenCalled();
	});

	it("persists independently removable area and manual lair notes on selected duplicate monsters", async () => {
		const store = new EncounterWorkspaceStore({storage: getStorage()});
		const initial = await EncounterWorkspaceState.pFromSavedList({
			exportedSublist: getList([{h: "goblin_mm", c: 2}]),
			pResolveItem: async () => ({entity: getMonster()}),
			fnUid: getUid(),
		});
		const note = {id: "note-a", kind: "trait", name: "Ash clouds", description: "<img src=x onerror=alert(1)>"};
		const onlyFirst = EncounterWorkspaceState.withTarget(initial, {id: "encounter-2", isSelected: false});
		const {state: noted, changedIds} = EncounterWorkspaceState.withAreaNote(onlyFirst, {note, isAdd: true});
		expect(changedIds).toEqual(["encounter-1"]);
		expect(onlyFirst.instances.map(it => it.areaNotes)).toEqual([[], []]);
		expect(noted.instances.map(it => it.areaNotes)).toEqual([[note], []]);
		const lair = {id: "note-b", kind: "lair", name: "Bell tolls", description: "Manual reminder; no automatic dice."};
		const {state: bothNoted} = EncounterWorkspaceState.withAreaNote(noted, {note: lair, isAdd: true, targetIds: ["encounter-1", "encounter-2"]});
		const {state: removed} = EncounterWorkspaceState.withAreaNote(bothNoted, {noteId: lair.id, isAdd: false, targetIds: ["encounter-1"]});
		await store.pSave(removed);
		const restored = await store.pLoad();
		expect(restored.instances.map(it => it.areaNotes)).toEqual([[note], [lair]]);
		expect(restored.selectedIds).toEqual(["encounter-1"]);
		expect(restored.instances[0].monster).toEqual(initial.instances[0].monster);
		expect(Object.isFrozen(restored.instances[0].monster.action[0])).toBe(true);
	});

	it("applies the selected Desecrated Ground variant only to actual undead and replaces the other", async () => {
		const monsters = [
			{...getMonster("Skeleton"), type: "undead"},
			{...getMonster("Wight"), type: {type: "undead", tags: ["wizard"]}},
			{...getMonster("Necromancer"), type: {type: "humanoid", tags: ["undead"]}},
			{...getMonster("Zombie"), type: "undead"},
		];
		const state = await EncounterWorkspaceState.pFromSavedList({
			exportedSublist: getList(monsters.map((it, i) => ({h: `monster-${i}`, c: 1}))),
			fnUid: getUid(),
			pResolveItem: async item => ({entity: monsters[Number(item.h.at(-1))]}),
		});
		const unselected = EncounterWorkspaceState.withTarget(state, {id: "encounter-4", isSelected: false});
		const dmg = getEncounterModifierForPreset("desecrated-dmg");
		const first = EncounterWorkspaceState.withModifier(unselected, {modifier: dmg, isAdd: true});
		expect(first.changedIds).toEqual(["encounter-1", "encounter-2"]);
		expect(first.skippedIds).toEqual(["encounter-3"]);
		expect(first.state.instances.map(it => it.modifiers)).toEqual([[dmg], [dmg], [], []]);
		expect(getEncounterIsUndead(monsters[0])).toBe(true);
		expect(getEncounterIsUndead(monsters[1])).toBe(true);
		expect(getEncounterIsUndead(monsters[2])).toBe(false);
		const house = getEncounterModifierForPreset("desecrated-house");
		const switched = EncounterWorkspaceState.withModifier(first.state, {modifier: house, isAdd: true, targetIds: ["encounter-1", "encounter-3"]});
		expect(switched.changedIds).toEqual(["encounter-1"]);
		expect(switched.skippedIds).toEqual(["encounter-3"]);
		expect(switched.state.instances.map(it => it.modifiers)).toEqual([[house], [dmg], [], []]);
		const repeated = EncounterWorkspaceState.withModifier(switched.state, {modifier: house, isAdd: true, targetIds: ["encounter-1"]});
		expect(repeated.changedIds).toEqual([]);
		const {state: removed} = EncounterWorkspaceState.withModifier(switched.state, {modifierId: house.id, isAdd: false, targetIds: ["encounter-1"]});
		expect(removed.instances.map(it => it.modifiers)).toEqual([[], [dmg], [], []]);
	});

	it("rejects malformed v3 effects, imprecise bonuses and tampered preset scopes", async () => {
		const state = await EncounterWorkspaceState.pFromSavedList({
			exportedSublist: getList([{h: "goblin_mm"}]),
			pResolveItem: async () => ({entity: getMonster()}),
			fnUid: getUid(),
		});
		const modifier = {id: "dm:1", name: "Blessing", scopes: ["check", "save"], mode: "normal", bonus: 2};
		for (const bad of [
			{...modifier, bonus: Infinity},
			{...modifier, bonus: 0.5},
			{...modifier, bonus: Number.MAX_SAFE_INTEGER + 1},
			{...modifier, scopes: []},
			{...modifier, mode: "normal", bonus: 0},
			{...getEncounterModifierForPreset("desecrated-dmg"), scopes: ["check", "save"]},
			{...modifier, presetId: "unrecognized"},
		]) {
			expect(() => EncounterWorkspaceState.withModifier(state, {modifier: bad, isAdd: true})).toThrow();
		}
		expect(() => EncounterWorkspaceState.validate({...state, instances: [{...state.instances[0], areaNotes: null}]}))
			.toThrow(/invalid monster instance/);
		expect(() => EncounterWorkspaceState.withAreaNote(state, {
			note: {id: "x", kind: "lair", name: "   ", description: "note"},
			isAdd: true,
		})).toThrow(/area note/);
		expect(state.instances[0]).toMatchObject({areaNotes: [], modifiers: []});
	});

	it("loads v3/v4 saved presets without rewriting storage, preserves notes, and rejects forged catalog metadata", async () => {
		const storage = getStorage();
		const store = new EncounterWorkspaceStore({storage});
		const base = await EncounterWorkspaceState.pFromSavedList({
			exportedSublist: getList([{h: "skeleton_mm"}]),
			pResolveItem: async () => ({entity: {...getMonster("Skeleton"), type: "undead"}}),
			fnUid: getUid(),
		});
		const old = {...getEncounterModifierForPreset("desecrated-dmg")};
		delete old.source;
		delete old.page;
		delete old.edition;
		const note = {id: "note", kind: "lair", name: "Bell", description: "Manual reminder"};
		for (const version of [3, 4]) {
			const legacy = structuredClone(base);
			legacy.version = version;
			legacy.instances[0].modifiers = [old];
			legacy.instances[0].areaNotes = [note];
			if (version === 3) {
				delete legacy.instances[0].hp;
				delete legacy.instances[0].initiative;
				delete legacy.turn;
			}
			storage.values.set("encounterWorkspaceState_encounterworkspace.html", legacy);
			const loaded = await store.pLoad();
			expect(loaded.instances[0].modifiers).toEqual([getEncounterModifierForPreset("desecrated-dmg")]);
			expect(loaded.instances[0].areaNotes).toEqual([note]);
			expect(storage.pSetForPage).not.toHaveBeenCalled();
		}
		for (const tampered of [
			{...getEncounterModifierForPreset("heavy-precipitation-xdmg"), page: 70},
			{...getEncounterModifierForPreset("heavy-precipitation-xdmg"), source: "House rule"},
			{...getEncounterModifierForPreset("heavy-precipitation-xdmg"), scopes: ["attack"]},
			{...getEncounterModifierForPreset("heavy-precipitation-xdmg"), bonus: 2},
		]) {
			expect(() => EncounterWorkspaceState.withModifier(base, {modifier: tampered, isAdd: true})).toThrow();
		}
		for (const presetId of ["heavy-precipitation-xdmg", "blizzard-idrotf", "ioun-dark-blue-rhomboid"]) {
			const uncited = {...getEncounterModifierForPreset(presetId)};
			delete uncited.source;
			delete uncited.page;
			delete uncited.edition;
			expect(() => EncounterWorkspaceState.withModifier(base, {modifier: uncited, isAdd: true})).toThrow(/cited source/);
			expect(() => EncounterWorkspaceState.validate({
				...base,
				instances: [{...base.instances[0], modifiers: [uncited]}],
			})).toThrow(/cited source/);
		}
	});

	it("stacks different cited presets but replaces only the other Desecrated Ground variant", async () => {
		const base = await EncounterWorkspaceState.pFromSavedList({
			exportedSublist: getList([{h: "skeleton_mm"}]),
			pResolveItem: async () => ({entity: {...getMonster("Skeleton"), type: "undead"}}),
			fnUid: getUid(),
		});
		const dmg = getEncounterModifierForPreset("desecrated-dmg");
		const weather = getEncounterModifierForPreset("heavy-precipitation-xdmg");
		const house = getEncounterModifierForPreset("desecrated-house");
		const withDmg = EncounterWorkspaceState.withModifier(base, {modifier: dmg, isAdd: true}).state;
		const withWeather = EncounterWorkspaceState.withModifier(withDmg, {modifier: weather, isAdd: true}).state;
		expect(withWeather.instances[0].modifiers).toEqual([dmg, weather]);
		const switched = EncounterWorkspaceState.withModifier(withWeather, {modifier: house, isAdd: true});
		expect(switched.state.instances[0].modifiers).toEqual([weather, house]);
		expect(EncounterWorkspaceState.withModifier(switched.state, {modifier: house, isAdd: true}).changedIds).toEqual([]);
	});

	it("does not publish changes to working state if effect persistence fails", async () => {
		const storage = getStorage();
		const store = new EncounterWorkspaceStore({storage});
		const initial = await EncounterWorkspaceState.pFromSavedList({
			exportedSublist: getList([{h: "skeleton_mm", c: 2}]),
			pResolveItem: async () => ({entity: {...getMonster("Skeleton"), type: "undead"}}),
			fnUid: getUid(),
		});
		storage.pSetForPage.mockRejectedValue(new Error("Storage full"));
		const note = {id: "note", kind: "trait", name: "Deep fog", description: "Dense fog."};
		const notes = EncounterWorkspaceState.withAreaNote(initial, {note, isAdd: true}).state;
		const preset = EncounterWorkspaceState.withModifier(initial, {modifier: getEncounterModifierForPreset("desecrated-dmg"), isAdd: true}).state;
		await expect(store.pSave(notes)).rejects.toThrow("Storage full");
		await expect(store.pSave(preset)).rejects.toThrow("Storage full");
		expect(initial.instances.map(it => [it.areaNotes, it.modifiers])).toEqual([[[], []], [[], []]]);
		expect(initial.selectedIds).toEqual(["encounter-1", "encounter-2"]);
		expect(storage.pSetForPage).not.toHaveBeenCalledWith("listSaveManager", expect.anything(), {page: "bestiary.html"});
	});

	it("does not change working state or selection on condition save failure", async () => {
		const storage = getStorage();
		const store = new EncounterWorkspaceStore({storage});
		const state = await EncounterWorkspaceState.pFromSavedList({
			exportedSublist: getList([{h: "goblin_mm", c: 2}]),
			pResolveItem: async () => ({entity: getMonster()}),
			fnUid: getUid(),
		});
		storage.pSetForPage.mockRejectedValue(new Error("Storage full"));
		await expect(store.pSave(EncounterWorkspaceState.withConditions(state, {condition: "Poisoned", isAdd: true})))
			.rejects.toThrow("Storage full");
		expect(state.instances.map(it => it.conditions)).toEqual([[], []]);
		expect(state.selectedIds).toEqual(["encounter-1", "encounter-2"]);
		expect(storage.pGetForPage).not.toHaveBeenCalled();
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
		storage.values.set("encounterWorkspaceState_encounterworkspace.html", {version: 5, instances: []});
		await expect(store.pLoad()).rejects.toThrow(/unsupported version/);
		expect(storage.pSetForPage).not.toHaveBeenCalled();
		await expect(store.pSave({
			...EncounterWorkspaceState.getEmpty(),
			instances: [{id: "same", hash: "goblin_mm", monster: getMonster()}, {id: "same", hash: "goblin_mm", monster: getMonster()}],
		})).rejects.toThrow(/invalid monster instance/);
		await expect(store.pSave({
			...EncounterWorkspaceState.getEmpty(),
			instances: [{id: "one", hash: "goblin_mm", monster: getMonster(), conditions: "poisoned"}],
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
