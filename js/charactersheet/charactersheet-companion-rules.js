/**
 * Pure, declarative feature-companion rules.
 *
 * Descriptors contain JSON-safe data only. Resolvers accept already-derived
 * summoner context and never reach into CharacterSheetState or the DOM.
 */

const COMPANION_FEATURE_UIDS = Object.freeze({
	EFA_STEEL_DEFENDER: "Steel Defender|Artificer|EFA|Battle Smith|EFA|3|EFA",
	TCE_STEEL_DEFENDER: "Steel Defender|Artificer|TCE|Battle Smith|TCE|3|TCE",
});

const ABILITIES = Object.freeze(["str", "dex", "con", "int", "wis", "cha"]);
const STEEL_DEFENDER_ABILITY_SCORES = Object.freeze({
	str: 14,
	dex: 12,
	con: 14,
	int: 4,
	wis: 10,
	cha: 6,
});

function deepFreeze (value) {
	if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
	Object.values(value).forEach(deepFreeze);
	return Object.freeze(value);
}

const COMPANION_RULES = deepFreeze({
	[COMPANION_FEATURE_UIDS.EFA_STEEL_DEFENDER]: {
		schemaVersion: 1,
		identity: {
			name: "Steel Defender",
			source: "EFA",
			companionUid: "Steel Defender|EFA",
			classUid: "Artificer|EFA",
			subclassUid: "Battle Smith|Artificer|EFA|EFA",
			featureUid: COMPANION_FEATURE_UIDS.EFA_STEEL_DEFENDER,
		},
		minimumArtificerLevel: 3,
		requiredSummonerContext: [
			"artificerLevel",
			"intelligenceModifier",
			"proficiencyBonus",
			"spellAttackBonus",
		],
		statistics: {
			size: ["M"],
			creatureType: "construct",
			abilityScores: STEEL_DEFENDER_ABILITY_SCORES,
			speed: {walk: 40},
			senses: {darkvision: 60},
			damageImmunities: ["poison"],
			conditionImmunities: ["charmed", "exhaustion", "poisoned"],
			languages: {understands: "summonerKnownLanguages", canSpeak: false},
			hitPoints: {formula: "5 + 5 * artificerLevel"},
			hitDice: {die: "d8", countFormula: "artificerLevel"},
			armorClass: {
				formula: "12 + intelligenceModifier",
				improvedDefenderBonus: 0,
			},
			proficiencyPolicy: {
				abilityChecks: "all",
				savingThrows: "all",
				bonusFormula: "proficiencyBonus",
			},
			passivePerception: {formula: "10", authoredValue: 10},
		},
		actions: {
			forceEmpoweredRend: {
				name: "Force-Empowered Rend",
				actionType: "action",
				attackType: "meleeSpellAttack",
				attackBonusFormula: "spellAttackBonus",
				reachFeet: 5,
				damage: {
					dice: "1d8",
					flatFormula: "2 + intelligenceModifier",
					type: "force",
				},
			},
			repair: {
				name: "Repair",
				actionType: "action",
				rangeFeet: 5,
				targets: ["self", "construct", "object"],
				healing: {dice: "2d8", flatFormula: "intelligenceModifier"},
				uses: {max: 3, recharge: "daily"},
			},
		},
		reactions: {
			deflectAttack: {
				name: "Deflect Attack",
				actionType: "reaction",
				rangeFeet: 5,
				requiresVisibleAttacker: true,
				requiresDifferentProtectedTarget: true,
				effect: {attackRollMode: "disadvantage"},
				improvedDamage: {
					unlockArtificerLevel: 15,
					dice: "1d4",
					flatFormula: "intelligenceModifier",
					type: "force",
				},
			},
		},
		commandPolicy: {
			turnTiming: "duringSummonerTurn",
			movement: "autonomous",
			reaction: "autonomous",
			defaultAction: "dodge",
			commandMethods: [
				{cost: "bonusAction", permits: "anyAction"},
				{
					cost: "replaceOneAttack",
					unlockArtificerLevel: 5,
					permits: "forceEmpoweredRend",
				},
			],
			whileSummonerIncapacitated: {
				actsAutonomously: true,
				actionRestriction: null,
			},
		},
		lifecycle: {
			onSummonerDeath: "vanishes",
			revival: {
				deathWindow: "1 hour",
				actionType: "magicAction",
				requiresTouch: true,
				spellSlot: {minimumLevel: 1, expend: 1},
				returnDelay: "1 minute",
				hitPointsRestored: "all",
			},
			replacement: {
				timing: "finishLongRest",
				requiresToolUid: "Smith's Tools|XPHB",
				toolRequirement: "inHand",
				previousDefenderFate: "vanishes",
			},
		},
		restPolicy: {
			shortRest: {automaticChanges: []},
			longRest: {
				mayCreateReplacement: true,
				arcaneJoltRecharge: "all",
			},
			repairRecharge: "daily",
		},
		arcaneJolt: {
			unlockArtificerLevel: 9,
			triggerSources: ["summonerMagicWeaponHit", "companionHit"],
			effects: ["forceDamage", "healing"],
			baseDice: "2d6",
			improvedDice: "4d6",
			improvedArtificerLevel: 15,
			healingRangeFeet: 30,
			healingTargets: ["creature", "object"],
			usesFormula: "max(1, intelligenceModifier)",
			limit: "oncePerTurn",
			recharge: "longRest",
		},
		improvedDefender: {
			unlockArtificerLevel: 15,
			armorClassBonus: 0,
			arcaneJoltDice: "4d6",
			deflectAttackDamage: {
				dice: "1d4",
				flatFormula: "intelligenceModifier",
				type: "force",
			},
		},
	},
	[COMPANION_FEATURE_UIDS.TCE_STEEL_DEFENDER]: {
		schemaVersion: 1,
		identity: {
			name: "Steel Defender",
			source: "TCE",
			companionUid: "Steel Defender|TCE",
			classUid: "Artificer|TCE",
			subclassUid: "Battle Smith|Artificer|TCE|TCE",
			featureUid: COMPANION_FEATURE_UIDS.TCE_STEEL_DEFENDER,
		},
		minimumArtificerLevel: 3,
		requiredSummonerContext: [
			"artificerLevel",
			"intelligenceModifier",
			"proficiencyBonus",
			"spellAttackBonus",
		],
		statistics: {
			size: ["M"],
			creatureType: "construct",
			abilityScores: STEEL_DEFENDER_ABILITY_SCORES,
			speed: {walk: 40},
			senses: {darkvision: 60},
			damageImmunities: ["poison"],
			conditionImmunities: ["charmed", "exhaustion", "poisoned"],
			languages: {understands: "summonerSpokenLanguages", canSpeak: false},
			hitPoints: {formula: "2 + intelligenceModifier + 5 * artificerLevel"},
			hitDice: {die: "d8", countFormula: "artificerLevel"},
			armorClass: {
				formula: "15",
				improvedDefenderBonus: 2,
				improvedArtificerLevel: 15,
			},
			proficiencyPolicy: {
				abilityChecks: "specificSkills",
				savingThrows: "dexterityAndConstitution",
			},
			savingThrows: {
				dex: "1 + proficiencyBonus",
				con: "2 + proficiencyBonus",
			},
			skills: {
				athletics: "2 + proficiencyBonus",
				perception: "2 * proficiencyBonus",
			},
			passivePerception: {formula: "10 + 2 * proficiencyBonus"},
		},
		actions: {
			forceEmpoweredRend: {
				name: "Force-Empowered Rend",
				actionType: "action",
				attackType: "meleeWeaponAttack",
				attackBonusFormula: "spellAttackBonus",
				reachFeet: 5,
				damage: {
					dice: "1d8",
					flatFormula: "proficiencyBonus",
					type: "force",
				},
			},
			repair: {
				name: "Repair",
				actionType: "action",
				rangeFeet: 5,
				targets: ["self", "construct", "object"],
				healing: {dice: "2d8", flatFormula: "proficiencyBonus"},
				uses: {max: 3, recharge: "daily"},
			},
		},
		reactions: {
			deflectAttack: {
				name: "Deflect Attack",
				actionType: "reaction",
				rangeFeet: 5,
				requiresVisibleAttacker: true,
				requiresDifferentProtectedTarget: true,
				effect: {attackRollMode: "disadvantage"},
				improvedDamage: {
					unlockArtificerLevel: 15,
					dice: "1d4",
					flatFormula: "intelligenceModifier",
					type: "force",
				},
			},
		},
		commandPolicy: {
			turnTiming: "immediatelyAfterSummonerTurn",
			initiative: "sharesSummonerInitiative",
			movement: "autonomous",
			reaction: "autonomous",
			defaultAction: "dodge",
			commandMethods: [{cost: "bonusAction", permits: "anyAction"}],
			whileSummonerIncapacitated: {
				actsAutonomously: true,
				actionRestriction: null,
			},
		},
		lifecycle: {
			onSummonerDeath: "perishes",
			mending: {healingDice: "2d6"},
			revival: {
				deathWindow: "1 hour",
				actionType: "action",
				rangeFeet: 5,
				requiresToolUid: "Smith's Tools|PHB",
				spellSlot: {minimumLevel: 1, expend: 1},
				returnDelay: "1 minute",
				hitPointsRestored: "all",
			},
			replacement: {
				timing: "finishLongRest",
				requiresToolUid: "Smith's Tools|PHB",
				toolRequirement: "carried",
				previousDefenderFate: "perishes",
			},
		},
		restPolicy: {
			shortRest: {automaticChanges: []},
			longRest: {
				mayCreateReplacement: true,
				arcaneJoltRecharge: "all",
			},
			repairRecharge: "daily",
		},
		arcaneJolt: {
			unlockArtificerLevel: 9,
			triggerSources: ["summonerMagicWeaponHit", "companionHit"],
			effects: ["forceDamage", "healing"],
			baseDice: "2d6",
			improvedDice: "4d6",
			improvedArtificerLevel: 15,
			healingRangeFeet: 30,
			healingTargets: ["creature", "object"],
			usesFormula: "max(1, intelligenceModifier)",
			limit: "oncePerTurn",
			recharge: "longRest",
		},
		improvedDefender: {
			unlockArtificerLevel: 15,
			armorClassBonus: 2,
			arcaneJoltDice: "4d6",
			deflectAttackDamage: {
				dice: "1d4",
				flatFormula: "intelligenceModifier",
				type: "force",
			},
		},
	},
});

