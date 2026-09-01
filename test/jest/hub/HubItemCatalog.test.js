import {jest} from "@jest/globals";
import {buildHubItemCatalog, pLoadHubItemCatalog} from "../../../js/hub/hub-item-catalog.js";

describe("Hub item catalog", () => {
	it("combines base, regular, and campaign items with case-insensitive UID deduplication", () => {
		const catalog = buildHubItemCatalog({
			items: {item: [
				{name: "Potion of Healing", source: "DMG"},
				{name: "Ignored without source"},
			]},
			baseItems: {baseitem: [
				{name: "Longsword", source: "PHB"},
				{name: "potion of healing", source: "dmg"},
			]},
			campaignBrewContent: [{
				head: {filename: "campaign.json"},
				body: {item: [{name: "Moon Blade", source: "TGTT"}]},
			}],
		});

		expect(catalog).toEqual([
			{name: "Longsword", source: "PHB"},
			{name: "Moon Blade", source: "TGTT"},
			{name: "Potion of Healing", source: "DMG"},
		]);
	});

	it("loads only the two item data files on demand", async () => {
		const fnFetch = jest.fn(async url => ({
			ok: true,
			json: async () => url.endsWith("items-base.json")
				? {baseitem: [{name: "Club", source: "PHB"}]}
				: {item: [{name: "Bag of Holding", source: "DMG"}]},
		}));

		await expect(pLoadHubItemCatalog({fnFetch})).resolves.toEqual([
			{name: "Bag of Holding", source: "DMG"},
			{name: "Club", source: "PHB"},
		]);
		expect(fnFetch.mock.calls.map(([url]) => url)).toEqual(["data/items.json", "data/items-base.json"]);
	});

	it("surfaces a failed catalog request", async () => {
		const fnFetch = jest.fn(async () => ({ok: false}));
		await expect(pLoadHubItemCatalog({fnFetch})).rejects.toThrow("Could not load data/items.json.");
	});
});
