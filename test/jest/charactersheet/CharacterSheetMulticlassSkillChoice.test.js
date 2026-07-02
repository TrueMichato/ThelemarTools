/**
 * Bug #3 — Multiclass skill-choice modal throws + renders empty.
 *
 * Symptom (pre-fix): adding e.g. a Bard multiclass to a Barbarian threw
 * `TypeError: currentSkills.includes is not a function` inside
 * `_showMulticlassChoices`. Root cause: `this._state.getSkillProficiencies()`
 * returns an OBJECT (map of canonical-skill-id -> proficiency level, e.g.
 * `{animalhandling: 1, survival: 1}`), but the code called the Array method
 * `.includes()` on it:
 *     skillGrant.from.filter(s => !currentSkills.includes(s))
 * The throw aborted the render loop, so the modal appeared with NO skills to pick.
 *
 * Two bugs really: (1) `.includes` on an object throws; (2) even
 * `Object.keys(...).includes(s)` would MIS-match, because grant lists use
 * spaced/lowercase names ("animal handling") while stored keys are canonicalised
 * ("animalhandling") — the same `toLowerCase().replace(/\s+/g,"")` form used when
 * skills are actually applied in `_applyMulticlass`.
 *
 * Fix: `_getMulticlassSkillOptions(skillGrant)` reduces BOTH sides to the canonical
 * form via a Set, returns the still-available skills plus a clamped `effectiveCount`
 * so an all-known / underflow character is never blocked by an impossible pick.
 *
 * These tests drive the REAL helper the modal now uses (no DOM/modal needed) and
 * pin the normalized comparison + edge cases. A source guard at the bottom locks
 * out the `.includes`-on-object regression.
 */

import "./setup.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-levelup.js";

import {readFileSync} from "fs";
import {fileURLToPath} from "url";
import {dirname, resolve} from "path";

const CharacterSheetState = globalThis.CharacterSheetState;
const CharacterSheetLevelUp = globalThis.CharacterSheetLevelUp;

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..", "..");
const read = (/** @type {string} */ rel) => readFileSync(resolve(REPO_ROOT, rel), "utf8");

// Canonical form used everywhere skills are stored/applied.
const norm = (/** @type {string} */ s) => s.toLowerCase().replace(/\s+/g, "");

// Minimal page stub — the helper only reads `this._state`.
const makeLevelUp = (/** @type {*} */ state) => new CharacterSheetLevelUp({getState: () => state});

/** A Barbarian who already has some proficiencies (stored canonicalised). */
const makeBarbarian = (/** @type {string[]} */ knownCanonicalSkills = ["animalhandling", "survival"]) => {
	const state = new CharacterSheetState();
	state.addClass({name: "Barbarian", source: "PHB", level: 3});
	knownCanonicalSkills.forEach((k) => state.setSkillProficiency(k, 1));
	return state;
};

// Bard multiclass grant: any skill. Mirrors the source (spaced/lowercase names).
const BARD_GRANT = {count: 1, from: Object.keys(Parser.SKILL_TO_ATB_ABV)};
// Ranger/Rogue-style grant: an explicit spaced/lowercase list.
const RANGER_GRANT = {count: 1, from: ["animal handling", "athletics", "insight", "investigation", "nature", "perception", "stealth", "survival"]};

describe("Bug #3 — Barbarian→Bard multiclass skill options (normalized exclusion)", () => {
	test("does NOT throw on the object returned by getSkillProficiencies()", () => {
		const state = makeBarbarian();
		const lu = makeLevelUp(state);
		// getSkillProficiencies must be an object, and the helper must tolerate it.
		expect(Array.isArray(state.getSkillProficiencies())).toBe(false);
		expect(() => lu._getMulticlassSkillOptions(BARD_GRANT)).not.toThrow();
	});

	test("excludes already-known skills using normalized (space/case-insensitive) compare", () => {
		// Known: "animalhandling" (canonical). Bard grant offers "animal handling" (spaced).
		const state = makeBarbarian(["animalhandling", "athletics"]);
		const lu = makeLevelUp(state);

		const {availableSkills, effectiveCount} = lu._getMulticlassSkillOptions(BARD_GRANT);
		const availNorm = availableSkills.map(norm);

		// The spaced grant name is excluded despite the stored key being unspaced.
		expect(availNorm).not.toContain("animalhandling");
		expect(availNorm).not.toContain("athletics");
		// Unknown skills remain selectable.
		expect(availNorm).toContain("stealth");
		expect(availNorm).toContain("arcana");
		expect(availNorm).toContain("sleightofhand"); // "sleight of hand" normalized
		expect(effectiveCount).toBe(1);
	});

	test("a still-available option, once normalized, is not among the character's proficiencies", () => {
		const state = makeBarbarian(["animalhandling", "survival"]);
		const lu = makeLevelUp(state);
		const {availableSkills} = lu._getMulticlassSkillOptions(RANGER_GRANT);
		const have = new Set(Object.keys(state.getSkillProficiencies()).map(norm));
		// Every offered skill is genuinely un-owned (the crux of the fix).
		availableSkills.forEach((s) => expect(have.has(norm(s))).toBe(false));
		// And the known ones are gone from the offer.
		expect(availableSkills.map(norm)).not.toContain("animalhandling");
		expect(availableSkills.map(norm)).not.toContain("survival");
	});

	test("with no relevant overlap, the full grant list is offered and count is intact", () => {
		// Barbarian with only STR/CON-ish skills that don't overlap the Ranger list.
		const state = makeBarbarian(["intimidation"]);
		const lu = makeLevelUp(state);
		const {availableSkills, effectiveCount} = lu._getMulticlassSkillOptions(RANGER_GRANT);
		expect(availableSkills).toHaveLength(RANGER_GRANT.from.length);
		expect(effectiveCount).toBe(1);
	});
});

