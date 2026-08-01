/**
 * The shared character-sheet modal wrapper.
 *
 * `CharacterSheetModal.pGetShow` sits in front of every one of the sheet's ~90 dialogs, so its
 * contract is load-bearing in a way an individual modal's isn't: get the delegation wrong and the
 * spawn harness hangs on a dialog nobody will ever click; get the `cbClose` composition wrong and
 * dozens of call sites stop persisting their state.
 *
 * There is no jsdom in this project, so these drive the wrapper against hand-built element stubs.
 * That is a feature here — it keeps the assertions on the wrapper's decisions rather than on
 * whatever a browser would have rendered.
 */

import "./setup.js";
import "../../../js/charactersheet/charactersheet-modal.js";

const CharacterSheetModal = globalThis.CharacterSheetModal;

/** Just enough element for the wrapper: attributes, classes, a query surface, and listeners. */
const mkEle = ({tag = "div", children = [], isVisible = true} = {}) => {
	const ele = {
		tag,
		attributes: {},
		classes: new Set(),
		handlers: {},
		children,
		isConnected: true,
		offsetParent: isVisible ? {} : null,
		disabled: false,
		setAttribute (k, v) { this.attributes[k] = v; },
		getAttribute (k) { return this.attributes[k] ?? null; },
		addEventListener (name, fn) { (this.handlers[name] ||= []).push(fn); },
		dispatch (name, evt) { (this.handlers[name] || []).forEach(fn => fn(evt)); },
		contains (other) { return other === this || this.children.includes(other); },
		querySelector (sel) {
			if (/^h1, h2/.test(sel)) return this.children.find(c => /^h\d$/.test(c.tag)) || null;
			return null;
		},
		querySelectorAll () { return this.children.filter(c => !/^h\d$/.test(c.tag)); },
		focus () { this.isFocused = true; globalThis.document.activeElement = this; },
	};
	ele.classList = {
		add: (...cs) => cs.forEach(c => ele.classes.add(c)),
		remove: (...cs) => cs.forEach(c => ele.classes.delete(c)),
		contains: c => ele.classes.has(c),
	};
	return ele;
};

const mkEvent = (key, {shiftKey = false} = {}) => ({
	key,
	shiftKey,
	isDefaultPrevented: false,
	isPropagationStopped: false,
	preventDefault () { this.isDefaultPrevented = true; },
	stopPropagation () { this.isPropagationStopped = true; },
});

