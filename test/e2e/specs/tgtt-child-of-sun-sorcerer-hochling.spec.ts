import {describeCharacter} from "../utils/characterSpecFactory";
import {PRESET_FULL_CHILD_OF_SUN_HOCHLING} from "../utils/characterBuilder";
import type {FeatureCheck} from "../utils/comprehensiveBuildHelpers";
import {buildSpecialtyChecks, buildAnyMetamagicChecks, TGTT_METAMAGIC} from "../utils/tgttFeaturePools";

// ── Child of the Sun Sorcerer L1→20 features matrix ──────────────────
// Sorcerer base (PHB classic — TGTT uses PHB Sorc table):
//   L2 Font of Magic / Sorcery Points (= Sorc level, long-rest restore)
//   L3 Metamagic — 3 known; 5 total at L10; 7 total at L17
//   L20 Sorcerous Restoration — short-rest recovery of up to 4 SP
// Child of the Sun Bloodline subclass (TGTT, copies Ar2 base):
//   L1 Glimpse of the Sun — passive on the sheet (cantrip rider)
//      with a sorcery-point-fueled flare action available from L3
//   L1 Summer's Defiant Blood — passive damage-rider reaction
//   L3 Sun Spells — always-prepared bloodline spell list
//      (continual flame, faerie fire, flaming sphere etc. at L3)
//   L6 Sunlit Path (passive) / L14 Grasping the Sun / L18 Bright Zenith
const CHILD_OF_SUN_FEATURES_MATRIX: FeatureCheck[] = [
	// ── Sorcerer base ────────────────────────────────────────────
	// TGTT Sorcery Points equal sorcerer level + 1 from L1; Font
	// of Magic → long-rest restore until Sorcerous Restoration.
	// L3 anchor also carries the Hochling racial probes (Aasimar copy:
	// resistance to necrotic + radiant, Light cantrip via Light Bearer)
	// and the Sorcerer cantrip-count baseline (4 cantrips known at L1+).
	{
		level: 3,
		name: "Sorcery Points",
		kind: "resource",
		untilLevel: 4,
		resourceMax: 4,
		restoreOn: "long",
		effects: [
			{kind: "longRestRestores", resource: "Sorcery Points"},
			// Hochling = Aasimar copy: Celestial Resistance grants
			// resistance to necrotic and radiant damage at L1.
			{kind: "resistance", damageType: "necrotic"},
			{kind: "resistance", damageType: "radiant"},
			// Light cantrip — granted by Hochling/Aasimar Light Bearer
			// (and re-granted by Glimpse of the Sun at L3).
			{kind: "spellInList", spell: "Light"},
			// Sorcerer L1 picks 4 cantrips (Sun Bloodline adds Light free).
			{kind: "cantripCount", min: 4},
			// Sorcerers are proficient in CON + CHA saves; CON button
			// must exist and not throw on click.
			{kind: "rollSavingThrow", ability: "con"},
			{kind: "rollSkillCheck", proficientSkills: true, skip: true, skipReason: "P5 follow-up: proficientSkills DOM lookup needs CharacterSheetPage hardening — state-side proficient ≠ rendered button"},
		],
	},
	{level: 5,  name: "Sorcery Points", kind: "resource", untilLevel: 10, resourceMax: 6,
		effects: [
			{kind: "rollSavingThrow", ability: "cha"},
			{kind: "rollAbilityCheck", ability: "cha"},
			{kind: "rollSkillCheck", proficientSkills: true, skip: true, skipReason: "P5 follow-up: proficientSkills DOM lookup needs CharacterSheetPage hardening — state-side proficient ≠ rendered button"},
			{kind: "rollInitiative"},
			// Spell save DC at L5 = 8 + prof(3) + CHA mod. The preset now pins
			// CHA first via `abilityPriority` (CS-BUG-056), so the standard
			// array's 15 + the Hochling's bonus lands the modifier at +3 or
			// better: 8 + 3 + 3 = 14. Floor kept one below to absorb species
			// ASI variation without going back to measuring a dump stat.
			{kind: "spellSaveDc", min: 13},
			// Signature attack — preset grants Fire Bolt cantrip and the
			// Sorcerer starting kit gives a dagger / light crossbow.
			{kind: "rollAttack", attackName: /dagger|crossbow|fire bolt|quarterstaff/i, skip: true, skipReason: "TGTT preset deliberately ships unarmed; see Phase 15 P4 for pre-equip plan"},
		]},
	{level: 11, name: "Sorcery Points", kind: "resource", untilLevel: 16, resourceMax: 12},
	{level: 17, name: "Sorcery Points", kind: "resource", untilLevel: 19, resourceMax: 18},
	{level: 20, name: "Sorcery Points", kind: "resource", resourceMax: 21},

	// TGTT Metamagic picks: 3 at L3, 5 at L10, 7 at L17.
	// The auto-picker's deterministic first choice is Aimed Spell.
	// Active metamagic is selected per cast, not exposed as a standing
	// toggle, so probe the known-only and cast-time state APIs directly.
	{level: 3, untilLevel: 9, name: /metamagic/i, kind: "pick", pickedCount: 3,
		pickedFrom: TGTT_METAMAGIC,
		effects: [
			{kind: "stateCall", method: "getKnownMetamagicKeys", path: "length", exact: 3},
			{kind: "stateCall", method: "getKnownActiveMetamagics", contains: "Aimed Spell"},
			{kind: "stateCall", method: "getMetamagicCost", args: ["aimed", 1], exact: 2},
			{kind: "stateCall", method: "getCastableActiveMetamagics", args: [{slotLevel: 1}], contains: "Aimed Spell"},
			{kind: "stateCall", method: "getCastableActiveMetamagics", args: [{slotLevel: 1}], path: "0.cost", exact: 2},
		]},
	{level: 3, untilLevel: 3, name: /font of magic/i, kind: "passive",
		effects: [
			{kind: "stateCall", method: "onLongRest", ignoreResult: true},
			{kind: "stateCall", method: "getSorceryPoints", path: "current", exact: 4},
			{kind: "stateCall", method: "useSorceryPoint", args: [2], exact: true},
			{kind: "stateCall", method: "getSorceryPoints", path: "current", exact: 2},
			{kind: "stateCall", method: "onLongRest", ignoreResult: true},
		]},
	{level: 10, untilLevel: 16, name: /metamagic/i, kind: "pick", pickedCount: 5,
		pickedFrom: TGTT_METAMAGIC,
		effects: [
			{kind: "stateCall", method: "getKnownMetamagicKeys", path: "length", exact: 5},
			{kind: "stateCall", method: "getKnownActiveMetamagics", contains: "Aimed Spell"},
		]},
	{level: 17, name: /metamagic/i, kind: "pick", pickedCount: 7,
		pickedFrom: TGTT_METAMAGIC,
		effects: [
			{kind: "stateCall", method: "getKnownMetamagicKeys", path: "length", exact: 7},
			{kind: "stateCall", method: "getKnownActiveMetamagics", contains: "Aimed Spell"},
		]},

	// Phase H additive coverage: helper-driven per-pick effect probes
	// (`pickedFeatureGrants` for the auto-picker's deterministic first
	// choice). Complements the rich rows above which assert ownership
	// and cast-time availability through the metamagic state APIs.
	...buildAnyMetamagicChecks(["TGTT"]),

	// Sorcerous Restoration at L20 — short-rest recovery of up to 4 SP.
	{level: 20, name: /sorcerous restoration/i, kind: "passive",
		effects: [
			{kind: "shortRestRestores", resource: "Sorcery Points"},
		]},

	// ── Child of the Sun Bloodline subclass ──────────────────────
	// Subclass features all key off L3 in this build (TGTT copies the
	// Ar2 bloodline whose first feature lands at sorcerer level 3).
	// Glimpse of the Sun grants the {@spell light} cantrip free AND
	// unlocks the sorcery-point flare, which is fully state-probeable:
	// `useGlimpseOfTheSunFlare()` performs the real spend and returns
	// the DC / range / target-count contract.
	{level: 3, name: /glimpse of the sun/i, kind: "passive",
		effects: [
			{kind: "spellInList", spell: "Light"},
			// The flare is an ACTION costing 1 Sorcery Point…
			{kind: "stateCall", method: "useGlimpseOfTheSunFlare", args: [{targets: ["Goblin"]}], path: "ok", exact: true},
			// …and its save is DEX against the sheet's own spell save DC,
			// which was `null` before this subclass was implemented.
			{kind: "stateCall", method: "useGlimpseOfTheSunFlare", args: [{targets: ["Goblin"]}], path: "saveAbility", exact: "dex"},
			{kind: "stateCall", method: "useGlimpseOfTheSunFlare", args: [{targets: ["Goblin"]}], path: "range", exact: 20},
			{kind: "stateCall", method: "useGlimpseOfTheSunFlare", args: [{targets: ["Goblin"]}], path: "condition", exact: "blinded"},
			// Without Bright Zenith the flare refuses a second target.
			{kind: "stateCall", method: "useGlimpseOfTheSunFlare", args: [{targets: ["Goblin", "Orc"]}], path: "ok", exact: false},
		]},
	// The flare's SPEND accounting is level-coupled (the Sorcery Point pool is
	// sorcerer level + 1 under TGTT's Font of Magic), so it is asserted on a
	// row pinned to a single level rather than on the unbounded row above,
	// which re-runs at every checkpoint.
	{level: 3, untilLevel: 3, name: /glimpse of the sun/i, kind: "passive",
		effects: [
			{kind: "stateCall", method: "onLongRest", ignoreResult: true},
			{kind: "stateCall", method: "getSorceryPoints", path: "current", exact: 4},
			{kind: "stateCall", method: "useGlimpseOfTheSunFlare", args: [{targets: ["Goblin"]}], path: "cost", exact: 1},
			{kind: "stateCall", method: "getSorceryPoints", path: "current", exact: 3},
			{kind: "stateCall", method: "onLongRest", ignoreResult: true},
		]},
	// Summer's Defiant Blood — arms a +CHA rider on the next spell's
	// damage roll, once per round. The old comment here claimed there
	// was "no state-observable probe"; there now is one — the arm/consume
	// pair is the generic `pendingSpellDamageBonus` family.
	{level: 3, name: /summer'?s defiant blood/i, kind: "passive",
		effects: [
			{kind: "stateCall", method: "resetPendingSpellDamageBonusCooldowns", ignoreResult: true},
			{kind: "stateCall", method: "armSummersDefiantBlood", path: "ok", exact: true},
			{kind: "stateCall", method: "isSummersDefiantBloodArmed", exact: true},
			// Once per round: a second arm in the same round is refused.
			{kind: "stateCall", method: "armSummersDefiantBlood", path: "ok", exact: false},
			// The round reset releases the lock again.
			{kind: "stateCall", method: "clearPendingSpellDamageBonus", ignoreResult: true},
			{kind: "stateCall", method: "resetPendingSpellDamageBonusCooldowns", ignoreResult: true},
			{kind: "stateCall", method: "armSummersDefiantBlood", path: "ok", exact: true},
			{kind: "stateCall", method: "clearPendingSpellDamageBonus", ignoreResult: true},
		]},

	// Sun Spells — always-prepared bloodline spells. The `kind:
	// "spells"` check verifies the spells appear via `grantsSpells`.
	// `spellInList` effect probes are an additional independent
	// assertion that the spell name ends up in the known-spells list.
	{level: 3, name: /sun spells/i, kind: "spells",
		grantsSpells: ["Continual Flame", "Flaming Sphere"],
		effects: [
			{kind: "spellInList", spell: "Continual Flame"},
			{kind: "spellInList", spell: "Flaming Sphere"},
		]},
	{level: 5, name: /sun spells/i, kind: "spells",
		grantsSpells: ["Daylight"],
		effects: [
			{kind: "spellInList", spell: "Daylight"},
		]},
	{level: 7, name: /sun spells/i, kind: "spells",
		grantsSpells: ["Fire Shield"],
		effects: [
			{kind: "spellInList", spell: "Fire Shield"},
		]},
	{level: 9, name: /sun spells/i, kind: "spells",
		grantsSpells: ["Dawn"],
		effects: [
			{kind: "spellInList", spell: "Dawn"},
		]},

	// Higher-tier subclass features inherited from the Ar2 base
	// bloodline. Ar2 is not vendored in-tree, but the CODE PATH is
	// shared with TGTT, so these are effect-verified like any other
	// feature rather than left as bare presence listings.
	//
	// Sunlit Path: +15 ft walking speed, radiant resistance, and the
	// overland-travel clause that used to be computed and rendered
	// nowhere.
	{level: 6, name: /sunlit path/i, kind: "passive",
		effects: [
			// Hochling base 30 ft + Sunlit Path 15 ft. Asserted as a FLOOR:
			// by the first checkpoint at which this row runs (11 — the MEGA
			// checkpoints are 3/5/11/17/20) the build has also taken a TGTT
			// specialty that moves the speed further. The Sunlit-Path-specific
			// half of the effect is pinned by the travel-pace probes below,
			// which no other feature contributes to.
			{kind: "speed", min: 45},
			{kind: "resistance", damageType: "radiant"},
			{kind: "stateCall", method: "getTravelPaceBonus", path: "feetPerMinute", exact: 100},
			{kind: "stateCall", method: "getTravelPaceBonus", path: "milesPerHour", exact: 1},
			{kind: "stateCall", method: "getTravelPaceBonus", path: "milesPerDay", exact: 6},
			{kind: "stateCall", method: "getTravelPaceBonus", path: "allyRange", exact: 30},
		]},
	// Grasping the Sun: reaction, reduce damage by sorcerer level, and
	// deal that much radiant back on a melee attack only. The reduction
	// IS the sorcerer level, so this row (which re-runs at every
	// checkpoint from 14 up) asserts the invariants rather than a
	// level-specific number.
	{level: 14, name: /grasping the sun/i, kind: "passive",
		effects: [
			{kind: "stateCall", method: "useGraspingTheSun", args: [{damage: 30, fromMeleeAttack: true}], path: "reduction", min: 14},
			// Retaliation equals the reduction, and only on a melee attack.
			{kind: "stateCall", method: "useGraspingTheSun", args: [{damage: 30, fromMeleeAttack: true}], path: "radiantDamage", min: 14},
			{kind: "stateCall", method: "useGraspingTheSun", args: [{damage: 30, fromMeleeAttack: false}], path: "radiantDamage", exact: 0},
			// Reduction never drives the damage below zero.
			{kind: "stateCall", method: "useGraspingTheSun", args: [{damage: 3, fromMeleeAttack: true}], path: "damageTaken", exact: 0},
		]},
	// The exact arithmetic is pinned at a single checkpoint, where the
	// sorcerer level is known: 30 incoming − 17 reduction = 13 taken.
	// (Pinned at 17 rather than 14 because the MEGA matrix's checkpoints
	// are 3/5/11/17/20 — a 14-only row would never execute.)
	{level: 17, untilLevel: 17, name: /grasping the sun/i, kind: "passive",
		effects: [
			{kind: "stateCall", method: "useGraspingTheSun", args: [{damage: 30, fromMeleeAttack: true}], path: "reduction", exact: 17},
			{kind: "stateCall", method: "useGraspingTheSun", args: [{damage: 30, fromMeleeAttack: true}], path: "damageTaken", exact: 13},
			{kind: "stateCall", method: "useGraspingTheSun", args: [{damage: 30, fromMeleeAttack: true}], path: "radiantDamage", exact: 17},
		]},
	// Bright Zenith: a real 1-minute toggle, not a one-shot spend.
	// Grants blindsight 100 ft and widens the Glimpse flare to 40 ft
	// and any number of targets.
	//
	// `useBrightZenith()` is called exactly ONCE — a second call while the
	// state runs correctly returns `{ok: false}`, so the cost assertion
	// rides the same activating call rather than a repeat of it.
	{level: 18, name: /bright zenith/i, kind: "passive",
		effects: [
			{kind: "stateCall", method: "onLongRest", ignoreResult: true},
			// `getSenseBonusFromStates` isolates the ACTIVE-STATE contribution,
			// so these assertions are independent of whatever blindsight the
			// rest of the build already carries (`getSenses()` merges the two
			// with `Math.max`, and by L20 this build has a standing 15 ft).
			{kind: "stateCall", method: "getSenseBonusFromStates", args: ["blindsight"], exact: 0},
			{kind: "stateCall", method: "useBrightZenith", path: "cost", exact: 6},
			{kind: "stateCall", method: "isStateTypeActive", args: ["brightZenith"], exact: true},
			{kind: "stateCall", method: "getSenseBonusFromStates", args: ["blindsight"], exact: 100},
			// …and the merged total really does reach 100 ft on the sheet.
			{kind: "stateCall", method: "getSenses", path: "blindsight", min: 100},
			// The state feeds back into the flare: 40 ft, multi-target.
			{kind: "stateCall", method: "useGlimpseOfTheSunFlare", args: [{targets: ["Goblin", "Orc"]}], path: "ok", exact: true},
			{kind: "stateCall", method: "useGlimpseOfTheSunFlare", args: [{targets: ["Goblin", "Orc"]}], path: "range", exact: 40},
			{kind: "stateCall", method: "useGlimpseOfTheSunFlare", args: [{targets: ["Goblin", "Orc"]}], path: "multiTarget", exact: true},
			// Ending it takes the blindsight with it.
			{kind: "stateCall", method: "endBrightZenith", ignoreResult: true},
			{kind: "stateCall", method: "isStateTypeActive", args: ["brightZenith"], exact: false},
			{kind: "stateCall", method: "getSenseBonusFromStates", args: ["blindsight"], exact: 0},
			{kind: "stateCall", method: "onLongRest", ignoreResult: true},
		]},
	...buildSpecialtyChecks("Sorcerer"),
];

