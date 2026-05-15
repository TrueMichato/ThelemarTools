/**
 * Regression guard for "Celestial Resistance of Hochling/Aasimar isn't
 * appearing as a resistance" — see bugs.md (closed) / CS-BUG-018.
 *
 * Two layers of coverage:
 *   1. JSON-level invariant on the TGTT homebrew file — guarantees the data
 *      shape that lets the homebrew loader resolve Hochling's `_copy`
 *      against MPMM Aasimar.
 *   2. Builder ingestion smoke test — confirms that a properly merged race
 *      object (i.e. Hochling once `_copy` has been resolved) produces the
 *      expected resistances on the state, and that an UN-merged race object
 *      (no `resist` field) produces none. The negative branch proves this
 *      spec would have caught the original bug.
 */

import fs from "fs";
import path from "path";
import {fileURLToPath} from "url";

import "./setup.js";
import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-builder.js";

const CharacterSheetState = globalThis.CharacterSheetState;
const CharacterSheetBuilder = globalThis.CharacterSheetBuilder;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "../../..");
const TGTT_PATH = path.join(REPO_ROOT, "homebrew/TravelersGuidetoThelemar.json");
const RACES_PATH = path.join(REPO_ROOT, "data/races.json");

function makeBuilder () {
	const builder = Object.create(CharacterSheetBuilder.prototype);
	builder._state = new CharacterSheetState();
	builder._useTashasRules = false;
	builder._tashasLanguageReplacements = [];
	builder._tashasSkillReplacements = [];
	builder._selectedRacialLanguages = {};
	builder._selectedSubraceLanguages = [];
	builder._selectedRacialSkills = [];
	builder._selectedRacialTools = [];
	builder._selectedRacialAbilityChoices = {};
	builder._selectedRacialAbilitySetIdx = {};
	builder._selectedRacialSpells = [];
	builder._selectedRacialSpellAbilities = {};
	builder._selectedRace = null;
	builder._selectedSubrace = null;
	return builder;
}

describe("Hochling Celestial Resistance — data invariants", () => {
	let tgtt;
	let mpmmAasimar;

	beforeAll(() => {
		tgtt = JSON.parse(fs.readFileSync(TGTT_PATH, "utf8"));
		const races = JSON.parse(fs.readFileSync(RACES_PATH, "utf8")).race;
		mpmmAasimar = races.find(r => r.name === "Aasimar" && r.source === "MPMM");
	});

	it("declares internalCopies for race so in-file _copy is resolved", () => {
		// Without this, the Hochling _copy directive is never merged and the
		// resulting race object lacks `resist` entirely.
		expect(tgtt._meta).toBeDefined();
		expect(Array.isArray(tgtt._meta.internalCopies)).toBe(true);
		expect(tgtt._meta.internalCopies).toContain("race");
	});

	it("declares MPMM in race dependencies so MPMM Aasimar is loadable for the copy target", () => {
		expect(tgtt._meta.dependencies).toBeDefined();
		expect(tgtt._meta.dependencies.race).toContain("MPMM");
	});

	it("Hochling exists and is a _copy of MPMM Aasimar", () => {
		const hochling = tgtt.race.find(r => r.name === "Hochling" && r.source === "TGTT");
		expect(hochling).toBeDefined();
		expect(hochling._copy).toEqual({name: "Aasimar", source: "MPMM"});
	});

	it("MPMM Aasimar (the copy source) actually carries the necrotic + radiant resistances", () => {
		expect(mpmmAasimar).toBeDefined();
		expect(mpmmAasimar.resist).toEqual(expect.arrayContaining(["necrotic", "radiant"]));
	});
});

describe("Hochling Celestial Resistance — builder ingestion", () => {
	it("a merged Hochling race (resist field present) produces necrotic + radiant resistances on the state", () => {
		const builder = makeBuilder();
		// Shape that a successful _copy merge would produce — the race object
		// the builder sees once Hochling has inherited from MPMM Aasimar.
		builder._selectedRace = {
			name: "Hochling",
			source: "TGTT",
			resist: ["necrotic", "radiant"],
		};
		builder._applyRacialTraits();

		const resistances = builder._state.getResistances();
		expect(resistances).toContain("necrotic");
		expect(resistances).toContain("radiant");
	});

	it("an unmerged race (no resist field, as Hochling looked when the bug was live) adds NO resistances — proves the regression guard would catch it", () => {
		const builder = makeBuilder();
		builder._selectedRace = {
			name: "Hochling",
			source: "TGTT",
			alias: ["Hochling"],
			_copy: {name: "Aasimar", source: "MPMM"},
			// no resist field — _copy not yet resolved
		};
		builder._applyRacialTraits();

		const resistances = builder._state.getResistances();
		expect(resistances).not.toContain("necrotic");
		expect(resistances).not.toContain("radiant");
	});
});
