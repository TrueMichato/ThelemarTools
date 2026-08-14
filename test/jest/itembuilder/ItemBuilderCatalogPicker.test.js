import "../charactersheet/setup.js";
import {
	filterItemCompositionCatalogRows,
	getItemCompositionCatalogRows,
} from "../../../js/itembuilder/itembuilder-catalog-picker.js";
import {ItemBuilderCore} from "../../../js/itembuilder/itembuilder-core.js";

const CATALOGS = {
	items: [{
		name: "Longsword",
		source: "PHB",
		type: "M",
		weapon: true,
		dmg1: "1d8",
		entries: [],
	}],
	materials: [{
		name: "Starsteel",
		source: "TGTT",
		appliesTo: ["weapon"],
		damage: 1,
		entries: ["Starsteel holds a keen edge."],
	}],
	upgrades: [
		{name: "Balanced", source: "TCAH", upgradeType: ["WU:1"], entries: ["Gain a +1 bonus to attack rolls."]},
		{name: "Journey", source: "TGTT", upgradeType: ["GS:R"], entries: ["Your speed increases."]},
	],
};

describe("ItemCompositionCatalogPicker helpers", () => {
	test("builds searchable rows with source, compatibility, effects, and projected deltas", () => {
		const draft = ItemBuilderCore.applyPreset(ItemBuilderCore.createDraft({source: "HB"}), CATALOGS.items[0], {source: "HB"});
		const rows = getItemCompositionCatalogRows({draft, catalogs: CATALOGS});

		expect(rows).toEqual(expect.arrayContaining([
			expect.objectContaining({
				category: "material",
				sourceLabel: expect.any(String),
				effectSummary: expect.stringContaining("keen edge"),
				compatibility: expect.stringContaining("weapon"),
				delta: expect.stringContaining("Damage: 1d8"),
			}),
			expect.objectContaining({
				category: "upgrade",
				effectSummary: expect.stringContaining("+1 bonus"),
				delta: expect.stringContaining("Weapon attack"),
			}),
		]));
	});

	test("filters across category, source, and effect text", () => {
		const rows = [
			{category: "material", categoryLabel: "Materials", entity: {name: "Starsteel", source: "TGTT"}, sourceLabel: "Thelemar", effectSummary: "Keen edge", compatibility: "Weapon", delta: "Damage"},
			{category: "upgrade", categoryLabel: "Upgrades", entity: {name: "Balanced", source: "TCAH"}, sourceLabel: "Armorer", effectSummary: "Attack bonus", compatibility: "Weapon", delta: "Attack"},
		];

		expect(filterItemCompositionCatalogRows(rows, {search: "keen"}).map(it => it.entity.name)).toEqual(["Starsteel"]);
		expect(filterItemCompositionCatalogRows(rows, {category: "upgrade", source: "TCAH"}).map(it => it.entity.name)).toEqual(["Balanced"]);
		expect(filterItemCompositionCatalogRows(rows, {category: "gemstone"})).toEqual([]);
	});
});
