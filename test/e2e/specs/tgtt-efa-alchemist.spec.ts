import {describeCharacter} from "../utils/characterSpecFactory";
import {PRESET_FULL_EFA_ALCHEMIST} from "../utils/characterBuilder";
import type {FeatureCheck} from "../utils/comprehensiveBuildHelpers";

const spellGrant = (atLevel: number, name: string, source: string) => ({level: atLevel, name, source});
const featureUid = (atLevel: number, uid: string) => ({level: atLevel, uid});

const ALCHEMIST_SPELLS = [
	spellGrant(3, "Healing Word", "XPHB"),
	spellGrant(3, "Ray of Sickness", "XPHB"),
	spellGrant(5, "Flaming Sphere", "XPHB"),
	spellGrant(5, "Melf's Acid Arrow", "XPHB"),
	spellGrant(9, "Gaseous Form", "XPHB"),
	spellGrant(9, "Mass Healing Word", "XPHB"),
	spellGrant(13, "Death Ward", "XPHB"),
	spellGrant(13, "Vitriolic Sphere", "XPHB"),
	spellGrant(17, "Cloudkill", "XPHB"),
	spellGrant(17, "Raise Dead", "XPHB"),
];

const EFA_ALCHEMIST_FEATURE_UIDS = [
	featureUid(3, "Tools of the Trade|Artificer|EFA|Alchemist|EFA|3|EFA"),
	featureUid(3, "Alchemist Spells|Artificer|EFA|Alchemist|EFA|3|EFA"),
	featureUid(3, "Experimental Elixir|Artificer|EFA|Alchemist|EFA|3|EFA"),
	featureUid(5, "Alchemical Savant|Artificer|EFA|Alchemist|EFA|5|EFA"),
	featureUid(9, "Restorative Reagents|Artificer|EFA|Alchemist|EFA|9|EFA"),
	featureUid(15, "Chemical Mastery|Artificer|EFA|Alchemist|EFA|15|EFA"),
];

