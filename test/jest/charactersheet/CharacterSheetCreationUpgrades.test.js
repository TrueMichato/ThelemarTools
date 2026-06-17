/**
 * Character Sheet — Custom-item creation upgrade/empowerment wiring (#15)
 *
 * Verifies that `_applyCreationUpgrades` delegates to the upgrades module and that a
 * freshly-created custom item carries any upgrades + empowered gemstone selected during
 * creation, with cost / prerequisites / skill requirements bypassed.
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
const UPGRADE_BALANCED = {name: "Balanced", source: "TCAH", upgradeType: ["WU:1"], cost: "100 gp"};

function newState () {
	const state = new CharacterSheetState();
	state.addClass({name: "Fighter", source: "PHB", level: 5});
	return state;
}

function makeInventoryWithUpgrades (state) {
	const inv = new CharacterSheetInventory({getState: () => state});
	const allUpgrades = [GEM_RUBY, UPGRADE_BALANCED];
	const upgrades = new CharacterSheetUpgrades({
		getState: () => state,
		getItemUpgrades: () => allUpgrades,
		saveCharacter: () => {},
		_inventory: inv,
	});
	upgrades.setUpgrades(allUpgrades);
	const page = {
		getState: () => state,
		renderCharacter: () => {},
		saveCharacter: () => {},
		_upgrades: upgrades,
	};
	inv._page = page;
	return inv;
}

describe("Creation-time upgrade/empowerment wiring (#15)", () => {
	it("applies pending upgrades + gemstone to the created item", () => {
		const state = newState();
		state.setCurrency?.("gp", 0);
		const inv = makeInventoryWithUpgrades(state);

		state.addItem({name: "Custom Blade", source: "Custom", type: "M", weapon: true, _isCustom: true});
		const itemId = state.getItems()[0].id;

		inv._applyCreationUpgrades(itemId, {
			_pendingUpgrades: [UPGRADE_BALANCED],
			_pendingGemstone: GEM_RUBY,
		});

		expect(state.getItemUpgrades(itemId)).toHaveLength(1);
		expect(state.getItemUpgrades(itemId)[0].costPaid).toBe(0);

		const sockets = state.getSocketedGemstones(itemId);
		expect(sockets).toHaveLength(1);
		expect(sockets[0].name).toBe("Searing Light");
	});

	it("is a no-op when nothing was selected", () => {
		const state = newState();
		const inv = makeInventoryWithUpgrades(state);
		state.addItem({name: "Custom Blade", source: "Custom", type: "M", weapon: true, _isCustom: true});
		const itemId = state.getItems()[0].id;

		inv._applyCreationUpgrades(itemId, {});
		expect(state.getItemUpgrades(itemId)).toHaveLength(0);
		expect(state.getSocketedGemstones(itemId)).toHaveLength(0);
	});

	it("is a no-op when the upgrades module is unavailable", () => {
		const state = newState();
		const inv = new CharacterSheetInventory({getState: () => state});
		inv._page = {getState: () => state, _upgrades: null};
		state.addItem({name: "Custom Blade", source: "Custom", type: "M", weapon: true, _isCustom: true});
		const itemId = state.getItems()[0].id;

		expect(() => inv._applyCreationUpgrades(itemId, {_pendingUpgrades: [UPGRADE_BALANCED]})).not.toThrow();
		expect(state.getItemUpgrades(itemId)).toHaveLength(0);
	});
});
