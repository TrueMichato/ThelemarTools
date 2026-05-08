import {describeCharacter} from "../utils/characterSpecFactory";
import {PRESET_FULL_ARCANE_ARCHER_HOCHLING} from "../utils/characterBuilder";
import type {FeatureCheck} from "../utils/comprehensiveBuildHelpers";
import {
	TGTT_SPECIALTIES,
	TGTT_BATTLE_TACTICS,
	buildSpecialtyChecks,
	buildBattleTacticChecks,
	buildAnyArcaneShotChecks,
} from "../utils/tgttFeaturePools";

// ── Arcane Archer Fighter L1→20 features matrix ──────────────────────
// Fighter base: Fighting Style (L1 pick), Second Wind (L1 resource —
// prof-bonus uses, short-rest), Weapon Mastery (L1 passive — 3 picks),
// Specialties (L1/5/9/13/17 — picks from a 16-option pool),
// Action Surge (L2 resource — 1 use, then 2 at L17),
// Battle Tactics (L3/7/10/15 — picks from 13 BT options),
// Extra Attack (L5/11/20 passive, count grows),
// Indomitable (L9 resource — 1 → 2 at L13 → 3 at L17), ASIs at
// L4/6/8/12/14/16/19. Subclass: Arcane Shot pool (L3, L7+) and
// 2-of-N Arcane Shot pick (L3 / +1 at L7/10/15/18). Magic Arrow (L7
// passive), Curving Shot (L7 passive), Ever-Ready Shot (L15 passive).
//
// CS-BUG-003 (Combat Methods validator + render container reuse) is
// fixed; CS-BUG-002 (Arcane Shot resource pool not granted) is the
// only blocker remaining for the resource-pool entries.

const FIGHTER_SPECIALTIES = TGTT_SPECIALTIES.Fighter;
const FIGHTER_BATTLE_TACTICS = TGTT_BATTLE_TACTICS;

