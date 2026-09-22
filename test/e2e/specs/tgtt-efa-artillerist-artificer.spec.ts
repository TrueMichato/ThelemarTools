import {describeCharacter} from "../utils/characterSpecFactory";
import {PRESET_FULL_EFA_ARTILLERIST_ARTIFICER} from "../utils/characterBuilder";
import type {FeatureCheck} from "../utils/comprehensiveBuildHelpers";

// EFA Ability Score Improvement and Epic Boon decisions are intentionally not
// listed as feature-card checks: their choices persist in level history, but
// they do not render stable generic feature rows for the matrix to match.
const EFA_ARTILLERIST_FEATURES: FeatureCheck[] = [
	{
		level: 1,
		name: /^spellcasting$/i,
		kind: "passive",
		effects: [
			{kind: "spellSlots", level: 1, min: 2},
			{kind: "cantripCount", min: 2},
			{kind: "spellSaveDc", min: 12},
			{kind: "rollSavingThrow", ability: "con"},
			{kind: "rollSavingThrow", ability: "int"},
			{kind: "rollAbilityCheck", ability: "int"},
			{kind: "rollInitiative"},
		],
	},
	{
		level: 1,
		name: /tinker's magic/i,
		kind: "passive",
		effects: [
			{kind: "featureUsesEqualAbilityMod", feature: "Tinker's Magic", ability: "int", minimum: 1, recharge: "long"},
		],
	},
	{
		level: 2,
		name: /replicate magic item/i,
		kind: "passive",
		effects: [
			{kind: "featureCalculation", property: "hasReplicateMagicItem", exact: true},
			{kind: "featureCalculation", property: "artificerPlansKnown", min: 4},
			{kind: "featureCalculation", property: "artificerCreatedMagicItemsMax", min: 2},
			{kind: "stateCall", method: "getEfaReplicateMagicItemProductionOptions", path: "available", exact: false},
			{kind: "stateCall", method: "getEfaReplicateMagicItemProductionOptions", path: "unavailableReason", contains: "Equip Tinker's Tools"},
		],
	},
	{
		level: 3,
		name: /tools of the trade/i,
		kind: "passive",
		effects: [
			{kind: "featureCalculation", property: "hasArtilleristMartialRangedWeaponProficiency", exact: true},
			{kind: "featureCalculation", property: "wandCraftingTimeMultiplier", exact: 0.5},
		],
	},
	{
		level: 3,
		name: /artillerist spells/i,
		kind: "spells",
		grantsSpells: ["Shield", "Thunderwave"],
		effects: [
			{kind: "spellInList", spell: "Shield"},
			{kind: "spellInList", spell: "Thunderwave"},
		],
	},
	{
		level: 3,
		name: /^eldritch cannon$/i,
		kind: "resource",
		resourceName: "Eldritch Cannon Creation",
		resourceMax: 1,
		restoreOn: "long",
		effects: [
			{kind: "featureCalculation", property: "hasEldritchCannon", exact: true},
			{kind: "featureCalculation", property: "eldritchCannonHp", min: 15},
			{kind: "featureCalculation", property: "flamethrowerDamage", exact: "2d8"},
			{kind: "featureCalculation", property: "forceBallistaDamage", exact: "2d8"},
			{kind: "featureCalculation", property: "protectorTempHpDice", exact: "1d8"},
			{kind: "stateCall", method: "getEfaEldritchCannonCreationState", path: "available", exact: true},
			{kind: "efaArtilleristProbe", probe: "baseCannon"},
		],
		untilLevel: 8,
	},
	{
		level: 5,
		name: /^arcane firearm$/i,
		kind: "passive",
		effects: [
			{kind: "featureCalculation", property: "hasArcaneFirearm", exact: true},
			{kind: "featureCalculation", property: "arcaneFirearmDamage", exact: "1d8"},
			{kind: "efaArtilleristProbe", probe: "arcaneFirearm"},
		],
		untilLevel: 8,
	},
	{
		level: 5,
		name: /artillerist spells/i,
		kind: "spells",
		grantsSpells: ["Scorching Ray", "Shatter"],
		effects: [
			{kind: "spellInList", spell: "Scorching Ray"},
			{kind: "spellInList", spell: "Shatter"},
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
		kind: "passive",
		effects: [
			{kind: "featureCalculation", property: "hasFlashOfGenius", exact: true},
			{kind: "featureCalculationDerivedFrom", property: "flashOfGeniusBonus", equals: "abilityMod", ability: "int"},
			{kind: "longRestRestoresFeatureUses", feature: "Flash of Genius"},
		],
	},
	{
		level: 9,
		name: /^eldritch cannon$/i,
		kind: "resource",
		resourceName: "Eldritch Cannon Creation",
		resourceMax: 1,
		restoreOn: "long",
		effects: [
			{kind: "featureCalculation", property: "flamethrowerDamage", exact: "3d8"},
			{kind: "featureCalculation", property: "forceBallistaDamage", exact: "3d8"},
			{kind: "featureCalculation", property: "protectorTempHpDice", exact: "2d8"},
		],
	},
	{
		level: 9,
		name: /^explosive cannon$/i,
		kind: "passive",
		effects: [
			{kind: "featureCalculation", property: "hasExplosiveCannon", exact: true},
			{kind: "featureCalculation", property: "cannonDetonationDamage", exact: "3d10"},
			{kind: "featureCalculation", property: "cannonDetonationActionType", exact: "reaction"},
			{kind: "featureCalculation", property: "cannonDetonationTrigger", exact: "cannonTakesDamage"},
			{kind: "efaArtilleristProbe", probe: "explosiveCannon"},
		],
		untilLevel: 14,
	},
	{
		level: 9,
		name: /artillerist spells/i,
		kind: "spells",
		grantsSpells: ["Fireball", "Wind Wall"],
		effects: [
			{kind: "spellInList", spell: "Fireball"},
			{kind: "spellInList", spell: "Wind Wall"},
		],
	},
	{
		level: 10,
		name: /magic item adept/i,
		kind: "passive",
		effects: [
			{kind: "featureCalculation", property: "hasMagicItemAdept", exact: true},
			{kind: "featureCalculation", property: "magicItemAttunementLimit", min: 4},
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
		level: 13,
		name: /artillerist spells/i,
		kind: "spells",
		grantsSpells: ["Ice Storm", "Wall of Fire"],
		effects: [
			{kind: "spellInList", spell: "Ice Storm"},
			{kind: "spellInList", spell: "Wall of Fire"},
		],
	},
	{
		level: 14,
		name: /advanced artifice/i,
		kind: "passive",
		effects: [
			{kind: "featureCalculation", property: "hasAdvancedArtifice", exact: true},
			{kind: "featureCalculation", property: "magicItemAttunementLimit", min: 5},
		],
	},
	{
		level: 15,
		name: /^fortified position$/i,
		kind: "passive",
		effects: [
			{kind: "featureCalculation", property: "hasFortifiedPosition", exact: true},
			{kind: "featureCalculation", property: "maxCannons", exact: 2},
			{kind: "featureCalculation", property: "cannonCoverRange", exact: 10},
			{kind: "featureCalculation", property: "cannonCoverType", exact: "half"},
			{kind: "efaArtilleristProbe", probe: "fortifiedPosition"},
		],
		untilLevel: 19,
	},
	{
		level: 17,
		name: /artillerist spells/i,
		kind: "spells",
		grantsSpells: ["Cone of Cold", "Wall of Force"],
		effects: [
			{kind: "spellInList", spell: "Cone of Cold"},
			{kind: "spellInList", spell: "Wall of Force"},
		],
	},
	{
		level: 18,
		name: /magic item master/i,
		kind: "passive",
		effects: [
			{kind: "featureCalculation", property: "hasMagicItemMaster", exact: true},
			{kind: "featureCalculation", property: "magicItemAttunementLimit", exact: 6},
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
	preset: PRESET_FULL_EFA_ARTILLERIST_ARTIFICER,
	displayName: "EFA Artillerist Artificer",
	signatureToggleSkip: {
		skip: true,
		reason: "Eldritch Cannon is an operated summon with action controls, not a standing character toggle",
	},
	midTierLoadout: [
		{name: "Longbow", source: "XPHB", equipped: true},
		{name: "Cloak of Protection", source: "XDMG", attune: true},
	],
	usage: {
		atLevel: 5,
		castSpellSlotLevel: 1,
		expectLongRestRestores: true,
		attackName: /longbow|dagger/i,
		skillRoll: {name: "Arcana"},
		shortRestRestores: {skip: true, reason: "EFA Artillerist has no class or subclass resource that recharges on a Short Rest."},
		concentrationCheck: {castSpell: "Faerie Fire", thenAction: "damage", expectActive: false},
		deathSaves: true,
		applyCondition: {name: "Restrained"},
		featAbility: {skip: true, reason: "This exact-source preset does not select an active feat ability."},
	},
	milestones: {
		1: {totalLevel: 1, spellSlots: {1: 2}},
		3: {totalLevel: 3, spellSlots: {1: 3}, expectResources: {"Eldritch Cannon Creation": 1}},
		5: {totalLevel: 5, spellSlots: {1: 4, 2: 2}, expectResources: {"Eldritch Cannon Creation": 1}},
		11: {totalLevel: 11, spellSlots: {1: 4, 2: 3, 3: 3}},
		17: {totalLevel: 17, spellSlots: {1: 4, 2: 3, 3: 3, 4: 3, 5: 1}},
		20: {totalLevel: 20, spellSlots: {1: 4, 2: 3, 3: 3, 4: 3, 5: 2}},
	},
	featuresMatrix: EFA_ARTILLERIST_FEATURES,
});
