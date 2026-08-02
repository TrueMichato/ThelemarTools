import {describeCharacter} from "../utils/characterSpecFactory";
import {PRESET_FULL_SHADOW_SORCERY_RHW_SORCERER} from "../utils/characterBuilder";
import {TGTT_METAMAGIC} from "../utils/tgttFeaturePools";

/**
 * Metamagic pick pool.
 *
 * Same reasoning as the Shadow Magic spec: the Thelemar homebrew registers its
 * Metamagic optional features against the Sorcerer class generally, so the picker
 * may serve the TGTT "<X> Spell (Active|Passive)" catalogue alongside — in practice
 * instead of — the XPHB names. Both spellings are accepted so the row asserts "the
 * picker produced N real picks" without pinning which catalogue was served.
 */
const METAMAGIC_POOL: RegExp[] = [
	...TGTT_METAMAGIC,
	/^careful spell$/i, /^distant spell$/i, /^empowered spell$/i, /^extended spell$/i,
	/^heightened spell$/i, /^quickened spell$/i, /^seeking spell$/i, /^subtle spell$/i,
	/^transmuted spell$/i, /^twinned spell$/i,
];

/**
 * Sorcerer / **Shadow Sorcery (RHW)** — L1→20.  The 2024 rework of Shadow Magic, on
 * the **XPHB** chassis: Innate Sorcery at 1, Font of Magic + Metamagic at 2, subclass
 * at **3**, Sorcerous Restoration at 5, Sorcery Incarnate at 7, Arcane Apotheosis at 20.
 *
 * ## Why this is not the Shadow Magic spec with the names changed
 *
 * `Shadow Magic|XGE` is already merged and shares this subclass's `shortName`
 * (`"Shadow"`), so the single biggest risk here is asserting XGE behaviour under an
 * RHW name.  Every row below that could be satisfied by the XGE implementation is
 * paired with a **discriminator** — an assertion the XGE code would FAIL:
 *
 * | Feature | XGE behaviour | RHW behaviour asserted here |
 * |---|---|---|
 * | Strength of the Grave | restores **1** HP | restores **CHA mod + Sorcerer level** (`min` rows that exclude 1) |
 * | Strength of the Grave | radiant + criticals excluded | **neither** is excluded — both asserted as SUCCESSES |
 * | Eyes of the Dark | 120 ft darkvision, casts *Darkness* for 3 SP | 120 ft darkvision **+ 10 ft blindsight**, **no** SP-cast Darkness |
 * | Ill Omen (L6) | *Hound* — a scaled companion | *Beasts* — a **3-SP free cast of Summon Beast**, optional concentration |
 * | Umbral Form (L18) | 6 SP to **enter**, 1 minute | bound to **Innate Sorcery**, 1/long rest, 6 SP **restores the use** |
 *
 * ## Every ability has a mechanical effect, and every effect is asserted at its READING
 *
 * The failure mode this batch keeps producing is a correct calculation that no
 * player-facing surface consumes.  So each feature below is probed at the number a
 * player would actually see, not at the calculation that produces it:
 *
 *   - **Eyes of the Dark** → `getSenses()` / `getSense()`, not `calculations.blindsight`.
 *     (Before this work `calculations.blindsight` had **zero** assignments anywhere in
 *     `js/` and the grant loop was darkvision-only — CS-BUG-098.)
 *   - **Strength of the Grave** → the **hit point the character ends up on** after
 *     `takeDamage()` → `applyZeroHpIntervention()`, not the registry entry.
 *   - **Beasts of Ill Omen** → the **Sorcery Point total actually dropping by 3**, and
 *     the companion actually appearing in `getCompanions()`.
 *   - **Shadow Resilience** → the **damage actually taken through the resistance**
 *     (`takeDamage` → `getCurrentHp`), not `getResistances()`.  Until CS-BUG-100
 *     `takeDamage()` never applied defenses at all, so every resistance the model
 *     computed was decorative on that path.
 *   - **Innate Sorcery** → the **spell save DC on the sheet** (CS-BUG-099: no consumer
 *     of a `{type: "bonus", target: "spellDc"}` state effect existed).
 *
 * ## Matrix-window discipline
 *
 * Checkpoints are exactly `[3, 5, 11, 17, 20]`.  Every still-active earlier row is
 * re-evaluated at every later checkpoint, so each `exact:` row on a value that grows
 * carries an `untilLevel`, and every row's window is checked to contain at least one
 * checkpoint (a window that contains none is never evaluated — green forever, with no
 * skip marker to grep for).  L1 is **not** a checkpoint, so the `level: 1` rows below
 * are first evaluated at L3 and carry L3's values.
 */
