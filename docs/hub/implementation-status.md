# Campaign Hub implementation status

> **Last updated:** 2026-09-03
> **Owner:** Campaign Hub maintainers

## Status

Private invite-only V1 release `hub-staging-2026-09-01` at `8f181712` is deployed on a reused Oracle Always
Free ARM instance. The same-origin HTTPS, GitHub OAuth, PostgreSQL, static site, BFF, API, and WebSocket smoke
checks pass. Phase 6G deployment is complete. The controlled one-DM/two-player test remains gated on
host-operations proof and the physical game day described in the [living roadmap](roadmap.md). Semi-public
onboarding remains intentionally disabled.

Phase 6A documentation/handoff, the reviewed checkpoint series, Phase 6B lifecycle administration, Phase 6C
migration management, Phase 6D portable deployment, Phase 6E operations, Phase 6F CI/real-stack integration,
and Phase 6G Oracle deployment are complete.

The first `t7-auth-providers` layer is implemented but not a Discord/Google product release: additive migration
0006, provider-neutral identity/session provenance, durable one-time OAuth transactions, a validated registry
running only the compatible GitHub adapter, rollback preflight, and deterministic memory/PostgreSQL/real-stack
coverage. Discord, Google, reauthentication, and link/unlink remain gated to later reviewed stack layers.

The Oracle deployment now has deliberate one-command release automation in `deploy/hub/release.sh`. It locks
out concurrent operators, verifies an immutable annotated tag and clean exact checkout, records rollback
identity, creates and reads an encrypted pre-release backup, enforces expand/deploy/contract migration
compatibility, applies the checked-in Compose overlays, performs complete public/runtime/static/backup checks,
and emits redacted machine/human evidence. It can automatically roll back only compatible application images;
it never reverses migrations, restores a database, changes filesystem ownership, or touches Foundry.

