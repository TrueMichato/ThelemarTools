/**
 * S3 — TGTT Minotaur species fixes.
 *
 * Bug #1 (languages): the TGTT Minotaur should end up with Common + the Minotaur
 *   language + one language of the player's choice. The homebrew race `_copy`s the
 *   MPMM Minotaur (which has NO languageProficiencies) and directly sets
 *   `[{common, "minotaur|TGTT"}]`. The fixed part already applied correctly
 *   (Common + Minotaur via `resolveLanguageProficiencyName`); the real gap was the
 *   MISSING free choice. Fix = add `anyStandard:1`.
 *   Secondary: the respec exotic-language clear path title-cased the raw UID
 *   ("Minotaur|Tgtt") so `removeLanguage` never matched the stored "Minotaur".
 *
 * Bug #2 (Powerful Build): the Minotaur must gain Powerful Build (carry ×2) WITHOUT
 *   losing the inherited `traitTags:["Natural Weapon"]`. Fix = `_copy._mod` appendArr
 *   on both `entries` (a "Powerful Build" feature) and `traitTags`.
 *
 * These tests resolve the REAL homebrew entry against the REAL MPMM base via
 * `DataUtil.race.pMergeCopy`, then exercise the REAL builder language loop and the
 * REAL carry-capacity state path.
 */

import "./setup.js";
import fs from "node:fs";
import path from "node:path";
import "../../../js/parser.js";
import "../../../js/utils.js";
import "../../../js/render.js";
import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-builder.js";
import "../../../js/charactersheet/charactersheet-respec.js";

const repo = path.resolve(process.cwd());
const CharacterSheetState = globalThis.CharacterSheetState;
const CharacterSheetBuilder = globalThis.CharacterSheetBuilder;
const CharacterSheetClassUtils = globalThis.CharacterSheetClassUtils;
const CharacterSheetRespec = globalThis.CharacterSheetRespec;

function loadLocal (relPath) {
	return JSON.parse(fs.readFileSync(path.join(repo, relPath), "utf8"));
}

