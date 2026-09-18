import {getCampaignConditionCatalog} from "../../../js/hub/hub-condition-catalog.js";

describe("Campaign Hub condition catalog", () => {
	it("uses canonical site and campaign-homebrew conditions with stable name/source identities", () => {
		const catalog = getCampaignConditionCatalog({
			siteData: {
				condition: [
					{name: "Blinded", source: "PHB"},
					{name: "Blinded", source: "XPHB"},
				],
			},
			campaignBrewContent: [
				{body: {condition: [{name: "Dazed", source: "TGTT"}]}},
				{condition: [{name: "Blinded", source: "XPHB"}]},
			],
		});

		expect(catalog).toEqual([
			{name: "Blinded", source: "PHB"},
			{name: "Blinded", source: "XPHB"},
			{name: "Dazed", source: "TGTT"},
		]);
	});

	it("drops malformed records instead of inventing fallback condition identities", () => {
		expect(getCampaignConditionCatalog({
			siteData: {condition: [{name: "Blinded"}, {source: "PHB"}, null]},
			campaignBrewContent: [{body: {condition: [{name: "", source: "TGTT"}]}}],
		})).toEqual([]);
	});

	it("keeps removable legacy and retired conditions beside the active catalog", () => {
		expect(getCampaignConditionCatalog({
			siteData: {condition: [{name: "Blinded", source: "XPHB"}]},
			additionalConditions: [
				"Poisoned",
				{name: "Dazed", source: "RETIRED"},
				{name: "Blinded", source: "XPHB"},
			],
		})).toEqual([
			{name: "Blinded", source: "XPHB"},
			{name: "Dazed", source: "RETIRED"},
			{name: "Poisoned", source: "XPHB"},
		]);
	});
});
