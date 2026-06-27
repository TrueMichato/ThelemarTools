/**
 * Bug #1 — the character-sheet loading tip only flashed for ~half a second.
 *
 * ROOT CAUSE: `_pInitLoadingTip()` (js/charactersheet/charactersheet.js) only set
 * `#charsheet-loading-tip` AFTER `await DataUtil.loadJSON("data/loading-tips.json")`.
 * That fetch resolves around the same time the rest of init finishes and the
 * loading overlay is removed, so the tip stayed on its "Loading a helpful tip..."
 * placeholder for nearly the entire load and appeared for only a blink.
 *
 * FIX: an embedded `static _INLINE_LOADING_TIPS` list is rendered SYNCHRONOUSLY
 * (before the first `await`) so a tip is visible the instant the overlay appears;
 * the async JSON load then swaps to a full-set tip (or leaves the inline one on
 * failure).
 *
 * These tests drive the REAL `_pInitLoadingTip` from the real controller (imported
 * with a minimal global shim — only `document`/`window`/`DataUtil` are needed by
 * the method) so the embedded list and control flow can't drift undetected. A few
 * source-pins additionally lock the call ORDERING in `pInit()` (the method must be
 * fired before `await this._pLoadData()`), which behavior alone can't observe.
 */

import "./setup.js";
import {readFileSync} from "fs";
import {resolve, dirname} from "path";
import {fileURLToPath} from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..", "..");
const CONTROLLER_SRC = readFileSync(resolve(REPO_ROOT, "js/charactersheet/charactersheet.js"), "utf8");

const PLACEHOLDER = "Loading a helpful tip...";

let CharacterSheetPage;
let currentTip; // the stub element returned for "#charsheet-loading-tip"
let loadJSONImpl; // swappable per-test

beforeAll(async () => {
	globalThis.window = {
		addEventListener: () => {},
		dispatchEvent: () => {},
		location: {search: ""},
		matchMedia: () => ({matches: false, addEventListener: () => {}}),
	};
	globalThis.document = {
		querySelector: (sel) => (sel === "#charsheet-loading-tip" ? currentTip : null),
		querySelectorAll: () => [],
		getElementById: () => null,
		addEventListener: () => {},
		body: {classList: {add () {}, remove () {}}},
	};
	globalThis.DataUtil = {...(globalThis.DataUtil || {}), loadJSON: (...args) => loadJSONImpl(...args)};

	await import("../../../js/charactersheet/charactersheet.js");
	CharacterSheetPage = globalThis.CharacterSheetPage;
});

function freshTip () {
	currentTip = {textContent: PLACEHOLDER};
	return currentTip;
}

describe("Loading tip — instant render (Bug #1, real method)", () => {
	test("a real embedded tip is shown SYNCHRONOUSLY, before the JSON fetch resolves", () => {
		const elTip = freshTip();
		loadJSONImpl = () => new Promise(() => {}); // never settles

		const page = Object.create(CharacterSheetPage.prototype);
		// Fire-and-forget (matches the production `.catch()` call site) — do NOT await.
		page._pInitLoadingTip().catch(() => {});

		expect(elTip.textContent).toBeTruthy();
		expect(elTip.textContent).not.toBe(PLACEHOLDER);
		// It came from the real embedded list, not the JSON (which never resolved).
		expect(CharacterSheetPage._INLINE_LOADING_TIPS).toContain(elTip.textContent);
	});

	test("inline tip survives a failed JSON fetch", async () => {
		const elTip = freshTip();
		loadJSONImpl = () => Promise.reject(new Error("offline"));
		const origWarn = console.warn;
		console.warn = () => {};

		try {
			await Object.create(CharacterSheetPage.prototype)._pInitLoadingTip();
		} finally {
			console.warn = origWarn;
		}

		expect(CharacterSheetPage._INLINE_LOADING_TIPS).toContain(elTip.textContent);
	});

	test("swaps to a full-set tip once the JSON resolves", async () => {
		const elTip = freshTip();
		const fullSet = ["Full-set tip A", "Full-set tip B"];
		loadJSONImpl = () => Promise.resolve(fullSet);

		await Object.create(CharacterSheetPage.prototype)._pInitLoadingTip();

		expect(fullSet).toContain(elTip.textContent);
	});

	test("ignores an empty/garbage JSON payload and keeps the inline tip", async () => {
		const elTip = freshTip();
		loadJSONImpl = () => Promise.resolve([null, "", false]); // filters to empty
		await Object.create(CharacterSheetPage.prototype)._pInitLoadingTip();
		expect(CharacterSheetPage._INLINE_LOADING_TIPS).toContain(elTip.textContent);
	});

	test("no-ops gracefully when the tip element is absent", async () => {
		currentTip = null;
		loadJSONImpl = () => Promise.resolve(["x"]);
		await expect(Object.create(CharacterSheetPage.prototype)._pInitLoadingTip()).resolves.toBeUndefined();
	});
});

describe("Loading tip — production source guarantees (Bug #1 source-pin)", () => {
	test("the embedded inline list has several real tips", () => {
		expect(CharacterSheetPage._INLINE_LOADING_TIPS.length).toBeGreaterThanOrEqual(3);
		CharacterSheetPage._INLINE_LOADING_TIPS.forEach((t) => expect(typeof t).toBe("string"));
	});

	test("`_pInitLoadingTip` queries the right element and sets it BEFORE awaiting the fetch", () => {
		const body = CONTROLLER_SRC.match(/async _pInitLoadingTip \(\)\s*\{[\s\S]*?\n\t\}/);
		expect(body).not.toBeNull();
		const src = body[0];
		expect(src).toMatch(/querySelector\("#charsheet-loading-tip"\)/);
		const idxInlineSet = src.indexOf("elTip.textContent = inlineTips[");
		const idxAwait = src.indexOf("await DataUtil.loadJSON(\"data/loading-tips.json\")");
		expect(idxInlineSet).toBeGreaterThan(-1);
		expect(idxAwait).toBeGreaterThan(-1);
		expect(idxInlineSet).toBeLessThan(idxAwait);
	});

	test("`pInit()` fires the tip BEFORE awaiting data load (so it covers the whole load)", () => {
		const body = CONTROLLER_SRC.match(/async pInit \(\)\s*\{[\s\S]*?await this\._pLoadData\(\);/);
		expect(body).not.toBeNull();
		const src = body[0];
		const idxTip = src.indexOf("this._pInitLoadingTip()");
		const idxLoad = src.indexOf("await this._pLoadData()");
		expect(idxTip).toBeGreaterThan(-1);
		expect(idxTip).toBeLessThan(idxLoad);
		// Hardened (observed) rather than a bare fire-and-forget.
		expect(src).toMatch(/this\._pInitLoadingTip\(\)\.catch\(/);
		expect(CONTROLLER_SRC).not.toMatch(/void this\._pInitLoadingTip\(\)/);
	});
});
