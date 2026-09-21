-- ADR 0020 schema-before-use substrate for bounded, consented multi-target operations.
-- Runtime capability remains disabled until the protocol/state-machine slices are reviewed.

ALTER TABLE hub.semantic_operations
	DROP CONSTRAINT semantic_operations_status_check,
	ADD CONSTRAINT semantic_operations_status_check
		CHECK (status IN (
			'proposed',
			'collecting_responses',
			'awaiting_source_selection',
			'applied',
			'rejected',
			'cancelled',
			'expired',
			'failed'
		)),
	ALTER COLUMN target_character_id DROP NOT NULL,
	ADD COLUMN target_set_version integer CHECK (target_set_version = 1),
	ADD COLUMN candidate_count smallint CHECK (candidate_count BETWEEN 1 AND 8),
	ADD COLUMN collection_closes_at timestamptz,
	ADD COLUMN allow_target_no_op boolean,
	ADD COLUMN ready_at timestamptz,
	ADD COLUMN ready_event_id uuid,
	ADD COLUMN finalized_event_id uuid,
	ADD CONSTRAINT semantic_operations_campaign_id_unique UNIQUE (campaign_id, id);

ALTER TABLE hub.semantic_operations
	ADD CONSTRAINT semantic_operations_ready_event_fk
		FOREIGN KEY (campaign_id, ready_event_id)
		REFERENCES hub.domain_events(campaign_id, id)
		ON DELETE RESTRICT,
	ADD CONSTRAINT semantic_operations_finalized_event_fk
		FOREIGN KEY (campaign_id, finalized_event_id)
		REFERENCES hub.domain_events(campaign_id, id)
		ON DELETE RESTRICT;

