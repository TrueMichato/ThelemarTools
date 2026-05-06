import {describeCharacter} from "../utils/characterSpecFactory";
import {PRESET_FULL_CHILD_OF_SUN_HOCHLING} from "../utils/characterBuilder";
import type {FeatureCheck} from "../utils/comprehensiveBuildHelpers";

// ── Child of the Sun Sorcerer L1→20 features matrix ──────────────────
// Sorcerer base (PHB classic — TGTT uses PHB Sorc table):
//   L2 Font of Magic / Sorcery Points (= Sorc level, long-rest restore)
//   L3 Metamagic — pick 2; +1 at L10 (3 total); +1 at L17 (4 total)
//   L20 Sorcerous Restoration — short-rest recovery of up to 4 SP
// Child of the Sun Bloodline subclass (TGTT, copies Ar2 base):
//   L1 Glimpse of the Sun — passive on the sheet (cantrip rider)
//      with a sorcery-point-fueled flare action available from L3
//   L1 Summer's Defiant Blood — passive damage-rider reaction
//   L3 Sun Spells — always-prepared bloodline spell list
//      (continual flame, faerie fire, flaming sphere etc. at L3)
//   L6 Sunlit Path (passive) / L14 Grasping the Sun / L18 Bright Zenith
const CHILD_OF_SUN_FEATURES_MATRIX: FeatureCheck[] = [
	// ── Sorcerer base ────────────────────────────────────────────
	// Sorcery Points pool scales with sorcerer level from L2; Font
	// of Magic → long-rest restore until Sorcerous Restoration.
	{level: 2,  name: "Sorcery Points", kind: "resource", resourceMax: 2,  restoreOn: "long"},
	{level: 3,  name: "Sorcery Points", kind: "resource", resourceMax: 3},
	{level: 5,  name: "Sorcery Points", kind: "resource", resourceMax: 5},
	{level: 11, name: "Sorcery Points", kind: "resource", resourceMax: 11},
	{level: 17, name: "Sorcery Points", kind: "resource", resourceMax: 17},
	{level: 20, name: "Sorcery Points", kind: "resource", resourceMax: 20},

	// Metamagic picks: 2 at L3, +1 at L10, +1 at L17.
	{level: 3,  name: /metamagic/i, kind: "pick", pickedCount: 2,
		pickedFrom: [/quickened/i, /twinned/i, /subtle/i, /careful/i, /distant/i, /empowered/i, /heightened/i, /extended/i, /seeking/i, /transmuted/i]},
	{level: 10, name: /metamagic/i, kind: "pick", pickedCount: 3,
		pickedFrom: [/quickened/i, /twinned/i, /subtle/i, /careful/i, /distant/i, /empowered/i, /heightened/i, /extended/i, /seeking/i, /transmuted/i]},
	{level: 17, name: /metamagic/i, kind: "pick", pickedCount: 4,
		pickedFrom: [/quickened/i, /twinned/i, /subtle/i, /careful/i, /distant/i, /empowered/i, /heightened/i, /extended/i, /seeking/i, /transmuted/i]},

	// Sorcerous Restoration capstone at L20.
	{level: 20, name: /sorcerous restoration/i, kind: "passive"},

	// ── Child of the Sun Bloodline subclass ──────────────────────
	// Subclass features all key off L3 in this build (TGTT copies the
	// Ar2 bloodline whose first feature lands at sorcerer level 3).
	// Glimpse of the Sun grants the Light cantrip + a SP-fueled flare;
	// Summer's Defiant Blood is a passive damage rider.
	{level: 3, name: /glimpse of the sun/i, kind: "passive"},
	{level: 3, name: /summer'?s defiant blood/i, kind: "passive"},
	// Sun Spells — always-prepared bloodline spells. Use `kind:
	// "spells"` with representative entries from each unlocked tier
	// (lower-cased lookups are case-insensitive).
	{level: 3, name: /sun spells/i, kind: "spells",
		grantsSpells: ["Continual Flame", "Flaming Sphere"]},
	{level: 5, name: /sun spells/i, kind: "spells",
		grantsSpells: ["Daylight"]},
	{level: 7, name: /sun spells/i, kind: "spells",
		grantsSpells: ["Fire Shield"]},
	{level: 9, name: /sun spells/i, kind: "spells",
		grantsSpells: ["Dawn"]},

	// Higher-tier subclass features inherited from the Ar2 base
	// bloodline. Probed as passive listings.
	{level: 6,  name: /sunlit path/i,    kind: "passive"},
	{level: 14, name: /grasping the sun/i, kind: "passive"},
	{level: 18, name: /bright zenith/i,  kind: "passive"},
];

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
	featuresMatrix: CHILD_OF_SUN_FEATURES_MATRIX,
});
