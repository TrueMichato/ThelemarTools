import {HUB_CAPABILITY_CAMPAIGN_RULES_POLICY} from "./hub-capabilities.js";

export const CAMPAIGN_RULES_POLICY_CAPABILITY = HUB_CAPABILITY_CAMPAIGN_RULES_POLICY;
export const CAMPAIGN_RULES_POLICY_SCHEMA_VERSION = 2;
export const CAMPAIGN_RULES_CATALOG_VERSION = 1;

export const DEFAULT_CAMPAIGN_SETTINGS = Object.freeze({
	enableTgtt: true,
	exhaustionRules: "thelemar",
	thelemar_carryWeight: true,
	thelemar_encumbranceTiers: true,
	thelemar_jumping: true,
	thelemar_linguisticsBonus: true,
	thelemar_criticalRolls: true,
});

const SUPPORTED_RULE_IDS = Object.freeze([
	"tgtt.enabled",
	"rules.exhaustion.system",
	"tgtt.carry-weight",
	"tgtt.encumbrance-tiers",
	"tgtt.jumping",
	"tgtt.linguistics-bonus",
	"tgtt.critical-rolls",
]);

const ENFORCED_RULE_IDS = new Set([
	"tgtt.carry-weight",
	"tgtt.encumbrance-tiers",
]);

const SURFACES_TGTT_ENFORCED = Object.freeze({
	characterOpen: "implemented",
	builder: "implemented",
	levelUp: "implemented",
	quickBuild: "implemented",
	respec: "implemented",
	contentFilter: "planned",
	characterWrite: "implemented",
	hubAdmin: "implemented",
});

const SURFACES_TGTT_ADVISORY = Object.freeze({
	characterOpen: "implemented",
	builder: "planned",
	levelUp: "planned",
	quickBuild: "planned",
	respec: "planned",
	contentFilter: "planned",
	characterWrite: "planned",
	hubAdmin: "implemented",
});

const SURFACES_TGTT_MASTER = Object.freeze({
	characterOpen: "implemented",
	builder: "implemented",
	levelUp: "implemented",
	quickBuild: "implemented",
	respec: "implemented",
	contentFilter: "implemented",
	characterWrite: "planned",
	hubAdmin: "implemented",
});

const SURFACES_CONTENT = Object.freeze({
	characterOpen: "planned",
	builder: "planned",
	levelUp: "planned",
	quickBuild: "planned",
	respec: "planned",
	contentFilter: "planned",
	characterWrite: "planned",
	hubAdmin: "planned",
});

/**
 * @typedef {"content"|"core"|"thelemar"} CampaignRuleCategory
 * @typedef {"implemented_enforced"|"implemented_advisory"|"informational_planned"|"unavailable"} CampaignRuleLifecycle
 * @typedef {"boolean"|"enum"|"string_list"|"uid_list"} CampaignRuleParameterType
 * @typedef {{
 *   id: string,
 *   ruleSchemaVersion: number,
 *   category: CampaignRuleCategory,
 *   applicability: {editions: string[], scope: "campaign"},
 *   title: string,
 *   summary: string,
 *   details: string,
 *   lifecycle: CampaignRuleLifecycle,
 *   supportLabel: string,
 *   isSelectable: boolean,
 *   parameter: {
 *     key: string,
 *     type: CampaignRuleParameterType,
 *     label: string,
 *     default: unknown,
 *     options?: {value: string, label: string}[],
 *     maxItems?: number,
 *   },
 *   implementationStatus: Record<string, "planned"|"advisory"|"implemented"|"retired">,
 *   compatibility: {requires: {id: string, parameter: string, equals: unknown, when?: {parameter: string, equals: unknown}}[], conflicts: string[]},
 * }} CampaignRuleDefinition
 */

