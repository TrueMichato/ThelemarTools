import {jest} from "@jest/globals";
import {readFileSync} from "node:fs";
import {dirname, join} from "node:path";
import {fileURLToPath} from "node:url";

import "./setup.js";
import "../../../js/charactersheet/charactersheet-materials.js";
import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-inventory.js";

const CharacterSheetState = globalThis.CharacterSheetState;
const CharacterSheetInventory = globalThis.CharacterSheetInventory;
const __dirname = dirname(fileURLToPath(import.meta.url));
const TGTT_DATA = JSON.parse(readFileSync(join(__dirname, "../../../homebrew/TravelersGuidetoThelemar.json"), "utf8"));
const DRAGON_SCALES = TGTT_DATA.itemMaterial.find(it => it.name === "Dragon Scales" && it.source === "TGTT");

let savedDocument;
let savedWindow;

beforeAll(() => {
	savedDocument = globalThis.document;
	savedWindow = globalThis.window;
	globalThis.document = {
		addEventListener () {},
		getElementById () { return null; },
		querySelector () { return null; },
		querySelectorAll () { return []; },
	};
	globalThis.window = {addEventListener () {}};
});

afterAll(() => {
	globalThis.document = savedDocument;
	globalThis.window = savedWindow;
});

function makeInventory (state) {
	let inventory;
	const rendered = [];
	const page = {
		getState: () => state,
		renderCharacter: jest.fn(() => {
			inventory.syncItemDerivedState();
			rendered.push({
				ac: state.getAc(),
				breakdown: state.getAcBreakdown(),
			});
		}),
		saveCharacter: jest.fn(),
	};
	inventory = new CharacterSheetInventory(page);
	inventory._renderItemList = jest.fn();
	inventory._renderEquippedItems = jest.fn();
	return {inventory, page, rendered};
}

function addItem (state, item, {equipped = false, attuned = false} = {}) {
	state.addItem(item, 1, equipped, attuned);
	return state.getItems().at(-1).id;
}

function makeArmorHarness ({
	shieldMaterial = DRAGON_SCALES,
	shieldBonusAc = undefined,
} = {}) {
	const state = new CharacterSheetState();
	state.setAbilityBase("dex", 10);
	state.setItemMaterialCatalog([DRAGON_SCALES]);
	const {inventory, page, rendered} = makeInventory(state);

	addItem(state, {
		name: "Plate",
		source: "PHB",
		type: "HA",
		armor: true,
		armorType: "heavy",
		ac: 18,
	}, {equipped: true});
	addItem(state, {
		name: "Aegis Charm",
		source: "HB",
		type: "W",
		bonusAc: "+8",
	}, {equipped: true});
	const shieldId = addItem(state, {
		name: "Dragon Scale Shield",
		source: "HB",
		type: "S",
		shield: true,
		ac: 2,
		...(shieldBonusAc === undefined ? {} : {bonusAc: shieldBonusAc}),
		...(shieldMaterial ? {material: {name: shieldMaterial.name, source: shieldMaterial.source}} : {}),
	});

	inventory.syncItemDerivedState();
	return {state, inventory, page, rendered, shieldId};
}

function getShieldContribution (state) {
	return state.getAcBreakdown().components
		.filter(it => it.type === "shield" || (it.type === "magic" && /shield/i.test(it.name)))
		.reduce((total, it) => total + it.value, 0);
}

