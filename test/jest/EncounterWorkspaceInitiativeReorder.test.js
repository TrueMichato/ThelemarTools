import {jest} from "@jest/globals";
import "../../js/parser.js";
import "../../js/utils.js";
import "../../js/render.js";
import "../../js/render-dice.js";
import "../../js/utils-ui.js";
import {EncounterWorkspaceState, EncounterWorkspaceStore} from "../../js/encounterworkspace/encounterworkspace-state.js";

const priorWindow = globalThis.window;
globalThis.window = {addEventListener: jest.fn()};
const {EncounterWorkspacePage} = await import("../../js/encounterworkspace.js");
globalThis.window = priorWindow;

const monster = {name: "Goblin", source: "MM", dex: 14, hp: {average: 7, formula: "2d6"}};
const create = async (totals) => {
	let id = 0;
	const state = await EncounterWorkspaceState.pFromSavedList({
		exportedSublist: {name: "Ambush", saveId: "saved", items: [{h: "goblin", c: totals.length}]},
		pResolveItem: async () => ({entity: monster}),
		fnUid: () => `g-${++id}`,
	});
	return EncounterWorkspaceState.withInitiativeResults(state, totals.map((total, ix) => ({id: `g-${ix + 1}`, total})));
};
const order = state => EncounterWorkspaceState.getInitiativeOrder(state).map(it => [it.id, it.initiative]);

