import crypto from "node:crypto";
import {HubStoreError} from "./hub-store-error.js";
import {validateCloudValue} from "./cloud-data-validation.js";
import {
	CAMPAIGN_RULES_POLICY_CAPABILITY,
	CampaignRulesPolicyError,
	DEFAULT_CAMPAIGN_SETTINGS,
	getCampaignRulesPolicy,
	getCampaignRulesPolicySummary,
	getCampaignRulesContentPolicy,
	normalizeCampaignRulesPolicy,
	projectCampaignSettings,
} from "../../js/hub/hub-campaign-rules.js";
import {
	CAMPAIGN_RULE_PROTOCOL_VERSION,
	evaluateCampaignRules,
} from "../../js/hub/hub-campaign-rule-evaluator.js";

export const CAMPAIGN_RULES_SCHEMA_VERSION = 1;

export const DEFAULT_CAMPAIGN_RULES = DEFAULT_CAMPAIGN_SETTINGS;

const _RULE_KEYS = new Set(Object.keys(DEFAULT_CAMPAIGN_RULES));
const _MAX_BUNDLE_BYTES = 1024 * 1024;
const _MAX_DOCUMENTS = 100;
const _MAX_DEPTH = 100;

function canonicalize (value) {
	if (Array.isArray(value)) return value.map(canonicalize);
	if (value && typeof value === "object") {
		return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalize(value[key])]));
	}
	return value;
}

function walk (value, fnVisit, depth = 0, key = null) {
	if (depth > _MAX_DEPTH) throw new HubStoreError("BREW_TOO_DEEP", `Campaign brew nesting is too deep.`);
	fnVisit(value, {key});
	if (Array.isArray(value)) value.forEach(it => walk(it, fnVisit, depth + 1, key));
	else if (value && typeof value === "object") Object.entries(value).forEach(([childKey, it]) => walk(it, fnVisit, depth + 1, childKey));
}

