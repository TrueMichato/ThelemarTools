import {describeCharacter} from "../utils/characterSpecFactory";
import {PRESET_FULL_SUN_SOUL_MONK_CHANGELING} from "../utils/characterBuilder";
import type {FeatureCheck} from "../utils/comprehensiveBuildHelpers";
import {buildSpecialtyChecks} from "../utils/tgttFeaturePools";

const SUN_SOUL_MONK_FEATURES: FeatureCheck[] = [
	{
		level: 1,
		name: /martial arts/i,
		kind: "passive",
		effects: [
			{kind: "martialArtsDie", minFaces: 6},
			{kind: "rollSavingThrow", ability: "str"},
		],
	},
	{
		level: 1,
		name: /unarmored defense/i,
		kind: "passive",
		effects: [{kind: "rollSavingThrow", ability: "dex"}],
	},
	{
		level: 2,
		name: /monk'?s focus/i,
		kind: "passive",
		effects: [{kind: "rollAbilityCheck", ability: "wis"}],
	},
	{
		level: 2,
		name: /unarmored movement/i,
		kind: "passive",
		effects: [{kind: "speed", min: 40}],
	},
	// no measurable derived effect: restores Focus Points when initiative is rolled.
	{level: 2, name: /uncanny metabolism/i, kind: "passive"},
	{
		level: 3,
		untilLevel: 4,
		name: "Focus Points",
		kind: "resource",
		resourceMax: 3,
		restoreOn: "short",
		effects: [{kind: "shortRestRestores", resource: "Focus Points"}],
	},
	{level: 5, untilLevel: 10, name: "Focus Points", kind: "resource", resourceMax: 5},
	{level: 11, untilLevel: 16, name: "Focus Points", kind: "resource", resourceMax: 11},
	{level: 17, untilLevel: 19, name: "Focus Points", kind: "resource", resourceMax: 17},
	{level: 20, name: "Focus Points", kind: "resource", resourceMax: 20},
	// no measurable derived effect: reaction damage reduction is target-roll dependent.
	{level: 3, name: /deflect attacks/i, kind: "passive"},
	// no measurable derived effect: the ASI result depends on the wizard's selected abilities.
	{level: 4, name: /ability score improvement/i, kind: "passive"},
	// no measurable derived effect: fall-distance damage is not represented as a persistent stat.
	{level: 4, name: /slow fall/i, kind: "passive"},
	{
		level: 5,
		name: /extra attack/i,
		kind: "passive",
		effects: [
			{kind: "rollInitiative"},
			{kind: "martialArtsDie", minFaces: 8},
		],
	},
	// no measurable derived effect: the stun rider requires a target saving throw.
	{level: 5, name: /stunning strike/i, kind: "passive"},
	// no measurable derived effect: this changes damage typing contextually.
	{level: 6, name: /empowered strikes/i, kind: "passive"},
	// no measurable derived effect: Evasion modifies resolved area-save damage.
	{level: 7, name: /evasion/i, kind: "passive"},
	// no measurable derived effect: the improvement applies to action economy.
	{level: 10, name: /heightened focus/i, kind: "passive"},
	// no measurable derived effect: condition removal is turn-event driven.
	{level: 10, name: /self.restoration/i, kind: "passive"},
	// no measurable derived effect: this changes Deflect Attacks damage typing.
	{level: 13, name: /deflect energy/i, kind: "passive"},
	{
		level: 14,
		name: /disciplined survivor/i,
		kind: "passive",
		effects: [{kind: "saveBonus", ability: "int", min: 1}],
	},
	// no measurable derived effect: only changes the initiative-start Focus Point floor.
	{level: 15, name: /perfect focus/i, kind: "passive"},
	// no measurable derived effect: costs Focus Points and modifies incoming damage.
	{level: 18, name: /superior defense/i, kind: "passive"},
	// no measurable derived effect: selected Epic Boon varies with wizard auto-fill.
	{level: 19, name: /ability score improvement|epic boon/i, kind: "passive"},
	{
		level: 20,
		name: /body and mind/i,
		kind: "passive",
		effects: [
			{kind: "featureCalculation", property: "bodyAndMindDexBonus", exact: 4},
			{kind: "featureCalculation", property: "bodyAndMindWisBonus", exact: 4},
		],
	},

	...buildSpecialtyChecks("Monk"),

	{
		level: 3,
		name: /radiant sun bolt/i,
		kind: "passive",
		effects: [
			{kind: "attackPresent", namePattern: /radiant sun bolt/i},
			{
				kind: "grantedAttack",
				name: "Radiant Sun Bolt",
				damageType: "radiant",
				range: "30 ft.",
				isSpellAttack: true,
				usesMartialArtsDie: true,
			},
			{kind: "rollAttack", attackName: /radiant sun bolt/i},
			{kind: "attackQualifiesThisTurn", attackName: /radiant sun bolt/i, sourceFeature: "Radiant Sun Bolt"},
			{
				kind: "combatFeatureAction",
				feature: "Radiant Sun Bolt",
				resource: "Focus Points",
				spend: 1,
				qualifyingAttackSourceFeature: "Radiant Sun Bolt",
				expectVariableSpend: false,
				expectAttackCount: 2,
			},
		],
	},
	{
		level: 3,
		untilLevel: 4,
		name: /radiant sun bolt/i,
		kind: "passive",
		effects: [{kind: "grantedAttack", name: "Radiant Sun Bolt", damage: "1d6"}],
	},
	{
		level: 5,
		untilLevel: 10,
		name: /radiant sun bolt/i,
		kind: "passive",
		effects: [{kind: "grantedAttack", name: "Radiant Sun Bolt", damage: "1d8"}],
	},
	{
		level: 11,
		untilLevel: 16,
		name: /radiant sun bolt/i,
		kind: "passive",
		effects: [{kind: "grantedAttack", name: "Radiant Sun Bolt", damage: "1d10"}],
	},
	{
		level: 17,
		name: /radiant sun bolt/i,
		kind: "passive",
		effects: [{kind: "grantedAttack", name: "Radiant Sun Bolt", damage: "1d12"}],
	},
	{
		level: 6,
		name: /searing arc strike/i,
		kind: "passive",
		effects: [
			{kind: "featureCalculation", property: "searingArcStrikeDc", min: 12},
			{
				kind: "combatFeatureAction",
				feature: "Searing Arc Strike",
				resource: "Focus Points",
				spend: 3,
				qualifyingAttackSourceFeature: "Radiant Sun Bolt",
				expectVariableSpend: true,
				expectSaveDamage: {saveAbility: "dex", damage: "4d6", damageType: "fire"},
			},
		],
	},
	{
		level: 11,
		name: /searing sunburst/i,
		kind: "passive",
		effects: [
			{kind: "featureCalculation", property: "searingSunburstRange", exact: 150},
			{kind: "featureCalculation", property: "searingSunburstRadius", exact: 20},
			{
				kind: "combatFeatureAction",
				feature: "Searing Sunburst",
				resource: "Focus Points",
				spend: 2,
				expectVariableSpend: true,
				expectSaveDamage: {saveAbility: "con", damage: "6d6", damageType: "radiant"},
			},
		],
	},
	{
		level: 17,
		name: /sun shield/i,
		kind: "toggle",
		toggleDelta: "none",
		effects: [
			{
				kind: "activeStateTrigger",
				feature: "Sun Shield",
				stateTypeId: "sunShield",
				label: "Retaliate",
				actionType: "reaction",
				damageType: "radiant",
				damageMin: 5,
			},
			{kind: "featureCalculation", property: "sunShieldBrightLightRange", exact: 30},
			{kind: "featureCalculation", property: "sunShieldDimLightRange", exact: 60},
			// blocked by CS-BUG-036: the calculations are correct, but no active-state/UI light effect exists.
			{
				kind: "activeStateLight",
				feature: "Sun Shield",
				stateTypeId: "sunShield",
				bright: 30,
				dim: 60,
				skip: true,
				skipReason: "CS-BUG-036",
			},
		],
	},
];

