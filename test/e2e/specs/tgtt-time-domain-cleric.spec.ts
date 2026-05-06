import {describeCharacter} from "../utils/characterSpecFactory";
import {PRESET_FULL_TIME_CLERIC} from "../utils/characterBuilder";
import type {EffectCheck, FeatureCheck} from "../utils/comprehensiveBuildHelpers";

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
		// Channel Divinity is the canonical short-rest cleric resource —
		// but `getResource("Channel Divinity")` returns nothing on the
		// TGTT Time Domain build at L2 (see CS-BUG-015). Pool-size and
		// shortRestRestores probes therefore skipped until the resource
		// surfaces under a stable name.
		{
			level: 2,
			name: /^channel divinity$/i,
			kind: "passive",
			skip: true,
			skipReason: "CS-BUG-015",
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
		// Reaction-based initiative re-order — no clean state probe; no effects.
		{level: 3, name: /chronological interference/i, kind: "passive"},
		// Initiative bonus is not exposed as a discrete addend — no effects.
		{level: 3, name: /right on time/i, kind: "passive"},
		// CD: Temporal Manipulation is a reaction (advantage/disadvantage on
		// another creature's d20). The sheet doesn't surface a self-targeted
		// roll-mod from this — no effects.
		{level: 3, name: /channel divinity: temporal manipulation/i, kind: "passive"},
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
		// "passive" — no toggle button to drive. Leave probe-less.
		{level: 6, name: /eyes of the future past/i, kind: "passive"},
		// CD pool growth at L6 — same CS-BUG-015 caveat as the L2 entry.
		{level: 6, name: /^channel divinity$/i, kind: "passive", skip: true, skipReason: "CS-BUG-015"},
		// ── L7: 3rd domain spell tier ───────────────────────────────────
		{
			level: 7,
			name: /time domain spells/i,
			kind: "passive",
		},
		// ── L8: Potent Spellcasting ─────────────────────────────────────
		// Potent Spellcasting adds Wis to cantrip damage — no clean
		// numeric probe on the sheet for cantrip-damage bonus, and the
		// `getSpellSaveDC()` page helper currently returns 0 on the
		// TGTT cleric build (probably reading from the wrong tab — see
		// CS-BUG-015 follow-up). No effect probe until that's resolved.
		{
			level: 8,
			name: /potent spellcasting/i,
			kind: "passive",
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
		// TGTT Time Domain spell list at L17 is TGTT-flavored, so we no
		// longer assert specific spell names (CS-BUG-015).
		{
			level: 17,
			name: /temporal mastery/i,
			kind: "passive",
		},
		// ── L20: Divine Intervention auto-success ───────────────────────
		// Auto-success rules upgrade — no probe per hint #5.
		{level: 20, name: /divine intervention improvement|divine intervention/i, kind: "passive"},
	],
});
