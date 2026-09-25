import {jest} from "@jest/globals";
import "../../js/parser.js";
import "../../js/utils.js";
import "../../js/render.js";
import "../../js/render-dice.js";
import "../../js/utils-ui.js";
import {BestiaryQuickActionsOperations} from "../../js/bestiary/bestiary-quick-actions-engine.js";
import {
	EncounterWorkspaceState,
	EncounterWorkspaceStore,
	getEncounterEffectiveMonster,
	getEncounterInitiativeTotal,
	getEncounterViewGroups,
} from "../../js/encounterworkspace/encounterworkspace-state.js";
import {getEncounterHandoffSnapshot} from "../../js/encounterworkspace/encounterworkspace-handoff.js";
import {pRollEncounterSelection} from "../../js/encounterworkspace/encounterworkspace-roll.js";

const priorWindow = globalThis.window;
globalThis.window = {addEventListener: jest.fn()};
const {EncounterWorkspacePage} = await import("../../js/encounterworkspace.js");
globalThis.window = priorWindow;

const goblin = {
	name: "Goblin",
	source: "MM",
	type: "humanoid",
	dex: 14,
	cr: "1/4",
	hp: {average: 7, formula: "2d6"},
	action: [{name: "Blade", entries: ["Hit."]}],
};
const make = async (monsters = [goblin, goblin, goblin]) => {
	let id = 0;
	return EncounterWorkspaceState.pFromSavedList({
		exportedSublist: {name: "Ambush", saveId: "saved", items: monsters.map((_, ix) => ({h: `${ix}`}))},
		pResolveItem: async ({h}) => ({entity: monsters[Number(h)]}),
		fnUid: () => `g-${++id}`,
	});
};
const ids = state => getEncounterViewGroups(state).map(group => group.memberIds);
const edit = (state, id, patch, opId = `op-${id}`) => EncounterWorkspaceState.withStatblockChanges(state, [{
	id, addOperations: [{id: opId, ...BestiaryQuickActionsOperations.patch({set: patch})}], removeIds: [],
}]);

