/**
 * One keymap for the cockpit. Pure parts (typing guard, matching, labels) are exported for jest; `installCockpitKeymap`
 * is the only function that touches the document.
 */

/** Section, keys (canonical), description, action id. `mod` = Cmd on Mac, Ctrl elsewhere. */
export const COCKPIT_KEY_BINDINGS = Object.freeze([
	{section: "Turns", keys: ["N"], label: "Next turn", action: "nextTurn"},
	{section: "Turns", keys: ["P"], label: "Previous turn", action: "prevTurn"},
	{section: "Turns", keys: ["Space"], label: "View the active creature", action: "viewActive"},
	{section: "View & select", keys: ["J"], label: "View next creature", action: "viewNext"},
	{section: "View & select", keys: ["K"], label: "View previous creature", action: "viewPrev"},
	{section: "View & select", keys: ["X"], label: "Select / unselect the viewed creature", action: "toggleViewed"},
	{section: "View & select", keys: ["1–9"], label: "Select a group (again to unselect)", action: "group", isDigit: true},
	{section: "View & select", keys: ["Esc"], label: "Close popup · clear selection", action: "escape"},
	{section: "Dock", keys: ["H"], label: "Hit points tab", action: "tab:hp"},
	{section: "Dock", keys: ["C"], label: "Conditions tab", action: "tab:cond"},
	{section: "Dock", keys: ["R"], label: "Roll tab (save · check · skill)", action: "tab:roll"},
	{section: "Dock", keys: ["E"], label: "Effects tab", action: "tab:fx"},
	{section: "History", keys: ["mod", "Z"], label: "Undo", action: "undo"},
	{section: "History", keys: ["mod", "Shift", "Z"], label: "Redo", action: "redo"},
	{section: "Help", keys: ["Shift", "?"], label: "Show this sheet", action: "help"},
]);

/**
 * Keys handled locally by a control rather than the global keymap — listed on the shortcut sheet so they are
 * discoverable, never matched by getCockpitKeyAction.
 */
export const COCKPIT_SHEET_ONLY_ROWS = Object.freeze([
	{section: "Prep", keys: ["←", "→"], label: "Switch prep tabs (on the tab strip)", action: "sheet:prepTabs"},
	{section: "Prep", keys: ["Home", "End"], label: "First / last prep tab", action: "sheet:prepTabEnds"},
	{section: "Prep", keys: ["mod", "Enter"], label: "Save the open edit", action: "sheet:saveEdit"},
]);

const _TEXT_INPUT_TYPES_EXCLUDED = new Set(["checkbox", "radio", "button", "submit", "reset", "range", "color", "file", "image"]);

/** True if the element is somewhere the user types (so single-letter shortcuts must not fire). */
export function isCockpitTypingElement (el) {
	if (!el || typeof el !== "object") return false;
	const tag = `${el.tagName || ""}`.toUpperCase();
	if (tag === "TEXTAREA" || tag === "SELECT") return true;
	if (tag === "INPUT") return !_TEXT_INPUT_TYPES_EXCLUDED.has(`${el.type || "text"}`.toLowerCase());
	if (el.isContentEditable || el.contentEditable === "true" || el.getAttribute?.("contenteditable") === "true") return true;
	return el.getAttribute?.("role") === "textbox";
}

/** Typing guard for an event: the target, or anything in its composed path (shadow DOM / nested editors). */
export function isCockpitTypingTarget (evt, {activeElement = null} = {}) {
	if (isCockpitTypingElement(evt?.target)) return true;
	const path = typeof evt?.composedPath === "function" ? evt.composedPath() : [];
	if (path.some(isCockpitTypingElement)) return true;
	return isCockpitTypingElement(activeElement);
}

const _CODE_TO_KEY = {Space: " ", Slash: "/", Escape: "Escape"};

/** The letter / symbol pressed, falling back to `code` so non-Latin layouts still work. */
export function getCockpitEventKey (evt) {
	const key = evt?.key;
	if (key && key.length === 1 && /[a-z0-9 ?/]/i.test(key)) return key === " " ? "Space" : key.toUpperCase();
	if (key === "Escape") return "Esc";
	const code = evt?.code || "";
	if (/^Key[A-Z]$/.test(code)) return code.slice(3);
	if (/^Digit\d$/.test(code)) return code.slice(5);
	if (code === "Slash" && evt.shiftKey) return "?";
	if (_CODE_TO_KEY[code]) return _CODE_TO_KEY[code] === " " ? "Space" : _CODE_TO_KEY[code] === "Escape" ? "Esc" : _CODE_TO_KEY[code];
	return key || "";
}

/**
 * Resolve a keyboard event to an action, or null.
 * Returns {action, digit?}. Never resolves while typing, except Esc (which blurs) and undo/redo (left to the input).
 */
