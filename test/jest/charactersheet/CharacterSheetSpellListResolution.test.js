import "./setup.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";

const CharacterSheetClassUtils = globalThis.CharacterSheetClassUtils;

const spell = ({name, source = "PHB", classes = {}}) => ({name, source, classes});

const tgttChronurgySubclass = {
	name: "Chronurgy Magic",
	shortName: "Chronurgy",
	additionalSpells: [
		{
			expanded: {
				1: ["gift of alacrity|egw"],
			},
		},
	],
};

const divineSoulSubclass = {
	name: "Divine Soul",
	shortName: "Divine Soul",
	additionalSpells: [
		{
			name: "Good",
			known: {
				1: ["cure wounds|phb"],
			},
			expanded: {
				1: ["bless|phb", "guiding bolt|phb"],
			},
		},
		{
			name: "Evil",
			known: {
				1: ["inflict wounds|phb"],
			},
		},
	],
};

const lifeDomainSubclass = {
	name: "Life Domain",
	shortName: "Life",
	additionalSpells: [
		{
			prepared: {
				1: ["bless|phb", "cure wounds|phb"],
				3: ["lesser restoration|phb", "spiritual weapon|phb"],
			},
		},
	],
};

const fiendSubclass = {
	name: "The Fiend",
	shortName: "Fiend",
	additionalSpells: [
		{
			expanded: {
				1: ["burning hands|phb", "command|phb"],
			},
		},
	],
};

describe("CharacterSheetClassUtils.spellIsAvailableForClass", () => {
	it("includes subclass additional spells for TGTT Chronurgy wizards", () => {
		const giftOfAlacrity = spell({name: "Gift of Alacrity", source: "EGW"});

		expect(CharacterSheetClassUtils.spellIsAvailableForClass(giftOfAlacrity, {
			className: "Wizard",
			classSource: "TGTT",
			subclass: tgttChronurgySubclass,
		})).toBe(true);
	});

	it("includes cleric-list access for Divine Soul sorcerers with an affinity choice", () => {
		const bless = spell({name: "Bless", source: "PHB", classes: {fromClassList: [{name: "Cleric"}]}});

		expect(CharacterSheetClassUtils.spellIsAvailableForClass(bless, {
			className: "Sorcerer",
			subclass: divineSoulSubclass,
			subclassChoice: {name: "Good"},
			additionalClassNames: CharacterSheetClassUtils.getAdditionalSpellListClasses({
				className: "Sorcerer",
				subclass: divineSoulSubclass,
				subclassChoice: {name: "Good"},
			}),
		})).toBe(true);
	});

	it("includes Divine Soul bonus known spells from the chosen affinity only", () => {
		const cureWounds = spell({name: "Cure Wounds", source: "PHB"});
		const inflictWounds = spell({name: "Inflict Wounds", source: "PHB"});

		expect(CharacterSheetClassUtils.spellIsAvailableForClass(cureWounds, {
			className: "Sorcerer",
			subclass: divineSoulSubclass,
			subclassChoice: {name: "Good"},
		})).toBe(true);
		expect(CharacterSheetClassUtils.spellIsAvailableForClass(inflictWounds, {
			className: "Sorcerer",
			subclass: divineSoulSubclass,
			subclassChoice: {name: "Good"},
		})).toBe(false);
	});

	it("includes cleric domain prepared spells", () => {
		const spiritualWeapon = spell({name: "Spiritual Weapon", source: "PHB"});

		expect(CharacterSheetClassUtils.spellIsAvailableForClass(spiritualWeapon, {
			className: "Cleric",
			subclass: lifeDomainSubclass,
		})).toBe(true);
	});

	it("includes warlock patron expanded spells", () => {
		const burningHands = spell({name: "Burning Hands", source: "PHB"});

		expect(CharacterSheetClassUtils.spellIsAvailableForClass(burningHands, {
			className: "Warlock",
			subclass: fiendSubclass,
		})).toBe(true);
	});

	it("still respects base class spell metadata", () => {
		const magicMissile = spell({
			name: "Magic Missile",
			source: "PHB",
			classes: {fromClassList: [{name: "Wizard"}]},
		});

		expect(CharacterSheetClassUtils.spellIsAvailableForClass(magicMissile, {
			className: "Wizard",
		})).toBe(true);
	});
});
