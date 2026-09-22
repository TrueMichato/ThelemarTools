import {describeCharacter} from "../utils/characterSpecFactory";
import {PRESET_FULL_EFA_REANIMATOR_ARTIFICER} from "../utils/characterBuilder";
import type {EffectCheck, FeatureCheck} from "../utils/comprehensiveBuildHelpers";

const CLASS_UID = "Artificer|EFA";
const SUBCLASS_UID = "Reanimator|Artificer|EFA|RHW";
const COMPANION_OWNER_UID = "Reanimated Companion|Artificer|EFA|Reanimator|RHW|3|RHW";
const REFINED_OWNER_UID = "Refined Reanimation|Artificer|EFA|Reanimator|RHW|15|RHW";

const sourceQualifiedFeature = (name: string, level: number): EffectCheck => ({
	kind: "sourceQualifiedFeature",
	uid: `${name}|Artificer|EFA|Reanimator|RHW|${level}|RHW`,
	excludedUids: [
		`${name}|Artificer|TCE|Reanimator|TCE|${level}|TCE`,
		`${name}|Artificer|EFA|Reanimator|TCE|${level}|TCE`,
	],
});

const exactSpell = (spell: string): EffectCheck => ({
	kind: "spellInList",
	spell,
	source: "XPHB",
});

const REANIMATOR_SPELL_GRANTS = [
	{name: "False Life", source: "XPHB", level: 3},
	{name: "Spare the Dying", source: "XPHB", level: 3},
	{name: "Witch Bolt", source: "XPHB", level: 3},
	{name: "Blindness/Deafness", source: "XPHB", level: 5},
	{name: "Enhance Ability", source: "XPHB", level: 5},
	{name: "Animate Dead", source: "XPHB", level: 9},
	{name: "Lightning Bolt", source: "XPHB", level: 9},
	{name: "Blight", source: "XPHB", level: 13},
	{name: "Death Ward", source: "XPHB", level: 13},
	{name: "Antilife Shell", source: "XPHB", level: 17},
	{name: "Raise Dead", source: "XPHB", level: 17},
] as const;

