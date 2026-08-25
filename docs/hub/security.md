# Campaign Hub security model

> **Status:** Implemented private-V1 controls; managed deployment review pending
> **Last verified:** 2026-08-25
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
  idempotency key.
- WebSocket upgrades require same origin, session, active membership, and protocol version.
- Event visibility is enforced server-side (`all_members`, `dm_only`, `actor_and_dm`,
  `explicit_accounts`) before replay or broadcast.
- Every campaign-owned foreign-key relationship uses `campaign_id` in its database constraint.
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
  HTTP rate limits, and WebSocket context; IPv6 rate-limit keys retain the plugin's `/64` normalization. Live
  staging must still prove DigitalOcean overwrites client copies before ADR 0009 is accepted.

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
- Provider-native alerting/PITR and production restore evidence remain Phase 6G launch work.
- Exactly one BFF replica is supported; private V1 accepts application restart/deploy downtime until shared
  realtime fanout exists.
