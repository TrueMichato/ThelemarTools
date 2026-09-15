import {jest} from "@jest/globals";
import "./setup.js";
import {readFileSync} from "fs";
import {resolve, dirname} from "path";
import {fileURLToPath} from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..", "..");
const CONTROLLER_SRC = readFileSync(resolve(REPO_ROOT, "js/charactersheet/charactersheet.js"), "utf8");

const TAB_IDS = [
	"#charsheet-tab-overview",
	"#charsheet-tab-combat",
	"#charsheet-tab-builder",
];

let CharacterSheetPage;
let storage;
let tabDom;

function makeClassList (initial = []) {
	const values = new Set(initial);
	return {
		add: (...classes) => classes.forEach(it => values.add(it)),
		remove: (...classes) => classes.forEach(it => values.delete(it)),
		contains: (clazz) => values.has(clazz),
	};
}

function makeTabDom ({hiddenTabIds = []} = {}) {
	const links = new Map();
	const panes = new Map();
	const lis = [];

	TAB_IDS.forEach((tabId, index) => {
		const li = {
			classList: makeClassList([
				...(index === 0 ? ["ve-active"] : []),
				...(hiddenTabIds.includes(tabId) ? ["ve-hidden"] : []),
			]),
		};
		const handlers = {};
		const link = {
			parentElement: li,
			getAttribute: (name) => name === "href" ? tabId : null,
			addEventListener: (eventName, handler) => { handlers[eventName] = handler; },
			click: () => handlers.click?.({preventDefault: jest.fn(), currentTarget: link}),
			handlers,
		};
		const pane = {
			classList: makeClassList(index === 0 ? ["ve-active", "in"] : []),
			style: {display: index === 0 ? "" : "none"},
		};

		li.link = link;
		lis.push(li);
		links.set(tabId, link);
		panes.set(tabId, pane);
	});

	const tabs = {
		querySelectorAll: (selector) => {
			if (selector === "a[data-toggle=\"tab\"]") return [...links.values()];
			if (selector === "li") return lis;
			return [];
		},
		querySelector: (selector) => {
			const match = selector.match(/^a\[href="(.+)"\]$/);
			return match ? links.get(match[1]) || null : null;
		},
	};
	const tabContent = {
		querySelectorAll: (selector) => selector === ".tab-pane" ? [...panes.values()] : [],
	};

	return {
		document: {
			getElementById: (id) => id === "charsheet-tabs" ? tabs : null,
			querySelector: (selector) => {
				if (selector === ".tab-content") return tabContent;
				if (panes.has(selector)) return panes.get(selector);
				return null;
			},
		},
		links,
		panes,
	};
}

function makePage () {
	const page = Object.create(CharacterSheetPage.prototype);
	page._updateAbilitiesTabVisibility = jest.fn();
	return page;
}

function installTabDom (opts) {
	tabDom = makeTabDom(opts);
	globalThis.document.getElementById = tabDom.document.getElementById;
	globalThis.document.querySelector = tabDom.document.querySelector;
	return tabDom;
}

beforeAll(async () => {
	globalThis.window = {
		addEventListener: jest.fn(),
		dispatchEvent: jest.fn(),
		location: {search: ""},
		matchMedia: () => ({matches: false, addEventListener: jest.fn()}),
	};
	globalThis.document = {
		getElementById: () => null,
		querySelector: () => null,
		querySelectorAll: () => [],
		addEventListener: jest.fn(),
		body: {classList: {add: jest.fn(), remove: jest.fn()}},
	};

	await import("../../../js/charactersheet/charactersheet.js");
	CharacterSheetPage = globalThis.CharacterSheetPage;
});

beforeEach(() => {
	storage = new Map();
	globalThis.StorageUtil.syncGetForPage = jest.fn((key) => storage.get(key) ?? null);
	globalThis.StorageUtil.syncSetForPage = jest.fn((key, value) => storage.set(key, value));
	installTabDom();
});

