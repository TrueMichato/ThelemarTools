/**
 * Character Sheet — World Tree "Vitality of the Tree": REAL-PATH integration guard (R41 #1)
 *
 * Round 40 added the feature and synthetic unit tests, yet it was reported as "does
 * nothing on a real character". Exhaustive LIVE reproduction on the base branch showed the
 * feature actually works on every realistic path — the missing coverage was a test that
 * drives the REAL data + REAL load/migrate/detect/rage-surge chain (not a hand-built state).
 *
 * Unlike the sibling synthetic tests, this test:
 *   1. Reads the ACTUAL `data/class/class-barbarian.json` and asserts the World Tree
 *      subclass's `name`/`shortName` still match a detection switch case in
 *      `getFeatureCalculations()` — so it FAILS if the data name ever drifts away from the
 *      code, or the code's switch case drifts away from the data.
 *   2. Exercises the real Rage-activation surge path via `activateState("rage")`.
 *   3. Exercises the legacy `subclass:null` SAVE path through `loadFromJson()` →
 *      `_migrateRepairSubclass()` → `getSubclassFromFeatures()`, using the REAL subclass
 *      feature shape (`subclassShortName` only, no `subclassName`) — the most plausible
 *      "unit tests pass but my saved sheet does nothing" scenario.
 *
 * If any link in that chain breaks (data drift, switch drift, repair regression, surge
 * regression), this test goes red — which a synthetic-state assertion would not.
 */

import "./setup.js";
import fs from "node:fs";
import path from "node:path";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-state.js";

const repo = path.resolve(process.cwd());
const CharacterSheetState = globalThis.CharacterSheetState;

function loadBarbarianData () {
	return JSON.parse(fs.readFileSync(path.join(repo, "data/class/class-barbarian.json"), "utf8"));
}

/** The World Tree subclass object exactly as level-up / QuickBuild store it (name + shortName + source). */
function getWorldTreeSubclassFromData () {
	const data = loadBarbarianData();
	const sub = (data.subclass || []).find(s =>
		s.className === "Barbarian" && (/world tree/i.test(s.shortName || "") || /world tree/i.test(s.name || "")));
	if (!sub) throw new Error("World Tree subclass not found in class-barbarian.json");
	return {name: sub.name, shortName: sub.shortName, source: sub.source};
}

/** A real L3 World Tree subclassFeature entry from the data (used for the legacy-save repair path). */
function getWorldTreeL3FeatureFromData () {
	const data = loadBarbarianData();
	const feat = (data.subclassFeature || []).find(f =>
		f.name === "Vitality of the Tree" && Number(f.level) === 3 && /world tree/i.test(f.subclassShortName || ""));
	if (!feat) throw new Error("Vitality of the Tree L3 subclassFeature not found in class-barbarian.json");
	return feat;
}

function buildWorldTreeBarbarian (level, subclass) {
	const state = new CharacterSheetState();
	state.setRace({name: "Human", source: "XPHB"});
	state.addClass({name: "Barbarian", source: "XPHB", level, subclass});
	state.setAbilityBase("str", 16);
	state.setAbilityBase("dex", 14);
	state.setAbilityBase("con", 15);
	return state;
}

describe("World Tree Vitality — real data ↔ detection code coupling", () => {
	it("stores the World Tree subclass in class-barbarian.json with the expected name/shortName", () => {
		const sub = getWorldTreeSubclassFromData();
		expect(sub.name).toBe("Path of the World Tree");
		expect(sub.shortName).toBe("World Tree");
		expect(sub.source).toBe("XPHB");
	});

	it("detection fires for the REAL subclass object (guards against data ↔ switch-case drift)", () => {
		// If the data name drifts (or the code's switch case does), this build stops
		// flagging the feature and the test goes red — the coupling the report feared.
		const sub = getWorldTreeSubclassFromData();
		const calc = buildWorldTreeBarbarian(3, sub).getFeatureCalculations();
		expect(calc.hasVitalityOfTheTree).toBe(true);
		expect(calc.vitalityTempHp).toBe(3);
	});

	it("detection also fires when only the subclass shortName is present (name absent)", () => {
		// Defense-in-depth hardening: a subclass object lacking `.name` must still resolve
		// via `shortName`. (No real build path produces this today, but the load-repair path
		// can yield a shortName-derived name, so detection must be robust either way.)
		const calc = buildWorldTreeBarbarian(5, {shortName: "World Tree", source: "XPHB"}).getFeatureCalculations();
		expect(calc.hasVitalityOfTheTree).toBe(true);
		expect(calc.vitalityTempHp).toBe(5);
	});
});

