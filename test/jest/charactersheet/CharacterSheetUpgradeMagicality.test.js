/**
 * Upgrade magicality — Unit Tests
 *
 * Most item upgrades are plain smithing. Counting all of them against a *magic* capacity budget
 * filled items up with craftsmanship, so magicality is now authored data (`isMagical`) rather
 * than an inference from effect shape or a hardcoded name table.
 *
 * These tests pin three things: the resolver's precedence and its fail-open behaviour, that
 * `applyItemUpgrade` snapshots the flag, and that the shipped data actually carries it.
 */

import fs from "fs";
import path from "path";

import "./setup.js";
import "../../../js/charactersheet/charactersheet-state.js";
import {
	isUpgradeMagical,
	resetItemUpgradeCatalog,
	setItemUpgradeCatalog,
} from "../../../js/itembuilder/itembuilder-upgrade-rules.js";

const CharacterSheetState = globalThis.CharacterSheetState;

const REPO_ROOT = path.resolve(process.cwd());
const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(REPO_ROOT, rel), "utf8"));

const CATALOG = [
	{name: "Balanced", source: "TCAH", upgradeType: ["WU:1"]},
	{name: "Arcane", source: "TCAH", upgradeType: ["WU:3"], isMagical: true},
];

describe("Upgrade magicality", () => {
	afterEach(() => resetItemUpgradeCatalog());

	// ==========================================================================
	// isUpgradeMagical
	// ==========================================================================
	describe("isUpgradeMagical", () => {
		beforeEach(() => setItemUpgradeCatalog(CATALOG));

		it("reads the flag off the reference when it carries one", () => {
			expect(isUpgradeMagical({name: "Anything", isMagical: true})).toBe(true);
			expect(isUpgradeMagical({name: "Anything", isMagical: false})).toBe(false);
		});

		it("prefers the reference's own flag over the catalog", () => {
			// A snapshot is the record of what was applied; the catalog may have been re-authored
			// since. The snapshot wins.
			expect(isUpgradeMagical({name: "Arcane", source: "TCAH", isMagical: false})).toBe(false);
			expect(isUpgradeMagical({name: "Balanced", source: "TCAH", isMagical: true})).toBe(true);
		});

		it("falls back to the catalog for snapshots that predate the flag", () => {
			expect(isUpgradeMagical({name: "Arcane", source: "TCAH"})).toBe(true);
			expect(isUpgradeMagical({name: "Balanced", source: "TCAH"})).toBe(false);
		});

		it("fails open when the upgrade cannot be resolved", () => {
			// A lookup miss must never inflate Magic Capacity and manufacture an overload the
			// player did not earn.
			expect(isUpgradeMagical({name: "Unknown Thing", source: "NOPE"})).toBe(false);
			expect(isUpgradeMagical(null)).toBe(false);
			expect(isUpgradeMagical(undefined)).toBe(false);
			expect(isUpgradeMagical({})).toBe(false);
		});

		it("fails open when no catalog is loaded at all", () => {
			resetItemUpgradeCatalog();
			expect(isUpgradeMagical({name: "Arcane", source: "TCAH"})).toBe(false);
		});
	});

	// ==========================================================================
	// The snapshot
	// ==========================================================================
	describe("applyItemUpgrade snapshot", () => {
		let state; let itemId;

		beforeEach(() => {
			state = new CharacterSheetState();
			state.setCurrency("gp", 5000);
			state.addItem({name: "Longsword", source: "PHB", type: "M", weapon: true});
			itemId = state.getItems()[0].id;
		});

		it("records isMagical when the catalog entity declares it", () => {
			state.applyItemUpgrade(itemId, {name: "Arcane", source: "TCAH", upgradeType: ["WU:3"], isMagical: true}, 0);
			expect(state.getItemUpgrades(itemId)[0].isMagical).toBe(true);
		});

		it("records false — not undefined — for a mundane upgrade", () => {
			// An explicit `false` is what lets the hot path skip the catalog entirely; `undefined`
			// would send every mundane upgrade through a lookup on every recalculation.
			state.applyItemUpgrade(itemId, {name: "Balanced", source: "TCAH", upgradeType: ["WU:1"]}, 100);
			expect(state.getItemUpgrades(itemId)[0].isMagical).toBe(false);
		});

		it("survives a save/load round trip", () => {
			state.applyItemUpgrade(itemId, {name: "Arcane", source: "TCAH", upgradeType: ["WU:3"], isMagical: true}, 0);
			const reloaded = new CharacterSheetState();
			reloaded.loadFromJson(JSON.parse(JSON.stringify(state.toJson())));
			const reloadedId = reloaded.getItems()[0].id;
			expect(reloaded.getItemUpgrades(reloadedId)[0].isMagical).toBe(true);
		});
	});

	// ==========================================================================
	// The shipped data
	// ==========================================================================
	describe("authored data", () => {
		it("flags exactly the three magical site upgrades", () => {
			const {itemUpgrade} = readJson("data/itemupgrades.json");
			const magical = itemUpgrade.filter(u => u.isMagical).map(u => u.name).sort();
			// Everything else is mundane smithing — Balanced, Brutal, Sharpened, Silvered,
			// Masterwork, the armour proofings. Only these three invoke magic.
			expect(magical).toEqual(["Arcane", "Enchanted", "Magical"]);
		});

		it("never flags an upgrade false — absence means mundane", () => {
			const {itemUpgrade} = readJson("data/itemupgrades.json");
			expect(itemUpgrade.filter(u => u.isMagical === false)).toEqual([]);
		});

		it("flags every gemstone power in the Thelemar brew", () => {
			const {itemUpgrade} = readJson("homebrew/TravelersGuidetoThelemar.json");
			const gems = itemUpgrade.filter(u => (u.upgradeType || []).some(t => String(t).startsWith("GS:")));
			expect(gems.length).toBeGreaterThan(0);
			// Gemstone powers carry `rarity` and `craftingDC`: they are magic items by construction.
			expect(gems.filter(u => u.isMagical !== true)).toEqual([]);
		});

		it("flags two of the brew's four resistance-granting armour tags", () => {
			const {itemUpgrade} = readJson("homebrew/TravelersGuidetoThelemar.json");
			const au = itemUpgrade.filter(u => (u.upgradeType || []).includes("AU"));
			const magical = au.filter(u => u.isMagical).map(u => u.name).sort();
			// This list used to hold all four, on the reasoning that "no mundane crafting in 5e
			// grants damage resistance." That is a sound generalisation about 5e and the wrong
			// authority for this question: magicality here is a SETTING RULING, and the setting's
			// author has ruled that only the divine two are magical. Tempering steel against fire,
			// cold, lightning or thunder and plating armour in copper against acid are metallurgy
			// and chemistry — expensive craft, not enchantment.
			expect(magical).toEqual(["Blessed", "Mirrored"]);
		});

		/**
		 * The other two are still AU, still resistance-granting, and still cost hundreds of gold.
		 * Asserted explicitly rather than left to the absence above, because "not in the magical
		 * list" is also what a typo in the name or a dropped entry produces.
		 */
		it("keeps the mundane two authored, resistance-granting and explicitly non-magical", () => {
			const {itemUpgrade} = readJson("homebrew/TravelersGuidetoThelemar.json");
			const mundane = itemUpgrade.filter(u => ["Specifically Tempered", "Copper Plated"].includes(u.name));

			expect(mundane).toHaveLength(2);
			for (const u of mundane) {
				// `false`, not absent. An absent flag means "written before the field existed" and
				// sends the resolver to the catalog; an explicit `false` is an authored statement.
				expect(u.isMagical).toBe(false);
				expect(u.upgradeType).toContain("AU");
				expect(JSON.stringify(u.entries)).toMatch(/resistance/i);
			}
		});

		/**
		 * The consequence of the ruling that is NOT visible in the data: an applied-upgrade
		 * snapshot carries its own `isMagical`, and the resolver prefers it over the catalog.
		 * So a character who applied Copper Plated before this ruling keeps counting it against
		 * their Magic Capacity, and re-applying it is what adopts the new answer.
		 *
		 * Pinned rather than migrated. A migration would have to rewrite authored snapshots on
		 * load, and the snapshot exists precisely so that a later catalog edit cannot silently
		 * restate what an item already is. Recorded here so the grandfathering is a declared
		 * property rather than a bug report.
		 */
		it("does not retroactively demagick an already-applied snapshot", () => {
			const {itemUpgrade} = readJson("homebrew/TravelersGuidetoThelemar.json");
			setItemUpgradeCatalog(itemUpgrade);

			const legacy = {name: "Copper Plated", source: "TGTT", isMagical: true};
			expect(isUpgradeMagical(legacy)).toBe(true);

			// A snapshot predating the field resolves against the catalog, and so DOES adopt it.
			expect(isUpgradeMagical({name: "Copper Plated", source: "TGTT"})).toBe(false);
			// Control: the same two shapes on an upgrade the ruling did not touch, proving the
			// contrast above is about the ruling and not about one of the lookups simply failing.
			expect(isUpgradeMagical({name: "Blessed", source: "TGTT", isMagical: true})).toBe(true);
			expect(isUpgradeMagical({name: "Blessed", source: "TGTT"})).toBe(true);
		});

		it("keeps every flagged brew upgrade resolvable by the real resolver", () => {
			const {itemUpgrade} = readJson("homebrew/TravelersGuidetoThelemar.json");
			setItemUpgradeCatalog(itemUpgrade);
			for (const u of itemUpgrade.filter(x => x.isMagical)) {
				// Simulate a legacy snapshot: name + source only, no flag.
				expect(isUpgradeMagical({name: u.name, source: u.source})).toBe(true);
			}
		});
	});
});
