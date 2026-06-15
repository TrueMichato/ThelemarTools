/**
 * Character Sheet Illrigger Class Tests
 * Testing for the Illrigger class (MCDM Productions — The Illrigger Revised)
 *
 * This test suite verifies that:
 * - Core class resources scale correctly by level (Seals, Seal Damage, Conduit Dice, Boons Known)
 * - Interdict Save DC uses 8 + prof + CHA
 * - Extra Attack is available at level 5
 * - All 5 subclass branches produce correct feature flags at subclass levels (3, 7, 11, 15)
 * - Architect of Ruin spellcasting: DC, attack bonus, cantrips known, spells known
 * - Infernal Majesty active state exists with correct effects
 * - Terrorizing Force damage scales (1d8 at L11, 2d8 at L17)
 * - Shadowmaster Strike from the Dark die scales (d4 at L3, d8 at L15)
 */
import "./setup.js";
import "../../../js/charactersheet/charactersheet-state.js";

const CharacterSheetState = globalThis.CharacterSheetState;

// ==========================================================================
// PART 1: CORE ILLRIGGER CLASS FEATURES
// ==========================================================================
describe("Illrigger Core Class Features", () => {
	let state;

	beforeEach(() => {
		state = new CharacterSheetState();
	});

	// ==========================================================================
	// Seals (short rest resource, scales by level)
	// ==========================================================================
	describe("Seals Max (scaling)", () => {
		const sealTests = [
			{level: 1, expected: 3},
			{level: 2, expected: 3},
			{level: 3, expected: 4},
			{level: 7, expected: 5},
			{level: 13, expected: 6},
			{level: 18, expected: 7},
			{level: 20, expected: 7},
		];

		sealTests.forEach(({level, expected}) => {
			it(`should have ${expected} seals at level ${level}`, () => {
				state.addClass({name: "Illrigger", source: "IllriggerRevised", level});
				const calcs = state.getFeatureCalculations();
				expect(calcs.sealsMax).toBe(expected);
			});
		});
	});

	// ==========================================================================
	// Seal Damage (scaling dice)
	// ==========================================================================
	describe("Seal Damage (scaling)", () => {
		it("should be 1d6 at levels 1-4", () => {
			state.addClass({name: "Illrigger", source: "IllriggerRevised", level: 4});
			const calcs = state.getFeatureCalculations();
			expect(calcs.sealDamage).toBe("1d6");
			expect(calcs.sealDamageDieCount).toBe(1);
		});

		it("should be 2d6 at levels 5-10", () => {
			state.addClass({name: "Illrigger", source: "IllriggerRevised", level: 5});
			const calcs = state.getFeatureCalculations();
			expect(calcs.sealDamage).toBe("2d6");
			expect(calcs.sealDamageDieCount).toBe(2);
		});

		it("should be 3d6 at levels 11-19", () => {
			state.addClass({name: "Illrigger", source: "IllriggerRevised", level: 15});
			const calcs = state.getFeatureCalculations();
			expect(calcs.sealDamage).toBe("3d6");
			expect(calcs.sealDamageDieCount).toBe(3);
		});

		it("should be 4d6 at level 20", () => {
			state.addClass({name: "Illrigger", source: "IllriggerRevised", level: 20});
			const calcs = state.getFeatureCalculations();
			expect(calcs.sealDamage).toBe("4d6");
			expect(calcs.sealDamageDieCount).toBe(4);
		});
	});

	// ==========================================================================
	// Interdict Save DC
	// ==========================================================================
	describe("Interdict Save DC", () => {
		it("should be 8 + prof + CHA at level 1 (default CHA 10)", () => {
			state.addClass({name: "Illrigger", source: "IllriggerRevised", level: 1});
			// Prof +2, CHA mod 0 (base 10)
			const calcs = state.getFeatureCalculations();
			expect(calcs.interdictDc).toBe(10); // 8 + 2 + 0
		});

		it("should scale with CHA", () => {
			state.addClass({name: "Illrigger", source: "IllriggerRevised", level: 1});
			state.setAbilityBase("cha", 16); // CHA mod +3
			const calcs = state.getFeatureCalculations();
			expect(calcs.interdictDc).toBe(13); // 8 + 2 + 3
		});

		it("should scale with proficiency at higher levels", () => {
			state.addClass({name: "Illrigger", source: "IllriggerRevised", level: 9});
			state.setAbilityBase("cha", 18); // CHA mod +4
			// Prof +4 at level 9
			const calcs = state.getFeatureCalculations();
			expect(calcs.interdictDc).toBe(16); // 8 + 4 + 4
		});
	});

	// ==========================================================================
	// Interdict Boons Known (scaling)
	// ==========================================================================
	describe("Interdict Boons Known (scaling)", () => {
		const boonTests = [
			{level: 1, expected: 0},
			{level: 2, expected: 1},
			{level: 7, expected: 2},
			{level: 13, expected: 3},
			{level: 18, expected: 4},
		];

		boonTests.forEach(({level, expected}) => {
			it(`should know ${expected} boons at level ${level}`, () => {
				state.addClass({name: "Illrigger", source: "IllriggerRevised", level});
				const calcs = state.getFeatureCalculations();
				expect(calcs.interdictBoonsKnown).toBe(expected);
			});
		});
	});

	// ==========================================================================
	// Infernal Conduit Dice (d10, long rest, from level 6)
	// ==========================================================================
	describe("Infernal Conduit Dice (scaling)", () => {
		it("should have 0 conduit dice before level 6", () => {
			state.addClass({name: "Illrigger", source: "IllriggerRevised", level: 5});
			const calcs = state.getFeatureCalculations();
			expect(calcs.infernalConduitDice).toBe(0);
		});

		it("should have 3 conduit dice at level 6", () => {
			state.addClass({name: "Illrigger", source: "IllriggerRevised", level: 6});
			const calcs = state.getFeatureCalculations();
			expect(calcs.infernalConduitDice).toBe(3);
			expect(calcs.infernalConduitDie).toBe(10);
		});

		it("should have 5 conduit dice at level 9", () => {
			state.addClass({name: "Illrigger", source: "IllriggerRevised", level: 9});
			const calcs = state.getFeatureCalculations();
			expect(calcs.infernalConduitDice).toBe(5);
		});

		it("should have 10 conduit dice at level 20", () => {
			state.addClass({name: "Illrigger", source: "IllriggerRevised", level: 20});
			const calcs = state.getFeatureCalculations();
			expect(calcs.infernalConduitDice).toBe(10);
		});
	});

	// ==========================================================================
	// Level-Gated Feature Flags
	// ==========================================================================
	describe("Level-Gated Feature Flags", () => {
		it("should have Baleful Interdict and Forked Tongue at level 1", () => {
			state.addClass({name: "Illrigger", source: "IllriggerRevised", level: 1});
			const calcs = state.getFeatureCalculations();
			expect(calcs.hasBalefulInterdict).toBe(true);
			expect(calcs.hasForkedTongue).toBe(true);
		});

		it("should have Combat Mastery and Interdiction at level 2", () => {
			state.addClass({name: "Illrigger", source: "IllriggerRevised", level: 2});
			const calcs = state.getFeatureCalculations();
			expect(calcs.hasCombatMastery).toBe(true);
			expect(calcs.hasInterdiction).toBe(true);
		});

		it("should have Diabolic Contract and Invoke Hell at level 3", () => {
			state.addClass({name: "Illrigger", source: "IllriggerRevised", level: 3});
			const calcs = state.getFeatureCalculations();
			expect(calcs.hasDiabolicContract).toBe(true);
			expect(calcs.hasInvokeHell).toBe(true);
			expect(calcs.invokeHellUses).toBe(1);
		});

		it("should have Extra Attack at level 5", () => {
			state.addClass({name: "Illrigger", source: "IllriggerRevised", level: 5});
			const calcs = state.getFeatureCalculations();
			expect(calcs.hasExtraAttack).toBe(true);
		});

		it("should NOT have Extra Attack at level 4", () => {
			state.addClass({name: "Illrigger", source: "IllriggerRevised", level: 4});
			const calcs = state.getFeatureCalculations();
			expect(calcs.hasExtraAttack).toBeUndefined();
		});

		it("should have Infernal Conduit at level 6", () => {
			state.addClass({name: "Illrigger", source: "IllriggerRevised", level: 6});
			const calcs = state.getFeatureCalculations();
			expect(calcs.hasInfernalConduit).toBe(true);
		});

		it("should have Forked Tongue Improvement at level 9", () => {
			state.addClass({name: "Illrigger", source: "IllriggerRevised", level: 9});
			const calcs = state.getFeatureCalculations();
			expect(calcs.hasForkedTongueImprovement).toBe(true);
		});

		it("should have Blood Price at level 10", () => {
			state.addClass({name: "Illrigger", source: "IllriggerRevised", level: 10});
			const calcs = state.getFeatureCalculations();
			expect(calcs.hasBloodPrice).toBe(true);
		});

		it("should have Superior Interdict at level 14", () => {
			state.addClass({name: "Illrigger", source: "IllriggerRevised", level: 14});
			const calcs = state.getFeatureCalculations();
			expect(calcs.hasSuperiorInterdict).toBe(true);
		});

		it("should have Infernal Majesty at level 17", () => {
			state.addClass({name: "Illrigger", source: "IllriggerRevised", level: 17});
			const calcs = state.getFeatureCalculations();
			expect(calcs.hasInfernalMajesty).toBe(true);
		});

		it("should have Master of Hell at level 20", () => {
			state.addClass({name: "Illrigger", source: "IllriggerRevised", level: 20});
			const calcs = state.getFeatureCalculations();
			expect(calcs.hasMasterOfHell).toBe(true);
		});
	});

	// ==========================================================================
	// Terrorizing Force Scaling
	// ==========================================================================
	describe("Terrorizing Force (Level 11+)", () => {
		it("should not be available before level 11", () => {
			state.addClass({name: "Illrigger", source: "IllriggerRevised", level: 10});
			const calcs = state.getFeatureCalculations();
			expect(calcs.hasTerrorizingForce).toBeUndefined();
		});

		it("should deal 1d8 extra damage at level 11", () => {
			state.addClass({name: "Illrigger", source: "IllriggerRevised", level: 11});
			const calcs = state.getFeatureCalculations();
			expect(calcs.hasTerrorizingForce).toBe(true);
			expect(calcs.terrorForceExtraDamage).toBe("1d8");
			expect(calcs.terrorForceExtraDamageDieCount).toBe(1);
		});

		it("should deal 2d8 extra damage at level 17 (Infernal Majesty upgrade)", () => {
			state.addClass({name: "Illrigger", source: "IllriggerRevised", level: 17});
			const calcs = state.getFeatureCalculations();
			expect(calcs.terrorForceExtraDamage).toBe("2d8");
			expect(calcs.terrorForceExtraDamageDieCount).toBe(2);
		});
	});

	// ==========================================================================
	// Extra Attack via getNumberOfAttacks()
	// ==========================================================================
	describe("getNumberOfAttacks()", () => {
		it("should return 1 before level 5", () => {
			state.addClass({name: "Illrigger", source: "IllriggerRevised", level: 4});
			expect(state.getNumberOfAttacks()).toBe(1);
		});

		it("should return 2 at level 5+", () => {
			state.addClass({name: "Illrigger", source: "IllriggerRevised", level: 5});
			expect(state.getNumberOfAttacks()).toBe(2);
		});
	});
});

