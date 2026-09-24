import {describeCharacter} from "../utils/characterSpecFactory";
import {PRESET_FULL_EFA_ARMORER_ARTIFICER} from "../utils/characterBuilder";
import {
	buildEfaArtificerBaseChecks,
	EFA_ARTIFICER_BASE_FEATURE_UIDS,
} from "../utils/efaArtificerBase";
import type {EffectCheck, FeatureCheck} from "../utils/comprehensiveBuildHelpers";

const featureUid = (level: number, uid: string) => ({level, uid});
const spellGrant = (level: number, name: string) => ({level, name, source: "XPHB"});

const ARMORER_FEATURE_UIDS = [
	featureUid(3, "Tools of the Trade|Artificer|EFA|Armorer|EFA|3|EFA"),
	featureUid(3, "Armorer Spells|Artificer|EFA|Armorer|EFA|3|EFA"),
	featureUid(3, "Arcane Armor|Artificer|EFA|Armorer|EFA|3|EFA"),
	featureUid(3, "Armor Model|Artificer|EFA|Armorer|EFA|3|EFA"),
	featureUid(3, "Dreadnaught|Artificer|EFA|Armorer|EFA|3|EFA"),
	featureUid(5, "Extra Attack|Artificer|EFA|Armorer|EFA|5|EFA"),
	featureUid(9, "Improved Armorer|Artificer|EFA|Armorer|EFA|9|EFA"),
	featureUid(15, "Perfected Armor|Artificer|EFA|Armorer|EFA|15|EFA"),
];

const ARMORER_SPELLS = [
	spellGrant(3, "Magic Missile"),
	spellGrant(3, "Thunderwave"),
	spellGrant(5, "Mirror Image"),
	spellGrant(5, "Shatter"),
	spellGrant(9, "Hypnotic Pattern"),
	spellGrant(9, "Lightning Bolt"),
	spellGrant(13, "Fire Shield"),
	spellGrant(13, "Greater Invisibility"),
	spellGrant(17, "Passwall"),
	spellGrant(17, "Wall of Force"),
];

const sourceQualifiedFeature = (name: string, level: number): EffectCheck => ({
	kind: "sourceQualifiedFeature",
	uid: `${name}|Artificer|EFA|Armorer|EFA|${level}|EFA`,
	excludedUids: [`${name}|Artificer|TCE|Armorer|TCE|${level}|TCE`],
});

const armorerSpellTier = (level: 3 | 5 | 9 | 13 | 17, names: string[]): FeatureCheck => ({
	level,
	name: /^Armorer Spells$/i,
	kind: "spells",
	grantsSpells: names,
	effects: [
		sourceQualifiedFeature("Armorer Spells", 3),
		{
			kind: "preparedSpellGrants",
			sourceFeature: "Armorer Spells",
			className: "Artificer",
			classSource: "EFA",
			subclassName: "Armorer",
			subclassSource: "EFA",
			grants: ARMORER_SPELLS,
		},
	],
});

const baseChecks = buildEfaArtificerBaseChecks().map((check): FeatureCheck => {
	if (check.featureUid !== EFA_ARTIFICER_BASE_FEATURE_UIDS.epicBoon) return check;
	const upgraded = {
		...check,
		effects: [{kind: "efaArmorerProbe", probe: "progression"}],
	} satisfies FeatureCheck;
	delete upgraded.effectReason;
	return upgraded;
});

