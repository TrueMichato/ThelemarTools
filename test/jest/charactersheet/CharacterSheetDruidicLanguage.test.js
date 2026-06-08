/**
 * Druidic language grant (round-4 Bug #3).
 *
 * BUG: When a Druid gains the "Druidic" class feature, "Druidic" was NOT added to
 * the character's languages. Class features grant languages through the effects
 * pipeline (`_aggregateFeatureEffects` → `_applyFeatureEffect` `case "language"` →
 * `_addClassFeatureLanguage`), sourced from `FeatureEffectRegistry`, structured
 * `languageProficiencies`, or metadata. The "Druidic" feature carries its grant
 * only in prose ("You know Druidic, the secret language of druids"), and prose
 * language-parsing runs only for ITEMS — never for class features — so nothing was
 * added.
 *
 * FIX: register "Druidic" in `FeatureEffectRegistry._registerClassFeatures()` as a
 * `{type: "language", language: "Druidic"}` effect (same shape as the existing
 * "Tongue of the Sun and Moon" grant). It then flows through the standard
 * add / clear+reapply / save-load pipeline.
 */

import "./setup.js";

let CharacterSheetState;

beforeAll(async () => {
	CharacterSheetState = (await import("../../../js/charactersheet/charactersheet-state.js")).CharacterSheetState;
});

/** A Druid that has the level-1 "Druidic" feature stored, with effects applied. */
function makeDruidWithDruidic (source = "PHB") {
	const state = new CharacterSheetState();
	state.setAbilityBase("wis", 16);
	state.addClass({name: "Druid", source, level: 3});
	state.addFeature({name: "Druidic", source});
	state.applyClassFeatureEffects();
	return state;
}

describe("Druidic feature grants the Druidic language", () => {
	it("adds Druidic to languages when the feature is present", () => {
		const state = makeDruidWithDruidic();
		expect(state.getLanguages()).toContain("Druidic");
	});

	it("tracks Druidic as a class-feature language (so it can be cleanly removed)", () => {
		const state = makeDruidWithDruidic();
		expect(state.toJson()._classFeatureLanguages).toContain("Druidic");
	});

	it("does NOT grant Druidic to a Druid without the Druidic feature", () => {
		const state = new CharacterSheetState();
		state.setAbilityBase("wis", 16);
		state.addClass({name: "Druid", source: "PHB", level: 3});
		state.applyClassFeatureEffects();
		expect(state.getLanguages()).not.toContain("Druidic");
	});

	it("is edition-neutral (XPHB feature name also grants it)", () => {
		const state = makeDruidWithDruidic("XPHB");
		expect(state.getLanguages()).toContain("Druidic");
	});

	it("removes Druidic when the feature is removed and effects are reapplied", () => {
		const state = makeDruidWithDruidic();
		expect(state.getLanguages()).toContain("Druidic");

		const druidicFeature = state.getFeatures().find(f => f.name === "Druidic");
		expect(druidicFeature).toBeTruthy();
		state.removeFeature(druidicFeature.id);
		state.applyClassFeatureEffects();

		expect(state.getLanguages()).not.toContain("Druidic");
		expect(state.toJson()._classFeatureLanguages || []).not.toContain("Druidic");
	});

	it("persists Druidic across a save/load round-trip", () => {
		const state = makeDruidWithDruidic();
		expect(state.getLanguages()).toContain("Druidic");

		const json = state.toJson();
		const reloaded = new CharacterSheetState();
		reloaded.loadFromJson(json);

		expect(reloaded.getLanguages()).toContain("Druidic");
		// Exactly one entry — no duplication from re-applying effects on load.
		expect(reloaded.getLanguages().filter(l => l === "Druidic")).toHaveLength(1);
	});

	it("backfills Druidic on load for a legacy save that has the feature but lacks the language", () => {
		// Mirrors the pre-fix Lunaria case: Druidic feature present, but the
		// languages array was saved without "Druidic".
		const state = makeDruidWithDruidic();
		const json = state.toJson();
		json.languages = json.languages.filter(l => l !== "Druidic");
		delete json._classFeatureLanguages;

		const reloaded = new CharacterSheetState();
		reloaded.loadFromJson(json);
		expect(reloaded.getLanguages()).toContain("Druidic");
	});
});
