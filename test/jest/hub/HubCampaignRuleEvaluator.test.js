import {
	CAMPAIGN_RULE_PROTOCOL_VERSION,
	evaluateCampaignRules,
	getCampaignSettingsOverlayFromRulesVersion,
} from "../../../js/hub/hub-campaign-rule-evaluator.js";
import {
	CAMPAIGN_RULES_POLICY_CAPABILITY,
	createDefaultCampaignRulesPolicy,
} from "../../../js/hub/hub-campaign-rules.js";

function rulesVersion (mutate = () => {}) {
	const rules = createDefaultCampaignRulesPolicy();
	mutate(rules);
	return {id: "rules-1", version: 1, schemaVersion: 2, catalogVersion: 1, rules};
}

function evaluate (version, overrides = {}) {
	return evaluateCampaignRules({
		capabilities: [CAMPAIGN_RULES_POLICY_CAPABILITY],
		personalSettings: {enableTgtt: false, localOnly: true},
		protocolVersion: CAMPAIGN_RULE_PROTOCOL_VERSION,
		rulesVersion: version,
		surface: "characterOpen",
		...overrides,
	});
}

describe("campaign rule evaluator", () => {
	it("applies supported enforced rules over personal defaults without mutating them", () => {
		const personalSettings = {enableTgtt: true, thelemar_jumping: true};
		const version = rulesVersion(policy => {
			policy.rules.find(rule => rule.id === "tgtt.enabled").parameters.enabled = false;
			policy.rules.find(rule => rule.id === "rules.exhaustion.system").parameters.system = "2024";
			policy.rules.find(rule => rule.id === "tgtt.jumping").parameters.enabled = false;
		});

		const decision = evaluate(version, {personalSettings});
		expect(decision).toMatchObject({
			status: "compliant",
			blocking: false,
			effectiveSettings: {enableTgtt: false, exhaustionRules: "2024", thelemar_jumping: false},
		});

		expect(personalSettings).toEqual({enableTgtt: true, thelemar_jumping: true});
	});

	it("makes TGTT subrules inert when the campaign master toggle is off", () => {
		const version = rulesVersion(policy => {
			policy.rules.find(rule => rule.id === "tgtt.enabled").parameters.enabled = false;
			policy.rules.find(rule => rule.id === "rules.exhaustion.system").parameters.system = "2024";
		});
		expect(evaluate(version).effectiveSettings).toMatchObject({
			enableTgtt: false,
			thelemar_carryWeight: false,
			thelemar_encumbranceTiers: false,
			thelemar_jumping: false,
			thelemar_linguisticsBonus: false,
			thelemar_criticalRolls: false,
		});
	});

	it("leaves explicit local mode unchanged", () => {
		expect(evaluate(null)).toMatchObject({
			status: "inactive",
			blocking: false,
			effectiveSettings: {enableTgtt: false, localOnly: true},
		});
	});

	it.each([
		["a stale policy pin", rulesVersion(), {expectedRulesVersionId: "rules-older"}, "POLICY_VERSION_STALE"],
		["a missing capability", rulesVersion(), {capabilities: []}, "RULES_CAPABILITY_REQUIRED"],
		["an old protocol", rulesVersion(), {protocolVersion: 3}, "RULES_PROTOCOL_UNSUPPORTED"],
		["a future schema", {...rulesVersion(), schemaVersion: 99}, {}, "RULES_SCHEMA_UNSUPPORTED"],
		["a future catalog", {...rulesVersion(), catalogVersion: 99}, {}, "RULES_CATALOG_UNSUPPORTED"],
		["a malformed version", {...rulesVersion(), version: "1"}, {}, "RULES_VERSION_INVALID"],
		["an open envelope", {...rulesVersion(), unexpected: true}, {}, "RULES_VERSION_INVALID"],
		["a malformed nested decision", {...rulesVersion(), ruleDecision: {unexpected: true}}, {}, "RULES_VERSION_INVALID"],
		["an invalid protocol type", rulesVersion(), {protocolVersion: {}}, "RULE_EVALUATOR_INPUT_INVALID"],
	])("fails closed for %s", (_label, version, overrides, code) => {
		expect(evaluate(version, overrides)).toMatchObject({
			status: "blocked",
			blocking: true,
			errors: [{code}],
			effectiveSettings: {enableTgtt: false, localOnly: true},
		});
	});

	it("preserves schema-v1 and pre-decision browser contexts", () => {
		const legacy = {
			id: "legacy",
			version: 2,
			schemaVersion: 1,
			rules: {enableTgtt: false, exhaustionRules: "2014"},
		};
		expect(evaluate(legacy).effectiveSettings).toMatchObject({enableTgtt: false, exhaustionRules: "2014"});
		expect(getCampaignSettingsOverlayFromRulesVersion(legacy)).toMatchObject({enableTgtt: false, exhaustionRules: "2014"});
	});

	it("evaluates the closed policy member of a public schema-v2 envelope", () => {
		const policy = createDefaultCampaignRulesPolicy();
		const version = {
			id: "public-v2",
			version: 3,
			schemaVersion: 2,
			catalogVersion: 1,
			rules: {enableTgtt: false},
			policy,
		};
		expect(evaluate(version).status).toBe("compliant");
		expect(evaluate(version).effectiveSettings.enableTgtt).toBe(true);
	});

	it("rejects a stale or mismatched public decision instead of applying its overlay", () => {
		const version = rulesVersion();
		version.ruleDecision = {
			...evaluate(version),
			policyIdentity: {...evaluate(version).policyIdentity, id: "other"},
		};
		expect(getCampaignSettingsOverlayFromRulesVersion(version)).toBeNull();
	});

	it("rejects contradictory Thelemar dependencies instead of partially applying", () => {
		const version = rulesVersion(policy => {
			policy.rules.find(rule => rule.id === "tgtt.carry-weight").parameters.enabled = false;
		});
		expect(evaluate(version)).toMatchObject({
			status: "blocked",
			errors: [{code: "RULES_COMBINATION_UNSUPPORTED"}],
		});
	});
});
