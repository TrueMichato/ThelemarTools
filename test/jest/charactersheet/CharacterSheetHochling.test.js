/**
 * Hochling race choices (TGTT homebrew, issue #8).
 *
 * Covers the three player-facing Hochling traits:
 *   1. Healing Hands  — once-per-long-rest tracked use (PB d4 heal is descriptive).
 *   2. Divine Spark   — one chosen Cleric cantrip cast with a CHOSEN ability
 *                       (WIS/INT/CHA), not the global spellcasting ability.
 *   3. Divine Manifestation — a single-select picker offering exactly two WORKING
 *                       options: War Domain Channel Divinity (Guided Strike, plus
 *                       War God's Blessing at character level 6) and the Aasimar
 *                       Celestial Revelation transformation (character level 3).
 *
 * Assertions are at the state / class-utils / builder-helper layer (display-agnostic).
 */

import fs from "fs";
import path from "path";
import {fileURLToPath} from "url";

import "./setup.js";
import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-builder.js";

const CharacterSheetState = globalThis.CharacterSheetState;
const CharacterSheetClassUtils = globalThis.CharacterSheetClassUtils;
const CharacterSheetBuilder = globalThis.CharacterSheetBuilder;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "../../..");
const TGTT_PATH = path.join(REPO_ROOT, "homebrew/TravelersGuidetoThelemar.json");

function loadHochling () {
	const tgtt = JSON.parse(fs.readFileSync(TGTT_PATH, "utf8"));
	return tgtt.race.find((/** @type {*} */ r) => r.name === "Hochling");
}

function makeBuilder () {
	const builder = Object.create(CharacterSheetBuilder.prototype);
	builder._state = new CharacterSheetState();
	builder._selectedRacialSpells = [];
	builder._selectedRacialSpellAbilities = {};
	builder._selectedRacialFeatureChoices = {};
	builder._selectedRace = null;
	builder._selectedSubrace = null;
	return builder;
}

function setCharacterLevel (state, level) {
	state._data.classes = [{name: "Cleric", source: "PHB", level}];
}

// ===========================================================================
// Trait 1 — Healing Hands
// ===========================================================================
describe("Hochling — Healing Hands", () => {
	it("is curated to a single use that recharges on a long rest", () => {
		const state = new CharacterSheetState();
		state.addFeature({
			name: "Healing Hands",
			source: "TGTT",
			featureType: "Species",
			description: "As an action, you touch a creature and roll a number of d4s equal to your "
				+ "proficiency bonus. The creature regains a number of hit points equal to the total rolled. "
				+ "Once you use this trait, you can't use it again until you finish a long rest.",
		});

		const feature = state.getFeatures().find((/** @type {*} */ f) => f.name === "Healing Hands");
		expect(feature).toBeDefined();
		expect(feature.uses.max).toBe(1);
		expect(feature.uses.recharge).toBe("long");
	});

	it("does not recharge on a short rest but does on a long rest", () => {
		const state = new CharacterSheetState();
		state.addFeature({
			name: "Healing Hands",
			source: "TGTT",
			featureType: "Species",
			description: "Once you use this trait, you can't use it again until you finish a long rest.",
		});

		const id = state.getFeatures().find((/** @type {*} */ f) => f.name === "Healing Hands").id;
		state.setFeatureUses(id, 0);

		state.onShortRest();
		expect(state.getFeatures().find((/** @type {*} */ f) => f.name === "Healing Hands").uses.current).toBe(0);

		state.onLongRest();
		expect(state.getFeatures().find((/** @type {*} */ f) => f.name === "Healing Hands").uses.current).toBe(1);
	});
});

