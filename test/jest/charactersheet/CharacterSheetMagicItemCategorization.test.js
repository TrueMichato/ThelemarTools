/**
 * Character Sheet — Magic item categorization + weapon-attack surfacing.
 *
 * Two tightly-coupled bugs shared one root cause: stored inventory items carry a COARSE `type`
 * string (produced by `_getItemType`), yet the render-time categoriser tested RAW 5etools codes
 * ("P"/"WD"/"ST"/"RG") and an `item.wondrous` flag that was never persisted — so every magic
 * staff/wand/ring/wondrous item collapsed into "Other". Separately, a `type:"M"`/`type:"R"`
 * artifact (Gae Bolg) carries NO `weapon:true` flag, so the pre-fix add path stored `weapon:false`,
 * which ALSO denied it an attack (Combat generates attacks from `items.filter(i => i.weapon)`).
 *
 * These tests pin:
 *   - `state.addItem` derives the `weapon` flag from raw weapon type codes (the builder/raw path);
 *   - `_getItemType` handles source-suffixed codes ("RG|DMG") and boolean flags ("staff":true);
 *   - `_getItemCategory` maps the coarse stored type so nothing magic falls into "Other";
 *   - `_migrateInventoryItemWeaponFlag` repairs the `weapon` flag on pre-fix saves (idempotently).
 */

import fs from "node:fs";

import "./setup.js";
import {
	addAwardedEntryToCharacter,
	addTransferPayload,
	removeTransferPayload,
} from "../../../server/src/hub-actions.js";
import {HubHttpCharacterRepository} from "../../../js/hub/hub-http-character-repository.js";
import {applyJsonPatch} from "../../../js/hub/hub-json-patch.js";

if (typeof globalThis.document === "undefined") {
	globalThis.document = {
		addEventListener () {},
		getElementById () { return null; },
		querySelector () { return null; },
		querySelectorAll () { return []; },
	};
}

if (typeof globalThis.Parser?.dmgTypeToFull !== "function") {
	globalThis.Parser = globalThis.Parser || {};
	globalThis.Parser.dmgTypeToFull = (c) => ({S: "slashing", P: "piercing", B: "bludgeoning"}[c] || c);
}

if (typeof globalThis.CharacterSheetUpgrades === "undefined") {
	globalThis.CharacterSheetUpgrades = {
		isWeapon: () => false,
		isArmor: () => false,
		isShield: () => false,
		getUpgradeEffects: () => ({tags: [], notes: []}),
		getGemstoneSummary: () => "",
	};
}

import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-inventory.js";

const CharacterSheetState = globalThis.CharacterSheetState;
const CharacterSheetInventory = globalThis.CharacterSheetInventory;
const SITE_AWARD_ITEMS = JSON.parse(fs.readFileSync(
	new URL("../../../server/data/item-award-site-catalog.json", import.meta.url),
	"utf8",
)).items;

function getSiteAwardItem (name, source) {
	const item = SITE_AWARD_ITEMS.find(it => it.name === name && it.source === source);
	if (!item) throw new Error(`Missing site award item: ${name}|${source}`);
	return structuredClone(item);
}

function newState () {
	const state = new CharacterSheetState();
	state.addClass({name: "Fighter", source: "PHB", level: 5});
	state.setAbilityBase("str", 16);
	state.setAbilityBase("dex", 14);
	return state;
}

function makeInventory (state) {
	const inv = new CharacterSheetInventory({getState: () => state});
	inv._page = {getState: () => state, renderCharacter: () => {}, saveCharacter: () => {}};
	return inv;
}

function lastAdded (state) {
	const items = state.getItems();
	return items[items.length - 1];
}

function getSheetNormalizedHubDocument ({canonicalItem, quantity, notes = "before"}) {
	const state = newState();
	state.setItemCatalog([canonicalItem], {
		pristineItems: [canonicalItem],
		repairItems: [canonicalItem],
	});
	state.loadFromJson({
		id: "character-1",
		name: "Mira",
		notes: {general: notes},
		inventory: [{
			id: "stable-stack",
			item: structuredClone(canonicalItem),
			quantity,
		}],
	});
	const local = state.toJson();
	delete local.id;
	const canonical = structuredClone(local);
	canonical.inventory[0].item = structuredClone(canonicalItem);
	delete canonical.carry;
	return {canonical, local};
}

