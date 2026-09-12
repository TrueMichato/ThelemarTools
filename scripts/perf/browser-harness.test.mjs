import assert from "node:assert/strict";
import {test} from "node:test";
import {chromium} from "playwright";
import {installInstrumentation, collectLogicalLists} from "./browser-harness.mjs";

test("readiness requires toolsLoaded and truthful logical counters, not mounted-row stability", async () => {
	const browser = await chromium.launch();
	try {
		const page = await browser.newPage();
		await page.setContent("<div class=\"ve-lst__wrp-search-visible\">1/1</div><div id=\"list\"><div class=\"ve-lst__row\"></div></div>");
		await page.evaluate(installInstrumentation);
		await page.evaluate(() => {
			const items = Array.from({length: 1000}, (_, ix) => ({
				ix,
				values: {hash: `entity-${ix}`},
				data: {entity: {__prop: "testEntity"}},
				_ele: null,
			}));
			const list = {items, visibleItems: [...items], _wrpList: document.querySelector("#list"), _isInit: true, _isDirty: false};
			globalThis.dbg_page = {primaryLists: [list], getListItem: () => null};
		});
		await page.waitForTimeout(100);
		assert.equal(await page.evaluate(() => globalThis.__perfHarness.listReadyMs), null, "A stable mounted row must not satisfy readiness");
		await page.evaluate(() => window.dispatchEvent(new Event("toolsLoaded")));
		await page.waitForTimeout(100);
		assert.equal(await page.evaluate(() => globalThis.__perfHarness.listReadyMs), null, "A stale displayed counter must not satisfy readiness");
		await page.evaluate(() => document.querySelector(".ve-lst__wrp-search-visible").textContent = "1000/1000");
		await page.waitForFunction(() => globalThis.__perfHarness.listReadyMs != null);
		const logical = await page.evaluate(collectLogicalLists);
		assert.equal(logical.lists[0].loadedCount, 1000);
		assert.equal(logical.lists[0].matchingCount, 1000);
		assert.equal(logical.lists[0].mountedRows, 1);
		assert.equal(logical.lists[0].materializedRows, 0);
		assert.equal(logical.counter.ok, true);
	} finally {
		await browser.close();
	}
});

test("an empty matching result can be ready without any mounted row", async () => {
	const browser = await chromium.launch();
	try {
		const page = await browser.newPage();
		await page.setContent("<div class=\"ve-lst__wrp-search-visible\">0/1</div><div id=\"list\"></div>");
		await page.evaluate(installInstrumentation);
		await page.evaluate(() => {
			globalThis.dbg_page = {
				primaryLists: [{
					items: [{values: {hash: "filtered-out"}, data: {}, _ele: null}],
					visibleItems: [],
					_wrpList: document.querySelector("#list"),
				}],
			};
			window.dispatchEvent(new Event("toolsLoaded"));
		});
		await page.waitForFunction(() => globalThis.__perfHarness.listReadyMs != null);
		const logical = await page.evaluate(collectLogicalLists);
		assert.equal(logical.lists[0].matchingCount, 0);
		assert.equal(logical.lists[0].mountedRows, 0);
	} finally {
		await browser.close();
	}
});
