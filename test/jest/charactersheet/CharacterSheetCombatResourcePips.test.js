/**
 * Combat Resources pip clicks (bug #9) + Arcane Shot fold-in (bugs #6/#7).
 *
 * Root cause (fixed here): renderCombatResources() wired the pip click handler via
 * `querySelector(".charsheet__resource-pip")` — only the FIRST pip got a listener,
 * so for a 2+ pip resource the rightmost pip was dead and use/restore was broken.
 *
 * These tests assert REAL mechanics, not existence:
 *  - `_computeResourcePipClickCurrent`: health-bar semantics (filled pip spends down
 *    to it; empty pip restores up to it), clamped, with edge cases.
 *  - `_onResourcePipClick`: resolves the resource, persists the computed value, and
 *    refreshes displays — for EVERY pip index, proving all pips are usable/restorable.
 *  - `_bindResourcePipClicks`: a SINGLE delegated listener routes clicks for every
 *    pip (regression guard against the "first pip only" wiring).
 *  - `_renderArcaneShotToggle`: renders inside the resources container using HOVER
 *    LINKS (no inline effect text), gated on hasArcaneShot().
 */

import "./setup.js";
import {jest} from "@jest/globals";
import "../../../js/charactersheet/charactersheet-combat.js";

const CharacterSheetCombat = globalThis.CharacterSheetCombat;

function makeCombat () {
	const combat = Object.create(CharacterSheetCombat.prototype);
	combat._page = {};
	return combat;
}

describe("_computeResourcePipClickCurrent — health-bar pip semantics", () => {
	let combat;
	beforeEach(() => { combat = makeCombat(); });

	it("clicking a filled pip spends down to (and including) that pip", () => {
		const r = {current: 3, max: 3};
		// rightmost filled pip (index 2) → use one → current 2 ("uses down to 2")
		expect(combat._computeResourcePipClickCurrent(r, 2)).toBe(2);
		// middle filled pip (index 1) → spend down to it → current 1
		expect(combat._computeResourcePipClickCurrent(r, 1)).toBe(1);
		// leftmost filled pip (index 0) → spend everything → current 0
		expect(combat._computeResourcePipClickCurrent(r, 0)).toBe(0);
	});

	it("clicking an empty pip restores up to (and including) that pip", () => {
		const r = {current: 0, max: 3};
		// leftmost empty pip (index 0) → restore one → current 1
		expect(combat._computeResourcePipClickCurrent(r, 0)).toBe(1);
		// rightmost empty pip (index 2) → restore all → current 3
		expect(combat._computeResourcePipClickCurrent(r, 2)).toBe(3);
	});

	it("the rightmost pip is both usable AND restorable (the original bug)", () => {
		// full → clicking rightmost filled pip uses one
		expect(combat._computeResourcePipClickCurrent({current: 3, max: 3}, 2)).toBe(2);
		// now rightmost is empty → clicking it restores it
		expect(combat._computeResourcePipClickCurrent({current: 2, max: 3}, 2)).toBe(3);
	});

	it("single-pip resource toggles correctly", () => {
		expect(combat._computeResourcePipClickCurrent({current: 1, max: 1}, 0)).toBe(0);
		expect(combat._computeResourcePipClickCurrent({current: 0, max: 1}, 0)).toBe(1);
	});

	it("clamps and ignores out-of-range / non-integer indices (no-op = current)", () => {
		const r = {current: 2, max: 3};
		expect(combat._computeResourcePipClickCurrent(r, 3)).toBe(2); // index === max
		expect(combat._computeResourcePipClickCurrent(r, -1)).toBe(2);
		expect(combat._computeResourcePipClickCurrent(r, 1.5)).toBe(2);
		expect(combat._computeResourcePipClickCurrent(r, NaN)).toBe(2);
	});

	it("treats an over-cap current as clamped to max", () => {
		// current somehow exceeds max → effective current is max; click filled idx
		expect(combat._computeResourcePipClickCurrent({current: 9, max: 3}, 2)).toBe(2);
	});
});

