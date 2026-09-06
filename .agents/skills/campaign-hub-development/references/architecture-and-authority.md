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
4. idempotency key and request hash semantics;
5. aggregate and advisory/row lock order;
6. canonical write plus audit/event/outbox/receipt ordering;
7. matching memory and PostgreSQL results, including rejected writes;
8. lifecycle cancellation/cleanup;
9. privacy-shaped response, event, log, and metric labels;
10. exact retry, concurrent winner, stale-version, and rollback behavior.

Do not edit an applied migration. Add the next immutable checksummed migration and propose the matching
migration-policy change alongside readiness, roles, tests, rollback compatibility, and records. The author must
justify `phase` and `previousAppCompatible` against the real prior application; operator review, not the author's
assertion, clears that release gate.

## Document writes

- Characters and DM workspaces are canonical versioned documents.
- Writes require base revision, held lease, and monotonic lease epoch.
- The client retains the accepted base for each in-flight write and performs explicit disjoint rebase or conflict
  recovery. It must not promote an unacknowledged snapshot to the base.
- Access loss, takeover, campaign switch, detach, logout, or terminal page hide fences queued callbacks and
  pending saves.

Primary sources: `docs/hub/architecture.md`, ADR 0002, `hub-http-character-repository.js`, and the character/
workspace repository tests.

## Realtime and projections

- Domain events and outbox rows are committed with authority state. WebSockets deliver already-committed facts.
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
