/**
 * Character Sheet Ritual Casting - Unit Tests
 * Tests for canCastAsRitual(), getAvailableRitualSpells(), and class-specific ritual flags
 */

import "./setup.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-state.js";

const CharacterSheetState = globalThis.CharacterSheetState;

describe("Ritual Casting", () => {
	let state;

	beforeEach(() => {
		state = new CharacterSheetState();
	});

	// ==========================================================================
	// Ritual Casting Flags Per Class
	// ==========================================================================
	describe("hasRitualCasting flags", () => {
		it("should set hasRitualCasting for PHB Wizard with spellbook mode", () => {
			state.addClass({name: "Wizard", level: 1, source: "PHB"});
			const calc = state.getFeatureCalculations();
			expect(calc.hasRitualCasting).toBe(true);
			expect(calc.ritualCastingMode).toBe("spellbook");
		});

		it("should set hasRitualCasting for XPHB Wizard with spellbook mode + Ritual Adept", () => {
			state.addClass({name: "Wizard", level: 1, source: "XPHB"});
			const calc = state.getFeatureCalculations();
			expect(calc.hasRitualCasting).toBe(true);
			expect(calc.ritualCastingMode).toBe("spellbook");
			expect(calc.hasRitualAdept).toBe(true);
		});

		it("should set hasRitualCasting for PHB Cleric with prepared mode", () => {
			state.addClass({name: "Cleric", level: 1, source: "PHB"});
			const calc = state.getFeatureCalculations();
			expect(calc.hasRitualCasting).toBe(true);
			expect(calc.ritualCastingMode).toBe("prepared");
		});

		it("should set hasRitualCasting for PHB Druid with prepared mode", () => {
			state.addClass({name: "Druid", level: 1, source: "PHB"});
			const calc = state.getFeatureCalculations();
			expect(calc.hasRitualCasting).toBe(true);
			expect(calc.ritualCastingMode).toBe("prepared");
		});

		it("should set hasRitualCasting for PHB Bard with known mode", () => {
			state.addClass({name: "Bard", level: 1, source: "PHB"});
			const calc = state.getFeatureCalculations();
			expect(calc.hasRitualCasting).toBe(true);
			expect(calc.ritualCastingMode).toBe("known");
		});

		it("should NOT set hasRitualCasting for XPHB Bard (2024 Bard lost ritual casting)", () => {
			state.addClass({name: "Bard", level: 1, source: "XPHB"});
			const calc = state.getFeatureCalculations();
			expect(calc.hasRitualCasting).toBeFalsy();
		});

		it("should set hasRitualCasting for Artificer with prepared mode", () => {
			state.addClass({name: "Artificer", level: 1, source: "TCE"});
			const calc = state.getFeatureCalculations();
			expect(calc.hasRitualCasting).toBe(true);
			expect(calc.ritualCastingMode).toBe("prepared");
		});

		it("should NOT set hasRitualCasting for Fighter", () => {
			state.addClass({name: "Fighter", level: 5, source: "PHB"});
			const calc = state.getFeatureCalculations();
			expect(calc.hasRitualCasting).toBeFalsy();
		});

		it("should NOT set hasRitualCasting for Rogue", () => {
			state.addClass({name: "Rogue", level: 5, source: "PHB"});
			const calc = state.getFeatureCalculations();
			expect(calc.hasRitualCasting).toBeFalsy();
		});
	});

	// ==========================================================================
	// canCastAsRitual
	// ==========================================================================
	describe("canCastAsRitual", () => {
		describe("Wizard (spellbook mode)", () => {
			beforeEach(() => {
				state.addClass({name: "Wizard", level: 5, source: "PHB"});
			});

			it("should allow ritual casting of unprepared spellbook ritual spells", () => {
				const spell = {name: "Detect Magic", source: "PHB", level: 1, ritual: true, inSpellbook: true, prepared: false};
				expect(state.canCastAsRitual(spell)).toBe(true);
			});

			it("should allow ritual casting of prepared ritual spells", () => {
				const spell = {name: "Find Familiar", source: "PHB", level: 1, ritual: true, inSpellbook: true, prepared: true};
				expect(state.canCastAsRitual(spell)).toBe(true);
			});

			it("should NOT allow ritual casting of non-ritual spells in spellbook", () => {
				const spell = {name: "Magic Missile", source: "PHB", level: 1, ritual: false, inSpellbook: true};
				expect(state.canCastAsRitual(spell)).toBe(false);
			});

			it("should NOT allow ritual casting of spells not in spellbook", () => {
				const spell = {name: "Detect Magic", source: "PHB", level: 1, ritual: true, inSpellbook: false, prepared: false};
				expect(state.canCastAsRitual(spell)).toBe(false);
			});

			it("should NOT allow ritual casting of cantrips", () => {
				const spell = {name: "Prestidigitation", source: "PHB", level: 0, ritual: true};
				expect(state.canCastAsRitual(spell)).toBe(false);
			});
		});

		describe("Cleric (prepared mode)", () => {
			beforeEach(() => {
				state.addClass({name: "Cleric", level: 5, source: "PHB"});
			});

			it("should allow ritual casting of prepared ritual spells", () => {
				const spell = {name: "Detect Magic", source: "PHB", level: 1, ritual: true, prepared: true};
				expect(state.canCastAsRitual(spell)).toBe(true);
			});

			it("should allow ritual casting of always-prepared ritual spells", () => {
				const spell = {name: "Detect Evil and Good", source: "PHB", level: 1, ritual: true, alwaysPrepared: true};
				expect(state.canCastAsRitual(spell)).toBe(true);
			});

			it("should NOT allow ritual casting of unprepared ritual spells", () => {
				const spell = {name: "Ceremony", source: "PHB", level: 1, ritual: true, prepared: false};
				expect(state.canCastAsRitual(spell)).toBe(false);
			});

			it("should NOT allow ritual casting of prepared non-ritual spells", () => {
				const spell = {name: "Cure Wounds", source: "PHB", level: 1, ritual: false, prepared: true};
				expect(state.canCastAsRitual(spell)).toBe(false);
			});
		});

		describe("Druid (prepared mode)", () => {
			beforeEach(() => {
				state.addClass({name: "Druid", level: 5, source: "PHB"});
			});

			it("should allow ritual casting of prepared ritual spells", () => {
				const spell = {name: "Detect Magic", source: "PHB", level: 1, ritual: true, prepared: true};
				expect(state.canCastAsRitual(spell)).toBe(true);
			});

			it("should NOT allow ritual casting of unprepared ritual spells", () => {
				const spell = {name: "Speak with Animals", source: "PHB", level: 1, ritual: true, prepared: false};
				expect(state.canCastAsRitual(spell)).toBe(false);
			});
		});

		describe("Bard PHB (known mode)", () => {
			beforeEach(() => {
				state.addClass({name: "Bard", level: 5, source: "PHB"});
			});

			it("should allow ritual casting of any known ritual spell", () => {
				const spell = {name: "Speak with Animals", source: "PHB", level: 1, ritual: true};
				expect(state.canCastAsRitual(spell)).toBe(true);
			});

			it("should NOT allow ritual casting of non-ritual known spells", () => {
				const spell = {name: "Healing Word", source: "PHB", level: 1, ritual: false};
				expect(state.canCastAsRitual(spell)).toBe(false);
			});
		});

		describe("Bard XPHB (no ritual casting)", () => {
			it("should NOT allow ritual casting for XPHB Bard", () => {
				state.addClass({name: "Bard", level: 5, source: "XPHB"});
				const spell = {name: "Speak with Animals", source: "PHB", level: 1, ritual: true};
				expect(state.canCastAsRitual(spell)).toBe(false);
			});
		});

		describe("Artificer (prepared mode)", () => {
			beforeEach(() => {
				state.addClass({name: "Artificer", level: 5, source: "TCE"});
			});

			it("should allow ritual casting of prepared ritual spells", () => {
				const spell = {name: "Detect Magic", source: "PHB", level: 1, ritual: true, prepared: true};
				expect(state.canCastAsRitual(spell)).toBe(true);
			});

			it.each([
				["Cleric", "Artificer|EFA"],
				["Druid", {name: "Artificer", source: "EFA"}],
			])("does not let %s ritual casting authorize an EFA Artificer spell", (otherClass, sourceClass) => {
				state = new CharacterSheetState();
				state.addClass({name: "Artificer", level: 5, source: "EFA"});
				state.addClass({name: otherClass, level: 5, source: "PHB"});
				const spell = {
					name: "Detect Magic",
					source: "PHB",
					sourceClass,
					level: 1,
					ritual: true,
					prepared: true,
				};
				expect(state.canCastAsRitual(spell)).toBe(false);
			});

			it("preserves TCE Artificer ritual casting when spell ownership is explicit", () => {
				state = new CharacterSheetState();
				state.addClass({name: "Artificer", level: 5, source: "TCE"});
				state.addClass({name: "Cleric", level: 5, source: "PHB"});
				const spell = {
					name: "Detect Magic",
					source: "PHB",
					sourceClass: "Artificer|TCE",
					level: 1,
					ritual: true,
					prepared: true,
				};
				expect(state.canCastAsRitual(spell)).toBe(true);
			});
		});

		describe("Non-caster", () => {
			it("should never allow ritual casting for non-ritual-caster", () => {
				state.addClass({name: "Fighter", level: 5, source: "PHB"});
				const spell = {name: "Detect Magic", source: "PHB", level: 1, ritual: true, prepared: true};
				expect(state.canCastAsRitual(spell)).toBe(false);
			});
		});

		describe("Edge cases", () => {
			it("should return false for null spell", () => {
				state.addClass({name: "Wizard", level: 5, source: "PHB"});
				expect(state.canCastAsRitual(null)).toBe(false);
			});

			it("should return false for undefined spell", () => {
				state.addClass({name: "Wizard", level: 5, source: "PHB"});
				expect(state.canCastAsRitual(undefined)).toBe(false);
			});
		});
	});

	// ==========================================================================
	// getAvailableRitualSpells
	// ==========================================================================
	describe("getAvailableRitualSpells", () => {
		it("should return ritual spells from Wizard spellbook (including unprepared)", () => {
			state.addClass({name: "Wizard", level: 5, source: "PHB"});

			// Add a ritual spell to spellbook (unprepared)
			state.addSpell({name: "Detect Magic", source: "PHB", level: 1, ritual: true, inSpellbook: true}, false);
			// Add a ritual spell to spellbook (prepared)
			state.addSpell({name: "Find Familiar", source: "PHB", level: 1, ritual: true, inSpellbook: true}, true);
			// Add a non-ritual spell (should NOT appear)
			state.addSpell({name: "Magic Missile", source: "PHB", level: 1, ritual: false, inSpellbook: true}, true);

			const rituals = state.getAvailableRitualSpells();
			expect(rituals.length).toBe(2);
			expect(rituals.find(s => s.name === "Detect Magic")).toBeTruthy();
			expect(rituals.find(s => s.name === "Find Familiar")).toBeTruthy();
			expect(rituals.find(s => s.name === "Magic Missile")).toBeFalsy();
		});

		it("should return only prepared ritual spells for Cleric", () => {
			state.addClass({name: "Cleric", level: 5, source: "PHB"});

			state.addSpell({name: "Detect Magic", source: "PHB", level: 1, ritual: true}, true); // prepared
			state.addSpell({name: "Ceremony", source: "PHB", level: 1, ritual: true}, false); // unprepared

			const rituals = state.getAvailableRitualSpells();
			expect(rituals.length).toBe(1);
			expect(rituals[0].name).toBe("Detect Magic");
		});

		it("should return all known ritual spells for PHB Bard", () => {
			state.addClass({name: "Bard", level: 5, source: "PHB"});

			state.addSpell({name: "Speak with Animals", source: "PHB", level: 1, ritual: true}, false);
			state.addSpell({name: "Comprehend Languages", source: "PHB", level: 1, ritual: true}, false);

			const rituals = state.getAvailableRitualSpells();
			expect(rituals.length).toBe(2);
		});

		it("should return empty for non-ritual-caster", () => {
			state.addClass({name: "Fighter", level: 5, source: "PHB"});
			const rituals = state.getAvailableRitualSpells();
			expect(rituals).toEqual([]);
		});

		it("should return empty for XPHB Bard", () => {
			state.addClass({name: "Bard", level: 5, source: "XPHB"});
			state.addSpell({name: "Speak with Animals", source: "PHB", level: 1, ritual: true}, false);

			const rituals = state.getAvailableRitualSpells();
			expect(rituals).toEqual([]);
		});
	});

	// ==========================================================================
	// Multiclass Ritual Casting
	// ==========================================================================
	describe("Multiclass Ritual Casting", () => {
		it("should use highest-priority ritual mode (Wizard spellbook > Cleric prepared)", () => {
			// Wizard/Cleric multiclass — wizard grants spellbook mode
			state.addClass({name: "Wizard", level: 3, source: "PHB"});
			state.addClass({name: "Cleric", level: 2, source: "PHB"});

			// Wizard spellbook ritual (unprepared) should work
			const spell = {name: "Detect Magic", source: "PHB", level: 1, ritual: true, inSpellbook: true, prepared: false};
			expect(state.canCastAsRitual(spell)).toBe(true);
		});

		it("should allow Cleric prepared ritual in multiclass even if not in Wizard spellbook", () => {
			state.addClass({name: "Wizard", level: 3, source: "PHB"});
			state.addClass({name: "Cleric", level: 2, source: "PHB"});

			// Cleric-only ritual spell (prepared, not in spellbook)
			const spell = {name: "Ceremony", source: "PHB", level: 1, ritual: true, inSpellbook: false, prepared: true};
			expect(state.canCastAsRitual(spell)).toBe(true);
		});
	});
});
