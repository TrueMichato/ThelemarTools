import {describeCharacter} from "../utils/characterSpecFactory";
import {PRESET_FULL_LUNAR_SORCERY_SORCERER} from "../utils/characterBuilder";
import {TGTT_METAMAGIC} from "../utils/tgttFeaturePools";

/**
 * Metamagic pick pool.
 *
 * The Thelemar homebrew's Metamagic optional features are registered against the
 * Sorcerer class generally, so a PHB-2014 Sorcerer's picker offers the TGTT
 * "<X> Spell (Active|Passive)" options alongside — in practice INSTEAD of — the
 * eight PHB names.  Both spellings are accepted so the row asserts "the picker
 * produced N real picks" without pinning which catalogue the sheet served.
 */
const METAMAGIC_POOL: RegExp[] = [
	...TGTT_METAMAGIC,
	/^careful spell$/i, /^distant spell$/i, /^empowered spell$/i, /^extended spell$/i,
	/^heightened spell$/i, /^quickened spell$/i, /^subtle spell$/i, /^twinned spell$/i,
];

/**
 * Lunar Sorcery Sorcerer (DSotDQ subclass on the PHB-2014 Sorcerer chassis) — L1→20.
 *
 * **Chassis:** the subclass exists for BOTH `classSource: "PHB"` and `"XPHB"`.  PHB is
 * used here because PHB-2014 Sorcerer picks its Sorcerous Origin at LEVEL 1 (the XPHB
 * copy is pinned to level 3), so every subclass gate below is a plain sorcerer-level
 * gate and the L1→20 ladder covers all seven features.
 *
 * Coverage focus — every subclass feature must have an observable MECHANICAL effect,
 * not just a rendered description.  Before this work the whole subclass was six
 * `hasXxx` calculation flags with ZERO consumers anywhere in `js/`.
 *
 * The interesting mechanic is the **lunar phase**.  It is a player-facing choice that
 * RECURS — re-chosen free on every long rest, and from 6 changeable mid-combat for a
 * sorcery point — and four separate systems read it:
 *
 *   - **Lunar Embodiment** (L1) — the phase itself, plus the 15-spell Lunar Spells
 *     table (all of which are known outright) and one free 1st-level lunar cast per
 *     long rest, gated on the phase matching the spell.  Probed as a real state
 *     transition (`setLunarPhase` → `getLunarPhase`) and a real refusal
 *     (`castLunarFreeSpell` on an off-phase spell, and a second cast of the same one).
 *   - **Moon Fire** (L1) — *sacred flame* known for free, splittable across two
 *     creatures.  `spellInList` proves the grant reached the spell list.
 *   - **Lunar Boons** (L6) — a proficiency-bonus pool that really shaves a sorcery
 *     point off a metamagic, and ONLY for the phase's two schools.  The negative
 *     (a non-phase school gets no discount) is what a description-only implementation
 *     cannot produce, so both directions are asserted, and the discount is read back
 *     off `getCastableActiveMetamagics()` — the production cast-time surface.
 *   - **Waxing and Waning** (L6) — really charges its sorcery point.  Asserted against
 *     the live pool before/after, and as a refusal below level 6.
 *   - **Lunar Empowerment** (L14) — the phase's passive.  Crescent's resistances reach
 *     `getResistances()`, New Moon's advantage reaches `getAdvantageState()` and its
 *     attacks-against-you disadvantage reaches `getActiveStateEffects()`, and Full
 *     Moon's advantage is gated behind the shed-moonlight switch.  All three drop the
 *     moment the phase changes, which is asserted.
 *   - **Lunar Phenomenon** (L18) — one free use per long rest, then 5 sorcery points.
 *     Both payment routes are spent for real against the live pool.
 *
 * ⚠️ Metamagic traps inherited from the Shadow Magic spec: `getFeatures()` lists
 * metamagic options the character has NOT picked, so a name probe can pass on a
 * character that does not know the metamagic; and metamagic is deliberately excluded
 * from the activatable-row surface (`charactersheet-combat.js:5806/:5827/:6048`), so a
 * `pickToggleable` probe against one can never pass.  The `pick` rows are kept because
 * "every CHOICE must be surfaced" is a real requirement, but each is BACKED by a
 * `getKnownMetamagicKeys()` count read straight off the character.
 *
 * Base-Sorcerer note (CS-BUG-080 / CS-BUG-084): `getSorceryPointsMaxForClass()` is the
 * single source of truth, and on the PHB chassis that is `level` from L2 — ZERO at L1.
 * A 19-step ladder, so each tier gets its own row with `untilLevel` (the matrix
 * re-evaluates every earlier entry at each later checkpoint, and `resourceMax` is an
 * exact match, so an unbounded row would fail against its own later self).
 */
