import {
	CAMPAIGN_RULES_CATALOG,
	CAMPAIGN_RULES_CATALOG_VERSION,
	CAMPAIGN_RULES_POLICY_CAPABILITY,
	CAMPAIGN_RULES_POLICY_SCHEMA_VERSION,
	CampaignRulesPolicyError,
	getCampaignRulesPolicy,
	normalizeCampaignRulesPolicy,
} from "./hub-campaign-rules.js";

export const CAMPAIGN_RULE_EVALUATOR_VERSION = "1";
export const CAMPAIGN_RULE_PROTOCOL_VERSION = 4;

const _INPUT_KEYS = new Set([
	"capabilities",
	"expectedRulesVersionId",
	"personalSettings",
	"protocolVersion",
	"rulesVersion",
	"surface",
]);
const _RULES_VERSION_KEYS = new Set([
	"id",
	"campaignId",
	"version",
	"schemaVersion",
	"catalogVersion",
	"rules",
	"createdAt",
	"policy",
	"policySummary",
	"ruleDecision",
]);
const _RULE_DECISION_KEYS = new Set([
	"schemaVersion",
	"evaluatorVersion",
	"status",
	"blocking",
	"surface",
	"policyIdentity",
	"effectiveSettings",
	"appliedRules",
	"errors",
]);
const _SURFACES = new Set([
	"characterOpen",
	"builder",
	"levelUp",
	"quickBuild",
	"respec",
	"contentFilter",
	"characterWrite",
	"hubAdmin",
	"dmProjection",
]);
const _SETTING_BY_RULE_ID = Object.freeze({
	"tgtt.enabled": "enableTgtt",
	"rules.exhaustion.system": "exhaustionRules",
	"tgtt.carry-weight": "thelemar_carryWeight",
	"tgtt.encumbrance-tiers": "thelemar_encumbranceTiers",
	"tgtt.jumping": "thelemar_jumping",
	"tgtt.linguistics-bonus": "thelemar_linguisticsBonus",
	"tgtt.critical-rolls": "thelemar_criticalRolls",
});
const _CATALOG_BY_ID = new Map(CAMPAIGN_RULES_CATALOG.map(rule => [rule.id, rule]));

/**
 * @typedef {{
 *   schemaVersion: 1,
 *   evaluatorVersion: "1",
 *   status: "inactive"|"compliant"|"blocked",
 *   blocking: boolean,
 *   surface: string,
 *   policyIdentity: null|{id: string, version: number, schemaVersion: number, catalogVersion: number},
 *   effectiveSettings: object,
 *   appliedRules: Array<{id: string, ruleSchemaVersion: number, mode: "legacy"|"advisory"|"enforced"}>,
 *   errors: Array<{code: string, ruleId?: string}>,
 * }} CampaignRuleDecision
 */

function copyObject (value) {
	if (!value || typeof value !== "object" || Array.isArray(value)) return {};
	try {
		return structuredClone(value);
	} catch {
		return {};
	}
}

function getPolicyIdentity (rulesVersion) {
	if (
		!rulesVersion
		|| typeof rulesVersion.id !== "string"
		|| !rulesVersion.id
		|| !Number.isSafeInteger(rulesVersion.version)
		|| rulesVersion.version < 1
		|| !Number.isSafeInteger(rulesVersion.schemaVersion)
		|| !Number.isSafeInteger(rulesVersion.catalogVersion)
	) return null;
	return {
		id: rulesVersion.id,
		version: rulesVersion.version,
		schemaVersion: rulesVersion.schemaVersion,
		catalogVersion: rulesVersion.catalogVersion,
	};
}

function isClosedRuleDecision (decision) {
	if (!decision || typeof decision !== "object" || Array.isArray(decision)) return false;
	return !Object.keys(decision).some(key => !_RULE_DECISION_KEYS.has(key));
}

function blocked ({surface, personalSettings, rulesVersion = null, code, ruleId = null}) {
	return {
		schemaVersion: 1,
		evaluatorVersion: CAMPAIGN_RULE_EVALUATOR_VERSION,
		status: "blocked",
		blocking: true,
		surface,
		policyIdentity: getPolicyIdentity(rulesVersion),
		effectiveSettings: copyObject(personalSettings),
		appliedRules: [],
		errors: [{code, ...(ruleId ? {ruleId} : {})}],
	};
}

/**
 * Pure campaign-policy evaluation. Inputs and output are closed, cloneable data; this function
 * performs no I/O and is shared by browser projections and server write authority.
 *
 * Missing `rulesVersion` is explicit local mode. A campaign policy is applied only when its
 * schema, catalog, rule versions, capability, protocol, surface, and optional policy pin agree.
 *
 * @param {object} input
 * @returns {CampaignRuleDecision}
 */
