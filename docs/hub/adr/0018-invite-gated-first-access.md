# ADR 0018: Invite-gated first account access

Status: Accepted for r9 foundation; account admission remains default-off until the stacked creator-entitlement layer

## Context

The private Hub previously admitted an unknown provider identity through
`HUB_ALLOWED_OAUTH_SUBJECTS`, then redeemed a campaign invite after sign-in. That split made provider identity
configuration an account-creation authority, allowed a failed first login to leave an account without the
campaign which admitted it, and required the browser to carry a raw invite through the OAuth journey.

[ADR 0014](0014-multi-provider-identity.md) remains authoritative for provider-neutral identity, no-email
linking, PKCE/nonce, sessions, and future link/unlink controls. This decision supersedes its admission rule that
campaign invites never bypass the provider-subject allowlist. Existing identities are already Hub accounts and
must continue to sign in without another invite.

Campaign creation is a separate authority. It will move in the next stacked layer to a provider-neutral
account-level `campaign:create` entitlement, backfilled for existing campaign owners and explicitly designated
operator accounts. Grant and revoke administration must be audited and require fresh reauthentication. Provider,
subject, email, handle, and login are never creator authority.

## Decision

### Admission rule

- An existing `(provider, subject)` signs in normally.
- An unknown identity may create its first Hub account only through a valid campaign invite.
- The first successful callback commits account, external identity, session, campaign membership, invite use,
  `account.created` audit, `invite.redeemed` audit, `membership.joined` event, and outbox row together.
- A valid invite context used by an existing identity commits session and membership together before redirect.
  An already-active member succeeds without consuming another invite use.
- Removed or left memberships may be reactivated by a fresh valid invite. Joining any later campaign remains
  invite-only through either this OAuth-bound path or the authenticated invite-redemption route.
- `deletion_requested` accounts may sign in through an existing identity for the restricted cancellation/export
  surface, but cannot redeem an invite. Suspended/deleted accounts receive no session or invite use.

The provider-subject allowlist is retired as default admission authority. The r9 foundation has a separate
`HUB_INVITE_ACCOUNT_ADMISSION_ENABLED` switch, default `false`. It gates only creation of a previously unknown
account; existing-account sign-in and invite redemption remain available. This layer is not deployable with new
account admission enabled until the stacked `campaign:create` entitlement layer and its rollout evidence land.

### Browser and OAuth flow

1. An invite link places the raw token in the URL fragment. The Hub removes the fragment from browser history
   immediately.
2. A signed-out provider choice sends the raw token once in the JSON body of
   `POST /api/auth/invite-contexts`, with exact Origin, current protocol, strict schema, and a per-address limit.
3. The BFF validates the invite and, in one store transaction, creates a random opaque `invite_contexts` row
   and the one OAuth transaction allowed to reference it. The response contains the provider authorization URL
   plus a separate opaque retry handle; no raw invite or context identifier enters return paths, OAuth state,
   cookies, referrers, or history.
4. Each transaction gets a short-lived signed `__Host-hub_oauth-<transaction-id>` cookie. State carries the
   transaction id plus independent entropy, so two starts from an empty shared cookie jar retain both
   correlations. Provider, transaction id, state, redirect URI, and the unique context binding prevent
   cross-provider or non-invite rebinding.
5. OAuth state is consumed before provider exchange as in ADR 0014. Provider cancellation/failure consumes no
   invite use and leaves no account/session/membership. Abandoning navigation also consumes nothing. The bound
   context is not reusable; its hash-only retry handle plus the old transaction-specific cookie may atomically
   replace either a consumed or unconsumed transaction with one fresh same-provider context/transaction while
   the invite remains valid.
6. After provider identity validation, the store re-reads and locks all admission authority and performs the
   terminal commit. Callback replay is rejected by the consumed OAuth transaction and completed context.

The server canonicalizes `returnTo`: only `/hub.html` or `/campaign.html` with an optional valid UUID `id`
parameter survives. Fragments, unknown query keys, and invite/context-shaped keys fall back to `/hub.html`.

### Persistence and locking

Migration `0008_invite_gated_first_access.sql` adds:

