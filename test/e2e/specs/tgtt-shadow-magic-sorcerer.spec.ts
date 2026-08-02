import {describeCharacter} from "../utils/characterSpecFactory";
import {PRESET_FULL_SHADOW_MAGIC_SORCERER} from "../utils/characterBuilder";
import {TGTT_METAMAGIC} from "../utils/tgttFeaturePools";

/**
 * Metamagic pick pool.
 *
 * The Thelemar homebrew's Metamagic optional features are registered against the
 * Sorcerer class generally, so a PHB-2014 Sorcerer's picker offers the TGTT
 * "<X> Spell (Active|Passive)" options alongside — in practice INSTEAD of — the
 * eight PHB names. Both spellings are accepted here so the row asserts "the picker
 * produced N real picks" without pinning which catalogue the sheet served.
 */
const METAMAGIC_POOL: RegExp[] = [
	...TGTT_METAMAGIC,
	/^careful spell$/i, /^distant spell$/i, /^empowered spell$/i, /^extended spell$/i,
	/^heightened spell$/i, /^quickened spell$/i, /^subtle spell$/i, /^twinned spell$/i,
];

/**
 * Shadow Magic Sorcerer (XGE subclass on the PHB-2014 Sorcerer chassis) — L1→20.
 *
 * PHB-2014 Sorcerer picks its Sorcerous Origin at LEVEL 1, so every subclass feature
 * gate below is a plain sorcerer-level gate.
 *
 * Coverage focus — every subclass feature must have an observable MECHANICAL effect,
 * not just a rendered description.  Before this work the whole subclass was five
 * `hasXxx` calculation flags with ZERO consumers anywhere in `js/` (CS-BUG-082):
 *
 *   - **Eyes of the Dark** (L1) — 120 ft darkvision that must actually reach
 *     `getSenses()`.  Probed with `stateCall` on `getSense`, because there is no
 *     dedicated sense `EffectCheck` kind.  From L3 it also grants `darkness` free and
 *     lets you cast it for 2 Sorcery Points, after which you can see through your own
 *     darkness — driven by the GENERIC `calculations.resourceCastSpells` descriptor and
 *     `castSpellWithResource()` / `canSeeThroughOwnDarkness()`.
 *   - **Strength of the Grave** (L1) — hooks the REAL hit-point machinery.
 *     `takeDamage()` arms a zero-HP intervention (the same generic registry Death Ward
 *     now uses); `applyZeroHpIntervention()` resolves a CHA save at DC 5 + damage taken
 *     and leaves you at 1 HP on a success.  The two RAW exclusions — radiant damage and
 *     critical hits — are asserted as negatives, which is exactly what a
 *     description-only implementation cannot do.
 *   - **Hound of Ill Omen** (L6) — a real `COMPANION_TYPES.CLASS_SUMMON` companion,
 *     summoned through the GENERIC declarative `companion.scaling` descriptor
 *     (`{className: "Sorcerer", tempHpPerLevel: 0.5}`) rather than a bespoke
 *     recalculation path.  `classSummon` reads `comp.hp.max` only, so the temporary hit
 *     points — the part that actually scales — need their own `stateCall` probe.
 *   - **Shadow Walk** (L14) — a 120 ft bonus-action teleport gated on dim light or
 *     darkness at BOTH ends.  The gate is the mechanic, so it is probed as a refusal.
 *   - **Umbral Form** (L18) — a 6-Sorcery-Point active state granting resistance to
 *     every damage type EXCEPT force and radiant.  Eleven `toggleGrantsResistance`
 *     probes plus the two exclusions asserted through `stateCall`.  Curated
 *     `{target: "damage:<type>"}` effects, never bare damage types — a bare type is
 *     silently inert (CS-BUG-050).
 *
 * Base-Sorcerer note (CS-BUG-080 / CS-BUG-084): the Sorcery Points pool now has a single
 * source of truth, `CharacterSheetState.getSorceryPointsMaxForClass()`.  On the PHB
 * chassis that is `level` from L2 — a 19-step ladder, so each tier gets its own row with
 * `untilLevel` (the matrix re-evaluates every earlier entry at each later checkpoint).
 */
