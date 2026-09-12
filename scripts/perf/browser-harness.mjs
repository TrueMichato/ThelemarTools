/** Serialized by Playwright; keep browser helpers inside this function. */
export function installInstrumentation () {
	const H = globalThis.__perfHarness = {
		longTasks: [],
		brew: {rawMs: null, processedMs: null, calls: 0},
		firstRowMs: null,
		toolsLoadedMs: null,
		listReadyMs: null,
		reach: {page: false, rowBuilder: false, brewRaw: false, brewProcessed: false, longTasks: false},
		rowBuilderCalls: 0,
		rowBuilderMs: 0,
		phases: {},
		errors: [],
	};
	try {
		new PerformanceObserver(list => {
			for (const entry of list.getEntries()) H.longTasks.push({start: entry.startTime, duration: entry.duration});
		}).observe({entryTypes: ["longtask"]});
		H.reach.longTasks = true;
	} catch (e) { H.errors.push(`Long-task observer: ${e.message}`); }

	const intercept = (name, onSet) => {
		let value;
		Object.defineProperty(globalThis, name, {
			configurable: true,
			enumerable: true,
			get: () => value,
			set: next => {
				value = next;
				onSet(next);
			},
		});
	};
	intercept("BrewUtil2", B => {
		for (const [method, bucket, reach] of [
			["_pGetBrewRaw_", "rawMs", "brewRaw"],
			["_pGetBrewProcessed_", "processedMs", "brewProcessed"],
		]) {
			if (typeof B?.[method] !== "function") continue;
			const original = B[method];
			H.reach[reach] = true;
			B[method] = async function (...args) {
				const start = performance.now();
				try { return await original.apply(this, args); } finally {
					H.brew[bucket] = (H.brew[bucket] || 0) + performance.now() - start;
					if (bucket === "processedMs") H.brew.calls++;
				}
			};
		}
	});
	intercept("dbg_page", P => {
		H.reach.page = !!P;
		if (typeof P?.getListItem === "function") {
			const original = P.getListItem;
			H.reach.rowBuilder = true;
			P.getListItem = function (...args) {
				const start = performance.now();
				H.rowBuilderCalls++;
				try { return original.apply(this, args); } finally { H.rowBuilderMs += performance.now() - start; }
			};
		}
		for (const method of ["_pOnLoad_pGetData", "_pOnLoad_pInitPrimaryLists", "_pOnLoad_pPreDataAdd", "_pOnLoad_pPostLoad"]) {
			if (typeof P?.[method] !== "function") continue;
			const original = P[method];
			P[method] = async function (...args) {
				const start = performance.now();
				try { return await original.apply(this, args); } finally {
					H.phases[method] = (H.phases[method] || 0) + performance.now() - start;
				}
			};
		}
	});

	H.getLists = () => globalThis.dbg_page?.primaryLists?.filter(Boolean) || [];
	H.getLogicalState = () => H.getLists().map(list => ({
		list,
		items: list.items,
		matching: list.visibleItems,
		loadedCount: list.items?.length,
		matchingCount: list.visibleItems?.length,
		isReady: list._isInit !== false && !list._isDirty,
	}));
	const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
	H.paint = async () => { await frame(); await frame(); };
	H.checkCounter = () => {
		const lists = H.getLists();
		const expected = `${lists.reduce((n, l) => n + l.visibleItems.length, 0)}/${lists.reduce((n, l) => n + l.items.length, 0)}`;
		const counters = [...document.querySelectorAll(".ve-lst__wrp-search-visible")].map(ele => ele.textContent.trim());
		const isCustomCounter = /\/(?:classes|names|encountergen)\.html$/.test(location.pathname);
		return {
			expected,
			actual: counters,
			skipped: isCustomCounter ? "Custom page does not maintain the standard result counter" : null,
			ok: isCustomCounter || (counters.length > 0 && counters.every(text => text === expected)),
		};
	};

	const firstRowPoll = setInterval(() => {
		if (!document.querySelector("#listcontainer .ve-lst__row, #list .ve-lst__row")) return;
		H.firstRowMs = performance.now();
		clearInterval(firstRowPoll);
	}, 25);
	window.addEventListener("toolsLoaded", async () => {
		H.toolsLoadedMs = performance.now();
		clearInterval(firstRowPoll);
		if (H.firstRowMs == null && document.querySelector(".ve-lst__row")) H.firstRowMs = H.toolsLoadedMs;
		// Two animation-frame callbacks allow a paint between them. This is a response proxy,
		// not a browser-guaranteed presentation timestamp or an INP measurement.
		for (let attempt = 0; attempt < 600; ++attempt) {
			const before = H.getLogicalState();
			await H.paint();
			const after = H.getLogicalState();
			if (!after.length || !after.some(it => it.loadedCount > 0)) continue;
			if (!after.every((it, ix) => it.isReady
				&& it.items === before[ix]?.items && it.matching === before[ix]?.matching
				&& it.loadedCount === before[ix]?.loadedCount && it.matchingCount === before[ix]?.matchingCount)) continue;
			if (!H.checkCounter().ok) continue;
			H.listReadyMs = performance.now();
			return;
		}
		H.errors.push("toolsLoaded fired, but logical lists/counters did not settle");
	}, {once: true});
}

