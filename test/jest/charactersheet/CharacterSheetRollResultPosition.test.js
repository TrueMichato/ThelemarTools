import {jest} from "@jest/globals";
import "./setup.js";

let CharacterSheetPage;
let previousWindow;
let previousDocument;
const previousFactory = globalThis.e_;
let currentResult;
let chrome;
let resizeObservers;
let mutationObservers;

const makeElement = (html = "") => {
	const properties = new Map();
	const selectors = new Map();
	const el = {
		outerHTML: html,
		isConnected: true,
		style: {setProperty: (key, value) => properties.set(key, value), getPropertyValue: key => properties.get(key)},
		querySelector: selector => {
			if (!selectors.has(selector)) selectors.set(selector, makeElement());
			return selectors.get(selector);
		},
		addEventListener: jest.fn(),
		remove: jest.fn(() => {
			el.isConnected = false;
			if (currentResult === el) currentResult = null;
		}),
	};
	return el;
};

const makeChrome = (top, height, style = {}) => ({
	isConnected: true,
	computedStyle: {position: "fixed", visibility: "visible", ...style},
	getBoundingClientRect: () => ({top, bottom: top + height, height}),
});

beforeAll(async () => {
	previousWindow = globalThis.window;
	previousDocument = globalThis.document;
	globalThis.e_ = opts => makeElement(opts.outer);
	globalThis.window = {addEventListener: () => {}};
	globalThis.document = {querySelector: () => null, getElementById: () => null};
	({CharacterSheetPage} = await import("../../../js/charactersheet/charactersheet.js"));
});

afterAll(() => {
	globalThis.window = previousWindow;
	globalThis.document = previousDocument;
	globalThis.e_ = previousFactory;
});

beforeEach(() => {
	jest.useFakeTimers();
	currentResult = null;
	chrome = [makeChrome(681, 59), makeChrome(635, 49)];
	resizeObservers = [];
	mutationObservers = [];
	class Observer {
		constructor (callback) {
			this.callback = callback;
			this.observe = jest.fn();
			this.unobserve = jest.fn();
			this.disconnect = jest.fn();
		}
	}
	globalThis.window = {
		innerHeight: 740,
		addEventListener: jest.fn(),
		removeEventListener: jest.fn(),
		requestAnimationFrame: jest.fn(callback => setTimeout(callback, 16)),
		cancelAnimationFrame: jest.fn(id => clearTimeout(id)),
		getComputedStyle: el => el.computedStyle,
		visualViewport: {
			offsetTop: 0,
			height: 740,
			addEventListener: jest.fn(),
			removeEventListener: jest.fn(),
		},
		ResizeObserver: class extends Observer {
			constructor (callback) { super(callback); resizeObservers.push(this); }
		},
		MutationObserver: class extends Observer {
			constructor (callback) { super(callback); mutationObservers.push(this); }
		},
	};
	globalThis.document = {
		body: {append: el => { currentResult = el; }},
		querySelector: selector => selector === ".charsheet__dice-result" ? currentResult : {},
		querySelectorAll: () => chrome,
	};
});

afterEach(() => {
	jest.clearAllTimers();
	jest.useRealTimers();
});

const makePage = () => {
	const page = Object.create(CharacterSheetPage.prototype);
	page._rollHistory = {addRoll: jest.fn()};
	return page;
};
const show = page => page._showDiceResult("Attack", 17, "1d20 (12) + 5");