/** The combat attack generator's entry gate (charactersheet-combat.js). */
function isAttackEligible (state, id) {
	return state.getItems().some(i => i.id === id && i.weapon && i.equipped);
}

describe("state.addItem derives the weapon flag from raw type codes (builder/raw path)", () => {
	test("a raw type:'M' weapon with NO weapon flag becomes weapon:true and attack-eligible", () => {
		const state = newState();
		// Mirrors a builder-added raw data-file weapon: type code only, no boolean flag.
		state.addItem({name: "Raw Greatsword", source: "PHB", type: "M", weaponCategory: "martial", dmg1: "2d6", dmgType: "S"});
		const added = lastAdded(state);
		expect(added.weapon).toBe(true);

		state.setItemEquipped(added.id, true);
		expect(isAttackEligible(state, added.id)).toBe(true);
		expect(state.getWeaponDamageDie(added)).toBe("2d6");
	});

	test("Gae Bolg (type:'M' artifact, no weapon flag) is attack-eligible with its 4d10 die", () => {
		const state = newState();
		state.addItem({name: "Gae Bolg", source: "TGTT", type: "M", weaponCategory: "simple", dmg1: "4d10", dmgType: "P", bonusWeapon: "+4", rarity: "artifact"});
		const gae = lastAdded(state);
		expect(gae.weapon).toBe(true);

		state.setItemEquipped(gae.id, true);
		expect(isAttackEligible(state, gae.id)).toBe(true);
		expect(state.getWeaponDamageDie(gae)).toBe("4d10");
	});

	test("a raw type:'R' ranged weapon is flagged", () => {
		const state = newState();
		state.addItem({name: "Raw Longbow", source: "PHB", type: "R", weaponCategory: "martial", dmg1: "1d8", dmgType: "P"});
		expect(lastAdded(state).weapon).toBe(true);
	});

	test("non-weapon raw items (a wand) are NOT flagged as weapons", () => {
		const state = newState();
		state.addItem({name: "Wand of Magic Missiles", source: "DMG", type: "WD|DMG", charges: 7});
		expect(lastAdded(state).weapon).toBe(false);
	});

	test("an explicit weapon:false from the inventory module is not overridden", () => {
		const state = newState();
		state.addItem({name: "Not A Weapon", source: "DMG", type: "wondrous", weapon: false});
		expect(lastAdded(state).weapon).toBe(false);
	});
});

describe("_getItemType classifies source-suffixed codes and boolean flags", () => {
	let inv;
	beforeEach(() => { inv = makeInventory(newState()); });

	test.each([
		["Ring of Protection", {type: "RG|DMG"}, "ring"],
		["Wand of Missiles", {type: "WD|DMG"}, "wand"],
		["Rod of Lordly Might", {type: "RD|DMG"}, "rod"],
		["Scroll", {type: "SC|XPHB"}, "scroll"],
		["Potion", {type: "P|DMG"}, "potion"],
		["Staff of Power (DMG, staff flag)", {staff: true}, "staff"],
		["Robe of the Archmagi", {wondrous: true}, "wondrous"],
		["Gae Bolg", {type: "M", weaponCategory: "simple"}, "weapon"],
	])("%s => %s", (_name, item, expected) => {
		expect(inv._getItemType(item)).toBe(expected);
	});
});

describe("_getItemCategory keeps magic items out of 'Other'", () => {
	let state; let inv;
	beforeEach(() => { state = newState(); inv = makeInventory(state); });

	/** Add a catalog item through the real state path, return the STORED (coarse) form. */
	function addStored (raw) {
		state.addItem(raw);
		return lastAdded(state);
	}

	test.each([
		["Gae Bolg", {name: "Gae Bolg", source: "TGTT", type: "M", weaponCategory: "simple", dmg1: "4d10", dmgType: "P"}, "Weapons"],
		["Staff of Power (DMG)", {name: "Staff of Power", source: "DMG", staff: true}, "Wondrous Items"],
		["Ring of Protection", {name: "Ring of Protection", source: "DMG", type: "RG|DMG"}, "Wondrous Items"],
		["Wand of Missiles", {name: "Wand of Magic Missiles", source: "DMG", type: "WD|DMG"}, "Wondrous Items"],
		["Rod of Lordly Might", {name: "Rod of Lordly Might", source: "DMG", type: "RD|DMG"}, "Wondrous Items"],
		["Robe of the Archmagi", {name: "Robe of the Archmagi", source: "DMG", wondrous: true}, "Wondrous Items"],
		["Potion of Healing", {name: "Potion of Healing", source: "DMG", type: "P"}, "Consumables"],
		["Spell Scroll", {name: "Spell Scroll", source: "DMG", type: "SC"}, "Consumables"],
	])("%s stores + categorises as %s (never 'Other')", (_n, raw, expectedCategory) => {
		const stored = addStored(raw);
		const category = inv._getItemCategory(stored);
		expect(category).not.toBe("Other");
		expect(category).toBe(expectedCategory);
	});

	test.each([
		[{name: "Legacy Blade", source: "TST", typeCode: "M"}, "Weapons"],
		[{name: "Legacy Ring", source: "TST", typeCode: "RG|DMG"}, "Wondrous Items"],
	])("categorises a fail-closed Hub summary %o as %s", (item, expectedCategory) => {
		expect(inv._getItemCategory(item)).toBe(expectedCategory);
	});
});