describe("shield AC projection through the Inventory equip flow", () => {
	it("reproduces the reported 28 to 29 correction and remains stable across repeated renders", () => {
		const {state, inventory, page, rendered, shieldId} = makeArmorHarness();
		expect(DRAGON_SCALES).toBeTruthy();
		expect(state.getAc()).toBe(26);

		inventory._toggleEquipped(shieldId);

		expect(page.renderCharacter).toHaveBeenCalledTimes(1);
		expect(page.saveCharacter).toHaveBeenCalledTimes(1);
		expect(rendered.at(-1)?.ac).toBe(29);
		expect(rendered.at(-1)?.breakdown.total).toBe(29);
		expect(state.getAc()).toBe(29);
		expect(state.getAcBreakdown().total).toBe(29);
		expect(getShieldContribution(state)).toBe(3);
		expect(state.getItemAcBonus()).toBe(8);
		expect(typeof state.getItemAcBonus()).toBe("number");

		inventory.syncItemDerivedState();
		expect(state.getAc()).toBe(29);
		expect(state.getItemAcBonus()).toBe(8);

		inventory._toggleEquipped(shieldId);
		expect(state.getAc()).toBe(26);
		inventory._toggleEquipped(shieldId);
		expect(state.getAc()).toBe(29);
	});

	it("updates an already-equipped shield when Dragon Scales are assigned or removed", () => {
		const {state, inventory, page, shieldId} = makeArmorHarness({shieldMaterial: null});
		inventory._toggleEquipped(shieldId);
		expect(state.getAc()).toBe(28);

		expect(state.setItemMaterial(shieldId, DRAGON_SCALES)).toBe(true);
		page.renderCharacter();
		expect(state.getAc()).toBe(29);
		expect(getShieldContribution(state)).toBe(3);

		expect(state.clearItemMaterial(shieldId)).toBe(true);
		page.renderCharacter();
		expect(state.getAc()).toBe(28);
		expect(getShieldContribution(state)).toBe(2);
	});

	it("repairs a stale persisted shield snapshot on the first render sync", () => {
		const {state, inventory, shieldId} = makeArmorHarness();
		inventory._toggleEquipped(shieldId);
		const saved = state.toJson();
		saved.ac.shield = {...saved.ac.shield, bonus: 0};

		const loaded = new CharacterSheetState();
		loaded.setItemMaterialCatalog([DRAGON_SCALES]);
		loaded.loadFromJson(saved);
		expect(loaded.getAc()).toBe(28);

		const loadedInventory = makeInventory(loaded).inventory;
		loadedInventory.syncItemDerivedState();
		expect(loaded.getAc()).toBe(29);
		expect(loaded.getAcBreakdown().total).toBe(29);
	});

	it("keeps a correct shield snapshot stable across save and load before render synchronization", () => {
		const {state, inventory, shieldId} = makeArmorHarness();
		inventory._toggleEquipped(shieldId);

		const loaded = new CharacterSheetState();
		loaded.setItemMaterialCatalog([DRAGON_SCALES]);
		loaded.loadFromJson(state.toJson());

		expect(loaded.getAc()).toBe(29);
		expect(loaded.getAcBreakdown().total).toBe(29);
	});

	it("folds an authored signed shield bonus and the material bonus exactly once", () => {
		const {state, inventory, shieldId} = makeArmorHarness({shieldBonusAc: "+1"});

		inventory._toggleEquipped(shieldId);

		expect(state.getAc()).toBe(30);
		expect(getShieldContribution(state)).toBe(4);
		expect(state._data.ac.shield).toEqual(expect.objectContaining({ac: 2, bonus: 2}));
		expect(typeof state._data.ac.shield.bonus).toBe("number");
		expect(state.getItemAcBonus()).toBe(8);

		inventory.syncItemDerivedState();
		expect(state.getAc()).toBe(30);
		expect(state.getItemAcBonus()).toBe(8);
	});
});