ALTER TABLE hub.semantic_operations
	DROP CONSTRAINT semantic_operations_check3,
	DROP CONSTRAINT semantic_operations_check4,
	DROP CONSTRAINT semantic_operations_source_cost_shape_check,
	DROP CONSTRAINT semantic_operations_source_result_check,
	DROP CONSTRAINT semantic_operations_cost_event_exclusivity_check,
	ADD CONSTRAINT semantic_operations_target_shape_check
		CHECK (
			(
				target_set_version IS NULL
				AND candidate_count IS NULL
				AND collection_closes_at IS NULL
				AND allow_target_no_op IS NULL
				AND ready_at IS NULL
				AND ready_event_id IS NULL
				AND finalized_event_id IS NULL
				AND target_character_id IS NOT NULL
				AND status NOT IN ('collecting_responses', 'awaiting_source_selection')
				AND (
					source_character_id IS NULL
					OR (
						target_ref IS NOT NULL
						AND source_entity IS NOT NULL
						AND effect_template_id IS NOT NULL
						AND choice IS NOT NULL
					)
				)
				AND (
					(status = 'applied' AND resulting_character_revision IS NOT NULL)
					OR (status <> 'applied' AND resulting_character_revision IS NULL)
				)
			)
			OR (
				target_set_version = 1
				AND candidate_count BETWEEN 1 AND 8
				AND source_character_id IS NOT NULL
				AND target_character_id IS NULL
				AND target_ref IS NULL
				AND target_owner_account_id_at_proposal IS NULL
				AND target_revision_observed IS NULL
				AND resulting_character_revision IS NULL
				AND applied_event_id IS NULL
				AND collection_closes_at IS NOT NULL
				AND allow_target_no_op IS NOT NULL
				AND expires_at IS NOT NULL
				AND collection_closes_at > created_at
				AND collection_closes_at < expires_at
				AND status IN (
					'collecting_responses',
					'awaiting_source_selection',
					'applied',
					'cancelled',
					'expired',
					'failed'
				)
			)
		),
	ADD CONSTRAINT semantic_operations_source_cost_shape_check
		CHECK (
			(
				source_cost_version IS NULL
				AND source_cost IS NULL
				AND rules_version_id IS NULL
				AND rules_pin IS NULL
				AND template_registry_version IS NULL
				AND effect_resolution_seed IS NULL
				AND source_revision_observed IS NULL
				AND source_cost_invalidated = false
				AND target_revision_observed IS NULL
				AND target_owner_account_id_at_proposal IS NULL
				AND target_set_version IS NULL
			)
			OR (
				source_character_id IS NOT NULL
				AND source_cost_version = 1
				AND source_cost IS NOT NULL
				AND rules_version_id IS NOT NULL
				AND rules_pin IS NOT NULL
				AND template_registry_version IS NOT NULL
				AND length(template_registry_version) BETWEEN 1 AND 120
				AND effect_resolution_seed IS NOT NULL
				AND octet_length(effect_resolution_seed) = 32
				AND source_revision_observed IS NOT NULL
				AND (
					(
						target_set_version IS NULL
						AND target_revision_observed IS NOT NULL
						AND target_owner_account_id_at_proposal IS NOT NULL
					)
					OR (
						target_set_version = 1
						AND target_revision_observed IS NULL
						AND target_owner_account_id_at_proposal IS NULL
					)
				)
			)
		),
	ADD CONSTRAINT semantic_operations_source_result_check
		CHECK (
			source_cost_version IS NULL
			OR (
				target_set_version IS NULL
				AND (
					(
						status = 'applied'
						AND resulting_source_character_revision IS NOT NULL
						AND resulting_character_revision IS NOT NULL
						AND (
							(
								source_character_id = target_character_id
								AND resulting_source_character_revision = resulting_character_revision
								AND source_cost_event_id IS NULL
							)
							OR (
								source_character_id <> target_character_id
								AND source_cost_event_id IS NOT NULL
							)
						)
					)
					OR (
						status <> 'applied'
						AND resulting_source_character_revision IS NULL
						AND resulting_character_revision IS NULL
						AND source_cost_event_id IS NULL
					)
				)
			)
			OR (
				target_set_version = 1
				AND (
					(
						status = 'applied'
						AND resulting_source_character_revision IS NOT NULL
						AND resulting_character_revision IS NULL
						AND source_cost_event_id IS NOT NULL
					)
					OR (
						status <> 'applied'
						AND resulting_source_character_revision IS NULL
						AND resulting_character_revision IS NULL
						AND source_cost_event_id IS NULL
					)
				)
			)
		),
	ADD CONSTRAINT semantic_operations_cost_event_exclusivity_check
		CHECK (
			source_cost_version IS NULL
			OR (
				target_set_version IS NULL
				AND (
					(status = 'applied' AND applied_event_id IS NOT NULL AND terminal_event_id IS NULL)
					OR (status = 'proposed' AND applied_event_id IS NULL AND terminal_event_id IS NULL)
					OR (
						status IN ('rejected', 'cancelled', 'expired', 'failed')
						AND applied_event_id IS NULL
						AND terminal_event_id IS NOT NULL
					)
				)
			)
			OR (
				target_set_version = 1
				AND applied_event_id IS NULL
				AND (
					(status IN ('collecting_responses', 'awaiting_source_selection') AND terminal_event_id IS NULL)
					OR (status = 'applied' AND terminal_event_id IS NULL)
					OR (status IN ('cancelled', 'expired', 'failed') AND terminal_event_id IS NOT NULL)
				)
			)
		);

DROP INDEX hub.semantic_operations_source_revision_unique;
CREATE UNIQUE INDEX semantic_operations_source_revision_unique
	ON hub.semantic_operations (source_character_id, resulting_source_character_revision)
	WHERE source_cost_version = 1
		AND (
			target_set_version = 1
			OR source_character_id <> target_character_id
		)
		AND resulting_source_character_revision IS NOT NULL;

ALTER TABLE hub.semantic_operation_commands
	DROP CONSTRAINT semantic_operation_commands_command_type_check,
	ADD COLUMN invitation_id uuid,
	ADD CONSTRAINT semantic_operation_commands_command_type_check
		CHECK (command_type IN (
			'create_direct',
			'create_proposal',
			'accept',
			'reject',
			'cancel',
			'create_multi_target_proposal',
			'respond_multi_target',
			'finalize_multi_target',
			'cancel_multi_target'
		)),
	ADD CONSTRAINT semantic_operation_commands_invitation_shape_check
		CHECK (
			(command_type = 'respond_multi_target' AND invitation_id IS NOT NULL)
			OR (command_type <> 'respond_multi_target' AND invitation_id IS NULL)
		),
	ADD CONSTRAINT semantic_operation_commands_operation_command_unique
		UNIQUE (operation_id, command_id);

