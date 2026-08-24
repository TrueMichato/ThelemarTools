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
transfers, accepted effects) update canonical state semantically. Disjoint local patches may be rebased after
a server command; overlapping paths require recovery/conflict UI.

## Consequences

- Audit/outbox tables must exist before the first cloud mutation.
- A lease is not sufficient without fencing.
- Offline player character editing is read-only in V1.
- Event delivery can be retried independently of the canonical transaction.
- Event replay retention and immutable audit retention are separate policies.

## Proof

`HubCharacterMemoryAuthority` and its Jest suite demonstrate:

- stale-device fencing after takeover;
- revision conflict detection;
- idempotent retry;
- one event/outbox record per mutation;
- disjoint owner rebase over a DM XP grant.

This proof is not the production authority; SQL transactions must enforce the same invariants.
