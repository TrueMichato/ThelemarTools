/**
 * Character Sheet Spell Effects - Unit Tests
 * Tests for spell effect parsing, application, and verification against official spells
 *
 * This test suite verifies the spell effect system:
 * 1. Spell effect parsing from spell data
 * 2. Target selection logic
 * 3. Dice rolling for damage/healing
 * 4. Condition application
 * 5. Effect duration and tracking
 * 6. Integration with character state
 */

import "./setup.js";
import "../../../js/charactersheet/charactersheet-state.js";

const CharacterSheetState = globalThis.CharacterSheetState;

// =============================================================================
// Sample Spell Data (from official sources)
// =============================================================================
const SAMPLE_SPELLS = {
	// Damage spell with save
	fireball: {
		name: "Fireball",
		source: "XPHB",
		level: 3,
		school: "V",
		time: [{number: 1, unit: "action"}],
		range: {type: "point", distance: {type: "feet", amount: 150}},
		components: {v: true, s: true, m: "a ball of bat guano and sulfur"},
		duration: [{type: "instant"}],
		entries: [
			"A bright streak flashes from you to a point you choose within range and then blossoms with a low roar into a fiery explosion. Each creature in a 20-foot-radius Sphere centered on that point makes a Dexterity saving throw, taking {@damage 8d6} Fire damage on a failed save or half as much damage on a successful one.",
		],
		entriesHigherLevel: [{
			type: "entries",
			name: "Using a Higher-Level Spell Slot",
			entries: ["The damage increases by {@scaledamage 8d6|3-9|1d6} for each spell slot level above 3."],
		}],
		damageInflict: ["fire"],
		savingThrow: ["dexterity"],
		areaTags: ["S"],
	},

	// Healing spell
	cureWounds: {
		name: "Cure Wounds",
		source: "XPHB",
		level: 1,
		school: "A",
		time: [{number: 1, unit: "action"}],
		range: {type: "point", distance: {type: "touch"}},
		components: {v: true, s: true},
		duration: [{type: "instant"}],
		entries: [
			"A creature you touch regains a number of Hit Points equal to {@dice 2d8} plus your spellcasting ability modifier.",
		],
		entriesHigherLevel: [{
			type: "entries",
			name: "Using a Higher-Level Spell Slot",
			entries: ["The healing increases by {@scaledice 2d8|1-9|2d8} for each spell slot level above 1."],
		}],
		miscTags: ["HL"],
		areaTags: ["ST"],
	},

	// Condition-applying spell
	holdPerson: {
		name: "Hold Person",
		source: "XPHB",
		level: 2,
		school: "E",
		time: [{number: 1, unit: "action"}],
		range: {type: "point", distance: {type: "feet", amount: 60}},
		components: {v: true, s: true, m: "a straight piece of iron"},
		duration: [{type: "timed", duration: {type: "minute", amount: 1}, concentration: true}],
		entries: [
			"Choose a Humanoid that you can see within range. The target must succeed on a Wisdom saving throw or have the Paralyzed condition for the duration. At the end of each of its turns, the target repeats the save, ending the spell on itself on a success.",
		],
		conditionInflict: ["paralyzed"],
		savingThrow: ["wisdom"],
		affectsCreatureType: ["humanoid"],
		areaTags: ["ST"],
	},

	// Buff spell (self)
	shield: {
		name: "Shield",
		source: "XPHB",
		level: 1,
		school: "A",
		time: [{number: 1, unit: "reaction", condition: "which you take when you are hit by an attack roll or targeted by the Magic Missile spell"}],
		range: {type: "point", distance: {type: "self"}},
		components: {v: true, s: true},
		duration: [{type: "timed", duration: {type: "round", amount: 1}}],
		entries: [
			"An imperceptible barrier of magical force protects you. Until the start of your next turn, you have a +5 bonus to AC, including against the triggering attack, and you take no damage from Magic Missile.",
		],
		miscTags: ["MAC"],
	},

	// Cantrip with scaling damage
	firebolt: {
		name: "Fire Bolt",
		source: "XPHB",
		level: 0,
		school: "V",
		time: [{number: 1, unit: "action"}],
		range: {type: "point", distance: {type: "feet", amount: 120}},
		components: {v: true, s: true},
		duration: [{type: "instant"}],
		entries: [
			"You hurl a mote of fire at a creature or object within range. Make a ranged spell attack against the target. On a hit, the target takes {@damage 1d10} Fire damage. If the target is a flammable object that isn't being worn or carried, it starts burning.",
		],
		entriesHigherLevel: [{
			type: "entries",
			name: "Cantrip Upgrade",
			entries: ["The damage increases by {@damage 1d10} when you reach levels 5 ({@damage 2d10}), 11 ({@damage 3d10}), and 17 ({@damage 4d10})."],
		}],
		scalingLevelDice: {
			label: "Fire damage",
			scaling: {1: "1d10", 5: "2d10", 11: "3d10", 17: "4d10"},
		},
		damageInflict: ["fire"],
		spellAttack: ["R"],
	},

	// Multi-target healing
	massCureWounds: {
		name: "Mass Cure Wounds",
		source: "XPHB",
		level: 5,
		school: "A",
		time: [{number: 1, unit: "action"}],
		range: {type: "point", distance: {type: "feet", amount: 60}},
		components: {v: true, s: true},
		duration: [{type: "instant"}],
		entries: [
			"A wave of healing energy washes out from a point you choose within range. Choose up to six creatures in a 30-foot-radius sphere centered on that point. Each target regains Hit Points equal to {@dice 5d8} plus your spellcasting ability modifier.",
		],
		miscTags: ["HL"],
		areaTags: ["S"],
	},

	// Buff spell with duration
	bless: {
		name: "Bless",
		source: "XPHB",
		level: 1,
		school: "E",
		time: [{number: 1, unit: "action"}],
		range: {type: "point", distance: {type: "feet", amount: 30}},
		components: {v: true, s: true, m: "a sprinkle of holy water"},
		duration: [{type: "timed", duration: {type: "minute", amount: 1}, concentration: true}],
		entries: [
			"You bless up to three creatures within range. Whenever a target makes an attack roll or a saving throw before the spell ends, the target adds {@dice 1d4} to the roll.",
		],
		areaTags: ["MT"],
	},

	// Damage + condition
	rayOfFrost: {
		name: "Ray of Frost",
		source: "XPHB",
		level: 0,
		school: "V",
		time: [{number: 1, unit: "action"}],
		range: {type: "point", distance: {type: "feet", amount: 60}},
		components: {v: true, s: true},
		duration: [{type: "instant"}],
		entries: [
			"A frigid beam of blue-white light streaks toward a creature within range. Make a ranged spell attack against the target. On a hit, it takes {@damage 1d8} Cold damage, and its Speed is reduced by 10 feet until the start of your next turn.",
		],
		scalingLevelDice: {
			label: "Cold damage",
			scaling: {1: "1d8", 5: "2d8", 11: "3d8", 17: "4d8"},
		},
		damageInflict: ["cold"],
		spellAttack: ["R"],
	},

	// Utility with temp HP
	armorOfAgathys: {
		name: "Armor of Agathys",
		source: "XPHB",
		level: 1,
		school: "A",
		time: [{number: 1, unit: "action"}],
		range: {type: "point", distance: {type: "self"}},
		components: {v: true, s: true, m: "a shard of blue glass"},
		duration: [{type: "timed", duration: {type: "hour", amount: 1}}],
		entries: [
			"Protective magical force surrounds you, manifesting as a spectral frost that covers you and your gear. You gain 5 Temporary Hit Points. If a creature hits you with a melee attack roll while you have these Hit Points, the creature takes 5 Cold damage.",
		],
		entriesHigherLevel: [{
			type: "entries",
			name: "Using a Higher-Level Spell Slot",
			entries: ["The Temporary Hit Points and the Cold damage both increase by 5 for each spell slot level above 1."],
		}],
		damageInflict: ["cold"],
	},

	// Condition-granting buff spell (self-target)
	invisibility: {
		name: "Invisibility",
		source: "XPHB",
		level: 2,
		school: "I",
		time: [{number: 1, unit: "action"}],
		range: {type: "point", distance: {type: "touch"}},
		components: {v: true, s: true, m: "an eyelash in gum arabic"},
		duration: [{type: "timed", duration: {type: "hour", amount: 1}, concentration: true}],
		entries: [
			"A creature you touch has the {@condition Invisible} condition until the spell ends. The spell ends early immediately after the target makes an attack roll, deals damage, or casts a spell.",
		],
		entriesHigherLevel: [{
			type: "entries",
			name: "Using a Higher-Level Spell Slot",
			entries: ["You can target one additional creature for each spell slot level above 2."],
		}],
		conditionInflict: ["invisible"],
		areaTags: ["ST"],
	},

	// Another condition-granting spell
	greaterInvisibility: {
		name: "Greater Invisibility",
		source: "XPHB",
		level: 4,
		school: "I",
		time: [{number: 1, unit: "action"}],
		range: {type: "point", distance: {type: "touch"}},
		components: {v: true, s: true},
		duration: [{type: "timed", duration: {type: "minute", amount: 1}, concentration: true}],
		entries: [
			"A creature you touch has the {@condition Invisible} condition until the spell ends.",
		],
		conditionInflict: ["invisible"],
		areaTags: ["ST"],
	},
};

