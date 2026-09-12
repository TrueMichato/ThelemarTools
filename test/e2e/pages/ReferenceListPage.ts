import {expect, type Locator, type Page} from "@playwright/test";

interface BrowserListItem {
	ix: number;
	name: string;
	isSelected: boolean;
	data: {
		hash?: string;
		hashCurr?: string;
		isPreviewExpanded?: boolean;
	};
	peekEle (): HTMLElement | null;
}

interface BrowserVirtualRenderer {
	_width: number;
	invalidateMeasurements (): void;
}

interface BrowserList {
	items: BrowserListItem[];
	visibleItems: BrowserListItem[];
	renderedItems: BrowserListItem[];
	isVirtualRendering: boolean;
	sortBy: string;
	sortDir: string;
	_wrpList: HTMLElement;
	_virtualRenderer: BrowserVirtualRenderer | null;
	_searchTerm: string;
	addItem (item: BrowserListItem): void;
	init (): void;
	search (term: string): void;
	destroy (): void;
	scrollToItem (item: BrowserListItem, options?: {isFocus?: boolean; align?: "nearest" | "start"}): boolean;
	setRenderingMode (options: {isRenderAll: boolean}): void;
	refreshRenderedItems (): void;
	on (event: "updated", callback: () => void): void;
}

interface BrowserListConstructor {
	new (options: {wrpList: HTMLElement; isVirtual?: boolean; fnSort?: null}): BrowserList;
	getCleanSearchTerm (term: string): string;
}

interface BrowserListItemConstructor {
	new (ix: number, element: HTMLElement | (() => HTMLElement), name: string, values: Record<string, unknown>): BrowserListItem;
}

interface BrowserEntity {
	__prop?: string;
	source?: string;
}

interface BrowserSource {
	source: string;
	loaded: boolean;
}

interface BrowserListPage {
	primaryLists: BrowserList[];
	_dataList: (BrowserEntity | undefined)[];
	_loadedSources?: Record<string, BrowserSource | undefined>;
	_pageFilter?: {
		sourceFilter?: {
			_state: Partial<Record<string, number>>;
		};
	};
}

interface BrowserHist {
	_listPage: BrowserListPage | null;
	getSelectedListItem (): BrowserListItem | null | undefined;
}

interface BrowserParser {
	sourceJsonToFull (source: string): string;
	sourceJsonToAbv (source: string): string;
}

interface BrowserTallAnchorFixture {
	root: HTMLDivElement;
	list: BrowserList;
	target: BrowserListItem;
}

type ReferenceBrowserGlobal = typeof globalThis & {
	Hist?: BrowserHist;
	List?: BrowserListConstructor;
	ListItem?: BrowserListItemConstructor;
	Parser?: BrowserParser;
	__referenceToolsLoaded?: boolean;
	__referenceLogicalUpdates?: number;
	__referenceTallAnchorFixture?: BrowserTallAnchorFixture;
};

export const REFERENCE_LIST_PAGES = [
	"actions", "backgrounds", "bastions", "bestiary", "charcreationoptions", "combatmethods",
	"conditionsdiseases", "crafting", "cultsboons", "decks", "deities", "feats", "homecrafts",
	"items", "itemupgrades", "languages", "objects", "optionalfeatures", "psionics", "races",
	"recipes", "rewards", "spells", "tables", "trapshazards", "variantrules", "vehicles",
] as const;

export const EXCLUDED_REFERENCE_LIST_PAGES = ["classes", "names", "encountergen"] as const;
export type ReferencePageName = typeof REFERENCE_LIST_PAGES[number] | typeof EXCLUDED_REFERENCE_LIST_PAGES[number];

export interface ReferenceRow {
	listIndex: number;
	ix: number;
	name: string;
	source: string;
	hash: string;
}

export interface ReferenceListSnapshot {
	logical: string[];
	matching: string[];
	mounted: string[];
	domIdentities: string[];
	selected: string[];
	materialized: number;
	domRows: number;
	wrapperChildren: number;
	isVirtual: boolean;
	hasVirtualRenderer: boolean;
	sortBy: string;
	sortDir: string;
	expanded: number;
	previewBodies: number;
}

