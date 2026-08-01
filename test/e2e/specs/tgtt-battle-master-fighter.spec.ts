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
		resourceMax: 1,
		restoreOn: "short",
		effects: [{kind: "shortRestRestores", resource: "Action Surge"}],
	},
	{
		level: 3,
		name: /superiority dice/i,
		kind: "resource",
		resourceMax: 4,
		restoreOn: "short",
		effects: [{kind: "shortRestRestores", resource: "Superiority Dice"}],
	},
	...buildAnyManeuverChecks(["XPHB"]),
	{level: 3, name: /student of war/i, kind: "passive"},
	{level: 5, name: /extra attack/i, kind: "passive"},
	{
		level: 7,
		name: /know your enemy/i,
		kind: "resource",
		resourceMax: 1,
		restoreOn: "long",
		effects: [{kind: "longRestRestores", resource: "Know Your Enemy"}],
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
