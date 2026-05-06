import {describeCharacter, describeMulticlassCharacter} from "../utils/characterSpecFactory";
import {PRESET_FULL_HUNTER_CENTAUR, PRESET_FULL_ZODIAC_CENTAUR} from "../utils/characterBuilder";
import type {FeatureCheck} from "../utils/comprehensiveBuildHelpers";

// ── Ranger 6 / Druid 14 Centaur multiclass features matrix ───────────
// Levels are TOTAL character levels. Druid level = char level − 6.
//   Char L1-6 = Ranger 1-6 (Hunter @ Ranger 3 = char L3).
//   Char L7-20 = Druid 1-14 (Zodiac Circle @ Druid 3 = char L9).
// Druid 14 doesn't reach Beast Spells (Druid 18) or Archdruid /
// Timeless Body (Druid 20), so those are intentionally omitted.
const HUNTER_ZODIAC_MULTI_FEATURES_MATRIX: FeatureCheck[] = [
	// ── Ranger leg (TGTT Ranger + XPHB-derived Hunter) ──────────────
	{level: 1, name: /primal focus|favored enemy/i, kind: "passive"},
	{level: 1, name: /spellcasting/i, kind: "passive"},
	// Combat Methods at L2 — TGTT-specific pick (varies). Pick-kind
	// would require enumerating all options; treat as passive listing.
	{level: 2, name: /combat methods/i, kind: "passive"},
	// Hunter subclass arrives at L3 (Ranger 3). Hunter's Prey is a
	// pick from Colossus Slayer / Horde Breaker (XPHB) plus Giant
	// Killer (PHB legacy carry-over).
	{level: 3, name: /hunter's prey|hunters prey/i, kind: "pick",
		pickedFrom: [/colossus slayer/i, /giant killer/i, /horde breaker/i]},
	// Extra Attack at Ranger 5 = char L5.
	{level: 5, name: /extra attack/i, kind: "passive"},

	// ── Druid leg (TGTT Druid + Zodiac subclass) ────────────────────
	// Druid 1 = char L7: Druidic + Spellcasting (Druidic shows up as a
	// passive feature on the sheet). Spellcasting is already listed
	// from the Ranger leg, so we only assert Druidic here to avoid a
	// duplicate matcher.
	{level: 7, name: /druidic/i, kind: "passive"},
	// Druid 2 = char L8: Wild Shape (resource, 2 uses, short rest)
	// and Wild Companion (passive feature option).
	{level: 8, name: /wild shape/i, kind: "resource", resourceMax: [2, 2], restoreOn: "short"},
	{level: 8, name: /wild companion/i, kind: "passive"},
	// Druid 3 = char L9: Druid Circle (Zodiac arrives) + Zodiac
	// Form: Month feature.
	{level: 9, name: /circle of the zodiac|druid circle/i, kind: "passive"},
	{level: 9, name: /zodiac form: month|zodiac form/i, kind: "passive"},
	// Druid 5 = char L11: Wild Resurgence.
	{level: 11, name: /wild resurgence/i, kind: "passive"},
	// Druid 7 = char L13: Elemental Fury.
	{level: 13, name: /elemental fury/i, kind: "passive"},
	// Druid 10 = char L16: subclass feature → Zodiac Form: Star Week.
	{level: 16, name: /zodiac form: star week|star week/i, kind: "passive"},
	// Druid 14 = char L20: subclass feature → Full Zodiac.
	{level: 20, name: /full zodiac/i, kind: "passive"},
];

/**
 * #4 — Hunter Ranger / Zodiac Druid Centaur (TGTT).
 *
 * Three covered builds:
 *   (a) pure Hunter Ranger 20
 *   (b) pure Zodiac Druid 20
 *   (c) Ranger 6 / Druid 14 multiclass
 */
describeCharacter({
	preset: PRESET_FULL_HUNTER_CENTAUR,
	displayName: "Hunter Ranger Centaur",
	signatureToggle: /hunter|hunter's mark|colossus|horde/i,
	usage: {
		atLevel: 5,
		castSpellSlotLevel: 1,
		expectLongRestRestores: true,
		attackName: /longbow|shortbow/i,
		skillRoll: {name: "Stealth"},
		shortRestRestores: {skip: true},
		concentrationCheck: {castSpell: "Hunter's Mark", thenAction: "damage", expectActive: false},
		deathSaves: true,
		applyCondition: {skip: true},
		featAbility: {skip: true},
	},
	milestones: {
		1:  {totalLevel: 1,  minMaxHp: 10},
		3:  {totalLevel: 3,  spellSlots: {1: 3}},
		5:  {totalLevel: 5,  spellSlots: {2: 2}},
		11: {totalLevel: 11, spellSlots: {3: 3}},
		17: {totalLevel: 17, spellSlots: {5: 1}},
		20: {totalLevel: 20, spellSlots: {5: 2}},
	},
});

describeCharacter({
	preset: PRESET_FULL_ZODIAC_CENTAUR,
	displayName: "Zodiac Druid Centaur",
	signatureToggle: /zodiac|starry|wild shape|stellar/i,
	usage: {
		atLevel: 5,
		castSpellSlotLevel: 1,
		useResourceName: "Wild Shape",
		expectLongRestRestores: true,
		attackName: /quarterstaff|scimitar|club/i,
		skillRoll: {name: "Nature"},
		shortRestRestores: {resourceName: "Wild Shape"},
		concentrationCheck: {castSpell: "Entangle", thenAction: "damage", expectActive: false},
		deathSaves: true,
		applyCondition: {skip: true},
		featAbility: {skip: true},
	},
	milestones: {
		1:  {totalLevel: 1,  spellSlots: {1: 2}},
		3:  {totalLevel: 3,  spellSlots: {2: 2}, expectToggles: [/zodiac|starry/i]},
		5:  {totalLevel: 5,  spellSlots: {3: 2}},
		11: {totalLevel: 11, spellSlots: {6: 1}},
		17: {totalLevel: 17, spellSlots: {9: 1}},
		20: {totalLevel: 20, spellSlots: {9: 1}},
	},
});

describeMulticlassCharacter({
	displayName: "Ranger 6 / Druid 14 Centaur",
	preset: {...PRESET_FULL_HUNTER_CENTAUR, name: "Mira Wildhoof"},
	plan: [
		{className: "Ranger", classSource: "TGTT", subclassName: "Hunter", subclassSource: "TGTT-2024",
			signatureSpells: PRESET_FULL_HUNTER_CENTAUR.signatureSpells, toTotalLevel: 6},
		{className: "Druid", classSource: "TGTT", subclassName: "Circle of the Zodiac", subclassSource: "TGTT",
			signatureSpells: PRESET_FULL_ZODIAC_CENTAUR.signatureSpells, toTotalLevel: 20},
	],
	usageAfterEachLeg: [
		// After Ranger 6 — should have Hunter's Mark + 1st-level slots + bow attack
		{
			castSpellSlotLevel: 1,
			attackName: /longbow|shortbow/i,
			skillRoll: {name: "Stealth"},
		},
		// After Druid 20 — full 9th-level access + Wild Shape resource + Nature roll
		{
			castSpellSlotLevel: 1,
			useResourceName: "Wild Shape",
			skillRoll: {name: "Nature"},
		},
	],
	finalMilestone: {
		totalLevel: 20,
		// Multiclass spell-slot table: Ranger 6 (half) + Druid 14 (full) → caster level ≈ 17 → 9th-level slots present.
		spellSlots: {1: 4, 5: 2, 7: 1, 9: 1},
	},
	featuresMatrix: HUNTER_ZODIAC_MULTI_FEATURES_MATRIX,
});