// ==========================================================================
// PART 2: SUBCLASS - ARCHITECT OF RUIN (1/3 caster)
// ==========================================================================
describe("Illrigger Subclass: Architect of Ruin", () => {
	let state;

	beforeEach(() => {
		state = new CharacterSheetState();
	});

	describe("Spellcasting (Level 3+)", () => {
		it("should not have spellcasting before level 3", () => {
			state.addClass({
				name: "Illrigger",
				source: "IllriggerRevised",
				level: 2,
				subclass: {name: "Architect of Ruin", shortName: "Architect of Ruin", source: "IllriggerRevised"},
			});
			const calcs = state.getFeatureCalculations();
			expect(calcs.hasSpellcasting).toBeUndefined();
		});

		it("should have CHA-based spellcasting at level 3", () => {
			state.addClass({
				name: "Illrigger",
				source: "IllriggerRevised",
				level: 3,
				subclass: {name: "Architect of Ruin", shortName: "Architect of Ruin", source: "IllriggerRevised"},
			});
			state.setAbilityBase("cha", 16); // CHA mod +3
			const calcs = state.getFeatureCalculations();
			expect(calcs.hasSpellcasting).toBe(true);
			expect(calcs.spellcastingAbility).toBe("cha");
			expect(calcs.spellSaveDc).toBe(13); // 8 + 2 + 3
			expect(calcs.spellAttackBonus).toBe(5); // 2 + 3
		});

		it("should know 2 cantrips at level 3", () => {
			state.addClass({
				name: "Illrigger",
				source: "IllriggerRevised",
				level: 3,
				subclass: {name: "Architect of Ruin", shortName: "Architect of Ruin", source: "IllriggerRevised"},
			});
			const calcs = state.getFeatureCalculations();
			expect(calcs.cantripsKnown).toBe(2);
		});

		it("should know 3 cantrips at level 10", () => {
			state.addClass({
				name: "Illrigger",
				source: "IllriggerRevised",
				level: 10,
				subclass: {name: "Architect of Ruin", shortName: "Architect of Ruin", source: "IllriggerRevised"},
			});
			const calcs = state.getFeatureCalculations();
			expect(calcs.cantripsKnown).toBe(3);
		});

		it("should know 3 spells at level 3", () => {
			state.addClass({
				name: "Illrigger",
				source: "IllriggerRevised",
				level: 3,
				subclass: {name: "Architect of Ruin", shortName: "Architect of Ruin", source: "IllriggerRevised"},
			});
			const calcs = state.getFeatureCalculations();
			expect(calcs.spellsKnown).toBe(3);
		});

		it("should know 13 spells at level 20", () => {
			state.addClass({
				name: "Illrigger",
				source: "IllriggerRevised",
				level: 20,
				subclass: {name: "Architect of Ruin", shortName: "Architect of Ruin", source: "IllriggerRevised"},
			});
			const calcs = state.getFeatureCalculations();
			expect(calcs.spellsKnown).toBe(13);
		});
	});

	describe("Subclass Features", () => {
		it("should have Asmodeus's Blessing at level 3", () => {
			state.addClass({
				name: "Illrigger",
				source: "IllriggerRevised",
				level: 3,
				subclass: {name: "Architect of Ruin", shortName: "Architect of Ruin", source: "IllriggerRevised"},
			});
			const calcs = state.getFeatureCalculations();
			expect(calcs.hasAsmodeusBlessing).toBe(true);
		});

		it("should have Hellish Versatility at level 7", () => {
			state.addClass({
				name: "Illrigger",
				source: "IllriggerRevised",
				level: 7,
				subclass: {name: "Architect of Ruin", shortName: "Architect of Ruin", source: "IllriggerRevised"},
			});
			const calcs = state.getFeatureCalculations();
			expect(calcs.hasHellishVersatility).toBe(true);
		});

		it("should have Submit at level 11", () => {
			state.addClass({
				name: "Illrigger",
				source: "IllriggerRevised",
				level: 11,
				subclass: {name: "Architect of Ruin", shortName: "Architect of Ruin", source: "IllriggerRevised"},
			});
			const calcs = state.getFeatureCalculations();
			expect(calcs.hasSubmit).toBe(true);
		});

		it("should have Vile Transmogrification at level 15", () => {
			state.addClass({
				name: "Illrigger",
				source: "IllriggerRevised",
				level: 15,
				subclass: {name: "Architect of Ruin", shortName: "Architect of Ruin", source: "IllriggerRevised"},
			});
			const calcs = state.getFeatureCalculations();
			expect(calcs.hasVileTransmogrification).toBe(true);
		});
	});

	describe("Spellcasting Info (getSpellcastingInfo)", () => {
		it("should return known-type spellcasting for Architect of Ruin", () => {
			state.addClass({
				name: "Illrigger",
				source: "IllriggerRevised",
				level: 5,
				subclass: {name: "Architect of Ruin", shortName: "Architect of Ruin", source: "IllriggerRevised"},
			});
			const info = state.getSpellcastingInfo?.("Illrigger");
			if (info) {
				expect(info.type).toBe("known");
				expect(info.cantripsKnown).toBe(2);
				expect(info.max).toBe(4);
			}
		});
	});
});

