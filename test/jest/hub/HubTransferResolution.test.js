import {jest} from "@jest/globals";

import {
	HubTransferResolutionKeys,
	pResolveTransferAndRefresh,
} from "../../../js/hub/hub-transfer-resolution.js";

describe("Campaign Hub transfer resolution retries", () => {
	it("keeps one key per transfer decision until an authoritative pending-list reconciliation", () => {
		let ix = 0;
		const keys = new HubTransferResolutionKeys({fnCreateKey: () => `key-${++ix}`});
		const input = {campaignId: "campaign-1", transferId: "transfer-1"};

		expect(keys.get({...input, decision: "accept"})).toBe("key-1");
		expect(keys.get({...input, decision: "accept"})).toBe("key-1");
		expect(keys.get({...input, decision: "reject"})).toBe("key-2");

		keys.reconcilePending({campaignId: "campaign-1", pendingTransferIds: ["transfer-1"]});
		expect(keys.get({...input, decision: "accept"})).toBe("key-1");

		keys.reconcilePending({campaignId: "campaign-1", pendingTransferIds: []});
		expect(keys.get({...input, decision: "accept"})).toBe("key-3");
	});

	it("reports a committed resolution separately when only the authoritative refresh fails", async () => {
		const resolution = {transfer: {id: "transfer-1", status: "committed"}};
		const refreshError = new Error("refresh failed");
		const pResolve = jest.fn(async () => resolution);
		const pRefresh = jest.fn(async () => { throw refreshError; });

		await expect(pResolveTransferAndRefresh({pResolve, pRefresh})).resolves.toEqual({
			state: "resolved_refresh_failed",
			resolution,
			refreshError,
		});
		expect(pResolve).toHaveBeenCalledTimes(1);
		expect(pRefresh).toHaveBeenCalledTimes(1);
	});

	it("reports an unknown outcome only when both the resolution response and refresh are unavailable", async () => {
		const resolutionError = new Error("response lost");
		const refreshError = new Error("refresh failed");
		const pResolve = jest.fn(async () => { throw resolutionError; });
		const pRefresh = jest.fn(async () => { throw refreshError; });

		await expect(pResolveTransferAndRefresh({pResolve, pRefresh})).resolves.toEqual({
			state: "resolution_failed_refresh_failed",
			resolutionError,
			refreshError,
		});
		expect(pResolve).toHaveBeenCalledTimes(1);
		expect(pRefresh).toHaveBeenCalledTimes(1);
	});
});
