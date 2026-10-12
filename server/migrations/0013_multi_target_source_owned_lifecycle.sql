CREATE OR REPLACE FUNCTION hub.validate_multi_target_semantic_operation(
	p_operation_id uuid
) RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
	v_parent hub.semantic_operations%ROWTYPE;
	v_finalization hub.semantic_operation_finalizations%ROWTYPE;
	v_candidate_count integer;
	v_min_ordinal integer;
	v_max_ordinal integer;
	v_distinct_ordinal_count integer;
	v_selected_count integer;
	v_selected_min_index integer;
	v_selected_max_index integer;
	v_selected_distinct_index_count integer;
	v_leg_count integer;
	v_combined_count integer;
	v_invalid_count integer;
	v_selected_invitation_ids jsonb;
	v_has_finalization boolean;
BEGIN
	SELECT *
	INTO v_parent
	FROM hub.semantic_operations
	WHERE id = p_operation_id;

	IF NOT FOUND THEN RETURN; END IF;

	IF v_parent.target_set_version IS NULL THEN
		IF EXISTS (
			SELECT 1
			FROM hub.semantic_operation_targets
			WHERE operation_id = p_operation_id
		) OR EXISTS (
			SELECT 1
			FROM hub.semantic_operation_finalizations
			WHERE operation_id = p_operation_id
		) THEN
			RAISE EXCEPTION 'legacy semantic operation % cannot own multi-target rows', p_operation_id
				USING ERRCODE = '23514';
		END IF;
		RETURN;
	END IF;

	SELECT
		count(*)::integer,
		min(ordinal)::integer,
		max(ordinal)::integer,
		count(DISTINCT ordinal)::integer
	INTO
		v_candidate_count,
		v_min_ordinal,
		v_max_ordinal,
		v_distinct_ordinal_count
	FROM hub.semantic_operation_targets
	WHERE operation_id = p_operation_id;

	IF v_candidate_count <> v_parent.candidate_count
		OR v_min_ordinal <> 1
		OR v_max_ordinal <> v_candidate_count
		OR v_distinct_ordinal_count <> v_candidate_count
	THEN
		RAISE EXCEPTION 'multi-target semantic operation % has an invalid candidate set', p_operation_id
			USING ERRCODE = '23514';
	END IF;

	SELECT count(*)::integer
	INTO v_invalid_count
	FROM hub.semantic_operation_targets
	WHERE operation_id = p_operation_id
		AND (
			campaign_id <> v_parent.campaign_id
			OR collection_closes_at <> v_parent.collection_closes_at
			OR (target_character_id = v_parent.source_character_id AND leg_id IS NOT NULL AND leg_kind <> 'combined')
			OR (target_character_id <> v_parent.source_character_id AND leg_id IS NOT NULL AND leg_kind <> 'target')
		);
	IF v_invalid_count <> 0 THEN
		RAISE EXCEPTION 'multi-target semantic operation % has inconsistent target rows', p_operation_id
			USING ERRCODE = '23514';
	END IF;

	SELECT count(*)::integer
	INTO v_invalid_count
	FROM hub.semantic_operation_targets
	WHERE operation_id = p_operation_id
		AND (
			(
				target_owner_account_id_at_proposal = v_parent.origin_actor_account_id
				AND response_state NOT IN ('approved_by_source', 'rejected', 'expired', 'revoked', 'declined')
			)
			OR (
				target_owner_account_id_at_proposal <> v_parent.origin_actor_account_id
				AND response_state = 'approved_by_source'
			)
		);
	IF v_invalid_count <> 0 THEN
		RAISE EXCEPTION 'multi-target semantic operation % has invalid source-owned consent', p_operation_id
			USING ERRCODE = '23514';
	END IF;

	SELECT *
	INTO v_finalization
	FROM hub.semantic_operation_finalizations
	WHERE operation_id = p_operation_id;
	v_has_finalization := FOUND;

	SELECT
		count(*) FILTER (WHERE selection_state IN ('selected', 'applied'))::integer,
		min(selection_index) FILTER (WHERE selection_state IN ('selected', 'applied'))::integer,
		max(selection_index) FILTER (WHERE selection_state IN ('selected', 'applied'))::integer,
		count(DISTINCT selection_index)
			FILTER (WHERE selection_state IN ('selected', 'applied'))::integer,
		count(*) FILTER (WHERE leg_id IS NOT NULL)::integer,
		count(*) FILTER (WHERE leg_kind = 'combined')::integer,
		count(*) FILTER (
			WHERE selection_state IN ('selected', 'applied')
				AND response_state NOT IN ('approved', 'approved_by_source')
		)::integer,
		COALESCE(
			jsonb_agg(to_jsonb(invitation_id::text) ORDER BY selection_index)
				FILTER (WHERE selection_state IN ('selected', 'applied')),
			'[]'::jsonb
		)
	INTO
		v_selected_count,
		v_selected_min_index,
		v_selected_max_index,
		v_selected_distinct_index_count,
		v_leg_count,
		v_combined_count,
		v_invalid_count,
		v_selected_invitation_ids
	FROM hub.semantic_operation_targets
	WHERE operation_id = p_operation_id;

	IF v_invalid_count <> 0 THEN
		RAISE EXCEPTION 'multi-target semantic operation % selects a non-approved target', p_operation_id
			USING ERRCODE = '23514';
	END IF;

	IF v_selected_count > 0 AND (
		v_selected_min_index <> 1
		OR v_selected_max_index <> v_selected_count
		OR v_selected_distinct_index_count <> v_selected_count
	) THEN
		RAISE EXCEPTION 'multi-target semantic operation % has non-contiguous selection indexes', p_operation_id
			USING ERRCODE = '23514';
	END IF;

	IF v_has_finalization
		AND v_finalization.terminal_status <> 'failed'
		AND v_finalization.selected_invitation_ids <> v_selected_invitation_ids
	THEN
		RAISE EXCEPTION 'multi-target semantic operation % finalization selection does not match target rows', p_operation_id
			USING ERRCODE = '23514';
	END IF;

	IF v_parent.status = 'applied' THEN
		IF NOT v_has_finalization
			OR v_finalization.terminal_status <> 'applied'
			OR v_selected_count = 0
			OR v_leg_count <> v_selected_count
		THEN
			RAISE EXCEPTION 'applied multi-target semantic operation % has incomplete finalization legs', p_operation_id
				USING ERRCODE = '23514';
		END IF;

		IF EXISTS (
			SELECT 1
			FROM hub.semantic_operation_targets
			WHERE operation_id = p_operation_id
				AND selection_state NOT IN ('selected', 'applied')
				AND leg_id IS NOT NULL
		) THEN
			RAISE EXCEPTION 'applied multi-target semantic operation % has an unselected mutation leg', p_operation_id
				USING ERRCODE = '23514';
		END IF;

		IF EXISTS (
			SELECT 1
			FROM hub.semantic_operation_targets
			WHERE operation_id = p_operation_id
				AND target_character_id = v_parent.source_character_id
				AND selection_state IN ('selected', 'applied')
		) THEN
			IF v_combined_count <> 1 THEN
				RAISE EXCEPTION 'multi-target semantic operation % has an invalid combined source leg', p_operation_id
					USING ERRCODE = '23514';
			END IF;
		ELSIF v_combined_count <> 0 OR v_parent.source_cost_event_id IS NULL THEN
			RAISE EXCEPTION 'multi-target semantic operation % has an invalid source-only leg', p_operation_id
				USING ERRCODE = '23514';
		END IF;
	ELSE
		IF v_leg_count <> 0 OR EXISTS (
			SELECT 1
			FROM hub.semantic_operation_targets
			WHERE operation_id = p_operation_id
				AND resulting_character_revision IS NOT NULL
		) THEN
			RAISE EXCEPTION 'non-applied multi-target semantic operation % has mutation legs', p_operation_id
				USING ERRCODE = '23514';
		END IF;

		IF v_parent.status IN ('collecting_responses', 'awaiting_source_selection')
			AND v_has_finalization
		THEN
			RAISE EXCEPTION 'live multi-target semantic operation % cannot have a finalization row', p_operation_id
				USING ERRCODE = '23514';
		END IF;
	END IF;

	IF v_has_finalization THEN
		IF v_finalization.campaign_id <> v_parent.campaign_id
			OR v_finalization.terminal_status <> v_parent.status
		THEN
			RAISE EXCEPTION 'multi-target semantic operation % has an inconsistent finalization row', p_operation_id
				USING ERRCODE = '23514';
		END IF;

		SELECT count(*)::integer
		INTO v_invalid_count
		FROM jsonb_array_elements_text(v_finalization.selected_invitation_ids) invitation(value);
		IF v_finalization.terminal_status <> 'failed' AND v_invalid_count <> v_selected_count THEN
			RAISE EXCEPTION 'multi-target semantic operation % has an invalid finalization selection count', p_operation_id
				USING ERRCODE = '23514';
		END IF;
	END IF;

	IF EXISTS (
		SELECT 1
		FROM hub.semantic_operation_commands command
		WHERE command.operation_id = p_operation_id
			AND command.command_type = 'respond_multi_target'
			AND NOT EXISTS (
				SELECT 1
				FROM hub.semantic_operation_targets target
				WHERE target.operation_id = command.operation_id
					AND target.invitation_id = command.invitation_id
			)
	) THEN
		RAISE EXCEPTION 'multi-target semantic operation % has a response command for another invitation', p_operation_id
			USING ERRCODE = '23514';
	END IF;
END;
$$;

COMMENT ON FUNCTION hub.validate_multi_target_semantic_operation(uuid) IS
	'Migration 0013 preserves the migration-0011 shape contract while allowing source-owned candidate lifecycle terminalization inside a still-live parent.';
