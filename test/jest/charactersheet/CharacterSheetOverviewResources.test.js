/**
 * Overview "Resources" panel — custom limited-use abilities (R42/B3).
 *
 * Bug: custom features with LIMITED USES rendered in the Features tab but were dropped from
 * the Overview "Resources" modal, so a custom-only or mixed character couldn't see or spend
 * those uses there. A prior round deliberately removed them.
 *
 * Fix (charactersheet.js `_renderResources`): append custom `mode:"limited"` abilities as
 * their own rows, mutated through `useCustomAbility` / `restoreCustomAbilityUse` (NOT the
 * generic `setResourceCurrent`, which would silently no-op on them), counted in the badge,
 * with the empty-state considering them and passive / already-pooled abilities excluded.
 *
 * This drives the REAL `CharacterSheetPage.prototype._renderResources` against a rich DOM
 * stub so the actual rows + click wiring are exercised end-to-end.
 */

import {jest} from "@jest/globals";
import "./setup.js";
import "../../../js/charactersheet/charactersheet-state.js";

const CharacterSheetState = globalThis.CharacterSheetState;

let CharacterSheetPage;
let baseDocument;
let savedWindow;
let savedE_;

/** A rich element stub: accumulates appended HTML and hands out per-selector button stubs. */
function makeEl (outer = "") {
	return {
		_html: outer,
		_children: [],
		_btns: {},
		_handlers: {},
		textContent: "",
		get innerHTML () { return this._html; },
		set innerHTML (v) { this._html = v; this._children = []; this._btns = {}; },
		get outerHTML () { return this._html; },
		append (child) {
			this._children.push(child);
			this._html += (typeof child === "string" ? child : (child._html || ""));
		},
		appendChild (child) { this.append(child); },
		querySelector (sel) {
			if (!this._btns[sel]) {
				this._btns[sel] = {
					disabled: false,
					_handlers: {},
					addEventListener (ev, h) { this._handlers[ev] = h; },
				};
			}
			return this._btns[sel];
		},
		querySelectorAll () { return []; },
		addEventListener (ev, h) { this._handlers[ev] = h; },
		setAttribute () {},
		getAttribute () { return null; },
		classList: {add () {}, remove () {}, toggle () {}, contains () { return false; }},
	};
}

const richE_ = (opts = {}) => makeEl(opts.outer || opts.html || "");

beforeAll(async () => {
	savedWindow = globalThis.window;
	savedE_ = globalThis.e_;
	// `charactersheet.js` captures `e_` from globalThis at module-load time (line 25), so the
	// rich factory MUST be installed before the dynamic import — a later reassignment would be
	// ignored by the module's already-bound `e_`.
	globalThis.e_ = richE_;
	globalThis.window = {
		addEventListener: () => {},
		dispatchEvent: () => {},
		location: {search: ""},
		matchMedia: () => ({matches: false, addEventListener: () => {}}),
	};
	globalThis.document = {
		querySelector: () => null,
		querySelectorAll: () => [],
		getElementById: () => null,
		addEventListener: () => {},
		body: {classList: {add () {}, remove () {}}},
	};
	await import("../../../js/charactersheet/charactersheet.js");
	CharacterSheetPage = globalThis.CharacterSheetPage;
	baseDocument = globalThis.document;
});

afterAll(() => {
	globalThis.window = savedWindow;
	globalThis.e_ = savedE_;
});

afterEach(() => {
	globalThis.document = baseDocument;
});

/**
 * Render the Overview Resources panel for a state and return the container + count elements
 * plus a helper to fire a row's button handler. The document stub stays installed after the
 * call so that a button handler's own `_renderResources()` re-render hits the same container;
 * `afterEach` restores the base document.
 */
function renderResources (state, pageOverrides = {}) {
	const container = makeEl();
	const countEl = makeEl();
	globalThis.document = {
		getElementById: (id) => {
			if (id === "charsheet-resources") return container;
			if (id === "charsheet-resources-count") return countEl;
			return null;
		},
	};

	const page = Object.create(CharacterSheetPage.prototype);
	page._state = state;
	page._saveCurrentCharacter = () => {};
	page._renderActiveStates = () => {};
	page._features = null;
	page._combat = null;
	page._customAbilities = null;
	Object.assign(page, pageOverrides);

	page._renderResources();

	return {page, container, countEl};
}

