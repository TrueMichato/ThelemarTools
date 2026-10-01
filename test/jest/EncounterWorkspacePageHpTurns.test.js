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

const createPage = async ({isMissingHp = false, monsterOverride = {}} = {}) => {
	let nextId = 0;
	const state = await EncounterWorkspaceState.pFromSavedList({
		exportedSublist: {name: "Ambush", items: [{h: "goblin_mm", c: 2}]},
		pResolveItem: async () => ({entity: {name: "Goblin", source: "MM", dex: 14, hp: isMissingHp ? {} : {average: 7}, ...monsterOverride}}),
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
	page._clearDamageFeedback = jest.fn();
	page._renderVitals = jest.fn();
	page._renderTurnOrder = jest.fn();
	page._renderResourcePanel = jest.fn();
	page._renderRosterMeta = jest.fn();
	page._renderCardSummary = jest.fn();
	page._renderActiveVitals = jest.fn();
	page._focusCurrentTurn = jest.fn();
	page._settings = {autoRollRecharge: false};
	page._renderRollResults = jest.fn();
	page._clearRollResults = jest.fn();
	page._restoreVitalFocus = jest.fn();
	return {page, storage};
};

describe("Encounter Workspace HP/turn controls", () => {
	const withSpentRecharge = state => EncounterWorkspaceState.withRechargeReady(state, {
		id: "goblin-1", rechargeId: "auto:recharge:action:0", ready: false,
	});

	it("prompts only after a saved turn change; Skip, reset, failed saves and no spent abilities never roll", async () => {
		const {page, storage} = await createPage({monsterOverride: {action: [{name: "Breath {@recharge 5}", entries: ["Damage."]}]}});
		page._state = EncounterWorkspaceState.withInitiativeResults(withSpentRecharge(page._state), [
			{id: "goblin-1", total: 15}, {id: "goblin-2", total: 10},
		]);
		const prompt = jest.spyOn(InputUiUtil, "pGetUserBoolean").mockResolvedValue(false);
		const roll = jest.spyOn(Renderer.dice, "pRoll2").mockResolvedValue(6);
		try {
			storage.pSetForPage.mockRejectedValueOnce(new Error("Storage full"));
			await page._pUpdateTurn("start");
			expect(prompt).not.toHaveBeenCalled();
			expect(roll).not.toHaveBeenCalled();
			await page._pUpdateTurn("start");
			expect(prompt).toHaveBeenCalledTimes(1);
			expect(roll).not.toHaveBeenCalled();
			expect(page._state.instances[0].resources.recharges[0].ready).toBe(false);
			await page._pUpdateTurn("next");
			expect(prompt).toHaveBeenCalledTimes(1);
			await page._pUpdateTurn("reset");
			expect(prompt).toHaveBeenCalledTimes(1);
		} finally {
			prompt.mockRestore();
			roll.mockRestore();
		}
	});

	it("rolls each shared-turn member separately, saves successes before announcing ready, and keeps failures spent", async () => {
		const {page, storage} = await createPage({monsterOverride: {
			action: [
				{name: "Breath {@recharge 5}", entries: ["Damage."]},
				{name: "Shout {@recharge 6}", entries: ["Damage."]},
			],
		}});
		page._state = EncounterWorkspaceState.withGroup({state: page._state, memberIds: ["goblin-1", "goblin-2"], id: "group"});
		page._state = EncounterWorkspaceState.withSharedTurn(page._state, {groupId: "group", isShared: true, total: 15});
		for (const id of ["goblin-1", "goblin-2"]) {
			for (const rechargeId of ["auto:recharge:action:0", "auto:recharge:action:1"]) {
				page._state = EncounterWorkspaceState.withRechargeReady(page._state, {id, rechargeId, ready: false});
			}
		}
		page._settings.autoRollRecharge = true;
		const prompt = jest.spyOn(InputUiUtil, "pGetUserBoolean");
		const roll = jest.spyOn(Renderer.dice, "pRoll2")
			.mockResolvedValueOnce(5).mockResolvedValueOnce(5)
			.mockResolvedValueOnce(null).mockResolvedValueOnce("6");
		const toast = jest.spyOn(JqueryUtil, "doToast").mockImplementation(() => {});
		page._setStatus.mockImplementation(text => {
			if (text.includes("ready")) expect(storage.pSetForPage).toHaveBeenCalledTimes(2);
		});
		try {
			await page._pUpdateTurn("start");
			expect(roll).toHaveBeenCalledTimes(4);
			expect(roll).toHaveBeenNthCalledWith(1, "1d6", expect.objectContaining({label: "Breath recharge (5–6)"}), {isResultUsed: false});
			expect(prompt).not.toHaveBeenCalled();
			expect(storage.pSetForPage).toHaveBeenCalledTimes(2);
			expect(page._state.instances.map(it => it.resources.recharges.map(recharge => recharge.ready))).toEqual([
				[true, false], [false, false],
			]);
			expect(page._setStatus).toHaveBeenCalledWith(expect.stringContaining("5 ≥ 5; ready"));
			expect(page._setStatus).toHaveBeenCalledWith(expect.stringContaining("5 < 6; still spent"));
			expect(page._setStatus).toHaveBeenCalledWith(expect.stringContaining("no valid roll; still spent"));
			expect(toast).toHaveBeenCalledTimes(1);
			expect(toast).toHaveBeenCalledWith({type: "success", content: expect.stringContaining("Goblin #1 Breath")});
			expect(toast.mock.calls[0][0].content).not.toMatch(/Shout|Goblin #2/);
		} finally {
			roll.mockRestore();
			prompt.mockRestore();
			toast.mockRestore();
		}
	});

	it("shows a success toast only after the ready state has been persisted", async () => {
		const {page, storage} = await createPage({monsterOverride: {action: [{name: "Breath {@recharge 5}", entries: ["Damage."]}]}});
		page._state = EncounterWorkspaceState.withInitiativeResults(withSpentRecharge(page._state), [{id: "goblin-1", total: 15}]);
		page._settings.autoRollRecharge = true;
		let finishSave;
		let isReadySaved = false;
		storage.pSetForPage.mockImplementation(async (key, state) => {
			if (!state.instances[0].resources.recharges[0].ready) return;
			await new Promise(resolve => { finishSave = resolve; });
			isReadySaved = true;
		});
		const roll = jest.spyOn(Renderer.dice, "pRoll2").mockResolvedValue(6);
		const toast = jest.spyOn(JqueryUtil, "doToast").mockImplementation(() => {
			expect(isReadySaved).toBe(true);
			expect(storage.pSetForPage.mock.lastCall[1].instances[0].resources.recharges[0].ready).toBe(true);
		});
		try {
			const transition = page._pUpdateTurn("start");
			for (let attempt = 0; attempt < 20; attempt++) {
				if (finishSave) break;
				await Promise.resolve();
			}
			expect(finishSave).toEqual(expect.any(Function));
			expect(page._state.instances[0].resources.recharges[0].ready).toBe(false);
			expect(toast).not.toHaveBeenCalled();
			finishSave();
			await transition;
			expect(toast).toHaveBeenCalledTimes(1);
			expect(toast).toHaveBeenCalledWith({
				type: "success",
				content: expect.stringMatching(/Recharged:.*Breath/),
			});
			expect(page._state.instances[0].resources.recharges[0].ready).toBe(true);
		} finally {
			finishSave?.();
			roll.mockRestore();
			toast.mockRestore();
		}
	});

	it("does not announce or publish a successful recharge when its storage write fails", async () => {
		const {page, storage} = await createPage({monsterOverride: {action: [{name: "Breath {@recharge 5}", entries: ["Damage."]}]}});
		page._state = EncounterWorkspaceState.withInitiativeResults(withSpentRecharge(page._state), [{id: "goblin-1", total: 15}]);
		page._settings.autoRollRecharge = true;
		storage.pSetForPage.mockImplementationOnce(async () => {}).mockRejectedValueOnce(new Error("Storage full"));
		const roll = jest.spyOn(Renderer.dice, "pRoll2").mockResolvedValue(6);
		const toast = jest.spyOn(JqueryUtil, "doToast").mockImplementation(() => {});
		try {
			await page._pUpdateTurn("start");
			expect(page._state.turn).toEqual({round: 1, activeId: "goblin-1"});
			expect(page._state.instances[0].resources.recharges[0].ready).toBe(false);
			expect(page._setError).toHaveBeenCalledWith(expect.stringContaining("The turn was saved, but recharge was not completed: Storage full"));
			expect(page._setStatus.mock.calls.some(([message]) => message.includes("; ready"))).toBe(false);
			expect(toast).not.toHaveBeenCalled();
		} finally {
			roll.mockRestore();
			toast.mockRestore();
		}
	});

	it.each([
		{reason: "Skip", shouldRoll: false, result: 6},
		{reason: "a missed threshold", shouldRoll: true, result: 4},
		{reason: "a cancelled roll", shouldRoll: true, result: null},
		{reason: "an invalid roll", shouldRoll: true, result: "6"},
	])("does not show a success toast after $reason", async ({shouldRoll, result}) => {
		const {page, storage} = await createPage({monsterOverride: {action: [{name: "Breath {@recharge 5}", entries: ["Damage."]}]}});
		page._state = EncounterWorkspaceState.withInitiativeResults(withSpentRecharge(page._state), [{id: "goblin-1", total: 15}]);
		const prompt = jest.spyOn(InputUiUtil, "pGetUserBoolean").mockResolvedValue(shouldRoll);
		const roll = jest.spyOn(Renderer.dice, "pRoll2").mockResolvedValue(result);
		const toast = jest.spyOn(JqueryUtil, "doToast").mockImplementation(() => {});
		try {
			await page._pUpdateTurn("start");
			expect(page._state.instances[0].resources.recharges[0].ready).toBe(false);
			expect(storage.pSetForPage).toHaveBeenCalledTimes(1);
			expect(roll).toHaveBeenCalledTimes(Number(shouldRoll));
			expect(toast).not.toHaveBeenCalled();
		} finally {
			prompt.mockRestore();
			roll.mockRestore();
			toast.mockRestore();
		}
	});

	it("checks spent abilities again on the next round of a one-entry initiative", async () => {
		const {page, storage} = await createPage({monsterOverride: {action: [{name: "Breath {@recharge 5}", entries: ["Damage."]}]}});
		page._state = EncounterWorkspaceState.withInitiativeResults(withSpentRecharge(page._state), [{id: "goblin-1", total: 15}]);
		page._settings.autoRollRecharge = true;
		const roll = jest.spyOn(Renderer.dice, "pRoll2").mockResolvedValueOnce(1).mockResolvedValueOnce(6);
		try {
			await page._pUpdateTurn("start");
			expect(page._state.turn).toEqual({round: 1, activeId: "goblin-1"});
			expect(page._state.instances[0].resources.recharges[0].ready).toBe(false);
			await page._pUpdateTurn("next");
			expect(page._state.turn).toEqual({round: 2, activeId: "goblin-1"});
			expect(page._state.instances[0].resources.recharges[0].ready).toBe(true);
			expect(roll).toHaveBeenCalledTimes(2);
			expect(storage.pSetForPage).toHaveBeenCalledTimes(3);
		} finally {
			roll.mockRestore();
		}
	});

	it("keeps resource edits blocked while a recharge die is pending", async () => {
		const {page, storage} = await createPage({monsterOverride: {action: [{name: "Breath {@recharge 5}", entries: ["Damage."]}]}});
		page._state = EncounterWorkspaceState.withInitiativeResults(withSpentRecharge(page._state), [{id: "goblin-1", total: 15}]);
		page._settings.autoRollRecharge = true;
		let finishRoll;
		const roll = jest.spyOn(Renderer.dice, "pRoll2").mockImplementation(() => new Promise(resolve => { finishRoll = resolve; }));
		try {
			const transition = page._pUpdateTurn("start");
			for (let attempt = 0; attempt < 10; attempt++) {
				if (finishRoll) break;
				await Promise.resolve();
			}
			expect(finishRoll).toEqual(expect.any(Function));
			expect(page._isBusy).toBe(true);
			await page._pUpdateResource("goblin-1", {kind: "recharge", rechargeId: "auto:recharge:action:0", ready: true});
			expect(storage.pSetForPage).toHaveBeenCalledTimes(1);
			expect(page._state.instances[0].resources.recharges[0].ready).toBe(false);
			finishRoll(6);
			await transition;
			expect(page._state.instances[0].resources.recharges[0].ready).toBe(true);
			expect(storage.pSetForPage).toHaveBeenCalledTimes(2);
		} finally {
			if (finishRoll) finishRoll(null);
			roll.mockRestore();
		}
	});

	it("reverts a failed automatic-roll setting write without changing the active choice", async () => {
		const {page} = await createPage();
		page._checkAutoRecharge = {checked: true};
		page._settingsStore = {pSave: jest.fn(async () => { throw new Error("Storage full"); })};
		await page._pSetAutoRollRecharge();
		expect(page._settings.autoRollRecharge).toBe(false);
		expect(page._checkAutoRecharge.checked).toBe(false);
		expect(page._setError).toHaveBeenCalledWith(expect.stringContaining("Recharge settings were not saved: Storage full"));
	});
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
