/**
 * Conditional skill-modifier save/load migration (R27 follow-up — Whiff of the Beyond)
 *
 * New-build gating works: a skill bonus restricted to specific creature types or a
 * tracking context (e.g. the Warlock "Whiff of the Beyond" specialty, whose
 * Perception bonus only applies when tracking/perceiving aberrations, celestials,
 * elementals, fey, fiends, or undead) is stored as a DISABLED conditional modifier,
 * so it never inflates a generic Perception check. BUT `loadFromJson` restores
 * `namedModifiers` verbatim and only re-applies *classFeature*-sourced effects —
 * text-parsed feature modifiers are NOT cleared/re-derived. A character saved BEFORE
 * the conditional-gating fix kept its Perception bonus `enabled: true`, and the leak
 * survived the round-trip (every Perception check got a flat +proficiency).
 *
 * FIX: `_migrateConditionalSkillModifiers()` re-parses each currently-ENABLED skill
 * modifier's source feature on load and disables it if the current definition says
 * the bonus is creature/tracking restricted. These tests drive the real
 * serialize → mutate-to-pre-fix → loadFromJson path.
 */

import "./setup.js";
import "../../../js/charactersheet/charactersheet-state.js";

const CharacterSheetState = globalThis.CharacterSheetState;

const WHIFF_DESCRIPTION = "You automatically sense when an aberration, celestial, elemental, fey, "
	+ "fiend, or undead has been within 30 feet of you in the past 24 hours. You also gain a bonus "
	+ "to Wisdom ({@skill Perception}) checks equal to your proficiency bonus and have advantage on "
	+ "checks to track these creature types.";

function makeSavedWhiff () {
	const state = new CharacterSheetState();
	state.addFeature({
		name: "Whiff of the Beyond",
		source: "TGTT",
		featureType: "Specialty",
		description: WHIFF_DESCRIPTION,
	});
	return state;
}

/** Serialize, then corrupt the perception modifier back to its pre-fix (leaked) shape. */
function makePreFixSaveJson ({keepConditional = false} = {}) {
	const json = makeSavedWhiff().toJson();
	const percMod = json.namedModifiers.find(m => m.type === "skill:perception");
	expect(percMod).toBeDefined();
	percMod.enabled = true; // the leak: enabled at base
	if (!keepConditional) delete percMod.conditional; // pre-fix saves lacked it
	return json;
}

describe("Whiff — fresh build gates the Perception bonus", () => {
	test("a fresh Whiff feature stores Perception as a disabled conditional modifier", () => {
		const state = makeSavedWhiff();
		const percMod = state._data.namedModifiers.find(m => m.type === "skill:perception");
		expect(percMod).toBeDefined();
		expect(percMod.enabled).toBe(false);
		expect(percMod.conditional).toBeTruthy();
		expect(percMod.proficiencyBonus).toBe(true);
	});
});

describe("Whiff — stale conditional Perception bonus is re-gated on load", () => {
	test("a pre-fix save (Perception enabled at base) is healed on load", () => {
		const json = makePreFixSaveJson();
		const loaded = new CharacterSheetState();
		loaded.loadFromJson(json);

		const percMod = loaded._data.namedModifiers.find(m => m.type === "skill:perception");
		expect(percMod).toBeDefined();
		expect(percMod.enabled).toBe(false);
		expect(percMod.conditional).toBeTruthy();
	});

	test("a pre-fix save that kept its conditional but stayed enabled is still disabled", () => {
		const json = makePreFixSaveJson({keepConditional: true});
		const loaded = new CharacterSheetState();
		loaded.loadFromJson(json);
		const percMod = loaded._data.namedModifiers.find(m => m.type === "skill:perception");
		expect(percMod.enabled).toBe(false);
	});

	test("migration is idempotent (a clean, correctly-gated save loads unchanged)", () => {
		const cleanJson = makeSavedWhiff().toJson();
		const loaded = new CharacterSheetState();
		loaded.loadFromJson(cleanJson);
		const percMod = loaded._data.namedModifiers.find(m => m.type === "skill:perception");
		expect(percMod.enabled).toBe(false);

		const loaded2 = new CharacterSheetState();
		loaded2.loadFromJson(loaded.toJson());
		expect(loaded2._data.namedModifiers.find(m => m.type === "skill:perception").enabled).toBe(false);
	});
});

describe("Whiff — migration does not over-reach", () => {
	test("an unconditional proficiency-bonus skill grant saved enabled stays enabled", () => {
		const state = new CharacterSheetState();
		state.addFeature({
			name: "Skulker Training",
			source: "TEST",
			featureType: "Feat",
			description: "You gain a bonus to Dexterity ({@skill Stealth}) checks equal to your proficiency bonus.",
		});
		const json = state.toJson();
		const stealthMod = json.namedModifiers.find(m => m.type === "skill:stealth");
		expect(stealthMod).toBeDefined();
		expect(stealthMod.enabled).toBe(true); // unconditional grant, enabled

		const loaded = new CharacterSheetState();
		loaded.loadFromJson(json);
		const reloaded = loaded._data.namedModifiers.find(m => m.type === "skill:stealth");
		expect(reloaded.enabled).toBe(true);
	});
});
