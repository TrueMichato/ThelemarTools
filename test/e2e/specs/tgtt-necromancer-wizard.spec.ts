import {describeCharacter} from "../utils/characterSpecFactory";
import {PRESET_FULL_NECROMANCER_WIZARD} from "../utils/characterBuilder";
import type {FeatureCheck} from "../utils/comprehensiveBuildHelpers";
import {buildSpecialtyChecks} from "../utils/tgttFeaturePools";

/**
 * School of Necromancy Wizard (PHB subclass, TGTT-2014 re-source) — L1→20.
 *
 * Coverage focus:
 *   - L3  Necromancy Savant — halves the gp + downtime to scribe Necromancy spells
 *   - L3  Grim Harvest      — heals 2× (3× Necromancy) the slot level on a kill
 *   - L6  Undead Thralls    — Animate Dead lands in the spellbook, created undead
 *                             gain +wizard level HP and +proficiency bonus damage
 *   - L10 Inured to Undeath — necrotic resistance + unreducible hit point maximum
 *   - L14 Command Undead    — action, Charisma save vs. the wizard's spell save DC
 *   - Wizard base: full-caster slot table to 9th, Arcane Recovery, Spell Mastery (18),
 *     Signature Spells (20), and the TGTT Specialties picker at 4/8/12/16/19.
 *
 * Every subclass row below carries at least one `EffectCheck` — the acceptance bar
 * for this build is that each feature computes something, not that it renders.
 */