function cloneJson (value) {
	return JSON.parse(JSON.stringify(value));
}

function getDescriptorInternal (featureUid) {
	if (typeof featureUid !== "string") return null;
	if (!Object.prototype.hasOwnProperty.call(COMPANION_RULES, featureUid)) return null;
	return COMPANION_RULES[featureUid];
}

function normalizeContext (context) {
	const out = {};
	for (const key of ["artificerLevel", "intelligenceModifier", "proficiencyBonus", "spellAttackBonus"]) {
		const value = Number(context?.[key]);
		if (!Number.isFinite(value)) throw new TypeError(`Companion rules require a finite ${key}.`);
		out[key] = value;
	}
	out.artificerLevel = Math.max(0, Math.floor(out.artificerLevel));
	out.proficiencyBonus = Math.max(0, Math.floor(out.proficiencyBonus));
	return out;
}

function getAbilityModifier (score) {
	return Math.floor((score - 10) / 2);
}

function getBaseAbilityModifiers (abilityScores) {
	return Object.fromEntries(ABILITIES.map(ability => [ability, getAbilityModifier(abilityScores[ability])]));
}

function addBonusToAbilities (abilityModifiers, bonus) {
	return Object.fromEntries(ABILITIES.map(ability => [ability, abilityModifiers[ability] + bonus]));
}

