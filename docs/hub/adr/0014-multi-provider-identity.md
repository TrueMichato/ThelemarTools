# ADR 0014: Multi-provider account identity

Status: Accepted for implementation (2026-09-01)

## Context

The Campaign Hub currently has one injected `GitHubOAuthProvider`, two concrete routes
(`/auth/github/start` and `/auth/github/callback`), and a private allowlist keyed by the stable GitHub
numeric subject. The provider returns `{provider, providerSubject, login, displayName}`; the authority looks
up `hub.external_identities` by `(provider, provider_subject)` and creates an internal account when no row
exists. The browser receives only an httpOnly Hub session cookie. This is the singular implementation being
generalized, not a second authentication system.

The schema already separates internal accounts from external identities and uniquely constrains
`(provider, provider_subject)`. It does not yet provide provider registration, identity management routes,
recent-reauthentication evidence, transient OAuth transaction storage, session identity provenance, or safe
link/unlink operations. `pUpsertOAuthAccount` also treats every unknown identity as a new account, which is
correct for the current allowlisted single-provider flow but is not sufficient for explicit account linking.

[ADR 0001](0001-backend-and-sessions.md) requires stable OAuth identities behind the same-origin BFF.
[ADR 0007](0007-lifecycle-deletion.md), the [security model](../security.md), and the
[data lifecycle](../data-lifecycle.md) require sessions, export, deletion, and audit to remain account-scoped.
The private pilot remains allowlisted and campaign invitations remain authorization to join a campaign, not
proof that two provider profiles belong to one person.

## Decision

Introduce an application-owned provider registry and an explicit external-identity lifecycle. Adapt GitHub to
the registry first without changing its public routes or account ids. After that framework has shipped and
been exercised, ship Discord and Google together as one product increment. Their production acceptance and
normal enablement are atomic; each retains an emergency kill switch for provider-specific incidents.

The following rules are normative:

1. Account identity is the internal account id. Login identity is the normalized pair `(provider, subject)`.
2. **Never auto-link by email, verified email, display name, username, or any other mutable profile field.**
3. An existing signed-in user links another provider only through an explicit account-management action with
   CSRF protection, recent reauthentication, one-time state, and PKCE where the provider supports it.
4. An identity already linked to another account is rejected without disclosing that account.
5. An unknown identity may create an account only after the private admission policy accepts that exact
   normalized provider and subject. A campaign invite never bypasses the Hub allowlist.
6. Unlinking, provider disablement, and rollback must not leave an active account without a usable identity.
7. Sessions, account export, account deletion, audit, and revocation operate across every identity linked to
   the internal account.
8. The BFF does not persist provider access tokens or refresh tokens after the callback completes.

This ADR does not implement Discord, Google, credentials, public registration, account merging, enterprise
SSO, recovery codes, or a browser-side authentication SDK.

## Normalized provider identity

Every provider adapter returns this authority-facing value:

```text
{
  provider: lower-case registry slug,
  subject: provider-issued immutable account identifier,
  displayName: bounded mutable presentation text or null,
  handle: bounded mutable provider handle or null
}
```

- `provider` is one of the enabled registry keys. The first keys are `github`, `discord`, and `google`.
- `subject` is a non-empty string of at most 255 characters. It is compared byte-for-byte after the owning
  adapter's documented normalization and is never lower-cased generically.
- GitHub subject is the numeric REST user `id`, serialized as canonical decimal text.
- Discord subject is the user `id` snowflake, serialized as canonical decimal text without conversion through
  a JavaScript `Number`.
- Google subject is the OpenID Connect `sub` claim after issuer, audience, signature, expiry, and nonce
  validation. It is opaque and case-sensitive.
- `displayName` and `handle` may change whenever a provider profile changes. They are metadata, never account
  lookup, authorization, admission, or linking keys.
- Email is not part of the normalized identity. The initial provider scopes should not request email merely
  for account matching.

The persistence column may remain named `provider_subject`; API/domain code should call the value `subject`
at the provider boundary and map it explicitly. Existing GitHub identity rows and internal account ids are
preserved.

## Provider registry and route ownership

The BFF receives a validated registry rather than one `oauthProvider`. Each entry owns:

- a fixed slug and concrete start/callback paths;
- authorization URL construction and exact redirect URI;
- authorization-code exchange;
- declared security capabilities, including PKCE support, confidential-client authentication, and OIDC nonce
  requirements;
