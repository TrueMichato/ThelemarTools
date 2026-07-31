import {describeCharacter} from "../utils/characterSpecFactory";
import {PRESET_FULL_XPHB_DEVOTION_PALADIN} from "../utils/characterBuilder";
import type {EffectCheck, FeatureCheck} from "../utils/comprehensiveBuildHelpers";
import {buildWeaponMasteryChecks} from "../utils/tgttFeaturePools";

describeCharacter({
	preset: PRESET_FULL_XPHB_DEVOTION_PALADIN,
	displayName: "Oath of Devotion Paladin (XPHB)",
	midTierLoadout: [
		{name: "Longsword", source: "XPHB", equipped: true},
		{name: "Shield", source: "XPHB", equipped: true},
	],
	usage: {
		atLevel: 5,
		castSpellSlotLevel: 1,
		useResourceName: "Channel Divinity",
		expectLongRestRestores: true,
		attackName: /unarmed strike|longsword/i,
		skillRoll: {name: "Athletics"},
		shortRestRestores: {resourceName: "Channel Divinity", spend: 2, expectAfter: 1},
		concentrationCheck: {castSpell: "Bless", thenAction: "damage", expectActive: false},
		deathSaves: true,
		applyCondition: {name: "Restrained"},
		featAbility: {skip: true},
	},
	milestones: {
		1: {totalLevel: 1, minMaxHp: 10, spellSlots: {1: 2}},
		3: {totalLevel: 3, minMaxHp: 22, spellSlots: {1: 3}, expectResources: {"Channel Divinity": 2}},
		5: {totalLevel: 5, minMaxHp: 38, spellSlots: {2: 2}},
		11: {totalLevel: 11, minMaxHp: 75, spellSlots: {3: 3}, expectResources: {"Channel Divinity": 3}},
		17: {totalLevel: 17, minMaxHp: 115, spellSlots: {5: 1}},
		20: {totalLevel: 20, minMaxHp: 130, spellSlots: {5: 2}, expectResources: {"Holy Nimbus": 1}},
	},
	featuresMatrix: <FeatureCheck[]>[
		...buildWeaponMasteryChecks(["Club", "Dagger"], 1),
		{
			level: 1,
			name: /spellcasting/i,
			kind: "passive",
			effects: <EffectCheck[]>[
				{kind: "spellSlots", level: 1, min: 2},
				{kind: "rollInitiative"},
			],
		},
		{
			level: 1,
			name: /lay on hands/i,
			kind: "passive",
			effects: [{kind: "featureCalculation", property: "layOnHandsPool", min: 5}],
		},
		{
			level: 2,
			name: /fighting style/i,
			kind: "pick",
			skip: true,
			skipReason: "CS-BUG-017",
			pickedCount: 1,
			pickedFrom: [/defense/i, /dueling/i, /great weapon fighting/i, /protection/i, /blessed warrior/i],
		},
		{
			level: 2,
			name: /paladin'?s? smite/i,
			kind: "passive",
			effects: [{kind: "featureCalculation", property: "smiteBaseDamage", exact: "2d8"}],
		},
		{
			level: 3,
			name: "Channel Divinity",
			kind: "resource",
			resourceMax: [2, 3],
			effects: [{kind: "shortRestRestores", resource: "Channel Divinity"}],
		},
		{
			level: 3,
			name: /oath of devotion spells/i,
			kind: "passive",
			effects: [
				{kind: "spellInList", spell: "Protection from Evil and Good"},
				{kind: "spellInList", spell: "Shield of Faith"},
			],
		},
		{
			level: 3,
			name: /^sacred weapon$/i,
			kind: "passive",
			effects: [{
				kind: "weaponScopedState",
				feature: "Sacred Weapon",
				attackBonusMin: 1,
				alternateDamageType: "radiant",
			}],
		},
		{
			level: 5,
			name: /oath of devotion spells/i,
			kind: "passive",
			effects: [
				{kind: "spellInList", spell: "Aid"},
				{kind: "spellInList", spell: "Zone of Truth"},
			],
		},
		{level: 5, name: /extra attack/i, kind: "passive"},
		{
			level: 6,
			name: /aura of protection/i,
			kind: "passive",
			effects: [
				{kind: "saveBonus", ability: "str", min: 1},
				{kind: "saveBonus", ability: "dex", min: 1},
				{kind: "saveBonus", ability: "con", min: 1},
				{kind: "saveBonus", ability: "int", min: 1},
				{kind: "saveBonus", ability: "wis", min: 1},
				{kind: "saveBonus", ability: "cha", min: 1},
			],
		},
		{
			level: 7,
			name: /^aura of devotion$/i,
			kind: "passive",
			effects: [{kind: "conditionImmunity", condition: "charmed"}],
		},
		{
			level: 9,
			name: /oath of devotion spells/i,
			kind: "passive",
			effects: [
				{kind: "spellInList", spell: "Beacon of Hope"},
				{kind: "spellInList", spell: "Dispel Magic"},
			],
		},
		{level: 9, name: /abjure foes/i, kind: "passive"},
		{
			level: 10,
			name: /aura of courage/i,
			kind: "passive",
			effects: [{kind: "conditionImmunity", condition: "frightened"}],
		},
		{
			level: 11,
			name: /radiant strikes/i,
			kind: "passive",
			effects: [{kind: "featureCalculation", property: "radiantStrikesDamage", exact: "1d8"}],
		},
		{
			level: 13,
			name: /oath of devotion spells/i,
			kind: "passive",
			effects: [
				{kind: "spellInList", spell: "Freedom of Movement"},
				{kind: "spellInList", spell: "Guardian of Faith"},
			],
		},
		{level: 14, name: /restoring touch/i, kind: "passive"},
		{
			level: 15,
			name: /^smite of protection$/i,
			kind: "passive",
			effects: [{
				kind: "spellCastGrantsCover",
				spell: "Divine Smite",
				source: "XPHB",
				acDelta: 2,
				saveAbility: "dex",
				saveDelta: 2,
			}],
		},
		{
			level: 17,
			name: /oath of devotion spells/i,
			kind: "passive",
			effects: [
				{kind: "spellInList", spell: "Commune"},
				{kind: "spellInList", spell: "Flame Strike"},
			],
		},
		{level: 18, name: /aura expansion/i, kind: "passive"},
		{
			level: 20,
			name: /^holy nimbus$/i,
			kind: "passive",
			effects: [
				{
					kind: "activeAuraMechanics",
					feature: "Holy Nimbus",
					damageType: "radiant",
					damageMin: 0,
					conditionalRollType: "save:wis",
					conditionalIncludes: "Fiend or Undead",
				},
				{kind: "restoreFeatureUseWithSpellSlot", feature: "Holy Nimbus", slotLevel: 5},
				{kind: "longRestRestoresFeatureUses", feature: "Holy Nimbus"},
			],
		},
	],
});