CREATE TABLE hub.semantic_operation_targets (
	operation_id uuid NOT NULL,
	target_character_id uuid NOT NULL,
	campaign_id uuid NOT NULL,
	invitation_id uuid NOT NULL UNIQUE,
	ordinal smallint NOT NULL CHECK (ordinal BETWEEN 1 AND 8),
	target_ref uuid NOT NULL,
	target_owner_account_id_at_proposal uuid NOT NULL,
	target_display_snapshot jsonb NOT NULL,
	target_operation jsonb NOT NULL,
	rules_version_id uuid NOT NULL,
	target_revision_observed bigint NOT NULL CHECK (target_revision_observed > 0),
	resulting_character_revision bigint CHECK (resulting_character_revision > 0),
	collection_closes_at timestamptz NOT NULL,
	response_state text NOT NULL DEFAULT 'pending'
		CHECK (response_state IN (
			'pending',
			'approved',
			'approved_by_source',
			'rejected',
			'expired',
			'revoked',
			'declined'
		)),
	response_actor_account_id uuid REFERENCES hub.accounts(id) ON DELETE SET NULL,
	response_command_id uuid,
	responded_at timestamptz,
	invitation_event_id uuid NOT NULL,
	response_event_id uuid,
	selection_state text NOT NULL DEFAULT 'unselected'
		CHECK (selection_state IN ('unselected', 'selected', 'applied', 'declined')),
	selection_index smallint CHECK (selection_index BETWEEN 1 AND 8),
	selected_at timestamptz,
	lifecycle_invalidated_at timestamptz,
	revoke_reason text
		CHECK (revoke_reason IN (
			'target_unavailable',
			'membership_unavailable',
			'ownership_changed',
			'target_ref_changed',
			'campaign_unavailable'
		)),
	lifecycle_event_id uuid,
	leg_id uuid,
	leg_kind text CHECK (leg_kind IN ('target', 'combined')),
	leg_event_id uuid,
	changed boolean,
	applied_at timestamptz,
	created_at timestamptz NOT NULL DEFAULT now(),
	updated_at timestamptz NOT NULL DEFAULT now(),
	PRIMARY KEY (operation_id, target_character_id),
	UNIQUE (operation_id, ordinal),
	UNIQUE (operation_id, target_ref),
	UNIQUE (operation_id, invitation_id),
	CONSTRAINT semantic_operation_targets_operation_campaign_fk
		FOREIGN KEY (campaign_id, operation_id)
		REFERENCES hub.semantic_operations(campaign_id, id)
		ON DELETE CASCADE,
	CONSTRAINT semantic_operation_targets_character_fk
		FOREIGN KEY (target_character_id)
		REFERENCES hub.characters(id)
		ON DELETE RESTRICT,
	CONSTRAINT semantic_operation_targets_owner_fk
		FOREIGN KEY (target_owner_account_id_at_proposal)
		REFERENCES hub.accounts(id)
		ON DELETE RESTRICT,
	CONSTRAINT semantic_operation_targets_rules_fk
		FOREIGN KEY (campaign_id, rules_version_id)
		REFERENCES hub.rules_versions(campaign_id, id)
		ON DELETE RESTRICT,
	CONSTRAINT semantic_operation_targets_response_command_fk
		FOREIGN KEY (operation_id, response_command_id)
		REFERENCES hub.semantic_operation_commands(operation_id, command_id)
		ON DELETE RESTRICT,
	CONSTRAINT semantic_operation_targets_response_event_fk
		FOREIGN KEY (campaign_id, response_event_id)
		REFERENCES hub.domain_events(campaign_id, id)
		ON DELETE RESTRICT,
	CONSTRAINT semantic_operation_targets_invitation_event_fk
		FOREIGN KEY (campaign_id, invitation_event_id)
		REFERENCES hub.domain_events(campaign_id, id)
		ON DELETE RESTRICT,
	CONSTRAINT semantic_operation_targets_lifecycle_event_fk
		FOREIGN KEY (campaign_id, lifecycle_event_id)
		REFERENCES hub.domain_events(campaign_id, id)
		ON DELETE RESTRICT,
	CONSTRAINT semantic_operation_targets_leg_event_fk
		FOREIGN KEY (campaign_id, leg_event_id)
		REFERENCES hub.domain_events(campaign_id, id)
		ON DELETE RESTRICT,
	CONSTRAINT semantic_operation_targets_response_shape_check
		CHECK (
			(
				response_state = 'pending'
				AND response_actor_account_id IS NULL
				AND response_command_id IS NULL
				AND responded_at IS NULL
				AND response_event_id IS NULL
			)
			OR (
				response_state = 'approved_by_source'
				AND response_command_id IS NULL
				AND responded_at IS NOT NULL
			)
			OR (
				response_state IN ('approved', 'rejected')
				AND response_actor_account_id IS NOT NULL
				AND response_command_id IS NOT NULL
				AND responded_at IS NOT NULL
				AND response_event_id IS NOT NULL
			)
			OR (
				response_state IN ('expired', 'revoked', 'declined')
				AND responded_at IS NOT NULL
			)
		),
	CONSTRAINT semantic_operation_targets_selection_shape_check
		CHECK (
			(
				selection_state IN ('selected', 'applied')
				AND response_state IN ('approved', 'approved_by_source')
				AND selection_index IS NOT NULL
				AND selected_at IS NOT NULL
			)
			OR (
				selection_state NOT IN ('selected', 'applied')
				AND selection_index IS NULL
				AND selected_at IS NULL
			)
		),
	CONSTRAINT semantic_operation_targets_revocation_shape_check
		CHECK (
			(response_state = 'revoked' AND lifecycle_invalidated_at IS NOT NULL AND revoke_reason IS NOT NULL)
			OR (
				response_state <> 'revoked'
				AND lifecycle_invalidated_at IS NULL
				AND revoke_reason IS NULL
				AND lifecycle_event_id IS NULL
			)
		),
	CONSTRAINT semantic_operation_targets_leg_shape_check
		CHECK (
			(
				leg_id IS NULL
				AND leg_kind IS NULL
				AND leg_event_id IS NULL
				AND changed IS NULL
				AND applied_at IS NULL
				AND resulting_character_revision IS NULL
			)
			OR (
				leg_id IS NOT NULL
				AND leg_kind IS NOT NULL
				AND leg_event_id IS NOT NULL
				AND changed IS NOT NULL
				AND applied_at IS NOT NULL
				AND (
					(changed = true AND resulting_character_revision IS NOT NULL)
					OR (
						changed = false
						AND (
							(leg_kind = 'target' AND resulting_character_revision IS NULL)
							OR (leg_kind = 'combined' AND resulting_character_revision IS NOT NULL)
						)
					)
				)
			)
		)
);