export function getCockpitKeyAction (evt, {isMac = false, isTyping = false, bindings = COCKPIT_KEY_BINDINGS} = {}) {
	const key = getCockpitEventKey(evt);
	const mod = isMac ? evt.metaKey : evt.ctrlKey;
	if (isTyping) return key === "Esc" ? {action: "blur"} : null;
	if (mod && !evt.altKey) {
		if (key === "Z") return {action: evt.shiftKey ? "redo" : "undo"};
		if (key === "Y" && !isMac) return {action: "redo"};
		return null;
	}
	if (evt.ctrlKey || evt.metaKey || evt.altKey) return null;
	if (key === "?" || (evt.shiftKey && key === "/")) return {action: "help"};
	if (evt.shiftKey) {
		const shifted = bindings.find(it => it.keys.length === 2 && it.keys[0] === "Shift" && it.keys[1] === key);
		return shifted ? {action: shifted.action} : null;
	}
	if (/^[1-9]$/.test(key)) return {action: "group", digit: Number(key)};
	const binding = bindings.find(it => it.keys.length === 1 && it.keys[0] === key);
	return binding ? {action: binding.action} : null;
}

const _MAC_LABELS = {mod: "⌘", Shift: "⇧", Alt: "⌥", Esc: "Esc", Space: "Space"};
const _PC_LABELS = {mod: "Ctrl", Shift: "Shift", Alt: "Alt", Esc: "Esc", Space: "Space"};

export function getCockpitKeyLabel (key, {isMac = false} = {}) {
	return (isMac ? _MAC_LABELS : _PC_LABELS)[key] ?? key;
}

export function getCockpitKeyLabels (keys, {isMac = false} = {}) {
	return keys.map(key => getCockpitKeyLabel(key, {isMac}));
}

export function getCockpitIsMac (nav = globalThis.navigator) {
	// Either source may be spoofed by a UA override; the OS still sends Cmd as metaKey, so trust any Mac signal.
	return [nav?.userAgentData?.platform, nav?.platform].some(platform => /mac|iphone|ipad|ipod/i.test(platform || ""));
}

/** `<kbd>` hint chip markup for a button, e.g. getCockpitKbdHtml(["mod", "Z"]). */
export function getCockpitKbdHtml (keys, {isMac = false} = {}) {
	return getCockpitKeyLabels(keys, {isMac}).map(label => `<kbd class="ewc-kbd" aria-hidden="true">${label}</kbd>`).join("");
}

/** aria-keyshortcuts value, e.g. "Control+Z" / "Meta+Z". */
export function getCockpitAriaShortcut (keys, {isMac = false} = {}) {
	return keys.map(key => ({mod: isMac ? "Meta" : "Control", Esc: "Escape"})[key] ?? key).join("+");
}

/**
 * Install the keymap on the document. `handlers` maps action ids to functions (read at key time, so entries added
 * later work); unknown actions are ignored. `getBindings` lets features add keys after install.
 * Returns an uninstall function.
 */
export function installCockpitKeymap ({root, handlers, isMac = getCockpitIsMac(), isEnabled = () => true, getBindings = () => COCKPIT_KEY_BINDINGS}) {
	const onKeyDown = evt => {
		if (evt.defaultPrevented || evt.isComposing || !isEnabled()) return;
		if (evt.target instanceof Node && !root.contains(evt.target) && evt.target !== document.body && evt.target !== document.documentElement) return;
		const isTyping = isCockpitTypingTarget(evt, {activeElement: document.activeElement});
		const resolved = getCockpitKeyAction(evt, {isMac, isTyping, bindings: getBindings()});
		if (!resolved) return;
		if (resolved.action === "blur") {
			const el = document.activeElement;
			if (el && root.contains(el)) el.blur();
			return;
		}
		const handler = handlers[resolved.action] || (resolved.action.startsWith("tab:") ? handlers.tab : null);
		if (!handler) return;
		const handled = handler(resolved.action.startsWith("tab:") ? resolved.action.slice(4) : resolved.digit, evt);
		if (handled === false) return;
		evt.preventDefault();
	};
	document.addEventListener("keydown", onKeyDown);
	return () => document.removeEventListener("keydown", onKeyDown);
}

/** Shortcut sheet model, grouped by section with platform labels. */
export function getCockpitShortcutSheet ({isMac = false, bindings = COCKPIT_KEY_BINDINGS, extraRows = COCKPIT_SHEET_ONLY_ROWS} = {}) {
	const sections = [];
	[...bindings, ...extraRows].forEach(binding => {
		let section = sections.find(it => it.name === binding.section);
		if (!section) sections.push(section = {name: binding.section, rows: []});
		section.rows.push({label: binding.label, keys: getCockpitKeyLabels(binding.keys, {isMac}), action: binding.action});
	});
	if (!isMac) {
		const history = sections.find(it => it.name === "History");
		history?.rows.push({label: "Redo", keys: ["Ctrl", "Y"], action: "redo"});
	}
	return sections;
}
