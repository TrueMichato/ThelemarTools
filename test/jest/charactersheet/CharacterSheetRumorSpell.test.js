/**
 * "Rumor" spell (TGTT homebrew — Bug 10).
 *
 * Validates the new 5th-level Enchantment added to the homebrew `spell` array:
 *   - core fields (level, school, casting time, range, components, duration);
 *   - class availability = every TGTT-referenced caster EXCEPT cleric/druid/ranger;
 *   - rarity/legality encoded on `subschools` using the EXACT strings the spell
 *     picker filters on (`rarity:rare`, `legality:illegal-II` — roman numerals);
 *   - "At Higher Levels" durations (6th/7th/8th/9th) via `entriesHigherLevel`.
 *
 * Reads the homebrew file directly (like the other TGTT data tests) so the test
 * fails loudly if the spell object is removed or its tags drift.
 */

import fs from "fs";
import path from "path";
import {fileURLToPath} from "url";

const __dirnameLocal = path.dirname(fileURLToPath(import.meta.url));
const BREW_PATH = path.join(__dirnameLocal, "..", "..", "..", "homebrew", "TravelersGuidetoThelemar.json");

let brew;
let rumor;

beforeAll(() => {
	brew = JSON.parse(fs.readFileSync(BREW_PATH, "utf8"));
	rumor = (brew.spell || []).find(s => s.name === "Rumor" && s.source === "TGTT");
});

describe("Rumor spell — core fields", () => {
	test("exists in the TGTT spell array", () => {
		expect(rumor).toBeDefined();
	});

	test("is a 5th-level Enchantment", () => {
		expect(rumor.level).toBe(5);
		expect(rumor.school).toBe("E");
	});

	test("casting time is 1 action", () => {
		expect(rumor.time).toEqual([{number: 1, unit: "action"}]);
	});

	test("range is touch", () => {
		expect(rumor.range).toMatchObject({type: "point", distance: {type: "touch"}});
	});

	test("components are Verbal + Somatic only (no material)", () => {
		expect(rumor.components.v).toBe(true);
		expect(rumor.components.s).toBe(true);
		expect(rumor.components.m).toBeUndefined();
	});

	test("base duration is 1 hour", () => {
		expect(rumor.duration).toEqual([
			{type: "timed", duration: {type: "hour", amount: 1}},
		]);
	});

	test("requires a Wisdom saving throw", () => {
		expect(rumor.savingThrow).toEqual(["wisdom"]);
	});

	test("entries include the belief-implant description and the canonical example list", () => {
		const flat = JSON.stringify(rumor.entries);
		expect(flat).toContain("I heard a rumor");
		const list = rumor.entries.find(e => e && e.type === "list");
		expect(list).toBeDefined();
		expect(Array.isArray(list.items)).toBe(true);
		const canonical = [
			"I heard a rumor you trust me completely.",
			"I heard a rumor your friend died in battle.",
			"I heard a rumor you want to surrender.",
			"I heard a rumor the vault is already empty.",
			"I heard a rumor you've known us for years.",
		];
		canonical.forEach(expected => {
			expect(list.items.some(it => typeof it === "string" && it.includes(expected))).toBe(true);
		});
	});
});

describe("Rumor spell — class availability (all casters except cleric/druid/ranger)", () => {
	let classNames;
	beforeAll(() => {
		classNames = (rumor.classes?.fromClassList || []).map(c => c.name);
	});

	test.each(["Artificer", "Bard", "Paladin", "Sorcerer", "Warlock", "Wizard"])(
		"is available to %s",
		(name) => {
			expect(classNames).toContain(name);
		},
	);

	test.each(["Cleric", "Druid", "Ranger"])(
		"is NOT available to %s",
		(name) => {
			expect(classNames).not.toContain(name);
		},
	);

	test("every listed class is sourced from TGTT", () => {
		(rumor.classes.fromClassList || []).forEach(c => {
			expect(c.source).toBe("TGTT");
		});
	});
});

describe("Rumor spell — rarity/legality tags (exact picker-filtered encoding)", () => {
	test("subschools carry rarity:rare and legality:illegal-II", () => {
		expect(Array.isArray(rumor.subschools)).toBe(true);
		expect(rumor.subschools).toContain("rarity:rare");
		expect(rumor.subschools).toContain("legality:illegal-II");
	});

	test("does NOT use the guessed 'illegal-2' / 'illegal 2' encoding", () => {
		expect(rumor.subschools).not.toContain("legality:illegal-2");
		expect(rumor.subschools).not.toContain("legality:illegal 2");
	});
});

describe("Rumor spell — At Higher Levels durations", () => {
	let text;
	beforeAll(() => {
		text = JSON.stringify(rumor.entriesHigherLevel || []);
	});

	test("has an entriesHigherLevel block", () => {
		expect(Array.isArray(rumor.entriesHigherLevel)).toBe(true);
		expect(rumor.entriesHigherLevel.length).toBeGreaterThan(0);
	});

	test.each([
		["6th", "24 hours"],
		["7th", "30 days"],
		["8th", "1 year"],
		["9th", "until it is removed"],
	])("mentions the %s-level duration (%s)", (_lvl, phrase) => {
		expect(text).toContain(phrase);
	});

	test("9th-level removal references greater restoration / wish", () => {
		expect(text.toLowerCase()).toContain("greater restoration");
		expect(text.toLowerCase()).toContain("wish");
	});
});
