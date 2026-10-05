import {beforeAll, beforeEach, afterEach, describe, expect, jest, test} from "@jest/globals";
import "./setup.js";

let CharacterSheetPage;
let elements;

class Element {
	constructor () {
		this.tagName = "DIV";
		this.attributes = new Map();
		this.listeners = new Map();
		this.children = [];
		this.dataset = {};
		this.style = {};
		this.isConnected = true;
		this.offsetWidth = 320;
		this.offsetHeight = 200;
		this.open = false;
	}

	setAttribute (name, value) { this.attributes.set(name, value); }
	getAttribute (name) { return this.attributes.get(name); }
	hasAttribute (name) { return this.attributes.has(name); }
	removeAttribute (name) { this.attributes.delete(name); }
	append (...children) {
		children.forEach(child => { child.parentElement = this; });
		this.children.push(...children);
	}
	replaceChildren () { this.children = []; }
	contains (target) { return target === this || this.children.some(child => child.contains(target)); }
	querySelectorAll () { return this.children.flatMap(child => [child, ...child.querySelectorAll()]).filter(child => child.attributes.has("title") || child.attributes.has("data-tooltip")); }
	getBoundingClientRect () { return {left: 480, top: 740, bottom: 780}; }
	matches () { return this.open; }
	addEventListener (name, listener) {
		if (!this.listeners.has(name)) this.listeners.set(name, []);
		this.listeners.get(name).push(listener);
	}

	emit (name, event = {}) {
		let stopped = false;
		const complete = {...event, preventDefault: jest.fn(), stopPropagation: jest.fn(() => { stopped = true; })};
		(this.listeners.get(name) || []).forEach(listener => listener(complete));
		if (event.bubbles && !stopped && this.parentElement) this.parentElement.emit(name, event);
		return complete;
	}

	dispatchEvent (event) { this.emit(event.type, event); }

	showPopover () {
		if (this.open) return;
		this.emit("beforetoggle", {newState: "open"});
		this.open = true;
	}

	hidePopover () {
		if (!this.open) return;
		this.emit("beforetoggle", {newState: "closed"});
		this.open = false;
	}
}

beforeAll(async () => {
	globalThis.window = {addEventListener: () => {}, location: {search: ""}, matchMedia: () => ({matches: false})};
	globalThis.document = {addEventListener: () => {}, querySelector: () => null};
	await import("../../../js/charactersheet/charactersheet.js");
	CharacterSheetPage = globalThis.CharacterSheetPage;
});

beforeEach(() => {
	jest.useFakeTimers();
	elements = [];
	globalThis.window = {clearTimeout, setTimeout, innerHeight: 844};
	globalThis.MouseEvent = class {
		constructor (type, options) { Object.assign(this, {type}, options); }
	};
	globalThis.document = {
		activeElement: null,
		documentElement: {clientWidth: 390},
		createElement: () => {
			const element = new Element();
			elements.push(element);
			return element;
		},
		getElementById: id => elements.find(element => element.id === id),
	};
});

afterEach(() => jest.useRealTimers());

function bind () {
	const page = Object.create(CharacterSheetPage.prototype);
	page._state = {
		getAbilityScoreBreakdown: jest.fn(() => ({
			total: 20,
			components: [
				{source: "base", label: "Base / earlier adjustments", amount: 20},
				{source: "acquisition", label: "ASI - Fighter [PHB] level 4", amount: null},
				{source: "featAcquisition", label: "Durable [PHB]", amount: 0},
			],
		})),
		getAbilityCheckBreakdown: () => ({total: 5, canonical: 5, components: [{name: "STR modifier", value: 5}]}),
	};
	const block = new Element();
	const score = new Element();
	const modifier = new Element();
	block.setAttribute("title", "competing block information");
	modifier.setAttribute("title", "competing check information");
	block.append(score, modifier);
	score.parentElement = block;
	page._bindAbilityScoreDisclosure(score, "str", {hoverTarget: block, includeCheckBreakdown: true});
	return {page, block, score, modifier, popover: block.children[2]};
}

