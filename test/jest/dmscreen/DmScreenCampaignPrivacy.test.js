import {jest} from "@jest/globals";

import {
	concealDmScreenCampaignWorkspace,
	pHandleDmScreenCampaignAccessLoss,
} from "../../../js/dmscreen/dmscreen-campaign-privacy.js";

describe("DM Screen campaign privacy teardown", () => {
	it("removes private panels and projections before later teardown stages run", () => {
		const eleScreen = {
			empty: jest.fn(),
			textContent: "",
			setAttribute: jest.fn(),
		};
		const board = {
			_hubCharacterProjections: [{id: "private-character"}],
			_hubCampaignStatus: {campaignId: "private-campaign"},
			_hubCampaignContext: {brewBundle: {content: [{name: "Private Brew"}]}},
			panels: {1: {title: "Private Notes"}},
			exiledPanels: [{title: "Private Notes"}],
			eleScreen,
		};
		board.fenceHubPrivatePersistence = jest.fn(() => {
			expect(board.panels).toEqual({1: {title: "Private Notes"}});
		});

		concealDmScreenCampaignWorkspace({board});

		expect(board.fenceHubPrivatePersistence).toHaveBeenCalledTimes(1);
		expect(board._hubCharacterProjections).toEqual([]);
		expect(board._hubCampaignStatus).toBeNull();
		expect(board._hubCampaignContext).toBeNull();
		expect(board.panels).toEqual({});
		expect(board.exiledPanels).toEqual([]);
		expect(eleScreen.empty).toHaveBeenCalledTimes(1);
		expect(eleScreen.textContent).toMatch(/Campaign access ended/);
		expect(eleScreen.setAttribute).toHaveBeenCalledWith("role", "alert");
	});

	it("conceals before classifying a DM-role loss without clearing the campaign selection", async () => {
		const order = [];
		const coordinator = {
			session: {signedIn: true},
			pHandleSurfaceRoleLoss: jest.fn(() => order.push("role-loss")),
			pReportFailure: jest.fn(),
		};

		await pHandleDmScreenCampaignAccessLoss({
			error: {code: "DM_ROLE_REQUIRED", status: 403},
			campaignId: "campaign-1",
			coordinator,
			realtime: {close: () => order.push("realtime")},
			controller: {detach: () => order.push("controller")},
			board: {concealHubPrivateWorkspace: () => order.push("conceal")},
		});

		expect(order).toEqual(["realtime", "controller", "conceal", "role-loss"]);
		expect(coordinator.pReportFailure).not.toHaveBeenCalled();
	});

	it("conceals before clearing an authoritatively inaccessible campaign", async () => {
		const order = [];
		const error = {code: "MEMBERSHIP_NOT_FOUND", status: 404};
		const coordinator = {
			session: {signedIn: true},
			pHandleSurfaceRoleLoss: jest.fn(),
			pReportFailure: jest.fn(() => order.push("report-failure")),
		};

		await pHandleDmScreenCampaignAccessLoss({
			error,
			campaignId: "campaign-1",
			coordinator,
			realtime: {close: () => order.push("realtime")},
			controller: {detach: () => order.push("controller")},
			board: {concealHubPrivateWorkspace: () => order.push("conceal")},
		});

		expect(order).toEqual(["realtime", "controller", "conceal", "report-failure"]);
		expect(coordinator.pReportFailure).toHaveBeenCalledWith({
			error,
			campaignId: "campaign-1",
			session: coordinator.session,
			trigger: "access_loss",
		});
		expect(coordinator.pHandleSurfaceRoleLoss).not.toHaveBeenCalled();
	});
});
