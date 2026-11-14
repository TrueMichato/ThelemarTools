import "./setup.js";
import {jest} from "@jest/globals";
import "../../../js/tgtt-filter.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-spells.js";

const {CharacterSheetSpells, TgttFilter} = globalThis;

const applyRarity = (spells, enabled = true) => CharacterSheetSpells.prototype.applyThelemarSpellRarity.call({
	_state: {getSettings: () => ({thelemar_spellRarity: enabled})},
}, spells);

describe("Character Sheet spell rarity uses the site's spell metadata", () => {
	afterEach(() => jest.restoreAllMocks());

	it.each([
		["BoET", "rare"],
		["HWCS", "common"],
		["VSS:PP", "uncommon"],
		["GH:PG'24", "rare"],
		["PHB", "common"],
		["TGTT", "common"],
		["UnlistedHomebrew", "uncommon"],
	])("uses the shared source rule for %s", (source, rarity) => {
		const spell = {name: "Test Spell", source};
		const metadata = TgttFilter.computeSpellMetadata(spell);
		expect(metadata.rarity).toBe(rarity);
		expect(applyRarity([spell])[0].subschools).toEqual(expect.arrayContaining([
			`rarity:${rarity}`,
			`legality:${metadata.legality}`,
		]));
		expect(spell.subschools).toBeUndefined();
	});

	it("resolves a book's full source ID through its displayed abbreviation", () => {
		const original = Parser.sourceJsonToAbv;
		jest.spyOn(Parser, "sourceJsonToAbv").mockImplementation(source =>
			source === "BookOfEbonTides" ? "BoET" : original(source));
		const spell = {name: "Bitter Wind", source: "BookOfEbonTides"};
		expect(applyRarity([spell])[0].subschools).toContain("rarity:rare");
		expect(applyRarity([spell])[0].subschools).not.toContain("rarity:common");
	});

	it("honors explicit metadata over normalized subschool tags and source defaults", () => {
		const spell = {
			name: "Explicit Spell",
			source: "BoET",
			subschools: ["Chronomancy", "(Rarity: Common)", "Legality: Illegal-II"],
			tgttRarity: "RARE",
			tgttLegality: "ILLEGAL-IV",
		};
		const result = applyRarity([spell]);
		expect(result[0].subschools).toEqual(["Chronomancy", "rarity:rare", "legality:illegal-iv"]);
		expect(applyRarity(result)).toEqual(result);
		expect(spell.subschools).toEqual(["Chronomancy", "(Rarity: Common)", "Legality: Illegal-II"]);
	});

	it("preserves explicit spell tags when the source dictionary differs", () => {
		const spell = {name: "Exception", source: "BoET", subschools: ["rarity:common", "legality:illegal-I"]};
		expect(applyRarity([spell])[0].subschools).toEqual(["rarity:common", "legality:illegal-i"]);
	});

	it("leaves the catalog untouched when the sheet's rarity setting is disabled", () => {
		const spells = [{name: "Bitter Wind", source: "BoET"}];
		expect(applyRarity(spells, false)).toBe(spells);
		expect(spells[0].subschools).toBeUndefined();
	});
});
