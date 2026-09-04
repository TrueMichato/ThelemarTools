import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {pathToFileURL} from "node:url";

async function loadVariant ({name, mutations = {}}) {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), `hub-rules-mutation-${name}-`));
	const hubDir = path.join(root, "hub");
	await fs.cp(path.resolve("js/hub"), hubDir, {recursive: true});
	await fs.writeFile(path.join(root, "package.json"), JSON.stringify({type: "module"}));
	for (const [fileName, mutate] of Object.entries(mutations)) {
		const filePath = path.join(hubDir, fileName);
		const source = await fs.readFile(filePath, "utf8");
		const mutated = mutate(source);
		if (mutated === source) throw new Error(`${name} mutation did not match ${fileName}.`);
		await fs.writeFile(filePath, mutated);
	}
	const pImport = fileName => import(`${pathToFileURL(path.join(hubDir, fileName)).href}?variant=${encodeURIComponent(name)}`);
	return {
		rules: await pImport("hub-campaign-rules.js"),
		evaluator: await pImport("hub-campaign-rule-evaluator.js"),
		capabilities: await pImport("hub-capabilities.js"),
		manager: await pImport("hub-rules-policy-manager.js"),
		cleanup: () => fs.rm(root, {recursive: true, force: true}),
	};
}

async function probeEvaluatorFailClosed ({rules, evaluator}) {
	const rulesVersion = {
		id: "rules-current",
		version: 1,
		schemaVersion: 2,
		catalogVersion: 1,
		rules: rules.createDefaultCampaignRulesPolicy(),
	};
	const base = {
		capabilities: [rules.CAMPAIGN_RULES_POLICY_CAPABILITY],
		personalSettings: {enableTgtt: false},
		protocolVersion: evaluator.CAMPAIGN_RULE_PROTOCOL_VERSION,
		rulesVersion,
		surface: "characterWrite",
	};
	assert.equal(evaluator.evaluateCampaignRules({...base, capabilities: []}).blocking, true);
	assert.equal(evaluator.evaluateCampaignRules({...base, expectedRulesVersionId: "rules-old"}).blocking, true);
	assert.equal(evaluator.getCampaignSettingsOverlay({
		status: "blocked",
		blocking: true,
		effectiveSettings: {enableTgtt: true},
	}), null);
}

function replaceLast (source, search, replacement) {
	const index = source.lastIndexOf(search);
	if (index < 0) return source;
	return `${source.slice(0, index)}${replacement}${source.slice(index + search.length)}`;
}

function mutateEncumbranceRequirement (source) {
	const start = source.indexOf("id: \"tgtt.encumbrance-tiers\"");
	const end = source.indexOf("id: \"tgtt.jumping\"", start);
	if (start < 0 || end < 0) return source;
	const segment = source.slice(start, end);
	const mutated = segment.replace("equals: true,", "equals: false,");
	return `${source.slice(0, start)}${mutated}${source.slice(end)}`;
}

async function probeHistoricalDiff ({rules}) {
	const active = rules.createDefaultCampaignRulesPolicy();
	const historical = rules.adaptLegacyCampaignRules({enableTgtt: false});
	assert.deepEqual(rules.diffCampaignRulesPolicies({
		before: active,
		after: historical,
		isAfterStoredPolicy: true,
	}), [{
		ruleId: "tgtt.enabled",
		title: "Thelemar rules",
		before: "On",
		after: "Off",
	}]);
	assert.throws(
		() => rules.diffCampaignRulesPolicies({before: active, after: historical}),
		error => error?.code === "RULES_COMBINATION_UNSUPPORTED",
	);
}

async function probeDependency ({rules}) {
	const policy = rules.createDefaultCampaignRulesPolicy();
	policy.rules.find(rule => rule.id === "tgtt.carry-weight").parameters.enabled = false;
	assert.throws(
		() => rules.normalizeCampaignRulesPolicy(policy),
		error => error?.code === "RULES_COMBINATION_UNSUPPORTED"
			&& error.details?.ruleId === "tgtt.encumbrance-tiers",
	);
	assert.equal(
		rules.projectCampaignSettings({
			schemaVersion: 1,
			rules: {thelemar_carryWeight: false, thelemar_encumbranceTiers: true},
		}).thelemar_encumbranceTiers,
		true,
	);
}