describe("Hub summary-only inventory metadata migration", () => {
	test("rehydrates a metadata-rich catalog weapon and preserves it through export/reload", () => {
		const catalogItem = {
			name: "Moonsteel Longsword",
			source: "TST",
			type: "M",
			rarity: "rare",
			weight: 3,
			value: 25000,
			reqAttune: "by a knight",
			weaponCategory: "martial",
			property: ["V"],
			dmg1: "1d8",
			dmg2: "1d10",
			dmgType: "S",
			weapon: true,
			bonusWeapon: "+1",
			entries: ["A synthetic metadata-rich weapon used only by this regression."],
			effects: [{type: "skillBonus", skill: "athletics", value: 1}],
			_baseSource: "TST",
			_fullEntries: ["Transient renderer cache"],
			_fullAdditionalEntries: ["Transient additional renderer cache"],
			_valueFromRarity: 40000,
			_compositionSearch: "Transient composition index",
			_fSources: ["TST"],
			_l_value: "250 gp",
			variants: [{name: "Transient variant index"}],
		};
		const pristineCatalogItem = structuredClone(catalogItem);
		for (const key of [
			"_fullEntries",
			"_fullAdditionalEntries",
			"_valueFromRarity",
			"_compositionSearch",
			"_fSources",
			"_l_value",
			"variants",
		]) delete pristineCatalogItem[key];
		const enhancedCatalogItem = {...catalogItem, _isEnhanced: true};
		const summaryOnlySave = {
			name: "Hub character",
			inventory: [{
				id: "hub-award",
				item: {
					name: catalogItem.name,
					source: catalogItem.source,
					typeCode: catalogItem.type,
					rarity: catalogItem.rarity,
					weight: catalogItem.weight,
					value: catalogItem.value,
					_awardProvenance: {awardId: "award-1"},
				},
				quantity: 2,
				equipped: false,
				attuned: false,
			}],
		};
		const state = newState();
		state.setItemCatalog([enhancedCatalogItem], {pristineItems: [pristineCatalogItem]});
		state.loadFromJson(summaryOnlySave);
		const inventory = makeInventory(state);
		const item = state.getItemRaw("hub-award");

		expect(item).toEqual(expect.objectContaining({
			type: "M",
			typeCode: "M",
			weapon: true,
			weaponCategory: "martial",
			properties: ["V"],
			dmg1: "1d8",
			dmg2: "1d10",
			dmgType: "S",
			bonusWeapon: "+1",
			entries: catalogItem.entries,
			effects: catalogItem.effects,
			_baseSource: "TST",
			requiresAttunement: true,
			_awardProvenance: {awardId: "award-1"},
		}));
		for (const key of [
			"_fullEntries",
			"_fullAdditionalEntries",
			"_valueFromRarity",
			"_compositionSearch",
			"_fSources",
			"_l_value",
			"variants",
		]) expect(item).not.toHaveProperty(key);
		expect(inventory._getItemCategory(item)).toBe("Weapons");
		expect(state.getEffectiveWeaponDamage("hub-award")).toEqual(expect.objectContaining({
			dice: "1d8",
			damageType: "slashing",
		}));

		const exported = state.toJson();
		const reloaded = newState();
		reloaded.setItemCatalog([enhancedCatalogItem], {pristineItems: [pristineCatalogItem]});
		reloaded.loadFromJson(exported);
		expect(reloaded.getItemRaw("hub-award")).toEqual(item);

		const lateCatalog = newState();
		lateCatalog.loadFromJson(summaryOnlySave);
		lateCatalog.setItemCatalog([enhancedCatalogItem], {pristineItems: [pristineCatalogItem]});
		expect(lateCatalog.getItemRaw("hub-award")).toEqual(item);
	});

	test("repairs an official summary from immutable site authority despite a mutable brew UID collision", () => {
		const officialItem = {
			name: "Longsword",
			source: "PHB",
			type: "M",
			weight: 3,
			value: 1500,
			weaponCategory: "martial",
			property: ["V"],
			dmg1: "1d8",
			dmgType: "S",
			entries: ["Official site metadata."],
		};
		const collidingBrewItem = {
			...officialItem,
			type: "G",
			weight: 99,
			entries: ["Mutable brew metadata."],
			effects: [{type: "skillBonus", skill: "arcana", value: 99}],
			customMetadata: {injected: true},
			_isEnhanced: true,
		};
		const state = newState();
		state.setItemCatalog([
			{...officialItem, _isEnhanced: true},
			collidingBrewItem,
		], {
			pristineItems: [{
				name: officialItem.name,
				source: officialItem.source,
				entries: officialItem.entries,
			}],
		});
		state.loadFromJson({
			name: "Legacy Hub character",
			inventory: [{
				id: "official-summary",
				item: {
					name: officialItem.name,
					source: officialItem.source,
					typeCode: officialItem.type,
					weight: officialItem.weight,
					value: officialItem.value,
				},
				quantity: 1,
			}],
		});

		const repaired = state.getItemRaw("official-summary");
		expect(repaired).toEqual(expect.objectContaining({
			type: officialItem.type,
			weight: officialItem.weight,
			entries: officialItem.entries,
			dmg1: officialItem.dmg1,
			weaponCategory: officialItem.weaponCategory,
		}));
		expect(repaired).not.toHaveProperty("effects");
		expect(repaired).not.toHaveProperty("customMetadata");
	});

	test("does not retroactively hydrate a legacy summary from the current mutable brew version", () => {
		const mutableBrewItem = {
			name: "Campaign Harp",
			source: "TST",
			type: "INS",
			rarity: "rare",
			entries: ["Current mutable bundle text."],
			effects: [{type: "skillBonus", skill: "performance", value: 3}],
			_isEnhanced: true,
		};
		const state = newState();
		state.setItemCatalog([mutableBrewItem], {pristineItems: []});
		state.loadFromJson({
			name: "Legacy Hub character",
			inventory: [{
				id: "legacy-brew-summary",
				item: {
					name: mutableBrewItem.name,
					source: mutableBrewItem.source,
					typeCode: mutableBrewItem.type,
					rarity: mutableBrewItem.rarity,
				},
				quantity: 1,
			}],
		});
		const inventory = makeInventory(state);
		inventory._page._isHubCharacter = true;
		inventory.setItems([mutableBrewItem], {pristineItems: []});

		expect(state.getItemRaw("legacy-brew-summary")).toEqual(expect.objectContaining({
			name: mutableBrewItem.name,
			source: mutableBrewItem.source,
			typeCode: mutableBrewItem.type,
			rarity: mutableBrewItem.rarity,
		}));
		expect(state.getItemRaw("legacy-brew-summary")).not.toHaveProperty("type");
		expect(state.getItemRaw("legacy-brew-summary")).not.toHaveProperty("entries");
		expect(state.getItemRaw("legacy-brew-summary")).not.toHaveProperty("effects");
		expect(inventory._getItemCategory(state.getItemRaw("legacy-brew-summary"))).toBe("Tools");

		const reloaded = newState();
		reloaded.setItemCatalog([mutableBrewItem], {pristineItems: []});
		reloaded.loadFromJson(state.toJson());
		const reloadedInventory = makeInventory(reloaded);
		reloadedInventory._page._isHubCharacter = true;
		reloadedInventory.setItems([mutableBrewItem], {pristineItems: []});
		expect(reloaded.getItemRaw("legacy-brew-summary")).not.toHaveProperty("type");
		expect(reloaded.getItemRaw("legacy-brew-summary")).not.toHaveProperty("entries");
		expect(reloaded.getItemRaw("legacy-brew-summary")).not.toHaveProperty("effects");
		expect(reloadedInventory._getItemCategory(reloaded.getItemRaw("legacy-brew-summary"))).toBe("Tools");
	});

	test("does not rewrite a typeless authoritative Hub item from the current mutable brew", () => {
		const authoritativeItem = {
			name: "Campaign Amulet",
			source: "TST",
			rarity: "rare",
			entries: ["The authoritative historical text."],
		};
		const currentBrewItem = {
			...authoritativeItem,
			entries: ["Changed bundle text."],
			effects: [{type: "skillBonus", skill: "arcana", value: 3}],
		};
		const state = newState();
		state.loadFromJson({
			name: "Hub character",
			inventory: [{
				id: "typeless-authoritative-item",
				item: authoritativeItem,
				quantity: 1,
			}],
		});
		const inventory = makeInventory(state);
		inventory._page._isHubCharacter = true;
		inventory.setItems([currentBrewItem], {pristineItems: []});

		expect(state.getItemRaw("typeless-authoritative-item")).toEqual(expect.objectContaining({
			name: authoritativeItem.name,
			source: authoritativeItem.source,
			entries: authoritativeItem.entries,
		}));
		expect(state.getItemRaw("typeless-authoritative-item")).not.toHaveProperty("effects");

		const reloaded = newState();
		reloaded.loadFromJson(state.toJson());
		const reloadedInventory = makeInventory(reloaded);
		reloadedInventory._page._isHubCharacter = true;
		reloadedInventory.setItems([currentBrewItem], {pristineItems: []});
		expect(reloaded.getItemRaw("typeless-authoritative-item").entries).toEqual(authoritativeItem.entries);
		expect(reloaded.getItemRaw("typeless-authoritative-item")).not.toHaveProperty("effects");
	});

	test("does not replace an already canonical customized item with missing catalog fields", () => {
		const state = newState();
		state.setItemCatalog([{
			name: "Moonsteel Longsword",
			source: "TST",
			type: "M",
			weapon: true,
			bonusWeapon: "+1",
			entries: ["Catalog text"],
			effects: [{type: "skillBonus", skill: "athletics", value: 1}],
		}]);
		state.loadFromJson({
			name: "Customized character",
			inventory: [{
				id: "customized",
				item: {
					name: "Moonsteel Longsword",
					source: "TST",
					type: "M",
					entries: ["Player-authored replacement text"],
				},
				quantity: 1,
			}],
		});

		expect(state.getItemRaw("customized")).toEqual(expect.objectContaining({
			entries: ["Player-authored replacement text"],
		}));
		expect(state.getItemRaw("customized")).not.toHaveProperty("bonusWeapon");
		expect(state.getItemRaw("customized")).not.toHaveProperty("effects");
	});

	test("normalizes stored raw metadata after its campaign brew leaves the active catalog", () => {
		const saved = {
			name: "Retired brew character",
			inventory: [{
				id: "retired-brew-item",
				item: {
					name: "Retired Knight's Belt",
					source: "TST",
					type: "W",
					reqAttune: true,
					property: ["V"],
					charges: 3,
					effects: [{type: "carryCapacity", value: 50}],
					entries: [],
					additionalSources: [{source: "XGE", page: 83}],
				},
				quantity: 1,
				equipped: true,
				attuned: false,
			}],
		};
		const state = newState();
		state.loadFromJson(saved);
		const item = state.getItemRaw("retired-brew-item");

		expect(item).toEqual(expect.objectContaining({
			type: "W",
			typeCode: "W",
			requiresAttunement: true,
			properties: ["V"],
			chargesCurrent: 3,
			entries: [],
			additionalSources: [{source: "XGE", page: 83}],
		}));
		expect(state.getCarryingCapacityBreakdown().flatBonus).toBe(0);

		const reloaded = newState();
		reloaded.loadFromJson(state.toJson());
		expect(reloaded.getItemRaw("retired-brew-item")).toEqual(item);
		expect(reloaded.getCarryingCapacityBreakdown().flatBonus).toBe(0);
	});

	test.each([
		{
			label: "empty renderer entries",
			authoritativeItem: {
				name: "Abacus",
				source: "PHB",
				page: 150,
				srd: true,
				basicRules: true,
				type: "G",
				rarity: "none",
				weight: 2,
				value: 200,
			},
			enhancedFields: {entries: []},
			transientField: "entries",
		},
		{
			label: "renderer-added instrument source",
			authoritativeItem: {
				name: "+1 Rhythm-Maker's Drum",
				source: "TCE",
				page: 134,
				baseItem: "drum|phb",
				type: "INS",
				rarity: "uncommon",
				reqAttune: "by a bard",
				wondrous: true,
				weight: 3,
				bonusSpellAttack: "+1",
				bonusSpellSaveDc: "+1",
				entries: ["Synthetic stand-in for the canonical instrument text."],
			},
			enhancedFields: {additionalSources: [{source: "XGE", page: 83}]},
			transientField: "additionalSources",
		},
	])("does not persist $label from the enhanced catalog into a repaired legacy row", ({authoritativeItem, enhancedFields, transientField}) => {
		const state = newState();
		state.setItemCatalog(
			[{...authoritativeItem, ...enhancedFields, _isEnhanced: true}],
			{pristineItems: [authoritativeItem]},
		);
		state.loadFromJson({
			name: "Legacy Hub character",
			inventory: [{
				id: "legacy-stack",
				item: {
					name: authoritativeItem.name,
					source: authoritativeItem.source,
					typeCode: authoritativeItem.type,
					rarity: authoritativeItem.rarity,
					weight: authoritativeItem.weight,
					value: authoritativeItem.value,
				},
				quantity: 1,
			}],
		});
		const repairedItem = state.toJson().inventory[0].item;
		const merged = addAwardedEntryToCharacter({
			container: {
				inventory: [{id: "legacy-stack", item: repairedItem, quantity: 1}],
				currency: {},
			},
			incoming: {item: authoritativeItem, quantity: 1},
		});
		expect(merged.container.inventory).toEqual([
			expect.objectContaining({id: "legacy-stack", quantity: 2}),
		]);
		expect(repairedItem).not.toHaveProperty(transientField);
	});

	test("does not trust source-like hasRefs when only an enhanced mutable catalog is available", () => {
		const authoritativeItem = getSiteAwardItem("Acid Absorbing Tattoo", "TCE");
		const state = newState();
		state.setItemCatalog([{...authoritativeItem, _isEnhanced: true}]);
		state.loadFromJson({
			name: "Legacy Hub character",
			inventory: [{
				id: "legacy-stack",
				item: {
					name: authoritativeItem.name,
					source: authoritativeItem.source,
					rarity: authoritativeItem.rarity,
				},
				quantity: 1,
			}],
		});

		expect(state.toJson().inventory[0].item.hasRefs).toBeUndefined();
	});

	test.each([
		{
			name: "Acid Absorbing Tattoo",
			source: "TCE",
			enhancedFields: {
				entries: ["Renderer-dereferenced synthetic replacement."],
			},
			assertCanonicalFields: item => {
				expect(item.hasRefs).toBe(true);
				expect(item.entries).toEqual(getSiteAwardItem("Acid Absorbing Tattoo", "TCE").entries);
			},
		},
		{
			name: "Alchemist's Supplies",
			source: "PHB",
			enhancedFields: {},
			assertCanonicalFields: item => {
				expect(item.additionalSources).toEqual([{source: "XGE", page: 79}]);
			},
		},
	])("preserves source-authored metadata for $name through repair, repeat award, and stash return", ({
		name,
		source,
		enhancedFields,
		assertCanonicalFields,
	}) => {
		const authoritativeItem = getSiteAwardItem(name, source);
		const state = newState();
		const inventory = makeInventory(state);
		inventory.setItems(
			[{...authoritativeItem, ...enhancedFields, _isEnhanced: true}],
			{pristineItems: [authoritativeItem]},
		);
		state.loadFromJson({
			name: "Legacy Hub character",
			inventory: [{
				id: "legacy-stack",
				item: {
					name: authoritativeItem.name,
					source: authoritativeItem.source,
					...(authoritativeItem.type != null ? {typeCode: authoritativeItem.type} : {}),
					...(authoritativeItem.rarity != null ? {rarity: authoritativeItem.rarity} : {}),
					...(authoritativeItem.weight != null ? {weight: authoritativeItem.weight} : {}),
					...(authoritativeItem.value != null ? {value: authoritativeItem.value} : {}),
				},
				quantity: 1,
			}],
		});

		const repairedItem = state.toJson().inventory[0].item;
		assertCanonicalFields(repairedItem);

		const repeatedAward = addAwardedEntryToCharacter({
			container: {
				inventory: [{id: "legacy-stack", item: repairedItem, quantity: 1}],
				currency: {},
			},
			incoming: {item: authoritativeItem, quantity: 1},
		});
		expect(repeatedAward.container.inventory).toEqual([
			expect.objectContaining({id: "legacy-stack", quantity: 2}),
		]);

		const deposited = removeTransferPayload({
			container: repeatedAward.container,
			payload: {items: [{entryId: "legacy-stack", quantity: 1}], currency: {}},
		});
		const stash = addTransferPayload({container: {inventory: [], currency: {}}, escrow: deposited.escrow});
		const stashEntry = stash.inventory[0];
		const withdrawn = removeTransferPayload({
			container: stash,
			payload: {items: [{entryId: stashEntry.id, quantity: 1}], currency: {}},
		});
		const returned = addTransferPayload({container: deposited.container, escrow: withdrawn.escrow});

		expect(returned.inventory).toEqual([
			expect.objectContaining({id: "legacy-stack", quantity: 2}),
		]);
		assertCanonicalFields(returned.inventory[0].item);
	});
});

