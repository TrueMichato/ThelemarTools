# Campaign Hub event and audit catalog

> **Status:** Current protocol-v3 catalog
> **Last verified:** 2026-09-02
> **Owner:** Campaign Hub maintainers

## Domain event envelope

| Field | Meaning |
|---|---|
| `id` | Event UUID and outbox uniqueness key |
| `campaignId` | Tenant and ordering scope |
| `sequence` | Monotonic campaign sequence |
| `type` | Stable event type |
| `actorAccountId` | Initiating account, nullable after future deletion |
| `aggregateType` / `aggregateId` | Entity affected |
| `aggregateRevision` | Canonical revision when applicable |
| `visibility` | all_members/dm_only/actor_and_dm/explicit_accounts |
| `visibleAccountIds` | Required only for explicit_accounts |
| `correlationId` | Reserved; not consistently populated in V1 |
| `payload` | Minimal client payload; never assume it is a full aggregate. Character-related events may include bounded `characterNameSnapshot`, `targetCharacterNameSnapshot`, or endpoint snapshot objects with `{version: 1, displayName}`. |
| `createdAt` | Database timestamp |

## Current domain events

| Event | Aggregate | Visibility | Payload/content | Notes |
|---|---|---|---|---|
| `campaign.created` | campaign | all_members | campaign name | First sequence allocated during campaign transaction |
| `campaign.archived` | campaign | all_members | empty | Characters already detached |
| `campaign.ownership_transferred` | campaign | all_members | target account id | Owner/roles changed atomically |
| `invite.created` | invite | dm_only | role, expiry | Raw token is never in event |
| `invite.revoked` | invite | dm_only | empty | Revoke is idempotent |
| `membership.joined` | membership | all_members | account id, role | Invite id remains audit detail, not public payload |
| `membership.role_changed` | membership | all_members | account id, role | Owner-authorized non-owner role change |
| `membership.removed` | membership | all_members | account id, detached character ids | Administrative removal completed |
| `membership.left` | membership | all_members | account id, detached character ids | Voluntary leave/account purge cleanup |
| `character.created` | character | all_members | empty | Full document not emitted; owner association is roster metadata, not an event payload |
| `character.reactivated` | character | all_members | empty | Same scoped import reactivates archived row |
| `character.patched` | character | actor_and_dm | submitted patches | Private owner/DM state event |
| `character.projection.invalidated` | character | all_members | `{projectionRevision}` only | Metadata-only ([ADR 0011](adr/0011-authorization-scoped-character-projections.md)). Carries no character field, patch, path, amount, field name or display text — including no name snapshot. Consumers refetch through the scoped HTTP projector |
| `character.operation.proposed` | semantic operation | explicit proposer+target owner | `{operationId,targetCharacterId,status:"proposed",sourceEntity,effectTemplateId,choice,sourceDisplaySnapshot,targetDisplaySnapshot,effectDisplaySnapshot,expiresAt}` | Stable operation id; DM/co-DM included by policy. Contains no derived low-level operation |
| `character.operation.applied` | target character | explicit proposer+target owner | `{operation:{operationId,kind,version:1,targetCharacterId,arguments},resultingCharacterRevision}` | `aggregateRevision === resultingCharacterRevision`; direct DM/co-DM application emits only this lifecycle state plus a separate projection invalidation |
| `character.operation.rejected` | semantic operation | explicit proposer+target owner | `{operationId,targetCharacterId,status:"rejected",reason,sourceDisplaySnapshot,targetDisplaySnapshot,effectDisplaySnapshot}` | Closed uniformly non-enumerating reason in the multi-recipient event |
| `character.operation.cancelled` | semantic operation | explicit proposer+target owner | `{operationId,targetCharacterId,status:"cancelled",reason,sourceDisplaySnapshot,targetDisplaySnapshot,effectDisplaySnapshot}` | Terminal |
| `character.operation.expired` | semantic operation | explicit proposer+target owner | `{operationId,targetCharacterId,status:"expired",reason,sourceDisplaySnapshot,targetDisplaySnapshot,effectDisplaySnapshot}` | Terminal |
| `character.cloned` | character | all_members | source campaign/character ids | New aggregate id |
| `character.moved_out` | character | all_members in source | target campaign id | Source-campaign notification |
| `character.moved` | character | all_members in target | source campaign/character ids | Same character id, new campaign |
| `character.archived` | character | all_members | empty/default | Character preserved for owner |
| `brew.activated` | brew bundle version | all_members | version | Context consumers refetch/activate |
| `rules.activated` | rules version | all_members | version | Context consumers refetch/activate |
| `roll.logged` | character or campaign | caller-selected all_members/dm_only/actor_and_dm | formula, total, context, detail | Cooperative evidence, not cryptographic roll authority. Activity presentation prefers bounded `detail.title` and selectively renders safe breakdown/result/advantage/critical/spell/ability/target fields. |
| `character.operation.proposed` | semantic operation | explicit proposer+target owner | `operationId`, `targetCharacterId`, `status`, pinned source/template/choice, safe source/target/effect snapshots, `expiresAt` | DMs also see explicit-account events; canonical source character id and derived low-level operation are omitted |
| `character.operation.applied` | target character | explicit proposer/DM actor+target owner | normalized operation plus `resultingCharacterRevision` | Aggregate revision equals the resulting revision; payload has no raw actor id or canonical character fields |
| `character.operation.rejected` | semantic operation | explicit proposer+target owner | `operationId`, `targetCharacterId`, status, `reason:"unavailable"`, safe snapshots | No character mutation |
| `character.operation.cancelled` | semantic operation | explicit proposer+target owner | same minimized terminal shape | Explicit decision or lifecycle cancellation |
| `character.operation.expired` | semantic operation | explicit proposer+target owner | same minimized terminal shape | Bounded 24-hour expiry transitions once |
| `xp.granted` | character | explicit DM+owner | amount, reason, resulting XP | DM/co-DM also included by visibility policy |
| `item.granted` | character | explicit DM actor+owner | `{awardId,index,targetCount,sourceKind,note,entry}` | One deterministic per-target fact; bounded entry/note, followed by that target's projection invalidation |
| `party_inventory.invalidated` | campaign | all_members | empty | Metadata-only shared-stash refresh signal |
| `transfer.reserved` | transfer | explicit actor+target owner | source/target kinds; each non-DM sees only owned character endpoint ids | Escrow content and counterpart identities are not broadcast |
| `transfer.committed` | transfer | explicit actor+target owner | privacy-reduced source/target endpoints | Destination write complete; affected owners refetch authoritative state |
| `transfer.rejected` | transfer | explicit actor+target owner | privacy-reduced source/target endpoints | Source restored; affected owners refetch authoritative state |
| `transfer.cancelled` | transfer | explicit actor+target owner | lifecycle reason plus privacy-reduced endpoints | Source restored; affected owners refetch authoritative state |

