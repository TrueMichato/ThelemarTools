import {describeCharacter} from "../utils/characterSpecFactory";
import {PRESET_FULL_JESTER_DENDULRA} from "../utils/characterBuilder";

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
				// Roll-button smoke probes — anchor the always-available
				// d20 buttons here so we hit them at every level the
				// matrix runs at. Bard is proficient in DEX + CHA saves.
				{kind: "rollInitiative"},
				{kind: "rollSavingThrow", ability: "dex"},
				{kind: "rollSavingThrow", ability: "cha"},
				{kind: "rollAbilityCheck", ability: "cha"},
				{kind: "rollSkillCheck", skill: "performance"},
				{kind: "rollSkillCheck", skill: "persuasion"},
				{kind: "rollAttack", attackName: /rapier|dagger|hand crossbow/i},
			],
		},
		// Font of Inspiration (L5+) → BI restores on short OR long rest.
		// Blocked by CS-BUG-008 (short-rest restore not wired).
		{level: 5, name: /bardic inspiration/i, kind: "resource", resourceMax: [1, 5], restoreOn: "short", skip: true, skipReason: "CS-BUG-008"},
		{
			level: 10,
			name: /bardic inspiration/i,
			kind: "resource",
			resourceMax: [1, 5],
			effects: [
				{kind: "longRestRestores", resource: "Bardic Inspiration"},
				// Bard's spell save DC at mid-level: 8 + prof(4) + CHA mod(≥3) ≥ 15;
				// keep min loose at 13 to tolerate non-maxed CHA builds.
				{kind: "spellSaveDc", min: 13},
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
				{kind: "shortRestRestores", resource: "Bardic Inspiration", skip: true, skipReason: "CS-BUG-008"},
			],
		},

		// Song of Rest — heals extra HP on short rest. Not directly
		// state-observable on the sheet (no persistent passive bonus,
		// triggered only during short-rest healing), so no probes.
		{level: 2, name: /song of rest/i, kind: "passive"},
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
		// Jester's Acts (JA optional features) — 3 picked at L3, +1 at
		// L6, +1 at L14. Candidate names sourced from
		// `featureType: ["JA"]` in homebrew/TravelersGuidetoThelemar.json.
		//
		// No Phase-7 effect probes attached: a `pick` FeatureCheck
		// validates the pick happened and references resolve, but
		// each individual Jester's Act has its own toggle / save-DC /
		// movement effect that depends on which acts the preset
		// actually picked. Those per-act effects belong on dedicated
		// rows once the picks are stable, not on the parent pick.
		{
			level: 3,
			name: /jester's acts?|acts/i,
			kind: "pick",
			pickedCount: 3,
			pickedFrom: [
				/pantomime/i,
				/prankster/i,
				/trickster's disengagement|disengagement/i,
				/tumbler/i,
				/dazzling disguise/i,
				/jester's juggle|juggle/i,
				/fool's folly|folly/i,
				/laughing lunge/i,
				/jester's jaunt|jaunt/i,
				/ridiculous ruse|ruse/i,
				/jester's agility|agility/i,
				/witty wordplay|wordplay/i,
				/jester's jest|jest/i,
			],
		},
		{
			level: 6,
			name: /jester's acts?|acts/i,
			kind: "pick",
			pickedCount: 4,
			pickedFrom: [
				/pantomime/i, /prankster/i, /disengagement/i, /tumbler/i,
				/dazzling disguise/i, /juggle/i, /folly/i, /laughing lunge/i,
				/jaunt/i, /ruse/i, /agility/i, /wordplay/i, /jest/i,
			],
		},
		{
			level: 14,
			name: /jester's acts?|acts/i,
			kind: "pick",
			pickedCount: 5,
			pickedFrom: [
				/pantomime/i, /prankster/i, /disengagement/i, /tumbler/i,
				/dazzling disguise/i, /juggle/i, /folly/i, /laughing lunge/i,
				/jaunt/i, /ruse/i, /agility/i, /wordplay/i, /jest/i,
			],
		},

		// Other Jesters subclass features.
		// Gifted Acrobat — climb speed = walk, bonus-action grapple
		// escape, stand from prone for 10 ft. None of these are
		// probeable through the current passive/toggle/roll APIs
		// (state.getSpeed("climb") isn't reliably populated for
		// subclass-granted modes), so no effect probes.
		{level: 6, name: /gifted acrobat/i, kind: "passive"},
		// Unparalleled Skill — doubles prof on one chosen skill. The
		// chosen skill is build-specific; without coupling to the
		// preset we can't assert a specific skillBonus floor.
		{level: 6, name: /unparalleled skill/i, kind: "passive"},
		// Jester's Privilege — once-per-long-rest charm-on-BI ability.
		// No persistent passive state to probe (it's an action, not a
		// modifier or active state), and the resource pool isn't
		// surfaced as a named "Jester's Privilege" resource on the
		// sheet, so no effect probes.
		{level: 14, name: /jester's privilege|privilege/i, kind: "passive"},

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
	],
});
