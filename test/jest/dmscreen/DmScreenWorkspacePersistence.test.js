import {jest} from "@jest/globals";

import {concealDmScreenCampaignWorkspace} from "../../../js/dmscreen/dmscreen-campaign-privacy.js";
import {
	isDmScreenSaveOperationCurrent,
	pApplyDmScreenLoadedState,
	pDoDmScreenWorkspaceSave,
} from "../../../js/dmscreen/dmscreen-workspace-persistence.js";
import {PANEL_TYP_RULES} from "../../../js/dmscreen/dmscreen-consts.js";

function getDeferred () {
	let resolve;
	let reject;
	const promise = new Promise((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return {promise, resolve, reject};
}

function getBoard ({
	workspaceRepository = null,
	saveGeneration = 1,
	panels = {1: {title: "Private Notes"}},
	exiledPanels = [{title: "Private Notes"}],
} = {}) {
	const board = {
		_workspaceRepository: workspaceRepository || {
			pSet: jest.fn(async () => undefined),
			pResolveConflict: jest.fn(async () => null),
		},
		_hubCharacterProjections: [{id: "private-character"}],
		_hubCampaignStatus: {campaignId: "private-campaign"},
		_hubCampaignContext: {brewBundle: {content: [{name: "Private Brew"}]}},
		_saveGeneration: saveGeneration,
		_savedGeneration: 0,
		_isPersistenceFenced: false,
		panels,
		exiledPanels,
		eleScreen: {
			empty: jest.fn(),
			textContent: "",
			setAttribute: jest.fn(),
		},
		cbConfirmTabClose: {prop: jest.fn()},
		sideMenu: {
			setSaveSlotInfo: jest.fn(),
		},
		width: 1,
		height: 1,
		doReset: jest.fn(function ({width, height}) {
			this.panels = {};
			this.exiledPanels = [];
			this.width = width;
			this.height = height;
		}),
		doToggleFullscreen: jest.fn(),
		doToggleLocked: jest.fn(),
		doCheckFillSpaces: jest.fn(),
		fireBoardEvent: jest.fn(),
		_pDoLoadStateFrom_getStretchedWidthHeight: jest.fn(({state}) => ({width: state.w, height: state.h})),
		getSaveableState: jest.fn(() => ({panels: ["local-state"]})),
		fenceHubPrivatePersistence: jest.fn(function () {
			this._isPersistenceFenced = true;
			this._savedGeneration = this._saveGeneration;
		}),
	};
	board.pDoLoadStateFrom = jest.fn(async resolved => {
		board.panels = {restored: resolved};
	});
	return board;
}

describe("DM Screen workspace persistence", () => {
	let originalInputUiUtil;
	let originalDataUtil;
	let originalJqueryUtil;

	beforeEach(() => {
		originalInputUiUtil = globalThis.InputUiUtil;
		originalDataUtil = globalThis.DataUtil;
		originalJqueryUtil = globalThis.JqueryUtil;

		globalThis.InputUiUtil = {pGetUserBoolean: jest.fn()};
		globalThis.DataUtil = {userDownload: jest.fn()};
		globalThis.JqueryUtil = {doToast: jest.fn()};
	});

	afterEach(() => {
		globalThis.InputUiUtil = originalInputUiUtil;
		globalThis.DataUtil = originalDataUtil;
		globalThis.JqueryUtil = originalJqueryUtil;
	});

	it("preserves normal workspace conflict resolution while current", async () => {
		const resolved = {panels: ["server-state"]};
		const workspaceRepository = {
			pSet: jest.fn(async () => {
				const error = new Error("conflict");
				error.code = "WORKSPACE_CONFLICT";
				error.recovery = {local: {panels: ["local-state"]}};
				throw error;
			}),
			pResolveConflict: jest.fn(async () => resolved),
		};
		const board = getBoard({workspaceRepository});
		board.pDoLoadStateFrom = jest.fn(async () => undefined);
		globalThis.InputUiUtil.pGetUserBoolean.mockResolvedValue(false);

		await pDoDmScreenWorkspaceSave({board, saveGeneration: 1});

		expect(globalThis.InputUiUtil.pGetUserBoolean).toHaveBeenCalledTimes(1);
		expect(globalThis.DataUtil.userDownload).not.toHaveBeenCalled();
		expect(workspaceRepository.pResolveConflict).toHaveBeenCalledWith({choice: "server"});
		expect(board.pDoLoadStateFrom).toHaveBeenCalledWith(resolved, expect.objectContaining({
			fnCanApply: expect.any(Function),
		}));
		expect(board._savedGeneration).toBe(1);
	});

	it("fences an in-flight workspace conflict after campaign concealment", async () => {
		const deferred = getDeferred();
		const workspaceRepository = {
			pSet: jest.fn(() => deferred.promise),
			pResolveConflict: jest.fn(async () => ({panels: ["server-state"]})),
		};
		const board = getBoard({workspaceRepository});
		board.pDoLoadStateFrom = jest.fn(async () => {
			board.panels = {restored: true};
		});

		const savePromise = pDoDmScreenWorkspaceSave({board, saveGeneration: 1});

		concealDmScreenCampaignWorkspace({board});

		const error = new Error("conflict");
		error.code = "WORKSPACE_CONFLICT";
		error.recovery = {local: {panels: ["local-state"]}};
		deferred.reject(error);

		await savePromise;

		expect(globalThis.InputUiUtil.pGetUserBoolean).not.toHaveBeenCalled();
		expect(globalThis.DataUtil.userDownload).not.toHaveBeenCalled();
		expect(workspaceRepository.pResolveConflict).not.toHaveBeenCalled();
		expect(board.pDoLoadStateFrom).not.toHaveBeenCalled();
		expect(board.panels).toEqual({});
		expect(board.exiledPanels).toEqual([]);
		expect(board._savedGeneration).toBe(1);
		expect(board.eleScreen.empty).toHaveBeenCalledTimes(1);
	});

	it("fences conflict-driven state adoption when access loss interleaves during panel hydration", async () => {
		const deferred = getDeferred();
		const board = getBoard();
		const saveGeneration = 1;
		const fnCanApply = () => isDmScreenSaveOperationCurrent({board, saveGeneration});
		const pFnLoadPanelFromSavedState = jest.fn(async ({fnCanApply}) => {
			await deferred.promise;
			if (!fnCanApply()) return null;
			return {
				id: "restored-panel",
				type: PANEL_TYP_RULES,
				exile: jest.fn(),
			};
		});

		const loadPromise = pApplyDmScreenLoadedState({
			board,
			state: {
				w: 3,
				h: 2,
				sla: "1",
				sls: {
					"1": {
						ps: [{x: 0, y: 0, w: 1, h: 1, t: PANEL_TYP_RULES}],
					},
				},
			},
			isCombined: false,
			fnCanApply,
			pFnLoadPanelFromSavedState,
		});

		concealDmScreenCampaignWorkspace({board});
		deferred.resolve();

		await loadPromise;

		expect(pFnLoadPanelFromSavedState).toHaveBeenCalledTimes(1);
		expect(board.doReset).toHaveBeenCalledTimes(1);
		expect(board.panels).toEqual({});
		expect(board.exiledPanels).toEqual([]);
		expect(board.fireBoardEvent).not.toHaveBeenCalled();
		expect(board.doCheckFillSpaces).not.toHaveBeenCalled();
		expect(board.sideMenu.setSaveSlotInfo).not.toHaveBeenCalled();
		expect(board.eleScreen.textContent).toMatch(/Campaign access ended/);
	});
});
