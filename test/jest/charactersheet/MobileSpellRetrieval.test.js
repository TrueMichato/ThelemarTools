import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-spells.js";

const CharacterSheetSpells = globalThis.CharacterSheetSpells;

describe("mobile spell retrieval policy", () => {
	const spells = [
		{name: "Fire Bolt", level: 0},
		{name: "Fireball", level: 3},
		{name: "Shield", level: 1},
		{name: "Wall of Fire", level: 4},
	];

	it("filters by case-insensitive name fragments", () => {
		expect(CharacterSheetSpells.filterSpellList(spells, {search: "FIRE"}).map(it => it.name))
			.toEqual(["Fire Bolt", "Fireball", "Wall of Fire"]);
	});

	it("filters by spell level, including cantrips", () => {
		expect(CharacterSheetSpells.filterSpellList(spells, {level: "0"}).map(it => it.name))
			.toEqual(["Fire Bolt"]);
		expect(CharacterSheetSpells.filterSpellList(spells, {level: "3"}).map(it => it.name))
			.toEqual(["Fireball"]);
	});

	it("combines name and level filters", () => {
		expect(CharacterSheetSpells.filterSpellList(spells, {search: "fire", level: "4"}).map(it => it.name))
			.toEqual(["Wall of Fire"]);
	});

	it("returns all usable entries after reset", () => {
		expect(CharacterSheetSpells.filterSpellList([null, ...spells], {search: "", level: "all"}))
			.toEqual(spells);
	});
});
