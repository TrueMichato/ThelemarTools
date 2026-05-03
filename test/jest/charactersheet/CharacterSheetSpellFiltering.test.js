import "./setup.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";

const CharacterSheetClassUtils = globalThis.CharacterSheetClassUtils;

// ==========================================================================
// Helper: create mock spell with class/subclass data
// ==========================================================================
function mockSpell (name, {fromClassList = [], fromSubclass = []} = {}) {
	return {
		name,
		source: "TEST",
		level: 1,
		classes: {fromClassList, fromSubclass},
	};
}

// ==========================================================================
// spellIsForClass — base class list
// ==========================================================================
describe("spellIsForClass", () => {
	describe("base class list (fromClassList)", () => {
		const fireball = mockSpell("Fireball", {
			fromClassList: [
				{name: "Wizard", source: "PHB"},
				{name: "Sorcerer", source: "PHB"},
			],
		});

		it("should match a spell on the class list", () => {
			expect(CharacterSheetClassUtils.spellIsForClass(fireball, "Wizard")).toBe(true);
		});

		it("should match another class on the list", () => {
			expect(CharacterSheetClassUtils.spellIsForClass(fireball, "Sorcerer")).toBe(true);
		});

		it("should NOT match a class not on the list", () => {
			expect(CharacterSheetClassUtils.spellIsForClass(fireball, "Cleric")).toBe(false);
		});

		it("should handle spells with no classes", () => {
			const noClassSpell = {name: "Mystery", source: "TEST", level: 1};
			expect(CharacterSheetClassUtils.spellIsForClass(noClassSpell, "Wizard")).toBe(false);
		});
	});

	// ==========================================================================
	// spellIsForClass — subclass list
	// ==========================================================================
	describe("subclass spell list (fromSubclass)", () => {
		// Gift of Alacrity is only available via subclass (Chronurgy Magic)
		const giftOfAlacrity = mockSpell("Gift of Alacrity", {
			fromClassList: [], // NOT on base wizard list
			fromSubclass: [
				{
					class: {name: "Wizard", source: "PHB"},
					subclass: {name: "Chronurgy Magic", shortName: "Chronurgy", source: "EGW"},
				},
				{
					class: {name: "Wizard", source: "PHB"},
					subclass: {name: "Graviturgy Magic", shortName: "Graviturgy", source: "EGW"},
				},
			],
		});

		it("should NOT match without subclass parameter", () => {
			expect(CharacterSheetClassUtils.spellIsForClass(giftOfAlacrity, "Wizard")).toBe(false);
		});

		it("should match when character has the correct subclass (by name)", () => {
			expect(CharacterSheetClassUtils.spellIsForClass(giftOfAlacrity, "Wizard", {
				subclass: {name: "Chronurgy Magic"},
			})).toBe(true);
		});

		it("should match by subclass shortName", () => {
			expect(CharacterSheetClassUtils.spellIsForClass(giftOfAlacrity, "Wizard", {
				subclass: {shortName: "Chronurgy"},
			})).toBe(true);
		});

		it("should match a different subclass that also grants the spell", () => {
			expect(CharacterSheetClassUtils.spellIsForClass(giftOfAlacrity, "Wizard", {
				subclass: {name: "Graviturgy Magic", shortName: "Graviturgy"},
			})).toBe(true);
		});

		it("should NOT match a subclass that does not grant the spell", () => {
			expect(CharacterSheetClassUtils.spellIsForClass(giftOfAlacrity, "Wizard", {
				subclass: {name: "Evocation", shortName: "Evocation"},
			})).toBe(false);
		});

		it("should NOT match wrong class even with matching subclass name", () => {
			expect(CharacterSheetClassUtils.spellIsForClass(giftOfAlacrity, "Cleric", {
				subclass: {name: "Chronurgy Magic"},
			})).toBe(false);
		});
	});

	// ==========================================================================
	// spellIsForClass — mixed class + subclass
	// ==========================================================================
	describe("spells on both class and subclass lists", () => {
		// A spell on base wizard list AND a subclass list
		const mixedSpell = mockSpell("Arcane Spell", {
			fromClassList: [{name: "Wizard", source: "PHB"}],
			fromSubclass: [
				{
					class: {name: "Cleric", source: "PHB"},
					subclass: {name: "Arcana Domain", shortName: "Arcana", source: "SCAG"},
				},
			],
		});

		it("should match via base class list without subclass param", () => {
			expect(CharacterSheetClassUtils.spellIsForClass(mixedSpell, "Wizard")).toBe(true);
		});

		it("should match Cleric only with Arcana Domain subclass", () => {
			expect(CharacterSheetClassUtils.spellIsForClass(mixedSpell, "Cleric", {
				subclass: {name: "Arcana Domain", shortName: "Arcana"},
			})).toBe(true);
		});

		it("should NOT match Cleric without subclass", () => {
			expect(CharacterSheetClassUtils.spellIsForClass(mixedSpell, "Cleric")).toBe(false);
		});

		it("should NOT match Cleric with wrong subclass", () => {
			expect(CharacterSheetClassUtils.spellIsForClass(mixedSpell, "Cleric", {
				subclass: {name: "Life Domain"},
			})).toBe(false);
		});
	});

	// ==========================================================================
	// spellIsForClass — variant class list (fromClassListVariant)
	// ==========================================================================
	describe("variant class list (fromClassListVariant)", () => {
		const absorbElements = {
			name: "Absorb Elements",
			source: "XGE",
			level: 1,
			classes: {
				fromClassListVariant: [
					{name: "Druid", source: "PHB", definedInSource: "XGE"},
					{name: "Ranger", source: "PHB", definedInSource: "XGE"},
					{name: "Sorcerer", source: "PHB", definedInSource: "XGE"},
					{name: "Wizard", source: "PHB", definedInSource: "XGE"},
				],
			},
		};

		it("should match Ranger via fromClassListVariant", () => {
			expect(CharacterSheetClassUtils.spellIsForClass(absorbElements, "Ranger")).toBe(true);
		});

		it("should match Druid via fromClassListVariant", () => {
			expect(CharacterSheetClassUtils.spellIsForClass(absorbElements, "Druid")).toBe(true);
		});

		it("should NOT match a class not in variant list", () => {
			expect(CharacterSheetClassUtils.spellIsForClass(absorbElements, "Cleric")).toBe(false);
		});

		it("should match when spell has both fromClassList and fromClassListVariant", () => {
			const spell = {
				name: "Ice Knife",
				source: "XGE",
				level: 1,
				classes: {
					fromClassList: [{name: "Wizard", source: "PHB"}],
					fromClassListVariant: [{name: "Sorcerer", source: "PHB", definedInSource: "XGE"}],
				},
			};
			expect(CharacterSheetClassUtils.spellIsForClass(spell, "Wizard")).toBe(true);
			expect(CharacterSheetClassUtils.spellIsForClass(spell, "Sorcerer")).toBe(true);
			expect(CharacterSheetClassUtils.spellIsForClass(spell, "Bard")).toBe(false);
		});
	});

	// ==========================================================================
	// Backward compatibility
	// ==========================================================================
	describe("backward compatibility", () => {
		const spell = mockSpell("Test Spell", {
			fromClassList: [{name: "Bard", source: "PHB"}],
		});

		it("should work with no opts parameter", () => {
			expect(CharacterSheetClassUtils.spellIsForClass(spell, "Bard")).toBe(true);
		});

		it("should work with empty opts", () => {
			expect(CharacterSheetClassUtils.spellIsForClass(spell, "Bard", {})).toBe(true);
		});

		it("should work with null subclass", () => {
			expect(CharacterSheetClassUtils.spellIsForClass(spell, "Bard", {subclass: null})).toBe(true);
		});

		it("should handle Renderer.spell.getCombinedClasses throwing", () => {
			const original = globalThis.Renderer.spell.getCombinedClasses;
			globalThis.Renderer.spell.getCombinedClasses = () => { throw new Error("mock error"); };
			try {
				// Should fall through to raw class data
				expect(CharacterSheetClassUtils.spellIsForClass(spell, "Bard")).toBe(true);
			} finally {
				globalThis.Renderer.spell.getCombinedClasses = original;
			}
		});
	});
});

