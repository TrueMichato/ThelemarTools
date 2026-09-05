import {
	CAMPAIGN_RULES_CATALOG,
	CAMPAIGN_RULES_CATALOG_VERSION,
	CAMPAIGN_RULES_POLICY_SCHEMA_VERSION,
	CampaignRulesPolicyError,
	DEFAULT_CAMPAIGN_SETTINGS,
	adaptLegacyCampaignRules,
	createDefaultCampaignRulesPolicy,
	diffCampaignRulesPolicies,
	getCampaignRulesPolicySummary,
	normalizeCampaignRulesPolicy,
	projectCampaignSettings,
} from "../../../js/hub/hub-campaign-rules.js";

const STABLE_RULE_IDS = [
	"content.sources.allowed",
	"content.species.allowed",
	"content.editions.allowed",
	"tgtt.enabled",
	"rules.exhaustion.system",
	"tgtt.carry-weight",
	"tgtt.encumbrance-tiers",
	"tgtt.jumping",
	"tgtt.linguistics-bonus",
	"tgtt.critical-rolls",
];

function getPolicyWith (ruleId, value) {
	const policy = createDefaultCampaignRulesPolicy();
	const selection = policy.rules.find(rule => rule.id === ruleId);
	const definition = CAMPAIGN_RULES_CATALOG.find(rule => rule.id === ruleId);
	selection.parameters[definition.parameter.key] = value;
	return policy;
}