describe("Character Sheet active-tab persistence", () => {
	test("restores the clicked tab after recreating the page controller", () => {
		const firstPage = makePage();
		firstPage._initTabs();
		tabDom.links.get("#charsheet-tab-combat").click();

		expect(globalThis.StorageUtil.syncSetForPage).toHaveBeenLastCalledWith(
			CharacterSheetPage._STORAGE_KEY_ACTIVE_TAB,
			"#charsheet-tab-combat",
		);

		installTabDom();

		const reloadedPage = makePage();
		reloadedPage._restoreActiveTab();

		expect(tabDom.links.get("#charsheet-tab-combat").parentElement.classList.contains("ve-active")).toBe(true);
		expect(tabDom.panes.get("#charsheet-tab-combat").classList.contains("ve-active")).toBe(true);
		expect(tabDom.panes.get("#charsheet-tab-combat").style.display).toBe("");
	});

	test("programmatic tab switches use the same persistence and display path", () => {
		const page = makePage();

		expect(page.switchToTab("#charsheet-tab-combat")).toBe(true);

		expect(globalThis.StorageUtil.syncSetForPage).toHaveBeenCalledWith(
			CharacterSheetPage._STORAGE_KEY_ACTIVE_TAB,
			"#charsheet-tab-combat",
		);
		expect(tabDom.panes.get("#charsheet-tab-overview").style.display).toBe("none");
		expect(tabDom.panes.get("#charsheet-tab-combat").style.display).toBe("");
	});

	test("falls back to Overview and replaces a saved tab which is hidden", () => {
		storage.set(CharacterSheetPage._STORAGE_KEY_ACTIVE_TAB, "#charsheet-tab-builder");
		installTabDom({hiddenTabIds: ["#charsheet-tab-builder"]});

		const restored = makePage()._restoreActiveTab();

		expect(restored).toBe("#charsheet-tab-overview");
		expect(tabDom.links.get("#charsheet-tab-overview").parentElement.classList.contains("ve-active")).toBe(true);
		expect(storage.get(CharacterSheetPage._STORAGE_KEY_ACTIVE_TAB)).toBe("#charsheet-tab-overview");
	});

	test.each([
		["missing", "#charsheet-tab-does-not-exist"],
		["malformed", "combat"],
	])("falls back to Overview for a %s saved tab", (_label, savedTabId) => {
		storage.set(CharacterSheetPage._STORAGE_KEY_ACTIVE_TAB, savedTabId);

		expect(makePage()._restoreActiveTab()).toBe("#charsheet-tab-overview");
		expect(tabDom.panes.get("#charsheet-tab-overview").classList.contains("ve-active")).toBe(true);
		expect(storage.get(CharacterSheetPage._STORAGE_KEY_ACTIVE_TAB)).toBe("#charsheet-tab-overview");
	});

	test("storage read failures do not prevent Overview from activating", () => {
		const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
		globalThis.StorageUtil.syncGetForPage = jest.fn(() => { throw new Error("storage unavailable"); });

		try {
			expect(makePage()._restoreActiveTab()).toBe("#charsheet-tab-overview");
			expect(tabDom.panes.get("#charsheet-tab-overview").classList.contains("ve-active")).toBe(true);
			expect(warn).toHaveBeenCalledWith(
				"[CharSheet] Failed to restore active tab:",
				expect.any(Error),
			);
		} finally {
			warn.mockRestore();
		}
	});

	test("storage write failures do not prevent a requested tab from activating", () => {
		const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
		globalThis.StorageUtil.syncSetForPage = jest.fn(() => { throw new Error("quota exceeded"); });

		try {
			expect(makePage().switchToTab("#charsheet-tab-combat")).toBe(true);
			expect(tabDom.panes.get("#charsheet-tab-combat").classList.contains("ve-active")).toBe(true);
			expect(warn).toHaveBeenCalledWith(
				"[CharSheet] Failed to persist active tab:",
				expect.any(Error),
			);
		} finally {
			warn.mockRestore();
		}
	});

	test("restoration is wired after character and spawn loading", () => {
		const initHead = CONTROLLER_SRC.match(/async pInit \(\)\s*\{[\s\S]*?this\._applyBackgroundTheme/);
		expect(initHead).not.toBeNull();

		const source = initHead[0];
		expect(source.indexOf("await this._pHandleSpawnUrl(urlParams)")).toBeLessThan(source.indexOf("this._updateTabVisibility()"));
		expect(source.indexOf("this._updateTabVisibility()")).toBeLessThan(source.indexOf("this._restoreActiveTab()"));
	});
});
