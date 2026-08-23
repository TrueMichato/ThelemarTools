/**
 * Mobile collapsible sections — resting `max-height` policy.
 *
 * The rule this file defends: **`max-height` is a transition device, never a
 * resting state.** A pinned pixel value freezes a section at whatever it
 * measured at that instant, so every piece of content that renders afterwards
 * — favourite spells, proficiencies, an added item — is clipped with no
 * scrollbar and no affordance to reveal it. That is silent data loss, and it
 * shipped: six Overview sections were hiding up to 176px each.
 *
 * `_releaseMaxHeight` touches only `classList.contains`, `style.maxHeight` and
 * the listener pair, so it is exercised here with fakes in the repo's DOM-less
 * node environment.
 *
 * The module has a load-time DOM guard, so stub the globals before importing.
 */

import {jest} from "@jest/globals";

globalThis.document = {
	addEventListener: () => {},
	removeEventListener: () => {},
	querySelector: () => null,
	querySelectorAll: () => [],
	getElementById: () => null,
	createElement: () => ({style: {}, classList: {add: () => {}, remove: () => {}, toggle: () => {}}, dataset: {}, setAttribute: () => {}, appendChild: () => {}, addEventListener: () => {}}),
	body: {classList: {add: () => {}, remove: () => {}, toggle: () => {}, contains: () => false}},
	documentElement: {style: {}},
};
globalThis.window = {
	addEventListener: () => {},
	removeEventListener: () => {},
	matchMedia: () => ({matches: false, addEventListener: () => {}, addListener: () => {}}),
	innerWidth: 1280,
};
globalThis.navigator = {maxTouchPoints: 0, userAgent: "node"};

await import("../../../js/charactersheet/charactersheet-mobile.js");
const CharacterSheetMobile = globalThis.CharacterSheetMobile;

const COLLAPSED_CLASS = "charsheet-mobile--collapsed";

function makeSection ({collapsed = false} = {}) {
	const classes = new Set(collapsed ? [COLLAPSED_CLASS] : []);
	return {
		classList: {
			contains: cls => classes.has(cls),
			add: cls => classes.add(cls),
			remove: cls => classes.delete(cls),
		},
	};
}

function makeWrapper () {
	const listeners = [];
	const classes = new Set();
	return {
		style: {maxHeight: "120px"},
		listeners,
		classList: {
			contains: cls => classes.has(cls),
			add: cls => classes.add(cls),
			remove: cls => classes.delete(cls),
		},
		addEventListener: (type, fn) => listeners.push({type, fn}),
		removeEventListener: (type, fn) => {
			const ix = listeners.findIndex(l => l.type === type && l.fn === fn);
			if (~ix) listeners.splice(ix, 1);
		},
		fire (evt) {
			[...listeners].filter(l => l.type === "transitionend").forEach(l => l.fn(evt));
		},
	};
}

// A bare instance: `_releaseMaxHeight` needs no constructor state.
const mobile = Object.create(CharacterSheetMobile.prototype);

