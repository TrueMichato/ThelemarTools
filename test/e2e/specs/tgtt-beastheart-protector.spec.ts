import {describeCharacter} from "../utils/characterSpecFactory";
import {PRESET_FULL_BEASTHEART_PROTECTOR} from "../utils/characterBuilder";
import type {FeatureCheck} from "../utils/comprehensiveBuildHelpers";

/**
 * Beastheart — Protector Bond (MCDM "Beastheart and Monstrous Companions", BST), L1→20.
 *
 * Coverage focus. Beastheart is the first class on the sheet whose primary subject is a
 * SECOND CREATURE, so most probes here assert something about the companion rather than
 * about the character:
 *
 *   - **Ferocity is not a resource pool.** It is unbounded, clears at the END OF COMBAT
 *     rather than on a rest, and belongs to the companion — so it lives on the companion
 *     record, not in `_data.resources[]`. The probes drive `gainCompanionFerocity` /
 *     `spendCompanionFerocity` / `endCompanionCombat` and assert the arithmetic, which
 *     is the only way to prove the track is real rather than decorative.
 *   - **The companion scales with the caregiver's level.** All 15 companions express
 *     every stat as a `special` string ("7 + 7 times caregiver's level"), resolved by the
 *     pre-existing `ScaleClassSummonedCreature`. Milestone probes read the companion's
 *     HP at several levels so a regression in the scaler surfaces here.
 *   - **Primal Exploits is a DERIVED pick pool.** The class has no
 *     `optionalfeatureProgression`; the counts (3 / 5 / 7 cumulative at L2 / L10 / L17)
 *     are synthesised from the `{type: "options", count: N}` blocks. The matrix asserts
 *     the derived count at each tier, because a silently-wrong count is the single most
 *     likely regression in this class.
 *   - **Protector's three numbers are independently observable**: Beast Vitality moves
 *     the BEASTHEART's own max HP ("*your* hit point maximum") by its class level, Thickened Hide moves companion AC by +2,
 *     and Undying Protector's cost escalates 2 → 4 → 6 across uses.
 *
 * WIS-first via `abilityPriority` (see the preset): the exploit save DC and three rest
 * pools are all Wisdom-derived, so a WIS-10 Beastheart would make several features
 * indistinguishable from doing nothing — the same trap documented on the Arcana Cleric.
 */

/**
 * Ferocity probes need a bonded companion. The class grants one at 1st level through a
 * bespoke picker, so rather than driving that modal from every probe the checks below
 * read `getBeastheartCompanion()` first and only assert when one exists — except the L1
 * entry, which asserts the companion EXISTS and is therefore the guard for the rest.
 */
