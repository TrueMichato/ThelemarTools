import {describeCharacter} from "../utils/characterSpecFactory";
import {PRESET_FULL_METEOR_KNIGHT_FIGHTER} from "../utils/characterBuilder";
import type {FeatureCheck} from "../utils/comprehensiveBuildHelpers";

const METEOR_KNIGHT_FEATURES_MATRIX: FeatureCheck[] = [
	{
		level: 1,
		name: /second wind/i,
		kind: "resource",
		resourceMax: 1,
		restoreOn: "short",
		effects: [{kind: "shortRestRestores", resource: "Second Wind"}],
	},
	{
		level: 2,
		name: /action surge/i,
		kind: "resource",
		resourceMax: [1, 2],
		restoreOn: "short",
		effects: [{kind: "shortRestRestores", resource: "Action Surge"}],
	},

	// ===== Satellite Mastery (3) =====
	// The pool tracks the proficiency bonus, so it must be asserted per tier
	// rather than as one flat max: PB is 2 at L3-4, 3 at L5-8, 4 at L9-12,
	// 5 at L13-16 and 6 from L17.
	{
		level: 3,
		untilLevel: 4,
		name: /satellite mastery/i,
		kind: "resource",
		resourceName: "Satellites",
		resourceMax: 2,
		restoreOn: "long",
		effects: [
			{kind: "longRestRestores", resource: "Satellites"},
			{kind: "featureCalculation", property: "satelliteDamage", exact: "1d4"},
			{kind: "featureCalculation", property: "satelliteRange", exact: 30},
			{kind: "featureCalculation", property: "satelliteAbility", exact: "int"},
			// "Being within 5 feet of a hostile creature doesn't impose disadvantage
			// on your ranged attack rolls with this feature."
			{kind: "featureCalculation", property: "satelliteIgnoresCloseQuartersDisadvantage", exact: true},
			{kind: "featureCalculation", property: "satelliteRecallRange", exact: 120},
			// The satellite is a real, rollable ranged SPELL attack, not prose.
			{kind: "attackPresent", namePattern: /^satellite\b/i},
			{kind: "grantedAttack", name: "Satellite", damage: "1d4", range: "30 ft.", isSpellAttack: true},
			{kind: "rollAttack", attackName: /satellite/i},
			// Firing one actually spends from the orbit pool.
			{kind: "stateCall", method: "getSatelliteAttackProfile", path: "damage", exact: "1d4"},
			{kind: "stateCall", method: "getSatelliteAttackProfile", path: "ability", exact: "int"},
			{kind: "stateCall", method: "getSatellitesMax", exact: 2},
		],
	},
	{
		level: 5,
		untilLevel: 8,
		name: /satellite mastery/i,
		kind: "resource",
		resourceName: "Satellites",
		resourceMax: 3,
		effects: [{kind: "stateCall", method: "getSatellitesMax", exact: 3}],
	},
	{
		level: 9,
		untilLevel: 12,
		name: /satellite mastery/i,
		kind: "resource",
		resourceName: "Satellites",
		resourceMax: 4,
		effects: [{kind: "stateCall", method: "getSatellitesMax", exact: 4}],
	},
	{
		// PB 5 (levels 13-16). Not exercised by the current checkpoint list
		// [3, 5, 11, 17, 20], but kept so the tier ladder is complete and stays
		// correct if the checkpoints ever change.
		level: 13,
		untilLevel: 16,
		name: /satellite mastery/i,
		kind: "resource",
		resourceName: "Satellites",
		resourceMax: 5,
		effects: [{kind: "stateCall", method: "getSatellitesMax", exact: 5}],
	},
	{
		level: 17,
		name: /satellite mastery/i,
		kind: "resource",
		resourceName: "Satellites",
		resourceMax: 6,
		effects: [{kind: "stateCall", method: "getSatellitesMax", exact: 6}],
	},

	// ===== Reduce Gravity (3 / 10 / 15) =====
	{
		level: 3,
		untilLevel: 9,
		name: /reduce gravity/i,
		kind: "passive",
		effects: [
			{kind: "featureCalculation", property: "hasReduceGravity", exact: true},
			{kind: "stateCall", method: "getInnateSpells", contains: "Feather Fall"},
			{kind: "stateCall", method: "getInnateSpells", contains: "Jump"},
			// Levitate is level-gated to 10 — it must NOT be granted yet.
			{kind: "stateCall", method: "getFeatureCalculations", path: "reduceGravitySpells.length", exact: 2},
		],
	},

	// ===== Course Correct (7) =====
	{
		level: 7,
		name: /course correct/i,
		kind: "passive",
		effects: [
			{kind: "featureCalculation", property: "hasCourseCorrect", exact: true},
			{kind: "featureCalculation", property: "courseCorrectRange", exact: 10},
			// The contest explicitly adds proficiency on top of the INT modifier,
			// so the bonus must beat a plain INT check at every tier.
			{kind: "stateCall", method: "getCourseCorrectCheckBonus", min: 3},
		],
	},

	// ===== Improved Satellite Mastery (10) =====
	{
		level: 10,
		name: /improved satellite mastery/i,
		kind: "passive",
		effects: [
			{kind: "featureCalculation", property: "hasImprovedSatelliteMastery", exact: true},
			{kind: "featureCalculation", property: "satelliteReturnsOnMiss", exact: true},
			{kind: "featureCalculation", property: "satelliteRecallOnActionSurge", exact: true},
			// Range steps up at 10 and never again.
			{kind: "featureCalculation", property: "satelliteRange", exact: 60},
			// Levitate is released only now — it was deferred at level 3.
			{kind: "stateCall", method: "getInnateSpells", contains: "Levitate"},
		],
	},
	{
		// The middle damage tier: 1d6 from 10 until Satellite Barrage bumps it to
		// 1d8 at 18, so this assertion must expire before the capstone.
		level: 10,
		untilLevel: 17,
		name: /improved satellite mastery/i,
		kind: "passive",
		effects: [
			{kind: "featureCalculation", property: "satelliteDamage", exact: "1d6"},
			{kind: "stateCall", method: "getSatelliteAttackProfile", path: "damage", exact: "1d6"},
		],
	},

	// ===== Increase Gravity (15) =====
	{
		level: 15,
		name: /increase gravity/i,
		kind: "passive",
		effects: [
			{kind: "featureCalculation", property: "hasIncreaseGravity", exact: true},
			// +INT to shove checks, surfaced as an opt-in Athletics conditional so it
			// can't leak onto unrelated Athletics rolls.
			{
				kind: "stateCall",
				method: "aggregateModifiers",
				args: ["skill:athletics"],
				path: "conditionalsAvailable",
				contains: "shove",
			},
			{
				kind: "stateCall",
				method: "aggregateModifiers",
				args: ["save:str"],
				path: "conditionals",
				contains: "pushed, pulled, or knocked prone",
			},
		],
	},

	// ===== Satellite Barrage (18) =====
	{
		level: 18,
		name: /satellite barrage/i,
		kind: "passive",
		effects: [
			{kind: "featureCalculation", property: "hasSatelliteBarrage", exact: true},
			// Any number of ranged spell attacks up to the satellites in orbit.
			{kind: "stateCall", method: "getSatelliteBarrageMaxAttacks", min: 6},
			// Damage steps up one final time.
			{kind: "featureCalculation", property: "satelliteDamage", exact: "1d8"},
			{kind: "stateCall", method: "getSatelliteAttackProfile", path: "damage", exact: "1d8"},
		],
	},

	// ===== Fighter chassis =====
	{
		level: 5,
		name: /extra attack/i,
		kind: "passive",
		effects: [{kind: "featureCalculation", property: "extraAttacks", min: 2}],
	},
	{
		level: 9,
		name: /indomitable/i,
		kind: "resource",
		// Defensive pin, NOT load-bearing. It names the authoritative pool
		// explicitly; it does not describe how the sheet renders. Once
		// CS-BUG-112 (classic-Fighter Indomitable emitting a second, stale
		// "Indomitable (two uses)" pool) is fixed, the pattern resolves to a
		// single pool and this line is redundant — check known-bugs.md for
		// status rather than inferring it from this comment.
		resourceName: "Indomitable",
		// 1 use at 9, 2 at 13, 3 at 17.
		resourceMax: [1, 2, 3],
		restoreOn: "long",
		effects: [{kind: "longRestRestores", resource: "Indomitable"}],
	},
];

