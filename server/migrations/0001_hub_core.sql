BEGIN;

CREATE SCHEMA IF NOT EXISTS hub;

CREATE TABLE hub.accounts (
	id uuid PRIMARY KEY,
	display_name text NOT NULL CHECK (length(trim(display_name)) BETWEEN 1 AND 100),
	status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'deleted')),
	created_at timestamptz NOT NULL DEFAULT now(),
	updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE hub.external_identities (
	id uuid PRIMARY KEY,
	account_id uuid NOT NULL REFERENCES hub.accounts(id) ON DELETE CASCADE,
	provider text NOT NULL,
	provider_subject text NOT NULL,
	created_at timestamptz NOT NULL DEFAULT now(),
	UNIQUE (provider, provider_subject)
);

CREATE TABLE hub.sessions (
	id uuid PRIMARY KEY,
	account_id uuid NOT NULL REFERENCES hub.accounts(id) ON DELETE CASCADE,
	token_hash bytea NOT NULL UNIQUE,
	user_agent text,
	created_at timestamptz NOT NULL DEFAULT now(),
	last_seen_at timestamptz NOT NULL DEFAULT now(),
	expires_at timestamptz NOT NULL,
	revoked_at timestamptz,
	CHECK (expires_at > created_at)
);

CREATE INDEX sessions_account_active_idx
	ON hub.sessions (account_id, expires_at)
	WHERE revoked_at IS NULL;

