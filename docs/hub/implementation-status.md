# Campaign Hub implementation status

> **Last updated:** 2026-09-21
> **Owner:** Campaign Hub maintainers

## Status

Private invite-only V1 release `hub-staging-2026-09-10-r7` at
`77d955c053dcdfe949235620db93f7eba477af34` is deployed on the reused, Hub-only Oracle Always Free ARM
instance. Foundry was intentionally decommissioned and is not a release prerequisite. The same-origin HTTPS,
GitHub OAuth, PostgreSQL, static site, BFF, API, and WebSocket checks pass. Phase 6G deployment and the
authenticated recovery/rollback and genuine scheduled-operations evidence for V1-G1 are complete. The physical
one-DM/two-player game day remains V1-G2. Semi-public onboarding remains intentionally disabled.

Phase 6A documentation/handoff, the reviewed checkpoint series, Phase 6B lifecycle administration, Phase 6C
migration management, Phase 6D portable deployment, Phase 6E operations, Phase 6F CI/real-stack integration,
and Phase 6G Oracle deployment are complete.

All 59 planned implementation todos in the coordinating program are complete. The only remaining V1 evidence is
V1-G2's physical one-DM/two-player game day and explicit private-launch go/no-go.

The first `t7-auth-providers` layer provides migration 0006, provider-neutral identity/session provenance,
durable one-time OAuth transactions, and the validated registry. Layer 2 adds production Discord OAuth and
Google OIDC adapters, bounded provider HTTP/JWKS validation, paired first-enable preflight, signed-out provider
guidance, and deterministic memory/PostgreSQL/real-stack coverage. Layer 3 adds capability-gated own-identity
listing, fresh-reauth provider linking, different-identity unlinking, required-provider retention, complete
session/lease/socket rotation, account-level security UI, linked-outcome preflight support, and Memory/PostgreSQL
parity. Normal production configuration remains GitHub-only and `account.identity_linking.v1` remains
default-off pending rollout evidence.

The first r9 identity layer now adds ADR 0018 and migration 0008: signed-out invite links exchange the raw token
once for a five-minute server-side context bound to one durable OAuth transaction. Existing identities sign in
normally; a bound context signs an existing account in and joins the campaign atomically. When the default-off
`HUB_INVITE_ACCOUNT_ADMISSION_ENABLED` switch is enabled, an unknown identity creates account, identity,
session, and membership in that same transaction. Provider failure, replay, expiry, revoke, exhaustion, race,
or session-write failure consumes no invite and leaves no orphan authority. The provider-subject allowlist is no
longer first-account admission authority.
Transaction-specific signed OAuth cookies support multiple simultaneous starts from an empty shared cookie jar.
A failed, cancelled, or abandoned invite flow can rotate a separate five-minute opaque retry handle into a fresh
same-provider context when the old transaction cookie is present, without retaining the raw invite.

The stacked r9 entitlement layer adds migration 0009, provider-neutral `campaign:create` and
`platform:operate`, exact owner backfill, add-only designated-operator UUID reconciliation, real provider
reauthentication with session rotation, transaction-local freshness checks, hidden idempotent operator
administration, lifecycle/export protection, an ordinary-user account reauthentication/deletion flow, stable
UUID disambiguation for duplicate account names, and focused creator/operator browser states. Enforcement remains
default-off until release preflight. The descendant account-linking layer reuses that ordinary-user
account-level reauthentication authority and adds no migration.

The Oracle deployment now has deliberate one-command release automation in `deploy/hub/release.sh`. It locks
out concurrent operators, verifies an immutable annotated tag and clean exact checkout, records rollback
identity, creates and reads an encrypted pre-release backup, enforces expand/deploy/contract migration
compatibility, applies the checked-in Compose overlays, performs complete public/runtime/static/backup checks,
and emits redacted machine/human evidence. It can automatically roll back only compatible application images;
it never reverses migrations, restores a database, changes filesystem ownership, performs destructive Compose
or volume teardown, or mutates services outside the Hub Compose project.

