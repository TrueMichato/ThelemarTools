/**
 * Tests for the 3D dice roller helper (CharacterSheetDice3d).
 *
 * The real renderer needs WebGL, which jsdom/node cannot provide, so we mock
 * the injectable DiceBox factory and a minimal DOM and assert the WIRING:
 * settings/capability gating, deterministic notation, theme mapping, the
 * fallback paths (missing lib / no WebGL / unsupported die / init or roll
 * failure), and that every roll's Promise ALWAYS resolves (timeout,
 * click-dismiss, throw, reject, never-settle).
 */

import "./setup.js";
import "../../../js/charactersheet/charactersheet-dice3d.js";
import {readFileSync} from "fs";
import {resolve, dirname} from "path";
import {fileURLToPath} from "url";

const _REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

const CharacterSheetDice3d = globalThis.CharacterSheetDice3d;

// ---------------------------------------------------------------------------
// Minimal fake DOM (node test environment has no document)
// ---------------------------------------------------------------------------
function makeClassList () {
	const set = new Set();
	return {
		add: (...cls) => cls.forEach(c => set.add(c)),
		remove: (...cls) => cls.forEach(c => set.delete(c)),
		contains: (c) => set.has(c),
		toString: () => [...set].join(" "),
	};
}

function makeEl (tag) {
	const listeners = {};
	const el = {
		tagName: tag,
		className: "",
		id: "",
		textContent: "",
		children: [],
		parentNode: null,
		classList: makeClassList(),
		style: {},
		appendChild (child) { child.parentNode = el; el.children.push(child); return child; },
		removeChild (child) {
			const i = el.children.indexOf(child);
			if (i >= 0) el.children.splice(i, 1);
			child.parentNode = null;
			return child;
		},
		querySelector () { return null; },
		addEventListener (type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
		removeEventListener (type, fn) {
			if (!listeners[type]) return;
			listeners[type] = listeners[type].filter(f => f !== fn);
		},
		getContext (type) {
			if (tag !== "canvas") return null;
			return el._webglOk && (type === "webgl2" || type === "webgl" || type === "experimental-webgl") ? {} : null;
		},
		_fire (type) { (listeners[type] || []).slice().forEach(fn => fn({preventDefault () {}})); },
		_listeners: listeners,
	};
	return el;
}

function installFakeDom ({webgl = true} = {}) {
	const body = makeEl("body");
	global.document = {
		_webgl: webgl,
		body,
		createElement (tag) {
			const el = makeEl(tag);
			if (tag === "canvas") el._webglOk = webgl;
			return el;
		},
	};
}

function installMatchMedia (reduced) {
	global.matchMedia = (q) => ({matches: reduced && /prefers-reduced-motion/.test(q)});
	globalThis.matchMedia = global.matchMedia;
}

// ---------------------------------------------------------------------------
// Fake DiceBox factory (the vendored library stand-in)
// ---------------------------------------------------------------------------
function makeFakeFactory (opts = {}) {
	const calls = {construct: [], initialize: 0, updateConfig: [], roll: [], clearDice: 0, destroy: 0};
	function FakeBox (selector, config) {
		calls.construct.push({selector, config});
		this.config = config;
	}
	FakeBox.prototype.initialize = async function () {
		calls.initialize++;
		if (opts.failInit) throw new Error("init fail");
	};
	FakeBox.prototype.updateConfig = async function (cfg) { calls.updateConfig.push(cfg); };
	FakeBox.prototype.roll = function (notation) {
		calls.roll.push(notation);
		if (opts.rollThrowSync) throw new Error("roll threw");
		if (opts.rollReject) return Promise.reject(new Error("roll rejected"));
		if (opts.neverResolve) return new Promise(() => {});
		return Promise.resolve({total: 1});
	};
	FakeBox.prototype.clearDice = function () { calls.clearDice++; };
	FakeBox.prototype.destroy = function () { calls.destroy++; };
	FakeBox._calls = calls;
	return FakeBox;
}

function fastTimings () {
	CharacterSheetDice3d._SETTLE_MS = 1;
	CharacterSheetDice3d._CRIT_SETTLE_MS = 1;
	CharacterSheetDice3d._FADE_MS = 1;
	CharacterSheetDice3d._ROLL_TIMEOUT_MS = 30;
}

describe("CharacterSheetDice3d", () => {
	const ORIG = {
		settle: CharacterSheetDice3d._SETTLE_MS,
		crit: CharacterSheetDice3d._CRIT_SETTLE_MS,
		fade: CharacterSheetDice3d._FADE_MS,
		timeout: CharacterSheetDice3d._ROLL_TIMEOUT_MS,
	};

	beforeEach(() => {
		installFakeDom({webgl: true});
		installMatchMedia(false);
		fastTimings();
		delete globalThis[CharacterSheetDice3d.GLOBAL_KEY];
	});

	afterEach(() => {
		CharacterSheetDice3d._SETTLE_MS = ORIG.settle;
		CharacterSheetDice3d._CRIT_SETTLE_MS = ORIG.crit;
		CharacterSheetDice3d._FADE_MS = ORIG.fade;
		CharacterSheetDice3d._ROLL_TIMEOUT_MS = ORIG.timeout;
		delete global.document;
		delete global.matchMedia;
		delete globalThis.matchMedia;
		delete globalThis[CharacterSheetDice3d.GLOBAL_KEY];
	});

	// --- static capability probes ------------------------------------------
	describe("static probes", () => {
		test("isReducedMotion reflects matchMedia", () => {
			installMatchMedia(true);
			expect(CharacterSheetDice3d.isReducedMotion()).toBe(true);
			installMatchMedia(false);
			expect(CharacterSheetDice3d.isReducedMotion()).toBe(false);
		});

		test("isWebglAvailable true when a context is returned", () => {
			installFakeDom({webgl: true});
			expect(CharacterSheetDice3d.isWebglAvailable()).toBe(true);
		});

		test("isWebglAvailable false when no context", () => {
			installFakeDom({webgl: false});
			expect(CharacterSheetDice3d.isWebglAvailable()).toBe(false);
		});
	});

	// --- gating -------------------------------------------------------------
	describe("canRender gating", () => {
		test("false when the library global is missing", () => {
			const d = new CharacterSheetDice3d({});
			expect(d.canRender(20)).toBe(false);
		});

		test("false for an unsupported die (d100 -> legacy)", () => {
			const d = new CharacterSheetDice3d({diceBoxFactory: makeFakeFactory()});
			expect(d.isSupportedDie(100)).toBe(false);
			expect(d.canRender(100)).toBe(false);
		});

		test("false when WebGL is unavailable", () => {
			installFakeDom({webgl: false});
			const d = new CharacterSheetDice3d({diceBoxFactory: makeFakeFactory()});
			expect(d.canRender(20)).toBe(false);
		});

		test("true when factory present, die supported, WebGL ok", () => {
			const d = new CharacterSheetDice3d({diceBoxFactory: makeFakeFactory()});
			expect(d.canRender(20)).toBe(true);
		});

		test("picks up the factory from the global when not injected", () => {
			globalThis[CharacterSheetDice3d.GLOBAL_KEY] = makeFakeFactory();
			const d = new CharacterSheetDice3d({});
			expect(d.canRender(20)).toBe(true);
		});
	});

	// --- theme mapping ------------------------------------------------------
	describe("theme mapping", () => {
		test("every theme maps to a plain hex colorset (no CSS gradients)", () => {
			const d = new CharacterSheetDice3d({});
			const HEX = /^#[0-9a-fA-F]{6}$/;
			for (const key of Object.keys(CharacterSheetDice3d.THEMES)) {
				const cs = d._buildColorset(key);
				expect(cs.name).toContain(key);
				// Every colour-bearing field the WebGL lib consumes must be plain hex.
				expect(cs.background).toMatch(HEX);
				expect(cs.foreground).toMatch(HEX);
				expect(cs.outline).toMatch(HEX);
				expect(cs.edge).toMatch(HEX);
				expect(typeof cs.texture).toBe("string");
				expect(["none", "metal", "wood", "glass", "plastic"]).toContain(cs.material);
				// No CSS colour syntax may leak into any field (would break three.js).
				const serialized = JSON.stringify(cs);
				expect(serialized).not.toMatch(/linear-gradient|radial-gradient|rgba?\(/i);
			}
		});

		test("unknown theme falls back to standard", () => {
			const d = new CharacterSheetDice3d({});
			expect(d._buildColorset("does-not-exist").background)
				.toBe(CharacterSheetDice3d.THEMES.standard.background);
		});
	});

	// --- happy path ---------------------------------------------------------
	describe("pRoll happy path", () => {
		test("rolls deterministic notation and resolves", async () => {
			const factory = makeFakeFactory();
			const d = new CharacterSheetDice3d({diceBoxFactory: factory});
			await d.pRoll({diceType: 20, finalValue: 17, theme: "blue"});
			expect(factory._calls.initialize).toBe(1);
			expect(factory._calls.roll).toContain("1d20@17");
		});

		test("applies the mapped theme via updateConfig when theme changes", async () => {
			const factory = makeFakeFactory();
			const d = new CharacterSheetDice3d({diceBoxFactory: factory});
			await d.pRoll({diceType: 20, finalValue: 10, theme: "inferno"});
			const applied = factory._calls.updateConfig.find(c => c.theme_customColorset);
			expect(applied).toBeTruthy();
			expect(applied.theme_customColorset.background)
				.toBe(CharacterSheetDice3d.THEMES.inferno.background);
		});

		test("reuses one DiceBox instance across rolls (warm singleton)", async () => {
			const factory = makeFakeFactory();
			const d = new CharacterSheetDice3d({diceBoxFactory: factory});
			await d.pRoll({diceType: 20, finalValue: 5, theme: "standard"});
			await d.pRoll({diceType: 6, finalValue: 4, theme: "standard"});
			expect(factory._calls.construct.length).toBe(1);
			expect(factory._calls.initialize).toBe(1);
			expect(factory._calls.roll).toEqual(["1d20@5", "1d6@4"]);
		});

		test("passes the offline relative assetPath to the library", async () => {
			const factory = makeFakeFactory();
			const d = new CharacterSheetDice3d({diceBoxFactory: factory});
			await d.pRoll({diceType: 20, finalValue: 1, theme: "standard"});
			expect(factory._calls.construct[0].config.assetPath)
				.toBe("lib/dice-box-threejs-assets/");
			expect(factory._calls.construct[0].config.sounds).toBe(false);
		});
	});

	// --- always resolves ----------------------------------------------------
	describe("pRoll always resolves", () => {
		test("resolves via the hard timeout when physics never settle", async () => {
			const factory = makeFakeFactory({neverResolve: true});
			const d = new CharacterSheetDice3d({diceBoxFactory: factory});
			await expect(d.pRoll({diceType: 20, finalValue: 12, theme: "standard"}))
				.resolves.toBeUndefined();
		});

		test("resolves when roll() throws synchronously", async () => {
			const factory = makeFakeFactory({rollThrowSync: true});
			const d = new CharacterSheetDice3d({diceBoxFactory: factory});
			await expect(d.pRoll({diceType: 20, finalValue: 8, theme: "standard"}))
				.resolves.toBeUndefined();
		});

		test("resolves when roll() rejects asynchronously", async () => {
			const factory = makeFakeFactory({rollReject: true});
			const d = new CharacterSheetDice3d({diceBoxFactory: factory});
			await expect(d.pRoll({diceType: 20, finalValue: 8, theme: "standard"}))
				.resolves.toBeUndefined();
		});

		test("click on the overlay dismisses and resolves early", async () => {
			const factory = makeFakeFactory({neverResolve: true});
			const d = new CharacterSheetDice3d({diceBoxFactory: factory});
			const p = d.pRoll({diceType: 20, finalValue: 3, theme: "standard"});
			// Overlay exists after init; simulate a user click to dismiss.
			await new Promise(r => setTimeout(r, 5));
			d._overlay._fire("click");
			await expect(p).resolves.toBeUndefined();
		});

		test("a new roll force-settles the previous in-flight roll", async () => {
			const factory = makeFakeFactory({neverResolve: true});
			const d = new CharacterSheetDice3d({diceBoxFactory: factory});
			const p1 = d.pRoll({diceType: 20, finalValue: 2, theme: "standard"});
			await new Promise(r => setTimeout(r, 5));
			const p2 = d.pRoll({diceType: 20, finalValue: 9, theme: "standard"});
			await expect(p1).resolves.toBeUndefined();
			await expect(p2).resolves.toBeUndefined();
		});
	});

	// --- failure / fallback seams ------------------------------------------
	describe("failure handling", () => {
		test("pRoll rejects and marks unavailable when initialize() fails", async () => {
			const factory = makeFakeFactory({failInit: true});
			const d = new CharacterSheetDice3d({diceBoxFactory: factory});
			await expect(d.pRoll({diceType: 20, finalValue: 4, theme: "standard"}))
				.rejects.toBeTruthy();
			// Session-down: caller should now fall back without retrying 3D.
			expect(d.canRender(20)).toBe(false);
			expect(d._unavailable).toBe(true);
		});

		test("pRoll rejects for an unsupported die so caller can fall back", async () => {
			const factory = makeFakeFactory();
			const d = new CharacterSheetDice3d({diceBoxFactory: factory});
			await expect(d.pRoll({diceType: 100, finalValue: 37, theme: "standard"}))
				.rejects.toBeTruthy();
			expect(factory._calls.construct.length).toBe(0);
		});

		test("destroy() tears down and is safe to call twice", async () => {
			const factory = makeFakeFactory();
			const d = new CharacterSheetDice3d({diceBoxFactory: factory});
			await d.pRoll({diceType: 20, finalValue: 6, theme: "standard"});
			d.destroy();
			expect(factory._calls.destroy).toBe(1);
			expect(() => d.destroy()).not.toThrow();
		});
	});
});

// ---------------------------------------------------------------------------
// Boundary contract: CharacterSheet.pAnimateDiceSpec(...) + _showAnimatedDice
//
// The roll handlers funnel through `pAnimateDiceSpec({groups})` (and the
// `_showAnimatedDice(diceType, finalValue)` thin wrapper). The contract is that
// it ALWAYS resolves, no-ops when the `animatedDice` setting is off, plays the
// roll sound when enabled, honours reduced-motion, attempts the 3D roller for
// the renderable groups, and falls back to the legacy CSS animation on ANY
// failure. We cannot import the 14k-line controller, so per the repo's
// source-pin convention we exercise a faithful replica of the method body and
// pin it against production with a regex so the two cannot silently drift.
// ---------------------------------------------------------------------------
async function _pAnimateDiceSpecReplica ({groups, isAdvantage = false, isDisadvantage = false} = {}) {
	const settings = this._state?.getSettings?.() || {};
	if (!settings.animatedDice) return;

	const cleanGroups = (Array.isArray(groups) ? groups : [])
		.map(g => g ? {sides: Number(g.sides), values: (Array.isArray(g.values) ? g.values : []).map(Number).filter(Number.isFinite)} : null)
		.filter(g => g && Number.isFinite(g.sides) && g.values.length);
	if (!cleanGroups.length) return;

	const Dice3d = globalThis.CharacterSheetDice3d;
	if (settings.diceSound !== false && Dice3d && typeof Dice3d.playRollSound === "function") {
		const dieCount = cleanGroups.reduce((acc, g) => acc + g.values.length, 0);
		Dice3d.playRollSound(0.35, dieCount);
	}
	if (Dice3d && typeof Dice3d.isReducedMotion === "function" && Dice3d.isReducedMotion()) return;

	const theme = settings.diceTheme || "standard";
	try {
		const dice3d = this._getDice3d();
		if (dice3d && cleanGroups.every(g => dice3d.canRender(g.sides))) {
			await dice3d.pRollMany({groups: cleanGroups, theme});
			return;
		}
	} catch (e) {
		/* fall through to legacy */
	}
	const primary = cleanGroups.find(g => g.sides !== 100) || cleanGroups[0];
	await this._showLegacyDice(primary.sides, primary.values[0], isAdvantage, isDisadvantage);
}

function makeHarness ({dice3d = undefined, getDice3dThrows = false, theme = "gold", animatedDice = true, diceSound = undefined} = {}) {
	const calls = {getDice3d: 0, pRollMany: [], legacy: [], sound: []};
	const settings = {diceTheme: theme, animatedDice};
	if (diceSound !== undefined) settings.diceSound = diceSound;
	const harness = {
		_state: {getSettings: () => settings},
		_getDice3d () {
			calls.getDice3d++;
			if (getDice3dThrows) throw new Error("getDice3d threw");
			return dice3d === undefined ? null : dice3d;
		},
		async _showLegacyDice (diceType, finalValue, isAdvantage, isDisadvantage) {
			calls.legacy.push({diceType, finalValue, isAdvantage, isDisadvantage});
		},
	};
	return {harness, calls, settings};
}

describe("CharacterSheet.pAnimateDiceSpec boundary contract", () => {
	let _origPlaySound;
	const soundCalls = [];

	beforeEach(() => {
		installMatchMedia(false);
		globalThis.CharacterSheetDice3d = CharacterSheetDice3d;
		soundCalls.length = 0;
		_origPlaySound = CharacterSheetDice3d.playRollSound;
		CharacterSheetDice3d.playRollSound = (vol, n) => soundCalls.push({vol, n});
	});

	afterEach(() => {
		CharacterSheetDice3d.playRollSound = _origPlaySound;
		globalThis.CharacterSheetDice3d = CharacterSheetDice3d;
	});

	test("source-pin: _showAnimatedDice delegates to pAnimateDiceSpec", () => {
		const src = readFileSync(resolve(_REPO_ROOT, "js/charactersheet/charactersheet.js"), "utf8");
		const match = src.match(/async _showAnimatedDice \(diceType, finalValue[\s\S]*?\n\t\}/);
		expect(match).not.toBeNull();
		expect(match[0]).toMatch(/pAnimateDiceSpec/);
		expect(match[0]).toMatch(/groups/);
	});

	test("source-pin: pAnimateDiceSpec keeps the gate / sound / 3D / legacy branches", () => {
		const src = readFileSync(resolve(_REPO_ROOT, "js/charactersheet/charactersheet.js"), "utf8");
		const match = src.match(/async pAnimateDiceSpec \(\{groups[\s\S]*?\n\t\}/);
		expect(match).not.toBeNull();
		const body = match[0];
		expect(body).toMatch(/animatedDice/);
		expect(body).toMatch(/playRollSound/);
		expect(body).toMatch(/isReducedMotion/);
		expect(body).toMatch(/_getDice3d\(\)/);
		expect(body).toMatch(/canRender/);
		expect(body).toMatch(/pRollMany/);
		expect(body).toMatch(/catch/);
		expect(body).toMatch(/_showLegacyDice/);
	});

	test("no-op (no 3D, no legacy, no sound) when animatedDice is off", async () => {
		const {harness, calls} = makeHarness({animatedDice: false});
		await expect(_pAnimateDiceSpecReplica.call(harness, {groups: [{sides: 20, values: [17]}]})).resolves.toBeUndefined();
		expect(calls.getDice3d).toBe(0);
		expect(calls.legacy.length).toBe(0);
		expect(soundCalls.length).toBe(0);
	});

	test("plays the roll sound (die count = total dice) when enabled", async () => {
		const dice3d = {canRender: () => true, pRollMany: async () => {}};
		const {harness} = makeHarness({dice3d});
		await _pAnimateDiceSpecReplica.call(harness, {groups: [{sides: 4, values: [1, 2, 3]}, {sides: 6, values: [5]}]});
		expect(soundCalls.length).toBe(1);
		expect(soundCalls[0].n).toBe(4);
	});

	test("does not play the roll sound when diceSound is false", async () => {
		const dice3d = {canRender: () => true, pRollMany: async () => {}};
		const {harness} = makeHarness({dice3d, diceSound: false});
		await _pAnimateDiceSpecReplica.call(harness, {groups: [{sides: 20, values: [10]}]});
		expect(soundCalls.length).toBe(0);
	});

	test("prefers-reduced-motion short-circuits the visual but sound still plays", async () => {
		installMatchMedia(true);
		const {harness, calls} = makeHarness();
		await expect(_pAnimateDiceSpecReplica.call(harness, {groups: [{sides: 20, values: [17]}]})).resolves.toBeUndefined();
		expect(calls.getDice3d).toBe(0);
		expect(calls.legacy.length).toBe(0);
		expect(soundCalls.length).toBe(1);
	});

	test("happy path: rolls the multi-die groups in 3D, skips legacy", async () => {
		const rollCalls = [];
		const dice3d = {canRender: () => true, pRollMany: async (a) => { rollCalls.push(a); }};
		const {harness, calls} = makeHarness({dice3d, theme: "gold"});
		const groups = [{sides: 4, values: [1, 3, 2]}];
		await expect(_pAnimateDiceSpecReplica.call(harness, {groups})).resolves.toBeUndefined();
		expect(rollCalls).toEqual([{groups: [{sides: 4, values: [1, 3, 2]}], theme: "gold"}]);
		expect(calls.legacy.length).toBe(0);
	});

	test("missing 3D helper falls back to legacy with the primary die and resolves", async () => {
		const {harness, calls} = makeHarness({dice3d: null});
		await expect(_pAnimateDiceSpecReplica.call(harness, {groups: [{sides: 6, values: [4, 2]}]})).resolves.toBeUndefined();
		expect(calls.legacy).toEqual([{diceType: 6, finalValue: 4, isAdvantage: false, isDisadvantage: false}]);
	});

	test("pRollMany rejection is caught and falls back to legacy (never throws)", async () => {
		const dice3d = {canRender: () => true, pRollMany: async () => { throw new Error("3D blew up"); }};
		const {harness, calls} = makeHarness({dice3d});
		await expect(_pAnimateDiceSpecReplica.call(harness, {groups: [{sides: 20, values: [1]}], isAdvantage: true})).resolves.toBeUndefined();
		expect(calls.legacy).toEqual([{diceType: 20, finalValue: 1, isAdvantage: true, isDisadvantage: false}]);
	});

	test("a throw from _getDice3d is caught and falls back to legacy", async () => {
		const {harness, calls} = makeHarness({getDice3dThrows: true});
		await expect(_pAnimateDiceSpecReplica.call(harness, {groups: [{sides: 8, values: [5]}]})).resolves.toBeUndefined();
		expect(calls.legacy.length).toBe(1);
	});
});