// ===========================================================================
// Trait 2 — Divine Spark (chosen Cleric cantrip + chosen casting ability)
// ===========================================================================
describe("Hochling — Divine Spark", () => {
	it("exposes the data-driven cantrip + ability choice on the race", () => {
		const hochling = loadHochling();
		const builder = makeBuilder();
		const choices = builder._getRacialSpellChoices(hochling);

		expect(choices.length).toBe(1);
		expect(choices[0].filter).toBe("level=0|class=Cleric");
		expect(choices[0].ability).toEqual(["wis", "int", "cha"]);
	});

	it("buildCantripStateObject stamps the chosen ability onto the cantrip", () => {
		const cantrip = CharacterSheetClassUtils.buildCantripStateObject(
			{name: "Sacred Flame", source: "PHB", school: "V", level: 0},
			{sourceFeature: "Hochling", sourceClass: null, ability: "cha"},
		);
		expect(cantrip.spellcastingAbility).toBe("cha");
	});

	it("the chosen cantrip casts with the chosen ability, not the global one", () => {
		const builder = makeBuilder();
		// Global spellcasting ability differs from the per-cantrip choice.
		builder._state._data.spellcasting.ability = "int";
		builder._selectedRacialSpells = [{name: "Guidance", source: "PHB", school: "D", level: 0}];

		builder._applySelectedRacialSpells("Hochling", "cha");

		const cantrip = builder._state.getCantrips().find((/** @type {*} */ c) => c.name === "Guidance");
		expect(cantrip).toBeDefined();
		expect(cantrip.spellcastingAbility).toBe("cha");
		expect(builder._state.getSpellcastingAbilityForSpell(cantrip)).toBe("cha");
	});

	it("a cantrip with no per-spell ability still falls back to the global ability", () => {
		const state = new CharacterSheetState();
		state._data.spellcasting.ability = "wis";
		state.addCantrip({name: "Mending", source: "PHB", school: "T", sourceFeature: "Test"});

		const cantrip = state.getCantrips().find((/** @type {*} */ c) => c.name === "Mending");
		expect(cantrip.spellcastingAbility).toBeNull();
		expect(state.getSpellcastingAbilityForSpell(cantrip)).toBe("wis");
	});
});

// ===========================================================================
// Trait 3 — Divine Manifestation (picker + apply)
// ===========================================================================
describe("Hochling — Divine Manifestation picker", () => {
	it("offers exactly the two approved options", () => {
		const hochling = loadHochling();
		const builder = makeBuilder();
		const choice = builder._getRacialFeatureChoices(hochling);

		expect(choice).not.toBeNull();
		expect(choice.traitName).toBe("Divine Manifestation");
		expect(choice.options.map((/** @type {*} */ o) => o.id)).toEqual(["war", "aasimar"]);
	});

	it("returns null for a race without the Divine Manifestation trait", () => {
		const builder = makeBuilder();
		expect(builder._getRacialFeatureChoices({name: "Human", entries: [{name: "Skills"}]})).toBeNull();
	});
});

describe("Hochling — Divine Manifestation apply: War Domain", () => {
	it("grants Guided Strike immediately as a Channel-Divinity use", () => {
		const state = new CharacterSheetState();
		setCharacterLevel(state, 1);
		state.setRaceManifestationChoice("war");
		CharacterSheetClassUtils.applyRaceManifestation(state);

		const guidedStrike = state.getFeatures().find((/** @type {*} */ f) => f.name === "Guided Strike");
		expect(guidedStrike).toBeDefined();
		expect(guidedStrike.source).toBe("TGTT");
		expect(guidedStrike.uses.max).toBe(1);
		expect(guidedStrike.uses.recharge).toBe("short");

		// War God's Blessing is gated to character level 6.
		expect(state.getFeatures().some((/** @type {*} */ f) => f.name === "War God's Blessing")).toBe(false);
	});

	it("grants War God's Blessing once the character reaches level 6", () => {
		const state = new CharacterSheetState();
		setCharacterLevel(state, 6);
		state.setRaceManifestationChoice("war");
		CharacterSheetClassUtils.applyRaceManifestation(state);

		expect(state.getFeatures().some((/** @type {*} */ f) => f.name === "Guided Strike")).toBe(true);
		const blessing = state.getFeatures().find((/** @type {*} */ f) => f.name === "War God's Blessing");
		expect(blessing).toBeDefined();
		expect(blessing.uses.recharge).toBe("short");
	});

	it("does NOT grant any Aasimar transformation feature", () => {
		const state = new CharacterSheetState();
		setCharacterLevel(state, 6);
		state.setRaceManifestationChoice("war");
		CharacterSheetClassUtils.applyRaceManifestation(state);

		expect(state.getFeatures().some((/** @type {*} */ f) => f.name === "Celestial Revelation")).toBe(false);
	});
});

