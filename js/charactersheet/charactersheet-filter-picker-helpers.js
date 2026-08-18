"use strict";

/**
 * Pure helpers for character-sheet filtered picker modals (Add Item / Spell / Feat / …).
 *
 * Shared empty-state, results toolbar, filter dirtiness, multiselect label/check sync, and
 * pressed-state grammar so pickers stop forking recovery UX. DOM builders use vanilla
 * createElement so Jest can import this module without the full sheet tree.
 */

export const LABELS = {
	selectNone: "Select none",
	resetFilters: "Reset filters",
	emptyFilteredTitle: "No matches",
	emptyFilteredDetail: "Nothing matches your search or filters.",
};

/** True when a filtered list should show the empty canvas (arrays only). */
export function shouldShowFilteredEmpty (filtered) {
	return !Array.isArray(filtered) || filtered.length === 0;
}

/** Set equality ignoring order (string coercion of members). */
export function setsEqual (a, b) {
	const sa = a instanceof Set ? a : new Set(a == null ? [] : Array.isArray(a) ? a : [a]);
	const sb = b instanceof Set ? b : new Set(b == null ? [] : Array.isArray(b) ? b : [b]);
	if (sa.size !== sb.size) return false;
	for (const v of sa) {
		if (!sb.has(v)) return false;
	}
	return true;
}

/**
 * @param {object} opts
 * @param {string} [opts.search]
 * @param {string} [opts.defaultSearch]
 * @param {Array<{current: *, default: *}>} [opts.dimensions] Set/array pairs
 * @param {Array<{current: *, default: *}>} [opts.flags] scalar pairs
 * @returns {boolean}
 */
export function isFilterDirty (opts = {}) {
	const search = opts.search == null ? "" : String(opts.search);
	const defaultSearch = opts.defaultSearch == null ? "" : String(opts.defaultSearch);
	if (search !== defaultSearch) return true;

	const dimensions = Array.isArray(opts.dimensions) ? opts.dimensions : [];
	for (const dim of dimensions) {
		if (!dim) continue;
		if (!setsEqual(dim.current, dim.default)) return true;
	}

	const flags = Array.isArray(opts.flags) ? opts.flags : [];
	for (const flag of flags) {
		if (!flag) continue;
		if (flag.current !== flag.default) return true;
	}
	return false;
}

/**
 * Pressed-state grammar for filter chips/buttons.
 * Uses `.active` (CS CSS) + aria-pressed; strips stray `ve-active`.
 */
export function setPressed (el, on) {
	if (!el) return;
	const pressed = !!on;
	el.classList.toggle("active", pressed);
	el.classList.remove("ve-active");
	if (el.getAttribute) {
		if (el.getAttribute("role") === "button" || el.tagName === "BUTTON") {
			el.setAttribute("aria-pressed", pressed ? "true" : "false");
		}
	}
}

/** Relabel data-action=none / clear buttons that empty a multiselect. */
export function relabelSelectNoneButtons (root) {
	if (!root?.querySelectorAll) return 0;
	let n = 0;
	const nodes = root.querySelectorAll(
		"[data-action=\"none\"], [data-action=\"clear\"], .charsheet__source-action-btn[data-action=\"none\"], .charsheet__source-action-btn[data-action=\"clear\"]",
	);
	for (const btn of nodes) {
		const action = btn.getAttribute("data-action");
		if (action !== "none" && action !== "clear") continue;
		const text = (btn.textContent || "").trim().toLowerCase();
		// Domain labels that already mean empty set with different words stay if already "select none"
		if (text === LABELS.selectNone.toLowerCase()) continue;
		if (
			text === "clear all"
			|| text === "clear"
			|| text === "none"
			|| text === "select none"
		) {
			btn.textContent = LABELS.selectNone;
			n++;
		}
	}
	return n;
}

/**
 * Sync checkbox rows in a multiselect list from a selected Set.
 * Fixes All/Clear handlers that only touched the first input.
 * @param {ParentNode|null} listEl
 * @param {Set<string>|Array<string>} selectedSet
 * @param {object} [opts]
 * @param {(input: HTMLInputElement) => string} [opts.getValue] default: input.value
 */
