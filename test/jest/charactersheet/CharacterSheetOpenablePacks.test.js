import {jest} from "@jest/globals";
import "./setup.js";

if (typeof globalThis.document === "undefined") {
	globalThis.document = {
		addEventListener () {},
		getElementById () { return null; },
		querySelector () { return null; },
		querySelectorAll () { return []; },
	};
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

import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-inventory.js";

const CharacterSheetState = globalThis.CharacterSheetState;
const CharacterSheetInventory = globalThis.CharacterSheetInventory;

const CATALOG = [
	{
		name: "Explorer's Pack",
		source: "XPHB",
		type: "G",
		packContents: [
			"backpack|xphb",
			{item: "torch|xphb", quantity: 10},
			{special: "10 feet of string"},
		],
	},
	{
		name: "Backpack",
		source: "XPHB",
		type: "G",
		weight: 5,
	},
	{name: "Torch", source: "XPHB", type: "G", weight: 1},
];

function makeInventory (state, catalog = CATALOG) {
	const inventory = new CharacterSheetInventory({
		getState: () => state,
		saveCharacter: jest.fn(),
	});
	inventory._renderItemList = jest.fn();
	inventory._updateEncumbrance = jest.fn();
	inventory._updateArmorClass = jest.fn();
	inventory.setItems(catalog);
	return inventory;
}

function addPack (state, quantity = 1, {withContents = false} = {}) {
	const pack = withContents ? CATALOG[0] : {name: "Explorer's Pack", source: "XPHB", type: "G"};
	state.addItem({...pack}, quantity);
	return state.getItems().find(item => item.name === "Explorer's Pack");
}

describe("Openable equipment packs", () => {
	let state;
	let inventory;

	beforeEach(() => {
		state = new CharacterSheetState();
		inventory = makeInventory(state);
		globalThis.JqueryUtil.doToast = jest.fn();
	});

	test("resolves plain UIDs, quantity UIDs, and special free-text entries before mutation", () => {
		const pack = addPack(state);
		const result = inventory._resolvePackContents(pack);

		expect(result.errors).toEqual([]);
		expect(result.contents).toHaveLength(3);
		expect(result.contents[0]).toMatchObject({
			item: {name: "Backpack", source: "XPHB", _fromPack: "Explorer's Pack|XPHB"},
			quantity: 1,
		});
		expect(result.contents[1]).toMatchObject({
			item: {name: "Torch", source: "XPHB", _fromPack: "Explorer's Pack|XPHB"},
			quantity: 10,
		});
		expect(result.contents[2]).toMatchObject({
			item: {
				name: "10 feet of string",
				source: "Custom",
				_isCustom: true,
				_fromPack: "Explorer's Pack|XPHB",
			},
			quantity: 1,
		});
	});

	test("opens atomically, consumes one pack per click, and cannot exceed the held pack count", () => {
		const pack = addPack(state, 2);

		expect(inventory._openPack(pack.id)).toBe(true);
		let items = state.getItems();
		expect(items.find(item => item.id === pack.id)?.quantity).toBe(1);
		expect(items.find(item => item.name === "Backpack")?.quantity).toBe(1);
		expect(items.find(item => item.name === "Torch")?.quantity).toBe(10);
		expect(items.find(item => item.name === "10 feet of string")?._fromPack).toBe("Explorer's Pack|XPHB");

		expect(inventory._openPack(pack.id)).toBe(true);
		items = state.getItems();
		expect(items.some(item => item.id === pack.id)).toBe(false);
		expect(items.find(item => item.name === "Backpack")?.quantity).toBe(2);
		expect(items.find(item => item.name === "Torch")?.quantity).toBe(20);
		expect(items.filter(item => item.name === "10 feet of string")).toHaveLength(2);

		const snapshot = MiscUtil.copyFast(state.getInventory());
		expect(inventory._openPack(pack.id)).toBe(false);
		expect(state.getInventory()).toEqual(snapshot);
	});

	test("keeps ordinary, same-pack, and different-pack stacks provenance-safe", () => {
		state.addItem({name: "Torch", source: "XPHB"}, 2);
		state.addItem({name: "Torch", source: "XPHB", _fromPack: "Explorer's Pack|XPHB"}, 3);
		state.addItem({name: "Torch", source: "XPHB", _fromPack: "Explorer's Pack|XPHB"}, 4);
		state.addItem({name: "Torch", source: "XPHB", _fromPack: "Dungeoneer's Pack|XPHB"}, 5);

		const torches = state.getItems().filter(item => item.name === "Torch");
		expect(torches).toHaveLength(3);
		expect(torches.find(item => !item._fromPack)?.quantity).toBe(2);
		expect(torches.find(item => item._fromPack === "Explorer's Pack|XPHB")?.quantity).toBe(7);
		expect(torches.find(item => item._fromPack === "Dungeoneer's Pack|XPHB")?.quantity).toBe(5);
	});

	test("aborts without consuming the pack when any UID is unresolved and reports it", () => {
		const brokenCatalog = [
			{name: "Broken Pack", source: "TST", type: "G", packContents: ["backpack|xphb", "missing thing|tst"]},
			CATALOG[1],
		];
		inventory.setItems(brokenCatalog);
		state.addItem({name: "Broken Pack", source: "TST", type: "G"});
		const pack = state.getItems().find(item => item.name === "Broken Pack");
		const snapshot = MiscUtil.copyFast(state.getInventory());

		expect(inventory._openPack(pack.id)).toBe(false);
		expect(state.getInventory()).toEqual(snapshot);
		expect(globalThis.JqueryUtil.doToast).toHaveBeenCalledWith(expect.objectContaining({
			type: "danger",
			content: expect.stringContaining("missing thing|tst"),
		}));
	});

	test("rolls the full character state back if a resolved batch throws during commit", () => {
		const pack = addPack(state);
		const resolved = inventory._resolvePackContents(pack);
		const snapshot = MiscUtil.copyFast(state._data);
		const originalAddItem = state.addItem.bind(state);
		let calls = 0;
		state.addItem = jest.fn((...args) => {
			calls++;
			if (calls === 2) throw new Error("synthetic add failure");
			return originalAddItem(...args);
		});

		const result = state.openEquipmentPack(pack.id, resolved.contents);

		expect(result).toMatchObject({success: false, consumed: 0, addedQuantity: 0});
		expect(state._data).toEqual(snapshot);
	});

	test("renders Open pack only for non-empty packs and surfaces spawned provenance", () => {
		const pack = addPack(state);
		const normalItem = {id: "normal", name: "Backpack", source: "XPHB", type: "G", quantity: 1};
		const packedItem = {
			...normalItem,
			id: "packed",
			_fromPack: "Explorer's Pack|XPHB",
		};

		expect(inventory._renderItemRow(pack).outerHTML).toContain("charsheet__item-open-pack");
		expect(inventory._renderItemRow(normalItem).outerHTML).not.toContain("charsheet__item-open-pack");
		expect(inventory._renderItemRow(packedItem).outerHTML).toContain("From Explorer's Pack");
	});
});