describe("Hochling — Divine Manifestation apply: Aasimar transformation", () => {
	it("is gated at character level 3", () => {
		const state = new CharacterSheetState();
		setCharacterLevel(state, 1);
		state.setRaceManifestationChoice("aasimar");
		CharacterSheetClassUtils.applyRaceManifestation(state);
		expect(state.getFeatures().some((/** @type {*} */ f) => f.name === "Celestial Revelation")).toBe(false);

		setCharacterLevel(state, 3);
		CharacterSheetClassUtils.applyRaceManifestation(state);
		expect(state.getFeatures().some((/** @type {*} */ f) => f.name === "Celestial Revelation")).toBe(true);
	});

	it("Celestial Revelation surfaces as an activatable transformation", () => {
		const state = new CharacterSheetState();
		state.setSpeed("walk", 30);
		setCharacterLevel(state, 3);
		state.setRaceManifestationChoice("aasimar");
		CharacterSheetClassUtils.applyRaceManifestation(state);

		const activatable = state.getActivatableFeatures();
		expect(activatable.some((/** @type {*} */ f) => f.feature?.name === "Celestial Revelation")).toBe(true);
	});

	it("switching the choice tears down the previously-granted manifestation", () => {
		const state = new CharacterSheetState();
		setCharacterLevel(state, 6);

		state.setRaceManifestationChoice("war");
		CharacterSheetClassUtils.applyRaceManifestation(state);
		expect(state.getFeatures().some((/** @type {*} */ f) => f.name === "Guided Strike")).toBe(true);

		state.setRaceManifestationChoice("aasimar");
		CharacterSheetClassUtils.applyRaceManifestation(state);
		expect(state.getFeatures().some((/** @type {*} */ f) => f.name === "Guided Strike")).toBe(false);
		expect(state.getFeatures().some((/** @type {*} */ f) => f.name === "War God's Blessing")).toBe(false);
		expect(state.getFeatures().some((/** @type {*} */ f) => f.name === "Celestial Revelation")).toBe(true);
	});
});

// ===========================================================================
// Save / load round-trip
// ===========================================================================
describe("Hochling — save/load round-trip", () => {
	it("persists the chosen cantrip ability and the manifestation features", () => {
		const state = new CharacterSheetState();
		state._data.spellcasting.ability = "int";
		setCharacterLevel(state, 6);
		state.addCantrip({name: "Sacred Flame", source: "PHB", school: "V", sourceFeature: "Hochling", spellcastingAbility: "cha"});
		state.setRaceManifestationChoice("war");
		CharacterSheetClassUtils.applyRaceManifestation(state);

		const reloaded = new CharacterSheetState();
		reloaded.loadFromJson(state.toJson());

		expect(reloaded.getRaceManifestationChoice()).toBe("war");
		const cantrip = reloaded.getCantrips().find((/** @type {*} */ c) => c.name === "Sacred Flame");
		expect(cantrip.spellcastingAbility).toBe("cha");
		expect(reloaded.getSpellcastingAbilityForSpell(cantrip)).toBe("cha");
		expect(reloaded.getFeatures().some((/** @type {*} */ f) => f.name === "Guided Strike")).toBe(true);
		expect(reloaded.getFeatures().some((/** @type {*} */ f) => f.name === "War God's Blessing")).toBe(true);
	});
});
