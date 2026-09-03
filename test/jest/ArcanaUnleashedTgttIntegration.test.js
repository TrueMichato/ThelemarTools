import fs from "fs";
import path from "path";
import "../../js/parser.js";
import "../../js/tgtt-filter.js";

const getSortKey = it => `${it.className}|${it.name}`;

describe("Arcana Unleashed TGTT integration", () => {
	it("classifies AU as an official common-rarity source", () => {
		expect(TgttFilter.OFFICIAL_SOURCES.has("AU")).toBe(true);
		expect(TgttFilter.computeSpellMetadata({name: "Test Spell", source: "AU"})).toEqual({
			rarity: "common",
			legality: "legal",
		});
	});

	it("shallow-copies every AU subclass onto the TGTT 2024 classes", () => {
		const canonical = fs.readdirSync("data/class")
			.filter(file => /^class-.*\.json$/.test(file))
			.flatMap(file => JSON.parse(fs.readFileSync(path.join("data/class", file), "utf8")).subclass || [])
			.filter(sc => sc.source === "AU")
			.map(sc => ({
				name: sc.name,
				shortName: sc.shortName,
				className: sc.className,
				classSource: sc.classSource,
			}))
			.sort((a, b) => getSortKey(a).localeCompare(getSortKey(b)));

		expect(canonical.map(({className, name}) => `${className}|${name}`)).toEqual([
			"Cleric|Arcana Domain",
			"Fighter|Arcane Archer",
			"Monk|Warrior of the Mystic Arts",
			"Warlock|Vestige Patron",
			"Wizard|Conjurer",
			"Wizard|Enchanter",
			"Wizard|Necromancer",
			"Wizard|Transmuter",
		]);

		const brew = JSON.parse(fs.readFileSync("homebrew/TravelersGuidetoThelemar.json", "utf8"));
		const copies = brew.subclass
			.filter(sc => sc.source === "TGTT-2024" && sc._copy?.source === "AU")
			.map(sc => {
				expect(Object.keys(sc).sort()).toEqual(["_copy", "className", "classSource", "source"]);
				expect(Object.keys(sc._copy).sort()).toEqual(["className", "classSource", "name", "shortName", "source"]);

				return {
					name: sc._copy.name,
					shortName: sc._copy.shortName,
					className: sc.className,
					classSource: sc._copy.classSource,
					targetClassSource: sc.classSource,
				};
			})
			.sort((a, b) => getSortKey(a).localeCompare(getSortKey(b)));

		expect(copies).toEqual(canonical.map(sc => ({
			...sc,
			targetClassSource: "TGTT",
		})));
	});
});