const EFA_ALCHEMIST_FEATURES: FeatureCheck[] = [
	{
		level: 1,
		name: /^spellcasting$/i,
		kind: "passive",
		effects: [
			{kind: "featureCalculation", property: "hasEfaArtificerSpellcasting", exact: true},
			{kind: "spellSlots", level: 1, min: 2},
		],
	},
	{
		level: 1,
		name: /tinker'?s magic/i,
		kind: "passive",
		effects: [{kind: "featureUsesEqualAbilityMod", feature: "Tinker's Magic", ability: "int", minimum: 1, recharge: "long"}],
	},
	{
		level: 2,
		name: /replicate magic item/i,
		kind: "passive",
		effects: [{kind: "efaArtificerPlans"}],
	},
	{
		level: 3,
		name: /^tools of the trade$/i,
		kind: "passive",
		effects: [
			{
				kind: "toolProficiencies",
				includes: ["Alchemist's Supplies", "Herbalism Kit"],
				feature: {
					name: "Tools of the Trade",
					source: "EFA",
					className: "Artificer",
					classSource: "EFA",
					subclassName: "Alchemist",
					subclassSource: "EFA",
					level: 3,
				},
				excludedFeatureSources: ["TCE"],
				conditionalGrantKey: "conditionalToolGrant.tools",
			},
			{
				kind: "sourceQualifiedRoundTrip",
				className: "Artificer",
				classSource: "EFA",
				subclassName: "Alchemist",
				subclassSource: "EFA",
				featureUids: EFA_ALCHEMIST_FEATURE_UIDS,
				spellGrants: ALCHEMIST_SPELLS,
				spellGrantSourceFeature: "Alchemist Spells",
				incompatibleSubclassSources: ["TCE"],
			},
		],
	},
	{
		level: 3,
		untilLevel: 9,
		name: /^tools of the trade$/i,
		kind: "passive",
		effects: [{
			kind: "craftingTimeCalculation",
			recipeCategory: "potion",
			rarity: "uncommon",
			expectValueAbsent: true,
			baselineWorkweeks: 1,
			effectiveWorkweeks: 0.5,
			multiplier: 0.5,
			sourceUid: "Tools of the Trade|Artificer|EFA|Alchemist|EFA|3|EFA",
		}],
	},
	{
		level: 10,
		name: /^tools of the trade$/i,
		kind: "passive",
		effects: [{
			kind: "craftingTimeCalculation",
			recipeCategory: "potion",
			rarity: "uncommon",
			expectValueAbsent: true,
			baselineWorkweeks: 1,
			effectiveWorkweeks: 0.125,
			multiplier: 0.125,
			sourceUid: "Tools of the Trade|Artificer|EFA|Alchemist|EFA|3|EFA",
			sourceMultiplier: 0.5,
			allowAdditionalSources: true,
		}],
	},
	{
		level: 3,
		name: /^alchemist spells$/i,
		kind: "spells",
		grantsSpells: ["Healing Word", "Ray of Sickness"],
		effects: [{
			kind: "preparedSpellGrants",
			sourceFeature: "Alchemist Spells",
			className: "Artificer",
			classSource: "EFA",
			subclassName: "Alchemist",
			subclassSource: "EFA",
			grants: ALCHEMIST_SPELLS,
			expectPreparedAllowanceFilled: true,
		}],
	},
	{
		level: 3,
		untilLevel: 4,
		name: /^experimental elixir$/i,
		kind: "passive",
		effects: [{kind: "stateCall", method: "getEfaExperimentalElixirBatchSize", exact: 2}],
	},
	{
		level: 5,
		untilLevel: 8,
		name: /^experimental elixir$/i,
		kind: "passive",
		effects: [{kind: "stateCall", method: "getEfaExperimentalElixirBatchSize", exact: 3}],
	},
	{
		level: 9,
		untilLevel: 14,
		name: /^experimental elixir$/i,
		kind: "passive",
		effects: [{kind: "stateCall", method: "getEfaExperimentalElixirBatchSize", exact: 4}],
	},
	{
		level: 15,
		untilLevel: 19,
		name: /^experimental elixir$/i,
		kind: "passive",
		effects: [
			{kind: "stateCall", method: "getEfaExperimentalElixirBatchSize", exact: 5},
			{kind: "efaExperimentalElixirUi"},
		],
	},
	{
		level: 20,
		name: /^experimental elixir$/i,
		kind: "passive",
		effects: [{kind: "stateCall", method: "getEfaExperimentalElixirBatchSize", exact: 5}],
	},
	{
		level: 5,
		name: /^alchemical savant$/i,
		kind: "passive",
		effects: [{
			kind: "featureCalculationDerivedFrom",
			property: "efaAlchemicalSavantBonus",
			equals: "abilityMod",
			ability: "int",
		}, {kind: "efaAlchemistCastFollowUp", probe: "savant"}],
	},
	{
		level: 6,
		name: /^magic item tinker$/i,
		kind: "passive",
		effects: [{kind: "featureCalculation", property: "hasMagicItemTinker", exact: true}],
	},
	{
		level: 7,
		name: /^flash of genius$/i,
		kind: "passive",
		effects: [
			{kind: "featureCalculationDerivedFrom", property: "flashOfGeniusUses", equals: "abilityMod", ability: "int"},
			{kind: "featureCalculationDerivedFrom", property: "flashOfGeniusBonus", equals: "abilityMod", ability: "int"},
			{kind: "featureUsesEqualAbilityMod", feature: "Flash of Genius", ability: "int", minimum: 1, recharge: "long"},
		],
	},
	{
		level: 9,
		name: /^restorative reagents$/i,
		kind: "passive",
		effects: [{
			kind: "sourceQualifiedInnateSpellFlow",
			spellName: "Lesser Restoration",
			spellSource: "XPHB",
			ownerUid: "Alchemist|Artificer|EFA|EFA",
			classUid: "Artificer|EFA",
			sourceFeatureUid: "Restorative Reagents|Artificer|EFA|Alchemist|EFA|9|EFA",
			expectedMax: "abilityMod",
			expectedSlotLevel: 2,
			ability: "int",
		}],
	},
	{
		level: 10,
		untilLevel: 13,
		name: /^magic item adept$/i,
		kind: "passive",
		effects: [
			{kind: "featureCalculation", property: "hasMagicItemAdept", exact: true},
			{kind: "featureCalculation", property: "magicItemAttunementLimit", exact: 4},
		],
	},
	{
		level: 11,
		name: /^spell-storing item$/i,
		kind: "passive",
		effects: [
			{kind: "featureCalculation", property: "hasSpellStoringItem", exact: true},
			{kind: "featureCalculation", property: "spellStoringItemUses", min: 2},
		],
	},
	{
		level: 14,
		untilLevel: 17,
		name: /^advanced artifice$/i,
		kind: "passive",
		effects: [
			{kind: "featureCalculation", property: "hasAdvancedArtifice", exact: true},
			{kind: "featureCalculation", property: "hasRefreshedGenius", exact: true},
			{kind: "featureCalculation", property: "magicItemAttunementLimit", exact: 5},
		],
	},
	{
		level: 15,
		name: /^chemical mastery$/i,
		kind: "passive",
		effects: [
			{kind: "resistance", damageType: "acid"},
			{kind: "resistance", damageType: "poison"},
			{kind: "conditionImmunity", condition: "poisoned"},
			{
				kind: "sourceQualifiedInnateSpellFlow",
				spellName: "Tasha's Bubbling Cauldron",
				spellSource: "XPHB",
				ownerUid: "Alchemist|Artificer|EFA|EFA",
				classUid: "Artificer|EFA",
				sourceFeatureUid: "Chemical Mastery|Artificer|EFA|Alchemist|EFA|15|EFA",
				expectedMax: 1,
				expectedSlotLevel: 6,
			},
			{kind: "efaAlchemistCastFollowUp", probe: "eruption"},
		],
	},
	{
		level: 18,
		name: /^magic item master$/i,
		kind: "passive",
		effects: [
			{kind: "featureCalculation", property: "hasMagicItemMaster", exact: true},
			{kind: "featureCalculation", property: "magicItemAttunementLimit", exact: 6},
		],
	},
	{
		level: 20,
		name: /^soul of artifice$/i,
		kind: "passive",
		effects: [
			{kind: "featureCalculation", property: "hasEfaSoulOfArtifice", exact: true},
			{kind: "featureCalculation", property: "hasMagicalGuidance", exact: true},
		],
	},
];

