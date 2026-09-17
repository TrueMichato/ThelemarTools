import {concealProjectionFormControl} from "../../../js/hub/hub-realtime-client.js";

describe("Campaign Hub projection form controls", () => {
	test("keeps balance-refresh recovery available while ordinary controls remain fenced", () => {
		const recovery = {
			dataset: {hubProjectionRecoveryControl: "true"},
			disabled: false,
		};
		const mutation = {
			dataset: {},
			disabled: false,
		};
		const controlStates = new Map();

		concealProjectionFormControl({control: recovery, controlStates});
		concealProjectionFormControl({control: mutation, controlStates});

		expect(recovery.disabled).toBe(false);
		expect(mutation.disabled).toBe(true);
		expect(controlStates.get(recovery)).toBe(false);
		expect(controlStates.get(mutation)).toBe(false);
	});

	test("does not revive an active retry and fails closed when reload is required", () => {
		const activeRetry = {
			dataset: {hubProjectionRecoveryControl: "true"},
			disabled: true,
		};
		const reloadRetry = {
			dataset: {hubProjectionRecoveryControl: "true"},
			disabled: false,
		};

		concealProjectionFormControl({control: activeRetry, controlStates: new Map()});
		concealProjectionFormControl({
			control: reloadRetry,
			controlStates: new Map(),
			isCampaignReloadRequired: true,
		});

		expect(activeRetry.disabled).toBe(true);
		expect(reloadRetry.disabled).toBe(true);
	});
});
