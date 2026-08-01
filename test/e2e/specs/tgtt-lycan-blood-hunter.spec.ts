import {describeCharacter} from "../utils/characterSpecFactory";
import {PRESET_FULL_LYCAN_BLOOD_HUNTER} from "../utils/characterBuilder";
import type {FeatureCheck} from "../utils/comprehensiveBuildHelpers";

const BLOOD_CURSES = [
	/Blood Curse of Binding/i,
	/Blood Curse of Bloated Agony/i,
	/Blood Curse of Corrosion/i,
	/Blood Curse of Exposure/i,
	/Blood Curse of the Anxious/i,
	/Blood Curse of the Exorcist/i,
	/Blood Curse of the Eyeless/i,
	/Blood Curse of the Fallen Puppet/i,
	/Blood Curse of the Howl/i,
	/Blood Curse of the Marked/i,
	/Blood Curse of the Muddled Mind/i,
	/Blood Curse of the Souleater/i,
];

const CRIMSON_RITES = [
	/Rite of the Dead/i,
	/Rite of the Flame/i,
	/Rite of the Frozen/i,
	/Rite of the Oracle/i,
	/Rite of the Roar/i,
	/Rite of the Storm/i,
];

const BLOOD_HUNTER_FEATURES: FeatureCheck[] = [
	{
		level: 1,
		name: /hunter'?s bane/i,
		kind: "passive",
		effects: [
			{
				kind: "featureChoiceCalculation",
				className: "Blood Hunter",
				featureName: "Hunter's Bane",
				expectedChoice: "Wisdom",
				property: "hemocraftAbility",
				expectedValue: "wis",
				dcProperty: "hemocraftSaveDc",
			},
		],
	},
	{
		level: 1,
		name: /blood maledict/i,
		kind: "resource",
		resourceMax: [1, 4],
		restoreOn: "short",
		effects: [
			{kind: "bloodMaledictAmplification", hpCost: 2},
			{kind: "featureCalculation", property: "bloodMaledictUses", min: 1},
		],
	},
	{
		level: 1,
		name: /blood curse/i,
		kind: "pick",
		pickedCount: 1,
		pickedFrom: BLOOD_CURSES,
		effects: [{
			kind: "pickedFeatureGrants",
			pickName: /Blood Curse of Binding/i,
			subEffects: [{kind: "pickActivatable", matchAny: BLOOD_CURSES, min: 1}],
		}],
	},
	{
		level: 2,
		name: /fighting style/i,
		kind: "pick",
		pickedCount: 1,
		pickedFrom: [
			/archery/i, /blind fighting/i, /defense/i, /dueling/i,
			/great weapon fighting/i, /two-weapon fighting/i,
		],
		effects: [{
			kind: "pickedFeatureGrants",
			pickName: /archery/i,
			subEffects: [{kind: "modifierBonus", modType: "attack:ranged", min: 2}],
		}],
	},
	{
		level: 2,
		name: /crimson rite/i,
		kind: "passive",
		effects: [
			{kind: "crimsonRiteMechanics", hpCosts: [2, 3]},
			{kind: "featureCalculation", property: "hasCrimsonRite", exact: true},
		],
	},
	{
		level: 2,
		name: /rite of/i,
		kind: "pick",
		pickedCount: 1,
		pickedFrom: CRIMSON_RITES,
		effects: [{
			kind: "pickedFeatureGrants",
			pickName: /Rite of the Dead/i,
			subEffects: [{kind: "pickActivatable", matchAny: CRIMSON_RITES, min: 1}],
		}],
	},
	{
		level: 3,
		name: /heightened senses/i,
		kind: "passive",
		effects: [{kind: "featureCalculation", property: "hasHeightenedSenses", exact: true}],
	},
	{
		level: 3,
		name: /hybrid transformation/i,
		kind: "toggle",
		toggleDelta: "any",
		effects: [{kind: "hybridTransformationMechanics"}],
	},
	// no measurable derived effect: narrative constraints on spreading or curing lycanthropy.
	{level: 3, name: /onus of lycanthropy/i, kind: "passive"},
	// ASIs are auto-filled and do not have a deterministic target.
	{level: 4, name: /ability score improvement/i, kind: "passive"},
	{
		level: 5,
		name: /extra attack/i,
		kind: "passive",
		effects: [{kind: "featureCalculation", property: "attackCount", exact: 2}],
	},
	{
		level: 6,
		name: /blood maledict improvement/i,
		kind: "passive",
		effects: [{kind: "featureCalculation", property: "bloodMaledictUses", min: 2}],
	},
	{
		level: 6,
		name: /brand of castigation/i,
		kind: "passive",
		effects: [{kind: "featureCalculation", property: "brandDamage", min: 1}],
	},
	{
		level: 6,
		name: /blood curse/i,
		kind: "pick",
		pickedCount: 2,
		pickedFrom: BLOOD_CURSES,
		effects: [{kind: "featureCalculation", property: "bloodCursesKnown", min: 2}],
	},
	{
		level: 7,
		name: /crimson rite improvement/i,
		kind: "passive",
		effects: [{kind: "featureCalculation", property: "crimsonRitesKnown", min: 2}],
	},
	{
		level: 7,
		name: /rite of/i,
		kind: "pick",
		pickedCount: 2,
		pickedFrom: CRIMSON_RITES,
		effects: [{kind: "featureCalculation", property: "crimsonRitesKnown", min: 2}],
	},
	{
		level: 7,
		name: /stalker'?s prowess/i,
		kind: "passive",
		effects: [
			{kind: "speed", type: "walk", min: 40},
			{kind: "featureCalculation", property: "hybridAttackBonus", min: 1},
		],
	},
	{level: 8, name: /ability score improvement/i, kind: "passive"},
	{
		level: 9,
		name: /grim psychometry/i,
		kind: "passive",
		effects: [{kind: "featureCalculation", property: "hasGrimPsychometry", exact: true}],
	},
	{
		level: 10,
		name: /dark augmentation/i,
		kind: "passive",
		effects: [
			{kind: "speed", type: "walk", min: 45},
			{kind: "featureCalculation", property: "darkAugmentationSaveBonus", min: 1},
		],
	},
	{
		level: 10,
		name: /blood curse/i,
		kind: "pick",
		pickedCount: 3,
		pickedFrom: BLOOD_CURSES,
		effects: [{kind: "featureCalculation", property: "bloodCursesKnown", min: 3}],
	},
	{
		level: 11,
		untilLevel: 17,
		name: /advanced transformation/i,
		kind: "passive",
		effects: [
			{kind: "featureCalculation", property: "hybridTransformationUses", exact: 2},
			{kind: "featureCalculation", property: "hybridNaturalWeaponDamage", exact: "1d8"},
			{kind: "hybridTransformationMechanics"},
		],
	},
	{level: 12, name: /ability score improvement/i, kind: "passive"},
	{
		level: 13,
		name: /blood maledict improvement/i,
		kind: "passive",
		effects: [{kind: "featureCalculation", property: "bloodMaledictUses", min: 3}],
	},
	{
		level: 13,
		name: /brand of tethering/i,
		kind: "passive",
		effects: [
			{kind: "featureCalculation", property: "brandTetherDamage", exact: "4d6"},
			{kind: "featureCalculation", property: "brandTetherDc", min: 13},
		],
	},
	{
		level: 14,
		name: /hardened soul/i,
		kind: "passive",
		effects: [{kind: "featureCalculation", property: "hasHardenedSoul", exact: true}],
	},
	{
		level: 14,
		name: /crimson rite improvement/i,
		kind: "passive",
		effects: [{kind: "featureCalculation", property: "crimsonRitesKnown", exact: 3}],
	},
	{
		level: 14,
		name: /rite of/i,
		kind: "pick",
		pickedCount: 3,
		pickedFrom: CRIMSON_RITES,
		effects: [{kind: "featureCalculation", property: "crimsonRitesKnown", exact: 3}],
	},
	{
		level: 14,
		name: /blood curse/i,
		kind: "pick",
		pickedCount: 4,
		pickedFrom: BLOOD_CURSES,
		effects: [{kind: "featureCalculation", property: "bloodCursesKnown", min: 4}],
	},
	{
		level: 15,
		name: /brand of the voracious/i,
		kind: "passive",
		effects: [
			{kind: "featureCalculation", property: "hasBrandOfTheVoracious", exact: true},
			{kind: "hybridTransformationMechanics"},
		],
	},
	{level: 16, name: /ability score improvement/i, kind: "passive"},
	{
		level: 17,
		name: /blood maledict improvement/i,
		kind: "passive",
		effects: [{kind: "featureCalculation", property: "bloodMaledictUses", exact: 4}],
	},
	{
		level: 18,
		name: /hybrid transformation mastery/i,
		kind: "passive",
		effects: [
			{kind: "featureCalculation", property: "hasHybridTransformationMastery", exact: true},
			{kind: "featureCalculation", property: "grantsBloodCurseOfTheHowl", exact: true},
			{kind: "hybridTransformationMechanics"},
		],
	},
	{
		level: 18,
		name: /blood curse/i,
		kind: "pick",
		pickedCount: 5,
		pickedFrom: BLOOD_CURSES,
		effects: [{kind: "featureCalculation", property: "bloodCursesKnown", exact: 5}],
	},
	{level: 19, name: /ability score improvement|epic boon/i, kind: "passive"},
	{
		level: 20,
		name: /sanguine mastery/i,
		kind: "passive",
		effects: [{kind: "featureCalculation", property: "hasSanguineMastery", exact: true}],
	},
];

