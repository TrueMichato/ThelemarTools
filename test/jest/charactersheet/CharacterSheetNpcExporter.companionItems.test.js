/**
 * v20 — bundling sheet-authored custom items alongside the statblock.
 *
 * A `{@item Name|SOURCE}` tag whose `name|source` resolves to nothing is a dead
 * hover. Items the character sheet authored exist nowhere but the character, so
 * the only way their hover can ever work is to ship them with the monster in the
 * same homebrew document.
 *
 * The bundled entity has to satisfy the real item schema, which is
 * `additionalProperties: false` — hence the whitelist, and hence this file, which
 * pins that whitelist against the schema shipped in `node_modules`.
 */
import {jest} from "@jest/globals";
import fs from "node:fs";
import path from "node:path";

import "./setup.js";
import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-npc-exporter.js";

const CharacterSheetNpcExporter = globalThis.CharacterSheetNpcExporter;

const SCHEMA_PATH = path.resolve(process.cwd(), "node_modules/5etools-utils/schema/site/items.json");
const hasSchema = fs.existsSync(SCHEMA_PATH);
const describeSchema = hasSchema ? describe : describe.skip;

describeSchema("v20 — the item whitelist tracks the real schema", () => {
	it("matches the schema's item property list exactly", () => {
		const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, "utf8"));
		const schemaProps = Object.keys(schema.$defs._item.properties).sort();
		const ours = [...CharacterSheetNpcExporter.ITEM_SCHEMA_PROPS].sort();

		// Reported as set differences rather than a bare deep-equal so a schema bump
		// tells you *which* property appeared or vanished.
		expect(schemaProps.filter(p => !ours.includes(p))).toEqual([]);
		expect(ours.filter(p => !schemaProps.includes(p))).toEqual([]);
	});

	it("keeps the schema's required fields inside the whitelist", () => {
		const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, "utf8"));
		const required = schema.$defs._item.required || [];
		expect(required.length).toBeGreaterThan(0);
		required.forEach(prop => expect(CharacterSheetNpcExporter.ITEM_SCHEMA_PROPS.has(prop)).toBe(true));
	});

	it("renames only into properties the schema actually allows", () => {
		Object.values(CharacterSheetNpcExporter._ITEM_PROP_RENAMES)
			.forEach(target => expect(CharacterSheetNpcExporter.ITEM_SCHEMA_PROPS.has(target)).toBe(true));
	});

	it("never renames a property the schema already accepts under its own name", () => {
		// A rename whose *source* is legal would silently move real data. `typeCode`,
		// `requiresAttunement`, `properties` and `damage` are all sheet-only spellings.
		Object.keys(CharacterSheetNpcExporter._ITEM_PROP_RENAMES)
			.forEach(from => expect(CharacterSheetNpcExporter.ITEM_SCHEMA_PROPS.has(from)).toBe(false));
	});
});

