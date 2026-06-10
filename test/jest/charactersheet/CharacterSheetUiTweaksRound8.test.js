/**
 * Round-8 UI tweaks:
 *  #3  Hunter's Dodge use-button row now shares the ranger-section look via the
 *      self-contained `.charsheet__ranger-ability-row--action` class (both render
 *      surfaces), instead of the detached `ve-flex-v-center gap-2 mb-2` utilities.
 *  #13 The Modifiers button shows the active state via the green outline only —
 *      the count badge is gone (`_renderModifierIndicators` never creates a
 *      `.charsheet__modifier-badge` node; it toggles `--has-modifiers`).
 *  #14 The redundant top-level "Abilities" tab is hidden by default and gated by
 *      a new `showAbilitiesTab` setting (state getter/setter, default false); the
 *      pane + nav link are preserved so it can be re-enabled at any time, and
 *      hiding it while active falls back to Overview.
 *
 * The main controller (charactersheet.js) is not importable in the node test env
 * (`window is not defined`), and jest-environment-jsdom is not installed, so the
 * controller methods are exercised behaviorally by extracting their source bodies
 * and running them against lightweight DOM shims that track real class state.
 * State (charactersheet-state.js) IS importable and is tested directly.
 */

import {jest} from "@jest/globals";
import "./setup.js";
import "../../../js/charactersheet/charactersheet-state.js";
import {readFileSync} from "fs";
import {resolve} from "path";

const CharacterSheetState = globalThis.CharacterSheetState;
const REPO_ROOT = process.cwd();

const charsheetSrc = readFileSync(resolve(REPO_ROOT, "js/charactersheet/charactersheet.js"), "utf8");
const combatSrc = readFileSync(resolve(REPO_ROOT, "js/charactersheet/charactersheet-combat.js"), "utf8");
const css = readFileSync(resolve(REPO_ROOT, "css/charactersheet.css"), "utf8");
const html = readFileSync(resolve(REPO_ROOT, "charactersheet.html"), "utf8");

/** Body of the first CSS rule whose selector block starts with `anchor`. */
function cssRuleBody (anchor) {
	const at = css.indexOf(anchor);
	if (at === -1) return null;
	const open = css.indexOf("{", at);
	const close = css.indexOf("}", open);
	return css.slice(open + 1, close);
}

/** Extract a method body (between its outer braces) by start/end markers. */
function extractMethodInner (src, startMarker, endMarker) {
	const start = src.indexOf(startMarker);
	if (start === -1) throw new Error(`start marker not found: ${startMarker}`);
	const end = src.indexOf(endMarker, start);
	if (end === -1) throw new Error(`end marker not found: ${endMarker}`);
	const chunk = src.slice(start, end);
	return chunk.slice(chunk.indexOf("{") + 1, chunk.lastIndexOf("}"));
}

/** Minimal element shim with real class-set tracking. */
function makeEl () {
	const classes = new Set();
	return {
		_badge: null,
		classList: {
			add: (...c) => c.forEach(x => classes.add(x)),
			remove: (...c) => c.forEach(x => classes.delete(x)),
			contains: (c) => classes.has(c),
			toggle: (c, force) => {
				const on = force === undefined ? !classes.has(c) : !!force;
				if (on) classes.add(c); else classes.delete(c);
				return classes.has(c);
			},
		},
		setAttribute: () => {},
		getAttribute: () => null,
		append: () => {},
		querySelector (sel) { return sel === ".charsheet__modifier-badge" ? this._badge : null; },
	};
}

