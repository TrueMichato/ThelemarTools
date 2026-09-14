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

	test("replaces a typeCode-only coarse Hub summary with the canonical catalog code", () => {
		const catalogItem = {
			name: "Signal Whistle",
			source: "TST",
			type: "G",
			entries: ["As an {@action Utilize} action, you sound the whistle."],
		};
		const summaryOnlySave = {
			name: "Legacy Hub character",
			inventory: [{
				id: "summary-only-gear",
				item: {
					name: catalogItem.name,
					source: catalogItem.source,
					typeCode: "gear",
				},
				quantity: 1,
			}],
		};
		const state = newState();
		state.setItemCatalog([catalogItem]);
		state.loadFromJson(summaryOnlySave);

		expect(state.getItemRaw("summary-only-gear")).toEqual(expect.objectContaining({
			type: "G",
			typeCode: "G",
		}));
		expect(state.getUsableGear()).toEqual([
			expect.objectContaining({
				itemId: "summary-only-gear",
				actionName: "Utilize",
			}),
		]);

		const lateCatalog = newState();
		lateCatalog.loadFromJson(summaryOnlySave);
		lateCatalog.setItemCatalog([catalogItem]);
		expect(lateCatalog.getItemRaw("summary-only-gear")).toEqual(state.getItemRaw("summary-only-gear"));
		expect(lateCatalog.getUsableGear()).toHaveLength(1);
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

	test("preserves source-authored hasRefs when only an enhanced catalog is available", () => {
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

		expect(state.toJson().inventory[0].item.hasRefs).toBe(true);
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