const REANIMATOR_FEATURES: FeatureCheck[] = [
	{
		level: 3,
		name: /^reanimator spells$/i,
		kind: "spells",
		grantsSpells: ["False Life", "Spare the Dying", "Witch Bolt"],
		effects: [
			sourceQualifiedFeature("Reanimator Spells", 3),
			...REANIMATOR_SPELL_GRANTS.slice(0, 3).map(({name}) => exactSpell(name)),
			{kind: "featureCalculation", property: "hasReanimatorSpells", exact: true},
		],
	},
	{
		level: 5,
		name: /^reanimator spells$/i,
		kind: "spells",
		grantsSpells: ["Blindness/Deafness", "Enhance Ability"],
		effects: [
			exactSpell("Blindness/Deafness"),
			exactSpell("Enhance Ability"),
		],
	},
	{
		level: 9,
		name: /^reanimator spells$/i,
		kind: "spells",
		grantsSpells: ["Animate Dead", "Lightning Bolt"],
		effects: [
			exactSpell("Animate Dead"),
			exactSpell("Lightning Bolt"),
		],
	},
	{
		level: 13,
		name: /^reanimator spells$/i,
		kind: "spells",
		grantsSpells: ["Blight", "Death Ward"],
		effects: [
			exactSpell("Blight"),
			exactSpell("Death Ward"),
		],
	},
	{
		level: 17,
		name: /^reanimator spells$/i,
		kind: "spells",
		grantsSpells: ["Antilife Shell", "Raise Dead"],
		effects: [
			exactSpell("Antilife Shell"),
			exactSpell("Raise Dead"),
		],
	},
	{
		level: 3,
		untilLevel: 10,
		name: /^reanimator's skill set$/i,
		kind: "passive",
		effects: [
			sourceQualifiedFeature("Reanimator's Skill Set", 3),
			{
				kind: "toolProficiencies",
				includes: ["Alchemist's Supplies"],
				feature: {
					name: "Reanimator's Skill Set",
					source: "RHW",
					className: "Artificer",
					classSource: "EFA",
					subclassName: "Reanimator",
					subclassSource: "RHW",
					level: 3,
				},
				excludedFeatureSources: ["TCE"],
				conditionalGrantKey: "Alchemist's Supplies",
			},
			{kind: "featureCalculation", property: "hasJoltToLife", exact: true},
			{kind: "stateCall", method: "getFeatureCalculations", path: "joltToLife.damage", exact: "2d4"},
			{kind: "stateCall", method: "getFeatureCalculations", path: "joltToLife.healing", min: 3},
			{kind: "stateCall", method: "getFeatureCalculations", path: "joltToLife.uses", exact: 2},
		],
	},
	{
		level: 11,
		untilLevel: 16,
		name: /^reanimator's skill set$/i,
		kind: "passive",
		effects: [
			{kind: "stateCall", method: "getFeatureCalculations", path: "joltToLife.damage", exact: "3d4"},
			{kind: "stateCall", method: "getFeatureCalculations", path: "joltToLife.healing", min: 11},
		],
	},
	{
		level: 17,
		name: /^reanimator's skill set$/i,
		kind: "passive",
		effects: [
			{kind: "stateCall", method: "getFeatureCalculations", path: "joltToLife.damage", exact: "4d4"},
			{kind: "stateCall", method: "getFeatureCalculations", path: "joltToLife.healing", min: 17},
		],
	},
	{
		level: 3,
		untilLevel: 4,
		name: /^reanimated companion$/i,
		kind: "passive",
		effects: [
			sourceQualifiedFeature("Reanimated Companion", 3),
			{kind: "featureCalculation", property: "hasReanimatedCompanionOwnership", exact: true},
			{kind: "stateCall", method: "getFeatureCalculations", path: "reanimatedCompanion.ownerUid", exact: COMPANION_OWNER_UID},
			{kind: "stateCall", method: "getFeatureCalculations", path: "reanimatedCompanion.companionUid", exact: "Reanimated Companion|RHW"},
			{kind: "rhwReanimatorProbe", probe: "l3Lifecycle"},
		],
	},
	{
		level: 5,
		untilLevel: 8,
		name: /^strange modifications$/i,
		kind: "passive",
		effects: [
			sourceQualifiedFeature("Strange Modifications", 5),
			{kind: "featureCalculation", property: "hasStrangeModifications", exact: true},
			{kind: "featureCalculation", property: "reanimatorModificationCount", exact: 1},
			{kind: "rhwReanimatorProbe", probe: "arcaneConduit"},
		],
	},
	{
		level: 9,
		untilLevel: 14,
		name: /^improved reanimation$/i,
		kind: "passive",
		effects: [
			sourceQualifiedFeature("Improved Reanimation", 9),
			{kind: "featureCalculation", property: "hasImprovedReanimation", exact: true},
			{kind: "rhwReanimatorProbe", probe: "macabreModifications"},
		],
	},
	{
		level: 9,
		untilLevel: 14,
		name: /^macabre modifications$/i,
		kind: "passive",
		effects: [
			sourceQualifiedFeature("Macabre Modifications", 9),
			{kind: "featureCalculation", property: "hasMacabreModifications", exact: true},
			{kind: "featureCalculation", property: "reanimatorModificationCount", exact: 2},
		],
	},
	{
		level: 15,
		name: /^refined reanimation$/i,
		kind: "passive",
		effects: [
			sourceQualifiedFeature("Refined Reanimation", 15),
			{kind: "featureCalculation", property: "hasRefinedReanimation", exact: true},
			{kind: "featureCalculation", property: "hasSuperiorModifications", exact: true},
			{kind: "featureCalculation", property: "reanimatorModificationCount", exact: 3},
			{kind: "stateCall", method: "getFeatureCalculations", path: "facilitatedRevival.featureUid", exact: REFINED_OWNER_UID},
			{kind: "stateCall", method: "getFeatureCalculations", path: "lifeTransfer.featureUid", exact: REFINED_OWNER_UID},
			{kind: "rhwReanimatorProbe", probe: "refinedReanimation"},
		],
	},
	{
		level: 20,
		name: /^refined reanimation$/i,
		kind: "passive",
		effects: [
			{kind: "rhwReanimatorProbe", probe: "roundTripRespec"},
			{
				kind: "sourceQualifiedRoundTrip",
				className: "Artificer",
				classSource: "EFA",
				subclassName: "Reanimator",
				subclassSource: "RHW",
				featureUids: [
					{uid: "Reanimator Spells|Artificer|EFA|Reanimator|RHW|3|RHW", level: 3},
					{uid: "Reanimator's Skill Set|Artificer|EFA|Reanimator|RHW|3|RHW", level: 3},
					{uid: "Reanimated Companion|Artificer|EFA|Reanimator|RHW|3|RHW", level: 3},
					{uid: "Strange Modifications|Artificer|EFA|Reanimator|RHW|5|RHW", level: 5},
					{uid: "Improved Reanimation|Artificer|EFA|Reanimator|RHW|9|RHW", level: 9},
					{uid: "Macabre Modifications|Artificer|EFA|Reanimator|RHW|9|RHW", level: 9},
					{uid: "Refined Reanimation|Artificer|EFA|Reanimator|RHW|15|RHW", level: 15},
				],
				spellGrants: REANIMATOR_SPELL_GRANTS.filter(({name}) => name !== "Spare the Dying"),
				spellGrantSourceFeature: "Reanimator Spells",
				incompatibleSubclassSources: ["TCE"],
			},
		],
	},
];

