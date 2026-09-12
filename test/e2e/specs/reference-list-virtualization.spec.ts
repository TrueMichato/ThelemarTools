import {expect, test} from "@playwright/test";
import {EXCLUDED_REFERENCE_LIST_PAGES, REFERENCE_LIST_PAGES, ReferenceListPage} from "../pages/ReferenceListPage";

test.describe("Reference lists — lazy rows and measured virtualization", () => {
	test.describe.configure({mode: "default", timeout: 180_000});
	test.use({
		serviceWorkers: "block",
		storageState: {cookies: [], origins: []},
		viewport: {width: 1440, height: 1000},
	});

	let reference: ReferenceListPage;
	test.beforeEach(({page}) => { reference = new ReferenceListPage(page); });
	test.afterEach(() => { reference.assertNoUnexpectedErrors(); });

	for (const pageName of REFERENCE_LIST_PAGES) {
		test(`${pageName}: complete logical results survive automatic/full rendering`, async () => {
			await reference.goto(pageName);
			await reference.assertLoaded();
			await reference.assertAutomaticBounds({isInitial: true});
			await reference.assertModeParity();
		});
	}

	for (const pageName of EXCLUDED_REFERENCE_LIST_PAGES) {
		test(`${pageName}: custom lists never allocate a virtual renderer and retain navigation/search`, async () => {
			await reference.goto(pageName);
			await reference.assertLoaded();
			await reference.assertLegacyRendering();
			const initial = await reference.snapshots();
			const listIndex = initial.findIndex(list => list.matching.length > 1);
			expect(listIndex, "an excluded page must load a usable reference list").toBeGreaterThanOrEqual(0);
			const row = (await reference.rows(listIndex)).at(-1)!;
			await reference.select(row);
			await reference.assertSelected(row);
			const beforeSearch = await reference.snapshots();
			await reference.search(row.name);
			await expect.poll(async () => (await reference.snapshots()).reduce((total, list) => total + list.matching.length, 0)).toBeGreaterThan(0);
			const filtered = await reference.snapshots();
			expect(filtered.map(list => list.logical)).toEqual(beforeSearch.map(list => list.logical));
			expect(filtered.reduce((total, list) => total + list.matching.length, 0)).toBeLessThan(beforeSearch.reduce((total, list) => total + list.matching.length, 0));
			await reference.assertLegacyRendering();
			await reference.clearSearch();
			expect((await reference.snapshots()).map(list => list.matching)).toEqual(beforeSearch.map(list => list.matching));
			await reference.assertLegacyRendering();
		});
	}

	test("Plain List: unconfigured consumers remain legacy above the virtualization threshold", async () => {
		await reference.goto("actions");
		await reference.assertLoaded();
		await reference.assertPlainListDefaultsToLegacy();
	});

	test("Virtual List: a 900px row retains its -500px anchor through invalidation and root/window resize", async () => {
		await reference.goto("actions");
		await reference.assertLoaded();
		try {
			await reference.mountTallAnchorFixture();
			await reference.assertTallAnchorFixtureStable();
			await reference.invalidateTallAnchorFixture();
			await reference.assertTallAnchorFixtureStable();
			await reference.resize(1000, 800);
			await reference.assertTallAnchorFixtureStable();
			await reference.resizeTallAnchorFixtureRoot();
			await reference.assertTallAnchorFixtureStable();
		} finally {
			await reference.removeTallAnchorFixture();
		}
	});

	test("Items: both panes retain complete identities through search, clear, empty results and sort", async () => {
		await reference.goto("items");
		await reference.assertLoaded(5000);
		await reference.findRow("Potion of Healing", "XDMG", 1);
		await reference.findRow("+1 Rod of the Pact Keeper", "XDMG", 1);
		const healingPotions = (await reference.rows(1, {isAll: true})).filter(row => row.name === "Potion of Healing");
		expect(new Set(healingPotions.map(row => row.source)).size, "same-name reprints must remain separate").toBeGreaterThan(1);
		const initial = await reference.snapshots();
		expect(initial.every(list => list.matching.length > ReferenceListPage.VIRTUAL_THRESHOLD)).toBe(true);
		await reference.assertAutomaticBounds({isInitial: true});

		await reference.search("potion of healing");
		await expect.poll(async () => (await reference.snapshots())[1].matching.length).toBeGreaterThan(0);
		const small = await reference.snapshots();
		expect(small[1].matching.length).toBeLessThan(ReferenceListPage.VIRTUAL_THRESHOLD);
		await reference.assertAutomaticBounds();
		await reference.assertModeParity();

		await reference.search("no-such-reference-row-6929da4f");
		await expect.poll(async () => (await reference.snapshots()).map(list => list.matching.length)).toEqual([0, 0]);
		await reference.assertAutomaticBounds();
		await reference.clearSearch();
		expect((await reference.snapshots()).map(list => list.matching)).toEqual(initial.map(list => list.matching));

		for (const listIndex of [0, 1]) {
			await reference.sort(listIndex, "name");
			const sorted = await reference.snapshots();
			expect(sorted[listIndex].matching).not.toEqual(initial[listIndex].matching);
			expect(new Set(sorted[listIndex].matching)).toEqual(new Set(initial[listIndex].matching));
		}
		await reference.assertModeParity();
	});

	for (const [listIndex, pane] of ["mundane", "magic"].entries()) {
		test(`Items ${pane}: distant navigation and complete traversal retain a bounded row cache`, async () => {
			test.setTimeout(300_000);
			await reference.goto("items");
			await reference.assertLoaded(5000);
			await reference.assertAutomaticBounds({isInitial: true});
			const rows = await reference.rows(listIndex);
			expect(rows.length).toBeGreaterThan(ReferenceListPage.VIRTUAL_THRESHOLD);
			const far = rows.at(-1)!;
			expect((await reference.rowState(far)).cached, "unvisited final row must not be constructed eagerly").toBe(false);
			await reference.reveal(far);
			await reference.select(far);
			const traversal = await reference.traverseAllRows(listIndex);
			expect(traversal.visited).toBe(traversal.total);
			expect(traversal.total).toBe(rows.length);
			expect(traversal.maxMounted).toBeLessThanOrEqual(ReferenceListPage.MAX_MOUNTED);
			expect(traversal.maxCacheExcess, "retained rows must respect max(200, mounted × 2) at every traversal step").toBe(0);
			await reference.assertAutomaticBounds();
		});
	}

	test("Items: focus, independent panes and wrapping survive viewport changes", async () => {
		await reference.goto("items");
		const mundane = await reference.rows(0);
		const magic = await reference.rows(1);
		const focused = mundane[Math.floor(mundane.length / 2)];
		await reference.reveal(focused, {isFocus: true});
		const otherPane = magic.at(-1)!;
		await reference.reveal(otherPane);
		expect((await reference.rowState(focused)).focused).toBe(true);
		const identities = (await reference.snapshots()).map(list => list.matching);

		await reference.resize(390, 844);
		await reference.reveal(otherPane);
		await reference.assertAutomaticBounds();
		expect((await reference.snapshots()).map(list => list.matching)).toEqual(identities);
		await reference.resize(1440, 1000);
		await reference.reveal(focused, {isFocus: true});
		await reference.assertAutomaticBounds();
		expect((await reference.rowState(focused)).focused).toBe(true);
		await reference.setModeWhileRowFocused(true);
		expect((await reference.rowState(focused)).focused).toBe(true);
		await reference.setModeWhileRowFocused(false);
		expect((await reference.rowState(focused)).focused).toBe(true);
		await reference.assertAutomaticBounds();
	});

	test("Items: compatibility preference persists while filtered order and selected detail remain intact", async () => {
		await reference.goto("items");
		await reference.search("potion");
		await expect.poll(async () => (await reference.snapshots())[1].matching.length).toBeGreaterThan(0);
		await reference.sort(1, "rarity");
		const selected = (await reference.rows(1)).at(-1)!;
		await reference.select(selected);
		await reference.assertModeParity();
		await reference.assertSelected(selected);
		await reference.setRenderingMode(true);
		await reference.reload();
		expect((await reference.snapshots()).every(list => !list.isVirtual && list.mounted.length === list.matching.length)).toBe(true);
		await reference.setRenderingMode(false);
		await reference.assertAutomaticBounds();
	});

	test("Feats: individual preview content and collapsed state survive actual cache eviction", async () => {
		await reference.goto("feats");
		await reference.assertLoaded(300);
		const rows = await reference.rows();
		expect(rows.length).toBeGreaterThan(ReferenceListPage.VIRTUAL_THRESHOLD);
		const preview = rows[1];
		await reference.togglePreview(preview);
		const expanded = await reference.rowState(preview);
		expect(expanded.previewText.length).toBeGreaterThan(20);
		await reference.focusSearch();
		await reference.traverseAllRows(0);
		expect((await reference.rowState(preview)).cached, "preview must really be evicted, not merely detached").toBe(false);
		expect((await reference.rowState(preview)).expanded).toBe(true);
		await reference.reveal(preview);
		expect((await reference.rowState(preview)).previewText).toBe(expanded.previewText);
		await reference.togglePreview(preview);
		const collapsedHeight = (await reference.rowState(preview)).height;
		expect(collapsedHeight).toBeLessThan(expanded.height);
		await reference.focusSearch();
		await reference.traverseAllRows(0);
		await reference.reveal(preview);
		expect((await reference.rowState(preview)).expanded).toBe(false);
		expect((await reference.rowState(preview)).previewText).toBe("");
	});

	test("Feats: expand-all is logical and lazy, including previews revealed far from the viewport", async () => {
		await reference.goto("feats");
		await reference.assertLoaded(300);
		const before = (await reference.snapshots())[0];
		await reference.toggleAllPreviews();
		await expect.poll(async () => (await reference.snapshots())[0].expanded).toBe(before.matching.length);
		const expanded = (await reference.snapshots())[0];
		expect(expanded.previewBodies).toBeLessThan(expanded.matching.length);
		expect(expanded.materialized).toBeLessThan(expanded.matching.length);
		await reference.assertAutomaticBounds();
		const far = (await reference.rows()).at(-1)!;
		await reference.reveal(far);
		expect((await reference.rowState(far)).previewText.length).toBeGreaterThan(20);
		await reference.toggleAllPreviews();
		expect((await reference.snapshots())[0].expanded).toBe(0);
		expect((await reference.rowState(far)).previewText).toBe("");
		await reference.assertModeParity();
	});

	test("Spells: deep links, back/forward, j/k and search Enter reach logical off-screen rows", async () => {
		await reference.goto("spells");
		await reference.assertLoaded(900);
		const rows = await reference.rows();
		expect(rows.length).toBeGreaterThan(ReferenceListPage.VIRTUAL_THRESHOLD);
		const far = rows.at(-2)!;
		const next = rows.at(-1)!;
		await reference.followHash(far);
		await reference.pressNavigation("j");
		await reference.assertSelected(next);
		await reference.pressNavigation("k");
		await reference.assertSelected(far);
		await reference.goBack();
		await reference.assertSelected(next);
		await reference.goForward();
		await reference.assertSelected(far);
		await reference.search("fireball");
		await expect.poll(async () => (await reference.rows()).length).toBeGreaterThan(0);
		const firstMatch = (await reference.rows())[0];
		await reference.pressSearchEnter();
		await reference.assertSelected(firstMatch);
		await reference.clearSearch();
		await reference.assertAutomaticBounds();
	});

	test("Spells: a real source filter incrementally loads data without dropping existing identities", async () => {
		await reference.goto("spells");
		await reference.assertLoaded(900);
		const before = (await reference.snapshots())[0].logical;
		const source = await reference.getUnloadedSpellSource();
		await reference.enableSource(source);
		const after = (await reference.snapshots())[0].logical;
		expect(after.length).toBeGreaterThan(before.length);
		expect(before.every(identity => after.includes(identity))).toBe(true);
		expect((await reference.rows(0, {isAll: true})).some(row => row.source === source.source)).toBe(true);
		await reference.assertModeParity();
	});

	test("Spells: wheel scrolling and Tab traverse rows without logical-list updates", async () => {
		await reference.goto("spells");
		await reference.assertLoaded(900);
		const rows = await reference.rows();
		await reference.reveal(rows[0]);
		const before = (await reference.snapshots())[0];
		await reference.observeLogicalUpdates();
		await reference.wheel(0, 1800);
		await expect.poll(async () => (await reference.snapshots())[0].mounted[0]).not.toBe(before.mounted[0]);
		expect((await reference.snapshots())[0].matching).toEqual(before.matching);
		expect(await reference.logicalUpdateCount(), "viewport-only updates must not rerun filtering/counters").toBe(0);
		const middleIndex = Math.floor(rows.length / 2);
		await reference.reveal(rows[middleIndex], {isFocus: true});
		await reference.pressTab();
		await expect.poll(async () => (await reference.rowState(rows[middleIndex + 1])).focused).toBe(true);
		await reference.pressTab(true);
		await expect.poll(async () => (await reference.rowState(rows[middleIndex])).focused).toBe(true);
		await reference.assertAutomaticBounds();
	});

	test("Crafting: all four entity kinds and asynchronous text-search results survive rendering modes", async () => {
		await reference.goto("crafting");
		await reference.assertLoaded(2000);
		expect(await reference.loadedProps()).toEqual(["craftingMaterial", "craftingRecipe", "craftingRule", "itemMaterial"]);
		const all = (await reference.snapshots())[0].matching;
		await reference.search("text:dragon");
		await expect.poll(async () => (await reference.snapshots())[0].matching.length, {timeout: 30_000}).toBeGreaterThan(0);
		await reference.assertModeParity();
		await reference.clearSearch();
		expect((await reference.snapshots())[0].matching).toEqual(all);
		await reference.assertAutomaticBounds();
	});
});