/** @type {ReadonlyArray<Readonly<CampaignRuleDefinition>>} */
export const CAMPAIGN_RULES_CATALOG = Object.freeze([
	{
		id: "content.sources.allowed",
		ruleSchemaVersion: 1,
		category: "content",
		applicability: {editions: ["2014", "2024"], scope: "campaign"},
		title: "Allowed sources",
		summary: "Limit new campaign choices to named books and campaign sources.",
		details: "Source enforcement is planned. This catalog entry is visible for planning but cannot be selected yet.",
		lifecycle: "informational_planned",
		supportLabel: "Planned",
		isSelectable: false,
		parameter: {key: "sources", type: "string_list", label: "Sources", default: [], maxItems: 100},
		implementationStatus: SURFACES_CONTENT,
		compatibility: {requires: [], conflicts: []},
	},
	{
		id: "content.species.allowed",
		ruleSchemaVersion: 1,
		category: "content",
		applicability: {editions: ["2014", "2024"], scope: "campaign"},
		title: "Allowed species",
		summary: "Limit new characters to selected species and source identities.",
		details: "Species enforcement is planned. Existing characters will not be changed when support is added.",
		lifecycle: "informational_planned",
		supportLabel: "Planned",
		isSelectable: false,
		parameter: {key: "species", type: "uid_list", label: "Species", default: [], maxItems: 100},
		implementationStatus: SURFACES_CONTENT,
		compatibility: {requires: [], conflicts: []},
	},
	{
		id: "content.editions.allowed",
		ruleSchemaVersion: 1,
		category: "content",
		applicability: {editions: ["2014", "2024"], scope: "campaign"},
		title: "Allowed editions",
		summary: "Limit new campaign choices to the 2014 rules, 2024 rules, or both.",
		details: "Edition enforcement is planned. This selection stays unavailable until all required surfaces can honor it.",
		lifecycle: "informational_planned",
		supportLabel: "Planned",
		isSelectable: false,
		parameter: {
			key: "editions",
			type: "string_list",
			label: "Editions",
			default: ["2014", "2024"],
			options: [{value: "2014", label: "2014"}, {value: "2024", label: "2024"}],
			maxItems: 2,
		},
		implementationStatus: SURFACES_CONTENT,
		compatibility: {requires: [], conflicts: []},
	},
	{
		id: "tgtt.enabled",
		ruleSchemaVersion: 1,
		category: "thelemar",
		applicability: {editions: ["2014", "2024"], scope: "campaign"},
		title: "Thelemar rules",
		summary: "Apply the campaign's existing Thelemar settings overlay.",
		details: "The Character Sheet reads this setting without changing a player's personal settings. Downstream choice enforcement is not included.",
		lifecycle: "implemented_advisory",
		supportLabel: "Advisory",
		isSelectable: true,
		parameter: {key: "enabled", type: "boolean", label: "Enable Thelemar rules", default: true},
		implementationStatus: SURFACES_TGTT_MASTER,
		compatibility: {requires: [], conflicts: []},
	},
	{
		id: "rules.exhaustion.system",
		ruleSchemaVersion: 1,
		category: "core",
		applicability: {editions: ["2014", "2024"], scope: "campaign"},
		title: "Exhaustion system",
		summary: "Choose the exhaustion model shown by campaign character tools.",
		details: "This setting projects to the existing Character Sheet exhaustion setting. It does not validate character writes on the server.",
		lifecycle: "implemented_advisory",
		supportLabel: "Advisory",
		isSelectable: true,
		parameter: {
			key: "system",
			type: "enum",
			label: "Exhaustion model",
			default: "thelemar",
			options: [
				{value: "thelemar", label: "Thelemar"},
				{value: "2024", label: "2024 rules"},
				{value: "2014", label: "2014 rules"},
			],
		},
		implementationStatus: SURFACES_TGTT_ADVISORY,
		compatibility: {
			requires: [{
				id: "tgtt.enabled",
				parameter: "enabled",
				equals: true,
				when: {parameter: "system", equals: "thelemar"},
			}],
			conflicts: [],
		},
	},
	{
		id: "tgtt.carry-weight",
		ruleSchemaVersion: 1,
		category: "thelemar",
		applicability: {editions: ["2014", "2024"], scope: "campaign"},
		title: "Thelemar carry capacity",
		summary: "Use the established Thelemar carry-capacity setting for campaign characters.",
		details: "The Character Sheet and DM projection apply this calculation from the transient campaign overlay; protocol-4 carry writes are fenced to the active policy identity.",
		lifecycle: "implemented_enforced",
		supportLabel: "Enforced",
		isSelectable: true,
		parameter: {key: "enabled", type: "boolean", label: "Enable Thelemar carry capacity", default: true},
		implementationStatus: SURFACES_TGTT_ENFORCED,
		compatibility: {requires: [], conflicts: []},
	},
	{
		id: "tgtt.encumbrance-tiers",
		ruleSchemaVersion: 1,
		category: "thelemar",
		applicability: {editions: ["2014", "2024"], scope: "campaign"},
		title: "Thelemar encumbrance tiers",
		summary: "Use the campaign's existing tiered-encumbrance house extension.",
		details: "This is a ThelemarTools house extension, not a rule published in the Traveler's Guide to Thelemar. Protocol-4 carry writes are fenced to the active policy identity.",
		lifecycle: "implemented_enforced",
		supportLabel: "Enforced",
		isSelectable: true,
		parameter: {key: "enabled", type: "boolean", label: "Enable encumbrance tiers", default: true},
		implementationStatus: SURFACES_TGTT_ENFORCED,
		compatibility: {
			requires: [{
				id: "tgtt.carry-weight",
				parameter: "enabled",
				equals: true,
				when: {parameter: "enabled", equals: true},
			}],
			conflicts: [],
		},
	},
	{
		id: "tgtt.jumping",
		ruleSchemaVersion: 1,
		category: "thelemar",
		applicability: {editions: ["2014", "2024"], scope: "campaign"},
		title: "Thelemar jumping",
		summary: "Use the established Thelemar jumping calculations for campaign characters.",
		details: "The Character Sheet already reads this setting. The policy catalog does not duplicate its calculations.",
		lifecycle: "implemented_advisory",
		supportLabel: "Advisory",
		isSelectable: true,
		parameter: {key: "enabled", type: "boolean", label: "Enable Thelemar jumping", default: true},
		implementationStatus: SURFACES_TGTT_ADVISORY,
		compatibility: {requires: [], conflicts: []},
	},
	{
		id: "tgtt.linguistics-bonus",
		ruleSchemaVersion: 1,
		category: "thelemar",
		applicability: {editions: ["2014", "2024"], scope: "campaign"},
		title: "Linguistics bonus",
		summary: "Use the established Thelemar Linguistics bonus setting.",
		details: "The Character Sheet already reads this setting. Server-side character enforcement is not included.",
		lifecycle: "implemented_advisory",
		supportLabel: "Advisory",
		isSelectable: true,
		parameter: {key: "enabled", type: "boolean", label: "Enable Linguistics bonus", default: true},
		implementationStatus: SURFACES_TGTT_ADVISORY,
		compatibility: {requires: [], conflicts: []},
	},
	{
		id: "tgtt.critical-rolls",
		ruleSchemaVersion: 1,
		category: "thelemar",
		applicability: {editions: ["2014", "2024"], scope: "campaign"},
		title: "Thelemar critical rolls",
		summary: "Use the established Thelemar critical-roll setting.",
		details: "Supported character tools read this setting as an advisory campaign overlay; the Hub does not enforce roll outcomes.",
		lifecycle: "implemented_advisory",
		supportLabel: "Advisory",
		isSelectable: true,
		parameter: {key: "enabled", type: "boolean", label: "Enable Thelemar critical rolls", default: true},
		implementationStatus: SURFACES_TGTT_ADVISORY,
		compatibility: {requires: [], conflicts: []},
	},
].map(definition => Object.freeze(definition)));

