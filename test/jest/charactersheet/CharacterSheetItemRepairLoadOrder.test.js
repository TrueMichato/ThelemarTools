import fs from "node:fs";

import "./setup.js";
import "../../../js/parser.js";
import "../../../js/utils.js";
import "../../../js/render.js";
import {addAwardedEntryToCharacter} from "../../../server/src/hub-actions.js";

globalThis.MiscUtil.copyFast = obj => obj === undefined ? undefined : JSON.parse(JSON.stringify(obj));
globalThis.window ||= {addEventListener () {}};
globalThis.document ||= {
	addEventListener () {},
	getElementById: () => null,
	querySelector: () => null,
	querySelectorAll: () => [],
	body: {
		appendChild () {},
		classList: {add () {}, remove () {}},
	},
};
globalThis.VetoolsConfig ||= {get: () => "classic"};

await import("../../../js/charactersheet/charactersheet.js");

const CharacterSheetPage = globalThis.CharacterSheetPage;
const CharacterSheetState = globalThis.CharacterSheetState;
const SITE_ITEMS = JSON.parse(fs.readFileSync(
	new URL("../../../data/items.json", import.meta.url),
	"utf8",
)).item;
const SITE_BASE_ITEMS = JSON.parse(fs.readFileSync(
	new URL("../../../data/items-base.json", import.meta.url),
	"utf8",
)).baseitem;

function getSiteItem (name, source) {
	const item = SITE_ITEMS.find(it => it.name === name && it.source === source);
	if (!item) throw new Error(`Missing site item: ${name}|${source}`);
	return structuredClone(item);
}

describe("Character Sheet item repair catalog load order", () => {
	test("captures a minimal immutable repair projection before site and brew enhancement", async () => {
		const siteItem = getSiteItem("+1 Rhythm-Maker's Drum", "TCE");
		const brewItem = {
			name: "Campaign Harp",
			source: "TST",
			type: "INS",
			rarity: "uncommon",
			entries: ["A synthetic campaign-brew instrument."],
		};
		const canonicalSiteItem = structuredClone(siteItem);
		const canonicalBrewItem = structuredClone(brewItem);
		expect(siteItem).not.toHaveProperty("additionalSources");
		expect(brewItem).not.toHaveProperty("additionalSources");

		const originalGetType = Renderer.item.getType;
		const originalGetAdditionalTypeEntries = Renderer.item.getAdditionalTypeEntries;
		Renderer.item.getType = () => ({name: "Instrument"});
		Renderer.item.getAdditionalTypeEntries = () => null;
		let loaded;
		try {
			loaded = await CharacterSheetPage._pLoadItemData({
				pLoadRawItems: async () => ({item: [siteItem], baseitem: []}),
				pLoadPrereleaseData: async () => ({}),
				pLoadBrewData: async () => ({item: [brewItem]}),
				pLoadVariantComponents: async () => ({item: []}),
				pLoadSiteItems: async () => {
					Renderer.item.enhanceItem(siteItem, {styleHint: "classic"});
					return [siteItem];
				},
				pLoadPrereleaseItems: async () => [],
				pLoadBrewItems: async () => {
					Renderer.item.enhanceItem(brewItem, {styleHint: "classic"});
					return [brewItem];
				},
			});
		} finally {
			Renderer.item.getType = originalGetType;
			Renderer.item.getAdditionalTypeEntries = originalGetAdditionalTypeEntries;
		}

		for (const enhanced of [siteItem, brewItem]) {
			expect(enhanced).toEqual(expect.objectContaining({
				_isEnhanced: true,
				additionalSources: [{source: "XGE", page: 83}],
			}));
			expect(enhanced._fullAdditionalEntries).toBeTruthy();
		}

		for (const pristine of loaded.itemRepairData) {
			expect(pristine).not.toHaveProperty("_isEnhanced");
			expect(pristine).not.toHaveProperty("_fullAdditionalEntries");
			expect(pristine).not.toHaveProperty("additionalSources");
			expect(Object.keys(pristine).sort()).toEqual(["entries", "name", "source"]);
		}

		const enhancedItems = [...loaded.items, ...loaded.brewItems];
		for (const canonicalItem of [canonicalSiteItem, canonicalBrewItem]) {
			const state = new CharacterSheetState();
			state.setItemCatalog(enhancedItems, {pristineItems: loaded.itemRepairData});
			state.loadFromJson({
				name: "Legacy Hub character",
				inventory: [{
					id: "legacy-stack",
					item: {
						name: canonicalItem.name,
						source: canonicalItem.source,
						typeCode: canonicalItem.type,
						rarity: canonicalItem.rarity,
					},
					quantity: 1,
				}],
			});

			const repairedItem = state.toJson().inventory[0].item;
			expect(repairedItem).not.toHaveProperty("additionalSources");
			expect(repairedItem).not.toHaveProperty("_fullAdditionalEntries");
			const repeatedAward = addAwardedEntryToCharacter({
				container: {
					inventory: [{id: "legacy-stack", item: repairedItem, quantity: 1}],
					currency: {},
				},
				incoming: {item: canonicalItem, quantity: 1},
			});
			expect(repeatedAward.container.inventory).toEqual([
				expect.objectContaining({id: "legacy-stack", quantity: 2}),
			]);
		}
	});

	test("keeps the full site repair catalog field- and memory-bounded", () => {
		const itemRepairData = CharacterSheetPage._getItemRepairData({
			rawItems: {item: SITE_ITEMS, baseitem: SITE_BASE_ITEMS},
			prereleaseData: {},
			brewData: {},
			variantComponents: {item: []},
		});
		const allowedFields = new Set(["name", "source", "entries", "additionalSources", "hasRefs"]);
		expect(itemRepairData).toHaveLength(SITE_ITEMS.length + SITE_BASE_ITEMS.length);
		expect(itemRepairData.every(item => Object.keys(item).every(key => allowedFields.has(key)))).toBe(true);

		const fullBytes = Buffer.byteLength(JSON.stringify([...SITE_ITEMS, ...SITE_BASE_ITEMS]));
		const repairBytes = Buffer.byteLength(JSON.stringify(itemRepairData));
		expect(repairBytes / fullBytes).toBeLessThan(0.85);
	});
});
