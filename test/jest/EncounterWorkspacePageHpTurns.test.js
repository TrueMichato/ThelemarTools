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

const createPage = async ({isMissingHp = false} = {}) => {
	let nextId = 0;
	const state = await EncounterWorkspaceState.pFromSavedList({
		exportedSublist: {name: "Ambush", items: [{h: "goblin_mm", c: 2}]},
		pResolveItem: async () => ({entity: {name: "Goblin", source: "MM", dex: 14, hp: isMissingHp ? {} : {average: 7}}}),
		fnUid: () => `goblin-${++nextId}`,
	});
	const storage = {
		pSetForPage: jest.fn(async () => {}),
		pGetForPage: jest.fn(async () => null),
	};
	const page = Object.create(EncounterWorkspacePage.prototype);
	page._state = state;
	page._store = new EncounterWorkspaceStore({storage});
	page._isBusy = false;
	page._hpUndo = [];
	page._inpHpExpression = {value: "=8d6"};
	page._checkHpHalf = {checked: false};
	page._selInitMode = {value: "normal"};
	page._setBusy = jest.fn(value => page._isBusy = value);
	page._setStatus = jest.fn();
	page._setError = jest.fn();
	page._renderVitals = jest.fn();
	page._renderTurnOrder = jest.fn();
	page._renderRollResults = jest.fn();
	page._clearRollResults = jest.fn();
	page._restoreVitalFocus = jest.fn();
	return {page, storage};
};

