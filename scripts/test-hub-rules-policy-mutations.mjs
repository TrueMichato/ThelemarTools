import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {pathToFileURL} from "node:url";

async function loadVariant ({name, mutations = {}}) {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), `hub-rules-mutation-${name}-`));
	const hubDir = path.join(root, "hub");
	await fs.cp(path.resolve("js/hub"), hubDir, {recursive: true});
	await fs.mkdir(path.join(root, "js"), {recursive: true});
	await fs.cp(path.resolve("js/hub"), path.join(root, "js/hub"), {recursive: true});
	await fs.mkdir(path.join(root, "server"), {recursive: true});
	await fs.cp(path.resolve("server/src"), path.join(root, "server/src"), {recursive: true});
	await fs.mkdir(path.join(root, "server", "data"), {recursive: true});
	await fs.copyFile(
		path.resolve("server/data/campaign-content-site-catalog.json"),
		path.join(root, "server", "data", "campaign-content-site-catalog.json"),
	);
	await fs.mkdir(path.join(root, "js", "charactersheet"), {recursive: true});
	await fs.copyFile(
		path.resolve("js/charactersheet/charactersheet.js"),
		path.join(root, "js", "charactersheet", "charactersheet.js"),
	);
	for (const fileName of [
		"parser.js",
		"utils.js",
		"charactersheet/charactersheet-state.js",
		"charactersheet/charactersheet-class-utils.js",
	]) {
		const target = path.join(root, "js", fileName);
		await fs.mkdir(path.dirname(target), {recursive: true});
		await fs.copyFile(path.resolve("js", fileName), target);
	}
	await fs.symlink(path.resolve("node_modules"), path.join(root, "node_modules"), "dir");
	await fs.writeFile(path.join(root, "package.json"), JSON.stringify({type: "module"}));
	for (const [fileName, mutate] of Object.entries(mutations)) {
		const filePath = path.join(root, fileName.startsWith("server/") || fileName.startsWith("js/")
			? fileName
			: `hub/${fileName}`);
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
		authority: await import(`${pathToFileURL(path.join(root, "server/src/campaign-rule-authority.js")).href}?variant=${encodeURIComponent(name)}`),
		pImportServer: fileName => import(`${pathToFileURL(path.join(root, "server/src", fileName)).href}?variant=${encodeURIComponent(name)}`),
		readSource: fileName => fs.readFile(path.join(root, fileName), "utf8"),
		cleanup: () => fs.rm(root, {recursive: true, force: true}),
	};
}

async function probeMemoryStoreFence ({rules, pImportServer}) {
	const {MemoryHubStore} = await pImportServer("memory-hub-store.js");
	const store = new MemoryHubStore();
	const account = await store.pUpsertOAuthAccount({provider: "test", providerSubject: "mutant", displayName: "Mutant"});
	const campaign = (await store.pCreateCampaign({accountId: account.id, name: "Mutant", idempotencyKey: "campaign"})).campaign;
	await store.pCreateAndActivateRulesPolicy({
		accountId: account.id,
		campaignId: campaign.id,
		policy: rules.createDefaultCampaignRulesPolicy(),
		expectedActiveRulesVersionId: null,
		idempotencyKey: "rules",
	});
	await expectRejectionCode(store.pCreateCharacter({
		accountId: account.id,
		campaignId: campaign.id,
		clientImportId: "stale",
		schemaVersion: 1,
		data: {carry: {basis: {kind: "campaign", rulesVersionId: "stale", settingsDigest: "digest"}}},
		protocolVersion: "4",
		idempotencyKey: "character",
	}), "POLICY_VERSION_STALE");
}

async function expectRejectionCode (promise, expectedCode) {
	let rejection = null;
	try {
		await promise;
	} catch (error) {
		rejection = error;
	}
	if (isInfrastructureError(rejection)) throw rejection;
	assert.equal(rejection?.code, expectedCode);
}

function getPolicyFenceFixture (rules) {
	return {
		id: "rules-current",
		version: 1,
		schema_version: 2,
		rules: rules.createDefaultCampaignRulesPolicy(),
	};
}

