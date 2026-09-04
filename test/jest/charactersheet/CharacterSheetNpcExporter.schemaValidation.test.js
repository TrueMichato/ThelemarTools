/**
 * Validates the exporter's actual output against the REAL schema shipped in the installed
 * `5etools-utils` package — via `test/util-npc-export-schema.js`'s UtilAjv/all-schema
 * registration (the same mechanism `test/util-combatmethods-schema.js` uses for combat
 * methods), never a hand-written property-list proxy.
 *
 * Requires `node_modules/5etools-utils` (the pinned dependency, currently unavailable in
 * some environments — see docs/charactersheet/18-npc-export.md). Skips cleanly, rather than
 * failing, when the package is absent, so CI without it stays meaningful via the other
 * (`_SCHEMA_ITEM_TYPES`-based) regression suite in `CharacterSheetNpcExporter.companionItems.test.js`.
 */
import fs from "node:fs";
import path from "node:path";

import "./setup.js";
import "../../../js/charactersheet/charactersheet-npc-exporter.js";

const CharacterSheetNpcExporter = globalThis.CharacterSheetNpcExporter;

const UTIL_AJV_PATH = path.resolve(process.cwd(), "node_modules/5etools-utils/lib/UtilAjv.js");
const hasRealSchema = fs.existsSync(UTIL_AJV_PATH);
const describeSchema = hasRealSchema ? describe : describe.skip;

describeSchema("v20.2 — the sanitized companion item validates against the real installed item schema", () => {
	let getNpcExportSchemaErrors;

	beforeAll(async () => {
		({getNpcExportSchemaErrors} = await import("../../util-npc-export-schema.js"));
	});

	const sanitize = (item, opts = {}) =>
		CharacterSheetNpcExporter._getSanitizedBrewItem(item, {sourceJson: "CSHEET", ...opts});

	const errorsFor = (items) => getNpcExportSchemaErrors({
		data: {item: items},
		filePath: "(test fixture)",
		kind: "item",
	});

	it("proves the raw, unfixed sheet label is genuinely rejected by the real schema (non-vacuous)", () => {
		// If this ever came back empty, the harness itself would be broken (a rubber stamp),
		// not the exporter — this is the "raw invalidity" half of the fix's contract.
		const rawShapedAsIfUnfixed = {name: "Raw Weapon", type: "weapon", rarity: "rare", source: "CSHEET"};
		expect(errorsFor([rawShapedAsIfUnfixed]).length).toBeGreaterThan(0);
	});

	it("validates a weapon resolved via baseItem", () => {
		const state = {getInventory: () => [], _allItems: [{name: "Longsword", source: "PHB", type: "M"}]};
		const out = sanitize({name: "Talna's Blade", type: "weapon", baseItem: "Longsword|PHB", rarity: "rare"}, {state});
		expect(errorsFor([out])).toEqual([]);
	});

	it("validates armor resolved via armorType with no baseItem", () => {
		const out = sanitize({name: "Onger's Guard", type: "armor", armorType: "medium", rarity: "none"});
		expect(errorsFor([out])).toEqual([]);
	});

	it("validates a ring resolved via the label map", () => {
		const out = sanitize({name: "Ring of the Assassin Lord", type: "ring", source: "DMG", rarity: "very rare"});
		expect(errorsFor([out])).toEqual([]);
	});

	it("validates an item with a missing typeCode that has no baseItem (type correctly omitted)", () => {
		const out = sanitize({name: "Duralin's Mystery", type: "wand", rarity: "rare"});
		expect(errorsFor([out])).toEqual([]);
	});

	it("validates an already-canonical type unchanged", () => {
		const state = {getInventory: () => [], _allItems: [{name: "Dagger", source: "PHB", type: "M|XPHB"}]};
		const out = sanitize({name: "Hecate's Dagger", type: "M", baseItem: "Dagger|PHB", rarity: "rare"}, {state});
		expect(errorsFor([out])).toEqual([]);
	});

	it("validates a full buildCompanionItems collection end to end", () => {
		const state = {
			getInventory: () => [
				{item: {name: "Weapon Item", _isCustom: true, type: "weapon", baseItem: "Longsword|PHB", rarity: "rare"}},
				{item: {name: "Armor Item", _isCustom: true, type: "armor", armorType: "heavy", rarity: "none"}},
			],
			_allItems: [{name: "Longsword", source: "PHB", type: "M"}],
		};
		const monster = {
			source: "CSHEET",
			trait: [{name: "Gear", entries: ["{@item Weapon Item|CSHEET} and {@item Armor Item|CSHEET}"]}],
		};
		const out = CharacterSheetNpcExporter.buildCompanionItems(monster, state, {sourceJson: "CSHEET"});
		expect(out).toHaveLength(2);
		expect(errorsFor(out)).toEqual([]);
	});
});
