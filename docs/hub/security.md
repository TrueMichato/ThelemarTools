# Campaign Hub security model

> **Status:** Implemented private-V1 controls; managed deployment review pending
> **Last verified:** 2026-09-20
> **Owner:** Campaign Hub maintainers

## Trust boundaries

- Browsers and all client-supplied JSON are untrusted.
- The same-origin BFF authenticates the httpOnly session cookie and authorizes every HTTP/WebSocket action.
- PostgreSQL is canonical; client snapshots never overwrite state without revision and fencing checks.
- Campaign homebrew is DM-authored but still untrusted content.

## Controls implemented

- OAuth authorization uses a validated concrete-route provider registry, PKCE according to adapter capability,
  signed browser correlation, hash-only expiring state, atomic one-time transaction consumption, exact redirect
  binding, invite-gated first-account admission, and same-origin return paths.
- Existing identities sign in by immutable `(provider, subject)`. Unknown identities are not admitted by provider
  subject: they require ADR 0018's valid five-minute campaign-invite context and the default-off new-account
  admission switch.
- The raw invite is sent once in a same-origin POST body. A random server-side context is bound to one provider,
  OAuth transaction, transaction-specific signed correlation cookie, redirect, and state. It never enters `returnTo`, OAuth
  state, cookies, referrers, logs, or browser history.
- Each concurrent start has its own cookie name and state-selected transaction, so two empty-jar starts survive
  the browser's final merged cookie jar. Failed, cancelled, or abandoned navigation may rotate a separate
  hash-only opaque retry handle into a new same-provider context only when the old transaction cookie is present;
  the original context is never rebound.
- Authentication authority is `(provider, immutable subject)`. Email and mutable profile fields are discarded
  before store lookup and cannot link, admit, merge, or select an account.
- Authorization codes and provider access/refresh tokens are never persisted. The callback-local access token is
  discarded after identity lookup; consumed state, PKCE verifier, and nonce values are cleared immediately.
- Provider HTTP uses fixed HTTPS endpoints, rejects redirects, times out after five seconds, and caps decoded
  token/profile JSON at 32 KiB and Google JWKS at 64 KiB. Google accepts only RS256 tokens with either official
  issuer, `accounts.google.com` or `https://accounts.google.com`, for the configured audience, with bounded
  `exp`/`iat`, exact nonce, and opaque `sub`; Discord retains its decimal snowflake as text.
- A failed or misconfigured adapter exposes only bounded provider status/error codes and cannot disable a healthy
  sibling. No upstream body, token, profile, subject, or credential is logged or returned.
- Sessions use random tokens stored only as SHA-256 hashes; successful reauthentication revokes the prior
  browser session. New sessions record same-account external-identity provenance without changing campaign
  authorization.
- Reauthentication starts only as an authenticated exact-Origin/CSRF/current-protocol mutation. Its OAuth
  transaction is bound to the current account, current session, operation, and concrete provider. The callback
  accepts only an identity already linked to that account, rotates the session, closes the old socket, records
  the exact identity provenance, and timestamps freshness at commit.
- `campaign:create` and `platform:operate` are internal-account entitlements. Provider subject, email, handle,
  login, display name, and campaign membership role are never creator/operator authority. Sensitive store
  transactions recheck the <=5 minute freshness window and last-operator invariant under locks.
- Invite tokens are cryptographically pseudorandom under an independent versioned key ring. Derivation is bound
  to actor, campaign, idempotency key, and normalized request hash. The invite table and command receipt store no
  raw token. Exact replay tries the current key then at most three retained prior keys and returns a token only
  when its hash matches the stored invite hash; otherwise it fails closed. Invite-context and OAuth transaction
  row data are excluded from backups.
- First access commits account, identity, session, membership, invite use, account/invite audit, membership event,
  and outbox atomically. Provider failure, cancellation, expiry, revocation, exhaustion, replay, a lost max-use
  race, or session-write failure commits none of them.
- Mutations require exact Origin, CSRF HMAC, protocol version, payload schema, role permission, and
  idempotency key. Reads whose response is an authorization envelope also require the protocol version, so an
  older client is told to update rather than silently misreading a newer shape.
- Operator routes are hidden from non-operators with route-equivalent 404 responses. Entitlement changes are
  account-audit-only and never emit campaign domain events or outbox rows. Exact idempotent replays and already
  active/revoked no-ops do not duplicate audit.
- Character reads cross the trust boundary through one server-owned projector
  ([ADR 0011](adr/0011-authorization-scoped-character-projections.md)). Peer values are derived into a typed,
  closed catalog rather than copied from the document, so a new document field cannot become shared by
  accident. A policy that fails validation fails closed and is indistinguishable from `private`; the server
  never falls back to a more permissive preset.
- Projection invalidation events are metadata-only. The durable event, outbox, live fanout, replay and resync
  paths carry no character field, patch, path, amount, field name, display text or name snapshot; logging and
  metrics record projection kind, revisions and failure code only.
- No shared (`all_members`) event payload carries a canonical character name or an owner association. A durable
  event cannot be rewritten, so a name captured in one would survive an owner later choosing a narrower policy;
  shared activity derives its labels from the current peer-visible projection instead. Name snapshots remain on
  targeted events, whose audience is already authorized for that character.
- Spell-use activity is explicit, never inferred from character patches. Its closed payload contains only the
  bounded spell name/source, spell and slot levels, and a cast-mode enum; it excludes spell text, targets,
  component selections, slot totals, resource names/values, document paths, and arbitrary JSON.
