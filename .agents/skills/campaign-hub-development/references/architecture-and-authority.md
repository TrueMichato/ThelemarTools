# Architecture and authority

## System map

| Concern | Browser/client | BFF/shared authority | Persistence/tests |
|---|---|---|---|
| API/security | `js/hub/hub-api-client.js` | `server/src/app.js`, `security.js` | `HubServerApp`, `HubAuthorizationMatrix`, `HubRouteContract` |
| Production startup | — | `server/src/index.js` | PostgreSQL readiness/migration tests |
| Characters | `hub-http-character-repository.js` | validation, projection, semantic helpers | both stores; migration `0001`, `0004`, `0005`, `0007` |
| DM workspaces | `hub-http-dm-workspace-repository.js` | workspace routes | both stores; workspace repository tests |
| Realtime | `hub-realtime-client.js` | `server/src/realtime.js`, `projections.js` | event/outbox tables and realtime tests |
| Rules/content | campaign context/rules/content modules | campaign rule/content authority | both stores; immutable `rules_versions` |
| Inventory/actions | inventory, award, source-cost modules | semantic/carry/item authority | both stores; transaction/parity tests |
| Identity/lifecycle | auth providers and Hub pages | provider registry/OAuth/lifecycle routes | migrations `0002`, `0006`; lifecycle/provider tests |

Production always uses `PostgresHubStore`. Treat `MemoryHubStore` as an executable contract double that must
match PostgreSQL, not as proof of database transaction correctness.

## Mutation checklist

For every new or changed mutation, locate and verify:

1. exact route schema and authorization in `server/src/app.js`;
2. stable capability/protocol gate and error shape;
3. validation before mutation and revalidation inside the authoritative transaction;
4. whether this is a durable command/receipt-backed flow and, if so, its idempotency key and request hash
   semantics;
5. aggregate and advisory/row lock order;
6. canonical write plus audit/event/outbox/receipt ordering;
7. matching memory and PostgreSQL results, including rejected writes;
8. lifecycle cancellation/cleanup;
9. privacy-shaped response, event, log, and metric labels;
10. exact retry, concurrent winner, stale-version, and rollback behavior.

Durable lifecycle, document, policy, inventory, transfer, award, and semantic-operation commands use
`getIdempotencyKey()` and a command receipt where their store contract requires one. Scope review findings to
those receipt-backed flows. Current explicitly ephemeral control paths still use the common mutation-security
prehandler but do not create receipts:

- `POST /api/logout`;
- character lease acquire/release;
- DM-workspace lease acquire (there is no separate release route in the current API).

Account session revoke/revoke-others, account deletion request/cancel, member removal, campaign leave/archive,
and ownership transfer are durable commands and do pass idempotency identity to the stores. Reverify
`server/src/app.js` and both store implementations before extending either list.

Do not edit an applied migration. Add the next immutable checksummed migration and propose the matching
migration-policy change alongside readiness, roles, tests, rollback compatibility, and records. The author must
justify `phase` and `previousAppCompatible` against the real prior application; operator review, not the author's
assertion, clears that release gate.

## Document writes

- Characters and DM workspaces are canonical versioned documents.
- Writes require base revision, held lease, and monotonic lease epoch.
- The client retains the accepted base for each in-flight write and performs explicit disjoint rebase or conflict
  recovery. It must not promote an unacknowledged snapshot to the base.
- A transport-failed owner write remains a local recovery draft. Reconnect/refocus refetches canonical truth:
  disjoint drafts retry, while overlapping paths use the explicit local/server recovery flow. Client-only save
  timestamps are excluded from overlap detection. `Use Local` preserves the actual local candidate, except that
  server-owned inventory and XP paths retain their stricter server-wins overlap policy.
- Persist the hash-significant PATCH body and rules-version pin before submission. Transport retries reuse that
  exact body and idempotency key; a confirmed revision conflict may rebase only after rotating and durably storing
  a new key. Never advance a later queued base without coherently rebasing its snapshot, because that turns stale
  XP/inventory into local removal intent.
- Choosing server conflict truth updates accepted, live, latest-submitted, and visible Character Sheet state
  inside the same serialized and generation-fenced mutation before queued realtime delivery resumes. A covered
  event remains suppressed, and a genuinely newer queued operation cannot be overwritten by stale caller
  adoption.
