import "./setup.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-spells.js";

const CharacterSheetSpells = globalThis.CharacterSheetSpells;

describe("Add Spell virtual result model", () => {
	test("keeps every spell in logical order beyond the former 100-row boundary", () => {
		const spells = Array.from({length: 156}, (_, index) => ({
			name: `Spell ${String(index).padStart(3, "0")}`,
			source: "TST",
			level: index < 60 ? 0 : index < 120 ? 1 : 4,
		}));

		const descriptors = CharacterSheetSpells._getSpellPickerVirtualDescriptors(spells);
		const spellDescriptors = descriptors.filter(it => it.type === "spell");

		expect(spellDescriptors).toHaveLength(156);
		expect(spellDescriptors[0].spell).toBe(spells[0]);
		expect(spellDescriptors[100].spell).toBe(spells[100]);
		expect(spellDescriptors.at(-1).spell).toBe(spells.at(-1));
	});

	test("emits one ordered header per level with the full per-level count", () => {
		const spells = [
			{name: "Cantrip B", source: "TST", level: 0},
			{name: "Cantrip A", source: "TST", level: 0},
			{name: "First", source: "TST", level: 1},
			{name: "Fourth B", source: "TST", level: 4},
			{name: "Fourth A", source: "TST", level: 4},
		];

		const descriptors = CharacterSheetSpells._getSpellPickerVirtualDescriptors(spells);
		expect(descriptors.filter(it => it.type === "header")).toEqual([
			{type: "header", key: "header:0:2", level: 0, count: 2},
			{type: "header", key: "header:1:1", level: 1, count: 1},
			{type: "header", key: "header:4:2", level: 4, count: 2},
		]);
		expect(descriptors.filter(it => it.type === "spell").map(it => it.spell.name)).toEqual([
			"Cantrip B",
			"Cantrip A",
			"First",
			"Fourth B",
			"Fourth A",
		]);
	});
});
