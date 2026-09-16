const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MAX_CAMPAIGN_IDS = 100;

export class PeerSourceCostsRolloutError extends Error {
	constructor (code, message, details = {}) {
		super(message);
		this.name = "PeerSourceCostsRolloutError";
		this.code = code;
		this.details = details;
	}
}

export function parsePeerSourceCostsCampaignIds (value, {allowWildcard = false} = {}) {
	const campaignIds = String(value || "")
		.split(",")
		.map(it => it.trim().toLowerCase())
		.filter(Boolean);
	if (!campaignIds.length) return [];
	if (campaignIds.includes("*")) {
		if (!allowWildcard) {
			throw new PeerSourceCostsRolloutError(
				"WILDCARD_NOT_ALLOWED",
				"HUB_PEER_SOURCE_COSTS_CAMPAIGN_IDS must contain exact campaign UUIDs.",
			);
		}
		if (campaignIds.length !== 1) {
			throw new PeerSourceCostsRolloutError(
				"WILDCARD_MUST_BE_EXCLUSIVE",
				"The isolated-test wildcard cannot be combined with campaign UUIDs.",
			);
		}
		return campaignIds;
	}
	if (campaignIds.length > MAX_CAMPAIGN_IDS) {
		throw new PeerSourceCostsRolloutError(
			"CAMPAIGN_ID_LIMIT_EXCEEDED",
			`At most ${MAX_CAMPAIGN_IDS} campaign UUIDs may be configured.`,
		);
	}
	for (const campaignId of campaignIds) {
		if (!UUID_PATTERN.test(campaignId)) {
			throw new PeerSourceCostsRolloutError(
				"INVALID_CAMPAIGN_ID",
				"HUB_PEER_SOURCE_COSTS_CAMPAIGN_IDS contains an invalid campaign UUID.",
			);
		}
	}
	if (new Set(campaignIds).size !== campaignIds.length) {
		throw new PeerSourceCostsRolloutError(
			"DUPLICATE_CAMPAIGN_ID",
			"HUB_PEER_SOURCE_COSTS_CAMPAIGN_IDS contains a duplicate campaign UUID.",
		);
	}
	return campaignIds;
}

export async function pCheckPeerSourceCostsCampaignReadiness ({queryable, campaignIds}) {
	if (!queryable?.query) throw new TypeError("A queryable database client is required.");
	if (!Array.isArray(campaignIds) || !campaignIds.length || campaignIds.includes("*")) {
		throw new PeerSourceCostsRolloutError(
			"EXACT_CAMPAIGN_IDS_REQUIRED",
			"At least one exact campaign UUID is required for rollout preflight.",
		);
	}

	const {rows} = await queryable.query(`
		SELECT id::text, status, active_rules_version_id::text
		FROM hub.campaigns
		WHERE id = ANY($1::uuid[])
	`, [campaignIds]);
	const rowsById = new Map(rows.map(row => [String(row.id).toLowerCase(), row]));
	const blockers = [];
	for (const campaignId of campaignIds) {
		const campaign = rowsById.get(campaignId);
		if (!campaign) {
			blockers.push({campaignId, reason: "campaign_not_found"});
			continue;
		}
		if (campaign.status !== "active") {
			blockers.push({campaignId, reason: "campaign_not_active"});
			continue;
		}
		if (!campaign.active_rules_version_id) {
			blockers.push({campaignId, reason: "active_rules_version_required"});
		}
	}
	if (blockers.length) {
		throw new PeerSourceCostsRolloutError(
			"CAMPAIGN_ROLLOUT_NOT_READY",
			"One or more configured campaigns are not ready for peer source-cost rollout.",
			{blockers},
		);
	}
	return {
		configuredCampaignCount: campaignIds.length,
		readyCampaignCount: campaignIds.length,
	};
}
