# Campaign Hub architecture

> **Status:** Current architecture with launch gaps called out
> **Last verified:** 2026-08-24
> **Owner:** Campaign Hub maintainers

## Principles

1. Local mode remains a supported product mode, not a degraded fallback.
2. The browser is untrusted and never receives database credentials or durable bearer tokens.
3. PostgreSQL is canonical for Hub data.
4. Full Character Sheet/Board documents remain documents; the system is not fully event-sourced.
5. Multiplayer-relevant changes use semantic commands where blind document patches would be unsafe.
6. Every stale-writer defense combines revision, lease, and monotonically increasing fencing epoch.
7. Campaign content is an overlay and never replaces personal content.
8. Realtime delivery is derived from committed outbox rows; WebSockets are not the source of truth.
9. Tenant and visibility checks are server responsibilities.
10. Private-V1 assumptions cannot silently become public-service policy.

## Components

```mermaid
flowchart TB
  subgraph Browser
    HubPage[Hub/Campaign pages]
    Sheet[Character Sheet]
    Board[DM Screen]
    API[HubApiClient]
    CharRepo[Hub HTTP character repository]
    SheetRT[Character Sheet realtime coordinator]
    DmRepo[Hub HTTP workspace repository]
    Context[Campaign context + brew overlay]
    RT[Realtime client]
  end

  subgraph BFF
    Routes[Fastify routes and guards]
    Store[PostgresHubStore]
    Validate[Content/character/domain validation]
    Realtime[HubRealtime]
    Dispatch[Outbox dispatcher]
  end

  PG[(PostgreSQL)]
  OAuth[GitHub OAuth]

  HubPage --> API
  Sheet --> CharRepo --> API
  Sheet --> Context --> API
  Sheet --> SheetRT --> RT
  SheetRT --> CharRepo
  Board --> DmRepo --> API
  Board --> Context
  RT <-->|WebSocket| Routes
  API --> Routes
  Routes --> OAuth
  Routes --> Validate --> Store --> PG
  Dispatch --> Store
  Dispatch --> Realtime
  Realtime --> RT
```

## Request authorization

```mermaid
sequenceDiagram
  participant B as Browser
  participant F as Fastify
  participant S as Store
  participant P as PostgreSQL

  B->>F: Mutation + cookie + Origin + CSRF + protocol + idempotency key
  F->>S: Resolve hashed session
  S->>P: Session/account lookup
  F->>S: Resolve campaign membership/role
  S->>P: Membership lookup
  F->>F: Validate schema and route permission
  F->>S: Authoritative command
  S->>P: BEGIN + advisory/row locks
  S->>P: Canonical write + audit + event + outbox + receipt
  S->>P: COMMIT
  S-->>F: Canonical result
  F-->>B: no-store JSON
```

Reads require a signed session where the route is private. Mutations additionally require exact Origin, CSRF,
wire protocol, request schema, and an idempotency key. Route-specific store methods repeat ownership and
tenant checks instead of trusting a client-supplied role.

## Character save/rebase

```mermaid
sequenceDiagram
  participant UI as Character Sheet
  participant R as Hub repository
  participant A as Authority

  UI->>R: toJson snapshot
  R->>R: diff last accepted base -> patch
  R->>A: patch(baseRevision, leaseEpoch, idempotency)
  alt accepted
    A-->>R: canonical document + revision
    R->>R: rebase edits made while request was in flight
    R-->>UI: apply canonical/rebased state
  else revision conflict
    A-->>R: current canonical state
    R->>R: three-way rebase
    alt disjoint paths
      R->>A: retry against current base
    else overlapping paths
      R-->>UI: explicit local/server conflict recovery
    end
  else lease fenced/expired
    A-->>R: stable lease error
    R-->>UI: read-only/takeover/recovery flow
  end
```

The client never treats an unacknowledged queued snapshot as a new base. Each submitted write retains its own
base so overlapping and disjoint changes are classified correctly.

## Transactional outbox and realtime

```mermaid
flowchart LR
  Command --> Tx[Database transaction]
  Tx --> Canonical[Canonical state]
  Tx --> Audit[Audit entry]
  Tx --> Event[Domain event + sequence]
  Tx --> Receipt[Command receipt]
  Tx --> Outbox[Outbox row]
  Outbox --> Claim[Claim token]
  Claim --> Filter[Session + membership + visibility recheck]
  Filter --> WS[WebSocket event]
  Claim --> Published[Published status]
```

Clients use snapshots and sequence-based replay to recover from disconnects. Presence is ephemeral. Roll and
action history is durable. Visibility is evaluated on the server for both replay and live fanout.

An authenticated campaign-backed Character Sheet attaches a focused realtime coordinator only after its
canonical character has loaded. Socket-generation fencing makes stale messages, closes, and watchdog timers
inert. The coordinator routes metadata-only projection invalidations and the frozen
`character.operation.*` lifecycle allowlist through the HTTP repository's existing mutation queue, so a
delivery cannot overtake an in-flight save. Character/campaign switch, canonical-id replacement, detach,
revocation, logout, page hide, and unload all fence the subscription generation.

This delivery layer is intentionally not reconciliation: it does not mutate `CharacterSheetState`, accepted
bases, revisions, leases, conflicts, or recovery storage, and it does not fetch or replace the owner document.
The later live-apply layer owns ADR 0012 operation-aware base/live transforms.

## Campaign content overlay

```mermaid
flowchart LR
  Site[Site/prerelease content] --> Merge[Processed content]
  Personal[Persisted personal brew] --> Merge
  Campaign[Temporary campaign bundle] --> Merge
  Merge --> Page[Current page renderer]
  Campaign -. never written .->|X| Personal
```

The page activates campaign context before loading character/DM data. Rules exist as a runtime overlay and are
removed by Character Sheet serialization.

## DM workspace and Party Tracker

- Each DM membership owns a private Board workspace.
- The workspace is one revisioned/fenced Board blob.
- Recovery drafts are scoped by account/workspace to prevent cross-account leakage.
- Campaign identity and DM/co-DM authorization are checked before the private Board blob is loaded.
- A focused Campaign DM Screen controller combines workspace save/conflict state with observable realtime
  connection state. Policy closure, role loss, membership removal, and archive block the Board instead of
  silently leaving private controls active.
- Live campaign character projections are injected outside serialized Board state.
- Linked Party Tracker rows use a static read-only detail view, are visually separated from private manual
  rows, and cannot be edited into duplicate local characters.
- Journey Tracker consumes only the Party Tracker projection allowed by existing board integration.

## Deployment boundary

The required production topology is documented, but its portable container implementation is Phase 6D:

- static-site service;
- BFF service;
- PostgreSQL;
- one-shot migrator;
- same-origin TLS edge with WebSocket proxying;
- maintenance/backup scheduling outside the request process.

The existing root `Dockerfile` is the static-site image. It must not be overloaded with BFF runtime or
database credentials.