function getArcaneJolt (descriptor, context) {
	const available = context.artificerLevel >= descriptor.arcaneJolt.unlockArtificerLevel;
	const isImproved = context.artificerLevel >= descriptor.arcaneJolt.improvedArtificerLevel;
	return {
		available,
		unlockArtificerLevel: descriptor.arcaneJolt.unlockArtificerLevel,
		triggerSources: [...descriptor.arcaneJolt.triggerSources],
		oncePerTurn: true,
		damage: available ? {dice: isImproved ? descriptor.arcaneJolt.improvedDice : descriptor.arcaneJolt.baseDice, type: "force"} : null,
		healing: available ? {
			dice: isImproved ? descriptor.arcaneJolt.improvedDice : descriptor.arcaneJolt.baseDice,
			rangeFeet: descriptor.arcaneJolt.healingRangeFeet,
			targets: [...descriptor.arcaneJolt.healingTargets],
		} : null,
		uses: {
			max: available ? Math.max(1, context.intelligenceModifier) : 0,
			recharge: descriptor.arcaneJolt.recharge,
		},
	};
}

function getCommandPolicy (descriptor, context) {
	return {
		...cloneJson(descriptor.commandPolicy),
		commandMethods: descriptor.commandPolicy.commandMethods
			.filter(method => context.artificerLevel >= (method.unlockArtificerLevel || 0))
			.map(cloneJson),
	};
}