describe("Bug #3 — effectiveCount clamps (underflow / all-known edges)", () => {
	test("clamps effectiveCount down when fewer skills remain than requested", () => {
		// Grant wants 3 but only 2 of its 4 options are still available.
		const grant = {count: 3, from: ["athletics", "stealth", "arcana", "insight"]};
		const state = makeBarbarian(["arcana", "insight"]);
		const lu = makeLevelUp(state);
		const {availableSkills, effectiveCount} = lu._getMulticlassSkillOptions(grant);
		expect(availableSkills.map(norm).sort()).toEqual(["athletics", "stealth"]);
		expect(effectiveCount).toBe(2); // clamped from 3
	});

	test("all-known: empty available list, effectiveCount 0 (never blocks confirm)", () => {
		const grant = {count: 1, from: ["athletics", "stealth"]};
		const state = makeBarbarian(["athletics", "stealth"]);
		const lu = makeLevelUp(state);
		const {availableSkills, effectiveCount} = lu._getMulticlassSkillOptions(grant);
		expect(availableSkills).toHaveLength(0);
		expect(effectiveCount).toBe(0);
	});
});

describe("Bug #3 — malformed / falsy grant is handled defensively", () => {
	test("falsy grant returns empty options", () => {
		const lu = makeLevelUp(makeBarbarian());
		expect(lu._getMulticlassSkillOptions(undefined)).toEqual({availableSkills: [], effectiveCount: 0});
		expect(lu._getMulticlassSkillOptions(null)).toEqual({availableSkills: [], effectiveCount: 0});
	});

	test("grant without an array `from` returns empty options (does not throw)", () => {
		const lu = makeLevelUp(makeBarbarian());
		expect(() => lu._getMulticlassSkillOptions({count: 1})).not.toThrow();
		expect(lu._getMulticlassSkillOptions({count: 1, from: "athletics"})).toEqual({availableSkills: [], effectiveCount: 0});
	});

	test("missing/invalid count coerces to 0 (no NaN leaking into effectiveCount)", () => {
		const lu = makeLevelUp(makeBarbarian(["intimidation"]));
		const {effectiveCount} = lu._getMulticlassSkillOptions({from: ["athletics", "stealth"]});
		expect(effectiveCount).toBe(0);
		expect(Number.isNaN(effectiveCount)).toBe(false);
	});

	test("fractional count floors (never over-clamps to a non-integer)", () => {
		const lu = makeLevelUp(makeBarbarian(["intimidation"]));
		const {effectiveCount} = lu._getMulticlassSkillOptions({count: 1.9, from: ["athletics", "stealth"]});
		expect(effectiveCount).toBe(1);
	});

	test("non-string entries in `from` are dropped (won't crash the picker's .split)", () => {
		const lu = makeLevelUp(makeBarbarian(["intimidation"]));
		const {availableSkills} = lu._getMulticlassSkillOptions({count: 2, from: ["athletics", 123, null, "stealth"]});
		expect(availableSkills).toEqual(["athletics", "stealth"]);
	});

	test("duplicate `from` entries are de-duplicated by canonical id", () => {
		const lu = makeLevelUp(makeBarbarian(["intimidation"]));
		// "Athletics"/"athletics" and "animal handling"/"animalhandling" collapse.
		const {availableSkills, effectiveCount} = lu._getMulticlassSkillOptions({
			count: 3,
			from: ["Athletics", "athletics", "animal handling", "animalhandling", "stealth"],
		});
		expect(availableSkills.map(norm).sort()).toEqual(["animalhandling", "athletics", "stealth"]);
		expect(effectiveCount).toBe(3);
	});

	test("already-canonical (unspaced) grant names still match stored canonical keys", () => {
		// Grant offers the unspaced form; character already knows it -> excluded.
		const lu = makeLevelUp(makeBarbarian(["sleightofhand"]));
		const {availableSkills, effectiveCount} = lu._getMulticlassSkillOptions({count: 1, from: ["sleightofhand"]});
		expect(availableSkills).toHaveLength(0);
		expect(effectiveCount).toBe(0);
	});
});

describe("Bug #3 — source guard (regression pins)", () => {
	const LEVELUP = read("js/charactersheet/charactersheet-levelup.js");

	test("no longer calls Array `.includes` on the getSkillProficiencies() object", () => {
		// The exact pre-fix shape that threw.
		expect(LEVELUP).not.toMatch(/currentSkills\.includes/);
		expect(LEVELUP).not.toMatch(/getSkillProficiencies\s*\(\s*\)\s*\.includes/);
	});

	test("uses the normalized-Set helper for multiclass skill filtering", () => {
		// Behavioral pins: the helper must exist AND be wired into the modal path
		// (guards against "helper defined but modal reverted to the old filter").
		expect(LEVELUP).toMatch(/_getMulticlassSkillOptions\s*\(/);
		expect(LEVELUP).toMatch(/this\._getMulticlassSkillOptions\(skillGrant\)/);
	});
});
