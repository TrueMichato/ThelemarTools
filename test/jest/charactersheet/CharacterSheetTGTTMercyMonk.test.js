/**
 * TGTT Way of Mercy (Warrior of Mercy) Monk — Full L1→20 test coverage.
 *
 * Covers:
 * - Monk Specialties at 2,4,6,8,10,12,14,16,18,20
 * - Combat Methods at L2 (2 traditions + Sanguine Knot from subclass at L3)
 * - Focus→Stamina conversion (Monk special rule)
 * - WIS-based method DC with +1 Monk bonus
 * - Unhindered Flurry at L8 (TGTT)
 * - Way of Mercy subclass features:
 *     Hand of Harm/Healing (L3), Physician's Touch (L6),
 *     Flurry of Healing and Harm (L11), Hand of Ultimate Mercy (L17)
 * - Ki/Focus point tracking and resource economy
 */

import "./setup.js";

let CharacterSheetState;
let state;

beforeAll(async () => {
	CharacterSheetState = (await import("../../../js/charactersheet/charactersheet-state.js")).CharacterSheetState;
});

describe("TGTT Way of Mercy Monk", () => {

	beforeEach(() => {
		state = new CharacterSheetState();
	});

	// =========================================================================
	// HELPER
	// =========================================================================
	function makeMercyMonk (level) {
		state.addClass({
			name: "Monk",
			source: "TGTT",
			level,
			subclass: level >= 3
				? {name: "Warrior of Mercy", shortName: "Mercy", source: "TGTT"}
				: undefined,
		});
		state.setAbilityBase("str", 10);
		state.setAbilityBase("dex", 18); // +4
		state.setAbilityBase("con", 14); // +2
		state.setAbilityBase("int", 10);
		state.setAbilityBase("wis", 16); // +3
		state.setAbilityBase("cha", 8);
	}

	// =========================================================================
	// CORE CLASS SETUP
	// =========================================================================
	describe("Core Class Setup", () => {
		it("should create a TGTT Monk", () => {
			makeMercyMonk(1);
			const classes = state.getClasses();
			expect(classes.length).toBe(1);
			expect(classes[0].name).toBe("Monk");
			expect(classes[0].source).toBe("TGTT");
		});

		it("should recognise the Mercy subclass at level 3", () => {
			makeMercyMonk(3);
			const classes = state.getClasses();
			expect(classes[0].subclass).toBeDefined();
			expect(classes[0].subclass.shortName).toBe("Mercy");
		});

		it("should track Ki/Focus points equal to Monk level", () => {
			makeMercyMonk(5);
			state.setKiPoints(5);
			state.setKiPointsCurrent(5);
			expect(state.getKiPoints()).toBe(5);
			expect(state.getKiPointsCurrent()).toBe(5);
		});
	});

	// =========================================================================
	// COMBAT METHODS
	// =========================================================================
	describe("Combat Methods System", () => {
		beforeEach(() => {
			makeMercyMonk(5);
			state.addCombatTradition("Unarmored Combat");
			state.addCombatTradition("SK"); // Sanguine Knot (from Mercy subclass at L3)
			state.ensureStaminaInitialized();
		});

		it("should use the combat system", () => {
			expect(state.usesCombatSystem()).toBe(true);
		});

		it("should have stamina pool = 2 × proficiency bonus", () => {
			// Level 5 → prof +3 → stamina = 6
			expect(state.getStaminaMax()).toBe(6);
		});

		it("should track Sanguine Knot tradition from Mercy subclass", () => {
			const traditions = state.getCombatTraditions();
			expect(traditions).toContain("SK");
		});

		it("should allow Focus→Stamina conversion for TGTT Monks", () => {
			state.setKiPoints(5);
			state.setKiPointsCurrent(5);
			expect(state.canUseFocusForStamina()).toBe(true);
		});

		it("should spend Ki when converting Focus to Stamina", () => {
			state.setKiPoints(5);
			state.setKiPointsCurrent(5);

			const result = state.useFocusForStamina(2);
			expect(result).toBe(true);
			expect(state.getKiPointsCurrent()).toBe(3);
		});

		it("should not affect stamina pool when using Focus for Stamina", () => {
			state.setKiPoints(5);
			state.setKiPointsCurrent(5);
			const initialStamina = state.getStaminaCurrent();

			state.useFocusForStamina(2);
			expect(state.getStaminaCurrent()).toBe(initialStamina);
		});

		it("should fail Focus→Stamina if insufficient Ki", () => {
			state.setKiPoints(5);
			state.setKiPointsCurrent(1);

			const result = state.useFocusForStamina(3);
			expect(result).toBe(false);
			expect(state.getKiPointsCurrent()).toBe(1);
		});

		it("should scale stamina across levels", () => {
			const cases = [
				{level: 2, expected: 4},   // prof +2
				{level: 5, expected: 6},   // prof +3
				{level: 9, expected: 8},   // prof +4
				{level: 13, expected: 10}, // prof +5
				{level: 17, expected: 12}, // prof +6
			];

			for (const {level, expected} of cases) {
				const s = new CharacterSheetState();
				s.addClass({name: "Monk", source: "TGTT", level});
				s.addCombatTradition("SK");
				s.ensureStaminaInitialized();
				expect(s.getStaminaMax()).toBe(expected);
			}
		});
	});

	// =========================================================================
	// COMBAT METHOD DC (Monk special: base 9, WIS-based)
	// =========================================================================
	describe("Combat Method DC", () => {
		it("should calculate DC = 9 + prof + max(STR, DEX, WIS) for TGTT Monk", () => {
			makeMercyMonk(5);
			state.addCombatTradition("SK");
			state.applyClassFeatureEffects();

			const calcs = state.getFeatureCalculations();
			// Monk DC base is 9 (not 8). DEX +4, WIS +3, prof +3 → 9 + 3 + 4 = 16
			expect(calcs.combatMethodDc).toBe(16);
			expect(calcs.monkCombatMethodDcBonus).toBe(true);
		});

		it("should scale DC with proficiency and ability increases", () => {
			const s = new CharacterSheetState();
			s.addClass({
				name: "Monk", source: "TGTT", level: 9,
				subclass: {name: "Warrior of Mercy", shortName: "Mercy", source: "TGTT"},
			});
			s.setAbilityBase("dex", 18); // +4
			s.setAbilityBase("wis", 18); // +4
			s.addCombatTradition("SK");
			s.applyClassFeatureEffects();

			const calcs = s.getFeatureCalculations();
			// DC = 9 + prof(4) + max(DEX +4, WIS +4) = 17
			expect(calcs.combatMethodDc).toBe(17);
		});
	});

	// =========================================================================
	// MARTIAL ARTS DIE SCALING
	// =========================================================================
	describe("Martial Arts Die", () => {
		const dieLevels = [
			{level: 1, die: "1d6"},
			{level: 4, die: "1d6"},
			{level: 5, die: "1d8"},
			{level: 10, die: "1d8"},
			{level: 11, die: "1d10"},
			{level: 16, die: "1d10"},
			{level: 17, die: "1d12"},
			{level: 20, die: "1d12"},
		];

		dieLevels.forEach(({level, die}) => {
			it(`should have Martial Arts die ${die} at level ${level}`, () => {
				const s = new CharacterSheetState();
				s.addClass({name: "Monk", source: "TGTT", level});
				const calcs = s.getFeatureCalculations();
				expect(calcs.martialArtsDie).toBe(die);
			});
		});
	});

	// =========================================================================
	// MONK SPECIALTIES (TGTT-specific)
	// =========================================================================
	describe("Monk (TGTT) Specialties", () => {
		it("should accept Specialty features at even levels 2-20", () => {
			makeMercyMonk(20);
			const specialtyLevels = [2, 4, 6, 8, 10, 12, 14, 16, 18, 20];
			specialtyLevels.forEach(lvl => {
				state.addFeature({
					name: `Monk Specialty (Lv ${lvl})`,
					source: "TGTT",
					featureType: "Class",
					className: "Monk",
					level: lvl,
					description: `Monk specialty at level ${lvl}.`,
				});
			});

			state.applyClassFeatureEffects();
			const features = state.getFeatures();
			specialtyLevels.forEach(lvl => {
				expect(features.some(f => f.name === `Monk Specialty (Lv ${lvl})`)).toBe(true);
			});
		});
	});

	// =========================================================================
	// SUBCLASS FEATURES
	// =========================================================================
	describe("Way of Mercy SubclassFeatures", () => {

		describe("Hand of Healing / Hand of Harm (Level 3)", () => {
			it("should grant Hand of Healing at level 3", () => {
				makeMercyMonk(3);
				state.addFeature({
					name: "Hand of Healing",
					source: "TGTT",
					featureType: "Subclass",
					className: "Monk",
					subclassName: "Warrior of Mercy",
					level: 3,
					description: "You can spend 1 ki point to touch a creature and restore hit points equal to a roll of your Martial Arts die + WIS modifier.",
				});
				state.applyClassFeatureEffects();
				const features = state.getFeatures();
				expect(features.some(f => f.name === "Hand of Healing")).toBe(true);
			});

			it("should grant Hand of Harm at level 3", () => {
				makeMercyMonk(3);
				state.addFeature({
					name: "Hand of Harm",
					source: "TGTT",
					featureType: "Subclass",
					className: "Monk",
					subclassName: "Warrior of Mercy",
					level: 3,
					description: "When you hit a creature with an unarmed strike, you can spend 1 ki point to deal extra necrotic damage equal to one roll of your Martial Arts die + WIS modifier.",
				});
				state.applyClassFeatureEffects();
				const features = state.getFeatures();
				expect(features.some(f => f.name === "Hand of Harm")).toBe(true);
			});
		});

		// =================================================================
		// HAND OF HEALING / HARM SCALING (martial arts die + WIS mod)
		// =================================================================
		describe("Hand of Healing Amount Scaling", () => {
			// TGTT Monk martial arts die: 1d6(<5), 1d8(5-10), 1d10(11-16), 1d12(17+)
			// WIS 16 = +3 (but at level 20, Body and Mind adds +4 → WIS 20 = +5)
			const healingProgression = [
				{level: 3, expected: "1d6+3"},
				{level: 4, expected: "1d6+3"},
				{level: 5, expected: "1d8+3"},
				{level: 10, expected: "1d8+3"},
				{level: 11, expected: "1d10+3"},
				{level: 16, expected: "1d10+3"},
				{level: 17, expected: "1d12+3"},
				{level: 20, expected: "1d12+5"},
			];

			healingProgression.forEach(({level, expected}) => {
				it(`should compute handOfHealingAmount = "${expected}" at level ${level}`, () => {
					const s = new CharacterSheetState();
					s.addClass({
						name: "Monk", source: "TGTT", level,
						subclass: {name: "Warrior of Mercy", shortName: "Mercy", source: "TGTT"},
					});
					s.setAbilityBase("wis", 16); // +3
					const calcs = s.getFeatureCalculations();
					expect(calcs.handOfHealingAmount).toBe(expected);
				});
			});
		});

		describe("Hand of Harm Damage Scaling", () => {
			const harmProgression = [
				{level: 3, expected: "1d6+3"},
				{level: 5, expected: "1d8+3"},
				{level: 11, expected: "1d10+3"},
				{level: 17, expected: "1d12+3"},
			];

			harmProgression.forEach(({level, expected}) => {
				it(`should compute handOfHarmDamage = "${expected}" at level ${level}`, () => {
					const s = new CharacterSheetState();
					s.addClass({
						name: "Monk", source: "TGTT", level,
						subclass: {name: "Warrior of Mercy", shortName: "Mercy", source: "TGTT"},
					});
					s.setAbilityBase("wis", 16); // +3
					const calcs = s.getFeatureCalculations();
					expect(calcs.handOfHarmDamage).toBe(expected);
				});
			});
		});

		describe("Physician's Touch (Level 6)", () => {
			it("should grant Physician's Touch at level 6", () => {
				makeMercyMonk(6);
				state.addFeature({
					name: "Physician's Touch",
					source: "TGTT",
					featureType: "Subclass",
					className: "Monk",
					subclassName: "Warrior of Mercy",
					level: 6,
					description: "Your Hand of Healing can end one disease or one of the following conditions: blinded, deafened, paralyzed, poisoned, or stunned.",
				});
				state.applyClassFeatureEffects();
				const features = state.getFeatures();
				expect(features.some(f => f.name === "Physician's Touch")).toBe(true);
			});
		});

		describe("Unhindered Flurry (Level 8 — TGTT-specific)", () => {
			it("should grant Unhindered Flurry at level 8", () => {
				makeMercyMonk(8);
				state.addFeature({
					name: "Unhindered Flurry",
					source: "TGTT",
					featureType: "Class",
					className: "Monk",
					level: 8,
					description: "Your Flurry of Blows is no longer limited to unarmed strikes.",
				});
				state.applyClassFeatureEffects();
				const features = state.getFeatures();
				expect(features.some(f => f.name === "Unhindered Flurry")).toBe(true);
			});
		});

		describe("Flurry of Healing and Harm (Level 11)", () => {
			it("should grant Flurry of Healing and Harm at level 11", () => {
				makeMercyMonk(11);
				state.addFeature({
					name: "Flurry of Healing and Harm",
					source: "TGTT",
					featureType: "Subclass",
					className: "Monk",
					subclassName: "Warrior of Mercy",
					level: 11,
					description: "When you use Flurry of Blows, you can replace each unarmed strike with a use of Hand of Healing without spending ki.",
				});
				state.applyClassFeatureEffects();
				const features = state.getFeatures();
				expect(features.some(f => f.name === "Flurry of Healing and Harm")).toBe(true);
			});
		});

		describe("Hand of Ultimate Mercy (Level 17)", () => {
			it("should grant Hand of Ultimate Mercy at level 17", () => {
				makeMercyMonk(17);
				state.addFeature({
					name: "Hand of Ultimate Mercy",
					source: "TGTT",
					featureType: "Subclass",
					className: "Monk",
					subclassName: "Warrior of Mercy",
					level: 17,
					description: "You can spend 5 ki points to touch the corpse of a creature that died within the past 24 hours and return it to life.",
				});
				state.applyClassFeatureEffects();
				const features = state.getFeatures();
				expect(features.some(f => f.name === "Hand of Ultimate Mercy")).toBe(true);
			});

			it("should track Hand of Ultimate Mercy resource (once per long rest)", () => {
				makeMercyMonk(17);
				state.addResource({name: "Hand of Ultimate Mercy", max: 1, current: 1, recharge: "long"});

				const res = state.getResource("Hand of Ultimate Mercy");
				expect(res.max).toBe(1);
				expect(res.recharge).toBe("long");
			});

			it("should compute handOfUltimateMercyCost = 5", () => {
				makeMercyMonk(17);
				const calcs = state.getFeatureCalculations();
				expect(calcs.handOfUltimateMercyCost).toBe(5);
			});
		});
	});

	// =========================================================================
	// IMPLEMENTS OF MERCY — Proficiency Grants (Phase 4)
	// =========================================================================
	describe("Implements of Mercy (Level 3 proficiency grants)", () => {
		it("should set hasImplementsOfMercy flag at level 3", () => {
			makeMercyMonk(3);
			const calcs = state.getFeatureCalculations();
			expect(calcs.hasImplementsOfMercy).toBe(true);
		});

		it("should grant Insight proficiency via effects", () => {
			makeMercyMonk(3);
			state.applyClassFeatureEffects();
			expect(state.isProficientInSkill("insight")).toBe(true);
		});

		it("should grant Medicine proficiency via effects", () => {
			makeMercyMonk(3);
			state.applyClassFeatureEffects();
			expect(state.isProficientInSkill("medicine")).toBe(true);
		});

		it("should grant Herbalism Kit proficiency via effects", () => {
			makeMercyMonk(3);
			state.applyClassFeatureEffects();
			const toolProfs = state.getToolProficiencies();
			expect(toolProfs.some(t => t.toLowerCase().includes("herbalism"))).toBe(true);
		});

		it("should not double-add proficiencies on repeated applyClassFeatureEffects", () => {
			makeMercyMonk(3);
			state.applyClassFeatureEffects();
			state.applyClassFeatureEffects();
			const toolProfs = state.getToolProficiencies();
			const herbCount = toolProfs.filter(t => t.toLowerCase().includes("herbalism")).length;
			expect(herbCount).toBe(1);
		});

		it("should not override existing higher proficiency level", () => {
			makeMercyMonk(3);
			// Set expertise in insight before applying effects
			state.setSkillProficiency("insight", 2);
			state.applyClassFeatureEffects();
			expect(state.getSkillProficiency("insight")).toBe(2);
		});

		it("should persist proficiencies at higher levels", () => {
			makeMercyMonk(17);
			state.applyClassFeatureEffects();
			expect(state.isProficientInSkill("insight")).toBe(true);
			expect(state.isProficientInSkill("medicine")).toBe(true);
			const toolProfs = state.getToolProficiencies();
			expect(toolProfs.some(t => t.toLowerCase().includes("herbalism"))).toBe(true);
		});
	});

	// =========================================================================
	// PHYSICIAN'S TOUCH — Condition Cure Details (Phase 4)
	// =========================================================================
	describe("Physician's Touch Conditions (Level 6)", () => {
		it("should set physiciansTouchConditions at level 6", () => {
			makeMercyMonk(6);
			const calcs = state.getFeatureCalculations();
			expect(calcs.hasPhysiciansTouch).toBe(true);
			expect(calcs.physiciansTouchConditions).toEqual(
				expect.arrayContaining(["blinded", "deafened", "paralyzed", "poisoned", "stunned"]),
			);
		});

		it("should have exactly 5 conditions", () => {
			makeMercyMonk(6);
			const calcs = state.getFeatureCalculations();
			expect(calcs.physiciansTouchConditions).toHaveLength(5);
		});

		it("should not have physiciansTouchConditions before level 6", () => {
			makeMercyMonk(5);
			const calcs = state.getFeatureCalculations();
			expect(calcs.hasPhysiciansTouch).toBeUndefined();
			expect(calcs.physiciansTouchConditions).toBeUndefined();
		});

		it("should retain conditions at level 17", () => {
			makeMercyMonk(17);
			const calcs = state.getFeatureCalculations();
			expect(calcs.hasPhysiciansTouch).toBe(true);
			expect(calcs.physiciansTouchConditions).toHaveLength(5);
		});
	});

	// =========================================================================
	// FLURRY OF HEALING AND HARM — Flag Verification (Phase 4)
	// =========================================================================
	describe("Flurry of Healing and Harm Flag", () => {
		it("should not grant Flurry of Healing and Harm before level 11", () => {
			makeMercyMonk(10);
			const calcs = state.getFeatureCalculations();
			expect(calcs.hasFlurryOfHealingAndHarm).toBeUndefined();
		});

		it("should grant Flurry of Healing and Harm at level 11", () => {
			makeMercyMonk(11);
			const calcs = state.getFeatureCalculations();
			expect(calcs.hasFlurryOfHealingAndHarm).toBe(true);
		});

		it("should retain Flurry of Healing and Harm at level 20", () => {
			makeMercyMonk(20);
			const calcs = state.getFeatureCalculations();
			expect(calcs.hasFlurryOfHealingAndHarm).toBe(true);
		});
	});

	// =========================================================================
	// FOCUS→EXERTION CONVERSION (Phase 4 — Verification)
	// =========================================================================
	describe("Focus→Stamina Conversion", () => {
		it("should allow Focus→Stamina for Monk", () => {
			makeMercyMonk(5);
			state.addCombatTradition("SK");
			state.ensureStaminaInitialized();
			state.setKiPoints(5);
			state.setKiPointsCurrent(5);
			expect(state.canUseFocusForStamina()).toBe(true);
		});

		it("should deduct ki when converting Focus→Stamina", () => {
			makeMercyMonk(5);
			state.addCombatTradition("SK");
			state.ensureStaminaInitialized();
			state.setKiPoints(5);
			state.setKiPointsCurrent(5);
			state.useFocusForStamina(2);
			expect(state.getKiPointsCurrent()).toBe(3);
		});

		it("should fail conversion if no ki points remain", () => {
			makeMercyMonk(5);
			state.addCombatTradition("SK");
			state.ensureStaminaInitialized();
			state.setKiPoints(5);
			state.setKiPointsCurrent(0);
			expect(state.useFocusForStamina(1)).toBe(false);
		});
	});

	// =========================================================================
	// COMBAT METHOD DEGREE PROGRESSION (Monk schedule)
	// =========================================================================
	describe("Combat Method Degree Progression", () => {
		// Monk: L2→1st, L4→2nd, L8→3rd, L13→4th, L17→5th
		const degreeProgression = [
			{level: 1, expected: 0},
			{level: 2, expected: 1},
			{level: 3, expected: 1},
			{level: 4, expected: 2},
			{level: 7, expected: 2},
			{level: 8, expected: 3},
			{level: 12, expected: 3},
			{level: 13, expected: 4},
			{level: 16, expected: 4},
			{level: 17, expected: 5},
			{level: 20, expected: 5},
		];

		degreeProgression.forEach(({level, expected}) => {
			it(`should have degree ${expected} access at Monk level ${level}`, () => {
				const s = new CharacterSheetState();
				s.addClass({name: "Monk", source: "TGTT", level});
				s.addCombatTradition("SK");
				expect(s.getMethodDegreeAccess()).toBe(expected);
			});
		});
	});

	// =========================================================================
	// EXERTION RESOURCES API
	// =========================================================================
	describe("Stamina Resources API", () => {
		it("should return correct resource summary for Mercy Monk", () => {
			makeMercyMonk(5);
			state.addCombatTradition("SK");
			state.setKiPoints(5);
			state.setKiPointsCurrent(5);
			state.ensureStaminaInitialized();

			const res = state.getStaminaResources();
			expect(res.stamina.available).toBe(true);
			expect(res.stamina.max).toBe(6); // 2 × prof
			expect(res.focus.available).toBe(true);
			expect(res.focus.current).toBe(5);
			expect(res.spellSlots.available).toBe(false); // Monks can't convert
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
					name: "Monk", source: "TGTT", level: lvl,
					subclass: lvl >= 3
						? {name: "Warrior of Mercy", shortName: "Mercy", source: "TGTT"}
						: undefined,
				});
				s.setAbilityBase("dex", 18);
				s.setAbilityBase("wis", 16);

				const classes = s.getClasses();
				expect(classes[0].level).toBe(lvl);
				expect(s.getTotalLevel()).toBe(lvl);
			}
		});

		it("should scale Ki/Focus points with level", () => {
			for (let lvl = 2; lvl <= 20; lvl++) {
				const s = new CharacterSheetState();
				s.addClass({name: "Monk", source: "TGTT", level: lvl});
				s.setKiPoints(lvl);
				expect(s.getKiPoints()).toBe(lvl);
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
				s.addClass({name: "Monk", source: "TGTT", level});
				expect(s.getProficiencyBonus()).toBe(prof);
			});
		});
	});
});
