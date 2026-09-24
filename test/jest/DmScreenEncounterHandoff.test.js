import "../../js/parser.js";
import "../../js/utils.js";
import "../../js/utils-ui.js";
import {jest} from "@jest/globals";
import {
	EncounterWorkspaceHandoffStore,
	getEncounterHandoffSnapshot,
	isEncounterHandoffImportedInBoardSave,
} from "../../js/encounterworkspace/encounterworkspace-handoff.js";
import {EncounterWorkspaceState} from "../../js/encounterworkspace/encounterworkspace-state.js";

globalThis.RenderableCollectionAsyncGenericRows = class {};
globalThis.RenderableCollectionGenericRows = class {};
globalThis.BaseComponent = class {};
globalThis.ListUtilEntity = class {};
const {InitiativeTrackerComponent} = await import("../../js/dmscreen/panels/initiativetracker/dmscreen-initiativetracker.js");

let nextId = 0;
const makeSnapshot = async () => {
	const state = await EncounterWorkspaceState.pFromSavedList({
		exportedSublist: {name: "Breach", saveId: "list-id", items: [{h: "mage_tst", c: 2}]},
		pResolveItem: async () => ({entity: {name: "Mage", source: "TST", hp: {average: 21}, _displayName: "Arcane Guard"}}),
		fnUid: () => `instance-${++nextId}`,
	});
	state.instances[0].hp = {current: null, max: null, temp: 0};
	state.instances[1].hp = {current: 9, max: 21, temp: 4};
	state.instances[1].conditions = ["poisoned", "dreambound"];
	state.instances[0].initiative = 23;
	state.instances[1].initiative = 14;
	return {state, snapshot: getEncounterHandoffSnapshot({state, id: `handoff-${nextId}`})};
};

const makeStore = () => {
	let raw = null;
	const storage = {
		pGet: jest.fn(async () => raw),
		pSet: jest.fn(async (_key, value) => raw = structuredClone(value)),
		pRemove: jest.fn(async () => raw = null),
		pIsAsyncFake: jest.fn(async () => false),
	};
	const store = new EncounterWorkspaceHandoffStore({storage, locks: {request: (_name, _opts, fn) => fn()}});
	return {store, storage};
};

const makePanel = ({store, board = {pDoSaveStateNow: jest.fn(async () => {})}}) => {
	const tracker = Object.create(InitiativeTrackerComponent.prototype);
	tracker._state = {rows: [], isLocked: false, importedEncounterHandoffIds: [], sort: "NUMBER", dir: "DESC"};
	tracker._board = board;
	tracker._handoffStore = store;
	tracker._isHandoffBusy = false;
	tracker._pendingHandoff = null;
	tracker._rowStateBuilderActive = {
		pGetNewRowState: jest.fn(async meta => ({
			id: `row-${meta.customName}`,
			entity: {
				name: meta.name,
				customName: meta.customName,
				monster: meta.monster,
				hpCurrent: meta.hpCurrent,
				hpMax: meta.hpMax,
				hpTemp: meta.hpTemp,
				initiative: meta.initiative,
				conditions: meta.conditions,
			},
		})),
	};
	tracker._updateEncounterHandoff = jest.fn();
	tracker._setEncounterHandoffStatus = jest.fn();
	tracker._pRefreshEncounterHandoff = jest.fn(async () => tracker._pendingHandoff = await store.pRead());
	tracker._pIsHandoffAlreadySaved = jest.fn(async () => false);
	return tracker;
};