export function syncMultiselectChecks (listEl, selectedSet, opts = {}) {
	if (!listEl?.querySelectorAll) return 0;
	const selected = selectedSet instanceof Set ? selectedSet : new Set(selectedSet || []);
	const getValue = typeof opts.getValue === "function"
		? opts.getValue
		: (input) => input.value;
	let n = 0;
	for (const input of listEl.querySelectorAll("input[type=\"checkbox\"], input[type=\"radio\"], input")) {
		if (!input || input.type === "text" || input.type === "search") continue;
		const val = getValue(input);
		const on = selected.has(val);
		if (input.checked !== on) {
			input.checked = on;
			n++;
		}
		const row = input.closest("label") || input.parentElement;
		const check = row?.querySelector?.(".charsheet__source-multiselect-check");
		if (check) check.textContent = on ? "✓" : "";
	}
	return n;
}

function _el (tag, className, text) {
	const node = document.createElement(tag);
	if (className) {
		// Prefer classList so stub/test DOMs that don't mirror className ↔ classList stay correct
		if (node.classList?.add) {
			String(className).trim().split(/\s+/).filter(Boolean).forEach(c => node.classList.add(c));
		} else {
			node.className = className;
		}
	}
	if (text != null) node.textContent = text;
	return node;
}

/**
 * Empty canvas with optional primary Reset.
 * @returns {HTMLElement}
 */
export function buildEmptyState (opts = {}) {
	const {
		icon = "🔍",
		title = LABELS.emptyFilteredTitle,
		detail = LABELS.emptyFilteredDetail,
		onReset = null,
		resetLabel = LABELS.resetFilters,
		showReset = true,
	} = opts;

	const root = _el("div", "charsheet__modal-empty");
	root.setAttribute("role", "status");

	const iconEl = _el("div", "charsheet__modal-empty-icon", icon);
	iconEl.setAttribute("aria-hidden", "true");
	root.appendChild(iconEl);

	const titleEl = _el("div", "charsheet__modal-empty-title", title);
	root.appendChild(titleEl);

	if (detail) {
		const detailEl = _el("div", "charsheet__modal-empty-text", detail);
		root.appendChild(detailEl);
	}

	if (showReset && typeof onReset === "function") {
		const actions = _el("div", "charsheet__modal-empty-actions");
		const btn = _el("button", "ve-btn ve-btn-primary ve-btn-sm charsheet__modal-empty-reset", resetLabel);
		btn.type = "button";
		btn.addEventListener("click", (e) => {
			e.preventDefault();
			onReset();
		});
		actions.appendChild(btn);
		root.appendChild(actions);
	}

	return root;
}

/**
 * Fill a results-count host with count content + optional Reset when dirty.
 * @param {HTMLElement} host
 * @param {object} opts
 * @param {string|Node} opts.countContent
 * @param {boolean} opts.isDirty
 * @param {() => void} [opts.onReset]
 * @param {string} [opts.resetLabel]
 */
export function renderResultsToolbar (host, opts = {}) {
	if (!host) return host;
	const {
		countContent = "",
		isDirty = false,
		onReset = null,
		resetLabel = LABELS.resetFilters,
	} = opts;

	host.classList.add("charsheet__modal-results-toolbar");
	host.replaceChildren();

	const countWrap = _el("div", "charsheet__modal-results-count-text");
	const isNode = typeof Node !== "undefined" && countContent instanceof Node;
	if (isNode || (countContent && typeof countContent === "object" && countContent.nodeType === 1)) {
		countWrap.appendChild(countContent);
	} else {
		countWrap.innerHTML = String(countContent);
	}
	host.appendChild(countWrap);

	if (isDirty && typeof onReset === "function") {
		const btn = _el("button", "ve-btn ve-btn-default ve-btn-xs charsheet__modal-reset-filters", resetLabel);
		btn.type = "button";
		btn.addEventListener("click", (e) => {
			e.preventDefault();
			onReset();
		});
		host.appendChild(btn);
	}

	return host;
}