const CATALOG_BY_ID = new Map(CAMPAIGN_RULES_CATALOG.map(definition => [definition.id, definition]));
const SETTING_BY_RULE_ID = Object.freeze({
	"tgtt.enabled": "enableTgtt",
	"rules.exhaustion.system": "exhaustionRules",
	"tgtt.carry-weight": "thelemar_carryWeight",
	"tgtt.encumbrance-tiers": "thelemar_encumbranceTiers",
	"tgtt.jumping": "thelemar_jumping",
	"tgtt.linguistics-bonus": "thelemar_linguisticsBonus",
	"tgtt.critical-rolls": "thelemar_criticalRolls",
});

export class CampaignRulesPolicyError extends Error {
	constructor (code, message, {details = null} = {}) {
		super(message);
		this.name = "CampaignRulesPolicyError";
		this.code = code;
		this.details = details;
	}
}

function copy (value) {
	return value == null ? value : structuredClone(value);
}

function assertPlainObject (value, code, message) {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new CampaignRulesPolicyError(code, message);
	}
}

function assertOnlyKeys (value, allowed, code, message) {
	const unknown = Object.keys(value).filter(key => !allowed.has(key));
	if (unknown.length) throw new CampaignRulesPolicyError(code, message, {details: {keys: unknown.sort()}});
}

