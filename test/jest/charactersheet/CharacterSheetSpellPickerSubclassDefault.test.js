/**
 * Phase 9 — Bug 7.1 follow-up regression test.
 *
 * Drives the production default-filter helper used by every Add Spell modal
 * open. This pins the primitive-vs-object subclass key fix and the Gambler's
 * Rogue → Warlock spell-list substitution across repeated modal opens.
 */

import "./setup.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-spells.js";

const CharacterSheetSpells = globalThis.CharacterSheetSpells;

describe("Phase 9: spell picker default subclass selection (Bug 7.1)", () => {
	function makeSpells (classes, {isGambler = () => false} = {}) {
		const spells = Object.create(CharacterSheetSpells.prototype);
		spells._state = {
			getClasses: () => classes,
			_isGamblerClassEntry: isGambler,
		};
		return spells;
	}

	test("Divine Soul Sorcerer derives 'Sorcerer: Divine Soul' (not '[object Object]')", () => {
		const classes = [
			{
				name: "Sorcerer",
				source: "TGTT",
				level: 5,
				subclass: {name: "Divine Soul", source: "XGE", shortName: "Divine Soul"},
			},
		];

		const {characterSubclassNames} = makeSpells(classes)._getPickerCharacterFilterDefaults();

		expect(characterSubclassNames).toEqual(["Sorcerer: Divine Soul"]);
		expect(characterSubclassNames[0]).not.toContain("[object Object]");
	});

	test("Chronurgy Wizard derives 'Wizard: Chronurgy Magic' correctly", () => {
		const classes = [
			{
				name: "Wizard",
				source: "TGTT",
				level: 3,
				subclass: {name: "Chronurgy Magic", source: "EGW", shortName: "Chronurgy"},
			},
		];

		expect(makeSpells(classes)._getPickerCharacterFilterDefaults().characterSubclassNames).toEqual(["Wizard: Chronurgy Magic"]);
	});

	test("Character with no subclass yields empty list (gracefully)", () => {
		const classes = [{name: "Sorcerer", source: "TGTT", level: 1, subclass: null}];
		expect(makeSpells(classes)._getPickerCharacterFilterDefaults().characterSubclassNames).toEqual([]);
	});

	test("Multiclass character lists each class's subclass", () => {
		const classes = [
			{name: "Sorcerer", source: "TGTT", level: 3, subclass: {name: "Divine Soul", source: "XGE"}},
			{name: "Wizard", source: "TGTT", level: 2, subclass: {name: "Chronurgy Magic", source: "EGW"}},
		];

		expect(makeSpells(classes)._getPickerCharacterFilterDefaults().characterSubclassNames).toEqual([
			"Sorcerer: Divine Soul",
			"Wizard: Chronurgy Magic",
		]);
	});

	test("Legacy string-shaped subclass (back-compat) still resolves to a useful key", () => {
		// Some very-old saves may have stored subclass as a string. The helper
		// must not crash and should still produce a parseable key.
		const classes = [{name: "Sorcerer", source: "TGTT", level: 1, subclass: "Divine Soul"}];
		expect(makeSpells(classes)._getPickerCharacterFilterDefaults().characterSubclassNames).toEqual(["Sorcerer: Divine Soul"]);
	});

	test("Gambler defaults to the Warlock class list and a readable Rogue subclass key on every open", () => {
		const gambler = {
			name: "Rogue",
			source: "TGTT",
			level: 5,
			subclass: {name: "Gambler", shortName: "Gambler", source: "TGTT"},
		};
		const spells = makeSpells([gambler], {isGambler: cls => cls === gambler});

		const firstOpen = spells._getPickerCharacterFilterDefaults();
		expect(firstOpen.characterClassNames).toEqual(["Warlock"]);
		expect(firstOpen.characterSubclassNames).toEqual(["Rogue: Gambler"]);

		// Modal filter state is per-open. Mutating one returned snapshot must not
		// leak a stale/default selection into a later open.
		firstOpen.characterClassNames.push("Wizard");
		firstOpen.characterSubclassNames[0] = "[object Object]";

		const secondOpen = spells._getPickerCharacterFilterDefaults();
		expect(secondOpen.characterClassNames).toEqual(["Warlock"]);
		expect(secondOpen.characterSubclassNames).toEqual(["Rogue: Gambler"]);
	});
});
