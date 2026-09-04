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