async function probeReconnectFence ({manager: {HubRulesPolicyManager}}) {
	let resolveLoad;
	const response = new Promise(resolve => resolveLoad = resolve);
	const originalManagement = {activeRulesVersionId: null, versions: []};
	const instance = Object.assign(Object.create(HubRulesPolicyManager.prototype), {
		_api: {pGetRulesPolicyManagement: () => response},
		_campaignId: "campaign",
		_management: originalManagement,
		_draft: {dirty: true},
		_isBusy: false,
		_isOffline: false,
		_isPolicyRefreshRequired: false,
		_policyLoadGeneration: 0,
		_pendingPolicyLoads: 0,
		_setLoading: () => {},
		_setStatus: () => {},
		_renderFilters: () => {},
		_renderCatalog: () => {},
		_renderHistory: () => {},
		_renderReview: () => {},
		_renderRollbackReview: () => {},
		_fnRenderError: error => { throw error; },
	});
	const pending = instance._pLoad({preservedDraft: instance._draft});
	instance._handleOffline();
	instance._handleOnline();
	resolveLoad({
		catalog: {categories: [], rules: []},
		management: {activeRulesVersionId: "stale", versions: [{id: "stale"}]},
	});
	await pending;
	assert.equal(instance._management, originalManagement, "a pre-offline load replaced post-reconnect policy state");
	assert.equal(instance._isPolicyRefreshRequired, true, "a pre-offline load cleared the reconnect freshness gate");
}

async function probeBusyControls ({manager: {HubRulesPolicyManager}}) {
	const input = {dataset: {}, disabled: false};
	const select = {dataset: {}, disabled: false};
	const button = {dataset: {}, disabled: false};
	const instance = Object.assign(Object.create(HubRulesPolicyManager.prototype), {
		_root: {
			querySelectorAll: selector => selector === "button" ? [button] : [input, select, button],
			setAttribute: () => {},
		},
		_management: null,
		_draft: null,
		_isBusy: false,
		_isLoading: false,
	});
	instance._setBusy(true);
	assert.equal(input.disabled, true, "policy inputs remained editable while busy");
	assert.equal(select.disabled, true, "policy selects remained editable while busy");
	assert.equal(button.disabled, true, "policy actions remained enabled while busy");
}

async function probeTerminalAccessLock ({manager: {HubRulesPolicyManager}}) {
	let rejectPublish;
	const publish = new Promise((resolve, reject) => rejectPublish = reject);
	const controls = [
		{dataset: {}, disabled: false},
		{dataset: {}, disabled: false},
		{dataset: {}, disabled: false},
		{dataset: {}, disabled: false},
	];
	const instance = Object.assign(Object.create(HubRulesPolicyManager.prototype), {
		_api: {pPublishRulesPolicy: () => publish},
		_campaignId: "campaign",
		_management: {activeRulesVersionId: "active", versions: []},
		_draft: {rules: []},
		_isBusy: false,
		_isLoading: false,
		_isOffline: false,
		_isPolicyRefreshRequired: false,
		_isReadOnlyAfterAccessChange: false,
		_root: {
			querySelectorAll: () => controls,
			setAttribute: () => {},
		},
		_setStatus: () => {},
		_renderCatalog: () => {},
		_renderHistory: () => {},
		_renderReview: () => {},
		_fnRenderError: () => {
			for (const control of controls) control.disabled = true;
		},
	});

	const pending = instance._pPublish();
	rejectPublish(Object.assign(new Error("access removed"), {code: "FORBIDDEN"}));
	await pending;

	assert.equal(instance._isReadOnlyAfterAccessChange, true, "terminal access loss did not persist read-only state");
	assert.equal(instance._isMutationUnavailable(), true, "terminal access loss did not fence later mutations");
	assert.equal(controls.every(control => control.disabled), true, "busy cleanup re-enabled policy controls after access loss");
}

