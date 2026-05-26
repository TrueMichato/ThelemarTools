/**
 * Priority Source Sub-Source Filtering
 *
 * Regression coverage for the Illrigger duplicate bug: the TGTT homebrew
 * bundle declares sub-sources ("TGTT-IllR", "TGTT-2014", "TGTT-2024", "TGTT-AR")
 * in addition to its main "TGTT" source. The character-sheet priority filter
 * previously did a strict `prioritySources.includes(e.source)` check, so an
 * entity from "TGTT-IllR" did not count as belonging to priority "TGTT" — the
 * non-priority duplicate (e.g. "IllriggerRevised/Illrigger" loaded as a TGTT
 * dependency) was never deduped against it, producing two "Illrigger" entries
 * in the class picker and multiclass modal.
 *
 * Fix: `CharacterSheetClassUtils.isSourceInPriority` treats any source of the
 * form "${priority}-..." as a member of that priority bundle.
 */

import "./setup.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import fs from "fs";
import path from "path";
import {fileURLToPath} from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CharacterSheetClassUtils = globalThis.CharacterSheetClassUtils;

// Tiny replica of `_applyPriorityFilter` from charactersheet.js — exercises the
// helper exactly the way the production filter does. A separate source-level
// guard below pins the production call site to this helper so the two cannot
// drift apart.
const applyPriorityFilter = (entities, prioritySources) => {
	const priorityNames = new Set();
	entities.forEach(e => {
		if (CharacterSheetClassUtils.isSourceInPriority(e.source, prioritySources)) {
			priorityNames.add(e.name?.toLowerCase());
		}
	});
	return entities.filter(e => {
		if (CharacterSheetClassUtils.isSourceInPriority(e.source, prioritySources)) return true;
		return !priorityNames.has(e.name?.toLowerCase());
	});
};

describe("CharacterSheetClassUtils.isSourceInPriority", () => {
	test("exact source match returns true", () => {
		expect(CharacterSheetClassUtils.isSourceInPriority("TGTT", ["TGTT"])).toBe(true);
	});

	test("sub-source of a priority bundle returns true", () => {
		expect(CharacterSheetClassUtils.isSourceInPriority("TGTT-IllR", ["TGTT"])).toBe(true);
		expect(CharacterSheetClassUtils.isSourceInPriority("TGTT-2024", ["TGTT"])).toBe(true);
		expect(CharacterSheetClassUtils.isSourceInPriority("TGTT-AR", ["TGTT"])).toBe(true);
	});

	test("unrelated source returns false", () => {
		expect(CharacterSheetClassUtils.isSourceInPriority("PHB", ["TGTT"])).toBe(false);
		expect(CharacterSheetClassUtils.isSourceInPriority("IllriggerRevised", ["TGTT"])).toBe(false);
	});

	test("prefix without delimiter does NOT match (boundary check)", () => {
		// "TGTTX" must not be treated as a sub-source of "TGTT" — only
		// "TGTT-..." counts.
		expect(CharacterSheetClassUtils.isSourceInPriority("TGTTX", ["TGTT"])).toBe(false);
		expect(CharacterSheetClassUtils.isSourceInPriority("TGTT2024", ["TGTT"])).toBe(false);
	});

	test("multiple priority sources — any match wins", () => {
		const priority = ["TGTT", "IllriggerRevised"];
		expect(CharacterSheetClassUtils.isSourceInPriority("TGTT-IllR", priority)).toBe(true);
		expect(CharacterSheetClassUtils.isSourceInPriority("IllriggerRevised", priority)).toBe(true);
		expect(CharacterSheetClassUtils.isSourceInPriority("PHB", priority)).toBe(false);
	});

	test("empty / nullish priority list returns false", () => {
		expect(CharacterSheetClassUtils.isSourceInPriority("TGTT", [])).toBe(false);
		expect(CharacterSheetClassUtils.isSourceInPriority("TGTT", null)).toBe(false);
		expect(CharacterSheetClassUtils.isSourceInPriority("TGTT", undefined)).toBe(false);
	});

	test("missing source returns false", () => {
		expect(CharacterSheetClassUtils.isSourceInPriority(null, ["TGTT"])).toBe(false);
		expect(CharacterSheetClassUtils.isSourceInPriority(undefined, ["TGTT"])).toBe(false);
		expect(CharacterSheetClassUtils.isSourceInPriority("", ["TGTT"])).toBe(false);
	});
});