- Character recovery never blindly replays that one-shot activity after the server's idempotency evidence may
  have expired. The browser persists an immutable 23-hour activity deadline with the exact command; expiry or
  missing deadline proof quarantines the complete queue behind export/use-server resolution. Canonical document
  equality never suppresses activity after revision conflict because the server checks receipts before revision.
- A poisoned PATCH for a character the server confirms no longer exists cannot silently retain or resurrect its
  private local live state. Resolution exports the complete queue first, then conceals the inaccessible character
  under a fresh local identity and clears recovery/reconciliation state; owner-scoped `clientImportId` matching
  and replacement CREATE remain create-only.
- Targeting is authorized on the server, not filtered in the browser. Semantic peers use random target
  references exposed only by an identity-visible profile. Hidden/missing/stale source, target, or eligibility
  fails as `SOURCE_OR_TARGET_UNAVAILABLE` at creation and `PROPOSAL_STALE` at apply, without identifying the
  failed predicate. Transfer targeting retains its non-enumerating not-found behavior.
- Generic semantic `kind`/`arguments` are privileged to DM/co-DM/internal authority. Player effects must resolve
  through a closed server template and explicit target-owner approval, including self-targeting. Protocol-4
  Cure Wounds binds one standard spell slot; the private seed, source-cost binding, resource ids/values, true
  target state, and failed eligibility predicate never enter target/peer projections. Source costs fail closed
  before persistence and are revalidated inside atomic acceptance.
- Semantic creation/resolution revalidates the authenticated session, active account/campaign/membership/role,
  source/target truth, template policy, and approval authority inside one transaction. Stable command ids are
  actor/body bound, and no unsupported/stale operation can partially mutate character/event/outbox state.
- WebSocket upgrades require same origin, session, active membership, and protocol version.
- Event visibility is enforced server-side (`all_members`, `dm_only`, `actor_and_dm`,
  `explicit_accounts`) before replay or broadcast.
- Campaign-owned semantic event linkage uses campaign-scoped foreign keys; historical operation references
  tolerate later character movement while creation/apply revalidate same-campaign truth.
- Character Sheet realtime subscribes only after signed-session campaign activation and canonical character
  load, then filters again by campaign and target character. It strips actor/visibility envelope fields from
  semantic callback values and never logs, persists, or caches lifecycle payloads.
- Socket and subscription generations are both fenced. Access-loss code 1008, character/campaign changes,
  detach, logout, remote archive/move, and non-persisted page hide invalidate queued callbacks before
  they can reach a reopened sheet. BFCache suspension resumes only the same in-memory client generation.
- XP/item recipient notices are derived only after server-side event authorization, deduplicated by event id,
  and reduced again to bounded display fields. Toasts receive text-only DOM content. XP reconciliation refetches
  owner truth; item reconciliation remains on the established inventory path.
- Projection invalidation remains metadata-only on the owner sheet: this layer performs no projection fetch,
  document replacement, operation application, save, render, or generic conflict fallback.
- Character and DM-workspace writes require aggregate revision plus a monotonic lease epoch.
- Inventory transfers reserve source value into escrow and lock source/target in deterministic order.
- Campaign archive refuses unresolved escrow and detaches characters without deleting player ownership.
- API/auth responses are `no-store` and include nosniff, frame denial, same-origin referrer, and restrictive
  permissions-policy headers.
- Database connections and queries have bounded timeouts; idle pool errors are handled.
- Structured request logs strip query strings and redact auth/cookie/CSRF/idempotency fields.
- Structured redaction also covers invite token/context field names. Auth request bodies are never logged.
- Metrics require an independent bearer token and expose aggregate bounded labels only.
- Backup archives are authenticated AES-256-GCM ciphertext; keys are separate from archives.
- Provider client identity is fail-closed: only `do-connecting-ip` can be enabled, it cannot be combined with
  `HUB_TRUST_PROXY`, and only one syntactically valid IP is accepted. The same resolved address keys logs,
  HTTP rate limits, and WebSocket context; IPv6 rate-limit keys retain the plugin's `/64` normalization. Under
  ADR 0010 this adapter stays **disabled**: Caddy is the only ingress, so `HUB_TRUST_PROXY` names its fixed
  private address and `X-Forwarded-For` is trusted from that hop alone. It is re-enabled only if a managed
  provider that injects its own header is adopted.

## Content restrictions

Campaign brew is limited to 1 MB and 100 documents. Uploads reject persistent blocklists, unresolved
dependencies, excessive nesting, `wrappedHtml`, dangerous element strings, and event-handler attributes.
The bundle is canonicalized and content-addressed before persistence.

Character documents are limited to 1.5 MB. Existing Character Sheet feature descriptions may contain
renderer-generated HTML, so the authority sanitizes every character mutation with a fixed tag/attribute
allowlist. Scripts, images, inline styles, event handlers, unsafe URL schemes, and unknown elements are
removed or escaped before the canonical document is stored.

This is deliberately stricter than personal/local homebrew. Relaxing it requires a centralized sanitizer or
sandboxed renderer, malicious fixture corpus, and another security review.

## Accepted V1 limitations

- Client-declared rolls are cooperative evidence, not cryptographically authoritative.
- Private V1 has no public moderation/reporting/billing system.
- Direct database access is restricted to the BFF role; browser database SDKs are not used.
- A formal public-service privacy/ToS review remains a gate before semi-public onboarding.
- Core renderer behavior prevents a strict no-inline-script CSP from being the primary content boundary.
- Oracle uses portable encrypted backups rather than provider-native PITR. Scheduled operations, off-machine
  backup, isolated restore, and exact-release rollback evidence remain the V1 host-operations gate.
- Exactly one BFF replica is supported; private V1 accepts application restart/deploy downtime until shared
  realtime fanout exists.