// ==========================================================================
// getMaxSpellLevelFromProgression — caster progression formulas
// ==========================================================================
describe("getMaxSpellLevelFromProgression", () => {
	it("should return 2 for half-caster at level 6", () => {
		expect(CharacterSheetClassUtils.getMaxSpellLevelFromProgression("1/2", 6)).toBe(2);
	});

	it("should return 2 for artificer progression at level 6", () => {
		expect(CharacterSheetClassUtils.getMaxSpellLevelFromProgression("artificer", 6)).toBe(2);
	});

	it("should return 1 for artificer progression at level 2", () => {
		expect(CharacterSheetClassUtils.getMaxSpellLevelFromProgression("artificer", 2)).toBe(1);
	});

	it("should return 3 for artificer progression at level 9", () => {
		expect(CharacterSheetClassUtils.getMaxSpellLevelFromProgression("artificer", 9)).toBe(3);
	});

	it("should cap artificer progression at 5", () => {
		expect(CharacterSheetClassUtils.getMaxSpellLevelFromProgression("artificer", 20)).toBe(5);
	});

	it("should return 3 for full caster at level 5", () => {
		expect(CharacterSheetClassUtils.getMaxSpellLevelFromProgression("full", 5)).toBe(3);
	});

	it("should return 5 for pact caster at level 9", () => {
		expect(CharacterSheetClassUtils.getMaxSpellLevelFromProgression("pact", 9)).toBe(5);
	});

	it("should return 1 for third-caster at level 3", () => {
		expect(CharacterSheetClassUtils.getMaxSpellLevelFromProgression("1/3", 3)).toBe(1);
	});
});

