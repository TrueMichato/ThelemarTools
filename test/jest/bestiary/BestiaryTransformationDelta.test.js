import "../../../js/parser.js";
import "../../../js/utils.js";
import {formatCreatureTransformationDeltaField, formatCreatureTransformationDeltaEntry} from "../../../js/bestiary/bestiary-transformation-editor.js";

describe("compact creature transformation delta", () => {
	it("names abilities, size, type, and defenses with exact before/after values", () => {
		expect(formatCreatureTransformationDeltaField({path: "cha", before: 8, after: 4})).toBe("Charisma: 8 → 4");
		expect(formatCreatureTransformationDeltaField({path: "type", before: "humanoid", after: "undead"})).toBe("Creature type: Humanoid → Undead");
		expect(formatCreatureTransformationDeltaField({path: "type", before: {type: "humanoid", tags: ["goblinoid"]}, after: "undead"}))
			.toBe("Creature type: Humanoid (Goblinoid) → Undead");
		expect(formatCreatureTransformationDeltaField({path: "size", before: ["S"], after: ["M"]})).toBe("Size: Small → Medium");
		expect(formatCreatureTransformationDeltaField({path: "conditionImmune", before: null, after: ["exhaustion", "poisoned"]}))
			.toBe("Condition immunities: none → exhaustion, poisoned");
		expect(formatCreatureTransformationDeltaField({path: "resist", before: ["cold"], after: ["cold", "fire"]}))
			.toBe("Damage resistances: cold → cold, fire");
	});

	it("labels movement, languages, senses, and conditional defenses without losing details", () => {
		expect(formatCreatureTransformationDeltaField({path: "speed.fly", before: null, after: 60}))
			.toBe("Fly speed: none → 60 ft.");
		expect(formatCreatureTransformationDeltaField({path: "speed", before: 30, after: {walk: 30, fly: 60}}))
			.toBe("Speed: 30 ft. → walk 30 ft., fly 60 ft.");
		expect(formatCreatureTransformationDeltaField({path: "languages", before: null, after: ["Common", "Draconic"]}))
			.toBe("Languages: none → Common, Draconic");
		expect(formatCreatureTransformationDeltaField({path: "senses", before: null, after: ["darkvision 60 ft."]}))
			.toBe("Senses: none → darkvision 60 ft.");
		expect(formatCreatureTransformationDeltaField({
			path: "resist",
			before: null,
			after: [{resist: ["slashing"], note: "from nonmagical attacks"}],
		})).toBe("Damage resistances: none → slashing (from nonmagical attacks)");
	});

	it("labels effective-walk flight and retained alternate flight without claiming unconditional movement", () => {
		const conditional = {number: 30, condition: "while not wearing medium or heavy armor"};
		expect(formatCreatureTransformationDeltaField({path: "speed.fly", before: null, after: conditional}))
			.toBe("Fly speed: none → 30 ft. while not wearing medium or heavy armor");
		expect(formatCreatureTransformationDeltaField({path: "speed.alternate.fly", before: null, after: [conditional]}))
			.toBe("Fly speed (alternate): none → 30 ft. while not wearing medium or heavy armor");
		expect(formatCreatureTransformationDeltaField({
			path: "speed",
			before: {walk: 30, fly: 20},
			after: {walk: 30, fly: 20, alternate: {fly: [conditional]}},
		})).toBe("Speed: walk 30 ft., fly 20 ft. → walk 30 ft., fly 20 ft., alternate fly 30 ft. while not wearing medium or heavy armor");
	});

	it("keeps unrecognized fields identifiable and their values intact", () => {
		expect(formatCreatureTransformationDeltaField({path: "customFlag", before: "old", after: {source: "HBR"}}))
			.toBe("Other field (customFlag): \"old\" → {\"source\":\"HBR\"}");
	});

	it("shows exact HP formula, AC alternatives, signed proficiency fields and independent CR/XP values", () => {
		const field = (path, before, after) => formatCreatureTransformationDeltaField({path, before, after});
		expect(field("hp", {average: 27, formula: "5d8 + 5"}, {average: 32, formula: "5d8 + 10"})).toBe("Hit points: 27 (5d8 + 5) → 32 (5d8 + 10)");
		expect(field("ac", [12, {ac: 16, from: ["shield"]}], [12, {ac: 17, from: ["shield"]}])).toContain("[12,{\"ac\":17,\"from\":[\"shield\"]}]");
		expect(field("save.dex", "+4", "+5")).toBe("Dexterity save: +4 → +5");
		expect(field("skill.stealth", 6, 7)).toBe("stealth skill: +6 → +7");
		expect(field("passive", 10, 11)).toBe("Passive Perception: 10 → 11");
		expect(field("profBonus", null, 2)).toBe("Proficiency bonus: none → +2");
		expect(field("pbNote", null, "+2")).toBe("Proficiency display: none → +2");
		expect(field("cr", "1", {cr: "2", xp: 450})).toBe("Challenge rating: 1 → 2 (450 XP)");
	});

	it("keeps exact sourced entry and spellcasting-header changes, not undefined entries-only summaries", () => {
		const before = {name: "Innate Spellcasting", source: "MM", headerEntries: ["DC {@dc 11}, {@hit 3} to hit"], will: ["{@spell dancing lights}"]};
		const after = {...before, headerEntries: ["DC {@dc 8}, {@hit 0} to hit"]};
		const text = formatCreatureTransformationDeltaEntry({section: "spellcasting", name: before.name, source: "MM", before, after});
		expect(text).toContain("Changed Innate Spellcasting (MM)");
		expect(text).toContain("DC {@dc 11}");
		expect(text).toContain("DC {@dc 8}");
		expect(text).toContain("\"will\":[\"{@spell dancing lights}\"]");
		expect(text).not.toContain("undefined");
		expect(formatCreatureTransformationDeltaEntry({section: "action", name: "Morningstar", chassisSource: "MM", before: {entries: ["{@hit 4}"]}, after: {entries: ["{@hit 5}"]}}))
			.toContain("Morningstar (MM)");
	});
});
