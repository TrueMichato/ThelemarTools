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

/**
 * Prepare a document crossing a campaign boundary without carrying an authority summary from
 * the source world into the destination. A summary is reusable only when the immutable policy
 * identity is unchanged; otherwise it is removed so the destination projector fails closed until
 * the Character Sheet recalculates it under the destination overlay.
 *
 * This helper is deliberately shared by the memory and PostgreSQL transition paths. It performs
 * no writes and returns a cloned document, allowing callers to reject or commit atomically.
 */
export function prepareCampaignTransitionData ({data, rulesVersion, protocolVersion = CAMPAIGN_RULE_PROTOCOL_VERSION}) {
	const prepared = structuredClone(data);
	if (!prepared?.carry) return prepared;
	const basis = prepared.carry?.basis;
	if (
		rulesVersion
		&& Number(rulesVersion.schemaVersion) >= 2
		&& basis?.kind === "campaign"
		&& basis.rulesVersionId === rulesVersion.id
	) {
		assertCampaignRuleWriteFence({rulesVersion, data: prepared, protocolVersion});
		return prepared;
	}
	// A detached, malformed, absent, or source-campaign basis cannot be trusted in the
	// destination. Dropping only the derived authority block preserves every character input.
	delete prepared.carry;
	return prepared;
}
