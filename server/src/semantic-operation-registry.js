import crypto from "node:crypto";
import {HubStoreError} from "./hub-store-error.js";
import {normalizeSemanticOperation, SEMANTIC_OPERATION_VERSION} from "./hub-actions.js";
import {
	getSourceCostMutationFootprint,
	normalizeSourceCost,
	PEER_SOURCE_COSTS_TEMPLATE_REGISTRY_VERSION,
	resolveSourceCost,
	SOURCE_COST_VERSION,
} from "../../js/hub/hub-source-costs.js";

const MAX_IDENTITY_LENGTH = 200;
const MAX_TEMPLATE_ID_LENGTH = 120;
const SPELLCASTING_ABILITIES = new Set(["int", "wis", "cha"]);
const KNOWN_CASTER_NAMES = new Set(["bard", "ranger", "sorcerer", "warlock"]);
const PREPARED_CASTER_NAMES = new Set(["artificer", "cleric", "druid", "paladin", "wizard"]);
const CLASS_SPELLCASTING_ABILITIES = new Map([
	["artificer", "int"],
	["bard", "cha"],
	["cleric", "wis"],
	["druid", "wis"],
	["paladin", "cha"],
	["ranger", "wis"],
	["sorcerer", "cha"],
	["warlock", "cha"],
	["wizard", "int"],
]);
export const PEER_EFFECT_TEMPLATE_REGISTRY_VERSION = PEER_SOURCE_COSTS_TEMPLATE_REGISTRY_VERSION;

function normalizeCureWoundsChoice (choice) {
	if (
		!choice
		|| typeof choice !== "object"
		|| Array.isArray(choice)
		|| Object.keys(choice).some(key => key !== "castLevel")
		|| !Number.isInteger(choice.castLevel)
		|| choice.castLevel < 1
		|| choice.castLevel > 9
	) throw new HubStoreError("SOURCE_OR_TARGET_UNAVAILABLE", `Source or target is unavailable.`, {status: 404});
	return {castLevel: choice.castLevel};
}

function getClassSpellcastingModel (cls) {
	if (!cls) return "none";
	if (cls.spellsKnownProgression || KNOWN_CASTER_NAMES.has(String(cls.name || "").toLowerCase())) return "known";
	if (
		cls.preparedSpellsProgression
		|| cls.preparedSpells
		|| cls.spellsKnownProgressionFixed
		|| PREPARED_CASTER_NAMES.has(String(cls.name || "").toLowerCase())
		|| cls.casterProgression
		|| cls.spellcastingAbility
	) return "prepared";
	return "none";
}

function findSpellOwnerClass ({data, spell}) {
	const keys = [spell.sourceClass, spell.sourceSubclass]
		.filter(Boolean)
		.map(value => String(value).trim().toLowerCase());
	if (!keys.length) return null;
	return (Array.isArray(data.classes) ? data.classes : []).find(cls => {
		const classKeys = [cls?.name, cls?.subclass?.name, cls?.subclass?.shortName]
			.filter(Boolean)
			.map(value => String(value).trim().toLowerCase());
		return classKeys.some(key => keys.includes(key));
	}) || null;
}

function isUsableLeveledSpell ({data, spell}) {
	if (
		!spell
		|| spell.level !== 1
		|| spell.sourceItem
		|| spell.itemName
		|| ["item", "innate"].includes(String(spell.sourceType || spell.sourceKind || spell.grantType || "").toLowerCase())
		|| spell.isInnate === true
	) return false;
	const owner = findSpellOwnerClass({data, spell});
	if (!owner) return false;
	const model = getClassSpellcastingModel(owner);
	if (model === "known") return true;
	if (model === "prepared") return spell.prepared === true || spell.alwaysPrepared === true;
	return false;
}

function getUsableSpell ({sourceCharacter, sourceEntity}) {
	const data = sourceCharacter.data || {};
	const matches = (Array.isArray(data.spellcasting?.spellsKnown) ? data.spellcasting.spellsKnown : [])
		.filter(spell => `${String(spell?.name || "").trim()}|${String(spell?.source || "").trim()}`.toLowerCase() === sourceEntity.uid)
		.filter(spell => isUsableLeveledSpell({data, spell}));
	if (matches.length !== 1) {
		throw new HubStoreError("SOURCE_OR_TARGET_UNAVAILABLE", `Source or target is unavailable.`, {status: 404});
	}
	return matches[0];
}

