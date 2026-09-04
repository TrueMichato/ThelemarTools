import {jest} from "@jest/globals";

import {
	HUB_CAPABILITY_CAMPAIGN_RULES_POLICY,
	pLoadHubCapabilityModule,
} from "../../../js/hub/hub-capabilities.js";

describe("pLoadHubCapabilityModule", () => {
	it("does not request an optional chunk when the capability is disabled", async () => {
		const pImport = jest.fn();
		await expect(pLoadHubCapabilityModule({
			capability: HUB_CAPABILITY_CAMPAIGN_RULES_POLICY,
			pGetMeta: async () => ({capabilities: []}),
			pImport,
		})).resolves.toEqual({status: "disabled", module: null, error: null});
		expect(pImport).not.toHaveBeenCalled();
	});

	it.each([
		["metadata", {
			pGetMeta: async () => { throw new Error("metadata unavailable"); },
			pImport: jest.fn(),
		}],
		["chunk", {
			pGetMeta: async () => ({capabilities: [HUB_CAPABILITY_CAMPAIGN_RULES_POLICY]}),
			pImport: async () => { throw new Error("chunk unavailable"); },
		}],
	])("returns an explicit unavailable state when %s loading fails", async (_label, options) => {
		const result = await pLoadHubCapabilityModule({
			capability: HUB_CAPABILITY_CAMPAIGN_RULES_POLICY,
			...options,
		});
		expect(result).toEqual({
			status: "unavailable",
			module: null,
			error: expect.any(Error),
		});
	});

	it("returns the enabled module only after capability discovery", async () => {
		const module = {pInit: jest.fn()};
		await expect(pLoadHubCapabilityModule({
			capability: HUB_CAPABILITY_CAMPAIGN_RULES_POLICY,
			pGetMeta: async () => ({capabilities: [HUB_CAPABILITY_CAMPAIGN_RULES_POLICY]}),
			pImport: async () => module,
		})).resolves.toEqual({status: "ready", module, error: null});
	});
});