describe("Hub authoritative inventory reconciliation", () => {
	test("rebases a repeat award across sheet-normalized live and queued snapshots", async () => {
		const canonicalItem = getSiteAwardItem("+1 Rhythm-Maker's Drum", "TCE");
		const {canonical: baseData, local} = getSheetNormalizedHubDocument({
			canonicalItem,
			quantity: 1,
		});
		local.notes.general = "locally edited";
		const remoteData = addAwardedEntryToCharacter({
			container: baseData,
			incoming: {item: canonicalItem, quantity: 1},
		}).container;
		const base = {id: "character-1", campaignId: "campaign-1", revision: 1, data: baseData};
		const remote = {id: "character-1", campaignId: "campaign-1", revision: 2, data: remoteData};
		let resolveRemote;
		const pRemote = new Promise(resolve => resolveRemote = resolve);
		let getCount = 0;
		let patchInput;
		const api = {
			pGetSession: async () => ({signedIn: true}),
			pGetCharacter: async () => ++getCount === 1 ? structuredClone(base) : pRemote,
			pAcquireCharacterLease: async () => ({epoch: 1}),
			pPatchCharacter: async input => {
				patchInput = input;
				return {
					character: {
						...remote,
						revision: 3,
						data: applyJsonPatch(remote.data, input.patches),
					},
				};
			},
		};
		const repository = new HubHttpCharacterRepository({campaignId: "campaign-1", api});
		await repository.pGet({characterId: "character-1"});

		let adopted;
		const pReconcile = repository.pReconcileAuthoritativeCharacter({
			characterId: "character-1",
			fnGetLiveData: () => structuredClone(local),
			fnAdoptLive: data => adopted = data,
		});
		const pSave = repository.pUpsert({character: {id: "character-1", ...structuredClone(local)}});
		const pSaveResult = pSave.then(
			value => ({value}),
			error => ({error}),
		);
		resolveRemote(structuredClone(remote));

		await expect(pReconcile).resolves.toMatchObject({status: "reconciled", revision: 2});
		const {value: saved, error: saveError} = await pSaveResult;
		expect(saveError).toBeUndefined();
		expect(saved).toMatchObject({
			id: "character-1",
			notes: {general: "locally edited"},
			inventory: [expect.objectContaining({id: "stable-stack", quantity: 2})],
		});
		expect(adopted).toMatchObject({
			notes: {general: "locally edited"},
			inventory: [expect.objectContaining({id: "stable-stack", quantity: 2})],
		});
		expect(patchInput.patches).toContainEqual({
			op: "replace",
			path: "/notes/general",
			value: "locally edited",
		});
		expect(patchInput.patches.some(patch => patch.path === "/inventory" || patch.path.startsWith("/inventory/"))).toBe(false);
		expect(repository.getConflictRecovery("character-1")).toBeNull();
	});

	test("rebases an accepted transfer into a failed sheet-normalized recovery draft", async () => {
		const canonicalItem = getSiteAwardItem("+1 Rhythm-Maker's Drum", "TCE");
		const {canonical: baseData, local} = getSheetNormalizedHubDocument({
			canonicalItem,
			quantity: 2,
		});
		local.notes.general = "offline edit";
		const remoteData = removeTransferPayload({
			container: baseData,
			payload: {items: [{entryId: "stable-stack", quantity: 1}], currency: {}},
		}).container;
		const base = {id: "character-1", campaignId: "campaign-1", revision: 1, data: baseData};
		const remote = {id: "character-1", campaignId: "campaign-1", revision: 2, data: remoteData};
		let isTransportFailure = true;
		let patchInput;
		let getCount = 0;
		const api = {
			pGetSession: async () => ({signedIn: true}),
			pGetCharacter: async () => structuredClone(++getCount === 1 ? base : remote),
			pAcquireCharacterLease: async () => ({epoch: 1}),
			pPatchCharacter: async input => {
				if (isTransportFailure) throw new Error("response lost");
				patchInput = input;
				return {
					character: {
						...remote,
						revision: 3,
						data: applyJsonPatch(remote.data, input.patches),
					},
				};
			},
		};
		const repository = new HubHttpCharacterRepository({campaignId: "campaign-1", api});
		await repository.pGet({characterId: "character-1"});
		await expect(repository.pUpsert({
			character: {id: "character-1", ...structuredClone(local)},
		})).rejects.toThrow("response lost");

		await expect(repository.pReconcileAuthoritativeCharacter({
			characterId: "character-1",
			fnGetLiveData: () => structuredClone(local),
			fnAdoptLive: () => {},
		})).resolves.toMatchObject({status: "reconciled", revision: 2});
		const recovery = repository.getPendingRecovery("character-1");
		expect(recovery).toMatchObject({
			notes: {general: "offline edit"},
			inventory: [expect.objectContaining({id: "stable-stack", quantity: 1})],
		});

		isTransportFailure = false;
		await expect(repository.pUpsert({
			character: {id: "character-1", ...recovery},
		})).resolves.toMatchObject({
			id: "character-1",
			notes: {general: "offline edit"},
			inventory: [expect.objectContaining({id: "stable-stack", quantity: 1})],
		});
		expect(patchInput.patches).toContainEqual({
			op: "replace",
			path: "/notes/general",
			value: "offline edit",
		});
		expect(patchInput.patches.some(patch => patch.path === "/inventory" || patch.path.startsWith("/inventory/"))).toBe(false);
		expect(repository.getConflictRecovery("character-1")).toBeNull();
	});
});