CREATE UNIQUE INDEX semantic_operation_targets_response_command_unique
	ON hub.semantic_operation_targets (response_command_id)
	WHERE response_command_id IS NOT NULL;
CREATE UNIQUE INDEX semantic_operation_targets_selection_unique
	ON hub.semantic_operation_targets (operation_id, selection_index)
	WHERE selection_state IN ('selected', 'applied');
CREATE UNIQUE INDEX semantic_operation_targets_leg_unique
	ON hub.semantic_operation_targets (operation_id, leg_id)
	WHERE leg_id IS NOT NULL;
CREATE UNIQUE INDEX semantic_operation_targets_character_revision_unique
	ON hub.semantic_operation_targets (target_character_id, resulting_character_revision)
	WHERE resulting_character_revision IS NOT NULL;

CREATE INDEX semantic_operation_targets_inbox_idx
	ON hub.semantic_operation_targets (
		target_owner_account_id_at_proposal,
		response_state,
		collection_closes_at,
		operation_id,
		target_character_id
	)
	WHERE response_state = 'pending';
CREATE INDEX semantic_operation_targets_lifecycle_idx
	ON hub.semantic_operation_targets (target_character_id, operation_id)
	WHERE response_state <> 'revoked';
CREATE INDEX semantic_operation_targets_terminal_cleanup_idx
	ON hub.semantic_operation_targets (responded_at, operation_id, target_character_id)
	WHERE response_state IN ('rejected', 'expired', 'revoked', 'declined');