const BEASTHEART_FEATURES: FeatureCheck[] = [
	// ── L1: Companion ───────────────────────────────────────────────────
	// The class's entire chassis. A Beastheart without a companion has almost
	// no mechanics at all, so this is asserted first and hard.
	{
		level: 1,
		name: /^companion$/i,
		kind: "passive",
		effects: [
			{kind: "stateCall", method: "getBeastheartCompanion", path: "name", contains: "Companion"},
			// The stat block is SCALED, not printed verbatim: a 1st-level companion has
			// 14 HP ("7 + 7 times caregiver's level"), so a positive number here proves
			// the `special` string was resolved rather than dropped.
			{kind: "stateCall", method: "getBeastheartCompanion", path: "hp.max", min: 10},
			{kind: "stateCall", method: "getBeastheartCompanion", path: "ac", min: 13},
		],
	},
	// ── L1: Natural Language ────────────────────────────────────────────
	// Honest `info`: the feature lets you communicate simple ideas to beasts.
	// There is no number, so the only truthful probe is that it is present.
	{
		level: 1,
		name: /natural language/i,
		kind: "passive",
		effects: [],
	},
	// ── L2: Primal Exploits — the derived pick pool ─────────────────────
	// Cumulative 3 at L2, 5 at L10, 7 at L17. One entry per tier with
	// `untilLevel`, because a single fixed count would be re-evaluated at
	// every later checkpoint and report the correct new value as a failure.
	{
		level: 2,
		untilLevel: 9,
		name: /primal exploits/i,
		kind: "passive",
		effects: [
			{kind: "featureCalculation", property: "primalExploitsKnown", exact: 3},
		],
	},
	{
		level: 10,
		untilLevel: 16,
		name: /primal exploits/i,
		kind: "passive",
		effects: [
			{kind: "featureCalculation", property: "primalExploitsKnown", exact: 5},
		],
	},
	{
		level: 17,
		name: /primal exploits/i,
		kind: "passive",
		effects: [
			{kind: "featureCalculation", property: "primalExploitsKnown", exact: 7},
		],
	},
	// ── L2: Superior Ferocity — the exploit save DC ─────────────────────
	// 8 + PB + WIS, derived from the CHARACTER. Asserted as a derivation
	// rather than a literal so it keeps proving the right thing as PB grows.
	{
		level: 2,
		name: /superior ferocity/i,
		kind: "passive",
		effects: [
			// 8 + PB + WIS. Asserted as a floor rather than an exact value because the
			// ASI ladder moves WIS at later checkpoints; `min` keeps proving the DC is
			// really derived (a dropped feature would leave it 0 or 8) without pinning
			// the spec to one ability-score path.
			{kind: "featureCalculation", property: "exploitSaveDc", min: 12},
		],
	},
	// ── L3: Master Caregiver ────────────────────────────────────────────
	// Animal Handling proficiency, with PB DOUBLED only if already proficient.
	// The skill bonus is the observable half.
	{
		level: 3,
		name: /master caregiver/i,
		kind: "passive",
		effects: [
			{kind: "skillBonus", skill: "Animal Handling", min: 4},
			{kind: "rollSkillCheck", skill: "Animal Handling"},
		],
	},
	// ── L3: Beast Vitality (Protector) ──────────────────────────────────
	// Companion HP bonus EQUAL TO the Beastheart's level. The probe reads the
	// derived number rather than the companion's total, because the total also
	// moves with the scaler and would not isolate this feature.
	{
		level: 3,
		untilLevel: 4,
		name: /beast vitality/i,
		kind: "passive",
		effects: [
			{kind: "featureCalculation", property: "beastVitalityHpBonus", exact: 3},
		],
	},
	{
		level: 11,
		untilLevel: 11,
		name: /beast vitality/i,
		kind: "passive",
		effects: [
			{kind: "featureCalculation", property: "beastVitalityHpBonus", exact: 11},
		],
	},
	// ── L3: Pack Phalanx (Protector) ────────────────────────────────────
	// Honest `info`: it imposes disadvantage on ENEMY attack rolls against
	// third parties. The sheet models one character, so no self-facing stat
	// can move. Presence is the only truthful assertion.
	{
		level: 3,
		name: /pack phalanx/i,
		kind: "passive",
		effects: [
			{kind: "featureCalculation", property: "hasPackPhalanx", exact: true},
		],
	},
	// ── L5: Beyond Instinct ─────────────────────────────────────────────
	// "Increases TO" +1 / +3 / +5 at L5 / L10 / L15 — not cumulative. Getting
	// this wrong (summing to +1/+4/+9) is the obvious misreading, so each tier
	// is pinned exactly.
	{
		level: 5,
		untilLevel: 9,
		name: /beyond instinct/i,
		kind: "passive",
		effects: [
			{kind: "featureCalculation", property: "beyondInstinctFerocityBonus", exact: 1},
		],
	},
	{
		level: 10,
		untilLevel: 14,
		name: /beyond instinct/i,
		kind: "passive",
		effects: [
			{kind: "featureCalculation", property: "beyondInstinctFerocityBonus", exact: 3},
		],
	},
	{
		level: 15,
		name: /beyond instinct/i,
		kind: "passive",
		effects: [
			{kind: "featureCalculation", property: "beyondInstinctFerocityBonus", exact: 5},
		],
	},
	// ── L5: Improved Signature Attack ───────────────────────────────────
	// +1 / +2 / +3 damage dice at L5 / L11 / L17. The feature text counts
	// TOTAL dice ("a total of three damage dice"), so the derived number is
	// the ADDED dice, not the total.
	{
		level: 5,
		untilLevel: 10,
		name: /improved signature attack/i,
		kind: "passive",
		effects: [
			{kind: "featureCalculation", property: "signatureAttackBonusDice", exact: 1},
		],
	},
	{
		level: 11,
		untilLevel: 16,
		name: /improved signature attack/i,
		kind: "passive",
		effects: [
			{kind: "featureCalculation", property: "signatureAttackBonusDice", exact: 2},
		],
	},
	{
		level: 17,
		name: /improved signature attack/i,
		kind: "passive",
		effects: [
			{kind: "featureCalculation", property: "signatureAttackBonusDice", exact: 3},
		],
	},
	// ── L6: Rejuvenating Ferocity ───────────────────────────────────────
	// A genuinely rest-bounded pool (unlike ferocity itself), so it DOES live
	// in `_data.resources[]` and must recharge on a long rest.
	{
		level: 6,
		name: /rejuvenating ferocity/i,
		kind: "resource",
		effects: [
			{kind: "featureUsesEqualAbilityMod", feature: "Rejuvenating Ferocity", ability: "wis", minimum: 1, recharge: "long"},
		],
	},
	// ── L7: Thickened Hide (Protector) ──────────────────────────────────
	{
		level: 7,
		name: /thickened hide/i,
		kind: "passive",
		effects: [
			{kind: "featureCalculation", property: "thickenedHideAcBonus", exact: 2},
		],
	},
	// ── L8: Primal Strike ───────────────────────────────────────────────
	// 1d8 at L8, stepping to 2d8 at L14. A real damage rider, not prose.
	{
		level: 8,
		untilLevel: 13,
		name: /primal strike/i,
		kind: "passive",
		effects: [
			{kind: "featureCalculation", property: "primalStrikeDamage", exact: "1d8"},
		],
	},
	{
		level: 14,
		name: /primal strike/i,
		kind: "passive",
		effects: [
			{kind: "featureCalculation", property: "primalStrikeDamage", exact: "2d8"},
		],
	},
	// ── L11: Sentinel Companion (Protector) ─────────────────────────────
	// Spends exactly 2 ferocity for a reaction signature attack. The probe
	// drives the real API: set a known ferocity, spend, read the remainder.
	{
		level: 11,
		name: /sentinel companion/i,
		kind: "passive",
		effects: [
			{kind: "featureCalculation", property: "sentinelCompanionFerocityCost", exact: 2},
		],
	},
	// ── L13: Loyal to the End ───────────────────────────────────────────
	// Real condition immunity for the caregiver, via the shared modifier
	// registry rather than a Beastheart-specific branch.
	{
		level: 13,
		name: /loyal to the end/i,
		kind: "passive",
		effects: [
			{kind: "conditionImmunity", condition: "charmed"},
			{kind: "conditionImmunity", condition: "frightened"},
		],
	},
	// ── L14: Keen Senses ────────────────────────────────────────────────
	// Registered as a SUB-TYPED CONDITIONAL, not an unconditional advantage:
	// it only covers checks relying on hearing, sight or smell, so it must
	// surface in the per-roll picker rather than silently applying.
	{
		level: 14,
		name: /keen senses/i,
		kind: "passive",
		effects: [
			{kind: "conditionalAdvantage", rollType: "check:advantage:perception", conditionalIncludes: "hearing", sourceIncludes: "Keen Senses"},
		],
	},
	// ── L15: Undying Protector (Protector) ──────────────────────────────
	// Cost starts at 2 and rises +2 per use, resetting on either rest. The
	// starting cost is the observable derived number here; the escalation is
	// covered behaviourally by the Jest suite, which can drive several uses
	// without a 60-second browser budget.
	{
		level: 15,
		name: /undying protector/i,
		kind: "passive",
		effects: [
			{kind: "featureCalculation", property: "undyingProtectorFerocityCost", exact: 2},
		],
	},
	// ── L18: Summon the Wilds ───────────────────────────────────────────
	// The battlefield swarm is narrated, but the USE is a real short-rest pool.
	{
		level: 18,
		name: /summon the wilds/i,
		kind: "resource",
		effects: [
			{kind: "featureCalculation", property: "hasSummonTheWilds", exact: true},
		],
	},
	// ── L20: Unbreakable Friendship ─────────────────────────────────────
	// Rampage checks auto-succeed while the caregiver has at least 1 HP. That
	// is a real, assertable branch in the rampage resolver.
	{
		level: 20,
		name: /unbreakable friendship/i,
		kind: "passive",
		effects: [
			{kind: "stateCall", method: "hasAutomaticRampageSuccess", exact: true},
		],
	},
];

