import {PANEL_TYP_EMPTY} from "./dmscreen-consts.js";

function _getConflictPromptOpts () {
	return {
		title: "DM Workspace Changed on Another Device",
		htmlDescription: "Your local workspace overlaps a newer server version. Use your local workspace, or load the server workspace?",
		textYes: "Use Local",
		textNo: "Use Server",
	};
}

export function isDmScreenSaveOperationCurrent ({board, saveGeneration}) {
	return !board._isPersistenceFenced && saveGeneration === board._saveGeneration;
}

export function markDmScreenSavePending ({board}) {
	if (board._isPersistenceFenced) return false;
	board._saveGeneration++;
	return true;
}

export function hasPendingDmScreenSave ({board}) {
	if (board._isPersistenceFenced) return false;
	return board._savedGeneration < board._saveGeneration;
}

function _getDefaultCanApply () {
	return true;
}

export async function pDoDmScreenWorkspaceSave ({board, saveGeneration}) {
	try {
		await board._workspaceRepository.pSet(board.getSaveableState());
		if (!isDmScreenSaveOperationCurrent({board, saveGeneration})) return;
		board._savedGeneration = Math.max(board._savedGeneration, saveGeneration);
	} catch (error) {
		if (error?.code === "WORKSPACE_CONFLICT" && board._workspaceRepository.pResolveConflict) {
			if (!isDmScreenSaveOperationCurrent({board, saveGeneration})) return;
			const choice = await InputUiUtil.pGetUserBoolean(_getConflictPromptOpts());
			if (!isDmScreenSaveOperationCurrent({board, saveGeneration})) return;
			if (choice == null) {
				DataUtil.userDownload("dm-workspace-conflict-local", error.recovery.local, {fileType: "dm-screen"});
				return;
			}
			const resolved = await board._workspaceRepository.pResolveConflict({choice: choice ? "local" : "server"});
			if (!isDmScreenSaveOperationCurrent({board, saveGeneration})) return;
			if (!choice && resolved) {
				await board.pDoLoadStateFrom(resolved, {
					fnCanApply: () => isDmScreenSaveOperationCurrent({board, saveGeneration}),
				});
				if (!isDmScreenSaveOperationCurrent({board, saveGeneration})) return;
			}
			board._savedGeneration = Math.max(board._savedGeneration, saveGeneration);
			return;
		}

		if (!isDmScreenSaveOperationCurrent({board, saveGeneration})) return;
		// eslint-disable-next-line no-console
		console.error("Failed to save DM screen:", error);
		JqueryUtil.doToast({
			content: `Failed to save DM screen. ${VeCt.STR_SEE_CONSOLE}`,
			type: "danger",
		});
	}
}

export async function pApplyDmScreenLoadedState ({
	board,
	state,
	isCombined,
	fnCanApply = _getDefaultCanApply,
	pFnLoadPanelFromSavedState,
}) {
	if (!fnCanApply()) return false;

	const {width, height} = board._pDoLoadStateFrom_getStretchedWidthHeight({state, isCombined});
	if (!fnCanApply()) return false;

	board.doReset({width, height});
	if (!fnCanApply()) return false;

	if (board.cbConfirmTabClose) board.cbConfirmTabClose.prop("checked", !!state.ctc);
	if ((state.fs !== !!board.isFullscreen)) board.doToggleFullscreen({val: !!state.fs});
	if ((state.lk !== !!board.isLocked)) board.doToggleLocked({val: !!state.lk});

	board._idSaveSlotActive = state.sla ?? "1";
	board._saveSlotStates = state.sls ?? {[board._idSaveSlotActive]: {}};

	const saveSlotStateActive = state.sls?.[state.sla] || {};

	const toReExile = (saveSlotStateActive.ex || [])
		.filter(Boolean)
		.reverse();
	for (const saved of toReExile) {
		if (!fnCanApply()) return false;
		const panel = await pFnLoadPanelFromSavedState({board, saved, fnCanApply});
		if (!fnCanApply()) return false;
		if (!panel) continue;

		board.panels[panel.id] = panel;
		board.fireBoardEvent({type: "panelIdSetActive", payload: {type: panel.type}});
		panel.exile();
	}

	const toReload = (saveSlotStateActive.ps || [])
		.filter(Boolean)
		.filter(saved => saved.t !== PANEL_TYP_EMPTY)
		.filter(saved => (saved.x < board.width) && (saved.y < board.height));
	for (const saved of toReload) {
		if (!fnCanApply()) return false;
		const panel = await pFnLoadPanelFromSavedState({board, saved, fnCanApply});
		if (!fnCanApply()) return false;
		if (!panel) continue;

		board.panels[panel.id] = panel;
		board.fireBoardEvent({type: "panelIdSetActive", payload: {type: panel.type}});
	}

	if (!fnCanApply()) return false;
	board.doCheckFillSpaces();

	if (!fnCanApply()) return false;
	board.sideMenu.setSaveSlotInfo({
		idSaveSlotActive: board._idSaveSlotActive,
		saveSlotStates: board._saveSlotStates,
	});

	return true;
}
