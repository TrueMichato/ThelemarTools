import {describeCharacter} from "../utils/characterSpecFactory";
import {PRESET_FULL_SPELLFIRE_SORCERER} from "../utils/characterBuilder";
import {TGTT_METAMAGIC} from "../utils/tgttFeaturePools";

/**
 * Metamagic pick pool. Identical rationale to the Shadow Magic spec: the Thelemar
 * homebrew registers its Metamagic optional features against the Sorcerer class
 * generally, so the picker offers the TGTT "<X> Spell (Active|Passive)" options
 * alongside — in practice INSTEAD of — the eight XPHB names. Both spellings are
 * accepted so the row asserts "the picker produced N real picks" without pinning
 * which catalogue the sheet served.
 */
const METAMAGIC_POOL: RegExp[] = [
	...TGTT_METAMAGIC,
	/^careful spell$/i, /^distant spell$/i, /^empowered spell$/i, /^extended spell$/i,
	/^heightened spell$/i, /^quickened spell$/i, /^subtle spell$/i, /^twinned spell$/i,
];

/**
 * Spellfire Sorcery Sorcerer (FRHoF subclass on the XPHB / 2024 Sorcerer chassis) — L1→20.
 *
 * The 2024 Sorcerer picks its subclass at LEVEL 3, so every subclass-feature gate below
 * is a sorcerer-level gate that first *evaluates* at the L3 matrix checkpoint.
 *
 * Coverage focus — every subclass feature must have an observable MECHANICAL effect, not
 * just a rendered description. Before this work the whole subclass rendered its text and
 * changed no number, roll, resource or toggle anywhere in `js/` (CS-BUG-092):
 *
 *   - **Spellfire Spells** (L3) — always-prepared spells driven by the subclass
 *     `additionalSpells.prepared` data (Cure Wounds/Guiding Bolt/Lesser Restoration/
 *     Scorching Ray at 3, up through Greater Restoration/Flame Strike at 9). Probed by
 *     the default `first-party` `spellInList` (never `spellMatchMode: "any"`, which
 *     DELETES the name assertion).
 *   - **Spellfire Burst** (L3) — the once-per-turn / spent-a-Sorcery-Point gate IS the
 *     mechanic, so both refusals are asserted through `useSpellfireBurst()` /
 *     `resetSpellfireBurstTurn()`.
 *   - **Radiant Fire** (L3, 1d4 → 1d8 at 14) — `useRadiantFire()` publishes the live
 *     die, the chosen Fire/Radiant type and rolls the total.
 *   - **Bolstering Flames** (L3, Temp HP 1d4 + CHA, +level at 14) — hooks the REAL
 *     Temp-HP machinery: `useBolsteringFlames({target: "self"})` calls `setTempHp`, so
 *     the reading (`getTempHp()`) is pinned, not just the calculation that feeds it.
 *   - **Absorb Spells** (L6) — Counterspell always prepared (data) + `1d4` Sorcery
 *     Points regained on a failed save, via `regainSorceryPointsFromAbsorbSpells()`
 *     which really raises the pool and clamps at max. Assertions are max-INDEPENDENT
 *     (the row is re-evaluated at L11/17/20 where the SP maximum differs).
 *   - **Honed Spellfire** (L14) — folds into the calc values: Radiant Fire becomes 1d8
 *     and Bolstering Flames adds your Sorcerer level.
 *   - **Crown of Spellfire** (L18) — a real active state: 60 ft Fly Speed reaching
 *     `getSpeed("fly")`, Burning Life Force expending Hit Point Dice via
 *     `useBurningLifeForce()`, Spell Avoidance rewriting save-for-half via
 *     `resolveSpellAvoidance()`, and a 5-Sorcery-Point restore.
 *
 * Base-Sorcerer note (CS-BUG-080 / CS-BUG-084): the Sorcery Points pool's single source of
 * truth is `CharacterSheetState.getSorceryPointsMaxForClass()`. On the XPHB chassis that is
 * `level` from L2 — a growing ladder, so each tier gets its own row with `untilLevel` (the
 * matrix re-evaluates every earlier entry at each later checkpoint, and `resourceMax` is an
 * EXACT match).
 */
