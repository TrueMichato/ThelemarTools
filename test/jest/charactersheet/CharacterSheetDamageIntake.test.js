import fs from "node:fs";
import {jest} from "@jest/globals";
import "./setup.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-state.js";

const ROOT = new URL("../../../", import.meta.url);
const HTML = fs.readFileSync(new URL("charactersheet.html", ROOT), "utf8");
const JS = fs.readFileSync(new URL("js/charactersheet/charactersheet.js", ROOT), "utf8");
const MOBILE_JS = fs.readFileSync(new URL("js/charactersheet/charactersheet-mobile.js", ROOT), "utf8");
const CSS = fs.readFileSync(new URL("css/charactersheet.css", ROOT), "utf8");

const CharacterSheetState = globalThis.CharacterSheetState;
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

afterEach(() => jest.restoreAllMocks());

afterAll(() => {
	globalThis.window = savedWindow;
	globalThis.document = savedDocument;
});

function makePage (state = new CharacterSheetState()) {
	const page = Object.create(CharacterSheetPage.prototype);
	page._state = state;
	page._currentCharacterId = "character-a";
	page._lastDamageType = null;
	page._damageIntakeAmount = 0;
	page._damageIntakePreviewIntent = "damage";
	page._lastHpChange = null;
	page._lastHpOutcome = null;
	page._saveCurrentCharacter = jest.fn();
	page._renderHp = jest.fn();
	page._renderConditions = jest.fn();
	page._showDiceResult = jest.fn();
	page._flashHpBar = jest.fn();
	page._pOfferZeroHpIntervention = jest.fn();
	page._pOfferMaterialDamageReactions = jest.fn();
	page._syncDamageIntakeControls = jest.fn();
	return page;
}

