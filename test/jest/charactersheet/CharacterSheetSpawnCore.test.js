/**
 * Spawner core — spec parsing, seeded RNG, name resolution, report pinning.
 *
 * These are the DOM-free pieces of the spawner; the Builder/QuickBuild driver
 * is covered by the Playwright spec (`test/e2e/specs/spawn.spec.ts`).
 */

import "./setup.js";

let CharacterSheetSpawnRng;
let CharacterSheetSpawnSpec;
let CharacterSheetSpawnResolve;
let CharacterSheetSpawnReport;

beforeAll(async () => {
	const mod = await import("../../../js/charactersheet/charactersheet-spawn.js");
	CharacterSheetSpawnRng = mod.CharacterSheetSpawnRng;
	CharacterSheetSpawnSpec = mod.CharacterSheetSpawnSpec;
	CharacterSheetSpawnResolve = mod.CharacterSheetSpawnResolve;
	CharacterSheetSpawnReport = mod.CharacterSheetSpawnReport;
});

describe("CharacterSheetSpawnSpec — short DSL", () => {
	it("parses class only as level 1", () => {
		const spec = CharacterSheetSpawnSpec.parse("cleric");
		expect(spec.classes).toEqual([{name: "cleric", source: null, subclass: null, subclassSource: null, level: 1}]);
		expect(spec.race).toBeNull();
	});

	it("parses class/level when the second segment is numeric", () => {
		const spec = CharacterSheetSpawnSpec.parse("fighter/9");
		expect(spec.classes[0].level).toBe(9);
		expect(spec.classes[0].subclass).toBeNull();
	});

	it("parses class/subclass/level/race", () => {
		const spec = CharacterSheetSpawnSpec.parse("cleric/tempest/9/dwarf");
		expect(spec.classes[0]).toMatchObject({name: "cleric", subclass: "tempest", level: 9});
		expect(spec.race).toBe("dwarf");
	});

	it("parses class/level/race", () => {
		const spec = CharacterSheetSpawnSpec.parse("barbarian/2/goliath");
		expect(spec.classes[0]).toMatchObject({name: "barbarian", subclass: null, level: 2});
		expect(spec.race).toBe("goliath");
	});

	it("parses multiclass legs joined by +", () => {
		const spec = CharacterSheetSpawnSpec.parse("fighter/champion/5+warlock/fiend/3");
		expect(spec.classes).toHaveLength(2);
		expect(spec.classes[0]).toMatchObject({name: "fighter", subclass: "champion", level: 5});
		expect(spec.classes[1]).toMatchObject({name: "warlock", subclass: "fiend", level: 3});
	});

	it("parses explicit sources in brackets", () => {
		const spec = CharacterSheetSpawnSpec.parse("cleric[TGTT]/tempest[TGTT-2014]/9");
		expect(spec.classes[0].source).toBe("TGTT");
		expect(spec.classes[0].subclassSource).toBe("TGTT-2014");
	});

	it("rejects a race segment inside a multiclass leg", () => {
		expect(() => CharacterSheetSpawnSpec.parse("fighter/champion/5/human+warlock/fiend/3")).toThrow(/use &race=/);
	});

	it("rejects a total level above 20", () => {
		expect(() => CharacterSheetSpawnSpec.parse("fighter/18+warlock/5")).toThrow(/exceeds 20/);
	});

	it("rejects an empty spec", () => {
		expect(() => CharacterSheetSpawnSpec.parse("")).toThrow();
	});
});

describe("CharacterSheetSpawnSpec — object form", () => {
	it("normalizes single-class shorthand", () => {
		const spec = CharacterSheetSpawnSpec.normalize({class: "Wizard", subclass: "Bladesinging", level: 11, race: "Tabaxi"});
		expect(spec.classes[0]).toMatchObject({name: "Wizard", subclass: "Bladesinging", level: 11});
		expect(spec.race).toBe("Tabaxi");
	});

	it("accepts string entries inside classes[]", () => {
		const spec = CharacterSheetSpawnSpec.normalize({classes: ["fighter/champion/5", "warlock/fiend/3"]});
		expect(spec.classes.map(c => c.name)).toEqual(["fighter", "warlock"]);
	});

	it("hoists top-level choice shorthands into choices", () => {
		const spec = CharacterSheetSpawnSpec.normalize({class: "Fighter", level: 4, weaponMasteries: ["Longsword"]});
		expect(spec.choices.weaponMasteries).toEqual(["Longsword"]);
	});

	it("accepts a single feat as a string", () => {
		const spec = CharacterSheetSpawnSpec.normalize({class: "Fighter", level: 4, feat: "War Caster"});
		expect(spec.feats).toEqual(["War Caster"]);
	});

	it("parses a JSON string", () => {
		const spec = CharacterSheetSpawnSpec.parse(JSON.stringify({class: "Rogue", level: 3}));
		expect(spec.classes[0]).toMatchObject({name: "Rogue", level: 3});
	});

	it("throws on a class-less spec", () => {
		expect(() => CharacterSheetSpawnSpec.normalize({race: "Elf"})).toThrow(/at least one class/);
	});
});

