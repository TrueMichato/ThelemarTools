# Campaign Hub implementation history

> **Status:** Historical record of implemented Phases 0-6F
> **Last verified:** 2026-08-25
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

## Phase 6A: durable handoff and checkpoint

Added the repository-owned current-system, architecture, domain, API, realtime, event, data-lifecycle,
implementation-history, checkpoint, traceability, risk, testing, staging, troubleshooting, contributor,
runbook, and roadmap documentation. ADRs 0004-0008 record the continuation decisions. Documentation contracts
verify required files, links, ADR sequence, and absence of session-private paths.

The large working tree was checkpointed as reviewed backend, browser, Character Sheet/DM Screen, and
documentation commits. Migration 0001 became immutable.

## Phase 6B: lifecycle administration

Added:

- invite metadata list/revoke;
- owner-authorized role changes;
- owner/co-DM member removal and voluntary leave;
- transactional action/transfer cancellation, escrow restoration, lease release, workspace archive, and
  character detachment;
- session/device list and revoke;
- seven-day account deletion request/restricted reauthentication/cancellation/purge;
- blocked purge reporting and immediate socket closure;
- Hub/Campaign lifecycle UI and runbooks.

Memory, API, and PostgreSQL drills cover ownership protections, role boundaries, escrow restoration,
detachment, deletion cancellation, and FK-safe purge.

## Phase 6C: migration management

Added:

- immutable checksummed migration discovery/ledger;
- session advisory lock;
- status/plan/apply commands;
- verified pre-ledger 0001 baselining;
- migration-aware readiness;
- least-privilege runtime/backup grants;
- migration 0002 lifecycle fields/FKs;
- fresh, baseline, concurrent, failed, checksum-mismatch, restored-database, and role-boundary drills.

The BFF runtime no longer needs schema-owner privileges once provider roles are configured.

## Phase 6D: portable deployment

Added a pinned Node 24 non-root/read-only-compatible BFF image, lightweight static image, PostgreSQL 17,
one-shot migration and role-grant jobs, same-origin HTTPS Caddy edge, explicit private/public/egress networks,
and migration-aware liveness/readiness. The local reference stack proved secure cookies, WebSocket routing,
exact proxy trust, GitHub egress, clean-volume startup, and graceful restart.

## Phase 6E: operations and recovery

Added migration 0003 operational evidence, advisory-locked bounded maintenance, protected Prometheus metrics,
bounded correlation ids, query-stripped/redacted JSON logs, outbox status metrics, AES-256-GCM encrypted
backup/restore, dedicated backup/operations roles, SLOs, alerts, and executable incident/recovery runbooks.
Real drills covered cleanup, singleton exclusion, tamper failure, encrypted restore, evidence age, and role
boundaries.

## Phase 6F: CI and real-stack integration

Added:

- a pinned-action Hub pull-request workflow with deterministic install, Hub/affected regression, PostgreSQL,
  migration/role, PWA, lint, audit, secret, SBOM, image, and provenance gates;
- a production-excluded test BFF with secret-gated synthetic sessions and production-mode refusal;
- a disposable, unique-project, signal-cleaned Compose orchestrator and dedicated Playwright
  configuration/page object;
- test auth derived from the exact exported production image plus an unmodified production-entry-point smoke;
- a lifecycle journey through the real Character Sheet and multiplayer administration;
- a six-member budget journey with near-limit documents, 500-event replay, and contended reservation;
- post-browser BFF and PostgreSQL restart/readiness probes.

Both real-stack journeys passed in 50.5 seconds in CI reporter mode. The harness removed all test containers,
networks, and volumes after the run. A separate SIGTERM drill exited 143 and left no matching Docker
resources.

## Phase 6G: provider decision preparation

Compared AWS, Google Cloud, DigitalOcean, and Render against the portable contract. ADR 0009 proposes
DigitalOcean App Platform + Managed PostgreSQL at an estimated $20-30/month, with AWS as fallback. The
recommendation surfaced the process-local single-replica/no-HA constraint, provider client-IP trust gap, and
managed-ingress idle WebSocket risk.

Implemented the provider-neutral preparation that can be validated locally:

- `do-connecting-ip` is the only accepted provider header and cannot coexist with `HUB_TRUST_PROXY`;
- one validated address is shared by safe request logs, HTTP rate-limit keys, and WebSocket context;
- malformed, missing, array, and comma-separated provider values fall back to the socket peer;
- the server sends 25-second WebSocket pings and terminates missed pongs for reconnect/resync recovery.

Provider/cost/region acceptance, live header-overwrite proof, managed resources, OAuth/domain, PITR, jobs,
alerts, backup destination, and restore remain Phase 6G gates.