describe("Canonical damage/heal intake structure", () => {
	it("removes the legacy buttons and keeps exactly one shared host per desktop tab", () => {
		expect(HTML).not.toMatch(/id="charsheet-btn-(?:heal|damage)"/);
		expect(HTML.match(/data-charsheet-hp-intake-host=/g)).toHaveLength(2);
		expect(HTML).toContain("data-charsheet-hp-intake-host=\"overview\"");
		expect(HTML).toContain("data-charsheet-hp-intake-host=\"combat\"");
		expect(JS).not.toMatch(/\n\t(?:async )?_onHeal \(/);
		expect(JS).not.toMatch(/\n\t(?:async )?_onDamage \(/);
	});

	it("generates Amount, Type, Damage, Heal in that order without saturated action classes", () => {
		const page = makePage();
		const markup = page._getDamageIntakeMarkup("overview");
		const positions = ["amount", "type-trigger", "damage", "heal"]
			.map(role => markup.indexOf(`data-charsheet-dmg-role="${role}"`));
		expect(positions).toEqual([...positions].sort((a, b) => a - b));
		expect(markup).not.toMatch(/ve-btn-(?:danger|success)/);
	});

	it("gates the quiet advanced affordance on nonmagical damage reduction", () => {
		const page = makePage();
		page._state.hasNonmagicalDamageReduction = () => false;
		expect(page._getDamageIntakeMarkup("overview")).not.toContain("data-charsheet-dmg-role=\"advanced\"");
		page._state.hasNonmagicalDamageReduction = () => true;
		expect(page._getDamageIntakeMarkup("overview")).toContain("data-charsheet-dmg-role=\"advanced\"");
	});

	it("keeps the type menu hidden and uses token-based neutral/tinted actions", () => {
		expect(CSS).toMatch(/\.charsheet__dmg-type-menu\[hidden\]\s*\{\s*display:\s*none;/);
		expect(CSS).toMatch(/\.charsheet__dmg-apply--damage[\s\S]*var\(--cs-primary-light\)/);
		expect(CSS).toMatch(/\.charsheet__dmg-apply--heal[\s\S]*var\(--cs-bg-elevated\)/);
		expect(CSS).toMatch(/@media \(max-width: 390px\)/);
	});

	it("routes mobile HP to the Combat intake instead of a separate tray", () => {
		expect(MOBILE_JS).not.toContain("status-tray");
		expect(MOBILE_JS).toContain("#charsheet-tabs a[href=\\\"#charsheet-tab-combat\\\"]");
		expect(MOBILE_JS).toContain("[data-charsheet-hp-intake-host=\\\"combat\\\"]");
	});
});

describe("HP outcome sentence formatter", () => {
	const outcome = ({intent = "damage", amount, current, temp = 0, max = 39, preview, after}) => {
		const page = makePage();
		return page._getHpOutcomePreview({
			intent,
			amount,
			hp: {current, temp, max},
			preview,
			after,
		}).text;
	};

	it.each([
		["normal damage", {amount: 12, current: 39, preview: {damage: 12}}, "39 → 27 HP"],
		["resistance", {amount: 12, current: 39, preview: {damage: 6, applied: "resistance"}}, "39 → 33 HP · resistance applied"],
		["immunity", {amount: 12, current: 39, preview: {damage: 0, applied: "immunity"}}, "39 → 39 HP · immune"],
		["vulnerability", {amount: 12, current: 39, preview: {damage: 24, applied: "vulnerability"}}, "39 → 15 HP · vulnerable (doubled)"],
		["flat reduction", {amount: 12, current: 39, preview: {damage: 8, reduction: 4}}, "39 → 31 HP · 4 damage reduced"],
		["combined reduction and resistance", {amount: 20, current: 39, preview: {damage: 8, reduction: 4, applied: "resistance"}}, "39 → 31 HP · 4 damage reduced · resistance applied"],
		["temp-only absorption", {amount: 12, current: 39, temp: 15, preview: {damage: 12}}, "39 HP + 15 temp → 39 HP + 3 temp · temp HP absorbed"],
		["split temp/current absorption", {amount: 12, current: 39, temp: 5, preview: {damage: 12}}, "39 HP + 5 temp → 32 HP · 5 temp absorbed"],
		["lethal damage", {amount: 30, current: 12, max: 39, preview: {damage: 30}}, "12 → 0 HP"],
		["healing", {intent: "heal", amount: 15, current: 24}, "24 → 39 HP"],
		["capped healing", {intent: "heal", amount: 15, current: 32}, "32 → 39 HP · capped at maximum"],
		["already full", {intent: "heal", amount: 15, current: 39}, "39 → 39 HP · already full"],
	])("%s", (_label, input, expected) => {
		expect(outcome(input)).toBe(expected);
	});
});

describe("One-shot HP undo", () => {
	it("restores exact current and temp HP after split damage, then clears itself", async () => {
		const state = new CharacterSheetState();
		state.setHp(30, 30, 5);
		const page = makePage(state);
		await page._pApplyDamage(12, {damageType: "fire"});
		expect(state.getHp()).toMatchObject({current: 23, temp: 0});
		expect(page._lastHpChange).toBeTruthy();
		expect(page._onUndoLastHpChange()).toBe(true);
		expect(state.getHp()).toMatchObject({current: 30, temp: 5});
		expect(page._onUndoLastHpChange()).toBe(false);
		expect(page._saveCurrentCharacter).toHaveBeenCalled();
		expect(page._renderHp).toHaveBeenCalled();
		expect(page._renderConditions).toHaveBeenCalled();
	});

	it("restores healing and creates no undo for an already-full heal", () => {
		const state = new CharacterSheetState();
		state.setHp(20, 30, 4);
		const page = makePage(state);
		page._damageIntakeAmount = 8;
		page._onHealIntakeApply();
		expect(state.getCurrentHp()).toBe(28);
		expect(page._onUndoLastHpChange()).toBe(true);
		expect(state.getHp()).toMatchObject({current: 20, temp: 4});

		state.setCurrentHp(30);
		page._damageIntakeAmount = 5;
		page._onHealIntakeApply();
		expect(page._lastHpChange).toBeNull();
	});

	it("overwrites the previous snapshot and clears it on manual reset", () => {
		const page = makePage();
		page._storeLastHpChange({
			kind: "damage",
			damageType: null,
			requestedAmount: 2,
			before: {currentHp: 20, tempHp: 0},
			after: {currentHp: 18, tempHp: 0},
		});
		const first = page._lastHpChange;
		page._storeLastHpChange({
			kind: "heal",
			damageType: null,
			requestedAmount: 4,
			before: {currentHp: 18, tempHp: 0},
			after: {currentHp: 22, tempHp: 0},
		});
		expect(page._lastHpChange).not.toBe(first);
		page._clearLastHpChange();
		expect(page._lastHpChange).toBeNull();
		expect(page._lastHpOutcome).toBeNull();
	});

	it("refuses to overwrite an intervening HP change with a stale snapshot", () => {
		const state = new CharacterSheetState();
		state.setHp(20, 30, 0);
		const page = makePage(state);
		page._storeLastHpChange({
			kind: "damage",
			damageType: null,
			requestedAmount: 5,
			before: {currentHp: 25, tempHp: 0},
			after: {currentHp: 20, tempHp: 0},
		});
		state.heal(3);
		page._renderDamageIntakes = jest.fn();
		expect(page._onUndoLastHpChange()).toBe(false);
		expect(state.getCurrentHp()).toBe(23);
		expect(page._lastHpChange).toBeNull();
		expect(page._renderDamageIntakes).toHaveBeenCalled();
	});
});

describe("Advanced magical-damage parity", () => {
	const makeHeavyArmorMaster = () => {
		const state = new CharacterSheetState();
		state.addClass({name: "Fighter", source: "PHB", level: 5});
		state._data.ac = {...(state._data.ac || {}), armor: {type: "heavy"}};
		state._processFeatRegistryEffects({name: "Heavy Armor Master", source: "PHB", id: "feat-ham"});
		state.setHp(30, 30, 0);
		return state;
	};

	it("ordinary inline damage is nonmagical, while Advanced can declare magical and bypass reduction", async () => {
		const state = makeHeavyArmorMaster();
		expect(state.hasNonmagicalDamageReduction()).toBe(true);
		const page = makePage(state);
		page._pApplyDamage = jest.fn(async (amount, opts = {}) => state.takeDamage(amount, opts));
		page._damageIntakeAmount = 10;
		page._lastDamageType = "slashing";
		await page._onDamageIntakeApply();
		expect(30 - state.getCurrentHp()).toBe(7);
		expect(page._pApplyDamage).toHaveBeenLastCalledWith(10, {damageType: "slashing"});

		state.setCurrentHp(30);
		page._damageIntakeAmount = 10;
		const originalPrompt = globalThis.InputUiUtil.pGetUserBoolean;
		globalThis.InputUiUtil.pGetUserBoolean = jest.fn(async () => true);
		try {
			await page._onAdvancedDamageIntakeApply();
		} finally {
			globalThis.InputUiUtil.pGetUserBoolean = originalPrompt;
		}
		expect(30 - state.getCurrentHp()).toBe(10);
		expect(page._pApplyDamage).toHaveBeenLastCalledWith(10, {
			damageType: "slashing",
			isMagicalDamage: true,
		});
	});
});
