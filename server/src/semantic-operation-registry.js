import {HubStoreError} from "./hub-store-error.js";
import {normalizeSemanticOperation, SEMANTIC_OPERATION_VERSION} from "./hub-actions.js";

const MAX_IDENTITY_LENGTH = 200;
const MAX_TEMPLATE_ID_LENGTH = 120;

const PRODUCTION_TEMPLATES = Object.freeze([
	Object.freeze({
		sourceEntity: Object.freeze({type: "spell", uid: "cure wounds|phb", version: "phb-2014-v1"}),
		effectTemplateId: "spell.cure-wounds.heal",
		cost: "spell_slot_and_action",
	}),
	Object.freeze({
		sourceEntity: Object.freeze({type: "spell", uid: "cure wounds|xphb", version: "xphb-2024-v1"}),
		effectTemplateId: "spell.cure-wounds.heal",
		cost: "spell_slot_and_action",
	}),
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
	const spellcasting = character.data?.spellcasting || {};
	const spells = [
		...(Array.isArray(spellcasting.spellsKnown) ? spellcasting.spellsKnown : []),
		...(Array.isArray(spellcasting.cantripsKnown) ? spellcasting.cantripsKnown : []),
		...(Array.isArray(spellcasting.innateSpells) ? spellcasting.innateSpells : []),
	];
	return spells.some(spell => `${String(spell?.name || "").trim()}|${String(spell?.source || "").trim()}`.toLowerCase() === sourceEntity.uid);
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
	constructor ({templates = PRODUCTION_TEMPLATES} = {}) {
		this._templates = new Map();
		for (const template of templates) {
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
	}) {
		const template = this.getTemplate({sourceEntity, effectTemplateId});
		if (template.cost !== "none") {
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
		});
		const operation = normalizeSemanticOperation({
			...derived,
			operationId,
			targetCharacterId: targetCharacter.id,
			version: SEMANTIC_OPERATION_VERSION,
		});
		return {
			operation,
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
