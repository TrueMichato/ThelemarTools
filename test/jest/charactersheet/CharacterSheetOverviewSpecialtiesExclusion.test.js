/**
 * Character Sheet — Overview "Specialties & Feats" surface: Principles excluded, Divine Order
 * gets its OWN read-only group, genuine Specialties kept.
 *
 * R47 Bug 2. Divine Order is a ONE-TIME level-1 build choice, so it is no longer a mid-play field
 * of its own — it is shown inside `_renderOverviewSpecialtiesFeats` as a READ-ONLY "Divine Order"
 * group (partitioned out of the generic "Specialties" list, not excluded from the surface).
 * Principles of Devotion genuinely CAN change mid-play and keeps its own dedicated Overview
 * surface, so its picks are still EXCLUDED from this surface entirely. Genuine TGTT Specialties
 * (a DIFFERENT structured-choice parent) still appear under "Specialties".
 *
 * Classification is data-model based (never a name match on the option): a feature-option's parent
 * is read from BOTH its own `parentFeature` field AND the durable `chosenSubfeatures` linkage.
 *
 * `charactersheet.js` (the controller) is too global-heavy to import in jest, so we (1) source-pin
 * the production method and (2) drive a byte-faithful replica of its partition against a real state.
 */

import "./setup.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-state.js";
import {readFileSync} from "fs";
import {resolve, dirname} from "path";
import {fileURLToPath} from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "../../..");
const CharacterSheetState = globalThis.CharacterSheetState;

// Byte-faithful replica of the production partition (see the source-pin below).
function partitionFor (state) {
	const EXCLUDED_SURFACE_PARENTS = new Set(["principles of devotion"]);
	const DIVINE_ORDER_PARENT = "divine order";
	const eq = (v) => String(v || "").toLowerCase();
	const chosen = state.getChosenSubfeatures?.() || [];
	const keysForParents = (predicate) => new Set(
		chosen
			.filter(r => predicate(eq(r.parent)))
			.map(r => `${eq(r.name)}\u0000${eq(r.source)}`),
	);
	const excludedSubOptionKeys = keysForParents(p => EXCLUDED_SURFACE_PARENTS.has(p));
	const divineOrderSubOptionKeys = keysForParents(p => p === DIVINE_ORDER_PARENT);
	const isDivineOrderOption = (f) => eq(f.parentFeature) === DIVINE_ORDER_PARENT
		|| divineOrderSubOptionKeys.has(`${eq(f.name)}\u0000${eq(f.source)}`);
	const isExcluded = (f) => EXCLUDED_SURFACE_PARENTS.has(eq(f.parentFeature))
		|| excludedSubOptionKeys.has(`${eq(f.name)}\u0000${eq(f.source)}`);
	const featureOptions = (state.getFeatures?.() || []).filter(f => f.isFeatureOption === true);
	return {
		divineOrder: featureOptions.filter(f => isDivineOrderOption(f)),
		specialties: featureOptions.filter(f => !isExcluded(f) && !isDivineOrderOption(f)),
	};
}

function mkClericWithAllThree () {
	const state = new CharacterSheetState();
	state.addClass({name: "Cleric", source: "TGTT", level: 3});

	// Principle of Devotion pick — dedicated mid-play surface, must be EXCLUDED from this surface.
	state.setChosenSubfeature(
		{parent: "Principles of Devotion", parentClass: "Cleric", parentClassSource: "TGTT", level: 2},
		{name: "Chaste", source: "TGTT", className: "Cleric", classSource: "TGTT", entries: ["Boon of clarity."]},
	);
	// Divine Order pick — one-time build choice, now its OWN read-only group in this surface.
	state.setChosenSubfeature(
		{parent: "Divine Order", parentClass: "Cleric", parentClassSource: "TGTT", level: 1},
		{name: "Protector", source: "TGTT", className: "Cleric", classSource: "TGTT", entries: ["Martial weapons + heavy armor."]},
	);
	// Genuine TGTT Specialty — a DIFFERENT structured-choice parent, must stay under "Specialties".
	state.setChosenSubfeature(
		{parent: "Specialties", parentClass: "Cleric", parentClassSource: "TGTT", level: 3},
		{name: "Combat Medic", source: "TGTT", className: "Cleric", classSource: "TGTT", entries: ["Healer's kit mastery."]},
	);
	return state;
}