beforeAll(() => {
	const DataUtil = globalThis.DataUtil;
	DataUtil.loadJSON = async (url) => {
		const m = String(url).replace(/^https?:\/\/[^/]+\//, "").replace(/^\/+/, "");
		const full = path.join(repo, m);
		return fs.existsSync(full) ? JSON.parse(fs.readFileSync(full, "utf8")) : null;
	};
	if (DataUtil.loadRawJSON) DataUtil.loadRawJSON = DataUtil.loadJSON;
});

/** Merge the TGTT Minotaur `_copy` against the real MPMM base, in place. */
async function resolveMinotaur () {
	const brew = loadLocal("homebrew/TravelersGuidetoThelemar.json");
	const tgtt = brew.race.find(r => r.name === "Minotaur" && r.source === "TGTT");
	const races = loadLocal("data/races.json");
	const mpmm = races.race.find(r => r.name === "Minotaur" && r.source === "MPMM");
	expect(tgtt).toBeTruthy();
	expect(mpmm).toBeTruthy();
	await globalThis.DataUtil.race.pMergeCopy([mpmm, tgtt], tgtt, {});
	return {tgtt, mpmm};
}

/** Minimal builder that only carries a language-proficiency-bearing race. */
function makeLangBuilder (languageProficiencies) {
	const builder = Object.create(CharacterSheetBuilder.prototype);
	builder._state = new CharacterSheetState();
	builder._selectedRace = {name: "Minotaur", source: "TGTT", languageProficiencies};
	builder._selectedSubrace = null;
	builder._useTashasRules = false;
	builder._tashasLanguageReplacements = [];
	builder._selectedRacialLanguages = {};
	builder._selectedSubraceLanguages = [];
	builder._selectedRacialSkills = [];
	builder._selectedRacialTools = [];
	builder._selectedRacialFeatureChoices = {};
	builder._tashasSkillReplacements = [];
	return builder;
}

describe("Bug #1 — TGTT Minotaur languages (Common + Minotaur + one choice)", () => {
	it("MPMM base ships no languageProficiencies (the grant is TGTT-authored)", async () => {
		const {mpmm} = await resolveMinotaur();
		expect(mpmm.languageProficiencies).toBeFalsy();
	});

	it("resolved race grants Common + the Minotaur language + one free choice", async () => {
		const {tgtt} = await resolveMinotaur();
		expect(tgtt.languageProficiencies).toEqual([
			{common: true, "minotaur|TGTT": true, anyStandard: 1},
		]);
	});

	it("resolveLanguageProficiencyName strips the homebrew UID to a clean name", () => {
		expect(CharacterSheetClassUtils.resolveLanguageProficiencyName("minotaur|TGTT")).toBe("Minotaur");
	});

	it("builder applies the fixed languages as Common + Minotaur (not 'Minotaur|Tgtt')", async () => {
		const {tgtt} = await resolveMinotaur();
		const builder = makeLangBuilder(tgtt.languageProficiencies);
		builder._applyRacialTraits();
		const langs = builder._state.getLanguages();
		expect(langs).toContain("Common");
		expect(langs).toContain("Minotaur");
		expect(langs).not.toContain("Minotaur|Tgtt");
	});

	it("the free choice (anyStandard) resolves to the player's pick, e.g. Dwarvish", async () => {
		const {tgtt} = await resolveMinotaur();
		// anyStandard:1 is what the picker uses to offer one choice.
		expect(tgtt.languageProficiencies[0].anyStandard).toBe(1);

		const builder = makeLangBuilder(tgtt.languageProficiencies);
		// Simulate the player choosing Dwarvish in the racial-language picker.
		builder._selectedRacialLanguages = {0: ["Dwarvish"]};
		builder._applyRacialTraits();
		const langs = builder._state.getLanguages();
		expect(langs).toEqual(expect.arrayContaining(["Common", "Minotaur", "Dwarvish"]));
	});

	it("respec exotic-language clear matches the stored name (regression for the UID bug)", () => {
		const state = new CharacterSheetState();
		// Builder stores the resolved name.
		state.addLanguage(CharacterSheetClassUtils.resolveLanguageProficiencyName("minotaur|TGTT"));
		expect(state.getLanguages()).toContain("Minotaur");

		// OLD respec path title-cased the raw UID → never matched → language leaked.
		state.removeLanguage("minotaur|TGTT".toTitleCase());
		expect(state.getLanguages()).toContain("Minotaur");

		// NEW respec path routes through resolveLanguageProficiencyName → removes it.
		state.removeLanguage(CharacterSheetClassUtils.resolveLanguageProficiencyName("minotaur|TGTT"));
		expect(state.getLanguages()).not.toContain("Minotaur");
	});

	it("respec _clearLanguagesFromData removes an exotic homebrew language on race change", async () => {
		const {tgtt} = await resolveMinotaur();
		const state = new CharacterSheetState();
		// Simulate the builder having granted the race's fixed languages.
		state.addLanguage("Common");
		state.addLanguage(CharacterSheetClassUtils.resolveLanguageProficiencyName("minotaur|TGTT"));
		expect(state.getLanguages()).toEqual(expect.arrayContaining(["Common", "Minotaur"]));

		const respec = new CharacterSheetRespec({page: null, state});
		// Clearing the race's languageProficiencies (as on a race swap) must remove
		// the exotic "Minotaur" — the pre-fix code looked for "Minotaur|Tgtt" and missed.
		respec._clearLanguagesFromData({languageProficiencies: tgtt.languageProficiencies});
		expect(state.getLanguages()).not.toContain("Minotaur");
	});
});

describe("Bug #2 — TGTT Minotaur Powerful Build (preserve inherited Natural Weapon)", () => {
	it("keeps the inherited Natural Weapon trait AND adds Powerful Build", async () => {
		const {tgtt} = await resolveMinotaur();
		expect(tgtt.traitTags).toEqual(["Natural Weapon", "Powerful Build"]);
	});

	it("adds a Powerful Build feature entry to the race", async () => {
		const {tgtt} = await resolveMinotaur();
		const pbEntry = (tgtt.entries || []).find(e => e && e.name === "Powerful Build");
		expect(pbEntry).toBeTruthy();
		expect(JSON.stringify(pbEntry.entries)).toMatch(/one size larger/i);
	});

	it("the Powerful Build entry doubles carrying capacity when applied as a feature", async () => {
		const {tgtt} = await resolveMinotaur();
		const pbEntry = (tgtt.entries || []).find(e => e && e.name === "Powerful Build");

		const state = new CharacterSheetState();
		state.addClass({name: "Barbarian", source: "TGTT", level: 6});
		state.setSetting("thelemar_carryWeight", true);
		state.setAbilityBase("str", 14); // passive Might 12 → base 120
		const base = state.getCarryingCapacity();
		expect(base).toBe(120);

		state.addFeature({
			name: pbEntry.name,
			source: "TGTT",
			sourceType: "raceFeature",
			description: pbEntry.entries.join(" "),
		});
		state.applyClassFeatureEffects();

		expect(state.getCarryingCapacity()).toBe(240);
		expect(state.getCarryingCapacityBreakdown().carryMultiplier).toBe(2);
	});
});