describe("CharacterSheetSpawnSpec — round-tripping", () => {
	it("renders back to the short DSL", () => {
		const spec = CharacterSheetSpawnSpec.parse("cleric/tempest/9/dwarf");
		expect(CharacterSheetSpawnSpec.toShortString(spec)).toBe("cleric/tempest/9/dwarf");
	});

	it("uses the compact spawn= param for simple specs", () => {
		const spec = CharacterSheetSpawnSpec.parse("cleric/tempest/9/dwarf");
		const qs = CharacterSheetSpawnSpec.toQueryString(spec);
		expect(qs).toContain("spawn=");
		expect(qs).not.toContain("spawnJson");
	});

	it("uses spawnJson for specs carrying overrides", () => {
		const spec = CharacterSheetSpawnSpec.normalize({class: "Fighter", level: 4, feats: ["War Caster"]});
		expect(CharacterSheetSpawnSpec.toQueryString(spec)).toContain("spawnJson=");
	});

	it("passes race as its own param for multiclass specs", () => {
		const spec = CharacterSheetSpawnSpec.normalize({classes: ["fighter/5", "warlock/3"], race: "Human"});
		const qs = CharacterSheetSpawnSpec.toQueryString(spec);
		expect(qs).toContain("race=Human");
	});

	it("derives a seed key that ignores name and seed", () => {
		const a = CharacterSheetSpawnSpec.normalize({class: "Cleric", level: 5, name: "Bob", seed: "x"});
		const b = CharacterSheetSpawnSpec.normalize({class: "Cleric", level: 5, name: "Alice", seed: "y"});
		expect(CharacterSheetSpawnSpec.toSeedKey(a)).toBe(CharacterSheetSpawnSpec.toSeedKey(b));
	});
});

describe("CharacterSheetSpawnRng", () => {
	it("is deterministic for a given seed", () => {
		const a = new CharacterSheetSpawnRng("seed-1");
		const b = new CharacterSheetSpawnRng("seed-1");
		const seqA = Array.from({length: 10}, () => a.next());
		const seqB = Array.from({length: 10}, () => b.next());
		expect(seqA).toEqual(seqB);
	});

	it("differs across seeds", () => {
		const a = new CharacterSheetSpawnRng("seed-1");
		const b = new CharacterSheetSpawnRng("seed-2");
		expect(a.next()).not.toBe(b.next());
	});

	it("stays within range", () => {
		const rng = new CharacterSheetSpawnRng("range");
		for (let i = 0; i < 200; ++i) {
			const v = rng.nextInt(7);
			expect(v).toBeGreaterThanOrEqual(0);
			expect(v).toBeLessThan(7);
		}
	});

	it("pickN returns distinct elements in input order", () => {
		const rng = new CharacterSheetSpawnRng("pickn");
		const src = ["a", "b", "c", "d", "e"];
		const got = rng.pickN(src, 3);
		expect(got).toHaveLength(3);
		expect(new Set(got).size).toBe(3);
		expect(got).toEqual([...got].sort((x, y) => src.indexOf(x) - src.indexOf(y)));
	});

	it("pickN clamps to the source length", () => {
		const rng = new CharacterSheetSpawnRng("clamp");
		expect(rng.pickN(["a", "b"], 5)).toEqual(["a", "b"]);
	});

	it("handles empty inputs", () => {
		const rng = new CharacterSheetSpawnRng("empty");
		expect(rng.pick([])).toBeNull();
		expect(rng.pickN([], 3)).toEqual([]);
	});
});

