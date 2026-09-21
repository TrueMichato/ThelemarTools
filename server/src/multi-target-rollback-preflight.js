const ROLLBACK_TARGETS = new Set(["pre-0011", "bridge"]);

function getCount (value) {
	const count = Number.parseInt(value ?? "0", 10);
	if (!Number.isSafeInteger(count) || count < 0) throw new Error(`Invalid rollback diagnostic count.`);
	return count;
}

export async function pGetMultiTargetRollbackPreflight ({
	queryable,
	target,
	supportedTemplateRegistryVersions = [],
}) {
	if (!ROLLBACK_TARGETS.has(target)) {
		throw new Error(`Rollback target must be "pre-0011" or "bridge".`);
	}
	const supportedVersions = [...new Set(supportedTemplateRegistryVersions
		.map(value => value.trim())
		.filter(Boolean))];
	const result = await queryable.query(`
		WITH parent_stats AS (
			SELECT
				count(*) AS total_parent_count,
				count(*) FILTER (
					WHERE status IN ('collecting_responses', 'awaiting_source_selection')
				) AS live_parent_count,
				min(collection_closes_at) FILTER (
					WHERE status = 'collecting_responses'
				) AS oldest_collection_closes_at,
				min(expires_at) FILTER (
					WHERE status = 'awaiting_source_selection'
				) AS oldest_finalization_deadline,
				min(resolved_at) FILTER (
					WHERE status IN ('applied', 'cancelled', 'expired', 'failed')
				) AS oldest_terminal_at,
				count(*) FILTER (
					WHERE template_registry_version IS NOT NULL
						AND NOT (template_registry_version = ANY($1::text[]))
				) AS unsupported_template_parent_count
			FROM hub.semantic_operations
			WHERE target_set_version = 1
		),
		target_stats AS (
			SELECT
				count(*) AS total_target_count,
				count(*) FILTER (WHERE response_state = 'pending') AS pending_target_count,
				count(*) FILTER (WHERE selection_state IN ('selected', 'applied')) AS selected_target_count,
				count(*) FILTER (WHERE leg_id IS NOT NULL) AS applied_leg_count
			FROM hub.semantic_operation_targets
		),
		finalization_stats AS (
			SELECT count(*) AS total_finalization_count
			FROM hub.semantic_operation_finalizations
		),
		incomplete_stats AS (
			SELECT count(*) AS incomplete_parent_count
			FROM hub.semantic_operations operation
			WHERE operation.target_set_version = 1
				AND (
					operation.candidate_count <> (
						SELECT count(*)
						FROM hub.semantic_operation_targets target
						WHERE target.operation_id = operation.id
					)
					OR (
						operation.status = 'applied'
						AND NOT EXISTS (
							SELECT 1
							FROM hub.semantic_operation_finalizations finalization
							WHERE finalization.operation_id = operation.id
								AND finalization.terminal_status = 'applied'
						)
					)
					OR EXISTS (
						SELECT 1
						FROM hub.semantic_operation_targets target
						WHERE target.operation_id = operation.id
							AND (
								(operation.status = 'applied'
									AND target.selection_state IN ('selected', 'applied')
									AND target.leg_id IS NULL)
								OR (operation.status <> 'applied' AND target.leg_id IS NOT NULL)
							)
					)
				)
		),
		cleanup_stats AS (
			SELECT count(*) AS cleanup_ready_parent_count
			FROM hub.semantic_operations operation
			WHERE operation.target_set_version = 1
				AND operation.status IN ('applied', 'cancelled', 'expired', 'failed')
				AND operation.resolved_at <= now() - interval '90 days'
				AND NOT EXISTS (
					SELECT 1
					FROM hub.domain_events event
					JOIN hub.outbox_entries outbox
						ON outbox.campaign_id = event.campaign_id
						AND outbox.event_id = event.id
					WHERE event.campaign_id = operation.campaign_id
						AND event.aggregate_id = operation.id
						AND outbox.status <> 'published'
				)
		)
		SELECT
			EXISTS (SELECT 1 FROM hub.semantic_multi_target_usage WHERE singleton) AS usage_marker_present,
			(SELECT first_used_at FROM hub.semantic_multi_target_usage WHERE singleton) AS first_used_at,
			parent_stats.*,
			target_stats.*,
			finalization_stats.*,
			incomplete_stats.*,
			cleanup_stats.*
		FROM parent_stats, target_stats, finalization_stats, incomplete_stats, cleanup_stats
	`, [supportedVersions]);
	const row = result.rows[0];
	const diagnostics = {
		usageMarkerPresent: row.usage_marker_present === true,
		firstUsedAt: row.first_used_at ?? null,
		totalParentCount: getCount(row.total_parent_count),
		liveParentCount: getCount(row.live_parent_count),
		totalTargetCount: getCount(row.total_target_count),
		pendingTargetCount: getCount(row.pending_target_count),
		selectedTargetCount: getCount(row.selected_target_count),
		appliedLegCount: getCount(row.applied_leg_count),
		totalFinalizationCount: getCount(row.total_finalization_count),
		incompleteParentCount: getCount(row.incomplete_parent_count),
		unsupportedTemplateParentCount: getCount(row.unsupported_template_parent_count),
		cleanupReadyParentCount: getCount(row.cleanup_ready_parent_count),
		oldestCollectionClosesAt: row.oldest_collection_closes_at ?? null,
		oldestFinalizationDeadline: row.oldest_finalization_deadline ?? null,
		oldestTerminalAt: row.oldest_terminal_at ?? null,
	};
	const blockers = [];
	if (target === "pre-0011") {
		if (diagnostics.usageMarkerPresent) blockers.push("USAGE_MARKER_PRESENT");
		if (
			diagnostics.totalParentCount
			|| diagnostics.totalTargetCount
			|| diagnostics.totalFinalizationCount
		) blockers.push("MULTI_TARGET_HISTORY_PRESENT");
	} else {
		if (diagnostics.incompleteParentCount) blockers.push("INCOMPLETE_MULTI_TARGET_HISTORY");
		if (diagnostics.unsupportedTemplateParentCount) blockers.push("UNSUPPORTED_TEMPLATE_VERSION");
	}
	return {
		target,
		compatible: blockers.length === 0,
		blockers,
		diagnostics,
	};
}
