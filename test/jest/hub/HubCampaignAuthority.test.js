import {jest} from "@jest/globals";
import {createCampaignAuthorityChangeHandler} from "../../../js/hub/hub-realtime-client.js";

describe("Campaign Overview authority changes", () => {
	function getHarness ({isReloadRequired = false} = {}) {
		const calls = [];
		let isReloadRequiredCurrent = isReloadRequired;
		const fnReload = jest.fn(() => calls.push("reload"));
		const handler = createCampaignAuthorityChangeHandler({
			fnIsReloadRequired: () => isReloadRequiredCurrent,
			fnSetReloadRequired: () => {
				calls.push("set-reload-required");
				isReloadRequiredCurrent = true;
			},
			fnConcealAuthorization: () => calls.push("conceal"),
			fnStopLiveUpdates: () => calls.push("stop-live-updates"),
			fnReload,
		});
		return {
			calls,
			fnReload,
			handler,
			isReloadRequired: () => isReloadRequiredCurrent,
		};
	}

	it("conceals and stops realtime when a reconnect cursor confirms offline role loss", () => {
		const harness = getHarness({isReloadRequired: true});

		harness.handler();

		expect(harness.calls).toEqual([
			"conceal",
			"set-reload-required",
			"stop-live-updates",
		]);
		expect(harness.fnReload).not.toHaveBeenCalled();
		expect(harness.isReloadRequired()).toBe(true);
	});

	it("keeps repeated cursor and event authority loss idempotent without duplicate navigation", () => {
		const harness = getHarness();

		harness.handler();
		harness.handler();

		expect(harness.calls).toEqual([
			"conceal",
			"set-reload-required",
			"stop-live-updates",
			"reload",
			"conceal",
			"set-reload-required",
			"stop-live-updates",
		]);
		expect(harness.fnReload).toHaveBeenCalledTimes(1);
		expect(harness.isReloadRequired()).toBe(true);
	});
});