CREATE TABLE hub.semantic_operation_finalizations (
	operation_id uuid PRIMARY KEY,
	campaign_id uuid NOT NULL,
	command_id uuid NOT NULL UNIQUE,
	actor_account_id uuid REFERENCES hub.accounts(id) ON DELETE SET NULL,
	selected_invitation_ids jsonb NOT NULL,
	terminal_status text NOT NULL CHECK (terminal_status IN ('applied', 'cancelled', 'failed')),
	result jsonb NOT NULL,
	source_event_id uuid,
	terminal_event_id uuid,
	created_at timestamptz NOT NULL DEFAULT now(),
	finalized_at timestamptz NOT NULL DEFAULT now(),
	CONSTRAINT semantic_operation_finalizations_operation_campaign_fk
		FOREIGN KEY (campaign_id, operation_id)
		REFERENCES hub.semantic_operations(campaign_id, id)
		ON DELETE CASCADE,
	CONSTRAINT semantic_operation_finalizations_command_fk
		FOREIGN KEY (operation_id, command_id)
		REFERENCES hub.semantic_operation_commands(operation_id, command_id)
		ON DELETE RESTRICT,
	CONSTRAINT semantic_operation_finalizations_source_event_fk
		FOREIGN KEY (campaign_id, source_event_id)
		REFERENCES hub.domain_events(campaign_id, id)
		ON DELETE RESTRICT,
	CONSTRAINT semantic_operation_finalizations_terminal_event_fk
		FOREIGN KEY (campaign_id, terminal_event_id)
		REFERENCES hub.domain_events(campaign_id, id)
		ON DELETE RESTRICT,
	CONSTRAINT semantic_operation_finalizations_selection_shape_check
		CHECK (
			jsonb_typeof(selected_invitation_ids) = 'array'
			AND jsonb_array_length(selected_invitation_ids) BETWEEN 0 AND 8
			AND (
				(terminal_status = 'applied' AND jsonb_array_length(selected_invitation_ids) BETWEEN 1 AND 8)
				OR terminal_status IN ('cancelled', 'failed')
			)
		),
	CONSTRAINT semantic_operation_finalizations_event_shape_check
		CHECK (
			(terminal_status = 'applied' AND source_event_id IS NOT NULL AND terminal_event_id IS NULL)
			OR (
				terminal_status IN ('cancelled', 'failed')
				AND source_event_id IS NULL
				AND terminal_event_id IS NOT NULL
			)
		)
);

CREATE INDEX semantic_operation_finalizations_terminal_cleanup_idx
	ON hub.semantic_operation_finalizations (finalized_at, operation_id);

CREATE TABLE hub.semantic_multi_target_usage (
	singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
	first_used_at timestamptz NOT NULL,
	first_operation_id uuid NOT NULL
);

ALTER TABLE hub.campaigns
	ADD COLUMN multi_target_first_used_at timestamptz,
	ADD COLUMN multi_target_first_operation_id uuid,
	ADD CONSTRAINT campaigns_multi_target_usage_shape_check
		CHECK (
			(multi_target_first_used_at IS NULL AND multi_target_first_operation_id IS NULL)
			OR (multi_target_first_used_at IS NOT NULL AND multi_target_first_operation_id IS NOT NULL)
		);

CREATE OR REPLACE FUNCTION hub.mark_peer_source_cost_invalidated()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF OLD.data IS NOT DISTINCT FROM NEW.data THEN RETURN NEW; END IF;

	UPDATE hub.semantic_operations operation
	SET source_cost_invalidated = true
	WHERE operation.source_character_id = NEW.id
		AND (
			(operation.target_set_version IS NULL AND operation.status = 'proposed')
			OR (
				operation.target_set_version = 1
				AND operation.status IN ('collecting_responses', 'awaiting_source_selection')
			)
		)
		AND operation.source_cost_version = 1
		AND operation.source_cost_invalidated = false
		AND EXISTS (
			SELECT 1
			FROM jsonb_array_elements(operation.source_cost->'components') AS component_entry(value)
			WHERE hub.peer_source_cost_binding_value(OLD.data, component_entry.value)
				IS DISTINCT FROM hub.peer_source_cost_binding_value(NEW.data, component_entry.value)
		);

	RETURN NEW;
END;
$$;

CREATE INDEX semantic_operations_multi_collection_idx
	ON hub.semantic_operations (campaign_id, status, collection_closes_at, id)
	WHERE target_set_version = 1 AND status = 'collecting_responses';
CREATE INDEX semantic_operations_multi_finalization_idx
	ON hub.semantic_operations (campaign_id, status, expires_at, id)
	WHERE target_set_version = 1
		AND status IN ('collecting_responses', 'awaiting_source_selection');
CREATE INDEX semantic_operations_multi_source_live_idx
	ON hub.semantic_operations (source_character_id, status, created_at DESC)
	WHERE target_set_version = 1
		AND status IN ('collecting_responses', 'awaiting_source_selection');
