import {describeCharacter} from "../utils/characterSpecFactory";
import {PRESET_FULL_LUNAR_SORCERY_SORCERER} from "../utils/characterBuilder";
import {TGTT_METAMAGIC} from "../utils/tgttFeaturePools";

/**
 * Metamagic pick pool — same reasoning as the Shadow Magic spec: the Thelemar
 * homebrew registers its Metamagic optional features against the Sorcerer class
 * generally, so a PHB-2014 Sorcerer's picker offers the TGTT "<X> Spell
 * (Active|Passive)" options alongside — in practice instead of — the eight PHB
 * names. Both spellings are accepted so the row asserts "the picker produced N
 * real picks" without pinning which catalogue the sheet served.
 */
const METAMAGIC_POOL: RegExp[] = [
	...TGTT_METAMAGIC,
	/^careful spell$/i, /^distant spell$/i, /^empowered spell$/i, /^extended spell$/i,
	/^heightened spell$/i, /^quickened spell$/i, /^subtle spell$/i, /^twinned spell$/i,
];

/**
 * Lunar Sorcery Sorcerer (DSotDQ subclass on the PHB-2014 Sorcerer chassis) — L1→20.
 *
 * ── Three corrections to the usual summary of this subclass, all pinned below ──
 *
 *  1. The phases are **Full Moon / New Moon / Crescent Moon**. **Moon Fire is not a
 *     phase** — it is a separate 1st-level feature granting `sacred flame`, with the
 *     rider that it may target two creatures within 5 ft of each other.
 *  2. **Lunar Empowerment (L14) adds no damage.** It grants phase-gated passives:
 *     Full Moon → a bonus-action light aura with advantage on Investigation and
 *     Perception inside it; New Moon → advantage on Stealth (+ attacks against you
 *     have disadvantage in total darkness); Crescent Moon → resistance to necrotic
 *     and radiant.
 *  3. **The phase does not gate which spells are known.** RAW you learn all fifteen
 *     Lunar Spells. The phase gates four OTHER things, each probed here: the free
 *     1st-level cast, the Lunar Boons discount schools, the live Empowerment passive,
 *     and the Lunar Phenomenon payload.
 *
 * ── The data defect this build exists to cover ──
 *
 * `data/class/class-sorcerer.json` encodes only the **Full Moon column** as a single
 * `additionalSpells` block; the New Moon and Crescent Moon columns — 10 spells — are
 * absent, because the real list lives in a `type: "table"` entry and
 * `SpellGrantParser.getFeatureSpellText` walks only `entries`/`items`. All fifteen are
 * granted sheet-side through the GENERIC `CharacterSheetState.FEATURE_SPELL_GRANTS`
 * descriptor, so the `spellInList` rows below are the regression guard for that
 * mechanism as much as for this subclass.
 *
 * Every `spellInList` probe uses the DEFAULT `first-party` match mode on purpose —
 * `spellMatchMode: "any"` drops the name assertion entirely
 * (`comprehensiveBuildHelpers.ts:1401`) and only counts spells at a level, which is
 * precisely the thing that must not be traded away here.
 *
 * Base-Sorcerer note: Sorcery Points have a single source of truth,
 * `CharacterSheetState.getSorceryPointsMaxForClass()`. On the PHB chassis that is
 * `level` from L2, so each tier gets its own row with `untilLevel`.
 */