Legacy pre-v3 `action.*` records may remain as history, but migration 0005 terminalizes arbitrary pending
structured effects and the protocol-v3 API cannot apply them.

The exact applied payload is:

```json
{
  "operation": {
    "operationId": "uuid",
    "kind": "hp.heal",
    "version": 1,
    "targetCharacterId": "uuid",
    "arguments": {"amount": 5}
  },
  "resultingCharacterRevision": 8
}
```

Actor attribution remains in the already-authorized event envelope. Shared terminal reasons are uniformly
non-enumerating; recipient-specific diagnostics do not ride a multi-recipient lifecycle event.

There is no `character.operation.accepted` lifecycle event. A distinct target-owner acceptance command emits
`character.operation.applied`. Operation payloads expose no source character id, canonical field/path,
effective delta, hidden eligibility/resource truth, or raw actor account id. Event/outbox/idempotent command
retries preserve `eventId` and `operationId`.

## Snapshot/replay interaction

Current-state character events at/before `snapshot.lastSequence` may be omitted by the client because the
snapshot already contains their result:

- character create/clone/move/move-out/archive/reactivate;
- character projection invalidation;
- XP/item grants;
- applied semantic operation, only for a fetched canonical base whose owner/DM `operationWatermark` already
  includes the event sequence.

