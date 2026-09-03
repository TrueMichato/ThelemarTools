# Runbook: authentication provider registry and rollback

> **Status:** Layer 1 portable procedure
> **Owner:** Campaign Hub operator
> **Last reviewed:** 2026-09-03

## Purpose and stop conditions

Use this procedure when deploying migration 0006, changing provider enablement, rotating a provider secret, or
rolling back the BFF. Stop if migration checks fail, no provider remains available, the exact callback differs
from `HUB_APP_ORIGIN`, or rollback preflight reports a blocked account.

Never:

- identify, admit, merge, link, or recover an account by email, username, handle, or display name;
- copy an identity row to another account with manual SQL;
- record provider subjects, authorization codes, state, PKCE verifier/nonce, access/refresh tokens, or secrets in
  operational evidence;
- reverse or edit an applied migration.

## Layer 1 deployment

1. Confirm the candidate contains immutable `0006_multi_provider_identity.sql`, required migration `0006`, and
   an `expand`/previous-app-compatible entry in `deploy/hub/migration-policy.json`.
2. Plan and apply migrations with the schema owner, then run role grants.
3. Verify the runtime role can CRUD `hub.oauth_transactions`; run the backup as the backup role and verify
   `oauth_transactions` row data is excluded. PostgreSQL requires table `SELECT` for `pg_dump` to lock/describe
   even an `--exclude-table-data` relation.
4. Set `HUB_AUTH_PROVIDERS=github`, leave `HUB_AUTH_EMERGENCY_DISABLED_PROVIDERS` empty, and retain the exact
   existing GitHub client/secret/callback/allowlist.
5. Deploy the candidate. Probe `/api/ready` and `/api/meta`; the latter must advertise protocol 3,
   `auth.provider_registry.v1`, and only available GitHub.
6. Complete one allowlisted GitHub sign-in and verify the prior browser session is revoked on a second sign-in.
7. Run maintenance and verify consumed/expired OAuth transaction count is bounded.
8. Record image/migration version, aggregate result, and request ids only.

## Provider-local failure

An unavailable/configuration-error registration must not change another valid provider. Layer 1 has only GitHub,
so invalid GitHub configuration intentionally prevents startup rather than serving a Hub with no recovery path.
Do not use the emergency disable variable for routine rollout.

## GitHub-only rollback preflight

Run against the current database and exact current admission policy:

```bash
DATABASE_URL=... \
HUB_DATABASE_SSL=true \
HUB_ALLOWED_OAUTH_SUBJECTS=github:12345678 \
HUB_ROLLBACK_SUPPORTED_AUTH_PROVIDERS=github \
npm run hub:check-auth-rollback
```

- exit 0 and `{"blockedAccounts":0}` permits the identity-compatibility portion of rollback;
- exit 2 means at least one currently admitted account would be newly left without an admitted identity supported
  by the target image;
- any query/configuration failure blocks rollback.

The command deliberately emits only a count. A zero count does not replace the migration-policy, backup,
readiness, or smoke checks in [application/database rollback](rollback.md).

## Recovery and escalation

If a deploy fails before any unsupported-provider-only identity exists, leave migration 0006 in place and deploy
the last registry or pre-registry GitHub image allowed by migration policy. Do not down-migrate. If a future
provider-specific incident strands an account, preserve its identities and data, restore provider service or the
last compatible registry image, and escalate to the Hub security owner. No email/manual-link fallback exists.

Evidence: incident/release id, candidate and rollback image digests/SHAs, migration ledger version, preflight
count, provider status labels, readiness result, request ids, and timestamps. Never include identity/profile or
OAuth secret material.
