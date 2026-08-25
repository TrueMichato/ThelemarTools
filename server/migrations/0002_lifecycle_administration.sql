ALTER TABLE hub.accounts
	DROP CONSTRAINT accounts_status_check,
	ADD COLUMN deletion_requested_at timestamptz,
	ADD COLUMN purge_after timestamptz,
	ADD CONSTRAINT accounts_status_check
		CHECK (status IN ('active', 'suspended', 'deletion_requested', 'deleted')),
	ADD CONSTRAINT accounts_deletion_state_check
		CHECK (
			(status = 'deletion_requested' AND deletion_requested_at IS NOT NULL AND purge_after IS NOT NULL AND purge_after > deletion_requested_at)
			OR (status <> 'deletion_requested' AND deletion_requested_at IS NULL AND purge_after IS NULL)
		);

CREATE INDEX accounts_deletion_due_idx
	ON hub.accounts (purge_after, id)
	WHERE status = 'deletion_requested';

ALTER TABLE hub.dm_workspaces
	ADD COLUMN archived_at timestamptz;

ALTER TABLE hub.pending_actions
	ALTER COLUMN actor_account_id DROP NOT NULL,
	DROP CONSTRAINT pending_actions_actor_account_id_fkey,
	ADD CONSTRAINT pending_actions_actor_account_fk
		FOREIGN KEY (actor_account_id)
		REFERENCES hub.accounts(id)
		ON DELETE SET NULL;

ALTER TABLE hub.transfers
	ALTER COLUMN actor_account_id DROP NOT NULL,
	DROP CONSTRAINT transfers_actor_account_id_fkey,
	ADD CONSTRAINT transfers_actor_account_fk
		FOREIGN KEY (actor_account_id)
		REFERENCES hub.accounts(id)
		ON DELETE SET NULL;

ALTER TABLE hub.domain_events
	DROP CONSTRAINT domain_events_actor_account_id_fkey,
	ADD CONSTRAINT domain_events_actor_account_fk
		FOREIGN KEY (actor_account_id)
		REFERENCES hub.accounts(id)
		ON DELETE SET NULL;

DO $$
DECLARE
	constraint_name text;
BEGIN
	SELECT conname INTO constraint_name
	FROM pg_constraint
	WHERE conrelid = 'hub.invites'::regclass
		AND confrelid = 'hub.memberships'::regclass
		AND contype = 'f';
	EXECUTE format('ALTER TABLE hub.invites DROP CONSTRAINT %I', constraint_name);
END;
$$;

ALTER TABLE hub.invites
	ADD CONSTRAINT invites_creator_membership_fk
		FOREIGN KEY (campaign_id, created_by_membership_id)
		REFERENCES hub.memberships(campaign_id, id)
		ON DELETE CASCADE;

DO $$
DECLARE
	constraint_name text;
BEGIN
	SELECT conname INTO constraint_name
	FROM pg_constraint
	WHERE conrelid = 'hub.brew_bundle_versions'::regclass
		AND confrelid = 'hub.memberships'::regclass
		AND contype = 'f';
	EXECUTE format('ALTER TABLE hub.brew_bundle_versions DROP CONSTRAINT %I', constraint_name);
END;
$$;

ALTER TABLE hub.brew_bundle_versions
	ALTER COLUMN created_by_membership_id DROP NOT NULL,
	ADD CONSTRAINT brew_bundle_creator_membership_fk
		FOREIGN KEY (campaign_id, created_by_membership_id)
		REFERENCES hub.memberships(campaign_id, id)
		ON DELETE SET NULL (created_by_membership_id);

DO $$
DECLARE
	constraint_name text;
BEGIN
	SELECT conname INTO constraint_name
	FROM pg_constraint
	WHERE conrelid = 'hub.rules_versions'::regclass
		AND confrelid = 'hub.memberships'::regclass
		AND contype = 'f';
	EXECUTE format('ALTER TABLE hub.rules_versions DROP CONSTRAINT %I', constraint_name);
END;
$$;

ALTER TABLE hub.rules_versions
	ALTER COLUMN created_by_membership_id DROP NOT NULL,
	ADD CONSTRAINT rules_creator_membership_fk
		FOREIGN KEY (campaign_id, created_by_membership_id)
		REFERENCES hub.memberships(campaign_id, id)
		ON DELETE SET NULL (created_by_membership_id);
