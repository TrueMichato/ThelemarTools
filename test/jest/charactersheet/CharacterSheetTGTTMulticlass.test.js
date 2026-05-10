/**
 * TGTT Multiclass Tests — Ranger/Druid and Sorcerer/Warlock combos.
 *
 * These are the two multiclass builds the player party uses:
 * 1. Ranger (TGTT) / Druid (TGTT) — Zodiac Stars + Hunter dual-nature
 * 2. Sorcerer (TGTT) / Warlock (TGTT) — Divine Soul + Hexblade (Sorlock)
 *
 * Covers:
 * - Combined spell slot calculations
 * - Resource independence (Focus vs Wild Shape, SP vs Pact Slots)
 * - Combat system interaction in multiclass
 * - Feature calculations from both classes
 * - Proficiency bonus from total character level
 */

import "./setup.js";

let CharacterSheetState;
let state;

beforeAll(async () => {
	CharacterSheetState = (await import("../../../js/charactersheet/charactersheet-state.js")).CharacterSheetState;
});

describe("TGTT Multiclass Builds", () => {
	beforeEach(() => {
		state = new CharacterSheetState();
	});

	// =========================================================================
	// RANGER / DRUID (Hunter Ranger 7 / Zodiac Druid 3)
	// =========================================================================
	describe("Ranger/Druid Multiclass (Hunter 7 / Stars 3)", () => {
		function makeRangerDruid (rangerLevel = 7, druidLevel = 3) {
			state.addClass({
				name: "Ranger",
				source: "TGTT",
				level: rangerLevel,
				subclass: rangerLevel >= 3
					? {name: "Hunter", shortName: "Hunter", source: "TGTT"}
					: undefined,
			});
			state.addClass({
				name: "Druid",
				source: "TGTT",
				level: druidLevel,
				subclass: druidLevel >= 3
					? {name: "Circle of the Zodiac", shortName: "Zodiac", source: "TGTT"}
					: undefined,
			});
			state.setAbilityBase("str", 10);
			state.setAbilityBase("dex", 16); // +3
			state.setAbilityBase("con", 14); // +2
			state.setAbilityBase("int", 10);
			state.setAbilityBase("wis", 18); // +4
			state.setAbilityBase("cha", 8);
		}

		describe("Basic Setup", () => {
			it("should create two-class multiclass", () => {
				makeRangerDruid();
				const classes = state.getClasses();
				expect(classes.length).toBe(2);
				expect(classes.find(c => c.name === "Ranger")).toBeDefined();
				expect(classes.find(c => c.name === "Druid")).toBeDefined();
			});

			it("should calculate total level correctly", () => {
				makeRangerDruid(7, 3);
				expect(state.getTotalLevel()).toBe(10);
			});

			it("should use proficiency bonus from total level", () => {
				makeRangerDruid(7, 3); // total 10
				expect(state.getProficiencyBonus()).toBe(4);
			});
		});

		describe("Multiclass Spellcasting Slots", () => {
			it("should calculate multiclass spell slots", () => {
				makeRangerDruid(7, 3); // half-caster 7 = floor(7/2)=3 + full-caster 3 = 3 → effective caster level 6
				state.calculateSpellSlots();
				// Level 6 caster: 4/3/3 slots
				expect(state.getSpellSlotsMax(1)).toBeGreaterThanOrEqual(4);
				expect(state.getSpellSlotsMax(2)).toBeGreaterThanOrEqual(3);
				expect(state.getSpellSlotsMax(3)).toBeGreaterThanOrEqual(3);
			});

			it("should not yet have 4th level slots at Ranger 7 / Druid 3", () => {
				// Ranger 7 (half-caster multiclass → floor(7/2) = 3) + Druid 3 (full → 3) = 6 effective
				// A 6th-level caster does NOT have 4th-level slots (need 7th)
				makeRangerDruid(7, 3);
				state.calculateSpellSlots();
				expect(state.getSpellSlotsMax(4)).toBe(0);
			});

			it("should gain 4th level slots at higher splits", () => {
				makeRangerDruid(9, 5); // half 9 = 4.5 + full 5 = 5 → effective 9
				state.calculateSpellSlots();
				expect(state.getSpellSlotsMax(4)).toBeGreaterThan(0);
			});
		});

		describe("Independent Resources", () => {
			it("should have Primal Focus (from Ranger) independently", () => {
				makeRangerDruid();
				state.applyClassFeatureEffects();
				expect(state.hasPrimalFocus()).toBe(true);
			});

			it("should have Focused Quarry damage from Ranger level (not total)", () => {
				makeRangerDruid(7, 3);
				state.applyClassFeatureEffects();
				const calcs = state.getFeatureCalculations();
				// Ranger 7 → 1d6 (level 5-9 bracket)
				expect(calcs.focusedQuarryDamage).toBe("1d6");
			});

			it("should have Hunter's Dodge uses from total proficiency", () => {
				makeRangerDruid(7, 3); // total level 10, prof 4
				state.applyClassFeatureEffects();
				expect(state.getFeatureCalculations().huntersDodgeUses).toBe(4);
			});

			it("should have focusSwitchesMax based on Ranger level", () => {
				makeRangerDruid(7, 3);
				state.applyClassFeatureEffects();
				const calcs = state.getFeatureCalculations();
				// Ranger L7 → focusSwitchesMax is Ranger-level-based
				expect(calcs.focusSwitchesMax).toBeGreaterThanOrEqual(1);
			});

			it("should scale focusSwitchesMax with Ranger level progression", () => {
				// higher Ranger level → more switches
				const s1 = new CharacterSheetState();
				s1.addClass({name: "Ranger",
					source: "TGTT",
					level: 5,
					subclass: {name: "Hunter", shortName: "Hunter", source: "TGTT"}});
				s1.addClass({name: "Druid", source: "TGTT", level: 1});
				s1.setAbilityBase("wis", 18);
				s1.applyClassFeatureEffects();
				const low = s1.getFeatureCalculations().focusSwitchesMax;

				const s2 = new CharacterSheetState();
				s2.addClass({name: "Ranger",
					source: "TGTT",
					level: 14,
					subclass: {name: "Hunter", shortName: "Hunter", source: "TGTT"}});
				s2.addClass({name: "Druid",
					source: "TGTT",
					level: 6,
					subclass: {name: "Circle of the Zodiac", shortName: "Zodiac", source: "TGTT"}});
				s2.setAbilityBase("wis", 18);
				s2.applyClassFeatureEffects();
				const high = s2.getFeatureCalculations().focusSwitchesMax;

				expect(high).toBeGreaterThanOrEqual(low);
			});

			it("should have Zodiac Form from Druid subclass", () => {
				makeRangerDruid(7, 3);
				const calcs = state.getFeatureCalculations();
				expect(calcs.hasZodiacForm).toBe(true);
			});

			it("should calculate Zodiac constellation values from Druid level", () => {
				makeRangerDruid(7, 3);
				const calcs = state.getFeatureCalculations();
				// Bee damage uses druid level: level 3 = before 10 scaling, 1d8+WIS
				expect(calcs.beeDamage).toBe("1d8+4");
			});

			it("should have aurochsStrBonus = total prof bonus in multiclass", () => {
				makeRangerDruid(7, 3); // total 10, prof 4
				const calcs = state.getFeatureCalculations();
				expect(calcs.aurochsStrBonus).toBe(4);
			});
		});

		describe("Combat System in Multiclass", () => {
			it("should have combat system from Ranger", () => {
				makeRangerDruid();
				state.addCombatTradition("Rapid Current");
				expect(state.usesCombatSystem()).toBe(true);
			});

			it("should have stamina pool based on total proficiency", () => {
				makeRangerDruid(7, 3); // total 10, prof 4
				state.addCombatTradition("Rapid Current");
				state.ensureStaminaInitialized();
				expect(state.getStaminaMax()).toBe(8); // 2 × 4
			});
		});

		describe("Level Progression Splits", () => {
			const splits = [
				{ranger: 5, druid: 1, total: 6},
				{ranger: 7, druid: 3, total: 10},
				{ranger: 10, druid: 5, total: 15},
				{ranger: 14, druid: 6, total: 20},
			];

			splits.forEach(({ranger, druid, total}) => {
				it(`should be valid at Ranger ${ranger} / Druid ${druid} (total ${total})`, () => {
					makeRangerDruid(ranger, druid);
					expect(state.getTotalLevel()).toBe(total);
					state.applyClassFeatureEffects();
					expect(state.hasPrimalFocus()).toBe(true);
					if (druid >= 3) {
						expect(state.getFeatureCalculations().hasZodiacForm).toBe(true);
					}
				});
			});
		});
	});

	// =========================================================================
	// SORCERER / WARLOCK (Divine Soul Sorcerer X / Hexblade Warlock Y)
	// =========================================================================
	describe("Sorcerer/Warlock Multiclass (Divine Soul 7 / Hexblade 3)", () => {
		function makeSorlock (sorcererLevel = 7, warlockLevel = 3) {
			state.addClass({
				name: "Sorcerer",
				source: "TGTT",
				level: sorcererLevel,
				subclass: sorcererLevel >= 3
					? {name: "Divine Soul", shortName: "Divine Soul", source: "TGTT"}
					: undefined,
			});
			state.addClass({
				name: "Warlock",
				source: "TGTT",
				level: warlockLevel,
				subclass: warlockLevel >= 3
					? {name: "The Hexblade", shortName: "Hexblade", source: "TGTT"}
					: undefined,
			});
			state.setAbilityBase("str", 8);
			state.setAbilityBase("dex", 14); // +2
			state.setAbilityBase("con", 14); // +2
			state.setAbilityBase("int", 10);
			state.setAbilityBase("wis", 12); // +1
			state.setAbilityBase("cha", 20); // +5
		}

		describe("Basic Setup", () => {
			it("should create Sorcerer/Warlock multiclass", () => {
				makeSorlock();
				const classes = state.getClasses();
				expect(classes.length).toBe(2);
				expect(classes.find(c => c.name === "Sorcerer")).toBeDefined();
				expect(classes.find(c => c.name === "Warlock")).toBeDefined();
			});

			it("should calculate total level correctly", () => {
				makeSorlock(7, 3);
				expect(state.getTotalLevel()).toBe(10);
			});

			it("should use proficiency bonus from total level", () => {
				makeSorlock(7, 3); // total 10
				expect(state.getProficiencyBonus()).toBe(4);
			});
		});

		describe("Spell Slots + Pact Slots Independence", () => {
			it("should have regular spell slots from Sorcerer levels only", () => {
				makeSorlock(7, 3);
				state.calculateSpellSlots();
				// Warlock pact magic does NOT contribute to multiclass spell slots
				// Sorcerer 7 = 4/3/3/1 slots
				expect(state.getSpellSlotsMax(1)).toBeGreaterThanOrEqual(4);
				expect(state.getSpellSlotsMax(4)).toBe(1);
			});

			it("should have separate pact slots from Warlock levels", () => {
				makeSorlock(7, 3);
				const pactSlots = state.getPactSlots();
				expect(pactSlots).toBeDefined();
				expect(pactSlots.max).toBe(2); // Warlock 3 = 2 pact slots
				expect(pactSlots.level).toBe(2); // 2nd level slots
			});

			it("should be able to use pact slots independently of spell slots", () => {
				makeSorlock(7, 3);
				state.calculateSpellSlots();

				const regularSlots1Max = state.getSpellSlotsMax(1);
				state.usePactSlot();

				// Regular spell slots should be unchanged
				expect(state.getSpellSlotsMax(1)).toBe(regularSlots1Max);
				expect(state.getPactSlots().current).toBe(1); // Used 1 of 2
			});
		});

		describe("Resource Independence", () => {
			it("should have sorcery points from Sorcerer level (TGTT: level + 1)", () => {
				makeSorlock(7, 3);
				const calcs = state.getFeatureCalculations();
				// TGTT Sorcerer L7: SP = 7 + 1 = 8
				expect(calcs.sorceryPoints).toBe(8);
			});

			it("should have Metamagic from Sorcerer level", () => {
				makeSorlock(7, 3);
				const calcs = state.getFeatureCalculations();
				expect(calcs.hasMetamagic).toBe(true);
			});

			it("should have 4 Metamagic options at Sorcerer level 7 (TGTT)", () => {
				makeSorlock(7, 3);
				const calcs = state.getFeatureCalculations();
				// TGTT Sorc: 3@L3, 4@L6, 5@L10 — Sorc L7 ≥ 6 → 4 options
				expect(calcs.metamagicOptions).toBe(4);
			});

			it("should maintain Hexblade Curse resource independently", () => {
				makeSorlock(7, 3);
				state.addResource({name: "Hexblade's Curse", max: 1, current: 1, recharge: "short"});

				// Use Hexblade Curse — shouldn't affect SP
				const res = state.getResource("Hexblade's Curse");
				expect(res.max).toBe(1);
				const calcs = state.getFeatureCalculations();
				expect(calcs.sorceryPoints).toBe(8); // TGTT: 7 + 1
			});

			it("should compute Hexblade's Curse bonus damage = proficiency bonus in multiclass", () => {
				makeSorlock(7, 3); // total 10, prof 4
				const calcs = state.getFeatureCalculations();
				expect(calcs.hexbladesCurseDamage).toBe(4); // equals prof bonus
			});

			it("should compute Hexblade's Curse healing = CHA mod + warlock level in multiclass", () => {
				makeSorlock(7, 3); // CHA 20 (+5), Warlock level 3
				const calcs = state.getFeatureCalculations();
				expect(calcs.hexbladesCurseHealing).toBe(8); // CHA(5) + warlock(3)
			});
		});

		describe("SP ↔ Slot Conversion in Multiclass", () => {
			it("should convert spell slot to SP in multiclass context", () => {
				makeSorlock(7, 3);
				state.setSorceryPoints(8);
				// Drain SP first so conversion is visible
				state.useSorceryPoint(4);
				const spBefore = state.getSorceryPoints().current;
				state.convertSlotToSorceryPoints(1); // L1 slot → 1 SP
				expect(state.getSorceryPoints().current).toBe(spBefore + 1);
			});

			it("should convert SP to spell slot in multiclass context", () => {
				makeSorlock(7, 3);
				state.setSorceryPoints(8);
				state.calculateSpellSlots();
				const slotsBefore = state.getSpellSlotsCurrent(1);
				// Spend a slot first
				state.useSpellSlot(1);
				expect(state.getSpellSlotsCurrent(1)).toBe(slotsBefore - 1);
				// Convert SP → slot
				state.convertSorceryPointsToSlot(1); // costs 2 SP
				expect(state.getSpellSlotsCurrent(1)).toBe(slotsBefore);
			});

			it("should respect max convertible level = 5 (TGTT) in multiclass", () => {
				makeSorlock(7, 3);
				expect(state.getMaxConvertibleSlotLevel()).toBe(5);
			});

			it("should use TGTT SP/Slot cost tables in multiclass", () => {
				makeSorlock(7, 3);
				expect(state.getSpToSlotCost(1)).toBe(2);
				expect(state.getSpToSlotCost(2)).toBe(3);
				expect(state.getSpToSlotCost(3)).toBe(5);
			});
		});

		describe("Combat System (from Hexblade)", () => {
			it("should have combat system from Warlock/Hexblade", () => {
				makeSorlock(7, 3);
				state.addCombatTradition("Mirror's Glint");
				expect(state.usesCombatSystem()).toBe(true);
			});

			it("should scale stamina with total proficiency", () => {
				makeSorlock(7, 3); // total 10, prof 4
				state.addCombatTradition("Mirror's Glint");
				state.ensureStaminaInitialized();
				expect(state.getStaminaMax()).toBe(8); // 2 × 4
			});

			it("should use Hexblade spellcasting DC override for combat methods", () => {
				makeSorlock(7, 3);
				state.addCombatTradition("Mirror's Glint");
				state.ensureStaminaInitialized();
				state.applyClassFeatureEffects();
				const calcs = state.getFeatureCalculations();
				// Physical DC = 8 + prof(4) + DEX(+2) = 14
				// Spell DC = 8 + prof(4) + CHA(+5) = 17 → higher wins
				expect(calcs.combatMethodDc).toBe(17);
				expect(calcs.combatMethodDcUsesSpellcasting).toBe(true);
			});
		});

		describe("Shared CHA Spellcasting", () => {
			it("should use CHA for both Sorcerer and Warlock spells", () => {
				makeSorlock(7, 3);
				state.applyClassFeatureEffects();
				const calcs = state.getFeatureCalculations();
				// Both classes use CHA: DC = 8 + prof(4) + CHA(5) = 17
				expect(calcs.spellSaveDc).toBe(17);
				expect(calcs.spellAttackBonus).toBe(9);
			});
		});

		describe("Level Progression Splits", () => {
			const splits = [
				{sorcerer: 5, warlock: 1, total: 6},
				{sorcerer: 7, warlock: 3, total: 10},
				{sorcerer: 11, warlock: 4, total: 15},
				{sorcerer: 14, warlock: 6, total: 20},
			];

			splits.forEach(({sorcerer, warlock, total}) => {
				it(`should be valid at Sorcerer ${sorcerer} / Warlock ${warlock} (total ${total})`, () => {
					makeSorlock(sorcerer, warlock);
					expect(state.getTotalLevel()).toBe(total);
					state.applyClassFeatureEffects();

					// Always have metamagic from Sorcerer 2+
					if (sorcerer >= 2) {
						expect(state.getFeatureCalculations().hasMetamagic).toBe(true);
					}

					// Always have pact slots from Warlock
					expect(state.getPactSlots().max).toBeGreaterThan(0);
				});
			});
		});

		describe("Coffeelock Pattern (SP → Pact Slot Cycling)", () => {
			it("should allow converting pact slots to sorcery points pattern", () => {
				makeSorlock(7, 3); // Pact slots are 2nd level
				state.setSorceryPoints(8); // TGTT: Sorcerer L7 = 7 + 1 = 8

				// Pattern: Use all pact slots → short rest → regain → convert
				// This test verifies the resources exist and are independent
				state.usePactSlot();
				state.usePactSlot();
				expect(state.getPactSlots().current).toBe(0);

				// Short rest restores pact slots
				state.setPactSlotsCurrent(state.getPactSlots().max);
				expect(state.getPactSlots().current).toBe(2);

				// SP still at TGTT value (7 + 1 = 8)
				const calcs = state.getFeatureCalculations();
				expect(calcs.sorceryPoints).toBe(8);
			});
		});
	});

	// =========================================================================
	// MULTICLASS SPELL CHOICES — Verifies spell state when multiclassing into casters
	// =========================================================================
	describe("Multiclass Spell Choices", () => {
		describe("Known caster multiclass (Ranger into Sorcerer)", () => {
			it("should store spells added via multiclass with correct sourceClass", () => {
				// Start as Ranger 5
				state.addClass({name: "Ranger", source: "TGTT", level: 5});

				// Multiclass into Sorcerer — add class then manually add spells (simulating _applyMulticlass)
				state.addClass({
					name: "Sorcerer",
					source: "TGTT",
					level: 1,
					casterProgression: "full",
					spellsKnownProgression: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 12, 13, 13, 14, 14, 15, 15, 15, 15],
					cantripProgression: [4, 4, 4, 5, 5, 5, 5, 5, 5, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6],
				});

				// Simulate spell choices that _applyMulticlass would apply
				state.addSpell({name: "Shield", source: "PHB", level: 1, sourceClass: "Sorcerer", sourceFeature: "Spells Known"});
				state.addSpell({name: "Magic Missile", source: "PHB", level: 1, sourceClass: "Sorcerer", sourceFeature: "Spells Known"});

				const spells = state.getSpells();
				const sorcererSpells = spells.filter(s => s.sourceClass === "Sorcerer");
				expect(sorcererSpells.length).toBe(2);
				expect(sorcererSpells.some(s => s.name === "Shield")).toBe(true);
				expect(sorcererSpells.some(s => s.name === "Magic Missile")).toBe(true);
			});

			it("should store cantrips added via multiclass with correct sourceClass", () => {
				state.addClass({name: "Ranger", source: "TGTT", level: 5});
				state.addClass({
					name: "Sorcerer",
					source: "TGTT",
					level: 1,
					casterProgression: "full",
					cantripProgression: [4, 4, 4, 5, 5, 5, 5, 5, 5, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6],
				});

				state.addSpell({name: "Fire Bolt", source: "PHB", level: 0, sourceClass: "Sorcerer", sourceFeature: "Cantrips Known", isCantrip: true});
				state.addSpell({name: "Prestidigitation", source: "PHB", level: 0, sourceClass: "Sorcerer", sourceFeature: "Cantrips Known", isCantrip: true});

				const cantrips = state.getSpells().filter(s => s.level === 0 && s.sourceClass === "Sorcerer");
				expect(cantrips.length).toBe(2);
			});
		});

		describe("Prepared caster multiclass (Fighter into Druid)", () => {
			it("should store prepared spells added via multiclass", () => {
				state.addClass({name: "Fighter", source: "TGTT", level: 5});
				state.addClass({
					name: "Druid",
					source: "TGTT",
					level: 1,
					casterProgression: "full",
					preparedSpellsProgression: [4, 5, 6, 7, 9, 10, 11, 12, 14, 15, 16, 16, 17, 17, 18, 18, 19, 20, 21, 22],
					cantripProgression: [2, 2, 2, 3, 3, 3, 3, 3, 3, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4],
				});

				// Simulate the 4 prepared spells from preparedSpellsProgression[0]
				state.addSpell({name: "Cure Wounds", source: "PHB", level: 1, sourceClass: "Druid", sourceFeature: "Prepared Spells"});
				state.addSpell({name: "Entangle", source: "PHB", level: 1, sourceClass: "Druid", sourceFeature: "Prepared Spells"});
				state.addSpell({name: "Faerie Fire", source: "PHB", level: 1, sourceClass: "Druid", sourceFeature: "Prepared Spells"});
				state.addSpell({name: "Healing Word", source: "PHB", level: 1, sourceClass: "Druid", sourceFeature: "Prepared Spells"});

				const druidSpells = state.getSpells().filter(s => s.sourceClass === "Druid" && s.level === 1);
				expect(druidSpells.length).toBe(4);
			});

			it("should store cantrips added via Druid multiclass", () => {
				state.addClass({name: "Fighter", source: "TGTT", level: 5});
				state.addClass({
					name: "Druid",
					source: "TGTT",
					level: 1,
					casterProgression: "full",
					cantripProgression: [2, 2, 2, 3, 3, 3, 3, 3, 3, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4],
				});

				state.addSpell({name: "Druidcraft", source: "PHB", level: 0, sourceClass: "Druid", sourceFeature: "Cantrips Known", isCantrip: true});
				state.addSpell({name: "Produce Flame", source: "PHB", level: 0, sourceClass: "Druid", sourceFeature: "Cantrips Known", isCantrip: true});

				const cantrips = state.getSpells().filter(s => s.level === 0 && s.sourceClass === "Druid");
				expect(cantrips.length).toBe(2);
			});
		});

		describe("Multiclass spell slots are correct with added spells", () => {
			it("should have correct combined spell slots for Ranger 6 / Druid 1", () => {
				state.addClass({
					name: "Ranger",
					source: "TGTT",
					level: 6,
					casterProgression: "artificer",
				});
				state.addClass({
					name: "Druid",
					source: "TGTT",
					level: 1,
					casterProgression: "full",
					preparedSpellsProgression: [4, 5, 6, 7, 9, 10, 11, 12, 14, 15, 16, 16, 17, 17, 18, 18, 19, 20, 21, 22],
				});

				state.calculateSpellSlots();
				const slots = state.getSpellSlots();

				// Multiclass caster level: Ranger 6 / 2 (artificer=half rounded up) + Druid 1 = 4
				// Level 4 full caster slots: 4/3/0/0/0/0/0/0/0
				expect(slots[1]?.max).toBe(4);
				expect(slots[2]?.max).toBe(3);
			});

			it("should keep multiclass spells separate by sourceClass", () => {
				state.addClass({name: "Ranger", source: "TGTT", level: 5});
				state.addSpell({name: "Hunter's Mark", source: "PHB", level: 1, sourceClass: "Ranger", sourceFeature: "Spells Known"});

				state.addClass({name: "Druid", source: "TGTT", level: 1, casterProgression: "full"});
				state.addSpell({name: "Cure Wounds", source: "PHB", level: 1, sourceClass: "Druid", sourceFeature: "Prepared Spells"});

				const allSpells = state.getSpells();
				const rangerSpells = allSpells.filter(s => s.sourceClass === "Ranger");
				const druidSpells = allSpells.filter(s => s.sourceClass === "Druid");

				expect(rangerSpells.length).toBe(1);
				expect(rangerSpells[0].name).toBe("Hunter's Mark");
				expect(druidSpells.length).toBe(1);
				expect(druidSpells[0].name).toBe("Cure Wounds");
			});
		});
	});
});
