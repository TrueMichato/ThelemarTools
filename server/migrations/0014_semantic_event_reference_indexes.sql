CREATE INDEX semantic_operations_created_event_idx
	ON hub.semantic_operations (campaign_id, created_event_id)
	WHERE created_event_id IS NOT NULL;
CREATE INDEX semantic_operations_applied_event_idx
	ON hub.semantic_operations (campaign_id, applied_event_id)
	WHERE applied_event_id IS NOT NULL;
CREATE INDEX semantic_operations_terminal_event_idx
	ON hub.semantic_operations (campaign_id, terminal_event_id)
	WHERE terminal_event_id IS NOT NULL;
CREATE INDEX semantic_operations_source_cost_event_idx
	ON hub.semantic_operations (campaign_id, source_cost_event_id)
	WHERE source_cost_event_id IS NOT NULL;
CREATE INDEX semantic_operations_ready_event_idx
	ON hub.semantic_operations (campaign_id, ready_event_id)
	WHERE ready_event_id IS NOT NULL;
CREATE INDEX semantic_operations_finalized_event_idx
	ON hub.semantic_operations (campaign_id, finalized_event_id)
	WHERE finalized_event_id IS NOT NULL;

CREATE INDEX semantic_operation_targets_invitation_event_idx
	ON hub.semantic_operation_targets (campaign_id, invitation_event_id)
	WHERE invitation_event_id IS NOT NULL;
CREATE INDEX semantic_operation_targets_response_event_idx
	ON hub.semantic_operation_targets (campaign_id, response_event_id)
	WHERE response_event_id IS NOT NULL;
CREATE INDEX semantic_operation_targets_lifecycle_event_idx
	ON hub.semantic_operation_targets (campaign_id, lifecycle_event_id)
	WHERE lifecycle_event_id IS NOT NULL;
CREATE INDEX semantic_operation_targets_leg_event_idx
	ON hub.semantic_operation_targets (campaign_id, leg_event_id)
	WHERE leg_event_id IS NOT NULL;

CREATE INDEX semantic_operation_finalizations_source_event_idx
	ON hub.semantic_operation_finalizations (campaign_id, source_event_id)
	WHERE source_event_id IS NOT NULL;
CREATE INDEX semantic_operation_finalizations_terminal_event_idx
	ON hub.semantic_operation_finalizations (campaign_id, terminal_event_id)
	WHERE terminal_event_id IS NOT NULL;