function getSpellcastingAbility ({data, spell}) {
	const explicit = String(spell.spellcastingAbility || "").toLowerCase();
	if (SPELLCASTING_ABILITIES.has(explicit)) return explicit;
	const owner = findSpellOwnerClass({data, spell});
	if (owner) {
		const stored = String(owner.spellcastingAbility || "").toLowerCase();
		if (SPELLCASTING_ABILITIES.has(stored)) return stored;
		const fallback = CLASS_SPELLCASTING_ABILITIES.get(String(owner.name || "").toLowerCase());
		if (fallback) return fallback;
	}
	return null;
}

function getAbilityScore ({data, ability}) {
	const customModifiers = data.customModifiers || {};
	let score = (Number(data.abilities?.[ability]) || 10)
		+ (Number(data.abilityBonuses?.[ability]) || 0)
		+ (Number(customModifiers.abilityScores?.[ability]) || 0)
		+ (Number(data.directAbilityBonuses?.[ability]) || 0);
	score += Number(data.itemAbilityOverrides?.bonus?.[ability]) || 0;
	const itemStatic = Number(data.itemAbilityOverrides?.static?.[ability]);
	if (itemStatic > score) score = itemStatic;
	const customStatic = Number(customModifiers.abilityScoreStatic?.[ability]);
	if (customStatic > score) score = customStatic;
	if (data.settings?.enforceAbilityScoreCap) {
		const maximum = Math.min(
			Math.max(
				20,
				Number(data.abilityScoreMaximums?.[ability]) || 0,
				Number(customModifiers.abilityScoreMaxSet?.[ability]) || 0,
			) + (Number(customModifiers.abilityScoreMaxIncrease?.[ability]) || 0),
			30,
		);
		score = Math.min(score, maximum);
	}
	for (const state of Array.isArray(data.activeStates) ? data.activeStates : []) {
		if (!state?.active) continue;
		for (const effect of Array.isArray(state.customEffects) ? state.customEffects : []) {
			if (effect?.type === "abilityScoreBonus" && effect.ability === ability) score += Number(effect.value) || 0;
		}
	}
	let damage = 0;
	for (const state of Array.isArray(data.activeStates) ? data.activeStates : []) {
		if (!state?.active) continue;
		for (const effect of Array.isArray(state.customEffects) ? state.customEffects : []) {
			if (effect?.type === "abilityDamage" && effect.target === ability) damage += Math.abs(Number(effect.value) || 0);
		}
	}
	return Math.max(0, score - damage);
}

function getSpellcastingModifier ({sourceCharacter, sourceEntity}) {
	const data = sourceCharacter.data || {};
	const spell = getUsableSpell({sourceCharacter, sourceEntity});
	const ability = getSpellcastingAbility({data, spell});
	if (!ability) {
		throw new HubStoreError("SOURCE_OR_TARGET_UNAVAILABLE", `Source or target is unavailable.`, {status: 404});
	}
	const score = getAbilityScore({data, ability});
	if (!Number.isSafeInteger(score) || score < 1 || score > 50) {
		throw new HubStoreError("SOURCE_OR_TARGET_UNAVAILABLE", `Source or target is unavailable.`, {status: 404});
	}
	return Math.floor((score - 10) / 2);
}

function rollDeterministicDice ({seed, count, size}) {
	if (typeof seed !== "string" || !/^[0-9a-f]{64}$/i.test(seed)) {
		throw new HubStoreError("SOURCE_COST_HANDLER_UNAVAILABLE", `The pinned source-cost handler is unavailable.`, {status: 503});
	}
	let total = 0;
	for (let ix = 0; ix < count; ++ix) {
		const digest = crypto.createHash("sha256").update(`${seed}:${ix}`).digest();
		total += digest.readUInt32BE(0) % size + 1;
	}
	return total;
}