describe("v20 — the sanitizer produces a schema-legal item", () => {
	const sanitize = (item, sourceJson = "CSHEET") =>
		CharacterSheetNpcExporter._getSanitizedBrewItem(item, {sourceJson});

	it("prefers the real type code over the sheet's human-readable label", () => {
		// The single most dangerous transform in the whole feature: the sheet stores
		// `type: "weapon"`, which the schema's type enum rejects outright, while the code
		// the schema *wants* sits in `typeCode`. Whitelisting alone would have shipped it.
		const out = sanitize({name: "Test Blade", type: "weapon", typeCode: "M|XPHB", rarity: "rare"});
		expect(out.type).toBe("M|XPHB");
		expect(out.typeCode).toBeUndefined();
	});

	it("keeps the sheet's label when there is no code to replace it", () => {
		// `typeCode` is absent on plenty of rows; dropping `type` unconditionally would
		// lose armour/shield classification for every one of them.
		expect(sanitize({name: "Plain Shield", type: "S", rarity: "none"}).type).toBe("S");
	});

	it("renames the remaining sheet-only spellings", () => {
		const out = sanitize({
			name: "Test Axe",
			requiresAttunement: true,
			properties: ["V", "H"],
			damage: "1d12",
			rarity: "uncommon",
		});
		expect(out.reqAttune).toBe(true);
		expect(out.property).toEqual(["V", "H"]);
		expect(out.dmg1).toBe("1d12");
		expect(out.requiresAttunement).toBeUndefined();
		expect(out.properties).toBeUndefined();
		expect(out.damage).toBeUndefined();
	});

	it("never lets the duplicate damage spelling clobber a real dmg1", () => {
		expect(sanitize({name: "X", dmg1: "1d8", damage: "9d9", rarity: "none"}).dmg1).toBe("1d8");
	});

	it("drops every sheet-only property", () => {
		const out = sanitize({
			name: "Kitchen Sink",
			rarity: "rare",
			effects: [{type: "bonus"}],
			itemPowers: [{name: "Zap"}],
			damageRiders: [{dice: "1d6"}],
			socketedGemstones: [{name: "Ioun"}],
			chargesCurrent: 3,
			bonusSavingThrowStr: 1,
			_isCustom: true,
			weapon: true,
			armor: false,
		});
		["effects", "itemPowers", "damageRiders", "socketedGemstones", "chargesCurrent",
			"bonusSavingThrowStr", "_isCustom", "armor"].forEach(k => expect(out[k]).toBeUndefined());
		// Every surviving key must be one the schema actually allows.
		Object.keys(out).forEach(k => expect(CharacterSheetNpcExporter.ITEM_SCHEMA_PROPS.has(k)).toBe(true));
	});

	it("prunes the sheet's zeroed bonus slots but keeps a real zero elsewhere", () => {
		const out = sanitize({name: "Y", rarity: "none", bonusWeapon: 0, bonusAc: 2, value: 0, weight: 0, charges: 0});
		expect(out.bonusWeapon).toBeUndefined();
		expect(out.value).toBeUndefined();
		expect(out.weight).toBeUndefined();
		expect(out.bonusAc).toBe(2);
		// `charges: 0` is not a bonus slot — a spent wand is still a wand with 0 charges.
		expect(out.charges).toBe(0);
	});

	it("supplies the schema's required fields even for the barest item", () => {
		const out = sanitize({name: "Gambler's Die"});
		expect(out.name).toBe("Gambler's Die");
		expect(out.rarity).toBe("none");
		expect(out.source).toBe("CSHEET");
	});

	it("re-sources the item no matter what the sheet claimed", () => {
		expect(sanitize({name: "Z", source: "CUSTOM", rarity: "none"}, "NPCX").source).toBe("NPCX");
	});

	it("splits authored paragraphs into separate entries", () => {
		// `_stripHtmlTags` collapses all whitespace, so a multi-paragraph magic item used
		// to arrive as one unbroken wall of text. `\n` means nothing to the renderer;
		// one array element per paragraph is the only shape that renders as paragraphs.
		const out = sanitize({
			name: "Wordy Wand",
			rarity: "rare",
			entries: ["First paragraph.\n\nSecond paragraph.\n\nThird paragraph."],
		});
		expect(out.entries).toEqual(["First paragraph.", "Second paragraph.", "Third paragraph."]);
	});

	it("strips stray HTML from prose but leaves 5etools tags intact", () => {
		const out = sanitize({name: "W", rarity: "rare", entries: ["<b>Deals</b> {@damage 2d6} fire."]});
		expect(out.entries[0]).toBe("Deals {@damage 2d6} fire.");
	});

	it("refuses an item with nothing usable as a name", () => {
		expect(sanitize({rarity: "none"})).toBeNull();
		expect(sanitize(null)).toBeNull();
	});
});

/**
 * v20.1 — regressions derived directly from the reported failing corpus (24 monsters / 15
 * companion items, including Duralin, Talna and Onger): 14 of 15 items stored a coarse
 * UI label ("weapon"/"armor"/"ring") in `type` with no `typeCode` to rescue them, which the
 * whitelist-only sanitizer above shipped verbatim and the real schema's `itemType` enum
 * rejects outright. Every case here failed before `_getCanonicalItemType` existed: the
 * sanitizer used to ship the raw label unchanged whenever `typeCode` was absent (see "keeps
 * the sheet's label when there is no code to replace it" above, which only happens to pass
 * because "S" is coincidentally itself a legal code).
 */
