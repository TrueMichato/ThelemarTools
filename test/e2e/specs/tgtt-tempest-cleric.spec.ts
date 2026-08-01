import {describeCharacter} from "../utils/characterSpecFactory";
import {PRESET_FULL_TEMPEST_CLERIC} from "../utils/characterBuilder";
import type {FeatureCheck} from "../utils/comprehensiveBuildHelpers";

const TEMPEST_FEATURES: FeatureCheck[] = [
	{
		level: 1,
		name: /tempest domain/i,
		kind: "passive",
		effects: [
			{kind: "spellInList", spell: "Fog Cloud"},
			{kind: "spellInList", spell: "Thunderwave"},
		],
	},
	{
		level: 1,
		name: /bonus proficiencies/i,
		kind: "passive",
		effects: [
			{kind: "proficiency", proficiencyType: "weapon", includes: "martial"},
			{kind: "proficiency", proficiencyType: "armor", includes: "heavy"},
		],
	},
	{
		level: 1,
		name: "Wrath of the Storm",
		kind: "passive",
		effects: [
			{kind: "featureUsesEqualAbilityMod", feature: "Wrath of the Storm", ability: "wis", minimum: 1, recharge: "long"},
			{kind: "combatAction", feature: "Wrath of the Storm", interactionMode: "reaction", formula: "2d8", damageTypes: ["lightning", "thunder"], saveAbility: "dex"},
			{kind: "pickActivatable", matchAny: [/^Wrath of the Storm$/i]},
			{kind: "longRestRestoresFeatureUses", feature: "Wrath of the Storm"},
		],
	},
	{
		level: 2,
		name: "Channel Divinity",
		kind: "resource",
		resourceMax: [1, 3],
		restoreOn: "short",
		effects: [{kind: "shortRestRestores", resource: "Channel Divinity"}],
	},
	{
		level: 2,
		name: /channel divinity: destructive wrath/i,
		kind: "passive",
		effects: [
			{kind: "pickActivatable", matchAny: [/^Channel Divinity: Destructive Wrath$/i]},
			{
				kind: "deferredDamageMaximizer",
				feature: "Channel Divinity: Destructive Wrath",
				resource: "Channel Divinity",
				eligibleType: "lightning",
				ineligibleType: "fire",
			},
		],
	},
	{
		level: 3,
		name: /tempest domain/i,
		kind: "passive",
		effects: [
			{kind: "spellInList", spell: "Gust of Wind"},
			{kind: "spellInList", spell: "Shatter"},
		],
	},
	{
		level: 5,
		name: /tempest domain/i,
		kind: "passive",
		effects: [
			{kind: "spellInList", spell: "Call Lightning"},
			{kind: "spellInList", spell: "Sleet Storm"},
		],
	},
	{
		level: 6,
		name: /thunderbolt strike/i,
		kind: "passive",
		effects: [{
			kind: "triggeredDamageEffect",
			damageType: "lightning",
			effectType: "forcedMovement",
			distance: 10,
			direction: "away",
			maxTargetSize: "Large",
			optional: true,
		}],
	},
	{
		level: 7,
		name: /tempest domain/i,
		kind: "passive",
		effects: [
			{kind: "spellInList", spell: "Control Water"},
			{kind: "spellInList", spell: "Ice Storm"},
		],
	},
	{
		level: 8,
		untilLevel: 13,
		name: /divine strike/i,
		kind: "passive",
		effects: [{kind: "weaponDamageRider", id: "clericDivineStrike", dice: "1d8", damageType: "thunder", perTurn: true}],
	},
	{
		level: 9,
		name: /tempest domain/i,
		kind: "passive",
		effects: [
			{kind: "spellInList", spell: "Destructive Wave"},
			{kind: "spellInList", spell: "Insect Plague"},
		],
	},
	{
		level: 14,
		name: /divine strike/i,
		kind: "passive",
		effects: [{kind: "weaponDamageRider", id: "clericDivineStrike", dice: "2d8", damageType: "thunder", perTurn: true}],
	},
	{
		level: 17,
		name: /stormborn/i,
		kind: "passive",
		effects: [{kind: "speedEquals", left: "fly", right: "walk"}],
	},
	{
		level: 18,
		name: /^channel divinity$/i,
		kind: "passive",
		effects: [
			{kind: "featureCalculation", property: "channelDivinityUses", exact: 3},
			{kind: "shortRestRestores", resource: "Channel Divinity"},
		],
	},
];

/**
 * PHB 2014 Tempest Domain Cleric — L1→20.
 *
 * Coverage focus:
 *   - Wrath of the Storm's reaction, typed damage, WIS pool, and long-rest recovery
 *   - Destructive Wrath's deferred typed spend and Thunderbolt Strike's push
 *   - Divine Strike scaling and Stormborn's live walk-equals-fly speed
 */
describeCharacter({
	preset: PRESET_FULL_TEMPEST_CLERIC,
	displayName: "Tempest Domain Cleric (PHB)",
	signatureToggle: /destructive wrath/i,
	signatureToggleNoDerivedEffect: "Destructive Wrath arms a deferred damage maximizer instead of changing a persistent derived stat.",
	midTierLoadout: [
		{name: "Mace", equipped: true},
		{name: "Plate Armor", equipped: true},
	],
	usage: {
		atLevel: 5,
		castSpellSlotLevel: 1,
		useResourceName: "Channel Divinity",
		expectLongRestRestores: true,
		attackName: /mace/i,
		skillRoll: {name: "Religion"},
		shortRestRestores: {resourceName: "Channel Divinity"},
		concentrationCheck: {castSpell: "Bless", thenAction: "damage", expectActive: false},
		deathSaves: true,
		applyCondition: {name: "Restrained"},
		// This deterministic build takes ASIs, not a toggleable feat.
		featAbility: {skip: true},
	},
	milestones: {
		1: {totalLevel: 1, spellSlots: {1: 2}},
		3: {totalLevel: 3, spellSlots: {2: 2}, expectResources: {"Channel Divinity": 1}},
		5: {totalLevel: 5, spellSlots: {3: 2}, expectResources: {"Channel Divinity": 1}},
		11: {totalLevel: 11, spellSlots: {6: 1}, expectResources: {"Channel Divinity": 2}},
		17: {totalLevel: 17, spellSlots: {9: 1}, expectResources: {"Channel Divinity": 2}},
		// The PHB L18 improvement takes the shared pool to three uses (CS-BUG-033).
		20: {totalLevel: 20, spellSlots: {9: 1}, expectResources: {"Channel Divinity": 3}},
	},
	featuresMatrix: TEMPEST_FEATURES,
});
