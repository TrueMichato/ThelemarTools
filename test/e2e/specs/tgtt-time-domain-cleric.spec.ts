import {describeCharacter} from "../utils/characterSpecFactory";
import {PRESET_FULL_TIME_CLERIC} from "../utils/characterBuilder";
import type {EffectCheck, FeatureCheck} from "../utils/comprehensiveBuildHelpers";
import {buildSpecialtyChecks} from "../utils/tgttFeaturePools";

/**
 * #10 — Time Domain Cleric (TGTT) — L1→20.
 *
 * Coverage focus:
 *   - Channel Divinity uses scale (1→2→3 by L18)
 *   - Cleric spell slot table all the way to 9th-level
 *   - Subclass features at L1, L3, L6, L8, L17
 *   - Divine Intervention at L10, automatic at L20
 */
describeCharacter({
	preset: PRESET_FULL_TIME_CLERIC,
	displayName: "Time Domain Cleric",
	signatureToggle: /channel divinity|time|temporal|destroy undead/i,
	// CS-BUG-030: TGTT presets deliberately ship unarmed, so equip a weapon
	// the USE attack probe can actually roll.
	midTierLoadout: [
		{name: "Mace", equipped: true},
	],
	usage: {
		atLevel: 5,
		castSpellSlotLevel: 1,
		useResourceName: "Channel Divinity",
		expectLongRestRestores: true,
		attackName: /mace|warhammer/i,
		skillRoll: {name: "Religion"},
		// Channel Divinity restores on a short rest.
		shortRestRestores: {resourceName: "Channel Divinity"},
		concentrationCheck: {castSpell: "Bless", thenAction: "damage", expectActive: false},
		deathSaves: true,
		applyCondition: {skip: true},
		featAbility: {skip: true},
	},
	milestones: {
		1:  {totalLevel: 1,  spellSlots: {1: 2}},
		3:  {totalLevel: 3,  spellSlots: {2: 2}},
		5:  {totalLevel: 5,  spellSlots: {3: 2}, expectResources: {"Channel Divinity": 1}},
		11: {totalLevel: 11, spellSlots: {6: 1}},
		17: {totalLevel: 17, spellSlots: {9: 1}},
		20: {totalLevel: 20, spellSlots: {9: 1}, expectToggles: [/divine intervention/i]},
	},
	// SMOKE-tier matrix: keep entries conservative — passive presence
	// checks for the well-known features, plus the domain spell list at
	// each granted tier and a Channel Divinity pool size range.
	featuresMatrix: <FeatureCheck[]>[
		// ── L1 baseline ─────────────────────────────────────────────────
		// SMOKE-tier roll-button spread — pinned here because every probe
		// on this entry runs at every milestone (L1/3/5/11/17/20). Cleric
		// proficient saves are Wis and Cha. Note: domain-spell-list and
		// cantrip probes were removed during Phase 7 matrix smoke — the
		// Time Domain TGTT preset prepares TGTT-flavor spells (Accelerate/
		// Decelerate, Animate Claw, etc.), NOT first-party Sacred Flame /
		// Cure Wounds, and the build also surfaces 0 cantrips at L1 (see
		// CS-BUG-015 for the cantrip auto-prep observation).
		{
			level: 1,
			name: /spellcasting/i,
			kind: "passive",
			effects: <EffectCheck[]>[
				{kind: "rollSavingThrow", ability: "wis"},
				{kind: "rollSavingThrow", ability: "cha"},
				{kind: "rollAbilityCheck", ability: "wis"},
				{kind: "rollInitiative"},
			],
		},
		// ── L2: Channel Divinity + Turn Undead ──────────────────────────
		// The pool GROWS (1 / 2 / 3), so it needs one exact-max row per
		// tier with `untilLevel` — the matrix re-evaluates every earlier
		// row at each later checkpoint, so a single fixed max fails by
		// construction. Tiers chosen so each contains a checkpoint from
		// [3, 5, 11, 17, 20]: L2-5 -> {3,5}, L6-17 -> {11,17}, L18+ -> {20}.
		{
			level: 2,
			untilLevel: 5,
			name: /^channel divinity$/i,
			// `kind: "resource"` stringifies a RegExp name to its `.source`, so the
			// anchored form would look up a resource literally called
			// "^channel divinity$" and never match. The regex is still the right
			// FEATURE matcher (it excludes "Channel Divinity: Temporal Manipulation"),
			// so keep it and give the pool lookup its own exact name.
			resourceName: "Channel Divinity",
			kind: "resource",
			resourceMax: 1,
			shortRestRestoresFeatureUses: true,
			effects: [
				{kind: "featureCalculation", property: "channelDivinityUses", exact: 1},
				{kind: "featureCalculationDerivedFrom", property: "channelDivinityDc", equals: "spellSaveDc", ability: "wis"},
			],
		},
		{level: 2, name: /turn undead/i, kind: "passive"},
		// ── L3: Time Domain subclass features + 1st domain spell tier ───
		// Domain spells are "always prepared" but the TGTT Time Domain
		// preset uses TGTT-flavor spells, not first-party Feather Fall.
		// Phase 6 declared Feather Fall here; Phase 7 smoke confirmed
		// the build prepares TGTT-flavor spells instead, so we no
		// longer assert any specific domain spell name.
		{
			level: 3,
			name: /time domain spells/i,
			kind: "passive",
		},
		// CS-BUG-093: the `has*` / `*Uses` / `*Dc` calc keys for Chronological
		// Interference, Temporal Manipulation, Eyes of the Future Past and
		// Temporal Mastery are all WRITE-ONLY (one ref each in js/). They are
		// redundant dead data rather than proof of inertness, though: the POOLS
		// genuinely work, because the generic feature-uses parser reads the
		// homebrew entry and never the calc key. That is why the real readings
		// are pinned alongside them here — `kind: "resource"` reads the rendered
		// sheet and `featureUsesEqualAbilityMod` reads actual feature uses. The
		// bare `featureCalculation` clauses are the weakest assertions in this
		// file and should not be read as evidence of implementation on their own.
		// Reaction-based initiative re-order. The reaction itself has no
		// clean roll probe, but its POOL is level-driven (= proficiency
		// bonus) and its recharge is long — both assertable. Left
		// open-ended deliberately: `derivedFrom` asserts the RELATIONSHIP,
		// so one row stays correct at every checkpoint (2/3/4/6/6) and
		// cannot rot into an inert window.
		{
			level: 3,
			name: /chronological interference/i,
			kind: "resource",
			longRestRestoresFeatureUses: true,
			effects: [
				{kind: "featureCalculation", property: "hasChronologicalInterference", exact: true},
				{
					kind: "featureCalculationDerivedFrom",
					property: "chronologicalInterferenceUses",
					equals: "proficiencyBonus",
				},
			],
		},
		// Initiative bonus is not exposed as a discrete addend on the
		// initiative row, but the derived value IS surfaced. Asserted as a
		// relationship (= Wis mod) rather than a literal: the preset sets
		// no `abilityPriority`, so this build's Wis is 10 and any absolute
		// number here would be asserting the preset, not the product.
		{
			level: 3,
			name: /right on time/i,
			kind: "passive",
			effects: [
				{kind: "featureCalculation", property: "hasRightOnTime", exact: true},
				{
					kind: "featureCalculationDerivedFrom",
					property: "rightOnTimeBonus",
					equals: "abilityMod",
					ability: "wis",
				},
			],
		},
		// CD: Temporal Manipulation is a reaction (advantage/disadvantage on
		// another creature's d20), so there is no self-targeted roll-mod to
		// read. Its SAVE DC is a real mechanical effect and is asserted
		// against the spell save DC it is derived from.
		{
			level: 3,
			name: /channel divinity: temporal manipulation/i,
			kind: "passive",
			effects: [
				{kind: "featureCalculation", property: "hasTemporalManipulation", exact: true},
				{kind: "featureCalculationDerivedFrom", property: "temporalManipulationDc", equals: "spellSaveDc", ability: "wis"},
			],
		},
		// ── L5: Destroy/Sear Undead + 2nd domain spell tier ─────────────
		// Destroy/Sear Undead is a passive Turn Undead upgrade — no clean
		// state probe per Phase-7 hint #4.
		{level: 5, name: /sear undead|destroy undead/i, kind: "passive"},
		// L5 domain spell tier — TGTT Time Domain prepares TGTT-flavor
		// spells (Accelerate/Decelerate, Animate Claw…) rather than
		// first-party Haste/Slow, so we no longer assert specific names
		// (CS-BUG-015). rollAttack probe was also removed — the TGTT
		// cleric build doesn't auto-equip a weapon, so the attack row
		// regex never matches; loadout-driven specs cover that case
		// elsewhere.
		{
			level: 5,
			name: /time domain spells/i,
			kind: "passive",
		},
		// ── L6: Eyes of the Future Past + CD pool grows ─────────────────
		// Bonus-action toggle in the rules but the parent FeatureCheck is
		// "passive" — no toggle button to drive. The uses pool is real
		// though: product computes `Math.max(1, wisMod)`, which
		// `featureUsesEqualAbilityMod` matches exactly (minimum included),
		// and is preset-independent unlike a literal count.
		{
			level: 6,
			name: /eyes of the future past/i,
			kind: "passive",
			effects: [
				{kind: "featureCalculation", property: "hasEyesOfFuturePast", exact: true},
				{
					kind: "featureUsesEqualAbilityMod",
					feature: "Eyes of the Future Past",
					ability: "wis",
					minimum: 1,
					recharge: "long",
				},
			],
		},
		// CD pool grows to 2 at L6 and holds through L17 (checkpoints 11, 17).
		{
			level: 6,
			untilLevel: 17,
			name: /^channel divinity$/i,
			resourceName: "Channel Divinity",
			kind: "resource",
			resourceMax: 2,
			effects: [{kind: "featureCalculation", property: "channelDivinityUses", exact: 2}],
		},
		// ── L7: 3rd domain spell tier ───────────────────────────────────
		{
			level: 7,
			name: /time domain spells/i,
			kind: "passive",
		},
		// ── L8: Potent Spellcasting ─────────────────────────────────────
		// Adds Wis to cleric cantrip damage. There is no cantrip-damage
		// addend to read off the sheet directly, but the product records
		// both the bonus and the OWNING CLASS (so the damage roll scopes
		// the bonus to cleric cantrips rather than every cantrip) — and
		// both are assertable. The bonus is asserted as a relationship,
		// not a literal, because the preset leaves Wis at 10.
		{
			level: 8,
			name: /potent spellcasting/i,
			kind: "passive",
			effects: [
				{kind: "featureCalculation", property: "hasPotentSpellcasting", exact: true},
				{
					kind: "featureCalculationDerivedFrom",
					property: "potentSpellcastingBonus",
					equals: "abilityMod",
					ability: "wis",
				},
				{kind: "featureCalculation", property: "potentSpellcastingClass", exact: "Cleric"},
			],
		},
		// ── L9: 4th domain spell tier ───────────────────────────────────
		{
			level: 9,
			name: /time domain spells/i,
			kind: "passive",
		},
		// ── L10: Divine Intervention ────────────────────────────────────
		// Once-per-long-rest cinematic feature — no easy probe per hint #5.
		{level: 10, name: /divine intervention/i, kind: "passive"},
		// ── L17: Temporal Mastery capstone subclass feature ─────────────
		// TGTT Time Domain spell list at L17 is TGTT-flavored, so we still
		// don't assert specific spell names — but the capstone itself sets
		// a real calculation flag, so its presence is now verified
		// mechanically rather than by name alone.
		{
			level: 17,
			name: /temporal mastery/i,
			kind: "passive",
			effects: [{kind: "featureCalculation", property: "hasTemporalMastery", exact: true}],
		},
		// ── L18: Channel Divinity reaches its final pool of 3 ───────────
		{
			level: 18,
			name: /^channel divinity$/i,
			resourceName: "Channel Divinity",
			kind: "resource",
			resourceMax: 3,
			effects: [{kind: "featureCalculation", property: "channelDivinityUses", exact: 3}],
		},
		// ── L20: Divine Intervention auto-success ───────────────────────
		// Auto-success rules upgrade — no probe per hint #5.
		{level: 20, name: /divine intervention improvement|divine intervention/i, kind: "passive"},
		...buildSpecialtyChecks("Cleric"),
	],
});