function decodeHtmlEntities (value) {
	return value
		.replace(/&#x([0-9a-f]+);?/gi, (...m) => String.fromCodePoint(parseInt(m[1], 16)))
		.replace(/&#([0-9]+);?/g, (...m) => String.fromCodePoint(parseInt(m[1], 10)))
		.replace(/&colon;?/gi, ":")
		.replace(/&tab;?/gi, "\t")
		.replace(/&newline;?/gi, "\n")
		.replace(/&amp;/gi, "&")
		.replace(/&quot;/gi, "\"")
		.replace(/&#39;|&apos;/gi, "'");
}

function getSources (brewDocs) {
	return new Set(brewDocs.flatMap(doc => doc.body?._meta?.sources || []).map(source => source?.json).filter(Boolean));
}

function getDependencies (brewDocs) {
	return new Set(brewDocs.flatMap(doc => {
		const dependencies = doc.body?._meta?.dependencies;
		if (!dependencies || typeof dependencies !== "object") return [];
		return Object.values(dependencies).flat().filter(it => typeof it === "string");
	}));
}

export function validateCampaignBrewBundle (brewDocs) {
	if (!Array.isArray(brewDocs) || !brewDocs.length) {
		throw new HubStoreError("BREW_INVALID", `Campaign brew must contain at least one document.`);
	}
	if (brewDocs.length > _MAX_DOCUMENTS) throw new HubStoreError("BREW_TOO_LARGE", `Campaign brew has too many documents.`);
	const byteLength = Buffer.byteLength(JSON.stringify(brewDocs), "utf8");
	if (byteLength > _MAX_BUNDLE_BYTES) throw new HubStoreError("BREW_TOO_LARGE", `Campaign brew exceeds the 1 MB V1 limit.`);

	for (const doc of brewDocs) {
		if (!doc?.head || !doc?.body || typeof doc.body !== "object" || Array.isArray(doc.body)) {
			throw new HubStoreError("BREW_INVALID", `Every campaign brew document requires head and body objects.`);
		}
		if (doc.body.blocklist?.length) {
			throw new HubStoreError("BREW_BLOCKLIST_FORBIDDEN", `Campaign brew cannot change a member's persistent blocklist.`);
		}
		try {
			validateCloudValue(doc, {label: "Campaign brew"});
		} catch (error) {
			const code = {
				CLOUD_HTML_FORBIDDEN: "BREW_RAW_HTML_FORBIDDEN",
				CLOUD_URL_FORBIDDEN: "BREW_URL_FORBIDDEN",
				CLOUD_KEY_FORBIDDEN: "BREW_KEY_FORBIDDEN",
			}[error.code];
			if (!code) throw error;
			throw new HubStoreError(code, error.message);
		}
		walk(doc.body, (value, {key}) => {
			if (value?.type === "wrappedHtml") {
				throw new HubStoreError("BREW_RAW_HTML_FORBIDDEN", `Campaign brew cannot contain wrappedHtml entries.`);
			}
			if (typeof value === "string" && /<\/?[a-z][^>]*>|\bon\w+\s*=/i.test(value)) {
				throw new HubStoreError("BREW_RAW_HTML_FORBIDDEN", `Campaign brew contains unsafe HTML.`);
			}
			if (typeof value === "string") {
				const decoded = decodeHtmlEntities(value);
				const compact = [...decoded].filter(char => char.charCodeAt(0) > 0x20).join("");
				if (/(?:^|\|)(?:javascript|data|vbscript|file):/i.test(compact)) {
					throw new HubStoreError("BREW_URL_FORBIDDEN", `Campaign brew contains an unsafe URL scheme.`);
				}
				if (/^(?:url|href)$/i.test(key || "")) {
					if (/["'`<>]/.test(decoded)) throw new HubStoreError("BREW_URL_FORBIDDEN", `Campaign brew URL contains unsafe characters.`);
					if (!/^(?:https?:|\/|\.{1,2}\/)/i.test(compact)) throw new HubStoreError("BREW_URL_FORBIDDEN", `Campaign brew URL must be HTTP(S) or relative.`);
				}
			}
		});
	}

	const sources = getSources(brewDocs);
	const missingDependencies = [...getDependencies(brewDocs)].filter(source => !sources.has(source));
	if (missingDependencies.length) {
		throw new HubStoreError("BREW_DEPENDENCY_MISSING", `Campaign brew dependencies are missing.`, {
			details: {sources: missingDependencies.sort()},
		});
	}
	return {
		byteLength,
		documentCount: brewDocs.length,
		sources: [...sources].sort(),
	};
}

export function getCampaignBrewHash (brewDocs) {
	validateCampaignBrewBundle(brewDocs);
	return crypto.createHash("sha256").update(JSON.stringify(canonicalize(brewDocs))).digest("hex");
}

export function normalizeCampaignRules (rules) {
	if (rules?.schemaVersion === 2) {
		try {
			return projectCampaignSettings({schemaVersion: 2, rules});
		} catch (error) {
			if (!(error instanceof CampaignRulesPolicyError)) throw error;
			throw new HubStoreError(error.code, error.message, {details: error.details});
		}
	}
	if (!rules || typeof rules !== "object" || Array.isArray(rules)) {
		throw new HubStoreError("RULES_INVALID", `Campaign rules must be an object.`);
	}
	const unknown = Object.keys(rules).filter(key => !_RULE_KEYS.has(key));
	if (unknown.length) throw new HubStoreError("RULES_INVALID", `Unsupported campaign rule keys.`, {details: {keys: unknown}});
	const out = {...DEFAULT_CAMPAIGN_RULES};
	for (const [key, value] of Object.entries(rules)) {
		if (key === "exhaustionRules") {
			if (!["2014", "2024", "thelemar"].includes(value)) {
				throw new HubStoreError("RULES_INVALID", `Invalid exhaustion rules.`);
			}
		} else if (typeof value !== "boolean") {
			throw new HubStoreError("RULES_INVALID", `Campaign rule "${key}" must be boolean.`);
		}
		out[key] = value;
	}
	return out;
}

export function getPublicCampaignRulesVersion (rulesVersion, {isIncludePolicy = false} = {}) {
	if (!rulesVersion) return null;
	try {
		const publicRulesVersion = {
			...rulesVersion,
			...(rulesVersion.createdAt == null
				? {}
				: {createdAt: new Date(rulesVersion.createdAt).toISOString()}),
		};
		const policy = getCampaignRulesPolicy({
			schemaVersion: publicRulesVersion.schemaVersion,
			rules: publicRulesVersion.rules,
		});
		return {
			...publicRulesVersion,
			catalogVersion: policy.catalogVersion,
			rules: projectCampaignSettings({
				schemaVersion: publicRulesVersion.schemaVersion,
				rules: publicRulesVersion.rules,
			}),
			...(isIncludePolicy ? {policy} : {}),
			contentPolicy: getCampaignRulesContentPolicy(policy),
			policySummary: getCampaignRulesPolicySummary(policy),
			ruleDecision: evaluateCampaignRules({
				capabilities: [CAMPAIGN_RULES_POLICY_CAPABILITY],
				personalSettings: {},
				protocolVersion: CAMPAIGN_RULE_PROTOCOL_VERSION,
				rulesVersion: publicRulesVersion,
				surface: "characterOpen",
			}),
		};
	} catch (error) {
		if (!(error instanceof CampaignRulesPolicyError)) throw error;
		throw new HubStoreError(error.code, error.message, {details: error.details});
	}
}

export function normalizeCampaignRulesPolicyForStorage (policy) {
	try {
		return normalizeCampaignRulesPolicy(policy);
	} catch (error) {
		if (!(error instanceof CampaignRulesPolicyError)) throw error;
		throw new HubStoreError(error.code, error.message, {details: error.details});
	}
}