// ==========================================================================
// PART 3: SUBCLASS - HELLSPEAKER
// ==========================================================================
describe("Illrigger Subclass: Hellspeaker", () => {
	let state;

	beforeEach(() => {
		state = new CharacterSheetState();
	});

	it("should have Moloch's Blessing and Charm Enemy at level 3", () => {
		state.addClass({
			name: "Illrigger",
			source: "IllriggerRevised",
			level: 3,
			subclass: {name: "Hellspeaker", shortName: "Hellspeaker", source: "IllriggerRevised"},
		});
		const calcs = state.getFeatureCalculations();
		expect(calcs.hasMolochBlessing).toBe(true);
		expect(calcs.hasCharmEnemy).toBe(true);
		expect(calcs.charmEnemyDc).toBe(calcs.interdictDc);
	});

	it("should have Moloch's Interdiction at level 7", () => {
		state.addClass({
			name: "Illrigger",
			source: "IllriggerRevised",
			level: 7,
			subclass: {name: "Hellspeaker", shortName: "Hellspeaker", source: "IllriggerRevised"},
		});
		const calcs = state.getFeatureCalculations();
		expect(calcs.hasMolochInterdiction).toBe(true);
	});

	it("should have Intransigent and Let's Make a Deal at level 11", () => {
		state.addClass({
			name: "Illrigger",
			source: "IllriggerRevised",
			level: 11,
			subclass: {name: "Hellspeaker", shortName: "Hellspeaker", source: "IllriggerRevised"},
		});
		const calcs = state.getFeatureCalculations();
		expect(calcs.hasIntransigent).toBe(true);
		expect(calcs.intransigentRange).toBe(10);
		expect(calcs.hasLetsMakeADeal).toBe(true);
	});

	it("should have Quid Pro Quo at level 15", () => {
		state.addClass({
			name: "Illrigger",
			source: "IllriggerRevised",
			level: 15,
			subclass: {name: "Hellspeaker", shortName: "Hellspeaker", source: "IllriggerRevised"},
		});
		const calcs = state.getFeatureCalculations();
		expect(calcs.hasQuidProQuo).toBe(true);
	});
});