function getStaleCarryData () {
	return {
		settings: {},
		carry: {basis: {kind: "campaign", rulesVersionId: "rules-stale", settingsDigest: "digest"}},
	};
}

function createPostgresFenceStore ({PostgresHubStore, rules, characterRow = null}) {
	const policyRow = getPolicyFenceFixture(rules);
	const sentinel = Object.assign(new Error("the operation passed its policy fence"), {
		code: "POST_FENCE_SENTINEL",
	});
	const client = {
		query: async query => {
			const sql = typeof query === "string" ? query : query.text;
			if (sql === "BEGIN" || sql === "ROLLBACK") return {rows: [], rowCount: 0};
			if (sql.includes("SELECT r.id, r.version, r.schema_version, r.rules")) {
				return {rows: [policyRow], rowCount: 1};
			}
			if (sql.includes("SELECT campaign_id FROM hub.characters")) {
				return {rows: [{campaign_id: "campaign"}], rowCount: 1};
			}
			if (characterRow && sql.includes("SELECT * FROM hub.characters")) {
				return {rows: [characterRow], rowCount: 1};
			}
			if (characterRow && sql.includes("FROM hub.character_leases")) {
				return {
					rows: [{
						session_id: "session",
						epoch: 1,
						expires_at: new Date(Date.now() + 60_000),
					}],
					rowCount: 1,
				};
			}
			throw sentinel;
		},
		release: () => {},
	};
	const store = new PostgresHubStore({
		pool: {
			query: async () => ({rows: [], rowCount: 0}),
			connect: async () => client,
			on: () => {},
		},
	});
	store._pLockCommand = async () => null;
	store._pGetMembershipForUpdate = async () => {};
	return store;
}

async function probePostgresCreateFence ({rules, pImportServer}) {
	const {PostgresHubStore} = await pImportServer("postgres-hub-store.js");
	const store = createPostgresFenceStore({PostgresHubStore, rules});
	await expectRejectionCode(store.pCreateCharacter({
		accountId: "account",
		campaignId: "campaign",
		clientImportId: "import",
		schemaVersion: 1,
		data: getStaleCarryData(),
		protocolVersion: "4",
		idempotencyKey: "create",
	}), "POLICY_VERSION_STALE");
}

async function probePostgresPatchFence ({rules, pImportServer}) {
	const {PostgresHubStore} = await pImportServer("postgres-hub-store.js");
	const characterRow = {
		id: "character",
		owner_account_id: "account",
		campaign_id: "campaign",
		status: "active",
		schema_version: 1,
		revision: 1,
		lease_epoch: 1,
		data: getStaleCarryData(),
		projection_policy: {},
		projection_revision: 1,
		operation_watermark: 0,
	};
	const store = createPostgresFenceStore({PostgresHubStore, rules, characterRow});
	await expectRejectionCode(store.pPatchCharacter({
		accountId: "account",
		sessionId: "session",
		characterId: "character",
		baseRevision: 1,
		leaseEpoch: 1,
		patches: [{op: "replace", path: "/carry", value: characterRow.data.carry}],
		idempotencyKey: "patch",
		protocolVersion: "4",
	}), "POLICY_VERSION_STALE");
}

async function probeTransitionOwners ({rules, pImportServer}) {
	const {MemoryHubStore} = await pImportServer("memory-hub-store.js");
	const store = new MemoryHubStore();
	const account = await store.pUpsertOAuthAccount({
		provider: "test",
		providerSubject: "transition-mutant",
		displayName: "Transition Mutant",
	});
	const campaign = (await store.pCreateCampaign({
		accountId: account.id,
		name: "Destination",
		idempotencyKey: "destination-campaign",
	})).campaign;
	await store.pCreateAndActivateRulesPolicy({
		accountId: account.id,
		campaignId: campaign.id,
		policy: rules.createDefaultCampaignRulesPolicy(),
		expectedActiveRulesVersionId: null,
		idempotencyKey: "destination-rules",
	});
	const source = (await store.pCreateCharacter({
		accountId: account.id,
		campaignId: null,
		clientImportId: "source",
		schemaVersion: 1,
		data: {name: "Source", settings: {}},
		idempotencyKey: "source-character",
	})).character;
	const staleCarry = getStaleCarryData().carry;
	store._characters.get(source.id).data.carry = staleCarry;
	const cloned = await store.pCloneCharacter({
		accountId: account.id,
		characterId: source.id,
		campaignId: campaign.id,
		idempotencyKey: "clone",
	});
	assert.equal(cloned.character.data.carry, undefined, "clone retained source campaign carry authority");
	assert.deepEqual(store._characters.get(source.id).data.carry, staleCarry, "transition rewrote source character data");
}

