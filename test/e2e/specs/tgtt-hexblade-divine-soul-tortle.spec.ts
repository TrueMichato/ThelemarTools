import {describeMulticlassCharacter} from "../utils/characterSpecFactory";
import {PRESET_FULL_HEX_DIVINE_TORTLE} from "../utils/characterBuilder";
import type {FeatureCheck} from "../utils/comprehensiveBuildHelpers";

// ── Hexblade 2 / Divine Soul 18 multiclass features matrix ───────────
// Levels are TOTAL character levels.
//   Char L1-2 = Warlock (Hexblade) 1-2.
//   Char L3-20 = Sorcerer (Divine Soul) 1-18.
const HEX_DIVINE_MULTI_FEATURES_MATRIX: FeatureCheck[] = [
	// ── Warlock leg (TGTT-2014 Hexblade — copy of XGE Hexblade) ─────
	// L1: Pact Magic + Hexblade subclass features. Hexblade's Curse
	// is a toggle (3-min duration buff vs. one creature). Hex Warrior
	// is passive (CHA-to-attack with bound weapon).
	{level: 1, name: /pact magic/i, kind: "passive"},
	{level: 1, name: /hex warrior/i, kind: "passive"},
	{level: 1, name: /hexblade's curse|hexblades curse/i, kind: "toggle", toggleDelta: "any"},
	// L2: Eldritch Invocations — 2 known at Warlock 2.
	{level: 2, name: /eldritch invocations?/i, kind: "pick", pickedCount: 2,
		pickedFrom: [/agonizing blast/i, /armor of shadows/i, /devil's sight/i, /eldritch sight/i,
			/eldritch spear/i, /repelling blast/i, /mask of many faces/i, /misty visions/i,
			/beast speech/i, /book of ancient secrets/i]},

	// ── Sorcerer leg (TGTT-2014 Divine Soul — copy of XGE Divine Soul)
	// L3 = Sorc 1: Spellcasting + Divine Soul + Divine Magic affinity
	// pick + Favored by the Gods (resource — once per short or long
	// rest; max 1).
	{level: 3, name: /divine magic|divine soul/i, kind: "pick",
		pickedFrom: [/good/i, /evil/i, /lawful/i, /chaotic/i, /neutral/i]},
	{level: 3, name: /favored by the gods/i, kind: "resource", resourceMax: [1, 1], restoreOn: "either"},
	// L4 = Sorc 2: Font of Magic / Sorcery Points (max = sorc level).
	{level: 4, name: /sorcery points/i, kind: "resource", resourceMax: [2, 2]},
	{level: 4, name: /font of magic/i, kind: "passive"},
	// L5 = Sorc 3: Metamagic — pick 2 options.
	{level: 5, name: /metamagic/i, kind: "pick", pickedCount: 2,
		pickedFrom: [/careful spell/i, /distant spell/i, /empowered spell/i, /extended spell/i,
			/heightened spell/i, /quickened spell/i, /seeking spell/i, /subtle spell/i,
			/transmuted spell/i, /twinned spell/i]},
	// L8 = Sorc 6: Empowered Healing (subclass — costs 1 sorcery
	// point to reroll a healing die). Modeled as passive feature
	// listing — it consumes the existing Sorcery Points pool rather
	// than exposing its own resource.
	{level: 8, name: /empowered healing/i, kind: "passive"},
	// Sorcery Points pool grows with sorcerer level.
	{level: 8, name: /sorcery points/i, kind: "resource", resourceMax: [6, 6]},
	{level: 12, name: /sorcery points/i, kind: "resource", resourceMax: [10, 10]},
	{level: 16, name: /sorcery points/i, kind: "resource", resourceMax: [14, 14]},
	// L16 = Sorc 14: Otherworldly Wings (toggle — flying speed).
	// Currently the sheet exposes this as a passive listing rather
	// than a stat-changing toggle (no AC/DC delta), so use toggle
	// kind with `none` to validate button presence + activation only.
	{level: 16, name: /otherworldly wings/i, kind: "toggle", toggleDelta: "none"},
	// L20 = Sorc 18: Unearthly Recovery (passive — once per long rest
	// regain HP at half).
	{level: 20, name: /unearthly recovery/i, kind: "passive"},
	{level: 20, name: /sorcery points/i, kind: "resource", resourceMax: [18, 18]},
];

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
	featuresMatrix: HEX_DIVINE_MULTI_FEATURES_MATRIX,
});