async function probeOptionalImport ({capabilities}) {
	let importCount = 0;
	const disabled = await capabilities.pLoadHubCapabilityModule({
		capability: capabilities.HUB_CAPABILITY_CAMPAIGN_RULES_POLICY,
		pGetMeta: async () => ({capabilities: []}),
		pImport: async () => {
			importCount++;
			return {};
		},
	});
	assert.equal(disabled.status, "disabled");
	assert.equal(importCount, 0, "the optional policy chunk loaded while its capability was disabled");

	const chunkError = new Error("chunk unavailable");
	const unavailable = await capabilities.pLoadHubCapabilityModule({
		capability: capabilities.HUB_CAPABILITY_CAMPAIGN_RULES_POLICY,
		pGetMeta: async () => ({capabilities: [capabilities.HUB_CAPABILITY_CAMPAIGN_RULES_POLICY]}),
		pImport: async () => { throw chunkError; },
	});
	assert.equal(unavailable.status, "unavailable");
	assert.equal(unavailable.error, chunkError);
}

const MUTANTS = [
	{
		name: "evaluator-capability-gate-disabled",
		probe: probeEvaluatorFailClosed,
		mutations: {
			"hub-campaign-rule-evaluator.js": source => source.replace(
				"if (!Array.isArray(input.capabilities) || !input.capabilities.includes(CAMPAIGN_RULES_POLICY_CAPABILITY)) {",
				"if (false) {",
			),
		},
	},
	{
		name: "evaluator-policy-fence-disabled",
		probe: probeEvaluatorFailClosed,
		mutations: {
			"hub-campaign-rule-evaluator.js": source => source.replace(
				"if (input.expectedRulesVersionId != null && input.expectedRulesVersionId !== rulesVersion.id) {",
				"if (false) {",
			),
		},
	},
	{
		name: "evaluator-blocked-overlay-leak",
		probe: probeEvaluatorFailClosed,
		mutations: {
			"hub-campaign-rule-evaluator.js": source => source.replace(
				"if (!decision || decision.status !== \"compliant\" || decision.blocking) return null;",
				"if (!decision) return null;",
			),
		},
	},
	{
		name: "historical-diff-strict",
		probe: probeHistoricalDiff,
		mutations: {
			"hub-campaign-rules.js": source => source.replace(
				"const afterNormalized = normalizeCampaignRulesPolicyInternal(after, {isValidateCompatibility: !isAfterStoredPolicy});",
				"const afterNormalized = normalizeCampaignRulesPolicyInternal(after, {isValidateCompatibility: true});",
			),
		},
	},
	{
		name: "encumbrance-dependency-disabled",
		probe: probeDependency,
		mutations: {"hub-campaign-rules.js": mutateEncumbranceRequirement},
	},
	{
		name: "reconnect-generation-fence-disabled",
		probe: probeReconnectFence,
		mutations: {
			"hub-rules-policy-manager.js": source => source.replace(
				"if (loadGeneration !== this._policyLoadGeneration || this._isOffline) return false;",
				"if (this._isOffline) return false;",
			),
		},
	},
	{
		name: "busy-input-lock-disabled",
		probe: probeBusyControls,
		mutations: {
			"hub-rules-policy-manager.js": source => source.replace(
				"querySelectorAll(\"input, select, button\")",
				"querySelectorAll(\"button\")",
			),
		},
	},
	{
		name: "terminal-access-lock-disabled",
		probe: probeTerminalAccessLock,
		mutations: {
			"hub-rules-policy-manager.js": source => source.replace(
				"if (TERMINAL_ACCESS_ERROR_CODES.has(error?.code)) this._isReadOnlyAfterAccessChange = true;",
				"if (TERMINAL_ACCESS_ERROR_CODES.has(error?.code)) this._isReadOnlyAfterAccessChange = false;",
			),
		},
	},
	{
		name: "optional-chunk-failure-hidden",
		probe: probeOptionalImport,
		mutations: {
			"hub-capabilities.js": source => replaceLast(
				source,
				"return {status: \"unavailable\", module: null, error};",
				"return {status: \"disabled\", module: null, error};",
			),
		},
	},
];

for (const mutant of MUTANTS) {
	const variant = await loadVariant(mutant);
	try {
		let killed = false;
		try {
			await mutant.probe(variant);
		} catch {
			killed = true;
		}
		if (!killed) throw new Error(`${mutant.name} survived.`);
		// eslint-disable-next-line no-console
		console.log(`${mutant.name}: KILLED`);
	} finally {
		await variant.cleanup();
	}
}

// eslint-disable-next-line no-console
console.log(`${MUTANTS.length}/${MUTANTS.length} campaign rules policy mutants killed.`);