function getCureWoundsTemplate ({source, version, dicePerLevel}) {
	return Object.freeze({
		sourceEntity: Object.freeze({type: "spell", uid: `cure wounds|${source}`, version}),
		effectTemplateId: "spell.cure-wounds.heal",
		sourceCostVersion: SOURCE_COST_VERSION,
		display: Object.freeze({label: "Cure Wounds", outcomeLabel: "Healing"}),
		normalizeChoice: normalizeCureWoundsChoice,
		buildSourceCost: ({choice}) => ({
			version: SOURCE_COST_VERSION,
			components: [{kind: "spell_slot", pool: "standard", level: choice.castLevel, amount: 1}],
		}),
		hasSource: ({character, sourceEntity}) => {
			try {
				getUsableSpell({sourceCharacter: character, sourceEntity});
				return true;
			} catch {
				return false;
			}
		},
		canUse: ({sourceCharacter, choice}) => getUsableSpell({
			sourceCharacter,
			sourceEntity: {uid: `cure wounds|${source}`},
		}).level <= choice.castLevel,
		deriveOperation: ({sourceCharacter, choice, effectResolutionSeed}) => ({
			kind: "hp.heal",
			arguments: {
				amount: Math.max(1, rollDeterministicDice({
					seed: effectResolutionSeed,
					count: dicePerLevel * choice.castLevel,
					size: 8,
				}) + getSpellcastingModifier({
					sourceCharacter,
					sourceEntity: {uid: `cure wounds|${source}`},
				})),
			},
		}),
		sourceFootprint: ({sourceCost}) => getSourceCostMutationFootprint(sourceCost),
		targetFootprint: () => ["hp"],
	});
}

const PRODUCTION_TEMPLATES = Object.freeze([
	getCureWoundsTemplate({source: "phb", version: "phb-2014-v1", dicePerLevel: 1}),
	getCureWoundsTemplate({source: "xphb", version: "xphb-2024-v1", dicePerLevel: 2}),
]);

function normalizeBoundedString (value, {label, maxLength}) {
	const out = typeof value === "string" ? value.trim() : "";
	if (!out || out.length > maxLength) throw new HubStoreError("SOURCE_OR_TARGET_UNAVAILABLE", `${label} is unavailable.`, {status: 404});
	return out;
}

export function normalizeSourceEntity (sourceEntity) {
	if (!sourceEntity || typeof sourceEntity !== "object" || Array.isArray(sourceEntity)) {
		throw new HubStoreError("SOURCE_OR_TARGET_UNAVAILABLE", `Source is unavailable.`, {status: 404});
	}
	if (Object.keys(sourceEntity).some(key => !["type", "uid", "version"].includes(key))) {
		throw new HubStoreError("SOURCE_OR_TARGET_UNAVAILABLE", `Source is unavailable.`, {status: 404});
	}
	if (!["ability", "spell"].includes(sourceEntity.type)) {
		throw new HubStoreError("SOURCE_OR_TARGET_UNAVAILABLE", `Source is unavailable.`, {status: 404});
	}
	return {
		type: sourceEntity.type,
		uid: normalizeBoundedString(sourceEntity.uid, {label: "Source", maxLength: MAX_IDENTITY_LENGTH}).toLowerCase(),
		version: normalizeBoundedString(sourceEntity.version, {label: "Source version", maxLength: 80}),
	};
}

function getTemplateKey ({sourceEntity, effectTemplateId}) {
	return `${sourceEntity.type}|${sourceEntity.uid}|${sourceEntity.version}|${effectTemplateId}`;
}

function hasSpellSource ({character, sourceEntity}) {
	try {
		getUsableSpell({sourceCharacter: character, sourceEntity});
		return true;
	} catch {
		return false;
	}
}

function hasAbilitySource ({character, sourceEntity}) {
	const features = Array.isArray(character.data?.features) ? character.data.features : [];
	return features.some(feature => {
		const explicitUid = typeof feature?.uid === "string" ? feature.uid.trim().toLowerCase() : null;
		const simpleUid = `${String(feature?.name || "").trim()}|${String(feature?.source || "").trim()}`.toLowerCase();
		return explicitUid === sourceEntity.uid || simpleUid === sourceEntity.uid;
	});
}

function getSafeIdentitySnapshot (profile) {
	const identity = profile?.data?.identity;
	return identity ? {identity: structuredClone(identity)} : {identity: null};
}

export class SemanticOperationRegistry {
	constructor ({templates = PRODUCTION_TEMPLATES, additionalTemplates = []} = {}) {
		this._templates = new Map();
		for (const template of [...templates, ...additionalTemplates]) {
			const sourceEntity = normalizeSourceEntity(template.sourceEntity);
			const effectTemplateId = normalizeBoundedString(template.effectTemplateId, {
				label: "Effect template",
				maxLength: MAX_TEMPLATE_ID_LENGTH,
			});
			const key = getTemplateKey({sourceEntity, effectTemplateId});
			if (this._templates.has(key)) throw new TypeError(`Duplicate semantic operation template: ${key}`);
			this._templates.set(key, {...template, sourceEntity, effectTemplateId});
		}
	}

