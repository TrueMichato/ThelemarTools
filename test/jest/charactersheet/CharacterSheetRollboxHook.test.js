/**
 * Bug #5 — the floating rollbox (core `Renderer.dice`) never touched the
 * character sheet's 3D dice engine, so notations typed there (e.g. `3d6`) or
 * dice tags clicked produced no 3D dice.
 *
 * The fix is an additive, generic hook on `Renderer.dice`:
 *   - the Dice AST records the ACTUAL per-die faces it rolled into `meta.dice`
 *     (`[{faces, vals:[…]}]`, kept/non-dropped values only);
 *   - a static hook registry (`addRollRenderedHook` / `removeRollRenderedHook` /
 *     `_notifyRollRendered`) fans out `{tree, result, meta, rolledBy, opts}`
 *     after each rollbox roll; empty by default so other site pages are
 *     unaffected.
 * The character sheet registers one hook that maps `meta.dice` →
 * `{sides, values}` groups → `pAnimateDiceSpec`. These tests pin the engine
 * side: registry semantics + `meta.dice` reflecting the real rolled values +
 * the notation→groups mapping the sheet performs.
 */

import "./setup.js";
import "../../../js/render-dice.js";

const Renderer = globalThis.Renderer;

// The Dice AST evaluates faces via `RollerUtil.randomise(faces)`. The shared
// charactersheet setup mock only stubs `isCrypto`, so provide a real uniform
// integer roller here (each suite gets its own module/global scope).
beforeAll(() => {
	globalThis.RollerUtil = globalThis.RollerUtil || {};
	globalThis.RollerUtil.randomise = (max, min = 1) => {
		const lo = Math.ceil(min);
		const hi = Math.floor(max);
		if (lo > hi) return 0;
		return lo + Math.floor(Math.random() * (hi - lo + 1));
	};
	// render-dice's AST eval relies on 5etools' Array.prototype extensions
	// (defined in js/utils.js, which the charactersheet test env deliberately
	// does not load). Provide the minimal set the eval path uses.
	if (!Array.prototype.sum) {
		Object.defineProperty(Array.prototype, "sum", {
			value (start = 0) { return this.reduce((a, b) => a + b, start); },
			writable: true,
			configurable: true,
		});
	}
	if (!Array.prototype.last) {
		Object.defineProperty(Array.prototype, "last", {
			value (val) { if (val !== undefined) { this[this.length - 1] = val; return val; } return this[this.length - 1]; },
			writable: true,
			configurable: true,
		});
	}
	// The drop/keep modifier path (`4d6dl1`) sorts via SortUtil.
	globalThis.SortUtil = globalThis.SortUtil || {};
	if (!globalThis.SortUtil.ascSortProp) {
		globalThis.SortUtil.ascSortProp = (prop, a, b) => (a[prop] < b[prop] ? -1 : a[prop] > b[prop] ? 1 : 0);
	}
});

/** Replicates the character sheet's `meta.dice` → 3D groups mapping (charactersheet.js `_initRollboxDiceHook`). */
function mapMetaDiceToGroups (meta) {
	const diceMeta = meta && Array.isArray(meta.dice) ? meta.dice : null;
	if (!diceMeta || !diceMeta.length) return [];
	return diceMeta
		.map(d => ({sides: Number(d.faces), values: (Array.isArray(d.vals) ? d.vals : []).map(Number).filter(Number.isFinite)}))
		.filter(g => Number.isFinite(g.sides) && g.values.length);
}