V2-T0 release-automation implementation is **shipped** by
[PR #219](https://github.com/TrueMichato/ThelemarTools/pull/219), and V2-T1 legible activity history is
**shipped** by [PR #218](https://github.com/TrueMichato/ThelemarTools/pull/218). The release script's live
Oracle dry run, deliberate release, and induced-failure drills are external host-operations evidence, not
unfinished T0 implementation; they remain blocked under the first V1 gate below.

The focused `t2-effects-server-role` prerequisite slice implements the ADR 0012 server contract without changing
the roadmap train status: protocol-v3 closed operations, immediate atomic DM/co-DM application, persistent
command/operation/event identity, owner/DM watermarks, opaque target refs, and the source-derived peer
proposal/terminal state machine. Production deliberately enables no successful `cost=none` peer template;
Cure Wounds is recognized and rejected as cost-bearing. Character Sheet subscription/rebase, approval/targeting
UI, costs, monster/multi-target effects, and the first real peer template remain later slices.

- Lifecycle includes invite list/revoke, owner role changes, owner/co-DM member removal, voluntary leave,
  session/device revocation, immediate socket closure, workspace archive/restore, character detachment,
  escrow/action cleanup, and seven-day deletion request/cancel/purge with blocked-id reporting.
- Migration management includes immutable/checksummed files, advisory locking, baseline detection,
  status/plan/apply, migration-aware readiness, runtime/backup role grants, migration 0002, and
  fresh/baseline/concurrent/failure/checksum/restored-database drills.
- The complete Hub suite passes 45 suites / 315 tests; affected Character Sheet persistence tests, repository
  JS lint, and Hub SCSS build/lint pass. Four real PostgreSQL/HTTPS browser journeys pass.

Phase 6D portable deployment is implemented and locally verified: non-root/read-only BFF image, reproducible
static image with release-built service workers, PostgreSQL 17, one-shot migration/role grants,
least-privilege runtime, same-origin Caddy edge, WebSocket forwarding, liveness/readiness, and graceful
restart.

Phase 6E portable operations/observability is implemented: migration 0003 operational evidence, singleton
bounded maintenance, protected Prometheus metrics, bounded route/request correlation, query/secret-safe JSON
logs, SLO/alert catalog, AES-256-GCM backup/restore, dedicated backup/evidence roles, and executable deploy/
rollback/outage/outbox/rotation/incident runbooks. Real cleanup, singleton lock, role boundaries, tamper
failure, encrypted backup/restore, evidence-age metrics, and OAuth log sanitization were drilled. Oracle
scheduling, off-machine backup, isolated restore, and rollback proof remain the V1 host-operations gate;
managed PITR is intentionally not part of the Oracle free-tier design.

Phase 6F adds a pinned-action Hub pull-request workflow, deterministic install/lint/test/migration/supply-chain
gates, exact-image export with Node/image SBOMs and provenance, production-excluded synthetic authentication
derived from the exact release image, production-entry-point smoke, and an isolated disposable same-origin
HTTPS/PostgreSQL Playwright stack. Four multi-context journeys cover the private lifecycle, real Character
Sheet loading, character detachment/copy/move recovery, six-member load, 500-event replay, near-limit
character storage, contended transfer reservation, and BFF/database restart recovery.

Phase 6G is **complete**: [ADR 0010](adr/0010-oracle-always-free-hosting.md) selects Oracle
Cloud Always Free (single ARM VM, Israel Central) at $0/month, superseding the earlier DigitalOcean proposal
in ADR 0009, which is retained as the paid upgrade path. Two deployment artefacts are added and validated
locally and on Oracle: `compose.hub.public.yml` and `deploy/hub/Caddyfile.public`, which publish 80/443 and issue Let's
Encrypt certificates for a real hostname without altering the base local stack. A click-by-click
[provisioning runbook](runbooks/oracle-provisioning.md) covers quota, capacity, the VCN/host dual-firewall
trap, DNS, the OAuth app, and first boot.

Two decisions are consequently narrowed and recorded in place: no managed PITR, so recovery is from nightly
encrypted backups with an RPO of up to 24 hours (ADR 0006); and image promotion by verified git tag rather
than registry digest, because the free tier is ARM while CI runners are x86 (ADR 0008).

The guarded `do-connecting-ip` adapter and 25-second WebSocket heartbeat are implemented and pass the full
real-stack gate; the adapter stays disabled on Oracle, where Caddy is the sole ingress. Release
`hub-staging-2026-09-01` at `8f181712` is live on the repurposed Foundry VM and its deployment smoke checks
pass. Only the host-operations proof and physical one-DM/two-player game day remain before the V1 go/no-go.

## Implemented

- Private GitHub OAuth allowlist, server sessions, CSRF/origin checks, protocol gating.
- Accounts, campaigns, roles, invites, membership, export, archive, and ownership transfer.
- Local/cloud Character Sheet repository switch, non-destructive claim, clone, move, archive, lease takeover.
- Character Sheet-native local copy, detached-character recovery, clone-by-default campaign reuse, and
  compatibility-gated explicit move with another-device lease refusal.
- Role-aware campaign operation surface: player characters and party status, DM live roster/workspace access,
  permission-aware inbox controls, recent activity, campaign setup status, copyable invites, and disclosed
  administration sections.
- Human-readable campaign interactions: source inventory stack selection, all five currency denominations,
  named action/transfer inbox entries, spell-slot proposals with spell/action context, and a lazy DM item
  catalog combining core and active campaign-brew items.
- Hub-owned surfaces provide a keyboard skip path, persistent semantic page heading, named main and campaign
  regions, labeled form controls, WCAG AA primary-button contrast in day/night themes, and 44 px entry targets.
- Immutable campaign brew/rules versions and early page context activation.
- Private per-DM workspaces using the existing Board blob and lease fencing.
- Authenticated WebSockets, presence, visibility-filtered event replay, snapshots, outbox dispatcher.
- Campaign pages consume both initial snapshots and visible events, coalesce projection invalidations into one
  authorization-scoped HTTP refetch that replaces rather than merges,
  debounce authoritative refreshes, sequence-fence stale refresh responses so newer roster state cannot
  regress, and run one bounded 10-second resync watchdog so a missed delivery cannot leave a live-looking
  roster stale indefinitely.
- DM full character reads plus the exact peer preview; owner-chosen peer profiles for other members with a
  sharing UI on the Character Sheet; live Party Tracker linked rows.
- Stale Character Sheet campaign URLs canonicalize before campaign rules/homebrew activation, and Hub-linked
  Party/Journey participants remain session-only rather than leaking into the private Board blob.
- Campaign DM Screen access is validated before private workspace data loads. Its persistent campaign banner
  reports live/reconnecting/stale party sync and loading/saving/saved/error/conflict workspace state, and
  closes the workspace when the session, membership, role, or campaign status no longer permits access.
- Campaign Party Trackers separate live read-only projections from private manual rows, retain the last good
  projection while reconnecting, show sync timestamps and empty states, and render linked details without
  disabled mutation controls.
- Durable roll log with semantic, bounded activity titles and selected authorized detail; character-related
  events carry privacy-safe versioned display-name snapshots so historical activity survives rename/detach/archive.
- Immediate DM/co-DM semantic character operations plus the fail-closed source-derived peer proposal/terminal
  server contract; XP/item grants, party inventory, and escrowed item/currency transfers remain domain-specific.
- Whole-item transfers preserve Character Sheet invariants, rollback identity, and metadata-safe stack merges.
- Owned cloud Character Sheets expose the server-authoritative party stash as a separate inventory section,
  including privacy-safe direct-pass destinations, escrow-backed partial transfers, reconnect/event refresh,
  repository-safe character reconciliation, accessible stateful controls, and reusable eligibility/weight
  summaries. Local and signed-out sheets remain unchanged.
- Character HTML is sanitized at the authority boundary; canonical documents are capped at 1.5 MB after
  every mutation.
- Idempotency receipts are compact, expire after 24 hours, and have bounded cleanup support.
- Backup/restore scripts and successful PostgreSQL 17 restore drills.
- Invite/member/session lifecycle administration and seven-day account deletion.
- Checksummed migration ledger, migration 0002, migration-aware readiness, and least-privilege role grants.
- Migration 0003 operational evidence, maintenance/metrics/redacted logs, and encrypted backup/restore.
- Pinned Hub CI, affected Character Sheet/DM Screen regressions, fresh PostgreSQL/role checks, SBOM/image
  evidence, secret/audit gates, and real-stack Playwright.
- Provider-gated client IPs shared by logs/rate limits/WebSocket context, plus server ping/pong heartbeat.
- Stable client-side failure classification for offline transport, unreadable responses, service/database
  outages, protocol skew, access loss, quotas, resources, transfers, leases, and revision conflicts.
- Campaign pages retain loaded data while offline, require a refresh after reconnecting, offer a direct reload
  for protocol skew, and become read-only immediately after session, membership, or permission loss.
- Oracle-ready systemd timers for maintenance, encrypted backup, and five-minute host checks; a host bind mount
  for encrypted archives; and a non-destructive off-machine pull script.
- Operator-triggered Oracle release automation with process locking, UID/GID 1001 backup mapping, immutable
  tag/SHA drift protection, verified pre-release backup, migration policy, compatible app-only rollback,
  protected endpoint/static asset checks, and redacted evidence.

## Final verification

- Blocker-only security/correctness review: no unresolved high-severity findings.
- Complete broad Jest gate: 601 suites and 17,495 tests passed. The Phase 6A Hub gate passes
  30 suites / 216 tests, including documentation, invite-recovery, and sanitizer regressions.
- Character Sheet: 528 suites and 16,833 tests passed.
- DM Screen targeted regression: 9 suites and 166 tests passed.
- Fresh PostgreSQL 17 migration, real grant/transfer/quota transactions, compact receipt inspection, backup,
  and single-transaction restore passed against a UTF-8 drill cluster.
- Repository JavaScript lint, Hub/DM Screen SCSS lint/build, service-worker build, and production dependency
  audit passed.
- Signed-out Hub, signed-in Hub, and DM Campaign views were checked at desktop and 390 px mobile widths with
  clean consoles, no horizontal overflow, and 44 px visible controls.
- Phase 6B/C PostgreSQL drills covered lifecycle escrow restoration/detachment/purge and fresh, baseline,
  concurrent, failed, checksum-mismatch, and restored migration paths.
- Phase 6F real-stack Playwright: 2 scenarios passed in 50.5 seconds; the harness then restarted BFF and
  PostgreSQL independently and recovered migration-aware readiness after each.
- Phase 6F cancellation drill: SIGTERM exited 143 and removed the unique test project's containers, volumes,
  and networks.
- Phase 6G preparation: 42 Hub suites / 273 tests and both real-stack journeys passed in 53.8 seconds with
  heartbeat and provider adapter included.
- Staging baseline repair: the production static image builds `sw.js` and `sw-injector.js` from the exact
  release source, serves both required ICO assets with correct content types, and omits build-only tooling.
  Real-stack Playwright renders a live campaign projection as a labeled read-only Party Tracker row; both
  lifecycle scenarios and the BFF/database restart smoke pass.
- Character-campaign readiness journey: a valid Fighter copied from local storage, detached-character Hub
  discovery and attachment, clone-by-default behavior, rules/homebrew move review, another-device lease
  refusal without an implicit takeover, direct retry, and idempotent move replay all pass.
- Role-aware campaign page: DM and player layouts were checked at desktop and 390 px mobile widths with clean
  consoles and no horizontal overflow. The real-stack journeys pass with the administration disclosures,
  explicit empty/loading/success/failure states, and permission-aware request controls.
- Campaign interaction usability: the real-stack lifecycle grants a core-catalog item, spends a spell slot
  through the structured-action form, and transfers that named item with CP/SP/EP/GP/PP through the stack
  picker. The pending inbox identifies the actor, item/source, currency, endpoints, and approval state.
- Campaign DM Screen hardening: focused contracts cover DM/co-DM admission, player/archive denial,
  realtime lifecycle and terminal policy closure, stale projection state, role-loss shutdown, observable
  workspace save/conflict recovery, and live-projection exclusion from the persisted Board blob.
- Accessibility/responsive hardening: signed-out Hub Lighthouse accessibility is 100 with zero failed audits
  in desktop/day and 390x844 mobile/night snapshots. Real-stack checks cover keyboard skip focus, semantic
  headings, accessible control names, 44 px entry targets, 390x844 portrait and 844x390 landscape reflow, and
  Character Sheet campaign-panel focus restoration.
- Final player-test readiness browser gate: four real PostgreSQL/HTTPS journeys pass in 3.0 minutes. The
  realtime scenario proves direct Character Sheet HP/initiative propagation, DM visibility, second-device
  takeover, and stale-writer fencing. The final saturation scenario covers six members, 500 rolls, large
  documents, transfer contention, accepted-transfer picker refresh, and complete transactional-outbox drainage
  before cleanup. Independent BFF and PostgreSQL restart recovery and production-entry-point smoke pass
  afterward.

## V1 limitations

- Monster/NPC structured actions are not automated.
- Campaign brew intentionally rejects raw HTML and persistent blocklists.
- Full simultaneous character/Board co-editing is not supported; one active editor holds the lease.
- Offline players can view a cached copy only; cloud mutation requires an authenticated online session.
- Semantic proposals expire after a bounded 24 hours when observed/processed. Legacy pending actions are
  terminalized by migration 0005. Transfers still remain explicit inbox work until resolved or lifecycle-cancelled.
- Semi-public moderation, self-service recovery, billing, and legal/privacy publication are not enabled.
- Private V1 supports one BFF replica and therefore no multi-replica application HA.

## Remaining V1 gates

1. **Host-operations proof:** run the shipped release automation's Oracle dry run and deliberate release against
   the next verified `hub-*` tag; prove lock contention, pre-cutover backup failure, compatible app rollback,
   redacted evidence, uninterrupted Foundry, timers, encrypted off-machine backup, isolated restore,
   monitoring/alerts, and the schema-incompatible break-glass decision without restoring over production.
2. **Physical game day:** complete and record the private one-DM/two-player session with real GitHub OAuth and
   physical devices, then make an explicit go/no-go decision.

The [living roadmap](roadmap.md) owns scope, dependencies, and acceptance criteria for these gates and the
approved V2 program.