describe("v20.1 — canonicalizing a companion item's type against the real schema enum", () => {
	const mkState = (allItems) => ({getInventory: () => [], _allItems: allItems});

	const sanitize = (item, opts = {}) =>
		CharacterSheetNpcExporter._getSanitizedBrewItem(item, {sourceJson: "CSHEET", ...opts});

	it("resolves a bare \"weapon\" label via a matching baseItem in the catalog", () => {
		// Mirrors 13 of the 15 real corpus items: `type: "weapon"`, no `typeCode`, but a
		// resolvable `baseItem`.
		const state = mkState([{name: "Longsword", source: "PHB", type: "M"}]);
		const warnings = [];
		const out = sanitize({name: "Talna's Blade", type: "weapon", baseItem: "Longsword|PHB", rarity: "rare"}, {state, warnings});
		expect(out.type).toBe("M");
		expect(warnings).toEqual([]);
	});

	it("resolves baseItem case-insensitively on both name and source", () => {
		// The real corpus has an item whose `baseItem` source is lowercase ("phb") while the
		// catalog entry is uppercase ("PHB").
		const state = mkState([{name: "Chain Mail", source: "PHB", type: "HA"}]);
		const out = sanitize({name: "Onger's Mail", type: "armor", baseItem: "chain mail|phb", rarity: "none"}, {state});
		expect(out.type).toBe("HA");
	});

	it("never trusts a baseItem catalog entry whose own type is itself schema-illegal", () => {
		const state = mkState([{name: "Bogus Blade", source: "CSHEET", type: "sword"}]);
		const warnings = [];
		const out = sanitize({name: "Duralin's Edge", type: "weapon", baseItem: "Bogus Blade|CSHEET", rarity: "rare"}, {state, warnings});
		expect(out.type).toBeUndefined();
		expect(warnings.length).toBe(1);
		expect(warnings[0]).toMatch(/Duralin's Edge/);
	});

	it("omits type and warns for an unresolvable \"weapon\" label with no baseItem", () => {
		const warnings = [];
		const out = sanitize({name: "Mystery Sword", type: "weapon", rarity: "rare"}, {warnings});
		expect("type" in out).toBe(false);
		expect(out.type).toBeUndefined();
		expect(warnings.length).toBe(1);
		expect(warnings[0]).toMatch(/Mystery Sword/);
		expect(warnings[0]).toMatch(/weapon/);
	});

	it("resolves an \"armor\" label with no baseItem via the item's own armorType", () => {
		// `armorType` (light/medium/heavy) is authoritative and unambiguous, unlike the coarse
		// "armor" UI label — no baseItem needed.
		expect(sanitize({name: "A", type: "armor", armorType: "light", rarity: "none"}).type).toBe("LA");
		expect(sanitize({name: "B", type: "armor", armorType: "medium", rarity: "none"}).type).toBe("MA");
		expect(sanitize({name: "C", type: "armor", armorType: "heavy", rarity: "none"}).type).toBe("HA");
	});

	it("omits type and warns for an \"armor\" label with neither armorType nor baseItem", () => {
		const warnings = [];
		const out = sanitize({name: "Odd Armor", type: "armor", rarity: "none"}, {warnings});
		expect(out.type).toBeUndefined();
		expect(warnings.length).toBe(1);
	});

	it("maps a bare \"ring\" label to the classic edition-suffixed code by default", () => {
		// Matches the real corpus's one label-map-only item: Ring of the Assassin Lord, no
		// baseItem, source not XDMG.
		const out = sanitize({name: "Ring of the Assassin Lord", type: "ring", source: "DMG", rarity: "very rare"});
		expect(out.type).toBe("RG|DMG");
	});

	it("maps a bare \"ring\" label to the 2024 edition-suffixed code when the item's own source is XDMG", () => {
		const out = sanitize({name: "Modern Ring", type: "ring", source: "XDMG", rarity: "rare"});
		expect(out.type).toBe("RG|XDMG");
	});

	it("reads the item's ORIGINAL source for edition detection, not the rewritten companion-doc source", () => {
		// The sanitizer overwrites `out.source` to the companion document's source further
		// down; edition detection must use the raw input's `source`, which here differs from
		// `sourceJson`. If it read the wrong one, this would come back "RG|DMG".
		const out = sanitize({name: "Edition Ring", type: "ring", source: "XDMG", rarity: "rare"});
		expect(out.source).toBe("CSHEET");
		expect(out.type).toBe("RG|XDMG");
	});

	it("suffixes scroll with XPHB, not XDMG, in the 2024 edition", () => {
		// Scroll's 2024 suffix genuinely differs from ring/rod/wand's XDMG — verified against
		// both the schema enum and `Parser.ITM_TYP__ODND_SCROLL`.
		expect(sanitize({name: "S", type: "scroll", source: "XPHB", rarity: "none"}).type).toBe("SC|XPHB");
		expect(sanitize({name: "S2", type: "scroll", source: "DMG", rarity: "none"}).type).toBe("SC|DMG");
	});

	it("maps bare labels needing no edition suffix (shield, potion)", () => {
		expect(sanitize({name: "Shield", type: "shield", rarity: "none"}).type).toBe("S");
		expect(sanitize({name: "Potion", type: "potion", rarity: "common"}).type).toBe("P");
	});

	it("never maps a bare \"wand\" label directly to WD — it is genuinely ambiguous", () => {
		// The sheet's own custom-item UI collapses wand/rod/legacy-staff into one "wand"
		// category (`_getCustomTypeForItem` in charactersheet-inventory.js maps
		// WD/RD/"ST" all back to "wand"), so a bare "wand" label cannot identify a single
		// real code without a baseItem match.
		const warnings = [];
		const out = sanitize({name: "Odd Wand", type: "wand", rarity: "rare"}, {warnings});
		expect(out.type).toBeUndefined();
		expect(warnings.length).toBe(1);
	});

	it("resolves \"wand\" via baseItem when one is present", () => {
		const state = mkState([{name: "Wand of Magic Missiles", source: "DMG", type: "WD|DMG"}]);
		const out = sanitize({name: "My Wand", type: "wand", baseItem: "Wand of Magic Missiles|DMG", rarity: "uncommon"}, {state});
		expect(out.type).toBe("WD|DMG");
	});

	it("flags a weapon-shaped staff as a bare melee weapon plus the staff flag, without warning", () => {
		// Every real weapon-shaped staff in this repo's own data (Diamond Staff, Eldritch
		// Staff, Enspelled Staff) is typed "M" alongside `staff: true` — never R or anything
		// else, so this is a safe, evidence-backed inference, not a guess.
		const warnings = [];
		const out = sanitize({name: "Battle Staff", type: "staff", dmg1: "1d6", rarity: "rare"}, {warnings});
		expect(out.type).toBe("M");
		expect(out.staff).toBe(true);
		expect(warnings).toEqual([]);
	});

	it("flags a non-weapon-shaped staff with the flag only and no type, without warning", () => {
		// Matches classic magic staves (e.g. Staff of Power) exactly: `type` absent, `staff:
		// true` present.
		const warnings = [];
		const out = sanitize({name: "Staff of Testing", type: "staff", rarity: "very rare"}, {warnings});
		expect("type" in out).toBe(false);
		expect(out.staff).toBe(true);
		expect(warnings).toEqual([]);
	});

	it("flags wondrous items without a type and without warning", () => {
		const warnings = [];
		const out = sanitize({name: "Trinket", type: "wondrous", rarity: "rare"}, {warnings});
		expect("type" in out).toBe(false);
		expect(out.wondrous).toBe(true);
		expect(warnings).toEqual([]);
	});

	it("prefers an already-legal incumbent type over baseItem resolution or the label map", () => {
		// Matches Hecate's Dagger from the real corpus: already `type: "M"`, needs no help.
		const state = mkState([{name: "Dagger", source: "PHB", type: "M|XPHB"}]);
		const out = sanitize({name: "Hecate's Dagger", type: "M", baseItem: "Dagger|PHB", rarity: "rare"}, {state});
		expect(out.type).toBe("M");
	});

	it("does not let an invalid legacy typeCode mask a recoverable raw label", () => {
		const warnings = [];
		const out = sanitize({name: "Legacy Relic", type: "wondrous", typeCode: "W", rarity: "rare"}, {warnings});
		expect(out.type).toBeUndefined();
		expect(out.wondrous).toBe(true);
		expect(warnings).toEqual([]);
	});

	it("does not let a stale but legal typeCode override the item's edited category", () => {
		const warnings = [];
		const out = sanitize({name: "Former Blade", type: "potion", typeCode: "M", rarity: "common"}, {warnings});
		expect(out.type).toBe("P");
		expect(warnings).toEqual([]);
	});

	it("does not let a stale baseItem override the item's edited category", () => {
		const state = mkState([{name: "Longsword", source: "PHB", type: "M"}]);
		const out = sanitize({name: "Former Sword", type: "potion", baseItem: "Longsword|PHB", rarity: "common"}, {state});
		expect(out.type).toBe("P");
	});

	it("preserves an edition-specific typeCode when it matches the current category", () => {
		const out = sanitize({name: "Modern Ring", type: "ring", typeCode: "RG|XDMG", source: "Custom", rarity: "rare"});
		expect(out.type).toBe("RG|XDMG");
	});

	it("preserves an edition-specific rod code when it matches the current category", () => {
		const out = sanitize({name: "Modern Rod", type: "rod", typeCode: "RD|XDMG", source: "Custom", rarity: "rare"});
		expect(out.type).toBe("RD|XDMG");
	});

	it("preserves an edition-specific armor code when it matches armorType", () => {
		const out = sanitize({name: "Modern Plate", type: "armor", typeCode: "HA|XPHB", armorType: "heavy", rarity: "rare"});
		expect(out.type).toBe("HA|XPHB");
	});

	it("never emits a null type — an omitted optional property is deleted, not nulled", () => {
		const out = sanitize({name: "No Type Here", type: "weapon", rarity: "none"});
		expect(out.type).not.toBeNull();
		expect(Object.prototype.hasOwnProperty.call(out, "type")).toBe(false);
	});

	it("resolves duplicate baseItem catalog rows with last-match-wins, matching the state's own catalog-merge convention", () => {
		const state = mkState([
			{name: "Trick Item", source: "CSHEET", type: "M"},
			{name: "Trick Item", source: "CSHEET", type: "R"},
		]);
		const out = sanitize({name: "Ambiguous", type: "weapon", baseItem: "Trick Item|CSHEET", rarity: "none"}, {state});
		expect(out.type).toBe("R");
	});
});

describe("v20 — the collector ships exactly what the statblock names", () => {
	const mkState = (items) => ({getInventory: () => items.map(item => ({item}))});

	const CUSTOM = {name: "Hex Blade", _isCustom: true, typeCode: "M", rarity: "rare"};
	const CATALOG = {name: "Longsword", source: "XPHB", rarity: "none"};

	it("bundles a custom item the statblock refers to", () => {
		const monster = {source: "CSHEET", trait: [{name: "Gear", entries: ["{@item Hex Blade|CSHEET}"]}]};
		const out = CharacterSheetNpcExporter.buildCompanionItems(monster, mkState([CUSTOM, CATALOG]));
		expect(out.map(i => i.name)).toEqual(["Hex Blade"]);
		expect(out[0].source).toBe("CSHEET");
	});

	it("leaves a custom item the statblock never mentions on the shelf", () => {
		// Bundling from inventory rather than from the finished text would ship gear the
		// reader has no way to see, and would drift the moment the statblock stopped
		// naming something.
		const monster = {source: "CSHEET", trait: [{name: "Gear", entries: ["carries nothing of note"]}]};
		expect(CharacterSheetNpcExporter.buildCompanionItems(monster, mkState([CUSTOM]))).toEqual([]);
	});

	it("never bundles a catalog item that already has a home", () => {
		const monster = {source: "CSHEET", trait: [{name: "Gear", entries: ["{@item Longsword|XPHB}"]}]};
		expect(CharacterSheetNpcExporter.buildCompanionItems(monster, mkState([CATALOG]))).toEqual([]);
	});

	it("emits one entity for a stack of identical customs", () => {
		const monster = {source: "CSHEET", action: [{name: "Throw", entries: ["{@item Hex Blade|CSHEET}"]}]};
		const out = CharacterSheetNpcExporter.buildCompanionItems(monster, mkState([CUSTOM, {...CUSTOM}]));
		expect(out).toHaveLength(1);
	});

	it("treats a legacy source:\"custom\" row as sheet-authored", () => {
		const legacy = {name: "Old Relic", source: "custom", rarity: "rare"};
		const monster = {source: "CSHEET", trait: [{name: "Gear", entries: ["{@item Old Relic|CSHEET}"]}]};
		expect(CharacterSheetNpcExporter.buildCompanionItems(monster, mkState([legacy])).map(i => i.name))
			.toEqual(["Old Relic"]);
	});

	it("survives an empty or malformed monster", () => {
		expect(CharacterSheetNpcExporter.buildCompanionItems(null, mkState([CUSTOM]))).toEqual([]);
		expect(CharacterSheetNpcExporter.buildCompanionItems({source: "CSHEET"}, null)).toEqual([]);
	});
});

describe("v20 — external brew is reported, never copied", () => {
	const mk = (...tags) => ({source: "CSHEET", trait: [{name: "Gear", entries: tags}]});

	it("names third-party sources a reader would need", () => {
		const out = CharacterSheetNpcExporter.getExternalItemSources(
			mk("{@item Ioun Stone|MECIOUNSTONES}", "{@item Bag of Colding|GRIFFONSSADDLEBAG3}"));
		expect(out.sort()).toEqual(["GRIFFONSSADDLEBAG3", "MECIOUNSTONES"]);
	});

	it("stays quiet about core sources and about our own", () => {
		expect(CharacterSheetNpcExporter.getExternalItemSources(
			mk("{@item Longsword|XPHB}", "{@item Rope|PHB}", "{@item Hex Blade|CSHEET}"))).toEqual([]);
	});

	it("reports each source once however many items cite it", () => {
		expect(CharacterSheetNpcExporter.getExternalItemSources(
			mk("{@item A|THELEMAR}", "{@item B|THELEMAR}", "{@item C|THELEMAR}"))).toEqual(["THELEMAR"]);
	});
});

/**
 * The preview renders before anything is saved, so a bundled item exists only as a
 * JS object we are holding — its `{@item}` link resolves against an empty cache and
 * the hover silently shows nothing. Seeding `DataLoader` fixes that, but the cached
 * entity needs a `__prop` the item schema forbids, so the two must not be the same
 * object: a `__prop` leaking into the payload would invalidate the download.
 */
describe("v20 — preview hover registration", () => {
	const ITEM = {name: "Hecate's Dagger", source: "CSHEET", rarity: "legendary", type: "M"};

	let register; let calls; let realDataLoader; let warnSpy;

	beforeAll(async () => {
		const mod = await import("../../../js/charactersheet/charactersheet-export.js");
		register = mod.CharacterSheetExport.prototype._registerCompanionItemHovers;
	});

	beforeEach(() => {
		calls = [];
		realDataLoader = globalThis.DataLoader;
		globalThis.DataLoader = {_pCache_addToCache: (arg) => calls.push(arg)};
		warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
	});

	afterEach(() => {
		globalThis.DataLoader = realDataLoader;
		warnSpy.mockRestore();
	});

	it("seeds the cache under the item prop, allowlisted", () => {
		register.call({}, [ITEM]);
		expect(calls).toHaveLength(1);
		expect(Object.keys(calls[0].allDataMerged)).toEqual(["item"]);
		expect([...calls[0].propAllowlist]).toEqual(["item"]);
		expect(calls[0].allDataMerged.item).toHaveLength(1);
	});

	it("never lets the cache-only __prop reach the payload item", () => {
		const payload = [{...ITEM}];
		register.call({}, payload);

		expect(calls[0].allDataMerged.item[0].__prop).toBe("item");
		expect(payload[0]).not.toHaveProperty("__prop");
		expect(calls[0].allDataMerged.item[0]).not.toBe(payload[0]);
		expect(Object.keys(payload[0]).sort()).toEqual(Object.keys(ITEM).sort());
	});

	it("registers every bundled item", () => {
		register.call({}, [ITEM, {...ITEM, name: "Gambler's Dice"}]);
		expect(calls[0].allDataMerged.item.map(it => it.name))
			.toEqual(["Hecate's Dagger", "Gambler's Dice"]);
	});

	it("does nothing when there is nothing to bundle", () => {
		register.call({}, []);
		register.call({}, null);
		register.call({}, undefined);
		expect(calls).toHaveLength(0);
	});

	it("stays silent outside the browser, where DataLoader does not exist", () => {
		delete globalThis.DataLoader;
		expect(() => register.call({}, [ITEM])).not.toThrow();

		globalThis.DataLoader = {};
		expect(() => register.call({}, [ITEM])).not.toThrow();
		expect(warnSpy).not.toHaveBeenCalled();
	});

	it("warns but does not throw when the cache rejects the item", () => {
		globalThis.DataLoader = {_pCache_addToCache: () => { throw new Error("boom"); }};
		expect(() => register.call({}, [ITEM])).not.toThrow();
		expect(warnSpy).toHaveBeenCalled();
	});
});
