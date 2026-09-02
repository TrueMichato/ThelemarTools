-- ADR 0012 server substrate: durable semantic commands, operations, targeting, and replay coverage.

ALTER TABLE hub.characters
	ADD COLUMN target_ref uuid NOT NULL DEFAULT gen_random_uuid(),
	ADD COLUMN operation_watermark bigint NOT NULL DEFAULT 0 CHECK (operation_watermark >= 0);

CREATE UNIQUE INDEX characters_target_ref_unique
	ON hub.characters (target_ref);

CREATE TABLE hub.semantic_operations (
	id uuid PRIMARY KEY,
	campaign_id uuid NOT NULL REFERENCES hub.campaigns(id) ON DELETE CASCADE,
	origin_actor_account_id uuid REFERENCES hub.accounts(id) ON DELETE SET NULL,
	source_character_id uuid REFERENCES hub.characters(id) ON DELETE CASCADE,
	target_character_id uuid NOT NULL REFERENCES hub.characters(id) ON DELETE CASCADE,
	target_ref uuid,
	status text NOT NULL CHECK (status IN ('proposed', 'applied', 'rejected', 'cancelled', 'expired')),
	version integer NOT NULL CHECK (version = 1),
	kind text,
	arguments jsonb,
	source_entity jsonb,
	effect_template_id text,
	choice jsonb,
	source_display_snapshot jsonb,
	target_display_snapshot jsonb,
	effect_display_snapshot jsonb,
	resulting_character_revision bigint CHECK (resulting_character_revision > 0),
	expires_at timestamptz,
	terminal_reason text,
	created_event_id uuid,
	applied_event_id uuid,
	terminal_event_id uuid,
	created_at timestamptz NOT NULL DEFAULT now(),
	updated_at timestamptz NOT NULL DEFAULT now(),
	resolved_at timestamptz,
	CHECK (
		(status = 'proposed' AND expires_at IS NOT NULL)
		OR status <> 'proposed'
	),
	CHECK (
		status <> 'proposed'
		OR (expires_at > created_at AND expires_at <= created_at + interval '24 hours')
	),
	CHECK (kind IS NOT NULL AND arguments IS NOT NULL),
	CHECK (
		source_character_id IS NULL
		OR (
			target_ref IS NOT NULL
			AND source_entity IS NOT NULL
			AND effect_template_id IS NOT NULL
			AND choice IS NOT NULL
		)
	),
	CHECK (
		(status = 'applied' AND resulting_character_revision IS NOT NULL)
		OR (status <> 'applied' AND resulting_character_revision IS NULL)
	),
	FOREIGN KEY (campaign_id, created_event_id)
		REFERENCES hub.domain_events(campaign_id, id),
	FOREIGN KEY (campaign_id, applied_event_id)
		REFERENCES hub.domain_events(campaign_id, id),
	FOREIGN KEY (campaign_id, terminal_event_id)
		REFERENCES hub.domain_events(campaign_id, id)
);

CREATE INDEX semantic_operations_campaign_status_idx
	ON hub.semantic_operations (campaign_id, status, created_at DESC);
CREATE INDEX semantic_operations_source_proposed_idx
	ON hub.semantic_operations (source_character_id)
	WHERE status = 'proposed';
CREATE INDEX semantic_operations_target_proposed_idx
	ON hub.semantic_operations (target_character_id)
	WHERE status = 'proposed';
CREATE INDEX semantic_operations_expiry_idx
	ON hub.semantic_operations (expires_at)
	WHERE status = 'proposed';
CREATE UNIQUE INDEX semantic_operations_character_revision_unique
	ON hub.semantic_operations (target_character_id, resulting_character_revision)
	WHERE resulting_character_revision IS NOT NULL;

CREATE TABLE hub.semantic_operation_commands (
	command_id uuid PRIMARY KEY,
	operation_id uuid NOT NULL REFERENCES hub.semantic_operations(id) ON DELETE CASCADE,
	actor_account_id uuid REFERENCES hub.accounts(id) ON DELETE SET NULL,
	command_type text NOT NULL CHECK (command_type IN ('create_direct', 'create_proposal', 'accept', 'reject', 'cancel')),
	request_hash text NOT NULL,
	response jsonb NOT NULL,
	event_ids uuid[] NOT NULL DEFAULT '{}',
	created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX semantic_operation_commands_operation_idx
	ON hub.semantic_operation_commands (operation_id, created_at);

-- Arbitrary pre-v3 peer effects can remain auditable but may never be accepted by
-- the semantic resolver.
UPDATE hub.pending_actions
SET status = 'cancelled', updated_at = now()
WHERE status = 'proposed' AND action_type = 'structured_effect';

COMMENT ON TABLE hub.semantic_operations IS
	'ADR 0012 semantic intent lifecycle. The character document remains canonical.';
COMMENT ON TABLE hub.semantic_operation_commands IS
	'Persistent globally unique command results for exactly-once semantic operation replay.';
COMMENT ON COLUMN hub.characters.operation_watermark IS
	'Latest applied semantic-operation event sequence already reflected in canonical character truth.';
