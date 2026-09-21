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