describe("Overview Specialties & Feats — Divine Order own group, Principles excluded (R47 Bug 2)", () => {
	it("routes Divine Order into its own group, excludes Principles, keeps genuine Specialties", () => {
		const state = mkClericWithAllThree();
		const {divineOrder, specialties} = partitionFor(state);

		const doNames = divineOrder.map(f => f.name);
		const spNames = specialties.map(f => f.name);

		// Divine Order pick lives in its own group…
		expect(doNames).toContain("Protector");
		// …and NOT duplicated in the generic Specialties list.
		expect(spNames).not.toContain("Protector");
		// Principles of Devotion keeps its own field → excluded from this surface entirely.
		expect(spNames).not.toContain("Chaste");
		expect(doNames).not.toContain("Chaste");
		// Genuine Specialty still shows under Specialties.
		expect(spNames).toContain("Combat Medic");
	});

	it("classifies Divine Order even when its parentFeature field was dropped on save", () => {
		// Simulate a save that serialized the sub-option without `parentFeature`: the durable
		// chosenSubfeatures linkage (name+source→parent) must still route it to the Divine Order group.
		const state = mkClericWithAllThree();
		const protector = state.getFeatures().find(f => f.name === "Protector");
		delete protector.parentFeature;
		const {divineOrder, specialties} = partitionFor(state);
		expect(divineOrder.map(f => f.name)).toContain("Protector");
		expect(specialties.map(f => f.name)).not.toContain("Protector");
	});

	it("still excludes a Principles pick even when its parentFeature field was dropped", () => {
		const state = mkClericWithAllThree();
		const chaste = state.getFeatures().find(f => f.name === "Chaste");
		delete chaste.parentFeature;
		const {divineOrder, specialties} = partitionFor(state);
		expect(specialties.map(f => f.name)).not.toContain("Chaste");
		expect(divineOrder.map(f => f.name)).not.toContain("Chaste");
	});

	it("keeps a genuine Specialty whose name/source is not a dedicated-surface record", () => {
		const state = mkClericWithAllThree();
		const {specialties} = partitionFor(state);
		const specialty = specialties.find(f => f.name === "Combat Medic");
		expect(specialty).toBeTruthy();
		expect(specialty.isFeatureOption).toBe(true);
	});

	describe("source-pin: production partition is data-model based", () => {
		const SOURCE = readFileSync(resolve(REPO_ROOT, "js/charactersheet/charactersheet.js"), "utf8");
		const m = SOURCE.match(/_renderOverviewSpecialtiesFeats\s*\(\)\s*\{[\s\S]*?\n\t\}/);

		it("locates the method", () => {
			expect(m).not.toBeNull();
		});

		it("excludes only Principles of Devotion from the surface", () => {
			const body = m[0];
			expect(body).toMatch(/EXCLUDED_SURFACE_PARENTS/);
			expect(body).toMatch(/principles of devotion/);
			// Divine Order is no longer excluded — it must NOT sit in the exclusion set literal.
			expect(body).not.toMatch(/EXCLUDED_SURFACE_PARENTS\s*=\s*new Set\(\[[^\]]*divine order/);
		});

		it("renders a dedicated read-only Divine Order group", () => {
			const body = m[0];
			expect(body).toMatch(/DIVINE_ORDER_PARENT\s*=\s*"divine order"/);
			expect(body).toMatch(/buildGroup\("Divine Order"/);
		});

		it("uses BOTH the parentFeature field and the chosenSubfeatures linkage", () => {
			const body = m[0];
			expect(body).toMatch(/parentFeature/);
			expect(body).toMatch(/getChosenSubfeatures/);
		});

		it("does NOT wire a mutable Divine Order selector (no setChosenSubfeature on change)", () => {
			// The whole controller must no longer render a mid-play Divine Order dropdown.
			expect(SOURCE).not.toMatch(/_renderOverviewDivineOrder/);
			expect(SOURCE).not.toMatch(/charsheet__divine-order-select/);
		});
	});
});