function getCommonResolution (descriptor, context) {
	const abilityScores = cloneJson(descriptor.statistics.abilityScores);
	const abilityModifiers = getBaseAbilityModifiers(abilityScores);
	const improvedAvailable = context.artificerLevel >= descriptor.improvedDefender.unlockArtificerLevel;
	const improvedDeflectDamage = improvedAvailable
		? {
			dice: descriptor.improvedDefender.deflectAttackDamage.dice,
			flat: context.intelligenceModifier,
			type: descriptor.improvedDefender.deflectAttackDamage.type,
		}
		: null;

	return {
		schemaVersion: descriptor.schemaVersion,
		identity: cloneJson(descriptor.identity),
		summonerContext: {...context},
		statistics: {
			size: [...descriptor.statistics.size],
			creatureType: descriptor.statistics.creatureType,
			abilityScores,
			abilityModifiers,
			speed: cloneJson(descriptor.statistics.speed),
			senses: cloneJson(descriptor.statistics.senses),
			damageImmunities: [...descriptor.statistics.damageImmunities],
			conditionImmunities: [...descriptor.statistics.conditionImmunities],
			languages: cloneJson(descriptor.statistics.languages),
			hitDice: {count: context.artificerLevel, die: descriptor.statistics.hitDice.die},
			proficiencyPolicy: cloneJson(descriptor.statistics.proficiencyPolicy),
		},
		actions: {
			forceEmpoweredRend: {
				...cloneJson(descriptor.actions.forceEmpoweredRend),
				attackBonus: context.spellAttackBonus,
			},
			repair: {
				...cloneJson(descriptor.actions.repair),
				uses: cloneJson(descriptor.actions.repair.uses),
			},
		},
		reactions: {
			deflectAttack: {
				...cloneJson(descriptor.reactions.deflectAttack),
				improvedDamage: improvedDeflectDamage,
			},
		},
		commandPolicy: getCommandPolicy(descriptor, context),
		lifecycle: cloneJson(descriptor.lifecycle),
		restPolicy: cloneJson(descriptor.restPolicy),
		arcaneJolt: getArcaneJolt(descriptor, context),
		improvedDefender: {
			available: improvedAvailable,
			unlockArtificerLevel: descriptor.improvedDefender.unlockArtificerLevel,
			armorClassBonus: improvedAvailable ? descriptor.improvedDefender.armorClassBonus : 0,
			arcaneJoltDice: improvedAvailable ? descriptor.improvedDefender.arcaneJoltDice : null,
			deflectAttackDamage: improvedDeflectDamage,
		},
	};
}

