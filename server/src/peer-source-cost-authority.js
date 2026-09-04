import {
	getPeerSourceCostsCapability,
	PEER_SOURCE_COSTS_TEMPLATE_REGISTRY_VERSION,
} from "../../js/hub/hub-source-costs.js";
import {getPendingEffectOutcomeLabel} from "../../js/hub/hub-effect-presentation.js";

export const PEER_SOURCE_COSTS_CATALOG_VERSION = 1;

export function createPeerSourceCostsGate (setting = false) {
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

export function getPeerSourceCostsCampaignCapability ({isEnabled}) {
	return getPeerSourceCostsCapability({enabled: isEnabled});
}

export function getPeerSourceCostsRulesPin ({rulesVersion, brewBundle}) {
	if (!rulesVersion) return null;
	return {
		rulesVersionId: rulesVersion.id,
		rulesVersion: Number(rulesVersion.version),
		rulesSchemaVersion: Number(rulesVersion.schemaVersion),
		catalogVersion: PEER_SOURCE_COSTS_CATALOG_VERSION,
		brewBundleVersionId: brewBundle?.id ?? null,
		brewContentHash: brewBundle?.contentHash ?? null,
	};
}

export function isCanonicalEqual (left, right) {
	const canonicalize = value => {
		if (Array.isArray(value)) return value.map(canonicalize);
		if (value && typeof value === "object") {
			return Object.fromEntries(
				Object.keys(value)
					.filter(key => value[key] !== undefined)
					.sort()
					.map(key => [key, canonicalize(value[key])]),
			);
		}
		return value;
	};
	return JSON.stringify(canonicalize(left)) === JSON.stringify(canonicalize(right));
}

export function isPeerSourceCostsPinCurrent ({
	operation,
	rulesPin,
	isCapabilityEnabled,
	templateRegistryVersion = PEER_SOURCE_COSTS_TEMPLATE_REGISTRY_VERSION,
}) {
	return isCapabilityEnabled
		&& operation.templateRegistryVersion === templateRegistryVersion
		&& isCanonicalEqual(operation.rulesPin, rulesPin);
}

export function getPrivateAcceptanceFailureCode (error, {leg = "source"} = {}) {
	if (error?.code === "OPERATION_STATE_INVALID") {
		return leg === "target" ? "TARGET_EFFECT_UNAVAILABLE" : "SOURCE_COST_UNAVAILABLE";
	}
	if ([
		"SOURCE_COST_UNAVAILABLE",
		"SOURCE_OR_TARGET_UNAVAILABLE",
		"RESOURCE_INSUFFICIENT",
	].includes(error?.code)) return "SOURCE_COST_UNAVAILABLE";
	if ([
		"HP_MAX_UNAVAILABLE",
		"TARGET_EFFECT_UNAVAILABLE",
	].includes(error?.code)) return "TARGET_EFFECT_UNAVAILABLE";
	if ([
		"CAPABILITY_UNAVAILABLE",
		"POLICY_VERSION_STALE",
	].includes(error?.code)) return "POLICY_VERSION_STALE";
	return null;
}

export function getPeerSourceCostState (status) {
	if (status === "proposed") return "pending";
	if (status === "applied") return "consumed";
	return "not_consumed";
}

export function getPeerSourceCostFailureForViewer ({operation, accountId, role, sourceOwnerAccountId, targetOwnerAccountId}) {
	if (operation.status !== "failed" || !operation.privateFailureCode) return null;
	if (["dm", "co_dm"].includes(role)) return operation.privateFailureCode;
	if (
		accountId === sourceOwnerAccountId
		&& ["SOURCE_COST_UNAVAILABLE", "POLICY_VERSION_STALE"].includes(operation.privateFailureCode)
	) return operation.privateFailureCode;
	if (accountId === targetOwnerAccountId && operation.privateFailureCode === "TARGET_EFFECT_UNAVAILABLE") {
		return operation.privateFailureCode;
	}
	return "unavailable";
}

function getBoundedLabel (value, fallback, maxLength = 160) {
	if (typeof value !== "string") return fallback;
	const normalized = value.trim().replace(/\s+/g, " ");
	return normalized ? normalized.slice(0, maxLength) : fallback;
}

export function getPeerSourceCostActionSummary (operation, {canCancel = operation.status === "proposed"} = {}) {
	const outcomeLabel = getPendingEffectOutcomeLabel({
		kind: operation.kind,
		arguments: operation.arguments,
	});
	return {
		actionId: operation.id,
		status: operation.status,
		expiresAt: operation.expiresAt,
		presentation: {
			effectLabel: getBoundedLabel(
				operation.effectDisplaySnapshot?.label,
				"Campaign effect",
				120,
			),
			targetName: getBoundedLabel(
				operation.targetDisplaySnapshot?.identity?.name,
				"Campaign character",
				120,
			),
			outcomeLabel: getBoundedLabel(
				outcomeLabel || operation.effectDisplaySnapshot?.outcomeLabel,
				"Review campaign effect",
			),
		},
		sourceCostState: getPeerSourceCostState(operation.status),
		...(operation.status === "failed" ? {failureCode: "unavailable"} : {}),
		capabilities: {canCancel: operation.status === "proposed" && canCancel},
	};
}