// ── Necromancer Wizard L1→20 features matrix ────────────────────────
// TGTT Wizard is XPHB-shaped (edition "one"): Spellcasting / Ritual Adept /
// Arcane Recovery at L1, Scholar L2, subclass at L3, ASIs 4/8/12/16/19,
// Memorize Spell L5, Spell Mastery L18, Signature Spells L20.
const NECROMANCER_FEATURES_MATRIX: FeatureCheck[] = [
	// ── Wizard base class ───────────────────────────────────────────
	// L1 Spellcasting carries the always-on baseline probes: the wizard's
	// two proficient saves (INT + WIS), an INT ability check, initiative,
	// and the 1st-level slot table.
	{
		level: 1,
		name: /spellcasting/i,
		kind: "passive",
		effects: [
			{kind: "spellSlots", level: 1, min: 2},
			{kind: "rollAbilityCheck", ability: "int"},
			{kind: "rollSavingThrow", ability: "int"},
			{kind: "rollSavingThrow", ability: "wis"},
			{kind: "rollInitiative"},
			// Wizard L1 cantrips + first-party spell names are blocked by the
			// documented E2E auto-pick gap, not by product code (CS-BUG-016 triage).
			{kind: "cantripCount", min: 3, skip: true, skipReason: "E2E-INFRA: cantrip/spell auto-pick empty"},
			{kind: "spellSaveDc", min: 12, skip: true, skipReason: "E2E-INFRA: cantrip/spell auto-pick empty"},
		],
	},
	// L1 Arcane Recovery — recover slot levels equal to ⌈half wizard level⌉,
	// once per long rest. The pool is exposed as a feature-owned use rather
	// than a generic resource row, so probe the restore semantics.
	{
		level: 1,
		name: /arcane recovery/i,
		kind: "passive",
		effects: [
			{kind: "longRestRestoresFeatureUses", feature: "Arcane Recovery", expectAfter: 1},
		],
	},
	// L2 Scholar — expertise in one Int-based skill (Arcana / History /
	// Investigation / Nature / Religion). Verified via the derived skill bonus.
	{
		level: 2,
		name: /scholar/i,
		kind: "passive",
		effects: [
			{kind: "rollSkillCheck", skill: "Arcana"},
		],
	},
	// ASIs — passive listings. The E2E harness always assigns the standard
	// array STR-first (BuilderWizardPage.assignStandardArray: 15/14/13/12/10/8
	// in str/dex/con/int/wis/cha order), and the level-up auto-picker
	// reinforces the highest score, so the observable proof that the ASI
	// actually applied is STR climbing above its 15 baseline.
	{
		level: 4,
		name: /ability score improvement/i,
		kind: "passive",
		effects: [
			{kind: "abilityScore", ability: "str", min: 17},
		],
	},
	{level: 8, name: /ability score improvement/i, kind: "passive", effects: [{kind: "abilityScore", ability: "str", min: 17}]},
	{level: 12, name: /ability score improvement/i, kind: "passive", effects: [{kind: "abilityScore", ability: "str", min: 17}]},
	{level: 16, name: /ability score improvement/i, kind: "passive", effects: [{kind: "abilityScore", ability: "str", min: 17}]},
	{level: 19, name: /ability score improvement|epic boon/i, kind: "passive", effects: [{kind: "abilityScore", ability: "str", min: 17}]},
	// L5 Memorize Spell — swap one prepared spell after a short rest.
	// no measurable derived effect: it re-labels an existing prepared slot,
	// changing no numeric the sheet exposes.
	{level: 5, name: /memorize spell/i, kind: "passive"},
	// L18 Spell Mastery — cast one 1st- and one 2nd-level spell at will.
	// no measurable derived effect: at-will casting is a spell-list annotation,
	// not a slot/DC/bonus the state engine computes.
	{level: 18, name: /spell mastery/i, kind: "passive"},
	// L20 Signature Spells — two always-prepared 3rd-level spells, each
	// recoverable once per short rest.
	{
		level: 20,
		name: /signature spells/i,
		kind: "passive",
		effects: [
			{kind: "spellSlots", level: 9, min: 1},
		],
	},

	// ── School of Necromancy ────────────────────────────────────────
	// L3 (the subclass-grant level for TGTT's XPHB-shaped Wizard): the
	// "School of Necromancy" umbrella feature carries Necromancy Savant and
	// Grim Harvest.
	//
	// Necromancy Savant halves both the gold and the downtime needed to copy a
	// Necromancy spell into the spellbook. The discount is registered
	// generically (`spellbookScribeDiscounts`) and consumed by
	// `getSpellbookScribeCost`, which the Add-Spell flow surfaces and charges.
	{
		level: 3,
		name: /necromancy savant/i,
		kind: "passive",
		effects: [
			{kind: "featureCalculation", property: "hasNecromancySavant", exact: true},
			// A 3rd-level Necromancy spell: 150 gp / 6 hr baseline → 75 gp / 3 hr.
			{kind: "stateCall", method: "getSpellbookScribeCost", args: [{level: 3, school: "N"}], path: "gp", exact: 75},
			{kind: "stateCall", method: "getSpellbookScribeCost", args: [{level: 3, school: "N"}], path: "hours", exact: 3},
			{kind: "stateCall", method: "getSpellbookScribeCost", args: [{level: 3, school: "N"}], path: "sources", contains: "Necromancy Savant"},
			// …and NO discount for any other school (the discount must be scoped).
			{kind: "stateCall", method: "getSpellbookScribeCost", args: [{level: 3, school: "V"}], path: "gp", exact: 150},
		],
	},
	// Grim Harvest — a TRIGGERED ability (a kill with a levelled spell), so it
	// surfaces as a limited-use activatable row rather than a toggle. The
	// healing itself is computed by `calculateGrimHarvestHealing`.
	{
		level: 3,
		name: /grim harvest/i,
		kind: "passive",
		effects: [
			{kind: "featureCalculation", property: "grimHarvestMultiplier", exact: 2},
			{kind: "featureCalculation", property: "grimHarvestNecromancyMultiplier", exact: 3},
			// The healing is really computed: a 3rd-level kill returns 6 HP,
			// or 9 if the spell was Necromancy.
			{kind: "stateCall", method: "calculateGrimHarvestHealing", args: [3, false], path: "total", exact: 6},
			{kind: "stateCall", method: "calculateGrimHarvestHealing", args: [3, true], path: "total", exact: 9},
			// Cantrip kills never trigger it.
			{kind: "stateCall", method: "calculateGrimHarvestHealing", args: [0, true], path: "total", exact: 0},
		],
	},
	// L6 Undead Thralls — three separate mechanics, each probed:
	//   (a) Animate Dead is added to the spellbook,
	//   (b) created undead gain +wizard level hit points,
	//   (c) created undead gain +proficiency bonus to weapon damage,
	//   (d) one extra corpse per casting.
	{
		level: 6,
		name: /undead thralls/i,
		kind: "passive",
		effects: [
			{kind: "spellInList", spell: "Animate Dead", level: 3},
			{kind: "featureCalculation", property: "createdUndeadHpBonus", min: 6},
			{kind: "featureCalculation", property: "createdUndeadDamageBonus", min: 3},
			{kind: "featureCalculation", property: "createdUndeadExtraTargets", exact: 1},
			// The buff bundle the companion engine actually applies.
			{kind: "stateCall", method: "getCreatedUndeadBonuses", path: "hasAny", exact: true},
			{kind: "stateCall", method: "getCreatedUndeadBonuses", path: "sources", contains: "Undead Thralls"},
		],
	},
	// L10 Inured to Undeath — necrotic resistance AND the hit point maximum
	// can't be reduced. Both are real state effects (the resistance lands in
	// `getResistances()`, the immunity zeroes `getMaxHpReduction()`).
	{
		level: 10,
		name: /inured to undeath/i,
		kind: "passive",
		effects: [
			{kind: "resistance", damageType: "necrotic"},
			{kind: "featureCalculation", property: "hasInuredToUndeath", exact: true},
			// The second half of the feature: the hit point maximum can't be reduced.
			{kind: "stateCall", method: "isImmuneToMaxHpReduction", exact: true},
			{kind: "stateCall", method: "getMaxHpReductionImmunitySources", contains: "Inured to Undeath"},
		],
	},
	// L14 Command Undead — action; the target's Charisma save is made against
	// the wizard's spell save DC, which the sheet computes live.
	{
		level: 14,
		name: /command undead/i,
		kind: "passive",
		effects: [
			// 8 + prof (5 at L14) + INT mod. The E2E harness's standard-array
			// assignment leaves INT at 12 (mod +1) → DC 14.
			{kind: "featureCalculation", property: "commandUndeadDc", min: 14},
			{kind: "featureCalculation", property: "commandUndeadRange", exact: 60},
			{kind: "featureCalculation", property: "commandUndeadSaveAbility", exact: "cha"},
			// The DC the action actually presents equals the wizard's spell save DC.
			{kind: "stateCall", method: "getCommandUndeadInfo", path: "dc", min: 14},
			{kind: "stateCall", method: "getCommandUndeadInfo", path: "ability", exact: "cha"},
		],
	},

	// ── TGTT Specialties picker (4 / 8 / 12 / 16 / 19) ──────────────
	...buildSpecialtyChecks("Wizard"),
];

