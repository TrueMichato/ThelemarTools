/**
 * Pure helpers for filtered picker empty/reset grammar.
 * No jsdom in this project — DOM builders use a minimal createElement stub.
 *
 * IMPORTANT SCOPE NOTE: `placeAnchoredPopover`'s math here was never the bug behind the
 * Add Item/Spell/Feat picker filter menus rendering in "random" screen locations — this
 * suite's fake DOM has no notion of CSS containing blocks, so it cannot see (and never
 * caught) a real root cause: `will-change: transform` on the shared `.ve-ui-modal__scroller`
 * establishing a fixed-position containing block for these `position:fixed` menus, which
 * made the browser resolve their `top`/`left` against the scroller's own box instead of the
 * viewport. That is fixed in `css/charactersheet.css` (scoped `will-change: scroll-position`
 * override for scrollers containing `.charsheet__modal-list`) and is covered by real-browser
 * regression tests in `test/e2e/specs/inventory-item-picker-filters.spec.ts`, which also
 * exercise the Spell/Feat pickers that share the same markup/CSS. Keep this file limited to
 * pure math/DOM-stub assertions; containing-block/positioning regressions belong in Playwright.
 */

import "./setup.js";

/** Minimal element tree for helper DOM builders (no jsdom). */
function mkNode (tag = "div") {
	const node = {
		tagName: String(tag).toUpperCase(),
		className: "",
		textContent: "",
		innerHTML: "",
		type: tag === "button" ? "submit" : "",
		checked: false,
		value: "",
		style: {},
		children: [],
		attrs: {},
		handlers: {},
		parentElement: null,
		classList: {
			_set: new Set(),
			add (...cs) { cs.forEach(c => this._set.add(c)); node.className = [...this._set].join(" "); },
			remove (...cs) { cs.forEach(c => this._set.delete(c)); node.className = [...this._set].join(" "); },
			toggle (c, force) {
				const on = force === undefined ? !this._set.has(c) : !!force;
				if (on) this._set.add(c); else this._set.delete(c);
				node.className = [...this._set].join(" ");
				return on;
			},
			contains (c) { return this._set.has(c); },
		},
		setAttribute (k, v) { this.attrs[k] = String(v); },
		getAttribute (k) { return this.attrs[k] ?? null; },
		addEventListener (name, fn) { (this.handlers[name] ||= []).push(fn); },
		appendChild (child) {
			child.parentElement = this;
			this.children.push(child);
			return child;
		},
		replaceChildren (...kids) {
			this.children.forEach(c => { c.parentElement = null; });
			this.children = [];
			kids.forEach(k => this.appendChild(k));
		},
		querySelector (sel) {
			const all = this._walk();
			if (sel.startsWith(".")) {
				const cls = sel.slice(1).split(".")[0];
				return all.find(n => n.classList.contains(cls)) || null;
			}
			if (sel.includes("data-action")) {
				const m = sel.match(/data-action="([^"]+)"/);
				return all.find(n => n.getAttribute("data-action") === m?.[1]) || null;
			}
			if (sel.includes("input")) {
				return all.find(n => n.tagName === "INPUT") || null;
			}
			return null;
		},
		querySelectorAll (sel) {
			const all = this._walk();
			if (sel.includes("data-action")) {
				return all.filter(n => {
					const a = n.getAttribute("data-action");
					return a === "none" || a === "clear" || a === "all";
				});
			}
			if (sel.includes("input")) {
				return all.filter(n => n.tagName === "INPUT");
			}
			if (sel.startsWith(".")) {
				const cls = sel.replace(/^\./, "").split(/[\s.>]/)[0];
				return all.filter(n => n.classList.contains(cls));
			}
			return all;
		},
		closest (sel) {
			let cur = this;
			while (cur) {
				if (sel === "label" && cur.tagName === "LABEL") return cur;
				cur = cur.parentElement;
			}
			return null;
		},
		click () {
			(this.handlers.click || []).forEach(fn => fn({preventDefault () {}}));
		},
		_walk () {
			const out = [];
			const visit = (n) => {
				out.push(n);
				(n.children || []).forEach(visit);
			};
			(this.children || []).forEach(visit);
			return out;
		},
	};
	return node;
}

beforeAll(() => {
	globalThis.document = {
		createElement (tag) { return mkNode(tag); },
	};
});

const {
	LABELS,
	shouldShowFilteredEmpty,
	setsEqual,
	isFilterDirty,
	setPressed,
	relabelSelectNoneButtons,
	syncMultiselectChecks,
	buildEmptyState,
	renderResultsToolbar,
	computeAnchoredPopoverPlacement,
	shouldShowTypeFamily,
	createExclusivePopoverController,
	clearAnchoredPopoverStyles,
} = await import("../../../js/charactersheet/charactersheet-filter-picker-helpers.js");

