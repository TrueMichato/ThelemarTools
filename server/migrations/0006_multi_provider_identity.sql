DO $$
BEGIN
	IF EXISTS (
		SELECT 1
		FROM hub.external_identities
		WHERE provider !~ '^[a-z][a-z0-9-]{0,31}$'
			OR provider_subject <> trim(provider_subject)
			OR length(provider_subject) NOT BETWEEN 1 AND 255
	) THEN
		RAISE EXCEPTION 'Existing external identity provider/subject values violate the multi-provider contract.';
	END IF;
END;
$$;

ALTER TABLE hub.external_identities
	ADD COLUMN provider_handle text,
	ADD COLUMN provider_display_name text,
	ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now(),
	ADD COLUMN last_authenticated_at timestamptz,
	ADD CONSTRAINT external_identities_provider_check
		CHECK (provider ~ '^[a-z][a-z0-9-]{0,31}$'),
	ADD CONSTRAINT external_identities_subject_check
		CHECK (
			provider_subject = trim(provider_subject)
			AND length(provider_subject) BETWEEN 1 AND 255
		),
	ADD CONSTRAINT external_identities_handle_check
		CHECK (
			provider_handle IS NULL
			OR length(trim(provider_handle)) BETWEEN 1 AND 100
		),
	ADD CONSTRAINT external_identities_display_name_check
		CHECK (
			provider_display_name IS NULL
			OR length(trim(provider_display_name)) BETWEEN 1 AND 100
		),
	ADD CONSTRAINT external_identities_account_identity_key
		UNIQUE (account_id, id);

CREATE INDEX external_identities_account_created_idx
	ON hub.external_identities (account_id, created_at, id);

ALTER TABLE hub.sessions
	ADD COLUMN authenticated_via_identity_id uuid,
	ADD COLUMN recent_reauthenticated_at timestamptz,
	ADD CONSTRAINT sessions_account_session_key
		UNIQUE (account_id, id),
	ADD CONSTRAINT sessions_identity_account_fk
		FOREIGN KEY (account_id, authenticated_via_identity_id)
		REFERENCES hub.external_identities(account_id, id)
		ON DELETE SET NULL (authenticated_via_identity_id),
	ADD CONSTRAINT sessions_recent_reauthentication_check
		CHECK (
			recent_reauthenticated_at IS NULL
			OR (
				authenticated_via_identity_id IS NOT NULL
				AND recent_reauthenticated_at >= created_at
				AND recent_reauthenticated_at <= now() + interval '5 minutes'
			)
		);

CREATE INDEX sessions_identity_active_idx
	ON hub.sessions (authenticated_via_identity_id, expires_at)
	WHERE revoked_at IS NULL;

WITH one_identity AS (
	SELECT account_id, (array_agg(id ORDER BY id))[1] AS identity_id
	FROM hub.external_identities
	GROUP BY account_id
	HAVING count(*) = 1
)
UPDATE hub.sessions s
SET authenticated_via_identity_id = one_identity.identity_id
FROM one_identity
WHERE s.account_id = one_identity.account_id;

UPDATE hub.external_identities ei
SET last_authenticated_at = activity.last_authenticated_at,
	updated_at = GREATEST(ei.updated_at, activity.last_authenticated_at)
FROM (
	SELECT authenticated_via_identity_id AS identity_id, max(created_at) AS last_authenticated_at
	FROM hub.sessions
	WHERE authenticated_via_identity_id IS NOT NULL
	GROUP BY authenticated_via_identity_id
) activity
WHERE ei.id = activity.identity_id;

CREATE FUNCTION hub.clear_session_identity_authentication ()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	UPDATE hub.sessions
	SET authenticated_via_identity_id = NULL,
		recent_reauthenticated_at = NULL
	WHERE authenticated_via_identity_id = OLD.id;
	RETURN OLD;
END;
$$;

CREATE TRIGGER external_identities_clear_session_authentication
	BEFORE DELETE ON hub.external_identities
	FOR EACH ROW
	EXECUTE FUNCTION hub.clear_session_identity_authentication();

