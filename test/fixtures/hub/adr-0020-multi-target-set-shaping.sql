WITH
candidate_targets (target_index, target_character_id, target_owner_account_id) AS (
	VALUES
		(0, '00000000-0000-0000-0000-000000000003'::uuid, '10000000-0000-0000-0000-000000000003'::uuid),
		(1, '00000000-0000-0000-0000-000000000001'::uuid, '10000000-0000-0000-0000-000000000001'::uuid),
		(2, '00000000-0000-0000-0000-000000000002'::uuid, '10000000-0000-0000-0000-000000000002'::uuid)
),
candidate_shape AS (
	SELECT
		count(*)::integer AS candidate_count,
		count(DISTINCT target_index)::integer AS ordinal_count,
		array_agg(target_index ORDER BY target_index) AS ordinals
	FROM candidate_targets
),
duplicate_targets (target_index, target_character_id) AS (
	VALUES
		(0, '00000000-0000-0000-0000-000000000001'::uuid),
		(1, '00000000-0000-0000-0000-000000000001'::uuid)
),
gapped_candidates (target_index, target_character_id) AS (
	VALUES
		(0, '00000000-0000-0000-0000-000000000001'::uuid),
		(2, '00000000-0000-0000-0000-000000000002'::uuid),
		(3, '00000000-0000-0000-0000-000000000003'::uuid)
),
gapped_shape AS (
	SELECT
		count(*)::integer AS candidate_count,
		count(DISTINCT target_index)::integer AS ordinal_count,
		array_agg(target_index ORDER BY target_index) AS ordinals
	FROM gapped_candidates
),
selected_targets (selection_index, target_character_id) AS (
	VALUES
		(0, '00000000-0000-0000-0000-000000000001'::uuid),
		(1, '00000000-0000-0000-0000-000000000003'::uuid)
),
unique_character_set AS (
	SELECT '00000000-0000-0000-0000-000000000001'::uuid AS character_id
	UNION
	SELECT target_character_id
	FROM selected_targets
)
SELECT
	(SELECT count(*) = count(DISTINCT target_character_id) FROM candidate_targets) AS target_set_unique,
	(
		SELECT ordinal_count = candidate_count
			AND ordinals = (
				SELECT array_agg(expected_index ORDER BY expected_index)
				FROM generate_series(0, candidate_count - 1) AS expected(expected_index)
			)
		FROM candidate_shape
	) AS candidate_order_contiguous,
	(
		SELECT count(*) = 0
		FROM selected_targets selected
		LEFT JOIN candidate_targets candidate USING (target_character_id)
		WHERE candidate.target_character_id IS NULL
	) AS selection_is_subset,
	(SELECT count(*) = count(DISTINCT target_character_id) FROM selected_targets) AS selection_unique,
	(
		SELECT array_agg(character_id ORDER BY character_id)
		FROM unique_character_set
	) = ARRAY[
		'00000000-0000-0000-0000-000000000001'::uuid,
		'00000000-0000-0000-0000-000000000003'::uuid
	] AS stable_unique_character_order,
	(
		SELECT count(*)
		FROM unique_character_set
		WHERE character_id = '00000000-0000-0000-0000-000000000001'::uuid
	) = 1 AS self_target_collapsed,
	(SELECT count(*) <> count(DISTINCT target_character_id) FROM duplicate_targets) AS duplicate_target_detected,
	(
		SELECT NOT (
			ordinal_count = candidate_count
			AND ordinals = (
				SELECT array_agg(expected_index ORDER BY expected_index)
				FROM generate_series(0, candidate_count - 1) AS expected(expected_index)
			)
		)
		FROM gapped_shape
	) AS gapped_ordinal_detected;
