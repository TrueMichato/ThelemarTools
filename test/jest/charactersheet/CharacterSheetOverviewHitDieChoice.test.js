import {jest} from "@jest/globals";

import "./setup.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-progression.js";
import "../../../js/charactersheet/charactersheet-state.js";

const CharacterSheetState = globalThis.CharacterSheetState;
let CharacterSheetPage;

beforeAll(async () => {
	globalThis.window ||= {addEventListener: () => {}};
	await import("../../../js/charactersheet/charactersheet.js");
	CharacterSheetPage = globalThis.CharacterSheetPage;
});

const makeOverview = () => {
	const state = new CharacterSheetState();
	state.addClass({name: "Ranger", source: "PHB", level: 2});
	state.addClass({name: "Druid", source: "PHB", level: 1});
	state.setAbilityBase("con", 14);
	state.setMaxHp(40);
	state.setCurrentHp(1);
	const page = Object.create(CharacterSheetPage.prototype);
	Object.assign(page, {
		_state: state,
		_saveCurrentCharacter: jest.fn(),
		_renderHp: jest.fn(),
		_renderHitDice: jest.fn(),
		_renderConditions: jest.fn(),
		_showDiceResult: jest.fn(),
	});
	return {page, state};
};

describe("Overview Use Hit Die multiclass choice", () => {
	const originalPicker = globalThis.InputUiUtil.pGetUserEnum;
	const originalRoller = globalThis.RollerUtil.randomise;
	const originalToast = globalThis.JqueryUtil.doToast;
	afterEach(() => {
		globalThis.InputUiUtil.pGetUserEnum = originalPicker;
		globalThis.RollerUtil.randomise = originalRoller;
		globalThis.JqueryUtil.doToast = originalToast;
	});

	it("advertises the choice on Overview and disables Use Hit Die when none remain", () => {
		const {page, state} = makeOverview();
		const originalDocument = globalThis.document;
		const container = globalThis.e_({tag: "div"});
		const button = {disabled: false, title: ""};
		globalThis.document = {getElementById: id => ({
			"charsheet-hitdice-pools": container,
			"charsheet-btn-use-hitdie": button,
		})[id]};
		try {
			page._renderHitDice = CharacterSheetPage.prototype._renderHitDice;
			page._renderHitDice();
			expect(container.children).toHaveLength(2);
			expect(button.title).toContain("Choose a Hit Die");
			expect(button.disabled).toBe(false);
			state.adjustHitDieCurrent("d10", -2);
			page._renderHitDice();
			expect(button.title).toContain("Spend an available Hit Die");
			state.adjustHitDieCurrent("d8", -1);
			page._renderHitDice();
			expect(button.disabled).toBe(true);
		} finally {
			globalThis.document = originalDocument;
		}
	});

	it("lets Ranger/Druid choose d8 before d10, then spend the d10 independently", async () => {
		const {page, state} = makeOverview();
		const pick = jest.fn(async ({values}) => values.find(value => value.includes("d8")));
		globalThis.InputUiUtil.pGetUserEnum = pick;
		globalThis.RollerUtil.randomise = jest.fn(() => 4);

		await page._onUseHitDie({shiftKey: false});
		expect(pick).toHaveBeenCalledWith(expect.objectContaining({
			title: expect.stringContaining("Hit Die"),
			values: expect.arrayContaining(["Ranger d10 (2 remaining)", "Druid d8 (1 remaining)"]),
			isResolveItem: true,
		}));
		expect(state.getHitDiceByType().d8.current).toBe(0);
		expect(state.getHitDiceByType().d10.current).toBe(2);
		expect(state.getCurrentHp()).toBe(7); // roll 4 + CON 2 exactly once
		expect(page._showDiceResult).toHaveBeenCalledWith("Hit Die", 6, expect.stringContaining("1d8"));

		await page._onUseHitDie({shiftKey: false});
		expect(pick).toHaveBeenCalledTimes(1); // only one spendable pool remains
		expect(state.getHitDiceByType().d10.current).toBe(1);
		expect(state.getCurrentHp()).toBe(13);
		expect(page._saveCurrentCharacter).toHaveBeenCalledTimes(2);
		expect(page._renderHitDice).toHaveBeenCalledTimes(2);
	});

	it("also permits choosing d10 while d8 is available, without touching the Druid pool", async () => {
		const {page, state} = makeOverview();
		globalThis.InputUiUtil.pGetUserEnum = jest.fn(async ({values}) => values.find(value => value.includes("d10")));
		globalThis.RollerUtil.randomise = jest.fn(() => 5);
		await page._onUseHitDie();
		expect(state.getHitDiceByType().d10.current).toBe(1);
		expect(state.getHitDiceByType().d8.current).toBe(1);
		expect(state.getCurrentHp()).toBe(8);
	});

	it("cancels without consuming either pool, healing, rolling, or saving", async () => {
		const {page, state} = makeOverview();
		globalThis.InputUiUtil.pGetUserEnum = jest.fn(async () => null);
		globalThis.RollerUtil.randomise = jest.fn();
		await page._onUseHitDie();
		expect(state.getHitDiceByType().d10.current).toBe(2);
		expect(state.getHitDiceByType().d8.current).toBe(1);
		expect(state.getCurrentHp()).toBe(1);
		expect(globalThis.RollerUtil.randomise).not.toHaveBeenCalled();
		expect(page._saveCurrentCharacter).not.toHaveBeenCalled();
	});

	it("refuses a pool spent while the choice is open rather than substituting another die", async () => {
		const {page, state} = makeOverview();
		const toast = jest.fn();
		globalThis.JqueryUtil.doToast = toast;
		globalThis.InputUiUtil.pGetUserEnum = jest.fn(async ({values}) => {
			state.adjustHitDieCurrent("d8", -1);
			return values.find(value => value.includes("d8"));
		});
		globalThis.RollerUtil.randomise = jest.fn();
		await page._onUseHitDie();
		expect(state.getHitDiceByType().d10.current).toBe(2);
		expect(state.getCurrentHp()).toBe(1);
		expect(page._saveCurrentCharacter).not.toHaveBeenCalled();
		expect(toast).toHaveBeenCalledWith(expect.objectContaining({type: "warning"}));
	});

	it("shift-click uses the selected die's maximum face and heals only once", async () => {
		const {page, state} = makeOverview();
		globalThis.InputUiUtil.pGetUserEnum = jest.fn(async ({values}) => values.find(value => value.includes("d8")));
		globalThis.RollerUtil.randomise = jest.fn();
		await page._onUseHitDie({shiftKey: true});
		expect(globalThis.RollerUtil.randomise).not.toHaveBeenCalled();
		expect(state.getHitDiceByType().d8.current).toBe(0);
		expect(state.getHitDiceByType().d10.current).toBe(2);
		expect(state.getCurrentHp()).toBe(11); // max d8 (8) + CON 2
		expect(page._showDiceResult).toHaveBeenCalledWith("Hit Die", 10, expect.stringContaining("1d8 (max)"));
		expect(page._renderHp).toHaveBeenCalledTimes(1);
		expect(page._renderConditions).toHaveBeenCalledTimes(1);
	});

	it("caps healing at maximum HP while still spending exactly one selected die", async () => {
		const {page, state} = makeOverview();
		state.setCurrentHp(39);
		globalThis.InputUiUtil.pGetUserEnum = jest.fn(async ({values}) => values.find(value => value.includes("d8")));
		await page._onUseHitDie({shiftKey: true});
		expect(state.getCurrentHp()).toBe(40);
		expect(state.getHitDiceByType().d8.current).toBe(0);
		expect(state.getHitDiceByType().d10.current).toBe(2);
		expect(page._saveCurrentCharacter).toHaveBeenCalledTimes(1);
	});
});
