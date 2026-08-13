import {jest} from "@jest/globals";
import {readFileSync} from "fs";
import {resolve, dirname} from "path";
import {fileURLToPath} from "url";

import "./setup.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-inventory.js";
import "../../../js/charactersheet/charactersheet-combat.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..", "..");
const catalogItems = JSON.parse(readFileSync(resolve(REPO_ROOT, "data/items.json"), "utf8")).item;
const CharacterSheetState = globalThis.CharacterSheetState;
const CharacterSheetInventory = globalThis.CharacterSheetInventory;
const CharacterSheetCombat = globalThis.CharacterSheetCombat;

function makeDocument () {
	const elements = new Map();
	return {
		elements,
		addEventListener () {},
		querySelector () { return null; },
		querySelectorAll () { return []; },
		getElementById: id => elements.get(id) || null,
	};
}

function makeHarness () {
	const state = new CharacterSheetState();
	const page = {
		getState: () => state,
		saveCharacter: jest.fn(),
		_renderHp: jest.fn(),
	};
	const inventory = new CharacterSheetInventory(page);
	page._inventory = inventory;
	inventory._renderItemList = jest.fn();
	inventory._updateEncumbrance = jest.fn();
	const combat = Object.create(CharacterSheetCombat.prototype);
	combat._state = state;
	combat._page = page;
	page._combat = combat;
	return {state, page, inventory, combat};
}

function addCatalogItem (inventory, name, source = "XPHB") {
	const item = catalogItems.find(entry => entry.name === name && entry.source === source);
	expect(item).toBeDefined();
	inventory._addItem(item);
	return inventory._state.getItems().find(entry => entry.name === name && entry.source === source);
}

describe("Usable adventuring gear", () => {
	beforeEach(() => {
		globalThis.document = makeDocument();
		globalThis.InputUiUtil = {pGetUserBoolean: jest.fn(async () => true)};
		globalThis.JqueryUtil = {doToast: jest.fn()};
	});

	it.each([
		["Acid", "consume"],
		["Ball Bearings", "deploy-recoverable"],
		["Caltrops", "deploy-recoverable"],
		["Rope", "reference-only"],
	])("classifies %s with the explicit %s policy", (name, policy) => {
		const {state, inventory} = makeHarness();
		const added = addCatalogItem(inventory, name);
		const activations = state.getUsableGear().filter(entry => entry.itemId === added.id);

		expect(added.type).toBe("gear");
		expect(added.typeCode).toBe("G|XPHB");
		expect(activations.length).toBeGreaterThan(0);
		expect(activations.every(entry => entry.policy === policy)).toBe(true);
	});

	it("detects legacy PHB type-G action prose without a source suffix", () => {
		const {state, inventory} = makeHarness();
		const added = addCatalogItem(inventory, "Acid (vial)", "PHB");
		const activation = state.getUsableGear().find(entry => entry.itemId === added.id);

		expect(added.typeCode).toBe("G");
		expect(activation).toEqual(expect.objectContaining({
			actionType: "action",
			policy: "consume",
		}));
	});

	it("consumes one Acid only after confirmation", async () => {
		const {state, inventory} = makeHarness();
		const added = addCatalogItem(inventory, "Acid");
		addCatalogItem(inventory, "Acid");
		const activation = state.getUsableGear().find(entry => entry.itemId === added.id);

		await expect(inventory._useUsableGear(added.id, activation.activationFingerprint)).resolves.toBe(true);
		expect(state.getItems().find(item => item.id === added.id).quantity).toBe(1);
		expect(globalThis.InputUiUtil.pGetUserBoolean).toHaveBeenCalledTimes(1);
	});

	it("does not consume recoverable Caltrops when deployed", async () => {
		const {state, inventory} = makeHarness();
		const added = addCatalogItem(inventory, "Caltrops");
		const activation = state.getUsableGear().find(entry => entry.itemId === added.id);

		await expect(inventory._useUsableGear(added.id, activation.activationFingerprint)).resolves.toBe(true);
		expect(state.getItems().find(item => item.id === added.id).quantity).toBe(1);
		expect(globalThis.InputUiUtil.pGetUserBoolean).not.toHaveBeenCalled();
	});

	it("confirms reference-only Rope use and never consumes it", async () => {
		const {state, inventory} = makeHarness();
		const added = addCatalogItem(inventory, "Rope");
		const activations = state.getUsableGear().filter(entry => entry.itemId === added.id);
		const activation = activations[0];

		expect(activations).toHaveLength(1);
		await expect(inventory._useUsableGear(added.id, activation.activationFingerprint)).resolves.toBe(true);
		expect(state.getItems().find(item => item.id === added.id).quantity).toBe(1);
		expect(globalThis.InputUiUtil.pGetUserBoolean).toHaveBeenCalledTimes(1);
	});

	it("leaves reference-only gear untouched when manual resolution is cancelled", async () => {
		globalThis.InputUiUtil.pGetUserBoolean.mockResolvedValue(false);
		const {state, inventory} = makeHarness();
		const added = addCatalogItem(inventory, "Rope");
		const activation = state.getUsableGear().find(entry => entry.itemId === added.id);

		await expect(inventory._useUsableGear(added.id, activation.activationFingerprint)).resolves.toBe(false);
		expect(state.getItems().find(item => item.id === added.id).quantity).toBe(1);
	});

	it("renders usable gear in the Combat quick-use surface", () => {
		const {inventory, combat} = makeHarness();
		addCatalogItem(inventory, "Acid");
		addCatalogItem(inventory, "Caltrops");
		const section = e_({tag: "div"});
		section.querySelector = () => null;
		const container = e_({tag: "div"});
		globalThis.document.elements.set("charsheet-combat-consumables-section", section);
		globalThis.document.elements.set("charsheet-combat-consumables", container);

		combat.renderCombatConsumables();

		expect(container.innerHTML).toContain("Acid");
		expect(container.innerHTML).toContain("Caltrops");
		expect(container.innerHTML).toContain("Consumed on use");
		expect(container.innerHTML).toContain("Recoverable");
	});

	it("suppresses a matching derived item power by item and activation fingerprint", () => {
		const {state, inventory} = makeHarness();
		inventory._addItem({
			name: "Test Sprayer",
			source: "TST",
			type: "G",
			entries: [{
				type: "entries",
				name: "Spray",
				entries: ["As an action, spray the target. It must succeed on a {@dc 12} Dexterity saving throw."],
			}],
		});
		const added = state.getItems().find(item => item.name === "Test Sprayer");
		const storedPower = state.getItemRaw(added.id).itemPowers[0];
		const activation = state.getUsableGear().find(entry => entry.itemId === added.id);

		expect(storedPower.activationFingerprint).toBe(activation.activationFingerprint);
		expect(state.getItemPowers().filter(power => power.itemId === added.id)).toHaveLength(0);
	});
});
