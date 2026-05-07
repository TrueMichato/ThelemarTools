import {describeCharacter} from "../utils/characterSpecFactory";
import {PRESET_FULL_CHILD_OF_SUN_HOCHLING} from "../utils/characterBuilder";
import type {FeatureCheck} from "../utils/comprehensiveBuildHelpers";
import {buildSpecialtyChecks} from "../utils/tgttFeaturePools";

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
	// L2 anchor also carries the Hochling racial probes (Aasimar copy:
	// resistance to necrotic + radiant, Light cantrip via Light Bearer)
	// and the Sorcerer cantrip-count baseline (4 cantrips known at L1+).
	{level: 2,  name: "Sorcery Points", kind: "resource", resourceMax: 2,  restoreOn: "long",
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
		]},
	{level: 3,  name: "Sorcery Points", kind: "resource", resourceMax: 3,
		effects: [
			// Sorcerers are proficient in CON + CHA saves; CON button
			// must exist and not throw on click.
			{kind: "rollSavingThrow", ability: "con"},
			{kind: "rollSkillCheck", skill: "arcana"},
		]},
	{level: 5,  name: "Sorcery Points", kind: "resource", resourceMax: 5,
		effects: [
			{kind: "rollSavingThrow", ability: "cha"},
			{kind: "rollAbilityCheck", ability: "cha"},
			{kind: "rollSkillCheck", skill: "persuasion"},
			{kind: "rollInitiative"},
			// Spell save DC at L5 with CHA ≥ 16 = 8 + prof(3) + CHA(≥3) = 14.
			{kind: "spellSaveDc", min: 13},
			// Signature attack — preset grants Fire Bolt cantrip and the
			// Sorcerer starting kit gives a dagger / light crossbow.
			{kind: "rollAttack", attackName: /dagger|crossbow|fire bolt|quarterstaff/i},
		]},
	{level: 11, name: "Sorcery Points", kind: "resource", resourceMax: 11},
	{level: 17, name: "Sorcery Points", kind: "resource", resourceMax: 17},
	{level: 20, name: "Sorcery Points", kind: "resource", resourceMax: 20},

	// Metamagic picks: 2 at L3, +1 at L10, +1 at L17.
	// `pickedFrom` verifies that a chosen Metamagic surfaces as a
	// feature entry. `pickToggleable` then verifies that ≥1 of the
	// picked options is an Active metamagic surfaced as a toggle on
	// the sheet. `matchAny` enumerates ONLY active TGTT metamagics
	// (passive options like Careful / Distant / Empowered / Extended
	// / Transmuted don't surface as toggles, so listing them would
	// be noise). Mirrors the Heroic Soul Sorcerer pattern.
	{level: 3,  name: /metamagic/i, kind: "pick", pickedCount: 2,
		pickedFrom: [/quickened/i, /twinned/i, /subtle/i, /careful/i, /distant/i, /empowered/i, /heightened/i, /extended/i, /seeking/i, /transmuted/i],
		effects: [
			{kind: "pickToggleable", min: 1, matchAny: [
				/quickened spell/i, /twinned spell/i, /subtle spell/i, /heightened spell/i,
				/bestowed spell/i, /aimed spell/i, /bouncing spell/i, /focused spell/i,
				/lingering spell/i, /overcharged spell/i, /seeking spell/i, /vampiric spell/i,
			]},
		]},
	{level: 10, name: /metamagic/i, kind: "pick", pickedCount: 3,
		pickedFrom: [/quickened/i, /twinned/i, /subtle/i, /careful/i, /distant/i, /empowered/i, /heightened/i, /extended/i, /seeking/i, /transmuted/i],
		effects: [
			{kind: "pickToggleable", min: 1, matchAny: [
				/quickened spell/i, /twinned spell/i, /subtle spell/i, /heightened spell/i,
				/bestowed spell/i, /aimed spell/i, /bouncing spell/i, /focused spell/i,
				/lingering spell/i, /overcharged spell/i, /seeking spell/i, /vampiric spell/i,
			]},
		]},
	{level: 17, name: /metamagic/i, kind: "pick", pickedCount: 4,
		pickedFrom: [/quickened/i, /twinned/i, /subtle/i, /careful/i, /distant/i, /empowered/i, /heightened/i, /extended/i, /seeking/i, /transmuted/i],
		effects: [
			{kind: "pickToggleable", min: 1, matchAny: [
				/quickened spell/i, /twinned spell/i, /subtle spell/i, /heightened spell/i,
				/bestowed spell/i, /aimed spell/i, /bouncing spell/i, /focused spell/i,
				/lingering spell/i, /overcharged spell/i, /seeking spell/i, /vampiric spell/i,
			]},
		]},

	// Sorcerous Restoration capstone at L20 — short-rest recovery of
	// up to 4 SP. Probe the short-rest restore behaviour to confirm
	// the resource is wired up.
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