describe("Priority-filter integration — sub-source dedup", () => {
	test("Illrigger bug repro: TGTT-IllR hides IllriggerRevised duplicate", () => {
		const entities = [
			{name: "Illrigger", source: "TGTT-IllR"},
			{name: "Illrigger", source: "IllriggerRevised"},
		];
		const result = applyPriorityFilter(entities, ["TGTT"]);
		expect(result).toEqual([{name: "Illrigger", source: "TGTT-IllR"}]);
	});

	test("exact-match priority still deduplicates against PHB", () => {
		const entities = [
			{name: "Fireball", source: "TGTT"},
			{name: "Fireball", source: "PHB"},
		];
		const result = applyPriorityFilter(entities, ["TGTT"]);
		expect(result).toEqual([{name: "Fireball", source: "TGTT"}]);
	});

	test("two sibling sub-sources of the same bundle are both kept", () => {
		// e.g. a class deliberately published in both 2014 and 2024 flavours
		// under the TGTT umbrella — both belong to priority and neither should
		// be hidden.
		const entities = [
			{name: "Gunslinger", source: "TGTT-2014"},
			{name: "Gunslinger", source: "TGTT-2024"},
		];
		const result = applyPriorityFilter(entities, ["TGTT"]);
		expect(result).toHaveLength(2);
		expect(result.map(e => e.source).sort()).toEqual(["TGTT-2014", "TGTT-2024"]);
	});

	test("boundary: 'TGTTX' is NOT a sub-source of 'TGTT' and gets deduped normally", () => {
		const entities = [
			{name: "Spell", source: "TGTT"},
			{name: "Spell", source: "TGTTX"},
		];
		const result = applyPriorityFilter(entities, ["TGTT"]);
		// TGTTX is treated as a non-priority source; its duplicate gets hidden
		expect(result).toEqual([{name: "Spell", source: "TGTT"}]);
	});

	test("multiple priority sources combine — both keep their entities", () => {
		const entities = [
			{name: "Illrigger", source: "TGTT-IllR"},
			{name: "Illrigger", source: "IllriggerRevised"},
			{name: "Wizard", source: "PHB"},
		];
		const result = applyPriorityFilter(entities, ["TGTT", "IllriggerRevised"]);
		// Both Illriggers are now in priority buckets → both kept
		expect(result).toHaveLength(3);
		expect(result.find(e => e.source === "TGTT-IllR")).toBeDefined();
		expect(result.find(e => e.source === "IllriggerRevised")).toBeDefined();
		expect(result.find(e => e.source === "PHB")).toBeDefined();
	});

	test("entities with no priority counterpart pass through", () => {
		const entities = [
			{name: "Bard", source: "PHB"},
			{name: "Cleric", source: "XPHB"},
		];
		const result = applyPriorityFilter(entities, ["TGTT"]);
		expect(result).toHaveLength(2);
	});

	test("case-insensitive name dedup is preserved", () => {
		const entities = [
			{name: "illrigger", source: "TGTT-IllR"},
			{name: "Illrigger", source: "IllriggerRevised"},
		];
		const result = applyPriorityFilter(entities, ["TGTT"]);
		expect(result).toEqual([{name: "illrigger", source: "TGTT-IllR"}]);
	});

	test("empty priority list passes input through unchanged", () => {
		const entities = [
			{name: "Illrigger", source: "TGTT-IllR"},
			{name: "Illrigger", source: "IllriggerRevised"},
		];
		const result = applyPriorityFilter(entities, []);
		expect(result).toHaveLength(2);
	});
});

describe("Source-level guard: production filter delegates to isSourceInPriority", () => {
	// Pin the production call site to the shared helper so the inline replica
	// above can't drift from the real filter.
	const src = fs.readFileSync(
		path.resolve(__dirname, "../../../js/charactersheet/charactersheet.js"),
		"utf8",
	);

	test("_applyPriorityFilter calls CharacterSheetClassUtils.isSourceInPriority", () => {
		// Locate the method body and verify it uses the helper (not strict includes()).
		const match = src.match(/_applyPriorityFilter\s*\(entities,\s*prioritySources\)\s*\{[\s\S]*?\n\t\}/);
		expect(match).not.toBeNull();
		const body = match[0];
		expect(body).toMatch(/CharacterSheetClassUtils\.isSourceInPriority\s*\(\s*e\.source\s*,\s*prioritySources\s*\)/);
		// Must NOT use the old strict-match pattern
		expect(body).not.toMatch(/prioritySources\.includes\s*\(\s*e\.source\s*\)/);
	});
});
