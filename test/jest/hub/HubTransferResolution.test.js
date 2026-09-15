import {jest} from "@jest/globals";

import {
	HubTransferResolutionDrafts,
	pResolveTransferAndRefresh,
} from "../../../js/hub/hub-api-client.js";

describe("Campaign Hub transfer resolution retries", () => {
	it("freezes one decision request until authoritative reconciliation and bounds its replay window", () => {
		let ix = 0;
		let now = 100;
		const drafts = new HubTransferResolutionDrafts({
			fnCreateKey: () => `key-${++ix}`,
			fnNow: () => now,
			replayWindowMs: 50,
		});
		const input = {campaignId: "campaign-1", transferId: "transfer-1"};

		const accept = drafts.stage({...input, decision: "accept", rulesVersionId: "rules-1"});
		expect(accept).toEqual({
			...input,
			decision: "accept",
			rulesVersionId: "rules-1",
			idempotencyKey: "key-1",
			replayUntil: 150,
		});
		expect(drafts.stage({...input, decision: "reject"})).toEqual(accept);
		expect(drafts.isReplayable(accept)).toBe(true);
		now = 150;
		expect(drafts.isReplayable(accept)).toBe(false);
		expect(drafts.clear({...input, idempotencyKey: "wrong-key"})).toBe(false);
		drafts.reconcilePending({campaignId: "campaign-1", pendingTransferIds: ["transfer-1"]});
		expect(drafts.get(input)).toEqual(accept);

		drafts.reconcileCampaign({campaignId: "campaign-1"});
		expect(drafts.stage({...input, decision: "reject"})).toEqual(expect.objectContaining({
			decision: "reject",
			idempotencyKey: "key-2",
		}));
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