describe("CharacterSheetFilterPickerHelpers — empty predicate", () => {
	it("treats empty arrays as empty", () => {
		expect(shouldShowFilteredEmpty([])).toBe(true);
	});

	it("does not treat non-empty arrays as empty (the old !filtered bug)", () => {
		expect(shouldShowFilteredEmpty([{name: "Fireball"}])).toBe(false);
		expect(![]).toBe(false);
		expect(shouldShowFilteredEmpty([])).toBe(true);
	});

	it("treats null/undefined/non-arrays as empty", () => {
		expect(shouldShowFilteredEmpty(null)).toBe(true);
		expect(shouldShowFilteredEmpty(undefined)).toBe(true);
		expect(shouldShowFilteredEmpty("x")).toBe(true);
	});
});

describe("CharacterSheetFilterPickerHelpers — setsEqual / isFilterDirty", () => {
	it("compares sets ignoring order", () => {
		expect(setsEqual(new Set(["a", "b"]), new Set(["b", "a"]))).toBe(true);
		expect(setsEqual(["a"], ["b"])).toBe(false);
		expect(setsEqual(new Set(), new Set())).toBe(true);
	});

	it("detects dirty search", () => {
		expect(isFilterDirty({search: "fire", defaultSearch: ""})).toBe(true);
		expect(isFilterDirty({search: "", defaultSearch: ""})).toBe(false);
	});

	it("detects dirty dimensions and flags", () => {
		expect(isFilterDirty({
			dimensions: [{current: new Set(["PHB"]), default: new Set()}],
		})).toBe(true);
		expect(isFilterDirty({
			flags: [{current: true, default: false}],
		})).toBe(true);
		expect(isFilterDirty({
			search: "",
			dimensions: [{current: new Set(["a"]), default: new Set(["a"])}],
			flags: [{current: false, default: false}],
		})).toBe(false);
	});
});

describe("CharacterSheetFilterPickerHelpers — setPressed", () => {
	it("toggles .active and aria-pressed, strips ve-active", () => {
		const btn = mkNode("button");
		btn.classList.add("ve-active");
		setPressed(btn, true);
		expect(btn.classList.contains("active")).toBe(true);
		expect(btn.classList.contains("ve-active")).toBe(false);
		expect(btn.getAttribute("aria-pressed")).toBe("true");
		setPressed(btn, false);
		expect(btn.classList.contains("active")).toBe(false);
		expect(btn.getAttribute("aria-pressed")).toBe("false");
	});
});

describe("CharacterSheetFilterPickerHelpers — relabelSelectNoneButtons", () => {
	it("renames Clear All / Clear / None to Select none", () => {
		const root = mkNode("div");
		const mkBtn = (action, text) => {
			const b = mkNode("button");
			b.setAttribute("data-action", action);
			b.textContent = text;
			root.appendChild(b);
			return b;
		};
		mkBtn("none", "Clear All");
		mkBtn("none", "Clear");
		mkBtn("none", "None");
		mkBtn("all", "Select All");
		const n = relabelSelectNoneButtons(root);
		expect(n).toBe(3);
		root.children.filter(b => b.getAttribute("data-action") === "none")
			.forEach(b => expect(b.textContent).toBe(LABELS.selectNone));
		expect(root.children.find(b => b.getAttribute("data-action") === "all").textContent).toBe("Select All");
	});
});

describe("CharacterSheetFilterPickerHelpers — syncMultiselectChecks", () => {
	it("updates every checkbox, not only the first", () => {
		const list = mkNode("div");
		const mkRow = (value, checked) => {
			const label = mkNode("label");
			const input = mkNode("input");
			input.type = "checkbox";
			input.value = value;
			input.checked = checked;
			const check = mkNode("span");
			check.classList.add("charsheet__source-multiselect-check");
			check.textContent = checked ? "✓" : "";
			label.appendChild(input);
			label.appendChild(check);
			list.appendChild(label);
			return input;
		};
		mkRow("A", false);
		mkRow("B", true);
		mkRow("C", true);

		syncMultiselectChecks(list, new Set());
		const inputs = list.children.map(l => l.children[0]);
		expect(inputs.every(i => !i.checked)).toBe(true);
		expect(list.children.every(l => l.children[1].textContent === "")).toBe(true);

		syncMultiselectChecks(list, new Set(["A", "C"]));
		expect(inputs[0].checked).toBe(true);
		expect(inputs[1].checked).toBe(false);
		expect(inputs[2].checked).toBe(true);
		expect(list.children[0].children[1].textContent).toBe("✓");
	});
});