describe("Renderer.dice roll-rendered hook registry (#5)", () => {
	afterEach(() => {
		// Ensure no leaked hooks across tests.
		Renderer.dice._rollRenderedHooks.length = 0;
	});

	test("exposes a registry that defaults to empty (other pages unaffected)", () => {
		expect(Array.isArray(Renderer.dice._rollRenderedHooks)).toBe(true);
		expect(Renderer.dice._rollRenderedHooks.length).toBe(0);
		expect(typeof Renderer.dice.addRollRenderedHook).toBe("function");
		expect(typeof Renderer.dice.removeRollRenderedHook).toBe("function");
	});

	test("addRollRenderedHook registers, fires on _notifyRollRendered, and dedups", () => {
		const seen = [];
		const fn = (payload) => seen.push(payload);
		Renderer.dice.addRollRenderedHook(fn);
		Renderer.dice.addRollRenderedHook(fn); // duplicate -> ignored
		expect(Renderer.dice._rollRenderedHooks.length).toBe(1);

		Renderer.dice._notifyRollRendered({result: 7, meta: {dice: []}});
		expect(seen.length).toBe(1);
		expect(seen[0].result).toBe(7);
	});

	test("the returned unsubscribe fn removes the hook", () => {
		const fn = () => {};
		const off = Renderer.dice.addRollRenderedHook(fn);
		expect(Renderer.dice._rollRenderedHooks.length).toBe(1);
		off();
		expect(Renderer.dice._rollRenderedHooks.length).toBe(0);
	});

	test("a throwing hook never breaks _notifyRollRendered or other hooks", () => {
		// Production surfaces a hook error via `setTimeout(() => { throw e; })` so
		// it's visible without breaking the fan-out loop. Stub setTimeout so that
		// deferred re-throw doesn't escape into the test runner.
		const origSetTimeout = globalThis.setTimeout;
		globalThis.setTimeout = () => 0;
		try {
			const seen = [];
			Renderer.dice.addRollRenderedHook(() => { throw new Error("boom"); });
			Renderer.dice.addRollRenderedHook(() => seen.push("ok"));
			expect(() => Renderer.dice._notifyRollRendered({result: 1, meta: {}})).not.toThrow();
			expect(seen).toEqual(["ok"]);
		} finally {
			globalThis.setTimeout = origSetTimeout;
		}
	});

	test("addRollRenderedHook ignores non-functions", () => {
		const off = Renderer.dice.addRollRenderedHook(null);
		expect(typeof off).toBe("function");
		expect(Renderer.dice._rollRenderedHooks.length).toBe(0);
	});
});

describe("Dice AST records real rolled faces into meta.dice (#5)", () => {
	function evalNotation (str, meta) {
		const wrpTree = Renderer.dice.lang.getTree3(str);
		expect(wrpTree).toBeTruthy();
		return wrpTree.tree.evl(meta);
	}

	test("a single dice term records one group with all kept faces", () => {
		const meta = {};
		const total = evalNotation("3d6", meta);
		expect(Array.isArray(meta.dice)).toBe(true);
		const group = meta.dice.find(d => d.faces === 6);
		expect(group).toBeTruthy();
		expect(group.vals.length).toBe(3);
		// Every recorded face is a valid d6 result.
		for (const v of group.vals) { expect(v).toBeGreaterThanOrEqual(1); expect(v).toBeLessThanOrEqual(6); }
		// The recorded faces sum to the total (no modifier in this notation).
		expect(group.vals.reduce((a, b) => a + b, 0)).toBe(total);
	});

	test("mixed dice (1d8 + 2d6) record one group per term with correct faces", () => {
		const meta = {};
		evalNotation("1d8 + 2d6", meta);
		const groups = mapMetaDiceToGroups(meta);
		const d8 = groups.find(g => g.sides === 8);
		const d6 = groups.find(g => g.sides === 6);
		expect(d8).toBeTruthy();
		expect(d6).toBeTruthy();
		expect(d8.values.length).toBe(1);
		expect(d6.values.length).toBe(2);
		for (const v of d8.values) { expect(v).toBeGreaterThanOrEqual(1); expect(v).toBeLessThanOrEqual(8); }
		for (const v of d6.values) { expect(v).toBeGreaterThanOrEqual(1); expect(v).toBeLessThanOrEqual(6); }
	});

	test("kept faces exclude dropped dice (e.g. keep-highest)", () => {
		const meta = {};
		// 4d6dl1 (drop lowest) keeps 3 dice.
		evalNotation("4d6dl1", meta);
		const group = (meta.dice || []).find(d => d.faces === 6);
		expect(group).toBeTruthy();
		expect(group.vals.length).toBe(3);
	});

	test("the sheet's mapping turns meta.dice into {sides, values} groups with real values", () => {
		const meta = {};
		const total = evalNotation("2d10", meta);
		const groups = mapMetaDiceToGroups(meta);
		expect(groups.length).toBe(1);
		expect(groups[0].sides).toBe(10);
		expect(groups[0].values.length).toBe(2);
		expect(groups[0].values.reduce((a, b) => a + b, 0)).toBe(total);
	});
});
