import {describeCharacter} from "../utils/characterSpecFactory";
import {PRESET_FULL_EFA_BATTLE_SMITH_ARTIFICER} from "../utils/characterBuilder";
import type {EffectCheck, FeatureCheck} from "../utils/comprehensiveBuildHelpers";

const BATTLE_SMITH_CLASS_UID = "Artificer|EFA";
const BATTLE_SMITH_SUBCLASS_UID = "Battle Smith|Artificer|EFA|EFA";
const TOOLS_UID = "Tools of the Trade|Artificer|EFA|Battle Smith|EFA|3|EFA";
const SPELLS_UID = "Battle Smith Spells|Artificer|EFA|Battle Smith|EFA|3|EFA";
const BATTLE_READY_UID = "Battle Ready|Artificer|EFA|Battle Smith|EFA|3|EFA";
const STEEL_DEFENDER_UID = "Steel Defender|Artificer|EFA|Battle Smith|EFA|3|EFA";
const EXTRA_ATTACK_UID = "Extra Attack|Artificer|EFA|Battle Smith|EFA|5|EFA";
const ARCANE_JOLT_UID = "Arcane Jolt|Artificer|EFA|Battle Smith|EFA|9|EFA";
const IMPROVED_DEFENDER_UID = "Improved Defender|Artificer|EFA|Battle Smith|EFA|15|EFA";
const TCE_STEEL_DEFENDER_UID = "Steel Defender|Artificer|TCE|Battle Smith|TCE|3|TCE";
const RHW_REANIMATED_COMPANION_UID = "Reanimated Companion|Artificer|EFA|Reanimator|RHW|3|RHW";

const sourceQualifiedFeature = (name: string, level: number): EffectCheck => ({
	kind: "sourceQualifiedFeature",
	uid: `${name}|Artificer|EFA|Battle Smith|EFA|${level}|EFA`,
	excludedUids: [
		`${name}|Artificer|TCE|Battle Smith|TCE|${level}|TCE`,
		`${name}|Artificer|EFA|Battle Smith|RHW|${level}|RHW`,
	],
});

const sourceQualifiedSpell = (spell: string): EffectCheck => ({
	kind: "spellInList",
	spell,
	source: "XPHB",
});