- normalized identity extraction;
- bounded scopes and provider-specific response validation;
- configuration health and an emergency enabled flag.

The application registers concrete routes from the validated registry:

```text
GET /auth/github/start       GET /auth/github/callback
GET /auth/discord/start      GET /auth/discord/callback
GET /auth/google/start       GET /auth/google/callback
```

There is no catch-all callback which guesses a provider from untrusted query data. Unknown or disabled
providers return 404 before creating an OAuth transaction. The callback invokes only the adapter bound to its
route, and the adapter's returned provider must match that route and transaction.

The existing GitHub scopes remain `read:user`. Discord starts with `identify`. Google starts with
`openid profile`; email scope is not required. Each provider uses the authorization-code flow. GitHub uses
S256 PKCE. Google uses S256 PKCE plus OIDC nonce validation. Discord uses the confidential-client
authorization-code flow with state/cookie correlation, exact redirect URI, client authentication, and
one-time transaction/code handling. PKCE is enabled for Discord only if its official documentation and a live
acceptance probe demonstrate support before production enablement; the registry must not pretend all providers
have the same capabilities.

## Admission and sign-in

Callback resolution is ordered and transactional:

1. Validate and atomically consume the OAuth transaction, including route provider, operation, browser cookie,
   expiry, state, redirect URI, and adapter-declared PKCE verifier or OIDC nonce where applicable.
2. Normalize and validate the provider identity.
3. If `(provider, subject)` already exists, sign in to its internal account unless the transaction is a link
   for a different account.
4. If the identity is unknown and the transaction is a normal sign-in, require
   `HUB_ALLOWED_OAUTH_SUBJECTS` (or its future policy implementation) to contain the exact
   `provider:subject`, then create the account and identity in one transaction.
5. If the identity is unknown and the transaction is a link, require the link intent's account/session,
   recent reauthentication, and the same private admission policy, then attach it to that account.
6. If the identity belongs to another account, return the stable conflict `IDENTITY_ALREADY_LINKED`. Do not
   reveal the owner, email, display name, or account existence beyond the conflict.

The existing campaign-invite fragment may survive the OAuth round trip as it does now, but redemption occurs
only after Hub admission and authentication. Matching an email on another identity does nothing. A user who
signs in with an unlinked but allowlisted provider may therefore create a separate account; the UI must direct
existing users to sign in with a linked identity and use **Link provider** first. Account merging is a
separate, higher-risk decision.

## Account-link lifecycle

### List

`GET /api/account/identities` returns the signed-in account's link ids, provider, bounded presentation
metadata, linked/last-authenticated timestamps, and whether each link is currently usable. It does not return
another account's identities or any provider token.

### Reauthenticate

A link or unlink requires a successful reauthentication on the current session within five minutes.
Reauthentication must use an identity already linked to that account. Its initiation is an authenticated
mutation with exact Origin and CSRF validation; the resulting provider flow is bound to operation
`reauthenticate`, account id, session id, and provider. Success rotates the current Hub session before issuing
recent-reauthentication evidence. Reauthentication never changes identity ownership.

### Link

`POST /api/account/identities/:provider/link-intents` is an authenticated, idempotent mutation. It requires an
active account, exact Origin, CSRF, current protocol, recent reauthentication, and an enabled provider. It
creates a short-lived operation-bound OAuth transaction and returns only the concrete provider start path.

The provider callback attaches an unknown admitted identity to the initiating account under an account lock
and the existing unique `(provider, provider_subject)` constraint. Linking the same identity to the same
account is idempotent. Linking an identity owned by another account is `IDENTITY_ALREADY_LINKED`. A race may
have one winner only and must not create an orphan account.

Successful linking:

- writes `identity.linked` audit with identity id and provider, not subject or profile fields;
- rotates the current session, revokes every other account session, releases their leases, and closes their
  WebSockets using the existing session-revocation path;
- exposes the complete updated identity list to the account;
- does not alter campaign memberships, ownership, characters, or display-name identity.

### Unlink

`DELETE /api/account/identities/:identityId` is an authenticated, idempotent mutation with the same mutation
and recent-reauthentication protections. The reauthentication identity must be different from the link being
removed.

The authority serializes link/unlink for the account and computes usable identities while holding the lock.
An identity is usable only when its provider is enabled and healthy enough to start authentication, its exact
provider-subject remains admitted by private policy, and the link is not being removed. If no other usable
identity remains, return `LAST_USABLE_IDENTITY`. Provider configuration changes run the same preflight across
active accounts before disablement.