- Recovery for a create without a canonical response remains keyed by the temporary id. Startup may migrate it
  through an owner-visible matching `clientImportId`, or list it as a recovery-only draft when no server row
  exists; both discovery paths validate the stored owner before hydration and preserve the original create
  idempotency key. Persist first-command intent, and never expose or replay established-character patch recovery
  as a replacement create. Canonicalization must also rebind Character Sheet identity, URL/roster, projections,
  and realtime before queued canonical events resume. Publish a temporary-to-canonical alias only after its
  pending queue is durably migrated; on storage failure, retain the temporary in-memory/durable queue with its
  original keys and activities. Remove obsolete pending aliases only after hydration, migration, or replay
  succeeds. A matching canonical row proves the create portion committed: replay later deltas from the original
  create snapshot as their base, rather than diffing that stale snapshot directly against current canonical truth.
- Access loss, takeover, campaign switch, detach, logout, or terminal page hide fences queued callbacks and
  pending saves.
- Durable recovery format 3 stores the exact PATCH body and rules-version pin used with each idempotency key.
  Legacy activity commands that cannot prove that exact request are quarantined locally and remain exportable;
  never reconstruct under the old key or rotate to a new key, because either path can lose or duplicate the
  one-shot event. Quarantine installs a save block so newer commands cannot accumulate; explicit server adoption
  refetches canonical truth, durably clears the queue, and adopts every repository/page track inside the serialized
  mutation. Activity-free legacy commands may rotate keys only after the replacement recovery envelope is durably
  stored. A legacy `pending` state is not proof of non-submission; require the later rules-pin marker too.

Primary sources: `docs/hub/architecture.md`, ADR 0002, `hub-http-character-repository.js`, and the character/
workspace repository tests.

## Realtime and projections

- Domain events and outbox rows are committed with authority state. WebSockets deliver already-committed facts.
- Backward activity requests are fenced by the authorization generation which started them. If role or projection
  authority changes, replace the visible window and discard older in-flight pages. Projection invalidation,
  authority reload, and realtime access loss increment that generation synchronously rather than waiting for a
  follow-up authorization fetch. Conceal cached rows and keep paging disabled until the authorized replacement
  succeeds; authorization errors keep the fence latched.
- The projector has three outcomes: `owner_truth`, `dm_truth`, and recipient-independent `peer_profile`.
- `character.projection.invalidated` contains metadata only. Consumers batch/coalesce invalidations, refetch the
  authorization-scoped projection over HTTP, sequence-fence responses, and replace the prior view.
- Never send projected fields in invalidation/resync payloads or merge fragments from different authorization
  scopes.
- Replay may return zero visible rows while `hasMore` is true. Continue with `scannedThroughSequence`.
- On reconnect or resync, replay to the raw cursor, refetch the complete authorized projection, and apply it only
  if the campaign/access generation and request sequence still match.
- Revocation or role/access loss closes the client and makes previously loaded private state inaccessible.

Primary sources: ADR 0011, `server/src/character-projection.js`, `server/src/realtime.js`,
`js/hub/hub-realtime-client.js`, `docs/hub/event-catalog.md`.

## Semantic operations and ordering

- Stable `commandId`, `operationId`, `eventId`, and source/target/combined leg identity prevent duplicate work.
- Generic operation kinds are DM/co-DM/internal authority only. Player proposals select a server-owned source,
  template, choice, and opaque target reference.
- Cost-bearing proposals reserve and consume nothing. Acceptance rederives under current authority and changes
  source and target together, or neither.
- Distinct source/target locks use stable character-id order; self-targeting writes one combined revision.
- Expected stale/unavailable outcomes are privacy-shaped terminal results. Infrastructure failure rolls back
  rather than pretending to complete.
- Character Sheet reconciliation uses operation-aware `B/L -> R/F` transforms and per-leg coverage. Unknown
  coverage triggers serialized resync, not guessed mutation or a generic conflict modal.

Primary sources: ADR 0012, ADR 0016, `server/src/semantic-operation-registry.js`,
`peer-source-cost-authority.js`, both stores, and `js/hub/hub-character-operation-reconciler.js`.
