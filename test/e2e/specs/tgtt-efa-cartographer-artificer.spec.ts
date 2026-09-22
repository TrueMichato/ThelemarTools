import {describeCharacter} from "../utils/characterSpecFactory";
import {PRESET_FULL_EFA_CARTOGRAPHER_ARTIFICER} from "../utils/characterBuilder";
import type {FeatureCheck} from "../utils/comprehensiveBuildHelpers";

/**
 * Artificer|EFA / Cartographer|EFA · Dwarf — L1→20.
 *
 * The same labels exist on older Artificer data, so every bespoke probe verifies
 * the exact EFA class/subclass owner and the exact XPHB spell source. Complex
 * transactions live in CharacterSheetPage.probeCartographerFlow; this spec stays
 * declarative and uses the shared factory for every build/lifecycle layer.
 */
const CARTOGRAPHER_FEATURES_MATRIX: FeatureCheck[] = [
	{
		level: 1,
		name: /spellcasting/i,
		kind: "passive",
		effects: [
			{kind: "spellSlots", level: 1, min: 2},
			{kind: "cantripCount", min: 2},
			{kind: "spellSaveDc", min: 12},
			{kind: "rollAbilityCheck", ability: "int"},
			{kind: "rollSavingThrow", ability: "int"},
			{kind: "rollSavingThrow", ability: "con"},
			{kind: "rollInitiative"},
		],
	},
	{
		level: 1,
		name: /tinker's magic/i,
		kind: "passive",
		effects: [
			{
				kind: "spellInList",
				spell: "Mending",
				level: 0,
				skip: true,
				skipReason: "CS-BUG-173: Tinker's Magic does not add its authored Mending|XPHB cantrip to the live spellbook",
			},
		],
	},
	{
		level: 2,
		untilLevel: 5,
		name: /replicate magic item/i,
		kind: "passive",
		effects: [
			{kind: "featureCalculation", property: "hasReplicateMagicItem", exact: true},
			{kind: "featureCalculation", property: "artificerPlansKnown", exact: 4},
			{kind: "featureCalculation", property: "artificerCreatedMagicItemsMax", exact: 2},
		],
	},
	{
		level: 6,
		untilLevel: 9,
		name: /replicate magic item/i,
		kind: "passive",
		effects: [
			{kind: "featureCalculation", property: "artificerPlansKnown", exact: 5},
			{kind: "featureCalculation", property: "artificerCreatedMagicItemsMax", exact: 3},
		],
	},
	{
		level: 10,
		untilLevel: 13,
		name: /replicate magic item/i,
		kind: "passive",
		effects: [
			{kind: "featureCalculation", property: "artificerPlansKnown", exact: 6},
			{kind: "featureCalculation", property: "artificerCreatedMagicItemsMax", exact: 4},
		],
	},
	{
		level: 14,
		untilLevel: 17,
		name: /replicate magic item/i,
		kind: "passive",
		effects: [
			{kind: "featureCalculation", property: "artificerPlansKnown", exact: 7},
			{kind: "featureCalculation", property: "artificerCreatedMagicItemsMax", exact: 5},
		],
	},
	{
		level: 18,
		name: /replicate magic item/i,
		kind: "passive",
		effects: [
			{kind: "featureCalculation", property: "artificerPlansKnown", exact: 8},
			{kind: "featureCalculation", property: "artificerCreatedMagicItemsMax", exact: 6},
		],
	},
	...([4, 8, 12, 16] as const).map((level, index) => ({
		level,
		name: /ability score improvement/i,
		kind: "passive" as const,
		effects: [{
			kind: "abilityScore" as const,
			ability: "str" as const,
			min: 10 + index * 2,
		}],
	})),
	{
		level: 19,
		name: /epic boon/i,
		kind: "passive",
		effects: [{kind: "cartographerProbe", probe: "progression"}],
	},

	{
		level: 3,
		name: /tools of the trade/i,
		kind: "passive",
		effects: [
			{kind: "cartographerProbe", probe: "tools"},
			{
				kind: "cartographerProbe",
				probe: "toolPersistence",
				skip: true,
				skipReason: "CS-BUG-175: fulfilled replacement-tool decisions reopen after save/load in the real Level Up flow",
			},
		],
	},
	{
		level: 3,
		name: /cartographer spells/i,
		kind: "passive",
		effects: [{kind: "cartographerProbe", probe: "spells", spellThreshold: 3}],
	},
	{
		level: 5,
		name: /cartographer spells/i,
		kind: "passive",
		effects: [{kind: "cartographerProbe", probe: "spells", spellThreshold: 5}],
	},
	{
		level: 9,
		name: /cartographer spells/i,
		kind: "passive",
		effects: [{kind: "cartographerProbe", probe: "spells", spellThreshold: 9}],
	},
	{
		level: 13,
		name: /cartographer spells/i,
		kind: "passive",
		effects: [{kind: "cartographerProbe", probe: "spells", spellThreshold: 13}],
	},
	{
		level: 17,
		name: /cartographer spells/i,
		kind: "passive",
		effects: [
			{kind: "cartographerProbe", probe: "spells", spellThreshold: 17},
			{kind: "cartographerProbe", probe: "lifecycle"},
			{
				kind: "cartographerProbe",
				probe: "lifecycleSpellCleanup",
			},
		],
	},
	{
		level: 3,
		name: /adventurer's atlas/i,
		kind: "passive",
		effects: [
			{kind: "featureCalculation", property: "hasAdventurersAtlas", exact: true},
			{kind: "featureCalculationDerivedFrom", property: "adventurersAtlasCapacity", equals: "abilityMod", ability: "int", offset: 1},
			{kind: "cartographerProbe", probe: "atlas"},
		],
	},
	{
		level: 3,
		name: /mapping magic/i,
		kind: "passive",
		effects: [
			{kind: "featureCalculation", property: "hasIlluminatedCartography", exact: true},
			{kind: "featureCalculationDerivedFrom", property: "illuminatedCartographyUses", equals: "abilityMod", ability: "int"},
			{kind: "featureCalculation", property: "hasPortalJump", exact: true},
			{kind: "cartographerProbe", probe: "mappingMagic"},
		],
	},
	{
		level: 5,
		name: /guided precision/i,
		kind: "passive",
		effects: [
			{kind: "featureCalculation", property: "hasGuidedPrecision", exact: true},
			{kind: "cartographerProbe", probe: "guidedPrecision"},
			{
				kind: "cartographerProbe",
				probe: "guidedPrecisionSpell",
				skip: true,
				skipReason: "CS-BUG-174: the live class catalog cannot resolve Cartographer additionalSpells for Guided Precision's spell route",
			},
		],
	},
	{
		level: 9,
		name: /ingenious movement/i,
		kind: "passive",
		effects: [
			{kind: "featureCalculation", property: "hasIngeniousMovement", exact: true},
			{kind: "featureCalculation", property: "ingeniousMovementRange", exact: 30},
			{kind: "cartographerProbe", probe: "ingeniousMovement"},
		],
	},
	{
		level: 15,
		name: /superior atlas/i,
		kind: "passive",
		effects: [
			{kind: "featureCalculation", property: "hasSuperiorAtlasSafeHaven", exact: true},
			{kind: "featureCalculation", property: "hasUnerringPath", exact: true},
			{kind: "cartographerProbe", probe: "superiorAtlas"},
		],
	},

	{
		level: 6,
		name: /magic item tinker/i,
		kind: "passive",
		effects: [{kind: "featureCalculation", property: "hasMagicItemTinker", exact: true}],
	},
	{
		level: 7,
		name: /flash of genius/i,
		kind: "resource",
		resourceMax: [1, 5],
		restoreOn: "long",
		effects: [
			{kind: "featureUsesEqualAbilityMod", feature: "Flash of Genius", ability: "int", minimum: 1, recharge: "long"},
			{kind: "featureCalculationDerivedFrom", property: "flashOfGeniusBonus", equals: "abilityMod", ability: "int"},
		],
	},
	{
		level: 10,
		untilLevel: 13,
		name: /magic item adept/i,
		kind: "passive",
		effects: [
			{kind: "featureCalculation", property: "hasMagicItemAdept", exact: true},
			{kind: "stateCall", method: "getMaxAttunement", exact: 4},
		],
	},
	{
		level: 11,
		name: /spell-storing item/i,
		kind: "passive",
		effects: [
			{kind: "featureCalculation", property: "hasSpellStoringItem", exact: true},
			{kind: "featureCalculation", property: "spellStoringItemUses", min: 2},
		],
	},
	{
		level: 14,
		untilLevel: 17,
		name: /advanced artifice/i,
		kind: "passive",
		effects: [
			{kind: "featureCalculation", property: "hasAdvancedArtifice", exact: true},
			{kind: "featureCalculation", property: "hasRefreshedGenius", exact: true},
			{kind: "stateCall", method: "getMaxAttunement", exact: 5},
		],
	},
	{
		level: 18,
		name: /magic item master/i,
		kind: "passive",
		effects: [
			{kind: "featureCalculation", property: "hasMagicItemMaster", exact: true},
			{kind: "stateCall", method: "getMaxAttunement", exact: 6},
		],
	},
	{
		level: 20,
		name: /soul of artifice/i,
		kind: "passive",
		effects: [
			{kind: "featureCalculation", property: "hasEfaSoulOfArtifice", exact: true},
			{kind: "featureCalculation", property: "hasMagicalGuidance", exact: true},
		],
	},
];

