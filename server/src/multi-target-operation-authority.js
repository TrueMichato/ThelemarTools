import {HubStoreError} from "./hub-store-error.js";
import {
	getMultiTargetOperationsCapability,
	MULTI_TARGET_OPERATION_LIVE_STATUSES,
	MULTI_TARGET_OPERATIONS_COLLECTION_TTL_SECONDS,
	MULTI_TARGET_OPERATIONS_CONTRACT_VERSION,
	MULTI_TARGET_OPERATIONS_MAX_TARGETS,
	MULTI_TARGET_OPERATIONS_PROTOCOL_VERSION,
	MULTI_TARGET_OPERATIONS_TEMPLATE_REGISTRY_VERSION,
	MULTI_TARGET_OPERATIONS_TTL_SECONDS,
	MULTI_TARGET_RESPONSE_TERMINAL_STATES,
} from "../../js/hub/hub-multi-target-operations.js";

export const MULTI_TARGET_COLLECTION_TTL_MS = MULTI_TARGET_OPERATIONS_COLLECTION_TTL_SECONDS * 1_000;
export const MULTI_TARGET_OPERATION_TTL_MS = MULTI_TARGET_OPERATIONS_TTL_SECONDS * 1_000;
export const MULTI_TARGET_TERMINAL_RETENTION_DAYS = 90;
export const MULTI_TARGET_PAGE_LIMIT = 100;

export function createMultiTargetOperationsGate (setting = false) {
	if (typeof setting === "function") return campaignId => setting(campaignId) === true;
	if (setting === true) return () => true;
	const allowed = new Set(
		setting instanceof Set
			? setting
			: Array.isArray(setting)
				? setting
				: [],
	);
	return campaignId => allowed.has("*") || allowed.has(campaignId);
}

export function getMultiTargetOperationsCampaignCapability ({isEnabled}) {
	return getMultiTargetOperationsCapability({enabled: isEnabled});
}

export function assertMultiTargetProtocol ({
	protocolVersion,
	contractVersion = MULTI_TARGET_OPERATIONS_CONTRACT_VERSION,
}) {
	if (
		`${protocolVersion}` !== MULTI_TARGET_OPERATIONS_PROTOCOL_VERSION
		|| contractVersion !== MULTI_TARGET_OPERATIONS_CONTRACT_VERSION
	) {
		throw new HubStoreError("PROTOCOL_UPDATE_REQUIRED", `Hub protocol 6 is required.`, {status: 426});
	}
}

export function assertMultiTargetCandidateRefs (targetRefs) {
	if (
		!Array.isArray(targetRefs)
		|| targetRefs.length < 1
		|| targetRefs.length > MULTI_TARGET_OPERATIONS_MAX_TARGETS
		|| targetRefs.some(targetRef => typeof targetRef !== "string")
	) throw new HubStoreError("INVALID_REQUEST", `The candidate target set is invalid.`, {status: 400});
	return [...targetRefs];
}

export function assertUniqueResolvedTargets (targets) {
	if (new Set(targets.map(target => target.id)).size !== targets.length) {
		throw new HubStoreError("DUPLICATE_TARGET", `The candidate target set contains a duplicate.`, {status: 409});
	}
}

export function assertUniqueSelection (invitationIds) {
	if (!Array.isArray(invitationIds) || invitationIds.some(id => typeof id !== "string")) {
		throw new HubStoreError("INVALID_REQUEST", `The final selection is invalid.`, {status: 400});
	}
	if (new Set(invitationIds).size !== invitationIds.length) {
		throw new HubStoreError("FINALIZATION_SELECTION_INVALID", `The final selection is invalid.`, {status: 409});
	}
	return [...invitationIds];
}

export function isMultiTargetLiveStatus (status) {
	return MULTI_TARGET_OPERATION_LIVE_STATUSES.includes(status);
}

export function isMultiTargetResponseTerminal (state) {
	return MULTI_TARGET_RESPONSE_TERMINAL_STATES.includes(state);
}

export function getMultiTargetCursor (parts) {
	return Buffer.from(JSON.stringify(parts), "utf8").toString("base64url");
}

export function parseMultiTargetCursor (cursor, expectedLength) {
	if (cursor == null) return null;
	try {
		const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
		if (
			!Array.isArray(parsed)
			|| parsed.length !== expectedLength
			|| parsed.some(value => typeof value !== "string" || !value)
		) throw new Error("invalid");
		return parsed;
	} catch {
		throw new HubStoreError("INVALID_CURSOR", `The pagination cursor is invalid.`, {status: 400});
	}
}

export function getMultiTargetSourceAudience ({sourceOwnerAccountId, dmAccountIds}) {
	return [...new Set([sourceOwnerAccountId, ...dmAccountIds].filter(Boolean))];
}

export function getMultiTargetLegAudience ({sourceOwnerAccountId, targetOwnerAccountId, dmAccountIds}) {
	return [...new Set([sourceOwnerAccountId, targetOwnerAccountId, ...dmAccountIds].filter(Boolean))];
}

export function getMultiTargetOperationSummary ({
	operation,
	targets,
	canFinalize = false,
	canCancel = false,
}) {
	return {
		operationId: operation.id,
		status: operation.status,
		contractVersion: MULTI_TARGET_OPERATIONS_CONTRACT_VERSION,
		candidateCount: operation.candidateCount,
		collectionClosesAt: operation.collectionClosesAt,
		expiresAt: operation.expiresAt,
		presentation: {
			effectLabel: operation.effectDisplaySnapshot?.label || "Campaign effect",
		},
		counts: {
			pending: targets.filter(target => target.responseState === "pending").length,
			approved: targets.filter(target => ["approved", "approved_by_source"].includes(target.responseState)).length,
			terminal: targets.filter(target => isMultiTargetResponseTerminal(target.responseState)).length,
		},
		capabilities: {
			canFinalize: canFinalize && operation.status === "awaiting_source_selection",
			canCancel: canCancel && isMultiTargetLiveStatus(operation.status),
		},
	};
}

export {
	MULTI_TARGET_OPERATIONS_CONTRACT_VERSION,
	MULTI_TARGET_OPERATIONS_MAX_TARGETS,
	MULTI_TARGET_OPERATIONS_PROTOCOL_VERSION,
	MULTI_TARGET_OPERATIONS_TEMPLATE_REGISTRY_VERSION,
};
