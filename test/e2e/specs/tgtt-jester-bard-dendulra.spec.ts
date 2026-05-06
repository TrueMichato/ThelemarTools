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
		{level: 1, name: /bardic inspiration/i, kind: "resource", resourceMax: [1, 5]},
		// Font of Inspiration (L5+) → BI restores on short OR long rest.
		// Blocked by CS-BUG-008 (short-rest restore not wired).
		{level: 5, name: /bardic inspiration/i, kind: "resource", resourceMax: [1, 5], restoreOn: "short", skip: true, skipReason: "CS-BUG-008"},
		{level: 10, name: /bardic inspiration/i, kind: "resource", resourceMax: [1, 5]},
		{level: 15, name: /bardic inspiration/i, kind: "resource", resourceMax: [1, 5]},

		{level: 2, name: /song of rest/i, kind: "passive"},
		{level: 3, name: /expertise/i, kind: "passive"},
		{level: 9, name: /expertise/i, kind: "passive"},
		{level: 10, name: /magical secrets/i, kind: "passive"},
		{level: 14, name: /magical secrets/i, kind: "passive"},
		{level: 18, name: /magical secrets/i, kind: "passive"},
		{level: 20, name: /superior inspiration/i, kind: "passive"},

		// ── College of Jesters subclass ──────────────────────────────
		// Jester's Acts (JA optional features) — 3 picked at L3, +1 at
		// L6, +1 at L14. Candidate names sourced from
		// `featureType: ["JA"]` in homebrew/TravelersGuidetoThelemar.json.
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
		{level: 6, name: /gifted acrobat/i, kind: "passive"},
		{level: 6, name: /unparalleled skill/i, kind: "passive"},
		{level: 14, name: /jester's privilege|privilege/i, kind: "passive"},
	],
});
