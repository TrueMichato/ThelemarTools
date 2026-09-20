CREATE TABLE hub.account_entitlements (
	id uuid PRIMARY KEY,
	account_id uuid NOT NULL REFERENCES hub.accounts(id) ON DELETE CASCADE,
	entitlement_name text NOT NULL
		CHECK (entitlement_name IN ('campaign:create', 'platform:operate')),
	source text NOT NULL CHECK (length(trim(source)) BETWEEN 1 AND 100),
	granted_by_account_id uuid REFERENCES hub.accounts(id) ON DELETE SET NULL,
	revoked_by_account_id uuid REFERENCES hub.accounts(id) ON DELETE SET NULL,
	granted_at timestamptz NOT NULL DEFAULT now(),
	revoked_at timestamptz,
	created_at timestamptz NOT NULL DEFAULT now(),
	updated_at timestamptz NOT NULL DEFAULT now(),
	CONSTRAINT account_entitlements_revocation_check
		CHECK (
			(revoked_at IS NULL AND revoked_by_account_id IS NULL)
			OR (revoked_at IS NOT NULL AND revoked_at >= granted_at)
		)
);

CREATE UNIQUE INDEX account_entitlements_active_key
	ON hub.account_entitlements (account_id, entitlement_name)
	WHERE revoked_at IS NULL;

CREATE INDEX account_entitlements_account_history_idx
	ON hub.account_entitlements (account_id, entitlement_name, granted_at, id);

INSERT INTO hub.account_entitlements (
	id,
	account_id,
	entitlement_name,
	source
)
SELECT
	gen_random_uuid(),
	owners.owner_account_id,
	'campaign:create',
	'campaign_owner_backfill'
FROM (
	SELECT DISTINCT c.owner_account_id
	FROM hub.campaigns c
	JOIN hub.accounts a ON a.id = c.owner_account_id
	WHERE a.status <> 'deleted'
		AND c.status IN ('active', 'archived', 'deleting')
) owners
ON CONFLICT (account_id, entitlement_name) WHERE revoked_at IS NULL DO NOTHING;

CREATE FUNCTION hub.enforce_active_platform_operator ()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
	removed_active_operator boolean := false;
BEGIN
	IF TG_TABLE_NAME = 'account_entitlements' THEN
		IF TG_OP = 'DELETE' AND NOT EXISTS (
			SELECT 1
			FROM hub.accounts
			WHERE id = OLD.account_id
		) THEN
			RETURN OLD;
		END IF;
	END IF;
	IF TG_TABLE_NAME = 'accounts' THEN
		IF TG_OP = 'UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status THEN
			RETURN NEW;
		END IF;
		IF current_setting('hub.enforce_operator_guard', true) IS DISTINCT FROM 'on' THEN
			RETURN COALESCE(NEW, OLD);
		END IF;
	END IF;
	IF NOT pg_try_advisory_xact_lock(hashtextextended('account-entitlements', 9)) THEN
		RAISE EXCEPTION 'Platform operator authority is changing concurrently.'
			USING ERRCODE = '23514';
	END IF;
	IF TG_TABLE_NAME = 'account_entitlements' THEN
		IF TG_OP = 'DELETE' THEN
			removed_active_operator := OLD.entitlement_name = 'platform:operate' AND OLD.revoked_at IS NULL;
		ELSE
			removed_active_operator := (
				OLD.entitlement_name = 'platform:operate'
				AND OLD.revoked_at IS NULL
				AND (
					NEW.revoked_at IS NOT NULL
					OR NEW.entitlement_name <> 'platform:operate'
					OR NEW.account_id <> OLD.account_id
				)
			);
		END IF;
	ELSE
		IF TG_OP = 'DELETE' THEN
			removed_active_operator := OLD.status = 'active';
		ELSE
			removed_active_operator := OLD.status = 'active' AND NEW.status <> 'active';
		END IF;
		removed_active_operator := removed_active_operator AND EXISTS (
			SELECT 1
			FROM hub.account_entitlements entitlement
			WHERE entitlement.account_id = OLD.id
				AND entitlement.entitlement_name = 'platform:operate'
				AND entitlement.revoked_at IS NULL
		);
	END IF;

	IF removed_active_operator AND NOT EXISTS (
		SELECT 1
		FROM hub.account_entitlements entitlement
		JOIN hub.accounts account ON account.id = entitlement.account_id
		WHERE entitlement.entitlement_name = 'platform:operate'
			AND entitlement.revoked_at IS NULL
			AND account.status = 'active'
	) THEN
		RAISE EXCEPTION 'At least one active platform operator is required.'
			USING ERRCODE = '23514';
	END IF;
	RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE CONSTRAINT TRIGGER account_entitlements_require_operator
	AFTER DELETE OR UPDATE
	ON hub.account_entitlements
	DEFERRABLE INITIALLY DEFERRED
	FOR EACH ROW
	EXECUTE FUNCTION hub.enforce_active_platform_operator();

CREATE CONSTRAINT TRIGGER accounts_require_operator
	AFTER DELETE OR UPDATE
	ON hub.accounts
	DEFERRABLE INITIALLY DEFERRED
	FOR EACH ROW
	EXECUTE FUNCTION hub.enforce_active_platform_operator();
