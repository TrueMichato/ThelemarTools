WITH
candidate_targets (target_index, target_character_id, target_owner_account_id) AS (
	VALUES
		(0, '00000000-0000-0000-0000-000000000003'::uuid, '10000000-0000-0000-0000-000000000003'::uuid),
		(1, '00000000-0000-0000-0000-000000000001'::uuid, '10000000-0000-0000-0000-000000000001'::uuid),
		(2, '00000000-0000-0000-0000-000000000002'::uuid, '10000000-0000-0000-0000-000000000002'::uuid)
),
selected_targets (selection_index, target_character_id) AS (
	VALUES
		(0, '00000000-0000-0000-0000-000000000001'::uuid),
		(1, '00000000-0000-0000-0000-000000000003'::uuid)
),
lock_set AS (
	SELECT '00000000-0000-0000-0000-000000000001'::uuid AS character_id
	UNION
	SELECT target_character_id
	FROM selected_targets
),
ordered_lock_set AS (
	SELECT character_id
	FROM lock_set
	ORDER BY character_id
)
SELECT
	(SELECT count(*) = count(DISTINCT target_character_id) FROM candidate_targets) AS target_set_unique,
	(SELECT min(target_index) = 0 AND max(target_index) = count(*) - 1 FROM candidate_targets) AS candidate_order_contiguous,
	(
		SELECT count(*) = 0
		FROM selected_targets selected
		LEFT JOIN candidate_targets candidate USING (target_character_id)
		WHERE candidate.target_character_id IS NULL
	) AS selection_is_subset,
	(SELECT count(*) = count(DISTINCT target_character_id) FROM selected_targets) AS selection_unique,
	(
		SELECT array_agg(character_id)
		FROM ordered_lock_set
	) = ARRAY[
		'00000000-0000-0000-0000-000000000001'::uuid,
		'00000000-0000-0000-0000-000000000003'::uuid
	] AS stable_unique_lock_order,
	(
		SELECT count(*)
		FROM ordered_lock_set
		WHERE character_id = '00000000-0000-0000-0000-000000000001'::uuid
	) = 1 AS self_target_collapsed;
