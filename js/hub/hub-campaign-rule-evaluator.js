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
	return structuredClone(value);
}

function blocked ({surface, personalSettings, rulesVersion = null, code, ruleId = null}) {
	return {
		schemaVersion: 1,
		evaluatorVersion: CAMPAIGN_RULE_EVALUATOR_VERSION,
		status: "blocked",
		blocking: true,
		surface,
		policyIdentity: rulesVersion?.id
			? {
				id: rulesVersion.id,
				version: Number(rulesVersion.version),
				schemaVersion: Number(rulesVersion.schemaVersion),
				catalogVersion: Number(rulesVersion.catalogVersion ?? CAMPAIGN_RULES_CATALOG_VERSION),
			}
			: null,
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
	if (unknownInputKeys.length || !_SURFACES.has(surface)) {
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
	if (!rulesVersion || typeof rulesVersion !== "object" || Array.isArray(rulesVersion) || !rulesVersion.id) {
		return blocked({surface, personalSettings, rulesVersion, code: "RULES_VERSION_INVALID"});
	}
	if (input.expectedRulesVersionId != null && input.expectedRulesVersionId !== rulesVersion.id) {
		return blocked({surface, personalSettings, rulesVersion, code: "POLICY_VERSION_STALE"});
	}
	const schemaVersion = Number(rulesVersion.schemaVersion ?? 1);
	if (![1, CAMPAIGN_RULES_POLICY_SCHEMA_VERSION].includes(schemaVersion)) {
		return blocked({surface, personalSettings, rulesVersion, code: "RULES_SCHEMA_UNSUPPORTED"});
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
		policy = schemaVersion === CAMPAIGN_RULES_POLICY_SCHEMA_VERSION
			? normalizeCampaignRulesPolicy(rulesVersion.rules)
			: getCampaignRulesPolicy({schemaVersion, rules: rulesVersion.rules});
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

	return {
		schemaVersion: 1,
		evaluatorVersion: CAMPAIGN_RULE_EVALUATOR_VERSION,
		status: "compliant",
		blocking: false,
		surface,
		policyIdentity: {
			id: rulesVersion.id,
			version: Number(rulesVersion.version),
			schemaVersion,
			catalogVersion: Number(policy.catalogVersion),
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

export function getCampaignSettingsOverlayFromRulesVersion (rulesVersion) {
	if (!rulesVersion) return null;
	if (rulesVersion.ruleDecision) return getCampaignSettingsOverlay(rulesVersion.ruleDecision);
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