function getRuleValueLabel (definition, value) {
	if (definition.parameter.type === "boolean") return value ? "On" : "Off";
	return definition.parameter.options?.find(option => option.value === value)?.label || `${value}`;
}

function normalizeLegacySettings (rules) {
	assertPlainObject(rules, "RULES_INVALID", "Campaign rules must be an object.");
	assertOnlyKeys(rules, new Set(Object.keys(DEFAULT_CAMPAIGN_SETTINGS)), "RULES_INVALID", "Unsupported campaign rule keys.");
	const out = {...DEFAULT_CAMPAIGN_SETTINGS};
	for (const [key, value] of Object.entries(rules)) {
		if (key === "exhaustionRules") {
			if (!["2014", "2024", "thelemar"].includes(value)) {
				throw new CampaignRulesPolicyError("RULES_INVALID", "Invalid exhaustion rules.");
			}
		} else if (typeof value !== "boolean") {
			throw new CampaignRulesPolicyError("RULES_INVALID", `Campaign rule "${key}" must be boolean.`);
		}
		out[key] = value;
	}
	return out;
}

function getSelectionMap (policy) {
	return new Map(policy.rules.map(rule => [rule.id, rule]));
}

function normalizeRuleParameters (definition, parameters) {
	assertPlainObject(parameters, "RULES_PARAMETER_INVALID", `Parameters for "${definition.id}" must be an object.`);
	assertOnlyKeys(
		parameters,
		new Set([definition.parameter.key]),
		"RULES_PARAMETER_INVALID",
		`Unsupported parameters for "${definition.id}".`,
	);
	if (!Object.hasOwn(parameters, definition.parameter.key)) {
		throw new CampaignRulesPolicyError("RULES_PARAMETER_INVALID", `Rule "${definition.id}" requires "${definition.parameter.key}".`);
	}
	const value = parameters[definition.parameter.key];
	if (definition.parameter.type === "boolean" && typeof value !== "boolean") {
		throw new CampaignRulesPolicyError("RULES_PARAMETER_INVALID", `Rule "${definition.id}" requires a boolean.`);
	}
	if (definition.parameter.type === "enum" && !definition.parameter.options.some(option => option.value === value)) {
		throw new CampaignRulesPolicyError("RULES_PARAMETER_INVALID", `Rule "${definition.id}" has an unsupported value.`);
	}
	return {[definition.parameter.key]: copy(value)};
}

function validateCompatibility (policy) {
	const selections = getSelectionMap(policy);
	for (const selection of policy.rules) {
		const definition = CATALOG_BY_ID.get(selection.id);
		for (const requirement of definition.compatibility.requires) {
			const dependency = selections.get(requirement.id);
			const isApplicable = requirement.when
				? selection.parameters[requirement.when.parameter] === requirement.when.equals
				: selection.parameters[definition.parameter.key] !== false;
			if (!isApplicable) continue;
			if (!dependency || dependency.parameters[requirement.parameter] !== requirement.equals) {
				throw new CampaignRulesPolicyError(
					"RULES_COMBINATION_UNSUPPORTED",
					`Rule "${selection.id}" requires "${requirement.id}".`,
					{details: {ruleId: selection.id, requiresRuleId: requirement.id}},
				);
			}
		}
	}
}

