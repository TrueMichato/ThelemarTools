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