// ==========================================================================
// Multiclass per-class spell level limits
// ==========================================================================
describe("Multiclass per-class max spell level", () => {
	it("Druid 3 in a multiclass should cap at 2nd level spells", () => {
		// Druid is a full caster: ceil(3/2) = 2
		expect(CharacterSheetClassUtils.getMaxSpellLevelFromProgression("full", 3)).toBe(2);
	});

	it("Ranger 6 (artificer prog) in a multiclass should cap at 2nd level spells", () => {
		// Artificer/Ranger: ceil(6/4) = 2
		expect(CharacterSheetClassUtils.getMaxSpellLevelFromProgression("artificer", 6)).toBe(2);
	});

	it("Ranger 6 (half-caster prog) in a multiclass should cap at 2nd level spells", () => {
		// Half caster: ceil(6/4) = 2
		expect(CharacterSheetClassUtils.getMaxSpellLevelFromProgression("1/2", 6)).toBe(2);
	});

	it("Warlock 5 in a multiclass should cap at 3rd level spells", () => {
		// Pact: ceil(5/2) = 3
		expect(CharacterSheetClassUtils.getMaxSpellLevelFromProgression("pact", 5)).toBe(3);
	});

	it("Sorcerer 1 in a multiclass should cap at 1st level spells", () => {
		// Full caster: ceil(1/2) = 1
		expect(CharacterSheetClassUtils.getMaxSpellLevelFromProgression("full", 1)).toBe(1);
	});

	it("should NOT use combined caster level — Druid 3 is 2nd, not 5th (if total was 9)", () => {
		// The bug was using characterLevel (9) for a Druid 3 → ceil(9/2) = 5
		// Correct: per-class level 3 → ceil(3/2) = 2
		expect(CharacterSheetClassUtils.getMaxSpellLevelFromProgression("full", 3)).toBe(2);
		expect(CharacterSheetClassUtils.getMaxSpellLevelFromProgression("full", 9)).toBe(5);
	});
});