describe("CharacterSheetFilterPickerHelpers — empty state + toolbar", () => {
	it("buildEmptyState invokes onReset", () => {
		let called = 0;
		const el = buildEmptyState({
			icon: "📖",
			title: "No matches",
			detail: "Nothing matches.",
			onReset: () => { called++; },
		});
		expect(el.classList.contains("charsheet__modal-empty")).toBe(true);
		const title = el.children.find(c => c.classList.contains("charsheet__modal-empty-title"));
		expect(title.textContent).toBe("No matches");
		const reset = el._walk().find(n => n.classList.contains("charsheet__modal-empty-reset"));
		expect(reset).toBeTruthy();
		reset.click();
		expect(called).toBe(1);
	});

	it("renderResultsToolbar shows Reset only when dirty", () => {
		const host = mkNode("div");
		let resets = 0;
		renderResultsToolbar(host, {
			countContent: "<span>0 spells found</span>",
			isDirty: true,
			onReset: () => { resets++; },
		});
		const resetBtn = host.children.find(c => c.classList?.contains("charsheet__modal-reset-filters"));
		expect(resetBtn).toBeTruthy();
		resetBtn.click();
		expect(resets).toBe(1);

		renderResultsToolbar(host, {
			countContent: "<span>12 spells found</span>",
			isDirty: false,
			onReset: () => { resets++; },
		});
		expect(host.children.find(c => c.classList?.contains("charsheet__modal-reset-filters"))).toBeFalsy();
		expect(host.children[0].innerHTML).toContain("12 spells found");
	});
});

describe("CharacterSheetFilterPickerHelpers — anchored popover placement", () => {
	it("places below when there is room", () => {
		const place = computeAnchoredPopoverPlacement(
			{top: 100, left: 50, right: 150, bottom: 130, width: 100, height: 30},
			{width: 320, height: 280},
			{width: 1280, height: 800},
			{gap: 4, margin: 8, maxHeight: 360},
		);
		expect(place.placement).toBe("below");
		expect(place.top).toBe(134);
		expect(place.left).toBe(50);
		expect(place.align).toBe("start");
	});

	it("flips above near the bottom edge", () => {
		const place = computeAnchoredPopoverPlacement(
			{top: 700, left: 40, right: 140, bottom: 730, width: 100, height: 30},
			{width: 320, height: 300},
			{width: 1000, height: 800},
			{gap: 4, margin: 8, maxHeight: 360},
		);
		expect(place.placement).toBe("above");
		expect(place.top).toBeLessThan(700);
	});

	it("flips horizontal alignment when overflowing the right edge", () => {
		const place = computeAnchoredPopoverPlacement(
			{top: 80, left: 900, right: 980, bottom: 110, width: 80, height: 30},
			{width: 320, height: 200},
			{width: 1000, height: 800},
			{gap: 4, margin: 8, maxHeight: 360},
		);
		expect(place.align).toBe("end");
		expect(place.left + 320).toBeLessThanOrEqual(1000 - 8 + 0.001);
	});
});

describe("CharacterSheetFilterPickerHelpers — type family visibility", () => {
	it("shows family when all types (empty set)", () => {
		expect(shouldShowTypeFamily(new Set(), "weapon")).toBe(true);
	});

	it("hides on __NONE__ or forceHide", () => {
		expect(shouldShowTypeFamily(new Set(["__NONE__"]), "weapon")).toBe(false);
		expect(shouldShowTypeFamily(new Set(["weapon"]), "weapon", {forceHide: true})).toBe(false);
	});

	it("gates by selected type keys", () => {
		expect(shouldShowTypeFamily(new Set(["armor", "gear"]), "weapon")).toBe(false);
		expect(shouldShowTypeFamily(new Set(["armor", "weapon"]), "weapon")).toBe(true);
		expect(shouldShowTypeFamily(new Set(["armor"]), "armor")).toBe(true);
	});
});

describe("CharacterSheetFilterPickerHelpers — exclusive popover controller", () => {
	it("opens one menu at a time and clears styles on close", () => {
		const a = mkNode("div");
		const b = mkNode("div");
		const anchor = mkNode("button");
		let placed = 0;
		const ctl = createExclusivePopoverController([a, b], {
			onPlace: (menu) => {
				placed++;
				menu.classList.add("charsheet__source-multiselect-dropdown--fixed");
				menu.style.position = "fixed";
			},
		});
		expect(ctl.toggle(a, anchor, {stopPropagation () {}})).toBe(true);
		expect(a.classList.contains("open")).toBe(true);
		expect(placed).toBe(1);
		ctl.toggle(b, anchor, {stopPropagation () {}});
		expect(a.classList.contains("open")).toBe(false);
		expect(b.classList.contains("open")).toBe(true);
		ctl.closeAll();
		expect(b.classList.contains("open")).toBe(false);
		clearAnchoredPopoverStyles(b);
		expect(b.style.position).toBe("");
	});
});