describe("Campaign rules policy catalog", () => {
	it("defines one closed, versioned catalog with stable IDs and truthful lifecycle labels", () => {
		expect(CAMPAIGN_RULES_CATALOG_VERSION).toBe(1);
		expect(CAMPAIGN_RULES_POLICY_SCHEMA_VERSION).toBe(2);
		expect(CAMPAIGN_RULES_CATALOG.map(rule => rule.id)).toEqual(STABLE_RULE_IDS);
		expect(new Set(CAMPAIGN_RULES_CATALOG.map(rule => rule.id)).size).toBe(STABLE_RULE_IDS.length);
		for (const rule of CAMPAIGN_RULES_CATALOG) {
			expect(rule).toEqual(expect.objectContaining({
				id: expect.any(String),
				ruleSchemaVersion: 1,
				category: expect.stringMatching(/^(content|core|thelemar)$/),
				applicability: expect.objectContaining({editions: expect.any(Array), scope: "campaign"}),
				title: expect.any(String),
				summary: expect.any(String),
				details: expect.any(String),
				lifecycle: expect.stringMatching(/^(implemented_enforced|implemented_advisory|informational_planned|unavailable)$/),
				supportLabel: expect.stringMatching(/^(Enforced|Advisory|Planned)$/),
				parameter: expect.objectContaining({key: expect.any(String), type: expect.any(String)}),
				implementationStatus: expect.any(Object),
				compatibility: expect.any(Object),
			}));
			if (rule.category === "content") expect(JSON.stringify(rule)).not.toMatch(/enforced/i);
		}
		expect(CAMPAIGN_RULES_CATALOG.filter(rule => rule.category === "content"))
			.toEqual(expect.arrayContaining([
				expect.objectContaining({id: "content.sources.allowed", isSelectable: false, supportLabel: "Planned"}),
				expect.objectContaining({id: "content.species.allowed", isSelectable: false, supportLabel: "Planned"}),
				expect.objectContaining({id: "content.editions.allowed", isSelectable: false, supportLabel: "Planned"}),
			]));
	});

	it("adapts schema-v1 settings without semantic drift and projects schema-v2 back for old clients", () => {
		const legacy = {
			enableTgtt: false,
			exhaustionRules: "2024",
			thelemar_carryWeight: true,
			thelemar_encumbranceTiers: false,
			thelemar_jumping: false,
			thelemar_linguisticsBonus: true,
			thelemar_criticalRolls: false,
		};
		const policy = adaptLegacyCampaignRules(legacy);
		expect(policy).toEqual(expect.objectContaining({
			schemaVersion: 2,
			catalogVersion: 1,
			rules: expect.any(Array),
			notes: [],
		}));
		expect(projectCampaignSettings({schemaVersion: 2, rules: policy})).toEqual(legacy);
		expect(projectCampaignSettings({schemaVersion: 1, rules: {exhaustionRules: "2014"}})).toEqual({
			...DEFAULT_CAMPAIGN_SETTINGS,
			exhaustionRules: "2014",
		});
	});

	it("keeps every schema-v1 accepted default combination readable without weakening schema-v2 publication", () => {
		const legacy = {enableTgtt: false};
		const policy = adaptLegacyCampaignRules(legacy);
		expect(policy.rules.find(rule => rule.id === "tgtt.enabled").parameters.enabled).toBe(false);
		expect(policy.rules.find(rule => rule.id === "rules.exhaustion.system").parameters.system).toBe("thelemar");
		expect(projectCampaignSettings({schemaVersion: 1, rules: legacy})).toEqual({
			...DEFAULT_CAMPAIGN_SETTINGS,
			enableTgtt: false,
		});
		expect(getCampaignRulesPolicySummary(policy).rules).toEqual(expect.arrayContaining([
			expect.objectContaining({id: "tgtt.enabled", value: "Off"}),
			expect.objectContaining({id: "rules.exhaustion.system", value: "Thelemar"}),
		]));
		expect(() => normalizeCampaignRulesPolicy(policy)).toThrow(expect.objectContaining({
			code: "RULES_COMBINATION_UNSUPPORTED",
		}));
	});

	it("rejects unknown, unavailable, malformed, duplicate, and falsely-enforced selections", () => {
		const cases = [
			{
				code: "RULES_UNKNOWN",
				mutate: policy => policy.rules[0].id = "unknown.rule",
			},
			{
				code: "RULES_UNAVAILABLE",
				mutate: policy => policy.rules.push({
					id: "content.sources.allowed",
					ruleSchemaVersion: 1,
					mode: "advisory",
					parameters: {sources: ["PHB"]},
				}),
			},
			{
				code: "RULES_PARAMETER_INVALID",
				mutate: policy => policy.rules[0].parameters.enabled = "yes",
			},
			{
				code: "RULES_INVALID",
				mutate: policy => policy.rules.push(structuredClone(policy.rules[0])),
			},
			{
				code: "RULES_MODE_UNSUPPORTED",
				mutate: policy => policy.rules.find(rule => rule.id === "rules.exhaustion.system").mode = "enforced",
			},
		];
		for (const {code, mutate} of cases) {
			const policy = createDefaultCampaignRulesPolicy();
			mutate(policy);
			expect(() => normalizeCampaignRulesPolicy(policy)).toThrow(expect.objectContaining({
				name: "CampaignRulesPolicyError",
				code,
			}));
		}
	});

	it("rejects unsupported dependency combinations atomically", () => {
		const tgttOff = getPolicyWith("tgtt.enabled", false);
		expect(() => normalizeCampaignRulesPolicy(tgttOff)).toThrow(expect.objectContaining({
			code: "RULES_COMBINATION_UNSUPPORTED",
			details: {ruleId: "rules.exhaustion.system", requiresRuleId: "tgtt.enabled"},
		}));
		const validTgttOff = getPolicyWith("tgtt.enabled", false);
		validTgttOff.rules.find(rule => rule.id === "rules.exhaustion.system").parameters.system = "2024";
		expect(normalizeCampaignRulesPolicy(validTgttOff)).toEqual(validTgttOff);

		const carryOff = getPolicyWith("tgtt.carry-weight", false);
		expect(() => normalizeCampaignRulesPolicy(carryOff)).toThrow(expect.objectContaining({
			code: "RULES_COMBINATION_UNSUPPORTED",
			details: {ruleId: "tgtt.encumbrance-tiers", requiresRuleId: "tgtt.carry-weight"},
		}));
		carryOff.rules.find(rule => rule.id === "tgtt.encumbrance-tiers").parameters.enabled = false;
		expect(normalizeCampaignRulesPolicy(carryOff)).toEqual(carryOff);

		const legacyCarryCombination = {
			thelemar_carryWeight: false,
			thelemar_encumbranceTiers: true,
		};
		expect(projectCampaignSettings({schemaVersion: 1, rules: legacyCarryCombination})).toEqual({
			...DEFAULT_CAMPAIGN_SETTINGS,
			...legacyCarryCombination,
		});
		const historicalV2 = createDefaultCampaignRulesPolicy();
		historicalV2.rules.find(rule => rule.id === "tgtt.carry-weight").parameters.enabled = false;
		expect(() => normalizeCampaignRulesPolicy(historicalV2)).toThrow(expect.objectContaining({
			code: "RULES_COMBINATION_UNSUPPORTED",
		}));
		expect(projectCampaignSettings({schemaVersion: 2, rules: historicalV2})).toEqual({
			...DEFAULT_CAMPAIGN_SETTINGS,
			thelemar_carryWeight: false,
		});
	});

	it("produces bounded player summaries and explainable before/after diffs", () => {
		const before = createDefaultCampaignRulesPolicy();
		const after = getPolicyWith("tgtt.jumping", false);
		const summary = getCampaignRulesPolicySummary(after);
		expect(summary.rules).toEqual(expect.arrayContaining([
			{id: "tgtt.jumping", title: "Thelemar jumping", value: "Off", supportLabel: "Advisory"},
		]));
		expect(JSON.stringify(summary)).not.toMatch(/details|explanation|createdBy|account/i);
		expect(diffCampaignRulesPolicies({before, after})).toEqual([{
			ruleId: "tgtt.jumping",
			title: "Thelemar jumping",
			before: "On",
			after: "Off",
		}]);
	});

	it("diffs already-stored legacy targets compatibly without weakening publication validation", () => {
		const active = createDefaultCampaignRulesPolicy();
		const historical = adaptLegacyCampaignRules({enableTgtt: false});
		expect(() => diffCampaignRulesPolicies({before: active, after: historical})).toThrow(expect.objectContaining({
			code: "RULES_COMBINATION_UNSUPPORTED",
		}));
		expect(diffCampaignRulesPolicies({
			before: active,
			after: historical,
			isAfterStoredPolicy: true,
		})).toEqual([{
			ruleId: "tgtt.enabled",
			title: "Thelemar rules",
			before: "On",
			after: "Off",
		}]);
	});

	it("bounds and sanitizes policy notes", () => {
		const policy = createDefaultCampaignRulesPolicy();
		policy.notes = [{id: "campaign.rest", title: "Rest pacing", explanation: "Long rests usually require a safe location."}];
		expect(normalizeCampaignRulesPolicy(policy).notes).toEqual(policy.notes);
		policy.notes[0].explanation = "<script>alert(1)</script>";
		expect(() => normalizeCampaignRulesPolicy(policy)).toThrow(CampaignRulesPolicyError);
	});
});
