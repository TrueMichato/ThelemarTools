CREATE TABLE hub.invite_contexts (
	id uuid PRIMARY KEY,
	invite_id uuid NOT NULL REFERENCES hub.invites(id) ON DELETE CASCADE,
	retry_token_hash bytea NOT NULL UNIQUE CHECK (octet_length(retry_token_hash) = 32),
	expires_at timestamptz NOT NULL,
	consumed_at timestamptz,
	completed_account_id uuid,
	completed_session_id uuid,
	completed_membership_id uuid,
	created_at timestamptz NOT NULL DEFAULT now(),
	CONSTRAINT invite_contexts_expiry_check
		CHECK (
			expires_at > created_at
			AND expires_at <= created_at + interval '5 minutes'
		),
	CONSTRAINT invite_contexts_consumption_check
		CHECK (
			(
				consumed_at IS NULL
				AND completed_account_id IS NULL
				AND completed_session_id IS NULL
				AND completed_membership_id IS NULL
			)
			OR (
				consumed_at IS NOT NULL
				AND consumed_at >= created_at
				AND completed_account_id IS NOT NULL
				AND completed_session_id IS NOT NULL
				AND completed_membership_id IS NOT NULL
			)
		)
);

CREATE INDEX invite_contexts_expiry_idx
	ON hub.invite_contexts (expires_at, id);

ALTER TABLE hub.oauth_transactions
	ADD COLUMN invite_context_id uuid UNIQUE
		REFERENCES hub.invite_contexts(id) ON DELETE CASCADE,
	ADD COLUMN browser_correlation_hash bytea,
	ADD CONSTRAINT oauth_transactions_browser_correlation_hash_check
		CHECK (
			browser_correlation_hash IS NULL
			OR octet_length(browser_correlation_hash) = 32
		);

CREATE INDEX oauth_transactions_invite_context_idx
	ON hub.oauth_transactions (invite_context_id)
	WHERE invite_context_id IS NOT NULL;