describe("Encounter Workspace identical effective statblocks and shared turns", () => {
	it("groups equal effective results regardless of source object key order or operation ID, but separates different outcomes", async () => {
		const initial = await make([goblin, {...goblin, dex: 14}, goblin, {...goblin, hp: {average: 12}}, goblin]);
		expect(ids(initial)).toEqual([["g-1", "g-2", "g-3", "g-5"], ["g-4"]]);
		const first = edit(initial, "g-1", {dex: 18}, "alpha").state;
		const second = edit(first, "g-2", {dex: 18}, "beta").state;
		expect(ids(second)).toEqual([["g-1", "g-2"], ["g-3", "g-5"], ["g-4"]]);
		expect(getEncounterEffectiveMonster(second.instances[0]).dex).toBe(18);
		const withHp = EncounterWorkspaceState.withHp(second, {id: "g-1", prop: "current", value: 2});
		const withCondition = EncounterWorkspaceState.withConditions(withHp, {condition: "poisoned", isAdd: true, targetIds: ["g-2"]});
		expect(ids(withCondition)).toEqual(ids(second));
		expect(withCondition.instances.map(it => [it.hp.current, it.conditions])).toEqual([
			[2, []], [7, ["poisoned"]], [7, []], [12, []], [7, []],
		]);
	});

	it("supports persistent create, split, rejoin and disband without changing creature state", async () => {
		const initial = await make();
		const selected = EncounterWorkspaceState.withTarget(initial, {id: "g-2", isSelected: false});
		const created = EncounterWorkspaceState.withGroup({state: selected, memberIds: ["g-1", "g-2"], id: "group-a"});
		expect(created.groups).toEqual([{id: "group-a", memberIds: ["g-1", "g-2"], sharedTurn: false, initiative: null}]);
		const split = EncounterWorkspaceState.withGroupSplit(created, {id: "g-2"});
		expect(split.ungroupedIds).toEqual(["g-2"]);
		expect(ids(split)).toEqual([["g-1"], ["g-2"], ["g-3"]]);
		const joined = EncounterWorkspaceState.withGroupRejoin(split, {id: "g-2", groupId: "group-a"});
		expect(joined.groups[0].memberIds).toEqual(["g-1", "g-2"]);
		const disbanded = EncounterWorkspaceState.withGroupDisband(joined, {groupId: "group-a"});
		expect(ids(disbanded)).toEqual([["g-1"], ["g-2"], ["g-3"]]);
		expect(disbanded.selectedIds).toEqual(["g-1", "g-3"]);
		expect(disbanded.instances).toEqual(initial.instances);
		expect(() => EncounterWorkspaceState.withGroup({state: initial, memberIds: ["g-1", "g-1"], id: "x"})).toThrow();
		expect(() => EncounterWorkspaceState.withGroup({state: initial, memberIds: ["g-1", "missing"], id: "x"})).toThrow();
		expect(() => EncounterWorkspaceState.withGroup({state: initial, memberIds: ["g-1", "g-2"], id: "view:g-1"})).toThrow();
	});

	it("uses one canonical turn with stable ties, keeps original initiatives, and restores them on unsharing", async () => {
		let state = await make();
		state = EncounterWorkspaceState.withInitiativeResults(state, [{id: "g-1", total: 12}, {id: "g-2", total: 21}, {id: "g-3", total: 17}]);
		state = EncounterWorkspaceState.withTurn(state, "start");
		expect(state.turn.activeId).toBe("g-2");
		state = EncounterWorkspaceState.withGroup({state, memberIds: ["g-1", "g-2"], id: "group-a"});
		state = EncounterWorkspaceState.withSharedTurn(state, {groupId: "group-a", isShared: true, total: 17});
		expect(state.turn).toEqual({round: 1, activeId: "group-a"});
		expect(EncounterWorkspaceState.getInitiativeOrder(state).map(it => it.id)).toEqual(["group-a", "g-3"]);
		expect(state.instances.map(it => it.initiative)).toEqual([12, 21, 17]);
		expect(state.instances.map(it => getEncounterInitiativeTotal(state, it))).toEqual([17, 17, 17]);
		state = EncounterWorkspaceState.withTurn(state, "next");
		expect(state.turn).toEqual({round: 1, activeId: "g-3"});
		state = EncounterWorkspaceState.withTurn(state, "next");
		expect(state.turn).toEqual({round: 2, activeId: "group-a"});
		state = EncounterWorkspaceState.withInitiative(state, {id: "g-2", total: 19});
		expect(state.groups[0].initiative).toBe(19);
		expect(state.instances.map(it => it.initiative)).toEqual([12, 21, 17]);
		state = EncounterWorkspaceState.withInitiative(state, {id: "group-a", total: 18});
		expect(state.groups[0].initiative).toBe(18);
		expect(state.turn).toEqual({round: 2, activeId: "group-a"});
		state = EncounterWorkspaceState.withSharedTurn(state, {groupId: "group-a", isShared: false});
		expect(state.turn).toEqual({round: 2, activeId: "g-1"});
		expect(EncounterWorkspaceState.getInitiativeOrder(state).map(it => it.id)).toEqual(["g-2", "g-3", "g-1"]);
		expect(state.instances.map(it => it.initiative)).toEqual([12, 21, 17]);
		const cleared = EncounterWorkspaceState.withInitiative(EncounterWorkspaceState.withSharedTurn(state, {groupId: "group-a", isShared: true, total: 10}), {id: "group-a", total: null});
		expect(cleared.groups[0]).toMatchObject({sharedTurn: true, initiative: null});
		expect(cleared.turn).toEqual({round: 0, activeId: null});
	});

	it("rolls initiative once per selected shared group, updates its canonical total, and does not overwrite originals on failed rolls", async () => {
		let state = await make();
		state = EncounterWorkspaceState.withInitiativeResults(state, [{id: "g-1", total: 11}, {id: "g-2", total: 12}]);
		state = EncounterWorkspaceState.withGroup({state, memberIds: ["g-1", "g-2"], id: "group-a"});
		state = EncounterWorkspaceState.withSharedTurn(state, {groupId: "group-a", isShared: true, total: 20});
		const pRoll = jest.fn(async () => ({total: 14, die: 12, mode: "normal"}));
		const {results, failures} = await pRollEncounterSelection({state, rollType: "initiative", pRoll});
		expect(results.map(it => it.id)).toEqual(["g-1", "g-3"]);
		expect(failures).toEqual([]);
		expect(pRoll).toHaveBeenCalledTimes(2);
		state = EncounterWorkspaceState.withInitiativeResults(state, results.map(({id, total}) => ({id, total})));
		expect(state.groups[0].initiative).toBe(14);
		expect(state.instances.map(it => it.initiative)).toEqual([11, 12, 14]);
		const cancelled = await pRollEncounterSelection({state, rollType: "initiative", pRoll: async () => null});
		expect(cancelled.results).toEqual([]);
		expect(cancelled.failures).toHaveLength(2);
		expect(state.groups[0].initiative).toBe(14);
		expect(() => EncounterWorkspaceState.withInitiativeResults(state, [{id: "g-1", total: 1}, {id: "g-2", total: 2}])).toThrow(/invalid encounter target/);
	});

	it("splits an edited member out of an active shared group without losing its HP, conditions or original total", async () => {
		let state = await make();
		state = EncounterWorkspaceState.withInitiativeResults(state, [{id: "g-1", total: 20}, {id: "g-2", total: 5}]);
		state = EncounterWorkspaceState.withHp(state, {id: "g-1", prop: "current", value: 3});
		state = EncounterWorkspaceState.withConditions(state, {condition: "poisoned", isAdd: true, targetIds: ["g-1"]});
		state = EncounterWorkspaceState.withGroup({state, memberIds: ["g-1", "g-2"], id: "group-a"});
		state = EncounterWorkspaceState.withSharedTurn(state, {groupId: "group-a", isShared: true, total: 15});
		state = EncounterWorkspaceState.withTurn(state, "start");
		const {state: edited, splitIds} = edit(state, "g-1", {dex: 18});
		expect(splitIds).toEqual(["g-1"]);
		expect(edited.groups[0]).toMatchObject({id: "group-a", memberIds: ["g-2"], initiative: 15});
		expect(edited.turn).toEqual({round: 1, activeId: "group-a"});
		expect(edited.instances[0]).toMatchObject({initiative: 20, hp: {current: 3, max: 7, temp: 0}, conditions: ["poisoned"]});
		expect(EncounterWorkspaceState.getInitiativeOrder(edited).map(it => it.id)).toEqual(["g-1", "group-a"]);
		expect(EncounterWorkspaceState.withTurn(edited, "next").turn).toEqual({round: 2, activeId: "g-1"});
		expect(() => EncounterWorkspaceState.withGroupRejoin(EncounterWorkspaceState.withGroupSplit(edited, {id: "g-1"}), {id: "g-1", groupId: "group-a"})).toThrow(/different effective/);
	});

	it("flattens handoff v1 using shared totals but distinct edited statblocks, HP and conditions", async () => {
		let state = await make();
		state = edit(state, "g-1", {dex: 18}, "edit-one").state;
		state = edit(state, "g-2", {dex: 18}, "edit-two").state;
		state = EncounterWorkspaceState.withInitiativeResults(state, [{id: "g-1", total: 2}, {id: "g-2", total: 3}]);
		state = EncounterWorkspaceState.withHp(state, {id: "g-1", prop: "current", value: 1});
		state = EncounterWorkspaceState.withConditions(state, {condition: "poisoned", isAdd: true, targetIds: ["g-2"]});
		state = EncounterWorkspaceState.withGroup({state, memberIds: ["g-1", "g-2"], id: "group-a"});
		state = EncounterWorkspaceState.withSharedTurn(state, {groupId: "group-a", isShared: true, total: 16});
		state = EncounterWorkspaceState.withTarget(state, {id: "g-3", isSelected: false});
		const snapshot = getEncounterHandoffSnapshot({state, id: "handoff", createdAt: "2026-01-01T00:00:00.000Z"});
		expect(snapshot.version).toBe(1);
		expect(snapshot.entries.map(it => [it.instanceId, it.initiative, it.hp.current, it.conditions])).toEqual([
			["g-1", 16, 1, []], ["g-2", 16, 7, ["poisoned"]],
		]);
		expect(snapshot.entries.map(it => it.monster.dex)).toEqual([18, 18]);
		snapshot.entries[0].monster.dex = 99;
		expect(state.instances[0].monster.dex).toBe(14);
		expect(state.instances[0].initiative).toBe(2);
	});

	it("migrates v1-v5 in memory without writing and rejects malformed groups/active turns", async () => {
		const state = await make();
		const storage = {pGetForPage: jest.fn(), pSetForPage: jest.fn()};
		const store = new EncounterWorkspaceStore({storage});
		for (const version of [1, 2, 3, 4, 5]) {
			const raw = structuredClone(state);
			raw.version = version;
			delete raw.groups;
			delete raw.ungroupedIds;
			if (version < 5) raw.instances.forEach(it => delete it.statblockOperations);
			if (version < 4) {
				delete raw.turn;
				raw.instances.forEach(it => { delete it.hp; delete it.initiative; });
			}
			if (version < 3) raw.instances.forEach(it => { delete it.areaNotes; delete it.modifiers; });
			if (version < 2) raw.instances.forEach(it => delete it.conditions);
			storage.pGetForPage.mockResolvedValueOnce(raw);
			const loaded = await store.pLoad();
			expect(loaded).toMatchObject({version: 6, groups: [], ungroupedIds: [], selectedIds: state.selectedIds});
			expect(loaded.instances.map(it => it.monster)).toEqual(state.instances.map(it => it.monster));
		}
		expect(storage.pSetForPage).not.toHaveBeenCalled();
		const group = EncounterWorkspaceState.withGroup({state, memberIds: ["g-1", "g-2"], id: "group-a"});
		expect(() => EncounterWorkspaceState.validate({...group, groups: [{...group.groups[0], memberIds: ["g-1", "missing"]}]})).toThrow(/invalid groups/);
		expect(() => EncounterWorkspaceState.validate({...group, groups: [{...group.groups[0], sharedTurn: true, initiative: 10}], turn: {round: 1, activeId: "g-1"}})).toThrow(/invalid active turn/);
		const different = edit(state, "g-2", {dex: 18}).state;
		expect(() => EncounterWorkspaceState.validate({...different, groups: group.groups})).toThrow(/different effective statblocks/);
	});

	it("preserves a v5 statblock history, notes and modifiers on read with no migration write", async () => {
		let state = await make();
		state = edit(state, "g-1", {dex: 18}).state;
		state = EncounterWorkspaceState.withAreaNote(state, {isAdd: true, note: {id: "fog", name: "Fog", kind: "trait", description: "Dim sight."}, targetIds: ["g-2"]}).state;
		state = EncounterWorkspaceState.withModifier(state, {isAdd: true, modifier: {id: "luck", name: "Luck", mode: "advantage", scopes: ["initiative"], bonus: 0}, targetIds: ["g-1"]}).state;
		const legacy = structuredClone(state);
		legacy.version = 5;
		delete legacy.groups;
		delete legacy.ungroupedIds;
		const storage = {pGetForPage: jest.fn(async () => legacy), pSetForPage: jest.fn()};
		const loaded = await new EncounterWorkspaceStore({storage}).pLoad();
		expect(loaded.version).toBe(6);
		expect(loaded.instances[0].statblockOperations).toEqual(state.instances[0].statblockOperations);
		expect(loaded.instances[0].modifiers).toEqual(state.instances[0].modifiers);
		expect(loaded.instances[1].areaNotes).toEqual(state.instances[1].areaNotes);
		expect(loaded.instances.map(it => it.id)).toEqual(state.instances.map(it => it.id));
		expect(Object.isFrozen(loaded.instances[0].monster)).toBe(true);
		expect(storage.pSetForPage).not.toHaveBeenCalled();
	});

	it("preserves visible state when sharing or splitting fails to save, then restores active turn on disband", async () => {
		let state = await make();
		state = EncounterWorkspaceState.withInitiativeResults(state, [{id: "g-1", total: 9}, {id: "g-2", total: 18}]);
		state = EncounterWorkspaceState.withGroup({state, memberIds: ["g-1", "g-2"], id: "group-a"});
		const store = new EncounterWorkspaceStore({storage: {
			pSetForPage: jest.fn(async () => { throw new Error("Storage full"); }),
		}});
		await expect(store.pSave(EncounterWorkspaceState.withSharedTurn(state, {groupId: "group-a", isShared: true, total: 16})))
			.rejects.toThrow("Storage full");
		expect(state.groups[0].sharedTurn).toBe(false);
		let shared = EncounterWorkspaceState.withSharedTurn(state, {groupId: "group-a", isShared: true, total: 16});
		shared = EncounterWorkspaceState.withTurn(shared, "start");
		await expect(store.pSave(EncounterWorkspaceState.withGroupSplit(shared, {id: "g-1"}))).rejects.toThrow("Storage full");
		expect(shared.groups[0].memberIds).toEqual(["g-1", "g-2"]);
		const disbanded = EncounterWorkspaceState.withGroupDisband(shared, {groupId: "group-a"});
		expect(disbanded.turn).toEqual({round: 1, activeId: "g-1"});
		expect(disbanded.instances.map(it => it.initiative)).toEqual([9, 18, null]);
	});

	it("does not publish failed page group changes and distinguishes a committed post-save render failure", async () => {
		const initial = await make();
		const page = Object.create(EncounterWorkspacePage.prototype);
		page._state = initial;
		page._isBusy = false;
		page._setBusy = jest.fn(value => page._isBusy = value);
		page._setStatus = jest.fn();
		page._setError = jest.fn();
		page._render = jest.fn();
		page._store = {pSave: jest.fn(async () => { throw new Error("Storage full"); })};
		await page._pChangeGroup({action: "create", memberIds: ["g-1", "g-2"]});
		expect(page._state).toBe(initial);
		expect(page._render).not.toHaveBeenCalled();
		expect(page._setError).toHaveBeenCalledWith(expect.stringContaining("Storage full"));

		const group = getEncounterViewGroups(initial)[0];
		const confirm = jest.spyOn(InputUiUtil, "pGetUserBoolean").mockResolvedValue(true);
		try {
			await page._pShareTurn({group, raw: "14"});
			expect(page._state).toBe(initial);
			expect(page._setError).toHaveBeenCalledWith(expect.stringContaining("Shared turn was not saved: Storage full"));
			page._store.pSave.mockImplementationOnce(async next => next);
			page._render.mockImplementationOnce(() => { throw new Error("Renderer failed"); });
			await page._pShareTurn({group, raw: "14"});
			expect(page._state.groups[0].sharedTurn).toBe(true);
			expect(page._setError).toHaveBeenCalledWith(expect.stringContaining("Shared turn was saved, but the page could not refresh"));
		} finally {
			confirm.mockRestore();
		}
	});
});
