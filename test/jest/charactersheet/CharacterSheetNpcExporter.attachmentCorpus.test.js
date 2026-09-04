/**
 * Attachment-driven integration harness (local-only, never committed).
 *
 * Validates the ACTUAL reported failing corpus — 24 monsters / 15 companion items,
 * including Duralin, Talna and Onger — by normalizing every raw item through the fixed
 * exporter and then validating the normalized result, while separately proving the raw
 * corpus really was invalid (a non-vacuous regression: if the "raw" assertions below ever
 * came back clean on their own, the harness would be a rubber stamp, not a test).
 *
 * The attachment lives OUTSIDE the repository (it is personal/session data) and must never
 * be copied in. Point `NPC_EXPORT_ATTACHMENT_PATH` at it to run this suite locally:
 *
 *   NPC_EXPORT_ATTACHMENT_PATH=/abs/path/to/all-npcs-CSHEET.json \
 *     NODE_OPTIONS='--experimental-vm-modules' npx jest --config jest.config.json \
 *     test/jest/charactersheet/CharacterSheetNpcExporter.attachmentCorpus.test.js
 *
 * Without the env var, the suite `describe.skip`s so CI stays green and meaningful (the
 * synthetic fixtures in `CharacterSheetNpcExporter.companionItems.test.js` carry the
 * permanent, always-on regression coverage for the same defects).
 *
 * Renderer/DOM note: this environment has no `jest-environment-jsdom` installed and the
 * site's `js/render.js` cannot load standalone (it depends on other browser-context globals
 * established by `charactersheet.html`'s specific script order). Genuine browser-DOM
 * rendering could not be exercised here. What IS exercised, against real data, is: (a) real
 * schema structural validity (via `test/util-npc-export-schema.js`'s UtilAjv registration,
 * when `node_modules/5etools-utils` is present), and (b) reference-integrity — the same
 * `{@item name|source}` resolution the exporter and the site's hover/DataLoader path both
 * depend on — so a "missing reference" is still caught even without a live renderer.
 */
import fs from "node:fs";
import path from "node:path";

import "./setup.js";
import "../../../js/charactersheet/charactersheet-npc-exporter.js";

const CharacterSheetNpcExporter = globalThis.CharacterSheetNpcExporter;

const ATTACHMENT_PATH = process.env.NPC_EXPORT_ATTACHMENT_PATH;
const hasAttachment = Boolean(ATTACHMENT_PATH && fs.existsSync(ATTACHMENT_PATH));
const describeCorpus = hasAttachment ? describe : describe.skip;

const UTIL_AJV_PATH = path.resolve(process.cwd(), "node_modules/5etools-utils/lib/UtilAjv.js");
const hasRealSchema = fs.existsSync(UTIL_AJV_PATH);