// ==========================================================================
// PART 4: SUBCLASS - PAINKILLER
// ==========================================================================
describe("Illrigger Subclass: Painkiller", () => {
	let state;

	beforeEach(() => {
		state = new CharacterSheetState();
	});

	it("should have heavy armor prof and Devastator at level 3", () => {
		state.addClass({
			name: "Illrigger",
			source: "IllriggerRevised",
			level: 3,
			subclass: {name: "Painkiller", shortName: "Painkiller", source: "IllriggerRevised"},
		});
		const calcs = state.getFeatureCalculations();
		expect(calcs.hasDispaterBlessing).toBe(true);
		expect(calcs.hasHeavyArmorProficiency).toBe(true);
		expect(calcs.hasDevastator).toBe(true);
	});

	it("should have Dispater's Interdiction at level 7", () => {
		state.addClass({
			name: "Illrigger",
			source: "IllriggerRevised",
			level: 7,
			subclass: {name: "Painkiller", shortName: "Painkiller", source: "IllriggerRevised"},
		});
		const calcs = state.getFeatureCalculations();
		expect(calcs.hasDispaterInterdiction).toBe(true);
	});

	it("should have You Die on My Command at level 11", () => {
		state.addClass({
			name: "Illrigger",
			source: "IllriggerRevised",
			level: 11,
			subclass: {name: "Painkiller", shortName: "Painkiller", source: "IllriggerRevised"},
		});
		const calcs = state.getFeatureCalculations();
		expect(calcs.hasYouDieOnMyCommand).toBe(true);
	});

	it("should have Deathstrike with doubled seal damage at level 15", () => {
		state.addClass({
			name: "Illrigger",
			source: "IllriggerRevised",
			level: 15,
			subclass: {name: "Painkiller", shortName: "Painkiller", source: "IllriggerRevised"},
		});
		const calcs = state.getFeatureCalculations();
		expect(calcs.hasDeathstrike).toBe(true);
		// At level 15, seal damage is 3d6, so doubled = 6d6
		expect(calcs.deathstrikeBonusDamage).toBe("6d6");
	});
});