describe("_migrateInventoryItemWeaponFlag repairs pre-fix saves", () => {
	function stateWithInventory (inventory) {
		const state = new CharacterSheetState();
		state._data.inventory = inventory;
		return state;
	}

	test("promotes a stored coarse type:'weapon' item that was saved weapon:false", () => {
		const state = stateWithInventory([
			{id: "gae", item: {name: "Gae Bolg", type: "weapon", weapon: false, weaponCategory: "simple", dmg1: "4d10"}, quantity: 1, equipped: true},
		]);
		state._migrateInventoryItemWeaponFlag();
		expect(state.getItems().find(i => i.id === "gae").weapon).toBe(true);
	});

	test("promotes a raw type:'M' item saved without a weapon flag", () => {
		const state = stateWithInventory([
			{id: "raw", item: {name: "Old Sword", type: "M", weaponCategory: "martial"}, quantity: 1, equipped: false},
		]);
		state._migrateInventoryItemWeaponFlag();
		expect(state.getItems().find(i => i.id === "raw").weapon).toBe(true);
	});

	test("does NOT flag non-weapons (a wand / gear with no weapon signals)", () => {
		const state = stateWithInventory([
			{id: "wand", item: {name: "Wand", type: "wand", weapon: false}, quantity: 1},
			{id: "gear", item: {name: "Rope", type: "gear"}, quantity: 1},
		]);
		state._migrateInventoryItemWeaponFlag();
		const items = state.getItems();
		expect(items.find(i => i.id === "wand").weapon).toBe(false);
		expect(!!items.find(i => i.id === "gear").weapon).toBe(false);
	});

	test("is idempotent — repeated runs never clobber an existing true flag", () => {
		const state = stateWithInventory([
			{id: "gae", item: {name: "Gae Bolg", type: "weapon", weapon: false, weaponCategory: "simple"}, quantity: 1},
		]);
		state._migrateInventoryItemWeaponFlag();
		state._migrateInventoryItemWeaponFlag();
		expect(state.getItems().find(i => i.id === "gae").weapon).toBe(true);
	});
});
