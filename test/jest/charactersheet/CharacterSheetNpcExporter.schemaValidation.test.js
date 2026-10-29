/**
 * Validates the exporter's actual output against the REAL schema shipped in the installed
 * `5etools-utils` package — via `test/util-npc-export-schema.js`'s UtilAjv/all-schema
 * registration (the same mechanism `test/util-combatmethods-schema.js` uses for combat
 * methods), never a hand-written property-list proxy.
 *
 * Requires the pinned `5etools-utils` dependency. Missing validation prerequisites must
 * fail this required gate, not silently skip into a green run.
 */
import "./setup.js";
import "../../../js/parser.js";
import "../../../js/utils.js";
import "../../../js/utils-config.js";
import "../../../js/render.js";
import "../../../js/render-dice.js";
import "../../../js/charactersheet/charactersheet-npc-exporter.js";
import {getNpcExportSchemaErrors} from "../../util-npc-export-schema.js";

const CharacterSheetNpcExporter = globalThis.CharacterSheetNpcExporter;

describe("v20.2 — the sanitized companion item validates against the real installed item schema", () => {
	beforeAll(() => {
		const brewUtilStub = {
			hasSourceJson: () => false,
			getCacheIteration: () => 0,
			getBrewProcessedFromCache: () => [],
		};
		globalThis.PrereleaseUtil = globalThis.PrereleaseUtil || brewUtilStub;
		globalThis.BrewUtil2 = globalThis.BrewUtil2 || brewUtilStub;
	});

	const sanitize = (item, opts = {}) =>
		CharacterSheetNpcExporter._getSanitizedBrewItem(item, {sourceJson: "CSHEET", ...opts});

	const errorsFor = (items) => getNpcExportSchemaErrors({
		data: {item: items},
		filePath: "(test fixture)",
		kind: "item",
	});

	it("Q01: compiles the real bestiary schema and rejects invalid monster fields", () => {
		const monster = {
			name: "Schema Control",
			source: "CSHEET",
			size: ["M"],
			type: "humanoid",
			alignment: ["N"],
			ac: [10],
			hp: {average: 4, formula: "1d8"},
			speed: {walk: 30},
			str: 10,
			dex: 10,
			con: 10,
			int: 10,
			wis: 10,
			cha: 10,
			cr: "0",
		};
		const check = value => getNpcExportSchemaErrors({data: {monster: [value]}, filePath: "Q01", kind: "bestiary"});
		expect(check(monster)).toEqual([]);
		expect(check({...monster, hp: {average: "invalid", formula: "1d8"}})).not.toEqual([]);
		expect(check({...monster, unsupportedExportField: true})).not.toEqual([]);
	});

	it("F37: the real item schema rejects numeric bonus fields", () => {
		expect(errorsFor([{name: "Armor Control", source: "CSHEET", rarity: "rare", type: "HA", bonusAc: 2}])).not.toEqual([]);
	});

	it("F37: serializes numeric armor and weapon bonuses as schema strings", () => {
		const items = [
			sanitize({name: "Armored Control", rarity: "rare", type: "HA", bonusAc: 2}),
			sanitize({name: "Weapon Control", rarity: "rare", type: "M", bonusWeapon: 3, bonusWeaponAttack: -1}),
		];
		expect(items[0].bonusAc).toBe("2");
		expect(items[1].bonusWeapon).toBe("3");
		expect(items[1].bonusWeaponAttack).toBe("-1");
		expect(errorsFor(items)).toEqual([]);
	});

	it("F37: normalizes every schema-supported numeric bonus without changing existing formula strings", () => {
		const keys = [...CharacterSheetNpcExporter.ITEM_SCHEMA_PROPS].filter(key => /^bonus/.test(key));
		expect(keys.length).toBeGreaterThan(10);
		const items = keys.map(key => {
			const out = sanitize({name: `Bonus Control ${key}`, rarity: "rare", [key]: 2});
			expect(out[key]).toBe("2");
			return out;
		});
		expect(errorsFor(items)).toEqual([]);
		expect(sanitize({name: "Formula Control", bonusWeapon: "+2"}).bonusWeapon).toBe("+2");
	});

	it("F55: normalizes unsupported material tags in flat and nested item entries", () => {
		const raw = {name: "Material Control",
			rarity: "rare",
			entries: [
				"Made from {@itemMaterial Heart Stone|TGTT|heart stone}.",
				{type: "entries",
					name: "Construction",
					entries: [
						"<b>Core:</b> {@itemMaterial Heart Stone|TGTT}; {@damage 1d6}.",
						{type: "list", items: ["{@itemMaterial Heart Stone|TGTT}"]},
					]},
			]};
		const before = JSON.stringify(raw);
		const out = sanitize(raw);
		expect(JSON.stringify(out)).not.toContain("{@itemMaterial");
		expect(out.entries[0]).toContain("{@5etools heart stone|crafting.html#heart%20stone_tgtt}");
		expect(out.entries[1].entries[0]).toBe("Core: {@5etools Heart Stone|crafting.html#heart%20stone_tgtt}; {@damage 1d6}.");
		expect(out.entries[1].entries[1].items[0]).toContain("{@5etools Heart Stone|crafting.html#heart%20stone_tgtt}");
		expect(JSON.stringify(raw)).toBe(before);
		expect(errorsFor([out])).toEqual([]);
		expect(() => Renderer.get().render({type: "entries", entries: raw.entries})).toThrow("Unhandled tag \"@itemMaterial\"");
		const html = Renderer.get().render({type: "entries", entries: out.entries});
		expect(html.match(/href="crafting\.html#heart%20stone_tgtt"/g)).toHaveLength(3);
		expect(Renderer.item.getCompactRenderedString(out)).toContain("href=\"crafting.html#heart%20stone_tgtt\"");
		expect(UrlUtil.URL_TO_HASH_BUILDER.itemMaterial({name: "Heart Stone", source: "TGTT"})).toBe("heart%20stone_tgtt");
	});

	it("F55: discloses missing material identity instead of inventing a source or leaving an unsupported tag", () => {
		const out = sanitize({name: "Unresolved Material Control",
			additionalEntries: [
				"Made from {@itemMaterial Heart Stone}.",
				"Made from {@itemMaterial |TGTT}.",
			]});
		expect(out.additionalEntries).toEqual([
			"Made from Heart Stone (item material; source unspecified).",
			"Made from Unknown material (unresolved item material reference).",
		]);
		expect(() => Renderer.get().render({type: "entries", entries: out.additionalEntries})).not.toThrow();
	});

	it("F55: preserves supported display formatting inside material references", () => {
		const out = sanitize({name: "Formatted Material Control",
			entries: [
				"Made from {@itemMaterial Heart Stone|TGTT|{@b heart stone}}.",
			]});
		const html = Renderer.get().render({type: "entries", entries: out.entries});
		expect(html).toContain("href=\"crafting.html#heart%20stone_tgtt\"");
		expect(html).toContain("<b>heart stone</b>");
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
