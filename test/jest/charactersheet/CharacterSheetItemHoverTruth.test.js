/**
 * Item hover truth — Unit Tests
 *
 * A materialled or upgraded item is no longer the thing the catalog describes: the material
 * rewrites its dice, weight and value, and an upgrade adds bonuses the printed entry never
 * mentions. Routing it to `items.html` showed the player a pristine longsword and silently
 * dropped everything they had paid for.
 *
 * These tests pin the routing decision, the two new lines, the derived damage, and — the thing
 * most easily lost in a change like this — that a plain catalog item still takes the catalog
 * path unchanged.
 */

import "./setup.js";
import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";

const CharacterSheetClassUtils = globalThis.CharacterSheetClassUtils;

// `isCatalogItemHoverTarget` requires a *loaded* source, so a site-source stub is the minimum
// needed to make the catalog path reachable at all.
beforeAll(() => {
	globalThis.SourceUtil = globalThis.SourceUtil || {};
	globalThis.SourceUtil.isSiteSource = (src) => String(src).toUpperCase() === "PHB";
});

afterEach(() => { delete globalThis.__csState; });

const plainSword = () => ({
	id: "i1", name: "Longsword", source: "PHB", weapon: true,
	dmg1: "1d8", dmgType: "S", weight: 3, value: 1500,
});

describe("Item hover routing", () => {
	// ==========================================================================
	// The catalog path must survive
	// ==========================================================================
	it("still routes a plain catalog item to the catalog hover", () => {
		expect(CharacterSheetClassUtils.isCatalogItemHoverTarget(plainSword())).toBe(true);
	});

	it("keeps routing a custom item away from the catalog", () => {
		expect(CharacterSheetClassUtils.isCatalogItemHoverTarget({...plainSword(), _isCustom: true})).toBe(false);
	});

	it("keeps routing an unloaded source away from the catalog", () => {
		expect(CharacterSheetClassUtils.isCatalogItemHoverTarget({...plainSword(), source: "NOPE"})).toBe(false);
	});

	// ==========================================================================
	// Modified items leave the catalog path
	// ==========================================================================
	it("takes a materialled item off the catalog path", () => {
		const item = {...plainSword(), material: {name: "Darkmetal", source: "TGTT"}};
		expect(CharacterSheetClassUtils.isCatalogItemHoverTarget(item)).toBe(false);
	});

	it("takes an upgraded item off the catalog path", () => {
		const item = {...plainSword(), appliedUpgrades: [{name: "Balanced", source: "TCAH"}]};
		expect(CharacterSheetClassUtils.isCatalogItemHoverTarget(item)).toBe(false);
	});

	it("takes a socketed item off the catalog path", () => {
		const item = {...plainSword(), socketedGemstones: [{name: "Ruby"}]};
		expect(CharacterSheetClassUtils.isCatalogItemHoverTarget(item)).toBe(false);
	});

	it("does not treat an empty upgrade array as a modification", () => {
		const item = {...plainSword(), appliedUpgrades: [], socketedGemstones: []};
		expect(CharacterSheetClassUtils.isCatalogItemHoverTarget(item)).toBe(true);
	});

	// ==========================================================================
	// Identity survives modification
	// ==========================================================================
	it("keeps a catalog identity even once modified", () => {
		const item = {...plainSword(), material: {name: "Darkmetal", source: "TGTT"}};
		expect(CharacterSheetClassUtils.isCatalogItemHoverTarget(item)).toBe(false);
		expect(CharacterSheetClassUtils.hasCatalogItemIdentity(item)).toBe(true);
	});

	it("denies a catalog identity to a custom item", () => {
		expect(CharacterSheetClassUtils.hasCatalogItemIdentity({...plainSword(), _isCustom: true})).toBe(false);
	});
});

describe("Item hover content", () => {
	const flatten = (entry) => JSON.stringify(entry.entries);

	// ==========================================================================
	// The two new lines
	// ==========================================================================
	it("names the material", () => {
		const item = {...plainSword(), material: {name: "Darkmetal", source: "TGTT"}};
		expect(flatten(CharacterSheetClassUtils.buildItemInlineHoverEntry(item))).toContain("Darkmetal");
	});

	it("lists every applied upgrade", () => {
		const item = {...plainSword(), appliedUpgrades: [{name: "Brutal"}, {name: "Balanced"}]};
		const text = flatten(CharacterSheetClassUtils.buildItemInlineHoverEntry(item));
		expect(text).toContain("Brutal");
		expect(text).toContain("Balanced");
		expect(text).toContain("Upgrades");
	});

	it("lists socketed gemstones with their charges", () => {
		const item = {...plainSword(), socketedGemstones: [{name: "Ruby", chargesMax: 3, chargesCurrent: 1}]};
		const text = flatten(CharacterSheetClassUtils.buildItemInlineHoverEntry(item));
		expect(text).toContain("Ruby");
		expect(text).toContain("1/3");
	});

	it("adds no material or upgrade line to an unmodified item", () => {
		const text = flatten(CharacterSheetClassUtils.buildItemInlineHoverEntry(plainSword()));
		expect(text).not.toContain("Material");
		expect(text).not.toContain("Upgrades");
	});

	// ==========================================================================
	// Nothing is lost by leaving the catalog path
	// ==========================================================================
	it("links back to the printed entry for a modified catalog item", () => {
		const item = {...plainSword(), material: {name: "Darkmetal", source: "TGTT"}};
		expect(flatten(CharacterSheetClassUtils.buildItemInlineHoverEntry(item)))
			.toContain("{@item Longsword|PHB}");
	});

	it("offers no catalog link for a modified custom item", () => {
		const item = {...plainSword(), _isCustom: true, appliedUpgrades: [{name: "Balanced"}]};
		expect(flatten(CharacterSheetClassUtils.buildItemInlineHoverEntry(item))).not.toContain("{@item");
	});

	it("offers no catalog link for an unmodified item", () => {
		expect(flatten(CharacterSheetClassUtils.buildItemInlineHoverEntry(plainSword()))).not.toContain("{@item");
	});

	it("preserves the item's own prose", () => {
		const item = {...plainSword(), material: {name: "Darkmetal"}, entries: ["A blade of black steel."]};
		expect(flatten(CharacterSheetClassUtils.buildItemInlineHoverEntry(item)))
			.toContain("A blade of black steel.");
	});

	// ==========================================================================
	// Damage comes from the derivation, not the frozen string
	// ==========================================================================
	it("shows the derived damage when state can supply it", () => {
		globalThis.__csState = {
			getEffectiveWeaponDamage: () => ({
				displayFull: "1d10+1 Slashing", attackBonus: 2, critThreshold: 19,
			}),
		};
		const item = {...plainSword(), damage: "1d8 slashing", appliedUpgrades: [{name: "Balanced"}]};
		const text = flatten(CharacterSheetClassUtils.buildItemInlineHoverEntry(item));

		expect(text).toContain("1d10+1 Slashing");
		expect(text).not.toContain("1d8 slashing");
		expect(text).toContain("+2");
		expect(text).toContain("19");
	});

	it("falls back to the item's own damage when no state is published", () => {
		const text = flatten(CharacterSheetClassUtils.buildItemInlineHoverEntry(plainSword()));
		expect(text).toContain("1d8");
	});
});
