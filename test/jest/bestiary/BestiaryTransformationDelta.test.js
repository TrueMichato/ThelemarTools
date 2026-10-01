import "../../../js/parser.js";
import "../../../js/utils.js";
import {formatCreatureTransformationDeltaField} from "../../../js/bestiary/bestiary-transformation-editor.js";

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

	it("keeps unrecognized fields identifiable and their values intact", () => {
		expect(formatCreatureTransformationDeltaField({path: "customFlag", before: "old", after: {source: "HBR"}}))
			.toBe("Other field (customFlag): \"old\" → {\"source\":\"HBR\"}");
	});
});