V2-T0 release-automation implementation is **shipped** by
[PR #219](https://github.com/TrueMichato/ThelemarTools/pull/219), and V2-T1 legible activity history is
**shipped** by [PR #218](https://github.com/TrueMichato/ThelemarTools/pull/218). The release script's live
Oracle dry run, deliberate r7 release, image preservation, and failure-path evidence are now proven external
host-operations evidence rather than unfinished T0 implementation.

V2-T2 projection/privacy is shipped: versioned authorization-scoped projections, metadata-only realtime
invalidations, owner/DM/peer views, sharing controls, and fail-closed privacy coverage are implemented.

V2-T5 whole-site campaign context is implemented: account-bound device selection, lightweight Hub/shared-nav
switchers, early temporary brew/rules activation, authorized bare Character Sheet and DM Screen defaults,
explicit local routes, pinned-resource behavior, access-loss concealment, BFCache/reconnect revalidation, and
server capability `campaign.active_context.v1`. ADR 0015/V2-T6 now consumes its source/edition metadata and
teardown generation for content enforcement.

The focused `t2-effects-server-role` prerequisite slice established the ADR 0012 server contract without changing
the roadmap train status: protocol-v3 closed operations, immediate atomic DM/co-DM application, persistent
command/operation/event identity, owner/DM watermarks, opaque target refs, and the source-derived peer
proposal/terminal state machine. Production deliberately enables no successful `cost=none` peer template;
Cure Wounds was recognized and rejected as cost-bearing until the ADR 0016 slice below.

The V2-T6 selection foundation and source/species/edition content-policy slice are implemented behind the default-off
`campaign.rules_policy.v1` capability. It adds a closed schema-v2 catalog, schema-v1 compatibility adapter,
atomic immutable DM/co-DM publish/rollback, privacy-safe member summaries, and an accessible searchable manager.
Source/species/edition controls are labeled **Enforced** and use content-policy version 1. The shared evaluator
additionally promotes carry-weight and encumbrance-tier calculation/projection and policy-fenced carry writes
to **Enforced** on their proven surfaces. Other selectable settings (`tgtt.enabled`, exhaustion, jumping,
linguistics, and critical rolls) remain **Advisory**. Shared browser/server evaluation filters relevant
Character Sheet choices, reports legacy violations without rewriting characters, and rejects newly disallowed
admissions/deltas, including import, move/clone, direct patch, grant/award, and transfer acceptance, across
both the content-identity and carry rule sets. Builder/level-up choice enforcement for non-carry settings
remains outside this slice.

The first V2-T7 product slice extends the ADR 0012 substrate with ADR 0016 protocol-4 source costs. A player can
cast PHB/XPHB Cure Wounds from an authenticated campaign Character Sheet, spend one selected standard spell slot,
and target one privacy-visible player-owned campaign character. The target owner explicitly accepts or rejects;
the proposer can cancel; expiry and lifecycle cancellation consume nothing. Acceptance rederives under current
locks and commits the slot decrement plus deterministic healing atomically exactly once. The spell must remain a
currently usable class spell (including preparation where required), and changing the bound slot permanently
invalidates that proposal even if the slot is later restored. Source, target, and combined self-target operation
legs reconcile through unsaved/in-flight local edits and reconnect/resync. V2-T7 remains active: NPC/monster,
party/multi-target, generic-effect, broader spell/ability/resource, and partial-resolution work is not implemented.
The capability remains default-off for every new campaign: an active immutable rules version and exact
operator-managed campaign UUID enrollment are both required. Production rejects wildcard or malformed rollout
configuration, release automation checks enrolled campaign readiness before traffic changes, and already-open
Character Sheets now clear and resynchronize targeting when authoritative campaign context changes.

Wave A0 adds [ADR 0020](adr/0020-consented-multi-target-operations.md) and an executable read-only query proof.
It accepts a future fixed 1-8 target set, opaque unique per-leg invitations, independent per-character owner
responses, source-finalization consent for source-owned legs, collection expiry, one exact ordered
source-selected subset, and one-cost/all-selected-leg atomic finalization. Reviewed multi-target healing
templates may privately record a full-HP selected leg as applied/no-change while consuming the single source
cost. **No multi-target production capability is implemented by Wave A0:** the design-only PR contains no
migration; future additive migration 0010, protocol 6, routes, store methods, events, browser UX, and templates
remain absent and default-off. The draft is held pending the physical game-day GO/NO-GO.

The accepted design now also fixes bounded abuse/fairness limits (3 live collections/source character,
5/source account, 50/campaign, 20 pending invitations/target owner, explicit mutation throttles, and
oldest-pending cursor pagination), intentional bounded DM/co-DM workflow observation, and protocol-3/4/5
fail-closed behavior across mutation/read/WebSocket/resync/replay. Schema is predecessor-readable before use,
with cross-campaign source-account/target-owner caps serialized by ascending seed-10 quota locks before campaign
authority. The first accepted proposal sets a permanent FK-independent usage marker; later normal rollback to a
true pre-0010 binary is forbidden even after workflow cleanup and requires an aware bridge release unless a
separately reviewed destructive history/event/outbox/recovery export/purge is approved.

V2-T9 Campaign Overview is shipped by PR #243. The page is now a role-adaptive pinned session brief centered on
campaign identity, party readiness, attention, recent activity, and one role-specific next action. Existing effects,
transfers, XP, item awards, membership, homebrew, and rules capabilities remain available through progressive
disclosure. The same merge fences historical role replay against current authority, preserves archived read-only
bootstrap/event parity, closes archived mutation paths in both stores, and reads PostgreSQL cursor/snapshot authority
from one transactionally consistent view.

- Lifecycle includes invite list/revoke, owner role changes, owner/co-DM member removal, voluntary leave,
  session/device revocation, immediate socket closure, workspace archive/restore, character detachment,
  escrow/action cleanup, and seven-day deletion request/cancel/purge with blocked-id reporting.
- Migration management includes immutable/checksummed files, advisory locking, baseline detection,
  status/plan/apply, migration-aware readiness, runtime/backup role grants, migration 0002, and
  fresh/baseline/concurrent/failure/checksum/restored-database drills.
- The merged PR handoffs record the targeted Hub, Character Sheet, mutation, PostgreSQL, browser, lint, build,
  security, and supply-chain evidence summarized under [Final verification](#final-verification). Historical
  milestone totals below remain historical rather than being relabeled as a current baseline.

Phase 6D portable deployment is implemented and locally verified: non-root/read-only BFF image, reproducible
static image with release-built service workers, PostgreSQL 17, one-shot migration/role grants,
least-privilege runtime, same-origin Caddy edge, WebSocket forwarding, liveness/readiness, and graceful
restart.

Phase 6E portable operations/observability is implemented and its Oracle recovery path is proven: migration 0003 operational evidence, singleton
bounded maintenance, protected Prometheus metrics, bounded route/request correlation, query/secret-safe JSON
logs, SLO/alert catalog, AES-256-GCM backup/restore, dedicated backup/evidence roles, and executable deploy/
rollback/outage/outbox/rotation/incident runbooks. Real cleanup, singleton lock, role boundaries, tamper
failure, encrypted backup/restore, evidence-age metrics, and OAuth log sanitization were drilled. On Oracle,
manual jobs, external heartbeat/failure signaling, off-machine copying, authenticated isolated restore,
continuous RPO/RTO, exact-r6 compatibility, exact-r7 return, and exact cleanup passed on 2026-09-12. Genuine
scheduled maintenance and backup executions passed on 2026-09-13, completing V1-G1; managed PITR is
intentionally not part of the Oracle free-tier design.

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
`hub-staging-2026-09-10-r7` at `77d955c053dcdfe949235620db93f7eba477af34` is live on the Oracle VM
originally repurposed from Foundry. The deployment and recovery checks pass. Only genuine daily
maintenance/backup timer evidence and the physical one-DM/two-player game day remain before the V1 go/no-go.

## Implemented

- Existing-identity OAuth sign-in, default-off invite-gated first access, server sessions, CSRF/origin checks,
  and protocol gating.
- Accounts, campaigns, roles, invites, membership, export, archive, and ownership transfer.
- Local/cloud Character Sheet repository switch, non-destructive claim, clone, move, archive, lease takeover.
- Character Sheet-native local copy, detached-character recovery, clone-by-default campaign reuse, and
  compatibility-gated explicit move with another-device lease refusal.
- Role-adaptive Campaign Overview: a pinned session brief with campaign identity, one role-specific continuation
  action, party readiness, attention, recent activity, explicit zero/one/many-character launch behavior, and
  progressive disclosure for the preserved campaign workbench and administration surfaces.
- Human-readable campaign interactions: source inventory stack selection, all five currency denominations,
  named action/transfer inbox entries, spell-slot proposals with spell/action context, and a lazy DM item
  catalog combining core and active campaign-brew items.
- Hub-owned surfaces provide a keyboard skip path, persistent semantic page heading, named main and campaign
  regions, labeled form controls, WCAG AA primary-button contrast in day/night themes, and 44 px entry targets.
- Immutable campaign brew/rules versions and early page context activation.
- Capability-gated, versioned campaign rules catalog/selection with before/after review, immutable rollback,
  schema-v1 compatibility, stale-base fencing, privacy-safe read-only member summaries, enforced
  source/species/edition content controls, and enforced carry calculation/policy-identity fencing. Other
  TGTT/exhaustion/jumping/linguistics/critical-rolls settings remain advisory.
- Campaign content policy filters Character Sheet build/level-up/respec/Quick Build and content candidates,
  blocks disallowed new admissions and authoritative deltas in memory/PostgreSQL, and shows bounded actionable
  grandfather warnings without changing existing character documents or local/personal-brew behavior.
- Whole-site active campaign selection with same-profile convergence and independent device choices; local
  Character Sheets, DM Screens, personal brew, and signed-out pages never inherit stale campaign state.
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
- DM/co-DM item awards are one ordered atomic/idempotent batch across one to 50 active campaign characters, from
  the lazy catalog, authorized recent awards, campaign items, or one authoritative party-stash stack. Safe item
  metadata, a bounded note, advisory privacy-shaped carry previews, carry invalidation, deterministic audit/event
  ordering, stash conservation, and live Character Sheet reconciliation are implemented without changing local
  sheets.
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
- Archived campaigns bootstrap for authorized readers as read-only views, reject every mutation path in memory and
  PostgreSQL, preserve idempotent replay, and keep cursor/snapshot authority transactionally consistent.
- Oracle-ready systemd timers for maintenance, encrypted backup, and five-minute host checks; a host bind mount
  for encrypted archives; and a non-destructive off-machine pull script.
- Operator-triggered Oracle release automation with process locking, UID/GID 1001 backup mapping, immutable
  tag/SHA drift protection, verified pre-release backup, migration policy, compatible app-only rollback,
  protected endpoint/static asset checks, and redacted evidence.

## Final verification

The phase-specific counts below are preserved as the evidence recorded at those milestones; they are not silently
rewritten into a current whole-repository baseline. The latest merged handoffs add:

- PR #242: 93 Hub suites / 1,230 tests, 677 full Jest suites / 17,800 tests, 7/7 active-context, 6/6 rules-policy,
  and 11/11 content-policy mutants killed, plus 25 migrated runtime-role PostgreSQL tests and 24
  production-derived Chromium journeys.
- PR #243: complete Hub, mutation (7/7 active-context, 28/28 rules-policy, 12/12 content-policy), production-stack
  PostgreSQL/Chromium, JavaScript/style/build/security, and bounded desktop/mobile day/night review gates. Its
  pre-push full-Jest handoff recorded 678 passing suites plus two nested-Git fixture failures that then passed
  17/17 directly.
- PR #243 also recorded the existing `npm run test:data` LinkCheck discrepancy as 550 missing links in that
  checkout (534 from generated `data/crafting.json`, 16 elsewhere). This document does not present that
  environment-specific count as a newly verified current baseline.

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
- Multi-target semantic operations are design-only under ADR 0020; current live behavior remains the singular
  protocol-4 Cure Wounds flow.
- Campaign brew intentionally rejects raw HTML and persistent blocklists.
- Full simultaneous character/Board co-editing is not supported; one active editor holds the lease.
- Offline players can view a cached copy only; cloud mutation requires an authenticated online session.
- Semantic proposals expire after a bounded 24 hours when observed/processed. Legacy pending actions are
  terminalized by migration 0005. Transfers still remain explicit inbox work until resolved or lifecycle-cancelled.
- Semi-public moderation, self-service recovery, billing, and legal/privacy publication are not enabled.
- Private V1 supports one BFF replica and therefore no multi-replica application HA.

## V1 gates

1. **Host-operations proof — complete:** installation, manual drills, five-minute monitoring, encrypted
   off-machine backup, authenticated isolated restore, continuous RPO/RTO, exact-r6 rollback, exact-r7 return,
   exact cleanup, and the first genuine scheduled maintenance/backup executions passed by 2026-09-13.
2. **Physical game day:** execute the [private one-DM/two-player runbook](runbooks/private-game-day.md) with real
   GitHub OAuth and physical devices, then make an explicit go/no-go decision.

The [living roadmap](roadmap.md) owns scope, dependencies, and acceptance criteria for these gates and the
approved V2 program.