/** No .ele getter access: observation must not materialize lazy rows. */
export function collectLogicalLists () {
	const H = globalThis.__perfHarness;
	const P = globalThis.dbg_page;
	const lists = H.getLists().map((list, index) => {
		const identity = item => {
			const entity = item.data?.entity || P.dataList_?.[item.ix] || P._dataList?.[item.ix];
			const hash = item.values?.hash ?? item.data?.hash;
			if (typeof hash !== "string" || !hash) H.errors.push(`List ${index}: missing entity hash at ${item.ix}`);
			return JSON.stringify([entity?.__prop ?? null, hash ?? null, item.data?.customHashId ?? null]);
		};
		const loaded = list.items.map(identity);
		const matching = list.visibleItems.map(identity);
		const loadedItems = new Set(list.items);
		if (list.visibleItems.some(item => !loadedItems.has(item))) H.errors.push(`List ${index}: matching item absent from logical items`);
		const seen = new Set();
		const duplicates = [];
		for (const id of loaded) {
			if (seen.has(id)) duplicates.push(id);
			seen.add(id);
		}
		const rows = [...(list._wrpList?.querySelectorAll(".ve-lst__row") || [])];
		let materializedRows = 0;
		let materializedElements = 0;
		let materializationKnown = true;
		for (const item of list.items) {
			let ele;
			if (typeof item.peekEle === "function") ele = item.peekEle();
			else if (item.peekEle === undefined) {
				const descriptor = Object.getOwnPropertyDescriptor(item, "ele") || Object.getOwnPropertyDescriptor(item, "_ele");
				if (!descriptor || !("value" in descriptor)) { materializationKnown = false; continue; }
				ele = descriptor.value;
			} else {
				materializationKnown = false;
				continue;
			}
			if (!ele) continue;
			materializedRows++;
			materializedElements += 1 + ele.querySelectorAll("*").length;
		}
		const renderedItems = list.renderedItems;
		return {
			id: list._wrpList?.id || `primary-${index}`,
			loaded,
			matching,
			loadedCount: loaded.length,
			matchingCount: matching.length,
			mountedRows: rows.length,
			renderedLogicalRows: Array.isArray(renderedItems) ? renderedItems.length : null,
			isVirtualRendering: typeof list.isVirtualRendering === "boolean" ? list.isVirtualRendering : null,
			materializedRows: materializationKnown ? materializedRows : null,
			materializedElements: materializationKnown ? materializedElements : null,
			duplicateIdentities: duplicates,
			sortBy: list.sortBy,
			sortDir: list.sortDir,
		};
	});
	return {
		lists,
		counter: H.checkCounter(),
		sourceConfiguration: P?._pageFilter?.sourceFilter?.getValues?.() ?? null,
		errors: [...H.errors],
	};
}
