import {jest} from "@jest/globals";
import {readFileSync} from "node:fs";
import {dirname, join} from "node:path";
import {fileURLToPath} from "node:url";

import "./setup.js";
import "../../../js/charactersheet/charactersheet-upgrades.js";
import "../../../js/charactersheet/charactersheet-state.js";

const CharacterSheetState = globalThis.CharacterSheetState;
const __dirname = dirname(fileURLToPath(import.meta.url));
const TGTT_DATA = JSON.parse(readFileSync(join(__dirname, "../../../homebrew/TravelersGuidetoThelemar.json"), "utf8"));
const ITEMS_DATA = JSON.parse(readFileSync(join(__dirname, "../../../data/items.json"), "utf8"));

const SPECIFICALLY_TEMPERED = TGTT_DATA.itemUpgrade.find(it => it.name === "Specifically Tempered" && it.source === "TGTT");
const FORM_FITTED = TGTT_DATA.itemUpgrade.find(it => it.name === "Form Fitted" && it.source === "TGTT");
const RING_OF_PROTECTION_DMG = ITEMS_DATA.item.find(it => it.name === "Ring of Protection" && it.source === "DMG");

let CharacterSheetPage;
let savedWindow;
let savedDocument;

beforeAll(async () => {
	savedWindow = globalThis.window;
	savedDocument = globalThis.document;
	globalThis.window = {
		addEventListener: () => {},
		dispatchEvent: () => {},
		location: {search: ""},
		matchMedia: () => ({matches: false, addEventListener: () => {}}),
	};
	globalThis.document = {
		querySelector: () => null,
		querySelectorAll: () => [],
		getElementById: () => null,
		addEventListener: () => {},
		body: {classList: {add () {}, remove () {}}},
	};
	await import("../../../js/charactersheet/charactersheet.js");
	CharacterSheetPage = globalThis.CharacterSheetPage;
});

afterEach(() => {
	jest.restoreAllMocks();
});

afterAll(() => {
	globalThis.window = savedWindow;
	globalThis.document = savedDocument;
});

function addLightArmor (state, {equipped = true} = {}) {
	state.addItem({
		name: "Leather Armor",
		source: "PHB",
		type: "LA",
		armor: true,
		armorType: "light",
		ac: 11,
	}, 1, equipped);
	return state.getItems().find(it => it.name === "Leather Armor").id;
}

function makeRollPage (state) {
	const page = Object.create(CharacterSheetPage.prototype);
	page._state = state;
	page._combat = null;
	page._getExhaustionPenalty = () => 0;
	page._rollD20 = () => ({roll: 10, mode: "normal", thelemar_critBonus: 0});
	page._pPickConditionalModifiers = async () => ({appliedConditionalIds: new Set(), applied: [], cancelled: false});
	page._pMaybeApplyRedCant = async ({effectiveRoll}) => ({effectiveRoll, applied: false, note: ""});
	page._pMaybeApplyFortuneIntervention = async ({effectiveRoll}) => ({effectiveRoll, note: ""});
	page._pMaybeApplyTacticalMind = async () => {};
	page._pMaybeApplyBloodPrice = async () => {};
	page.pAnimateD20 = async () => {};
	page._showDiceResult = jest.fn();
	return page;
}

describe("Specifically Tempered damage-resistance choice", () => {
	test("requires, persists, applies, removes, and swaps the exact TGTT choice", () => {
		expect(SPECIFICALLY_TEMPERED).toBeTruthy();
		const state = new CharacterSheetState();
		const itemId = addLightArmor(state);

		const missing = state.applyItemUpgrade(itemId, SPECIFICALLY_TEMPERED, 600);
		expect(missing).toEqual(expect.objectContaining({success: false}));
		expect(state.getItemUpgrades(itemId)).toEqual([]);

		expect(state.applyItemUpgrade(itemId, SPECIFICALLY_TEMPERED, 600, {damageType: "fire"})).toEqual({success: true});
		expect(state.getItemUpgrades(itemId)[0]).toEqual(expect.objectContaining({
			name: "Specifically Tempered",
			source: "TGTT",
			choices: {damageType: "fire"},
		}));
		expect(state.getResistances()).toContain("fire");
		expect(state.getResistances()).not.toContain("cold");

		const loaded = new CharacterSheetState();
		loaded.loadFromJson(state.toJson());
		expect(loaded.getItemUpgrades(itemId)[0].choices).toEqual({damageType: "fire"});
		expect(loaded.getResistances()).toContain("fire");

		expect(loaded.setItemUpgradeChoices(itemId, "Specifically Tempered", "TGTT", {damageType: "cold"})).toBe(true);
		expect(loaded.getResistances()).toContain("cold");
		expect(loaded.getResistances()).not.toContain("fire");

		expect(loaded.removeItemUpgrade(itemId, "Specifically Tempered", "TGTT")).toBe(true);
		expect(loaded.getResistances()).not.toContain("cold");
	});

	test("rejects damage types outside the authored choice list", () => {
		const state = new CharacterSheetState();
		const itemId = addLightArmor(state);

		const result = state.applyItemUpgrade(itemId, SPECIFICALLY_TEMPERED, 600, {damageType: "poison"});

		expect(result).toEqual(expect.objectContaining({success: false}));
		expect(state.getItemUpgrades(itemId)).toEqual([]);
		expect(state.getResistances()).not.toContain("poison");
	});
});