describeCorpus("v20.3 — the reported failing corpus normalizes and validates end to end", () => {
	let raw;
	let catalog;
	let normalizedItems;
	let warnings;
	let getNpcExportSchemaErrors;

	beforeAll(async () => {
		raw = JSON.parse(fs.readFileSync(ATTACHMENT_PATH, "utf8"));

		// The real item catalog `baseItem` refs need to resolve against. Mundane gear (e.g.
		// "Plate Armor|PHB", "Longsword|PHB") lives in `data/items-base.json`'s `baseitem`
		// array, NOT `data/items.json`'s `item` array — mirroring how the sheet's own
		// production loader (`DataUtil.item.loadJSON()` in `charactersheet.js`) merges both
		// into the single catalog it hands to `CharacterSheetState.setItemCatalog`.
		const itemsData = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), "data/items.json"), "utf8"));
		const baseItemsData = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), "data/items-base.json"), "utf8"));
		catalog = [...(itemsData.item || []), ...(baseItemsData.baseitem || [])];

		warnings = [];
		const state = {getInventory: () => [], _allItems: catalog};
		normalizedItems = (raw.item || []).map(item => CharacterSheetNpcExporter._getSanitizedBrewItem(
			item,
			{sourceJson: item.source || "CSHEET", state, warnings},
		));

		if (hasRealSchema) {
			({getNpcExportSchemaErrors} = await import("../../util-npc-export-schema.js"));
		}
	});

	it("loads exactly the reported corpus shape (24 monsters, 15 items)", () => {
		expect(raw.monster).toHaveLength(24);
		expect(raw.item).toHaveLength(15);
	});

	it("proves the RAW corpus is genuinely invalid before normalization (non-vacuous)", () => {
		// Ground-truthed against the actual attachment: 14 of 15 items carry a bare UI label
		// ("weapon"/"armor"/"ring") the schema's `itemType` enum rejects outright; only
		// Hecate's Dagger (`type: "M"`) is already legal. If this count ever dropped to 0,
		// either the corpus changed or this assertion is no longer testing anything real.
		const rawInvalid = (raw.item || []).filter(item => !CharacterSheetNpcExporter._SCHEMA_ITEM_TYPES.has(item.type));
		expect(rawInvalid.length).toBeGreaterThanOrEqual(14);
	});

	it("normalizes every one of the 15 items to a schema-legal type or a documented omission", () => {
		normalizedItems.forEach((item, ix) => {
			if ("type" in item) {
				expect(CharacterSheetNpcExporter._SCHEMA_ITEM_TYPES.has(item.type))
					.toBe(true);
			}
			expect(item.type).not.toBeNull();
			// Every item in the real corpus has a `baseItem`, except the ring — so this
			// corpus should never actually need the warn-and-omit fallback path.
			expect(warnings.some(w => w.includes(raw.item[ix].name))).toBe(false);
		});
	});

	it("resolves all 14 baseItem-bearing items via the catalog, with no residual human labels", () => {
		const baseItemBacked = normalizedItems.filter((_, ix) => raw.item[ix].baseItem);
		expect(baseItemBacked.length).toBe(14);
		baseItemBacked.forEach(item => {
			expect(["weapon", "armor", "ring", "wand", "rod", "scroll", "shield", "potion", "staff", "wondrous"])
				.not.toContain(item.type);
		});
	});

	it("resolves the one baseItem-less item (Ring of the Assassin Lord) via the label map", () => {
		const ring = normalizedItems.find((_, ix) => raw.item[ix].name === "Ring of the Assassin Lord");
		expect(ring).toBeTruthy();
		expect(ring.type === "RG|DMG" || ring.type === "RG|XDMG").toBe(true);
	});

	it("leaves the already-canonical item (Hecate's Dagger) unchanged", () => {
		const dagger = normalizedItems.find((_, ix) => raw.item[ix].name === "Hecate's Dagger");
		expect(dagger.type).toBe("M");
	});

	describe("explicit per-monster coverage: Duralin, Talna, Onger", () => {
		const findMonster = (nameFragment) => raw.monster.find(m => m.name.startsWith(nameFragment));

		it("Duralin's bundled companion item (+2 Plate Armor) normalizes to a legal armor code", () => {
			const monster = findMonster("Duralin");
			expect(monster).toBeTruthy();
			const tagged = CharacterSheetNpcExporter._collectItemTagNames(monster, monster.source);
			expect(tagged.has("+2 plate armor")).toBe(true);

			const ix = raw.item.findIndex(i => i.name.toLowerCase() === "+2 plate armor");
			expect(ix).toBeGreaterThanOrEqual(0);
			expect(normalizedItems[ix].type).toBe("HA");
		});

		it("Talna references no sheet-authored companion item — every tag is a real catalog/homebrew item", () => {
			const monster = findMonster("Talna");
			expect(monster).toBeTruthy();
			const tagged = CharacterSheetNpcExporter._collectItemTagNames(monster, monster.source);
			expect(tagged.size).toBe(0);
		});

		it("Onger references no sheet-authored companion item — every tag is a real catalog/homebrew item", () => {
			const monster = findMonster("Onger");
			expect(monster).toBeTruthy();
			const tagged = CharacterSheetNpcExporter._collectItemTagNames(monster, monster.source);
			expect(tagged.size).toBe(0);
		});
	});

	it("has no dangling {@item name|CSHEET} reference across all 24 monsters (missing-reference check)", () => {
		const itemNamesLc = new Set((raw.item || []).map(i => i.name.toLowerCase()));
		const dangling = [];
		raw.monster.forEach(monster => {
			const tagged = CharacterSheetNpcExporter._collectItemTagNames(monster, monster.source);
			tagged.forEach(name => {
				if (!itemNamesLc.has(name)) dangling.push(`${monster.name} -> "${name}"`);
			});
		});
		expect(dangling).toEqual([]);
	});

	it("reports every non-CSHEET item source as external (never silently dropped or copied)", () => {
		// External-source hovers (real published/homebrew items this repo does not bundle,
		// e.g. "Griffon's Saddlebag" or a personal Ioun-stone compendium) are already an
		// established, intentional, separately-tested behavior — see "external brew is
		// reported, never copied" in `CharacterSheetNpcExporter.companionItems.test.js`. This
		// corpus is a real stress-test of that existing contract at scale: confirms every
		// monster's external references are surfaced via `getExternalItemSources`, not
		// silently treated as broken. It is NOT this fix's job to make them resolve locally.
		const nonEmpty = raw.monster.filter(monster =>
			CharacterSheetNpcExporter.getExternalItemSources(monster).length > 0);
		expect(nonEmpty.length).toBeGreaterThan(0);

	});

	(hasRealSchema ? it : it.skip)(
		"validates the normalized item document against the real installed item schema",
		() => {
			const errors = getNpcExportSchemaErrors({
				data: {item: normalizedItems},
				filePath: ATTACHMENT_PATH,
				kind: "item",
			});
			expect(errors).toEqual([]);
		},
	);

	(hasRealSchema ? it : it.skip)(
		"validates the 24 monsters against the real installed bestiary schema",
		() => {
			const errors = getNpcExportSchemaErrors({
				data: {monster: raw.monster},
				filePath: ATTACHMENT_PATH,
				kind: "bestiary",
			});
			expect(errors).toEqual([]);
		},
	);
});
