/**
 * Hochling race choices (TGTT homebrew, issue #8).
 *
 * Covers the three player-facing Hochling traits:
 *   1. Healing Hands  — once-per-long-rest tracked use (PB d4 heal is descriptive).
 *   2. Divine Spark   — one chosen Cleric cantrip cast with a CHOSEN ability
 *                       (WIS/INT/CHA), not the global spellcasting ability.
 *   3. Divine Manifestation — a single-select picker offering ONE Channel Divinity
 *                       option from any of the 16 approved Cleric domains (Trickery,
 *                       Light, Grave, War, Peace, Order, Knowledge, Nature, Forge,
 *                       Death, Beauty, Blood, Time, Madness, Lust, Darkness) OR the
 *                       Aasimar Celestial Revelation transformation (character level 3).
 *                       Save-requiring options use DC = 8 + proficiency + the chosen
 *                       Divine Spark ability (WIS/INT/CHA).
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
import "../../../js/charactersheet/charactersheet-spells.js";

const CharacterSheetState = globalThis.CharacterSheetState;
const CharacterSheetClassUtils = globalThis.CharacterSheetClassUtils;
const CharacterSheetBuilder = globalThis.CharacterSheetBuilder;
const CharacterSheetSpells = globalThis.CharacterSheetSpells;

// _renderSpellDcAttackBadge reads Parser.attAbvToFull for the tooltip; stub if absent.
globalThis.Parser = globalThis.Parser || {};
globalThis.Parser.attAbvToFull = globalThis.Parser.attAbvToFull || ((abv) => abv);
globalThis.Parser.ABIL_ABVS = globalThis.Parser.ABIL_ABVS || ["str", "dex", "con", "int", "wis", "cha"];

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
	it("offers every approved domain plus the Aasimar transformation", () => {
		const hochling = loadHochling();
		const builder = makeBuilder();
		const choice = builder._getRacialFeatureChoices(hochling);

		expect(choice).not.toBeNull();
		expect(choice.traitName).toBe("Divine Manifestation");
		expect(choice.options.map((/** @type {*} */ o) => o.id)).toEqual([
			"trickery", "light", "grave", "war", "peace", "order", "knowledge",
			"nature", "forge", "death", "beauty", "blood", "time", "madness",
			"lust", "darkness", "aasimar",
		]);
		// Every option carries a label + a descriptive blurb for the picker.
		choice.options.forEach((/** @type {*} */ o) => {
			expect(typeof o.label).toBe("string");
			expect(o.label.length).toBeGreaterThan(0);
			expect(typeof o.desc).toBe("string");
			expect(o.desc.length).toBeGreaterThan(0);
		});
	});

	it("is sourced from the single curated option-definition map", () => {
		const hochling = loadHochling();
		const builder = makeBuilder();
		const choice = builder._getRacialFeatureChoices(hochling);
		const defIds = Object.keys(CharacterSheetClassUtils.getRaceManifestationOptionDefs());
		expect(choice.options.map((/** @type {*} */ o) => o.id)).toEqual(defIds);
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
// Trait 3 — Divine Manifestation: every approved domain grants its CD option(s)
// ===========================================================================
const stripCd = (/** @type {*} */ nm) => nm.replace(/^Channel Divinity:\s*/i, "");

describe("Hochling — Divine Manifestation apply: all approved domains", () => {
	const defs = CharacterSheetClassUtils.getRaceManifestationOptionDefs();
	const domainEntries = Object.entries(defs).filter(([, /** @type {*} */ def]) => !def.aasimar);

	it.each(domainEntries)("grants the level-1 Channel Divinity option for %s", (id, def) => {
		const state = new CharacterSheetState();
		setCharacterLevel(state, 1);
		state.setRaceManifestationChoice(id);
		CharacterSheetClassUtils.applyRaceManifestation(state);

		(def.cd || []).filter((/** @type {*} */ cd) => cd.level === 1).forEach((/** @type {*} */ cd) => {
			const feature = state.getFeatures().find((/** @type {*} */ f) => f.name === stripCd(cd.cdName));
			expect(feature).toBeDefined();
			expect(feature.source).toBe("TGTT");
			expect(feature.featureType).toBe("Species");
			expect(feature.uses.max).toBe(1);
			expect(feature.uses.recharge).toBe("short");
		});

		// Any higher-tier option is gated above level 1.
		(def.cd || []).filter((/** @type {*} */ cd) => cd.level > 1).forEach((/** @type {*} */ cd) => {
			expect(state.getFeatures().some((/** @type {*} */ f) => f.name === stripCd(cd.cdName))).toBe(false);
		});
	});

	it.each(domainEntries)("grants every tier of %s once the character reaches level 6", (id, def) => {
		const state = new CharacterSheetState();
		setCharacterLevel(state, 6);
		state.setRaceManifestationChoice(id);
		CharacterSheetClassUtils.applyRaceManifestation(state);

		(def.cd || []).forEach((/** @type {*} */ cd) => {
			const feature = state.getFeatures().find((/** @type {*} */ f) => f.name === stripCd(cd.cdName));
			expect(feature).toBeDefined();
			expect(feature.uses.recharge).toBe("short");
		});
	});

	it("switching between two domains tears the previous one down", () => {
		const state = new CharacterSheetState();
		setCharacterLevel(state, 6);

		state.setRaceManifestationChoice("light");
		CharacterSheetClassUtils.applyRaceManifestation(state);
		expect(state.getFeatures().some((/** @type {*} */ f) => f.name === "Radiance of the Dawn")).toBe(true);

		state.setRaceManifestationChoice("trickery");
		CharacterSheetClassUtils.applyRaceManifestation(state);
		expect(state.getFeatures().some((/** @type {*} */ f) => f.name === "Radiance of the Dawn")).toBe(false);
		expect(state.getFeatures().some((/** @type {*} */ f) => f.name === "Invoke Duplicity")).toBe(true);
		expect(state.getFeatures().some((/** @type {*} */ f) => f.name === "Cloak of Shadows")).toBe(true);
	});
});

// ===========================================================================
// Trait 3 — Divine Manifestation: save DC derives from the Divine Spark ability
// ===========================================================================
describe("Hochling — Divine Manifestation save DC", () => {
	it("computes DC = 8 + proficiency + the chosen Divine Spark ability modifier", () => {
		const state = new CharacterSheetState();
		setCharacterLevel(state, 5); // proficiency bonus +3
		state.setAbilityBase("cha", 18); // +4
		// Divine Spark cantrip cast with a chosen CHA ability.
		state.addCantrip({name: "Sacred Flame", source: "PHB", school: "V", sourceFeature: "Hochling", spellcastingAbility: "cha"});

		expect(CharacterSheetClassUtils.getRaceManifestationAbility(state)).toBe("cha");
		expect(CharacterSheetClassUtils.computeRaceManifestationDc(state)).toBe(15); // 8 + 3 + 4
	});

	it("stamps the chosen ability + DC onto a save-requiring option", () => {
		const state = new CharacterSheetState();
		setCharacterLevel(state, 5);
		state.setAbilityBase("wis", 16); // +3
		state.addCantrip({name: "Guidance", source: "PHB", school: "D", sourceFeature: "Hochling", spellcastingAbility: "wis"});
		state.setRaceManifestationChoice("light"); // Radiance of the Dawn requires a save
		CharacterSheetClassUtils.applyRaceManifestation(state);

		const feature = state.getFeatures().find((/** @type {*} */ f) => f.name === "Radiance of the Dawn");
		expect(feature).toBeDefined();
		expect(feature._manifestationRequiresSave).toBe(true);
		expect(feature._manifestationSaveAbility).toBe("wis");
		expect(feature._manifestationSaveDc).toBe(14); // 8 + 3 + 3
		expect(feature.description).toContain("DC 14");
	});

	it("falls back to WIS when no Divine Spark ability has been chosen", () => {
		const state = new CharacterSheetState();
		setCharacterLevel(state, 1);
		expect(CharacterSheetClassUtils.getRaceManifestationAbility(state)).toBe("wis");
	});
});

// ===========================================================================
// Trait 2/3 bridge (bug #13) — a racial cantrip shows a save DC / attack bonus
// even when the character has NO spellcasting class.
// ===========================================================================
describe("Hochling — racial cantrip save DC / attack bonus (no caster class)", () => {
	const makeSpells = (/** @type {*} */ st) => {
		const s = Object.create(CharacterSheetSpells.prototype);
		s._page = {getState: () => st};
		s._state = st;
		s._allSpells = [];
		return s;
	};

	it("resolves save DC + attack bonus from the chosen casting ability with no class present", () => {
		const state = new CharacterSheetState();
		// No classes added — proficiency bonus is the level-1 baseline (+2).
		state.setAbilityBase("cha", 18); // +4
		state.addCantrip({name: "Sacred Flame", source: "PHB", school: "V", sourceFeature: "Hochling", spellcastingAbility: "cha"});

		const cantrip = state.getCantrips().find((/** @type {*} */ c) => c.name === "Sacred Flame");
		expect(state.getSpellcastingAbilityForSpell(cantrip)).toBe("cha");

		const spells = makeSpells(state);
		const stats = spells._getSpellAbilityStats(cantrip);
		expect(stats).not.toBeNull();
		expect(stats.ability).toBe("cha");
		expect(stats.saveDc).toBe(14); // 8 + 2 + 4
		expect(stats.attackBonus).toBe(6); // 2 + 4

		const badge = spells._renderSpellDcAttackBadge(cantrip);
		expect(badge).toContain("Save DC 14");
		expect(badge).toContain("+6 to hit");
	});

	it("renders the badge in the innate spell item when an ability is attributed", () => {
		const state = new CharacterSheetState();
		state.setAbilityBase("wis", 16); // +3
		state.addInnateSpell({name: "Sacred Flame", source: "PHB", level: 0, school: "V", atWill: true, sourceFeature: "Hochling", spellcastingAbility: "wis"});

		const innate = state.getInnateSpells().find((/** @type {*} */ s) => s.name === "Sacred Flame");
		expect(innate.spellcastingAbility).toBe("wis"); // addInnateSpell preserves the chosen ability

		const spells = makeSpells(state);
		const item = spells._renderInnateSpellItem(innate);
		const html = item.outerHTML || item.innerHTML || "";
		expect(html).toContain("Save DC 13"); // 8 + 2 + 3
		expect(html).toContain("+5 to hit"); // 2 + 3
	});

	it("omits the badge for a normal cantrip with no per-spell ability override", () => {
		const state = new CharacterSheetState();
		state.setAbilityBase("wis", 16);
		state.addCantrip({name: "Mending", source: "PHB", school: "T", sourceFeature: "Test"});

		const cantrip = state.getCantrips().find((/** @type {*} */ c) => c.name === "Mending");
		const spells = makeSpells(state);
		expect(spells._getSpellAbilityStats(cantrip)).toBeNull();
		expect(spells._renderSpellDcAttackBadge(cantrip)).toBe("");
	});
});

// ===========================================================================
// Trait 3 — Divine Manifestation: data-driven hoverable entries (from catalog)
// ===========================================================================
describe("Hochling — Divine Manifestation entries resolution", () => {
	it("attaches real Channel-Divinity entries from the loaded subclass-feature catalog", () => {
		const state = new CharacterSheetState();
		setCharacterLevel(state, 1);
		// Minimal stand-in for the catalog the page builds from DataUtil.class.loadRawJSON():
		// a classic PHB entry WITH text plus a 2024 _copy-style stub WITHOUT text.
		state.setClassFeatureCatalog([], [
			{name: "Channel Divinity: Invoke Duplicity", className: "Cleric", subclassShortName: "Trickery", source: "PHB", entries: ["Real PHB rules text for Invoke Duplicity."]},
			{name: "Channel Divinity: Invoke Duplicity", className: "Cleric", subclassShortName: "Trickery", source: "XPHB", entries: null},
		]);
		state.setRaceManifestationChoice("trickery");
		CharacterSheetClassUtils.applyRaceManifestation(state);

		const feature = state.getFeatures().find((/** @type {*} */ f) => f.name === "Invoke Duplicity");
		expect(feature).toBeDefined();
		expect(Array.isArray(feature.entries)).toBe(true);
		expect(feature.entries).toContain("Real PHB rules text for Invoke Duplicity.");
	});

	it("falls back to the curated description when no catalog is present", () => {
		const state = new CharacterSheetState();
		setCharacterLevel(state, 1);
		state.setRaceManifestationChoice("grave");
		CharacterSheetClassUtils.applyRaceManifestation(state);

		const feature = state.getFeatures().find((/** @type {*} */ f) => f.name === "Path to the Grave");
		expect(feature).toBeDefined();
		expect(feature.entries).toBeUndefined();
		expect(typeof feature.description).toBe("string");
		expect(feature.description.length).toBeGreaterThan(0);
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