CREATE INDEX semantic_operations_multi_terminal_cleanup_idx
	ON hub.semantic_operations (resolved_at, id)
	WHERE target_set_version = 1
		AND status IN ('applied', 'cancelled', 'expired', 'failed');

CREATE FUNCTION hub.guard_multi_target_identity_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF ROW(
		OLD.operation_id,
		OLD.target_character_id,
		OLD.campaign_id,
		OLD.invitation_id,
		OLD.ordinal,
		OLD.target_ref,
		OLD.target_owner_account_id_at_proposal,
		OLD.target_display_snapshot,
		OLD.target_operation,
		OLD.rules_version_id,
		OLD.target_revision_observed,
		OLD.collection_closes_at,
		OLD.invitation_event_id,
		OLD.created_at
	) IS DISTINCT FROM ROW(
		NEW.operation_id,
		NEW.target_character_id,
		NEW.campaign_id,
		NEW.invitation_id,
		NEW.ordinal,
		NEW.target_ref,
		NEW.target_owner_account_id_at_proposal,
		NEW.target_display_snapshot,
		NEW.target_operation,
		NEW.rules_version_id,
		NEW.target_revision_observed,
		NEW.collection_closes_at,
		NEW.invitation_event_id,
		NEW.created_at
	) THEN
		RAISE EXCEPTION 'multi-target invitation identity is immutable'
			USING ERRCODE = '23514';
	END IF;
	RETURN NEW;
END;
$$;

CREATE TRIGGER semantic_operation_targets_identity_immutable
	BEFORE UPDATE ON hub.semantic_operation_targets
	FOR EACH ROW
	EXECUTE FUNCTION hub.guard_multi_target_identity_immutable();

CREATE FUNCTION hub.guard_multi_target_parent_identity_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF TG_OP = 'DELETE' THEN
		IF OLD.target_set_version = 1
			AND OLD.status IN ('collecting_responses', 'awaiting_source_selection')
		THEN
			RAISE EXCEPTION 'live multi-target parent is immutable'
				USING ERRCODE = '23514';
		END IF;
		RETURN OLD;
	END IF;

	IF OLD.target_set_version = 1 AND ROW(
		OLD.campaign_id,
		OLD.source_character_id,
		OLD.target_set_version,
		OLD.candidate_count,
		OLD.source_entity,
		OLD.effect_template_id,
		OLD.choice,
		OLD.source_display_snapshot,
		OLD.effect_display_snapshot,
		OLD.source_cost_version,
		OLD.source_cost,
		OLD.rules_version_id,
		OLD.rules_pin,
		OLD.template_registry_version,
		OLD.effect_resolution_seed,
		OLD.source_revision_observed,
		OLD.collection_closes_at,
		OLD.expires_at,
		OLD.allow_target_no_op,
		OLD.created_at
	) IS DISTINCT FROM ROW(
		NEW.campaign_id,
		NEW.source_character_id,
		NEW.target_set_version,
		NEW.candidate_count,
		NEW.source_entity,
		NEW.effect_template_id,
		NEW.choice,
		NEW.source_display_snapshot,
		NEW.effect_display_snapshot,
		NEW.source_cost_version,
		NEW.source_cost,
		NEW.rules_version_id,
		NEW.rules_pin,
		NEW.template_registry_version,
		NEW.effect_resolution_seed,
		NEW.source_revision_observed,
		NEW.collection_closes_at,
		NEW.expires_at,
		NEW.allow_target_no_op,
		NEW.created_at
	) THEN
		RAISE EXCEPTION 'multi-target proposal identity is immutable'
			USING ERRCODE = '23514';
	END IF;
	RETURN NEW;
END;
$$;

CREATE TRIGGER semantic_operations_multi_target_identity_immutable
	BEFORE UPDATE OR DELETE ON hub.semantic_operations
	FOR EACH ROW
	EXECUTE FUNCTION hub.guard_multi_target_parent_identity_immutable();

CREATE FUNCTION hub.guard_multi_target_candidate_membership()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
	v_parent hub.semantic_operations%ROWTYPE;
	v_candidate_count integer;