const defenderProjection = ({
	level,
	proficiencyBonus,
	maxHp,
	expectRendReplacement = level >= 5,
	expectArcaneJoltDice = null,
	expectImprovedDefender = false,
}: {
	level: number;
	proficiencyBonus: number;
	maxHp: number;
	expectRendReplacement?: boolean;
	expectArcaneJoltDice?: "2d6" | "4d6" | null;
	expectImprovedDefender?: boolean;
}): EffectCheck => ({
	kind: "featureCompanionProjection",
	ownerUid: STEEL_DEFENDER_UID,
	excludedOwnerUids: [TCE_STEEL_DEFENDER_UID, RHW_REANIMATED_COMPANION_UID],
	checks: [
		{path: "count", exact: 1},
		{path: "setup.status", exact: "complete"},
		{path: "companion.id", equalsPath: "setup.companionId"},
		{path: "companion.name", exact: "Steel Defender"},
		{path: "companion.source", exact: "EFA"},
		{path: "companion.ownerUid", exact: STEEL_DEFENDER_UID},
		{path: "companion.hpMax", exact: maxHp},
		{path: "companion.hitDiceMax", exact: level},
		{path: "companion.repairUsesMax", exact: 3},
		{path: "context.artificerLevel", exact: level},
		{path: "context.proficiencyBonus", exact: proficiencyBonus},
		{path: "rules.identity.classUid", exact: BATTLE_SMITH_CLASS_UID},
		{path: "rules.identity.subclassUid", exact: BATTLE_SMITH_SUBCLASS_UID},
		{path: "rules.identity.featureUid", exact: "Steel Defender|Artificer|EFA|Battle Smith|EFA|3"},
		{path: "rules.identity.companionUid", exact: "Steel Defender|EFA"},
		{path: "rules.statistics.maxHp", exact: maxHp},
		{path: "rules.statistics.ac", equalsPath: "context.intelligenceModifier", offset: 12},
		{path: "rules.statistics.proficiencyPolicy.abilityChecks", exact: "all"},
		{path: "rules.statistics.proficiencyPolicy.savingThrows", exact: "all"},
		{path: "rules.actions.forceEmpoweredRend.attackBonus", equalsPath: "context.spellAttackBonus"},
		{path: "rules.actions.forceEmpoweredRend.damage.dice", exact: "1d8"},
		{path: "rules.actions.forceEmpoweredRend.damage.flat", equalsPath: "context.intelligenceModifier", offset: 2},
		{path: "rules.actions.forceEmpoweredRend.damage.type", exact: "force"},
		{path: "rules.actions.repair.healing.dice", exact: "2d8"},
		{path: "rules.actions.repair.healing.flat", equalsPath: "context.intelligenceModifier"},
		{path: "rules.actions.repair.uses.max", exact: 3},
		{path: "rules.actions.repair.uses.recharge", exact: "longRest"},
		{path: "rules.reactions.deflectAttack.effect.attackRollMode", exact: "disadvantage"},
		{path: "rules.commandPolicy.commandMethods", contains: "bonusAction"},
		...(expectRendReplacement
			? [{path: "rules.commandPolicy.commandMethods", contains: "replaceOneAttack"} as const]
			: []),
		{path: "matchesResolved.hp", exact: true},
		{path: "matchesResolved.ac", exact: true},
		{path: "matchesResolved.repairUses", exact: true},
		{path: "matchesResolved.hitDice", exact: true},
		{path: "matchesResolved.identity", exact: true},
		...(expectArcaneJoltDice
			? [
				{path: "rules.arcaneJolt.available", exact: true} as const,
				{path: "rules.arcaneJolt.oncePerTurn", exact: true} as const,
				{path: "rules.arcaneJolt.triggerSources", contains: "summonerMagicWeaponHit"} as const,
				{path: "rules.arcaneJolt.triggerSources", contains: "companionHit"} as const,
				{path: "rules.arcaneJolt.damage.dice", exact: expectArcaneJoltDice} as const,
				{path: "rules.arcaneJolt.healing.dice", exact: expectArcaneJoltDice} as const,
				{path: "rules.arcaneJolt.healing.rangeFeet", exact: 30} as const,
				{path: "rules.arcaneJolt.uses.max", equalsPath: "context.intelligenceModifier"} as const,
				{path: "rules.arcaneJolt.uses.recharge", exact: "longRest"} as const,
			]
			: [{path: "rules.arcaneJolt.available", exact: false} as const]),
		{path: "rules.improvedDefender.available", exact: expectImprovedDefender},
		{path: "rules.improvedDefender.armorClassBonus", exact: 0},
		...(expectImprovedDefender
			? [
				{path: "rules.improvedDefender.arcaneJoltDice", exact: "4d6"} as const,
				{path: "rules.improvedDefender.deflectAttackDamage.dice", exact: "1d4"} as const,
				{path: "rules.improvedDefender.deflectAttackDamage.flat", equalsPath: "context.intelligenceModifier"} as const,
				{path: "rules.improvedDefender.deflectAttackDamage.type", exact: "force"} as const,
			]
			: []),
	],
});