describeCharacter({
	preset: PRESET_FULL_LUNAR_SORCERY_SORCERER,
	displayName: "Lunar Sorcery Sorcerer",
	// The three lunar-phase states are deliberately `noNameDetect` — the dedicated
	// Combat-tab Lunar Sorcery panel owns them, exactly as the Metamagic Dashboard owns
	// metamagic — so they never appear as generic toggle rows for the signature probe.
	signatureToggleSkip: {
		skip: true,
		reason:
			"Lunar Sorcery's recurring toggle IS the lunar phase, and the three phase states are `noNameDetect` on "
			+ "purpose so the generic activatable surface cannot hijack them behind the phase API's back (CS-BUG-083); "
			+ "the dedicated Combat-tab panel owns that UI. The phase is asserted directly in the matrix instead — "
			+ "setLunarPhase/getLunarPhase transitions, and the getResistances / getAdvantageState / "
			+ "getActiveStateEffects consequences at L14+. Nothing online at L5 is a persistent toggle: the free "
			+ "lunar cast and Moon Fire are instant, and Waxing and Waning arrives at L6.",
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
		// Sorcery Points restore on a LONG rest only. Sorcerous Restoration (4 SP on a
		// short rest) is a level-20 feature, far past this L5 probe.
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
		11: {totalLevel: 11, spellSlots: {6: 1}, expectResources: {"Sorcery Points": 11, "Lunar Boons": 4}},
		17: {totalLevel: 17, spellSlots: {9: 1}, expectResources: {"Sorcery Points": 17, "Lunar Boons": 6}},
		20: {totalLevel: 20, spellSlots: {9: 1}, expectResources: {"Sorcery Points": 20, "Lunar Boons": 6}},
	},
	featuresMatrix: [
		// ══ Sorcerer base chassis ════════════════════════════════════════
		// Font of Magic (L2) → Sorcery Points = sorcerer level from L2. The pool grows
		// at EVERY level, so one bounded row per matrix checkpoint.
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
		// Metamagic: 2 options at L3, +1 at L10, +1 at L17.
		{level: 3, untilLevel: 9, name: /metamagic/i, kind: "pick", pickedCount: 2, pickedFrom: METAMAGIC_POOL,
			effects: [
				{kind: "stateCall", method: "getKnownMetamagicKeys", path: "length", exact: 2},
				{kind: "stateCall", method: "getKnownActiveMetamagics", path: "length", min: 1},
			]},
		{level: 10, untilLevel: 16, name: /metamagic/i, kind: "pick", pickedCount: 3, pickedFrom: METAMAGIC_POOL,
			effects: [{kind: "stateCall", method: "getKnownMetamagicKeys", path: "length", exact: 3}]},
		{level: 17, name: /metamagic/i, kind: "pick", pickedCount: 4, pickedFrom: METAMAGIC_POOL,
			effects: [{kind: "stateCall", method: "getKnownMetamagicKeys", path: "length", exact: 4}]},
		{level: 20, name: /sorcerous restoration/i, kind: "passive"},

		// ══ Lunar Sorcery (L1) ═══════════════════════════════════════════
		{level: 1, name: /^lunar sorcery$/i, kind: "passive"},

		// ══ Lunar Embodiment (L1) — THE PHASE ════════════════════════════
		// The phase is the subclass's whole point, so it is probed as a real state
		// machine: it has a default, all three are reachable, the transition sticks,
		// and it survives into `getFeatureCalculations()` for downstream consumers.
		{
			level: 1,
			name: /lunar embodiment/i,
			kind: "passive",
			effects: [
				{kind: "featureCalculation", property: "hasLunarEmbodiment", exact: true},
				{kind: "featureCalculation", property: "lunarPhase", exact: "full"},
				{kind: "featureCalculation", property: "lunarPhaseName", exact: "Full Moon"},
				{kind: "stateCall", method: "hasLunarSorcery", exact: true},
				{kind: "stateCall", method: "getLunarSubclassLevel", exact: 1},
				{kind: "stateCall", method: "getLunarPhases", path: "length", exact: 3},
				{kind: "stateCall", method: "getLunarPhase", exact: "full"},
				// The transition is real, and it is reflected back through the
				// calculations the rest of the sheet reads.
				{kind: "stateCall", method: "setLunarPhase", args: ["new"], path: "ok", exact: true},
				{kind: "stateCall", method: "getLunarPhase", exact: "new"},
				{kind: "featureCalculation", property: "lunarPhaseName", exact: "New Moon"},
				{kind: "stateCall", method: "setLunarPhase", args: ["crescent"], path: "previousPhase", exact: "new"},
				{kind: "stateCall", method: "getLunarPhase", exact: "crescent"},
				// Nonsense is refused rather than silently accepted.
				{kind: "stateCall", method: "setLunarPhase", args: ["gibbous"], path: "ok", exact: false},
				{kind: "stateCall", method: "getLunarPhase", exact: "crescent"},
				// …restore the default so later rows start from a known phase.
				{kind: "stateCall", method: "setLunarPhase", args: ["full"], path: "ok", exact: true},
			],
		},
		// The Lunar Spells table: all three columns of every unlocked row are known
		// outright, so the grant is asserted by name against the real spell list.
		{
			level: 1,
			untilLevel: 4,
			name: /lunar embodiment/i,
			kind: "passive",
			effects: [
				{kind: "stateCall", method: "getLunarSpellTable", path: "length", exact: 2},
				{kind: "spellInList", spell: "Shield"},
				{kind: "spellInList", spell: "Ray of Sickness"},
				{kind: "spellInList", spell: "Color Spray"},
				{kind: "spellInList", spell: "Lesser Restoration"},
				{kind: "spellInList", spell: "Blindness/Deafness"},
				{kind: "spellInList", spell: "Alter Self"},
			],
		},
		{
			level: 9,
			name: /lunar embodiment/i,
			kind: "passive",
			effects: [
				{kind: "stateCall", method: "getLunarSpellTable", path: "length", exact: 5},
				{kind: "featureCalculation", property: "lunarSpellTableRows", exact: 5},
				{kind: "spellInList", spell: "Dispel Magic"},
				{kind: "spellInList", spell: "Vampiric Touch"},
				{kind: "spellInList", spell: "Phantom Steed"},
				{kind: "spellInList", spell: "Death Ward"},
				{kind: "spellInList", spell: "Confusion"},
				{kind: "spellInList", spell: "Hallucinatory Terrain"},
				{kind: "spellInList", spell: "Rary's Telepathic Bond"},
				{kind: "spellInList", spell: "Hold Monster"},
				{kind: "spellInList", spell: "Mislead"},
			],
		},
		// The free lunar cast. Below 6 there is exactly ONE option — the current
		// phase's — and it is once per long rest. The matrix long-rests before each
		// checkpoint, so the pool starts full.
		{
			level: 1,
			untilLevel: 5,
			name: /lunar embodiment/i,
			kind: "passive",
			effects: [
				{kind: "featureCalculation", property: "lunarFreeCastCount", exact: 1},
				{kind: "stateCall", method: "getLunarFreeCastOptions", path: "length", exact: 1},
				{kind: "stateCall", method: "getLunarFreeCastOptions", path: "0.spell", exact: "Shield"},
				{kind: "stateCall", method: "getLunarFreeCastOptions", path: "0.available", exact: true},
				// A real cast, spending no slot…
				{kind: "stateCall", method: "castLunarFreeSpell", args: ["Shield"], path: "slotSpent", exact: false},
				// …and it is genuinely once per long rest.
				{kind: "stateCall", method: "castLunarFreeSpell", args: ["Shield"], path: "ok", exact: false},
				{kind: "stateCall", method: "onLongRest", ignoreResult: true},
				{kind: "stateCall", method: "getLunarFreeCastOptions", path: "0.used", exact: false},
			],
		},
		// From 6, Waxing and Waning widens it to one free cast per phase — but the
		// phase gate stays, so the off-phase options are refusals.
		{
			level: 6,
			name: /lunar embodiment/i,
			kind: "passive",
			effects: [
				{kind: "featureCalculation", property: "lunarFreeCastCount", exact: 3},
				{kind: "stateCall", method: "getLunarFreeCastOptions", path: "length", exact: 3},
				{kind: "stateCall", method: "getLunarFreeCastOptions", path: "1.available", exact: false},
				{kind: "stateCall", method: "castLunarFreeSpell", args: ["Ray of Sickness"], path: "ok", exact: false},
				{kind: "stateCall", method: "castLunarFreeSpell", args: ["Shield"], path: "ok", exact: true},
				{kind: "stateCall", method: "onLongRest", ignoreResult: true},
			],
		},

		// ══ Moon Fire (L1) ═══════════════════════════════════════════════
		{
			level: 1,
			name: /moon fire/i,
			kind: "passive",
			effects: [
				{kind: "featureCalculation", property: "hasMoonFire", exact: true},
				{kind: "featureCalculation", property: "moonFireSpell", exact: "Sacred Flame"},
				{kind: "featureCalculation", property: "moonFireTargetCount", exact: 2},
				{kind: "featureCalculation", property: "moonFireTargetSeparation", exact: 5},
				{kind: "stateCall", method: "getMoonFireInfo", path: "maxTargets", exact: 2},
				// The grant has to reach the real spell list, not just a flag.
				{kind: "spellInList", spell: "Sacred Flame"},
			],
		},

		// ══ Waxing and Waning (L6) ═══════════════════════════════════════
		// Below 6 the phase only changes on a long rest — the refusal IS the feature.
		{
			level: 1,
			untilLevel: 5,
			name: /lunar embodiment/i,
			kind: "passive",
			effects: [
				{kind: "stateCall", method: "changeLunarPhase", args: ["new"], path: "ok", exact: false},
				{kind: "stateCall", method: "getLunarPhase", exact: "full"},
				// …but the free long-rest choice still works.
				{kind: "stateCall", method: "chooseLunarPhaseOnRest", args: ["new"], path: "ok", exact: true},
				{kind: "stateCall", method: "chooseLunarPhaseOnRest", args: ["full"], path: "spent", exact: 0},
			],
		},
		{
			level: 6,
			name: /waxing and waning/i,
			kind: "passive",
			effects: [
				{kind: "featureCalculation", property: "hasWaxingAndWaning", exact: true},
				{kind: "featureCalculation", property: "waxingAndWaningCost", exact: 1},
				{kind: "featureCalculation", property: "waxingAndWaningAction", exact: "bonus"},
				// A shift to the phase you are already in is refused so the point is
				// never wasted…
				{kind: "stateCall", method: "changeLunarPhase", args: ["full"], path: "ok", exact: false},
				// …and a real shift really charges one sorcery point.
				{kind: "stateCall", method: "changeLunarPhase", args: ["new"], path: "spent", exact: 1},
				{kind: "stateCall", method: "getLunarPhase", exact: "new"},
				{kind: "stateCall", method: "changeLunarPhase", args: ["full"], path: "action", exact: "bonus"},
			],
		},
		// The exact before/after numbers are only knowable when the pool size is known,
		// so the live-pool assertion is scoped to the L11 checkpoint alone.
		{
			level: 11,
			untilLevel: 11,
			name: /waxing and waning/i,
			kind: "passive",
			effects: [
				{kind: "stateCall", method: "onLongRest", ignoreResult: true},
				{kind: "stateCall", method: "getSorceryPoints", path: "current", exact: 11},
				{kind: "stateCall", method: "changeLunarPhase", args: ["crescent"], path: "spent", exact: 1},
				{kind: "stateCall", method: "getSorceryPoints", path: "current", exact: 10},
				{kind: "stateCall", method: "changeLunarPhase", args: ["full"], path: "spent", exact: 1},
				{kind: "stateCall", method: "getSorceryPoints", path: "current", exact: 9},
				// With no points left the shift is refused and the phase does not move.
				{kind: "stateCall", method: "setSorceryPoints", args: [{current: 0}], ignoreResult: true},
				{kind: "stateCall", method: "changeLunarPhase", args: ["new"], path: "ok", exact: false},
				{kind: "stateCall", method: "getLunarPhase", exact: "full"},
				{kind: "stateCall", method: "onLongRest", ignoreResult: true},
				{kind: "stateCall", method: "getSorceryPoints", path: "current", exact: 11},
			],
		},

		// ══ Lunar Boons (L6) ═════════════════════════════════════════════
		// A real proficiency-bonus pool. PB is 4 at L11 and 6 at L17/20.
		{level: 6, untilLevel: 12, name: "Lunar Boons", kind: "resource", resourceMax: 4, restoreOn: "long",
			effects: [{kind: "longRestRestores", resource: "Lunar Boons"}]},
		{level: 17, name: "Lunar Boons", kind: "resource", resourceMax: 6},
		{
			level: 6,
			name: /lunar boons/i,
			kind: "passive",
			effects: [
				{kind: "featureCalculation", property: "hasLunarBoons", exact: true},
				{kind: "featureCalculation", property: "lunarBoonsReduction", exact: 1},
				// Full Moon discounts abjuration and divination…
				{kind: "stateCall", method: "getLunarPhase", exact: "full"},
				{kind: "stateCall", method: "getLunarBoonDiscount", args: ["A"], path: "reduction", exact: 1},
				{kind: "stateCall", method: "getLunarBoonDiscount", args: ["divination"], path: "applies", exact: true},
				// …and NOTHING else. The negative is the half a description-only
				// implementation cannot produce.
				{kind: "stateCall", method: "getLunarBoonDiscount", args: ["N"], path: "applies", exact: false},
				{kind: "stateCall", method: "getLunarBoonDiscount", args: ["T"], path: "applies", exact: false},
				// The discounted school set follows the phase.
				{kind: "stateCall", method: "setLunarPhase", args: ["new"], ignoreResult: true},
				{kind: "stateCall", method: "getLunarBoonDiscount", args: ["N"], path: "applies", exact: true},
				{kind: "stateCall", method: "getLunarBoonDiscount", args: ["E"], path: "applies", exact: true},
				{kind: "stateCall", method: "getLunarBoonDiscount", args: ["A"], path: "applies", exact: false},
				{kind: "stateCall", method: "setLunarPhase", args: ["crescent"], ignoreResult: true},
				{kind: "stateCall", method: "getLunarBoonDiscount", args: ["I"], path: "applies", exact: true},
				{kind: "stateCall", method: "getLunarBoonDiscount", args: ["T"], path: "applies", exact: true},
				{kind: "stateCall", method: "getLunarBoonDiscount", args: ["E"], path: "applies", exact: false},
				{kind: "stateCall", method: "setLunarPhase", args: ["full"], ignoreResult: true},
				// THE MECHANICAL EFFECT, read off the production cast-time surface:
				// `getCastableActiveMetamagics()` is what `_resolveMetamagicChoice`
				// shows the player and what the spend path charges.
				{kind: "stateCall", method: "getCastableActiveMetamagics", args: [{slotLevel: 3, spellData: {school: "A"}}], contains: "\"lunarBoonApplied\":true"},
				{kind: "stateCall", method: "getCastableActiveMetamagics", args: [{slotLevel: 3, spellData: {school: "N"}}], contains: "\"lunarBoonApplied\":false"},
				// A use is really consumed, and only for a discounted school.
				{kind: "stateCall", method: "onLongRest", ignoreResult: true},
				{kind: "stateCall", method: "consumeLunarBoon", args: ["N"], exact: false},
				{kind: "stateCall", method: "consumeLunarBoon", args: ["A"], exact: true},
				{kind: "stateCall", method: "onLongRest", ignoreResult: true},
			],
		},
		// The pool really runs dry, and a dry pool really stops discounting.
		{
			level: 11,
			untilLevel: 11,
			name: /lunar boons/i,
			kind: "passive",
			effects: [
				{kind: "stateCall", method: "onLongRest", ignoreResult: true},
				{kind: "stateCall", method: "getLunarBoonUses", path: "current", exact: 4},
				{kind: "stateCall", method: "consumeLunarBoon", args: ["A"], exact: true},
				{kind: "stateCall", method: "consumeLunarBoon", args: ["A"], exact: true},
				{kind: "stateCall", method: "consumeLunarBoon", args: ["A"], exact: true},
				{kind: "stateCall", method: "consumeLunarBoon", args: ["A"], exact: true},
				{kind: "stateCall", method: "getLunarBoonUses", path: "current", exact: 0},
				{kind: "stateCall", method: "consumeLunarBoon", args: ["A"], exact: false},
				{kind: "stateCall", method: "getLunarBoonDiscount", args: ["A"], path: "applies", exact: false},
				{kind: "stateCall", method: "getCastableActiveMetamagics", args: [{slotLevel: 3, spellData: {school: "A"}}], contains: "\"lunarBoonApplied\":false"},
				{kind: "stateCall", method: "onLongRest", ignoreResult: true},
				{kind: "stateCall", method: "getLunarBoonUses", path: "current", exact: 4},
			],
		},

		// ══ Lunar Empowerment (L14) ══════════════════════════════════════
		// Below 14 the phase has NO passive, which is asserted as an absence so a
		// premature grant cannot hide.
		{
			level: 1,
			untilLevel: 13,
			name: /lunar embodiment/i,
			kind: "passive",
			effects: [
				{kind: "stateCall", method: "setLunarPhase", args: ["crescent"], ignoreResult: true},
				// Dwarven Resilience's poison and nothing else.
				{kind: "stateCall", method: "getResistances", path: "length", exact: 1},
				{kind: "stateCall", method: "setLunarPhase", args: ["new"], ignoreResult: true},
				{kind: "stateCall", method: "getAdvantageState", args: ["skill:stealth"], path: "advantage", exact: false},
				{kind: "stateCall", method: "toggleLunarMoonlight", args: [true], path: "ok", exact: false},
				{kind: "stateCall", method: "setLunarPhase", args: ["full"], ignoreResult: true},
			],
		},
		{
			level: 14,
			name: /lunar empowerment/i,
			kind: "passive",
			effects: [
				{kind: "featureCalculation", property: "hasLunarEmpowerment", exact: true},
				{kind: "featureCalculation", property: "lunarMoonlightRadius", exact: 10},
				// ── Crescent Moon: resistance to necrotic and radiant. These must reach
				// `getResistances()` through the ordinary active-state pipeline, which is
				// exactly what the six bare booleans could not do.
				{kind: "stateCall", method: "setLunarPhase", args: ["crescent"], ignoreResult: true},
				{kind: "stateCall", method: "getResistances", contains: "necrotic"},
				{kind: "stateCall", method: "getResistances", contains: "radiant"},
				// Exactly 3: the Dwarf's poison plus the two. A leak would show up here.
				{kind: "stateCall", method: "getResistances", path: "length", exact: 3},
				// …and it drops the instant the phase changes.
				{kind: "stateCall", method: "setLunarPhase", args: ["full"], ignoreResult: true},
				{kind: "stateCall", method: "getResistances", path: "length", exact: 1},

				// ── New Moon: advantage on Stealth, always.
				{kind: "stateCall", method: "setLunarPhase", args: ["new"], ignoreResult: true},
				{kind: "stateCall", method: "getAdvantageState", args: ["skill:stealth"], path: "advantage", exact: true},
				{kind: "stateCall", method: "getAdvantageState", args: ["skill:perception"], path: "advantage", exact: false},
				// …plus disadvantage on attacks against you, gated on being entirely in
				// darkness. The gate is the mechanic, so both sides are asserted.
				{kind: "stateCall", method: "isLunarInDarkness", exact: false},
				{kind: "stateCall", method: "setLunarInDarkness", args: [true], exact: true},
				{kind: "stateCall", method: "getActiveStateEffects", contains: "\"attacksAgainst\""},
				{kind: "stateCall", method: "setLunarInDarkness", args: [false], ignoreResult: true},

				// ── Full Moon: advantage on Investigation and Perception, but only
				// inside the moonlight you choose to shed.
				{kind: "stateCall", method: "setLunarPhase", args: ["full"], ignoreResult: true},
				{kind: "stateCall", method: "getAdvantageState", args: ["skill:stealth"], path: "advantage", exact: false},
				{kind: "stateCall", method: "getAdvantageState", args: ["skill:perception"], path: "advantage", exact: false},
				{kind: "stateCall", method: "toggleLunarMoonlight", args: [true], path: "shed", exact: true},
				{kind: "stateCall", method: "getAdvantageState", args: ["skill:perception"], path: "advantage", exact: true},
				{kind: "stateCall", method: "getAdvantageState", args: ["skill:investigation"], path: "advantage", exact: true},
				// Dousing it takes the advantage away again.
				{kind: "stateCall", method: "toggleLunarMoonlight", args: [false], path: "shed", exact: false},
				{kind: "stateCall", method: "getAdvantageState", args: ["skill:perception"], path: "advantage", exact: false},
				// …and so does leaving the phase, without needing to douse it first.
				{kind: "stateCall", method: "toggleLunarMoonlight", args: [true], ignoreResult: true},
				{kind: "stateCall", method: "setLunarPhase", args: ["crescent"], ignoreResult: true},
				{kind: "stateCall", method: "isLunarMoonlightShed", exact: false},
				{kind: "stateCall", method: "setLunarPhase", args: ["full"], ignoreResult: true},
			],
		},

		// ══ Lunar Phenomenon (L18) ═══════════════════════════════════════
		{level: 18, name: "Lunar Phenomenon", kind: "resource", resourceMax: 1, restoreOn: "long",
			effects: [{kind: "longRestRestores", resource: "Lunar Phenomenon"}]},
		{
			level: 18,
			name: /lunar phenomenon/i,
			kind: "passive",
			effects: [
				{kind: "featureCalculation", property: "hasLunarPhenomenon", exact: true},
				{kind: "featureCalculation", property: "lunarPhenomenonCost", exact: 5},
				{kind: "featureCalculation", property: "lunarPhenomenonRange", exact: 30},
				{kind: "featureCalculation", property: "lunarPhenomenonAction", exact: "bonus"},
				{kind: "featureCalculation", property: "lunarPhenomenonHealing", exact: "3d8"},
				// Each phase has a different burst, and the save DC is the real
				// spell save DC rather than a hard-coded number.
				{kind: "stateCall", method: "getLunarPhenomenon", path: "saveAbility", exact: "con"},
				{kind: "stateCall", method: "getLunarPhenomenon", path: "healing", exact: "3d8"},
				{kind: "stateCall", method: "getLunarPhenomenon", path: "saveDc", min: 15},
				{kind: "stateCall", method: "setLunarPhase", args: ["new"], ignoreResult: true},
				{kind: "stateCall", method: "getLunarPhenomenon", path: "damage", exact: "3d10"},
				{kind: "stateCall", method: "getLunarPhenomenon", path: "damageType", exact: "necrotic"},
				{kind: "stateCall", method: "getLunarPhenomenon", path: "saveAbility", exact: "dex"},
				{kind: "stateCall", method: "setLunarPhase", args: ["crescent"], ignoreResult: true},
				{kind: "stateCall", method: "getLunarPhenomenon", path: "teleport", exact: 60},
				{kind: "stateCall", method: "getLunarPhenomenon", path: "saveDc", exact: null},
				{kind: "stateCall", method: "setLunarPhase", args: ["full"], ignoreResult: true},
			],
		},
		// Both payment routes, spent for real against the live pool. Scoped to L20
		// because the exact before/after sorcery point numbers are only knowable when
		// the pool size is.
		{
			level: 20,
			name: /lunar phenomenon/i,
			kind: "passive",
			effects: [
				{kind: "stateCall", method: "onLongRest", ignoreResult: true},
				{kind: "stateCall", method: "getSorceryPoints", path: "current", exact: 20},
				// The free long-rest use goes first and costs no points…
				{kind: "stateCall", method: "useLunarPhenomenon", path: "usedFreeUse", exact: true},
				{kind: "stateCall", method: "getSorceryPoints", path: "current", exact: 20},
				{kind: "stateCall", method: "getLunarPhenomenon", path: "usesRemaining", exact: 0},
				// …then it really costs 5 sorcery points a go.
				{kind: "stateCall", method: "useLunarPhenomenon", path: "spentSorceryPoints", exact: 5},
				{kind: "stateCall", method: "getSorceryPoints", path: "current", exact: 15},
				// With neither a use nor the points, it is refused.
				{kind: "stateCall", method: "setSorceryPoints", args: [{current: 4}], ignoreResult: true},
				{kind: "stateCall", method: "getLunarPhenomenon", path: "available", exact: false},
				{kind: "stateCall", method: "useLunarPhenomenon", path: "ok", exact: false},
				{kind: "stateCall", method: "onLongRest", ignoreResult: true},
				{kind: "stateCall", method: "getLunarPhenomenon", path: "usesRemaining", exact: 1},
				{kind: "stateCall", method: "getSorceryPoints", path: "current", exact: 20},
			],
		},
	],
});
