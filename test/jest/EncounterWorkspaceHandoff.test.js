import "../../js/parser.js";
import "../../js/utils.js";
import {jest} from "@jest/globals";
import {EncounterWorkspaceState} from "../../js/encounterworkspace/encounterworkspace-state.js";
import {
	EncounterWorkspaceHandoffStore,
	getEncounterHandoffSnapshot,
	validateEncounterHandoffSnapshot,
} from "../../js/encounterworkspace/encounterworkspace-handoff.js";

const makeState = async () => {
	let nextId = 0;
	const state = await EncounterWorkspaceState.pFromSavedList({
		exportedSublist: {name: "Bridge Ambush", saveId: "saved-list", items: [{h: "goblin_mm", c: 2}]},
		pResolveItem: async () => ({entity: {name: "Goblin", source: "MM", hp: {average: 7}, _displayName: "River Goblin"}}),
		fnUid: () => `instance-${++nextId}`,
	});
	return EncounterWorkspaceState.withInitiativeResults(state, [{id: "instance-1", total: 17}, {id: "instance-2", total: 11}]);
};

const makeStorage = () => {
	const items = new Map();
	return {
		items,
		pGet: jest.fn(async key => items.get(key) ?? null),
		pSet: jest.fn(async (key, value) => items.set(key, structuredClone(value))),
		pRemove: jest.fn(async key => items.delete(key)),
		pIsAsyncFake: jest.fn(async () => false),
	};
};

const makeLocks = () => {
	let tail = Promise.resolve();
	return {request: jest.fn((_name, _options, fn) => {
		const next = tail.then(fn, fn);
		tail = next.catch(() => {});
		return next;
	})};
};