describe("DM Screen per-panel encounter handoff", () => {
	let confirm;
	beforeEach(() => {
		confirm = jest.spyOn(InputUiUtil, "pGetUserBoolean").mockResolvedValue(true);
	});
	afterEach(() => confirm.mockRestore());

	it("appends exactly once after confirmation, preserving duplicates, unknown HP, initiative and custom conditions without linking the source", async () => {
		const {state, snapshot} = await makeSnapshot();
		const {store, storage} = makeStore();
		await store.pQueue({snapshot});
		const panel = makePanel({store});
		await panel._pRefreshEncounterHandoff();
		await panel._pImportEncounterHandoff();
		expect(panel._board.pDoSaveStateNow).toHaveBeenCalledTimes(1);
		expect(storage.pRemove).toHaveBeenCalledTimes(1);
		expect(await store.pRead()).toBeNull();
		expect(panel._state.importedEncounterHandoffIds).toEqual([snapshot.id]);
		expect(panel._getSerializedState().ih).toEqual([snapshot.id]);
		expect(panel._state.rows.map(it => it.entity.customName)).toEqual(["Arcane Guard #1", "Arcane Guard #2"]);
		expect(panel._state.rows.map(it => it.entity.initiative)).toEqual([23, 14]);
		expect(panel._state.rows.map(it => [it.entity.hpCurrent, it.entity.hpMax, it.entity.hpTemp])).toEqual([[null, null, 0], [9, 21, 4]]);
		expect(panel._rowStateBuilderActive.pGetNewRowState).toHaveBeenNthCalledWith(1, expect.objectContaining({isKeepHpUnset: true}));
		expect(panel._state.rows[1].entity.conditions.map(it => it.entity.name)).toEqual(["Poisoned", "Dreambound"]);
		expect(panel._state.rows[1].entity.conditions.every(it => it.entity.color)).toBe(true);
		panel._state.rows[0].entity.hpCurrent = 1;
		expect(state.instances[0].hp.current).toBeNull();
		expect(state.instances[0].monster.name).toBe("Mage");
		expect(panel._setEncounterHandoffStatus).toHaveBeenCalledWith(expect.stringContaining("no later changes will sync"), {isError: false});
	});

	it("leaves pending data untouched on cancel, locked tracker and incomplete row construction", async () => {
		const {snapshot} = await makeSnapshot();
		const {store} = makeStore();
		await store.pQueue({snapshot});
		const panel = makePanel({store});
		panel._pendingHandoff = snapshot;
		confirm.mockResolvedValueOnce(false);
		await panel._pImportEncounterHandoff();
		expect(panel._rowStateBuilderActive.pGetNewRowState).not.toHaveBeenCalled();
		panel._state.isLocked = true;
		await panel._pImportEncounterHandoff();
		expect(panel._setEncounterHandoffStatus).toHaveBeenCalledWith(expect.stringContaining("locked"), {isError: true});
		panel._state.isLocked = false;
		panel._rowStateBuilderActive.pGetNewRowState.mockResolvedValueOnce(null);
		await panel._pImportEncounterHandoff();
		expect(panel._state.rows).toHaveLength(0);
		expect(panel._board.pDoSaveStateNow).not.toHaveBeenCalled();
		expect(await store.pRead()).toEqual(snapshot);
	});

	it("does not claim success if board save fails, and a receipt blocks re-import when queue clear fails", async () => {
		const {snapshot} = await makeSnapshot();
		const {store, storage} = makeStore();
		await store.pQueue({snapshot});
		const board = {pDoSaveStateNow: jest.fn().mockRejectedValueOnce(new Error("Disk full")).mockResolvedValueOnce()};
		const panel = makePanel({store, board});
		panel._pendingHandoff = snapshot;
		await panel._pImportEncounterHandoff();
		expect(await store.pRead()).toEqual(snapshot);
		expect(panel._setEncounterHandoffStatus).toHaveBeenCalledWith(expect.stringContaining("save could not be verified"), {isError: true});
		expect(panel._state.importedEncounterHandoffIds).toEqual([snapshot.id]);
		await panel._pImportEncounterHandoff();
		expect(board.pDoSaveStateNow).toHaveBeenCalledTimes(1);
		expect(panel._state.rows).toHaveLength(2);

		const otherPanel = makePanel({store});
		otherPanel._pendingHandoff = snapshot;
		storage.pRemove.mockRejectedValueOnce(new Error("Cannot remove queue"));
		await otherPanel._pImportEncounterHandoff();
		expect(await store.pRead()).toEqual(snapshot);
		expect(otherPanel._setEncounterHandoffStatus).toHaveBeenCalledWith(expect.stringContaining("Cannot remove queue"), {isError: true});
		expect(otherPanel._state.rows).toHaveLength(2);
		await otherPanel._pImportEncounterHandoff();
		expect(otherPanel._state.rows).toHaveLength(2);
		expect(otherPanel._board.pDoSaveStateNow).toHaveBeenCalledTimes(1);
		const thirdPanel = makePanel({store});
		thirdPanel._pendingHandoff = snapshot;
		thirdPanel._pIsHandoffAlreadySaved.mockResolvedValue(true);
		await thirdPanel._pImportEncounterHandoff();
		expect(thirdPanel._state.rows).toHaveLength(0);
		expect(thirdPanel._board.pDoSaveStateNow).not.toHaveBeenCalled();
		expect(await store.pRead()).toEqual(snapshot);
	});

	it("finds durable receipts in panels and tabs, across save slots", () => {
		expect(isEncounterHandoffImportedInBoardSave({saved: null, id: "once"})).toBe(false);
		const saved = {sls: {
			one: {ps: [{s: {ih: ["other"]}}, {a: [{s: {ih: ["once"]}}]}], ex: []},
			two: {ps: [], ex: [{s: {ih: ["elsewhere"]}}]},
		}};
		expect(isEncounterHandoffImportedInBoardSave({saved, id: "once"})).toBe(true);
		expect(isEncounterHandoffImportedInBoardSave({saved, id: "elsewhere"})).toBe(true);
		expect(isEncounterHandoffImportedInBoardSave({saved, id: "missing"})).toBe(false);
	});

	it("keeps queue on stale confirmations and requires explicit clear without removing tracker rows", async () => {
		const {snapshot} = await makeSnapshot();
		const {store} = makeStore();
		await store.pQueue({snapshot});
		const panel = makePanel({store});
		panel._pendingHandoff = snapshot;
		const newer = {...snapshot, id: "newer"};
		await store.pQueue({snapshot: newer, pConfirmReplace: async () => true});
		await panel._pImportEncounterHandoff();
		expect(panel._state.rows).toHaveLength(0);
		expect(await store.pRead()).toEqual(newer);
		panel._pendingHandoff = newer;
		confirm.mockResolvedValueOnce(false);
		await panel._pClearEncounterHandoff();
		expect(await store.pRead()).toEqual(newer);
		await panel._pClearEncounterHandoff();
		expect(await store.pRead()).toBeNull();
	});
});