describe("Encounter Workspace initiative reorder", () => {
	it("resolves tied turns by changing the real total and preserves the original ties on undo", async () => {
		const initial = await create([10, 10, 8]);
		const {state, changes, undo} = EncounterWorkspaceState.withInitiativeReorder(initial, {id: "g-2", beforeId: "g-1"});
		expect(order(state)).toEqual([["g-2", 11], ["g-1", 10], ["g-3", 8]]);
		expect(changes).toEqual([{id: "g-2", before: 10, after: 11}]);
		expect(order(EncounterWorkspaceState.withInitiativeReorderUndo(state, undo))).toEqual(order(initial));
		expect(EncounterWorkspaceState.withInitiativeReorder(initial, {id: "g-1", beforeId: "g-1"}).changes).toEqual([]);
		expect(() => EncounterWorkspaceState.withInitiativeReorder(initial, {id: "missing", beforeId: null})).toThrow(/Choose a monster/);
		expect(() => EncounterWorkspaceState.withInitiativeReorder(initial, {id: "g-2", beforeId: "missing"})).toThrow(/destination/);
	});

	it("changes only the moved total when there is room, but shifts the shortest necessary adjacent run when there is no gap", async () => {
		const spaced = await create([20, 10, 0]);
		const withGap = EncounterWorkspaceState.withInitiativeReorder(spaced, {id: "g-3", beforeId: "g-2"});
		expect(order(withGap.state)).toEqual([["g-1", 20], ["g-3", 11], ["g-2", 10]]);
		expect(withGap.changes).toEqual([{id: "g-3", before: 0, after: 11}]);
		const packed = await create([25, 20, 19, 18, 16]);
		const moved = EncounterWorkspaceState.withInitiativeReorder(packed, {id: "g-5", beforeId: "g-3"});
		expect(order(moved.state)).toEqual([["g-1", 25], ["g-2", 21], ["g-5", 20], ["g-3", 19], ["g-4", 18]]);
		expect(moved.changes).toEqual([
			{id: "g-5", before: 16, after: 20},
			{id: "g-2", before: 20, after: 21},
		]);
		expect(order(EncounterWorkspaceState.withInitiativeReorderUndo(moved.state, moved.undo))).toEqual(order(packed));
		const negative = await create([5, 0, -1, -2, -7]);
		expect(order(EncounterWorkspaceState.withInitiativeReorder(negative, {id: "g-5", beforeId: "g-3"}).state))
			.toEqual([["g-1", 5], ["g-2", 1], ["g-5", 0], ["g-3", -1], ["g-4", -2]]);
	});

	it("fits at both safe-integer boundaries without fractions or overflow", async () => {
		const max = Number.MAX_SAFE_INTEGER;
		const high = await create([max, max - 1, null]);
		expect(order(EncounterWorkspaceState.withInitiativeReorder(high, {id: "g-3", beforeId: "g-1"}).state))
			.toEqual([["g-3", max], ["g-1", max - 1], ["g-2", max - 2]]);
		const min = Number.MIN_SAFE_INTEGER;
		const low = await create([min + 1, min, null]);
		expect(order(EncounterWorkspaceState.withInitiativeReorder(low, {id: "g-3", beforeId: null}).state))
			.toEqual([["g-1", min + 2], ["g-2", min + 1], ["g-3", min]]);
	});

	it("places unrolled monsters and shared groups as single entries without changing retained individual totals or active IDs", async () => {
		let state = await create([20, 10, null, -5]);
		state = EncounterWorkspaceState.withGroup({state, memberIds: ["g-1", "g-2"], id: "shared"});
		state = EncounterWorkspaceState.withSharedTurn(state, {groupId: "shared", isShared: true, total: 15});
		state = EncounterWorkspaceState.withTurn(state, "start");
		expect(state.turn).toEqual({round: 1, activeId: "shared"});
		const inserted = EncounterWorkspaceState.withInitiativeReorder(state, {id: "g-3", beforeId: "g-4"});
		expect(order(inserted.state)).toEqual([["shared", 15], ["g-3", -4], ["g-4", -5]]);
		expect(inserted.state.turn).toEqual(state.turn);
		expect(inserted.state.instances.map(it => it.initiative)).toEqual([20, 10, -4, -5]);
		const groupMove = EncounterWorkspaceState.withInitiativeReorder(inserted.state, {id: "shared", beforeId: null});
		expect(order(groupMove.state)).toEqual([["g-3", -4], ["g-4", -5], ["shared", -6]]);
		expect(groupMove.state.instances.map(it => it.initiative)).toEqual([20, 10, -4, -5]);
		expect(groupMove.state.turn).toEqual({round: 1, activeId: "shared"});
		expect(EncounterWorkspaceState.withTurn(groupMove.state, "next").turn).toEqual({round: 2, activeId: "g-3"});
		const restored = EncounterWorkspaceState.withSharedTurn(groupMove.state, {groupId: "shared", isShared: false});
		expect(order(restored)).toEqual([["g-1", 20], ["g-2", 10], ["g-3", -4], ["g-4", -5]]);
		const unrolledGroup = EncounterWorkspaceState.withInitiative(EncounterWorkspaceState.withTurn(state, "reset"), {id: "shared", total: null});
		expect(unrolledGroup.turn.round).toBe(0);
		const fromUnrolled = EncounterWorkspaceState.withInitiativeReorder(unrolledGroup, {id: "shared", beforeId: "g-4"});
		expect(order(fromUnrolled.state)).toEqual([["shared", -4], ["g-4", -5]]);
		expect(fromUnrolled.state.instances.map(it => it.initiative)).toEqual([20, 10, null, -5]);
		expect(order(EncounterWorkspaceState.withInitiativeReorderUndo(fromUnrolled.state, fromUnrolled.undo))).toEqual(order(unrolledGroup));
		expect(() => EncounterWorkspaceState.withInitiativeReorder(state, {id: "g-1", beforeId: null})).toThrow(/Choose a monster/);
	});

	it("guards undo against later initiative, group, or turn changes while allowing unrelated HP edits", async () => {
		const initial = await create([20, 10, 0]);
		const {state, undo} = EncounterWorkspaceState.withInitiativeReorder(initial, {id: "g-3", beforeId: "g-2"});
		for (const edited of [
			EncounterWorkspaceState.withInitiative(state, {id: "g-1", total: 21}),
			EncounterWorkspaceState.withGroup({state, memberIds: ["g-1", "g-2"], id: "new-group"}),
			EncounterWorkspaceState.withTurn(state, "start"),
		]) expect(() => EncounterWorkspaceState.withInitiativeReorderUndo(edited, undo)).toThrow(/cannot be undone safely/);
		const withHp = EncounterWorkspaceState.withHp(state, {id: "g-2", prop: "current", value: 3});
		const restored = EncounterWorkspaceState.withInitiativeReorderUndo(withHp, undo);
		expect(order(restored)).toEqual(order(initial));
		expect(restored.instances[1].hp.current).toBe(3);
	});

	it("reorders a packed 1000-monster encounter by adjusting only the shorter adjacent run", async () => {
		const initial = await create(Array.from({length: 1000}, (_, ix) => 1000 - ix));
		const {state, changes, undo} = EncounterWorkspaceState.withInitiativeReorder(initial, {id: "g-1000", beforeId: "g-501"});
		expect(changes).toHaveLength(500);
		expect(order(state).slice(498, 503)).toEqual([
			["g-499", 502], ["g-500", 501], ["g-1000", 500], ["g-501", 499], ["g-502", 498],
		]);
		expect(order(EncounterWorkspaceState.withInitiativeReorderUndo(state, undo))).toEqual(order(initial));
	});

	it("publishes neither a failed move nor a failed undo and keeps the undo available after a storage failure", async () => {
		const initial = await create([20, 10, 0]);
		const {state, undo} = EncounterWorkspaceState.withInitiativeReorder(initial, {id: "g-3", beforeId: "g-2"});
		const storage = {pSetForPage: jest.fn(async () => { throw new Error("Storage full"); })};
		const store = new EncounterWorkspaceStore({storage});
		await expect(store.pSave(state)).rejects.toThrow("Storage full");
		expect(order(initial)).toEqual([["g-1", 20], ["g-2", 10], ["g-3", 0]]);
		const page = Object.create(EncounterWorkspacePage.prototype);
		page._state = initial;
		page._isBusy = false;
		page._setBusy = jest.fn(value => page._isBusy = value);
		page._setError = jest.fn();
		page._setStatus = jest.fn();
		page._store = store;
		await page._pMoveInitiative({id: "g-3", beforeId: "g-2"});
		expect(page._state).toBe(initial);
		expect(page._initiativeUndo).toBeUndefined();
		expect(page._setError).toHaveBeenCalledWith(expect.stringContaining("Storage full"));
		page._state = state;
		page._initiativeUndo = undo;
		await page._pUndoInitiativeMove();
		expect(page._state).toBe(state);
		expect(page._initiativeUndo).toBe(undo);
		expect(page._setError).toHaveBeenCalledWith(expect.stringContaining("working encounter is unchanged"));
	});
});