describeCharacter({
	preset: PRESET_FULL_SPELLFIRE_SORCERER,
	displayName: "Spellfire Sorcery Sorcerer",
	// Spellfire's only persistent toggle is Crown of Spellfire at L18 — long past the
	// L5/L7 signature-toggle checkpoints. Everything online at L5 is instant (Radiant
	// Fire, Bolstering Flames, Spellfire Burst) and is asserted directly in the matrix.
	signatureToggleSkip: {
		skip: true,
		reason:
			"Spellfire's only persistent toggle is Crown of Spellfire at L18, well past the L5/L7 signature-toggle "
			+ "checkpoints. Everything online at L5 is instant — Radiant Fire, Bolstering Flames and Spellfire Burst "
			+ "are asserted directly in the matrix (useRadiantFire / useBolsteringFlames → getTempHp / useSpellfireBurst), "
			+ "and Crown of Spellfire's toggle + effects are probed at L18/L20.",
	},
	// CS-BUG-030: the wizard ships an unarmed caster, so equip something the USE attack
	// probe can actually roll.
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
		// Sorcery Points restore on a LONG rest only; Sorcerous Restoration (a short-rest
		// refund) is a level-20 feature, far past this L5 probe.
		shortRestRestores: {skip: true},
		concentrationCheck: {castSpell: "Aura of Vitality", thenAction: "damage", expectActive: false},
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
		// Font of Magic (L2) → Sorcery Points = sorcerer level from L2. The pool grows at
		// every level, so one row per checkpoint with `untilLevel` — an earlier row must
		// never be re-evaluated against a later, larger pool.
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

		// Metamagic (base class, XPHB) — 2 options from L2. The picker is a real choice the
		// wizard must surface, so the `pick` row proves that. It is BACKED by a
		// `getKnownMetamagicKeys()` count read straight off the character, which counts only
		// stored picks and is immune to whatever the Features tab chooses to render — the
		// Features surface can list UNPICKED metamagic, so a name probe alone can pass on a
		// character that does not know it. The deep cost mechanics are base-class and are
		// exercised exhaustively by the Shadow Magic spec; here the count is enough.
		{
			level: 3,
			name: /metamagic/i,
			kind: "pick",
			pickedCount: 2,
			pickedFrom: METAMAGIC_POOL,
			effects: [
				{kind: "stateCall", method: "getKnownMetamagicKeys", path: "length", min: 2},
			],
		},

		// ══ Spellfire Spells (L3) ════════════════════════════════════════
		// Always-prepared spells from the subclass `additionalSpells.prepared` data. Exact
		// name lookups, deliberately (default first-party mode) — `spellMatchMode: "any"`
		// DROPS the name assertion and only counts spells at a level.
		{
			level: 3,
			untilLevel: 4,
			name: /spellfire spells|spellfire sorcery/i,
			kind: "passive",
			effects: [
				{kind: "spellInList", spell: "Scorching Ray"},
				{kind: "spellInList", spell: "Guiding Bolt"},
				{kind: "spellInList", spell: "Cure Wounds"},
			],
		},
		{
			level: 5,
			untilLevel: 10,
			name: /spellfire spells|spellfire sorcery/i,
			kind: "passive",
			effects: [
				{kind: "spellInList", spell: "Aura of Vitality"},
				{kind: "spellInList", spell: "Dispel Magic"},
			],
		},
		{
			level: 11,
			name: /spellfire spells|spellfire sorcery/i,
			kind: "passive",
			effects: [
				// Prepared by sorcerer 7 and 9 respectively — first evaluated here at L11.
				{kind: "spellInList", spell: "Wall of Fire"},
				{kind: "spellInList", spell: "Flame Strike"},
			],
		},

		// ══ Radiant Fire (L3, scales at 14) ══════════════════════════════
		// 1d4 Fire OR Radiant within 30 ft; `useRadiantFire()` publishes the live die and
		// the per-use damage type and rolls the total.
		{
			level: 3,
			untilLevel: 11,
			name: /radiant fire/i,
			kind: "passive",
			effects: [
				{kind: "featureCalculation", property: "hasRadiantFire", exact: true},
				{kind: "featureCalculation", property: "radiantFireDamage", exact: "1d4"},
				{kind: "featureCalculation", property: "radiantFireRange", exact: 30},
				{kind: "stateCall", method: "useRadiantFire", args: [{damageType: "radiant", roll: 5}], path: "total", exact: 5},
				{kind: "stateCall", method: "useRadiantFire", args: [{damageType: "radiant", roll: 5}], path: "damageType", exact: "radiant"},
				{kind: "stateCall", method: "useRadiantFire", args: [{damageType: "fire", roll: 5}], path: "damage", exact: "1d4"},
			],
		},
		// Honed Spellfire (L14) upgrades the die to 1d8 — anchored at L14, first evaluated
		// at the L17 checkpoint.
		{
			level: 14,
			name: /radiant fire/i,
			kind: "passive",
			effects: [
				{kind: "featureCalculation", property: "radiantFireDamage", exact: "1d8"},
				{kind: "stateCall", method: "useRadiantFire", args: [{roll: 8}], path: "damage", exact: "1d8"},
			],
		},

		// ══ Bolstering Flames (L3, scales at 14) ═════════════════════════
		// Temp HP 1d4 + CHA within 30 ft. Hooks the REAL Temp-HP machinery: the reading
		// (`getTempHp()`) is pinned, not just the calculation. `min` bounds throughout —
		// the 2024 Background Origin ASI makes the exact final CHA uncertain.
		{
			level: 3,
			untilLevel: 11,
			name: /bolstering flames/i,
			kind: "passive",
			effects: [
				{kind: "featureCalculation", property: "hasBolsteringFlames", exact: true},
				{kind: "featureCalculation", property: "bolsteringFlamesRange", exact: 30},
				{kind: "featureCalculation", property: "bolsteringFlamesTempHpDie", exact: "1d4"},
				// Self-apply performs the mutation and reports it applied…
				{kind: "stateCall", method: "useBolsteringFlames", args: [{target: "self", roll: 4}], path: "applied", exact: true},
				// …and the Temp HP actually land on the sheet (4 + CHA mod ≥ 3 → ≥ 7; min 5 is safe).
				{kind: "stateCall", method: "getTempHp", min: 5},
				// Targeting an ally leaves your own Temp HP untouched.
				{kind: "stateCall", method: "useBolsteringFlames", args: [{target: "ally", roll: 4}], path: "applied", exact: false},
			],
		},
		// Honed Spellfire (L14) adds your Sorcerer level to the Temp HP total — anchored at
		// L14, first evaluated at L17 (bonus = CHA mod + 17).
		{
			level: 14,
			name: /honed spellfire/i,
			kind: "passive",
			effects: [
				{kind: "featureCalculation", property: "hasHonedSpellfire", exact: true},
				{kind: "featureCalculation", property: "radiantFireDamage", exact: "1d8"},
				{kind: "featureCalculation", property: "bolsteringFlamesTempHpBonus", min: 15},
				// The reading: 1 (die) + CHA mod + level(≥17) → ≥ 18; min 15 survives L17 and L20.
				{kind: "stateCall", method: "useBolsteringFlames", args: [{target: "self", roll: 1}], path: "applied", exact: true},
				{kind: "stateCall", method: "getTempHp", min: 15},
			],
		},

		// ══ Spellfire Burst (L3) ═════════════════════════════════════════
		// Once per turn, and only when you spent ≥1 Sorcery Point on the Magic action or a
		// Bonus Action, you may unleash Bolstering Flames or Radiant Fire. Both gates are
		// the mechanic, so both refusals are asserted.
		{
			level: 3,
			untilLevel: 11,
			name: /spellfire burst/i,
			kind: "passive",
			effects: [
				{kind: "featureCalculation", property: "hasSpellfireBurst", exact: true},
				{kind: "featureCalculation", property: "spellfireBurstUsesPerTurn", exact: 1},
				{kind: "featureCalculation", property: "spellfireBurstMinSorceryPoints", exact: 1},
				{kind: "stateCall", method: "resetSpellfireBurstTurn", ignoreResult: true},
				// First use this turn succeeds…
				{kind: "stateCall", method: "useSpellfireBurst", args: [{effect: "radiant", effectOpts: {roll: 4}}], path: "ok", exact: true},
				// …a second in the same turn is refused (once-per-turn lock)…
				{kind: "stateCall", method: "useSpellfireBurst", args: [{effect: "radiant", effectOpts: {roll: 4}}], path: "ok", exact: false},
				{kind: "stateCall", method: "resetSpellfireBurstTurn", ignoreResult: true},
				// …and even after reset, spending no Sorcery Point is refused (trigger gate).
				{kind: "stateCall", method: "useSpellfireBurst", args: [{effect: "radiant", spentSorceryPoint: false, effectOpts: {roll: 4}}], path: "ok", exact: false},
			],
		},

		// ══ Absorb Spells (L6) ═══════════════════════════════════════════
		// Counterspell always prepared (data) + regain 1d4 Sorcery Points on a failed save.
		// The regain really raises the pool and clamps at max. Assertions are
		// max-INDEPENDENT because this row (no restrictive `untilLevel`) is first evaluated
		// at L11 and re-evaluated at L17/L20 where the SP maximum differs.
		{
			level: 6,
			name: /absorb spells/i,
			kind: "passive",
			effects: [
				{kind: "featureCalculation", property: "hasAbsorbSpells", exact: true},
				{kind: "featureCalculation", property: "absorbSpellsSorceryPointRegain", exact: "1d4"},
				{kind: "spellInList", spell: "Counterspell"},
				// Full pool → regain clamps to 0 gained.
				{kind: "stateCall", method: "onLongRest", ignoreResult: true},
				{kind: "stateCall", method: "regainSorceryPointsFromAbsorbSpells", args: [{roll: 3}], path: "regained", exact: 0},
				// Spend 4 (room ≥ 4 at every checkpoint ≥ 11) → a 3 regains exactly 3.
				{kind: "stateCall", method: "useSorceryPoint", args: [4], ignoreResult: true},
				{kind: "stateCall", method: "regainSorceryPointsFromAbsorbSpells", args: [{roll: 3}], path: "regained", exact: 3},
			],
		},

		// ══ Crown of Spellfire (L18) ═════════════════════════════════════
		// A real active state, first evaluated at the L20 checkpoint. The `toggle` row
		// (toggleDelta "none") proves the ability is DISPLAYED and TOGGLEABLE and that
		// activate/deactivate work through the UI; the `stateCall` sequence then drives the
		// three mechanics end to end against one live state.
		{
			level: 18,
			name: /crown of spellfire/i,
			kind: "toggle",
			toggleDelta: "none",
			effects: [
				{kind: "featureCalculation", property: "hasCrownOfSpellfire", exact: true},
				{kind: "featureCalculation", property: "crownOfSpellfireFlySpeed", exact: 60},
				{kind: "featureCalculation", property: "crownOfSpellfireRestoreCost", exact: 5},
				{kind: "featureCalculation", property: "crownBurningLifeForceMaxDice", min: 1},
				// Flight: the 60 ft Fly Speed must reach the sheet's real speed.
				{kind: "stateCall", method: "activateState", args: ["crownOfSpellfire"], ignoreResult: true},
				{kind: "stateCall", method: "getSpeed", args: ["fly"], exact: 60},
				// Burning Life Force: expends Hit Point Dice and reduces damage (crown active).
				{kind: "stateCall", method: "useBurningLifeForce", args: [{diceToSpend: 2, roll: 9, incomingDamage: 30}], path: "diceSpent", exact: 2},
				{kind: "stateCall", method: "useBurningLifeForce", args: [{diceToSpend: 2, roll: 9, incomingDamage: 5}], path: "reduction", exact: 5},
				// Spell Avoidance rewrites save-for-half: success → 0 damage, failure → half.
				{kind: "stateCall", method: "resolveSpellAvoidance", args: [{saveSuccess: true, damage: 40}], path: "damageTaken", exact: 0},
				{kind: "stateCall", method: "resolveSpellAvoidance", args: [{saveSuccess: false, damage: 40}], path: "damageTaken", exact: 20},
				// Deactivating removes the Fly Speed again.
				{kind: "stateCall", method: "deactivateState", args: ["crownOfSpellfire"], ignoreResult: true},
				{kind: "stateCall", method: "getSpeed", args: ["fly"], exact: 0},
			],
		},
	],
});