describeCharacter({
	preset: PRESET_FULL_EFA_REANIMATOR_ARTIFICER,
	displayName: "EFA RHW Reanimator Artificer",
	midTierTimeoutMs: 300_000,
	megaTimeoutMs: 900_000,
	signatureToggleSkip: {
		skip: true,
		reason: "Reanimator mechanics are companion transactions and reactions, not a persistent L5 stance",
	},
	midTierLoadout: [
		{name: "Dagger", source: "XPHB", equipped: true},
		{name: "Tinker's Tools", source: "XPHB", equipped: true},
	],
	usage: {
		atLevel: 5,
		castSpellSlotLevel: 1,
		useResourceName: "Jolt to Life",
		attackName: /dagger/i,
		expectLongRestRestores: true,
		skillRoll: {name: "Arcana", expectBonusAtLeast: 2},
		shortRestRestores: {
			skip: true,
			reason: "Jolt to Life and companion creation recharge on a Long Rest, not a Short Rest",
		},
		concentrationCheck: {castSpell: "Enhance Ability", thenAction: "damage", expectActive: false},
		deathSaves: true,
		applyCondition: {name: "poisoned"},
		featAbility: {
			skip: true,
			reason: "The deterministic Reanimator build takes ASIs and no active feat",
		},
	},
	milestones: {
		1: {totalLevel: 1, proficiencyBonus: 2, spellSlots: {1: 2}},
		3: {
			totalLevel: 3,
			proficiencyBonus: 2,
			spellSlots: {1: 3},
			expectResources: {"Jolt to Life": 1},
		},
		5: {
			totalLevel: 5,
			proficiencyBonus: 3,
			spellSlots: {1: 4, 2: 2},
			expectResources: {"Jolt to Life": 1},
		},
		9: {
			totalLevel: 9,
			proficiencyBonus: 4,
			spellSlots: {1: 4, 2: 3, 3: 2},
			expectResources: {"Jolt to Life": 1},
		},
		15: {
			totalLevel: 15,
			proficiencyBonus: 5,
			spellSlots: {1: 4, 2: 3, 3: 3, 4: 2},
			expectResources: {"Jolt to Life": 1, "Facilitated Revival": 1},
		},
		17: {
			totalLevel: 17,
			proficiencyBonus: 6,
			spellSlots: {1: 4, 2: 3, 3: 3, 4: 3, 5: 1},
			expectResources: {"Jolt to Life": 1, "Facilitated Revival": 1},
		},
		20: {
			totalLevel: 20,
			proficiencyBonus: 6,
			spellSlots: {1: 4, 2: 3, 3: 3, 4: 3, 5: 2},
			expectResources: {"Jolt to Life": 1, "Facilitated Revival": 1},
		},
	},
	megaCheckpoints: [3, 5, 9, 11, 13, 15, 17, 20],
	featureMatrixDedicatedOnly: true,
	featuresMatrix: REANIMATOR_FEATURES,
	prepareFinalExport: charSheet => charSheet.prepareRhwReanimatorExportArtifact(),
});

/**
 * Comprehensive standard mapping:
 *  #1 L1 factory build; #2 L3 exact RHW subclass, tool provenance, creation UI,
 *  Manager/Play surfaces, companion formulas and lifecycle; #3 L5 immutable
 *  Strange Modification and Arcane Conduit receipt/reset; #4 Dagger/tool
 *  loadout; #5 explicit no-stance skip; #6 milestone walk includes every
 *  subclass spell/modification tier; #7 slot spend; #8 Jolt to Life spend;
 *  #9 Dagger attack; #10 Long Rest restores slots and Reanimator resources;
 *  #11 Arcana roll; #12 explicit Long-Rest-only resource skip; #13 Enhance
 *  Ability concentration; #14 death saves; #15 poisoned condition; #16
 *  explicit no-active-feat skip; #17 final automatic export fixture and
 *  source-qualified round-trip; #18 N/A single-class; #19 N/A no Specialty;
 *  #20 N/A EFA Artificer has no XPHB Weapon Mastery picker; #21 immutable
 *  Strange/Macabre/Superior picks are probed at L5/L9/L15; #22 every row has
 *  one or more mechanical EffectChecks.
 */
