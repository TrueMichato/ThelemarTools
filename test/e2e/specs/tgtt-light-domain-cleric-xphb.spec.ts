import {describeCharacter} from "../utils/characterSpecFactory";
import {PRESET_FULL_XPHB_LIGHT_CLERIC} from "../utils/characterBuilder";
import type {EffectCheck, FeatureCheck} from "../utils/comprehensiveBuildHelpers";

describeCharacter({
	preset: PRESET_FULL_XPHB_LIGHT_CLERIC,
	displayName: "Light Domain Cleric (XPHB)",
	midTierLoadout: [
		{name: "Cloak of Protection", source: "XDMG", attune: true},
	],
	usage: {
		atLevel: 6,
		castSpellSlotLevel: 1,
		useResourceName: "Channel Divinity",
		expectLongRestRestores: true,
		attackName: /unarmed strike/i,
		skillRoll: {name: "Religion"},
		concentrationCheck: {castSpell: "Bless", thenAction: "damage", expectActive: false},
		deathSaves: true,
		applyCondition: {name: "Restrained"},
		featAbility: {skip: true},
	},
	milestones: {
		1: {totalLevel: 1, spellSlots: {1: 2}},
		3: {totalLevel: 3, spellSlots: {2: 2}},
		5: {totalLevel: 5, spellSlots: {3: 2}, expectResources: {"Channel Divinity": 1}},
		11: {totalLevel: 11, spellSlots: {6: 1}},
		17: {totalLevel: 17, spellSlots: {9: 1}},
		20: {totalLevel: 20, spellSlots: {9: 1}},
	},
	featuresMatrix: <FeatureCheck[]>[
		{
			level: 1,
			name: /spellcasting/i,
			kind: "passive",
			effects: <EffectCheck[]>[
				{kind: "spellSlots", level: 1, min: 2},
			],
		},
		{
			level: 2,
			name: /^channel divinity$/i,
			kind: "passive",
			effects: [{kind: "shortRestRestoresFeatureUses", feature: "Channel Divinity"}],
		},
		{
			level: 3,
			name: /light domain spells/i,
			kind: "passive",
			effects: [
				{kind: "spellInList", spell: "Burning Hands"},
				{kind: "spellInList", spell: "Faerie Fire"},
				{kind: "spellInList", spell: "Scorching Ray"},
				{kind: "spellInList", spell: "See Invisibility"},
			],
		},
		{
			level: 3,
			name: /^radiance of the dawn$/i,
			kind: "passive",
			effects: [
				{kind: "shortRestRestoresFeatureUses", feature: "Channel Divinity"},
				{kind: "pickActivatable", matchAny: [/^Radiance of the Dawn$/i]},
			],
		},
		{
			level: 3,
			name: /^warding flare$/i,
			kind: "passive",
			effects: [
				{kind: "longRestRestoresFeatureUses", feature: "Warding Flare"},
				{kind: "pickActivatable", matchAny: [/^Warding Flare$/i]},
			],
		},
		{
			level: 5,
			name: /light domain spells/i,
			kind: "passive",
			effects: [
				{kind: "spellInList", spell: "Daylight"},
				{kind: "spellInList", spell: "Fireball"},
			],
		},
		{
			level: 6,
			name: /improved warding flare/i,
			kind: "passive",
			effects: [{kind: "shortRestRestoresFeatureUses", feature: "Warding Flare"}],
		},
		{
			level: 7,
			name: /light domain spells/i,
			kind: "passive",
			effects: [
				{kind: "spellInList", spell: "Arcane Eye"},
				{kind: "spellInList", spell: "Wall of Fire"},
			],
		},
		{
			level: 9,
			name: /light domain spells/i,
			kind: "passive",
			effects: [
				{kind: "spellInList", spell: "Flame Strike"},
				{kind: "spellInList", spell: "Scrying"},
			],
		},
		{
			level: 17,
			name: /corona of light/i,
			kind: "passive",
			effects: [
				{kind: "longRestRestoresFeatureUses", feature: "Corona of Light"},
				{kind: "pickActivatable", matchAny: [/^Corona of Light$/i]},
			],
		},
	],
});
