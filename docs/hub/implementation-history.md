# Campaign Hub implementation history

> **Status:** Historical record of implemented Phases 0-5
> **Last verified:** 2026-08-24
> **Owner:** Campaign Hub maintainers

This record explains how the implementation reached its current architecture. It preserves reasons and
rejected approaches so future changes do not accidentally recreate earlier hazards.

## Exploration and architecture correction

The original idea was peer interaction on top of a local-only site. Requirements expanded to durable
accounts, multi-device access, offline delivery, complete DM visibility, shared campaign content, and atomic
inventory movement. Those requirements invalidated a peer-to-peer authority model.

The plan changed to:

- same-origin BFF;
- managed PostgreSQL;
- canonical documents plus audit/events/outbox;
- typed repository seams;
- one active editor with lease fencing;
- immutable campaign content overlays;
- private invite-only V1.

Rejected:

- global `StorageUtil` cloud replacement, because it would sync unrelated caches/preferences and cannot make
  asynchronous network reads satisfy synchronous callers;
- replacing personal brew through `pSetBrew`, because it would clobber personal content and race across
  campaign tabs;
- full Character Sheet event sourcing, because the existing large imperative state object is unsuitable;
- PeerJS/WebRTC authority, because it cannot supply durable offline/multi-device semantics.

## Branch preflight

The historical `multiplayer-hub` ref had divergent history but no unique Hub patch content. Its prior tip was
preserved as `backup/multiplayer-hub-pre-sync-81f5aa1a`, then the implementation branch was synchronized
exactly to `character-sheet-wip`. A clean Character Sheet baseline was recorded before edits.

## Phase 0: proof seams

Implemented deterministic proof modules for:

- per-character documents and revisions;
- leases, takeover, and monotonic fencing;
- JSON patch/rebase conflict detection;
- DM grant racing owner edits;
- temporary context-keyed brew overlays;
- revisioned DM Board repositories;
- service-worker API/auth network policy.

The proof established that existing Character Sheet and Board save boundaries were usable without replacing
the rest of local persistence.

## Phase 1: accounts, campaigns, characters, durability

Added:

- Fastify BFF and PostgreSQL store;
- GitHub OAuth PKCE flow with signed state and numeric-subject allowlist;
- hashed server sessions, CSRF and exact-Origin enforcement;
- campaigns, roles, memberships, invites, cloud characters, leases, clone/move/archive;
- Hub and Campaign pages;
- canonical-id adoption;
- audit, domain events, command receipts, and transactional outbox from the first mutation;
- account export and campaign ownership transfer;
- backup/restore scripts and PostgreSQL drills.

Important defects found and corrected:

- mutable GitHub logins were rejected as identity keys;
- idempotency became payload/path aware;
- same-origin return paths rejected scheme-relative redirects;
- tenant constraints moved into the database;
- credentials were removed from process command arguments.

## Phase 2: campaign content and private DM workspaces

Added:

- immutable/content-addressed campaign brew versions;
- strict content validation and dependency closure;
- typed campaign rules versions;
- early campaign context activation on Character Sheet/DM Screen;
- per-DM private Board workspaces with leases;
- complete DM character views and player-limited projections.

Important defects found and corrected:

- personal brew remained completely separate;
- raw HTML and unsafe URL paths were rejected;
- campaign rules were prevented from leaking into character JSON;
- workspace recovery became account/workspace scoped.

## Phase 3: realtime reads

Added:

- authenticated WebSockets;
- presence;
- sequence snapshots and visible-event replay;
- durable roll events;
- outbox dispatcher with claim tokens and stale-claim recovery;
- reconnect/backoff and tab coordination;
- live Party Tracker projections excluded from Board persistence.

Important defects found and corrected:

- membership/session is revalidated during messages and fanout;
- events cannot overtake a failed earlier event in the same campaign;
- snapshot-covered state events are suppressed while durable history can replay;
- stale protocol clients fail closed.

## Phase 4: actions, grants, inventory, transfers

Added:

- structured effect proposal/resolution;
- XP/item grants;
- denomination currency;
- party inventory;
- escrowed transfers with partial stacks and all terminal outcomes.

Important defects found and corrected:

- whole-item removal cannot bypass Character Sheet cleanup invariants;
- rollback preserves source identity;
- commit mints a destination identity unless metadata-compatible merge is safe;
- lifecycle operations cancel incoming transfers and restore escrow;
- outgoing escrow blocks archive/move;
- resulting characters are quota-validated, not merely individual inputs.

## Phase 5: hardening

Added or completed:

- lifecycle export/archive/ownership transfer;
- strict cross-user character validation and HTML sanitization;
- 1.5 MB post-mutation character ceiling;
- compact 24-hour command receipts;
- security headers, origin/CSRF/protocol checks, bounded bodies and database timeouts;
- operations, security, and performance references;
- repeated blocker-focused reviews;
- real PostgreSQL migration/transaction/backup/restore drills;
- desktop/mobile Hub browser verification.

Late launch blockers corrected:

- renderer-generated Character Sheet HTML was sanitized instead of blanket rejected;
- a compatible, patched `sanitize-html` version was selected for the Jest runtime;
- default browser `fetch` was bound correctly;
- Hub pages loaded shared scripts in valid order;
- canonical-id URL adoption tolerated test/browser history environments;
- invalid pending invites clear themselves without aborting Hub initialization;
- unknown angle-bracket prose is escaped rather than silently discarded.

## Verification record

At the Phase 5 close:

- complete broad Jest gate: 601 suites / 17,495 tests;
- Character Sheet: 527 suites / 16,819 tests;
- post-review Hub: 29 suites / 212 tests;
- targeted DM Screen: 6 suites / 138 tests;
- repository JS lint, Hub/DM SCSS build/lint, service-worker build, production dependency audit;
- fresh UTF-8 PostgreSQL 17 migration, real grants/transfers/quota rollback, receipt inspection, backup, and
  single-transaction restore;
- signed-out/signed-in Hub and campaign views at desktop and 390 px mobile, with clean consoles and no
  horizontal overflow.

These results describe the implementation checkpoint, not a managed-provider staging deployment.
