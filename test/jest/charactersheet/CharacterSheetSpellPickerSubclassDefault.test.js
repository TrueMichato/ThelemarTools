/**
 * Phase 9 — Bug 7.1 follow-up regression test.
 *
 * Verifies that when the playmode "Add Spell" modal builds its default
 * subclass filter selection, the character's subclass NAME (not its
 * stringified object) is used as the key, so the player's actual subclass
 * is auto-checked and subclass-only spells (Guidance via Divine Soul,
 * Gift of Alacrity via Chronurgy, etc.) are visible by default.
 *
 * Mirrors the `characterSubclassNames` derivation from
 * `js/charactersheet/charactersheet-spells.js::_pShowSpellPickerModal`.
 */

describe("Phase 9: spell picker default subclass selection (Bug 7.1)", () => {
	function deriveCharacterSubclassNames (characterClasses) {
		return characterClasses
			.filter(c => c.subclass && (c.subclass.name || typeof c.subclass === "string"))
			.map(c => `${c.name}: ${typeof c.subclass === "string" ? c.subclass : c.subclass.name}`);
	}

	function buildKey (className, subclassName) {
		return `${className}: ${subclassName}`;
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

		const characterSubclassNames = deriveCharacterSubclassNames(classes);

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

		expect(deriveCharacterSubclassNames(classes)).toEqual(["Wizard: Chronurgy Magic"]);
	});

	test("Derived key matches the picker's per-spell subclass key format", () => {
		const classes = [
			{name: "Sorcerer", source: "TGTT", level: 1, subclass: {name: "Divine Soul", source: "XGE"}},
		];

		const characterSubclassNames = deriveCharacterSubclassNames(classes);

		// This is the key format the picker builds from spell.classes.fromSubclass entries.
		const spellSideKey = buildKey("Sorcerer", "Divine Soul");

		expect(characterSubclassNames).toContain(spellSideKey);
	});

	test("Character with no subclass yields empty list (gracefully)", () => {
		const classes = [{name: "Sorcerer", source: "TGTT", level: 1, subclass: null}];
		expect(deriveCharacterSubclassNames(classes)).toEqual([]);
	});

	test("Multiclass character lists each class's subclass", () => {
		const classes = [
			{name: "Sorcerer", source: "TGTT", level: 3, subclass: {name: "Divine Soul", source: "XGE"}},
			{name: "Wizard", source: "TGTT", level: 2, subclass: {name: "Chronurgy Magic", source: "EGW"}},
		];

		expect(deriveCharacterSubclassNames(classes)).toEqual([
			"Sorcerer: Divine Soul",
			"Wizard: Chronurgy Magic",
		]);
	});

	test("Legacy string-shaped subclass (back-compat) still resolves to a useful key", () => {
		// Some very-old saves may have stored subclass as a string. The helper
		// must not crash and should still produce a parseable key.
		const classes = [{name: "Sorcerer", source: "TGTT", level: 1, subclass: "Divine Soul"}];
		expect(deriveCharacterSubclassNames(classes)).toEqual(["Sorcerer: Divine Soul"]);
	});
});