const EFA_ARMORER_FEATURES: FeatureCheck[] = [
	...baseChecks,
	{
		level: 3,
		name: /^Tools of the Trade$/i,
		kind: "passive",
		effects: [
			sourceQualifiedFeature("Tools of the Trade", 3),
			{kind: "proficiency", proficiencyType: "armor", includes: "Heavy"},
			{kind: "stateCall", method: "hasToolProficiency", args: ["Smith's Tools"], exact: true},
			{
				kind: "stateCall",
				method: "getCraftingTimeCalculation",
				args: [{baseWorkweeks: 10, recipe: {recipeCategory: "item", itemType: "HA", rarity: "rare"}}],
				path: "effectiveWorkweeks",
				exact: 5,
			},
			{
				kind: "stateCall",
				method: "getCraftingTimeCalculation",
				args: [{baseWorkweeks: 10, recipe: {recipeCategory: "item", itemType: "HA", rarity: "rare"}}],
				path: "sourceBreakdown",
				contains: ARMORER_FEATURE_UIDS[0].uid,
			},
			{
				kind: "stateCall",
				method: "getCraftingTimeCalculation",
				args: [{baseWorkweeks: 10, recipe: {recipeCategory: "item", itemType: "G", rarity: "rare"}}],
				path: "effectiveWorkweeks",
				exact: 10,
			},
		],
	},
	armorerSpellTier(3, ["Magic Missile", "Thunderwave"]),
	armorerSpellTier(5, ["Mirror Image", "Shatter"]),
	armorerSpellTier(9, ["Hypnotic Pattern", "Lightning Bolt"]),
	armorerSpellTier(13, ["Fire Shield", "Greater Invisibility"]),
	armorerSpellTier(17, ["Passwall", "Wall of Force"]),
	{
		level: 3,
		name: /^Arcane Armor$/i,
		kind: "passive",
		effects: [
			sourceQualifiedFeature("Arcane Armor", 3),
			{kind: "featureCalculation", property: "hasArcaneArmor", exact: true},
			{kind: "featureCalculation", property: "hasEfaArmorer", exact: true},
			{kind: "featureCalculation", property: "efaArmorerSource", exact: "EFA"},
			{
				kind: "sourceQualifiedRoundTrip",
				className: "Artificer",
				classSource: "EFA",
				subclassName: "Armorer",
				subclassSource: "EFA",
				featureUids: ARMORER_FEATURE_UIDS,
				spellGrants: ARMORER_SPELLS,
				spellGrantSourceFeature: "Armorer Spells",
				incompatibleSubclassSources: ["TCE"],
			},
			{kind: "efaArmorerProbe", probe: "core"},
		],
	},
	{
		level: 3,
		name: /^Armor Model$/i,
		kind: "passive",
		effects: [
			sourceQualifiedFeature("Armor Model", 3),
			{kind: "efaArmorerProbe", probe: "models"},
		],
	},
	{
		level: 3,
		name: /^Dreadnaught$/i,
		kind: "passive",
		effects: [
			{kind: "stateCall", method: "getEfaArmorerModel", path: "name", exact: "Dreadnaught"},
			{
				kind: "stateCall",
				method: "getEfaArmorerModel",
				path: "id",
				exact: "efa-armorer:dreadnaught:force-demolisher",
			},
		],
	},
	{
		level: 5,
		name: /^Extra Attack$/i,
		kind: "passive",
		effects: [
			sourceQualifiedFeature("Extra Attack", 5),
			{kind: "featureCalculation", property: "hasExtraAttack", exact: true},
			{kind: "featureCalculation", property: "attacksPerAction", exact: 2},
		],
	},
	{
		level: 9,
		name: /^Improved Armorer$/i,
		kind: "passive",
		effects: [
			sourceQualifiedFeature("Improved Armorer", 9),
			{kind: "efaArmorerProbe", probe: "improved"},
		],
	},
	{
		level: 15,
		name: /^Perfected Armor$/i,
		kind: "passive",
		effects: [
			sourceQualifiedFeature("Perfected Armor", 15),
			{kind: "featureCalculation", property: "hasEfaPerfectedArmor", exact: true},
			{kind: "efaArmorerProbe", probe: "perfected"},
		],
	},
];

describeCharacter({
	preset: PRESET_FULL_EFA_ARMORER_ARTIFICER,
	displayName: "EFA Armorer Artificer",
	signatureToggleSkip: {
		skip: true,
		reason: "Arcane Armor and model powers are inventory-bound transactions, not a standing Overview toggle",
	},
	midTierLoadout: [
		{name: "Dagger", source: "XPHB", equipped: true},
		{name: "Plate Armor", source: "XPHB", equipped: true},
		{name: "Smith's Tools", source: "XPHB"},
		{name: "Cloak of Protection", source: "XDMG", attune: true},
	],
	usage: {
		atLevel: 14,
		castSpellSlotLevel: 1,
		useResourceName: "Flash of Genius",
		expectLongRestRestores: true,
		attackName: /dagger/i,
		skillRoll: {name: "Arcana", expectBonusAtLeast: 3},
		shortRestRestores: {resourceName: "Flash of Genius", spend: "all", expectAfter: 1},
		concentrationCheck: {castSpell: "Faerie Fire", thenAction: "damage", expectActive: false},
		deathSaves: true,
		applyCondition: {name: "Poisoned", expectEffect: "disadvantage"},
		featAbility: {
			skip: true,
			reason: "The deterministic Artificer progression takes ASIs; the resolved Epic Boon and its applied-effect ledger are asserted in the matrix",
		},
	},
	milestones: {
		1: {totalLevel: 1, proficiencyBonus: 2, spellSlots: {1: 2}},
		3: {
			totalLevel: 3,
			proficiencyBonus: 2,
			spellSlots: {1: 3},
			expectFeatureUids: ARMORER_FEATURE_UIDS.filter(it => it.level <= 3).map(it => it.uid),
		},
		5: {
			totalLevel: 5,
			proficiencyBonus: 3,
			spellSlots: {1: 4, 2: 2},
			expectFeatureUids: ["Extra Attack|Artificer|EFA|Armorer|EFA|5|EFA"],
		},
		11: {
			totalLevel: 11,
			proficiencyBonus: 4,
			spellSlots: {1: 4, 2: 3, 3: 3},
			expectFeatureUids: ["Improved Armorer|Artificer|EFA|Armorer|EFA|9|EFA"],
		},
		17: {
			totalLevel: 17,
			proficiencyBonus: 6,
			spellSlots: {1: 4, 2: 3, 3: 3, 4: 3, 5: 1},
			expectFeatureUids: ["Perfected Armor|Artificer|EFA|Armorer|EFA|15|EFA"],
		},
		20: {
			totalLevel: 20,
			proficiencyBonus: 6,
			spellSlots: {1: 4, 2: 3, 3: 3, 4: 3, 5: 2},
			expectFeatureUids: ["Soul of Artifice|Artificer|EFA|20|EFA"],
		},
	},
	megaCheckpoints: [3, 5, 6, 9, 10, 11, 13, 14, 15, 17, 18, 19, 20],
	megaTimeoutMs: 1_200_000,
	featureMatrixDedicatedOnly: true,
	featuresMatrix: EFA_ARMORER_FEATURES,
});