CREATE TABLE hub.campaigns (
	id uuid PRIMARY KEY,
	owner_account_id uuid NOT NULL REFERENCES hub.accounts(id),
	name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
	status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived', 'deleting')),
	next_event_sequence bigint NOT NULL DEFAULT 1 CHECK (next_event_sequence > 0),
	created_at timestamptz NOT NULL DEFAULT now(),
	updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE hub.memberships (
	id uuid PRIMARY KEY,
	campaign_id uuid NOT NULL REFERENCES hub.campaigns(id) ON DELETE CASCADE,
	account_id uuid NOT NULL REFERENCES hub.accounts(id) ON DELETE CASCADE,
	role text NOT NULL CHECK (role IN ('dm', 'co_dm', 'player', 'spectator')),
	status text NOT NULL DEFAULT 'active' CHECK (status IN ('invited', 'active', 'removed', 'left')),
	created_at timestamptz NOT NULL DEFAULT now(),
	updated_at timestamptz NOT NULL DEFAULT now(),
	UNIQUE (campaign_id, account_id),
	UNIQUE (campaign_id, id)
);

CREATE INDEX memberships_account_active_idx
	ON hub.memberships (account_id, campaign_id)
	WHERE status = 'active';

CREATE TABLE hub.invites (
	id uuid PRIMARY KEY,
	campaign_id uuid NOT NULL REFERENCES hub.campaigns(id) ON DELETE CASCADE,
	created_by_membership_id uuid NOT NULL,
	token_hash bytea NOT NULL UNIQUE,
	role text NOT NULL CHECK (role IN ('co_dm', 'player', 'spectator')),
	max_uses integer NOT NULL DEFAULT 1 CHECK (max_uses > 0),
	use_count integer NOT NULL DEFAULT 0 CHECK (use_count >= 0 AND use_count <= max_uses),
	expires_at timestamptz NOT NULL,
	revoked_at timestamptz,
	created_at timestamptz NOT NULL DEFAULT now(),
	FOREIGN KEY (campaign_id, created_by_membership_id)
		REFERENCES hub.memberships(campaign_id, id)
);

CREATE TABLE hub.brew_bundle_versions (
	id uuid PRIMARY KEY,
	campaign_id uuid NOT NULL REFERENCES hub.campaigns(id) ON DELETE CASCADE,
	version integer NOT NULL CHECK (version > 0),
	content_hash text NOT NULL,
	object_key text,
	content jsonb NOT NULL,
	manifest jsonb NOT NULL,
	created_by_membership_id uuid NOT NULL,
	created_at timestamptz NOT NULL DEFAULT now(),
	UNIQUE (campaign_id, version),
	UNIQUE (campaign_id, content_hash),
	UNIQUE (campaign_id, id),
	FOREIGN KEY (campaign_id, created_by_membership_id)
		REFERENCES hub.memberships(campaign_id, id)
);

CREATE TABLE hub.rules_versions (
	id uuid PRIMARY KEY,
	campaign_id uuid NOT NULL REFERENCES hub.campaigns(id) ON DELETE CASCADE,
	version integer NOT NULL CHECK (version > 0),
	schema_version integer NOT NULL CHECK (schema_version > 0),
	rules jsonb NOT NULL,
	created_by_membership_id uuid NOT NULL,
	created_at timestamptz NOT NULL DEFAULT now(),
	UNIQUE (campaign_id, version),
	UNIQUE (campaign_id, id),
	FOREIGN KEY (campaign_id, created_by_membership_id)
		REFERENCES hub.memberships(campaign_id, id)
);

ALTER TABLE hub.campaigns
	ADD COLUMN active_brew_bundle_version_id uuid,
	ADD COLUMN active_rules_version_id uuid,
	ADD CONSTRAINT campaigns_active_brew_bundle_fk
		FOREIGN KEY (id, active_brew_bundle_version_id)
		REFERENCES hub.brew_bundle_versions(campaign_id, id),
	ADD CONSTRAINT campaigns_active_rules_fk
		FOREIGN KEY (id, active_rules_version_id)
		REFERENCES hub.rules_versions(campaign_id, id);

CREATE TABLE hub.characters (
	id uuid PRIMARY KEY,
	owner_account_id uuid NOT NULL REFERENCES hub.accounts(id),
	campaign_id uuid REFERENCES hub.campaigns(id),
	cloned_from_character_id uuid REFERENCES hub.characters(id) ON DELETE SET NULL,
	client_import_id text,
	status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived', 'deleted')),
	schema_version integer NOT NULL CHECK (schema_version > 0),
	revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
	lease_epoch bigint NOT NULL DEFAULT 0 CHECK (lease_epoch >= 0),
	data jsonb NOT NULL,
	import_provenance jsonb,
	created_at timestamptz NOT NULL DEFAULT now(),
	updated_at timestamptz NOT NULL DEFAULT now(),
	UNIQUE (campaign_id, id),
	UNIQUE (owner_account_id, campaign_id, client_import_id)
);

CREATE INDEX characters_owner_idx ON hub.characters (owner_account_id, status);
CREATE INDEX characters_campaign_idx ON hub.characters (campaign_id, status) WHERE campaign_id IS NOT NULL;
CREATE UNIQUE INDEX characters_detached_import_unique
	ON hub.characters (owner_account_id, client_import_id)
	WHERE campaign_id IS NULL AND client_import_id IS NOT NULL;

CREATE TABLE hub.character_leases (
	character_id uuid PRIMARY KEY REFERENCES hub.characters(id) ON DELETE CASCADE,
	session_id uuid NOT NULL REFERENCES hub.sessions(id) ON DELETE CASCADE,
	epoch bigint NOT NULL CHECK (epoch > 0),
	expires_at timestamptz NOT NULL,
	updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE hub.dm_workspaces (
	id uuid PRIMARY KEY,
	campaign_id uuid NOT NULL REFERENCES hub.campaigns(id) ON DELETE CASCADE,
	owner_membership_id uuid NOT NULL,
	schema_version integer NOT NULL CHECK (schema_version > 0),
	revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
	lease_epoch bigint NOT NULL DEFAULT 0 CHECK (lease_epoch >= 0),
	state jsonb NOT NULL,
	created_at timestamptz NOT NULL DEFAULT now(),
	updated_at timestamptz NOT NULL DEFAULT now(),
	UNIQUE (campaign_id, owner_membership_id),
	UNIQUE (campaign_id, id),
	FOREIGN KEY (campaign_id, owner_membership_id)
		REFERENCES hub.memberships(campaign_id, id)
		ON DELETE CASCADE
);

CREATE TABLE hub.dm_workspace_leases (
	workspace_id uuid PRIMARY KEY REFERENCES hub.dm_workspaces(id) ON DELETE CASCADE,
	session_id uuid NOT NULL REFERENCES hub.sessions(id) ON DELETE CASCADE,
	epoch bigint NOT NULL CHECK (epoch > 0),
	expires_at timestamptz NOT NULL,
	updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE hub.party_inventories (
	id uuid PRIMARY KEY,
	campaign_id uuid NOT NULL UNIQUE REFERENCES hub.campaigns(id) ON DELETE CASCADE,
	revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
	currency jsonb NOT NULL DEFAULT '{"cp":0,"sp":0,"ep":0,"gp":0,"pp":0}'::jsonb,
	created_at timestamptz NOT NULL DEFAULT now(),
	updated_at timestamptz NOT NULL DEFAULT now(),
	UNIQUE (campaign_id, id)
);

CREATE TABLE hub.inventory_entries (
	id uuid PRIMARY KEY,
	campaign_id uuid NOT NULL REFERENCES hub.campaigns(id) ON DELETE CASCADE,
	character_id uuid REFERENCES hub.characters(id) ON DELETE CASCADE,
	party_inventory_id uuid REFERENCES hub.party_inventories(id) ON DELETE CASCADE,
	item_uid text NOT NULL,
	bundle_version_id uuid,
	quantity numeric NOT NULL CHECK (quantity > 0),
	metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
	revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
	created_at timestamptz NOT NULL DEFAULT now(),
	updated_at timestamptz NOT NULL DEFAULT now(),
	CHECK ((character_id IS NOT NULL)::integer + (party_inventory_id IS NOT NULL)::integer = 1),
	FOREIGN KEY (campaign_id, party_inventory_id)
		REFERENCES hub.party_inventories(campaign_id, id)
		ON DELETE CASCADE,
	FOREIGN KEY (campaign_id, bundle_version_id)
		REFERENCES hub.brew_bundle_versions(campaign_id, id)
);

CREATE INDEX inventory_entries_character_idx ON hub.inventory_entries (character_id) WHERE character_id IS NOT NULL;
CREATE INDEX inventory_entries_party_idx ON hub.inventory_entries (party_inventory_id) WHERE party_inventory_id IS NOT NULL;

CREATE TABLE hub.pending_actions (
	id uuid PRIMARY KEY,
	campaign_id uuid NOT NULL REFERENCES hub.campaigns(id) ON DELETE CASCADE,
	actor_account_id uuid NOT NULL REFERENCES hub.accounts(id),
	target_character_id uuid REFERENCES hub.characters(id),
	action_type text NOT NULL,
	status text NOT NULL DEFAULT 'proposed'
		CHECK (status IN ('proposed', 'accepted', 'rejected', 'expired', 'cancelled', 'applied')),
	payload jsonb NOT NULL,
	expires_at timestamptz,
	created_at timestamptz NOT NULL DEFAULT now(),
	updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE hub.transfers (
	id uuid PRIMARY KEY,
	campaign_id uuid NOT NULL REFERENCES hub.campaigns(id) ON DELETE CASCADE,
	actor_account_id uuid NOT NULL REFERENCES hub.accounts(id),
	source_character_id uuid REFERENCES hub.characters(id),
	source_party_inventory_id uuid,
	target_character_id uuid REFERENCES hub.characters(id),
	target_party_inventory_id uuid,
	status text NOT NULL DEFAULT 'proposed'
		CHECK (status IN ('proposed', 'reserved', 'accepted', 'committed', 'rejected', 'cancelled', 'expired')),
	payload jsonb NOT NULL,
	expires_at timestamptz,
	created_at timestamptz NOT NULL DEFAULT now(),
	updated_at timestamptz NOT NULL DEFAULT now(),
	CHECK ((source_character_id IS NOT NULL)::integer + (source_party_inventory_id IS NOT NULL)::integer = 1),
	CHECK ((target_character_id IS NOT NULL)::integer + (target_party_inventory_id IS NOT NULL)::integer = 1),
	FOREIGN KEY (campaign_id, source_party_inventory_id)
		REFERENCES hub.party_inventories(campaign_id, id),
	FOREIGN KEY (campaign_id, target_party_inventory_id)
		REFERENCES hub.party_inventories(campaign_id, id)
);

CREATE FUNCTION hub.enforce_character_campaign_match ()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
	character_id_to_check uuid;
BEGIN
	IF TG_TABLE_NAME = 'inventory_entries' THEN
		character_id_to_check := NEW.character_id;
	ELSIF TG_TABLE_NAME = 'pending_actions' THEN
		character_id_to_check := NEW.target_character_id;
	ELSIF TG_TABLE_NAME = 'transfers' THEN
		IF NEW.source_character_id IS NOT NULL AND EXISTS (
			SELECT 1 FROM hub.characters c
			WHERE c.id = NEW.source_character_id
				AND c.campaign_id IS DISTINCT FROM NEW.campaign_id
		) THEN
			RAISE EXCEPTION 'source character campaign mismatch' USING ERRCODE = '23514';
		END IF;
		character_id_to_check := NEW.target_character_id;
	END IF;

	IF character_id_to_check IS NOT NULL AND EXISTS (
		SELECT 1 FROM hub.characters c
		WHERE c.id = character_id_to_check
			AND c.campaign_id IS DISTINCT FROM NEW.campaign_id
	) THEN
		RAISE EXCEPTION 'character campaign mismatch' USING ERRCODE = '23514';
	END IF;
	RETURN NEW;
END;
$$;

CREATE TRIGGER inventory_entries_character_campaign_check
	BEFORE INSERT OR UPDATE OF campaign_id, character_id
	ON hub.inventory_entries
	FOR EACH ROW EXECUTE FUNCTION hub.enforce_character_campaign_match();

CREATE TRIGGER pending_actions_character_campaign_check
	BEFORE INSERT OR UPDATE OF campaign_id, target_character_id
	ON hub.pending_actions
	FOR EACH ROW EXECUTE FUNCTION hub.enforce_character_campaign_match();

CREATE TRIGGER transfers_character_campaign_check
	BEFORE INSERT OR UPDATE OF campaign_id, source_character_id, target_character_id
	ON hub.transfers
	FOR EACH ROW EXECUTE FUNCTION hub.enforce_character_campaign_match();

CREATE TABLE hub.domain_events (
	id uuid PRIMARY KEY,
	campaign_id uuid NOT NULL REFERENCES hub.campaigns(id) ON DELETE CASCADE,
	sequence bigint NOT NULL CHECK (sequence > 0),
	event_type text NOT NULL,
	actor_account_id uuid REFERENCES hub.accounts(id),
	aggregate_type text NOT NULL,
	aggregate_id uuid NOT NULL,
	aggregate_revision bigint,
	visibility text NOT NULL
		CHECK (visibility IN ('all_members', 'dm_only', 'actor_and_dm', 'explicit_accounts')),
	visible_account_ids uuid[],
	correlation_id uuid,
	payload jsonb NOT NULL,
	created_at timestamptz NOT NULL DEFAULT now(),
	UNIQUE (campaign_id, sequence),
	UNIQUE (campaign_id, id),
	CHECK (
		(visibility = 'explicit_accounts' AND visible_account_ids IS NOT NULL)
		OR (visibility <> 'explicit_accounts' AND visible_account_ids IS NULL)
	)
);

CREATE TABLE hub.audit_entries (
	id uuid PRIMARY KEY,
	campaign_id uuid REFERENCES hub.campaigns(id) ON DELETE SET NULL,
	actor_account_id uuid REFERENCES hub.accounts(id) ON DELETE SET NULL,
	actor_session_id uuid REFERENCES hub.sessions(id) ON DELETE SET NULL,
	action text NOT NULL,
	target_type text NOT NULL,
	target_id uuid,
	details jsonb NOT NULL DEFAULT '{}'::jsonb,
	created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX audit_entries_campaign_created_idx ON hub.audit_entries (campaign_id, created_at DESC);

CREATE TABLE hub.command_receipts (
	actor_account_id uuid NOT NULL REFERENCES hub.accounts(id) ON DELETE CASCADE,
	idempotency_key text NOT NULL,
	request_hash text NOT NULL,
	command_type text NOT NULL,
	response jsonb NOT NULL,
	created_at timestamptz NOT NULL DEFAULT now(),
	expires_at timestamptz NOT NULL DEFAULT (now() + interval '24 hours'),
	PRIMARY KEY (actor_account_id, idempotency_key)
);

CREATE INDEX command_receipts_expires_idx ON hub.command_receipts (expires_at);

CREATE TABLE hub.outbox_entries (
	id bigserial PRIMARY KEY,
	event_id uuid NOT NULL UNIQUE,
	campaign_id uuid NOT NULL REFERENCES hub.campaigns(id) ON DELETE CASCADE,
	status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'publishing', 'published', 'failed')),
	attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
	available_at timestamptz NOT NULL DEFAULT now(),
	claimed_at timestamptz,
	claim_token uuid,
	published_at timestamptz,
	last_error text,
	created_at timestamptz NOT NULL DEFAULT now(),
	FOREIGN KEY (campaign_id, event_id)
		REFERENCES hub.domain_events(campaign_id, id)
		ON DELETE CASCADE
);

CREATE INDEX outbox_pending_idx
	ON hub.outbox_entries (available_at, id)
	WHERE status IN ('pending', 'failed');

CREATE INDEX outbox_stale_claim_idx
	ON hub.outbox_entries (claimed_at, id)
	WHERE status = 'publishing';

COMMENT ON SCHEMA hub IS
	'Campaign Hub canonical schema. Browser clients never connect directly; the same-origin BFF authorizes every transaction.';
COMMENT ON COLUMN hub.characters.lease_epoch IS
	'Monotonic fencing epoch. Every character mutation must match the current lease epoch.';
COMMENT ON COLUMN hub.dm_workspaces.owner_membership_id IS
	'DM workspace privacy boundary; campaign membership alone does not grant read access.';
COMMENT ON TABLE hub.outbox_entries IS
	'Inserted in the same transaction as canonical state and domain_events, then published asynchronously.';

COMMIT;
