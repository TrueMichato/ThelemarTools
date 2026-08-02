import {describeCharacter} from "../utils/characterSpecFactory";
import {PRESET_FULL_ASTRAL_SELF_MONK_CHANGELING} from "../utils/characterBuilder";
import type {FeatureCheck} from "../utils/comprehensiveBuildHelpers";
import {
	buildCombatMethodChecks,
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
		name: /monk'?s focus/i,
		kind: "passive",
		effects: [{kind: "rollAbilityCheck", ability: "wis"}],
	},
	{
		level: 3,
		name: "Focus Points",
		kind: "resource",
		// CS-BUG-018 is Fixed/superseded (see known-bugs.md), so this skip was
		// stale and left the Monk's core resource unasserted. Focus Points equal
		// the Monk level, so each matrix checkpoint needs its own tier —
		// `untilLevel` stops an earlier entry firing once the pool has grown
		// (this is the CS-BUG-035 pattern).
		untilLevel: 4,
		resourceMax: 3,
		effects: [{kind: "shortRestRestores", resource: "Focus Points"}],
	},
	{level: 5, name: "Focus Points", kind: "resource", untilLevel: 10, resourceMax: 5},
	{level: 11, name: "Focus Points", kind: "resource", untilLevel: 16, resourceMax: 11},
	{level: 17, name: "Focus Points", kind: "resource", untilLevel: 19, resourceMax: 17},
	{level: 20, name: "Focus Points", kind: "resource", resourceMax: 20},
	{level: 2, name: /unarmored movement/i, kind: "passive", effects: [{kind: "speed", min: 30}]},
	{level: 3, name: /deflect attacks/i, kind: "passive"},
	{level: 3, name: /forms of your astral self/i, kind: "passive"},
	{
		level: 17,
		name: /awakened astral self/i,
		kind: "toggle",
		effects: [
			{kind: "togglePlusAc", whenActive: 2},
			{kind: "martialArtsDie", minFaces: 12},
		],
	},
	{
		level: 3,
		name: /arms of the astral self/i,
		kind: "toggle",
		toggleDelta: "none",
		effects: [{kind: "toggleAddsAttack", namePattern: /astral arms/i}],
	},
	{level: 4, name: /slow fall/i, kind: "passive"},
	{level: 5, name: /extra attack/i, kind: "passive"},
	{level: 5, name: /stunning strike/i, kind: "passive"},
	{level: 6, name: /empowered strikes/i, kind: "passive"},
	{
		level: 6,
		name: /visage of the astral self/i,
		kind: "toggle",
		toggleDelta: "none",
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
	{level: 18, name: /superior defense/i, kind: "passive"},
	{level: 20, name: /body and mind/i, kind: "passive"},
	...buildSpecialtyChecks("Monk").slice(0, 1),
	// Combat Methods — count-based ladder through the product's own
	// structural API. Monk's "Methods Known" column reads 0 at L1, so the
	// first milestone is L2. Astral Self additionally GRANTS one method at
	// L3 ("you learn one additional method from this tradition"), which the
	// subclass-grant table folds into the expected totals — without it the
	// ladder is one short at every level from 3 on.
	...buildCombatMethodChecks("Monk", {subclassName: "Astral Self"}),
];

describeCharacter({
	preset: PRESET_FULL_ASTRAL_SELF_MONK_CHANGELING,
	displayName: "Astral Self Monk Changeling",
	signatureToggle: /arms of the astral self/i,
	signatureToggleAddsAttack: /astral arms/i,
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