function resolveEfaSteelDefender (descriptor, context) {
	const out = getCommonResolution(descriptor, context);
	out.statistics.maxHp = 5 + (5 * context.artificerLevel);
	out.statistics.ac = 12 + context.intelligenceModifier;
	out.statistics.abilityChecks = addBonusToAbilities(out.statistics.abilityModifiers, context.proficiencyBonus);
	out.statistics.savingThrows = addBonusToAbilities(out.statistics.abilityModifiers, context.proficiencyBonus);
	out.statistics.skills = {};
	out.statistics.passivePerception = descriptor.statistics.passivePerception.authoredValue;
	out.actions.forceEmpoweredRend.damage = {
		dice: descriptor.actions.forceEmpoweredRend.damage.dice,
		flat: 2 + context.intelligenceModifier,
		type: descriptor.actions.forceEmpoweredRend.damage.type,
	};
	out.actions.repair.healing = {
		dice: descriptor.actions.repair.healing.dice,
		flat: context.intelligenceModifier,
	};
	return out;
}

function resolveTceSteelDefender (descriptor, context) {
	const out = getCommonResolution(descriptor, context);
	const improvedAcBonus = out.improvedDefender.armorClassBonus;
	out.statistics.maxHp = 2 + context.intelligenceModifier + (5 * context.artificerLevel);
	out.statistics.ac = 15 + improvedAcBonus;
	out.statistics.abilityChecks = {...out.statistics.abilityModifiers};
	out.statistics.savingThrows = {
		...out.statistics.abilityModifiers,
		dex: out.statistics.abilityModifiers.dex + context.proficiencyBonus,
		con: out.statistics.abilityModifiers.con + context.proficiencyBonus,
	};
	out.statistics.skills = {
		athletics: out.statistics.abilityModifiers.str + context.proficiencyBonus,
		perception: 2 * context.proficiencyBonus,
	};
	out.statistics.passivePerception = 10 + (2 * context.proficiencyBonus);
	out.actions.forceEmpoweredRend.damage = {
		dice: descriptor.actions.forceEmpoweredRend.damage.dice,
		flat: context.proficiencyBonus,
		type: descriptor.actions.forceEmpoweredRend.damage.type,
	};
	out.actions.repair.healing = {
		dice: descriptor.actions.repair.healing.dice,
		flat: context.proficiencyBonus,
	};
	return out;
}

class CharacterSheetCompanionRules {
	static FEATURE_UIDS = COMPANION_FEATURE_UIDS;
	static REGISTRY = COMPANION_RULES;

	static getRegistry () {
		return cloneJson(COMPANION_RULES);
	}

	static getDescriptor (featureUid) {
		const descriptor = getDescriptorInternal(featureUid);
		return descriptor ? cloneJson(descriptor) : null;
	}

	static resolve (featureUid, summonerContext) {
		const descriptor = getDescriptorInternal(featureUid);
		if (!descriptor) return null;

		const context = normalizeContext(summonerContext);
		switch (featureUid) {
			case COMPANION_FEATURE_UIDS.EFA_STEEL_DEFENDER:
				return resolveEfaSteelDefender(descriptor, context);
			case COMPANION_FEATURE_UIDS.TCE_STEEL_DEFENDER:
				return resolveTceSteelDefender(descriptor, context);
			default:
				return null;
		}
	}
}

globalThis.CharacterSheetCompanionRules = CharacterSheetCompanionRules;

export {
	CharacterSheetCompanionRules,
	COMPANION_FEATURE_UIDS,
	COMPANION_RULES,
};