const BATTLE_SMITH_FEATURES_MATRIX: FeatureCheck[] = [
	{
		level: 3,
		name: /^tools of the trade$/i,
		kind: "passive",
		effects: [
			sourceQualifiedFeature("Tools of the Trade", 3),
			{kind: "featureCalculation", property: "hasEfaBattleSmithToolsOfTheTrade", exact: true},
			{kind: "featureCalculation", property: "efaBattleSmithToolsOfTheTradeFeatureUid", exact: TOOLS_UID},
			{kind: "stateCall", method: "hasToolProficiency", args: ["Smith's Tools"], exact: true},
			{
				kind: "stateCall",
				method: "getCraftingTimeCalculation",
				args: [{baseWorkweeks: 10, recipe: {recipeCategory: "item", itemType: "M", rarity: "rare"}}],
				path: "effectiveWorkweeks",
				exact: 5,
			},
			{
				kind: "stateCall",
				method: "getCraftingTimeCalculation",
				args: [{baseWorkweeks: 10, recipe: {recipeCategory: "item", itemType: "M", rarity: "rare"}}],
				path: "sourceBreakdown",
				contains: TOOLS_UID,
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
	{
		level: 3,
		name: /^battle smith spells$/i,
		kind: "spells",
		grantsSpells: ["Heroism", "Shield"],
		effects: [
			sourceQualifiedFeature("Battle Smith Spells", 3),
			sourceQualifiedSpell("Heroism"),
			sourceQualifiedSpell("Shield"),
		],
	},
	{
		level: 5,
		name: /^battle smith spells$/i,
		kind: "spells",
		grantsSpells: ["Shining Smite", "Warding Bond"],
		effects: [
			sourceQualifiedFeature("Battle Smith Spells", 3),
			sourceQualifiedSpell("Shining Smite"),
			sourceQualifiedSpell("Warding Bond"),
		],
	},
	{
		level: 9,
		name: /^battle smith spells$/i,
		kind: "spells",
		grantsSpells: ["Aura of Vitality", "Conjure Barrage"],
		effects: [
			sourceQualifiedFeature("Battle Smith Spells", 3),
			sourceQualifiedSpell("Aura of Vitality"),
			sourceQualifiedSpell("Conjure Barrage"),
		],
	},
	{
		level: 13,
		name: /^battle smith spells$/i,
		kind: "spells",
		grantsSpells: ["Aura of Purity", "Fire Shield"],
		effects: [
			sourceQualifiedFeature("Battle Smith Spells", 3),
			sourceQualifiedSpell("Aura of Purity"),
			sourceQualifiedSpell("Fire Shield"),
		],
	},
	{
		level: 17,
		name: /^battle smith spells$/i,
		kind: "spells",
		grantsSpells: ["Banishing Smite", "Mass Cure Wounds"],
		effects: [
			sourceQualifiedFeature("Battle Smith Spells", 3),
			sourceQualifiedSpell("Banishing Smite"),
			sourceQualifiedSpell("Mass Cure Wounds"),
		],
	},
	{
		level: 3,
		name: /^battle ready$/i,
		kind: "passive",
		effects: [
			sourceQualifiedFeature("Battle Ready", 3),
			{kind: "featureCalculation", property: "hasEfaBattleReady", exact: true},
			{kind: "featureCalculation", property: "efaBattleReadyFeatureUid", exact: BATTLE_READY_UID},
			{kind: "featureCalculation", property: "efaBattleReadyAttackAbility", exact: "int"},
			{kind: "featureCalculation", property: "efaBattleReadyWeaponRequirement", exact: "magic"},
			{kind: "proficiency", proficiencyType: "weapon", includes: "Martial"},
			{
				kind: "stateCall",
				method: "getWeaponAbilityResolution",
				args: [{
					abilityMode: "dex",
					sourceItem: {
						name: "Sun Blade",
						source: "XDMG",
						type: "M|XPHB",
						weaponCategory: "martial",
						property: ["F"],
						rarity: "rare",
						bonusWeapon: "+2",
					},
				}],
				path: "ability",
				exact: "int",
			},
			{
				kind: "stateCall",
				method: "getWeaponAbilityResolution",
				args: [{
					abilityMode: "dex",
					sourceItem: {
						name: "Sun Blade",
						source: "XDMG",
						type: "M|XPHB",
						weaponCategory: "martial",
						property: ["F"],
						rarity: "rare",
						bonusWeapon: "+2",
					},
				}],
				path: "sourceFeatureUid",
				exact: BATTLE_READY_UID,
			},
			{
				kind: "stateCall",
				method: "getWeaponAbilityResolution",
				args: [{
					abilityMode: "str",
					sourceItem: {
						name: "Longsword",
						source: "XPHB",
						type: "M|XPHB",
						weaponCategory: "martial",
						rarity: "none",
					},
				}],
				path: "ability",
				exact: "str",
			},
			{
				kind: "stateCall",
				method: "getWeaponAbilityResolution",
				args: [{
					abilityMode: "str",
					sourceItem: {
						name: "Longsword",
						source: "XPHB",
						type: "M|XPHB",
						weaponCategory: "martial",
						rarity: "none",
					},
				}],
				path: "source",
				exact: null,
			},
			{
				kind: "stateCall",
				method: "getSpellCastFocusRequirement",
				args: [{name: "Cure Wounds", source: "XPHB", castingClassName: "Artificer", castingClassSource: "EFA"}],
				path: "ruleId",
				exact: "efa-battle-ready-tools-or-proficient-weapon",
			},
			{
				kind: "stateCall",
				method: "getSpellCastFocusRequirement",
				args: [{name: "Cure Wounds", source: "XPHB", castingClassName: "Artificer", castingClassSource: "EFA"}],
				path: "sourceFeatureUid",
				exact: BATTLE_READY_UID,
			},
			{
				kind: "stateCall",
				method: "getSpellCastFocusRequirement",
				args: [{name: "Cure Wounds", source: "XPHB", castingClassName: "Artificer", castingClassSource: "EFA"}],
				path: "filter.weapon.category",
				exact: "any",
			},
		],
	},
	{
		level: 3,
		untilLevel: 4,
		name: /^steel defender$/i,
		kind: "passive",
		effects: [
			sourceQualifiedFeature("Steel Defender", 3),
			{kind: "featureCalculation", property: "hasEfaSteelDefenderGrant", exact: true},
			{kind: "featureCalculation", property: "efaSteelDefenderFeatureUid", exact: STEEL_DEFENDER_UID},
			defenderProjection({proficiencyBonus: 2, level: 3, maxHp: 20}),
		],
	},
	{
		level: 5,
		untilLevel: 10,
		name: /^steel defender$/i,
		kind: "passive",
		effects: [
			sourceQualifiedFeature("Steel Defender", 3),
			defenderProjection({proficiencyBonus: 3, level: 5, maxHp: 30}),
		],
	},
	{
		level: 11,
		untilLevel: 16,
		name: /^steel defender$/i,
		kind: "passive",
		effects: [
			sourceQualifiedFeature("Steel Defender", 3),
			defenderProjection({proficiencyBonus: 4, level: 11, maxHp: 60, expectArcaneJoltDice: "2d6"}),
		],
	},
	{
		level: 17,
		untilLevel: 19,
		name: /^steel defender$/i,
		kind: "passive",
		effects: [
			sourceQualifiedFeature("Steel Defender", 3),
			defenderProjection({
				proficiencyBonus: 6,
				level: 17,
				maxHp: 90,
				expectArcaneJoltDice: "4d6",
				expectImprovedDefender: true,
			}),
		],
	},
	{
		level: 20,
		name: /^steel defender$/i,
		kind: "passive",
		effects: [
			sourceQualifiedFeature("Steel Defender", 3),
			defenderProjection({
				proficiencyBonus: 6,
				level: 20,
				maxHp: 105,
				expectArcaneJoltDice: "4d6",
				expectImprovedDefender: true,
			}),
		],
	},
	{
		level: 5,
		name: /^extra attack$/i,
		kind: "passive",
		effects: [
			sourceQualifiedFeature("Extra Attack", 5),
			{kind: "featureCalculation", property: "hasExtraAttack", exact: true},
			{kind: "featureCalculation", property: "attacksPerAction", exact: 2},
			{kind: "featureCalculation", property: "efaBattleSmithExtraAttackFeatureUid", exact: EXTRA_ATTACK_UID},
			{
				kind: "featureCompanionProjection",
				ownerUid: STEEL_DEFENDER_UID,
				checks: [
					{path: "rules.commandPolicy.commandMethods", contains: "replaceOneAttack"},
				],
			},
		],
	},
	{
		level: 9,
		untilLevel: 14,
		name: /^arcane jolt$/i,
		kind: "passive",
		effects: [
			sourceQualifiedFeature("Arcane Jolt", 9),
			{kind: "featureCalculation", property: "hasEfaArcaneJolt", exact: true},
			{kind: "featureCalculation", property: "efaArcaneJoltFeatureUid", exact: ARCANE_JOLT_UID},
			{kind: "featureCalculation", property: "efaArcaneJoltDamage", exact: "2d6"},
			{kind: "featureCalculation", property: "efaArcaneJoltHealing", exact: "2d6"},
			{kind: "featureCalculationDerivedFrom", property: "efaArcaneJoltUses", equals: "abilityMod", ability: "int"},
			{kind: "featureCalculation", property: "efaArcaneJoltRecharge", exact: "longRest"},
			{kind: "featureCalculation", property: "efaArcaneJoltOncePerTurn", exact: true},
			{kind: "stateCall", method: "getEfaArcaneJoltStatus", path: "available", exact: true},
			{kind: "stateCall", method: "getEfaArcaneJoltStatus", path: "featureUid", exact: ARCANE_JOLT_UID},
			{kind: "stateCall", method: "getEfaArcaneJoltStatus", path: "classUid", exact: BATTLE_SMITH_CLASS_UID},
			{kind: "stateCall", method: "getEfaArcaneJoltStatus", path: "subclassUid", exact: BATTLE_SMITH_SUBCLASS_UID},
			{kind: "stateCall", method: "getEfaArcaneJoltStatus", path: "oncePerTurn", exact: true},
			{kind: "stateCall", method: "getEfaArcaneJoltStatus", path: "damageDice", exact: "2d6"},
			{kind: "stateCall", method: "getEfaArcaneJoltStatus", path: "healingDice", exact: "2d6"},
			{kind: "stateCall", method: "getEfaArcaneJoltStatus", path: "healingRangeFeet", exact: 30},
			{kind: "longRestRestores", resource: "Arcane Jolt", toMax: true},
		],
	},
	{
		level: 15,
		name: /^improved defender$/i,
		kind: "passive",
		effects: [
			sourceQualifiedFeature("Improved Defender", 15),
			{kind: "featureCalculation", property: "hasEfaImprovedDefender", exact: true},
			{kind: "featureCalculation", property: "efaImprovedDefenderFeatureUid", exact: IMPROVED_DEFENDER_UID},
			{kind: "featureCalculation", property: "efaImprovedDefenderArcaneJoltDice", exact: "4d6"},
			{kind: "featureCalculation", property: "efaImprovedDefenderDeflectAttackDamageDice", exact: "1d4"},
			{kind: "featureCalculationDerivedFrom", property: "efaImprovedDefenderDeflectAttackDamageBonus", equals: "abilityMod", ability: "int"},
			{kind: "featureCalculation", property: "efaImprovedDefenderDeflectAttackDamageType", exact: "force"},
			{kind: "stateCall", method: "getEfaArcaneJoltStatus", path: "damageDice", exact: "4d6"},
			{kind: "stateCall", method: "getEfaArcaneJoltStatus", path: "healingDice", exact: "4d6"},
			{
				kind: "featureCompanionProjection",
				ownerUid: STEEL_DEFENDER_UID,
				excludedOwnerUids: [TCE_STEEL_DEFENDER_UID, RHW_REANIMATED_COMPANION_UID],
				checks: [
					{path: "rules.improvedDefender.available", exact: true},
					{path: "rules.improvedDefender.armorClassBonus", exact: 0},
					{path: "rules.improvedDefender.arcaneJoltDice", exact: "4d6"},
					{path: "rules.reactions.deflectAttack.improvedDamage.dice", exact: "1d4"},
					{path: "rules.reactions.deflectAttack.improvedDamage.flat", equalsPath: "context.intelligenceModifier"},
					{path: "rules.reactions.deflectAttack.improvedDamage.type", exact: "force"},
					{path: "matchesResolved.ac", exact: true},
				],
			},
		],
	},
];

describeCharacter({
	preset: PRESET_FULL_EFA_BATTLE_SMITH_ARTIFICER,
	displayName: "EFA Battle Smith Artificer",
	midTierTimeoutMs: 300_000,
	featureCompanion: {
		identity: {
			ownerUid: STEEL_DEFENDER_UID,
			name: "Steel Defender",
			source: "EFA",
		},
		setup: {
			ownerUid: STEEL_DEFENDER_UID,
			nickname: "Aegis",
			appearance: "A compact iron hound with a blue-glass arcane core.",
			locomotion: "fourLegs",
			deferOnce: true,
		},
		l5Operation: {
			operation: "forceEmpoweredRend",
			commandMethod: "bonusAction",
			expectedOperationUid: "Force-Empowered Rend|Steel Defender|EFA",
		},
		lifecycle: {
			deathAndRevival: {
				spellSlotLevel: 1,
				probeUnknownLegacyTiming: true,
			},
			replacement: {
				toolUid: "Smith's Tools|XPHB",
				excludedToolUids: ["Smith's Tools|PHB"],
			},
			vanishedState: true,
			pdfExport: true,
			isolationCompanions: [
				{
					id: "m8b-tce-steel-defender",
					name: "Steel Defender",
					source: "TCE",
					ownerUid: TCE_STEEL_DEFENDER_UID,
				},
				{
					id: "m8b-rhw-reanimated-companion",
					name: "Reanimated Companion",
					source: "RHW",
					ownerUid: RHW_REANIMATED_COMPANION_UID,
				},
				{
					id: "m8b-name-only-steel-defender",
					name: "Steel Defender",
					source: "EFA",
				},
			],
		},
	},
	signatureToggleSkip: {
		skip: true,
		reason: "Battle Smith has no persistent L5 stance; Battle Ready and Steel Defender operations are passive/transactional mechanics",
	},
	midTierLoadout: [
		{name: "Longsword", source: "XPHB", equipped: true},
		{name: "Sun Blade", source: "XDMG", attune: true},
	],
	usage: {
		atLevel: 9,
		castSpellSlotLevel: 1,
		useResourceName: "Arcane Jolt",
		attackName: /sun blade/i,
		expectLongRestRestores: true,
		skillRoll: {name: "Arcana", expectBonusAtLeast: 2},
		shortRestRestores: {
			skip: true,
			reason: "Battle Smith's named pools (Repair and Arcane Jolt) recharge on a long rest, not a short rest",
		},
		concentrationCheck: {castSpell: "Heroism", thenAction: "damage", expectActive: false},
		deathSaves: true,
		applyCondition: {name: "poisoned"},
		featAbility: {
			skip: true,
			reason: "The deterministic core build takes ASIs and no active feat; feat UI is outside this subclass milestone",
		},
	},
	milestones: {
		1: {totalLevel: 1, proficiencyBonus: 2, spellSlots: {1: 2}},
		3: {totalLevel: 3, proficiencyBonus: 2, spellSlots: {1: 3}},
		5: {totalLevel: 5, proficiencyBonus: 3, spellSlots: {1: 4, 2: 2}},
		11: {
			totalLevel: 11,
			proficiencyBonus: 4,
			spellSlots: {1: 4, 2: 3, 3: 3},
			expectResources: {"Arcane Jolt": 1},
		},
		17: {
			totalLevel: 17,
			proficiencyBonus: 6,
			spellSlots: {1: 4, 2: 3, 3: 3, 4: 3, 5: 1},
			expectResources: {"Arcane Jolt": 1},
		},
		20: {
			totalLevel: 20,
			proficiencyBonus: 6,
			spellSlots: {1: 4, 2: 3, 3: 3, 4: 3, 5: 2},
			expectResources: {"Arcane Jolt": 1},
		},
	},
	megaCheckpoints: [3, 5, 11, 17, 20],
	featureMatrixDedicatedOnly: true,
	featuresMatrix: BATTLE_SMITH_FEATURES_MATRIX,
});

/**
 * Comprehensive standard mapping:
 *  #1 L1 factory build; #2 L3 exact subclass + setup/card; #3 L5 Extra
 *  Attack/half-caster slots/Rend replacement; #4 Longsword + Sun Blade
 *  loadout; #5 explicit no-stance skip; #6 milestone walk 3/5/11/17/20;
 *  #7 slot spend; #8 Arcane Jolt spend; #9 Sun Blade attack; #10 long-rest
 *  slot restore; #11 Arcana roll; #12 explicit no-short-rest-pool skip;
 *  #13 Heroism concentration; #14 death saves; #15 poisoned condition;
 *  #16 explicit no-active-feat skip; #17 export round-trip.
 *  M8B opt-in companion lifecycle extensions additionally cover exact
 *  source-owned death/revival, one-hour timing, owner-death vanishing,
 *  Long Rest replacement/undo, lifecycle export/import, and PDF rendering.
 *
 *  #18 N/A: this is an exact single-class EFA build, not a multiclass spec.
 *  #19 N/A: EFA Artificer has no TGTT Specialty progression.
 *  #20 N/A: EFA Artificer does not receive the XPHB Weapon Mastery picker.
 *  #21 N/A: Battle Smith adds no Battle Tactic/Metamagic/Invocation-style
 *      class-option picker; its required companion setup is covered directly.
 *  #22 every non-cinematic matrix row above has one or more EffectChecks.
 */
