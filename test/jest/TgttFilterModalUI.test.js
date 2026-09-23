import {jest} from "@jest/globals";
import fs from "node:fs";

import "../../js/tgtt-filter.js";

const FILTER_BOX_SOURCE = fs.readFileSync(new URL("../../js/filter/filter-box.js", import.meta.url), "utf8");

const mkModal = ({title, isFilterBoxModal = false}) => {
	const children = [];
	const scroller = {
		children,
		parentElement: {
			querySelector: selector => selector === "h4" ? {textContent: title} : null,
		},
		querySelector: () => null,
		appendChild: child => children.push(child),
		insertBefore: child => children.push(child),
	};

	return {title, isFilterBoxModal, scroller};
};

const getDocumentStub = modals => ({
	getElementById: () => null,
	querySelector: selector => selector === ".tgtt-filter-section"
		? modals.flatMap(it => it.scroller.children).find(it => it.className === "tgtt-filter-section") || null
		: null,
	querySelectorAll: selector => {
		if (selector === ".ve-ui-modal__scroller") return modals.map(it => it.scroller);
		if (selector === "[data-filter-box-modal]") return modals.filter(it => it.isFilterBoxModal).map(it => it.scroller);
		if (selector === ".tgtt-filter-pill" || selector === ".tgtt-duplicate") return [];
		return [];
	},
});

describe("TgttFilterModalUI", () => {
	let originalDocument;
	let originalStorageUtil;
	let originalUrlUtil;
	let originalWindow;

	beforeEach(() => {
		originalDocument = globalThis.document;
		originalStorageUtil = globalThis.StorageUtil;
		originalUrlUtil = globalThis.UrlUtil;
		originalWindow = globalThis.window;
	});

	afterEach(() => {
		globalThis.document = originalDocument;
		globalThis.StorageUtil = originalStorageUtil;
		globalThis.UrlUtil = originalUrlUtil;
		globalThis.window = originalWindow;
	});

	it("marks the production FilterBox scroller as the TGTT injection owner", () => {
		expect(FILTER_BOX_SOURCE).toMatch(/ve-ui-modal__scroller[^>]*data-filter-box-modal/);
	});

	it("discovers the main spells FilterBox modal rather than spell-selection or confirmation dialogs", () => {
		const mainFilterModal = mkModal({title: "Filters", isFilterBoxModal: true});
		const spellPickerModal = mkModal({title: "Filter/Search for Spells"});
		const attributionModal = mkModal({title: "Attribute Fireball"});
		const confirmationModal = mkModal({title: "Add Fireball?"});
		globalThis.document = getDocumentStub([
			mainFilterModal,
			spellPickerModal,
			attributionModal,
			confirmationModal,
		]);

		const ui = new TgttFilterModalUI({getFilterState: () => ({rarity: {}, legality: {}})});

		expect(ui._getSpellFilterModalScroller()).toBe(mainFilterModal.scroller);
	});

	it("injects rarity and legality controls only into the owned main-page filter modal", () => {
		const mainFilterModal = mkModal({title: "Filters", isFilterBoxModal: true});
		const spellPickerModal = mkModal({title: "Filter/Search for Spells"});
		const attributionModal = mkModal({title: "Attribute Fireball"});
		const confirmationModal = mkModal({title: "Add Fireball?"});
		globalThis.document = getDocumentStub([
			mainFilterModal,
			spellPickerModal,
			attributionModal,
			confirmationModal,
		]);
		globalThis.window = {location: {href: "http://localhost:5050/spells.html", pathname: "/spells.html"}};

		const ui = new TgttFilterModalUI({getFilterState: () => ({rarity: {}, legality: {}})});
		ui._createFilterSection = title => ({className: "tgtt-filter-section", title});
		ui._injectFilterUI();

		expect(mainFilterModal.scroller.children.map(it => it.title)).toEqual(["TGTT Rarity", "TGTT Legality"]);
		expect(spellPickerModal.scroller.children).toEqual([]);
		expect(attributionModal.scroller.children).toEqual([]);
		expect(confirmationModal.scroller.children).toEqual([]);
	});

	it("does not inject into a Character Sheet FilterBox modal", () => {
		const characterSheetFilterModal = mkModal({title: "Filters", isFilterBoxModal: true});
		globalThis.document = getDocumentStub([characterSheetFilterModal]);
		globalThis.window = {location: {href: "http://localhost:5050/charactersheet.html?return=spells.html", pathname: "/charactersheet.html"}};

		const ui = new TgttFilterModalUI({});
		ui._createFilterSection = title => ({className: "tgtt-filter-section", title});
		ui._injectFilterUI();

		expect(characterSheetFilterModal.scroller.children).toEqual([]);
	});

	it("persists filter state and updates the main spell-list CSS", () => {
		let savedState;
		globalThis.document = getDocumentStub([]);
		globalThis.window = {location: {href: "http://localhost:5050/spells.html", pathname: "/spells.html"}};
		globalThis.StorageUtil = {
			syncSetForPage: (_key, state) => { savedState = structuredClone(state); },
		};

		const filter = new TgttFilter();
		filter._dynamicStyleSheet = {textContent: ""};
		filter.setFilterState("rarity", "rare", "yes");

		expect(savedState.rarity.rare).toBe("yes");
		expect(filter._dynamicStyleSheet.textContent).toContain("[data-tgtt-rarity=\"rare\"]");
		expect(filter._dynamicStyleSheet.textContent).toContain("display: none !important");
	});

	it("cycles focused pills with Enter and Space", () => {
		const updates = [];
		const ui = new TgttFilterModalUI({
			setFilterState: (...args) => updates.push(args),
		});
		const pill = {dataset: {filterType: "rarity", filterKey: "rare", state: "ignore"}};
		const enterEvent = {
			key: "Enter",
			currentTarget: pill,
			preventDefault: jest.fn(),
		};

		ui._handlePillKeydown(enterEvent);
		expect(pill.dataset.state).toBe("yes");
		expect(updates).toEqual([["rarity", "rare", "yes"]]);
		expect(enterEvent.preventDefault).toHaveBeenCalled();

		const spaceEvent = {
			key: " ",
			currentTarget: pill,
			preventDefault: jest.fn(),
		};
		ui._handlePillKeydown(spaceEvent);
		expect(pill.dataset.state).toBe("no");
		expect(updates.at(-1)).toEqual(["rarity", "rare", "no"]);
		expect(spaceEvent.preventDefault).toHaveBeenCalled();
	});
});
