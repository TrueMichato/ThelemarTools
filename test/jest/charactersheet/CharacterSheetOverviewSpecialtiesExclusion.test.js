/**
 * Character Sheet — Overview "Specialties & Feats" must NOT list dedicated-surface sub-options.
 *
 * R46 Bug 3. Structured-choice sub-options carry `isFeatureOption:true`, so the Overview
 * "Specialties & Feats" list (`_renderOverviewSpecialtiesFeats`) used to include Principles of
 * Devotion picks (e.g. "Chaste") and Divine Order picks (Protector / Thaumaturge). Those two
 * parents have their OWN Overview surfaces, so their sub-options are now excluded — while genuine
 * TGTT Specialties (a DIFFERENT structured-choice parent) still appear.
 *
 * The exclusion is data-model based (never a name match on the option): a feature is excluded when
 * `isFeatureOption` AND its parent is a dedicated-surface parent, read from BOTH the feature's own
 * `parentFeature` field AND the durable `chosenSubfeatures` linkage.
 *
 * `charactersheet.js` (the controller) is too global-heavy to import in jest, so we (1) source-pin
 * the production method and (2) drive a byte-faithful replica of its filter against a real state.
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

// Byte-faithful replica of the production filter (see the source-pin below).
function specialtiesFor (state) {
	const DEDICATED_SURFACE_PARENTS = new Set(["principles of devotion", "divine order"]);
	const eq = (v) => String(v || "").toLowerCase();
	const chosen = state.getChosenSubfeatures?.() || [];
	const dedicatedSubOptionKeys = new Set(
		chosen
			.filter(r => DEDICATED_SURFACE_PARENTS.has(eq(r.parent)))
			.map(r => `${eq(r.name)}\u0000${eq(r.source)}`),
	);
	return (state.getFeatures?.() || []).filter(f => {
		if (f.isFeatureOption !== true) return false;
		if (DEDICATED_SURFACE_PARENTS.has(eq(f.parentFeature))) return false;
		if (dedicatedSubOptionKeys.has(`${eq(f.name)}\u0000${eq(f.source)}`)) return false;
		return true;
	});
}

function mkClericWithAllThree () {
	const state = new CharacterSheetState();
	state.addClass({name: "Cleric", source: "TGTT", level: 3});

	// Principle of Devotion pick — dedicated surface, must be excluded.
	state.setChosenSubfeature(
		{parent: "Principles of Devotion", parentClass: "Cleric", parentClassSource: "TGTT", level: 2},
		{name: "Chaste", source: "TGTT", className: "Cleric", classSource: "TGTT", entries: ["Boon of clarity."]},
	);
	// Divine Order pick — dedicated surface, must be excluded.
	state.setChosenSubfeature(
		{parent: "Divine Order", parentClass: "Cleric", parentClassSource: "TGTT", level: 1},
		{name: "Protector", source: "TGTT", className: "Cleric", classSource: "TGTT", entries: ["Martial weapons + heavy armor."]},
	);
	// Genuine TGTT Specialty — a DIFFERENT structured-choice parent, must be KEPT.
	state.setChosenSubfeature(
		{parent: "Specialties", parentClass: "Cleric", parentClassSource: "TGTT", level: 3},
		{name: "Combat Medic", source: "TGTT", className: "Cleric", classSource: "TGTT", entries: ["Healer's kit mastery."]},
	);
	return state;
}

describe("Overview Specialties & Feats — exclude dedicated-surface sub-options (R46 Bug 3)", () => {
	it("excludes Principles of Devotion and Divine Order picks, keeps genuine Specialties", () => {
		const state = mkClericWithAllThree();
		const names = specialtiesFor(state).map(f => f.name);
		expect(names).not.toContain("Chaste");
		expect(names).not.toContain("Protector");
		expect(names).toContain("Combat Medic");
	});

	it("still excludes a dedicated-surface pick even when its parentFeature field was dropped", () => {
		// Simulate a save that serialized the sub-option without `parentFeature`: the durable
		// chosenSubfeatures linkage (name+source→parent) must still exclude it.
		const state = mkClericWithAllThree();
		const chaste = state.getFeatures().find(f => f.name === "Chaste");
		delete chaste.parentFeature;
		const names = specialtiesFor(state).map(f => f.name);
		expect(names).not.toContain("Chaste");
	});

	it("keeps a genuine Specialty whose name/source is not a dedicated-surface record", () => {
		const state = mkClericWithAllThree();
		const specialty = specialtiesFor(state).find(f => f.name === "Combat Medic");
		expect(specialty).toBeTruthy();
		expect(specialty.isFeatureOption).toBe(true);
	});

	describe("source-pin: production filter is data-model based", () => {
		const SOURCE = readFileSync(resolve(REPO_ROOT, "js/charactersheet/charactersheet.js"), "utf8");
		const m = SOURCE.match(/_renderOverviewSpecialtiesFeats\s*\(\)\s*\{[\s\S]*?\n\t\}/);

		it("locates the method", () => {
			expect(m).not.toBeNull();
		});

		it("excludes by dedicated-surface parents (principles + divine order), not option names", () => {
			const body = m[0];
			expect(body).toMatch(/DEDICATED_SURFACE_PARENTS/);
			expect(body).toMatch(/principles of devotion/);
			expect(body).toMatch(/divine order/);
		});

		it("uses BOTH the parentFeature field and the chosenSubfeatures linkage", () => {
			const body = m[0];
			expect(body).toMatch(/parentFeature/);
			expect(body).toMatch(/getChosenSubfeatures/);
		});
	});
});