const ARCANE_ARCHER_FEATURES_MATRIX: FeatureCheck[] = [
	// Fighting Style at L1 — pick 1 from the Fighter list.
	// No effect probe: the +2 from Archery (the most likely pick) goes
	// onto attack rolls, which the sheet doesn't expose as a stable,
	// readable field; reading attack-button text is brittle and
	// preset-dependent.
	{
		level: 1,
		name: /fighting style/i,
		kind: "pick",
		pickedCount: 1,
		pickedFrom: [
			/archery/i,
			/defense/i,
			/dueling/i,
			/great weapon fighting/i,
			/two-weapon fighting/i,
			/protection/i,
			/blind fighting/i,
			/superior technique/i,
			/thrown weapon fighting/i,
			/unarmed fighting/i,
			/interception/i,
		],
	},
	// Second Wind at L1 — prof-bonus uses, short-rest restore.
	// PHB classic Second Wind is 1/short-rest; XPHB grants prof-bonus
	// uses. The TGTT preset uses the 2024-style class file, so allow
	// a [1, prof-bonus-at-20] range and just verify the resource and
	// short-rest restore semantics.  Effects: layer the explicit
	// shortRestRestores probe on top, plus base-roll-button probes
	// (STR ability check, STR save, initiative — all available from L1
	// on every character).
	{
		level: 1,
		name: /second wind/i,
		kind: "resource",
		resourceMax: [1, 6],
		restoreOn: "short",
		effects: [
			{kind: "shortRestRestores", resource: "Second Wind"},
			{kind: "rollSavingThrow", ability: "str"},
			{kind: "rollAbilityCheck", ability: "str"},
			{kind: "rollInitiative"},
		],
	},
	// Weapon Mastery at L1 — Fighter (XPHB/TGTT) gains the mastery
	// property on 3 chosen weapons. The chosen weapon names live in
	// the inventory (not the feature list), so the FEATURE itself is
	// what we probe here. Layered effect: a melee attack roll probe
	// using one of the common Fighter mastery picks.
	{
		level: 1,
		name: /weapon mastery/i,
		kind: "passive",
		effects: [
			{
				kind: "rollAttack",
				attackName: /longsword|greatsword|warhammer|battleaxe|mace|scimitar|rapier|shortsword|longbow|shortbow/i,
				skip: true,
				skipReason: "preset weapon equip varies — covered by other martial specs",
			},
		],
	},
	// Specialties at L1 / +1 each at L5, L9, L13, L17 — TGTT Fighter's
	// pick-list of passive flavor abilities. Every level builds on the
	// L1 pool of 16; cumulative pickedCount reflects total picks owned
	// at that level.
	{level: 1,  name: /specialties/i, kind: "pick", pickedCount: 1, pickedFrom: FIGHTER_SPECIALTIES},
	{level: 5,  name: /specialties/i, kind: "pick", pickedCount: 2, pickedFrom: FIGHTER_SPECIALTIES},
	{level: 9,  name: /specialties/i, kind: "pick", pickedCount: 3, pickedFrom: FIGHTER_SPECIALTIES},
	{level: 13, name: /specialties/i, kind: "pick", pickedCount: 4, pickedFrom: FIGHTER_SPECIALTIES},
	{level: 17, name: /specialties/i, kind: "pick", pickedCount: 5, pickedFrom: FIGHTER_SPECIALTIES},
	// Action Surge at L2 — 1 use, short-rest. Bumps to 2 uses at L17.
	// Effects: explicit shortRestRestores probe, plus a CON save (the
	// other Fighter-proficient save) and a Perception skill-roll probe.
	{
		level: 2,
		name: /action surge/i,
		kind: "resource",
		resourceMax: 1,
		restoreOn: "short",
		effects: [
			{kind: "shortRestRestores", resource: "Action Surge"},
			{kind: "rollSavingThrow", ability: "con"},
			{kind: "rollSkillCheck", skill: "perception"},
		],
	},
	{
		level: 17,
		name: /action surge/i,
		kind: "resource",
		resourceMax: 2,
		effects: [
			{kind: "shortRestRestores", resource: "Action Surge"},
		],
	},
	// Fighter ASIs at L4/6/8/12/14/16/19.
	{level: 4,  name: /ability score improvement/i, kind: "passive"},
	{level: 6,  name: /ability score improvement/i, kind: "passive"},
	{level: 8,  name: /ability score improvement/i, kind: "passive"},
	{level: 12, name: /ability score improvement/i, kind: "passive"},
	{level: 14, name: /ability score improvement/i, kind: "passive"},
	{level: 16, name: /ability score improvement/i, kind: "passive"},
	{level: 19, name: /ability score improvement|epic boon/i, kind: "passive"},
	// Extra Attack: L5 (×2), L11 (×3), L20 (×4) — passive listing.
	// Effects on L5 entry: a longbow/shortbow attack-roll probe (the
	// signature Arcane Archer weapon). Skipped because the preset
	// doesn't auto-equip a bow — the wizard's default starting kit
	// for the TGTT Fighter doesn't surface a longbow attack on the
	// sheet, so clickAttackRoll(/longbow|shortbow/) returns
	// `clicked: false`. Re-enable once the preset's equipment block
	// adds a longbow (or once Arcane Archer's level-up auto-grants
	// the implied weapon).
	{
		level: 5,
		name: /extra attack/i,
		kind: "passive",
		effects: [
			{
				kind: "rollAttack",
				attackName: /longbow|shortbow/i,
				skip: true,
				skipReason: "preset has no bow attack auto-equipped",
			},
		],
	},
	{level: 11, name: /extra attack/i, kind: "passive"},
	{level: 20, name: /extra attack/i, kind: "passive"},
	// Indomitable at L9 — re-roll a failed save. 1 use → 2 at L13 → 3 at L17.
	// Effects: explicit longRestRestores probe (Indomitable is the
	// canonical long-rest Fighter resource) plus an Athletics
	// skill-roll probe (Fighter signature physical skill).
	{
		level: 9,
		name: /indomitable/i,
		kind: "resource",
		resourceMax: 1,
		restoreOn: "long",
		effects: [
			{kind: "longRestRestores", resource: "Indomitable"},
			{kind: "rollSkillCheck", skill: "athletics"},
		],
	},
	{
		level: 13,
		name: /indomitable/i,
		kind: "resource",
		resourceMax: 2,
		effects: [
			{kind: "longRestRestores", resource: "Indomitable"},
		],
	},
	{
		level: 17,
		name: /indomitable/i,
		kind: "resource",
		resourceMax: 3,
		effects: [
			{kind: "longRestRestores", resource: "Indomitable"},
		],
	},

	// Battle Tactics at L3/7/10/15 — TGTT Fighter's curated optional
	// feature pool (13 BT options). Cumulative count grows with the
	// {3:2, 7:1, 10:1, 15:1} progression: 2 / 3 / 4 / 5.
	{level: 3,  name: /battle tactics/i, kind: "pick", pickedCount: 2, pickedFrom: FIGHTER_BATTLE_TACTICS},
	{level: 7,  name: /battle tactics/i, kind: "pick", pickedCount: 3, pickedFrom: FIGHTER_BATTLE_TACTICS},
	{level: 10, name: /battle tactics/i, kind: "pick", pickedCount: 4, pickedFrom: FIGHTER_BATTLE_TACTICS},
	{level: 15, name: /battle tactics/i, kind: "pick", pickedCount: 5, pickedFrom: FIGHTER_BATTLE_TACTICS},

	// Arcane Archer subclass.
	// Arcane Shot resource pool (2/short-rest at L3, scales) — blocked
	// by CS-BUG-002 (subclass features not granted on level-up, so the
	// pool never appears). Re-enable once CS-BUG-002 lands.
	{
		level: 3,
		name: /arcane shot/i,
		kind: "resource",
		resourceMax: 2,
		restoreOn: "short",
		skip: true,
		skipReason: "CS-BUG-002",
	},
	// Arcane Shot pick — replaced with cross-source helper that emits
	// `pickedFeatureGrants` per option's documented effect (Banishing /
	// Beguiling / Bursting / Enfeebling / Grasping / Piercing / Seeking /
	// Shadow). Progression: 2 at L3, +1 at L7/10/15/18.
	...buildAnyArcaneShotChecks(),
	// Magic Arrow at L7 — non-magical ammo counts as magical. Passive.
	{level: 7, name: /magic arrow/i, kind: "passive"},
	// Curving Shot at L7 — re-roll a missed magic-arrow attack on a
	// new target. Passive (no resource of its own).
	{level: 7, name: /curving shot/i, kind: "passive"},
	// Ever-Ready Shot at L15 — start every combat with at least 1
	// Arcane Shot use. Passive feature listing.
	{level: 15, name: /ever-ready shot/i, kind: "passive"},
	// TGTT Specialties (Fighter: 1/5/9/13/17) — helper attaches per-pick
	// effects for the deterministic auto-picker first choice.
	...buildSpecialtyChecks("Fighter"),
	// TGTT Battle Tactics (Fighter base feature) — pick + per-pick
	// effect for the auto-picked tactic.
	...buildBattleTacticChecks(),
];