describe("World Tree Vitality — real Rage-activation surge path", () => {
	it("activating Rage grants Temp HP == Barbarian level via the real activateState() path", () => {
		const state = buildWorldTreeBarbarian(3, getWorldTreeSubclassFromData());
		expect(state.getTempHp()).toBe(0);
		state.activateState("rage");
		expect(state.isStateTypeActive("rage")).toBe(true);
		expect(state.getTempHp()).toBe(3);
	});

	it("is non-stacking take-higher: never lowers a larger existing Temp HP pool", () => {
		const state = buildWorldTreeBarbarian(3, getWorldTreeSubclassFromData());
		state.setTempHp(9); // larger pool from some other source
		state.activateState("rage");
		expect(state.getTempHp()).toBe(9); // surge (3) must not overwrite the larger 9
	});

	it("raises Temp HP up to the surge value when the existing pool is smaller", () => {
		const state = buildWorldTreeBarbarian(6, getWorldTreeSubclassFromData());
		state.setTempHp(2);
		state.activateState("rage");
		expect(state.getTempHp()).toBe(6); // raised from 2 → barbarian level 6
	});

	it("does NOT re-grant on re-activating an already-active Rage (inactive→active gate)", () => {
		const state = buildWorldTreeBarbarian(3, getWorldTreeSubclassFromData());
		state.activateState("rage");
		expect(state.getTempHp()).toBe(3);
		state.setTempHp(0); // temp HP spent during the rage
		state.activateState("rage"); // re-activation while already active must not refresh
		expect(state.getTempHp()).toBe(0);
	});

	it("DOES re-grant after Rage ends and is activated again (positive half of the gate)", () => {
		const state = buildWorldTreeBarbarian(3, getWorldTreeSubclassFromData());
		state.activateState("rage");
		expect(state.getTempHp()).toBe(3);
		state.setTempHp(0);
		state.deactivateState("rage");
		expect(state.isStateTypeActive("rage")).toBe(false);
		state.activateState("rage"); // a real inactive→active transition must grant again
		expect(state.getTempHp()).toBe(3);
	});

	it("scopes the surge to the BARBARIAN class level, not total character level (multiclass)", () => {
		const state = buildWorldTreeBarbarian(3, getWorldTreeSubclassFromData());
		state.addClass({name: "Fighter", source: "XPHB", level: 2}); // total level 5, barbarian level 3
		expect(state.getFeatureCalculations().vitalityTempHp).toBe(3);
		state.activateState("rage");
		expect(state.getTempHp()).toBe(3); // barbarian level (3), NOT total level (5)
	});

	it("does not leak the surge to a non-World-Tree barbarian", () => {
		const state = buildWorldTreeBarbarian(3, {name: "Path of the Berserker", shortName: "Berserker", source: "XPHB"});
		state.activateState("rage");
		expect(state.getFeatureCalculations().hasVitalityOfTheTree).toBeFalsy();
		expect(state.getTempHp()).toBe(0);
	});
});

describe("World Tree Vitality — legacy save (subclass:null) load/repair path", () => {
	/**
	 * Simulate a saved character whose class carries no `subclass` object but whose
	 * features array still identifies the subclass (the shape `getSubclassFromFeatures`
	 * exists to heal). Uses the REAL L3 subclassFeature shape from the data, which carries
	 * `subclassShortName` but no `subclassName`.
	 */
	function makeLegacyJson () {
		const seed = buildWorldTreeBarbarian(3, getWorldTreeSubclassFromData());
		const json = seed.toJson();
		json.classes[0].subclass = null;
		const dataFeat = getWorldTreeL3FeatureFromData();
		json.features = [{
			name: dataFeat.name,
			className: dataFeat.className,
			classSource: dataFeat.classSource,
			isSubclassFeature: true,
			subclassShortName: dataFeat.subclassShortName,
			subclassSource: dataFeat.subclassSource,
			level: dataFeat.level,
			source: dataFeat.subclassSource,
		}];
		return json;
	}

	it("repairs the null subclass from features on load so detection fires", () => {
		const json = makeLegacyJson();
		const state = new CharacterSheetState();
		state.loadFromJson(json);

		const cls = state.getClasses().find(c => c.name === "Barbarian");
		expect(cls.subclass).toBeTruthy();
		// getSubclassFromFeatures derives name from subclassName||subclassShortName → "World Tree"
		expect(cls.subclass.shortName).toBe("World Tree");

		const calc = state.getFeatureCalculations();
		expect(calc.hasVitalityOfTheTree).toBe(true);
		expect(calc.vitalityTempHp).toBe(3);
	});

	it("grants the Rage surge after loading a legacy (subclass:null) save", () => {
		const json = makeLegacyJson();
		const state = new CharacterSheetState();
		state.loadFromJson(json);

		expect(state.getTempHp()).toBe(0);
		state.activateState("rage");
		expect(state.getTempHp()).toBe(3);
	});
});