export function evaluateCampaignRules (input = {}) {
	if (!input || typeof input !== "object" || Array.isArray(input)) {
		return blocked({surface: "unknown", personalSettings: {}, code: "RULE_EVALUATOR_INPUT_INVALID"});
	}
	const unknownInputKeys = Object.keys(input).filter(key => !_INPUT_KEYS.has(key));
	const surface = input.surface || "characterOpen";
	if (
		unknownInputKeys.length
		|| !_SURFACES.has(surface)
		|| (input.personalSettings != null && (typeof input.personalSettings !== "object" || Array.isArray(input.personalSettings)))
		|| (input.capabilities != null && (!Array.isArray(input.capabilities) || input.capabilities.some(capability => typeof capability !== "string")))
		|| (input.expectedRulesVersionId != null && typeof input.expectedRulesVersionId !== "string")
		|| (input.protocolVersion != null && !["string", "number"].includes(typeof input.protocolVersion))
	) {
		return blocked({surface, personalSettings: input.personalSettings, code: "RULE_EVALUATOR_INPUT_INVALID"});
	}
	const personalSettings = copyObject(input.personalSettings);
	const rulesVersion = input.rulesVersion;
	if (rulesVersion == null) {
		return {
			schemaVersion: 1,
			evaluatorVersion: CAMPAIGN_RULE_EVALUATOR_VERSION,
			status: "inactive",
			blocking: false,
			surface,
			policyIdentity: null,
			effectiveSettings: personalSettings,
			appliedRules: [],
			errors: [],
		};
	}
	if (!rulesVersion || typeof rulesVersion !== "object" || Array.isArray(rulesVersion)) {
		return blocked({surface, personalSettings, rulesVersion, code: "RULES_VERSION_INVALID"});
	}
	const unknownRulesVersionKeys = Object.keys(rulesVersion).filter(key => !_RULES_VERSION_KEYS.has(key));
	const schemaVersion = Object.hasOwn(rulesVersion, "schemaVersion") ? rulesVersion.schemaVersion : 1;
	const catalogVersion = Object.hasOwn(rulesVersion, "catalogVersion") ? rulesVersion.catalogVersion : CAMPAIGN_RULES_CATALOG_VERSION;
	const normalizedRulesVersion = {...rulesVersion, schemaVersion, catalogVersion};
	if (
		unknownRulesVersionKeys.length
		|| typeof rulesVersion.id !== "string"
		|| !rulesVersion.id
		|| !Number.isSafeInteger(rulesVersion.version)
		|| rulesVersion.version < 1
		|| !Number.isSafeInteger(schemaVersion)
		|| !Number.isSafeInteger(catalogVersion)
		|| (rulesVersion.campaignId != null && typeof rulesVersion.campaignId !== "string")
		|| (rulesVersion.createdAt != null && typeof rulesVersion.createdAt !== "string")
		|| (rulesVersion.policy != null && (typeof rulesVersion.policy !== "object" || Array.isArray(rulesVersion.policy)))
		|| (rulesVersion.policySummary != null && (typeof rulesVersion.policySummary !== "object" || Array.isArray(rulesVersion.policySummary)))
		|| (rulesVersion.ruleDecision != null && !isClosedRuleDecision(rulesVersion.ruleDecision))
	) return blocked({surface, personalSettings, rulesVersion: normalizedRulesVersion, code: "RULES_VERSION_INVALID"});
	if (input.expectedRulesVersionId != null && input.expectedRulesVersionId !== rulesVersion.id) {
		return blocked({surface, personalSettings, rulesVersion: normalizedRulesVersion, code: "POLICY_VERSION_STALE"});
	}
	if (![1, CAMPAIGN_RULES_POLICY_SCHEMA_VERSION].includes(schemaVersion)) {
		return blocked({surface, personalSettings, rulesVersion: normalizedRulesVersion, code: "RULES_SCHEMA_UNSUPPORTED"});
	}
	if (schemaVersion === CAMPAIGN_RULES_POLICY_SCHEMA_VERSION && catalogVersion !== CAMPAIGN_RULES_CATALOG_VERSION) {
		return blocked({surface, personalSettings, rulesVersion: normalizedRulesVersion, code: "RULES_CATALOG_UNSUPPORTED"});
	}
	if (schemaVersion === CAMPAIGN_RULES_POLICY_SCHEMA_VERSION) {
		if (Number(input.protocolVersion) !== CAMPAIGN_RULE_PROTOCOL_VERSION) {
			return blocked({surface, personalSettings, rulesVersion, code: "RULES_PROTOCOL_UNSUPPORTED"});
		}
		if (!Array.isArray(input.capabilities) || !input.capabilities.includes(CAMPAIGN_RULES_POLICY_CAPABILITY)) {
			return blocked({surface, personalSettings, rulesVersion, code: "RULES_CAPABILITY_REQUIRED"});
		}
	}

	let policy;
	try {
		const policyInput = rulesVersion.policy ?? rulesVersion.rules;
		policy = schemaVersion === CAMPAIGN_RULES_POLICY_SCHEMA_VERSION
			? normalizeCampaignRulesPolicy(policyInput)
			: getCampaignRulesPolicy({schemaVersion, rules: policyInput});
	} catch (error) {
		if (!(error instanceof CampaignRulesPolicyError)) throw error;
		return blocked({surface, personalSettings, rulesVersion, code: error.code});
	}

	const effectiveSettings = {...personalSettings};
	const appliedRules = [];
	for (const selection of policy.rules) {
		const definition = _CATALOG_BY_ID.get(selection.id);
		if (!definition || selection.ruleSchemaVersion !== definition.ruleSchemaVersion) {
			return blocked({surface, personalSettings, rulesVersion, code: "RULES_SCHEMA_UNSUPPORTED", ruleId: selection.id});
		}
		const status = definition.implementationStatus[surface === "dmProjection" ? "characterOpen" : surface];
		if (selection.mode === "enforced" && status !== "implemented") {
			return blocked({surface, personalSettings, rulesVersion, code: "RULE_SURFACE_UNSUPPORTED", ruleId: selection.id});
		}
		const settingKey = _SETTING_BY_RULE_ID[selection.id];
		if (!settingKey) continue;
		effectiveSettings[settingKey] = selection.parameters[definition.parameter.key];
		appliedRules.push({
			id: selection.id,
			ruleSchemaVersion: selection.ruleSchemaVersion,
			mode: schemaVersion === 1 ? "legacy" : selection.mode,
		});
	}
	if (effectiveSettings.enableTgtt === false) {
		for (const key of [
			"thelemar_carryWeight",
			"thelemar_encumbranceTiers",
			"thelemar_jumping",
			"thelemar_linguisticsBonus",
			"thelemar_criticalRolls",
		]) effectiveSettings[key] = false;
	}

	return {
		schemaVersion: 1,
		evaluatorVersion: CAMPAIGN_RULE_EVALUATOR_VERSION,
		status: "compliant",
		blocking: false,
		surface,
		policyIdentity: {
			id: rulesVersion.id,
			version: rulesVersion.version,
			schemaVersion,
			catalogVersion: policy.catalogVersion,
		},
		effectiveSettings,
		appliedRules,
		errors: [],
	};
}