Successful unlinking first revokes sessions authenticated through the identity, then rotates the current
session and revokes all other account sessions. It writes `identity.unlinked` audit with identity id and
provider before deleting the link. Historical audit may retain the provider and opaque Hub identity id, but
not the provider subject. An unlink never deletes or changes the upstream provider account.

Link and unlink are blocked while the Hub account is suspended, deletion-requested, purging, or deleted.

## OAuth transaction and schema migration

Implement this as an additive `0004_multi_provider_identity.sql` migration before enabling any new provider:

1. Keep `hub.external_identities.id`, `account_id`, `provider`, `provider_subject`, `created_at`, and
   `UNIQUE (provider, provider_subject)`.
2. Add bounded nullable `provider_handle` and `provider_display_name`, plus non-null `updated_at` and nullable
   `last_authenticated_at`.
3. Add constraints for a lower-case provider slug and a non-empty provider subject of at most 255 characters.
   Validate existing rows before attaching constraints; do not rewrite subjects or account ids.
4. Add nullable `hub.sessions.authenticated_via_identity_id` referencing `external_identities(id)` with
   `ON DELETE SET NULL`, plus an index for identity-scoped revocation. Backfill only where an old session's
   account has exactly one identity; ambiguous provenance stays null.
5. Add `hub.oauth_transactions` with a random-state hash, provider, operation
   (`sign_in`, `reauthenticate`, or `link`), optional initiating account/session, optional PKCE verifier,
   optional OIDC nonce, exact redirect URI, bounded return path, expiry, consumed timestamp, and creation
   timestamp.
6. Constrain account/session presence by operation, uniquely index the state hash, index expiry for bounded
   cleanup, and cascade transient transactions with an initiating account/session.
7. Grant the runtime role only the CRUD required for these rows. Backup/export handling follows the existing
   least-privilege roles.

Only a hash of the random state is durable. The raw state is correlated with a Secure, httpOnly, SameSite=Lax,
`__Host-` cookie. A PKCE verifier or OIDC nonce required by an adapter is a transient BFF secret, retained for
at most ten minutes and removed by atomic consumption or bounded maintenance. Authorization codes, access
tokens, and refresh tokens are never stored.

Migration and deployment order is:

1. apply the additive migration;
2. deploy the provider registry with only the GitHub adapter enabled and preserve the existing GitHub routes,
   allowlist values, sessions, identities, and account ids;
3. exercise GitHub sign-in, reauthentication, link/unlink invariants, export, deletion, and rollback;
4. deploy Discord and Google adapters disabled, configure exact callbacks and independent credentials outside
   Git, and pass the acceptance suite;
5. enable Discord and Google together.

## Sessions, export, deletion, and audit

Hub sessions remain internal-account sessions. Authorization never depends on which linked provider created a
session. Existing **revoke one** and **revoke all other sessions** actions include sessions created through
GitHub, Discord, or Google. Identity link/unlink reuses the same revocation path so lease release, WebSocket
closure, session list state, and audit cannot diverge.

Account export adds `externalIdentities` containing every link's id, provider, subject, bounded profile
metadata, and lifecycle timestamps, plus session authentication provenance where available. It contains no
provider tokens, OAuth transaction secrets, or identities belonging to another account.

The seven-day account deletion flow:

- allows restricted reauthentication through any linked usable identity for export or cancellation;
- blocks link/unlink once deletion is requested;
- revokes all account sessions regardless of provider;
- deletes all external identities and OAuth transactions during purge;
- retains only the existing anonymized/null actor treatment for audit and campaign integrity;
- never requests deletion of upstream GitHub, Discord, or Google accounts.

Add `identity.linked` and `identity.unlinked` to the security audit catalog. Successful authentication records
the identity id on the created session. Failed callbacks, admission denials, conflicts, and rate limits are
security telemetry, not audit rows attached to a guessed account.

## Threat model

