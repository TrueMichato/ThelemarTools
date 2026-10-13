import {resolveReviewedHealingWordSpell} from "./hub-healing-word-spells.js";

export const MULTI_TARGET_OPERATIONS_CONTRACT_VERSION = 1;
export const MULTI_TARGET_OPERATIONS_PROTOCOL_VERSION = "6";
export const MULTI_TARGET_OPERATIONS_MAX_TARGETS = 8;
export const MULTI_TARGET_OPERATIONS_TEMPLATE_REGISTRY_VERSION = "multi-target-effects-v1";
export const MULTI_TARGET_OPERATIONS_COLLECTION_TTL_SECONDS = 10 * 60;
export const MULTI_TARGET_OPERATIONS_TTL_SECONDS = 24 * 60 * 60;

export const MULTI_TARGET_OPERATION_LIVE_STATUSES = Object.freeze([
	"collecting_responses",
	"awaiting_source_selection",
]);

export const MULTI_TARGET_OPERATION_TERMINAL_STATUSES = Object.freeze([
	"applied",
	"cancelled",
	"expired",
	"failed",
]);

export const MULTI_TARGET_RESPONSE_TERMINAL_STATES = Object.freeze([
	"approved",
	"approved_by_source",
	"rejected",
	"expired",
	"revoked",
	"declined",
]);

export function isMultiTargetOperationsProtocolVersion (protocolVersion) {
	return `${protocolVersion}` === MULTI_TARGET_OPERATIONS_PROTOCOL_VERSION;
}

export function getMultiTargetOperationsCapability ({enabled = false} = {}) {
	return {
		enabled: enabled === true,
		contractVersion: MULTI_TARGET_OPERATIONS_CONTRACT_VERSION,
		protocolVersion: Number(MULTI_TARGET_OPERATIONS_PROTOCOL_VERSION),
		maxTargets: MULTI_TARGET_OPERATIONS_MAX_TARGETS,
		collectionTtlSeconds: MULTI_TARGET_OPERATIONS_COLLECTION_TTL_SECONDS,
		operationTtlSeconds: MULTI_TARGET_OPERATIONS_TTL_SECONDS,
		supportsSourceOwnedFinalizationConsent: true,
		supportsPartialSelection: true,
		supportsPartialCommit: false,
		templateRegistryVersion: MULTI_TARGET_OPERATIONS_TEMPLATE_REGISTRY_VERSION,
	};
}

export function hasMultiTargetOperationsCapability (capability) {
	const expected = getMultiTargetOperationsCapability({enabled: true});
	return Object.entries(expected).every(([key, value]) => capability?.[key] === value);
}

export function resolveReviewedMultiTargetSpell (options) {
	const descriptor = resolveReviewedHealingWordSpell(options);
	return descriptor?.maxTargets === 6 ? descriptor : null;
}

export function getMultiTargetResultDelivery ({operationId, result, characterId}) {
	if (!operationId || !result || !characterId) return null;
	const leg = result.legKind;
	if (!["source", "target", "combined"].includes(leg)) return null;
	if (leg === "source" ? result.sourceCharacterId !== characterId : result.operation?.targetCharacterId !== characterId) return null;
	const revision = leg === "source" ? result.resultingSourceCharacterRevision : result.resultingCharacterRevision ?? result.resultingSourceCharacterRevision;
	if (!Number.isInteger(result.eventSequence) || !result.appliedEventId) return null;
	if (!Number.isInteger(revision) && !(leg === "target" && result.changed === false && revision == null)) return null;
	if (leg !== "source" && (typeof result.legId !== "string" || !result.legId)) return null;
	if (result.operationLegKey != null && result.operationLegKey !== `${operationId}/${leg}`) return null;
	return {
		actionId: operationId,
		characterId,
		eventId: result.appliedEventId,
		sequence: result.eventSequence,
		leg,
		legId: result.legId ?? null,
		operationLegKey: `${operationId}/${leg}${result.legId ? `/${result.legId}` : ""}`,
		operation: result.operation ?? null,
		sourceCost: result.sourceCost ?? null,
		resultingCharacterRevision: revision ?? null,
		changed: result.changed !== false,
	};
}

export function getMultiTargetOperationRouting (event) {
	if (!event?.type?.startsWith("character.multi_operation.")) return null;
	const payload = event.payload;
	const operationId = payload?.operationId;
	if (typeof operationId !== "string" || !operationId) return null;
	if (event.aggregateType === "semantic_operation" && event.aggregateId === operationId) {
		return {characterId: null, targetCharacterId: null, leg: null, operationId, operationLegKey: null, status: "refresh", payload: {}};
	}
	if (event.aggregateType !== "character" || !event.aggregateId) return null;
	const isSource = event.type === "character.multi_operation.source_cost_consumed";
	const leg = isSource ? "source" : payload.leg;
	if (!isSource && (event.type !== "character.multi_operation.target_applied" || !["target", "combined"].includes(leg))) return null;
	const revision = (isSource ? payload.resultingSourceCharacterRevision : payload.resultingCharacterRevision) ?? null;
	const isNoOp = leg === "target" && payload.changed === false && revision == null;
	if (!isNoOp && (!Number.isInteger(revision) || revision < 0)) return null;
	if (event.aggregateRevision !== revision) return null;
	if (leg !== "source" && (!payload.legId || payload.operation?.targetCharacterId !== event.aggregateId || payload.operation?.operationId !== operationId)) return null;
	if (leg !== "target" && (!payload.sourceCost || typeof payload.sourceCost !== "object")) return null;
	return {
		characterId: event.aggregateId,
		targetCharacterId: event.aggregateId,
		leg,
		legId: payload.legId ?? null,
		operationId,
		operationLegKey: `${operationId}/${leg}${payload.legId ? `/${payload.legId}` : ""}`,
		status: "applied",
		payload: {
			leg,
			...(leg !== "source" ? {operation: structuredClone(payload.operation)} : {}),
			...(leg !== "target" ? {sourceCost: structuredClone(payload.sourceCost)} : {}),
			resultingCharacterRevision: revision ?? null,
			changed: payload.changed !== false,
		},
	};
}