One metadata-only invalidation is emitted per affected character per commit by every mutation that can change
a catalog field: owner patches, item grants, applied structured effects, both legs of a transfer (escrow
reservation and resolution), archived-import reactivation, and a sharing-policy write. `xp.granted` emits none
because `xp` is not a catalog field.

An atomic item-award batch emits each `item.granted` and its projection invalidation in request target order,
then one `party_inventory.invalidated` if the source stash was debited. Retries replay the receipt and emit
nothing. No campaign-wide batch event exposes the complete recipient list.

Roll history and non-state workflow history are not assumed to be represented by the snapshot.
Character semantic-operation lifecycle events are delivered even when their sequence is at/before the
snapshot cursor or an owner/DM character ref's `operationWatermark`. The later live-apply consumer, not the
transport, decides whether an applied operation is already represented by canonical truth.

Semantic lifecycle events are still delivered when their sequence is at/below `operationWatermark`; the
watermark says only that owner/DM canonical truth already includes the applied mutation. Clients deduplicate by
stable event id and applied operation id. Peer refs never carry this watermark.

### Character display-name snapshots

Character-related events capture the sanitized display name at the authoritative write point. The snapshot is
bounded and versioned so activity remains legible after a rename, detach, archive, or deletion. A viewer may use
the snapshot only after the event has passed the existing visibility filter; no new event visibility is granted.
Legacy events without a snapshot resolve a current authorized roster name, then an authorized account fallback, and
finally a neutral label.

## Audit entries

Audit is distinct from domain events:

- audit is security/admin evidence;
- domain event is visibility-filtered product/replay behavior;
- outbox is delivery state.

Current audit actions include:

- `campaign.created`, `campaign.archived`, `campaign.ownership_transferred`;
- `invite.created`, `invite.redeemed`, `invite.revoked`;
- `membership.role_changed`, `membership.removed`, `membership.left`;
- `character.created`, `character.reactivated`, `character.cloned`, `character.moved`,
  `character.archived`;
- `brew.created`, `brew.activated`;
- `rules.created`, `rules.activated`;
- `dm_workspace.created`, `dm_workspace.updated`;
- `character.operation.proposed`, `.applied`, `.rejected`, `.cancelled`, `.expired`;
- `xp.granted`, compatibility `item.granted`, atomic `item.award_batch`;
- `transfer.committed`, `transfer.rejected`;
- `session.revoked`, `session.revoked_others`;
- `account.deletion_requested`, `account.deletion_cancelled`, `account.deletion_purged`.

Not every high-frequency product event has an audit row. Character patches, presence, roll logging, action
proposal, and transfer reservation are represented by canonical/domain data instead. Changing audit policy
requires privacy/retention review.

## Outbox lifecycle

```text
pending -> publishing -> published
                  \-> failed -> publishing (retry)
publishing stale -> pending
```

- Event and outbox are inserted together.
- `claim_token` fences publishers.
- `attempt_count` increments on claim.
- `last_error` is operator diagnostics and must not contain private payloads.
- `published_at` supports planned 7-day technical cleanup.

## Adding or changing an event

Update in the same change:

1. canonical transaction and event insertion;
2. visibility and minimal payload threat review;
3. PostgreSQL and memory stores;
4. replay SQL and `canViewEvent`;
5. realtime client snapshot suppression/deduplication if relevant;
6. authorization and reconnect tests;
7. this catalog, API/realtime docs, traceability, data lifecycle, and retention;
8. operator signals if delivery failure matters.
