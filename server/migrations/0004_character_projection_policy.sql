-- ADR 0011: authorization-scoped character projections.
--
-- Additive only. Existing characters adopt the `table` preset, which is the closest
-- match to the previous fixed player projection while keeping the two inventory-derived
-- summaries closed.
ALTER TABLE hub.characters
	ADD COLUMN projection_policy jsonb NOT NULL DEFAULT '{"version": 1, "preset": "table", "overrides": {}}'::jsonb,
	ADD COLUMN projection_revision bigint NOT NULL DEFAULT 1 CHECK (projection_revision > 0);