describeCharacter({
	preset: PRESET_FULL_SUN_SOUL_MONK_CHANGELING,
	displayName: "Sun Soul Monk Changeling",
	midTierLoadout: [{name: "Quarterstaff", equipped: true}],
	signatureToggleSkip: {
		skip: true,
		reason: "Sun Soul's only true toggle is Sun Shield at L17; Radiant Sun Bolt is an always-granted attack",
	},
	usage: {
		atLevel: 6,
		useResourceName: "Focus Points",
		attackName: /radiant sun bolt/i,
		skillRoll: {name: "Insight"},
		shortRestRestores: {resourceName: "Focus Points", expectAfter: 6},
		concentrationCheck: {skip: true}, // Monks have no concentration spell in this build.
		deathSaves: true,
		applyCondition: {name: "poisoned"},
		featAbility: {skip: true}, // The build does not take a toggleable feat.
	},
	milestones: {
		1: {totalLevel: 1, minMaxHp: 8, acRange: [10, 20]},
		3: {totalLevel: 3, minMaxHp: 18},
		5: {totalLevel: 5, minMaxHp: 30, expectResources: {"Focus Points": 5}},
		11: {totalLevel: 11, minMaxHp: 60, expectResources: {"Focus Points": 11}},
		17: {totalLevel: 17, minMaxHp: 90, expectResources: {"Focus Points": 17}, expectToggles: [/sun shield/i]},
		20: {totalLevel: 20, minMaxHp: 100, expectResources: {"Focus Points": 20}},
	},
	featuresMatrix: SUN_SOUL_MONK_FEATURES,
});
