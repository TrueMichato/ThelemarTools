import {
	COCKPIT_KEY_BINDINGS,
	getCockpitAriaShortcut,
	getCockpitIsMac,
	getCockpitKeyAction,
	getCockpitKeyLabels,
	getCockpitShortcutSheet,
	isCockpitTypingTarget,
} from "../../js/encounterworkspace/cockpit/keymap.js";

const key = (k, extra = {}) => ({key: k, code: "", shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, ...extra});
const el = (tagName, extra = {}) => ({tagName, getAttribute: name => extra.attrs?.[name] ?? null, ...extra});

describe("Encounter cockpit shell keymap", () => {
	describe("typing guard", () => {
		test("text inputs, textareas, selects and editable regions count as typing; checkboxes and buttons do not", () => {
			expect(isCockpitTypingTarget({target: el("INPUT", {type: "text"})})).toBe(true);
			expect(isCockpitTypingTarget({target: el("INPUT", {type: "number"})})).toBe(true);
			expect(isCockpitTypingTarget({target: el("TEXTAREA")})).toBe(true);
			expect(isCockpitTypingTarget({target: el("SELECT")})).toBe(true);
			expect(isCockpitTypingTarget({target: el("DIV", {isContentEditable: true})})).toBe(true);
			expect(isCockpitTypingTarget({target: el("DIV", {attrs: {role: "textbox"}})})).toBe(true);
			expect(isCockpitTypingTarget({target: el("INPUT", {type: "checkbox"})})).toBe(false);
			expect(isCockpitTypingTarget({target: el("BUTTON")})).toBe(false);
		});

		test("an editor inside a shadow root or a focused input elsewhere still counts as typing", () => {
			const evt = {target: el("DIV"), composedPath: () => [el("INPUT", {type: "search"}), el("DIV")]};
			expect(isCockpitTypingTarget(evt)).toBe(true);
			expect(isCockpitTypingTarget({target: el("BODY")}, {activeElement: el("TEXTAREA")})).toBe(true);
		});

		test("while typing no shortcut fires; Esc only blurs", () => {
			["n", "p", "h", "c", " ", "?", "1"].forEach(k => {
				expect(getCockpitKeyAction(key(k), {isTyping: true})).toBeNull();
			});
			expect(getCockpitKeyAction(key("z", {ctrlKey: true}), {isTyping: true})).toBeNull();
			expect(getCockpitKeyAction(key("Escape"), {isTyping: true})).toEqual({action: "blur"});
		});
	});

	describe("actions", () => {
		test("single keys map to the mockup's actions, and modifiers suppress them", () => {
			expect(getCockpitKeyAction(key("n"))).toEqual({action: "nextTurn"});
			expect(getCockpitKeyAction(key("P"))).toEqual({action: "prevTurn"});
			expect(getCockpitKeyAction(key(" "))).toEqual({action: "viewActive"});
			expect(getCockpitKeyAction(key("h"))).toEqual({action: "tab:hp"});
			expect(getCockpitKeyAction(key("c"))).toEqual({action: "tab:cond"});
			expect(getCockpitKeyAction(key("3"))).toEqual({action: "group", digit: 3});
			expect(getCockpitKeyAction(key("n", {altKey: true}))).toBeNull();
			expect(getCockpitKeyAction(key("n", {ctrlKey: true}))).toBeNull();
			expect(getCockpitKeyAction(key("N", {shiftKey: true}))).toBeNull();
		});

		test("Shift+? opens help on any layout", () => {
			expect(getCockpitKeyAction(key("?", {shiftKey: true}))).toEqual({action: "help"});
			expect(getCockpitKeyAction(key("Dead", {code: "Slash", shiftKey: true}))).toEqual({action: "help"});
		});

		test("non-Latin layouts resolve letters from the physical key", () => {
			expect(getCockpitKeyAction(key("т", {code: "KeyN"}))).toEqual({action: "nextTurn"});
		});

		test("undo/redo use Cmd on Mac and Ctrl elsewhere; Ctrl+Y redoes only off Mac", () => {
			expect(getCockpitKeyAction(key("z", {metaKey: true}), {isMac: true})).toEqual({action: "undo"});
			expect(getCockpitKeyAction(key("Z", {metaKey: true, shiftKey: true}), {isMac: true})).toEqual({action: "redo"});
			expect(getCockpitKeyAction(key("z", {ctrlKey: true}), {isMac: true})).toBeNull();
			expect(getCockpitKeyAction(key("z", {ctrlKey: true}))).toEqual({action: "undo"});
			expect(getCockpitKeyAction(key("y", {ctrlKey: true}))).toEqual({action: "redo"});
			expect(getCockpitKeyAction(key("y", {metaKey: true}), {isMac: true})).toBeNull();
		});
	});

	describe("platform and labels", () => {
		test("a Mac is detected even when the user-agent platform is overridden", () => {
			expect(getCockpitIsMac({userAgentData: {platform: "Windows"}, platform: "MacIntel"})).toBe(true);
			expect(getCockpitIsMac({userAgentData: {platform: "macOS"}, platform: ""})).toBe(true);
			expect(getCockpitIsMac({userAgentData: {platform: "Windows"}, platform: "Win32"})).toBe(false);
			expect(getCockpitIsMac({})).toBe(false);
		});

		test("labels and aria-keyshortcuts follow the platform", () => {
			expect(getCockpitKeyLabels(["mod", "Shift", "Z"], {isMac: true})).toEqual(["⌘", "⇧", "Z"]);
			expect(getCockpitKeyLabels(["mod", "Shift", "Z"])).toEqual(["Ctrl", "Shift", "Z"]);
			expect(getCockpitAriaShortcut(["mod", "Z"], {isMac: true})).toBe("Meta+Z");
			expect(getCockpitAriaShortcut(["mod", "Z"])).toBe("Control+Z");
		});

		test("the shortcut sheet lists every binding once, with Ctrl+Y only off Mac", () => {
			const flat = sheet => sheet.flatMap(section => section.rows.map(row => row.keys.join("+")));
			const pc = flat(getCockpitShortcutSheet());
			const mac = flat(getCockpitShortcutSheet({isMac: true}));
			expect(pc).toContain("Ctrl+Y");
			expect(mac).not.toContain("Ctrl+Y");
			expect(mac).toContain("⌘+Z");
			expect(new Set(pc).size).toBe(pc.length);
		});
	});

	describe("feature bindings", () => {
		const bindings = [
			...COCKPIT_KEY_BINDINGS,
			{section: "Console", keys: ["/"], label: "Open the console", action: "console"},
			{section: "Groups", keys: ["Shift", "G"], label: "Group the selection", action: "groupSel"},
		];

		test("added single keys and Shift+letter keys resolve; Shift+letter without a binding still does nothing", () => {
			expect(getCockpitKeyAction(key("/"), {bindings})).toEqual({action: "console"});
			expect(getCockpitKeyAction(key("G", {shiftKey: true}), {bindings})).toEqual({action: "groupSel"});
			expect(getCockpitKeyAction(key("N", {shiftKey: true}), {bindings})).toBeNull();
			expect(getCockpitKeyAction(key("/"))).toBeNull();
			expect(getCockpitKeyAction(key("G", {shiftKey: true}), {bindings, isTyping: true})).toBeNull();
		});

		test("the shortcut sheet lists feature keys in their own sections", () => {
			const sheet = getCockpitShortcutSheet({bindings});
			expect(sheet.find(it => it.name === "Groups").rows).toEqual([{label: "Group the selection", keys: ["Shift", "G"], action: "groupSel"}]);
		});
	});
});