export function getCampaignSettingsOverlay (decision) {
	if (!decision || decision.status !== "compliant" || decision.blocking) return null;
	return copyObject(decision.effectiveSettings);
}

/** Return the complete transient state that must be removed on campaign-rule teardown. */
export function getClearedCampaignRulesState () {
	return {
		hubContext: null,
		overlay: null,
		carryAuthorityContext: null,
	};
}

export function getCampaignSettingsOverlayFromRulesVersion (rulesVersion) {
	if (!rulesVersion) return null;
	if (rulesVersion.ruleDecision) {
		if (!isClosedRuleDecision(rulesVersion.ruleDecision)) return null;
		const identity = getPolicyIdentity(rulesVersion);
		const decisionIdentity = rulesVersion.ruleDecision.policyIdentity;
		if (
			!identity
			|| !decisionIdentity
			|| identity.id !== decisionIdentity.id
			|| identity.version !== decisionIdentity.version
			|| identity.schemaVersion !== decisionIdentity.schemaVersion
			|| identity.catalogVersion !== decisionIdentity.catalogVersion
		) return null;
		return getCampaignSettingsOverlay(rulesVersion.ruleDecision);
	}
	// Older browser contexts carried only `{id, rules}`. Keep that schema-v1 adapter explicit
	// rather than weakening the closed evaluator envelope for direct callers.
	if (
		!Object.hasOwn(rulesVersion, "version")
		&& !Object.hasOwn(rulesVersion, "schemaVersion")
		&& !Object.hasOwn(rulesVersion, "catalogVersion")
	) {
		return getCampaignSettingsOverlay(evaluateCampaignRules({
			capabilities: [],
			expectedRulesVersionId: null,
			personalSettings: {},
			protocolVersion: CAMPAIGN_RULE_PROTOCOL_VERSION,
			rulesVersion: {
				id: typeof rulesVersion.id === "string" && rulesVersion.id ? rulesVersion.id : "legacy",
				version: 1,
				schemaVersion: 1,
				catalogVersion: CAMPAIGN_RULES_CATALOG_VERSION,
				rules: rulesVersion.rules,
			},
			surface: "characterOpen",
		}));
	}
	const legacyDecision = evaluateCampaignRules({
		capabilities: [],
		expectedRulesVersionId: rulesVersion.id,
		personalSettings: {},
		protocolVersion: CAMPAIGN_RULE_PROTOCOL_VERSION,
		rulesVersion: {
			...rulesVersion,
			schemaVersion: 1,
		},
		surface: "characterOpen",
	});
	return getCampaignSettingsOverlay(legacyDecision);
}