describe("CharacterSheetSpawnResolve", () => {
	const SUBCLASSES = [
		{name: "Tempest Domain", shortName: "Tempest", source: "PHB"},
		{name: "Life Domain", shortName: "Life", source: "PHB"},
		{name: "Tempest Domain", shortName: "Tempest", source: "TGTT-2014"},
		{name: "Circle of the Stars", shortName: "Stars", source: "TCE"},
	];

	it("matches on an exact name", () => {
		expect(CharacterSheetSpawnResolve.findByName(SUBCLASSES, "Life Domain").shortName).toBe("Life");
	});

	it("matches loosely on a bare subclass word", () => {
		expect(CharacterSheetSpawnResolve.findByName(SUBCLASSES, "tempest").shortName).toBe("Tempest");
	});

	it("honours an explicit source when disambiguating", () => {
		const hit = CharacterSheetSpawnResolve.findByName(SUBCLASSES, "tempest", {source: "TGTT-2014"});
		expect(hit.source).toBe("TGTT-2014");
	});

	it("ignores filler words like 'circle of the'", () => {
		expect(CharacterSheetSpawnResolve.findByName(SUBCLASSES, "stars").shortName).toBe("Stars");
	});

	it("searches alternate name keys", () => {
		const hit = CharacterSheetSpawnResolve.findByName(SUBCLASSES, "Stars", {nameKeys: ["shortName"]});
		expect(hit.name).toBe("Circle of the Stars");
	});

	it("returns null when nothing matches", () => {
		expect(CharacterSheetSpawnResolve.findByName(SUBCLASSES, "necromancy")).toBeNull();
	});

	it("compares names loosely", () => {
		expect(CharacterSheetSpawnResolve.namesMatch("Eldritch Knight", "eldritch-knight")).toBe(true);
		expect(CharacterSheetSpawnResolve.namesMatch("Defense", "Duelling")).toBe(false);
	});

	it("suggests near names for typos", () => {
		const suggestions = CharacterSheetSpawnResolve.suggest(SUBCLASSES, "temp");
		expect(suggestions).toContain("Tempest Domain");
	});

	describe("findRace against the flattened race catalog", () => {
		const RACES = [
			{name: "Dwarf", source: "PHB"},
			{name: "Elf (High)", source: "PHB", _baseName: "Elf", _subraceName: "High"},
			{name: "Elf (Wood)", source: "PHB", _baseName: "Elf", _subraceName: "Wood"},
		];

		it("finds a standalone race", () => {
			const rng = new CharacterSheetSpawnRng("r");
			expect(CharacterSheetSpawnResolve.findRace(RACES, "Dwarf", null, rng).race.name).toBe("Dwarf");
		});

		it("finds a subrace via the combined name", () => {
			const rng = new CharacterSheetSpawnRng("r");
			expect(CharacterSheetSpawnResolve.findRace(RACES, "Elf", "Wood", rng).race.name).toBe("Elf (Wood)");
		});

		it("picks a subrace deterministically when only the base race is named", () => {
			const first = CharacterSheetSpawnResolve.findRace(RACES, "Elf", null, new CharacterSheetSpawnRng("same")).race.name;
			const second = CharacterSheetSpawnResolve.findRace(RACES, "Elf", null, new CharacterSheetSpawnRng("same")).race.name;
			expect(first).toBe(second);
			expect(["Elf (High)", "Elf (Wood)"]).toContain(first);
		});
	});
});

describe("CharacterSheetSpawnReport", () => {
	/** @returns {*} */
	function makeReport () {
		const spec = CharacterSheetSpawnSpec.parse("cleric/9/dwarf");
		spec.seed = "abc";
		const report = new CharacterSheetSpawnReport(spec);
		report.record({level: 1, kind: "skill", chosen: "Insight", from: "auto", options: ["Insight", "Medicine"]});
		report.record({level: 1, kind: "subclass", key: "Cleric", chosen: {name: "Tempest Domain"}, from: "auto"});
		report.record({level: 4, kind: "feat", chosen: "War Caster", from: "spec"});
		report.record({level: 4, kind: "optionalFeature", key: "EI", chosen: {name: "Agonizing Blast"}, from: "auto"});
		return report;
	}

	it("is clean when nothing was left unresolved", () => {
		expect(makeReport().isClean).toBe(true);
	});

	it("is dirty once a choice is unresolved", () => {
		const report = makeReport();
		report.markUnresolved("no eligible feats at level 4");
		expect(report.isClean).toBe(false);
	});

	it("is dirty once an unhandled prompt appears", () => {
		const report = makeReport();
		report.markUnhandledPrompt("Choose a Cantrip");
		expect(report.isClean).toBe(false);
	});

	it("de-duplicates warnings", () => {
		const report = makeReport();
		report.warn("same");
		report.warn("same");
		expect(report.warnings).toEqual(["same"]);
	});

	it("pins auto-picked choices back into an explicit spec", () => {
		const pinned = makeReport().toPinnedSpec();
		expect(pinned.classes[0].subclass).toBe("Tempest Domain");
		expect(pinned.feats).toEqual(["War Caster"]);
		expect(pinned.choices.skills).toEqual(["Insight"]);
		expect(pinned.choices.optionalFeatures.EI).toEqual(["Agonizing Blast"]);
		expect(pinned.seed).toBe("abc");
	});

	it("renders a readable text summary", () => {
		const text = makeReport().toText();
		expect(text).toContain("cleric");
		expect(text).toContain("War Caster");
	});

	it("serialises to JSON with the pinned spec attached", () => {
		const json = makeReport().finish().toJson();
		expect(json.isClean).toBe(true);
		expect(json.pinnedSpec.feats).toEqual(["War Caster"]);
		expect(json.choices.length).toBe(4);
	});
});