	getTemplate ({sourceEntity, effectTemplateId}) {
		const normalizedSource = normalizeSourceEntity(sourceEntity);
		const normalizedTemplateId = normalizeBoundedString(effectTemplateId, {
			label: "Effect template",
			maxLength: MAX_TEMPLATE_ID_LENGTH,
		});
		const template = this._templates.get(getTemplateKey({
			sourceEntity: normalizedSource,
			effectTemplateId: normalizedTemplateId,
		}));
		if (!template) throw new HubStoreError("SOURCE_OR_TARGET_UNAVAILABLE", `Source or target is unavailable.`, {status: 404});
		return template;
	}

	isCostBearing ({sourceEntity, effectTemplateId}) {
		return this.getTemplate({sourceEntity, effectTemplateId}).sourceCostVersion != null;
	}

	derive ({
		sourceCharacter,
		targetCharacter,
		targetRef,
		sourceEntity,
		effectTemplateId,
		choice,
		sourceProfile,
		targetProfile,
		operationId = null,
		effectResolutionSeed = null,
	}) {
		const template = this.getTemplate({sourceEntity, effectTemplateId});
		const isCostBearing = template.sourceCostVersion != null;
		if (!isCostBearing && template.cost !== "none") {
			throw new HubStoreError("SOURCE_COST_UNSUPPORTED", `The source cost is not supported.`, {status: 409});
		}
		const normalizedChoice = template.normalizeChoice
			? template.normalizeChoice(structuredClone(choice))
			: (() => {
				if (!choice || typeof choice !== "object" || Array.isArray(choice) || Object.keys(choice).length) {
					throw new HubStoreError("SOURCE_OR_TARGET_UNAVAILABLE", `Source or target is unavailable.`, {status: 404});
				}
				return {};
			})();
		const hasSource = template.hasSource
			? template.hasSource({character: sourceCharacter, sourceEntity: template.sourceEntity})
			: template.sourceEntity.type === "spell"
				? hasSpellSource({character: sourceCharacter, sourceEntity: template.sourceEntity})
				: hasAbilitySource({character: sourceCharacter, sourceEntity: template.sourceEntity});
		if (!hasSource || (template.canUse && !template.canUse({sourceCharacter, targetCharacter, choice: normalizedChoice}))) {
			throw new HubStoreError("SOURCE_OR_TARGET_UNAVAILABLE", `Source or target is unavailable.`, {status: 404});
		}
		if (targetCharacter.targetRef !== targetRef || (template.canTarget && !template.canTarget({sourceCharacter, targetCharacter, choice: normalizedChoice}))) {
			throw new HubStoreError("SOURCE_OR_TARGET_UNAVAILABLE", `Source or target is unavailable.`, {status: 404});
		}
		const derived = template.deriveOperation({
			sourceCharacter,
			targetCharacter,
			choice: normalizedChoice,
			effectResolutionSeed,
		});
		const operation = normalizeSemanticOperation({
			...derived,
			operationId,
			targetCharacterId: targetCharacter.id,
			version: SEMANTIC_OPERATION_VERSION,
		});
		const sourceCost = isCostBearing
			? normalizeSourceCost(template.buildSourceCost({
				sourceCharacter,
				targetCharacter,
				choice: normalizedChoice,
				effectResolutionSeed,
			}))
			: null;
		if (sourceCost) resolveSourceCost({data: sourceCharacter.data, sourceCost});
		const sourceFootprint = sourceCost
			? (template.sourceFootprint?.({sourceCost, sourceCharacter, targetCharacter, choice: normalizedChoice})
				|| getSourceCostMutationFootprint(sourceCost))
			: [];
		const targetFootprint = template.targetFootprint?.({
			operation,
			sourceCharacter,
			targetCharacter,
			choice: normalizedChoice,
		}) || [];
		if (
			sourceCharacter.id === targetCharacter.id
			&& sourceFootprint.some(binding => targetFootprint.includes(binding))
		) throw new HubStoreError("SOURCE_COST_UNSUPPORTED", `The source cost is not supported.`, {status: 409});
		return {
			operation,
			sourceCost,
			sourceFootprint,
			targetFootprint,
			choice: normalizedChoice,
			sourceEntity: structuredClone(template.sourceEntity),
			effectTemplateId: template.effectTemplateId,
			sourceDisplaySnapshot: getSafeIdentitySnapshot(sourceProfile),
			targetDisplaySnapshot: {
				targetRef,
				...getSafeIdentitySnapshot(targetProfile),
			},
			effectDisplaySnapshot: structuredClone(template.display || {label: template.effectTemplateId}),
		};
	}
}

export function createSemanticOperationRegistry (options) {
	return new SemanticOperationRegistry(options);
}
