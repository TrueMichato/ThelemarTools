CREATE OR REPLACE FUNCTION hub.normalize_peer_source_cost_resource_id(
	p_value text
) RETURNS text
LANGUAGE sql
IMMUTABLE
STRICT
AS $$
	WITH normalized AS (
		SELECT btrim(
			p_value,
			U&'\0009\000B\000C\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\202F\205F\3000\FEFF\000A\000D\2028\2029'
		) AS value
	)
	SELECT CASE
		WHEN value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
			THEN lower(value)
		ELSE value
	END
	FROM normalized
$$;

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
	v_resources jsonb := '[]'::jsonb;
	v_features jsonb := '[]'::jsonb;
	v_innate_spells jsonb := '[]'::jsonb;
BEGIN
	IF v_kind = 'spell_slot' THEN
		IF v_pool = 'standard' THEN
			RETURN p_data #> ARRAY['spellcasting', 'spellSlots', p_component->>'level'];
		END IF;
		RETURN p_data #> ARRAY['spellcasting', 'pactSlots'];
	END IF;

	IF v_kind IN ('item_charge', 'inventory_quantity') THEN
		v_id := hub.normalize_peer_source_cost_resource_id(p_component->>'inventoryEntryId');
		RETURN jsonb_build_object(
			'matches',
			CASE
				WHEN jsonb_typeof(p_data->'inventory') <> 'array' THEN '[]'::jsonb
				ELSE COALESCE((
					SELECT jsonb_agg(inventory_entry.value ORDER BY inventory_entry.ordinality)
					FROM jsonb_array_elements(p_data->'inventory')
						WITH ORDINALITY AS inventory_entry(value, ordinality)
					WHERE hub.normalize_peer_source_cost_resource_id(inventory_entry.value->>'id') = v_id
				), '[]'::jsonb)
			END
		);
	END IF;

	IF v_kind = 'feature_use' THEN
		v_id := hub.normalize_peer_source_cost_resource_id(p_component->>'resourceId');
		IF jsonb_typeof(p_data->'resources') = 'array' THEN
			SELECT COALESCE(jsonb_agg(resource_entry.value ORDER BY resource_entry.ordinality), '[]'::jsonb)
			INTO v_resources
			FROM jsonb_array_elements(p_data->'resources')
				WITH ORDINALITY AS resource_entry(value, ordinality)
			WHERE hub.normalize_peer_source_cost_resource_id(resource_entry.value->>'id') = v_id;
		END IF;

		IF jsonb_typeof(p_data->'features') = 'array' THEN
			SELECT COALESCE(jsonb_agg(feature_entry.value ORDER BY feature_entry.ordinality), '[]'::jsonb)
			INTO v_features
			FROM jsonb_array_elements(p_data->'features')
				WITH ORDINALITY AS feature_entry(value, ordinality)
			WHERE EXISTS (
				SELECT 1
				FROM jsonb_array_elements(v_resources) AS resource_entry(value)
				WHERE CASE
					WHEN resource_entry.value->>'featureId' IS NOT NULL
						THEN feature_entry.value->>'id' = resource_entry.value->>'featureId'
					ELSE resource_entry.value->>'id' IS NOT NULL
						AND feature_entry.value->>'resourceId' = resource_entry.value->>'id'
				END
			);
		END IF;

		IF jsonb_typeof(p_data->'spellcasting'->'innateSpells') = 'array' THEN
			SELECT COALESCE(jsonb_agg(spell_entry.value ORDER BY spell_entry.ordinality), '[]'::jsonb)
			INTO v_innate_spells
			FROM jsonb_array_elements(p_data->'spellcasting'->'innateSpells')
				WITH ORDINALITY AS spell_entry(value, ordinality)
			WHERE EXISTS (
				SELECT 1
				FROM jsonb_array_elements(v_resources) AS resource_entry(value)
				WHERE CASE
					WHEN resource_entry.value->>'linkedInnateSpellId' IS NOT NULL
						THEN spell_entry.value->>'id' = resource_entry.value->>'linkedInnateSpellId'
					ELSE resource_entry.value->>'id' IS NOT NULL
						AND (
							spell_entry.value->>'resourceId' = resource_entry.value->>'id'
							OR spell_entry.value->>'linkedResourceId' = resource_entry.value->>'id'
						)
				END
			);
		END IF;

		RETURN jsonb_build_object(
			'resources', v_resources,
			'features', v_features,
			'innateSpells', v_innate_spells
		);
	END IF;

	RETURN NULL;
END;
$$;

COMMENT ON FUNCTION hub.normalize_peer_source_cost_resource_id(text) IS
	'Matches ECMAScript String.trim for source-cost version-1 identity normalization, lowercases UUIDs only, and preserves non-UUID case.';

COMMENT ON FUNCTION hub.peer_source_cost_binding_value(jsonb, jsonb) IS
	'Canonical ADR 0016 ABA snapshot including every matching source entry/resource and linked feature/innate mirror; duplicate cardinality is identity-significant.';