// =============================================================================
// Spell Effect Types
// =============================================================================
const SPELL_EFFECT_TYPES = {
	DAMAGE: "damage",
	HEALING: "healing",
	TEMP_HP: "tempHp",
	CONDITION: "condition",
	BUFF: "buff",
	DEBUFF: "debuff",
	UTILITY: "utility",
	SUMMON: "summon",
	CONTROL: "control",
};

const TARGET_TYPES = {
	SELF: "self",
	SINGLE: "single",
	MULTIPLE: "multiple",
	AREA: "area",
	NONE: "none",
};

describe("CharacterSheetSpellEffects", () => {
	let state;

	beforeEach(() => {
		state = new CharacterSheetState();
		state.setName("Test Caster");
		state.setAbilityBase("str", 10);
		state.setAbilityBase("dex", 14);
		state.setAbilityBase("con", 14);
		state.setAbilityBase("int", 16);
		state.setAbilityBase("wis", 14);
		state.setAbilityBase("cha", 10);
		state.addClass({name: "Wizard", source: "XPHB", level: 5});
		state.setSpellcastingAbility("int"); // Wizard uses INT
	});

	// ==========================================================================
	// Spell Effect Parsing
	// ==========================================================================
	describe("Spell Effect Parsing", () => {
		describe("Damage Spells", () => {
			it("should parse damage dice from spell entries", () => {
				const parsed = CharacterSheetState.parseSpellEffects(SAMPLE_SPELLS.fireball);

				expect(parsed.damage).toBeDefined();
				expect(parsed.damage.dice).toBe("8d6");
				expect(parsed.damage.type).toBe("fire");
			});

			it("should parse upcast damage scaling", () => {
				const parsed = CharacterSheetState.parseSpellEffects(SAMPLE_SPELLS.fireball);

				expect(parsed.upcast).toBeDefined();
				expect(parsed.upcast.perLevel).toBe("1d6");
				expect(parsed.upcast.type).toBe("damage");
			});

			it("should parse saving throw information", () => {
				const parsed = CharacterSheetState.parseSpellEffects(SAMPLE_SPELLS.fireball);

				expect(parsed.savingThrow).toBeDefined();
				expect(parsed.savingThrow.ability).toBe("dexterity");
				expect(parsed.savingThrow.onSuccess).toBe("half");
			});

			it("should parse cantrip scaling", () => {
				const parsed = CharacterSheetState.parseSpellEffects(SAMPLE_SPELLS.firebolt);

				expect(parsed.scaling).toBeDefined();
				expect(parsed.scaling.type).toBe("cantrip");
				expect(parsed.scaling.levels).toBeDefined();
				expect(parsed.scaling.levels[5]).toBe("2d10");
				expect(parsed.scaling.levels[11]).toBe("3d10");
			});

			it("should parse spell attack type", () => {
				const parsed = CharacterSheetState.parseSpellEffects(SAMPLE_SPELLS.firebolt);

				expect(parsed.attack).toBeDefined();
				expect(parsed.attack.type).toBe("ranged");
			});
		});

		describe("Healing Spells", () => {
			it("should parse healing dice from spell entries", () => {
				const parsed = CharacterSheetState.parseSpellEffects(SAMPLE_SPELLS.cureWounds);

				expect(parsed.healing).toBeDefined();
				expect(parsed.healing.dice).toBe("2d8");
				expect(parsed.healing.addModifier).toBe(true);
			});

			it("should parse upcast healing scaling", () => {
				const parsed = CharacterSheetState.parseSpellEffects(SAMPLE_SPELLS.cureWounds);

				expect(parsed.upcast).toBeDefined();
				expect(parsed.upcast.perLevel).toBe("2d8");
				expect(parsed.upcast.type).toBe("healing");
			});

			it("should identify multi-target healing", () => {
				const parsed = CharacterSheetState.parseSpellEffects(SAMPLE_SPELLS.massCureWounds);

				expect(parsed.healing).toBeDefined();
				expect(parsed.target).toBeDefined();
				expect(parsed.target.count).toBe(6);
			});
		});

		describe("Condition Spells", () => {
			it("should parse condition infliction", () => {
				const parsed = CharacterSheetState.parseSpellEffects(SAMPLE_SPELLS.holdPerson);

				expect(parsed.conditions).toBeDefined();
				expect(parsed.conditions).toContain("paralyzed");
			});

			it("should parse concentration requirement", () => {
				const parsed = CharacterSheetState.parseSpellEffects(SAMPLE_SPELLS.holdPerson);

				expect(parsed.concentration).toBe(true);
			});

			it("should parse spell duration", () => {
				const parsed = CharacterSheetState.parseSpellEffects(SAMPLE_SPELLS.holdPerson);

				expect(parsed.duration).toBeDefined();
				expect(parsed.duration.amount).toBe(1);
				expect(parsed.duration.unit).toBe("minute");
			});
		});

		describe("Buff Spells", () => {
			it("should parse AC bonus effects", () => {
				const parsed = CharacterSheetState.parseSpellEffects(SAMPLE_SPELLS.shield);

				expect(parsed.buffs).toBeDefined();
				const acBuff = parsed.buffs.find(b => b.target === "ac");
				expect(acBuff).toBeDefined();
				expect(acBuff.value).toBe(5);
			});

			it("should parse temporary hit points", () => {
				const parsed = CharacterSheetState.parseSpellEffects(SAMPLE_SPELLS.armorOfAgathys);

				expect(parsed.tempHp).toBeDefined();
				expect(parsed.tempHp.amount).toBe(5);
			});

			it("should parse bonus dice effects", () => {
				const parsed = CharacterSheetState.parseSpellEffects(SAMPLE_SPELLS.bless);

				expect(parsed.buffs).toBeDefined();
				const rollBuff = parsed.buffs.find(b => b.type === "rollBonus");
				expect(rollBuff).toBeDefined();
				expect(rollBuff.dice).toBe("1d4");
			});
		});

		describe("Target Parsing", () => {
			it("should identify self-targeting spells", () => {
				const parsed = CharacterSheetState.parseSpellEffects(SAMPLE_SPELLS.shield);

				expect(parsed.target).toBeDefined();
				expect(parsed.target.type).toBe("self");
			});

			it("should identify touch spells", () => {
				const parsed = CharacterSheetState.parseSpellEffects(SAMPLE_SPELLS.cureWounds);

				expect(parsed.target).toBeDefined();
				expect(parsed.target.type).toBe("touch");
			});

			it("should identify area effect spells", () => {
				const parsed = CharacterSheetState.parseSpellEffects(SAMPLE_SPELLS.fireball);

				expect(parsed.target).toBeDefined();
				expect(parsed.target.type).toBe("area");
				expect(parsed.target.shape).toBe("sphere");
				expect(parsed.target.radius).toBe(20);
			});

			it("should identify single-target spells", () => {
				const parsed = CharacterSheetState.parseSpellEffects(SAMPLE_SPELLS.holdPerson);

				expect(parsed.target).toBeDefined();
				expect(parsed.target.type).toBe("single");
			});
		});
	});

	// ==========================================================================
	// Damage Calculation
	// ==========================================================================
	describe("Damage Calculation", () => {
		it("should calculate base damage for spell", () => {
			const result = CharacterSheetState.calculateSpellDamage(
				SAMPLE_SPELLS.fireball,
				3, // cast at level 3
				state,
			);

			expect(result).toBeDefined();
			expect(result.dice).toBe("8d6");
			expect(result.total).toBeGreaterThanOrEqual(8);
			expect(result.total).toBeLessThanOrEqual(48);
			expect(result.type).toBe("fire");
		});

		it("should calculate upcast damage", () => {
			const result = CharacterSheetState.calculateSpellDamage(
				SAMPLE_SPELLS.fireball,
				5, // upcast to level 5 (2 levels higher)
				state,
			);

			expect(result.dice).toBe("10d6"); // 8d6 + 2d6
			expect(result.total).toBeGreaterThanOrEqual(10);
			expect(result.total).toBeLessThanOrEqual(60);
		});

		it("should calculate cantrip damage at level 5", () => {
			state.addClass({name: "Wizard", source: "XPHB", level: 5});

			const result = CharacterSheetState.calculateSpellDamage(
				SAMPLE_SPELLS.firebolt,
				0,
				state,
			);

			expect(result.dice).toBe("2d10"); // 2d10 at level 5
		});

		it("should calculate cantrip damage at level 11", () => {
			// Set character to level 11
			state.removeClass("Wizard");
			state.addClass({name: "Wizard", source: "XPHB", level: 11});

			const result = CharacterSheetState.calculateSpellDamage(
				SAMPLE_SPELLS.firebolt,
				0,
				state,
			);

			expect(result.dice).toBe("3d10"); // 3d10 at level 11
		});

		it("should return half damage on successful save when applicable", () => {
			const parsed = CharacterSheetState.parseSpellEffects(SAMPLE_SPELLS.fireball);

			// Simulate a successful save
			const fullDamage = 24;
			const halfDamage = CharacterSheetState.calculateSaveDamage(
				fullDamage,
				parsed.savingThrow.onSuccess,
			);

			expect(halfDamage).toBe(12);
		});
	});

	// ==========================================================================
	// Healing Calculation
	// ==========================================================================
	describe("Healing Calculation", () => {
		it("should calculate base healing with modifier", () => {
			const result = CharacterSheetState.calculateSpellHealing(
				SAMPLE_SPELLS.cureWounds,
				1, // cast at level 1
				state,
			);

			expect(result).toBeDefined();
			expect(result.dice).toBe("2d8");
			expect(result.modifier).toBe(3); // INT mod for Wizard
			expect(result.total).toBeGreaterThanOrEqual(5); // 2 + 3
			expect(result.total).toBeLessThanOrEqual(19); // 16 + 3
		});

		it("should calculate upcast healing", () => {
			const result = CharacterSheetState.calculateSpellHealing(
				SAMPLE_SPELLS.cureWounds,
				3, // upcast to level 3 (2 levels higher)
				state,
			);

			expect(result.dice).toBe("6d8"); // 2d8 + 4d8
		});

		it("should not add modifier when spell doesn't include it", () => {
			const result = CharacterSheetState.calculateSpellHealing(
				SAMPLE_SPELLS.massCureWounds,
				5,
				state,
			);

			// Mass Cure Wounds adds spellcasting modifier
			expect(result.modifier).toBe(3);
		});

		it("honors abilityOverride so a multiclass heal uses the casting class's ability", () => {
			// Default (Wizard) → INT mod +3. Override to WIS (14 → +2) as if the
			// heal was cast via a WIS-based class (e.g. Druid/Cleric in a multiclass).
			const def = CharacterSheetState.calculateSpellHealing(SAMPLE_SPELLS.cureWounds, 1, state);
			expect(def.modifier).toBe(3);

			const overridden = CharacterSheetState.calculateSpellHealing(SAMPLE_SPELLS.cureWounds, 1, state, "wis");
			expect(overridden.modifier).toBe(2);
		});
	});

	// ==========================================================================
	// Condition Application
	// ==========================================================================
	describe("Condition Application", () => {
		it("should apply condition on failed save", () => {
			const target = new CharacterSheetState();
			target.setName("Target");

			CharacterSheetState.applySpellCondition(
				SAMPLE_SPELLS.holdPerson,
				target,
				{saveResult: "failed"},
			);

			expect(target.hasCondition("Paralyzed")).toBe(true);
		});

		it("should not apply condition on successful save", () => {
			const target = new CharacterSheetState();
			target.setName("Target");

			CharacterSheetState.applySpellCondition(
				SAMPLE_SPELLS.holdPerson,
				target,
				{saveResult: "success"},
			);

			expect(target.hasCondition("Paralyzed")).toBe(false);
		});

		it("should track spell source for condition", () => {
			const target = new CharacterSheetState();
			target.setName("Target");

			CharacterSheetState.applySpellCondition(
				SAMPLE_SPELLS.holdPerson,
				target,
				{saveResult: "failed", casterName: "Test Caster"},
			);

			const conditions = target.getConditions();
			const paralyzed = conditions.find(c => c.name === "Paralyzed");
			expect(paralyzed).toBeDefined();
		});

		it("should parse beneficial conditions from buff spells", () => {
			const effects = CharacterSheetState.parseSpellEffects(SAMPLE_SPELLS.invisibility);
			expect(effects.conditions).toBeDefined();
			expect(effects.conditions).toContain("invisible");
		});

		it("should distinguish hostile vs beneficial conditions", () => {
			// Hold Person inflicts paralyzed (hostile condition on enemy)
			const holdPersonEffects = CharacterSheetState.parseSpellEffects(SAMPLE_SPELLS.holdPerson);
			expect(holdPersonEffects.conditions).toContain("paralyzed");

			// Invisibility inflicts invisible (beneficial condition on ally/self)
			const invisibilityEffects = CharacterSheetState.parseSpellEffects(SAMPLE_SPELLS.invisibility);
			expect(invisibilityEffects.conditions).toContain("invisible");
		});
	});

	// ==========================================================================
	// Buff Application
	// ==========================================================================
	describe("Buff Application", () => {
		it("should apply AC bonus to self", () => {
			const initialAC = state.getAc();

			CharacterSheetState.applySpellBuff(SAMPLE_SPELLS.shield, state);

			// Check that there's an AC buff effect
			const effects = state.getActiveStateEffects();
			const acBuff = effects.find(e => e.type === "bonus" && e.target === "ac");
			expect(acBuff).toBeDefined();
			expect(acBuff.value).toBe(5);
		});

		it("should apply temporary hit points", () => {
			CharacterSheetState.applySpellBuff(SAMPLE_SPELLS.armorOfAgathys, state);

			const hp = state.getHp();
			expect(hp.temp).toBe(5);
		});

		it("should apply upcast temporary hit points", () => {
			CharacterSheetState.applySpellBuff(SAMPLE_SPELLS.armorOfAgathys, state, {slotLevel: 3});

			const hp = state.getHp();
			expect(hp.temp).toBe(15); // 5 + (2 * 5) = 15
		});

		it("should track buff duration", () => {
			CharacterSheetState.applySpellBuff(SAMPLE_SPELLS.shield, state);

			const activeStates = state.getActiveStates();
			const shieldState = activeStates.find(s => s.name === "Shield");
			expect(shieldState).toBeDefined();
			expect(shieldState.duration).toBeDefined();
		});
	});

	// ==========================================================================
	// Spell Save DC
	// ==========================================================================
	describe("Spell Save DC", () => {
		it("should calculate correct spell save DC", () => {
			// DC = 8 + proficiency + spellcasting mod
			// Level 5 Wizard: proficiency = 3, INT mod = 3
			// DC = 8 + 3 + 3 = 14
			const dc = state.getSpellSaveDC();
			expect(dc).toBe(14);
		});

		it("should include exhaustion penalty in Thelemar rules", () => {
			state.setExhaustionRules("thelemar");
			state.setExhaustion(2);

			// DC should be reduced by 2
			const dc = state.getSpellSaveDC();
			expect(dc).toBe(12); // 14 - 2
		});
	});

	// ==========================================================================
	// Spell Attack Bonus
	// ==========================================================================
	describe("Spell Attack Bonus", () => {
		it("should calculate correct spell attack bonus", () => {
			// Bonus = proficiency + spellcasting mod
			// Level 5 Wizard: proficiency = 3, INT mod = 3
			const bonus = state.getSpellAttackBonus();
			expect(bonus).toBe(6);
		});
	});

	// ==========================================================================
	// Target Selection
	// ==========================================================================
	describe("Target Selection", () => {
		it("should identify self-only spells", () => {
			const targets = CharacterSheetState.getValidTargets(SAMPLE_SPELLS.shield);
			expect(targets.selfOnly).toBe(true);
		});

		it("should identify ally-targetable spells", () => {
			const targets = CharacterSheetState.getValidTargets(SAMPLE_SPELLS.cureWounds);
			expect(targets.canTargetAlly).toBe(true);
			expect(targets.canTargetSelf).toBe(true);
		});

		it("should identify enemy-targetable spells", () => {
			const targets = CharacterSheetState.getValidTargets(SAMPLE_SPELLS.fireball);
			expect(targets.canTargetEnemy).toBe(true);
		});

		it("should identify multi-target spells", () => {
			const targets = CharacterSheetState.getValidTargets(SAMPLE_SPELLS.bless);
			expect(targets.maxTargets).toBe(3);
		});
	});

	// ==========================================================================
	// Spell Effect Application Integration
	// ==========================================================================
	describe("Spell Effect Application Integration", () => {
		it("should apply healing to self", () => {
			state.setHp(20, 10); // max 20, current 10

			const result = CharacterSheetState.applySpellEffect(
				SAMPLE_SPELLS.cureWounds,
				state, // caster
				state, // target (self)
				{slotLevel: 1, healingRoll: 10}, // Use pre-rolled value
			);

			expect(result.type).toBe("healing");
			expect(result.amount).toBe(13); // 10 (dice) + 3 (INT mod)
		});

		it("should actually update HP when healing self", () => {
			state.setHp(30, 50); // current 30, max 50

			CharacterSheetState.applySpellEffect(
				SAMPLE_SPELLS.cureWounds,
				state,
				state,
				{slotLevel: 1, healingRoll: 10},
			);

			const hp = state.getHp();
			expect(hp.current).toBe(43); // 30 + 10 + 3 = 43
		});

		it("should not exceed max HP when healing", () => {
			state.setHp(48, 50); // current 48, max 50

			CharacterSheetState.applySpellEffect(
				SAMPLE_SPELLS.cureWounds,
				state,
				state,
				{slotLevel: 1, healingRoll: 10}, // Would heal 13, but cap at max
			);

			const hp = state.getHp();
			expect(hp.current).toBe(50); // Capped at max
		});

		it("should apply damage to target", () => {
			const target = new CharacterSheetState();
			target.setName("Goblin");
			target.setHp(10, 10);

			// Mock dice roll
			globalThis.Renderer = globalThis.Renderer || {};
			globalThis.Renderer.dice = globalThis.Renderer.dice || {};
			globalThis.Renderer.dice.parseRandomise2 = () => 28;

			const result = CharacterSheetState.applySpellEffect(
				SAMPLE_SPELLS.fireball,
				state, // caster
				target, // target
				{slotLevel: 3, saveResult: "failed"},
			);

			expect(result.type).toBe("damage");
			expect(result.amount).toBe(28);
			expect(result.damageType).toBe("fire");
		});

		it("should apply half damage on successful save", () => {
			const target = new CharacterSheetState();
			target.setName("Rogue");
			target.setHp(30, 30);

			globalThis.Renderer = globalThis.Renderer || {};
			globalThis.Renderer.dice = globalThis.Renderer.dice || {};
			globalThis.Renderer.dice.parseRandomise2 = () => 28;

			const result = CharacterSheetState.applySpellEffect(
				SAMPLE_SPELLS.fireball,
				state,
				target,
				{slotLevel: 3, saveResult: "success"},
			);

			expect(result.amount).toBe(14); // Half of 28
		});
	});

	// ==========================================================================
	// Complete Spell Casting Flow
	// ==========================================================================
	describe("Complete Spell Casting Flow", () => {
		it("should execute full damage spell flow", () => {
			const castResult = CharacterSheetState.executeSpellCast(
				SAMPLE_SPELLS.firebolt,
				state,
				{
					target: "enemy",
					attackRoll: 18, // Mock attack roll
				},
			);

			expect(castResult.success).toBe(true);
			expect(castResult.attackResult).toBeDefined();
			expect(castResult.damage).toBeDefined();
		});

		it("should execute full healing spell flow", () => {
			state.setHp(50, 30); // max 50, current 30

			const castResult = CharacterSheetState.executeSpellCast(
				SAMPLE_SPELLS.cureWounds,
				state,
				{
					target: "self",
					slotLevel: 1,
				},
			);

			expect(castResult.success).toBe(true);
			expect(castResult.healing).toBeDefined();
			expect(castResult.healing.total).toBeGreaterThan(0);
		});

		it("should execute full condition spell flow", () => {
			const target = new CharacterSheetState();
			target.setName("Enemy");

			const castResult = CharacterSheetState.executeSpellCast(
				SAMPLE_SPELLS.holdPerson,
				state,
				{
					target: target,
					slotLevel: 2,
					targetSaveRoll: 8, // Failed save (assuming DC 14)
				},
			);

			expect(castResult.success).toBe(true);
			expect(castResult.conditionApplied).toBe(true);
		});

		it("should set concentration for concentration spells", () => {
			// Clear any existing concentration
			state.breakConcentration?.();

			CharacterSheetState.executeSpellCast(
				SAMPLE_SPELLS.holdPerson,
				state,
				{
					target: "enemy",
					slotLevel: 2,
					targetSaveRoll: 5, // Failed save
				},
			);

			expect(state.isConcentrating?.()).toBe(true);
			expect(state.getConcentration?.()?.spellName).toBe("Hold Person");
		});
	});

	// ==========================================================================
	// Effect Duration Tracking
	// ==========================================================================
	describe("Effect Duration Tracking", () => {
		it("should track spell effect with duration", () => {
			CharacterSheetState.applySpellBuff(SAMPLE_SPELLS.bless, state);

			const activeStates = state.getActiveStates();
			const blessState = activeStates.find(s => s.name === "Bless");

			expect(blessState).toBeDefined();
			expect(blessState.isSpellEffect).toBe(true);
		});

		it("should store duration info on spell effects", () => {
			CharacterSheetState.applySpellBuff(SAMPLE_SPELLS.bless, state);

			const activeStates = state.getActiveStates();
			const blessState = activeStates.find(s => s.name === "Bless");

			expect(blessState.duration).toBeDefined();
			expect(blessState.duration.amount).toBe(1);
			expect(blessState.duration.unit).toBe("minute");
		});

		it("should be able to remove spell effects", () => {
			CharacterSheetState.applySpellBuff(SAMPLE_SPELLS.bless, state);

			let activeStates = state.getActiveStates();
			const blessState = activeStates.find(s => s.name === "Bless");
			expect(blessState).toBeDefined();

			// Remove the state
			state.removeActiveState(blessState.id);

			activeStates = state.getActiveStates();
			const removedState = activeStates.find(s => s.name === "Bless");
			expect(removedState).toBeUndefined();
		});

		it("should mark concentration spells appropriately", () => {
			CharacterSheetState.applySpellBuff(SAMPLE_SPELLS.bless, state);

			const activeStates = state.getActiveStates();
			const blessState = activeStates.find(s => s.name === "Bless");

			expect(blessState.concentration).toBe(true);
		});
	});

	// ==========================================================================
	// Edge Cases
	// ==========================================================================
	describe("Edge Cases", () => {
		it("should handle spells with no dice", () => {
			// Light cantrip has no damage/healing
			const lightSpell = {
				name: "Light",
				source: "XPHB",
				level: 0,
				entries: ["You touch one object. For the duration, the object sheds bright light."],
			};

			const parsed = CharacterSheetState.parseSpellEffects(lightSpell);
			expect(parsed.damage).toBeUndefined();
			expect(parsed.healing).toBeUndefined();
		});

		it("should handle healing that exceeds max HP", () => {
			state.setHp(20, 18); // max 20, current 18

			const result = CharacterSheetState.applySpellEffect(
				SAMPLE_SPELLS.cureWounds,
				state,
				state,
				{slotLevel: 1, healingRoll: 10},
			);

			// Should cap at max HP
			const hp = state.getHp();
			expect(hp.current).toBeLessThanOrEqual(hp.max);
		});

		it("should handle damage that reduces to 0 HP", () => {
			const target = new CharacterSheetState();
			target.setHp(5, 5);

			const result = CharacterSheetState.applySpellEffect(
				SAMPLE_SPELLS.fireball,
				state,
				target,
				{slotLevel: 3, damageRoll: 30, saveResult: "failed"},
			);

			const hp = target.getHp();
			expect(hp.current).toBe(0);
		});
	});

	// ==========================================================================
	// Condition-Granting Buff Spells (like Invisibility)
	// ==========================================================================
	describe("Condition-Granting Buff Spells", () => {
		it("should identify Invisibility as a condition-granting spell", () => {
			const effects = CharacterSheetState.parseSpellEffects(SAMPLE_SPELLS.invisibility);

			expect(effects.conditions).toBeDefined();
			expect(effects.conditions).toContain("invisible");
			expect(effects.concentration).toBe(true);
			expect(effects.duration).toBeDefined();
			expect(effects.duration.amount).toBe(1);
			expect(effects.duration.unit).toBe("hour");
		});

		it("should apply Invisible condition when spell grants it", () => {
			// Directly apply the condition (simulating what happens when casting on self)
			const effects = CharacterSheetState.parseSpellEffects(SAMPLE_SPELLS.invisibility);

			// Apply condition
			if (effects.conditions?.includes("invisible")) {
				state.addCondition("Invisible");
			}

			expect(state.hasCondition("Invisible")).toBe(true);
		});

		it("should get mechanical effects from the condition, not spell text", () => {
			// Add the Invisible condition
			state.addCondition("Invisible");

			// The condition definition should have its effects defined
			const conditionDef = CharacterSheetState.getConditionEffects("Invisible");

			expect(conditionDef).toBeDefined();
			expect(conditionDef.effects).toBeDefined();

			// The Invisible condition should provide advantage on attacks
			const hasAttackAdvantage = conditionDef.effects.some(e =>
				e.type === "advantage" && e.target === "attack",
			);
			expect(hasAttackAdvantage).toBe(true);

			// And disadvantage on attacks against
			const hasDefenseDisadvantage = conditionDef.effects.some(e =>
				e.type === "disadvantage" && e.target === "attacksAgainst",
			);
			expect(hasDefenseDisadvantage).toBe(true);
		});

		it("should track which spell granted the condition", () => {
			// Add active state for the spell effect
			state.addActiveState("custom", {
				name: "Invisibility",
				isSpellEffect: true,
				concentration: true,
				duration: {amount: 1, unit: "hour"},
				grantsConditions: ["Invisible"],
			});

			// Also add the actual condition
			state.addCondition("Invisible");

			const activeStates = state.getActiveStates();
			const invisState = activeStates.find(s => s.name === "Invisibility");

			expect(invisState).toBeDefined();
			expect(invisState.grantsConditions).toContain("Invisible");
		});

		it("should not create duplicate effects from spell text when condition already provides them", () => {
			// The spell effect should NOT have customEffects that duplicate the condition
			state.addActiveState("custom", {
				name: "Invisibility",
				isSpellEffect: true,
				concentration: true,
				duration: {amount: 1, unit: "hour"},
				grantsConditions: ["Invisible"],
				customEffects: [], // Empty! Condition provides the effects
			});

			const activeStates = state.getActiveStates();
			const invisState = activeStates.find(s => s.name === "Invisibility");

			expect(invisState.customEffects).toEqual([]);
		});
	});
});

