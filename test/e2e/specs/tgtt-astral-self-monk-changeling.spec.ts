import {describeCharacter} from "../utils/characterSpecFactory";
import {PRESET_FULL_ASTRAL_SELF_MONK_CHANGELING} from "../utils/characterBuilder";
import type {FeatureCheck} from "../utils/comprehensiveBuildHelpers";
import {
	buildPreciseStrikeChecks,
	buildSpecialtyChecks,
} from "../utils/tgttFeaturePools";

const ASTRAL_SELF_MONK_FEATURES: FeatureCheck[] = [
	{
		level: 1,
		name: /martial arts/i,
		kind: "passive",
		effects: [
			{kind: "rollSavingThrow", ability: "str"},
			{kind: "martialArtsDie", minFaces: 6},
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
		name: /monk'?s focus|focus points/i,
		kind: "resource",
		resourceName: "Focus Points",
		minMax: 2,
		effects: [
			{kind: "rollAbilityCheck", ability: "wis"},
			{kind: "shortRestRestores", resource: "Focus Points"},
		],
	},
	{level: 2, name: /unarmored movement/i, kind: "passive", effects: [{kind: "speed", min: 30}]},
	{level: 2, name: /patient defense/i, kind: "toggle"},
	{level: 2, name: /step of the wind/i, kind: "toggle"},
	{level: 3, name: /deflect attacks/i, kind: "passive"},
	{level: 3, name: /forms of your astral self/i, kind: "passive"},
	{
		level: 3,
		name: /arms of the astral self/i,
		kind: "toggle",
		effects: [{kind: "toggleAddsAttack", namePattern: /astral arms/i}],
	},
	{level: 4, name: /slow fall/i, kind: "passive"},
	{level: 5, name: /extra attack/i, kind: "passive"},
	{level: 5, name: /stunning strike/i, kind: "toggle"},
	{level: 6, name: /empowered strikes/i, kind: "passive"},
	{
		level: 6,
		name: /visage of the astral self/i,
		kind: "toggle",
		effects: [{kind: "toggleGrantsAdvantage", rollType: "skill:insight"}],
	},
	{level: 7, name: /evasion/i, kind: "passive"},
	{level: 10, name: /self-restoration/i, kind: "passive"},
	{
		level: 11,
		name: /body of the astral self/i,
		kind: "passive",
		effects: [{kind: "martialArtsDie", minFaces: 10}],
	},
	{level: 14, name: /disciplined survivor/i, kind: "passive"},
	{
		level: 17,
		name: /awakened astral self/i,
		kind: "toggle",
		effects: [
			{kind: "togglePlusAc", whenActive: 2},
			{kind: "martialArtsDie", minFaces: 12},
		],
	},
	{level: 18, name: /superior defense/i, kind: "toggle"},
	{level: 20, name: /body and mind/i, kind: "toggle"},
	...buildSpecialtyChecks("Monk"),
	...buildPreciseStrikeChecks(),
];

describeCharacter({
	preset: PRESET_FULL_ASTRAL_SELF_MONK_CHANGELING,
	displayName: "Astral Self Monk Changeling",
	signatureToggle: /arms of the astral self/i,
	usage: {
		atLevel: 5,
		useResourceName: "Focus Points",
		skillRoll: {name: "Insight"},
		shortRestRestores: {resourceName: "Focus Points"},
		concentrationCheck: {skip: true},
		deathSaves: true,
		applyCondition: {skip: true},
		featAbility: {skip: true},
	},
	milestones: {
		1: {totalLevel: 1, minMaxHp: 8, acRange: [10, 20]},
		3: {totalLevel: 3, minMaxHp: 18, expectToggles: [/arms of the astral self/i]},
		5: {totalLevel: 5, minMaxHp: 30},
		11: {totalLevel: 11, minMaxHp: 60},
		17: {totalLevel: 17, minMaxHp: 90, expectToggles: [/awakened astral self/i]},
		20: {totalLevel: 20, minMaxHp: 100},
	},
	featuresMatrix: ASTRAL_SELF_MONK_FEATURES,
});
