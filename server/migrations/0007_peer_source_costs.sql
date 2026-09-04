ALTER TABLE hub.semantic_operations
	DROP CONSTRAINT semantic_operations_status_check,
	ADD CONSTRAINT semantic_operations_status_check
		CHECK (status IN ('proposed', 'applied', 'rejected', 'cancelled', 'expired', 'failed'));

ALTER TABLE hub.semantic_operations
	ADD COLUMN target_owner_account_id_at_proposal uuid,
	ADD COLUMN source_cost_version integer CHECK (source_cost_version = 1),
	ADD COLUMN source_cost jsonb,
	ADD COLUMN rules_version_id uuid,
	ADD COLUMN rules_pin jsonb,
	ADD COLUMN template_registry_version text,
	ADD COLUMN effect_resolution_seed bytea,
	ADD COLUMN source_revision_observed bigint CHECK (source_revision_observed > 0),
	ADD COLUMN source_cost_invalidated boolean NOT NULL DEFAULT false,
	ADD COLUMN target_revision_observed bigint CHECK (target_revision_observed > 0),
	ADD COLUMN resulting_source_character_revision bigint CHECK (resulting_source_character_revision > 0),
	ADD COLUMN source_cost_event_id uuid,
	ADD COLUMN private_failure_code text
		CHECK (private_failure_code IN (
			'SOURCE_COST_UNAVAILABLE',
			'TARGET_EFFECT_UNAVAILABLE',
			'POLICY_VERSION_STALE'
		)),
	ADD CONSTRAINT semantic_operations_target_owner_fk
		FOREIGN KEY (target_owner_account_id_at_proposal)
		REFERENCES hub.accounts(id)
		ON DELETE RESTRICT,
	ADD CONSTRAINT semantic_operations_rules_version_fk
		FOREIGN KEY (campaign_id, rules_version_id)
		REFERENCES hub.rules_versions(campaign_id, id)
		ON DELETE RESTRICT,
	ADD CONSTRAINT semantic_operations_source_cost_event_fk
		FOREIGN KEY (campaign_id, source_cost_event_id)
		REFERENCES hub.domain_events(campaign_id, id)
		ON DELETE RESTRICT,
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
				AND target_revision_observed IS NOT NULL
				AND target_owner_account_id_at_proposal IS NOT NULL
			)
		),
	ADD CONSTRAINT semantic_operations_source_result_check
		CHECK (
			source_cost_version IS NULL
			OR (
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
		),
	ADD CONSTRAINT semantic_operations_private_failure_check
		CHECK (
			(status = 'failed' AND private_failure_code IS NOT NULL)
			OR (status <> 'failed' AND private_failure_code IS NULL)
		),
	ADD CONSTRAINT semantic_operations_cost_event_exclusivity_check
		CHECK (
			source_cost_version IS NULL
			OR (
				(status = 'applied' AND applied_event_id IS NOT NULL AND terminal_event_id IS NULL)
				OR (status = 'proposed' AND applied_event_id IS NULL AND terminal_event_id IS NULL)
				OR (
					status IN ('rejected', 'cancelled', 'expired', 'failed')
					AND applied_event_id IS NULL
					AND terminal_event_id IS NOT NULL
				)
			)
		);

ALTER TABLE hub.semantic_operations
	DROP CONSTRAINT semantic_operations_source_character_id_fkey,
	DROP CONSTRAINT semantic_operations_target_character_id_fkey,
	ADD CONSTRAINT semantic_operations_source_character_fk
		FOREIGN KEY (source_character_id)
		REFERENCES hub.characters(id)
		ON DELETE RESTRICT,
	ADD CONSTRAINT semantic_operations_target_character_fk
		FOREIGN KEY (target_character_id)
		REFERENCES hub.characters(id)
		ON DELETE RESTRICT;

CREATE UNIQUE INDEX semantic_operations_source_revision_unique
	ON hub.semantic_operations (source_character_id, resulting_source_character_revision)
	WHERE source_cost_version = 1
		AND source_character_id <> target_character_id
		AND resulting_source_character_revision IS NOT NULL;

CREATE INDEX semantic_operations_live_template_idx
	ON hub.semantic_operations (
		source_cost_version,
		template_registry_version,
		effect_template_id,
		expires_at
	)
	WHERE status = 'proposed' AND source_cost_version IS NOT NULL;

COMMENT ON COLUMN hub.semantic_operations.source_cost IS
	'Closed server-derived ADR 0016 source-cost descriptor; never client-authored.';
COMMENT ON COLUMN hub.semantic_operations.effect_resolution_seed IS
	'Private 256-bit deterministic template seed; never projected, logged, or emitted.';
COMMENT ON COLUMN hub.semantic_operations.source_cost_invalidated IS
	'Permanent ADR 0016 ABA fence set when any bound source resource changes while a proposal is live.';

CREATE OR REPLACE FUNCTION hub.peer_source_cost_binding_value(
	p_data jsonb,
	p_component jsonb
) RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
	v_kind text := p_component->>'kind';
	v_pool text := p_component->>'pool';
	v_id text;
	v_value jsonb;
BEGIN
	IF v_kind = 'spell_slot' THEN
		IF v_pool = 'standard' THEN
			RETURN p_data #> ARRAY['spellcasting', 'spellSlots', p_component->>'level'];
		END IF;
		RETURN p_data #> ARRAY['spellcasting', 'pactSlots'];
	END IF;

	IF v_kind IN ('item_charge', 'inventory_quantity') THEN
		v_id := lower(p_component->>'inventoryEntryId');
		IF jsonb_typeof(p_data->'inventory') <> 'array' THEN RETURN NULL; END IF;
		SELECT inventory_entry.value
		INTO v_value
		FROM jsonb_array_elements(p_data->'inventory') AS inventory_entry(value)
		WHERE lower(inventory_entry.value->>'id') = v_id
		LIMIT 1;
		RETURN v_value;
	END IF;

	IF v_kind = 'feature_use' THEN
		v_id := lower(p_component->>'resourceId');
		IF jsonb_typeof(p_data->'resources') = 'array' THEN
			SELECT resource_entry.value
			INTO v_value
			FROM jsonb_array_elements(p_data->'resources') AS resource_entry(value)
			WHERE lower(resource_entry.value->>'id') = v_id
			LIMIT 1;
		END IF;
		RETURN jsonb_build_object(
			'resource', v_value,
			'features', CASE WHEN v_value IS NULL THEN '[]'::jsonb ELSE COALESCE((
				SELECT jsonb_agg(feature_entry.value ORDER BY feature_entry.ordinality)
				FROM jsonb_array_elements(
					CASE WHEN jsonb_typeof(p_data->'features') = 'array' THEN p_data->'features' ELSE '[]'::jsonb END
				) WITH ORDINALITY AS feature_entry(value, ordinality)
				WHERE feature_entry.value->>'id' = v_value->>'featureId'
					OR feature_entry.value->>'resourceId' = v_value->>'id'
			), '[]'::jsonb) END,
			'innateSpells', CASE WHEN v_value IS NULL THEN '[]'::jsonb ELSE COALESCE((
				SELECT jsonb_agg(spell_entry.value ORDER BY spell_entry.ordinality)
				FROM jsonb_array_elements(
					CASE
						WHEN jsonb_typeof(p_data->'spellcasting'->'innateSpells') = 'array'
							THEN p_data->'spellcasting'->'innateSpells'
						ELSE '[]'::jsonb
					END
				) WITH ORDINALITY AS spell_entry(value, ordinality)
				WHERE spell_entry.value->>'id' = v_value->>'linkedInnateSpellId'
					OR spell_entry.value->>'resourceId' = v_value->>'id'
					OR spell_entry.value->>'linkedResourceId' = v_value->>'id'
			), '[]'::jsonb) END
		);
	END IF;

	RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION hub.mark_peer_source_cost_invalidated()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF OLD.data IS NOT DISTINCT FROM NEW.data THEN RETURN NEW; END IF;

	UPDATE hub.semantic_operations operation
	SET source_cost_invalidated = true
	WHERE operation.source_character_id = NEW.id
		AND operation.status = 'proposed'
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

CREATE TRIGGER characters_peer_source_cost_invalidation
	BEFORE UPDATE OF data ON hub.characters
	FOR EACH ROW
	EXECUTE FUNCTION hub.mark_peer_source_cost_invalidated();
