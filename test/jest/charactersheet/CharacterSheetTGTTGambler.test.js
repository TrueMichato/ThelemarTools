/**
 * Tests for TGTT Gambler rogue subclass spellcasting and Gambler's Folly mechanics.
 *
 * The Gambler is a ROGUE subclass from Traveler's Guide to Thelemar (TGTT) that:
 * - Uses a unique "Gambler's Folly" mechanic where every leveled spell cast triggers a bet roll
 * - Has an increasing win chance as they level up (25% → 33% → 50%)
 * - Lost bets require rolling on a d100 "Gambling Table" with 100 different effects
 * - Gains "Extra Luck" (L9) and "Master of Fortune" (L17) features that interact with the d100 table
 */

import "./setup.js";

let CharacterSheetState;
let state;

beforeAll(async () => {
	CharacterSheetState = (await import("../../../js/charactersheet/charactersheet-state.js")).CharacterSheetState;
});

describe("TGTT Gambler Subclass", () => {
	beforeEach(() => {
		state = new CharacterSheetState();
	});

	// =========================================================================
	// GAMBLER SETUP HELPERS
	// =========================================================================

	const createGambler = (level = 3) => {
		state.addClass({
			name: "Rogue",
			source: "TGTT",
			level: level,
			subclass: {
				name: "Gambler",
				shortName: "Gambler",
				source: "TGTT",
			},
		});

		// Add Gambler's Folly feature (Level 3 - when subclass is gained)
		if (level >= 3) {
			state.addFeature({
				name: "Gambler's Folly",
				source: "TGTT",
				featureType: "Subclass",
				className: "Rogue",
				subclassShortName: "Gambler",
				level: 3,
				description: "Every time you cast a spell using a spell slot, roll a gambling dice.",
			});
		}

		// Apply effects to enable hasGamblerFolly
		state.applyClassFeatureEffects();
	};

	const createExtraLuckGambler = () => {
		createGambler(9);
		state.addFeature({
			name: "Extra Luck",
			source: "TGTT",
			featureType: "Subclass",
			className: "Rogue",
			subclassShortName: "Gambler",
			level: 9,
			description: "Starting at 9th level, as a bonus action, you can grant yourself advantage on any ability check, attack roll, or saving throw you make before the start of your next turn.",
		});
		state.applyClassFeatureEffects();
	};

	const createMasterGambler = () => {
		// Create at level 17 directly
		state.addClass({
			name: "Rogue",
			source: "TGTT",
			level: 17,
			subclass: {
				name: "Gambler",
				shortName: "Gambler",
				source: "TGTT",
			},
		});

		// Add all Gambler features
		state.addFeature({
			name: "Gambler's Folly",
			source: "TGTT",
			featureType: "Subclass",
			className: "Rogue",
			subclassShortName: "Gambler",
			level: 3,
			description: "Every time you cast a spell using a spell slot, roll a gambling dice.",
		});
		state.addFeature({
			name: "Extra Luck",
			source: "TGTT",
			featureType: "Subclass",
			className: "Rogue",
			subclassShortName: "Gambler",
			level: 9,
			description: "Starting at 9th level, as a bonus action, you can grant yourself advantage.",
		});
		state.addFeature({
			name: "Master of Fortune",
			source: "TGTT",
			featureType: "Subclass",
			className: "Rogue",
			subclassShortName: "Gambler",
			level: 17,
			description: "Beginning at 17th level, whenever you roll a natural 1, you may turn it into a natural 20.",
		});
		state.applyClassFeatureEffects();
	};

	// =========================================================================
	// GAMBLER'S FOLLY BASE MECHANICS
	// =========================================================================
	describe("Gambler's Folly Feature Detection", () => {
		it("should detect hasGamblerFolly for Gambler subclass", () => {
			createGambler(3);
			const calcs = state.getFeatureCalculations();
			expect(calcs.hasGamblerFolly).toBe(true);
		});

		it("should NOT have hasGamblerFolly for non-Gambler rogue", () => {
			state.addClass({
				name: "Rogue",
				source: "PHB",
				level: 3,
				subclass: {
					name: "Thief",
					shortName: "Thief",
					source: "PHB",
				},
			});
			state.applyClassFeatureEffects();

			const calcs = state.getFeatureCalculations();
			expect(calcs.hasGamblerFolly).toBeFalsy();
		});
	});

	// =========================================================================
	// BET ROLLING MECHANICS (based on SPELL SLOT LEVEL, not character level)
	// =========================================================================
	describe("Bet Rolling Mechanics", () => {
		describe("Spell Level 1-2: d4, lose on 4 (25% loss chance)", () => {
			it("should roll d4 for 1st level spells", () => {
				createGambler(3);
				const result = state.rollGamblerBet(1); // 1st level spell

				expect(result).not.toBeNull();
				expect(result.die).toBe(4);
				expect(result.roll).toBeGreaterThanOrEqual(1);
				expect(result.roll).toBeLessThanOrEqual(4);
			});

			it("should win on rolls 1-3 (d4)", () => {
				createGambler(3);

				// Mock RNG to test specific values
				const originalRandom = Math.random;

				// Roll = 1 (should win)
				Math.random = () => 0;
				expect(state.rollGamblerBet(1).won).toBe(true);

				// Roll = 3 (should win)
				Math.random = () => 0.6;
				expect(state.rollGamblerBet(1).won).toBe(true);

				// Roll = 4 (should lose)
				Math.random = () => 0.99;
				expect(state.rollGamblerBet(1).won).toBe(false);

				Math.random = originalRandom;
			});

			it("should roll d4 for 2nd level spells", () => {
				createGambler(5);
				const result = state.rollGamblerBet(2); // 2nd level spell
				expect(result.die).toBe(4);
			});
		});

		describe("Spell Level 3: d6, lose on 5-6 (33% loss chance)", () => {
			it("should roll d6 for 3rd level spells", () => {
				createGambler(7);
				const result = state.rollGamblerBet(3); // 3rd level spell

				expect(result).not.toBeNull();
				expect(result.die).toBe(6);
				expect(result.roll).toBeGreaterThanOrEqual(1);
				expect(result.roll).toBeLessThanOrEqual(6);
			});

			it("should win on rolls 1-4, lose on 5-6 (d6)", () => {
				createGambler(7);
				const originalRandom = Math.random;

				// Roll = 4 (should win)
				Math.random = () => 0.5;
				expect(state.rollGamblerBet(3).won).toBe(true);

				// Roll = 5 (should lose)
				Math.random = () => 0.7;
				expect(state.rollGamblerBet(3).won).toBe(false);

				// Roll = 6 (should lose)
				Math.random = () => 0.99;
				expect(state.rollGamblerBet(3).won).toBe(false);

				Math.random = originalRandom;
			});
		});

		describe("Spell Level 4+: d2, lose on 2 (50% loss chance)", () => {
			it("should roll d2 for 4th level spells", () => {
				createGambler(10);
				const result = state.rollGamblerBet(4); // 4th level spell

				expect(result).not.toBeNull();
				expect(result.die).toBe(2);
				expect(result.roll).toBeGreaterThanOrEqual(1);
				expect(result.roll).toBeLessThanOrEqual(2);
			});

			it("should roll d2 for higher level spells (5, 6, 7, 8, 9)", () => {
				createGambler(10);
				[5, 6, 7, 8, 9].forEach(spellLevel => {
					const result = state.rollGamblerBet(spellLevel);
					expect(result.die).toBe(2);
				});
			});

			it("should win on 1, lose on 2 (d2)", () => {
				createGambler(10);
				const originalRandom = Math.random;

				// Roll = 1 (should win)
				Math.random = () => 0;
				expect(state.rollGamblerBet(4).won).toBe(true);

				// Roll = 2 (should lose)
				Math.random = () => 0.99;
				expect(state.rollGamblerBet(4).won).toBe(false);

				Math.random = originalRandom;
			});
		});

		describe("Bet Tracking", () => {
			it("should track last bet result", () => {
				createGambler(5);

				state.rollGamblerBet(2);
				const lastBet = state.getGamblerLastBet();

				expect(lastBet).not.toBeNull();
				expect(lastBet.die).toBe(4);
				expect(lastBet.slotLevel).toBe(2);
				expect(typeof lastBet.won).toBe("boolean");
			});

			it("should calculate correct bet odds for each spell level", () => {
				createGambler(10);

				// Spell level 1-2: 25% loss (d4, lose on 4)
				expect(state.getGamblerBetOdds(1)).toEqual({
					winChance: 0.75,
					lossChance: 0.25,
					die: 4,
				});
				expect(state.getGamblerBetOdds(2)).toEqual({
					winChance: 0.75,
					lossChance: 0.25,
					die: 4,
				});

				// Spell level 3: 33% loss (d6, lose on 5-6)
				const odds3 = state.getGamblerBetOdds(3);
				expect(odds3.die).toBe(6);
				expect(odds3.lossChance).toBeCloseTo(0.333, 2);

				// Spell level 4+: 50% loss (d2, lose on 2)
				expect(state.getGamblerBetOdds(4)).toEqual({
					winChance: 0.5,
					lossChance: 0.5,
					die: 2,
				});
			});

			it("should return null for non-Gambler characters", () => {
				state.addClass({name: "Fighter", source: "PHB", level: 5});

				expect(state.rollGamblerBet(1)).toBeNull();
				expect(state.getGamblerLastBet()).toBeNull();
				expect(state.getGamblerBetOdds(1)).toBeNull();
			});
		});
	});

	// =========================================================================
	// GAMBLING TABLE MECHANICS
	// =========================================================================
	describe("Gambling Table (d100)", () => {
		it("should have GAMBLER_GAMBLING_TABLE constant with 100 entries", () => {
			expect(CharacterSheetState.GAMBLER_GAMBLING_TABLE).toBeDefined();
			expect(CharacterSheetState.GAMBLER_GAMBLING_TABLE.length).toBe(100);
		});

		it("should roll d100 on the Gambling Table", () => {
			createGambler(3);

			const result = state.rollGamblingTable();

			expect(result).not.toBeNull();
			expect(result.roll).toBeGreaterThanOrEqual(1);
			expect(result.roll).toBeLessThanOrEqual(100);
			expect(typeof result.effect).toBe("string");
			expect(result.effect.length).toBeGreaterThan(0);
		});

		it("should track last table roll", () => {
			createGambler(3);

			state.rollGamblingTable();
			const lastRoll = state.getGamblerLastTableRoll();

			expect(lastRoll).not.toBeNull();
			expect(lastRoll.roll).toBeGreaterThanOrEqual(1);
			expect(lastRoll.roll).toBeLessThanOrEqual(100);
			expect(typeof lastRoll.effect).toBe("string");
		});

		it("should return matching effect for each roll", () => {
			createGambler(3);
			const originalRandom = Math.random;

			// Test roll = 1
			Math.random = () => 0;
			const result1 = state.rollGamblingTable();
			expect(result1.roll).toBe(1);
			expect(result1.effect).toBe(CharacterSheetState.GAMBLER_GAMBLING_TABLE[0]);

			// Test roll = 50
			Math.random = () => 0.49;
			const result50 = state.rollGamblingTable();
			expect(result50.roll).toBe(50);
			expect(result50.effect).toBe(CharacterSheetState.GAMBLER_GAMBLING_TABLE[49]);

			// Test roll = 100
			Math.random = () => 0.99;
			const result100 = state.rollGamblingTable();
			expect(result100.roll).toBe(100);
			expect(result100.effect).toBe(CharacterSheetState.GAMBLER_GAMBLING_TABLE[99]);

			Math.random = originalRandom;
		});

		it("should return null for non-Gambler characters", () => {
			state.addClass({name: "Wizard", source: "PHB", level: 5});

			expect(state.rollGamblingTable()).toBeNull();
			expect(state.getGamblerLastTableRoll()).toBeNull();
		});
	});

	// =========================================================================
	// AUTO-ROLL SETTINGS
	// =========================================================================
	describe("Auto-Roll Settings", () => {
		it("should default to auto-roll disabled", () => {
			createGambler(3);
			expect(state.getGamblerAutoRollTable()).toBe(false);
		});

		it("should persist auto-roll setting", () => {
			createGambler(3);

			state.setGamblerAutoRollTable(true);
			expect(state.getGamblerAutoRollTable()).toBe(true);

			state.setGamblerAutoRollTable(false);
			expect(state.getGamblerAutoRollTable()).toBe(false);
		});

		it("should coerce values to boolean", () => {
			createGambler(3);

			state.setGamblerAutoRollTable(1);
			expect(state.getGamblerAutoRollTable()).toBe(true);

			state.setGamblerAutoRollTable(0);
			expect(state.getGamblerAutoRollTable()).toBe(false);

			state.setGamblerAutoRollTable("yes");
			expect(state.getGamblerAutoRollTable()).toBe(true);
		});

		it("should persist setting through save/load", () => {
			createGambler(3);
			state.setGamblerAutoRollTable(true);

			// Save and recreate
			const json = state.toJson();
			const newState = new CharacterSheetState();
			newState.loadFromJson(json);

			expect(newState.getGamblerAutoRollTable()).toBe(true);
		});
	});

	// =========================================================================
	// EXTRA LUCK (Level 9)
	// =========================================================================
	describe("Extra Luck (Level 9)", () => {
		it("should detect hasExtraLuck for L9+ Gambler", () => {
			createExtraLuckGambler();
			const calcs = state.getFeatureCalculations();
			expect(calcs.hasExtraLuck).toBe(true);
		});

		it("should NOT have hasExtraLuck before level 9", () => {
			createGambler(8);
			const calcs = state.getFeatureCalculations();
			expect(calcs.hasExtraLuck).toBeFalsy();
		});

		it("should have uses equal to proficiency bonus", () => {
			createExtraLuckGambler();
			const calcs = state.getFeatureCalculations();
			const pb = state.getProficiencyBonus();

			expect(calcs.extraLuckUses).toBe(pb);
			expect(state.getExtraLuckUses().max).toBe(pb);
			expect(state.getExtraLuckUses().remaining).toBe(pb);
		});

		it("should consume uses when activated", () => {
			createExtraLuckGambler();
			const pb = state.getProficiencyBonus();

			// Use once
			const result = state.useExtraLuck();
			expect(result).toBe(true);
			expect(state.getExtraLuckUses().remaining).toBe(pb - 1);

			// Use remaining
			for (let i = 1; i < pb; i++) {
				state.useExtraLuck();
			}
			expect(state.getExtraLuckUses().remaining).toBe(0);

			// Should fail when exhausted
			expect(state.useExtraLuck()).toBe(false);
		});

		it("should trigger d100 roll when used", () => {
			createExtraLuckGambler();

			state.useExtraLuck();
			const lastRoll = state.getGamblerLastTableRoll();

			expect(lastRoll).not.toBeNull();
			expect(lastRoll.roll).toBeGreaterThanOrEqual(1);
			expect(lastRoll.roll).toBeLessThanOrEqual(100);
		});

		it("should reset uses on long rest", () => {
			createExtraLuckGambler();
			const pb = state.getProficiencyBonus();

			// Exhaust uses
			for (let i = 0; i < pb; i++) {
				state.useExtraLuck();
			}
			expect(state.getExtraLuckUses().remaining).toBe(0);

			// Long rest
			state.resetGamblerDailyResources();
			expect(state.getExtraLuckUses().remaining).toBe(pb);
		});
	});

	// =========================================================================
	// MASTER OF FORTUNE (Level 17)
	// =========================================================================
	describe("Master of Fortune (Level 17)", () => {
		it("should detect hasMasterOfFortune for L17+ Gambler", () => {
			createMasterGambler();
			const calcs = state.getFeatureCalculations();
			expect(calcs.hasMasterOfFortune).toBe(true);
		});

		it("should NOT have hasMasterOfFortune before level 17", () => {
			createExtraLuckGambler(); // L9
			const calcs = state.getFeatureCalculations();
			expect(calcs.hasMasterOfFortune).toBeFalsy();
		});

		it("should have uses equal to proficiency bonus", () => {
			createMasterGambler();
			const pb = state.getProficiencyBonus();

			expect(state.getMasterOfFortuneUses().max).toBe(pb);
			expect(state.getMasterOfFortuneUses().remaining).toBe(pb);
		});

		it("should consume use when activated", () => {
			createMasterGambler();
			const pb = state.getProficiencyBonus();

			expect(state.useMasterOfFortune()).toBe(true);
			expect(state.getMasterOfFortuneUses().remaining).toBe(pb - 1);

			// Exhaust uses
			for (let i = 1; i < pb; i++) {
				state.useMasterOfFortune();
			}
			expect(state.getMasterOfFortuneUses().remaining).toBe(0);

			// Should fail when exhausted
			expect(state.useMasterOfFortune()).toBe(false);
		});

		it("should trigger d100 roll when used", () => {
			createMasterGambler();

			state.useMasterOfFortune();
			const lastRoll = state.getGamblerLastTableRoll();

			expect(lastRoll).not.toBeNull();
		});

		it("should roll twice on d100 table (choose result)", () => {
			createMasterGambler();
			const originalRandom = Math.random;

			// Force different rolls
			let callCount = 0;
			Math.random = () => {
				callCount++;
				return callCount === 1 ? 0.1 : 0.9; // First roll low, second roll high
			};

			const result = state.rollGamblingTable();

			// Master of Fortune should give both rolls
			expect(result.roll).toBeDefined();
			expect(result.secondRoll).toBeDefined();
			expect(result.roll).not.toBe(result.secondRoll);

			Math.random = originalRandom;
		});

		it("should reset uses on long rest", () => {
			createMasterGambler();
			const pb = state.getProficiencyBonus();

			state.useMasterOfFortune();
			expect(state.getMasterOfFortuneUses().remaining).toBeLessThan(pb);

			state.resetGamblerDailyResources();
			expect(state.getMasterOfFortuneUses().remaining).toBe(pb);
		});
	});

	// =========================================================================
	// LONG REST INTEGRATION
	// =========================================================================
	describe("Long Rest Resource Reset", () => {
		it("should reset all Gambler daily resources on long rest", () => {
			createMasterGambler();
			const elPb = state.getProficiencyBonus();
			const mofPb = state.getProficiencyBonus();

			// Exhaust all resources
			for (let i = 0; i < elPb; i++) {
				state.useExtraLuck();
			}
			for (let i = 0; i < mofPb; i++) {
				state.useMasterOfFortune();
			}

			expect(state.getExtraLuckUses().remaining).toBe(0);
			expect(state.getMasterOfFortuneUses().remaining).toBe(0);

			// Reset
			state.resetGamblerDailyResources();

			expect(state.getExtraLuckUses().remaining).toBe(elPb);
			expect(state.getMasterOfFortuneUses().remaining).toBe(mofPb);
		});
	});

	// =========================================================================
	// STATE SERIALIZATION
	// =========================================================================
	describe("State Serialization", () => {
		it("should persist Gambler state through save/load", () => {
			createMasterGambler();
			const elPb = state.getProficiencyBonus();
			const mofPb = state.getProficiencyBonus();

			// Set some state
			state.setGamblerAutoRollTable(true);
			state.useExtraLuck();
			state.useMasterOfFortune();
			state.rollGamblerBet(3);

			// Save and load
			const json = state.toJson();
			const newState = new CharacterSheetState();
			newState.loadFromJson(json);

			// Verify persisted state
			expect(newState.getGamblerAutoRollTable()).toBe(true);
			expect(newState.getExtraLuckUses().remaining).toBe(elPb - 1);
			expect(newState.getMasterOfFortuneUses().remaining).toBe(mofPb - 1);
			expect(newState.getGamblerLastBet()).not.toBeNull();
			expect(newState.getGamblerLastTableRoll()).not.toBeNull();
		});
	});
});
