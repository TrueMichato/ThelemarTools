# ADR 0017: Atomic DM item-award batches

Status: Accepted and implemented for the V2-T4 DM award slice (2026-09-03)

## Context

Campaign Hub already has canonical character inventories, authoritative party inventory, escrowed transfers,
idempotency receipts, per-campaign event sequencing, audit snapshots, projection invalidation, and Character
Sheet reconciliation. The old DM grant form called a single-character route with a browser-supplied item object.
Repeating that call for multiple recipients would permit partial awards, repeated stash debits, duplicate events,
and misleading carry previews.

The award UI also needs four sources with different trust boundaries:

- the browser-lazy 5etools catalog;
- recent authorized award events;
- the active campaign brew bundle;
- an authoritative party-inventory stack.

The BFF must not load the full 5etools item catalog. Conversely, it must not accept rich arbitrary JSON merely
because the browser labels it as catalog content. Carry data is projection-scoped, can be stale or intentionally
unavailable, and cannot be reconstructed from hidden peer state.

## Decision

### One command and one outcome

`POST /api/campaigns/:campaignId/item-awards` is one DM/co-DM command. Its request contains:

- one source: `catalog`, `recent`, `campaign_item`, or `party_inventory`;
- one to 50 ordered, unique, active campaign character UUIDs;
- one safe integer quantity from 1 through 100,000, applied to every target;
- an optional note of at most 500 characters.

The ordered target list is part of the command identity. Success returns targets in that same order. Any invalid,
ineligible, missing, oversized, unsafe, or insufficient input aborts the complete batch before a canonical write,
audit row, event, outbox row, or receipt is committed.

The `Idempotency-Key` and normalized command fingerprint identify the whole batch. An exact retry returns the
stored response, including award, entry, revision, and event identities. Reusing the key for another normalized
command fails. PostgreSQL serializes the receipt first, then locks target characters in sorted UUID order and the
campaign party inventory through the existing lock classes. The memory store stages every target and optional
stash mutation before publishing them and relies on single-threaded command execution plus the same receipt
contract.

The browser retains a failed attempt's key against that same normalized command body, including ordered target
IDs. Incidental form controls and whitespace that normalize away cannot rotate the key, while any source,
ordered-target, quantity, or note change must mint a new key before another request is sent.

### Item trust and normalization

Catalog, recent, and campaign-item requests accept only this bounded summary:

`name`, `source`, optional `page`, `rarity`, `weight`, `value`, `typeCode`, and `edition`.

Unknown keys, invalid types/ranges, control text, HTML-like content, handler-like text, and executable URL schemes
are rejected. `name` and `source` are required and normalized. This preserves the source identity and useful
display/carry metadata without sending entries, renderer content, callbacks, or the full catalog to the BFF.

A party-inventory request supplies only its stack entry UUID. The server reads and locks that stack, validates
the total debit (`quantity * target count`), removes it once through the transfer inventory primitives, and
splits transferable metadata into each destination. Browser-supplied stash item content is never trusted.

### Canonical mutation, audit, and events

The transaction:

1. validates the actor, membership, targets, source, normalized quantity/note, and receipt;
2. stages all destination inventory merges and removes stale `data.carry` authority;
3. stages the one optional stash debit;
4. validates every resulting character against cloud size/safety limits;
5. writes one `item.award_batch` audit snapshot;
6. emits one `item.granted` fact followed by one `character.projection.invalidated` event for each target in
   request order;
7. emits one final `party_inventory.invalidated` event when the stash changed;
8. stores the response receipt and commits.

`item.granted` is visible only to the actor/DM policy and that character's owner. Its payload carries the shared
`awardId`, deterministic target index/count, source kind, bounded note, and safe granted entry. The batch audit
is administrative evidence; there is no additional broad event exposing the recipient list.

### Preview and live reconciliation

Carry preview is advisory. It uses only the caller's authorization-scoped projection and published item weight:

- `known`: exact current authorized summary and exact added weight;
- `lower_bound`: the authorized current summary is explicitly indeterminate;
- `unavailable`: carry context or item weight is unavailable;
- `policy_blocked`: reserved for an authoritative policy denial.

The browser never infers a hidden value and never presents unavailable context as an exact post-award load.
Mutation success does not recompute carry; it invalidates stale carry authority.

An open owner Character Sheet treats `item.granted` as an authoritative inventory edge and schedules the existing
HTTP repository reconciliation. Stable event/revision handling prevents duplicate application and preserves
disjoint unsaved local edits. Reconnect and next-load canonical fetches cover offline recipients. Signed-out,
local, detached, and non-owner sheets do not attach this integration.

## Consequences

- Multi-recipient and stash-backed awards are all-or-nothing and retry-safe.
- Memory and PostgreSQL expose the same normalized request, response ordering, audit, and event ordering.
- The catalog remains a static browser concern; the BFF receives only a strict summary.
- Preview can be incomplete without becoming a privacy leak or mutation blocker.
- Existing single-character item grants remain compatible but now use the same safe item normalization.
- Campaign source/edition enforcement remains a separate ADR 0015 policy slice; this command already provides the
  authoritative boundary where that policy will be rechecked.
