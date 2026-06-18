/**
 * Character Sheet — Edit-mode item upgrade/empowerment wiring (#6)
 *
 * Verifies that `_applyEditUpgrades` reconciles the upgrades/gemstone selection from the EDIT
 * modal against an item's CURRENT persisted state:
 *   - newly-selected upgrades are added (force-applied, no cost);
 *   - de-selected upgrades that were previously applied are removed;
 *   - the gemstone select sockets / swaps / un-sockets the single gem slot;
 *   - applying the same selection again is idempotent (never double-records);
 *   - it is a no-op (existing upgrades untouched) when the upgrades section was not shown.
 *
 * Mirrors the creation-time counterpart (#15) in CharacterSheetCreationUpgrades.test.js.
 */

import "./setup.js";

if (typeof globalThis.document === "undefined") {
	globalThis.document = {
		addEventListener () {},
		getElementById () { return null; },
		querySelector () { return null; },
		querySelectorAll () { return []; },
	};
}

import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-upgrades.js";
import "../../../js/charactersheet/charactersheet-inventory.js";

const CharacterSheetState = globalThis.CharacterSheetState;
const CharacterSheetUpgrades = globalThis.CharacterSheetUpgrades;
const CharacterSheetInventory = globalThis.CharacterSheetInventory;

const GEM_RUBY = {
	name: "Searing Light",
	source: "TGTT",
	gemName: "Ruby",
	rarity: "uncommon",
	upgradeType: ["GS:U"],
	entries: ["Deals fire damage."],
	charges: 3,
	recharge: "dawn",
};
const GEM_SAPPHIRE = {
	name: "Chilling Touch",
	source: "TGTT",
	gemName: "Sapphire",
	rarity: "uncommon",
	upgradeType: ["GS:U"],
	entries: ["Deals cold damage."],
};
const UPGRADE_BALANCED = {name: "Balanced", source: "TCAH", upgradeType: ["WU:1"], cost: "100 gp"};
const UPGRADE_SILVERED = {name: "Silvered", source: "TCAH", upgradeType: ["WU:1"], cost: "100 gp"};

const ALL_UPGRADES = [GEM_RUBY, GEM_SAPPHIRE, UPGRADE_BALANCED, UPGRADE_SILVERED];

function newState () {
	const state = new CharacterSheetState();
	state.addClass({name: "Fighter", source: "PHB", level: 5});
	return state;
}

function makeInventoryWithUpgrades (state) {
	const inv = new CharacterSheetInventory({getState: () => state});
	const upgrades = new CharacterSheetUpgrades({
		getState: () => state,
		getItemUpgrades: () => ALL_UPGRADES,
		saveCharacter: () => {},
		_inventory: inv,
	});
	upgrades.setUpgrades(ALL_UPGRADES);
	inv._page = {
		getState: () => state,
		renderCharacter: () => {},
		saveCharacter: () => {},
		getItemUpgrades: () => ALL_UPGRADES,
		_upgrades: upgrades,
	};
	return inv;
}

function makeWeapon (state) {
	state.addItem({name: "Custom Blade", source: "Custom", type: "M", weapon: true, _isCustom: true});
	return state.getItems()[0].id;
}