// ==========================================================================
// getAdditionalSpellListClasses — Divine Soul Cleric spell access
// ==========================================================================
describe("getAdditionalSpellListClasses", () => {
	const divineSoulSubclass = {
		name: "Divine Soul",
		shortName: "Divine Soul",
		source: "XGE",
		additionalSpells: [
			{name: "Good", known: {"1": ["cure wounds|PHB"]}},
			{name: "Evil", known: {"1": ["inflict wounds|PHB"]}},
		],
	};

	it("returns ['Cleric'] for Divine Soul Sorcerer with valid affinity", () => {
		const result = CharacterSheetClassUtils.getAdditionalSpellListClasses({
			className: "Sorcerer",
			subclass: divineSoulSubclass,
			subclassChoice: {name: "Good", key: "good"},
		});
		expect(result).toEqual(["Cleric"]);
	});

	it("returns [] for Divine Soul Sorcerer without affinity", () => {
		const result = CharacterSheetClassUtils.getAdditionalSpellListClasses({
			className: "Sorcerer",
			subclass: divineSoulSubclass,
			subclassChoice: null,
		});
		expect(result).toEqual([]);
	});

	it("returns [] for non-Divine-Soul sorcerer subclass", () => {
		const result = CharacterSheetClassUtils.getAdditionalSpellListClasses({
			className: "Sorcerer",
			subclass: {name: "Aberrant Mind", shortName: "Aberrant Mind", source: "TCE"},
			subclassChoice: null,
		});
		expect(result).toEqual([]);
	});

	it("returns [] for non-Sorcerer class", () => {
		const result = CharacterSheetClassUtils.getAdditionalSpellListClasses({
			className: "Wizard",
			subclass: {name: "Some Subclass", source: "PHB"},
		});
		expect(result).toEqual([]);
	});

	it("returns [] when no arguments provided", () => {
		expect(CharacterSheetClassUtils.getAdditionalSpellListClasses()).toEqual([]);
		expect(CharacterSheetClassUtils.getAdditionalSpellListClasses({})).toEqual([]);
	});
});

// ==========================================================================
// Divine Soul spell filtering integration
// ==========================================================================
describe("Divine Soul spell filtering with additionalClassNames", () => {
	const clericOnlySpell = mockSpell("Cure Wounds", {
		fromClassList: [{name: "Cleric", source: "PHB"}],
	});

	const sorcererSpell = mockSpell("Fire Bolt", {
		fromClassList: [{name: "Sorcerer", source: "PHB"}],
	});

	const sharedSpell = mockSpell("Guidance", {
		fromClassList: [
			{name: "Cleric", source: "PHB"},
			{name: "Druid", source: "PHB"},
		],
	});

	it("Cleric-only spell is accessible via additionalClassNames", () => {
		const additionalClassNames = ["Cleric"];
		const isAvailable = CharacterSheetClassUtils.spellIsForClass(clericOnlySpell, "Sorcerer")
			|| additionalClassNames.some(cls => CharacterSheetClassUtils.spellIsForClass(clericOnlySpell, cls));
		expect(isAvailable).toBe(true);
	});

	it("Cleric-only spell is NOT accessible without additionalClassNames", () => {
		const isAvailable = CharacterSheetClassUtils.spellIsForClass(clericOnlySpell, "Sorcerer");
		expect(isAvailable).toBe(false);
	});

	it("Sorcerer spell is accessible regardless of additionalClassNames", () => {
		expect(CharacterSheetClassUtils.spellIsForClass(sorcererSpell, "Sorcerer")).toBe(true);
	});

	it("Shared Cleric/Druid spell is accessible via additionalClassNames", () => {
		const additionalClassNames = ["Cleric"];
		const isAvailable = CharacterSheetClassUtils.spellIsForClass(sharedSpell, "Sorcerer")
			|| additionalClassNames.some(cls => CharacterSheetClassUtils.spellIsForClass(sharedSpell, cls));
		expect(isAvailable).toBe(true);
	});
});
