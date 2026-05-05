import {describeCharacter} from "../utils/characterSpecFactory";
import {PRESET_FULL_CHILD_OF_SUN_HOCHLING} from "../utils/characterBuilder";

/**
 * #6 — Child of the Sun Bloodline Sorcerer Hochling (TGTT) — L1→20.
 *
 * Coverage focus:
 *   - Sorcery Points scale with class level (TGTT grants Font of Magic at L1)
 *   - Bloodline-specific resistances / fire damage rider at L1
 *   - Metamagic options arrive on schedule
 *   - Sorcerous Restoration / capstone arrives at L20
 */
describeCharacter({
	preset: PRESET_FULL_CHILD_OF_SUN_HOCHLING,
	displayName: "Child of the Sun Sorcerer Hochling",
	signatureToggle: /metamagic|sun|font of magic|searing/i,
	usage: {
		atLevel: 5,
		castSpellSlotLevel: 1,
		useResourceName: "Sorcery Points",
		expectLongRestRestores: true,
		attackName: /dagger|crossbow/i,
		skillRoll: {name: "Persuasion"},
		// Sorcery Points restore on long rest, not short rest; skip cleanly.
		shortRestRestores: {skip: true},
		concentrationCheck: {castSpell: "Bless", thenAction: "damage", expectActive: false},
		deathSaves: true,
		applyCondition: {skip: true},
		featAbility: {skip: true},
	},
	milestones: {
		1:  {totalLevel: 1,  spellSlots: {1: 2},  expectResources: {"Sorcery Points": 1}},
		3:  {totalLevel: 3,  spellSlots: {2: 2},  expectResources: {"Sorcery Points": 3}},
		5:  {totalLevel: 5,  spellSlots: {3: 2},  expectResources: {"Sorcery Points": 5}},
		11: {totalLevel: 11, spellSlots: {6: 1}, expectResources: {"Sorcery Points": 11}},
		17: {totalLevel: 17, spellSlots: {9: 1}, expectResources: {"Sorcery Points": 17}},
		20: {totalLevel: 20, spellSlots: {9: 1}, expectResources: {"Sorcery Points": 20}},
	},
});