function normalizeCampaignRulesPolicyInternal (policy, {isValidateCompatibility = true} = {}) {
	assertPlainObject(policy, "RULES_INVALID", "Campaign policy must be an object.");
	assertOnlyKeys(policy, new Set(["schemaVersion", "catalogVersion", "rules", "notes"]), "RULES_INVALID", "Unsupported campaign policy fields.");
	if (policy.schemaVersion !== CAMPAIGN_RULES_POLICY_SCHEMA_VERSION) {
		throw new CampaignRulesPolicyError("RULES_SCHEMA_UNSUPPORTED", "Campaign policy schema version is not supported.");
	}
	if (policy.catalogVersion !== CAMPAIGN_RULES_CATALOG_VERSION) {
		throw new CampaignRulesPolicyError("RULES_CATALOG_UNSUPPORTED", "Campaign rules catalog version is not supported.");
	}
	if (!Array.isArray(policy.rules) || policy.rules.length > CAMPAIGN_RULES_CATALOG.length) {
		throw new CampaignRulesPolicyError("RULES_INVALID", "Campaign policy rules must be a bounded array.");
	}
	if (!Array.isArray(policy.notes) || policy.notes.length > 25) {
		throw new CampaignRulesPolicyError("RULES_INVALID", "Campaign policy notes must be a bounded array.");
	}

	const seenRuleIds = new Set();
	const rules = policy.rules.map(selection => {
		assertPlainObject(selection, "RULES_INVALID", "Every campaign rule selection must be an object.");
		assertOnlyKeys(selection, new Set(["id", "ruleSchemaVersion", "mode", "parameters"]), "RULES_INVALID", "Unsupported campaign rule selection fields.");
		if (typeof selection.id !== "string" || selection.id.length > 100) {
			throw new CampaignRulesPolicyError("RULES_UNKNOWN", "Campaign rule ID is invalid.");
		}
		const definition = CATALOG_BY_ID.get(selection.id);
		if (!definition) {
			throw new CampaignRulesPolicyError("RULES_UNKNOWN", `Campaign rule "${selection.id}" is unknown.`, {details: {ruleId: selection.id}});
		}
		if (seenRuleIds.has(selection.id)) {
			throw new CampaignRulesPolicyError("RULES_INVALID", `Campaign rule "${selection.id}" is selected more than once.`);
		}
		seenRuleIds.add(selection.id);
		if (!definition.isSelectable) {
			throw new CampaignRulesPolicyError("RULES_UNAVAILABLE", `Campaign rule "${selection.id}" is not available for selection.`);
		}
		if (selection.ruleSchemaVersion !== definition.ruleSchemaVersion) {
			throw new CampaignRulesPolicyError("RULES_SCHEMA_UNSUPPORTED", `Campaign rule "${selection.id}" uses an unsupported schema version.`);
		}
		if (
			!["advisory", "enforced"].includes(selection.mode)
			|| (selection.mode === "enforced" && definition.lifecycle !== "implemented_enforced")
		) {
			throw new CampaignRulesPolicyError("RULES_MODE_UNSUPPORTED", `Campaign rule "${selection.id}" has an unsupported mode.`);
		}
		return {
			id: selection.id,
			ruleSchemaVersion: selection.ruleSchemaVersion,
			mode: selection.mode,
			parameters: normalizeRuleParameters(definition, selection.parameters),
		};
	});
	const missingRuleIds = SUPPORTED_RULE_IDS.filter(id => !seenRuleIds.has(id));
	if (missingRuleIds.length) {
		throw new CampaignRulesPolicyError("RULES_INVALID", "Campaign policy is missing supported rule selections.", {details: {ruleIds: missingRuleIds}});
	}

	const seenNoteIds = new Set();
	const notes = policy.notes.map(note => {
		assertPlainObject(note, "RULES_NOTE_INVALID", "Every campaign policy note must be an object.");
		assertOnlyKeys(note, new Set(["id", "title", "explanation"]), "RULES_NOTE_INVALID", "Unsupported campaign policy note fields.");
		if (
			typeof note.id !== "string"
			|| !/^[a-z0-9][a-z0-9.-]{0,63}$/.test(note.id)
			|| seenNoteIds.has(note.id)
			|| typeof note.title !== "string"
			|| note.title.trim().length < 1
			|| note.title.length > 100
			|| typeof note.explanation !== "string"
			|| note.explanation.trim().length < 1
			|| note.explanation.length > 500
			|| [...`${note.title}${note.explanation}`].some(char => "<>".includes(char) || char.codePointAt(0) < 32)
		) throw new CampaignRulesPolicyError("RULES_NOTE_INVALID", "Campaign policy note is invalid.");
		seenNoteIds.add(note.id);
		return {id: note.id, title: note.title.trim(), explanation: note.explanation.trim()};
	});
	const normalized = {
		schemaVersion: CAMPAIGN_RULES_POLICY_SCHEMA_VERSION,
		catalogVersion: CAMPAIGN_RULES_CATALOG_VERSION,
		rules,
		notes,
	};
	if (isValidateCompatibility) validateCompatibility(normalized);
	return normalized;
}