// ==========================================================================
// PART 5: SUBCLASS - SANGUINE KNIGHT
// ==========================================================================
describe("Illrigger Subclass: Sanguine Knight", () => {
	let state;

	beforeEach(() => {
		state = new CharacterSheetState();
	});

	it("should have Sutekh's Blessing and Exsanguinate at level 3", () => {
		state.addClass({
			name: "Illrigger",
			source: "IllriggerRevised",
			level: 3,
			subclass: {name: "Sanguine Knight", shortName: "Sanguine Knight", source: "IllriggerRevised"},
		});
		const calcs = state.getFeatureCalculations();
		expect(calcs.hasSutekhBlessing).toBe(true);
		expect(calcs.hasExsanguinate).toBe(true);
	});

	it("should have Sutekh's Interdiction at level 7", () => {
		state.addClass({
			name: "Illrigger",
			source: "IllriggerRevised",
			level: 7,
			subclass: {name: "Sanguine Knight", shortName: "Sanguine Knight", source: "IllriggerRevised"},
		});
		const calcs = state.getFeatureCalculations();
		expect(calcs.hasSutekhInterdiction).toBe(true);
	});

	it("should have Bloodstroke at level 11", () => {
		state.addClass({
			name: "Illrigger",
			source: "IllriggerRevised",
			level: 11,
			subclass: {name: "Sanguine Knight", shortName: "Sanguine Knight", source: "IllriggerRevised"},
		});
		const calcs = state.getFeatureCalculations();
		expect(calcs.hasBloodstroke).toBe(true);
	});

	it("should have Haemal Exchange at level 15", () => {
		state.addClass({
			name: "Illrigger",
			source: "IllriggerRevised",
			level: 15,
			subclass: {name: "Sanguine Knight", shortName: "Sanguine Knight", source: "IllriggerRevised"},
		});
		const calcs = state.getFeatureCalculations();
		expect(calcs.hasHaemalExchange).toBe(true);
	});
});

// ==========================================================================
// PART 6: SUBCLASS - SHADOWMASTER
// ==========================================================================
describe("Illrigger Subclass: Shadowmaster", () => {
	let state;

	beforeEach(() => {
		state = new CharacterSheetState();
	});

	it("should have Marked for Death and Strike from the Dark (d4) at level 3", () => {
		state.addClass({
			name: "Illrigger",
			source: "IllriggerRevised",
			level: 3,
			subclass: {name: "Shadowmaster", shortName: "Shadowmaster", source: "IllriggerRevised"},
		});
		const calcs = state.getFeatureCalculations();
		expect(calcs.hasMarkedForDeath).toBe(true);
		expect(calcs.hasStrikeFromTheDark).toBe(true);
		expect(calcs.strikeFromTheDarkDie).toBe("d4");
	});

	it("should have Belial's Interdiction at level 7", () => {
		state.addClass({
			name: "Illrigger",
			source: "IllriggerRevised",
			level: 7,
			subclass: {name: "Shadowmaster", shortName: "Shadowmaster", source: "IllriggerRevised"},
		});
		const calcs = state.getFeatureCalculations();
		expect(calcs.hasBelialInterdiction).toBe(true);
	});

	it("should have Umbral Killer features at level 11", () => {
		state.addClass({
			name: "Illrigger",
			source: "IllriggerRevised",
			level: 11,
			subclass: {name: "Shadowmaster", shortName: "Shadowmaster", source: "IllriggerRevised"},
		});
		const calcs = state.getFeatureCalculations();
		expect(calcs.hasUmbralKiller).toBe(true);
		expect(calcs.umbralKillerDarkvision).toBe(60);
		expect(calcs.umbralKillerSpeedBonus).toBe(10);
		expect(calcs.hasEvasion).toBe(true);
	});

	it("should upgrade Strike from the Dark to d8 at level 15", () => {
		state.addClass({
			name: "Illrigger",
			source: "IllriggerRevised",
			level: 15,
			subclass: {name: "Shadowmaster", shortName: "Shadowmaster", source: "IllriggerRevised"},
		});
		const calcs = state.getFeatureCalculations();
		expect(calcs.hasDoomedToTheShadows).toBe(true);
		expect(calcs.strikeFromTheDarkDie).toBe("d8");
	});
});