| Threat | Required control |
|---|---|
| OAuth confused deputy or mix-up | Concrete provider routes; transaction binds provider, operation, redirect URI, account/session, and adapter; callback rejects any mismatch |
| Login CSRF | Unpredictable one-time state, browser cookie correlation, ten-minute expiry, atomic consumption, safe same-origin return path |
| Authorization-code interception/injection | Exact registered HTTPS callback and one-time exchange for every provider; S256 PKCE for GitHub/Google; confidential-client authentication and one-time transaction/code handling for Discord; no code/token logging |
| Account takeover through linking | Existing linked-identity reauthentication, CSRF-protected link intent, operation-bound state plus adapter-declared protections, private admission, ownership uniqueness, other-session revocation |
| Email or profile takeover/change | Email is neither stored as identity nor used for lookup/link/admission; mutable handle/display name cannot change `(provider, subject)` |
| Cross-account link race | Identity-key and account locking plus unique `(provider, provider_subject)`; loser receives non-enumerating conflict and no orphan account |
| Last-login removal | Locked usable-identity count on unlink and provider-disable preflight; no rollback to software which cannot serve the remaining identity |
| Stolen session | Recent provider reauthentication for link/unlink; session rotation; revoke other sessions, leases, and sockets |
| OAuth transaction replay | State hash is unique and atomically consumed; cookie, route, operation, account/session, expiry, and adapter-required PKCE/nonce are checked; Discord authorization codes are one-time |
| Provider outage or compromise | Per-provider emergency disable; existing Hub sessions remain governed by normal expiry/revocation unless incident response requires global revocation |

The no-email-link rule is absolute even when a provider asserts `email_verified=true`. Recovery from accidental
duplicate accounts or loss of every provider is an operator-reviewed future workflow, not a reason to weaken
the callback.

## Secrets, configuration, and rotation

Provider credentials are independent secret-manager values, never committed configuration. Enabled registry
entries fail startup when required client configuration is absent, when callback origins differ from
`HUB_APP_ORIGIN`, or when a route/slug is duplicated. Provider consoles use exact HTTPS callback URLs without
wildcards.

Rotation is provider-by-provider:

1. create the replacement credential or provider application without exposing the value;
2. register the same exact callback and minimum scopes;
3. update the BFF secret/config and restart;
4. pass start/callback, state, declared provider-capability, allowlist, session rotation, and redacted-log
   probes;
5. revoke the prior credential only after success.

If a provider supports only one active secret, use a parallel provider application or a short announced login
maintenance window; do not log or commit an old/new secret pair. Rotating Hub cookie/state protection
invalidates in-flight OAuth transactions and may require sign-in again, but does not relink identities.
Compromise of one provider credential triggers that provider's kill switch, callback review, relevant session
revocation based on incident scope, and the existing [secret rotation](../runbooks/secret-rotation.md),
[session compromise](../runbooks/session-compromise.md), and incident procedures.

## Rate limits and redacted observability

Apply both client-address and bounded provider/account dimensions:

| Surface | Initial limit |
|---|---:|
| Provider sign-in start | 10/minute/address/provider |
| Provider callback | 20/minute/address/provider |
| Reauthentication or link intent | 5/minute/account/provider |
| Unlink | 5/minute/account |
| New-account creation | 5/hour/address across providers |

Limits return the normal stable error envelope and `Retry-After`. Provider is a registry-bounded label; subject,
email, account id, OAuth state/code/verifier/nonce, provider tokens, cookies, identity profile, and response
bodies are never metric labels or log values. Request logs continue to strip query strings. Metrics may count
start/callback/link/unlink outcomes by fixed provider and bounded outcome (`success`, `invalid_state`,
`not_allowed`, `already_linked`, `rate_limited`, `provider_error`) without recording identity material.

Alert on sustained callback/provider errors, state replays, cross-account link conflicts, and rate-limit
surges. Do not alert with raw provider responses. Operator correlation uses request id plus internal OAuth
transaction/identity ids, not subject or email.

## Rollback

The additive migration is not rolled back destructively. Before Discord/Google enablement, the singular
GitHub implementation may be restored because existing rows and routes remain compatible. After either new
provider has created a sole usable identity, rollback to the pre-registry BFF is forbidden.

The supported post-enable rollback target is the last provider-registry image with GitHub working. Disable
Discord and Google together only after a database preflight proves every active account retains another usable
identity. If that is false, keep the required adapter online or roll forward with a fix. Never delete links,
merge accounts, rewrite subjects, or auto-link by email to make rollback appear successful.

Emergency disabling of one compromised provider is allowed even though normal Discord/Google product
enablement is paired. Existing sessions may remain active when the provider is merely unavailable; a security
incident can revoke sessions through the account-scoped mechanism. Restore the provider only after exact
callback, secret, state, declared provider-capability, and redacted-observability probes pass.

## Acceptance tests

Implementation is not accepted until automated tests cover:

1. registry rejection of duplicate slugs/routes, unknown adapters, enabled providers with missing config, and
   mismatched callback origins;