describe("Edit-mode upgrade/empowerment reconciliation (#6)", () => {
	it("adds a newly-selected upgrade while preserving one already applied (no duplication)", () => {
		const state = newState();
		const inv = makeInventoryWithUpgrades(state);
		const itemId = makeWeapon(state);

		// Pre-existing upgrade on the item.
		state.applyItemUpgrade(itemId, UPGRADE_BALANCED, 0);
		expect(state.getItemUpgrades(itemId).map(u => u.name)).toEqual(["Balanced"]);

		// Edit modal: Balanced stays checked + Silvered newly checked.
		inv._applyEditUpgrades(itemId, {_pendingUpgrades: [UPGRADE_BALANCED, UPGRADE_SILVERED], _pendingGemstone: null});

		const names = state.getItemUpgrades(itemId).map(u => u.name).sort();
		expect(names).toEqual(["Balanced", "Silvered"]);
		// Balanced must not be re-recorded.
		expect(state.getItemUpgrades(itemId).filter(u => u.name === "Balanced")).toHaveLength(1);
	});

	it("removes a previously-applied upgrade when it is de-selected", () => {
		const state = newState();
		const inv = makeInventoryWithUpgrades(state);
		const itemId = makeWeapon(state);

		state.applyItemUpgrade(itemId, UPGRADE_BALANCED, 0);
		state.applyItemUpgrade(itemId, UPGRADE_SILVERED, 0);

		// Edit modal: only Balanced left checked → Silvered removed.
		inv._applyEditUpgrades(itemId, {_pendingUpgrades: [UPGRADE_BALANCED], _pendingGemstone: null});

		expect(state.getItemUpgrades(itemId).map(u => u.name)).toEqual(["Balanced"]);
	});

	it("is idempotent: re-applying the identical selection changes nothing", () => {
		const state = newState();
		const inv = makeInventoryWithUpgrades(state);
		const itemId = makeWeapon(state);

		const selection = {_pendingUpgrades: [UPGRADE_BALANCED], _pendingGemstone: GEM_RUBY};
		inv._applyEditUpgrades(itemId, selection);
		inv._applyEditUpgrades(itemId, selection);
		inv._applyEditUpgrades(itemId, selection);

		expect(state.getItemUpgrades(itemId)).toHaveLength(1);
		expect(state.getSocketedGemstones(itemId)).toHaveLength(1);
		expect(state.getSocketedGemstones(itemId)[0].name).toBe("Searing Light");
	});

	it("sockets, swaps, and un-sockets the single gemstone slot", () => {
		const state = newState();
		const inv = makeInventoryWithUpgrades(state);
		const itemId = makeWeapon(state);

		// Socket Ruby.
		inv._applyEditUpgrades(itemId, {_pendingUpgrades: [], _pendingGemstone: GEM_RUBY});
		expect(state.getSocketedGemstones(itemId).map(g => g.name)).toEqual(["Searing Light"]);

		// Swap to Sapphire (un-socket old, socket new → still one gem).
		inv._applyEditUpgrades(itemId, {_pendingUpgrades: [], _pendingGemstone: GEM_SAPPHIRE});
		const gems = state.getSocketedGemstones(itemId);
		expect(gems).toHaveLength(1);
		expect(gems[0].name).toBe("Chilling Touch");

		// Clear → un-socket.
		inv._applyEditUpgrades(itemId, {_pendingUpgrades: [], _pendingGemstone: null});
		expect(state.getSocketedGemstones(itemId)).toHaveLength(0);
	});

	it("removes an upgrade without disturbing the socketed gemstone", () => {
		const state = newState();
		const inv = makeInventoryWithUpgrades(state);
		const itemId = makeWeapon(state);

		state.applyItemUpgrade(itemId, UPGRADE_BALANCED, 0);
		state.socketGemstone(itemId, CharacterSheetUpgrades.buildGemstoneData(GEM_RUBY));

		// De-select the upgrade but keep the gem selected.
		inv._applyEditUpgrades(itemId, {_pendingUpgrades: [], _pendingGemstone: GEM_RUBY});

		expect(state.getItemUpgrades(itemId)).toHaveLength(0);
		expect(state.getSocketedGemstones(itemId).map(g => g.name)).toEqual(["Searing Light"]);
	});

	it("is a no-op when the upgrades section was not shown (no pending keys)", () => {
		const state = newState();
		const inv = makeInventoryWithUpgrades(state);
		const itemId = makeWeapon(state);

		state.applyItemUpgrade(itemId, UPGRADE_BALANCED, 0);
		state.socketGemstone(itemId, CharacterSheetUpgrades.buildGemstoneData(GEM_RUBY));

		// Neither _pendingUpgrades nor _pendingGemstone present → leave everything untouched.
		inv._applyEditUpgrades(itemId, {});

		expect(state.getItemUpgrades(itemId).map(u => u.name)).toEqual(["Balanced"]);
		expect(state.getSocketedGemstones(itemId).map(g => g.name)).toEqual(["Searing Light"]);
	});

	it("does not throw when the upgrades module is unavailable", () => {
		const state = newState();
		const inv = new CharacterSheetInventory({getState: () => state});
		inv._page = {getState: () => state, _upgrades: null};
		const itemId = makeWeapon(state);

		expect(() => inv._applyEditUpgrades(itemId, {_pendingUpgrades: [UPGRADE_BALANCED]})).not.toThrow();
		expect(state.getItemUpgrades(itemId)).toHaveLength(0);
	});
});
