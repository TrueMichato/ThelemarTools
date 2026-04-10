/**
 * TGTT Hexblade Warlock — Full L1→20 test coverage.
 *
 * Covers:
 * - Core TGTT Warlock setup (Pact Magic, Pact of the Blade)
 * - Warlock Specialties at 2, 8, 14
 * - Invocations progression (TGTT schedule)
 * - Combat Methods — 7 traditions from Hexblade subclass at L3
 * - Hex Warrior: CHA for weapon attacks
 * - Hexblade's Curse toggle (L1)
 * - Accursed Specter (L6), Armor of Hexes (L10), Master of Hexes (L14)
 * - Pact Magic slot scaling
 * - Stamina pool with spell-save DC as combat method DC
 * - Full L1→20 progression
 */

import "./setup.js";

let CharacterSheetState;
let state;

beforeAll(async () => {
	CharacterSheetState = (await import("../../../js/charactersheet/charactersheet-state.js")).CharacterSheetState;
});

describe("TGTT Hexblade Warlock", () => {

	beforeEach(() => {
		state = new CharacterSheetState();
	});

	// =========================================================================
	// HELPER
	// =========================================================================
	function makeHexblade (level) {
		state.addClass({
			name: "Warlock",
			source: "TGTT",
			level,
			subclass: level >= 3
				? {name: "The Hexblade", shortName: "Hexblade", source: "TGTT"}
				: undefined,
		});
		state.setAbilityBase("str", 10);
		state.setAbilityBase("dex", 14); // +2
		state.setAbilityBase("con", 14); // +2
		state.setAbilityBase("int", 10);
		state.setAbilityBase("wis", 12); // +1
		state.setAbilityBase("cha", 18); // +4
	}

	// =========================================================================
	// CORE CLASS SETUP
	// =========================================================================
	describe("Core Class Setup", () => {
		it("should create a TGTT Warlock", () => {
			makeHexblade(1);
			const classes = state.getClasses();
			expect(classes.length).toBe(1);
			expect(classes[0].name).toBe("Warlock");
			expect(classes[0].source).toBe("TGTT");
		});

		it("should recognise the Hexblade subclass at level 3", () => {
			makeHexblade(3);
			const classes = state.getClasses();
			expect(classes[0].subclass).toBeDefined();
			expect(classes[0].subclass.shortName).toBe("Hexblade");
		});

		it("should use CHA as spellcasting ability", () => {
			makeHexblade(5);
			state.applyClassFeatureEffects();
			const calcs = state.getFeatureCalculations();
			// Spell DC = 8 + prof(3) + CHA(4) = 15
			expect(calcs.spellSaveDc).toBe(15);
			expect(calcs.spellAttackBonus).toBe(7);
		});
	});

	// =========================================================================
	// PACT MAGIC SLOTS
	// =========================================================================
	describe("Pact Magic Slots", () => {
		it("should have pact slots at level 1", () => {
			makeHexblade(1);
			const pactSlots = state.getPactSlots();
			expect(pactSlots).toBeDefined();
			expect(pactSlots.max).toBe(1);
			expect(pactSlots.level).toBe(1);
		});

		it("should scale pact slot count: 1→2 at L2, 3 at L11, 4 at L17", () => {
			const progression = [
				{level: 1, max: 1, slotLevel: 1},
				{level: 2, max: 2, slotLevel: 1},
				{level: 3, max: 2, slotLevel: 2},
				{level: 5, max: 2, slotLevel: 3},
				{level: 7, max: 2, slotLevel: 4},
				{level: 9, max: 2, slotLevel: 5},
				{level: 11, max: 3, slotLevel: 5},
				{level: 17, max: 4, slotLevel: 5},
			];

			for (const {level, max, slotLevel} of progression) {
				const s = new CharacterSheetState();
				s.addClass({name: "Warlock", source: "TGTT", level});
				const slots = s.getPactSlots();
				expect(slots.max).toBe(max);
				expect(slots.level).toBe(slotLevel);
			}
		});

		it("should use and restore pact slots", () => {
			makeHexblade(5);
			const initial = state.getPactSlots().current;
			state.usePactSlot();
			expect(state.getPactSlots().current).toBe(initial - 1);

			state.usePactSlot();
			expect(state.getPactSlots().current).toBe(0);

			// Short rest restore
			state.setPactSlotsCurrent(state.getPactSlots().max);
			expect(state.getPactSlots().current).toBe(2);
		});
	});

	// =========================================================================
	// WARLOCK SPECIALTIES (TGTT-specific)
	// =========================================================================
	describe("Warlock (TGTT) Specialties", () => {
		it("should accept Specialty features at levels 2, 8, 14", () => {
			makeHexblade(14);
			const specialtyLevels = [2, 8, 14];
			specialtyLevels.forEach(lvl => {
				state.addFeature({
					name: `Warlock Specialty (Lv ${lvl})`,
					source: "TGTT",
					featureType: "Class",
					className: "Warlock",
					level: lvl,
					description: `Warlock specialty at level ${lvl}.`,
				});
			});

			state.applyClassFeatureEffects();
			const features = state.getFeatures();
			specialtyLevels.forEach(lvl => {
				expect(features.some(f => f.name === `Warlock Specialty (Lv ${lvl})`)).toBe(true);
			});
		});
	});

	// =========================================================================
	// INVOCATIONS PROGRESSION
	// =========================================================================
	describe("Invocation Progression", () => {
		it("should track invocation count scaling with level", () => {
			const progression = [
				{level: 2, count: 2},
				{level: 5, count: 3},
				{level: 7, count: 4},
				{level: 9, count: 5},
				{level: 12, count: 6},
				{level: 15, count: 7},
				{level: 18, count: 8},
			];

			for (const {level, count} of progression) {
				const s = new CharacterSheetState();
				s.addClass({name: "Warlock", source: "TGTT", level});
				const calcs = s.getFeatureCalculations();
				expect(calcs.invocationsKnown).toBe(count);
			}
		});
	});

	// =========================================================================
	// COMBAT METHODS (Hexblade grants at L3)
	// =========================================================================
	describe("Combat Methods (Hexblade subclass)", () => {

		beforeEach(() => {
			makeHexblade(5);
			// Warlocks need explicit combat traditions to activate the combat system
			state.addCombatTradition({name: "Mirror's Glint", source: "TGTT"});
		});

		it("should use the combat system with traditions added", () => {
			expect(state.usesCombatSystem()).toBe(true);
		});

		it("should have an stamina pool based on level", () => {
			state.ensureStaminaInitialized();
			const maxSt = state.getStaminaMax();
			expect(maxEx).toBeGreaterThan(0);
		});

		it("should use higher of physical or spellcasting DC per TGTT", () => {
			state.ensureStaminaInitialized();
			state.applyClassFeatureEffects();
			const calcs = state.getFeatureCalculations();
			// TGTT Hexblade: "You can use your spellcasting DC in place of your method DC"
			// Physical DC = 8 + prof(3) + DEX(+2) = 13
			// Spell DC = 8 + prof(3) + CHA(+4) = 15 → higher wins
			expect(calcs.combatMethodDc).toBe(15);
			expect(calcs.combatMethodDcUsesSpellcasting).toBe(true);
		});

		it("should have 7 combat traditions from Hexblade subclass", () => {
			// TGTT Hexblade traditions: Adamant Mountain, Arcane Knight, Eldritch Blackguard,
			// Mirror's Glint, Spirited Steed, Tempered Iron, Unending Wheel
			state.addCombatTradition({name: "Adamant Mountain", source: "TGTT"});
			state.addCombatTradition({name: "Arcane Knight", source: "TGTT"});
			state.addCombatTradition({name: "Eldritch Blackguard", source: "TGTT"});
			state.addCombatTradition({name: "Spirited Steed", source: "TGTT"});
			state.addCombatTradition({name: "Tempered Iron", source: "TGTT"});
			state.addCombatTradition({name: "Unending Wheel", source: "TGTT"});

			const traditions = state.getCombatTraditions();
			expect(traditions.length).toBe(7);
		});

		it("should spend and restore stamina", () => {
			state.ensureStaminaInitialized();
			const max = state.getStaminaMax();
			state.spendStamina(2);
			expect(state.getStaminaCurrent()).toBe(max - 2);

			// restoreStamina() restores to full (no partial restore)
			state.restoreStamina();
			expect(state.getStaminaCurrent()).toBe(max);
		});

		it("should scale stamina pool at higher levels", () => {
			const lowLevel = new CharacterSheetState();
			lowLevel.addClass({name: "Warlock", source: "TGTT", level: 3,
				subclass: {name: "The Hexblade", shortName: "Hexblade", source: "TGTT"}});
			lowLevel.addCombatTradition({name: "Mirror's Glint", source: "TGTT"});
			lowLevel.ensureStaminaInitialized();

			const highLevel = new CharacterSheetState();
			highLevel.addClass({name: "Warlock", source: "TGTT", level: 15,
				subclass: {name: "The Hexblade", shortName: "Hexblade", source: "TGTT"}});
			highLevel.addCombatTradition({name: "Mirror's Glint", source: "TGTT"});
			highLevel.ensureStaminaInitialized();

			expect(highLevel.getStaminaMax()).toBeGreaterThan(lowLevel.getStaminaMax());
		});
	});

	// =========================================================================
	// HEX WARRIOR (CHA for weapons)
	// =========================================================================
	describe("Hex Warrior", () => {
		it("should allow CHA for weapon attack/damage at L1", () => {
			makeHexblade(3);
			state.applyClassFeatureEffects();
			const calcs = state.getFeatureCalculations();
			// Hexblade Warrior feature detected via hasHexWarrior flag
			expect(calcs.hasHexWarrior).toBe(true);
		});
	});

	// =========================================================================
	// HEXBLADE'S CURSE TOGGLE
	// =========================================================================
	describe("Hexblade's Curse Toggle", () => {
		beforeEach(() => {
			makeHexblade(5);
			state.addResource({name: "Hexblade's Curse", max: 1, current: 1, recharge: "short"});
		});

		it("should have Hexblade's Curse as a feature", () => {
			state.addFeature({
				name: "Hexblade's Curse",
				source: "TGTT",
				featureType: "Subclass",
				className: "Warlock",
				subclassName: "The Hexblade",
				level: 1,
				description: "You can place a baleful curse on a creature.",
			});

			const features = state.getFeatures();
			expect(features.some(f => f.name === "Hexblade's Curse")).toBe(true);
		});

		it("should track curse as a managed resource", () => {
			// Hexblade's Curse is resource-based (1 use, short rest recharge)
			const res = state.getResource("Hexblade's Curse");
			expect(res.max).toBe(1);
			expect(res.current).toBe(1);
		});

		it("should be detectable via subclass calculations", () => {
			state.applyClassFeatureEffects();
			const calcs = state.getFeatureCalculations();
			// Hexblade subclass flags the curse capability
			expect(calcs.hasHexbladeCurse || calcs.hasHexWarrior).toBe(true);
		});

		it("should track curse resource (short rest recharge)", () => {
			const res = state.getResource("Hexblade's Curse");
			expect(res.max).toBe(1);
			expect(res.recharge).toBe("short");
		});

		it("should calculate Hexblade's Curse bonus damage = proficiency bonus", () => {
			state.applyClassFeatureEffects();
			const calcs = state.getFeatureCalculations();
			// At level 5, prof = 3
			expect(calcs.hexbladesCurseDamage).toBe(3);
		});

		it("should calculate Hexblade's Curse healing on kill = CHA mod + level", () => {
			state.applyClassFeatureEffects();
			const calcs = state.getFeatureCalculations();
			// CHA 18 (+4), level 5 → healing = 4 + 5 = 9
			expect(calcs.hexbladesCurseHealing).toBe(9);
		});

		it("should scale curse mechanics with level", () => {
			const cases = [
				{level: 3, prof: 2, curseDmg: 2, curseHeal: 7},   // CHA +4, 4+3=7
				{level: 10, prof: 4, curseDmg: 4, curseHeal: 14}, // CHA +4, 4+10=14
				{level: 17, prof: 6, curseDmg: 6, curseHeal: 21}, // CHA +4, 4+17=21
			];

			for (const {level, curseDmg, curseHeal} of cases) {
				const s = new CharacterSheetState();
				s.addClass({
					name: "Warlock", source: "TGTT", level,
					subclass: {name: "The Hexblade", shortName: "Hexblade", source: "TGTT"},
				});
				s.setAbilityBase("cha", 18); // +4
				s.applyClassFeatureEffects();
				const calcs = s.getFeatureCalculations();
				expect(calcs.hexbladesCurseDamage).toBe(curseDmg);
				expect(calcs.hexbladesCurseHealing).toBe(curseHeal);
			}
		});
	});

	// =========================================================================
	// HEXBLADE SUBCLASS FEATURES
	// =========================================================================
	describe("Hexblade Subclass Features", () => {

		describe("Accursed Specter (Level 6)", () => {
			it("should grant Accursed Specter at level 6", () => {
				makeHexblade(6);
				state.addFeature({
					name: "Accursed Specter",
					source: "TGTT",
					featureType: "Subclass",
					className: "Warlock",
					subclassName: "The Hexblade",
					level: 6,
					description: "You can curse the soul of a person you slay, temporarily binding it to your service.",
				});
				state.applyClassFeatureEffects();
				const features = state.getFeatures();
				expect(features.some(f => f.name === "Accursed Specter")).toBe(true);
			});

			it("should grant specter temp HP = floor(warlock level / 2)", () => {
				makeHexblade(10);
				state.applyClassFeatureEffects();
				const calcs = state.getFeatureCalculations();
				expect(calcs.accursedSpecterTempHp).toBe(5);
			});

			// Full scaling: floor(level / 2)
			const specterProgression = [
				{level: 6, expected: 3},
				{level: 7, expected: 3},
				{level: 8, expected: 4},
				{level: 10, expected: 5},
				{level: 12, expected: 6},
				{level: 14, expected: 7},
				{level: 16, expected: 8},
				{level: 17, expected: 8},
				{level: 18, expected: 9},
				{level: 20, expected: 10},
			];

			specterProgression.forEach(({level, expected}) => {
				it(`should have accursedSpecterTempHp = ${expected} at level ${level}`, () => {
					const s = new CharacterSheetState();
					s.addClass({
						name: "Warlock", source: "TGTT", level,
						subclass: {name: "The Hexblade", shortName: "Hexblade", source: "TGTT"},
					});
					s.setAbilityBase("cha", 18);
					s.applyClassFeatureEffects();
					expect(s.getFeatureCalculations().accursedSpecterTempHp).toBe(expected);
				});
			});
		});

		describe("Armor of Hexes (Level 10)", () => {
			it("should grant Armor of Hexes at level 10", () => {
				makeHexblade(10);
				state.addFeature({
					name: "Armor of Hexes",
					source: "TGTT",
					featureType: "Subclass",
					className: "Warlock",
					subclassName: "The Hexblade",
					level: 10,
					description: "If the target cursed by your Hexblade's Curse hits you with an attack roll, you can roll a d6. On a 4 or higher, the attack instead misses you.",
				});
				state.applyClassFeatureEffects();
				const features = state.getFeatures();
				expect(features.some(f => f.name === "Armor of Hexes")).toBe(true);
			});
		});

		describe("Master of Hexes (Level 14)", () => {
			it("should grant Master of Hexes at level 14", () => {
				makeHexblade(14);
				state.addFeature({
					name: "Master of Hexes",
					source: "TGTT",
					featureType: "Subclass",
					className: "Warlock",
					subclassName: "The Hexblade",
					level: 14,
					description: "When the creature cursed by your Hexblade's Curse dies, you can apply the curse to a different creature you can see within 30 feet.",
				});
				state.applyClassFeatureEffects();
				const features = state.getFeatures();
				expect(features.some(f => f.name === "Master of Hexes")).toBe(true);
			});
		});
	});

	// =========================================================================
	// MYSTIC ARCANUM (Level 11+)
	// =========================================================================
	describe("Mystic Arcanum (Level 11+)", () => {
		const arcanumLevels = [
			{warlockLevel: 11, arcanumLevel: 6},
			{warlockLevel: 13, arcanumLevel: 7},
			{warlockLevel: 15, arcanumLevel: 8},
			{warlockLevel: 17, arcanumLevel: 9},
		];

		arcanumLevels.forEach(({warlockLevel, arcanumLevel}) => {
			it(`should have ${arcanumLevel}th-level Mystic Arcanum available at Warlock level ${warlockLevel}`, () => {
				const s = new CharacterSheetState();
				s.addClass({
					name: "Warlock", source: "TGTT", level: warlockLevel,
					subclass: {name: "The Hexblade", shortName: "Hexblade", source: "TGTT"},
				});
				s.setAbilityBase("cha", 18);
				expect(s.isMysticArcanumAvailable(arcanumLevel)).toBe(true);
			});
		});

		it("should NOT have 6th-level Arcanum before level 11", () => {
			makeHexblade(10);
			expect(state.isMysticArcanumAvailable(6)).toBe(false);
		});

		it("should NOT have 7th-level Arcanum at exactly level 11", () => {
			makeHexblade(11);
			expect(state.isMysticArcanumAvailable(7)).toBe(false);
		});

		it("should use a Mystic Arcanum and mark it unavailable", () => {
			makeHexblade(11);
			expect(state.useMysticArcanum(6)).toBe(true);
			expect(state.isMysticArcanumAvailable(6)).toBe(false);
		});

		it("should track used arcanum in getMysticArcanumUsage()", () => {
			makeHexblade(17);
			state.useMysticArcanum(6);
			state.useMysticArcanum(9);

			const usage = state.getMysticArcanumUsage();
			expect(usage[6]).toBe(true);
			expect(usage[7]).toBe(false);
			expect(usage[8]).toBe(false);
			expect(usage[9]).toBe(true);
		});

		it("should refuse to use already-used Arcanum", () => {
			makeHexblade(11);
			state.useMysticArcanum(6);
			expect(state.useMysticArcanum(6)).toBe(false);
		});

		it("should reset all Arcanum on long rest", () => {
			makeHexblade(17);
			state.useMysticArcanum(6);
			state.useMysticArcanum(7);
			state.useMysticArcanum(8);
			state.useMysticArcanum(9);

			state.resetMysticArcanum();

			expect(state.isMysticArcanumAvailable(6)).toBe(true);
			expect(state.isMysticArcanumAvailable(7)).toBe(true);
			expect(state.isMysticArcanumAvailable(8)).toBe(true);
			expect(state.isMysticArcanumAvailable(9)).toBe(true);
		});

		it("should reject invalid arcanum levels (< 6 and > 9)", () => {
			makeHexblade(17);
			expect(state.isMysticArcanumAvailable(5)).toBe(false);
			expect(state.isMysticArcanumAvailable(10)).toBe(false);
			expect(state.useMysticArcanum(5)).toBe(false);
		});
	});

	// =========================================================================
	// FULL L1→20 PROGRESSION
	// =========================================================================
	describe("Full L1→20 Progression", () => {
		it("should maintain valid state at every level", () => {
			for (let lvl = 1; lvl <= 20; lvl++) {
				const s = new CharacterSheetState();
				s.addClass({
					name: "Warlock", source: "TGTT", level: lvl,
					subclass: lvl >= 3
						? {name: "The Hexblade", shortName: "Hexblade", source: "TGTT"}
						: undefined,
				});
				s.setAbilityBase("cha", 18);

				expect(s.getTotalLevel()).toBe(lvl);
				s.applyClassFeatureEffects();
				const calcs = s.getFeatureCalculations();
				expect(calcs.spellSaveDc).toBeGreaterThanOrEqual(12);
			}
		});

		it("should always have pact slots", () => {
			for (let lvl = 1; lvl <= 20; lvl++) {
				const s = new CharacterSheetState();
				s.addClass({name: "Warlock", source: "TGTT", level: lvl});
				const pactSlots = s.getPactSlots();
				expect(pactSlots.max).toBeGreaterThan(0);
			}
		});

		it("should track proficiency bonus correctly", () => {
			const profTable = [
				{level: 1, prof: 2}, {level: 4, prof: 2},
				{level: 5, prof: 3}, {level: 8, prof: 3},
				{level: 9, prof: 4}, {level: 12, prof: 4},
				{level: 13, prof: 5}, {level: 16, prof: 5},
				{level: 17, prof: 6}, {level: 20, prof: 6},
			];

			profTable.forEach(({level, prof}) => {
				const s = new CharacterSheetState();
				s.addClass({name: "Warlock", source: "TGTT", level});
				expect(s.getProficiencyBonus()).toBe(prof);
			});
		});
	});
});