describeCharacter({
	preset: PRESET_FULL_EFA_CARTOGRAPHER_ARTIFICER,
	displayName: "EFA Cartographer Artificer Dwarf",
	signatureToggleSkip: {
		skip: true,
		reason: "Cartographer features are transactional abilities, riders, and rest actions; the subclass has no persistent L5 toggle",
	},
	midTierLoadout: [
		{name: "Dagger", source: "XPHB", equipped: true},
		{name: "Cloak of Protection", source: "XDMG", attune: true},
	],
	usage: {
		atLevel: 7,
		castSpellSlotLevel: 1,
		useResourceName: "Flash of Genius",
		expectLongRestRestores: true,
		attackName: /dagger/i,
		skillRoll: {name: "Arcana", expectBonusAtLeast: 3},
		shortRestRestores: {
			skip: true,
			reason: "Flash of Genius is Long-Rest-only until Advanced Artifice at Artificer 14; the USE build stops at 7",
		},
		concentrationCheck: {castSpell: "Faerie Fire", thenAction: "damage", expectActive: false},
		deathSaves: true,
		applyCondition: {name: "Poisoned", expectEffect: "disadvantage"},
		featAbility: {
			skip: true,
			reason: "The build has no independent on-sheet feat toggle for the generic USE surface; ASI application and Epic Boon selection/effects are asserted in the matrix",
		},
	},
	megaCheckpoints: [3, 4, 5, 7, 8, 9, 12, 13, 15, 16, 17, 19, 20],
	featureMatrixDedicatedOnly: true,
	milestones: {
		1: {totalLevel: 1, spellSlots: {1: 2}},
		3: {totalLevel: 3, spellSlots: {1: 3}, features: [/Tools of the Trade/i, /Adventurer's Atlas/i, /Mapping Magic/i]},
		5: {totalLevel: 5, spellSlots: {1: 4, 2: 2}, features: [/Guided Precision/i]},
		7: {totalLevel: 7, spellSlots: {1: 4, 2: 3}, features: [/Flash of Genius/i]},
		9: {totalLevel: 9, spellSlots: {1: 4, 2: 3, 3: 2}, features: [/Ingenious Movement/i]},
		13: {totalLevel: 13, spellSlots: {1: 4, 2: 3, 3: 3, 4: 1}},
		15: {totalLevel: 15, spellSlots: {1: 4, 2: 3, 3: 3, 4: 2}, features: [/Superior Atlas/i]},
		17: {totalLevel: 17, spellSlots: {1: 4, 2: 3, 3: 3, 4: 3, 5: 1}},
		20: {totalLevel: 20, spellSlots: {1: 4, 2: 3, 3: 3, 4: 3, 5: 2}, features: [/Soul of Artifice/i]},
	},
	featuresMatrix: CARTOGRAPHER_FEATURES_MATRIX,
});