async function probeCharacterSheetOwners ({readSource}) {
	const source = await readSource("js/charactersheet/charactersheet.js");
	assert.match(source, /_clearHubRules[\s\S]*this\._hubContext = cleared\.hubContext;/);
	assert.match(source, /catch \(error\) \{[\s\S]*this\._clearHubRules\(\);[\s\S]*_hubRulesRefreshBlocked/);
	assert.match(source, /state\?\.state === "live" && this\._hubRulesRefreshBlocked[\s\S]*_pRefreshHubRules/);
	assert.match(
		source,
		/if \(expectedRulesVersionId && context\?\.rulesVersion\?\.id !== expectedRulesVersionId\) \{\s*this\._clearHubRules\(\);\s*this\._hubRulesRefreshBlocked = true;\s*this\._hubRulesPendingVersionId = expectedRulesVersionId;\s*return false;/,
	);
}

async function probeCarrySettingsDigest ({rules, pImportServer}) {
	const {getExpectedCarryBasis} = await pImportServer("carry-basis.js");
	const rulesVersion = {
		id: "rules-current",
		version: 1,
		schemaVersion: 2,
		catalogVersion: 1,
		rules: rules.createDefaultCampaignRulesPolicy(),
	};
	const basis = getExpectedCarryBasis({
		character: {
			campaignId: "campaign",
			data: {settings: {
				enableMaterials: true,
				materials_weightFromDensity: true,
				materials_degradation: true,
			}},
		},
		rulesVersion,
	});
	assert.match(basis.settingsDigest, /enableMaterials=true/);
	assert.match(basis.settingsDigest, /materials_weightFromDensity=true/);
	assert.match(basis.settingsDigest, /materials_degradation=true/);
}

async function probeExistingImportOrder ({rules, pImportServer}) {
	const {MemoryHubStore} = await pImportServer("memory-hub-store.js");
	const store = new MemoryHubStore();
	const account = await store.pUpsertOAuthAccount({provider: "test", providerSubject: "existing", displayName: "Existing"});
	const campaign = (await store.pCreateCampaign({accountId: account.id, name: "Existing", idempotencyKey: "campaign"})).campaign;
	const first = await store.pCreateAndActivateRulesPolicy({
		accountId: account.id,
		campaignId: campaign.id,
		policy: rules.createDefaultCampaignRulesPolicy(),
		expectedActiveRulesVersionId: null,
		idempotencyKey: "rules-1",
	});
	const staleData = {carry: {schemaVersion: 1, basis: {kind: "campaign", rulesVersionId: first.rulesVersion.id, settingsDigest: "digest"}}};
	const created = await store.pCreateCharacter({
		accountId: account.id,
		campaignId: campaign.id,
		clientImportId: "same",
		schemaVersion: 1,
		data: staleData,
		protocolVersion: "4",
		idempotencyKey: "create",
	});
	const changed = rules.createDefaultCampaignRulesPolicy();
	changed.rules.find(rule => rule.id === "tgtt.carry-weight").parameters.enabled = false;
	changed.rules.find(rule => rule.id === "tgtt.encumbrance-tiers").parameters.enabled = false;
	await store.pCreateAndActivateRulesPolicy({
		accountId: account.id,
		campaignId: campaign.id,
		policy: changed,
		expectedActiveRulesVersionId: first.rulesVersion.id,
		idempotencyKey: "rules-2",
	});
	let replay;
	try {
		replay = await store.pCreateCharacter({
			accountId: account.id,
			campaignId: campaign.id,
			clientImportId: "same",
			schemaVersion: 1,
			data: staleData,
			protocolVersion: "4",
			idempotencyKey: "replay",
		});
	} catch (error) {
		if (isInfrastructureError(error)) throw error;
		assert.fail(`existing import was rejected with ${error?.code || error?.name}`);
	}
	assert.equal(replay.character.id, created.character.id);
}

async function probeExistingImportOwners ({pImportServer}) {
	const {MemoryHubStore} = await pImportServer("memory-hub-store.js");
	const {PostgresHubStore} = await pImportServer("postgres-hub-store.js");
	const memorySource = MemoryHubStore.prototype.pCreateCharacter.toString();
	const postgresSource = PostgresHubStore.prototype.pCreateCharacter.toString();
	const memoryExistingIx = memorySource.indexOf("imported?.status === \"active\"");
	const memoryFenceIx = memorySource.indexOf("assertCampaignRuleWriteFence");
	const postgresExistingIx = postgresSource.indexOf("existing.rows[0]?.status === \"active\"");
	const postgresFenceIx = postgresSource.indexOf("assertCampaignRuleWriteFence");
	assert.ok(memoryExistingIx >= 0 && memoryExistingIx < memoryFenceIx);
	assert.ok(postgresExistingIx >= 0 && postgresExistingIx < postgresFenceIx);
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
		personalSettings: {enableTgtt: true},
		protocolVersion: evaluator.CAMPAIGN_RULE_PROTOCOL_VERSION,
		rulesVersion,
		surface: "characterWrite",
	};
	assert.equal(evaluator.evaluateCampaignRules({...base, capabilities: []}).blocking, true);
	assert.equal(evaluator.evaluateCampaignRules({...base, expectedRulesVersionId: "rules-old"}).blocking, true);
	assert.equal(evaluator.evaluateCampaignRules({...base, rulesVersion: {...rulesVersion, version: "1"}}).blocking, true);
	assert.equal(evaluator.evaluateCampaignRules({...base, rulesVersion: {...rulesVersion, unexpected: true}}).blocking, true);
	assert.equal(evaluator.getCampaignSettingsOverlayFromRulesVersion({
		id: "flat-v2",
		version: 1,
		schemaVersion: 2,
		catalogVersion: 1,
		rules: {enableTgtt: false},
	}), null);
	assert.equal(evaluator.getCampaignSettingsOverlayFromRulesVersion({
		id: "legacy",
		rules: {enableTgtt: false},
	}).enableTgtt, false);
	const masterOff = structuredClone(rulesVersion);
	masterOff.rules.rules.find(rule => rule.id === "tgtt.enabled").parameters.enabled = false;
	masterOff.rules.rules.find(rule => rule.id === "rules.exhaustion.system").parameters.system = "2024";
	const masterDecision = evaluator.evaluateCampaignRules({...base, rulesVersion: masterOff});
	assert.equal(masterDecision.effectiveSettings.thelemar_carryWeight, false);
	assert.equal(masterDecision.effectiveSettings.thelemar_jumping, false);
	assert.equal(evaluator.getCampaignSettingsOverlay({
		status: "blocked",
		blocking: true,
		effectiveSettings: {enableTgtt: true},
	}), null);
	const validDecision = evaluator.evaluateCampaignRules(base);
	assert.equal(evaluator.getCampaignSettingsOverlay({
		...validDecision,
		effectiveSettings: {enableTgtt: "yes"},
	}), null);
	assert.equal(evaluator.getCampaignSettingsOverlay({
		...validDecision,
		appliedRules: [{id: "unknown.rule", ruleSchemaVersion: -1, mode: "advisory"}],
	}), null);
	assert.equal(evaluator.getCampaignSettingsOverlay({
		status: "compliant",
		blocking: false,
		policyIdentity: {id: "rules-current", version: 1, schemaVersion: 2, catalogVersion: 1},
		effectiveSettings: {enableTgtt: true},
	}), null);
	assert.deepEqual(evaluator.getClearedCampaignRulesState(), {
		hubContext: null,
		overlay: null,
		carryAuthorityContext: null,
	});
}

async function probeServerFence ({rules, authority}) {
	const rulesVersion = {
		id: "rules-current",
		version: 1,
		schemaVersion: 2,
		catalogVersion: 1,
		rules: rules.createDefaultCampaignRulesPolicy(),
	};
	const data = {
		settings: {},
		carry: {basis: {kind: "campaign", rulesVersionId: "rules-current"}},
	};
	assert.doesNotThrow(() => authority.assertCampaignRuleWriteFence({rulesVersion, data, protocolVersion: "4"}));
	assert.throws(
		() => authority.assertCampaignRuleWriteFence({rulesVersion,
			data: {
				...data,
				carry: {basis: {kind: "detached"}},
			},
			protocolVersion: "4"}),
		/active rules-version identity/,
	);
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
	let diff;
	assert.doesNotThrow(() => {
		diff = rules.diffCampaignRulesPolicies({
			before: active,
			after: historical,
			isAfterStoredPolicy: true,
		});
	});
	assert.deepEqual(diff, [{
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
		name: "carry-material-settings-digest-disabled",
		probe: probeCarrySettingsDigest,
		mutations: {
			"server/src/carry-basis.js": source => source.replace(
				"const effectiveSettings = {...ownSettings, ...decision.effectiveSettings};",
				"const effectiveSettings = decision.effectiveSettings;",
			),
		},
	},
	{
		name: "schema-v2-fallback-enabled",
		probe: probeEvaluatorFailClosed,
		mutations: {
			"hub-campaign-rule-evaluator.js": source => source.replace(
				"if (rulesVersion.schemaVersion !== 1) return null;",
				"rulesVersion = {...rulesVersion, schemaVersion: 1};",
			),
		},
	},
	{
		name: "character-sheet-version-lag-clear-disabled",
		probe: probeCharacterSheetOwners,
		mutations: {
			"js/charactersheet/charactersheet.js": source => source.replace(
				"this._hubRulesRefreshBlocked = true;\n\t\t\tthis._hubRulesPendingVersionId = expectedRulesVersionId;\n\t\t\tthis._isHubContextRevalidationRequired = true;",
				"this._hubRulesRefreshBlocked = true;\n\t\t\tthis._hubRulesPendingVersionId = null;\n\t\t\tthis._isHubContextRevalidationRequired = true;",
			),
		},
	},
	{
		name: "existing-import-order-disabled",
		probe: probeExistingImportOrder,
		mutations: {
			"server/src/memory-hub-store.js": source => source.replace(
				"if (imported?.status === \"active\") {",
				"if (false) {",
			),
		},
	},
	{
		name: "postgres-existing-import-order-disabled",
		probe: probeExistingImportOwners,
		mutations: {
			"server/src/postgres-hub-store.js": source => source.replace(
				"if (existing.rows[0]?.status === \"active\") {",
				"if (false) {",
			),
		},
	},
	{
		name: "decision-output-validation-disabled",
		probe: probeEvaluatorFailClosed,
		mutations: {
			"hub-campaign-rule-evaluator.js": source => source.replace(
				"if (!isClosedRuleDecision(decision) || decision.status !== \"compliant\" || decision.blocking) return null;",
				"if (!decision || decision.status !== \"compliant\" || decision.blocking) return null;",
			),
		},
	},
	{
		name: "evaluator-envelope-open",
		probe: probeEvaluatorFailClosed,
		mutations: {
			"hub-campaign-rule-evaluator.js": source => source.replace(
				"unknownRulesVersionKeys.length\n\t\t|| typeof rulesVersion.id",
				"false\n\t\t|| typeof rulesVersion.id",
			),
		},
	},
	{
		name: "evaluator-version-check-disabled",
		probe: probeEvaluatorFailClosed,
		mutations: {
			"hub-campaign-rule-evaluator.js": source => source.replaceAll(
				"|| !Number.isSafeInteger(rulesVersion.version)\n\t\t|| rulesVersion.version < 1",
				"|| false\n\t\t|| rulesVersion.version < 1",
			),
		},
	},
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
				"if (!isClosedRuleDecision(decision) || decision.status !== \"compliant\" || decision.blocking) return null;",
				"if (!decision) return null;",
			),
		},
	},
	{
		name: "evaluator-settings-domain-disabled",
		probe: probeEvaluatorFailClosed,
		mutations: {
			"hub-campaign-rule-evaluator.js": source => source.replace(
				"if (Object.entries(decision.effectiveSettings).some(([key, value]) => (",
				"if (false && Object.entries(decision.effectiveSettings).some(([key, value]) => (",
			),
		},
	},
	{
		name: "evaluator-applied-rule-catalog-disabled",
		probe: probeEvaluatorFailClosed,
		mutations: {
			"hub-campaign-rule-evaluator.js": source => source.replace(
				"\t\treturn isInvalid;\n\t})) return false;",
				"\t\treturn false;\n\t})) return false;",
			),
		},
	},
	{
		name: "evaluator-master-toggle-disabled",
		probe: probeEvaluatorFailClosed,
		mutations: {
			"hub-campaign-rule-evaluator.js": source => source.replace(
				"if (effectiveSettings.enableTgtt === false) {",
				"if (false) {",
			),
		},
	},
	{
		name: "character-rules-teardown-disabled",
		probe: probeEvaluatorFailClosed,
		mutations: {
			"hub-campaign-rule-evaluator.js": source => source.replace(
				"hubContext: null,",
				"hubContext: {},",
			),
		},
	},
	{
		name: "server-policy-fence-disabled",
		probe: probeServerFence,
		mutations: {
			"server/src/campaign-rule-authority.js": source => source.replace(
				"if (data.carry?.basis?.kind !== \"campaign\" || typeof data.carry.basis.rulesVersionId !== \"string\" || !data.carry.basis.rulesVersionId) {",
				"if (false) {",
			),
		},
	},
	{
		name: "memory-store-policy-fence-disabled",
		probe: probeMemoryStoreFence,
		mutations: {
			"server/src/memory-hub-store.js": source => source.replace(
				"if (data?.carry) assertCampaignRuleWriteFence({rulesVersion, data, protocolVersion});",
				"if (false) assertCampaignRuleWriteFence({rulesVersion, data, protocolVersion});",
			),
		},
	},
	{
		name: "postgres-create-policy-fence-disabled",
		probe: probePostgresCreateFence,
		mutations: {
			"server/src/postgres-hub-store.js": source => source.replace(
				"assertCampaignRuleWriteFence({",
				"void ({",
			),
		},
	},
	{
		name: "postgres-patch-policy-fence-disabled",
		probe: probePostgresPatchFence,
		mutations: {
			"server/src/postgres-hub-store.js": source => replaceLast(
				source,
				"assertCampaignRuleWriteFence({",
				"void ({",
			),
		},
	},
	{
		name: "character-sheet-teardown-owner-disabled",
		probe: probeCharacterSheetOwners,
		mutations: {
			"js/charactersheet/charactersheet.js": source => source.replace(
				"this._hubContext = cleared.hubContext;",
				"this._hubContext = this._hubContext;",
			),
		},
	},
	{
		name: "character-sheet-reconnect-owner-disabled",
		probe: probeCharacterSheetOwners,
		mutations: {
			"js/charactersheet/charactersheet.js": source => source.replace(
				"} else if (state?.state === \"live\" && this._hubRulesRefreshBlocked) {",
				"} else if (false) {",
			),
		},
	},
	{
		name: "destination-transition-owner-disabled",
		probe: probeTransitionOwners,
		mutations: {
			"server/src/memory-hub-store.js": source => source.replace(
				"const destinationData = prepareCampaignTransitionData({",
				"const destinationData = source.data; /* transition disabled */\n\t\t/*",
			).replace(
				"			brewBundleHash: destinationBrewBundle?.contentHash ?? null,\n\t\t});",
				"			brewBundleHash: destinationBrewBundle?.contentHash ?? null,\n\t\t}); */",
			),
		},
	},
	{
		name: "historical-diff-strict",
		probe: probeHistoricalDiff,
		mutations: {
			"hub-campaign-rules.js": source => source.replace(
				"isValidateCompatibility: !isAfterStoredPolicy,",
				"isValidateCompatibility: true,",
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

function isInfrastructureError (error) {
	const original = error?.actual instanceof Error ? error.actual : error;
	return original?.code === "ERR_MODULE_NOT_FOUND"
		|| ["SyntaxError", "ReferenceError"].includes(original?.name);
}

function isProbeAssertionFailure (error) {
	return !isInfrastructureError(error)
		&& (error?.name === "AssertionError" || error?.code === "ERR_ASSERTION");
}

let wrappedInfrastructureError;
try {
	await assert.rejects(Promise.reject(new ReferenceError("synthetic infrastructure failure")), () => false);
} catch (error) {
	wrappedInfrastructureError = error;
}
assert.equal(isProbeAssertionFailure(wrappedInfrastructureError), false);

for (const mutant of MUTANTS) {
	let variant;
	try {
		variant = await loadVariant(mutant);
	} catch (error) {
		throw new Error(`${mutant.name} fixture/import failed.`, {cause: error});
	}
	try {
		let killed = false;
		try {
			await mutant.probe(variant);
		} catch (error) {
			if (!isProbeAssertionFailure(error)) {
				throw new Error(`${mutant.name} probe failed before its assertion.`, {cause: error});
			}
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

async function runAuthorityMutant ({name, mutate, probe}) {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), `hub-rule-authority-mutation-${name}-`));
	try {
		await fs.mkdir(path.join(root, "js"), {recursive: true});
		await fs.mkdir(path.join(root, "server", "src"), {recursive: true});
		await fs.cp(path.resolve("js/hub"), path.join(root, "js", "hub"), {recursive: true});
		await fs.copyFile("server/src/hub-store-error.js", path.join(root, "server", "src", "hub-store-error.js"));
		const source = await fs.readFile("server/src/campaign-rule-authority.js", "utf8");
		const mutated = mutate(source);
		if (mutated === source) throw new Error(`${name} authority mutation did not match.`);
		await fs.writeFile(path.join(root, "server", "src", "campaign-rule-authority.js"), mutated);
		await fs.writeFile(path.join(root, "package.json"), JSON.stringify({type: "module"}));
		const authority = await import(`${pathToFileURL(path.join(root, "server", "src", "campaign-rule-authority.js")).href}?variant=${name}`);
		const rules = await import(`${pathToFileURL(path.join(root, "js", "hub", "hub-campaign-rules.js")).href}?variant=${name}`);
		let killed = false;
		try {
			await probe({authority, rules});
		} catch (error) {
			if (!isProbeAssertionFailure(error)) {
				throw new Error(`${name} authority probe failed before its assertion.`, {cause: error});
			}
			killed = true;
		}
		if (!killed) throw new Error(`${name} survived.`);
		// eslint-disable-next-line no-console
		console.log(`${name}: KILLED`);
	} finally {
		await fs.rm(root, {recursive: true, force: true});
	}
}

const getAuthorityFixture = rules => ({
	id: "rules-current",
	version: 1,
	schemaVersion: 2,
	catalogVersion: 1,
	rules: rules.createDefaultCampaignRulesPolicy(),
});
const authorityBasisProbe = ({authority, rules}) => {
	assert.throws(() => authority.assertCampaignRuleWriteFence({
		rulesVersion: getAuthorityFixture(rules),
		protocolVersion: "4",
		data: {carry: {basis: {kind: "detached", settingsDigest: "digest"}}},
	}));
};
const authorityProtocolProbe = ({authority, rules}) => {
	const rulesVersion = {
		...getAuthorityFixture(rules),
	};
	assert.throws(() => authority.assertCampaignRuleWriteFence({
		rulesVersion,
		protocolVersion: "3",
		data: {carry: {basis: {kind: "campaign", rulesVersionId: "rules-current", settingsDigest: "digest"}}},
	}));
};

await runAuthorityMutant({
	name: "server-basis-fence-disabled",
	probe: authorityBasisProbe,
	mutate: source => source.replace(
		"if (data.carry?.basis?.kind !== \"campaign\" || typeof data.carry.basis.rulesVersionId !== \"string\" || !data.carry.basis.rulesVersionId) {",
		"if (false) {",
	),
});
await runAuthorityMutant({
	name: "server-protocol-fence-disabled",
	probe: authorityProtocolProbe,
	mutate: source => replaceLast(source, "\n\t\tprotocolVersion,", "\n\t\tprotocolVersion: CAMPAIGN_RULE_PROTOCOL_VERSION,"),
});