export class ReferenceListPage {
	static readonly VIRTUAL_THRESHOLD = 200;
	static readonly MAX_MOUNTED = 200;

	private readonly _errors: string[] = [];
	private _isInitialized = false;
	private _pageName?: ReferencePageName;

	constructor (readonly page: Page) {
		page.on("pageerror", error => this._errors.push(error.message));
		page.on("response", response => {
			if (response.status() < 400 || !/\/(?:data|homebrew)\/.*\.json(?:\?|$)/.test(response.url())) return;
			this._errors.push(`Data response ${response.status()}: ${response.url()}`);
		});
		page.on("requestfailed", request => {
			if (!/\/(?:data|homebrew)\/.*\.json(?:\?|$)/.test(request.url())) return;
			if (request.failure()?.errorText === "net::ERR_ABORTED") return;
			this._errors.push(`Data request failed: ${request.url()} (${request.failure()?.errorText})`);
		});
	}

	async goto (pageName: ReferencePageName, hash = ""): Promise<void> {
		if (!this._isInitialized) {
			await this.page.addInitScript(() => {
				const browser = globalThis as ReferenceBrowserGlobal;
				browser.__referenceToolsLoaded = false;
				window.addEventListener("toolsLoaded", () => {
					browser.__referenceToolsLoaded = true;
				}, {once: true});
			});
			this._isInitialized = true;
		}
		this._pageName = pageName;
		await this.page.goto(`/${pageName}.html${hash ? `#${hash}` : ""}`, {waitUntil: "domcontentloaded"});
		await this.waitForReady();
	}

	async waitForReady (): Promise<void> {
		await this.page.waitForFunction(() => {
			const browser = globalThis as ReferenceBrowserGlobal;
			const lists = browser.Hist?._listPage?.primaryLists;
			return browser.__referenceToolsLoaded
				&& lists != null && lists.length > 0
				&& lists.every(list => Array.isArray(list.items) && Array.isArray(list.visibleItems));
		}, null, {timeout: 90_000});
		await this.settleRendering();
		await expect(this.page.locator("#lst__search")).toBeVisible();
	}

	async reload (): Promise<void> {
		await this.page.reload({waitUntil: "domcontentloaded"});
		await this.waitForReady();
	}

	async settleRendering (): Promise<void> {
		await this.page.evaluate(() => new Promise<void>(resolve => {
			requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
		}));
	}

	async snapshots (): Promise<ReferenceListSnapshot[]> {
		return this.page.evaluate(() => {
			const listPage = (globalThis as ReferenceBrowserGlobal).Hist?._listPage;
			if (!listPage) throw new Error("Reference list page is not ready");
			return listPage.primaryLists.map(list => {
				const identity = (item: BrowserListItem) => {
					const entity = listPage._dataList[item.ix];
					// The index and page-specific hash distinguish multi-prop entities and same-name reprints.
					return JSON.stringify([item.ix, entity?.__prop, item.name, entity?.source, item.data.hashCurr ?? item.data.hash]);
				};
				const wrapper = list._wrpList;
				const elements: HTMLElement[] = [];
				const identityByElement = new Map<Element, string>();
				for (const item of list.items) {
					const element = item.peekEle();
					if (!element) continue;
					elements.push(element);
					identityByElement.set(element, identity(item));
				}
				return {
					logical: list.items.map(identity),
					matching: list.visibleItems.map(identity),
					mounted: list.renderedItems.map(identity),
					domIdentities: [...wrapper.querySelectorAll(":scope > .ve-lst__row")].map(element => identityByElement.get(element) ?? "UNKNOWN DOM ROW"),
					selected: list.items.filter(item => item.isSelected).map(identity),
					materialized: elements.length,
					domRows: wrapper.querySelectorAll(":scope > .ve-lst__row").length,
					wrapperChildren: wrapper.children.length,
					isVirtual: list.isVirtualRendering,
					hasVirtualRenderer: list._virtualRenderer != null,
					sortBy: list.sortBy,
					sortDir: list.sortDir,
					expanded: list.visibleItems.filter(item => item.data.isPreviewExpanded).length,
					previewBodies: elements.filter(element => element.querySelector(".ve-accordion__wrp-preview-inner")?.childElementCount).length,
				};
			});
		});
	}

	async assertLoaded (minimumTotal = 1): Promise<void> {
		const snapshots = await this.snapshots();
		if (this._pageName === "names" || this._pageName === "encountergen") expect(snapshots.length).toBeGreaterThan(1);
		else expect(snapshots).toHaveLength(this._pageName === "items" ? 2 : 1);
		expect(snapshots.reduce((total, list) => total + list.logical.length, 0)).toBeGreaterThanOrEqual(minimumTotal);
		expect(snapshots.reduce((total, list) => total + list.matching.length, 0)).toBeGreaterThan(0);
		for (const list of snapshots) {
			expect(new Set(list.logical).size, "logical rows must not be duplicated").toBe(list.logical.length);
			expect(list.matching.every(identity => list.logical.includes(identity))).toBe(true);
		}
		if (this._pageName !== "items") {
			const coverage = await this.page.evaluate(() => {
				const listPage = (globalThis as ReferenceBrowserGlobal).Hist?._listPage;
				if (!listPage) throw new Error("Reference list page is not ready");
				const indices = new Set(listPage.primaryLists.flatMap(list => list.items.map(item => item.ix)));
				return {logicalEntities: indices.size, loadedEntities: listPage._dataList.length};
			});
			expect(coverage.logicalEntities, "every loaded reference entity must retain a logical row").toBe(coverage.loadedEntities);
		}
	}

	async assertLegacyRendering (): Promise<void> {
		for (const list of await this.snapshots()) {
			expect(list.hasVirtualRenderer, "excluded lists must not allocate a virtual renderer, even below its threshold").toBe(false);
			expect(list.isVirtual).toBe(false);
			expect(list.mounted).toEqual(list.matching);
			expect(list.domIdentities).toEqual(list.matching);
			expect(list.domRows).toBe(list.matching.length);
			expect(list.wrapperChildren).toBe(list.domRows);
		}
	}

	async assertPlainListDefaultsToLegacy (): Promise<void> {
		const result = await this.page.evaluate(() => {
			const {List, ListItem} = globalThis as ReferenceBrowserGlobal;
			if (!List || !ListItem) throw new Error("List constructors are not loaded");
			const wrapper = document.createElement("div");
			document.body.append(wrapper);
			const list = new List({wrpList: wrapper});
			try {
				for (let i = 0; i < 512; ++i) {
					const row = document.createElement("div");
					row.textContent = `Fixture ${i}`;
					list.addItem(new ListItem(i, row, row.textContent, {}));
				}
				list.init();
				const initial = {
					hasVirtualRenderer: list._virtualRenderer != null,
					isVirtual: list.isVirtualRendering,
					loaded: list.items.length,
					matching: list.visibleItems.length,
					mounted: list.renderedItems.length,
					domRows: wrapper.children.length,
				};
				list.search("fixture 42");
				const filtered = {loaded: list.items.length, matching: list.visibleItems.length, domRows: wrapper.children.length};
				list.search("");
				return {initial, filtered, restored: list.visibleItems.length, restoredDom: wrapper.children.length};
			} finally {
				list.destroy();
				wrapper.remove();
			}
		});
		expect(result.initial).toEqual({hasVirtualRenderer: false, isVirtual: false, loaded: 512, matching: 512, mounted: 512, domRows: 512});
		expect(result.filtered).toEqual({loaded: 512, matching: 11, domRows: 11});
		expect(result.restored).toBe(512);
		expect(result.restoredDom).toBe(512);
	}

	async mountTallAnchorFixture (): Promise<void> {
		await this.page.evaluate(async () => {
			const browser = globalThis as ReferenceBrowserGlobal;
			const {List, ListItem} = browser;
			if (!List || !ListItem) throw new Error("List constructors are not loaded");
			const root = document.createElement("div");
			root.id = "reference-tall-anchor-fixture";
			root.style.cssText = "position:fixed;top:0;left:0;width:480px;height:240px;overflow:auto;z-index:10000;background:white;padding:0;border:0";
			document.body.append(root);
			const list = new List({wrpList: root, isVirtual: true, fnSort: null});
			for (let i = 0; i < 512; ++i) {
				list.addItem(new ListItem(i, () => {
					const row = document.createElement("div");
					row.style.cssText = `height:${i === 73 ? 900 : 20}px;box-sizing:border-box;padding:0;margin:0;border:0`;
					row.textContent = `Layout fixture row ${i}`;
					return row;
				}, `Layout fixture row ${i}`, {}));
			}
			const target = list.items[73];
			if (!target) throw new Error("Tall anchor fixture row was not created");
			browser.__referenceTallAnchorFixture = {root, list, target};
			list.init();
			await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
			list.scrollToItem(target, {align: "start"});
			root.scrollTop += 500;
			list.refreshRenderedItems();
		});
		await this.settleRendering();
	}

	async assertTallAnchorFixtureStable (): Promise<void> {
		await expect.poll(() => this.page.evaluate(() => {
			const fixture = (globalThis as ReferenceBrowserGlobal).__referenceTallAnchorFixture;
			if (!fixture) throw new Error("Tall anchor fixture is not mounted");
			const {root, list, target} = fixture;
			const element = target.peekEle();
			return {
				mounted: list.renderedItems.includes(target) && !!element?.isConnected,
				virtual: list.isVirtualRendering,
				top: element ? Math.round(element.getBoundingClientRect().top - root.getBoundingClientRect().top) : null,
				height: element?.getBoundingClientRect().height ?? null,
				overflowAnchor: getComputedStyle(root).overflowAnchor,
			};
		}), {message: "the viewport must remain 500px inside the same 900px row"}).toEqual({
			mounted: true,
			virtual: true,
			top: -500,
			height: 900,
			overflowAnchor: "none",
		});
	}

	async invalidateTallAnchorFixture (): Promise<void> {
		await this.page.evaluate(() => {
			const fixture = (globalThis as ReferenceBrowserGlobal).__referenceTallAnchorFixture;
			if (!fixture) throw new Error("Tall anchor fixture is not mounted");
			if (!fixture.list._virtualRenderer) throw new Error("Tall anchor fixture has no virtual renderer");
			fixture.list._virtualRenderer.invalidateMeasurements();
		});
		await this.settleRendering();
	}

	async resizeTallAnchorFixtureRoot (): Promise<void> {
		await this.page.evaluate(() => {
			const fixture = (globalThis as ReferenceBrowserGlobal).__referenceTallAnchorFixture;
			if (!fixture) throw new Error("Tall anchor fixture is not mounted");
			const {root} = fixture;
			root.style.width = "360px";
			root.style.height = "200px";
		});
		await this.page.waitForFunction(() => {
			const fixture = (globalThis as ReferenceBrowserGlobal).__referenceTallAnchorFixture;
			if (!fixture) throw new Error("Tall anchor fixture is not mounted");
			if (!fixture.list._virtualRenderer) throw new Error("Tall anchor fixture has no virtual renderer");
			return fixture.list._virtualRenderer._width === 360;
		});
		await this.settleRendering();
	}

	async removeTallAnchorFixture (): Promise<void> {
		await this.page.evaluate(() => {
			const browser = globalThis as ReferenceBrowserGlobal;
			const fixture = browser.__referenceTallAnchorFixture;
			if (!fixture) return;
			fixture.list.destroy();
			fixture.root.remove();
			delete browser.__referenceTallAnchorFixture;
		});
	}

	async assertAutomaticBounds ({isInitial = false} = {}): Promise<void> {
		await expect.poll(async () => {
			const lists = await this.snapshots();
			return lists.every(list => list.isVirtual === (list.matching.length > ReferenceListPage.VIRTUAL_THRESHOLD)
				&& list.mounted.length === list.domRows
				&& JSON.stringify(list.mounted) === JSON.stringify(list.domIdentities)
				&& list.wrapperChildren <= list.domRows + 4
				&& list.materialized <= Math.max(ReferenceListPage.VIRTUAL_THRESHOLD, list.mounted.length * 2)
				&& (list.isVirtual ? list.mounted.length <= ReferenceListPage.MAX_MOUNTED : list.mounted.length === list.matching.length));
		}, {message: "automatic rendering must bound mounted rows without truncating logical matches"}).toBe(true);
		if (isInitial) {
			for (const list of await this.snapshots()) {
				const cacheBudget = Math.max(ReferenceListPage.VIRTUAL_THRESHOLD, list.mounted.length * 2);
				if (list.logical.length <= cacheBudget) continue;
				expect(list.materialized, "initial row creation must be lazy, including filtered-out entities").toBeLessThanOrEqual(cacheBudget);
				expect(list.materialized).toBeLessThan(list.logical.length);
			}
		}
	}

	async setRenderingMode (isRenderAll: boolean): Promise<void> {
		await this.page.locator("#tabs-right [title='Other Options']").click();
		await this.page.getByText("List rendering…", {exact: true}).click();
		const modal = this.page.locator(".ve-ui-modal__inner:visible");
		await expect(modal).toContainText("List Rendering");
		await modal.getByRole("combobox").selectOption({label: isRenderAll ? "Render all rows" : "Automatic"});
		await modal.getByRole("button", {name: "OK", exact: true}).click();
		await expect(modal).toHaveCount(0);
		await this.settleRendering();
		if (isRenderAll) {
			await expect.poll(async () => (await this.snapshots()).every(list => !list.isVirtual
				&& list.mounted.length === list.matching.length
				&& list.domRows === list.matching.length)).toBe(true);
		} else await this.assertAutomaticBounds();
	}

	async assertModeParity (): Promise<void> {
		const before = await this.snapshots();
		await this.setRenderingMode(true);
		const full = await this.snapshots();
		for (let i = 0; i < before.length; ++i) {
			expect(full[i].logical).toEqual(before[i].logical);
			expect(full[i].matching).toEqual(before[i].matching);
			expect(full[i].mounted).toEqual(before[i].matching);
			expect(full[i].domIdentities).toEqual(before[i].matching);
			expect(full[i].selected).toEqual(before[i].selected);
			expect(full[i].sortBy).toBe(before[i].sortBy);
			expect(full[i].sortDir).toBe(before[i].sortDir);
			expect(full[i].expanded).toBe(before[i].expanded);
		}
		await this.setRenderingMode(false);
		const automatic = await this.snapshots();
		for (let i = 0; i < before.length; ++i) {
			expect(automatic[i].logical).toEqual(before[i].logical);
			expect(automatic[i].matching).toEqual(before[i].matching);
			expect(automatic[i].selected).toEqual(before[i].selected);
			expect(automatic[i].expanded).toBe(before[i].expanded);
		}
	}

	async search (term: string): Promise<void> {
		const search = this.page.locator("#lst__search");
		await search.fill("");
		if (term) await search.pressSequentially(term);
		else await search.press("Backspace");
		await this.page.waitForFunction(term => {
			const {Hist, List} = globalThis as ReferenceBrowserGlobal;
			if (!Hist?._listPage || !List) throw new Error("Reference list search is not ready");
			return Hist._listPage.primaryLists.every(list => list._searchTerm === List.getCleanSearchTerm(term));
		}, term, {timeout: 10_000});
		await this.settleRendering();
	}

	async clearSearch (): Promise<void> {
		await this.page.locator("#lst__search").press("Escape");
		await expect(this.page.locator("#lst__search")).toHaveValue("");
		await this.page.waitForFunction(() => {
			const listPage = (globalThis as ReferenceBrowserGlobal).Hist?._listPage;
			if (!listPage) throw new Error("Reference list page is not ready");
			return listPage.primaryLists.every(list => list._searchTerm === "");
		});
		await this.settleRendering();
	}

	async sort (listIndex: number, column: string): Promise<void> {
		const toolbar = this._pageName === "items" ? `#filtertools-${listIndex === 0 ? "mundane" : "magic"}` : "#filtertools";
		const before = (await this.snapshots())[listIndex];
		await this.page.locator(`${toolbar} [data-sort=${JSON.stringify(column)}]`).click();
		await expect.poll(async () => {
			const after = (await this.snapshots())[listIndex];
			return after.sortBy === column && (before.sortBy !== column || after.sortDir !== before.sortDir);
		}).toBe(true);
		await this.settleRendering();
	}

	async rows (listIndex = 0, {isAll = false} = {}): Promise<ReferenceRow[]> {
		return this.page.evaluate(({listIndex, isAll}) => {
			const listPage = (globalThis as ReferenceBrowserGlobal).Hist?._listPage;
			if (!listPage) throw new Error("Reference list page is not ready");
			const list = listPage.primaryLists[listIndex];
			if (!list) throw new Error(`Missing primary list ${listIndex}`);
			return (isAll ? list.items : list.visibleItems).map(item => {
				const hash = item.data.hashCurr ?? item.data.hash;
				if (typeof hash !== "string") throw new Error(`Missing navigation hash for row ${listIndex}:${item.ix}`);
				return {
					listIndex,
					ix: item.ix,
					name: item.name,
					source: listPage._dataList[item.ix]?.source ?? "",
					hash,
				};
			});
		}, {listIndex, isAll});
	}

	async findRow (name: string, source: string, listIndex = 0): Promise<ReferenceRow> {
		const row = (await this.rows(listIndex, {isAll: true})).find(row => row.name === name && row.source === source);
		expect(row, `required real entity ${name}|${source} must be loaded`).toBeDefined();
		if (!row) throw new Error(`Required real entity ${name}|${source} is not loaded`);
		return row;
	}

	private _rowLocator (row: ReferenceRow): Locator {
		const wrapper = this._pageName === "items" ? `#list-${row.listIndex === 0 ? "mundane" : "magic"}` : "#list";
		const child = this._pageName === "names" || this._pageName === "encountergen" ? " " : " > ";
		return this.page.locator(`${wrapper}${child}.ve-lst__row`).filter({
			has: this.page.locator(`a[href=${JSON.stringify(`#${row.hash}`)}]`),
		});
	}

	async rowState (row: ReferenceRow): Promise<{cached: boolean; mounted: boolean; inViewport: boolean; focused: boolean; expanded: boolean; previewText: string; height: number}> {
		return this.page.evaluate(({listIndex, ix}) => {
			const list = (globalThis as ReferenceBrowserGlobal).Hist?._listPage?.primaryLists[listIndex];
			if (!list) throw new Error(`Missing primary list ${listIndex}`);
			const item = list.items.find(item => item.ix === ix);
			if (!item) throw new Error(`Missing logical row ${listIndex}:${ix}`);
			const element = item.peekEle();
			const rect = element?.getBoundingClientRect();
			const viewport = list._wrpList.getBoundingClientRect();
			return {
				cached: !!element,
				mounted: !!element?.isConnected && list.renderedItems.includes(item),
				inViewport: !!rect && rect.bottom > viewport.top && rect.top < viewport.bottom,
				focused: !!element?.contains(document.activeElement),
				expanded: !!item.data.isPreviewExpanded,
				previewText: element?.querySelector(".ve-accordion__wrp-preview-inner")?.textContent?.trim() ?? "",
				height: rect?.height ?? 0,
			};
		}, row);
	}

	async reveal (row: ReferenceRow, {isFocus = false} = {}): Promise<void> {
		await this.page.evaluate(async ({row, isFocus}) => {
			const list = (globalThis as ReferenceBrowserGlobal).Hist?._listPage?.primaryLists[row.listIndex];
			if (!list) throw new Error(`Missing primary list ${row.listIndex}`);
			const item = list.items.find(item => item.ix === row.ix);
			if (!item || !list.visibleItems.includes(item)) throw new Error(`Cannot reveal filtered/missing row ${row.ix}`);
			await list.scrollToItem(item, {isFocus, align: "nearest"});
		}, {row, isFocus});
		await expect.poll(async () => {
			const state = await this.rowState(row);
			return state.mounted && state.inViewport && (!isFocus || state.focused);
		}, {message: `reveal ${row.name} in list ${row.listIndex}`}).toBe(true);
	}

	async select (row: ReferenceRow, modifiers: ("Shift" | "ControlOrMeta")[] = []): Promise<void> {
		await this.reveal(row);
		await this._rowLocator(row).locator("a").first().click({modifiers});
		if (!modifiers.length) await this.assertSelected(row);
	}

	async assertSelected (row: ReferenceRow): Promise<void> {
		await expect.poll(() => this.page.evaluate(() => {
			const hist = (globalThis as ReferenceBrowserGlobal).Hist;
			if (!hist) throw new Error("Reference history is not ready");
			return hist.getSelectedListItem()?.ix;
		})).toBe(row.ix);
		await expect(this.page.locator("#pagecontent")).toContainText(row.name);
	}

	async pressNavigation (key: string): Promise<void> {
		await this.page.locator("#lst__search").blur();
		await this.page.keyboard.press(key);
		await this.settleRendering();
	}

	async pressTab (isReverse = false): Promise<void> {
		await this.page.keyboard.press(isReverse ? "Shift+Tab" : "Tab");
		await this.settleRendering();
	}

	async setModeWhileRowFocused (isRenderAll: boolean): Promise<void> {
		// A menu click necessarily moves focus; use the public model API to isolate renderer focus retention.
		await this.page.evaluate(isRenderAll => {
			const listPage = (globalThis as ReferenceBrowserGlobal).Hist?._listPage;
			if (!listPage) throw new Error("Reference list page is not ready");
			listPage.primaryLists.forEach(list => list.setRenderingMode({isRenderAll}));
		}, isRenderAll);
		await this.settleRendering();
	}

	async pressSearchEnter (): Promise<void> {
		await this.page.locator("#lst__search").press("Enter");
		await this.settleRendering();
	}

	async focusSearch (): Promise<void> {
		await this.page.locator("#lst__search").focus();
	}

	async followHash (row: ReferenceRow): Promise<void> {
		await this.page.goto(`/${this._pageName}.html#${row.hash}`, {waitUntil: "domcontentloaded"});
		await this.assertSelected(row);
		await expect.poll(async () => (await this.rowState(row)).inViewport).toBe(true);
	}

	async goBack (): Promise<void> {
		await this.page.goBack();
		await this.settleRendering();
	}

	async goForward (): Promise<void> {
		await this.page.goForward();
		await this.settleRendering();
	}

	async togglePreview (row: ReferenceRow): Promise<void> {
		await this.reveal(row);
		const wasExpanded = (await this.rowState(row)).expanded;
		await this._rowLocator(row).locator(".ve-lst__btn-toggle-expand").click();
		await expect.poll(async () => (await this.rowState(row)).expanded).toBe(!wasExpanded);
		await this.settleRendering();
		await expect(this._rowLocator(row).locator(".ve-lst__btn-toggle-expand")).toHaveAttribute("aria-expanded", `${!wasExpanded}`);
		await expect(this._rowLocator(row).locator(".ve-lst__btn-toggle-expand")).toHaveAttribute("title", wasExpanded ? "Expand preview" : "Collapse preview");
		if (wasExpanded) await expect(this._rowLocator(row).locator(".ve-accordion__wrp-preview")).toBeHidden();
		else {
			await expect(this._rowLocator(row).locator(".ve-accordion__wrp-preview")).toBeVisible();
			await expect(this._rowLocator(row).locator(".ve-accordion__wrp-preview-inner")).not.toBeEmpty();
		}
	}

	async toggleAllPreviews (): Promise<void> {
		await this.page.locator("[name='list-toggle-all-previews']").click();
		await this.settleRendering();
	}

	async traverseAllRows (listIndex: number): Promise<{visited: number; total: number; maxMounted: number; maxRetained: number; maxCacheExcess: number}> {
		return this.page.evaluate(async ({listIndex, threshold}) => {
			const list = (globalThis as ReferenceBrowserGlobal).Hist?._listPage?.primaryLists[listIndex];
			if (!list) throw new Error(`Missing primary list ${listIndex}`);
			const visited = new Set<BrowserListItem>();
			let maxMounted = 0;
			let maxRetained = 0;
			let maxCacheExcess = 0;
			const settle = () => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
			for (const item of list.visibleItems) {
				if (visited.has(item)) continue;
				await list.scrollToItem(item, {isFocus: false, align: "nearest"});
				await settle();
				if (!list.renderedItems.includes(item)) throw new Error(`Logical row ${item.ix} could not be mounted during traversal`);
				list.renderedItems.forEach(mounted => visited.add(mounted));
				maxMounted = Math.max(maxMounted, list.renderedItems.length);
				const retained = list.items.filter(item => item.peekEle()).length;
				maxRetained = Math.max(maxRetained, retained);
				maxCacheExcess = Math.max(maxCacheExcess, retained - Math.max(threshold, list.renderedItems.length * 2));
			}
			return {visited: visited.size, total: list.visibleItems.length, maxMounted, maxRetained, maxCacheExcess};
		}, {listIndex, threshold: ReferenceListPage.VIRTUAL_THRESHOLD});
	}

	async resize (width: number, height: number): Promise<void> {
		await this.page.setViewportSize({width, height});
		await this.settleRendering();
	}

	async wheel (listIndex: number, deltaY: number): Promise<void> {
		const wrapper = this._pageName === "items" ? `#list-${listIndex === 0 ? "mundane" : "magic"}` : "#list";
		await this.page.locator(wrapper).hover();
		await this.page.mouse.wheel(0, deltaY);
		await this.settleRendering();
	}

	async observeLogicalUpdates (): Promise<void> {
		await this.page.evaluate(() => {
			const browser = globalThis as ReferenceBrowserGlobal;
			const listPage = browser.Hist?._listPage;
			if (!listPage) throw new Error("Reference list page is not ready");
			browser.__referenceLogicalUpdates = 0;
			listPage.primaryLists.forEach(list => {
				list.on("updated", () => {
					if (browser.__referenceLogicalUpdates == null) throw new Error("Logical-update observation was not initialized");
					browser.__referenceLogicalUpdates++;
				});
			});
		});
	}

	async logicalUpdateCount (): Promise<number> {
		return this.page.evaluate(() => {
			const count = (globalThis as ReferenceBrowserGlobal).__referenceLogicalUpdates;
			if (count == null) throw new Error("Logical-update observation was not initialized");
			return count;
		});
	}

	async loadedProps (): Promise<string[]> {
		return this.page.evaluate(() => {
			const listPage = (globalThis as ReferenceBrowserGlobal).Hist?._listPage;
			if (!listPage) throw new Error("Reference list page is not ready");
			return [...new Set(listPage.primaryLists.flatMap(list => list.items.map(item => {
				const prop = listPage._dataList[item.ix]?.__prop;
				if (typeof prop !== "string") throw new Error(`Missing entity kind for row ${item.ix}`);
				return prop;
			})))].sort();
		});
	}

	async getUnloadedSpellSource (): Promise<{source: string; title: string; abbreviation: string}> {
		return this.page.evaluate(() => {
			const {Hist, Parser} = globalThis as ReferenceBrowserGlobal;
			const sources = Hist?._listPage?._loadedSources;
			const sourceState = Hist?._listPage?._pageFilter?.sourceFilter?._state;
			if (!sources || !sourceState || !Parser) throw new Error("Spell source loading is not ready");
			const entry = Object.values(sources)
				.find((entry): entry is BrowserSource => entry != null && !entry.loaded && !sourceState[entry.source]);
			if (!entry) throw new Error("The incremental-source test requires a real unloaded spell source");
			return {source: entry.source, title: Parser.sourceJsonToFull(entry.source), abbreviation: Parser.sourceJsonToAbv(entry.source)};
		});
	}

	async enableSource (source: {source: string; title: string; abbreviation: string}): Promise<void> {
		await this.page.locator("#filter-search-group").getByRole("button", {name: "Filter", exact: true}).click();
		const pill = this.page.locator(".ve-fltr__pill:visible").filter({
			has: this.page.locator("span").filter({hasText: new RegExp(`^${source.title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`)}),
		});
		await expect(pill).toHaveCount(1);
		await pill.click();
		await this.page.waitForFunction(source => {
			const sources = (globalThis as ReferenceBrowserGlobal).Hist?._listPage?._loadedSources;
			if (!sources) throw new Error("Spell source loading is not ready");
			return sources[source]?.loaded;
		}, source.source, {timeout: 60_000});
		await this.page.locator(".ve-fltr__btn-close:visible").filter({hasText: /^Save$/}).click();
		await expect(this.page.locator(".ve-ui-modal__overlay:visible")).toHaveCount(0);
		await this.settleRendering();
	}

	assertNoUnexpectedErrors (): void {
		expect(this._errors, "uncaught browser exceptions and failed content loads").toEqual([]);
	}
}
