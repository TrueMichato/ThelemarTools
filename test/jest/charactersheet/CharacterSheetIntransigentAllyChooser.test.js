/**
 * (#11) Intransigent ally-chooser UI control.
 *
 * S-B owns the Intransigent charmed-immunity MECHANICS and the state API
 * (`getIntransigentAllyCount` / `setIntransigentAllyCount`) plus the dynamic feature
 * summary. THIS session (S-A, feature/abilities render) owns the interactive control in
 * the Intransigent feature row that reads/writes that API and re-renders the summary.
 *
 * The API lands on S-B's branch and is present in the integrated tree, so these tests
 * stub the contract on the state instance (faithful to S-B's signatures) and assert what
 * `_renderFeature` emits. The charactersheet Jest env renders through a string-based `e_`
 * mock (no live DOM events), so the interactive change->setter->re-render path is covered
 * by LIVE browser verification; here we prove the RENDER contract:
 *   - a numeric input seeded from getIntransigentAllyCount() appears when the API + the
 *     hasIntransigent calc are present (with min/max/type and the 10-ft range text),
 *   - NO control is emitted (and nothing throws) when the API is absent — the feature-detect
 *     guard that keeps this safe on a non-integrated branch,
 *   - the control is scoped to the Intransigent feature only.
 */
import "./setup.js";
import {jest} from "@jest/globals";

// CharacterSheetFeatures' constructor wires a global click listener.
if (typeof globalThis.document === "undefined") {
	globalThis.document = {addEventListener () {}, removeEventListener () {}};
}

import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-features.js";

const CharacterSheetState = globalThis.CharacterSheetState;
const CharacterSheetFeatures = globalThis.CharacterSheetFeatures;

const INTRANSIGENT_FEATURE = {
	id: "intransigent-1",
	name: "Intransigent",
	featureType: "Class",
	className: "Illrigger",
	classSource: "IllriggerRevised",
	source: "IllriggerRevised",
	level: 11,
	entries: ["You can't be charmed while conscious, and you may extend this to creatures of your choice within 10 feet of you."],
};

/** Pull an attribute value out of the first input match for a class in the rendered HTML. */
function attrOf (html, klass, attr) {
	const tag = (html.match(new RegExp(`<input[^>]*${klass}[^>]*>`)) || [])[0] || "";
	return (tag.match(new RegExp(`${attr}="([^"]*)"`)) || [])[1] ?? null;
}

/**
 * Build a CharacterSheetFeatures wired to a real state + mocked page. `withApi` controls
 * whether S-B's ally-count API is present (simulating pre- vs post-integration trees).
 */
function makeFeatures ({withApi = true, initialCount = 0} = {}) {
	const state = new CharacterSheetState();
	state.addClass({name: "Illrigger", source: "TGTT-IllR", level: 11});

	// Force the calc the control gates on (S-B owns the real derivation).
	state.getFeatureCalculations = () => ({hasIntransigent: true, intransigentRange: 10});

	let stored = initialCount;
	const setSpy = jest.fn((count) => {
		const n = Number(count);
		stored = Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
		return stored;
	});
	if (withApi) {
		state.getIntransigentAllyCount = () => stored;
		state.setIntransigentAllyCount = setSpy;
	}

	const featuresRenderSpy = jest.fn();
	const page = {
		getState: () => state,
		saveCharacter: jest.fn(),
		getClassFeatures: () => [],
		_features: {render: featuresRenderSpy},
		_getActivatableAbilityForFeature: () => null,
		_getFeatureHoverLink: (f) => f.name,
		_renderFavouriteStar: () => null,
	};

	const features = new CharacterSheetFeatures(page);
	features._expandedFeatures = new Set([INTRANSIGENT_FEATURE.id]);
	return {features, state, page, setSpy, featuresRenderSpy};
}

describe("#11 Intransigent ally-chooser control", () => {
	test("renders a numeric input seeded from getIntransigentAllyCount() when the API is present", () => {
		const {features} = makeFeatures({withApi: true, initialCount: 2});
		const html = features._renderFeature({...INTRANSIGENT_FEATURE}).outerHTML || "";

		expect(html).toContain("charsheet__intransigent-ally-count");
		expect(attrOf(html, "charsheet__intransigent-ally-count", "type")).toBe("number");
		expect(attrOf(html, "charsheet__intransigent-ally-count", "min")).toBe("0");
		// Seeded from the API, not a hard-coded default.
		expect(attrOf(html, "charsheet__intransigent-ally-count", "value")).toBe("2");
		// Surfaces the aura's 10-ft / conscious gating from the calc.
		expect(html).toContain("within 10 ft");
	});

	test("the seeded value follows the API (a different stored count renders a different value)", () => {
		const a = makeFeatures({withApi: true, initialCount: 0});
		const b = makeFeatures({withApi: true, initialCount: 5});
		const htmlA = a.features._renderFeature({...INTRANSIGENT_FEATURE}).outerHTML || "";
		const htmlB = b.features._renderFeature({...INTRANSIGENT_FEATURE}).outerHTML || "";
		expect(attrOf(htmlA, "charsheet__intransigent-ally-count", "value")).toBe("0");
		expect(attrOf(htmlB, "charsheet__intransigent-ally-count", "value")).toBe("5");
	});

	test("an over-ceiling stored value is clamped to the UI max on render", () => {
		const {features} = makeFeatures({withApi: true, initialCount: 999});
		const html = features._renderFeature({...INTRANSIGENT_FEATURE}).outerHTML || "";
		const max = Number(attrOf(html, "charsheet__intransigent-ally-count", "max"));
		expect(max).toBeGreaterThan(0);
		expect(Number(attrOf(html, "charsheet__intransigent-ally-count", "value"))).toBe(max);
	});

	test("is inert (no control, no throw) when the ally-count API is absent", () => {
		const {features} = makeFeatures({withApi: false});
		let html;
		expect(() => { html = features._renderFeature({...INTRANSIGENT_FEATURE}).outerHTML || ""; }).not.toThrow();
		expect(html).not.toContain("charsheet__intransigent-ally-count");
	});

	test("the control is not added to unrelated features", () => {
		const {features} = makeFeatures({withApi: true});
		const html = features._renderFeature({
			id: "other-1",
			name: "Some Other Feature",
			featureType: "Class",
			className: "Illrigger",
			source: "IllriggerRevised",
			level: 11,
			entries: ["..."],
		}).outerHTML || "";
		expect(html).not.toContain("charsheet__intransigent-ally-count");
	});
});