describe("_onResourcePipClick — persists computed value for every pip", () => {
	let combat;
	let resources;
	let setCalls;

	beforeEach(() => {
		combat = makeCombat();
		resources = [{id: "r1", name: "Ki", current: 3, max: 3}];
		setCalls = [];
		combat._state = {
			getResources: () => resources,
			setResourceCurrent: (id, val) => {
				setCalls.push([id, val]);
				const res = resources.find(r => r.id === id);
				if (res) res.current = val;
			},
		};
		combat._page = {_renderResources: jest.fn(), _features: {_renderResources: jest.fn()}};
		combat.renderCombatResources = jest.fn();
	});

	it("uses one when clicking the rightmost filled pip (index 2)", () => {
		combat._onResourcePipClick("r1", 2);
		expect(setCalls).toEqual([["r1", 2]]);
		expect(combat.renderCombatResources).toHaveBeenCalledTimes(1);
		expect(combat._page._renderResources).toHaveBeenCalledTimes(1);
		expect(combat._page._features._renderResources).toHaveBeenCalledTimes(1);
	});

	it("each pip index routes to the correct new value (all pips alive)", () => {
		resources[0].current = 3;
		combat._onResourcePipClick("r1", 0); // spend everything
		expect(setCalls.at(-1)).toEqual(["r1", 0]);
		combat._onResourcePipClick("r1", 2); // restore up to rightmost
		expect(setCalls.at(-1)).toEqual(["r1", 3]);
		combat._onResourcePipClick("r1", 1); // spend down to middle
		expect(setCalls.at(-1)).toEqual(["r1", 1]);
	});

	it("no-ops when the computed value equals current (out-of-range pip index)", () => {
		resources[0].current = 2;
		// index === max (3) is out of range → computed equals current → no-op
		combat._onResourcePipClick("r1", 3);
		expect(setCalls).toEqual([]);
		expect(combat.renderCombatResources).not.toHaveBeenCalled();
	});

	it("no-ops for an unknown resource id", () => {
		combat._onResourcePipClick("does-not-exist", 0);
		expect(setCalls).toEqual([]);
		expect(combat.renderCombatResources).not.toHaveBeenCalled();
	});
});

describe("_bindResourcePipClicks — single delegated listener handles every pip", () => {
	let combat;
	let captured;
	let pipsEl;

	beforeEach(() => {
		combat = makeCombat();
		captured = null;
		pipsEl = {
			addEventListener: (type, fn) => { if (type === "click") captured = fn; },
			contains: () => true,
		};
		combat._onResourcePipClick = jest.fn();
	});

	function clickPip (idx) {
		const fakePip = {dataset: {pipIndex: String(idx)}};
		captured({target: {closest: (sel) => (sel === ".charsheet__resource-pip" ? fakePip : null)}});
	}

	it("registers exactly one click listener on the pips container", () => {
		const spy = jest.spyOn(pipsEl, "addEventListener");
		combat._bindResourcePipClicks(pipsEl, "r1");
		expect(spy).toHaveBeenCalledTimes(1);
		expect(spy.mock.calls[0][0]).toBe("click");
	});

	it("routes a click on ANY pip (0,1,2) to _onResourcePipClick with the right index", () => {
		combat._bindResourcePipClicks(pipsEl, "r1");
		clickPip(0);
		clickPip(1);
		clickPip(2);
		expect(combat._onResourcePipClick).toHaveBeenNthCalledWith(1, "r1", 0);
		expect(combat._onResourcePipClick).toHaveBeenNthCalledWith(2, "r1", 1);
		expect(combat._onResourcePipClick).toHaveBeenNthCalledWith(3, "r1", 2);
	});

	it("ignores clicks that are not on a pip", () => {
		combat._bindResourcePipClicks(pipsEl, "r1");
		captured({target: {closest: () => null}});
		expect(combat._onResourcePipClick).not.toHaveBeenCalled();
	});

	it("does not throw when the pips container is missing", () => {
		expect(() => combat._bindResourcePipClicks(null, "r1")).not.toThrow();
	});
});

