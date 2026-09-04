export function concealDmScreenCampaignWorkspace ({board}) {
	board.fenceHubPrivatePersistence?.();
	board._hubCharacterProjections = [];
	board._hubCampaignStatus = null;
	board._hubCampaignContext = null;
	board.panels = {};
	board.exiledPanels = [];
	board.eleScreen.empty();
	board.eleScreen.textContent = "Campaign access ended. Reload or return to the Campaign Hub.";
	board.eleScreen.setAttribute("role", "alert");
}

export function pHandleDmScreenCampaignAccessLoss ({
	error,
	campaignId,
	coordinator,
	controller,
	realtime,
	board,
}) {
	realtime?.close?.();
	controller?.detach?.();
	board?.concealHubPrivateWorkspace?.();
	if (error?.status === 403 || ["FORBIDDEN", "DM_ROLE_REQUIRED"].includes(error?.code)) {
		return coordinator?.pHandleSurfaceRoleLoss?.();
	}
	return coordinator?.pReportFailure?.({
		error,
		campaignId,
		session: coordinator?.session,
		trigger: "access_loss",
	});
}