describe("Encounter Workspace HP/turn controls", () => {
	it("evaluates HP dice only once for the selected batch, persists one state, and undoes only committed changes", async () => {
		const {page, storage} = await createPage();
		const tree = jest.spyOn(Renderer.dice.lang, "getTree3");
		try {
			await page._pApplyHp();
			expect(tree.mock.calls.filter(([raw]) => raw === "8d6")).toHaveLength(1);
			expect(page._state.instances[0].hp.current).toBe(page._state.instances[1].hp.current);
			expect(page._state.instances[0].hp.current).toBeGreaterThanOrEqual(8);
			expect(page._hpUndo).toHaveLength(1);
			expect(storage.pSetForPage).toHaveBeenCalledTimes(1);
			await page._pUndoHp();
			expect(page._state.instances.map(it => it.hp.current)).toEqual([7, 7]);
			expect(page._hpUndo).toHaveLength(0);
			expect(storage.pSetForPage).toHaveBeenCalledTimes(2);
		} finally {
			tree.mockRestore();
		}
	});

	it("skips and names unset HP targets, without parsing dice for zero eligible or zero selected", async () => {
		const {page, storage} = await createPage({isMissingHp: true});
		const tree = jest.spyOn(Renderer.dice.lang, "getTree3");
		try {
			await page._pApplyHp();
			expect(tree).not.toHaveBeenCalled();
			expect(storage.pSetForPage).not.toHaveBeenCalled();
			expect(page._setError).toHaveBeenCalledWith(expect.stringContaining("No selected monsters have usable HP"));
			page._state = EncounterWorkspaceState.withHp(page._state, {id: "goblin-1", prop: "max", value: 10});
			await page._pApplyHp();
			expect(page._state.instances.map(it => it.hp.current)[1]).toBeNull();
			expect(page._setStatus).toHaveBeenCalledWith(expect.stringContaining("Skipped 1 with unset HP: Goblin #2"));
			expect(tree.mock.calls.filter(([raw]) => raw === "8d6")).toHaveLength(1);
			page._state = {...page._state, selectedIds: []};
			await page._pApplyHp();
			expect(tree.mock.calls.filter(([raw]) => raw === "8d6")).toHaveLength(1);
		} finally {
			tree.mockRestore();
		}
	});

	it("halves damage down but does not halve healing or an absolute set", async () => {
		const {page} = await createPage();
		page._checkHpHalf.checked = true;
		page._inpHpExpression.value = "-5";
		await page._pApplyHp();
		expect(page._state.instances.map(it => it.hp.current)).toEqual([5, 5]);
		page._inpHpExpression.value = "+2";
		await page._pApplyHp();
		expect(page._state.instances.map(it => it.hp.current)).toEqual([7, 7]);
		page._inpHpExpression.value = "=4";
		await page._pApplyHp();
		expect(page._state.instances.map(it => it.hp.current)).toEqual([4, 4]);
	});

	it("retains only five successful bulk undo entries", async () => {
		const {page} = await createPage();
		for (const value of [1, 2, 3, 4, 5, 6]) {
			page._inpHpExpression.value = `=${value}`;
			await page._pApplyHp();
		}
		expect(page._hpUndo).toHaveLength(5);
		for (let ix = 0; ix < 5; ix++) await page._pUndoHp();
		expect(page._state.instances.map(it => it.hp.current)).toEqual([1, 1]);
		expect(page._hpUndo).toHaveLength(0);
	});

	it("does not change visible HP or undo on failed apply/undo, and clears undo only after a successful direct edit", async () => {
		const {page, storage} = await createPage();
		page._inpHpExpression.value = "-3";
		storage.pSetForPage.mockRejectedValueOnce(new Error("Storage full"));
		await page._pApplyHp();
		expect(page._state.instances.map(it => it.hp.current)).toEqual([7, 7]);
		expect(page._hpUndo).toHaveLength(0);
		expect(page._setError).toHaveBeenCalledWith(expect.stringContaining("Storage full"));
		await page._pApplyHp();
		expect(page._state.instances.map(it => it.hp.current)).toEqual([4, 4]);
		expect(page._hpUndo).toHaveLength(1);
		storage.pSetForPage.mockRejectedValueOnce(new Error("Storage full"));
		await page._pUndoHp();
		expect(page._state.instances.map(it => it.hp.current)).toEqual([4, 4]);
		expect(page._hpUndo).toHaveLength(1);
		const priorDocument = globalThis.document;
		globalThis.document = {activeElement: null};
		try {
			storage.pSetForPage.mockRejectedValueOnce(new Error("Storage full"));
			await page._pSetHp({id: "goblin-1", prop: "current", raw: "2"});
			expect(page._hpUndo).toHaveLength(1);
			expect(page._state.instances[0].hp.current).toBe(4);
			await page._pSetHp({id: "goblin-1", prop: "current", raw: "2"});
			expect(page._hpUndo).toHaveLength(0);
			expect(page._state.instances.map(it => it.hp.current)).toEqual([2, 4]);
			await page._pSetHp({id: "goblin-1", prop: "current", raw: "-2"});
			expect(page._state.instances[0].hp.current).toBe(2);
			expect(page._setError).toHaveBeenCalledWith(expect.stringContaining("Hit points cannot be negative"));
		} finally {
			globalThis.document = priorDocument;
		}
	});

	it("keeps initiative and active turn on failed saves; canceled rolls do not add totals", async () => {
		const {page, storage} = await createPage();
		const priorDocument = globalThis.document;
		globalThis.document = {activeElement: null};
		try {
			storage.pSetForPage.mockRejectedValueOnce(new Error("Storage full"));
			await page._pSetInitiative({id: "goblin-1", raw: "19"});
			expect(page._state.instances[0].initiative).toBeNull();
			await page._pSetInitiative({id: "goblin-1", raw: "19"});
			await page._pSetInitiative({id: "goblin-2", raw: "19"});
			await page._pUpdateTurn("start");
			expect(page._state.turn).toEqual({round: 1, activeId: "goblin-1"});
			storage.pSetForPage.mockRejectedValueOnce(new Error("Storage full"));
			await page._pUpdateTurn("next");
			expect(page._state.turn).toEqual({round: 1, activeId: "goblin-1"});
			expect(page._setError).toHaveBeenCalledWith(expect.stringContaining("Storage full"));
			await page._pSetInitiative({id: "goblin-1", raw: ""});
			expect(page._state.turn).toEqual({round: 0, activeId: null});
			expect(page._state.instances.map(it => it.initiative)).toEqual([null, 19]);
		} finally {
			globalThis.document = priorDocument;
		}
	});

	it("saves only completed selected initiative rolls and preserves cancelled totals, including on failed writes", async () => {
		const {page, storage} = await createPage();
		page._state = EncounterWorkspaceState.withInitiativeResults(page._state, [
			{id: "goblin-1", total: 3},
			{id: "goblin-2", total: 12},
		]);
		const dice = jest.spyOn(Renderer.dice, "pRoll2").mockResolvedValueOnce(17).mockResolvedValueOnce(null);
		try {
			await page._pRollInitiative();
			expect(page._state.instances.map(it => it.initiative)).toEqual([17, 12]);
			expect(storage.pSetForPage).toHaveBeenCalledTimes(1);
			expect(page._renderRollResults).toHaveBeenCalledWith(expect.objectContaining({
				results: [expect.objectContaining({id: "goblin-1", total: 17})],
				failures: [expect.objectContaining({id: "goblin-2", reason: expect.stringContaining("cancelled")})],
			}));
			expect(page._setError).toHaveBeenCalledWith(expect.stringContaining("1 initiatives saved, 1 failed"));
			storage.pSetForPage.mockRejectedValueOnce(new Error("Storage full"));
			dice.mockResolvedValueOnce(14).mockResolvedValueOnce(16);
			await page._pRollInitiative();
			expect(page._state.instances.map(it => it.initiative)).toEqual([17, 12]);
			expect(page._setError).toHaveBeenCalledWith(expect.stringContaining("Initiative was not saved: Storage full"));
		} finally {
			dice.mockRestore();
		}
	});
});
