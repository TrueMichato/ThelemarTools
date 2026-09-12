import assert from "node:assert/strict";
import {EventEmitter} from "node:events";
import {test} from "node:test";
import {SCHEMA_VERSION, READINESS_VERSION, compactLogicalLists, compatibilityErrors, correctnessErrors} from "./results.mjs";
import {collectLogicalLists} from "./browser-harness.mjs";
import {observeErrors} from "./errors.mjs";

const configuration = {
	schemaVersion: SCHEMA_VERSION,
	readinessVersion: READINESS_VERSION,
	origin: "http://127.0.0.1:5100",
	localServer: true,
	viewport: {width: 1440, height: 1000},
	cpuThrottle: 1,
	browserVersion: "test-browser",
	interactionsEnabled: false,
	storagePolicy: "test-policy",
};

test("legacy readiness, changed viewport and foreign origins cannot be compared", () => {
	assert.ok(compatibilityErrors({}, configuration).some(it => it.includes("Legacy")));
	assert.ok(compatibilityErrors(configuration, {...configuration, viewport: {width: 800, height: 600}}).length);
	assert.ok(compatibilityErrors(configuration, {...configuration, origin: "https://example.com", localServer: false}).length);
	assert.deepEqual(compatibilityErrors(configuration, {...configuration, origin: "http://127.0.0.1:5199"}), []);
});

test("ordered digests catch missing, duplicated and reordered identities independently of mounted rows", () => {
	const make = (matching, mountedRows = 1) => ({
		logical: compactLogicalLists({lists: [{id: "list", loaded: ["a", "b", "c"], matching, mountedRows}]}),
		brewProps: {item: 3},
	});
	const baseline = make(["a", "b", "c"]);
	assert.deepEqual(correctnessErrors(baseline, make(["a", "b", "c"], 3)), []);
	for (const matching of [["a", "b"], ["a", "a", "c"], ["c", "b", "a"]]) {
		assert.ok(correctnessErrors(baseline, make(matching)).includes("Logical matchingDigest changed"));
	}
	assert.ok(correctnessErrors(baseline, {...baseline, brewProps: {item: 2}}).includes("Homebrew property counts changed"));
});

test("logical observation never reads a lazy element getter", () => {
	const item = {
		ix: 0,
		values: {hash: "actual_page_discriminator"},
		data: {entity: {__prop: "craftingRecipe"}},
		_ele: null,
		get ele () { throw new Error("Observation materialized a row"); },
	};
	globalThis.dbg_page = {};
	globalThis.__perfHarness = {
		getLists: () => [{items: [item], visibleItems: [item], _wrpList: {id: "list", querySelectorAll: () => []}}],
		checkCounter: () => ({ok: true}),
		errors: [],
	};
	try {
		const result = collectLogicalLists();
		assert.equal(result.lists[0].loadedCount, 1);
		assert.equal(result.lists[0].mountedRows, 0);
		assert.equal(result.lists[0].materializedRows, null);
		assert.deepEqual(JSON.parse(result.lists[0].loaded[0]), ["craftingRecipe", "actual_page_discriminator", null]);
	} finally {
		delete globalThis.dbg_page;
		delete globalThis.__perfHarness;
	}
});

test("only the optional local SW bootstrap is downgraded, never data or page errors", () => {
	const page = new EventEmitter();
	const observed = observeErrors(page, {isLocal: true});
	const response = (url, status) => ({url: () => url, status: () => status});
	page.emit("response", response("http://127.0.0.1:5100/sw-injector.js", 404));
	page.emit("response", response("http://127.0.0.1:5100/data/items.json", 404));
	page.emit("pageerror", new Error("real failure"));
	assert.equal(observed.warnings.length, 1);
	assert.equal(observed.requestErrors.length, 1);
	assert.deepEqual(observed.consoleErrors, ["real failure"]);
	const remote = new EventEmitter();
	const remoteObserved = observeErrors(remote);
	remote.emit("response", response("https://example.com/sw-injector.js", 404));
	assert.equal(remoteObserved.requestErrors.length, 1);
});

test("peekEle returning null never falls through to a lazy getter", () => {
	const row = {querySelectorAll: () => [{}, {}]};
	const items = [null, row].map((ele, ix) => ({
		ix,
		values: {hash: `entity-${ix}`},
		data: {},
		peekEle: () => ele,
		get ele () { throw new Error("Lazy getter must not be read, including when peekEle returns null"); },
	}));
	globalThis.dbg_page = {};
	globalThis.__perfHarness = {
		getLists: () => [{
			items,
			visibleItems: items,
			renderedItems: [items[1]],
			isVirtualRendering: true,
			_wrpList: {id: "list", querySelectorAll: () => [row]},
		}],
		checkCounter: () => ({ok: true}),
		errors: [],
	};
	try {
		const [list] = collectLogicalLists().lists;
		assert.equal(list.loadedCount, 2);
		assert.equal(list.materializedRows, 1);
		assert.equal(list.materializedElements, 3);
		assert.equal(list.mountedRows, 1);
		assert.equal(list.renderedLogicalRows, 1);
		assert.equal(list.isVirtualRendering, true);
	} finally {
		delete globalThis.dbg_page;
		delete globalThis.__perfHarness;
	}
});
