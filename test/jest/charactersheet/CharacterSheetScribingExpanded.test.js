/**
 * Bug 3 — Spell Scribing Adept must offer Cleric spells to a Divine Soul Sorcerer.
 *
 * The scribable pool was built from `spell.classes.fromClassList` matched
 * against the scribing class name only, so a Divine Soul Sorcerer (whose
 * "Divine Magic" feature grants the whole Cleric list) never saw Cleric spells.
 *
 * Fix: build the pool through `CharacterSheetSpells.getScribableSpells`, which
 * delegates the availability decision to
 * `CharacterSheetClassUtils.spellIsAvailableForClass` — the same
 * granted/expanded-list seam used elsewhere. These tests exercise that static
 * helper with plain spell objects (no UI), asserting the resulting pool.
 */

import "./setup.js";

let CharacterSheetSpells;
let CharacterSheetClassUtils;

beforeAll(async () => {
	await import("../../../js/charactersheet/charactersheet-class-utils.js");
	CharacterSheetClassUtils = globalThis.CharacterSheetClassUtils;
	await import("../../../js/charactersheet/charactersheet-spells.js");
	CharacterSheetSpells = globalThis.CharacterSheetSpells;
});

const DIVINE_SOUL = {name: "Divine Soul", shortName: "Divine Soul", source: "TGTT"};

const SPELLS = [
	{name: "Cure Wounds", source: "PHB", level: 1, school: "A", classes: {fromClassList: [{name: "Cleric"}]}},
	{name: "Guiding Bolt", source: "PHB", level: 1, school: "V", classes: {fromClassList: [{name: "Cleric"}]}},
	{name: "Shield", source: "PHB", level: 1, school: "A", classes: {fromClassList: [{name: "Sorcerer"}, {name: "Wizard"}]}},
	{name: "Magic Missile", source: "PHB", level: 1, school: "V", classes: {fromClassList: [{name: "Sorcerer"}, {name: "Wizard"}]}},
	{name: "Hex", source: "PHB", level: 1, school: "E", classes: {fromClassList: [{name: "Warlock"}]}},
	{name: "Fireball", source: "PHB", level: 3, school: "V", classes: {fromClassList: [{name: "Sorcerer"}, {name: "Wizard"}]}},
	{name: "Light", source: "PHB", level: 0, school: "V", classes: {fromClassList: [{name: "Sorcerer"}, {name: "Cleric"}]}},
];

const names = (arr) => arr.map(s => s.name).sort();

describe("Bug 3 — getScribableSpells honours expanded/granted class lists", () => {
	test("Divine Soul Sorcerer can scribe Cleric spells AND Sorcerer spells", () => {
		const pool = CharacterSheetSpells.getScribableSpells({
			allSpells: SPELLS,
			className: "Sorcerer",
			classSource: "TGTT",
			subclass: DIVINE_SOUL,
			subclassChoice: {key: "good", name: "Good"},
			maxLevel: 2,
			existingIds: new Set(),
		});
		// Cleric spells now included; Sorcerer spells stay; Warlock-only excluded.
		expect(names(pool)).toEqual(["Cure Wounds", "Guiding Bolt", "Magic Missile", "Shield"]);
		expect(pool.some(s => s.name === "Hex")).toBe(false);
	});

	test("plain Sorcerer (no Divine Soul) does NOT get Cleric spells", () => {
		const pool = CharacterSheetSpells.getScribableSpells({
			allSpells: SPELLS,
			className: "Sorcerer",
			classSource: "PHB",
			subclass: null,
			subclassChoice: null,
			maxLevel: 2,
			existingIds: new Set(),
		});
		expect(names(pool)).toEqual(["Magic Missile", "Shield"]);
		expect(pool.some(s => s.name === "Cure Wounds")).toBe(false);
	});

	test("maxLevel bound excludes higher-level spells (and cantrips)", () => {
		const pool = CharacterSheetSpells.getScribableSpells({
			allSpells: SPELLS,
			className: "Sorcerer",
			classSource: "TGTT",
			subclass: DIVINE_SOUL,
			maxLevel: 1,
			existingIds: new Set(),
		});
		// Level-3 Fireball excluded by maxLevel; level-0 Light excluded (cantrip, level<1).
		expect(pool.some(s => s.name === "Fireball")).toBe(false);
		expect(pool.some(s => s.name === "Light")).toBe(false);
	});

	test("existingIds removes already-scribed spells", () => {
		const pool = CharacterSheetSpells.getScribableSpells({
			allSpells: SPELLS,
			className: "Sorcerer",
			classSource: "TGTT",
			subclass: DIVINE_SOUL,
			maxLevel: 2,
			existingIds: new Set(["Cure Wounds|PHB", "Shield|PHB"]),
		});
		expect(pool.some(s => s.name === "Cure Wounds")).toBe(false);
		expect(pool.some(s => s.name === "Shield")).toBe(false);
		expect(pool.some(s => s.name === "Guiding Bolt")).toBe(true);
	});

	test("results are sorted by level then name", () => {
		const pool = CharacterSheetSpells.getScribableSpells({
			allSpells: SPELLS,
			className: "Sorcerer",
			classSource: "TGTT",
			subclass: DIVINE_SOUL,
			maxLevel: 9,
			existingIds: new Set(),
		});
		const sorted = [...pool].sort((a, b) => a.level - b.level || a.name.localeCompare(b.name));
		expect(pool).toEqual(sorted);
	});
});