- `hub.invite_contexts`, retained for at most five minutes, with a hash-only one-time retry handle;
- one immutable optional `oauth_transactions.invite_context_id` binding;
- terminal account/session/membership identifiers on a consumed context for bounded bootstrap evidence;
- expiry indexes and constraints which prohibit partial terminal outcomes.

The invite table continues to store only `token_hash`. New raw invite tokens are cryptographically
pseudorandom under a dedicated `HUB_INVITE_TOKEN_SECRET`, bound to actor, campaign, idempotency key, and request
hash. The 24-hour creator command receipt contains no raw token; the BFF reconstructs the same token for an exact
retry. Invite listing, events, logs, metrics, exports, and backups never expose it. OAuth transactions and
invite-context row data are excluded from portable backup contents.

PostgreSQL invite authority uses one total lock order:

1. identity advisory/account row when the callback has a provider identity;
2. read the invite only to discover campaign identity;
3. campaign advisory lock;
4. campaign row lock;
5. invite row lock and complete revalidation;
6. membership/session writes.

Creation, revoke, authenticated redemption, OAuth admission, and creator purge follow this order. The memory
store preserves the same outcomes and cleanup semantics. Invalid, expired, revoked, exhausted, replayed, raced,
or deleted-creator credentials use one bounded invalid-admission result and commit no partial authority.

### Lifecycle and privacy

- Invite contexts are removed after consumption/expiry by bounded maintenance and cascade when their invite is
  removed.
- Purging an invite creator removes that creator's outstanding invites and contexts in both stores.
- Expired/revoked invites retain the existing 30-day technical cleanup policy; memory and PostgreSQL match.
- Raw invite/context/OAuth fields are redacted from structured logs. Request logging records route templates,
  never bodies or query strings.
- `account.created` audit records only Hub ids and `{admission:"campaign_invite"}`. It contains no provider
  subject, profile, raw token, token hash, state, context, code, verifier, or nonce.

## Consequences

- Private first access is campaign-sponsored rather than provider-configured.
- A first-login failure cannot create an orphan account or consume an invite.
- Existing users retain normal sign-in and may join an invited campaign during that same callback.
- Multiple tabs retain transaction-specific cookies while state selects the matching transaction, so a later
  start does not overwrite or misapply an earlier tab's invite context.
- Rollback to pre-r9 application behavior after admitting r9-only accounts can strand those accounts. Keep new
  admission disabled until the stacked entitlement/release layer defines and proves the exact rollback gate.
- Migration 0008 is additive and readable by the previous application, but enabling r9 admission is a separate
  application/data compatibility decision.

## Rejected alternatives

- Provider-subject or email allowlists: provider identity is authentication, not admission or creator authority.
- Carrying the raw invite in `returnTo`, OAuth state, cookies, query strings, or session storage: each broadens
  leakage and replay surfaces.
- Browser redemption after account creation: cannot make first account/session/membership creation atomic.
- Account-scoped command receipts for first access: no account exists yet.
- Consuming invite use when minting context or consuming OAuth state: provider failure would burn admission.
- Rebinding one context after a callback/provider/tab failure: weakens correlation and creates confused-deputy
  ambiguity. The retry handle replaces the old context with a new same-provider context instead.

## Acceptance

- Memory and PostgreSQL prove existing sign-in, unknown denial, first-access atomicity, existing-account atomic
  redemption, active-member no-extra-use behavior, removed-member rejoin, status matrix, replay, expiry,
  revocation, exhaustion, max-use races, duplicate-token parity, provider failure, session-insert rollback,
  creator purge, and no-deadlock interleavings.
- Route tests prove exact Origin/protocol/schema, five-minute lifetime, uniform invalid responses, safe
  `returnTo`, provider/tab/transaction binding, no raw-token response/log/URL leakage, and no second browser
  redeem.
- Migration tests prove fresh/upgrade/readiness, policy coverage, runtime/backup role access, and backup
  exclusion.
- The new-account switch remains off until layer 2 implements provider-neutral creator entitlement and records
  its backfill/administration/rollback evidence.
