import {jest} from "@jest/globals";
import "./setup.js";

let CharacterSheetPage;
let elements;
let missingIds;

function makeElement () {
	const handlers = {};
	return {
		handlers,
		classList: {add: jest.fn()},
		setAttribute: jest.fn(),
		addEventListener: jest.fn((eventName, handler) => {
			handlers[eventName] = handler;
		}),
	};
}

function getElement (id) {
	if (missingIds.has(id)) return null;
	if (!elements.has(id)) elements.set(id, makeElement());
	return elements.get(id);
}

function makePage () {
	const page = Object.create(CharacterSheetPage.prototype);
	page._selCharacter = makeElement();
	page._state = {
		setMaxHpReduction: jest.fn(),
	};
	page._bindActivate = jest.fn();
	page._saveCurrentCharacter = jest.fn();
	page._renderHp = jest.fn();
	page._renderConditions = jest.fn();

	for (const method of [
		"_initThemePicker",
		"_initTextSizePicker",
		"_initFontPicker",
		"_initDicePicker",
		"_initRollboxDiceHook",
		"_initSecondaryHeader",
		"_initPortraitHandlers",
	]) page[method] = jest.fn();

	return page;
}

beforeAll(async () => {
	globalThis.window = {
		addEventListener: jest.fn(),
		dispatchEvent: jest.fn(),
		location: {search: ""},
		matchMedia: () => ({matches: false, addEventListener: jest.fn()}),
	};
	globalThis.document = {
		getElementById: (id) => getElement(id),
		querySelector: () => null,
		querySelectorAll: () => [],
		addEventListener: jest.fn(),
		body: {classList: {add: jest.fn(), remove: jest.fn()}},
	};

	await import("../../../js/charactersheet/charactersheet.js");
	CharacterSheetPage = globalThis.CharacterSheetPage;
});

beforeEach(() => {
	elements = new Map();
	missingIds = new Set();
});

describe("CharacterSheetPage listener initialization resilience", () => {
	test("skips a missing HP reduction input and continues binding later controls", () => {
		missingIds.add("charsheet-ipt-hp-max-reduction");
		const page = makePage();

		expect(() => page._initEventListeners()).not.toThrow();
		expect(getElement("charsheet-edit-masteries").addEventListener).toHaveBeenCalledWith("click", expect.any(Function));

		const clearButton = getElement("charsheet-btn-hp-max-reduction-clear");
		expect(() => clearButton.handlers.click()).not.toThrow();
		expect(page._state.setMaxHpReduction).toHaveBeenCalledWith(0);
	});

	test("does not activate a missing combat box and still binds later controls", () => {
		missingIds.add("charsheet-box-ac");
		const page = makePage();

		expect(() => page._initEventListeners()).not.toThrow();
		expect(page._bindActivate).not.toHaveBeenCalledWith(null, expect.anything());
		expect(page._bindActivate).toHaveBeenCalledTimes(3);
		expect(getElement("charsheet-edit-masteries").addEventListener).toHaveBeenCalledWith("click", expect.any(Function));
	});
});