CREATE FUNCTION hub.enforce_account_has_identity ()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
	account_id_to_check uuid;
BEGIN
	IF TG_TABLE_NAME = 'accounts' THEN
		account_id_to_check := COALESCE(NEW.id, OLD.id);
	ELSE
		account_id_to_check := COALESCE(NEW.account_id, OLD.account_id);
	END IF;
	IF EXISTS (
		SELECT 1
		FROM hub.accounts a
		WHERE a.id = account_id_to_check
			AND a.status <> 'deleted'
			AND NOT EXISTS (
				SELECT 1
				FROM hub.external_identities ei
				WHERE ei.account_id = a.id
			)
	) THEN
		RAISE EXCEPTION 'Account % must retain an external identity.', account_id_to_check
			USING ERRCODE = '23514';
	END IF;
	RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE CONSTRAINT TRIGGER accounts_require_external_identity
	AFTER INSERT OR UPDATE ON hub.accounts
	DEFERRABLE INITIALLY DEFERRED
	FOR EACH ROW
	EXECUTE FUNCTION hub.enforce_account_has_identity();

CREATE CONSTRAINT TRIGGER external_identities_require_account_identity
	AFTER DELETE OR UPDATE ON hub.external_identities
	DEFERRABLE INITIALLY DEFERRED
	FOR EACH ROW
	EXECUTE FUNCTION hub.enforce_account_has_identity();

CREATE TABLE hub.oauth_transactions (
	id uuid PRIMARY KEY,
	state_hash bytea UNIQUE,
	provider text NOT NULL CHECK (provider ~ '^[a-z][a-z0-9-]{0,31}$'),
	operation text NOT NULL CHECK (operation IN ('sign_in', 'reauthenticate', 'link')),
	initiating_account_id uuid REFERENCES hub.accounts(id) ON DELETE CASCADE,
	initiating_session_id uuid,
	redirect_uri text NOT NULL CHECK (
		length(redirect_uri) BETWEEN 1 AND 2048
		AND redirect_uri ~ '^https?://'
	),
	return_to text NOT NULL CHECK (
		length(return_to) BETWEEN 1 AND 2048
		AND left(return_to, 1) = '/'
		AND left(return_to, 2) <> '//'
	),
	pkce_verifier text CHECK (
		pkce_verifier IS NULL
		OR length(pkce_verifier) BETWEEN 43 AND 128
	),
	oidc_nonce text CHECK (
		oidc_nonce IS NULL
		OR length(oidc_nonce) BETWEEN 32 AND 255
	),
	authorization_started_at timestamptz NOT NULL DEFAULT now(),
	expires_at timestamptz NOT NULL,
	consumed_at timestamptz,
	created_at timestamptz NOT NULL DEFAULT now(),
	CONSTRAINT oauth_transactions_session_account_fk
		FOREIGN KEY (initiating_account_id, initiating_session_id)
		REFERENCES hub.sessions(account_id, id)
		ON DELETE CASCADE,
	CONSTRAINT oauth_transactions_operation_binding_check
		CHECK (
			(operation = 'sign_in' AND initiating_account_id IS NULL AND initiating_session_id IS NULL)
			OR (
				operation IN ('reauthenticate', 'link')
				AND initiating_account_id IS NOT NULL
				AND initiating_session_id IS NOT NULL
			)
		),
	CONSTRAINT oauth_transactions_expiry_check
		CHECK (
			expires_at > created_at
			AND expires_at <= created_at + interval '10 minutes'
		),
	CONSTRAINT oauth_transactions_consumption_check
		CHECK (
			(consumed_at IS NULL AND state_hash IS NOT NULL)
			OR (
				consumed_at IS NOT NULL
				AND state_hash IS NULL
				AND pkce_verifier IS NULL
				AND oidc_nonce IS NULL
			)
		)
);

CREATE INDEX oauth_transactions_expiry_idx
	ON hub.oauth_transactions (expires_at, id);

CREATE INDEX oauth_transactions_initiating_session_idx
	ON hub.oauth_transactions (initiating_session_id)
	WHERE initiating_session_id IS NOT NULL;
