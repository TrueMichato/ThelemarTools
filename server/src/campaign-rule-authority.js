import {
	CAMPAIGN_RULE_PROTOCOL_VERSION,
	evaluateCampaignRules,
} from "../../js/hub/hub-campaign-rule-evaluator.js";
import {CAMPAIGN_RULES_POLICY_CAPABILITY} from "../../js/hub/hub-campaign-rules.js";
import {HubStoreError} from "./hub-store-error.js";

export function getAuthoritativeCampaignRuleDecision ({
	rulesVersion,
	personalSettings = {},
	surface = "characterWrite",
	expectedRulesVersionId = null,
	protocolVersion = null,
}) {
	const decision = evaluateCampaignRules({
		capabilities: [CAMPAIGN_RULES_POLICY_CAPABILITY],
		expectedRulesVersionId,
		personalSettings,
		protocolVersion,
		rulesVersion,
		surface,
	});
	if (!decision.blocking) return decision;
	const code = decision.errors[0]?.code || "RULES_UNAVAILABLE";
	throw new HubStoreError(code, code === "POLICY_VERSION_STALE"
		? "Campaign rules changed before this character write committed."
		: "Campaign rules are not compatible with this operation.", {
		status: code === "POLICY_VERSION_STALE" ? 409 : 422,
		details: {policyIdentity: decision.policyIdentity, errors: decision.errors},
	});
}

export function assertCampaignRuleWriteFence ({rulesVersion, data, protocolVersion}) {
	if (!rulesVersion || Number(rulesVersion.schemaVersion) < 2 || !data?.carry) return null;
	if (data.carry?.basis?.kind !== "campaign" || typeof data.carry.basis.rulesVersionId !== "string" || !data.carry.basis.rulesVersionId) {
		throw new HubStoreError("POLICY_VERSION_STALE", "Campaign character write is missing its active rules-version identity.", {status: 409});
	}
	const expectedRulesVersionId = data.carry.basis.rulesVersionId;
	return getAuthoritativeCampaignRuleDecision({
		rulesVersion,
		personalSettings: data?.settings,
		expectedRulesVersionId,
		protocolVersion,
	});
}