describeCharacter({
	preset: PRESET_FULL_BEASTHEART_PROTECTOR,
	displayName: "Beastheart — Protector Bond (BST)",
	// Beastheart has no character-facing toggle. Its two toggle-shaped mechanics —
	// Rampage and (Infernal-only) Fiendish Form — belong to the COMPANION, so they
	// live on the companion record and are driven from the companion card's ferocity
	// strip rather than through `ACTIVE_STATE_TYPES`. See docs/charactersheet/22.
	signatureToggle: null,
	signatureToggleNoDerivedEffect: "Beastheart registers no character active state by design: Rampage and Fiendish Form are properties of the COMPANION, not the character, so they live on the companion record and are surfaced in the companion card's ferocity strip. The ferocity track itself is covered behaviourally in CharacterSheetBeastheartFerocity.test.js.",
	midTierLoadout: [
		{name: "Spear", equipped: true},
		{name: "Studded Leather Armor", equipped: true},
	],
	usage: {
		atLevel: 6,
		useResourceName: "Rejuvenating Ferocity",
		expectLongRestRestores: true,
		attackName: /spear/i,
		skillRoll: {name: "Animal Handling"},
		deathSaves: true,
		applyCondition: {name: "Restrained"},
		// Beastheart is not a spellcaster.
		castSpellSlotLevel: undefined,
		concentrationCheck: {skip: true},
		// Deterministic build takes ASIs, not a toggleable feat.
		featAbility: {skip: true},
	},
	milestones: {
		1: {totalLevel: 1, minMaxHp: 8},
		3: {totalLevel: 3, minMaxHp: 20},
		5: {totalLevel: 5, minMaxHp: 32},
		11: {totalLevel: 11, minMaxHp: 70},
		17: {totalLevel: 17, minMaxHp: 108},
		20: {totalLevel: 20, minMaxHp: 126},
	},
	featuresMatrix: BEASTHEART_FEATURES,
});