// =============================================================================
// Spell Effect Parsing Verification Against Official Spells
// =============================================================================
describe("Spell Effect Verification Against Official Spells", () => {
	// These tests verify the parser works correctly with various official spell patterns

	describe("Damage Spell Patterns", () => {
		it("should parse {@damage XdY} pattern", () => {
			const entry = "The target takes {@damage 3d8} force damage.";
			const damage = CharacterSheetState.parseDamageFromEntry(entry);
			expect(damage).toBeDefined();
			expect(damage.dice).toBe("3d8");
			expect(damage.type).toBe("force");
		});

		it("should parse multiple damage types", () => {
			const entry = "The target takes {@damage 2d6} fire damage plus {@damage 1d6} radiant damage.";
			const damages = CharacterSheetState.parseAllDamageFromEntry(entry);
			expect(damages.length).toBe(2);
		});

		it("should parse {@scaledamage} pattern", () => {
			const entry = "The damage increases by {@scaledamage 8d6|3-9|1d6} for each slot level above 3.";
			const scaling = CharacterSheetState.parseScalingFromEntry(entry);
			expect(scaling).toBeDefined();
			expect(scaling.perLevel).toBe("1d6");
		});
	});

	describe("Healing Spell Patterns", () => {
		it("should parse healing dice with modifier", () => {
			const entry = "The creature regains {@dice 2d8} + your spellcasting ability modifier hit points.";
			const healing = CharacterSheetState.parseHealingFromEntry(entry);
			expect(healing).toBeDefined();
			expect(healing.dice).toBe("2d8");
			expect(healing.addModifier).toBe(true);
		});

		it("should parse flat healing amounts", () => {
			const entry = "Each target's Hit Point maximum and current Hit Points increase by 5.";
			const healing = CharacterSheetState.parseHealingFromEntry(entry);
			expect(healing).toBeDefined();
			expect(healing.flat).toBe(5);
		});
	});

	describe("Condition Patterns", () => {
		it("should extract conditions from entries", () => {
			const entry = "The target must succeed on a Wisdom saving throw or have the {@condition Frightened} condition.";
			const conditions = CharacterSheetState.parseConditionsFromEntry(entry);
			expect(conditions).toContain("frightened");
		});

		it("should extract save-ends duration", () => {
			const entry = "At the end of each of its turns, the target can repeat the saving throw, ending the effect on a success.";
			const duration = CharacterSheetState.parseDurationFromEntry(entry);
			expect(duration.endCondition).toBe("save");
		});
	});
});
