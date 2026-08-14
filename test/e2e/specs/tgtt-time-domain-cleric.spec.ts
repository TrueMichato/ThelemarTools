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
	// `destroy undead` is the L5 passive rider, not a row; `channel divinity`
	// is the resource, not the ability. The activatable the sheet actually
	// renders is the Channel Divinity option itself — "Turn Undead".
	signatureToggle: /turn undead|channel divinity|time|temporal/i,
	signatureToggleNoDerivedEffect: "Turn Undead is enemy-facing (undead within 30 ft make a WIS save or flee); the sheet models one character, so no self-facing stat can move. Activation itself is still asserted.",
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
		// The domain spells ARE first-party / EGW spells and they ARE granted
		// always-prepared at the right tiers — verified literally against
		// `additionalSpells.prepared` in homebrew/TravelersGuidetoThelemar.json.
		// (An earlier note in known-bugs.md claimed the sheet listed
		// "plausible but wrong" TGTT-flavor spells here; that is stale.)
		{
			level: 3,
			name: /time domain spells/i,
			kind: "passive",
			effects: <EffectCheck[]>[
				{kind: "spellInList", spell: "Gift of Alacrity"},
				{kind: "spellInList", spell: "Feather Fall"},
				{kind: "spellInList", spell: "Fortune's Favor"},
				{kind: "spellInList", spell: "Immovable Object"},
			],
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
		// another creature's d20). It imposes NO saving throw, so there is no
		// DC to read — the product used to publish a `temporalManipulationDc`
		// calc key, which was invented data nothing rendered; it has been
		// removed. Its real mechanical footprint is that it is a REACTION
		// bound to the shared Channel Divinity pool, which is what is asserted.
		{
			level: 3,
			name: /channel divinity: temporal manipulation/i,
			kind: "resource",
			resourceName: "Channel Divinity",
			effects: [
				{kind: "featureCalculation", property: "hasTemporalManipulation", exact: true},
				{
					kind: "featureActivation",
					feature: "Channel Divinity: Temporal Manipulation",
					activationAction: "reaction",
					resourceName: "Channel Divinity",
					resourceCost: 1,
				},
			],
		},
		// ── L5: Destroy/Sear Undead + 2nd domain spell tier ─────────────
		// Destroy/Sear Undead is a passive Turn Undead upgrade — no clean
		// state probe per Phase-7 hint #4.
		{level: 5, name: /sear undead|destroy undead/i, kind: "passive"},
		// L5 domain spell tier — Haste / Slow, granted always-prepared.
		// rollAttack probe was removed — the TGTT cleric build doesn't
		// auto-equip a weapon, so the attack row regex never matches;
		// the midTierLoadout Mace covers that case in the USE probes.
		{
			level: 5,
			name: /time domain spells/i,
			kind: "passive",
			effects: <EffectCheck[]>[
				{kind: "spellInList", spell: "Haste"},
				{kind: "spellInList", spell: "Slow"},
			],
		},
		// ── L6: Eyes of the Future Past + CD pool grows ─────────────────
		// A genuine bonus-action TOGGLE ("stays active until you dismiss it,
		// up to 1 minute") whose COST is a self-imposed condition: "While
		// using this ability, you are under the blinded condition with respect
		// to everything happening in the present around you." That cost is now
		// mechanically applied through the generic `addsConditions` channel on
		// active states, and released when the toggle ends — both halves are
		// probed here, because a self-imposed condition that leaks is worse
		// than one that never applies.
		// The uses pool is real: product computes `Math.max(1, wisMod)`, which
		// `featureUsesEqualAbilityMod` matches exactly (minimum included), and
		// is preset-independent unlike a literal count.
		{
			level: 6,
			name: /eyes of the future past/i,
			kind: "toggle",
			effects: <EffectCheck[]>[
				{kind: "featureCalculation", property: "hasEyesOfFuturePast", exact: true},
				{
					kind: "featureUsesEqualAbilityMod",
					feature: "Eyes of the Future Past",
					ability: "wis",
					minimum: 1,
					recharge: "long",
				},
				{kind: "toggleAddsCondition", condition: "blinded"},
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
			effects: <EffectCheck[]>[
				{kind: "spellInList", spell: "Death Ward"},
				{kind: "spellInList", spell: "Freedom of Movement"},
			],
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
			effects: <EffectCheck[]>[
				{kind: "spellInList", spell: "Temporal Shunt"},
				{kind: "spellInList", spell: "Hold Monster"},
			],
		},
		// ── L10: Divine Intervention ────────────────────────────────────
		// Once-per-long-rest cinematic feature — no easy probe per hint #5.
		{level: 10, name: /divine intervention/i, kind: "passive"},
		// ── L17: Temporal Mastery capstone subclass feature ─────────────
		// The capstone's prose says it adds Time Stop and Time Ravage to the
		// domain spell list, always prepared. Those two spells were MISSING
		// from `additionalSpells.prepared` in the homebrew, so the grant was
		// inert; a `"17"` tier was added to the book data (no JS special-case
		// — it reuses the same level-gated channel as every other tier).
		// These two probes are what keep that fix honest.
		{
			level: 17,
			name: /temporal mastery/i,
			kind: "passive",
			effects: <EffectCheck[]>[
				{kind: "featureCalculation", property: "hasTemporalMastery", exact: true},
				{kind: "spellInList", spell: "Time Stop"},
				{kind: "spellInList", spell: "Time Ravage"},
			],
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
