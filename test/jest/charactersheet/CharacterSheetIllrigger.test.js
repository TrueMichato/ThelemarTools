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
				name: "Illrigger", source: "IllriggerRevised", level: 2,
				subclass: {name: "Architect of Ruin", shortName: "Architect of Ruin", source: "IllriggerRevised"},
			});
			const calcs = state.getFeatureCalculations();
			expect(calcs.hasSpellcasting).toBeUndefined();
		});

		it("should have CHA-based spellcasting at level 3", () => {
			state.addClass({
				name: "Illrigger", source: "IllriggerRevised", level: 3,
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
				name: "Illrigger", source: "IllriggerRevised", level: 3,
				subclass: {name: "Architect of Ruin", shortName: "Architect of Ruin", source: "IllriggerRevised"},
			});
			const calcs = state.getFeatureCalculations();
			expect(calcs.cantripsKnown).toBe(2);
		});

		it("should know 3 cantrips at level 10", () => {
			state.addClass({
				name: "Illrigger", source: "IllriggerRevised", level: 10,
				subclass: {name: "Architect of Ruin", shortName: "Architect of Ruin", source: "IllriggerRevised"},
			});
			const calcs = state.getFeatureCalculations();
			expect(calcs.cantripsKnown).toBe(3);
		});

		it("should know 3 spells at level 3", () => {
			state.addClass({
				name: "Illrigger", source: "IllriggerRevised", level: 3,
				subclass: {name: "Architect of Ruin", shortName: "Architect of Ruin", source: "IllriggerRevised"},
			});
			const calcs = state.getFeatureCalculations();
			expect(calcs.spellsKnown).toBe(3);
		});

		it("should know 13 spells at level 20", () => {
			state.addClass({
				name: "Illrigger", source: "IllriggerRevised", level: 20,
				subclass: {name: "Architect of Ruin", shortName: "Architect of Ruin", source: "IllriggerRevised"},
			});
			const calcs = state.getFeatureCalculations();
			expect(calcs.spellsKnown).toBe(13);
		});
	});

	describe("Subclass Features", () => {
		it("should have Asmodeus's Blessing at level 3", () => {
			state.addClass({
				name: "Illrigger", source: "IllriggerRevised", level: 3,
				subclass: {name: "Architect of Ruin", shortName: "Architect of Ruin", source: "IllriggerRevised"},
			});
			const calcs = state.getFeatureCalculations();
			expect(calcs.hasAsmodeusBlessing).toBe(true);
		});

		it("should have Hellish Versatility at level 7", () => {
			state.addClass({
				name: "Illrigger", source: "IllriggerRevised", level: 7,
				subclass: {name: "Architect of Ruin", shortName: "Architect of Ruin", source: "IllriggerRevised"},
			});
			const calcs = state.getFeatureCalculations();
			expect(calcs.hasHellishVersatility).toBe(true);
		});

		it("should have Submit at level 11", () => {
			state.addClass({
				name: "Illrigger", source: "IllriggerRevised", level: 11,
				subclass: {name: "Architect of Ruin", shortName: "Architect of Ruin", source: "IllriggerRevised"},
			});
			const calcs = state.getFeatureCalculations();
			expect(calcs.hasSubmit).toBe(true);
		});

		it("should have Vile Transmogrification at level 15", () => {
			state.addClass({
				name: "Illrigger", source: "IllriggerRevised", level: 15,
				subclass: {name: "Architect of Ruin", shortName: "Architect of Ruin", source: "IllriggerRevised"},
			});
			const calcs = state.getFeatureCalculations();
			expect(calcs.hasVileTransmogrification).toBe(true);
		});
	});

	describe("Spellcasting Info (getSpellcastingInfo)", () => {
		it("should return known-type spellcasting for Architect of Ruin", () => {
			state.addClass({
				name: "Illrigger", source: "IllriggerRevised", level: 5,
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
			name: "Illrigger", source: "IllriggerRevised", level: 3,
			subclass: {name: "Hellspeaker", shortName: "Hellspeaker", source: "IllriggerRevised"},
		});
		const calcs = state.getFeatureCalculations();
		expect(calcs.hasMolochBlessing).toBe(true);
		expect(calcs.hasCharmEnemy).toBe(true);
		expect(calcs.charmEnemyDc).toBe(calcs.interdictDc);
	});

	it("should have Moloch's Interdiction at level 7", () => {
		state.addClass({
			name: "Illrigger", source: "IllriggerRevised", level: 7,
			subclass: {name: "Hellspeaker", shortName: "Hellspeaker", source: "IllriggerRevised"},
		});
		const calcs = state.getFeatureCalculations();
		expect(calcs.hasMolochInterdiction).toBe(true);
	});

	it("should have Intransigent and Let's Make a Deal at level 11", () => {
		state.addClass({
			name: "Illrigger", source: "IllriggerRevised", level: 11,
			subclass: {name: "Hellspeaker", shortName: "Hellspeaker", source: "IllriggerRevised"},
		});
		const calcs = state.getFeatureCalculations();
		expect(calcs.hasIntransigent).toBe(true);
		expect(calcs.intransigentRange).toBe(10);
		expect(calcs.hasLetsMakeADeal).toBe(true);
	});

	it("should have Quid Pro Quo at level 15", () => {
		state.addClass({
			name: "Illrigger", source: "IllriggerRevised", level: 15,
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
			name: "Illrigger", source: "IllriggerRevised", level: 3,
			subclass: {name: "Painkiller", shortName: "Painkiller", source: "IllriggerRevised"},
		});
		const calcs = state.getFeatureCalculations();
		expect(calcs.hasDispaterBlessing).toBe(true);
		expect(calcs.hasHeavyArmorProficiency).toBe(true);
		expect(calcs.hasDevastator).toBe(true);
	});

	it("should have Dispater's Interdiction at level 7", () => {
		state.addClass({
			name: "Illrigger", source: "IllriggerRevised", level: 7,
			subclass: {name: "Painkiller", shortName: "Painkiller", source: "IllriggerRevised"},
		});
		const calcs = state.getFeatureCalculations();
		expect(calcs.hasDispaterInterdiction).toBe(true);
	});

	it("should have You Die on My Command at level 11", () => {
		state.addClass({
			name: "Illrigger", source: "IllriggerRevised", level: 11,
			subclass: {name: "Painkiller", shortName: "Painkiller", source: "IllriggerRevised"},
		});
		const calcs = state.getFeatureCalculations();
		expect(calcs.hasYouDieOnMyCommand).toBe(true);
	});

	it("should have Deathstrike with doubled seal damage at level 15", () => {
		state.addClass({
			name: "Illrigger", source: "IllriggerRevised", level: 15,
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
			name: "Illrigger", source: "IllriggerRevised", level: 3,
			subclass: {name: "Sanguine Knight", shortName: "Sanguine Knight", source: "IllriggerRevised"},
		});
		const calcs = state.getFeatureCalculations();
		expect(calcs.hasSutekhBlessing).toBe(true);
		expect(calcs.hasExsanguinate).toBe(true);
	});

	it("should have Sutekh's Interdiction at level 7", () => {
		state.addClass({
			name: "Illrigger", source: "IllriggerRevised", level: 7,
			subclass: {name: "Sanguine Knight", shortName: "Sanguine Knight", source: "IllriggerRevised"},
		});
		const calcs = state.getFeatureCalculations();
		expect(calcs.hasSutekhInterdiction).toBe(true);
	});

	it("should have Bloodstroke at level 11", () => {
		state.addClass({
			name: "Illrigger", source: "IllriggerRevised", level: 11,
			subclass: {name: "Sanguine Knight", shortName: "Sanguine Knight", source: "IllriggerRevised"},
		});
		const calcs = state.getFeatureCalculations();
		expect(calcs.hasBloodstroke).toBe(true);
	});

	it("should have Haemal Exchange at level 15", () => {
		state.addClass({
			name: "Illrigger", source: "IllriggerRevised", level: 15,
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
			name: "Illrigger", source: "IllriggerRevised", level: 3,
			subclass: {name: "Shadowmaster", shortName: "Shadowmaster", source: "IllriggerRevised"},
		});
		const calcs = state.getFeatureCalculations();
		expect(calcs.hasMarkedForDeath).toBe(true);
		expect(calcs.hasStrikeFromTheDark).toBe(true);
		expect(calcs.strikeFromTheDarkDie).toBe("d4");
	});

	it("should have Belial's Interdiction at level 7", () => {
		state.addClass({
			name: "Illrigger", source: "IllriggerRevised", level: 7,
			subclass: {name: "Shadowmaster", shortName: "Shadowmaster", source: "IllriggerRevised"},
		});
		const calcs = state.getFeatureCalculations();
		expect(calcs.hasBelialInterdiction).toBe(true);
	});

	it("should have Umbral Killer features at level 11", () => {
		state.addClass({
			name: "Illrigger", source: "IllriggerRevised", level: 11,
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
			name: "Illrigger", source: "IllriggerRevised", level: 15,
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