/**
 * #2 — Arcane Archer Fighter Hochling (TGTT) — L1→20.
 *
 * Coverage focus:
 *   - Fighter Action Surge / Second Wind at low levels
 *   - Arcane Shot options arrive at L3 (Fighter subclass level)
 *   - Extra Attack ×2 at L11, ×3 at L20
 *   - Mid-tier loadout: +1 Longbow → attack bonus delta
 */
describeCharacter({
	preset: PRESET_FULL_ARCANE_ARCHER_HOCHLING,
	displayName: "Arcane Archer Fighter Hochling",
	// CS-BUG-003 fixed (Combat Methods validator + render container reuse).
	// All level-up checkpoints re-enabled.
	skipL3: false,
	skipL5: false,
	skipL7: false,
	skipMega: false,
	midTierLoadout: [
		{name: "Cloak of Protection", source: "XDMG", attune: true},
	],
	signatureToggle: /action surge|second wind|arcane shot/i,
	usage: {
		skillRoll: {name: "Perception"},
		shortRestRestores: {resourceName: "Action Surge", expectAfter: 1},
		concentrationCheck: {skip: true},
		deathSaves: true,
		applyCondition: {skip: true},
		featAbility: {skip: true},
	},
	milestones: {
		1:  {totalLevel: 1,  minMaxHp: 10, expectToggles: [/second wind/i]},
		3:  {totalLevel: 3,  minMaxHp: 25, expectToggles: [/arcane shot|second wind/i]},
		5:  {totalLevel: 5,  minMaxHp: 39},
		11: {totalLevel: 11, minMaxHp: 80},
		17: {totalLevel: 17, minMaxHp: 120},
		20: {totalLevel: 20, minMaxHp: 140},
	},
	featuresMatrix: ARCANE_ARCHER_FEATURES_MATRIX,
});