describe("_renderArcaneShotToggle — folded into Combat Resources with hover links", () => {
	let combat;

	function baseState (overrides = {}) {
		return {
			hasArcaneShot: () => true,
			getArcaneShotMax: () => 4,
			getArcaneShotRemaining: () => 3,
			getKnownArcaneShots: () => [{name: "Grasping Arrow", source: "XGE", description: "<p>VERBOSE EFFECT TEXT</p>", entries: ["VERBOSE EFFECT TEXT"]}],
			getFeatureCalculations: () => ({arcaneShotSaveDc: 15, arcaneShotAbility: "int", hasEverReadyShot: false, hasMagicArrow: true, hasCurvingShot: false}),
			...overrides,
		};
	}

	beforeEach(() => {
		combat = makeCombat();
		combat._state = baseState();
		combat._page = {
			getHoverLink: jest.fn((page, name, source) => `<a class="hover-link" data-page="${page}" data-source="${source}">${name}</a>`),
		};
	});

	it("appends nothing when the character is not an Arcane Archer", () => {
		combat._state = baseState({hasArcaneShot: () => false});
		const container = e_({outer: "<div></div>"});
		combat._renderArcaneShotToggle(container);
		expect(container.innerHTML).not.toContain("charsheet__arcane-shot-section");
	});

	it("renders the Arcane Shot section with uses badge and known shots", () => {
		const container = e_({outer: "<div></div>"});
		combat._renderArcaneShotToggle(container);
		expect(container.innerHTML).toContain("charsheet__arcane-shot-section");
		expect(container.innerHTML).toContain("Arcane Shot");
		expect(container.innerHTML).toContain("3/4"); // remaining/max
		expect(container.innerHTML).toContain("DC 15");
	});

	it("uses a hover link for the shot name and DROPS the inline effect text", () => {
		const container = e_({outer: "<div></div>"});
		combat._renderArcaneShotToggle(container);
		expect(combat._page.getHoverLink).toHaveBeenCalledWith(globalThis.UrlUtil.PG_OPT_FEATURES, "Grasping Arrow", "XGE");
		expect(container.innerHTML).toContain(`class="hover-link"`);
		expect(container.innerHTML).toContain("Grasping Arrow");
		// The verbose inline description must NOT be reproduced inline anymore.
		expect(container.innerHTML).not.toContain("VERBOSE EFFECT TEXT");
	});
});

describe("renderCombatResources — empty-state suppression (fold-in)", () => {
	let combat;
	let container;
	let children;

	beforeEach(() => {
		children = [];
		container = {
			innerHTML: "",
			append: (...els) => { children.push(...els); },
			querySelector: () => null,
			get children () { return children; },
		};
		global.document = {getElementById: (id) => (id === "charsheet-combat-resources" ? container : null)};
		combat = makeCombat();
		// Instance fields normally initialised in the constructor; the supplemental
		// toggles read these before their early-returns.
		combat._weaponRiderEnabled = {};
		combat._selectedCunningStrikes = [];
	});

	afterEach(() => { delete global.document; });

	function arcaneState (overrides = {}) {
		return {
			getResources: () => [],
			hasArcaneShot: () => true,
			getArcaneShotMax: () => 4,
			getArcaneShotRemaining: () => 3,
			getKnownArcaneShots: () => [{name: "Grasping Arrow", source: "XGE", description: "", entries: []}],
			getFeatureCalculations: () => ({arcaneShotSaveDc: 15, arcaneShotAbility: "int"}),
			...overrides,
		};
	}

	it("suppresses 'No combat resources' when only Arcane Shot renders", () => {
		combat._state = arcaneState();
		combat._page = {getHoverLink: (p, n) => n};
		combat.renderCombatResources();
		expect(container.innerHTML).not.toContain("No combat resources");
		expect(children.length).toBe(1);
		expect(children[0]._html).toContain("charsheet__arcane-shot-section");
	});

	it("shows 'No combat resources' when nothing at all renders", () => {
		combat._state = {
			getResources: () => [],
			hasArcaneShot: () => false,
			getFeatureCalculations: () => ({}),
		};
		combat._page = {};
		combat.renderCombatResources();
		expect(container.innerHTML).toContain("No combat resources");
		expect(children.length).toBe(0);
	});
});