describe("CharacterSheetModal", () => {
	let calls;
	let nextModal;
	let body;

	beforeEach(() => {
		calls = [];
		body = mkEle({tag: "body"});
		globalThis.document = {body, activeElement: body};
		globalThis.EventUtil = {isInInput: () => false};

		nextModal = () => ({eleModal: mkEle(), eleModalInner: mkEle(), doClose: () => {}});

		globalThis.UiUtil = {
			pGetShowModal: async opts => {
				calls.push(opts);
				return nextModal(opts);
			},
		};
	});

	describe("delegation", () => {
		// `CharacterSheetSpawnPrompts` monkey-patches `UiUtil.pGetShowModal` at runtime to
		// auto-answer dialogs during `?spawn=` builds and E2E runs. A reference captured at module
		// load would silently bypass the patch and hang the harness forever.
		it("resolves UiUtil.pGetShowModal at call time, not at module load", async () => {
			let isPatchedCalled = false;
			globalThis.UiUtil.pGetShowModal = async () => {
				isPatchedCalled = true;
				return {eleModalInner: mkEle(), doClose: () => {}};
			};

			await CharacterSheetModal.pGetShow({title: "Anything"});

			expect(isPatchedCalled).toBe(true);
		});

		it("passes the caller's options through untouched", async () => {
			await CharacterSheetModal.pGetShow({title: "Craft", isWidth100: true, isHeight100: true});

			expect(calls[0].title).toBe("Craft");
			expect(calls[0].isWidth100).toBe(true);
			expect(calls[0].isHeight100).toBe(true);
		});

		it("honours the escape hatch and strips its own flag", async () => {
			const modal = await CharacterSheetModal.pGetShow({title: "Raw", isSkipCharacterSheetEnhancements: true});

			expect(calls[0].isSkipCharacterSheetEnhancements).toBeUndefined();
			expect(calls[0].title).toBe("Raw");
			// Untouched — no dialog semantics applied
			expect(modal.eleModal.getAttribute("role")).toBeNull();
		});
	});

	describe("the spawn harness's fallback stub", () => {
		// It returns only `eleModalInner`, `doClose`, `pGetResolved` and `doAutoResize`. Every
		// enhancement has to be guarded or every spawned character throws on its first dialog.
		it("survives a modal handle with no eleModal", async () => {
			nextModal = () => ({eleModalInner: mkEle(), doClose: () => {}, pGetResolved: async () => {}});

			const modal = await CharacterSheetModal.pGetShow({title: "Choose a subclass"});

			expect(modal.eleModal).toBeUndefined();
			expect(modal.eleModalInner).toBeDefined();
		});

		it("still composes cbClose when there is no eleModal", async () => {
			nextModal = () => ({eleModalInner: mkEle(), doClose: () => {}});
			let isClosed = false;

			await CharacterSheetModal.pGetShow({title: "X", cbClose: () => { isClosed = true; }});
			await calls[0].cbClose(false);

			expect(isClosed).toBe(true);
		});
	});

	describe("cbClose composition", () => {
		it("calls the caller's callback with its original arguments", async () => {
			const seen = [];

			await CharacterSheetModal.pGetShow({title: "X", cbClose: (...args) => { seen.push(args); }});
			await calls[0].cbClose(true, "extra");

			expect(seen).toEqual([[true, "extra"]]);
		});

		it("returns whatever the caller returned", async () => {
			await CharacterSheetModal.pGetShow({title: "X", cbClose: () => "kept"});

			await expect(calls[0].cbClose(false)).resolves.toBe("kept");
		});

		it("awaits an async callback before restoring focus", async () => {
			const order = [];
			const trigger = mkEle({tag: "button"});
			trigger.focus = () => order.push("restore");
			globalThis.document.activeElement = trigger;

			await CharacterSheetModal.pGetShow({
				title: "X",
				cbClose: async () => {
					await new Promise(resolve => setTimeout(resolve, 1));
					order.push("caller");
				},
			});
			await calls[0].cbClose(false);
			await new Promise(resolve => setTimeout(resolve, 5));

			expect(order).toEqual(["caller", "restore"]);
		});

		it("works when the caller passed no callback at all", async () => {
			await CharacterSheetModal.pGetShow({title: "X"});

			await expect(calls[0].cbClose(false)).resolves.toBeUndefined();
		});
	});

	describe("focus restore", () => {
		// `UiUtil.getShowModal` blurs the active element while building, so the trigger must be
		// read before delegating — otherwise every restore target is `<body>`.
		it("returns focus to the element that opened the modal", async () => {
			const trigger = mkEle({tag: "button"});
			globalThis.document.activeElement = trigger;

			await CharacterSheetModal.pGetShow({title: "Harvest"});
			globalThis.document.activeElement = body;
			await calls[0].cbClose(false);
			await new Promise(resolve => setTimeout(resolve, 5));

			expect(trigger.isFocused).toBe(true);
		});

		it("ignores a trigger that has left the document", async () => {
			const trigger = mkEle({tag: "button"});
			globalThis.document.activeElement = trigger;

			await CharacterSheetModal.pGetShow({title: "Harvest"});
			trigger.isConnected = false;
			await calls[0].cbClose(false);
			await new Promise(resolve => setTimeout(resolve, 5));

			expect(trigger.isFocused).toBeUndefined();
		});

		it("does not try to restore to <body>", async () => {
			globalThis.document.activeElement = body;

			await CharacterSheetModal.pGetShow({title: "Harvest"});
			await calls[0].cbClose(false);
			await new Promise(resolve => setTimeout(resolve, 5));

			expect(body.isFocused).toBeUndefined();
		});
	});

	describe("dialog semantics", () => {
		it("announces itself as a modal dialog", async () => {
			const modal = await CharacterSheetModal.pGetShow({title: "Harvest"});

			expect(modal.eleModal.getAttribute("role")).toBe("dialog");
			expect(modal.eleModal.getAttribute("aria-modal")).toBe("true");
			expect(modal.eleModal.classList.contains("cs-modal")).toBe(true);
		});

		it("points aria-labelledby at the rendered header", async () => {
			const header = mkEle({tag: "h4"});
			nextModal = () => ({eleModal: mkEle({children: [header]}), eleModalInner: mkEle(), doClose: () => {}});

			const modal = await CharacterSheetModal.pGetShow({title: "Harvest"});

			expect(header.id).toBeTruthy();
			expect(modal.eleModal.getAttribute("aria-labelledby")).toBe(header.id);
		});

		it("falls back to aria-label when there is no header element", async () => {
			const modal = await CharacterSheetModal.pGetShow({title: "Harvest"});

			expect(modal.eleModal.getAttribute("aria-label")).toBe("Harvest");
			expect(modal.eleModal.getAttribute("aria-labelledby")).toBeNull();
		});

		it("gives each modal a unique header id", async () => {
			const h1 = mkEle({tag: "h4"});
			const h2 = mkEle({tag: "h4"});
			nextModal = () => ({eleModal: mkEle({children: [h1]}), eleModalInner: mkEle(), doClose: () => {}});
			await CharacterSheetModal.pGetShow({title: "A"});
			nextModal = () => ({eleModal: mkEle({children: [h2]}), eleModalInner: mkEle(), doClose: () => {}});
			await CharacterSheetModal.pGetShow({title: "B"});

			expect(h1.id).not.toBe(h2.id);
		});
	});

	describe("the close button", () => {
		it("adds one to a titled, closeable modal", async () => {
			await CharacterSheetModal.pGetShow({title: "Harvest"});

			expect(calls[0].eleTitleSplit).toBeTruthy();
		});

		it("does not offer to close a modal that cannot be closed", async () => {
			await CharacterSheetModal.pGetShow({title: "Loading", isPermanent: true});

			expect(calls[0].eleTitleSplit).toBeFalsy();
		});

		it("does not add one to a chrome-less modal", async () => {
			await CharacterSheetModal.pGetShow({isEmpty: true});

			expect(calls[0].eleTitleSplit).toBeFalsy();
		});
	});

	describe("Escape", () => {
		// `UiUtil`'s document-level handler bails on `EventUtil.isInInput`, and several of our
		// modals autofocus a search field on open — so Escape was dead exactly when it was most
		// likely to be pressed.
		it("closes from inside a text input, which the site handler refuses to do", async () => {
			globalThis.EventUtil.isInInput = () => true;
			let isClosed = false;
			nextModal = () => ({eleModal: mkEle(), eleModalInner: mkEle(), doClose: () => { isClosed = true; }});

			const modal = await CharacterSheetModal.pGetShow({title: "Harvest"});
			const evt = mkEvent("Escape");
			modal.eleModal.dispatch("keydown", evt);

			expect(isClosed).toBe(true);
			expect(evt.isDefaultPrevented).toBe(true);
		});

		it("leaves the ordinary case to the site handler, so it cannot double-close", async () => {
			globalThis.EventUtil.isInInput = () => false;
			let nClosed = 0;
			nextModal = () => ({eleModal: mkEle(), eleModalInner: mkEle(), doClose: () => { nClosed++; }});

			const modal = await CharacterSheetModal.pGetShow({title: "Harvest"});
			modal.eleModal.dispatch("keydown", mkEvent("Escape"));

			expect(nClosed).toBe(0);
		});

		it("does nothing on a permanent modal", async () => {
			globalThis.EventUtil.isInInput = () => true;
			let isClosed = false;
			nextModal = () => ({eleModal: mkEle(), eleModalInner: mkEle(), doClose: () => { isClosed = true; }});

			const modal = await CharacterSheetModal.pGetShow({title: "Loading", isPermanent: true});
			modal.eleModal.dispatch("keydown", mkEvent("Escape"));

			expect(isClosed).toBe(false);
		});
	});

	describe("the focus trap", () => {
		const mkTrapped = async () => {
			const first = mkEle({tag: "button"});
			const last = mkEle({tag: "button"});
			nextModal = () => ({eleModal: mkEle({children: [first, last]}), eleModalInner: mkEle(), doClose: () => {}});
			const modal = await CharacterSheetModal.pGetShow({title: "Harvest"});
			return {modal, first, last};
		};

		it("wraps forward from the last element to the first", async () => {
			const {modal, first, last} = await mkTrapped();
			globalThis.document.activeElement = last;

			const evt = mkEvent("Tab");
			modal.eleModal.dispatch("keydown", evt);

			expect(evt.isDefaultPrevented).toBe(true);
			expect(first.isFocused).toBe(true);
		});

		it("wraps backward from the first element to the last", async () => {
			const {modal, first, last} = await mkTrapped();
			globalThis.document.activeElement = first;

			const evt = mkEvent("Tab", {shiftKey: true});
			modal.eleModal.dispatch("keydown", evt);

			expect(evt.isDefaultPrevented).toBe(true);
			expect(last.isFocused).toBe(true);
		});

		it("leaves an ordinary Tab in the middle alone", async () => {
			const middle = mkEle({tag: "button"});
			const first = mkEle({tag: "button"});
			const last = mkEle({tag: "button"});
			nextModal = () => ({eleModal: mkEle({children: [first, middle, last]}), eleModalInner: mkEle(), doClose: () => {}});
			const modal = await CharacterSheetModal.pGetShow({title: "Harvest"});
			globalThis.document.activeElement = middle;

			const evt = mkEvent("Tab");
			modal.eleModal.dispatch("keydown", evt);

			expect(evt.isDefaultPrevented).toBe(false);
		});

		it("does nothing when the modal holds nothing focusable", async () => {
			nextModal = () => ({eleModal: mkEle({children: []}), eleModalInner: mkEle(), doClose: () => {}});
			const modal = await CharacterSheetModal.pGetShow({title: "Harvest"});

			const evt = mkEvent("Tab");
			expect(() => modal.eleModal.dispatch("keydown", evt)).not.toThrow();
			expect(evt.isDefaultPrevented).toBe(false);
		});

		it("skips elements that are hidden", async () => {
			const hidden = mkEle({tag: "button", isVisible: false});
			const visible = mkEle({tag: "button"});
			nextModal = () => ({eleModal: mkEle({children: [hidden, visible]}), eleModalInner: mkEle(), doClose: () => {}});
			const modal = await CharacterSheetModal.pGetShow({title: "Harvest"});
			globalThis.document.activeElement = visible;

			// `visible` is both first and last once the hidden one is filtered out, so a forward
			// Tab should wrap onto itself rather than reaching the hidden element.
			const evt = mkEvent("Tab");
			modal.eleModal.dispatch("keydown", evt);

			expect(hidden.isFocused).toBeUndefined();
			expect(visible.isFocused).toBe(true);
		});
	});
});