describe("shield AC snapshot compatibility", () => {
	it("normalizes canonical, projected, and legacy shield shapes without double projection", () => {
		const state = new CharacterSheetState();
		state.setItemMaterialCatalog([DRAGON_SCALES]);
		const canonical = {
			name: "Magic Dragon Scale Shield",
			source: "HB",
			type: "S",
			shield: true,
			ac: 2,
			bonusAc: "+1",
			material: {name: "Dragon Scales", source: "TGTT"},
			appliedUpgrades: [{name: "Test Upgrade", source: "HB"}],
		};

		expect(state._getShieldAcSlotSnapshot(canonical)).toEqual(expect.objectContaining({
			ac: 2,
			bonus: 2,
			appliedUpgrades: canonical.appliedUpgrades,
		}));
		expect(state._getShieldAcSlotSnapshot(state.projectItemMaterial(canonical))).toEqual(expect.objectContaining({
			ac: 2,
			bonus: 2,
		}));
		expect(state._getShieldAcSlotSnapshot({name: "Legacy Shield", acBonus: 2})).toEqual(expect.objectContaining({
			ac: 2,
			bonus: 0,
		}));
		expect(state._getShieldAcSlotSnapshot({
			name: "Legacy Dragon Scale Shield",
			acBonus: 2,
			material: {name: "Dragon Scales", source: "TGTT"},
		})).toEqual(expect.objectContaining({
			ac: 2,
			bonus: 1,
		}));
		expect(state._getShieldAcSlotSnapshot({
			name: "Dragon Scale Shield",
			type: "armor",
			armor: true,
			ac: 2,
			material: {name: "Dragon Scales", source: "TGTT"},
		})).toEqual(expect.objectContaining({
			ac: 2,
			bonus: 1,
		}));
	});

	it("keeps signed shield and item bonuses numeric at the AC boundary", () => {
		const state = new CharacterSheetState();
		state.setAbilityBase("dex", 10);
		state.setShield({equipped: true, ac: 2, bonus: "+1"});
		state.setItemAcBonus("-2");

		expect(state.getItemAcBonus()).toBe(-2);
		expect(state.getAc()).toBe(11);
		expect(state.getAcBreakdown().total).toBe(11);
		expect(typeof state.getAc()).toBe("number");

		const armored = new CharacterSheetState();
		armored.addItem({
			name: "Cursed Plate",
			type: "HA",
			armor: true,
			ac: 18,
			bonusAc: "-1",
		}, 1, true);
		expect(armored.getAc()).toBe(17);
		expect(armored.getAcBreakdown().total).toBe(17);
	});

	it("keeps armor and shield bonuses out of the generic item AC bucket", () => {
		const state = new CharacterSheetState();
		const {inventory} = makeInventory(state);
		addItem(state, {name: "+1 Plate", type: "HA", armor: true, ac: 18, bonusAc: "+1"}, {equipped: true});
		addItem(state, {name: "+2 Shield", type: "S", shield: true, ac: 2, bonusAc: "+2"}, {equipped: true});
		addItem(state, {name: "Ring of Protection", type: "RG", bonusAc: "+3", requiresAttunement: true}, {equipped: true, attuned: true});
		addItem(state, {name: "Cursed Cloak", type: "W", bonusAc: "-1"}, {equipped: true});

		inventory.syncItemDerivedState();
		expect(state.getItemAcBonus()).toBe(2);
		expect(state.getAc()).toBe(25);
		expect(state.getAcBreakdown().total).toBe(25);
	});

	it("continues to reject shields for Monk and shield-forbidden unarmored formulas", () => {
		const monk = new CharacterSheetState();
		monk.setAbilityBase("dex", 16);
		monk.setAbilityBase("wis", 16);
		monk.addClass({name: "Monk", source: "PHB", level: 1});
		monk.setItemMaterialCatalog([DRAGON_SCALES]);
		const monkInventory = makeInventory(monk).inventory;
		const monkShieldId = addItem(monk, {
			name: "Dragon Scale Shield",
			source: "HB",
			type: "S",
			shield: true,
			ac: 2,
			material: {name: "Dragon Scales", source: "TGTT"},
		});
		monkInventory.syncItemDerivedState();
		monkInventory._toggleEquipped(monkShieldId);
		expect(monk.getAc()).toBe(16);
		expect(monk.getAcBreakdown().total).toBe(16);

		const formulaState = new CharacterSheetState();
		formulaState.setAbilityBase("dex", 10);
		formulaState._data.acFormulas.push({
			base: 17,
			addDex: false,
			formulaType: "unarmoredDefense",
			requireUnarmored: true,
			name: "Carapace",
		});
		formulaState.setItemMaterialCatalog([DRAGON_SCALES]);
		const formulaInventory = makeInventory(formulaState).inventory;
		const formulaShieldId = addItem(formulaState, {
			name: "Dragon Scale Shield",
			source: "HB",
			type: "S",
			shield: true,
			ac: 2,
			material: {name: "Dragon Scales", source: "TGTT"},
		});
		formulaInventory.syncItemDerivedState();
		formulaInventory._toggleEquipped(formulaShieldId);
		expect(formulaState.getAc()).toBe(17);
		expect(formulaState.getAcBreakdown().total).toBe(17);
	});
});
