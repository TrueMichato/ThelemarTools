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
	} else {
		// In the integrated tree S-B's ally-count API are real prototype methods on
		// CharacterSheetState, so "absent" must explicitly shadow them on the instance to
		// faithfully exercise the feature-detect guard (typeof !== "function").
		state.getIntransigentAllyCount = undefined;
		state.setIntransigentAllyCount = undefined;
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

describe("#11 Intransigent extend-to-allies signifier", () => {
	test("renders an explicit '➕ Extend immunity to allies' title + labelled stepper", () => {
		const {features} = makeFeatures({withApi: true, initialCount: 0});
		const html = features._renderFeature({...INTRANSIGENT_FEATURE}).outerHTML || "";

		// An unmistakable heading that names the extend-to-others action.
		expect(html).toContain("charsheet__intransigent-title");
		expect(html).toContain("➕ Extend immunity to allies");
		// A dedicated, visually set-off extend action section.
		expect(html).toContain("charsheet__intransigent-extend");
		// The stepper carries an inline label so it reads as a choice, not a stat.
		expect(html).toContain("charsheet__intransigent-label");
		expect(html).toContain("Creatures you choose to protect:");
		// ±stepper buttons make the extend action a real control.
		expect(html).toContain("charsheet__intransigent-step");
		const stepData = [...html.matchAll(/charsheet__intransigent-step[^>]*data-step="(-?\d)"/g)].map(m => m[1]);
		expect(stepData).toEqual(expect.arrayContaining(["1", "-1"]));
	});

	test("the feature text sets no cap, so the UI signals 'no fixed limit' (no misleading hard cap)", () => {
		const {features} = makeFeatures({withApi: true, initialCount: 0});
		const html = features._renderFeature({...INTRANSIGENT_FEATURE}).outerHTML || "";
		expect(html).toContain("no fixed limit");
		// The numeric input keeps only a sanity bound, not a rules cap of 12.
		expect(Number(attrOf(html, "charsheet__intransigent-ally-count", "max"))).toBeGreaterThan(12);
	});

	test("at zero allies the status badge reads 'Only you are immune' and advertises the extend option", () => {
		const {features} = makeFeatures({withApi: true, initialCount: 0});
		const html = features._renderFeature({...INTRANSIGENT_FEATURE}).outerHTML || "";
		expect(html).toContain("charsheet__intransigent-live");
		expect(html).toContain("charsheet__intransigent-status");
		// At zero, the status is the gold call-to-action variant.
		expect(html).toContain("charsheet__intransigent-live--extend");
		// The badge distinctly states the self-only scope (while conscious)…
		expect(html).toContain("Only you are immune to charmed");
		expect(html).toContain("while you are conscious");
		// …and the extend section advertises sharing it BEFORE anyone is chosen.
		expect(html).toMatch(/share this immunity/i);
		expect(html).toMatch(/haven't extended it to anyone yet/i);
	});

	test("the status badge reflects the chosen ally count (singular/plural) and flips to the active accent", () => {
		const one = makeFeatures({withApi: true, initialCount: 1});
		const many = makeFeatures({withApi: true, initialCount: 3});
		const htmlOne = one.features._renderFeature({...INTRANSIGENT_FEATURE}).outerHTML || "";
		const htmlMany = many.features._renderFeature({...INTRANSIGENT_FEATURE}).outerHTML || "";

		// A non-zero count flips the accent to the emerald "active" modifier.
		expect(htmlOne).toContain("charsheet__intransigent-live--active");
		expect(htmlMany).toContain("charsheet__intransigent-live--active");

		const head = (html) => (html.match(/charsheet__intransigent-status-head[^>]*>([^<]*)</) || [])[1] || "";
		expect(head(htmlOne)).toMatch(/You \+ 1 chosen ally within 10 ft are immune to charmed/);
		expect(head(htmlMany)).toMatch(/You \+ 3 chosen allies within 10 ft are immune to charmed/);
	});
});

// (R27 #3) Repeat report: "Intransigent still has no badge anywhere in the sheet". The R26
// status badge lives in the feature BODY, which is collapsed by default — so on the
// un-expanded card there was no visible signal at all. The fix adds a compact badge to the
// feature HEADER (always rendered, even while the body is collapsed) that flips
// gold(warning)->emerald(success) and states the live charmed-immunity scope at a glance.
describe("#11 / R27 #3 — Intransigent collapsed-card header badge", () => {
	/** Render the Intransigent card with the body COLLAPSED (the default accordion state). */
	function renderCollapsed (opts) {
		const {features} = makeFeatures(opts);
		features._expandedFeatures = new Set(); // collapsed: body is display:none
		return features._renderFeature({...INTRANSIGENT_FEATURE}).outerHTML || "";
	}

	/** Extract the feature HEADER markup (everything before the feature body opens). */
	function headerOf (html) {
		const bodyIdx = html.indexOf("charsheet__feature-body");
		return bodyIdx >= 0 ? html.slice(0, bodyIdx) : html;
	}

	test("emits a header badge even when the feature body is collapsed (no longer buried)", () => {
		const html = renderCollapsed({withApi: true, initialCount: 0});
		// Body is collapsed…
		expect(html).toContain("charsheet__feature-body\" style=\"display: none;\"");
		// …yet a charmed-immunity badge is present in the HEADER, before the body.
		const header = headerOf(html);
		expect(header).toMatch(/Charmed-immune/i);
		expect(header).toContain("badge");
	});

	test("at zero allies the header badge is the gold 'extendable' variant", () => {
		const header = headerOf(renderCollapsed({withApi: true, initialCount: 0}));
		expect(header).toContain("badge-warning");
		expect(header).toMatch(/Charmed-immune \(extendable\)/i);
		expect(header).not.toContain("badge-success");
	});

	test("with allies chosen the header badge flips to the emerald 'You + N' variant", () => {
		const headerOne = headerOf(renderCollapsed({withApi: true, initialCount: 1}));
		expect(headerOne).toContain("badge-success");
		expect(headerOne).toMatch(/Charmed-immune: You \+ 1 ally/i);

		const headerMany = headerOf(renderCollapsed({withApi: true, initialCount: 3}));
		expect(headerMany).toContain("badge-success");
		expect(headerMany).toMatch(/Charmed-immune: You \+ 3 allies/i);
	});

	test("no header badge when the ally-count API is absent (inert on a non-integrated tree)", () => {
		const header = headerOf(renderCollapsed({withApi: false}));
		expect(header).not.toMatch(/Charmed-immune/i);
	});
});