describeCharacter({
	preset: PRESET_FULL_LUNAR_SORCERY_SORCERER,
	displayName: "Lunar Sorcery Sorcerer",
	// The lunar phases ARE persistent toggles and they are online from L1, but they are
	// driven through `setLunarPhase()` (which enforces mutual exclusivity and charges the
	// Waxing and Waning sorcery point) rather than by clicking a bare activatable row, so
	// the generic signature-toggle probe would assert the wrong contract.
	signatureToggleSkip: {
		skip: true,
		reason:
			"The lunar phases are mutually-exclusive states owned by setLunarPhase(), which also charges the "
			+ "Waxing and Waning sorcery point and re-attaches the level-14 empowerment effects. Toggling the raw "
			+ "state row would bypass all of that. Phase switching, exclusivity, the SP cost and the empowerment "
			+ "hand-off are asserted directly through stateCall probes in the matrix instead.",
	},
	// CS-BUG-030: the wizard ships an unarmed caster, so equip something the USE
	// attack probe can actually roll.
	midTierLoadout: [
		{name: "Dagger", equipped: true},
	],
	usage: {
		atLevel: 5,
		castSpellSlotLevel: 1,
		useResourceName: "Sorcery Points",
		expectLongRestRestores: true,
		attackName: /dagger|quarterstaff|crossbow/i,
		skillRoll: {name: "Arcana"},
		// Sorcery Points restore on a LONG rest only; Sorcerous Restoration is L20.
		shortRestRestores: {skip: true},
		concentrationCheck: {castSpell: "Shield of Faith", thenAction: "damage", expectActive: false},
		deathSaves: true,
		applyCondition: {skip: true},
		featAbility: {skip: true},
	},
	milestones: {
		1: {totalLevel: 1, spellSlots: {1: 2}},
		3: {totalLevel: 3, spellSlots: {2: 2}, expectResources: {"Sorcery Points": 3}},
		5: {totalLevel: 5, spellSlots: {3: 2}, expectResources: {"Sorcery Points": 5}},
		11: {totalLevel: 11, spellSlots: {6: 1}, expectResources: {"Sorcery Points": 11}},
		17: {totalLevel: 17, spellSlots: {9: 1}, expectResources: {"Sorcery Points": 17}},
		20: {totalLevel: 20, spellSlots: {9: 1}, expectResources: {"Sorcery Points": 20}},
	},
	featuresMatrix: [
		// ══ Sorcerer base chassis ════════════════════════════════════════
		// NOTE: the MEGA/matrix runners only evaluate at checkpoints [3, 5, 11, 17, 20]
		// (`characterSpecFactory.ts` `const checkpoints = [...]`). Any entry whose
		// [level, untilLevel] window misses ALL of those is silently never run, so
		// every window below is chosen to contain at least one checkpoint.
		{
			level: 3,
			untilLevel: 4,
			name: "Sorcery Points",
			kind: "resource",
			resourceMax: 3,
			restoreOn: "long",
			effects: [{kind: "longRestRestores", resource: "Sorcery Points"}],
		},
		{level: 5, untilLevel: 10, name: "Sorcery Points", kind: "resource", resourceMax: 5},
		{level: 11, untilLevel: 16, name: "Sorcery Points", kind: "resource", resourceMax: 11},
		{level: 17, untilLevel: 19, name: "Sorcery Points", kind: "resource", resourceMax: 17},
		{level: 20, name: "Sorcery Points", kind: "resource", resourceMax: 20},
		{level: 3, untilLevel: 9, name: /metamagic/i, kind: "pick", pickedCount: 2, pickedFrom: METAMAGIC_POOL},
		{level: 10, untilLevel: 16, name: /metamagic/i, kind: "pick", pickedCount: 3, pickedFrom: METAMAGIC_POOL},
		{level: 17, name: /metamagic/i, kind: "pick", pickedCount: 4, pickedFrom: METAMAGIC_POOL},
		{level: 20, name: /sorcerous restoration/i, kind: "passive"},

		// ══ Lunar Embodiment (L1) — the phase itself ═════════════════════
		// The starting phase is a real CHOICE the Builder must surface: the Class step's
		// Next button refuses to advance until it is answered
		// (`charactersheet-builder.js` `hasSubclassChoicePrompt` guard), and the preset
		// answers it with "Full Moon".
		{
			level: 1,
			untilLevel: 5,
			name: /lunar sorcery|lunar embodiment/i,
			kind: "passive",
			effects: [
				{kind: "featureCalculation", property: "hasLunarEmbodiment", exact: true},
				// The Builder's choice actually landed, and it seeded a live state.
				// Windowed to <=5 deliberately: the matrix mutates the phase at later
				// checkpoints and the phase is PERSISTENT (a long rest does not reset
				// it), so the untouched seed is only observable before then.
				{kind: "stateCall", method: "getLunarPhase", path: "key", exact: "full moon"},
				{kind: "stateCall", method: "isStateTypeActive", args: ["lunarPhaseFull"], exact: true},
				{kind: "stateCall", method: "isStateTypeActive", args: ["lunarPhaseNew"], exact: false},
				{kind: "stateCall", method: "isStateTypeActive", args: ["lunarPhaseCrescent"], exact: false},
				{kind: "featureCalculation", property: "lunarPhaseName", exact: "Full Moon"},
			],
		},
		{
			level: 1,
			name: /lunar sorcery|lunar embodiment/i,
			kind: "passive",
			effects: [
				{kind: "featureCalculation", property: "hasLunarEmbodiment", exact: true},
				// Self-seeding: this entry runs at every checkpoint, and earlier
				// checkpoints leave the phase wherever their last mutation put it.
				{kind: "stateCall", method: "setLunarPhase", args: ["full moon", {free: true}], ignoreResult: true},
				// All three options are published for the UI to render.
				{kind: "stateCall", method: "getLunarFreeCasts", path: "length", exact: 3},
				// Switching phase is real and MUTUALLY EXCLUSIVE. (Free at L1 — Waxing and
				// Waning's 1-SP bonus-action switch only exists from L6.)
				{kind: "stateCall", method: "setLunarPhase", args: ["crescent moon", {free: true}], path: "success", exact: true},
				{kind: "stateCall", method: "isStateTypeActive", args: ["lunarPhaseCrescent"], exact: true},
				{kind: "stateCall", method: "isStateTypeActive", args: ["lunarPhaseFull"], exact: false},
				{kind: "stateCall", method: "getLunarPhase", path: "name", exact: "Crescent Moon"},
				// …and the free 1st-level spell follows the phase, which is one of the four
				// things the phase actually gates.
				{kind: "stateCall", method: "getLunarPhase", path: "freeSpell.name", exact: "Color Spray"},
				{kind: "stateCall", method: "setLunarPhase", args: ["new moon", {free: true}], path: "success", exact: true},
				{kind: "stateCall", method: "getLunarPhase", path: "freeSpell.name", exact: "Ray of Sickness"},
				{kind: "stateCall", method: "setLunarPhase", args: ["full moon", {free: true}], path: "success", exact: true},
				{kind: "stateCall", method: "getLunarPhase", path: "freeSpell.name", exact: "Shield"},
				// A nonsense phase is refused rather than silently accepted.
				{kind: "stateCall", method: "setLunarPhase", args: ["gibbous moon", {free: true}], path: "success", exact: false},
			],
		},

		// ══ Lunar Embodiment — the fifteen Lunar Spells ══════════════════
		// Row 1 of the table, all three columns. Only "Shield" is in the shipped
		// `additionalSpells`; the other two exist ONLY because of FEATURE_SPELL_GRANTS.
		{
			level: 1,
			name: /lunar sorcery|lunar embodiment/i,
			kind: "passive",
			effects: [
				{kind: "spellInList", spell: "Shield"},
				{kind: "spellInList", spell: "Ray of Sickness"},
				{kind: "spellInList", spell: "Color Spray"},
			],
		},
		// Row 2 (sorcerer 3) — and the level gate is asserted as a NEGATIVE at L1 above
		// by omission; here the row arrives on schedule.
		{
			level: 3,
			name: /lunar sorcery|lunar embodiment/i,
			kind: "passive",
			effects: [
				{kind: "spellInList", spell: "Lesser Restoration"},
				{kind: "spellInList", spell: "Blindness/Deafness"},
				{kind: "spellInList", spell: "Alter Self"},
			],
		},
		{
			level: 5,
			untilLevel: 6,
			name: /lunar sorcery|lunar embodiment/i,
			kind: "passive",
			effects: [
				{kind: "spellInList", spell: "Dispel Magic"},
				{kind: "spellInList", spell: "Vampiric Touch"},
				{kind: "spellInList", spell: "Phantom Steed"},
				// Row 4 has NOT arrived yet — the level gate is the mechanism, and it is
				// asserted as a NUMBER rather than by the absence of a spell name (there
				// is no negative `spellInList`): three rows unlocked, three spells each.
				{kind: "featureCalculation", property: "lunarSpellsKnownCount", exact: 9},
			],
		},
		// Row 4 (sorcerer 7). Left open-ended so checkpoint 11 evaluates it — a
		// `untilLevel: 8` window would contain no checkpoint and never run.
		{
			level: 7,
			name: /lunar sorcery|lunar embodiment/i,
			kind: "passive",
			effects: [
				{kind: "spellInList", spell: "Death Ward"},
				{kind: "spellInList", spell: "Confusion"},
				{kind: "spellInList", spell: "Hallucinatory Terrain"},
			],
		},
		{
			level: 9,
			name: /lunar sorcery|lunar embodiment/i,
			kind: "passive",
			effects: [
				{kind: "spellInList", spell: "Rary's Telepathic Bond"},
				{kind: "spellInList", spell: "Hold Monster"},
				{kind: "spellInList", spell: "Mislead"},
				// All five rows, all three columns.
				{kind: "featureCalculation", property: "lunarSpellsKnownCount", exact: 15},
			],
		},

		// ══ Moon Fire (L1) ═══════════════════════════════════════════════
		{
			level: 1,
			name: /lunar sorcery|moon fire/i,
			kind: "passive",
			effects: [
				{kind: "featureCalculation", property: "hasMoonFire", exact: true},
				{kind: "featureCalculation", property: "moonFireCantrip", exact: "Sacred Flame"},
				{kind: "featureCalculation", property: "moonFireTargets", exact: 2},
				{kind: "featureCalculation", property: "moonFireTargetSpacingFt", exact: 5},
				// Granted as a real cantrip. `spellInList` unions the cantrip list, so
				// this is a genuine name assertion — Sacred Flame is NOT on the Sorcerer
				// cantrip list, so a Sorcerer can only have it from Moon Fire.
				{kind: "spellInList", spell: "Sacred Flame"},
			],
		},

		// ══ Lunar Embodiment free casts (L1, upgraded at L6) ═════════════
		// One free cast of the CURRENT phase's 1st-level spell before L6; one per phase
		// from L6 (Waxing and Waning). Tracked per phase so switching cannot refund it.
		{
			level: 1,
			untilLevel: 5,
			name: /lunar sorcery|lunar embodiment/i,
			kind: "passive",
			effects: [
				{kind: "stateCall", method: "setLunarPhase", args: ["full moon", {free: true}], ignoreResult: true},
				{kind: "stateCall", method: "getLunarFreeCasts", path: "length", exact: 3},
				// Only the current phase's is available before 6th level.
				{kind: "featureCalculation", property: "lunarEmbodimentFreeCasts", exact: 1},
				{kind: "stateCall", method: "useLunarFreeCast", args: ["new moon"], path: "success", exact: false},
				{kind: "stateCall", method: "useLunarFreeCast", args: ["full moon"], path: "success", exact: true},
				{kind: "stateCall", method: "useLunarFreeCast", args: ["full moon"], path: "success", exact: false},
				{kind: "stateCall", method: "onLongRest", ignoreResult: true},
				{kind: "stateCall", method: "useLunarFreeCast", args: ["full moon"], path: "success", exact: true},
			],
		},

		// ══ Lunar Boons (L6) ═════════════════════════════════════════════
		// Pool = proficiency bonus, long rest. Discounts metamagic by 1 SP, but ONLY for
		// the two schools of the current phase — which is the second thing the phase gates.
		{
			level: 6,
			untilLevel: 13,
			name: /lunar boons/i,
			kind: "passive",
			effects: [
				{kind: "featureCalculation", property: "hasLunarBoons", exact: true},
				// Evaluated at checkpoint 11, where the proficiency bonus is +4.
				{kind: "featureCalculation", property: "lunarBoonsMax", exact: 4},
				{kind: "featureCalculation", property: "lunarBoonsDiscount", exact: 1},
				{kind: "stateCall", method: "setLunarPhase", args: ["full moon", {free: true}], ignoreResult: true},
				// Abjuration and Divination are discounted…
				{kind: "stateCall", method: "getLunarBoonsDiscountedCost", args: [2, "A"], path: "cost", exact: 1},
				{kind: "stateCall", method: "getLunarBoonsDiscountedCost", args: [2, "Divination"], path: "discounted", exact: true},
				// …and nothing else is.
				{kind: "stateCall", method: "getLunarBoonsDiscountedCost", args: [2, "Necromancy"], path: "cost", exact: 2},
				{kind: "stateCall", method: "getLunarBoonsDiscountedCost", args: [2, "N"], path: "discounted", exact: false},
				// The discounted pair FOLLOWS the phase.
				{kind: "stateCall", method: "setLunarPhase", args: ["new moon", {free: true}], ignoreResult: true},
				{kind: "stateCall", method: "getLunarBoonsDiscountedCost", args: [2, "N"], path: "cost", exact: 1},
				{kind: "stateCall", method: "getLunarBoonsDiscountedCost", args: [2, "A"], path: "cost", exact: 2},
				// It never goes below zero and never discounts a free metamagic.
				{kind: "stateCall", method: "getLunarBoonsDiscountedCost", args: [0, "N"], path: "cost", exact: 0},
				// Uses are finite: spend the whole pool (proficiency bonus = 4 at L11),
				// then the discount stops.
				{kind: "stateCall", method: "consumeLunarBoon", exact: true},
				{kind: "stateCall", method: "consumeLunarBoon", exact: true},
				{kind: "stateCall", method: "consumeLunarBoon", exact: true},
				{kind: "stateCall", method: "consumeLunarBoon", exact: true},
				{kind: "stateCall", method: "consumeLunarBoon", exact: false},
				{kind: "stateCall", method: "getLunarBoonsDiscountedCost", args: [2, "N"], path: "cost", exact: 2},
				{kind: "stateCall", method: "onLongRest", ignoreResult: true},
				{kind: "stateCall", method: "getLunarBoonsDiscountedCost", args: [2, "N"], path: "cost", exact: 1},
			],
		},
		// Pool tracks the proficiency bonus, which is the whole scaling story.
		{
			level: 17,
			name: /lunar boons/i,
			kind: "passive",
			effects: [
				{kind: "featureCalculation", property: "lunarBoonsMax", exact: 6},
			],
		},

		// ══ Waxing and Waning (L6) ═══════════════════════════════════════
		// Bonus-action phase switch for exactly 1 sorcery point, and one free cast PER
		// PHASE rather than one overall.
		{
			level: 6,
			untilLevel: 13,
			name: /waxing and waning/i,
			kind: "passive",
			effects: [
				{kind: "featureCalculation", property: "hasWaxingAndWaning", exact: true},
				{kind: "featureCalculation", property: "waxingAndWaningCost", exact: 1},
				{kind: "stateCall", method: "onLongRest", ignoreResult: true},
				{kind: "stateCall", method: "setLunarPhase", args: ["full moon", {free: true}], ignoreResult: true},
				// Every phase's free cast is now live — that is the upgrade.
				{kind: "featureCalculation", property: "lunarEmbodimentFreeCasts", exact: 3},
				{kind: "stateCall", method: "useLunarFreeCast", args: ["new moon"], path: "success", exact: true},
				{kind: "stateCall", method: "useLunarFreeCast", args: ["full moon"], path: "success", exact: true},
				// …and spending one phase's charge does NOT spend another's.
				{kind: "stateCall", method: "useLunarFreeCast", args: ["crescent moon"], path: "success", exact: true},
				{kind: "stateCall", method: "useLunarFreeCast", args: ["crescent moon"], path: "success", exact: false},
				// The bonus-action switch costs exactly one sorcery point. Evaluated at
				// checkpoint 11, where the pool is 11 (`getSorceryPointsMaxForClass`).
				{kind: "stateCall", method: "onLongRest", ignoreResult: true},
				{kind: "stateCall", method: "getSorceryPoints", path: "current", exact: 11},
				{kind: "stateCall", method: "setLunarPhase", args: ["crescent moon", {bonusAction: true}], path: "sorceryPointsSpent", exact: 1},
				{kind: "stateCall", method: "getSorceryPoints", path: "current", exact: 10},
				{kind: "stateCall", method: "getLunarPhase", path: "key", exact: "crescent moon"},
			],
		},

		// ══ Lunar Empowerment (L14) ══════════════════════════════════════
		// No damage rider — phase-gated passives. Crescent Moon's necrotic/radiant
		// resistance is the falsifiable one on a Dwarf (whose only racial resistance is
		// poison), so it is asserted BOTH as a presence and, in the other two phases, as
		// an absence.
		{
			level: 14,
			name: /lunar empowerment/i,
			kind: "passive",
			effects: [
				{kind: "featureCalculation", property: "hasLunarEmpowerment", exact: true},
				// Crescent Moon → resistance to necrotic AND radiant.
				// CS-BUG-050: these are `{target: "damage:<type>"}`; a bare damage type
				// is silently inert.
				{kind: "stateCall", method: "setLunarPhase", args: ["crescent moon", {free: true}], ignoreResult: true},
				{kind: "stateCall", method: "hasResistance", args: ["necrotic"], exact: true},
				{kind: "stateCall", method: "hasResistance", args: ["radiant"], exact: true},
				// New Moon → the resistances are GONE and Stealth advantage appears.
				{kind: "stateCall", method: "setLunarPhase", args: ["new moon", {free: true}], ignoreResult: true},
				{kind: "stateCall", method: "hasResistance", args: ["necrotic"], exact: false},
				{kind: "stateCall", method: "hasResistance", args: ["radiant"], exact: false},
				{kind: "stateCall", method: "getSkillAdvantageState", args: ["stealth"], path: "advantage", exact: true},
				// Full Moon → neither; the moonlight sub-toggle is the mechanic instead.
				{kind: "stateCall", method: "setLunarPhase", args: ["full moon", {free: true}], ignoreResult: true},
				{kind: "stateCall", method: "hasResistance", args: ["necrotic"], exact: false},
				{kind: "stateCall", method: "getSkillAdvantageState", args: ["stealth"], path: "advantage", exact: false},
				{kind: "stateCall", method: "activateState", args: ["lunarMoonlight"], ignoreResult: true},
				{kind: "stateCall", method: "isStateTypeActive", args: ["lunarMoonlight"], exact: true},
				// …and the moonlight cannot survive a phase change.
				{kind: "stateCall", method: "setLunarPhase", args: ["new moon", {free: true}], ignoreResult: true},
				{kind: "stateCall", method: "isStateTypeActive", args: ["lunarMoonlight"], exact: false},
			],
		},

		// ══ Lunar Phenomenon (L18) ═══════════════════════════════════════
		// One free use PER PHASE per long rest, or 5 sorcery points. The payload is the
		// fourth thing the phase gates.
		{
			level: 18,
			name: /lunar phenomenon/i,
			kind: "passive",
			effects: [
				{kind: "featureCalculation", property: "hasLunarPhenomenon", exact: true},
				{kind: "featureCalculation", property: "lunarPhenomenonSorceryPointCost", exact: 5},
				{kind: "stateCall", method: "onLongRest", ignoreResult: true},
				// Full Moon: a Constitution save, the Blinded condition and 3d8 healing.
				{kind: "stateCall", method: "setLunarPhase", args: ["full moon", {free: true}], ignoreResult: true},
				{kind: "stateCall", method: "useLunarPhenomenon", path: "phenomenon.save", exact: "con"},
				{kind: "stateCall", method: "useLunarPhenomenon", args: [{spendSorceryPoints: true}], path: "phenomenon.healDice", exact: "3d8"},
				// New Moon: a Dexterity save and 3d10 necrotic — a different payload
				// entirely, which is the point.
				{kind: "stateCall", method: "setLunarPhase", args: ["new moon", {free: true}], ignoreResult: true},
				{kind: "stateCall", method: "useLunarPhenomenon", path: "phenomenon.damageDice", exact: "3d10"},
				{kind: "stateCall", method: "useLunarPhenomenon", args: [{spendSorceryPoints: true}], path: "phenomenon.damageType", exact: "necrotic"},
				// Crescent Moon teleports instead of dealing damage.
				{kind: "stateCall", method: "setLunarPhase", args: ["crescent moon", {free: true}], ignoreResult: true},
				{kind: "stateCall", method: "useLunarPhenomenon", path: "phenomenon.teleportFeet", exact: 60},
				// The free per-phase use is spent, so the next one costs 5 sorcery points.
				{kind: "stateCall", method: "useLunarPhenomenon", path: "sorceryPointsSpent", exact: 5},
			],
		},
	],
});