/**
 * #6 — Child of the Sun Bloodline Sorcerer Hochling (TGTT) — L1→20.
 *
 * Coverage focus:
 *   - Sorcery Points scale with class level (TGTT grants Font of Magic at L1)
 *   - Bloodline-specific resistances / fire damage rider at L1
 *   - Metamagic options arrive on schedule
 *   - Sorcerous Restoration / capstone arrives at L20
 */
describeCharacter({
	preset: PRESET_FULL_CHILD_OF_SUN_HOCHLING,
	displayName: "Child of the Sun Sorcerer Hochling",
	signatureToggle: /metamagic|sun|font of magic|searing/i,
	// CS-BUG-030: TGTT presets deliberately ship unarmed, so equip a weapon
	// the USE attack probe can actually roll.
	midTierLoadout: [
		{name: "Dagger", equipped: true},
	],
	usage: {
		atLevel: 5,
		castSpellSlotLevel: 1,
		useResourceName: "Sorcery Points",
		expectLongRestRestores: true,
		attackName: /dagger|crossbow/i,
		skillRoll: {name: "Persuasion"},
		// Sorcery Points restore on long rest, not short rest; skip cleanly.
		shortRestRestores: {skip: true},
		concentrationCheck: {castSpell: "Bless", thenAction: "damage", expectActive: false},
		deathSaves: true,
		applyCondition: {skip: true},
		featAbility: {skip: true},
	},
	milestones: {
		1:  {totalLevel: 1,  spellSlots: {1: 2},  expectResources: {"Sorcery Points": 1}},
		3:  {totalLevel: 3,  spellSlots: {2: 2},  expectResources: {"Sorcery Points": 3}},
		5:  {totalLevel: 5,  spellSlots: {3: 2},  expectResources: {"Sorcery Points": 5}},
		11: {totalLevel: 11, spellSlots: {6: 1}, expectResources: {"Sorcery Points": 11}},
		17: {totalLevel: 17, spellSlots: {9: 1}, expectResources: {"Sorcery Points": 17}},
		20: {totalLevel: 20, spellSlots: {9: 1}, expectResources: {"Sorcery Points": 20}},
	},
	featuresMatrix: CHILD_OF_SUN_FEATURES_MATRIX,
});
