/**
 * Pure, declarative feature-companion rules.
 *
 * Descriptors contain JSON-safe data only. Resolvers accept already-derived
 * summoner context and never reach into CharacterSheetState or the DOM.
 */

const COMPANION_FEATURE_UIDS = Object.freeze({
	EFA_STEEL_DEFENDER: "Steel Defender|Artificer|EFA|Battle Smith|EFA|3",
	RHW_REANIMATED_COMPANION: "Reanimated Companion|Artificer|EFA|Reanimator|RHW|3",
	TCE_STEEL_DEFENDER: "Steel Defender|Artificer|TCE|Battle Smith|TCE|3",
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
const REANIMATED_COMPANION_ABILITY_SCORES = Object.freeze({
	str: 11,
	dex: 10,
	con: 16,
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
				attackType: "meleeWeaponAttack",
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
				uses: {max: 3, recharge: "longRest"},
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
			repairRecharge: "longRest",
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
	[COMPANION_FEATURE_UIDS.RHW_REANIMATED_COMPANION]: {
		schemaVersion: 1,
		identity: {
			name: "Reanimated Companion",
			source: "RHW",
			companionUid: "Reanimated Companion|RHW",
			classUid: "Artificer|EFA",
			subclassUid: "Reanimator|Artificer|EFA|RHW",
			featureUid: COMPANION_FEATURE_UIDS.RHW_REANIMATED_COMPANION,
		},
		minimumArtificerLevel: 3,
		requiredSummonerContext: [
			"artificerLevel",
			"intelligenceModifier",
			"proficiencyBonus",
			"spellAttackBonus",
			"spellSaveDc",
		],
		statistics: {
			size: ["M"],
			creatureType: "undead",
			abilityScores: REANIMATED_COMPANION_ABILITY_SCORES,
			speed: {walk: 30},
			senses: {blindsight: 60},
			damageResistances: ["necrotic", "poison"],
			damageImmunities: ["lightning"],
			conditionImmunities: ["charmed", "exhaustion", "poisoned"],
			languages: {understands: "summonerKnownLanguages", canSpeak: false},
			hitPoints: {formula: "5 + 5 * artificerLevel"},
			hitDice: {die: "d8", countFormula: "artificerLevel"},
			armorClass: {formula: "10 + intelligenceModifier"},
			proficiencyBonus: {formula: "proficiencyBonus"},
			spellAttackBonus: {formula: "spellAttackBonus"},
			spellSaveDc: {formula: "spellSaveDc"},
			passivePerception: {formula: "10", authoredValue: 10},
		},
		actions: {
			dreadfulSwipe: {
				name: "Dreadful Swipe",
				actionType: "action",
				attackType: "melee",
				attackBonusFormula: "spellAttackBonus",
				reachFeet: 5,
				damage: {
					dice: "1d4",
					flatFormula: "intelligenceModifier",
					type: "necrotic",
				},
				riders: [{
					id: "preventOpportunityAttacks",
					effect: "targetCannotTakeOpportunityAttacks",
					duration: "untilStartOfTargetNextTurn",
				}],
			},
		},
		traits: {
			deathBurst: {
				name: "Death Burst",
				trigger: "onDeath",
				area: {shape: "emanation", radiusFeet: 10},
				save: {
					ability: "dex",
					dcFormula: "spellSaveDc",
					onSuccess: "halfDamage",
				},
				damage: {
					dice: "2d4",
					flatFormula: "0",
					type: "necrotic",
				},
			},
			lightningAbsorption: {
				name: "Lightning Absorption",
				trigger: "subjectedToLightningDamage",
				damageImmunity: "lightning",
				healing: {formula: "lightningDamageDealt"},
			},
		},
		creationPolicy: {
			actionType: "magicAction",
			manifest: {
				rangeFeet: 5,
				space: "unoccupied",
			},
			toolEligibility: {
				requiresProficiency: true,
				allowed: [
					{kind: "tool", uid: "Tinker's Tools|XPHB"},
					{kind: "toolCategory", uid: "Artisan's Tools|XPHB"},
				],
			},
			freeCreation: {
				uses: 1,
				recharge: "longRest",
			},
			alternatePayment: {
				spellSlot: {minimumLevel: 1, expend: 1},
			},
			maximumActive: 1,
			prohibitedWhileActive: true,
		},
		commandPolicy: {
			turnTiming: "duringSummonerTurn",
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
			duration: {until: "finishLongRest"},
			earlyDismissal: {
				actionType: "magicAction",
				outcome: "harmlessCollapse",
				triggersDeathBurst: false,
			},
			onSummonerDeath: {
				hitPoints: 0,
				outcome: "dies",
				triggersDeathBurst: true,
			},
			onCompanionDeath: {
				triggersDeathBurst: true,
			},
		},
		restPolicy: {
			shortRest: {automaticChanges: []},
			longRest: {
				companionLifecycle: "expires",
				freeCreationRecharge: "all",
			},
		},
		damageRules: {
			necrotic: {
				ignoresResistance: false,
				unlockArtificerLevel: 9,
			},
		},
		modifications: {
			selection: {
				unique: true,
				requiredCountByArtificerLevel: [
					{minimum: 0, maximum: 4, count: 0},
					{minimum: 5, maximum: 8, count: 1},
					{minimum: 9, maximum: 14, count: 2},
					{minimum: 15, maximum: null, count: 3},
				],
			},
			options: {
				arcaneConduit: {
					id: "arcaneConduit",
					name: "Arcane Conduit",
					unlockArtificerLevel: 5,
					castingOrigin: {
						mayCastFromCompanionSpace: true,
						usesSummonerSenses: true,
					},
					damageRider: {
						limit: "oncePerTurn",
						requiresCompanionWithinFeet: 120,
						spellClassUid: "Artificer|EFA",
						spellSchools: ["evocation", "necromancy"],
						trigger: "spellDealsDamage",
						damageRollBonusFormula: "intelligenceModifier",
					},
				},
				ferocity: {
					id: "ferocity",
					name: "Ferocity",
					unlockArtificerLevel: 5,
					dreadfulSwipeDamageDice: "1d6",
				},
				bloated: {
					id: "bloated",
					name: "Bloated",
					unlockArtificerLevel: 9,
					size: ["L"],
					dreadfulSwipePush: {
						distanceFeet: 10,
						maximumTargetSize: "L",
					},
					deathBurstDamageBonusFormula: "intelligenceModifier",
				},
				gaunt: {
					id: "gaunt",
					name: "Gaunt",
					unlockArtificerLevel: 9,
					speed: {walk: 45, climb: "walk"},
					climbing: {
						difficultSurfaces: true,
						ceilings: true,
						requiresAbilityCheck: false,
					},
					fearAura: {
						trigger: "chosenCreatureStartsTurn",
						area: {shape: "emanation", radiusFeet: 10},
						save: {ability: "wis", dcFormula: "spellSaveDc"},
						onFailure: {
							condition: "frightened",
							duration: "untilStartOfCreatureNextTurn",
						},
					},
				},
				moist: {
					id: "moist",
					name: "Moist",
					unlockArtificerLevel: 9,
					speed: {swim: "walk"},
					squeeze: {
						minimumSpaceInches: 1,
						extraMovement: false,
					},
					acidRetaliation: {
						trigger: "hitByAttackRoll",
						attackerMaximumRangeFeet: 10,
						damage: {
							flatFormula: "intelligenceModifier",
							type: "acid",
						},
					},
				},
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

function normalizeFeatureUid (featureUid) {
	if (typeof featureUid !== "string") return null;
	const parts = featureUid.split("|").map(part => part.trim());
	if (parts.length !== 6 && parts.length !== 7) return null;

	const [name, className, classSource, subclassShortName, subclassSource, levelRaw, featureSourceRaw] = parts;
	if (!name || !className || !classSource || !subclassShortName || !subclassSource || !levelRaw) return null;
	if (parts.length === 7 && !featureSourceRaw) return null;

	const level = Number(levelRaw);
	if (!Number.isInteger(level) || level < 0) return null;

	const featureSource = featureSourceRaw || subclassSource;
	const canonicalParts = [name, className, classSource, subclassShortName, subclassSource, level];
	if (featureSource !== subclassSource) canonicalParts.push(featureSource);
	return canonicalParts.join("|");
}

function getDescriptorInternal (featureUid) {
	const canonicalUid = normalizeFeatureUid(featureUid);
	if (!canonicalUid || !Object.prototype.hasOwnProperty.call(COMPANION_RULES, canonicalUid)) return null;
	return {canonicalUid, descriptor: COMPANION_RULES[canonicalUid]};
}

function normalizeContext (descriptor, context) {
	const out = {};
	for (const key of descriptor.requiredSummonerContext) {
		const rawValue = context?.[key];
		if (rawValue == null || (typeof rawValue === "string" && !rawValue.trim())) {
			throw new TypeError(`Companion rules require a non-blank ${key}.`);
		}
		const value = Number(rawValue);
		if (!Number.isFinite(value)) throw new TypeError(`Companion rules require a finite ${key}.`);
		out[key] = value;
	}
	out.artificerLevel = Math.max(0, Math.floor(out.artificerLevel));
	out.proficiencyBonus = Math.max(0, Math.floor(out.proficiencyBonus));
	return out;
}

function getRequiredModificationCount (descriptor, artificerLevel) {
	const range = descriptor.modifications.selection.requiredCountByArtificerLevel
		.find(it => artificerLevel >= it.minimum && (it.maximum == null || artificerLevel <= it.maximum));
	if (!range) throw new RangeError(`No modification count is defined for Artificer level ${artificerLevel}.`);
	return range.count;
}

function normalizeModificationSetup (descriptor, context, setup) {
	if (setup != null && (typeof setup !== "object" || Array.isArray(setup))) {
		throw new TypeError("Companion resolver setup must be an object.");
	}

	const rawModifications = setup && Object.prototype.hasOwnProperty.call(setup, "modifications")
		? setup.modifications
		: [];
	if (!Array.isArray(rawModifications)) throw new TypeError("Companion modifications must be an array.");

	const optionEntries = Object.entries(descriptor.modifications.options);
	const optionOrder = new Map(optionEntries.map(([id], index) => [id, index]));
	const selected = rawModifications.map(id => {
		if (typeof id !== "string" || !id.trim()) throw new TypeError("Companion modification IDs must be non-blank strings.");
		return id.trim();
	});
	const uniqueSelected = new Set(selected);
	if (uniqueSelected.size !== selected.length) throw new RangeError("Companion modifications must be unique.");

	for (const id of selected) {
		const option = descriptor.modifications.options[id];
		if (!option) throw new RangeError(`Unknown companion modification "${id}".`);
		if (context.artificerLevel < option.unlockArtificerLevel) {
			throw new RangeError(`Companion modification "${id}" is locked at Artificer level ${context.artificerLevel}.`);
		}
	}

	const requiredCount = getRequiredModificationCount(descriptor, context.artificerLevel);
	if (selected.length !== requiredCount) {
		throw new RangeError(`Companion requires exactly ${requiredCount} modification selection${requiredCount === 1 ? "" : "s"} at Artificer level ${context.artificerLevel}; received ${selected.length}.`);
	}

	return {
		requiredCount,
		selected: [...selected].sort((a, b) => optionOrder.get(a) - optionOrder.get(b)),
		available: optionEntries
			.filter(([, option]) => context.artificerLevel >= option.unlockArtificerLevel)
			.map(([id]) => id),
	};
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

function getResolvedReanimatorModificationEffects (descriptor, context, selected) {
	return Object.fromEntries(selected.map(id => {
		const effect = cloneJson(descriptor.modifications.options[id]);
		switch (id) {
			case "arcaneConduit":
				effect.damageRider.damageRollBonus = context.intelligenceModifier;
				break;
			case "gaunt":
				effect.fearAura.save.dc = context.spellSaveDc;
				break;
			case "moist":
				effect.acidRetaliation.damage.flat = context.intelligenceModifier;
				break;
		}
		return [id, effect];
	}));
}

function resolveRhwReanimatedCompanion (descriptor, context, setup, {deferSetupChoices = false} = {}) {
	const modificationSetup = deferSetupChoices
		? {
			deferred: true,
			requiredCount: getRequiredModificationCount(descriptor, context.artificerLevel),
			selected: [],
			available: Object.entries(descriptor.modifications.options)
				.filter(([, option]) => context.artificerLevel >= option.unlockArtificerLevel)
				.map(([id]) => id),
		}
		: {
			deferred: false,
			...normalizeModificationSetup(descriptor, context, setup),
		};
	const selected = new Set(modificationSetup.selected);
	const abilityScores = cloneJson(descriptor.statistics.abilityScores);
	const improvedReanimationAvailable = !deferSetupChoices
		&& context.artificerLevel >= descriptor.damageRules.necrotic.unlockArtificerLevel;
	const hasBloated = selected.has("bloated");
	const hasGaunt = selected.has("gaunt");
	const hasMoist = selected.has("moist");

	const speed = {
		walk: hasGaunt
			? descriptor.modifications.options.gaunt.speed.walk
			: descriptor.statistics.speed.walk,
	};
	if (hasGaunt) speed.climb = speed.walk;
	if (hasMoist) speed.swim = speed.walk;

	const dreadfulSwipeDamage = {
		dice: selected.has("ferocity")
			? descriptor.modifications.options.ferocity.dreadfulSwipeDamageDice
			: descriptor.actions.dreadfulSwipe.damage.dice,
		flat: context.intelligenceModifier,
		type: descriptor.actions.dreadfulSwipe.damage.type,
		ignoresResistance: improvedReanimationAvailable,
	};
	const dreadfulSwipeRiders = cloneJson(descriptor.actions.dreadfulSwipe.riders);
	if (hasBloated) {
		dreadfulSwipeRiders.push({
			id: "bloatedPush",
			effect: "push",
			distanceFeet: descriptor.modifications.options.bloated.dreadfulSwipePush.distanceFeet,
			maximumTargetSize: descriptor.modifications.options.bloated.dreadfulSwipePush.maximumTargetSize,
		});
	}

	const deathBurstDamage = {
		dice: improvedReanimationAvailable ? "4d4" : descriptor.traits.deathBurst.damage.dice,
		flat: hasBloated ? context.intelligenceModifier : 0,
		type: descriptor.traits.deathBurst.damage.type,
		ignoresResistance: improvedReanimationAvailable,
	};

	return {
		schemaVersion: descriptor.schemaVersion,
		identity: cloneJson(descriptor.identity),
		summonerContext: {...context},
		statistics: {
			size: hasBloated ? [...descriptor.modifications.options.bloated.size] : [...descriptor.statistics.size],
			creatureType: descriptor.statistics.creatureType,
			abilityScores,
			abilityModifiers: getBaseAbilityModifiers(abilityScores),
			speed,
			senses: cloneJson(descriptor.statistics.senses),
			damageResistances: [...descriptor.statistics.damageResistances],
			damageImmunities: [...descriptor.statistics.damageImmunities],
			conditionImmunities: [...descriptor.statistics.conditionImmunities],
			languages: cloneJson(descriptor.statistics.languages),
			hitDice: {count: context.artificerLevel, die: descriptor.statistics.hitDice.die},
			maxHp: 5 + (5 * context.artificerLevel),
			ac: 10 + context.intelligenceModifier,
			proficiencyBonus: context.proficiencyBonus,
			spellAttackBonus: context.spellAttackBonus,
			spellSaveDc: context.spellSaveDc,
			passivePerception: descriptor.statistics.passivePerception.authoredValue,
		},
		actions: {
			dreadfulSwipe: {
				...cloneJson(descriptor.actions.dreadfulSwipe),
				attackBonus: context.spellAttackBonus,
				damage: dreadfulSwipeDamage,
				riders: dreadfulSwipeRiders,
			},
		},
		traits: {
			deathBurst: {
				...cloneJson(descriptor.traits.deathBurst),
				save: {
					...cloneJson(descriptor.traits.deathBurst.save),
					dc: context.spellSaveDc,
				},
				damage: deathBurstDamage,
			},
			lightningAbsorption: cloneJson(descriptor.traits.lightningAbsorption),
		},
		creationPolicy: cloneJson(descriptor.creationPolicy),
		commandPolicy: cloneJson(descriptor.commandPolicy),
		lifecycle: cloneJson(descriptor.lifecycle),
		restPolicy: cloneJson(descriptor.restPolicy),
		damageRules: {
			necrotic: {
				ignoresResistance: improvedReanimationAvailable,
				unlockArtificerLevel: descriptor.damageRules.necrotic.unlockArtificerLevel,
			},
		},
		modifications: {
			deferred: modificationSetup.deferred,
			requiredCount: modificationSetup.requiredCount,
			selected: modificationSetup.selected,
			available: modificationSetup.available,
			effects: getResolvedReanimatorModificationEffects(descriptor, context, modificationSetup.selected),
		},
	};
}

class CharacterSheetCompanionRules {
	static FEATURE_UIDS = COMPANION_FEATURE_UIDS;
	static REGISTRY = COMPANION_RULES;

	static getRegistry () {
		return cloneJson(COMPANION_RULES);
	}

	static getDescriptor (featureUid) {
		const match = getDescriptorInternal(featureUid);
		return match ? cloneJson(match.descriptor) : null;
	}

	static resolve (featureUid, summonerContext, setup, options = {}) {
		const match = getDescriptorInternal(featureUid);
		if (!match) return null;

		const context = normalizeContext(match.descriptor, summonerContext);
		switch (match.canonicalUid) {
			case COMPANION_FEATURE_UIDS.EFA_STEEL_DEFENDER:
				return resolveEfaSteelDefender(match.descriptor, context);
			case COMPANION_FEATURE_UIDS.RHW_REANIMATED_COMPANION:
				return resolveRhwReanimatedCompanion(match.descriptor, context, setup, options);
			case COMPANION_FEATURE_UIDS.TCE_STEEL_DEFENDER:
				return resolveTceSteelDefender(match.descriptor, context);
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
