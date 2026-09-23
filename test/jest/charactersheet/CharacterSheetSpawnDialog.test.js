import {afterAll, beforeAll, beforeEach, describe, expect, test} from "@jest/globals";
import "./setup.js";
import "../../../js/utils.js";
import {findElements, installElementUtilTestDom} from "../helpers/element-util-test-dom.js";

let CharacterSheetPage;
let dom;
let modalInner;
let originalGetShowModal;
let originalSortUtil;
let originalWindow;
let originalLocation;

beforeAll(async () => {
	originalWindow = globalThis.window;
	originalLocation = globalThis.location;
	originalSortUtil = globalThis.SortUtil;
	originalGetShowModal = globalThis.UiUtil.getShowModal;

	globalThis.window = {
		addEventListener: () => {},
		dispatchEvent: () => {},
		location: {search: ""},
		matchMedia: () => ({matches: false, addEventListener: () => {}}),
	};
	globalThis.location = {origin: "https://example.com", pathname: "/charactersheet.html"};
	globalThis.SortUtil = {ascSortLower: (a, b) => String(a).localeCompare(String(b), undefined, {sensitivity: "base"})};
	dom = installElementUtilTestDom();

	const mod = await import("../../../js/charactersheet/charactersheet.js");
	CharacterSheetPage = mod.CharacterSheetPage;
});

afterAll(() => {
	globalThis.UiUtil.getShowModal = originalGetShowModal;
	dom.restore();
	if (originalSortUtil === undefined) delete globalThis.SortUtil;
	else globalThis.SortUtil = originalSortUtil;
	if (originalLocation === undefined) delete globalThis.location;
	else globalThis.location = originalLocation;
	if (originalWindow === undefined) delete globalThis.window;
	else globalThis.window = originalWindow;
});

beforeEach(() => {
	modalInner = dom.e_({tag: "div"});
	globalThis.UiUtil.getShowModal = () => ({
		eleModalInner: modalInner,
		doClose: () => {},
	});
});

describe("Character Spawn dialog labels", () => {
	test("builds visible, focusable button labels through the real ElementUtil contract", async () => {
		const page = Object.create(CharacterSheetPage.prototype);
		page._classes = [{name: "Fighter", subclasses: []}];
		page._races = [];
		page.filterByAllowedSources = entries => entries;
		page.getBackgrounds = () => [];

		await page._pOpenSpawnDialog();

		const buttons = findElements(modalInner, element => element.tagName === "BUTTON");
		expect(buttons.map(button => button.textContent.trim())).toEqual([
			"🎲 Randomise",
			"🔗 Copy URL",
			"📋 Copy spec",
			"⚡ Spawn",
		]);
		buttons.forEach(button => {
			expect(button.textContent.trim()).not.toBe("");
			expect(button.classList.contains("ve-btn-sm")).toBe(true);
			expect(button.tabIndex).not.toBe(-1);
			expect(button._listeners.click).toHaveLength(1);
		});
	});
});
