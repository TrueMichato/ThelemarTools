CREATE INDEX semantic_operation_targets_owner_recovery_idx
	ON hub.semantic_operation_targets (
		campaign_id,
		target_owner_account_id_at_proposal,
		updated_at DESC,
		operation_id,
		target_character_id
	)
	WHERE response_state <> 'pending';

COMMENT ON INDEX hub.semantic_operation_targets_owner_recovery_idx IS
	'Bounded ADR 0020 target-owner recovery for responded live and retained terminal invitation legs.';
