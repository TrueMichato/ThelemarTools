import {describeCharacter} from "../utils/characterSpecFactory";
import {PRESET_FULL_JESTER_DENDULRA} from "../utils/characterBuilder";
import {buildSpecialtyChecks, buildJesterActChecks} from "../utils/tgttFeaturePools";

/**
 * #13 — College of Jesters Bard Dendulra (TGTT) — L1→20.
 *
 * Coverage focus:
 *   - Standard Bard spell-slot scaling and Bardic Inspiration
 *   - 3 *Jester's Acts* (JA optional features) picked at L3,
 *     +1 each at L6 and L14 — at least one of the picked Acts must
 *     surface as an activatable feature on the sheet (validated via
 *     `expectToggles` regex covering all 13 JA names)
 *   - Concentration via Bless
 *   - Short-rest BI restoration is blocked by CS-BUG-008
 */
describeCharacter({
	preset: PRESET_FULL_JESTER_DENDULRA,
	displayName: "College of Jesters Bard Dendulra",
	signatureToggle: /juggle|jaunt|jest|prankster|pantomime|fool|laughing|witty|agility|dazzling|tumbler|disengagement|ridiculous/i,
	// CS-BUG-032: the only Jester's Act that surfaces as a TOGGLE is Pantomime, and
	// its whole effect (speed 0, disadvantage on attacks) lands on the charmed target,
	// which a single-character sheet cannot model. The acts with self effects —
	// notably Jester's Agility (+PB AC for a turn) — are limited-use "Use" abilities
	// rather than toggles; their mechanics are pinned by
	// test/jest/charactersheet/CharacterSheetFeatureTextEffects.test.js.
	signatureToggleNoDerivedEffect: "Pantomime is target-facing; self-effect acts are Use abilities, covered by Jest",
	// CS-BUG-030: TGTT presets deliberately ship unarmed, so equip a weapon
	// the USE attack probe can actually roll.
	midTierLoadout: [
		{name: "Rapier", equipped: true},
	],
	usage: {
		atLevel: 5,
		castSpellSlotLevel: 1,
		useResourceName: "Bardic Inspiration",
		expectLongRestRestores: true,
		attackName: /dagger|rapier|crossbow/i,
		skillRoll: {name: "Performance"},
		shortRestRestores: {skip: true}, // blocked by CS-BUG-008 (Bardic Inspiration not restored on short rest)
		concentrationCheck: {castSpell: "Bless", thenAction: "damage", expectActive: false},
		deathSaves: true,
		applyCondition: {skip: true},
		featAbility: {skip: true},
	},
	milestones: {
		1:  {totalLevel: 1,  spellSlots: {1: 2}, expectResources: {"Bardic Inspiration": 1}},
		3:  {totalLevel: 3,  spellSlots: {2: 2}, expectToggles: [/juggle|jaunt|jest|prankster|pantomime|fool|laughing|witty|agility|dazzling|tumbler|disengagement|ridiculous/i]},
		5:  {totalLevel: 5,  spellSlots: {3: 2}},
		11: {totalLevel: 11, spellSlots: {6: 1}},
		17: {totalLevel: 17, spellSlots: {9: 1}, expectToggles: [/jester's privilege|privilege/i]},
		20: {totalLevel: 20, spellSlots: {9: 1}},
	},
	featuresMatrix: [
		// ── Bard base ─────────────────────────────────────────────────
		// Bardic Inspiration — pool size = CHA mod (we expect 3-5 with
		// the standard array; min 1). Die scaling (d6→d8→d10→d12)
		// isn't directly probeable via the resource API, so we layer
		// scaling-level entries to at least re-assert the pool exists
		// at each die-tier breakpoint.
		{
			level: 1,
			name: /bardic inspiration/i,
			kind: "resource",
			resourceMax: [1, 5],
			effects: [
				// L1-4: BI restores only on a long rest (Font of Inspiration kicks in at L5).
				{kind: "longRestRestores", resource: "Bardic Inspiration"},
				// Bard always knows ≥2 cantrips from L1 (Spellcasting effect probe).
				{kind: "cantripCount", min: 2},
				// Signature spells from the preset must surface in the
				// Bard's known/prepared spell list.
				{kind: "spellInList", spell: "Vicious Mockery"},
				{kind: "spellInList", spell: "Healing Word"},
				// Bardic Inspiration die starts at d6 (L1-L4).
				{kind: "bardicInspirationDie", minFaces: 6},
				// Roll-button smoke probes — anchor the always-available
				// d20 buttons here so we hit them at every level the
				// matrix runs at. Bard is proficient in DEX + CHA saves.
				{kind: "rollInitiative"},
				{kind: "rollSavingThrow", ability: "dex"},
				{kind: "rollSavingThrow", ability: "cha"},
				{kind: "rollAbilityCheck", ability: "cha"},
				{kind: "rollSkillCheck", proficientSkills: true, skip: true, skipReason: "P5 follow-up: proficientSkills DOM lookup needs CharacterSheetPage hardening — state-side proficient ≠ rendered button"},
				{kind: "rollSkillCheck", proficientSkills: true, skip: true, skipReason: "P5 follow-up: proficientSkills DOM lookup needs CharacterSheetPage hardening — state-side proficient ≠ rendered button"},
				{kind: "rollAttack", attackName: /rapier|dagger|hand crossbow/i, skip: true, skipReason: "TGTT preset deliberately ships unarmed; see Phase 15 P4 for pre-equip plan"},
			],
		},
		// Font of Inspiration (L5+) → BI restores on short OR long rest.
		// Blocked by CS-BUG-008 (short-rest restore not wired).
		{level: 5, name: /bardic inspiration/i, kind: "resource", resourceMax: [1, 5], restoreOn: "short", skip: true, skipReason: "CS-BUG-008"},
		// L5+ Bardic Inspiration die grows to d8 (then d10 at L10, d12
		// at L15). Anchored on a passive row so the resource skip above
		// doesn't suppress the die probe.
		{
			level: 5,
			name: /bardic inspiration/i,
			kind: "passive",
			effects: [
				{kind: "bardicInspirationDie", minFaces: 8},
			],
		},
		{
			level: 10,
			name: /bardic inspiration/i,
			kind: "resource",
			resourceMax: [1, 5],
			effects: [
				{kind: "longRestRestores", resource: "Bardic Inspiration"},
				// Bard's spell save DC at mid-level: 8 + prof(4) + CHA mod(≥3) ≥ 15;
				// keep min loose at 13 to tolerate non-maxed CHA builds.
				// Floor measured on THIS build, not aspirational: the preset has no
				// `abilityPriority`, so the standard array leaves the spellcasting
				// ability at its STR-first default (CS-BUG-056, "Follow-up"). DC is
				// 8 + prof + mod with that dump-stat mod. Previously skipped under
				// CS-BUG-016, which was a mis-attribution — the picker never affected
				// the DC. Raise this when the preset gains `abilityPriority`.
				{kind: "spellSaveDc", min: 12},
				// L10+ BI die grows to d10.
				{kind: "bardicInspirationDie", minFaces: 10},
				// Font of Inspiration: should restore on short rest too — blocked by CS-BUG-008.
				{kind: "shortRestRestores", resource: "Bardic Inspiration", skip: true, skipReason: "CS-BUG-008"},
			],
		},
		{
			level: 15,
			name: /bardic inspiration/i,
			kind: "resource",
			resourceMax: [1, 5],
			effects: [
				{kind: "longRestRestores", resource: "Bardic Inspiration"},
				// L15+ BI die grows to d12 (final tier).
				{kind: "bardicInspirationDie", minFaces: 12},
				{kind: "shortRestRestores", resource: "Bardic Inspiration", skip: true, skipReason: "CS-BUG-008"},
			],
		},

		// Song of Rest — heals extra HP on short rest. Not directly
		// state-observable on the sheet (no persistent passive bonus,
		// triggered only during short-rest healing), so no probes.
		{level: 2, name: /song of rest/i, kind: "passive", skip: true, skipReason: "CS-BUG-017"},
		// Expertise — doubles prof on chosen skills. Which skills are
		// picked is build-specific and the matrix doesn't know them, so
		// we can't assert a specific skillBonus floor without coupling
		// to the preset. Skip effect probes.
		{level: 3, name: /expertise/i, kind: "passive"},
		{level: 9, name: /expertise/i, kind: "passive"},
		// Magical Secrets — adds spells of player choice from any list.
		// We don't know the picks, so don't assert spellInList. The
		// generic spellSaveDc / cantripCount probes are anchored on
		// Bardic Inspiration above.
		{level: 10, name: /magical secrets/i, kind: "passive"},
		{level: 14, name: /magical secrets/i, kind: "passive"},
		{level: 18, name: /magical secrets/i, kind: "passive"},
		// Superior Inspiration — refills 1 BI use on initiative roll if
		// at 0. Not a passive state value; can't be probed via the
		// passive/toggle/roll APIs.
		{level: 20, name: /superior inspiration/i, kind: "passive"},

		// ── College of Jesters subclass ──────────────────────────────
		// Jester's Acts (JA optional features) — 3 known from L3, 4 from
		// L6, 5 from L14 (the subclass's "Jester's Acts Known" table
		// column). The pool, the cumulative counts and the per-act
		// mechanical probes all come from `buildJesterActChecks()` at the
		// bottom of this matrix, which is generated from
		// homebrew/TravelersGuidetoThelemar.json — open-coding them here
		// would let the two drift.

		// Other Jesters subclass features.
		// Gifted Acrobat — climbing speed equal to walking speed, plus a
		// bonus-action grapple escape and a 10-ft cost to stand from
		// prone. Only the climb speed has a generic surface on the sheet
		// (movement-cost overrides have no state representation at all —
		// see CS-BUG-115), so that is what is asserted here.
		{
			level: 6,
			name: /gifted acrobat/i,
			kind: "passive",
			effects: [
				{kind: "speedEquals", left: "climb", right: "walk"},
			],
		},
		// Unparalleled Skill — expertise (doubled proficiency) in one
		// chosen skill. The chosen skill is build-specific, so assert the
		// generic consequence: the character has at least one expertise
		// skill by L6.
		{
			level: 6,
			name: /unparalleled skill/i,
			kind: "passive",
			effects: [
				{kind: "stateCall", method: "getExpertise", min: 1, path: "length"},
			],
		},
		// Jester's Privilege — once-per-long-rest charm rider on Bardic
		// Inspiration. Surfaces as a named 1/long-rest resource.
		{
			level: 14,
			name: /jester's privilege|privilege/i,
			kind: "resource",
			resourceMax: 1,
			restoreOn: "long",
		},

		// ── Dendulra racial features (TGTT) ───────────────────────────
		// All meaningful Dendulra effects fall outside the
		// state-observable surface the Phase-7 helpers expose:
		//   • Fey Ancestry — advantage on saves vs charmed; the
		//     getAdvantageState API only supports "save:<abl>" /
		//     "check:<abl>" / "skill:..." / "attack", so condition-
		//     scoped advantage can't be probed.
		//   • Bubbling Energy (long rest in 4 hours) — not surfaced
		//     in state as a passive value.
		//   • Step of Feywild — bonus-action teleport with embedded
		//     save DC; per-use ability with no persistent passive.
		//   • Darkvision 60 — sense, not a probeable mod/save/skill.
		//   • Innate spells (druidcraft cantrip, entangle 1/day @ L3)
		//     — could in principle be spellInList probes, but they're
		//     attached to the race, not the matrix's class entries,
		//     and there's no Dendulra row to hang them on.
		// Documented here intentionally; no effects: arrays added.
		...buildSpecialtyChecks("Bard"),
		// Jester Acts (JA optional features) — Bard subclass picks.
		// Cumulative 3 / 4 / 5 at L3 / L6 / L14, from the subclass's
		// "Jester's Acts Known" table column. Every act in the pool
		// carries a real per-act mechanical probe (action economy, save
		// ability + DC, range, imposed condition, granted spell, AC
		// bonus, Bardic Inspiration cost) via TGTT_JESTER_ACT_EFFECTS,
		// so whichever acts the wizard picks get asserted for real
		// behaviour rather than mere existence.
		...buildJesterActChecks(),
	],
});