BEGIN
	SELECT *
	INTO v_parent
	FROM hub.semantic_operations
	WHERE id = CASE WHEN TG_OP = 'DELETE' THEN OLD.operation_id ELSE NEW.operation_id END;

	IF NOT FOUND OR v_parent.target_set_version IS NULL THEN
		RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
	END IF;

	IF TG_OP = 'DELETE' THEN
		IF v_parent.status IN ('collecting_responses', 'awaiting_source_selection') THEN
			RAISE EXCEPTION 'live multi-target candidate membership is immutable'
				USING ERRCODE = '23514';
		END IF;
		RETURN OLD;
	END IF;

	IF v_parent.status <> 'collecting_responses' THEN
		RAISE EXCEPTION 'multi-target candidates may be inserted only during proposal construction'
			USING ERRCODE = '23514';
	END IF;

	SELECT count(*)::integer
	INTO v_candidate_count
	FROM hub.semantic_operation_targets
	WHERE operation_id = NEW.operation_id;
	IF v_candidate_count >= v_parent.candidate_count THEN
		RAISE EXCEPTION 'multi-target candidate set is already complete'
			USING ERRCODE = '23514';
	END IF;
	RETURN NEW;
END;
$$;

CREATE TRIGGER semantic_operation_targets_membership_immutable
	BEFORE INSERT OR DELETE ON hub.semantic_operation_targets
	FOR EACH ROW
	EXECUTE FUNCTION hub.guard_multi_target_candidate_membership();

CREATE FUNCTION hub.validate_multi_target_semantic_operation(
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
			(response_state = 'approved_by_source')
				<> (target_owner_account_id_at_proposal = v_parent.origin_actor_account_id)
		)
		AND (
			v_parent.status IN ('collecting_responses', 'awaiting_source_selection')
			OR response_state = 'approved_by_source'
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

CREATE FUNCTION hub.validate_multi_target_semantic_operation_trigger()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF TG_TABLE_NAME = 'semantic_operations' THEN
		PERFORM hub.validate_multi_target_semantic_operation(
			CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END
		);
	ELSE
		PERFORM hub.validate_multi_target_semantic_operation(
			CASE WHEN TG_OP = 'DELETE' THEN OLD.operation_id ELSE NEW.operation_id END
		);
	END IF;
	RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER semantic_operations_multi_target_shape
	AFTER INSERT OR UPDATE OR DELETE ON hub.semantic_operations
	DEFERRABLE INITIALLY DEFERRED
	FOR EACH ROW
	EXECUTE FUNCTION hub.validate_multi_target_semantic_operation_trigger();

CREATE CONSTRAINT TRIGGER semantic_operation_targets_shape
	AFTER INSERT OR UPDATE OR DELETE ON hub.semantic_operation_targets
	DEFERRABLE INITIALLY DEFERRED
	FOR EACH ROW
	EXECUTE FUNCTION hub.validate_multi_target_semantic_operation_trigger();

CREATE CONSTRAINT TRIGGER semantic_operation_finalizations_shape
	AFTER INSERT OR UPDATE OR DELETE ON hub.semantic_operation_finalizations
	DEFERRABLE INITIALLY DEFERRED
	FOR EACH ROW
	EXECUTE FUNCTION hub.validate_multi_target_semantic_operation_trigger();

CREATE CONSTRAINT TRIGGER semantic_operation_commands_multi_target_shape
	AFTER INSERT OR UPDATE OR DELETE ON hub.semantic_operation_commands
	DEFERRABLE INITIALLY DEFERRED
	FOR EACH ROW
	EXECUTE FUNCTION hub.validate_multi_target_semantic_operation_trigger();

COMMENT ON COLUMN hub.semantic_operations.target_set_version IS
	'ADR 0020 normalized target-set contract. NULL identifies immutable legacy one-target rows; 1 uses child targets.';
COMMENT ON TABLE hub.semantic_operation_targets IS
	'Normalized immutable ADR 0020 candidate targets, consent responses, selected subset, and applied per-character legs.';
COMMENT ON TABLE hub.semantic_operation_finalizations IS
	'One durable source-owner finalization per ADR 0020 parent, including the exact ordered invitation selection fingerprint.';
COMMENT ON TABLE hub.semantic_multi_target_usage IS
	'Irreversible schema-use high-water marker. Normal retention never updates or deletes this singleton.';
COMMENT ON COLUMN hub.campaigns.multi_target_first_operation_id IS
	'Persistent per-campaign protocol-6 history marker. Ordinary semantic-operation retention never clears it.';
