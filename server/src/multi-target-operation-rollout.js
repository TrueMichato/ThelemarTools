const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MAX_CAMPAIGN_IDS = 100;

export class MultiTargetOperationsRolloutError extends Error {
	constructor (code, message, details = {}) {
		super(message);
		this.name = "MultiTargetOperationsRolloutError";
		this.code = code;
		this.details = details;
	}
}

export function parseMultiTargetOperationsCampaignIds (value, {allowWildcard = false} = {}) {
	const campaignIds = String(value || "")
		.split(",")
		.map(it => it.trim().toLowerCase())
		.filter(Boolean);
	if (!campaignIds.length) return [];
	if (campaignIds.includes("*")) {
		if (!allowWildcard) {
			throw new MultiTargetOperationsRolloutError(
				"WILDCARD_NOT_ALLOWED",
				"HUB_MULTI_TARGET_OPERATIONS_CAMPAIGN_IDS must contain exact campaign UUIDs.",
			);
		}
		if (campaignIds.length !== 1) {
			throw new MultiTargetOperationsRolloutError(
				"WILDCARD_MUST_BE_EXCLUSIVE",
				"The isolated-test wildcard cannot be combined with campaign UUIDs.",
			);
		}
		return campaignIds;
	}
	if (campaignIds.length > MAX_CAMPAIGN_IDS) {
		throw new MultiTargetOperationsRolloutError(
			"CAMPAIGN_ID_LIMIT_EXCEEDED",
			`At most ${MAX_CAMPAIGN_IDS} campaign UUIDs may be configured.`,
		);
	}
	for (const campaignId of campaignIds) {
		if (!UUID_PATTERN.test(campaignId)) {
			throw new MultiTargetOperationsRolloutError(
				"INVALID_CAMPAIGN_ID",
				"HUB_MULTI_TARGET_OPERATIONS_CAMPAIGN_IDS contains an invalid campaign UUID.",
			);
		}
	}
	if (new Set(campaignIds).size !== campaignIds.length) {
		throw new MultiTargetOperationsRolloutError(
			"DUPLICATE_CAMPAIGN_ID",
			"HUB_MULTI_TARGET_OPERATIONS_CAMPAIGN_IDS contains a duplicate campaign UUID.",
		);
	}
	return campaignIds;
}

export async function pCheckMultiTargetOperationsCampaignReadiness ({queryable, campaignIds}) {
	if (!queryable?.query) throw new TypeError("A queryable database client is required.");
	if (!Array.isArray(campaignIds) || !campaignIds.length || campaignIds.includes("*")) {
		throw new MultiTargetOperationsRolloutError(
			"EXACT_CAMPAIGN_IDS_REQUIRED",
			"At least one exact campaign UUID is required for multi-target rollout preflight.",
		);
	}
	const migration = await queryable.query(`
		SELECT EXISTS (
			SELECT 1
			FROM hub.schema_migrations
			WHERE version = '0011'
		) AS migration_ready,
		to_regclass('hub.semantic_operation_targets') IS NOT NULL AS targets_ready,
		to_regclass('hub.semantic_operation_finalizations') IS NOT NULL AS finalizations_ready,
		to_regclass('hub.semantic_multi_target_usage') IS NOT NULL AS usage_marker_ready,
		EXISTS (
			SELECT 1
			FROM information_schema.columns
			WHERE table_schema = 'hub'
				AND table_name = 'campaigns'
				AND column_name = 'multi_target_first_operation_id'
		) AS campaign_marker_ready
	`);
	if (!Object.values(migration.rows[0] || {}).every(Boolean)) {
		throw new MultiTargetOperationsRolloutError(
			"SCHEMA_NOT_READY",
			"Migration 0011 multi-target schema is not ready.",
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
		if (!campaign) blockers.push({campaignId, reason: "campaign_not_found"});
		else if (campaign.status !== "active") blockers.push({campaignId, reason: "campaign_not_active"});
		else if (!campaign.active_rules_version_id) {
			blockers.push({campaignId, reason: "active_rules_version_required"});
		}
	}
	if (blockers.length) {
		throw new MultiTargetOperationsRolloutError(
			"CAMPAIGN_ROLLOUT_NOT_READY",
			"One or more configured campaigns are not ready for multi-target rollout.",
			{blockers},
		);
	}
	return {
		configuredCampaignCount: campaignIds.length,
		readyCampaignCount: campaignIds.length,
		migrationVersion: "0011",
	};
}
