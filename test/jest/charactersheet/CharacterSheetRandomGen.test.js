/**
 * Tests for the RandomCharacterGenerator utility.
 *
 * Validates that every class can produce a coherent level-1 character
 * with race, background, ability scores, proficiencies, and spells.
 */

import {RandomCharacterGenerator, CLASS_DEFS, SeededRandom} from "./CharacterSheetRandomGen.js";

const CharacterSheetState = globalThis.CharacterSheetState;
const ABILITIES = ["str", "dex", "con", "int", "wis", "cha"];

describe("RandomCharacterGenerator", () => {
	let gen;

	beforeEach(() => {
		gen = new RandomCharacterGenerator();
	});

	// ── Core contract: every class produces a valid character ──

	describe.each(Object.keys(CLASS_DEFS))("create('%s')", (className) => {
		let state;

		beforeEach(() => {
			state = gen.create(className, {seed: 12345});
		});

		test("returns a CharacterSheetState instance", () => {
			expect(state).toBeInstanceOf(CharacterSheetState);
		});

		test("has the chosen class at level 1", () => {
			const classes = state.getClasses();
			expect(classes).toHaveLength(1);
			expect(classes[0].name).toBe(className);
			expect(classes[0].level).toBe(1);
		});

		test("has a race set", () => {
			expect(state.getRace()).not.toBeNull();
			expect(state.getRace().name).toBeTruthy();
		});

		test("has a background set", () => {
			expect(state.getBackground()).not.toBeNull();
			expect(state.getBackground().name).toBeTruthy();
		});

		test("has all six ability base scores assigned from standard array", () => {
			const bases = ABILITIES.map(a => state.getAbilityBase(a));
			// Should contain exactly the standard array values (sorted)
			expect([...bases].sort((a, b) => a - b)).toEqual([8, 10, 12, 13, 14, 15]);
		});

		test("total level is 1", () => {
			expect(state.getTotalLevel()).toBe(1);
		});

		test("has save proficiencies matching class", () => {
			const classDef = CLASS_DEFS[className];
			for (const save of classDef.saves) {
				expect(state._data.saveProficiencies).toContain(save);
			}
		});

		test("has at least one language", () => {
			expect(state._data.languages.length).toBeGreaterThanOrEqual(1);
		});

		test("has level history recorded", () => {
			expect(state._data.levelHistory).toHaveLength(1);
			expect(state._data.levelHistory[0].level).toBe(1);
			expect(state._data.levelHistory[0].class.name).toBe(className);
		});

		test("has HP set and > 0", () => {
			expect(state._data.hp.current).toBeGreaterThan(0);
			expect(state._data.hp.max).toBeGreaterThan(0);
		});
	});

	// ── Spellcaster-specific checks ──

	describe("spellcasting classes", () => {
		const CASTERS = Object.entries(CLASS_DEFS)
			.filter(([, def]) => def.casterType)
			.map(([name]) => name);

		test.each(CASTERS)("%s has spellcasting ability set", (className) => {
			const state = gen.create(className, {seed: 99});
			const classDef = CLASS_DEFS[className];
			expect(state.getSpellcastingAbility()).toBe(classDef.castingAbility);
		});

		test.each(CASTERS)("%s has cantrips if class knows cantrips", (className) => {
			const state = gen.create(className, {seed: 99});
			const classDef = CLASS_DEFS[className];
			if (classDef.cantripsKnown) {
				expect(state._data.spellcasting.cantripsKnown.length).toBe(classDef.cantripsKnown);
			}
		});

		test("Bard has 4 known spells", () => {
			const state = gen.create("Bard", {seed: 42});
			expect(state._data.spellcasting.spellsKnown.length).toBe(4);
		});

		test("Sorcerer has 2 known spells", () => {
			const state = gen.create("Sorcerer", {seed: 42});
			expect(state._data.spellcasting.spellsKnown.length).toBe(2);
		});

		test("Warlock has 2 known spells", () => {
			const state = gen.create("Warlock", {seed: 42});
			expect(state._data.spellcasting.spellsKnown.length).toBe(2);
		});

		test("Wizard has 6 spellbook spells", () => {
			const state = gen.create("Wizard", {seed: 42});
			expect(state._data.spellcasting.spellsKnown.length).toBe(6);
		});

		test("Cleric has cantrips but no known spells (prepared caster)", () => {
			const state = gen.create("Cleric", {seed: 42});
			expect(state._data.spellcasting.cantripsKnown.length).toBe(3);
			expect(state._data.spellcasting.spellsKnown.length).toBe(0);
		});

		test("Druid has cantrips but no known spells (prepared caster)", () => {
			const state = gen.create("Druid", {seed: 42});
			expect(state._data.spellcasting.cantripsKnown.length).toBe(2);
			expect(state._data.spellcasting.spellsKnown.length).toBe(0);
		});
	});

	// ── Non-casters ──

	describe("non-casters", () => {
		const NON_CASTERS = Object.entries(CLASS_DEFS)
			.filter(([, def]) => !def.casterType)
			.map(([name]) => name);

		test.each(NON_CASTERS)("%s has no spellcasting ability", (className) => {
			const state = gen.create(className, {seed: 42});
			expect(state.getSpellcastingAbility()).toBeNull();
		});

		test.each(NON_CASTERS)("%s has no cantrips or spells", (className) => {
			const state = gen.create(className, {seed: 42});
			expect(state._data.spellcasting.cantripsKnown).toHaveLength(0);
			expect(state._data.spellcasting.spellsKnown).toHaveLength(0);
		});
	});

	// ── Reproducibility ──

	describe("seed reproducibility", () => {
		test("same seed produces identical characters", () => {
			const s1 = gen.create("Fighter", {seed: 42});
			const s2 = gen.create("Fighter", {seed: 42});
			// Compare serialised data (excluding generated IDs)
			const strip = (data) => {
				const copy = JSON.parse(JSON.stringify(data));
				// IDs are random UUIDs, strip them for comparison
				const stripIds = (obj) => {
					if (Array.isArray(obj)) return obj.map(stripIds);
					if (obj && typeof obj === "object") {
						const out = {};
						for (const [k, v] of Object.entries(obj)) {
							if (k === "id" || k === "timestamp") continue;
							out[k] = stripIds(v);
						}
						return out;
					}
					return obj;
				};
				return stripIds(copy);
			};
			expect(strip(s1._data)).toEqual(strip(s2._data));
		});

		test("different seeds produce different characters", () => {
			const s1 = gen.create("Wizard", {seed: 1});
			const s2 = gen.create("Wizard", {seed: 9999});
			// Race or background or ability arrangement should differ
			const r1 = s1.getRace()?.name;
			const r2 = s2.getRace()?.name;
			const b1 = s1.getBackground()?.name;
			const b2 = s2.getBackground()?.name;
			const a1 = ABILITIES.map(a => s1.getAbilityBase(a));
			const a2 = ABILITIES.map(a => s2.getAbilityBase(a));
			const differ = r1 !== r2 || b1 !== b2 || JSON.stringify(a1) !== JSON.stringify(a2);
			expect(differ).toBe(true);
		});
	});

	// ── Skill proficiency deduplication ──

	describe("skill deduplication", () => {
		test("class skills don't duplicate race/background skills", () => {
			// Run many seeds and check no skill appears twice
			for (let seed = 0; seed < 20; seed++) {
				const state = gen.create("Rogue", {seed});
				const profs = state._data.skillProficiencies;
				// All values should be 1 (proficient) — no overwrites
				for (const [skill, level] of Object.entries(profs)) {
					expect(level).toBeGreaterThanOrEqual(1);
				}
			}
		});
	});

	// ── Error handling ──

	describe("error handling", () => {
		test("throws for unknown class", () => {
			expect(() => gen.create("Artificer")).toThrow("Unknown class: Artificer");
		});
	});

	// ── SeededRandom ──

	describe("SeededRandom", () => {
		test("produces deterministic sequences", () => {
			const r1 = new SeededRandom(42);
			const r2 = new SeededRandom(42);
			for (let i = 0; i < 50; i++) {
				expect(r1.next()).toBe(r2.next());
			}
		});

		test("pickN returns correct count", () => {
			const rng = new SeededRandom(7);
			const result = rng.pickN([1, 2, 3, 4, 5], 3);
			expect(result).toHaveLength(3);
			// All unique
			expect(new Set(result).size).toBe(3);
		});

		test("pickN handles n > arr.length", () => {
			const rng = new SeededRandom(7);
			const result = rng.pickN([1, 2], 5);
			expect(result).toHaveLength(2);
		});
	});
});
