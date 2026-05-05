import {describeMulticlassCharacter} from "../utils/characterSpecFactory";
import {PRESET_FULL_HEX_DIVINE_TORTLE} from "../utils/characterBuilder";

/**
 * #5 — Hexblade Warlock 2 / Divine Soul Sorcerer 18 Tortle (TGTT).
 *
 * Tests:
 *   - Pact Magic + Spell Slots coexist (Warlock pact slots + Sorcerer
 *     prepared slot pool both visible on Spells tab).
 *   - Hex/Hexblade's Curse signature toggle present after L1.
 *   - Divine Soul affinity selection completed during creation.
 *   - Reaching final 2/18 split reports total character level 20 with
 *     Sorcery Points = 18 max and 9th-level slots present.
 */
describeMulticlassCharacter({
	displayName: "Hexblade 2 / Divine Soul 18 Tortle",
	preset: {
		...PRESET_FULL_HEX_DIVINE_TORTLE,
		// Builder must auto-pick a Divine Soul affinity at the Sorcerer leg,
		// not at the Warlock primary leg.  We set the affinity here so the
		// downstream multiclass step (after Sorcerer level 1) consumes it.
		divineSoulAffinity: "Good",
	},
	plan: [
		{className: "Warlock", classSource: "TGTT", subclassName: "The Hexblade", subclassSource: "TGTT-2014",
			signatureSpells: ["Hex", "Eldritch Blast"], toTotalLevel: 2},
		{className: "Sorcerer", classSource: "TGTT", subclassName: "Divine Soul", subclassSource: "TGTT-2014",
			signatureSpells: ["Cure Wounds", "Shield"], toTotalLevel: 20},
	],
	usageAfterEachLeg: [
		// After Warlock 2 — Pact slots present + Hex available + Arcana skill
		{
			useResourceName: "Sorcery Points",  // not yet present; probe will log + skip
			skillRoll: {name: "Arcana"},
		},
		// After Sorcerer 18 — full caster + Sorcery Points + skill probe
		{
			castSpellSlotLevel: 1,
			useResourceName: "Sorcery Points",
			skillRoll: {name: "Persuasion"},
		},
	],
	finalMilestone: {
		totalLevel: 20,
		spellSlots: {1: 4, 5: 2, 7: 1, 9: 1},
		pactSlots: {level: 1, max: 2},
		expectToggles: [/hexblade|hex|metamagic|font of magic/i],
		expectResources: {"Sorcery Points": 18},
	},
});