describe("Encounter Workspace one-time handoff", () => {
	it("copies only selected instances in roster order, distinct aliases, exact HP and custom conditions without touching source", async () => {
		const original = await makeState();
		const state = EncounterWorkspaceState.withConditions(original, {condition: "dreambound", isAdd: true, targetIds: ["instance-2"]});
		state.selectedIds.reverse();
		state.instances[0].hp = {current: null, max: null, temp: 0};
		const before = structuredClone(state);
		const snapshot = getEncounterHandoffSnapshot({state, id: "handoff-a", createdAt: "2026-09-24T10:00:00.000Z"});

		expect(snapshot).toMatchObject({
			version: 1,
			id: "handoff-a",
			source: {name: "Bridge Ambush", saveId: "saved-list"},
			entries: [
				{instanceId: "instance-1", alias: "River Goblin #1", hp: {current: null, max: null, temp: 0}, initiative: 17},
				{instanceId: "instance-2", alias: "River Goblin #2", hp: {current: 7, max: 7, temp: 0}, conditions: ["dreambound"], initiative: 11},
			],
		});
		expect(snapshot.entries[0].monster).toEqual(state.instances[0].monster);
		expect(state).toEqual(before);
		snapshot.entries[0].monster.name = "Changed after queuing";
		expect(state.instances[0].monster.name).toBe("Goblin");
	});

	it("blocks missing initiative with each precise duplicate name, zero selection and absent sources", async () => {
		const state = await makeState();
		state.instances.forEach(it => it.initiative = null);
		expect(() => getEncounterHandoffSnapshot({state})).toThrow("River Goblin #1, River Goblin #2");
		state.selectedIds = [];
		expect(() => getEncounterHandoffSnapshot({state})).toThrow("Select at least one monster");
		state.sourceList = null;
		expect(() => getEncounterHandoffSnapshot({state})).toThrow("Choose a saved Bestiary list");
	});

	it.each([
		["unknown version", snapshot => snapshot.version = 8],
		["duplicate instance", snapshot => snapshot.entries[1].instanceId = snapshot.entries[0].instanceId],
		["missing monster", snapshot => delete snapshot.entries[0].monster.source],
		["missing initiative", snapshot => snapshot.entries[0].initiative = null],
		["missing HP", snapshot => delete snapshot.entries[0].hp.current],
		["invalid temp HP", snapshot => snapshot.entries[0].hp.temp = -1],
		["noncanonical condition", snapshot => snapshot.entries[0].conditions = ["Poisoned"]],
		["invalid timestamp", snapshot => snapshot.createdAt = "not a date"],
	])("rejects %s rather than silently dropping data", async (_case, mutate) => {
		const snapshot = getEncounterHandoffSnapshot({state: await makeState()});
		mutate(snapshot);
		expect(() => validateEncounterHandoffSnapshot(snapshot)).toThrow();
	});

	it("persists a queue across independent page instances, requires replacement confirmation, and fences stale clear/import", async () => {
		const storage = makeStorage();
		const locks = makeLocks();
		const source = new EncounterWorkspaceHandoffStore({storage, locks});
		const destination = new EncounterWorkspaceHandoffStore({storage, locks});
		const a = getEncounterHandoffSnapshot({state: await makeState(), id: "a"});
		const b = getEncounterHandoffSnapshot({state: await makeState(), id: "b"});
		expect(await source.pQueue({snapshot: a, pConfirmReplace: jest.fn()})).toMatchObject({ok: true});
		expect(await destination.pRead()).toEqual(a);
		const declined = jest.fn(async () => false);
		expect(await destination.pQueue({snapshot: b, pConfirmReplace: declined})).toEqual({ok: false, reason: "cancelled"});
		expect(declined).toHaveBeenCalledWith(a);
		expect(await source.pRead()).toEqual(a);
		expect(await destination.pQueue({snapshot: b, pConfirmReplace: async () => true})).toMatchObject({ok: true});
		await expect(source.pClear({expectedId: "a"})).rejects.toThrow("changed in another tab");
		const append = jest.fn();
		await expect(source.pImport({expectedId: "a", pAppend: append})).rejects.toThrow("changed in another tab");
		expect(append).not.toHaveBeenCalled();
		expect(await source.pRead()).toEqual(b);
		await destination.pClear({expectedId: "b"});
		expect(await source.pRead()).toBeNull();
	});

	it("retains pending snapshots on failed append/remove/write, and never treats fake or lockless storage as durable", async () => {
		const storage = makeStorage();
		const snapshot = getEncounterHandoffSnapshot({state: await makeState(), id: "pending"});
		const store = new EncounterWorkspaceHandoffStore({storage, locks: makeLocks()});
		storage.pSet.mockRejectedValueOnce(new Error("Quota exceeded"));
		await expect(store.pQueue({snapshot})).rejects.toThrow("Quota exceeded");
		expect(await store.pRead()).toBeNull();
		await store.pQueue({snapshot});
		expect(await store.pImport({expectedId: "pending", pAppend: async () => ({ok: false, message: "Tracker is locked"})}))
			.toEqual({ok: false, message: "Tracker is locked"});
		expect(await store.pRead()).toEqual(snapshot);
		storage.pRemove.mockRejectedValueOnce(new Error("Storage unavailable"));
		await expect(store.pImport({expectedId: "pending", pAppend: async () => ({ok: true, count: 2})}))
			.rejects.toThrow("Storage unavailable");
		expect(await store.pRead()).toEqual(snapshot);
		const fake = new EncounterWorkspaceHandoffStore({storage: {...storage, pIsAsyncFake: async () => true}, locks: makeLocks()});
		await expect(fake.pImport({expectedId: "pending", pAppend: jest.fn()})).rejects.toThrow("Persistent browser storage");
		const lockless = new EncounterWorkspaceHandoffStore({storage, locks: null});
		await expect(lockless.pClear({expectedId: "pending"})).rejects.toThrow("Web Locks");
		expect(await store.pRead()).toEqual(snapshot);
	});

	it("requires an explicit, fenced clear for malformed pending data; never replaces it silently", async () => {
		const storage = makeStorage();
		const store = new EncounterWorkspaceHandoffStore({storage, locks: makeLocks()});
		const snapshot = getEncounterHandoffSnapshot({state: await makeState(), id: "usable"});
		await store.pQueue({snapshot});
		const key = storage.pSet.mock.calls[0][0];
		storage.items.set(key, {...snapshot, version: 999});
		await expect(store.pRead()).rejects.toThrow("unsupported version");
		await expect(store.pQueue({snapshot: {...snapshot, id: "other"}})).rejects.toThrow("unsupported version");
		const token = await store.pGetCorruptRecoveryToken();
		expect(token).toBeTruthy();
		storage.items.set(key, {...snapshot, version: 998});
		await expect(store.pClearCorrupt({expectedToken: token})).rejects.toThrow("changed in another tab");
		expect(storage.items.has(key)).toBe(true);
		await store.pClearCorrupt({expectedToken: await store.pGetCorruptRecoveryToken()});
		expect(await store.pRead()).toBeNull();
		await store.pQueue({snapshot});
		expect(await store.pGetCorruptRecoveryToken()).toBeNull();
	});
});