describeCharacter({
	preset: PRESET_FULL_SHADOW_MAGIC_SORCERER,
	displayName: "Shadow Magic Sorcerer",
	// Umbral Form is the only persistent toggle the subclass has, and it arrives at L18 —
	// long after the L5/L7 signature-toggle checkpoints.
	signatureToggleSkip: {
		skip: true,
		reason:
			"Shadow Magic's only persistent toggle is Umbral Form at L18, well past the L5/L7 signature-toggle checkpoints. "
			+ "Everything online at L5 is instant: Eyes of the Dark casts darkness for 2 Sorcery Points, Strength of the Grave "
			+ "is a damage-triggered save. Both are asserted directly in the matrix (resourceCastSpells / castSpellWithResource "
			+ "and the takeDamage → applyZeroHpIntervention path), and Umbral Form's 11 resistances are probed at L18/L20.",
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
		11: {totalLevel: 11, spellSlots: {6: 1}, expectResources: {"Sorcery Points": 11}},
		17: {totalLevel: 17, spellSlots: {9: 1}, expectResources: {"Sorcery Points": 17}},
		20: {totalLevel: 20, spellSlots: {9: 1}, expectResources: {"Sorcery Points": 20}},
	},
	featuresMatrix: [
		// ══ Sorcerer base chassis ════════════════════════════════════════
		// Font of Magic (L2) → Sorcery Points = sorcerer level from L2.
		// The pool grows at EVERY level, so one row per matrix checkpoint
		// with `untilLevel` — an earlier row must never be re-evaluated
		// against a later, larger pool.
		// NOTE: the MEGA/matrix runners only stop at levels [3, 5, 11, 17, 20]
		// (`characterSpecFactory.ts` MATRIX_CHECKPOINTS), so a `2..2` window would
		// never be evaluated. The long-rest probe therefore rides on the first
		// window that IS reachable.
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
		// Metamagic: 2 options at L3, +1 at L10, +1 at L17. The picker is a real
		// choice the Level-Up wizard must surface, so each tier asserts the
		// cumulative pick count against the PHB option list.
		{level: 3, untilLevel: 9, name: /metamagic/i, kind: "pick", pickedCount: 2, pickedFrom: METAMAGIC_POOL},
		{level: 10, untilLevel: 16, name: /metamagic/i, kind: "pick", pickedCount: 3, pickedFrom: METAMAGIC_POOL},
		{level: 17, name: /metamagic/i, kind: "pick", pickedCount: 4, pickedFrom: METAMAGIC_POOL},
		{level: 20, name: /sorcerous restoration/i, kind: "passive"},

		// ══ Eyes of the Dark (L1) ════════════════════════════════════════
		// Half passive: 120 ft darkvision that has to reach the sheet's real
		// senses, not just a calculation field. There is no `sense`
		// EffectCheck kind, so `stateCall` on getSense/getSenses is the probe.
		{
			level: 1,
			name: /eyes of the dark/i,
			kind: "passive",
			effects: [
				{kind: "featureCalculation", property: "hasEyesOfTheDark", exact: true},
				{kind: "featureCalculation", property: "darkvision", exact: 120},
				// CS-BUG-082 regression guard: `calculations.darkvision` had ZERO
				// consumers anywhere in js/ before this work.
				{kind: "stateCall", method: "getSense", args: ["darkvision"], exact: 120},
				{kind: "stateCall", method: "getSenses", path: "darkvision", exact: 120},
			],
		},
		// Second half, from sorcerer 3: `darkness` is known for free and can be
		// cast for 2 Sorcery Points, after which you see through it.
		{
			level: 3,
			name: /eyes of the dark/i,
			kind: "passive",
			effects: [
				{kind: "featureCalculation", property: "eyesOfTheDarkGrantsDarkness", exact: true},
				{kind: "featureCalculation", property: "darknessSorceryPointCost", exact: 2},
				// Exact-name lookup, deliberately: `spellMatchMode: "any"` DROPS the name
				// assertion and only counts spells at a given level, which both proves less
				// and depends on `getKnownSpells()` reporting a level for subclass
				// always-prepared entries. The name is the thing under test.
				{kind: "spellInList", spell: "Darkness"},
				// The generic resource-cast descriptor, and the cast actually working.
				{kind: "stateCall", method: "getResourceCastableSpells", path: "length", exact: 1},
				{kind: "stateCall", method: "getResourceCastableSpells", path: "0.spell", exact: "Darkness"},
				{kind: "stateCall", method: "getResourceCastableSpells", path: "0.cost", exact: 2},
				{kind: "stateCall", method: "getResourceCastableSpells", path: "0.resourceName", exact: "Sorcery Points"},
				// Before any cast you cannot see through your own darkness…
				{kind: "stateCall", method: "canSeeThroughOwnDarkness", exact: false},
				// …casting it with Sorcery Points spends exactly 2…
				{kind: "stateCall", method: "castSpellWithResource", args: ["Darkness"], path: "spent", exact: 2},
				// …and now you can. (Probes run in order against one live state.)
				{kind: "stateCall", method: "canSeeThroughOwnDarkness", exact: true},
				{kind: "stateCall", method: "endResourceCastSpell", args: ["Darkness"], exact: true},
			],
		},

		// ══ Strength of the Grave (L1) ═══════════════════════════════════
		// The single most fakeable feature in the subclass, so it is probed
		// through the real hit-point machinery end to end: drop to 0, arm the
		// intervention, resolve the save, land on 1 HP.
		{
			level: 1,
			name: /strength of the grave/i,
			kind: "passive",
			effects: [
				{kind: "featureCalculation", property: "hasStrengthOfTheGrave", exact: true},
				{kind: "featureCalculation", property: "strengthOfTheGraveSaveAbility", exact: "cha"},
				{kind: "featureCalculation", property: "strengthOfTheGraveDc", exact: 5},
				// The intervention is registered and CHA-based.
				{kind: "stateCall", method: "getZeroHpInterventions", path: "0.id", exact: "strengthOfTheGrave"},
				{kind: "stateCall", method: "getZeroHpInterventions", path: "0.saveAbility", exact: "cha"},
				{kind: "stateCall", method: "getZeroHpInterventions", path: "0.usesRemaining", exact: 1},
				// Take 12 damage while on exactly 12 HP → 0 HP, intervention armed,
				// DC 5 + 12 = 17.
				{kind: "stateCall", method: "setCurrentHp", args: [12], ignoreResult: true},
				{kind: "stateCall", method: "takeDamage", args: [12], ignoreResult: true},
				{kind: "stateCall", method: "getCurrentHp", exact: 0},
				{kind: "stateCall", method: "getPendingZeroHpIntervention", path: "interventions.0.dc", exact: 17},
				// A total of 17 beats the DC → 1 hit point instead of 0.
				{kind: "stateCall", method: "applyZeroHpIntervention", args: ["strengthOfTheGrave", {total: 17}], path: "success", exact: true},
				{kind: "stateCall", method: "getCurrentHp", exact: 1},
				// …and the use is spent until a long rest.
				{kind: "stateCall", method: "getZeroHpInterventions", path: "0.usesRemaining", exact: 0},
			],
		},
		// The two RAW exclusions, asserted as refusals. A text-only
		// implementation cannot produce these.
		{
			level: 3,
			untilLevel: 3,
			name: /strength of the grave/i,
			kind: "passive",
			effects: [
				// Radiant damage: no save offered.
				{kind: "stateCall", method: "setCurrentHp", args: [9], ignoreResult: true},
				{kind: "stateCall", method: "takeDamage", args: [9, {damageType: "radiant"}], ignoreResult: true},
				{kind: "stateCall", method: "getPendingZeroHpIntervention", path: "interventions.0.available", exact: false},
				{kind: "stateCall", method: "applyZeroHpIntervention", args: ["strengthOfTheGrave", {total: 99}], path: "applied", exact: false},
				{kind: "stateCall", method: "getCurrentHp", exact: 0},
			],
		},
		{
			level: 5,
			untilLevel: 5,
			name: /strength of the grave/i,
			kind: "passive",
			effects: [
				// Critical hit: no save offered either.
				{kind: "stateCall", method: "setCurrentHp", args: [9], ignoreResult: true},
				{kind: "stateCall", method: "takeDamage", args: [9, {isCritical: true}], ignoreResult: true},
				{kind: "stateCall", method: "getPendingZeroHpIntervention", path: "interventions.0.available", exact: false},
				{kind: "stateCall", method: "applyZeroHpIntervention", args: ["strengthOfTheGrave", {total: 99}], path: "applied", exact: false},
				{kind: "stateCall", method: "getCurrentHp", exact: 0},
			],
		},

		// ══ Hound of Ill Omen (L6) ═══════════════════════════════════════
		// A real CLASS_SUMMON companion built from the dire wolf, re-typed to
		// Medium monstrosity, costing 3 Sorcery Points.
		// Widened from `6..10`, which contained no matrix checkpoint and so ran
		// NEVER — the whole `classSummon` probe below was silently dead.
		{
			level: 6,
			untilLevel: 16,
			name: /hound of ill omen/i,
			kind: "passive",
			effects: [
				{kind: "featureCalculation", property: "hasHoundOfIllOmen", exact: true},
				{kind: "featureCalculation", property: "houndOfIllOmenCost", exact: 3},
				{kind: "featureCalculation", property: "houndOfIllOmenRange", exact: 120},
				// Temp HP = half sorcerer level (3 at L6, 5 at L10).
				{kind: "featureCalculation", property: "houndOfIllOmenTempHp", min: 3},
				{
					kind: "classSummon",
					method: "summonHoundOfIllOmen",
					restFirst: "long",
					dismissMethod: "dismissHoundOfIllOmen",
					namePattern: "hound of ill omen",
					ac: 14,
					hpExact: 37,
					attackNamePattern: "bite",
					damageContains: "piercing",
				},
				// `classSummon` reads comp.hp.max only, so the SCALING part — the
				// temporary hit points — needs its own probe, along with the
				// declarative descriptor that produces them.
				{kind: "stateCall", method: "summonHoundOfIllOmen", path: "ok", exact: true},
				{kind: "stateCall", method: "getHoundOfIllOmen", path: "hp.temp", min: 3},
				{kind: "stateCall", method: "getHoundOfIllOmen", path: "scaling.className", exact: "Sorcerer"},
				{kind: "stateCall", method: "getHoundOfIllOmen", path: "scaling.tempHpPerLevel", exact: 0.5},
				{kind: "stateCall", method: "getHoundOfIllOmen", path: "size", exact: "M"},
				{kind: "stateCall", method: "getHoundOfIllOmen", path: "creatureType", exact: "monstrosity"},
				{kind: "stateCall", method: "dismissHoundOfIllOmen", exact: true},
			],
		},
		{
			level: 17,
			name: /hound of ill omen/i,
			kind: "passive",
			effects: [
				// Half of 17 = 8; half of 20 = 10. `min` so the row survives
				// re-evaluation at the L20 checkpoint.
				{kind: "featureCalculation", property: "houndOfIllOmenTempHp", min: 8},
				{kind: "stateCall", method: "summonHoundOfIllOmen", path: "ok", exact: true},
				{kind: "stateCall", method: "getHoundOfIllOmen", path: "hp.temp", min: 8},
				{kind: "stateCall", method: "dismissHoundOfIllOmen", exact: true},
			],
		},

		// ══ Shadow Walk (L14) ════════════════════════════════════════════
		// The lighting gate IS the mechanic, so both the success and the two
		// refusals are asserted.
		{
			level: 14,
			name: /shadow walk/i,
			kind: "passive",
			effects: [
				{kind: "featureCalculation", property: "hasShadowWalk", exact: true},
				{kind: "featureCalculation", property: "shadowWalkRange", exact: 120},
				{kind: "featureCalculation", property: "shadowWalkAction", exact: "bonus"},
				{kind: "stateCall", method: "useShadowWalk", path: "distance", exact: 120},
				{kind: "stateCall", method: "useShadowWalk", path: "action", exact: "bonus"},
				// Not in dim light/darkness → refused.
				{kind: "stateCall", method: "useShadowWalk", args: [{inDimLightOrDarkness: false}], path: "ok", exact: false},
				// Destination not in dim light/darkness → also refused.
				{kind: "stateCall", method: "useShadowWalk", args: [{destinationInDimLightOrDarkness: false}], path: "ok", exact: false},
				// Beyond 120 ft → refused.
				{kind: "stateCall", method: "useShadowWalk", args: [{distance: 121}], path: "ok", exact: false},
			],
		},

		// ══ Umbral Form (L18) ════════════════════════════════════════════
		// 6 Sorcery Points for resistance to EVERYTHING except force and
		// radiant. The exclusions are the interesting half — a curated
		// effects list that quietly resisted all 13 types would pass a
		// naive probe, so both exceptions are asserted as absences.
		{
			level: 18,
			name: /umbral form/i,
			kind: "toggle",
			toggleDelta: "none",
			effects: [
				{kind: "featureCalculation", property: "hasUmbralForm", exact: true},
				{kind: "featureCalculation", property: "umbralFormCost", exact: 6},
				{kind: "featureCalculation", property: "umbralFormDurationMinutes", exact: 1},
				// CS-BUG-050 regression guard: these must be
				// `{target: "damage:<type>"}`; a bare damage type is silently inert.
				{kind: "toggleGrantsResistance", damageType: "acid"},
				{kind: "toggleGrantsResistance", damageType: "bludgeoning"},
				{kind: "toggleGrantsResistance", damageType: "cold"},
				{kind: "toggleGrantsResistance", damageType: "fire"},
				{kind: "toggleGrantsResistance", damageType: "lightning"},
				{kind: "toggleGrantsResistance", damageType: "necrotic"},
				{kind: "toggleGrantsResistance", damageType: "piercing"},
				// NOTE: no `toggleGrantsResistance` probe for poison — this build is a
				// Dwarf, and Dwarven Resilience already grants poison resistance, so the
				// helper (correctly) refuses to probe a delta that cannot exist. Poison is
				// covered by the total-count assertions below instead.
				{kind: "toggleGrantsResistance", damageType: "psychic"},
				{kind: "toggleGrantsResistance", damageType: "slashing"},
				{kind: "toggleGrantsResistance", damageType: "thunder"},
				// …and NOT force or radiant. Umbral Form grants exactly 11 of the 13 damage
				// types; the Dwarf's own poison resistance is one of those 11, so the active
				// total is 11 and the baseline it returns to is 1 (poison). If force or
				// radiant leaked in, the active count would be 12 or 13.
				{kind: "stateCall", method: "activateState", args: ["umbralForm"], ignoreResult: true},
				{kind: "stateCall", method: "getResistances", path: "length", exact: 11},
				{kind: "stateCall", method: "deactivateState", args: ["umbralForm"], ignoreResult: true},
				{kind: "stateCall", method: "getResistances", path: "length", exact: 1},
			],
		},
	],
});