/**
 * BH2022 Order of the Lycan Blood Hunter — L1→20.
 *
 * Coverage focus:
 *   - Persisted Wisdom Hemocraft choice drives the derived save DC.
 *   - Blood Curse and Crimson Rite picks spend/restore uses and charge real HP.
 *   - Hybrid Transformation changes defenses, attacks, Bloodlust, and regeneration.
 *   - Crimson Rite can target multiple weapons and active-state Predatory Strikes.
 */
describeCharacter({
	preset: PRESET_FULL_LYCAN_BLOOD_HUNTER,
	displayName: "Order of the Lycan Blood Hunter Dwarf",
	skipL3: false,
	skipL5: false,
	skipL7: false,
	skipMega: false,
	midTierLoadout: [
		{name: "Cloak of Protection", source: "XDMG", attune: true},
		{name: "Longsword", equipped: true},
		{name: "Longbow", equipped: true},
	],
	signatureToggle: /hybrid transformation/i,
	signatureToggleAddsAttack: /predatory strike/i,
	usage: {
		atLevel: 7,
		useResourceName: "Blood Maledict",
		attackName: /longsword|longbow|predatory strike/i,
		skillRoll: {name: "Survival"},
		shortRestRestores: {resourceName: "Blood Maledict", expectAfter: 2},
		concentrationCheck: {skip: true}, // Blood Hunters have no concentration spellcasting.
		deathSaves: true,
		applyCondition: {name: "Poisoned"},
		featAbility: {skip: true}, // The preset does not pin an activatable feat.
	},
	milestones: {
		1: {totalLevel: 1, minMaxHp: 10, expectResources: {"Blood Maledict": 1}},
		3: {totalLevel: 3, minMaxHp: 24, expectToggles: [/hybrid transformation/i], expectResources: {"Hybrid Transformation": 1}},
		5: {totalLevel: 5, minMaxHp: 38, expectResources: {"Blood Maledict": 1}},
		11: {totalLevel: 11, minMaxHp: 80, expectResources: {"Blood Maledict": 2, "Hybrid Transformation": 2}},
		17: {totalLevel: 17, minMaxHp: 122, expectResources: {"Blood Maledict": 4}},
		20: {totalLevel: 20, minMaxHp: 143, expectToggles: [/hybrid transformation/i], expectResources: {"Blood Maledict": 4}},
	},
	featuresMatrix: BLOOD_HUNTER_FEATURES,
});