/** @deprecated Prefer renderResultsToolbar into an existing host */
export function buildResultsToolbar (opts = {}) {
	const host = _el("div", "charsheet__modal-results-count charsheet__modal-results-toolbar");
	return renderResultsToolbar(host, opts);
}

/**
 * Pure placement math for fixed multiselect popovers (unit-testable).
 * @param {{top:number,left:number,right:number,bottom:number,width:number,height:number}} anchorRect
 * @param {{width:number,height:number}} popoverSize
 * @param {{width:number,height:number}} viewport
 * @param {{gap?:number,margin?:number,maxHeight?:number}} [opts]
 * @returns {{top:number,left:number,maxHeight:number,placement:"below"|"above",align:"start"|"end"}}
 */
export function computeAnchoredPopoverPlacement (anchorRect, popoverSize, viewport, opts = {}) {
	const gap = opts.gap == null ? 4 : Number(opts.gap);
	const margin = opts.margin == null ? 8 : Number(opts.margin);
	const maxHeightCap = opts.maxHeight == null ? 360 : Number(opts.maxHeight);
	const vw = Math.max(0, Number(viewport?.width) || 0);
	const vh = Math.max(0, Number(viewport?.height) || 0);
	const pw = Math.max(0, Number(popoverSize?.width) || 0);
	const desiredH = Math.max(0, Number(popoverSize?.height) || 0);
	const ph = Math.min(desiredH || maxHeightCap, maxHeightCap);

	const aTop = Number(anchorRect?.top) || 0;
	const aBottom = Number(anchorRect?.bottom) || 0;
	const aLeft = Number(anchorRect?.left) || 0;
	const aRight = Number(anchorRect?.right) || 0;

	const spaceBelow = vh - aBottom - gap - margin;
	const spaceAbove = aTop - gap - margin;
	let placement = "below";
	let top = aBottom + gap;
	if (spaceBelow < Math.min(ph, 160) && spaceAbove > spaceBelow) {
		placement = "above";
		top = aTop - gap - ph;
	}

	// Prefer start-aligned to anchor; flip to end if it would overflow the right edge.
	let align = "start";
	let left = aLeft;
	if (left + pw > vw - margin) {
		left = aRight - pw;
		align = "end";
	}
	left = Math.max(margin, Math.min(left, Math.max(margin, vw - margin - pw)));
	top = Math.max(margin, Math.min(top, Math.max(margin, vh - margin - ph)));

	return {
		top,
		left,
		maxHeight: Math.max(120, Math.min(ph, placement === "below" ? Math.max(120, spaceBelow) : Math.max(120, spaceAbove), maxHeightCap)),
		placement,
		align,
	};
}

/** Clear inline styles applied by placeAnchoredPopover. */
export function clearAnchoredPopoverStyles (menuEl) {
	if (!menuEl?.style) return;
	menuEl.style.position = "";
	menuEl.style.top = "";
	menuEl.style.left = "";
	menuEl.style.right = "";
	menuEl.style.bottom = "";
	menuEl.style.maxHeight = "";
	menuEl.style.width = "";
	menuEl.style.zIndex = "";
	menuEl.classList?.remove?.("charsheet__source-multiselect-dropdown--fixed");
	menuEl.classList?.remove?.("open-left");
	menuEl.classList?.remove?.("open-right");
}

/**
 * Position an open multiselect menu with position:fixed so modal overflow cannot clip it.
 * @returns {ReturnType<typeof computeAnchoredPopoverPlacement>|null}
 */
