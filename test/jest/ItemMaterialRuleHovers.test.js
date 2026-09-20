import fs from "node:fs";
import "../../js/parser.js";
import "../../js/utils.js";
import "../../js/utils-config.js";
import "../../js/render.js";
import "../../js/render-dice.js";
import "../../js/utils-dataloader.js";
import {RenderCrafting} from "../../js/render-crafting.js";
import "../../js/charactersheet/charactersheet-materials.js";

globalThis.veT = globalThis.veT || String.raw;

const CharacterSheetMaterials = globalThis.CharacterSheetMaterials;
const DataLoader = globalThis.DataLoader;

const CRAFTING_DATA = JSON.parse(fs.readFileSync("data/crafting.json", "utf-8"));
const EXPECTED_RULE_NAMES = {
	density: "Item Material Property: Density",
	damage: "Item Material Property: Damage Dice",
	protection: "Item Material Property: Protection",
	critical: "Item Material Property: Critical",
	penetration: "Item Material Property: Penetration",
	magicCapacity: "Item Material Property: Magic Capacity",
	color: "Item Material Property: Color",
};

beforeAll(() => {
	const brewUtilStub = {
		hasSourceJson: () => false,
		getCacheIteration: () => 0,
		getBrewProcessedFromCache: () => [],
	};
	globalThis.PrereleaseUtil = globalThis.PrereleaseUtil || brewUtilStub;
	globalThis.BrewUtil2 = globalThis.BrewUtil2 || brewUtilStub;

	DataLoader._pCache_addToCache({
		allDataMerged: {craftingRule: CRAFTING_DATA.craftingRule},
		propAllowlist: new Set(["craftingRule"]),
	});
});

function getExpectedTarget (rule) {
	const name = EXPECTED_RULE_NAMES[rule.key];
	const source = "TGTT";
	return {
		name,
		source,
		page: UrlUtil.PG_CRAFTING,
		hash: UrlUtil.URL_TO_HASH_BUILDER["craftingRule"]({name, source}),
	};
}

describe("TGTT item-material property rule references", () => {
	it("maps every shared Parser rule to a real generated craftingRule entity", () => {
		expect(Parser.ITEM_MATERIAL_RULES).toHaveLength(7);

		for (const rule of Parser.ITEM_MATERIAL_RULES) {
			const expected = getExpectedTarget(rule);
			expect(rule.reference).toEqual({name: expected.name, source: expected.source});

			const entity = CRAFTING_DATA.craftingRule.find(it => it.name === expected.name && it.source === expected.source);
			expect(entity).toBeTruthy();
			expect(entity.entries?.length).toBeGreaterThan(0);
		}
	});

	it("resolves every rule target through the real DataLoader cache and compact hover renderer", () => {
		for (const rule of Parser.ITEM_MATERIAL_RULES) {
			const expected = getExpectedTarget(rule);
			const entity = DataLoader.getFromCache(expected.page, expected.source, expected.hash);
			expect(entity).toBeTruthy();
			expect(entity.name).toBe(expected.name);

			const hoverHtml = Renderer.hover.getFnRenderCompact(expected.page)(entity);
			expect(hoverHtml).toContain(expected.name);
			expect(hoverHtml).toContain(rule.summary);
		}
	});

	it("renders canonical hover targets for every property on crafting.html", () => {
		const material = {
			...CRAFTING_DATA.itemMaterial.find(it => it.name === "Darkmetal" && it.source === "TGTT"),
			__prop: "itemMaterial",
		};
		const html = `${RenderCrafting.getRenderedCrafting(material, {isSkipExcludesRender: true})}`;

		for (const rule of Parser.ITEM_MATERIAL_RULES) {
			const expected = getExpectedTarget(rule);
			expect(html).toContain(`data-vet-page="${expected.page}"`);
			expect(html).toContain(`data-vet-source="${expected.source}"`);
			expect(html).toContain(`data-vet-hash="${expected.hash}"`);
		}
		expect(html).not.toMatch(/class="crafting__rule-help"[^>]*\stitle=/);
	});

	it("renders the same canonical hover targets in Character Sheet material summaries", () => {
		const disclosureHtml = CharacterSheetMaterials._getMaterialRulesHtml();

		for (const rule of Parser.ITEM_MATERIAL_RULES) {
			const expected = getExpectedTarget(rule);
			const html = CharacterSheetMaterials._getMaterialRuleHelpHtml(rule.key, rule.full);

			expect(html).toContain(`data-vet-page="${expected.page}"`);
			expect(html).toContain(`data-vet-source="${expected.source}"`);
			expect(html).toContain(`data-vet-hash="${expected.hash}"`);
			expect(html).not.toContain("title=");
			expect(disclosureHtml).toContain(`data-vet-hash="${expected.hash}"`);
		}
	});

	it("keeps the complete keyboard/touch fallback disclosure on both surfaces", () => {
		const material = {
			...CRAFTING_DATA.itemMaterial.find(it => it.name === "Darkmetal" && it.source === "TGTT"),
			__prop: "itemMaterial",
		};
		const craftingHtml = `${RenderCrafting.getRenderedCrafting(material, {isSkipExcludesRender: true})}`;
		const sheetHtml = CharacterSheetMaterials._getMaterialRulesHtml();

		for (const html of [craftingHtml, sheetHtml]) {
			expect(html).toContain("<details");
			expect(html).toContain("Material Rules");
			expect(html).toContain("Weapon Damage Progression");
			for (const rule of Parser.ITEM_MATERIAL_RULES) expect(html).toContain(rule.summary);
		}
	});
});