// ───────────────────────────── #3 ─────────────────────────────
describe("#3 Hunter's Dodge row matches the standard ranger-section rows", () => {
	const overviewDodgeBlock = (charsheetSrc.match(/const dodgeRemaining[\s\S]*?charsheet__overview-dodge-use[\s\S]*?<\/div>`;/) || [""])[0];
	const combatDodgeBlock = (combatSrc.match(/const dodgeRemaining[\s\S]*?charsheet__combat-dodge-use[\s\S]*?<\/div>`;/) || [""])[0];

	it("retires the bespoke .charsheet__ranger-ability-row--action CSS rule", () => {
		expect(css).not.toContain(".charsheet__ranger-ability-row--action");
	});

	it("keeps the standard reminder-row grid (border-left accent) intact", () => {
		const body = cssRuleBody(".charsheet__ranger-ability-row {");
		expect(body).not.toBeNull();
		expect(body).toMatch(/border-left:\s*2px solid var\(--rgb-link\)/);
		expect(body).toMatch(/display:\s*grid/);
	});

	it("lays the badge column out so the dodge controls space and wrap safely", () => {
		const body = cssRuleBody(".charsheet__ranger-ability-badge {");
		expect(body).not.toBeNull();
		expect(body).toMatch(/display:\s*inline-flex/);
		expect(body).toMatch(/flex-wrap:\s*wrap/);
		expect(body).toMatch(/gap:/);
		expect(body).toMatch(/min-width:\s*0/);
	});

	it("Overview dodge row uses the standard grid markup (not the old --action class)", () => {
		expect(overviewDodgeBlock.length).toBeGreaterThan(0);
		expect(overviewDodgeBlock).not.toContain("charsheet__ranger-ability-row--action");
		expect(overviewDodgeBlock).toContain("charsheet__ranger-ability-row");
		expect(overviewDodgeBlock).toContain("charsheet__ranger-ability-name");
		expect(overviewDodgeBlock).toContain("charsheet__ranger-ability-badge");
		expect(overviewDodgeBlock).toContain("charsheet__ranger-ability-note");
		expect(overviewDodgeBlock).not.toContain("ve-flex-v-center gap-2 mb-2");
		// Keeps the interactive uses badge + exactly one Use button.
		expect(overviewDodgeBlock).toMatch(/<span class="badge[\s\S]*?\$\{dodgeRemaining\}\/\$\{dodgeMax\}/);
		expect((overviewDodgeBlock.match(/charsheet__overview-dodge-use/g) || []).length).toBe(1);
	});

	it("Combat dodge row uses the standard grid markup and keeps Use + ✏️ edit", () => {
		expect(combatDodgeBlock.length).toBeGreaterThan(0);
		expect(combatDodgeBlock).not.toContain("charsheet__ranger-ability-row--action");
		expect(combatDodgeBlock).toContain("charsheet__ranger-ability-row");
		expect(combatDodgeBlock).toContain("charsheet__ranger-ability-name");
		expect(combatDodgeBlock).toContain("charsheet__ranger-ability-badge");
		expect(combatDodgeBlock).toContain("charsheet__ranger-ability-note");
		expect(combatDodgeBlock).not.toContain("ve-flex-v-center gap-2 mb-2");
		expect(combatDodgeBlock).toMatch(/<span class="badge[\s\S]*?\$\{dodgeRemaining\}\/\$\{dodgeMax\}/);
		expect((combatDodgeBlock.match(/charsheet__combat-dodge-use/g) || []).length).toBe(1);
		expect((combatDodgeBlock.match(/charsheet__combat-dodge-edit/g) || []).length).toBe(1);
	});
});

// ──────────────────────── #3 (speed alignment) ────────────────
describe("#3 Speed segment values share a consistent column", () => {
	const speedBlock = extractMethodInner(charsheetSrc, "_renderSpeedDisplay (speedDisplay) {", "_renderSenses");

	it("renders a dedicated .charsheet__speed-seg-value span per segment", () => {
		expect(speedBlock).toContain("charsheet__speed-seg-value");
	});

	it("defines a .charsheet__speed-seg-value CSS rule with a stable value column", () => {
		const body = cssRuleBody(".charsheet__speed-seg-value {");
		expect(body).not.toBeNull();
		expect(body).toMatch(/min-width:/);
		expect(body).toMatch(/display:\s*inline-block/);
	});

	it("gives the emoji a fixed-width column so values align across glyph widths", () => {
		const body = cssRuleBody(".charsheet__speed-seg-emoji {");
		expect(body).not.toBeNull();
		expect(body).toMatch(/display:\s*inline-block/);
		expect(body).toMatch(/width:/);
	});
});

// ───────────────────────────── #13 ────────────────────────────
describe("#13 Modifiers button: outline only, no count badge", () => {
	const inner = extractMethodInner(charsheetSrc, "_renderModifierIndicators () {", "_renderConditions () {");

	function run (modifiers, {seedBadge = false} = {}) {
		const btn = makeEl();
		const acBox = makeEl();
		const initBox = makeEl();
		const badge = {remove () { btn._badge = null; }};
		if (seedBadge) btn._badge = badge;
		const doc = {
			getElementById: (id) => ({
				"charsheet-btn-modifiers": btn,
				"charsheet-box-ac": acBox,
				"charsheet-box-initiative": initBox,
			}[id] || null),
			querySelector: () => null,
		};
		const eSpy = jest.fn();
		const mockThis = {
			_state: {
				getNamedModifiers: () => modifiers,
				getCustomModifier: () => 0,
				getSkillCustomMod: () => 0,
			},
			getSkillsList: () => [],
		};
		// eslint-disable-next-line no-new-func
		const factory = new Function("document", "Parser", "e_", `return function () {\n${inner}\n};`);
		factory(doc, globalThis.Parser, eSpy).call(mockThis);
		return {btn, eSpy};
	}

	it("adds the green-outline class when modifiers are active and creates NO badge node", () => {
		const {btn, eSpy} = run([{enabled: true}, {enabled: true}]);
		expect(btn.classList.contains("charsheet__btn--has-modifiers")).toBe(true);
		expect(btn.querySelector(".charsheet__modifier-badge")).toBeNull();
		expect(eSpy).not.toHaveBeenCalled();
	});

	it("removes the outline class when no modifiers are active", () => {
		const {btn} = run([{enabled: false}]);
		expect(btn.classList.contains("charsheet__btn--has-modifiers")).toBe(false);
		expect(btn.querySelector(".charsheet__modifier-badge")).toBeNull();
	});

	it("cleans up any legacy badge node left over from older render passes", () => {
		const {btn} = run([], {seedBadge: true});
		expect(btn._badge).toBeNull();
		expect(btn.classList.contains("charsheet__btn--has-modifiers")).toBe(false);
	});

	it("the .charsheet__modifier-badge CSS rule is removed but the outline rule is kept", () => {
		expect(css).not.toContain(".charsheet__modifier-badge {");
		expect(css).toContain(".charsheet__btn--has-modifiers {");
	});

	it("the render method no longer creates a badge span (source pin)", () => {
		expect(inner).not.toContain("charsheet__modifier-badge\">");
		expect(inner).toMatch(/classList\.toggle\("charsheet__btn--has-modifiers"/);
	});
});

// ───────────────────────────── #14 ────────────────────────────
describe("#14 showAbilitiesTab setting + tab gating", () => {
	describe("state getter/setter + persistence", () => {
		it("defaults to false on a fresh character", () => {
			const st = new CharacterSheetState();
			expect(st.getShowAbilitiesTab()).toBe(false);
			expect(st.getSettings().showAbilitiesTab).toBe(false);
		});

		it("round-trips true through toJson/loadFromJson", () => {
			const st = new CharacterSheetState();
			st.setShowAbilitiesTab(true);
			expect(st.getShowAbilitiesTab()).toBe(true);

			const json = st.toJson();
			const st2 = new CharacterSheetState();
			st2.loadFromJson(json);
			expect(st2.getShowAbilitiesTab()).toBe(true);
		});

		it("old saves with partial settings (no key) resolve to false", () => {
			const st = new CharacterSheetState();
			st.loadFromJson({settings: {speedEmojiLabels: false}});
			expect(st.getShowAbilitiesTab()).toBe(false);
			// ...and can still be turned on + round-tripped from that state.
			st.setShowAbilitiesTab(true);
			const st2 = new CharacterSheetState();
			st2.loadFromJson(st.toJson());
			expect(st2.getShowAbilitiesTab()).toBe(true);
		});
	});

	describe("_updateAbilitiesTabVisibility behavior", () => {
		const inner = extractMethodInner(charsheetSrc, "_updateAbilitiesTabVisibility () {", "static _isModalHoverCleanupInit");

		function makeLi (active) {
			const classes = new Set(active ? ["ve-active"] : []);
			return {classList: {
				add: (c) => classes.add(c),
				remove: (c) => classes.delete(c),
				contains: (c) => classes.has(c),
			}};
		}

		function run (settingVal, {abilitiesActive = false, abilitiesHidden = false} = {}) {
			const overviewLi = makeLi(!abilitiesActive);
			const abilitiesLi = makeLi(abilitiesActive);
			if (abilitiesHidden) abilitiesLi.classList.add("ve-hidden");
			const clickSpy = jest.fn(() => {
				overviewLi.classList.add("ve-active");
				abilitiesLi.classList.remove("ve-active");
			});
			const overviewLink = {parentElement: overviewLi, click: clickSpy};
			const abilitiesLink = {parentElement: abilitiesLi};
			const doc = {
				querySelector: (sel) => {
					if (sel.includes("charsheet-tab-overview")) return overviewLink;
					if (sel.includes("charsheet-tab-abilities")) return abilitiesLink;
					return null;
				},
			};
			const mockThis = {
				_state: {getShowAbilitiesTab: () => settingVal},
				_showTab: (id) => doc.querySelector(`#charsheet-tabs a[href="${id}"]`).parentElement.classList.remove("ve-hidden"),
				_hideTab: (id) => doc.querySelector(`#charsheet-tabs a[href="${id}"]`).parentElement.classList.add("ve-hidden"),
			};
			// eslint-disable-next-line no-new-func
			const factory = new Function("document", `return function () {\n${inner}\n};`);
			factory(doc).call(mockThis);
			return {overviewLi, abilitiesLi, clickSpy};
		}

		it("shows the tab when the setting is on (no fallback)", () => {
			const {abilitiesLi, clickSpy} = run(true, {abilitiesHidden: true});
			expect(abilitiesLi.classList.contains("ve-hidden")).toBe(false);
			expect(clickSpy).not.toHaveBeenCalled();
		});

		it("hides the tab when the setting is off", () => {
			const {abilitiesLi, clickSpy} = run(false, {abilitiesActive: false});
			expect(abilitiesLi.classList.contains("ve-hidden")).toBe(true);
			expect(clickSpy).not.toHaveBeenCalled();
		});

		it("falls back to Overview when hiding the currently-active Abilities tab", () => {
			const {overviewLi, abilitiesLi, clickSpy} = run(false, {abilitiesActive: true});
			expect(abilitiesLi.classList.contains("ve-hidden")).toBe(true);
			expect(clickSpy).toHaveBeenCalledTimes(1);
			expect(overviewLi.classList.contains("ve-active")).toBe(true);
		});
	});

	describe("wiring is preserved (source/HTML pins)", () => {
		it("keeps the Abilities nav link and pane in the HTML (not deleted)", () => {
			expect(html).toContain("href=\"#charsheet-tab-abilities\"");
			expect(html).toContain("id=\"charsheet-tab-abilities\"");
		});

		it("gates the tab through getShowAbilitiesTab and falls back to overview", () => {
			const inner = extractMethodInner(charsheetSrc, "_updateAbilitiesTabVisibility () {", "static _isModalHoverCleanupInit");
			expect(inner).toContain("getShowAbilitiesTab");
			expect(inner).toContain("#charsheet-tab-abilities");
			expect(inner).toContain("#charsheet-tab-overview");
		});

		it("invokes the gate from both _initTabs and _updateTabVisibility", () => {
			const initTabs = extractMethodInner(charsheetSrc, "_initTabs () {", "_updateAbilitiesTabVisibility () {");
			expect(initTabs).toContain("this._updateAbilitiesTabVisibility()");
			const updateVis = extractMethodInner(charsheetSrc, "_updateTabVisibility () {", "_initEventListeners () {");
			expect(updateVis).toContain("this._updateAbilitiesTabVisibility()");
		});

		it("adds the settings-modal toggle and a handler that persists + refreshes", () => {
			expect(charsheetSrc).toContain("id=\"settings-show-abilities-tab\"");
			const handler = (charsheetSrc.match(/#settings-show-abilities-tab"\)\.addEventListener\([\s\S]*?\}\);/) || [""])[0];
			expect(handler).toContain("setShowAbilitiesTab");
			expect(handler).toContain("_updateAbilitiesTabVisibility");
		});
	});
});