describe("manual defense ownership", () => {
	test("manual and automatic overlap round-trips without either owner deleting the other", () => {
		const state = new CharacterSheetState();
		state.addResistance("fire");
		state.addManualDefense("resistances", "fire");
		state.addManualDefense("immunities", "cold");
		state.addManualDefense("vulnerabilities", "radiant");

		const fireOwners = state.getDefenseBreakdown().resistances.filter(it => it.type === "fire");
		expect(fireOwners).toEqual(expect.arrayContaining([
			expect.objectContaining({ownership: "manual", removable: true}),
			expect.objectContaining({ownership: "automatic", removable: false}),
		]));

		const loaded = new CharacterSheetState();
		loaded.loadFromJson(state.toJson());
		expect(loaded.getManualDefenses()).toEqual({
			resistances: ["fire"],
			immunities: ["cold"],
			vulnerabilities: ["radiant"],
		});

		expect(loaded.removeManualDefense("resistances", "fire")).toBe(true);
		expect(loaded.getResistances()).toContain("fire");
		expect(loaded.getManualDefenses().resistances).not.toContain("fire");
	});

	test("removing a manual entry never removes an item-owned defense of the same type", () => {
		const state = new CharacterSheetState();
		state.setItemDefenses({
			resist: [{type: "lightning", source: "Ring of Lightning Resistance"}],
			immune: [],
			vulnerable: [],
			conditionImmune: [],
		});
		state.addManualDefense("resistances", "lightning");

		expect(state.removeManualDefense("resistances", "lightning")).toBe(true);
		expect(state.getResistances()).toContain("lightning");
		expect(state.getDefenseBreakdown().resistances).toContainEqual(expect.objectContaining({
			type: "lightning",
			source: "Ring of Lightning Resistance",
			ownership: "automatic",
			removable: false,
		}));
	});
});

describe("Ring of Protection structured item bonuses", () => {
	test("the real DMG entity and its +2 variant obey equip/attunement gates without double-counting", () => {
		expect(RING_OF_PROTECTION_DMG).toEqual(expect.objectContaining({
			source: "DMG",
			reqAttune: true,
			bonusAc: "+1",
			bonusSavingThrow: "+1",
		}));

		const state = new CharacterSheetState();
		state.setAbilityBase("dex", 10);
		state.addItem({
			...RING_OF_PROTECTION_DMG,
			bonusAc: "+2",
			bonusSavingThrow: "+2",
			_variantName: "Ring of Protection +2",
		});
		const itemId = state.getItems()[0].id;

		expect(state.getAc()).toBe(10);
		expect(state.getSaveBreakdown("dex").total).toBe(0);

		state.setItemEquipped(itemId, true);
		expect(state.getAc()).toBe(10);
		expect(state.getSaveBreakdown("dex").total).toBe(0);

		state.setItemAttuned(itemId, true);
		expect(state.getAc()).toBe(12);
		expect(state.getSaveBreakdown("dex")).toEqual(expect.objectContaining({total: 2}));
		expect(state.getSaveBreakdown("dex").components).toContainEqual(expect.objectContaining({
			type: "item",
			value: 2,
		}));

		state.setItemAttuned(itemId, true);
		expect(state.getAc()).toBe(12);
		expect(state.getSaveBreakdown("dex").total).toBe(2);

		const loaded = new CharacterSheetState();
		loaded.loadFromJson(state.toJson());
		expect(loaded.getAc()).toBe(12);
		expect(loaded.getSaveBreakdown("dex").total).toBe(2);

		loaded.setItemEquipped(itemId, false);
		expect(loaded.getAc()).toBe(10);
		expect(loaded.getSaveBreakdown("dex").total).toBe(0);
	});
});

describe("Form Fitted canonical skill path", () => {
	test("flows through skill modifier, breakdown, roll, persistence, and cleanup", async () => {
		expect(FORM_FITTED).toBeTruthy();
		const state = new CharacterSheetState();
		state.setAbilityBase("dex", 14);
		const itemId = addLightArmor(state, {equipped: false});
		expect(state.applyItemUpgrade(itemId, FORM_FITTED, 200)).toEqual({success: true});

		expect(state.getSkillModifier("acrobatics")).toBe(2);
		state.setItemEquipped(itemId, true);
		expect(state.getSkillModifier("acrobatics")).toBe(5);
		expect(state.getSkillBreakdown("acrobatics")).toEqual(expect.objectContaining({
			total: 5,
			components: expect.arrayContaining([
				expect.objectContaining({name: "Form Fitted", value: 3}),
			]),
		}));

		const roll = await makeRollPage(state)._rollSkillCheck("acrobatics", "Acrobatics", null);
		expect(roll.total).toBe(15);

		const loaded = new CharacterSheetState();
		loaded.loadFromJson(state.toJson());
		expect(loaded.getSkillModifier("acrobatics")).toBe(5);

		loaded.setItemEquipped(itemId, false);
		expect(loaded.getSkillModifier("acrobatics")).toBe(2);
		loaded.setItemEquipped(itemId, true);
		expect(loaded.removeItemUpgrade(itemId, "Form Fitted", "TGTT")).toBe(true);
		expect(loaded.getSkillModifier("acrobatics")).toBe(2);
		expect(loaded.getSkillBreakdown("acrobatics").components.some(it => it.name === "Form Fitted")).toBe(false);
	});
});
