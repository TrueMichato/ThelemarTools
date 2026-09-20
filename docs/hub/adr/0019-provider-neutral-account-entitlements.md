# ADR 0019: Provider-neutral account entitlements and reauthentication

Status: Accepted for r9 layer 2; rollout remains default-off pending release preflight

## Context

[ADR 0018](0018-invite-gated-first-access.md) makes campaign invites the authority for first account access,
but campaign creation and platform operation are account-level privileges rather than properties of a provider
identity or campaign membership. Provider subject, email, handle, login, display name, DM role, and co-DM role
must not become creator or operator authority.

The multi-provider substrate in [ADR 0014](0014-multi-provider-identity.md) already reserves OAuth operation
`reauthenticate`, account/session bindings, session identity provenance, and recent-reauthentication timestamps.
This layer completes that substrate and uses it for narrowly scoped operator administration.

## Decision

### Entitlements

Migration `0009_account_entitlements.sql` adds `hub.account_entitlements` for:

- `campaign:create`;
- `platform:operate`.

An active entitlement belongs to an internal account UUID. Provider identity metadata is never entitlement
authority. Account deletion cascades its entitlement rows; nullable granted/revoked actor foreign keys use
`ON DELETE SET NULL` so a later purge preserves the audit trail. A partial unique index permits at most one
active row for each account and entitlement.

A deferred database constraint trigger prevents a transaction from committing with zero active
`platform:operate` entitlements. Application commands also acquire the operator namespace advisory lock and
the relevant entitlement/account rows before checking the last-operator rule.

The migration grants `campaign:create` exactly once to every non-deleted account which owns a current campaign,
including active, archived, and deleting campaigns. Membership role alone is not a backfill source, and a later
ownership transfer does not implicitly grant the entitlement.

`HUB_OPERATOR_ACCOUNT_IDS` is a comma-separated set of provider-neutral account UUIDs. Startup reconciliation
adds missing `platform:operate` and `campaign:create` entitlements and writes account-scoped audit entries.
Unknown UUIDs produce a bounded warning. Removing a UUID from configuration never revokes authority.

### Rollout and campaign creation

`HUB_ACCOUNT_ENTITLEMENTS_ENABLED` defaults to `false`. When disabled, the previous campaign-creation behavior
remains available and `account.entitlements.v1` is not advertised. When enabled:

- `/api/session` includes the caller's active entitlements;
- `/api/meta` advertises `account.entitlements.v1`;
- `pCreateCampaign` in both stores checks active `campaign:create` inside the authoritative transaction before
  campaign, membership, audit, event, outbox, or receipt writes;
- missing authority returns `403 CAMPAIGN_CREATE_NOT_ENTITLED` with zero side effects.

Creator revocation and campaign creation serialize so a create cannot pass on stale authority. The browser may
hide the form and explain missing access, but remains non-authoritative.

### Reauthentication

Reauthentication starts through an authenticated mutation protected by exact Origin, CSRF, and current
protocol. The OAuth transaction is bound to the current account, current session, operation
`reauthenticate`, and one concrete provider route.

The callback accepts only an immutable `(provider, subject)` identity already linked to the initiating account.
It locks and revalidates the initiating session, revokes it, creates a replacement session, records
`authenticated_via_identity_id` for the returned identity, and sets `recent_reauthenticated_at` to database
time. The BFF closes every revoked session socket, including the old current session, and replaces the cookie
and CSRF state. An identity linked to another account, a provider mismatch, a session mismatch, an expired
transaction, or a stale initiating session cannot freshen authority.

Sensitive entitlement and deletion commands recheck a five-minute freshness window inside their store
transactions. Deletion-grace reauthentication remains available only for the existing export and cancellation
paths; deletion-requested accounts cannot use operator administration.

### Operator administration

The hidden account-level operator namespace supports listing accounts and idempotent entitlement grant/revoke
commands. A non-operator receives route-equivalent `404 NOT_FOUND`; only an operator can distinguish an unknown
target account. A stale or missing fresh reauthentication returns `REAUTHENTICATION_REQUIRED`.

Granting an already-active entitlement and revoking an already-inactive entitlement are successful no-ops and
append no duplicate audit. Entitlement changes write account-scoped audit only: they never allocate a campaign
sequence, append a domain event, or enqueue outbox work. The last operator cannot revoke their operator
entitlement or request account deletion; purge of a non-last operator is allowed and nullable actor references
remain valid.

The lock order is:

1. idempotency advisory lock;
2. operator namespace advisory lock;
3. entitlement row;
4. account row;
5. identities;
6. sessions;
7. leases;
8. campaign advisory lock;
9. campaign row;
10. invite row.

## Consequences

- New invited users can join campaigns without automatically gaining campaign-creation or platform-operation
  authority.
- Existing campaign owners retain creation authority through one migration backfill.
- Operator configuration is provider-neutral, additive, auditable, and safe against accidental removal.
- Reverting application code leaves migration 0009 in place and disables entitlement enforcement. There is no
  database down migration.
- Invite admission remains disabled until migration, designated-operator reconciliation, reauthentication,
  entitlement administration, previous-app compatibility, backup/restore, and rollback preflight all pass.

## Rejected alternatives

- Provider-subject/email/login allowlists: authentication metadata is not account authorization.
- Deriving creator authority from DM/co-DM membership: campaign role is tenant-scoped and changes over time.
- Route-only freshness checks: freshness can expire or be revoked before the authoritative commit.
- A delete-on-config-removal reconciler: configuration drift must not silently remove the last operator.
- Campaign events for entitlement changes: account administration is not campaign-domain activity.

## Acceptance

- Memory and PostgreSQL parity covers reauthentication binding, commit-time freshness, entitlement idempotency,
  zero-side-effect denials, create/revoke serialization, mutual operator revocation, lifecycle protection,
  export redaction, migration backfill, and operator reconciliation.
- Route tests cover hidden 404 behavior, exact mutation security, provider-specific reauthentication, session
  rotation/socket closure, stable error codes, session/meta additions, and deletion-grace boundaries.
- Browser tests cover creator explanation, focused operator controls, and a clear reauthentication journey.
- Migration, role, readiness, backup/restore, mutation, full Hub, and disposable real-stack gates pass before
  enablement.