describe("ability disclosure at the real binder and formatter", () => {
	test("whole-block mouse hover/focus opens the sole disclosure without adding a card pin target", () => {
		const {block, score, popover} = bind();
		expect(block.attributes.has("title")).toBe(false);
		expect(block.querySelectorAll()).toHaveLength(0);
		expect(block.listeners.has("click")).toBe(false);
		expect(score.listeners.has("pointerenter")).toBe(false);
		block.emit("pointerenter", {pointerType: "mouse"});
		expect(popover.open).toBe(true);
		expect(score.getAttribute("aria-expanded")).toBe("true");
		popover.hidePopover();
		block.emit("focusin", {target: score});
		expect(popover.open).toBe(true);
	});

	test("native light-dismiss before a second score click still unpins rather than reopening", () => {
		const {score, popover} = bind();
		expect(score.emit("click").stopPropagation).toHaveBeenCalled();
		expect(popover.open).toBe(true);
		// Native outside-click dismissal precedes click; its toggle event is queued.
		popover.hidePopover();
		expect(score.emit("click").stopPropagation).toHaveBeenCalled();
		expect(popover.open).toBe(false);
		popover.emit("toggle");
		expect(score.getAttribute("aria-expanded")).toBe("false");
	});

	test("native Enter/Space clicks pin/unpin, Escape closes, and touch never opens on hover alone", () => {
		const {block, score, popover} = bind();
		block.emit("pointerenter", {pointerType: "touch"});
		expect(popover.open).toBe(false);
		expect(score.emit("keydown", {key: "Enter"}).stopPropagation).toHaveBeenCalled();
		score.emit("click");
		expect(popover.open).toBe(true);
		expect(score.emit("keydown", {key: " "}).stopPropagation).toHaveBeenCalled();
		score.emit("click");
		expect(popover.open).toBe(false);
		score.emit("click");
		block.emit("keydown", {key: "Escape"});
		expect(popover.open).toBe(false);
		expect(score.getAttribute("aria-expanded")).toBe("false");
	});

	test("bound score events never roll; block and real modifier activation still roll once each", () => {
		const {page, block, score, modifier} = bind();
		const roll = jest.fn();
		block.addEventListener("click", roll);
		page._bindActivate(modifier, {label: "Roll Strength check"});
		score.emit("click", {bubbles: true});
		score.emit("keydown", {key: "Enter", bubbles: true});
		score.emit("click", {bubbles: true});
		score.emit("keydown", {key: " ", bubbles: true});
		score.emit("click", {bubbles: true});
		expect(roll).not.toHaveBeenCalled();
		block.emit("click");
		expect(roll).toHaveBeenCalledTimes(1);
		modifier.emit("click", {bubbles: true});
		expect(roll).toHaveBeenCalledTimes(2);
		modifier.emit("keydown", {key: "Enter"});
		expect(roll).toHaveBeenCalledTimes(3);
		modifier.emit("keydown", {key: " "});
		expect(roll).toHaveBeenCalledTimes(4);
	});

	test("pointer transfer to the popover and pinning preserve visibility; leaving an unpinned block hides", () => {
		const {block, score, popover} = bind();
		block.emit("pointerenter", {pointerType: "mouse"});
		block.emit("pointerleave", {relatedTarget: popover});
		jest.advanceTimersByTime(150);
		expect(popover.open).toBe(true);
		score.emit("click");
		block.emit("pointerleave");
		jest.advanceTimersByTime(150);
		expect(popover.open).toBe(true);
		score.emit("click");
		block.emit("pointerenter", {pointerType: "mouse"});
		block.emit("pointerleave");
		jest.advanceTimersByTime(150);
		expect(popover.open).toBe(false);
	});

	test("focusing the accessible Close action does not replace it before its click", () => {
		const {page, block, score, popover} = bind();
		score.emit("click");
		const close = popover.children[0].children[1];
		const refreshes = page._state.getAbilityScoreBreakdown.mock.calls.length;
		block.emit("focusin", {target: close});
		expect(page._state.getAbilityScoreBreakdown).toHaveBeenCalledTimes(refreshes);
		expect(close.getAttribute("aria-label")).toBe("Close Strength score breakdown");
		close.emit("click");
		popover.emit("toggle");
		expect(popover.open).toBe(false);
		expect(score.getAttribute("aria-expanded")).toBe("false");
	});

	test("formats unknown evidence as source-only, a proven zero as +0, and retains check context", () => {
		const {page, popover} = bind();
		const text = page._formatAbilityScoreBreakdown(page._state.getAbilityScoreBreakdown("str"));
		expect(text).toBe("Base / earlier adjustments: 20\nASI - Fighter [PHB] level 4\nDurable [PHB]: +0\nTotal: 20");
		expect(popover.children[2].children[1].textContent).toBe("");
		expect(popover.children[3].children[1].textContent).toBe("+0");
		expect(popover.children.at(-1).textContent).toContain("STR modifier: +5");
	});

	test("positions the same disclosure within the mobile viewport", () => {
		const {block, popover} = bind();
		block.emit("pointerenter", {pointerType: "mouse"});
		expect(Number.parseFloat(popover.style.left)).toBeGreaterThanOrEqual(8);
		expect(Number.parseFloat(popover.style.left) + popover.offsetWidth).toBeLessThanOrEqual(382);
		expect(Number.parseFloat(popover.style.top)).toBeGreaterThanOrEqual(8);
		expect(Number.parseFloat(popover.style.top) + popover.offsetHeight).toBeLessThanOrEqual(836);
	});
});