describeCharacter({
	preset: PRESET_FULL_SHADOW_SORCERY_RHW_SORCERER,
	displayName: "Shadow Sorcery RHW Sorcerer",
	// Innate Sorcery is the subclass's load-bearing toggle (Umbral Form hangs off it)
	// and it is online from L1, so it — not Umbral Form — is the L5/L7 signature toggle.
	// It moves the spell save DC by +1, so `probeToggleDelta` sees a real dcDelta.
	signatureToggle: /innate sorcery/i,
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
		// XPHB Sorcerous Restoration (L5) restores Sorcery Points on a SHORT rest, but
		// only up to half the sorcerer's level and once per long rest — the generic
		// "short rest fully restores" probe does not model that, so it is asserted
		// explicitly in the matrix instead.
		shortRestRestores: {skip: true},
		concentrationCheck: {castSpell: "Shield of Faith", thenAction: "damage", expectActive: false},
		deathSaves: true,
		applyCondition: {skip: true},
		featAbility: {skip: true},
	},
	milestones: {
		1: {totalLevel: 1, spellSlots: {1: 2}, expectResources: {"Innate Sorcery": 2}},
		3: {totalLevel: 3, spellSlots: {2: 2}, expectResources: {"Sorcery Points": 3, "Innate Sorcery": 2}},
		5: {totalLevel: 5, spellSlots: {3: 2}, expectResources: {"Sorcery Points": 5}},
		11: {totalLevel: 11, spellSlots: {6: 1}, expectResources: {"Sorcery Points": 11}},
		17: {totalLevel: 17, spellSlots: {9: 1}, expectResources: {"Sorcery Points": 17}},
		20: {totalLevel: 20, spellSlots: {9: 1}, expectResources: {"Sorcery Points": 20}},
	},
	featuresMatrix: [
		// ══ Sorcerer XPHB base chassis ═══════════════════════════════════
		// Sorcery Points = sorcerer level from L2. NOTE this is the XPHB
		// ladder, NOT the TGTT `level + 1` one — `prioritySources: ["XPHB"]`
		// on the preset is what keeps the sheet off `Sorcerer|TGTT`, and
		// these numbers are the assertion that it worked.
		{
			level: 2,
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

		// ── Innate Sorcery (L1) — the XPHB feature the whole subclass hangs off.
		// A `resource` row proves it is DISPLAYED with its real 2/long-rest budget;
		// the effects prove it DOES something. Before CS-BUG-099 the sheet
		// classified it as a junk `custom` toggle whose only effect was a note,
		// and nothing anywhere read a `{type: "bonus", target: "spellDc"}` effect.
		{
			level: 1,
			name: "Innate Sorcery",
			kind: "resource",
			resourceMax: 2,
			restoreOn: "long",
			effects: [
				{kind: "longRestRestores", resource: "Innate Sorcery"},
				// It is a real named state, not a name-detected `custom` toggle.
				// `getActivatableFeatures()` is the sheet's OWN "Available to Activate"
				// list — the surface the toggle row is built from — so this reads the
				// classification the player's click will actually use. (The static
				// `detectActivatableFeature` is not reachable through `stateCall`, which
				// only calls INSTANCE methods; it is pinned in Jest instead.)
				{kind: "pickToggleable", matchAny: [/^innate sorcery$/i]},
				{kind: "stateCall", method: "getActivatableFeatures", contains: "\"stateTypeId\":\"innateSorcery\""},
				// THE READING: the spell save DC on the sheet moves by +1.
				// `getSpellSaveDC` is what the Spells tab renders, so this is the
				// player-facing number and not one more accessor.
				{kind: "stateCall", method: "deactivateState", args: ["innateSorcery"], ignoreResult: true},
				{kind: "stateCall", method: "activateState", args: ["innateSorcery", {source: "Innate Sorcery"}], ignoreResult: true},
				{kind: "stateCall", method: "getBonusFromStates", args: ["spellDc"], exact: 1},
				{kind: "stateCall", method: "hasAdvantageFromStates", args: ["attack:spell"], exact: true},
				{kind: "stateCall", method: "deactivateState", args: ["innateSorcery"], ignoreResult: true},
				{kind: "stateCall", method: "getBonusFromStates", args: ["spellDc"], exact: 0},
				{kind: "stateCall", method: "hasAdvantageFromStates", args: ["attack:spell"], exact: false},
			],
		},
		// Metamagic: 2 options at L2, +2 at L10, +2 at L17 (XPHB), a different
		// ladder from the PHB 2/3/4.
		//
		// ⚠️ The `pick` row alone is NOT enough and this trap is worth inheriting:
		// `getFeatures()` lists UNPICKED metamagic options, so a name probe passes
		// on a character that does not know the metamagic. Metamagic is also
		// deliberately excluded from the activatable-row surface
		// (`charactersheet-combat.js:5806/:5827/:6048`) because it resolves at CAST
		// time, so a `pickToggleable` probe against it is structurally
		// unsatisfiable. Each tier is therefore BACKED by `getKnownMetamagicKeys()`,
		// which only counts stored picks.
		{level: 2, untilLevel: 9, name: /metamagic/i, kind: "pick", pickedCount: 2, pickedFrom: METAMAGIC_POOL,
			effects: [
				{kind: "stateCall", method: "getKnownMetamagicKeys", path: "length", exact: 2},
				{kind: "stateCall", method: "getCastableActiveMetamagics", args: [{slotLevel: 2}], ignoreResult: true},
			]},
		{level: 10, untilLevel: 16, name: /metamagic/i, kind: "pick", pickedCount: 4, pickedFrom: METAMAGIC_POOL,
			effects: [{kind: "stateCall", method: "getKnownMetamagicKeys", path: "length", exact: 4}]},
		{level: 17, name: /metamagic/i, kind: "pick", pickedCount: 6, pickedFrom: METAMAGIC_POOL,
			effects: [{kind: "stateCall", method: "getKnownMetamagicKeys", path: "length", exact: 6}]},
		// Sorcerous Restoration (L5) and the two capstones, asserted as displayed.
		{level: 5, name: /sorcerous restoration/i, kind: "passive"},
		{level: 7, name: /sorcery incarnate/i, kind: "passive"},
		{level: 20, name: /arcane apotheosis/i, kind: "passive"},

		// ══ Shadow Sorcery (L3) — the umbrella ═══════════════════════════
		// A `refSubclassFeature` umbrella; assert it is displayed so a broken
		// pointer surfaces here rather than as four silently missing features.
		{level: 3, name: /shadow sorcery/i, kind: "passive"},

		// ══ Shadow Spells (L3) — always-prepared table ════════════════════
		// Asserted BY NAME at every tier. `spellMatchMode: "any"` is never used
		// here: it silently DROPS the name assertion and only counts spells at a
		// level, which is how a probe can pass against a spell that does not exist.
		{
			level: 3,
			name: /shadow spells/i,
			kind: "passive",
			effects: [
				{kind: "spellInList", spell: "Bane"},
				{kind: "spellInList", spell: "Darkness"},
				{kind: "spellInList", spell: "Inflict Wounds"},
				{kind: "spellInList", spell: "Pass Without Trace"},
			],
		},
		{
			level: 5,
			name: /shadow spells/i,
			kind: "passive",
			effects: [
				{kind: "spellInList", spell: "Hunger of Hadar"},
				{kind: "spellInList", spell: "Nondetection"},
			],
		},
		// L7 and L9 tiers. Their first checkpoint is 11 — deliberately noted,
		// because a row whose window contains no checkpoint is never evaluated.
		{
			level: 7,
			name: /shadow spells/i,
			kind: "passive",
			effects: [
				{kind: "spellInList", spell: "Greater Invisibility"},
				{kind: "spellInList", spell: "Phantasmal Killer"},
			],
		},
		{
			level: 9,
			name: /shadow spells/i,
			kind: "passive",
			effects: [
				{kind: "spellInList", spell: "Contagion"},
				{kind: "spellInList", spell: "Creation"},
			],
		},

		// ══ Power of Shadow (L3) → Eyes of the Dark ═══════════════════════
		// TWO senses, and the second one is the whole point: the sense-grant loop
		// was darkvision-only, so a blindsight grant was silently dropped
		// (CS-BUG-098). `getSenses()` is the sheet's own senses surface.
		{
			level: 3,
			// `untilLevel: 5` bounds ONLY because of the final row: Beasts of Ill Omen
			// (L6) publishes its own `resourceCastSpells` entry, so the "there is no
			// SP-cast Darkness" count stops being 0 from L6 onward. The sense grants
			// below are re-asserted unbounded in the companion row that follows.
			untilLevel: 5,
			name: /power of shadow/i,
			kind: "passive",
			effects: [
				{kind: "featureCalculation", property: "hasPowerOfShadow", exact: true},
				{kind: "featureCalculation", property: "darkvision", exact: 120},
				{kind: "featureCalculation", property: "blindsight", exact: 10},
				{kind: "stateCall", method: "getSense", args: ["darkvision"], exact: 120},
				{kind: "stateCall", method: "getSense", args: ["blindsight"], exact: 10},
				{kind: "stateCall", method: "getSenses", path: "darkvision", exact: 120},
				{kind: "stateCall", method: "getSenses", path: "blindsight", exact: 10},
				// DISCRIMINATOR vs XGE: RHW has NO Sorcery-Point cast of Darkness.
				// XGE's Eyes of the Dark registers exactly one resource-cast spell
				// (Darkness, 2 SP) at this level, so an XGE implementation wearing the
				// RHW name would report 1 here at L3.
				{kind: "stateCall", method: "getResourceCastableSpells", path: "length", exact: 0},
			],
		},
		// The sense grants again, unbounded, so the L11/L17/L20 checkpoints still
		// assert them once the row above has expired. Deliberately WITHOUT the
		// resource-cast count, which is 1 from L6 (Summon Beast).
		{
			level: 6,
			name: /power of shadow/i,
			kind: "passive",
			effects: [
				{kind: "stateCall", method: "getSense", args: ["darkvision"], exact: 120},
				{kind: "stateCall", method: "getSense", args: ["blindsight"], exact: 10},
				{kind: "stateCall", method: "getSenses", path: "blindsight", exact: 10},
			],
		},
		// Seeing normally through Darkness created by a spell YOU cast. The trigger
		// is your own concentration, so it is driven through the real concentration
		// surface and read back through the same predicate Shadow Walk consults.
		{
			level: 3,
			untilLevel: 5,
			name: /power of shadow/i,
			kind: "passive",
			effects: [
				{kind: "featureCalculation", property: "seeThroughOwnSpellDarkness", exact: true},
				{kind: "stateCall", method: "canSeeThroughOwnDarkness", exact: false},
				{kind: "stateCall", method: "setConcentration", args: [{name: "Darkness", level: 2, source: "Spell"}], ignoreResult: true},
				{kind: "stateCall", method: "canSeeThroughOwnDarkness", exact: true},
				// An unrelated concentration spell must NOT qualify — the negative is
				// what separates "reads the spell name" from "returns true whenever
				// you are concentrating".
				{kind: "stateCall", method: "setConcentration", args: [{name: "Haste", level: 3, source: "Spell"}], ignoreResult: true},
				{kind: "stateCall", method: "canSeeThroughOwnDarkness", exact: false},
				{kind: "stateCall", method: "breakConcentration", ignoreResult: true},
			],
		},

		// ══ Power of Shadow (L3) → Strength of the Grave ══════════════════
		// The most fakeable feature in the subclass, and the one most likely to be
		// copied from XGE, so it is probed end-to-end through the real hit-point
		// machinery AND at the value that distinguishes the two editions.
		{
			level: 3,
			untilLevel: 3,
			name: /power of shadow/i,
			kind: "passive",
			effects: [
				{kind: "stateCall", method: "getZeroHpInterventions", path: "0.id", exact: "strengthOfTheGraveRhw"},
				{kind: "stateCall", method: "getZeroHpInterventions", path: "0.saveAbility", exact: "cha"},
				{kind: "stateCall", method: "getZeroHpInterventions", path: "0.usesRemaining", exact: 1},
				// Drop to exactly 0 from 12 HP → DC 5 + 12 = 17.
				{kind: "stateCall", method: "setCurrentHp", args: [12], ignoreResult: true},
				{kind: "stateCall", method: "takeDamage", args: [12], ignoreResult: true},
				{kind: "stateCall", method: "getCurrentHp", exact: 0},
				{kind: "stateCall", method: "getPendingZeroHpIntervention", path: "interventions.0.dc", exact: 17},
				{kind: "stateCall", method: "applyZeroHpIntervention", args: ["strengthOfTheGraveRhw", {total: 17}], path: "success", exact: true},
				// THE READING, and THE DISCRIMINATOR. XGE leaves you on exactly 1 HP.
				// RHW leaves you on Charisma modifier + Sorcerer level, which at L3
				// with a CHA-first standard array is at least 3 + 1 = 4. `min` (not
				// `exact`) because the exact Charisma depends on the background's ASI
				// spread, but the floor is chosen to EXCLUDE 1 — the XGE value.
				{kind: "stateCall", method: "getCurrentHp", min: 4},
				{kind: "stateCall", method: "getZeroHpInterventions", path: "0.usesRemaining", exact: 0},
			],
		},
		// The two XGE exclusions are NOT exclusions in RHW. Asserted as SUCCESSES —
		// this is exactly the pair an implementation copied from Shadow Magic fails.
		{
			level: 5,
			untilLevel: 5,
			name: /power of shadow/i,
			kind: "passive",
			effects: [
				// Radiant damage: RHW offers the save (XGE does not).
				{kind: "stateCall", method: "setCurrentHp", args: [9], ignoreResult: true},
				{kind: "stateCall", method: "takeDamage", args: [9, {damageType: "radiant"}], ignoreResult: true},
				{kind: "stateCall", method: "getPendingZeroHpIntervention", path: "interventions.0.available", exact: true},
				{kind: "stateCall", method: "applyZeroHpIntervention", args: ["strengthOfTheGraveRhw", {total: 99}], path: "success", exact: true},
				// CHA mod (≥3) + sorcerer level 5.
				{kind: "stateCall", method: "getCurrentHp", min: 6},
			],
		},
		{
			level: 11,
			untilLevel: 11,
			name: /power of shadow/i,
			kind: "passive",
			effects: [
				// Critical hit: RHW offers the save (XGE does not).
				{kind: "stateCall", method: "setCurrentHp", args: [9], ignoreResult: true},
				{kind: "stateCall", method: "takeDamage", args: [9, {isCritical: true}], ignoreResult: true},
				{kind: "stateCall", method: "getPendingZeroHpIntervention", path: "interventions.0.available", exact: true},
				{kind: "stateCall", method: "applyZeroHpIntervention", args: ["strengthOfTheGraveRhw", {total: 99}], path: "success", exact: true},
				// The HP restored SCALES with sorcerer level — 11 here vs 5 above,
				// which a flat-1 (or flat-anything) implementation cannot produce.
				{kind: "stateCall", method: "getCurrentHp", min: 12},
			],
		},

		// ══ Beasts of Ill Omen (L6) ══════════════════════════════════════
		// NOT a companion descriptor. A 3-Sorcery-Point free cast of Summon Beast as
		// a Bonus Action, with an explicit player CHOICE of waiving concentration.
		{
			level: 6,
			untilLevel: 11,
			name: /beasts of ill omen/i,
			kind: "passive",
			effects: [
				{kind: "featureCalculation", property: "hasBeastsOfIllOmen", exact: true},
				{kind: "featureCalculation", property: "beastsOfIllOmenCost", exact: 3},
				// The resource-cast descriptor is what the Spells tab reads to build
				// the cast entry, including the CHOICE the player is offered.
				{kind: "stateCall", method: "getResourceCastableSpells", path: "0.spell", exact: "Summon Beast"},
				{kind: "stateCall", method: "getResourceCastableSpells", path: "0.cost", exact: 3},
				{kind: "stateCall", method: "getResourceCastableSpells", path: "0.resourceName", exact: "Sorcery Points"},
				{kind: "stateCall", method: "getResourceCastableSpells", path: "0.castingTime", exact: "bonus"},
				{kind: "stateCall", method: "getResourceCastableSpells", path: "0.concentrationOptional", exact: true},
				{kind: "stateCall", method: "getResourceCastableSpells", path: "0.ignoresMaterialComponents", exact: true},
				{kind: "stateCall", method: "getResourceCastableSpells", path: "0.ignoresPreparation", exact: true},
				// THE READING: the Sorcery Point pool actually drops by 3. At the L11
				// checkpoint the pool is exactly 11, so the before/after are knowable.
				{kind: "stateCall", method: "onLongRest", ignoreResult: true},
				{kind: "stateCall", method: "getSorceryPoints", path: "current", exact: 11},
				{kind: "stateCall", method: "castBeastsOfIllOmen", path: "spent", exact: 3},
				{kind: "stateCall", method: "getSorceryPoints", path: "current", exact: 8},
				// …and a real companion appears on the sheet.
				{kind: "stateCall", method: "getCompanions", path: "length", min: 1},
				// By default it concentrates, like the spell.
				{kind: "stateCall", method: "endResourceCastSpell", args: ["Summon Beast"], ignoreResult: true},
			],
		},
		// The CHOICE, asserted as a difference. Waiving concentration must change the
		// outcome — otherwise the option the picker offers is decorative.
		{
			level: 6,
			untilLevel: 17,
			name: /beasts of ill omen/i,
			kind: "passive",
			effects: [
				{kind: "stateCall", method: "onLongRest", ignoreResult: true},
				// Default: concentrates, no fixed duration.
				{kind: "stateCall", method: "castBeastsOfIllOmen", path: "concentrationWaived", exact: false},
				{kind: "stateCall", method: "endResourceCastSpell", args: ["Summon Beast"], ignoreResult: true},
				// Waived: no concentration, duration becomes 1 minute.
				{kind: "stateCall", method: "castBeastsOfIllOmen", args: [{waiveConcentration: true}], path: "concentrationWaived", exact: true},
				{kind: "stateCall", method: "getActiveResourceCastSpells", path: "0.durationMinutes", exact: 1},
				// Recasting ENDS the earlier one rather than stacking companions:
				// one active cast and one companion, not two of each.
				{kind: "stateCall", method: "castBeastsOfIllOmen", args: [{waiveConcentration: true}], path: "concentrationWaived", exact: true},
				{kind: "stateCall", method: "getActiveResourceCastSpells", path: "length", exact: 1},
				{kind: "stateCall", method: "getCompanions", path: "length", exact: 1},
				{kind: "stateCall", method: "endResourceCastSpell", args: ["Summon Beast"], ignoreResult: true},
				{kind: "stateCall", method: "getCompanions", path: "length", exact: 0},
			],
		},

		// ══ Shadow Walk (L14) ════════════════════════════════════════════
		// The lighting gate IS the mechanic, so both the success and the refusals
		// are asserted. Unchanged from XGE by design — RAW is identical.
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
				{kind: "stateCall", method: "useShadowWalk", args: [{inDimLightOrDarkness: false}], path: "ok", exact: false},
				{kind: "stateCall", method: "useShadowWalk", args: [{destinationInDimLightOrDarkness: false}], path: "ok", exact: false},
				{kind: "stateCall", method: "useShadowWalk", args: [{distance: 121}], path: "ok", exact: false},
				// Your own spell Darkness satisfies the origin-light gate.
				{kind: "stateCall", method: "setConcentration", args: [{name: "Darkness", level: 2, source: "Spell"}], ignoreResult: true},
				{kind: "stateCall", method: "useShadowWalk", args: [{inDimLightOrDarkness: false}], path: "ok", exact: true},
				{kind: "stateCall", method: "breakConcentration", ignoreResult: true},
			],
		},

		// ══ Umbral Form (L18) ════════════════════════════════════════════
		// Bound to Innate Sorcery, once per long rest, 6 SP RESTORES the use.
		//
		// Deliberately NOT `kind: "toggle"`: the matrix's toggle handler activates
		// the row directly, and Umbral Form correctly REFUSES to activate while
		// Innate Sorcery is inactive.
		//
		// Deliberately NOT `pickToggleable` either, and the reason is measured
		// rather than assumed. `pickToggleable` reads `.charsheet__activatable-row`
		// off the Overview tab, and `getActivatableFeatures()` correctly HIDES a
		// state whose `requiresStates` gate is unmet — so the row is absent until
		// Innate Sorcery is on. A `stateCall` cannot bring it back, because
		// `stateCall` only reaches `_state` and nothing re-renders: measured on a
		// live L20 export, the row list was `["Innate Sorcery", ""]` both before
		// AND after `state.activateState("innateSorcery")`, and only became
		// `["Umbral Form", ""]` after an explicit `_renderCharacter()`. A
		// `pickToggleable` row here is therefore structurally unsatisfiable, which
		// is exactly the silent-green shape this suite is supposed to avoid.
		//
		// The display requirement is met instead by `pickActivatable`, which drives
		// the real player-facing control: `activateFeature()` falls through to the
		// Features-tab **Use** button (measured present on the Umbral Form card),
		// i.e. the button wired to `_pUseUmbralFormRhw()`. The toggle-row MODEL is
		// then asserted separately below via `getActivatableFeatures()`, and the
		// mechanics are driven through `stateCall` with Innate Sorcery on first.
		{
			level: 18,
			name: /umbral form/i,
			kind: "passive",
			effects: [
				// The matrix re-evaluates every still-active row at every later
				// checkpoint, and Umbral Form is a once-per-Long-Rest budget: without
				// this the row's outcome would depend on what an earlier row spent.
				// A Long Rest is the feature's own documented recharge, so this makes
				// the row order-independent rather than papering over anything.
				{kind: "stateCall", method: "onLongRest", ignoreResult: true},
				{kind: "stateCall", method: "getUmbralFormStatus", path: "usesRemaining", exact: 1},
				{kind: "featureCalculation", property: "hasUmbralFormRhw", exact: true},
				{kind: "featureCalculation", property: "umbralFormRestoreCost", exact: 6},
				{kind: "featureCalculation", property: "umbralFormIncorporealDamage", exact: "1d10"},
				{kind: "featureCalculation", property: "umbralFormIncorporealDamageType", exact: "force"},
				{kind: "pickActivatable", matchAny: [/^umbral form$/i]},
				// `pickActivatable` drives the real Use button, so if Innate Sorcery
				// happened to be running it legitimately SPENDS the once-per-Long-Rest
				// use — which is the whole point of the click. Dropping Innate Sorcery
				// cascades Umbral Form off (see the `deactivateState` cascade), and the
				// second Long Rest hands the use back, so the gate probes below test the gate
				// rather than an exhausted budget. Without this the row failed at L20 with
				// `activateUmbralForm().ok=false` for the RIGHT reason and the wrong cause.
				{kind: "stateCall", method: "deactivateState", args: ["innateSorcery"], ignoreResult: true},
				{kind: "stateCall", method: "onLongRest", ignoreResult: true},
				{kind: "stateCall", method: "getUmbralFormStatus", path: "usesRemaining", exact: 1},
				// THE GATE: it refuses while Innate Sorcery is off…
				{kind: "stateCall", method: "deactivateState", args: ["innateSorcery"], ignoreResult: true},
				{kind: "stateCall", method: "activateUmbralForm", path: "ok", exact: false},
				// …and works once Innate Sorcery is on.
				{kind: "stateCall", method: "activateState", args: ["innateSorcery", {source: "Innate Sorcery"}], ignoreResult: true},
				// It resolves to the RHW state, not the XGE one — read off the sheet's own
				// "Available to Activate" list, which is what the toggle row is built from.
				// `Umbral Form` is a name shared with Shadow Magic, so this is the only
				// feature in the codebase disambiguated by SOURCE rather than by name; an
				// XGE-classified row would carry `"stateTypeId":"umbralForm"`, which does
				// NOT contain the needle below. Read AFTER Innate Sorcery is on, because
				// `getActivatableFeatures()` correctly hides states whose `requiresStates`
				// are unmet.
				{kind: "stateCall", method: "getActivatableFeatures", contains: "\"stateTypeId\":\"umbralFormRhw\""},
				{kind: "stateCall", method: "activateUmbralForm", path: "ok", exact: true},
				{kind: "stateCall", method: "isStateTypeActive", args: ["umbralFormRhw"], exact: true},
				// Leave NO residue. The matrix re-evaluates every still-active row at every
				// later checkpoint and runs them in declaration order, so a row that ends
				// with Umbral Form still running makes the NEXT row's `activateUmbralForm`
				// return `ok:false` ("already active") — which is correct behaviour and a
				// useless failure. Measured: this exact coupling broke the Shadow
				// Resilience row below the moment this row started passing.
				{kind: "stateCall", method: "endUmbralForm", ignoreResult: true},
				{kind: "stateCall", method: "deactivateState", args: ["innateSorcery"], ignoreResult: true},
			],
		},
		// Shadow Resilience, asserted at the DAMAGE ACTUALLY TAKEN.
		//
		// `getResistances()` is a calculation; the number a player sees is the hit
		// points that leave the sheet. Until CS-BUG-100 `takeDamage()` applied no
		// defenses at all, so a probe against `getResistances()` alone would have
		// been green through the entire period the feature did nothing.
		{
			level: 18,
			name: /umbral form/i,
			kind: "passive",
			effects: [
				// Order-independence: clear any Umbral Form left running by an earlier row
				// before the Long Rest hands the use back, so this row starts from a known
				// state no matter which rows ran ahead of it.
				{kind: "stateCall", method: "endUmbralForm", ignoreResult: true},
				{kind: "stateCall", method: "deactivateState", args: ["innateSorcery"], ignoreResult: true},
				{kind: "stateCall", method: "onLongRest", ignoreResult: true},
				{kind: "stateCall", method: "activateState", args: ["innateSorcery", {source: "Innate Sorcery"}], ignoreResult: true},
				{kind: "stateCall", method: "activateUmbralForm", path: "ok", exact: true},
				// Resistance to everything EXCEPT Force and Radiant — 11 of 13 types.
				{kind: "stateCall", method: "getResistances", path: "length", exact: 11},
				// Fire (resisted): 20 → 10 taken.
				{kind: "stateCall", method: "setCurrentHp", args: [100], ignoreResult: true},
				{kind: "stateCall", method: "takeDamage", args: [20, {damageType: "fire"}], ignoreResult: true},
				{kind: "stateCall", method: "getCurrentHp", exact: 90},
				// Force (NOT resisted): 20 → 20 taken.
				{kind: "stateCall", method: "setCurrentHp", args: [100], ignoreResult: true},
				{kind: "stateCall", method: "takeDamage", args: [20, {damageType: "force"}], ignoreResult: true},
				{kind: "stateCall", method: "getCurrentHp", exact: 80},
				// Radiant (NOT resisted): 20 → 20 taken. XGE excludes force and radiant
				// too, so this pair is a RAW check rather than a discriminator — but a
				// curated list that quietly resisted all 13 types would pass a
				// count-only probe, which is why both are read through damage.
				{kind: "stateCall", method: "setCurrentHp", args: [100], ignoreResult: true},
				{kind: "stateCall", method: "takeDamage", args: [20, {damageType: "radiant"}], ignoreResult: true},
				{kind: "stateCall", method: "getCurrentHp", exact: 80},
				// Ending Innate Sorcery CASCADES Umbral Form off — the binding again,
				// this time from the other direction — and the resistances go with it.
				{kind: "stateCall", method: "deactivateState", args: ["innateSorcery"], ignoreResult: true},
				{kind: "stateCall", method: "isStateTypeActive", args: ["umbralFormRhw"], exact: false},
				{kind: "stateCall", method: "getResistances", path: "length", exact: 0},
			],
		},
		// 6 Sorcery Points RESTORE the use — they do not pay for the transformation.
		// The distinction is the whole L18 rewrite, and it is only observable as a
		// SPEND that leaves you with a use you did not have.
		{
			level: 20,
			name: /umbral form/i,
			kind: "passive",
			effects: [
				{kind: "stateCall", method: "endUmbralForm", ignoreResult: true},
				{kind: "stateCall", method: "deactivateState", args: ["innateSorcery"], ignoreResult: true},
				{kind: "stateCall", method: "onLongRest", ignoreResult: true},
				{kind: "stateCall", method: "getUmbralFormStatus", path: "usesRemaining", exact: 1},
				{kind: "stateCall", method: "activateState", args: ["innateSorcery", {source: "Innate Sorcery"}], ignoreResult: true},
				// Activating costs NO Sorcery Points (XGE charged 6 to enter).
				{kind: "stateCall", method: "getSorceryPoints", path: "current", exact: 20},
				{kind: "stateCall", method: "activateUmbralForm", path: "ok", exact: true},
				{kind: "stateCall", method: "getSorceryPoints", path: "current", exact: 20},
				{kind: "stateCall", method: "getUmbralFormStatus", path: "usesRemaining", exact: 0},
				// Out of uses → refused.
				{kind: "stateCall", method: "endUmbralForm", ignoreResult: true},
				{kind: "stateCall", method: "activateUmbralForm", path: "ok", exact: false},
				// 6 SP buys the use back, and now it works again.
				{kind: "stateCall", method: "restoreUmbralFormUse", path: "ok", exact: true},
				{kind: "stateCall", method: "getSorceryPoints", path: "current", exact: 14},
				{kind: "stateCall", method: "getUmbralFormStatus", path: "usesRemaining", exact: 1},
				{kind: "stateCall", method: "activateUmbralForm", path: "ok", exact: true},
				{kind: "stateCall", method: "deactivateState", args: ["innateSorcery"], ignoreResult: true},
			],
		},
	],
});