/**
 * Standard coverage map:
 *  1 L1 factory creation; 2 L3 subclass; 3 L5 milestone; 4 L5 loadout.
 *  5 explicit signature skip below; 6 MEGA L1-20; 7 spell-slot use;
 *  8 Flash of Genius use; 9 crossbow attack; 10 long-rest slot restore;
 * 11 Arcana roll; 12 explicit short-rest skip; 13 Faerie Fire concentration;
 * 14 death saves; 15 Poisoned lifecycle; 16 explicit feat-toggle skip;
 * 17 exact-source round trip; 18 single-class, not applicable;
 * 19 TGTT Specialties not owned by Artificer; 20 Weapon Mastery not owned;
 * 21 Replicate Magic Item plan choice/production; 22 effects or reasons above.
 */
describeCharacter({
	preset: PRESET_FULL_EFA_ALCHEMIST,
	displayName: "EFA Alchemist Artificer",
	midTierLoadout: [
		{name: "Light Crossbow", source: "XPHB", equipped: true},
		{name: "Cloak of Protection", source: "XDMG", equipped: true, attune: true},
		{name: "Alchemist's Supplies", source: "XPHB", equipped: true},
		{name: "Tinker's Tools", source: "XPHB", equipped: true},
	],
	signatureToggleSkip: {
		skip: true,
		reason: "Experimental Elixir is a limited-use production and consumption operation, not an L5 standing stance.",
	},
	usage: {
		atLevel: 7,
		castSpellSlotLevel: 1,
		useResourceName: "Flash of Genius",
		expectLongRestRestores: true,
		attackName: /light crossbow/i,
		skillRoll: {name: "Arcana"},
		shortRestRestores: {skip: true, reason: "EFA Alchemist has no subclass resource that recharges on a Short Rest."},
		concentrationCheck: {castSpell: "Faerie Fire", thenAction: "damage", expectActive: false},
		deathSaves: true,
		applyCondition: {name: "Poisoned"},
		featAbility: {skip: true, reason: "This exact-source preset does not select an active feat ability."},
	},
	milestones: {
		1: {totalLevel: 1, minMaxHp: 8, spellSlots: {1: 2}},
		3: {totalLevel: 3, minMaxHp: 18, spellSlots: {1: 3}},
		5: {totalLevel: 5, minMaxHp: 30, spellSlots: {1: 4, 2: 2}},
		11: {totalLevel: 11, minMaxHp: 65, spellSlots: {1: 4, 2: 3, 3: 3}},
		17: {totalLevel: 17, minMaxHp: 100, spellSlots: {1: 4, 2: 3, 3: 3, 4: 3, 5: 1}},
		20: {totalLevel: 20, minMaxHp: 115, spellSlots: {1: 4, 2: 3, 3: 3, 4: 3, 5: 2}},
	},
	featuresMatrix: EFA_ALCHEMIST_FEATURES,
});
