# Campaign Hub event and audit catalog

> **Status:** Current private-V1 catalog
> **Last verified:** 2026-08-24
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
| `payload` | Minimal client payload; never assume it is a full aggregate |
| `createdAt` | Database timestamp |

## Current domain events

| Event | Aggregate | Visibility | Payload/content | Notes |
|---|---|---|---|---|
| `campaign.created` | campaign | all_members | campaign name | First sequence allocated during campaign transaction |
| `campaign.archived` | campaign | all_members | empty | Characters already detached |
| `campaign.ownership_transferred` | campaign | all_members | target account id | Owner/roles changed atomically |
| `invite.created` | invite | dm_only | role, expiry | Raw token is never in event |
| `membership.joined` | membership | all_members | account id, role | Invite id remains audit detail, not public payload |
| `character.created` | character | all_members | owner account id | Full document not emitted |
| `character.reactivated` | character | all_members | empty | Same scoped import reactivates archived row |
| `character.patched` | character | actor_and_dm | submitted patches | Private owner/DM state event |
| `character.projection.updated` | character | all_members | fixed player projection | Does not contain notes/inventory/private fields |
| `character.cloned` | character | all_members | source campaign/character ids | New aggregate id |
| `character.moved_out` | character | all_members in source | target campaign id | Source-campaign notification |
| `character.moved` | character | all_members in target | source campaign/character ids | Same character id, new campaign |
| `character.archived` | character | all_members | empty/default | Character preserved for owner |
| `brew.activated` | brew bundle version | all_members | version | Context consumers refetch/activate |
| `rules.activated` | rules version | all_members | version | Context consumers refetch/activate |
| `roll.logged` | character or campaign | caller-selected all_members/dm_only/actor_and_dm | formula, total, context, detail | Cooperative evidence, not cryptographic roll authority |
| `action.proposed` | pending action | explicit actor+target | target id, structured effect | DMs also see explicit-account events |
| `action.applied` | pending action | explicit actor+target | effect, target id, character revision | Character changed semantically |
| `action.rejected` | pending action | explicit actor+target | effect, target id, character revision | No character mutation |
| `xp.granted` | character | explicit DM+owner | amount, reason, resulting XP | DM/co-DM also included by visibility policy |
| `item.granted` | character | explicit DM+owner | granted entry | Entry content is cross-user validated |
| `transfer.reserved` | transfer | all_members | source/target kinds and ids | Escrow content is not broadcast |
| `transfer.committed` | transfer | all_members | source/target ids | Destination write complete |
| `transfer.rejected` | transfer | all_members | source/target ids | Source restored |
| `transfer.cancelled` | transfer | all_members | lifecycle reason or source/target ids | Source restored |

Schema permits future `expired`/intermediate action/transfer states, but no corresponding event is currently
emitted automatically.

## Snapshot/replay interaction

Current-state character events at/before `snapshot.lastSequence` may be omitted by the client because the
snapshot already contains their result:

- character create/clone/move/move-out/archive/reactivate;
- character projection update;
- XP/item grants;
- applied action.

Roll history and non-state workflow history are not assumed to be represented by the snapshot.

## Audit entries

Audit is distinct from domain events:

- audit is security/admin evidence;
- domain event is visibility-filtered product/replay behavior;
- outbox is delivery state.

Current audit actions include:

- `campaign.created`, `campaign.archived`, `campaign.ownership_transferred`;
- `invite.created`, `invite.redeemed`;
- `character.created`, `character.reactivated`, `character.cloned`, `character.moved`,
  `character.archived`;
- `brew.created`, `brew.activated`;
- `rules.created`, `rules.activated`;
- `dm_workspace.created`, `dm_workspace.updated`;
- `action.applied`, `action.rejected`;
- `xp.granted`, `item.granted`;
- `transfer.committed`, `transfer.rejected`.

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