export function placeAnchoredPopover (menuEl, anchorEl, opts = {}) {
	if (!menuEl || !anchorEl || typeof anchorEl.getBoundingClientRect !== "function") return null;

	const gap = opts.gap == null ? 4 : opts.gap;
	const margin = opts.margin == null ? 8 : opts.margin;
	const maxHeight = opts.maxHeight == null ? 360 : opts.maxHeight;
	const minWidth = opts.minWidth == null ? 280 : opts.minWidth;
	const zIndex = opts.zIndex == null ? 10050 : opts.zIndex;

	menuEl.classList.add("open");
	menuEl.classList.add("charsheet__source-multiselect-dropdown--fixed");

	const anchorRect = anchorEl.getBoundingClientRect();
	// Force a layout read while open styles apply
	const menuRect = typeof menuEl.getBoundingClientRect === "function"
		? menuEl.getBoundingClientRect()
		: {width: minWidth, height: maxHeight};
	const width = Math.max(menuRect.width || 0, minWidth, anchorRect.width || 0);
	const height = Math.min(Math.max(menuRect.height || maxHeight, 160), maxHeight);

	const viewport = {
		width: (typeof window !== "undefined" && window.innerWidth) || opts.viewportWidth || 1280,
		height: (typeof window !== "undefined" && window.innerHeight) || opts.viewportHeight || 800,
	};

	const place = computeAnchoredPopoverPlacement(
		anchorRect,
		{width, height},
		viewport,
		{gap, margin, maxHeight},
	);

	menuEl.style.position = "fixed";
	menuEl.style.top = `${Math.round(place.top)}px`;
	menuEl.style.left = `${Math.round(place.left)}px`;
	menuEl.style.right = "auto";
	menuEl.style.bottom = "auto";
	menuEl.style.maxHeight = `${Math.round(place.maxHeight)}px`;
	menuEl.style.width = `${Math.round(width)}px`;
	menuEl.style.zIndex = String(zIndex);
	menuEl.classList.remove("open-left", "open-right");
	menuEl.classList.add(place.align === "start" ? "open-right" : "open-left");

	return place;
}

/**
 * Exclusive open/close for a set of multiselect menus (one open at a time).
 * @param {HTMLElement[]} menus
 * @param {object} [opts]
 * @param {(menu: HTMLElement, anchor: HTMLElement) => void} [opts.onPlace]
 */
export function createExclusivePopoverController (menus = [], opts = {}) {
	const list = Array.isArray(menus) ? menus.filter(Boolean) : [];
	const onPlace = typeof opts.onPlace === "function"
		? opts.onPlace
		: (menu, anchor) => placeAnchoredPopover(menu, anchor, opts.placeOpts);

	const closeAll = () => {
		for (const m of list) {
			m.classList?.remove?.("open");
			clearAnchoredPopoverStyles(m);
		}
	};

	const toggle = (menu, anchor, evt) => {
		if (evt?.stopPropagation) evt.stopPropagation();
		const wasOpen = menu?.classList?.contains?.("open");
		closeAll();
		if (!wasOpen && menu && anchor) {
			menu.classList.add("open");
			onPlace(menu, anchor);
		}
		return !wasOpen;
	};

	const register = (menu) => {
		if (menu && !list.includes(menu)) list.push(menu);
	};

	return {closeAll, toggle, register, menus: list};
}

/**
 * Whether a multiselect "types" set should show a family of facets.
 * Empty set = all types (show). `__NONE__` = show none.
 * @param {Set<string>|Array<string>} selectedTypes
 * @param {string|string[]} familyKeys e.g. "weapon" or ["weapon"]
 * @param {{forceHide?: boolean}} [opts]
 */
export function shouldShowTypeFamily (selectedTypes, familyKeys, opts = {}) {
	if (opts.forceHide) return false;
	const set = selectedTypes instanceof Set
		? selectedTypes
		: new Set(selectedTypes == null ? [] : Array.isArray(selectedTypes) ? selectedTypes : [selectedTypes]);
	if (set.has("__NONE__")) return false;
	if (set.size === 0) return true; // all types
	const keys = Array.isArray(familyKeys) ? familyKeys : [familyKeys];
	return keys.some(k => set.has(k));
}

const exportsObj = {
	LABELS,
	shouldShowFilteredEmpty,
	setsEqual,
	isFilterDirty,
	setPressed,
	relabelSelectNoneButtons,
	syncMultiselectChecks,
	buildEmptyState,
	renderResultsToolbar,
	buildResultsToolbar,
	computeAnchoredPopoverPlacement,
	clearAnchoredPopoverStyles,
	placeAnchoredPopover,
	createExclusivePopoverController,
	shouldShowTypeFamily,
};

if (typeof globalThis !== "undefined") {
	globalThis.CharacterSheetFilterPickerHelpers = exportsObj;
}

export default exportsObj;
