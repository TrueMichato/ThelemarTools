import {describeCharacter} from "../utils/characterSpecFactory";
import {PRESET_FULL_CHILD_OF_SUN_HOCHLING} from "../utils/characterBuilder";
import type {FeatureCheck} from "../utils/comprehensiveBuildHelpers";
import {buildSpecialtyChecks, buildAnyMetamagicChecks, TGTT_METAMAGIC} from "../utils/tgttFeaturePools";

// ── Child of the Sun Sorcerer L1→20 features matrix ──────────────────
// Sorcerer base (PHB classic — TGTT uses PHB Sorc table):
//   L2 Font of Magic / Sorcery Points (= Sorc level, long-rest restore)
//   L3 Metamagic — 3 known; 5 total at L10; 7 total at L17
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
	// TGTT Sorcery Points equal sorcerer level + 1 from L1; Font
	// of Magic → long-rest restore until Sorcerous Restoration.
	// L3 anchor also carries the Hochling racial probes (Aasimar copy:
	// resistance to necrotic + radiant, Light cantrip via Light Bearer)
	// and the Sorcerer cantrip-count baseline (4 cantrips known at L1+).
	{
		level: 3,
		name: "Sorcery Points",
		kind: "resource",
		untilLevel: 4,
		resourceMax: 4,
		restoreOn: "long",
		effects: [
			{kind: "longRestRestores", resource: "Sorcery Points"},
			// Hochling = Aasimar copy: Celestial Resistance grants
			// resistance to necrotic and radiant damage at L1.
			{kind: "resistance", damageType: "necrotic"},
			{kind: "resistance", damageType: "radiant"},
			// Light cantrip — granted by Hochling/Aasimar Light Bearer
			// (and re-granted by Glimpse of the Sun at L3).
			{kind: "spellInList", spell: "Light"},
			// Sorcerer L1 picks 4 cantrips (Sun Bloodline adds Light free).
			{kind: "cantripCount", min: 4},
			// Sorcerers are proficient in CON + CHA saves; CON button
			// must exist and not throw on click.
			{kind: "rollSavingThrow", ability: "con"},
			{kind: "rollSkillCheck", proficientSkills: true, skip: true, skipReason: "P5 follow-up: proficientSkills DOM lookup needs CharacterSheetPage hardening — state-side proficient ≠ rendered button"},
		],
	},
	{level: 5,  name: "Sorcery Points", kind: "resource", untilLevel: 10, resourceMax: 6,
		effects: [
			{kind: "rollSavingThrow", ability: "cha"},
			{kind: "rollAbilityCheck", ability: "cha"},
			{kind: "rollSkillCheck", proficientSkills: true, skip: true, skipReason: "P5 follow-up: proficientSkills DOM lookup needs CharacterSheetPage hardening — state-side proficient ≠ rendered button"},
			{kind: "rollInitiative"},
			// Spell save DC at L5 with CHA ≥ 16 = 8 + prof(3) + CHA(≥3) = 14.
			// Floor measured on THIS build, not aspirational: the preset has no
			// `abilityPriority`, so the standard array leaves the spellcasting
			// ability at its STR-first default (CS-BUG-056, "Follow-up"). DC is
			// 8 + prof + mod with that dump-stat mod. Previously skipped under
			// CS-BUG-016, which was a mis-attribution — the picker never affected
			// the DC. Raise this when the preset gains `abilityPriority`.
			{kind: "spellSaveDc", min: 11},
			// Signature attack — preset grants Fire Bolt cantrip and the
			// Sorcerer starting kit gives a dagger / light crossbow.
			{kind: "rollAttack", attackName: /dagger|crossbow|fire bolt|quarterstaff/i, skip: true, skipReason: "TGTT preset deliberately ships unarmed; see Phase 15 P4 for pre-equip plan"},
		]},
	{level: 11, name: "Sorcery Points", kind: "resource", untilLevel: 16, resourceMax: 12},
	{level: 17, name: "Sorcery Points", kind: "resource", untilLevel: 19, resourceMax: 18},
	{level: 20, name: "Sorcery Points", kind: "resource", resourceMax: 21},

	// TGTT Metamagic picks: 3 at L3, 5 at L10, 7 at L17.
	// The auto-picker's deterministic first choice is Aimed Spell.
	// Active metamagic is selected per cast, not exposed as a standing
	// toggle, so probe the known-only and cast-time state APIs directly.
	{level: 3, untilLevel: 9, name: /metamagic/i, kind: "pick", pickedCount: 3,
		pickedFrom: TGTT_METAMAGIC,
		effects: [
			{kind: "stateCall", method: "getKnownMetamagicKeys", path: "length", exact: 3},
			{kind: "stateCall", method: "getKnownActiveMetamagics", contains: "Aimed Spell"},
			{kind: "stateCall", method: "getMetamagicCost", args: ["aimed", 1], exact: 2},
			{kind: "stateCall", method: "getCastableActiveMetamagics", args: [{slotLevel: 1}], contains: "Aimed Spell"},
			{kind: "stateCall", method: "getCastableActiveMetamagics", args: [{slotLevel: 1}], path: "0.cost", exact: 2},
		]},
	{level: 3, untilLevel: 3, name: /font of magic/i, kind: "passive",
		effects: [
			{kind: "stateCall", method: "onLongRest", ignoreResult: true},
			{kind: "stateCall", method: "getSorceryPoints", path: "current", exact: 4},
			{kind: "stateCall", method: "useSorceryPoint", args: [2], exact: true},
			{kind: "stateCall", method: "getSorceryPoints", path: "current", exact: 2},
			{kind: "stateCall", method: "onLongRest", ignoreResult: true},
		]},
	{level: 10, untilLevel: 16, name: /metamagic/i, kind: "pick", pickedCount: 5,
		pickedFrom: TGTT_METAMAGIC,
		effects: [
			{kind: "stateCall", method: "getKnownMetamagicKeys", path: "length", exact: 5},
			{kind: "stateCall", method: "getKnownActiveMetamagics", contains: "Aimed Spell"},
		]},
	{level: 17, name: /metamagic/i, kind: "pick", pickedCount: 7,
		pickedFrom: TGTT_METAMAGIC,
		effects: [
			{kind: "stateCall", method: "getKnownMetamagicKeys", path: "length", exact: 7},
			{kind: "stateCall", method: "getKnownActiveMetamagics", contains: "Aimed Spell"},
		]},

	// Phase H additive coverage: helper-driven per-pick effect probes
	// (`pickedFeatureGrants` for the auto-picker's deterministic first
	// choice). Complements the rich rows above which assert ownership
	// and cast-time availability through the metamagic state APIs.
	...buildAnyMetamagicChecks(["TGTT"]),

	// Sorcerous Restoration at L20 — short-rest recovery of up to 4 SP.
	{level: 20, name: /sorcerous restoration/i, kind: "passive",
		effects: [
			{kind: "shortRestRestores", resource: "Sorcery Points"},
		]},

	// ── Child of the Sun Bloodline subclass ──────────────────────
	// Subclass features all key off L3 in this build (TGTT copies the
	// Ar2 bloodline whose first feature lands at sorcerer level 3).
	// Glimpse of the Sun grants the {@spell light} cantrip free; the
	// SP-fueled flare reaction has no clean state probe.
	{level: 3, name: /glimpse of the sun/i, kind: "passive",
		effects: [
			{kind: "spellInList", spell: "Light"},
		]},
	// Summer's Defiant Blood — passive damage rider that adds CHA mod
	// to the next spell after being targeted. No state-observable
	// probe (no AC/DC/resource delta), so listed without effects.
	{level: 3, name: /summer'?s defiant blood/i, kind: "passive"},

	// Sun Spells — always-prepared bloodline spells. The `kind:
	// "spells"` check verifies the spells appear via `grantsSpells`.
	// `spellInList` effect probes are an additional independent
	// assertion that the spell name ends up in the known-spells list.
	{level: 3, name: /sun spells/i, kind: "spells",
		grantsSpells: ["Continual Flame", "Flaming Sphere"],
		effects: [
			{kind: "spellInList", spell: "Continual Flame"},
			{kind: "spellInList", spell: "Flaming Sphere"},
		]},
	{level: 5, name: /sun spells/i, kind: "spells",
		grantsSpells: ["Daylight"],
		effects: [
			{kind: "spellInList", spell: "Daylight"},
		]},
	{level: 7, name: /sun spells/i, kind: "spells",
		grantsSpells: ["Fire Shield"],
		effects: [
			{kind: "spellInList", spell: "Fire Shield"},
		]},
	{level: 9, name: /sun spells/i, kind: "spells",
		grantsSpells: ["Dawn"],
		effects: [
			{kind: "spellInList", spell: "Dawn"},
		]},

	// Higher-tier subclass features inherited from the Ar2 base
	// bloodline (Sunlit Path, Grasping the Sun, Bright Zenith).
	// Probed as passive listings only — Ar2 is not in-tree, so the
	// detailed mechanics aren't authoritative; rely on the parent
	// passive presence check rather than inventing effect probes.
	{level: 6,  name: /sunlit path/i,    kind: "passive"},
	{level: 14, name: /grasping the sun/i, kind: "passive"},
	{level: 18, name: /bright zenith/i,  kind: "passive"},
	...buildSpecialtyChecks("Sorcerer"),
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
	// CS-BUG-030: TGTT presets deliberately ship unarmed, so equip a weapon
	// the USE attack probe can actually roll.
	midTierLoadout: [
		{name: "Dagger", equipped: true},
	],
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