describe("real roll-result positioning and lifecycle", () => {
	it("reserves actual visible navigation including the status mirror, not its nominal 56px token", () => {
		const page = makePage();
		const result = show(page);
		expect(result.style.getPropertyValue("--cs-roll-bottom-offset")).toBe("105px");
		expect(page._rollHistory.addRoll).toHaveBeenCalledWith(expect.objectContaining({total: 17, breakdown: "1d20 (12) + 5"}));
		expect(result.outerHTML).toContain("aria-label=\"Dismiss roll result\"");
		page._dismissDiceResult(result);
	});

	it("ignores hidden/static chrome and counts a safe-area-sized bar only once", () => {
		const page = makePage();
		chrome = [makeChrome(649, 91), makeChrome(600, 0), makeChrome(50, 40, {position: "static"}), makeChrome(400, 50, {visibility: "hidden"})];
		const result = show(page);
		expect(result.style.getPropertyValue("--cs-roll-bottom-offset")).toBe("91px");
		chrome = [];
		page._positionDiceResult(result);
		expect(result.style.getPropertyValue("--cs-roll-bottom-offset")).toBe("0px");
		page._dismissDiceResult(result);
	});

	it("bounds to the visual viewport and excludes navigation outside it", () => {
		const page = makePage();
		window.visualViewport.offsetTop = 80;
		window.visualViewport.height = 400;
		const result = show(page);
		expect(result.style.getPropertyValue("--cs-roll-bottom-offset")).toBe("260px");
		expect(result.style.getPropertyValue("--cs-roll-viewport-top")).toBe("80px");
		page._dismissDiceResult(result);
	});

	it("coalesces height/visibility/resize changes and observes replacement mobile chrome", () => {
		const page = makePage();
		const result = show(page);
		expect(resizeObservers[0].observe).toHaveBeenCalledTimes(2);
		chrome[0].isConnected = false;
		chrome = [makeChrome(621, 119)];
		resizeObservers[0].callback();
		mutationObservers[0].callback();
		expect(window.requestAnimationFrame).toHaveBeenCalledTimes(1);
		jest.advanceTimersByTime(16);
		expect(result.style.getPropertyValue("--cs-roll-bottom-offset")).toBe("119px");
		expect(resizeObservers[0].unobserve).toHaveBeenCalledTimes(1);
		expect(resizeObservers[0].observe).toHaveBeenCalledTimes(3);
		page._dismissDiceResult(result);
	});

	it("replacement cancels the previous timer and all observers/listeners, including a queued frame", () => {
		const page = makePage();
		const first = show(page);
		resizeObservers[0].callback();
		const second = show(page);
		expect(first.remove).toHaveBeenCalledTimes(1);
		expect(first.__positionCleanup).toBeNull();
		expect(resizeObservers[0].disconnect).toHaveBeenCalledTimes(1);
		expect(mutationObservers[0].disconnect).toHaveBeenCalledTimes(1);
		expect(window.cancelAnimationFrame).toHaveBeenCalledTimes(1);
		expect(window.removeEventListener).toHaveBeenCalledWith("resize", expect.any(Function));
		expect(window.visualViewport.removeEventListener).toHaveBeenCalledWith("scroll", expect.any(Function));
		expect(jest.getTimerCount()).toBe(1);
		page._dismissDiceResult(second);
		expect(jest.getTimerCount()).toBe(0);
		expect(page._lastDiceResultEl).toBeNull();
	});

	it("keeps the extended reaction window and cleans up on timed dismissal", () => {
		const page = makePage();
		const result = show(page);
		page._scheduleDiceResultDismiss(result, 15000);
		jest.advanceTimersByTime(5300);
		expect(result.remove).not.toHaveBeenCalled();
		jest.advanceTimersByTime(10000);
		expect(result.remove).toHaveBeenCalledTimes(1);
		expect(resizeObservers[0].disconnect).toHaveBeenCalledTimes(1);
		expect(mutationObservers[0].disconnect).toHaveBeenCalledTimes(1);
		expect(jest.getTimerCount()).toBe(0);
	});

	it("also releases positioning if an external caller detaches the toast", () => {
		const page = makePage();
		const result = show(page);
		result.remove();
		mutationObservers[0].callback();
		jest.advanceTimersByTime(16);
		expect(result.__positionCleanup).toBeNull();
		expect(jest.getTimerCount()).toBe(0);
	});
});