function fireRowButton (container, nameNeedle, selector, event = "click") {
	const row = container._children.find(c => (c._html || "").includes(nameNeedle));
	if (!row) throw new Error(`No row containing "${nameNeedle}"`);
	const btn = row._btns[selector];
	if (!btn || !btn._handlers[event]) throw new Error(`No ${event} handler for ${selector}`);
	btn._handlers[event]();
}

describe("Overview Resources — custom limited-use abilities (B3)", () => {
	test("a self-contained limited ability surfaces as a row and is counted in the badge", () => {
		const s = new CharacterSheetState();
		s.addCustomAbility({name: "Nature's Blessing", mode: "limited", uses: {max: 3, recharge: "short"}});

		const {container, countEl} = renderResources(s);
		expect(container._html).toContain("Nature's Blessing");
		expect(container._html).toContain("charsheet__resource-row--custom");
		expect(container._html).toContain("/ 3");
		expect(countEl.textContent).toBe(1);
	});

	test("clicking Use decrements via useCustomAbility (NOT setResourceCurrent)", () => {
		const s = new CharacterSheetState();
		const id = s.addCustomAbility({name: "Starfire", mode: "limited", uses: {max: 3, recharge: "long"}});

		const setResSpy = jest.spyOn(s, "setResourceCurrent");
		const useSpy = jest.spyOn(s, "useCustomAbility");

		const {container} = renderResources(s);
		expect(s.getCustomAbilityUsesDisplay(id).current).toBe(3);

		fireRowButton(container, "Starfire", ".charsheet__ability-use-btn");

		expect(useSpy).toHaveBeenCalledWith(id);
		expect(setResSpy).not.toHaveBeenCalled();
		expect(s.getCustomAbilityUsesDisplay(id).current).toBe(2);
	});

	test("clicking + restores via restoreCustomAbilityUse", () => {
		const s = new CharacterSheetState();
		const id = s.addCustomAbility({name: "Moonwell", mode: "limited", uses: {max: 2, recharge: "long"}});
		s.useCustomAbility(id); // 2 -> 1
		expect(s.getCustomAbilityUsesDisplay(id).current).toBe(1);

		const restoreSpy = jest.spyOn(s, "restoreCustomAbilityUse");
		const {container} = renderResources(s);
		fireRowButton(container, "Moonwell", ".charsheet__ability-restore-btn");

		expect(restoreSpy).toHaveBeenCalledWith(id);
		expect(s.getCustomAbilityUsesDisplay(id).current).toBe(2);
	});

	test("passive custom abilities do NOT surface in Resources", () => {
		const s = new CharacterSheetState();
		s.addCustomAbility({name: "Ironhide", mode: "passive"});

		const {container, countEl} = renderResources(s);
		expect(container._html).not.toContain("Ironhide");
		expect(container._html).not.toContain("charsheet__resource-row--custom");
		expect(countEl.textContent).toBe(0);
	});

	test("an ability linked to an already-shown pool is not double-listed as a custom row", () => {
		const s = new CharacterSheetState();
		// A real generic pool row will render; the linked ability must NOT also add a custom row.
		s._data.resources.push({id: "res_shared", name: "Shared Charges", current: 3, max: 3, recharge: "long"});
		s.addCustomAbility({
			name: "Linked Strike",
			mode: "limited",
			resourceSource: {type: "linked", resourceId: "res_shared", cost: 1},
		});

		const {container, countEl} = renderResources(s);
		// The shared pool shows once; the linked ability does not spawn a duplicate custom row.
		expect(container._html).toContain("Shared Charges");
		expect(container._html).not.toContain("Linked Strike");
		expect(container._html).not.toContain("charsheet__resource-row--custom");
		// Count = the single generic pool only (linked custom row suppressed).
		expect(countEl.textContent).toBe(1);
	});

	test("custom-only character still shows its rows (empty-state does not swallow them)", () => {
		const s = new CharacterSheetState();
		s.addCustomAbility({name: "Wildheart", mode: "limited", uses: {max: 1, recharge: "long"}});

		const {container} = renderResources(s);
		expect(container._html).not.toContain("No class-granted resources yet");
		expect(container._html).toContain("Wildheart");
	});
});