2. unchanged GitHub start/callback paths, numeric-subject allowlist behavior, S256 PKCE, safe return paths,
   existing identity/account ids, and session-cookie semantics;
3. concrete Discord and Google paths, minimum scopes, exact redirect URI, Discord snowflake handling without
   numeric precision loss, Discord confidential-client authentication and one-time transaction/code handling,
   no Discord PKCE parameters unless official documentation and a live probe prove support, and Google S256
   PKCE plus complete OIDC issuer/audience/signature/expiry/nonce validation;
4. disabled/unknown provider 404 behavior before transaction creation;
5. state cookie correlation, expiry, single consumption, callback replay refusal, provider/operation/redirect
   binding, callback swapping, adapter-capability enforcement, GitHub/Google PKCE failure, Google OIDC nonce
   failure, and Discord client-authentication/code-replay failure;
6. normalization of GitHub, Discord, and Google subjects while mutable handle/display-name changes preserve
   identity ownership;
7. explicit proof that equal or changed emails never link, merge, admit, or select an account;
8. unknown sign-in denial outside the exact provider-subject allowlist, including a valid campaign invite,
   plus allowed first-account creation in one transaction;
9. link initiation refusal without authentication, active status, exact Origin, CSRF, protocol, idempotency,
   recent reauthentication, provider admission, or provider availability;
10. link success to the initiating account, same-account idempotency, cross-account
    `IDENTITY_ALREADY_LINKED`, concurrent one-winner behavior, and no orphan account;
11. link success audit, current-session rotation, other-session/lease revocation, WebSocket closure, and
    unchanged campaign/character ownership;
12. unlink refusal when reauthenticated by the target identity, when it is the last usable identity, or while
    account deletion is pending;
13. unlink success audit-before-delete, identity-created session revocation, all-other-session revocation,
    current-session rotation, lease release, socket closure, and no upstream account mutation;
14. provider-disable and deployment rollback preflight for accounts with GitHub-only, mixed, and sole
    Discord/Google identity sets;
15. account identity listing isolation and absence of provider tokens;
16. account export containing every linked identity and session provenance, with no foreign identity or
    OAuth/provider secret;
17. deletion-grace reauthentication through every linked provider, link/unlink freeze, all-provider session
    revocation, purge of every identity/transaction, and anonymized retained audit;
18. per-address/provider/account rate limits, bounded `Retry-After`, and non-interference between unrelated
    accounts;
19. logs/metrics under success, denial, provider errors, replay, link conflict, unlink, and deletion containing
    no subject, email, code, verifier, nonce, token, cookie, state, or profile body;
20. additive migration from the current GitHub-only schema, ambiguous session-provenance backfill, runtime-role
    grants, maintenance cleanup, fresh install, rollback-compatible GitHub boot, and no account-id/subject
    rewrite.

Discord and Google must pass this shared matrix in the same release candidate before normal production
enablement. A provider-specific happy-path test is not a substitute for the cross-provider ownership,
lifecycle, and rollback tests.

## Consequences

- Users can add login resilience without changing their internal account, campaign memberships, or owned data.
- Provider outages and credential rotation become isolated operational events.
- Identity management becomes a security-sensitive mutation surface with additional schema, rate limiting,
  audit, UI, maintenance, and test responsibilities.
- Private allowlisting remains explicit per provider subject; adding providers does not broaden registration.
- Users must understand that signing in with an unlinked provider can create a separate account when that
  identity is admitted. This inconvenience is accepted instead of risking account takeover.
- The registry framework must remain deployable with GitHub alone, but Discord and Google are not released as
  separate partial product increments.

## Rejected alternatives

- **Auto-link verified matching email:** provider email ownership and change semantics differ, and compromise of
  one mailbox/provider would become Hub account takeover.
- **One generic callback which trusts a provider query parameter:** vulnerable to confused-deputy/mix-up errors
  and harder to configure or audit safely.
- **Use provider user names as subjects:** names are mutable and reassignable.
- **Independent Discord-first or Google-first release:** creates two transition states and invites
  provider-specific lifecycle gaps. They ship together after the framework.
- **Store provider access/refresh tokens for convenience:** the Hub needs authentication, not long-lived access
  to provider APIs.
- **Automatic account merging:** ownership, campaigns, audit, deletion, and conflict recovery need a separate
  reviewed design.
- **Disable the last provider during rollback:** strands users and violates the identity lifecycle invariant.
