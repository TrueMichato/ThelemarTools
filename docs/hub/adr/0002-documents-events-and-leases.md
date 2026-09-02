# ADR 0002: Canonical documents with audit, domain events, and an outbox

Status: Accepted for implementation

## Context

The character sheet is a large imperative object and is not suitable for a full event-sourcing rewrite.
Nevertheless, multiplayer actions need ordering, idempotency, replay, and durable audit. Multiple devices
also require stale-writer protection.

## Decision

- Canonical state lives in ordinary versioned documents/tables.
- Each authoritative mutation transaction updates canonical state and appends:
  - a security/admin audit entry when relevant;
  - a domain event for client-visible behavior;
  - a transactional outbox row for fanout.
- Character and DM-workspace writes use an aggregate `revision`.
- One device holds a time-limited edit lease.
- Every lease grant/takeover receives a monotonically increasing fencing `epoch`.
- Every client write requires `baseRevision`, `leaseEpoch`, and `clientMutationId`.
- Old epochs are rejected even if the old device reconnects with queued writes.
- Idempotent retries return the previously committed result.
- Whole stale snapshots are never merged automatically.

Owner edits are path patches derived from the last accepted snapshot. Structured server commands (grants,
transfers, and ADR 0012 versioned character operations) update canonical state semantically. DM/co-DM character
operations apply in their creation transaction; source-derived peer operations require explicit target-owner
approval. Generic overlap handling remains for opaque writes, while operation-aware Character Sheet rebase is
specified separately by ADR 0012.

## Consequences

- Audit/outbox tables must exist before the first cloud mutation.
- A lease is not sufficient without fencing.
- Offline player character editing is read-only in V1.
- Event delivery can be retried independently of the canonical transaction.
- Event replay retention and immutable audit retention are separate policies.

## Proof

The memory/PostgreSQL authorities and their Jest/real-stack suites demonstrate:

- stale-device fencing after takeover;
- revision conflict detection;
- idempotent retry;
- one event/outbox record per mutation;
- disjoint owner rebase over a DM XP grant.
- stable command/operation/event identity and mutated-body rejection;
- immediate DM/co-DM semantic application and explicit peer proposal resolution;
- one atomic character revision, applied event, outbox row, and owner/DM operation watermark.

PostgreSQL transactions are the production authority. Character Sheet operation-aware live rebase remains the
client-side proof owned by ADR 0012.