/**
 * TGS3 Meteor Knight Fighter — L1→20.
 *
 * Coverage focus:
 *   - Satellite Mastery's Intelligence-keyed ranged spell attack, its
 *     proficiency-sized orbit pool, and the 3/10/18 damage + range tiers
 *   - Reduce Gravity's level-gated spell grants (feather fall + jump at 3,
 *     levitate deferred to 10, at-will upgrade at 15)
 *   - Course Correct's proficiency-added contest, Improved Satellite Mastery's
 *     Action Surge recall, Increase Gravity's opt-in conditionals, and the
 *     Satellite Barrage capstone
 */
describeCharacter({
	preset: PRESET_FULL_METEOR_KNIGHT_FIGHTER,
	displayName: "Meteor Knight Fighter Aarakocra",
	skipL3: false,
	skipL5: false,
	skipL7: false,
	skipMega: false,
	midTierLoadout: [
		{name: "Cloak of Protection", source: "DMG", attune: true},
	],
	// Meteor Knight has no toggle-shaped feature: Satellite Mastery is an
	// action/bonus-action economy ability backed by the Satellites pool, and
	// Increase Gravity is a per-roll opt-in conditional rather than a stance.
	signatureToggleSkip: {skip: true, reason: "Meteor Knight's signature abilities are action-economy + per-roll conditionals, not stances; the Satellites pool is probed via kind:\"resource\" and usage.useResourceName"},
	usage: {
		useResourceName: "Satellites",
		attackName: /satellite/i,
		skillRoll: {name: "Athletics"},
		// Satellites re-form over a long rest; in play they come back via the
		// Recall action or Action Surge, neither of which is a short rest.
		// Meteor Knight has no short-rest subclass pool — Satellites recharge on a
		// long rest, and in play via the Recall action or Action Surge.
		shortRestRestores: {skip: true},
		// Fighter has no concentration spell at L5.
		concentrationCheck: {skip: true},
		deathSaves: true,
		applyCondition: {name: "Frightened"},
		// The build takes Archery, a passive Fighting Style with no activatable toggle.
		featAbility: {skip: true},
	},
	milestones: {
		1: {totalLevel: 1, minMaxHp: 10, expectToggles: [/second wind/i]},
		3: {totalLevel: 3, minMaxHp: 25, expectResources: {Satellites: 2}},
		5: {totalLevel: 5, minMaxHp: 39, expectResources: {Satellites: 3}},
		11: {totalLevel: 11, minMaxHp: 80, expectResources: {Satellites: 4}},
		17: {totalLevel: 17, minMaxHp: 120, expectResources: {Satellites: 6}},
		20: {totalLevel: 20, minMaxHp: 140, expectResources: {Satellites: 6}},
	},
	featuresMatrix: METEOR_KNIGHT_FEATURES_MATRIX,
});