// ==========================================================================
// PART 7: INFERNAL MAJESTY ACTIVE STATE
// ==========================================================================
describe("Infernal Majesty Active State", () => {
	it("should exist in ACTIVE_STATE_TYPES", () => {
		const stateType = CharacterSheetState.ACTIVE_STATE_TYPES.infernalMajesty;
		expect(stateType).toBeDefined();
		expect(stateType.id).toBe("infernalMajesty");
		expect(stateType.name).toBe("Infernal Majesty");
	});

	it("should have fire, cold, and necrotic resistance effects", () => {
		const stateType = CharacterSheetState.ACTIVE_STATE_TYPES.infernalMajesty;
		const resistances = stateType.effects.filter(e => e.type === "resistance");
		expect(resistances).toHaveLength(3);

		const targets = resistances.map(r => r.target).sort();
		expect(targets).toEqual(["damage:cold", "damage:fire", "damage:necrotic"]);
	});

	it("should have a fly speed effect", () => {
		const stateType = CharacterSheetState.ACTIVE_STATE_TYPES.infernalMajesty;
		const speedEffect = stateType.effects.find(e => e.type === "speed");
		expect(speedEffect).toBeDefined();
		expect(speedEffect.target).toBe("fly");
		expect(speedEffect.value).toBe(60);
	});

	it("should have 10 minute duration", () => {
		const stateType = CharacterSheetState.ACTIVE_STATE_TYPES.infernalMajesty;
		expect(stateType.duration).toBe("10 minutes");
	});
});