describe("CharacterSheetMobile._releaseMaxHeight", () => {
	beforeEach(() => jest.useFakeTimers());
	afterEach(() => jest.useRealTimers());

	it("releases the pinned height once the section's own max-height transition ends", () => {
		const section = makeSection();
		const wrapper = makeWrapper();

		mobile._releaseMaxHeight(section, wrapper);
		expect(wrapper.style.maxHeight).toBe("120px");
		expect(wrapper.classList.contains("charsheet-mobile__section-content--animating")).toBe(true);

		wrapper.fire({target: wrapper, propertyName: "max-height"});

		expect(wrapper.style.maxHeight).toBe("none");
		expect(wrapper.classList.contains("charsheet-mobile__section-content--animating")).toBe(false);
	});

	it("releases via the timeout when no transition fires — the reduced-motion path", () => {
		const section = makeSection();
		const wrapper = makeWrapper();

		mobile._releaseMaxHeight(section, wrapper);
		expect(wrapper.style.maxHeight).toBe("120px");

		jest.advanceTimersByTime(CharacterSheetMobile._MAX_HEIGHT_RELEASE_MS);

		expect(wrapper.style.maxHeight).toBe("none");
		expect(wrapper.classList.contains("charsheet-mobile__section-content--animating")).toBe(false);
	});

	it("outlasts the CSS transition, so the fallback never pre-empts the animation", () => {
		// `.charsheet-mobile__section-content` transitions max-height over 0.3s.
		expect(CharacterSheetMobile._MAX_HEIGHT_RELEASE_MS).toBeGreaterThan(300);
	});

	it("ignores transitions bubbling up from descendants", () => {
		const section = makeSection();
		const wrapper = makeWrapper();

		mobile._releaseMaxHeight(section, wrapper);
		wrapper.fire({target: {}, propertyName: "max-height"});
		expect(wrapper.style.maxHeight).toBe("120px");

		wrapper.fire({target: wrapper, propertyName: "opacity"});
		expect(wrapper.style.maxHeight).toBe("120px");
	});

	it("leaves the height alone when the section was re-collapsed mid-transition", () => {
		const section = makeSection();
		const wrapper = makeWrapper();

		mobile._releaseMaxHeight(section, wrapper);
		// User taps again before the expand finishes; the collapse handler owns the height.
		section.classList.add(COLLAPSED_CLASS);
		wrapper.style.maxHeight = "0";
		wrapper.fire({target: wrapper, propertyName: "max-height"});

		expect(wrapper.style.maxHeight).toBe("0");
	});

	it("does not release twice — the timeout is cancelled once the transition lands", () => {
		const section = makeSection();
		const wrapper = makeWrapper();

		mobile._releaseMaxHeight(section, wrapper);
		wrapper.fire({target: wrapper, propertyName: "max-height"});
		expect(wrapper.style.maxHeight).toBe("none");

		// A later collapse pins the height again; the stale timeout must not undo it.
		section.classList.add(COLLAPSED_CLASS);
		wrapper.style.maxHeight = "0";
		jest.advanceTimersByTime(CharacterSheetMobile._MAX_HEIGHT_RELEASE_MS * 4);

		expect(wrapper.style.maxHeight).toBe("0");
	});

	it("detaches its listener after releasing, leaving nothing bound to the wrapper", () => {
		const section = makeSection();
		const wrapper = makeWrapper();

		mobile._releaseMaxHeight(section, wrapper);
		expect(wrapper.listeners).toHaveLength(1);

		wrapper.fire({target: wrapper, propertyName: "max-height"});

		expect(wrapper.listeners).toHaveLength(0);
	});
});

describe("mobile section disclosure accessibility", () => {
	it("adds a native disclosure button and keeps aria-expanded synchronized", () => {
		const sectionClasses = new Set();
		const section = {
			children: [],
			dataset: {mobileSectionRole: "action"},
			classList: {
				contains: cls => sectionClasses.has(cls),
				add: cls => sectionClasses.add(cls),
				toggle: cls => {
					if (sectionClasses.has(cls)) {
						sectionClasses.delete(cls);
						return false;
					}
					sectionClasses.add(cls);
					return true;
				},
			},
			querySelector: selector => selector === ".charsheet__section-title" ? title : null,
			appendChild: child => section.children.push(child),
		};
		const titleListeners = {};
		const title = {
			dataset: {},
			textContent: "Defenses",
			parentElement: section,
			appendChild: child => { title.toggleButton = child; },
			addEventListener: (type, fn) => { titleListeners[type] = fn; },
		};
		const body = {parentElement: section};
		section.children = [title, body];

		const originalQuerySelectorAll = document.querySelectorAll;
		const originalCreateElement = document.createElement;
		document.querySelectorAll = () => [section];
		document.createElement = tag => {
			const attributes = {};
			const listeners = {};
			return {
				tag,
				attributes,
				listeners,
				style: {},
				classList: {add: () => {}, remove: () => {}},
				setAttribute: (name, value) => { attributes[name] = value; },
				appendChild: () => {},
				addEventListener: (type, fn) => { listeners[type] = fn; },
				removeEventListener: () => {},
			};
		};
		mobile._haptic = jest.fn();

		try {
			mobile._initCollapsibleSections();
			const button = title.toggleButton;
			expect(button.tag).toBe("button");
			expect(button.type).toBe("button");
			expect(button.attributes["aria-controls"]).toBe("charsheet-mobile-section-content-0");
			expect(button.attributes["aria-expanded"]).toBe("true");

			button.listeners.click({stopPropagation: jest.fn()});

			expect(sectionClasses.has(COLLAPSED_CLASS)).toBe(true);
			expect(button.attributes["aria-expanded"]).toBe("false");
		} finally {
			document.querySelectorAll = originalQuerySelectorAll;
			document.createElement = originalCreateElement;
		}
	});
});
