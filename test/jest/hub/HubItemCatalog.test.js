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
			{name: "Longsword", source: "PHB", sourceKind: "catalog"},
			{name: "Moon Blade", source: "TGTT", sourceKind: "campaign_item"},
			{name: "Potion of Healing", source: "DMG", sourceKind: "catalog"},
		]);
	});

	it("keeps only bounded award metadata from catalog entities", () => {
		expect(buildHubItemCatalog({
			items: {item: [{
				name: "Moon-Touched Sword",
				source: "XGE",
				page: 138,
				rarity: "common",
				type: "M",
				weight: 3,
				value: 1500,
				edition: "classic",
				entries: ["This rich content must not enter an award request."],
				_onClick: "alert(1)",
			}]},
		})).toEqual([{
			name: "Moon-Touched Sword",
			source: "XGE",
			sourceKind: "catalog",
			page: 138,
			rarity: "common",
			typeCode: "M",
			weight: 3,
			value: 1500,
			edition: "classic",
		}]);
	});

	it("loads only the two item data files on demand", async () => {
		const fnFetch = jest.fn(async url => ({
			ok: true,
			json: async () => url.endsWith("items-base.json")
				? {baseitem: [{name: "Club", source: "PHB"}]}
				: {item: [{name: "Bag of Holding", source: "DMG"}]},
		}));

		await expect(pLoadHubItemCatalog({fnFetch})).resolves.toEqual([
			{name: "Bag of Holding", source: "DMG", sourceKind: "catalog"},
			{name: "Club", source: "PHB", sourceKind: "catalog"},
		]);
		expect(fnFetch.mock.calls.map(([url]) => url)).toEqual(["data/items.json", "data/items-base.json"]);
	});

	it("surfaces a failed catalog request", async () => {
		const fnFetch = jest.fn(async () => ({ok: false}));
		await expect(pLoadHubItemCatalog({fnFetch})).rejects.toThrow("Could not load data/items.json.");
	});
});