describeCharacter({
	preset: PRESET_FULL_NECROMANCER_WIZARD,
	displayName: "Necromancer Wizard",
	// Grim Harvest and Command Undead are limited-use ABILITIES (a triggered
	// heal and a one-shot action), not persistent toggles, and the subclass
	// grants no toggle at all — so there is nothing for the L5 toggle-delta
	// probe to flip. Deliberately declared rather than silently dropped.
	signatureToggleSkip: {skip: true, reason: "School of Necromancy grants no toggleable state — Grim Harvest / Command Undead are one-shot abilities"},
	// CS-BUG-030: TGTT presets deliberately ship unarmed, so equip a weapon the
	// USE attack probe can actually roll, plus an attunement item that moves a
	// derived stat at L5.
	midTierLoadout: [
		{name: "Quarterstaff", equipped: true},
		{name: "Cloak of Protection", source: "XDMG", attune: true},
	],
	usage: {
		atLevel: 5,
		castSpellSlotLevel: 1,
		expectLongRestRestores: true,
		attackName: /quarterstaff|dagger/i,
		skillRoll: {name: "Arcana"},
		// Arcane Recovery restores slots on a SHORT rest but is not exposed under
		// a stable resource name across builds; the feature-use restore is asserted
		// in the matrix instead.
		shortRestRestores: {skip: true},
		concentrationCheck: {castSpell: "Blur", thenAction: "damage", expectActive: false},
		deathSaves: true,
		applyCondition: {skip: true},
		featAbility: {skip: true},
	},
	milestones: {
		1: {totalLevel: 1, spellSlots: {1: 2}},
		3: {totalLevel: 3, spellSlots: {2: 2}},
		5: {totalLevel: 5, spellSlots: {3: 2}},
		11: {totalLevel: 11, spellSlots: {6: 1}},
		17: {totalLevel: 17, spellSlots: {9: 1}},
		20: {totalLevel: 20, spellSlots: {9: 1}},
	},
	featuresMatrix: NECROMANCER_FEATURES_MATRIX,
});
