import assert from "node:assert/strict";
import {collectLogicalLists} from "./browser-harness.mjs";
import {compactLogicalLists} from "./results.mjs";

const QUERIES = {items: "longsword", spells: "fireball", feats: "alert"};

/** Input-to-two-frame response proxies; checks observe real app state, never set it. */
export async function measureInteractions (page, {pageName, timeoutMs}) {
	if (!QUERIES[pageName]) return {skipped: "Interaction recipes currently cover items, spells and feats only", scenarios: []};
	const scenarios = [];
	const snapshot = async () => {
		const logical = compactLogicalLists(await page.evaluate(collectLogicalLists));
		assert.deepEqual(logical.errors, [], "Logical list instrumentation reported an error");
		assert.ok(logical.lists.every(list => !list.duplicateIdentities.length), "Duplicate logical identities");
		assert.ok(logical.counter.ok, "UI counter differs from logical results");
		return logical;
	};
	const initial = await snapshot();
	const total = data => data.lists.reduce((n, list) => n + list.matchingCount, 0);

	const run = async (name, eventType, action, check, arg = null) => {
		await page.evaluate(({eventType}) => {
			const H = globalThis.__perfHarness;
			H.interaction = {start: null, updates: 0, longTaskIndex: H.longTasks.length};
			H.interaction.onEvent = event => {
				if (event.isTrusted && H.interaction.start == null) H.interaction.start = performance.now();
			};
			window.addEventListener(eventType, H.interaction.onEvent, true);
			H.interaction.onUpdate = () => H.interaction.updates++;
			for (const list of H.getLists()) list.on("updated", H.interaction.onUpdate);
		}, {eventType});
		try {
			await action();
			await page.waitForFunction(check, arg, {timeout: timeoutMs});
			await page.evaluate(async () => {
				const H = globalThis.__perfHarness;
				await H.paint();
				if (!H.checkCounter().ok) throw new Error("Interaction UI counter differs from logical results");
				if (H.interaction.start == null) throw new Error("No trusted input event observed");
				H.interaction.end = performance.now();
			});
			// Drain long-task observer delivery after recording the response endpoint.
			await page.waitForTimeout(50);
			const timing = await page.evaluate(() => {
				const H = globalThis.__perfHarness;
				const I = H.interaction;
				const tasks = H.longTasks.slice(I.longTaskIndex).filter(task => task.start < I.end && task.start + task.duration > I.start);
				return {
					responseMs: Math.round(I.end - I.start),
					logicalUpdates: I.updates,
					longTaskTotalMs: Math.round(tasks.reduce((n, task) => n + task.duration, 0)),
					longTaskMaxMs: Math.round(Math.max(0, ...tasks.map(task => task.duration))),
				};
			});
			const logical = await snapshot();
			assert.equal(logical.loadedDigest, initial.loadedDigest, `${name}: logical loaded identities changed`);
			scenarios.push({name, ...timing, logical});
			return logical;
		} catch (e) {
			throw new Error(`${name}: ${e.message}`, {cause: e});
		} finally {
			await page.evaluate(({eventType}) => {
				const H = globalThis.__perfHarness;
				window.removeEventListener(eventType, H.interaction.onEvent, true);
				for (const list of H.getLists()) list.off("updated", H.interaction.onUpdate);
			}, {eventType});
		}
	};

	const query = QUERIES[pageName];
	await page.locator("#lst__search").focus();
	const narrowed = await run("search", "keydown",
		() => page.locator("#lst__search").pressSequentially(query),
		query => {
			const H = globalThis.__perfHarness;
			return H.getLists().every(list => list._searchTerm === query) && H.checkCounter().ok;
		}, query);
	assert.ok(total(narrowed) > 0 && total(narrowed) < total(initial), "Search did not narrow to a nonempty result");
	assert.ok(scenarios.at(-1).logicalUpdates > 0, "Search did not produce a logical update");

	const cleared = await run("clear", "click",
		() => page.locator("#lst__search-glass").click(),
		count => {
			const H = globalThis.__perfHarness;
			return H.getLists().every(list => list._searchTerm === "")
				&& H.getLists().reduce((n, list) => n + list.visibleItems.length, 0) === count
				&& H.checkCounter().ok;
		}, total(initial));
	assert.equal(cleared.matchingDigest, initial.matchingDigest, "Clear did not restore ordered matches");

	for (const [index, initialList] of initial.lists.entries()) {
		if (initialList.matchingCount < 2) continue;
		const selector = pageName === "items" ? `#filtertools-${index === 0 ? "mundane" : "magic"} [data-sort="name"]` : "#filtertools [data-sort=\"name\"]";
		const sorted = await run(`sort-${initialList.id}`, "click",
			() => page.locator(selector).click(),
			({index, direction}) => globalThis.__perfHarness.getLists()[index].sortDir !== direction,
			{index, direction: initialList.sortDir});
		assert.notEqual(sorted.lists[index].matchingDigest, initialList.matchingDigest, "Sort did not change matching order");
		assert.equal(sorted.lists[index].matchingCount, initialList.matchingCount, "Sort changed matching count");
	}

	// The existing source mini-pill removes one included source using its real click handler.
	const source = await page.evaluate(() => {
		const P = globalThis.dbg_page;
		const filter = P._pageFilter.sourceFilter;
		const state = filter.getValues().Source;
		const sourceCounts = new Map();
		for (const list of P.primaryLists) {
			for (const item of list.visibleItems) {
				const source = (item.data.entity || P.dataList_[item.ix]).source;
				sourceCounts.set(source, (sourceCounts.get(source) || 0) + 1);
			}
		}
		const candidates = filter._items.filter(item => state[item.item] === 1 && sourceCounts.has(item.item)
			&& item.btnMini?.getBoundingClientRect().height > 0);
		candidates.sort((a, b) => sourceCounts.get(b.item) - sourceCounts.get(a.item) || String(a.item).localeCompare(String(b.item)));
		const item = candidates[0];
		if (!item) return null;
		item.btnMini.setAttribute("data-perf-source", "target");
		return {name: item.item, matchingCount: P.primaryLists.reduce((n, list) => n + list.visibleItems.length, 0)};
	});
	if (source) {
		const filtered = await run("source-filter", "click",
			() => page.locator("[data-perf-source=\"target\"]").click(),
			source => {
				const P = globalThis.dbg_page;
				return P._pageFilter.sourceFilter.getValues().Source[source.name] === 0
					&& P.primaryLists.reduce((n, list) => n + list.visibleItems.length, 0) < source.matchingCount
					&& globalThis.__perfHarness.checkCounter().ok;
			}, source);
		assert.ok(total(filtered) < source.matchingCount, "Source filter did not narrow logical results");
		scenarios.at(-1).source = source.name;
	} else scenarios.push({name: "source-filter", skipped: "No visible included source mini-pill with matching entities"});

	for (const [index, list] of (await snapshot()).lists.entries()) {
		const selector = `#${list.id}`;
		const scroll = await page.locator(selector).evaluate(ele => ({top: ele.scrollTop, height: ele.clientHeight, extent: ele.scrollHeight}));
		if (scroll.extent <= scroll.height) {
			scenarios.push({name: `scroll-${list.id}`, skipped: "List is not scrollable"});
			continue;
		}
		await page.locator(selector).hover();
		await run(`scroll-${list.id}`, "wheel",
			() => page.mouse.wheel(0, Math.max(300, scroll.height)),
			({index, top}) => globalThis.__perfHarness.getLists()[index]._wrpList.scrollTop > top,
			{index, top: scroll.top});

		const target = await page.evaluate(index => {
			const list = globalThis.__perfHarness.getLists()[index];
			const item = list.visibleItems.at(-1);
			return {hash: item.data.hashCurr ?? item.data.hash ?? item.values.hash, ix: item.ix};
		}, index);
		// k from the next nonempty list's first entry wraps to this list's last entry.
		// The same-document deep link is untimed setup; only the subsequent key is measured.
		const first = await page.evaluate(index => {
			const lists = globalThis.__perfHarness.getLists();
			const candidates = lists.filter(list => list.visibleItems.length);
			const next = candidates[(candidates.indexOf(lists[index]) + 1) % candidates.length];
			const item = next.visibleItems[0];
			return {hash: item.data.hashCurr ?? item.data.hash ?? item.values.hash, ix: item.ix};
		}, index);
		await page.goto(`${page.url().split("#")[0]}#${first.hash}`, {waitUntil: "commit"});
		try {
			await page.waitForFunction(first => location.hash.slice(1) === first.hash && globalThis.Hist.lastLoadedId === first.ix, first, {timeout: timeoutMs});
		} catch (e) {
			const state = await page.evaluate(() => ({hash: location.hash, selected: globalThis.Hist.lastLoadedId}));
			throw new Error(`far-reveal setup expected ${JSON.stringify(first)}, got ${JSON.stringify(state)}: ${e.message}`, {cause: e});
		}
		await page.locator("#lst__search").blur();
		await run(`far-reveal-${list.id}`, "keydown",
			() => page.keyboard.press("k"),
			target => {
				const P = globalThis.dbg_page;
				if (location.hash.slice(1) !== target.hash) return false;
				for (const list of P.primaryLists) {
					const row = [...list._wrpList.querySelectorAll(".ve-lst__row")].find(row => row.querySelector("a")?.getAttribute("href") === `#${target.hash}`);
					if (!row) continue;
					const a = row.getBoundingClientRect();
					const b = list._wrpList.getBoundingClientRect();
					return a.bottom > b.top && a.top < b.bottom;
				}
				return false;
			}, target);
	}
	await page.locator("#reset").click();
	await page.waitForFunction(expected => {
		const H = globalThis.__perfHarness;
		return H.getLists().every(list => !list._searchTerm)
				&& H.getLists().reduce((n, list) => n + list.visibleItems.length, 0) === expected
				&& H.checkCounter().ok;
	}, total(initial), {timeout: timeoutMs});
	await page.evaluate(() => globalThis.__perfHarness.paint());
	assert.equal((await snapshot()).matchingDigest, initial.matchingDigest, "Reset did not restore initial ordered matches");
	// Let the app's debounced filter persistence finish before the next warm run.
	await page.waitForTimeout(250);
	return {query, scenarios};
}