// ==========================================================================
// PART 8: BALEFUL INTERDICT — SEAL POOL & INTERDICTION FRAMEWORK
// ==========================================================================
describe("Baleful Interdict — Seal Pool", () => {
	let state;
	const BALEFUL_DESC = "Once on your turn you place a magical seal on a creature within 30 feet of you that you can see, either when you hit it with a weapon attack or as a bonus action.";
	const addBalefulFeature = (st) => st.addFeature({
		name: "Baleful Interdict",
		source: "IllriggerRevised",
		classSource: "IllriggerRevised",
		description: BALEFUL_DESC,
	});

	beforeEach(() => { state = new CharacterSheetState(); });

	// ----------------------------------------------------------------------
	// Seal pool size == sealsMax at every level
	// ----------------------------------------------------------------------
	describe("Seal pool size matches sealsMax (L1-20)", () => {
		for (let level = 1; level <= 20; level++) {
			it(`available seals == sealsMax at level ${level}`, () => {
				state.addClass({name: "Illrigger", source: "IllriggerRevised", level});
				const calcs = state.getFeatureCalculations();
				expect(state.getSealsMax()).toBe(calcs.sealsMax);
				expect(state.getSealsAvailable()).toBe(calcs.sealsMax);
			});
		}

		it("starts at the minimum of 3 at level 1", () => {
			state.addClass({name: "Illrigger", source: "IllriggerRevised", level: 1});
			expect(state.getSealsAvailable()).toBe(3);
		});
	});

	it("returns no seals and no Baleful Interdict for a non-Illrigger", () => {
		state.addClass({name: "Fighter", source: "PHB", level: 5});
		expect(state.hasBalefulInterdict()).toBe(false);
		expect(state.getSealsMax()).toBe(0);
		expect(state.getSealsAvailable()).toBe(0);
		expect(state.placeSeal("Anyone")).toBeNull();
	});

	// ----------------------------------------------------------------------
	// Bug #4 — feature uses reflect sealsMax, not the parsed "1"
	// ----------------------------------------------------------------------
	describe("Bug #4 — feature uses reflect sealsMax (not 1)", () => {
		it("sizes the Baleful Interdict feature to sealsMax (3), not 1, at L1", () => {
			state.addClass({name: "Illrigger", source: "IllriggerRevised", level: 1});
			addBalefulFeature(state);
			const feat = state.getFeatures().find(f => f.name === "Baleful Interdict");
			expect(feat).toBeDefined();
			expect(feat.uses.max).toBe(3);
			expect(feat.uses.max).not.toBe(1);
			expect(feat.uses.current).toBe(3);
			expect(feat.uses.recharge).toBe("short");
		});

		it("creates the linked resource at sealsMax, not 1", () => {
			state.addClass({name: "Illrigger", source: "IllriggerRevised", level: 1});
			addBalefulFeature(state);
			const res = state.getResources().find(r => r.name === "Baleful Interdict");
			expect(res).toBeDefined();
			expect(res.max).toBe(3);
		});

		it("scales the feature uses to 5 at level 7", () => {
			state.addClass({name: "Illrigger", source: "IllriggerRevised", level: 7});
			addBalefulFeature(state);
			const feat = state.getFeatures().find(f => f.name === "Baleful Interdict");
			expect(feat.uses.max).toBe(5);
		});

		it("curates the feature to {max: sealsMax, recharge: short}", () => {
			state.addClass({name: "Illrigger", source: "IllriggerRevised", level: 1});
			const curated = state._getCuratedFeatureUses({name: "Baleful Interdict", classSource: "IllriggerRevised"});
			expect(curated).toEqual({max: 3, recharge: "short"});
		});

		it("does NOT curate a same-named feature from another source", () => {
			state.addClass({name: "Illrigger", source: "IllriggerRevised", level: 1});
			expect(state._getCuratedFeatureUses({name: "Baleful Interdict", classSource: "PHB"})).toBeNull();
		});
	});

	// ----------------------------------------------------------------------
	// Place / burn / move state transitions
	// ----------------------------------------------------------------------
	describe("place / burn / move transitions", () => {
		beforeEach(() => { state.addClass({name: "Illrigger", source: "IllriggerRevised", level: 5}); });

		it("placeSeal spends one seal and marks the target interdicted", () => {
			const max = state.getSealsMax(); // 4 at L5
			const placed = state.placeSeal("Goblin A");
			expect(placed).toBeTruthy();
			expect(placed.count).toBe(1);
			expect(state.getSealsAvailable()).toBe(max - 1);
			expect(state.isInterdicted("Goblin A")).toBe(true);
			expect(state.isInterdicted("Goblin B")).toBe(false);
		});

		it("stacks seals on a single placement when targeting the same creature", () => {
			state.placeSeal("Ogre", {force: true});
			state.placeSeal("Ogre", {force: true});
			const placements = state.getSealPlacements();
			expect(placements).toHaveLength(1);
			expect(placements[0].count).toBe(2);
			expect(state.getSealsAvailable()).toBe(state.getSealsMax() - 2);
		});

		it("cannot place when no seals remain", () => {
			const max = state.getSealsMax();
			for (let i = 0; i < max; i++) state.placeSeal(`T${i}`, {force: true});
			expect(state.getSealsAvailable()).toBe(0);
			expect(state.placeSeal("Extra", {force: true})).toBeNull();
		});

		it("burnSeals consumes seals (no refund) and returns scaled damage", () => {
			const placed = state.placeSeal("Dragon", {force: true});
			state.placeSeal("Dragon", {force: true}); // 2 seals on Dragon
			const availBefore = state.getSealsAvailable();
			const result = state.burnSeals(placed.id, 2, "necrotic");
			expect(result).toBeTruthy();
			expect(result.count).toBe(2);
			expect(result.damageType).toBe("necrotic");
			expect(result.dice).toBe("4d6"); // 2 seals × sealDamageDieCount(2 at L5)
			expect(state.isInterdicted("Dragon")).toBe(false); // all burned
			expect(state.getSealsAvailable()).toBe(availBefore); // burning never refunds the pool
		});

		it("burning fewer seals than present leaves the remainder", () => {
			const placed = state.placeSeal("Lich", {force: true});
			state.placeSeal("Lich", {force: true});
			state.placeSeal("Lich", {force: true}); // 3 on Lich
			const result = state.burnSeals(placed.id, 1, "fire");
			expect(result.count).toBe(1);
			expect(result.dice).toBe("2d6"); // 1 seal × 2
			expect(state.getSealPlacements()[0].count).toBe(2);
		});

		it("defaults the burn damage type to fire", () => {
			const placed = state.placeSeal("Skeleton", {force: true});
			expect(state.burnSeals(placed.id, 1).damageType).toBe("fire");
		});

		it("can burn by target name as well as placement id", () => {
			state.placeSeal("Wraith", {force: true});
			const result = state.burnSeals("Wraith", 1, "necrotic");
			expect(result).toBeTruthy();
			expect(result.target).toBe("Wraith");
		});

		it("moveSeals relocates all of a dying creature's seals to a new creature", () => {
			const placed = state.placeSeal("Cultist", {force: true});
			state.placeSeal("Cultist", {force: true}); // 2 on Cultist
			const moved = state.moveSeals(placed.id, "Acolyte");
			expect(moved.target).toBe("Acolyte");
			expect(moved.count).toBe(2);
			expect(state.isInterdicted("Cultist")).toBe(false);
			expect(state.isInterdicted("Acolyte")).toBe(true);
		});

		it("moveSeals merges into an existing placement on the new target", () => {
			const p1 = state.placeSeal("A", {force: true});
			state.placeSeal("B", {force: true});
			const moved = state.moveSeals(p1.id, "B");
			expect(moved.target).toBe("B");
			expect(moved.count).toBe(2);
			expect(state.getSealPlacements()).toHaveLength(1);
		});
	});

	// ----------------------------------------------------------------------
	// Recharge on a SHORT and a LONG rest
	// ----------------------------------------------------------------------
	describe("recharge (short & long rest semantics)", () => {
		it("restoreSeals refills the pool and clears all placements", () => {
			state.addClass({name: "Illrigger", source: "IllriggerRevised", level: 3});
			state.placeSeal("X", {force: true});
			state.placeSeal("Y", {force: true});
			expect(state.getSealsAvailable()).toBeLessThan(state.getSealsMax());
			state.restoreSeals();
			expect(state.getSealsAvailable()).toBe(state.getSealsMax());
			expect(state.getSealPlacements()).toHaveLength(0);
		});

		it("syncs the Baleful Interdict feature uses on restore", () => {
			state.addClass({name: "Illrigger", source: "IllriggerRevised", level: 1});
			addBalefulFeature(state);
			state.placeSeal("Z", {force: true});
			expect(state.getFeatures().find(f => f.name === "Baleful Interdict").uses.current).toBe(2);
			state.restoreSeals();
			expect(state.getFeatures().find(f => f.name === "Baleful Interdict").uses.current).toBe(3);
		});

		it("uses a short-rest recharge tag, so the rest engine restores it on BOTH rests", () => {
			// rest.js restores any feature whose uses.recharge === "short" on a short OR
			// long rest; the curated tag therefore guarantees seals come back on both.
			state.addClass({name: "Illrigger", source: "IllriggerRevised", level: 1});
			addBalefulFeature(state);
			expect(state.getFeatures().find(f => f.name === "Baleful Interdict").uses.recharge).toBe("short");
		});
	});

	// ----------------------------------------------------------------------
	// Once-per-turn placement gate
	// ----------------------------------------------------------------------
	describe("once-per-turn placement gate", () => {
		beforeEach(() => { state.addClass({name: "Illrigger", source: "IllriggerRevised", level: 5}); });

		it("blocks a second placement in the same round but allows it the next round", () => {
			expect(state.placeSeal("R1", {round: 1})).toBeTruthy();
			expect(state.canPlaceSealThisTurn(1)).toBe(false);
			expect(state.placeSeal("R1b", {round: 1})).toBeNull();
			expect(state.canPlaceSealThisTurn(2)).toBe(true);
			expect(state.placeSeal("R2", {round: 2})).toBeTruthy();
		});

		it("is not gated outside combat (no active round)", () => {
			expect(state.placeSeal("A")).toBeTruthy();
			expect(state.placeSeal("B")).toBeTruthy();
		});
	});

	// ----------------------------------------------------------------------
	// DC display
	// ----------------------------------------------------------------------
	it("exposes the interdict save DC for the panel (8 + prof + CHA)", () => {
		state.addClass({name: "Illrigger", source: "IllriggerRevised", level: 1});
		state.setAbilityBase("cha", 16);
		expect(state.getFeatureCalculations().interdictDc).toBe(13);
	});

	// ----------------------------------------------------------------------
	// Known interdict boons (#7 framework)
	// ----------------------------------------------------------------------
	describe("known interdict boons (#7 framework)", () => {
		it("getInterdictBoons returns features tagged with the ItdBoon optional-feature type", () => {
			state.addClass({name: "Illrigger", source: "IllriggerRevised", level: 7});
			state.addFeature({name: "Boon of Vengeance", source: "IllriggerRevised", optionalFeatureTypes: ["ItdBoon"], description: "When a creature dies..."});
			state.addFeature({name: "Some Other Feature", source: "IllriggerRevised", description: "A passive thing."});
			const boons = state.getInterdictBoons();
			expect(boons).toHaveLength(1);
			expect(boons[0].name).toBe("Boon of Vengeance");
		});

		it("also recognises the ItdBoon tag stored on featureType", () => {
			state.addClass({name: "Illrigger", source: "IllriggerRevised", level: 7});
			state.addFeature({name: "Boon of Flame", source: "IllriggerRevised", featureType: "ItdBoon", description: "Passive."});
			expect(state.getInterdictBoons().map(b => b.name)).toContain("Boon of Flame");
		});

		it("returns an empty list when no boons are known", () => {
			state.addClass({name: "Illrigger", source: "IllriggerRevised", level: 1});
			expect(state.getInterdictBoons()).toEqual([]);
		});
	});

	// ----------------------------------------------------------------------
	// Serialization round-trip
	// ----------------------------------------------------------------------
	it("persists the seal pool across toJson / loadFromJson", () => {
		state.addClass({name: "Illrigger", source: "IllriggerRevised", level: 5});
		state.placeSeal("Persisted", {force: true});
		const json = state.toJson();
		const restored = new CharacterSheetState();
		restored.loadFromJson(json);
		expect(restored.isInterdicted("Persisted")).toBe(true);
		expect(restored.getSealsAvailable()).toBe(state.getSealsAvailable());
	});

	it("self-heals a legacy save with no illriggerSeals block", () => {
		state.addClass({name: "Illrigger", source: "IllriggerRevised", level: 5});
		const json = state.toJson();
		delete json.illriggerSeals; // legacy save predates the seal pool
		const restored = new CharacterSheetState();
		restored.loadFromJson(json);
		expect(restored.getSealsAvailable()).toBe(restored.getSealsMax());
		expect(restored.getSealPlacements()).toEqual([]);
	});
});
