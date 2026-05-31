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

// Bug 5: Real Chronurgy data uses filter-query shorthand ({"all": "source=EGW"}),
// not literal name lists. Treat this as the canonical case.
const tgttChronurgySubclassFilterQuery = {
	name: "Chronurgy Magic",
	shortName: "Chronurgy",
	additionalSpells: [
		{
			expanded: {
				1: [{all: "source=EGW"}],
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

// Bug 5: Real Divine Soul data uses filter-query shorthand for the cleric-list
// expansion ({"all": "level=0|class=Cleric"}). Treat this as the canonical case.
const divineSoulSubclassFilterQuery = {
	name: "Divine Soul",
	shortName: "Divine Soul",
	additionalSpells: [
		{
			name: "Good",
			known: {
				1: ["cure wounds|phb"],
			},
			expanded: {
				0: [{all: "level=0|class=Cleric"}],
				1: [{all: "level=1|class=Cleric"}],
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

	// ----- Bug 5: filter-query shorthand in additionalSpells -----

	describe("Bug 5: filter-query shorthand in expanded lists", () => {
		it("matches Chronurgy Magic via {all: 'source=EGW'} (the real data shape)", () => {
			const giftOfAlacrity = spell({name: "Gift of Alacrity", source: "EGW"});
			expect(CharacterSheetClassUtils.spellIsAvailableForClass(giftOfAlacrity, {
				className: "Wizard",
				classSource: "TGTT",
				subclass: tgttChronurgySubclassFilterQuery,
			})).toBe(true);
		});

		it("does not falsely match a non-EGW spell through Chronurgy's source filter", () => {
			const fireball = spell({name: "Fireball", source: "PHB"});
			expect(CharacterSheetClassUtils.spellIsAvailableForClass(fireball, {
				className: "Wizard",
				classSource: "TGTT",
				subclass: tgttChronurgySubclassFilterQuery,
			})).toBe(false);
		});

		it("matches Divine Soul cleric cantrip via {all: 'level=0|class=Cleric'}", () => {
			const guidance = spell({
				name: "Guidance",
				source: "PHB",
				classes: {fromClassList: [{name: "Cleric"}]},
			});
			Object.assign(guidance, {level: 0});
			expect(CharacterSheetClassUtils.spellIsAvailableForClass(guidance, {
				className: "Sorcerer",
				subclass: divineSoulSubclassFilterQuery,
				subclassChoice: {name: "Good"},
			})).toBe(true);
		});

		it("surfaces Divine Soul cleric cantrips even without an affinity chosen (Divine Magic is unconditional)", () => {
			// Bug 5: Divine Magic grants access to the entire Cleric spell list
			// at L1 — UNCONDITIONALLY. The affinity choice only adds one
			// always-prepared 1st-level spell; it does not gate access to the
			// Cleric list itself. Previously this returned false because
			// `getAdditionalSpellListClasses` required `normalizeDivineSoulAffinity`
			// before returning `["Cleric"]`, hiding Guidance / Sacred Flame /
			// other cantrips in the picker.
			const guidance = spell({
				name: "Guidance",
				source: "PHB",
				classes: {fromClassList: [{name: "Cleric"}]},
			});
			Object.assign(guidance, {level: 0});
			expect(CharacterSheetClassUtils.spellIsAvailableForClass(guidance, {
				className: "Sorcerer",
				subclass: divineSoulSubclassFilterQuery,
				// no subclassChoice
				additionalClassNames: CharacterSheetClassUtils.getAdditionalSpellListClasses({
					className: "Sorcerer",
					subclass: divineSoulSubclassFilterQuery,
				}),
			})).toBe(true);
		});

		it("filter-query strings are not poisoned into the literal name id-set", () => {
			// Regression guard for the original bug: `_getNormalizedSpellRefIds`
			// used to add e.g. "source=egw|phb" to the id-set. Confirm the helper
			// now rejects filter-query strings entirely.
			const ids = CharacterSheetClassUtils._getNormalizedSpellRefIds("source=EGW");
			expect(ids.size).toBe(0);
			const ids2 = CharacterSheetClassUtils._getNormalizedSpellRefIds([
				"source=EGW",
				"gift of alacrity|egw",
				"level=0|class=Cleric",
			]);
			expect([...ids2]).toEqual(["gift of alacrity|egw"]);
		});
	});

	describe("Bug 5 helpers — filter query parsing", () => {
		it("_isFilterQueryString accepts canonical query shapes", () => {
			expect(CharacterSheetClassUtils._isFilterQueryString("source=EGW")).toBe(true);
			expect(CharacterSheetClassUtils._isFilterQueryString("level=0|class=Cleric")).toBe(true);
			expect(CharacterSheetClassUtils._isFilterQueryString("subclass=Life Domain")).toBe(true);
		});

		it("_isFilterQueryString rejects literal spell refs and noise", () => {
			expect(CharacterSheetClassUtils._isFilterQueryString("fireball|phb")).toBe(false);
			expect(CharacterSheetClassUtils._isFilterQueryString("fireball")).toBe(false);
			expect(CharacterSheetClassUtils._isFilterQueryString("")).toBe(false);
			expect(CharacterSheetClassUtils._isFilterQueryString(null)).toBe(false);
			// One side has `=`, one doesn't → not a valid filter query.
			expect(CharacterSheetClassUtils._isFilterQueryString("source=EGW|fireball")).toBe(false);
		});

		it("_parseFilterQuery splits AND-clauses on `|`", () => {
			expect(CharacterSheetClassUtils._parseFilterQuery("level=0|class=Cleric")).toEqual([
				{key: "level", value: "0"},
				{key: "class", value: "Cleric"},
			]);
		});

		it("_spellMatchesFilterQuery enforces all clauses", () => {
			const guidance = spell({
				name: "Guidance",
				source: "PHB",
				classes: {fromClassList: [{name: "Cleric"}]},
			});
			Object.assign(guidance, {level: 0, school: "D"});

			expect(CharacterSheetClassUtils._spellMatchesFilterQuery(guidance, [
				{key: "level", value: "0"},
				{key: "class", value: "Cleric"},
			])).toBe(true);

			expect(CharacterSheetClassUtils._spellMatchesFilterQuery(guidance, [
				{key: "level", value: "1"}, // wrong level
				{key: "class", value: "Cleric"},
			])).toBe(false);

			expect(CharacterSheetClassUtils._spellMatchesFilterQuery(guidance, [
				{key: "source", value: "PHB"},
			])).toBe(true);
		});

		it("_spellMatchesFilterQuery fails closed on unknown filter keys", () => {
			const anySpell = spell({name: "Anything", source: "PHB"});
			expect(CharacterSheetClassUtils._spellMatchesFilterQuery(anySpell, [
				{key: "color", value: "blue"},
			])).toBe(false);
		});
	});
});
