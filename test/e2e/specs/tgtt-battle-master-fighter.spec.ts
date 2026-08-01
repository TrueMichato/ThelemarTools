import {describeCharacter} from "../utils/characterSpecFactory";
import {PRESET_FULL_BATTLE_MASTER_FIGHTER} from "../utils/characterBuilder";
import type {FeatureCheck} from "../utils/comprehensiveBuildHelpers";
import {
	buildAnyManeuverChecks,
	buildSpecialtyChecks,
	buildWeaponMasteryChecks,
} from "../utils/tgttFeaturePools";

const BATTLE_MASTER_FEATURES_MATRIX: FeatureCheck[] = [
	...buildWeaponMasteryChecks(["Club", "Dagger", "Dart"], 1),
	{
		level: 1,
		name: /second wind/i,
		kind: "resource",
		resourceMax: [1, 6],
		restoreOn: "short",
		effects: [{kind: "shortRestRestores", resource: "Second Wind"}],
	},
	{
		level: 2,
		name: /action surge/i,
		kind: "resource",
		// CS-BUG-035: the matrix re-evaluates every earlier entry at each later
		// checkpoint, so a fixed max on a GROWING pool is stale the moment it
		// grows. `untilLevel` is the harness's mechanism for exactly this — its
		// own docs use Action Surge as the worked example. Prefer it over a
		// loose [min,max] range so each tier stays exactly asserted.
		untilLevel: 16,
		resourceMax: 1,
		restoreOn: "short",
		effects: [{kind: "shortRestRestores", resource: "Action Surge"}],
	},
	{level: 17, name: /action surge/i, kind: "resource", resourceMax: 2},
	{
		level: 3,
		name: /superiority dice/i,
		kind: "resource",
		// CS-BUG-035: XPHB grows the pool 4 -> 5 (L7) -> 6 (L15). Same
		// `untilLevel` treatment as Action Surge above; each tier keeps an
		// exact expectation instead of a loosened range.
		untilLevel: 6,
		resourceMax: 4,
		restoreOn: "short",
		effects: [{kind: "shortRestRestores", resource: "Superiority Dice"}],
	},
	{level: 7, name: /superiority dice/i, kind: "resource", untilLevel: 14, resourceMax: 5},
	{level: 15, name: /superiority dice/i, kind: "resource", resourceMax: 6},
	...buildAnyManeuverChecks(["XPHB"]),
	{level: 3, name: /student of war/i, kind: "passive"},
	{level: 5, name: /extra attack/i, kind: "passive"},
	{
		level: 7,
		name: /know your enemy/i,
		// CS-BUG-035: NOT `kind: "resource"`. XPHB Know Your Enemy is a
		// 1/long-rest feature use, and `getGenericPoolResources()` deliberately
		// excludes resources whose feature already renders as an ability row
		// with a Use button, so it never appears as a resource row. Probing the
		// feature-use surface asserts strictly more than the old resource probe
		// did: spend a use, long rest, verify it came back.
		kind: "passive",
		effects: [{kind: "longRestRestoresFeatureUses", feature: "Know Your Enemy"}],
	},
	{level: 10, name: /improved combat superiority/i, kind: "passive"},
	{level: 15, name: /relentless/i, kind: "passive"},
	{level: 18, name: /ultimate combat superiority/i, kind: "passive"},
	...buildSpecialtyChecks("Fighter"),
];

/**
 * XPHB Battle Master Fighter — L1→20.
 *
 * Coverage focus:
 *   - XPHB-only maneuver progression and per-pick Use controls
 *   - Superiority Dice spend/short-rest pool
 *   - Improved/Ultimate Combat Superiority and Relentless milestones
 */
describeCharacter({
	preset: PRESET_FULL_BATTLE_MASTER_FIGHTER,
	displayName: "Battle Master Fighter Aarakocra",
	skipL3: false,
	skipL5: false,
	skipL7: false,
	skipMega: false,
	midTierLoadout: [
		{name: "Cloak of Protection", source: "XDMG", attune: true},
		// CS-BUG-030: TGTT presets deliberately ship unarmed, so equip a
		// weapon the USE attack probe can actually roll.
		{name: "Longsword", equipped: true},
	],
	signatureToggle: /action surge|second wind/i,
	usage: {
		useResourceName: "Superiority Dice",
		attackName: /longsword|greatsword|warhammer|battleaxe|mace|scimitar|rapier|shortsword/i,
		skillRoll: {name: "Athletics"},
		shortRestRestores: {resourceName: "Superiority Dice", expectAfter: 4},
		concentrationCheck: {skip: true},
		deathSaves: true,
		applyCondition: {name: "Frightened"},
		featAbility: {skip: true},
	},
	milestones: {
		1: {totalLevel: 1, minMaxHp: 10, expectToggles: [/second wind/i]},
		3: {totalLevel: 3, minMaxHp: 25, expectResources: {"Superiority Dice": 4}},
		5: {totalLevel: 5, minMaxHp: 39, expectResources: {"Superiority Dice": 4}},
		11: {totalLevel: 11, minMaxHp: 80, expectResources: {"Superiority Dice": 5}},
		17: {totalLevel: 17, minMaxHp: 120, expectResources: {"Superiority Dice": 6}},
		20: {totalLevel: 20, minMaxHp: 140, expectResources: {"Superiority Dice": 6}},
	},
	featuresMatrix: BATTLE_MASTER_FEATURES_MATRIX,
});
