import {describeCharacter} from "../utils/characterSpecFactory";
import {PRESET_FULL_SHADOW_KNIGHT_FIGHTER} from "../utils/characterBuilder";
import type {FeatureCheck} from "../utils/comprehensiveBuildHelpers";

const SHADOW_KNIGHT_FEATURES_MATRIX: FeatureCheck[] = [
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
	{
		level: 3,
		name: /dark gaze/i,
		kind: "passive",
		effects: [
			{kind: "featureCalculation", property: "darkGazeRange", exact: 60},
			{kind: "featureCalculation", property: "darkGazeSeesMagicalDarkness", exact: true},
		],
	},
	{
		level: 3,
		name: /manifest shadow/i,
		kind: "passive",
		effects: [
			{kind: "attackPresent", namePattern: /shadow weapon \(one-handed\)/i},
			{kind: "attackPresent", namePattern: /shadow weapon \(two-handed\)/i},
			{kind: "rollAttack", attackName: /shadow weapon/i},
		],
	},
	{
		level: 3,
		name: /shadowcasting/i,
		kind: "resource",
		resourceMax: [2, 6],
		restoreOn: "short",
		effects: [
			{kind: "shortRestRestores", resource: "Shadowcasting"},
			{kind: "featureCalculation", property: "shadowbiteDamage", exact: "1d8"},
		],
	},
	{
		level: 5,
		name: /extra attack/i,
		kind: "passive",
		effects: [{kind: "featureCalculation", property: "extraAttacks", min: 2}],
	},
	{
		level: 7,
		name: /umbral warrior/i,
		kind: "passive",
		effects: [{kind: "featureCalculation", property: "hasUmbralWarrior", exact: true}],
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
		resourceMax: [1, 3],
		restoreOn: "long",
		effects: [{kind: "longRestRestores", resource: "Indomitable"}],
	},
	{
		level: 10,
		name: /improved shadowcasting/i,
		kind: "passive",
		effects: [{kind: "featureCalculation", property: "hasImprovedShadowcasting", exact: true}],
	},
	{
		level: 15,
		name: /shadow sneak/i,
		kind: "passive",
		effects: [{kind: "featureCalculation", property: "hasShadowSneak", exact: true}],
	},
	{
		level: 18,
		name: /cover of darkness/i,
		kind: "passive",
		effects: [
			{kind: "featureCalculation", property: "coverOfDarknessAcBonus", exact: 2},
			{kind: "featureCalculation", property: "coverOfDarknessDexSaveBonus", exact: 2},
		],
	},
];

/**
 * TGS4 Shadow Knight Fighter — L1→20.
 *
 * Coverage focus:
 *   - Dark Gaze and both generated shadow-weapon attacks
 *   - proficiency-scaled Shadowcasting pool and exact Shadowbite rider
 *   - Umbral Warrior, Improved Shadowcasting, Shadow Sneak, and half cover
 */
describeCharacter({
	preset: PRESET_FULL_SHADOW_KNIGHT_FIGHTER,
	displayName: "Shadow Knight Fighter Human",
	skipL3: false,
	skipL5: false,
	skipL7: false,
	skipMega: false,
	midTierLoadout: [
		{name: "Cloak of Protection", source: "DMG", attune: true},
	],
	signatureToggle: /action surge|second wind/i,
	usage: {
		useResourceName: "Shadowcasting",
		attackName: /shadow weapon/i,
		skillRoll: {name: "Athletics"},
		shortRestRestores: {resourceName: "Shadowcasting"},
		concentrationCheck: {skip: true},
		deathSaves: true,
		applyCondition: {name: "Frightened"},
		featAbility: {skip: true},
	},
	milestones: {
		1: {totalLevel: 1, minMaxHp: 10, expectToggles: [/second wind/i]},
		3: {totalLevel: 3, minMaxHp: 25, expectResources: {Shadowcasting: 2}},
		5: {totalLevel: 5, minMaxHp: 39, expectResources: {Shadowcasting: 3}},
		11: {totalLevel: 11, minMaxHp: 80, expectResources: {Shadowcasting: 4}},
		17: {totalLevel: 17, minMaxHp: 120, expectResources: {Shadowcasting: 6, "Shadow Sneak": 1}},
		20: {totalLevel: 20, minMaxHp: 140, expectResources: {Shadowcasting: 6, "Shadow Sneak": 1}},
	},
	featuresMatrix: SHADOW_KNIGHT_FEATURES_MATRIX,
});
