# Campaign Hub security model

> **Status:** Implemented private-V1 controls; managed deployment review pending
> **Last verified:** 2026-09-02
> **Owner:** Campaign Hub maintainers

## Trust boundaries

- Browsers and all client-supplied JSON are untrusted.
- The same-origin BFF authenticates the httpOnly session cookie and authorizes every HTTP/WebSocket action.
- PostgreSQL is canonical; client snapshots never overwrite state without revision and fencing checks.
- Campaign homebrew is DM-authored but still untrusted content.

## Controls implemented

- OAuth authorization uses PKCE, signed/expiring state, stable provider-subject allowlists, and same-origin
  return paths.
- Sessions use random tokens stored only as SHA-256 hashes; successful reauthentication revokes the prior
  browser session.
- Invite tokens are deterministic HMAC values derived from `HUB_CSRF_SECRET`, creator account, campaign, and
  idempotency key so an idempotent retry can reproduce the same raw token while PostgreSQL stores only its
  hash. Compromise/rotation of the CSRF secret therefore also affects invite issuance/recovery.
- Mutations require exact Origin, CSRF HMAC, protocol version, payload schema, role permission, and
  idempotency key. Reads whose response is an authorization envelope also require the protocol version, so an
  older client is told to update rather than silently misreading a newer shape.
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
- Targeting is authorized on the server, not filtered in the browser. Semantic peers use random target
  references exposed only by an identity-visible profile. Hidden/missing/stale source, target, or eligibility
  fails as `SOURCE_OR_TARGET_UNAVAILABLE` at creation and `PROPOSAL_STALE` at apply, without identifying the
  failed predicate. Transfer targeting retains its non-enumerating not-found behavior.
- Generic semantic `kind`/`arguments` are privileged to DM/co-DM/internal authority. Player effects must resolve
  through a closed server template and explicit target-owner approval, including self-targeting. Recognized
  source costs fail closed before persistence and again before application.
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
- Projection invalidation remains metadata-only on the owner sheet: this layer performs no projection fetch,
  document replacement, operation application, save, render, or generic conflict fallback.
- Character and DM-workspace writes require aggregate revision plus a monotonic lease epoch.
- Inventory transfers reserve source value into escrow and lock source/target in deterministic order.
- Campaign archive refuses unresolved escrow and detaches characters without deleting player ownership.
- API/auth responses are `no-store` and include nosniff, frame denial, same-origin referrer, and restrictive
  permissions-policy headers.
- Database connections and queries have bounded timeouts; idle pool errors are handled.
- Structured request logs strip query strings and redact auth/cookie/CSRF/idempotency fields.
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
