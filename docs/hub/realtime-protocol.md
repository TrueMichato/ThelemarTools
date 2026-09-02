# Campaign Hub realtime protocol

> **Status:** Current private-V1 wire protocol
> **Protocol version:** `3`
> **Last verified:** 2026-09-02
> **Owner:** Campaign Hub maintainers

## Connection

```text
GET /ws/campaign/{campaignId}?v=3
Origin: <exact HUB_APP_ORIGIN>
Cookie: __Host-hub_session=...
```

Upgrade requires:

- UUID campaign id;
- query protocol `v=3`;
- exact Origin;
- valid signed/unexpired session;
- active campaign membership.

The service worker does not intercept WebSocket traffic.

The server sends a WebSocket protocol ping every 25 seconds. Standards-compliant browser clients reply with
pong automatically. A connection which misses one complete heartbeat interval is terminated and recovers
through the normal reconnect/resync path. Heartbeats are control frames, not JSON messages, and do not count
against the 20-message client rate limit.

## Initial server message

```json
{
  "type": "subscribed",
  "campaignId": "uuid",
  "membershipId": "uuid",
  "role": "player",
  "connectedAt": "ISO-8601"
}
```

The server then broadcasts current presence.

## Client messages

### Presence

```json
{
  "type": "presence",
  "activity": "editing_character",
  "targetId": "character-or-workspace-id"
}
```

Allowed activities:

- `idle`;
- `viewing_character`;
- `editing_character`;
- `viewing_dm_screen`.

Unknown activity becomes `idle`. `targetId` is optional and limited to 200 characters.

### Resync

```json
{
  "type": "resync",
  "afterSequence": 42
}
```

Response:

```json
{
  "type": "resync_complete",
  "cursor": {"campaignId": "uuid", "lastSequence": 42},
  "campaign": {},
  "membership": {},
  "characterRefs": [{"id": "uuid", "revision": 8, "projectionRevision": 3, "operationWatermark": 41}],
  "events": []
}
```

Resync carries **no character document and no peer profile**
([ADR 0011](adr/0011-authorization-scoped-character-projections.md)). `characterRefs` supplies only the ids and
revisions a client needs to invalidate its caches; the projections themselves are fetched over the
authorization-scoped HTTP projector (`GET /api/campaigns/:campaignId/character-projections`). A ref carries
`operationWatermark` only when the requester may read that character's canonical truth: its owner or a
DM/co-DM. Peer refs never carry it, because a changing hidden sequence would disclose unseen operations.
Events are ordered, visibility-filtered, sequence-greater than the requested value, and capped at 500.

Unknown client types receive:

```json
{"type":"error","code":"UNSUPPORTED_MESSAGE"}
```

Invalid JSON receives `INVALID_MESSAGE`. Handler failure receives `MESSAGE_FAILED`.

## Server messages

### Presence

```json
{
  "type": "presence",
  "members": [
    {
      "accountId": "uuid",
      "displayName": "Player",
      "role": "player",
      "activity": "viewing_character",
      "targetId": "uuid",
      "connectedAt": "ISO-8601"
    }
  ]
}
```

Presence is ephemeral and not written to the event log.

### Event

```json
{
  "type": "event",
  "event": {
    "id": "uuid",
    "campaignId": "uuid",
    "sequence": 43,
    "type": "character.projection.invalidated",
    "actorAccountId": "uuid",
    "aggregateType": "character",
    "aggregateId": "uuid",
    "aggregateRevision": 8,
    "visibility": "all_members",
    "visibleAccountIds": null,
    "payload": {"projectionRevision": 3},
    "createdAt": "ISO-8601"
  }
}
```

## Limits and close behavior

- Fastify WebSocket max payload: 16 KB.
- Realtime handler independently closes oversized messages with code 1009.
- More than 20 messages in one second closes with 1008.
- Expired/revoked session closes with 1008.
- Removed membership closes with 1008.
- Revoking the current session through logout closes matching sockets immediately.
- Missed heartbeat closes the underlying socket; server shutdown closes with 1001.

Shutdown sends code 1001 during the WebSocket plugin's pre-close phase, waits up to one second for close
handshakes, then terminates stragglers before the HTTP server and database pool exit.

Session and membership are rechecked:

- on each client message;
- before each event fanout;
- during each presence broadcast.

## Visibility

| Visibility | Recipient |
|---|---|
| `all_members` | every active campaign member |
| `dm_only` | DM and co-DM |
| `actor_and_dm` | actor plus DM/co-DM |
| `explicit_accounts` | listed accounts plus DM/co-DM |

Visibility is enforced during both database replay and live fanout. The client cannot widen it.

## Ordering and delivery

Each campaign has a monotonically allocated `sequence`.

1. Canonical transaction inserts event and outbox row.
2. Dispatcher claims up to 100 available rows with a claim token.
3. Rows are processed in order.
4. If one campaign event fails, later claimed events for that campaign are marked failed rather than
   overtaking it.
5. Success marks the row published.
6. Failure clears claim and schedules retry after one second.
7. Stale publishing claims are reclaimable.

WebSocket delivery is at-least-once in the presence of process/network failure. Clients deduplicate by event
id (falling back to sequence/type) and track the highest sequence.

### Semantic character operations

The lifecycle allowlist is:

- `character.operation.proposed`;
- `character.operation.applied`;
- `character.operation.rejected`;
- `character.operation.cancelled`;
- `character.operation.expired`.

Every lifecycle event includes a stable `operationId` and `targetCharacterId`. Proposal/terminal events aggregate
on the semantic operation and use `explicit_accounts` for proposer plus target owner; existing visibility policy
also includes DM/co-DM. Terminal payloads expose only `reason:"unavailable"` plus immutable safe display
snapshots. Applied events aggregate on the target character and carry exactly:

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

Direct DM/co-DM application emits `character.operation.applied` and the separate metadata-only
`character.projection.invalidated`. `operationWatermark` is the latest applied-operation campaign sequence
already reflected by owner/DM canonical truth. It does not suppress delivery: events at/below the watermark
still arrive for history and dirty-local reconciliation, while a clean fetched base does not apply them twice.

## Client resync algorithm

`HubRealtimeClient`:

1. reconnects with bounded exponential backoff;
2. sends resync from last accepted sequence;
3. buffers live events while resync is in progress;
4. applies the cursor baseline and emits `cursor` with `characterRefs`;
5. applies replay events;
6. suppresses cursor-covered historical state events;
7. applies buffered events in order;
8. emits current presence/events to page consumers.

Consumers coalesce repeated `character.projection.invalidated` events and perform one
authorization-scoped HTTP fetch. The response **replaces** the previous projection rather than merging with
it, so a field an owner has just stopped sharing cannot survive from an older, broader response. An editable
owner Character Sheet never replaces live local state from an invalidation-triggered fetch: it has no realtime
subscription, and ordinary document changes use its accepted-base rebase.

Snapshot-covered event types are suppressed only when at/before the snapshot sequence. Semantic lifecycle
events are not discarded solely because they are at/below `operationWatermark`; durable roll/operation history
may still replay because it is not fully represented by current state.

## Protocol evolution

- Header/query version mismatch fails closed.
- Old clients must not submit writes under a new incompatible protocol.
- Additive server messages still require clients to ignore unknown types safely or a protocol bump.
- Any shape/visibility/order change updates this document, event catalog, route tests, client tests, and
  `HUB_PROTOCOL_VERSION`.
