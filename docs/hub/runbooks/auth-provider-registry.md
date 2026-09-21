# Runbook: authentication provider registry and rollback

> **Status:** Layers 1-3 implemented; provider enablement remains operator-controlled
> **Owner:** Campaign Hub operator
> **Last reviewed:** 2026-09-17

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
4. Set `HUB_AUTH_PROVIDERS=github`, leave `HUB_AUTH_EMERGENCY_DISABLED_PROVIDERS` empty, retain the exact
   existing GitHub client/secret/callback, and keep `HUB_INVITE_ACCOUNT_ADMISSION_ENABLED=false`.
5. Deploy the candidate. Probe `/api/ready` and `/api/meta`; the latter must advertise protocol 6,
   `auth.provider_registry.v1`, and only available GitHub.
6. Complete one existing-account GitHub sign-in and verify the prior browser session is revoked on a second sign-in.
7. Run maintenance and verify consumed/expired OAuth transaction count is bounded.
8. Record image/migration version, aggregate result, and request ids only.

## Provider-local failure

An unavailable/configuration-error registration must not change another valid provider. Layer 1 has only GitHub,
so invalid GitHub configuration intentionally prevents startup rather than serving a Hub with no recovery path.
Do not use the emergency disable variable for routine rollout.

## Layer 2 paired-provider acceptance

Deploy layer 2 with `HUB_AUTH_PROVIDERS=github`. Discord and Google credentials may be provisioned, but normal
production/private-cohort admission stays disabled until layer 3 supplies explicit reauthentication and
identity linking. Never treat an existing user's unlinked provider subject as the same account.

Before layer 3, live acceptance is limited to isolated staging with fresh test identities:

1. Register exact callbacks `/auth/discord/callback` and `/auth/google/callback`; use Discord scope `identify`
   and Google scopes `openid profile`.
2. Configure all three providers. Identity admission remains invite-gated rather than subject-allowlisted.
3. Run `HUB_APP_ORIGIN=... HUB_METRICS_TOKEN=... npm run hub:check-auth-first-enable`.
4. Complete one printed sign-in or authenticated link journey for each provider. The command passes only if
   both providers remain available and each aggregate successful sign-in-plus-link counter increases after its
   baseline.
5. Return staging to GitHub-only.

After layer 3 is deployed, keep `HUB_ACCOUNT_IDENTITY_LINKING_ENABLED=false` and
`HUB_IDENTITY_RETENTION_REQUIRED_PROVIDERS=github` until the exact-head identity suites, mutation gate, rollback
preflight, and multi-browser journey pass. Enable the identity capability separately; then repeat the paired
provider preflight before first production enablement. A partial result blocks enablement. After admission, one
failing provider may be emergency-disabled independently while healthy providers and existing sessions remain
usable.

## GitHub-only rollback preflight

Run against the current database and exact current admission policy:

```bash
DATABASE_URL=... \
HUB_DATABASE_SSL=true \
HUB_ROLLBACK_SUPPORTED_AUTH_PROVIDERS=github \
npm run hub:check-auth-rollback
```

- exit 0 and `{"blockedAccounts":0}` permits the identity-compatibility portion of rollback;
- exit 2 means at least one active account would be left without an identity supported by the target image;
- any query/configuration failure blocks rollback.

The command deliberately emits only a count. A zero count does not replace the migration-policy, backup,
readiness, or smoke checks in [application/database rollback](rollback.md).
Optional `HUB_ALLOWED_OAUTH_SUBJECTS=github:12345678` is target-image compatibility input only. When the target
still enforces it, every active account requires a supported identity in that historical list, including
invite-admitted accounts. The value is not passed to or enforced by the r9 BFF.

## Recovery and escalation

If a deploy fails before any unsupported-provider-only identity exists, leave migrations 0006/0008 in place and deploy
the last registry or pre-registry GitHub image allowed by migration policy. Do not down-migrate. If a future
provider-specific incident strands an account, preserve its identities and data, restore provider service or the
last compatible registry image, and escalate to the Hub security owner. No email/manual-link fallback exists.

Evidence: incident/release id, candidate and rollback image digests/SHAs, migration ledger version, preflight
count, provider status labels, readiness result, request ids, and timestamps. Never include identity/profile or
OAuth secret material.

## ADR 0018 rollout stop

Migration 0008 and the server foundation may ship with
`HUB_INVITE_ACCOUNT_ADMISSION_ENABLED=false`. Do not enable first-account admission until the stacked
provider-neutral `campaign:create` entitlement layer is merged, existing campaign owners and designated
operators are backfilled, audited fresh-reauth grant/revoke administration is available, and rollback is
reviewed against accounts created outside the pre-r9 subject allowlist.

## ADR 0019 entitlement preflight

1. Apply migration 0009 and rerun role grants in an isolated environment.
2. Configure `HUB_OPERATOR_ACCOUNT_IDS` only with reviewed internal account UUIDs. Do not use provider subjects,
   email, login, handle, or display name.
3. Start with `HUB_ACCOUNT_ENTITLEMENTS_ENABLED=false`. Verify add-only reconciliation grants each configured
   account `platform:operate` and `campaign:create`, audits additions, and emits only bounded warnings for
   unknown UUIDs. Removing configuration must not revoke.
4. Verify campaign-owner backfill includes active, archived, and deleting campaign owners exactly once and
   excludes role-only DM/co-DM accounts.
5. Complete a real provider reauthentication, then grant a synthetic account `campaign:create`, create a
   campaign as that account, revoke it, and prove a second create is denied with zero side effects.
6. Verify two operators cannot concurrently revoke each other to zero and the last operator cannot request
   deletion.
7. Enable `HUB_ACCOUNT_ENTITLEMENTS_ENABLED=true` through the normal reviewed release. Only after this succeeds
   may invite admission be enabled separately.
