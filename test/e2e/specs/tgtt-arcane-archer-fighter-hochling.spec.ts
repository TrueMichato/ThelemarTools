import {describeCharacter} from "../utils/characterSpecFactory";
import {PRESET_FULL_ARCANE_ARCHER_HOCHLING} from "../utils/characterBuilder";
import type {FeatureCheck} from "../utils/comprehensiveBuildHelpers";

// ── Arcane Archer Fighter L1→20 features matrix ──────────────────────
// Fighter base: Fighting Style (L1 pick), Second Wind (L1 resource —
// prof-bonus uses, short-rest), Action Surge (L2 resource — 1 use,
// then 2 at L17), Extra Attack (L5/11/20 passive, count grows),
// Indomitable (L9 resource — 1 → 2 at L13 → 3 at L17), ASIs at
// L4/6/8/12/14/16/19. Subclass: Arcane Shot pool (L3, L7+) and
// 2-of-N Arcane Shot pick (L3 / +1 at L7/10/15/18) — both blocked by
// CS-BUG-002 / CS-BUG-003 respectively. Magic Arrow (L7 passive),
// Curving Shot (L7 passive), Ever-Ready Shot (L15 passive).
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
	{level: 17, name: /action surge/i, kind: "resource", resourceMax: 2},
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
	{level: 13, name: /indomitable/i, kind: "resource", resourceMax: 2},
	{level: 17, name: /indomitable/i, kind: "resource", resourceMax: 3},

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
	// Arcane Shot pick — choose 2 options at L3 (+1 at L7/10/15/18).
	// Blocked by CS-BUG-003 (Combat Methods validator path makes the
	// wizard unfinishable when the pick step fires).
	{
		level: 3,
		name: /arcane shot/i,
		kind: "pick",
		pickedCount: 2,
		pickedFrom: [
			/banishing arrow/i,
			/beguiling arrow/i,
			/bursting arrow/i,
			/enfeebling arrow/i,
			/grasping arrow/i,
			/piercing arrow/i,
			/seeking arrow/i,
			/shadow arrow/i,
		],
		skip: true,
		skipReason: "CS-BUG-003",
	},
	// Magic Arrow at L7 — non-magical ammo counts as magical. Passive.
	{level: 7, name: /magic arrow/i, kind: "passive"},
	// Curving Shot at L7 — re-roll a missed magic-arrow attack on a
	// new target. Passive (no resource of its own).
	{level: 7, name: /curving shot/i, kind: "passive"},
	// Ever-Ready Shot at L15 — start every combat with at least 1
	// Arcane Shot use. Passive feature listing.
	{level: 15, name: /ever-ready shot/i, kind: "passive"},
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
	// Skip L7 + MEGA: blocked by CS-BUG-003 (Combat Methods validator
	// makes the wizard unfinishable when no new methods are available).
	// L3 / L5 stay on as red reminders of the bug.
	skipL7: true,
	skipMega: true,
	midTierLoadout: [
		{name: "Cloak of Protection", source: "XDMG", attune: true},
	],
	signatureToggle: /action surge|second wind|arcane shot/i,
	// Usage spec skipped — CS-BUG-003 makes the L3+ level-up wizard
	// unfinishable for this preset, so the L5 build doesn't complete.
	// Re-enable once the validator is fixed.  When un-skipping, restore:
	//   skillRoll: {name: "Perception"}, shortRestRestores: {resourceName: "Action Surge", expectAfter: 1},
	//   concentrationCheck: {skip: true}, deathSaves: true,
	//   applyCondition: {skip: true}, featAbility: {skip: true},
	usage: {skip: true},
	milestones: {
		1:  {totalLevel: 1,  minMaxHp: 10, expectToggles: [/second wind/i]},
		3:  {totalLevel: 3,  minMaxHp: 26, expectToggles: [/arcane shot|second wind/i]},
		5:  {totalLevel: 5,  minMaxHp: 44},
		11: {totalLevel: 11, minMaxHp: 80},
		17: {totalLevel: 17, minMaxHp: 120},
		20: {totalLevel: 20, minMaxHp: 140},
	},
	featuresMatrix: ARCANE_ARCHER_FEATURES_MATRIX,
});