export function normalizeCampaignRulesPolicy (policy) {
	return normalizeCampaignRulesPolicyInternal(policy);
}

export function adaptLegacyCampaignRules (rules) {
	const settings = normalizeLegacySettings(rules);
	const selections = SUPPORTED_RULE_IDS.map(id => {
		const definition = CATALOG_BY_ID.get(id);
		const settingKey = SETTING_BY_RULE_ID[id];
		return {
			id,
			ruleSchemaVersion: definition.ruleSchemaVersion,
			mode: "advisory",
			parameters: {[definition.parameter.key]: settings[settingKey]},
		};
	});
	return normalizeCampaignRulesPolicyInternal({
		schemaVersion: CAMPAIGN_RULES_POLICY_SCHEMA_VERSION,
		catalogVersion: CAMPAIGN_RULES_CATALOG_VERSION,
		rules: selections,
		notes: [],
	}, {isValidateCompatibility: false});
}

export function createDefaultCampaignRulesPolicy () {
	const policy = adaptLegacyCampaignRules(DEFAULT_CAMPAIGN_SETTINGS);
	policy.rules.forEach(rule => {
		if (ENFORCED_RULE_IDS.has(rule.id)) rule.mode = "enforced";
	});
	return policy;
}

export function getCampaignRulesPolicy ({schemaVersion, rules}) {
	if (schemaVersion === CAMPAIGN_RULES_POLICY_SCHEMA_VERSION || rules?.schemaVersion === CAMPAIGN_RULES_POLICY_SCHEMA_VERSION) {
		return normalizeCampaignRulesPolicyInternal(rules, {isValidateCompatibility: false});
	}
	return adaptLegacyCampaignRules(rules);
}

export function projectCampaignSettings ({schemaVersion, rules}) {
	const policy = getCampaignRulesPolicy({schemaVersion, rules});
	const out = {...DEFAULT_CAMPAIGN_SETTINGS};
	for (const selection of policy.rules) {
		const definition = CATALOG_BY_ID.get(selection.id);
		out[SETTING_BY_RULE_ID[selection.id]] = selection.parameters[definition.parameter.key];
	}
	return out;
}

export function getCampaignRulesPolicySummary (policy) {
	const normalized = normalizeCampaignRulesPolicyInternal(policy, {isValidateCompatibility: false});
	return {
		catalogVersion: normalized.catalogVersion,
		rules: normalized.rules.map(selection => {
			const definition = CATALOG_BY_ID.get(selection.id);
			return {
				id: selection.id,
				title: definition.title,
				value: getRuleValueLabel(definition, selection.parameters[definition.parameter.key]),
				supportLabel: selection.mode === "enforced" ? "Enforced" : "Advisory",
			};
		}),
	};
}

export function diffCampaignRulesPolicies ({before, after, isAfterStoredPolicy = false}) {
	const beforeMap = getSelectionMap(normalizeCampaignRulesPolicyInternal(before, {isValidateCompatibility: false}));
	const afterNormalized = normalizeCampaignRulesPolicyInternal(after, {isValidateCompatibility: !isAfterStoredPolicy});
	return afterNormalized.rules.flatMap(selection => {
		const definition = CATALOG_BY_ID.get(selection.id);
		const key = definition.parameter.key;
		const beforeValue = beforeMap.get(selection.id)?.parameters[key];
		const afterValue = selection.parameters[key];
		if (JSON.stringify(beforeValue) === JSON.stringify(afterValue)) return [];
		return [{
			ruleId: selection.id,
			title: definition.title,
			before: getRuleValueLabel(definition, beforeValue),
			after: getRuleValueLabel(definition, afterValue),
		}];
	});
}

export function getPublicCampaignRulesCatalog () {
	return {
		catalogVersion: CAMPAIGN_RULES_CATALOG_VERSION,
		categories: [
			{id: "content", label: "Content"},
			{id: "core", label: "Core rules"},
			{id: "thelemar", label: "Thelemar"},
		],
		rules: copy(CAMPAIGN_RULES_CATALOG),
	};
}
