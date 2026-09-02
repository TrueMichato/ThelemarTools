# Campaign Hub testing guide

> **Status:** Current automated and real-stack coverage plus managed-staging gates
> **Last verified:** 2026-08-31
> **Owner:** Campaign Hub maintainers

## Test layers

| Layer | Location | Purpose |
|---|---|---|
| Pure domain | `test/jest/hub/HubActions.test.js`, `HubCloudDataValidation.test.js`, `HubCampaignContent.test.js`, `HubEventPresentation.test.js` | Effects, escrow, quotas, sanitization, rules/brew validation, privacy-safe activity normalization |
| Repository proofs | `HubCharacterRepository.test.js`, `HubDmWorkspaceRepository.test.js` | Revision/lease/rebase/recovery semantics |
| HTTP repositories | `HubHttpCharacterRepository.test.js`, `HubHttpDmWorkspaceRepository.test.js` | API translation, retry, canonical ids, recovery |
| BFF/domain API | `HubServerApp.test.js`, `HubPhase1Domain.test.js` through `HubPhase4Domain.test.js`, `HubLifecycle.test.js` | Auth, campaigns, characters, content, realtime actions, lifecycle |
| Authorization/security | `HubAuthorizationMatrix.test.js`, `HubXssContract.test.js`, `HubInviteRoleSafety.test.js`, `HubRouteContract.test.js` | Tenancy, roles, XSS, schemas, route policy |
| Realtime | `HubRealtime.test.js`, `HubWebSocket.test.js`, `HubBroadcastSync.test.js` | Visibility, replay, presence, observable connection state, terminal policy closure, sockets, tabs |
| Integration seams | Character Sheet repository/rules/roll-history tests; `DmScreenHubController.test.js`; `HubPartyTrackerProjection.test.js` | Existing page behavior, Campaign DM Screen access/recovery, live/manual Party Tracker separation, and local/Hub isolation |
| Static UI/PWA contracts | `HubPageContract.test.js`, `HubRoutePolicy.test.js`, `HubPerformanceBudget.test.js` | Required states, boot order, navigation, service-worker and fixed limits |
| Database contract | `HubMigrationContract.test.js`, local PostgreSQL drills | Schema clauses and real migration/transaction/restore |
| Real-stack browser | `test/e2e/hub/`, `test/e2e/pages/HubCampaignPage.ts` | Multi-user lifecycle, Character Sheet copy/attach/clone/move, leases, keyboard focus, phone reflow, labels/touch targets, and six-member/replay/quota/contention budgets |
| CI/supply chain | `.github/workflows/hub.yml`, `HubCiContract.test.js` | Pinned actions, deterministic gates, SBOM/image/provenance and test-auth isolation |

## Current commands

```bash
# Complete Hub suite
npm run test:hub

# Complete Character Sheet suite
NODE_OPTIONS='--experimental-vm-modules' \
  npx jest test/jest/charactersheet/ --no-coverage --forceExit

# Targeted DM Screen regression used for the checkpoint
NODE_OPTIONS='--experimental-vm-modules' \
  npx jest \
    test/jest/DmScreenNpcTracker.test.js \
    test/jest/DmScreenJourneyTracker.test.js \
    test/jest/DmScreenInitiativeTrackerNpcAppend.test.js \
    test/jest/DmScreenLairMarkers.test.js \
    test/jest/dmscreen/DmScreenNpcTrackerUx.test.js \
    test/jest/hub/DmScreenHubController.test.js \
    test/jest/hub/HubHttpDmWorkspaceRepository.test.js \
    test/jest/hub/HubPartyTrackerProjection.test.js \
    test/jest/hub/HubRealtime.test.js \
    --no-coverage --forceExit

# Entire Jest/unit corpus
npm run test:unit -- --no-coverage --forceExit

# Code/style/PWA
npm run test:js
npx stylelint scss/hub.scss scss/includes/dmscreen-party-tracker.scss
npx sass --style=compressed scss/hub.scss css/hub.css
npx sass --style=compressed scss/dmscreen.scss css/dmscreen.css
npm run build:sw

# Production dependency audit
npm audit --omit=dev --audit-level=high

# Tracked-file secret scan and disposable HTTPS/PostgreSQL E2E
npm run hub:check-secrets
npm run test:hub:e2e:stack
```

## Test data rules

- Never use a real OAuth token, invite token, database URL, or private character in fixtures.
- Use stable synthetic account/campaign labels and generated UUIDs.
- Malicious fixtures must be inert strings, not executable external resources.
- PostgreSQL drills use a disposable UTF-8 database and an isolated restore target.
- Test-auth code must live only in a test entry point and must fail startup in production mode.

## Remaining V1 target-environment coverage

The shipped V2-T0 release-automation implementation and V2-T1 activity history do not clear external Oracle
or physical-table gates. V1-G1 still requires the real-host dry run, deliberate release, induced lock/backup/
compatible-rollback failures, redacted evidence, uninterrupted Foundry, scheduled host operations, encrypted
off-machine backup, isolated restore, and break-glass decision rehearsal. V1-G2 remains blocked on V1-G1 and
requires the physical one-DM/two-player game day. Synthetic CI never substitutes for these gates.

## Evidence record

For each release candidate, record:

| Field | Value |
|---|---|
| Git commit/image digest | |
| App/protocol/migration versions | |
| Date/operator | |
| Unit/Hub/Character Sheet/DM Screen totals | |
| Migration paths tested | |
| Container/Compose result | |
| Dependency/SBOM/image scan result | |
| Browser contexts/devices | |
| Load/fault scenarios | |
| Backup id and restore target | |
| Restore duration and resulting checks | |
| Open defects/waivers | |
| Go/no-go decision | |

Evidence containing secrets or user data belongs in the approved private operational store, not Git.

## Phase 6B-6E evidence

- Hub: 39 suites / 254 tests.
- PostgreSQL 17: fresh 0001+0002, pre-ledger baseline+0002, concurrent runners, failed 0002 rollback,
  checksum mismatch, restored-database upgrade/readiness.
- Runtime role: CRUD allowed, schema create denied.
- Backup role: reads allowed, writes denied.
- Lifecycle: invite/member/session administration, escrow restoration, character detachment, restricted
  deletion reauthentication/cancellation, FK-safe purge.
- Browser: active account/device controls, pending-deletion surface, DM member/invite controls at desktop and
  390 px mobile with no console error/overflow.
- Deployment: BFF image build via configurable registry, UID 10001/read-only runtime, ~85 MB BFF and ~70 MB
  static images, Compose migration/grant ordering, least-privilege BFF readiness, static/API/auth/WebSocket
  edge probes, and graceful SIGTERM restart.
- Operations: migration 0003; singleton-lock and seeded technical cleanup drills; protected aggregate metrics;
  OAuth query/secret log scan; backup/evidence role boundaries; AES-GCM tamper failure; encrypted backup and
  isolated restore with matching SHA-256 and persistent age metrics.

## Phase 6F evidence

- Hub: 41 suites / 265 tests.
- Repository JavaScript lint, focused Hub/DM Screen SCSS lint, service-worker build, production dependency
  audit, tracked-file secret scan, and CycloneDX Node SBOM generation passed.
- Dedicated Playwright discovery: 2 tests in 2 files.
- Disposable same-origin HTTPS/PostgreSQL stack: both scenarios passed in 50.5 seconds in CI reporter mode.
- Lifecycle scenario: DM/player sign-in, campaign/invite, cloud Character Sheet, XP, structured damage, party
  inventory transfer, second-device session revoke, member removal/detachment, deletion request/cancel.
- Budget scenario: six active members, 1.4 MB character, 500 roll writes/replay page, concurrent transfer
  reservation with one success/one conflict.
- Fault probes: independent BFF restart and PostgreSQL restart both recovered `/api/ready`; stack teardown
  removed the unique per-run test project's containers, networks, volumes, and images without touching a
  normal Hub project or externally supplied production image.
- Cancellation drill: SIGTERM during a child image build propagated to the process group, exited 143, and
  left no matching containers, volumes, or networks.
- Supply chain: production BFF image builds, Node SBOM generation passes, and CI is configured to emit the
  exact image archive, image SBOM, provenance record, Trivy scan, and success/failure Playwright result.
- Image equivalence: the synthetic-auth layer derives from the downloaded production image, and the
  unmodified production image must boot its real entry point and become healthy against the migrated test
  database before Playwright starts.
- Secret fixtures cover direct/YAML, shell `export`, Docker `ENV`, inline JSON, continued lines, classic and
  fine-grained GitHub tokens, database URL, OAuth, cookie, CSRF, metrics, backup, and test-auth assignments.
  Large text/source files are scanned; only known binary formats are explicitly counted as skipped.

See [CI and provenance](ci-and-provenance.md) for job ownership, test-auth boundaries, and artifact semantics.

## Shipped V2 foundation evidence

- V2-T0 release automation shipped in [PR #219](https://github.com/TrueMichato/ThelemarTools/pull/219):
  25 focused release/deployment/documentation contracts, shell/Bash/Python validation, and Compose rendering
  passed. The PR explicitly leaves the live Oracle induced-failure drill to V1-G1.
- V2-T1 activity history shipped in [PR #218](https://github.com/TrueMichato/ThelemarTools/pull/218):
  75 targeted presentation/deployment/Character Sheet roll-history tests, the full Hub suite, disposable
  PostgreSQL lifecycle integration, JavaScript lint, style lint, and all four Hub CI jobs passed.

## Phase 6G preparation evidence

- Current Hub gate: 45 suites / 315 tests.
- `HubClientIp` verifies the supported header allowlist, single IPv4/IPv6 parsing, safe fallback, structured
  logging, rate-limit isolation, unsupported configuration, and mutual exclusion with proxy trust.
- `HubWebSocket` verifies the resolved provider client address reaches WebSocket connection context.
- `HubRealtime` verifies ping/pong liveness and termination after a missed heartbeat; `HubWebSocket` also
  verifies bounded code-1001 shutdown during plugin pre-close.
- Exact-image real-stack Playwright now covers four scenarios. The readiness journey verifies Hub discovery
  and attachment of detached characters, non-destructive clone as the default, compatibility review before
  an explicit move, another-device lease refusal, retry after lease release, and idempotent move replay.
- The role-aware campaign page contract covers role gating, primary player/DM tasks, inbox and activity states,
  disclosed administration, mutation feedback, and invite-copy behavior. Desktop DM and 390 px player layouts
  were checked with representative data, clean consoles, and no horizontal overflow.
- The lifecycle journey now grants a Longsword through the on-demand core item catalog, proposes and applies a
  contextual spell-slot spend, then selects that stack and transfers it with non-zero CP/SP/EP/GP/PP. The DM
  inbox asserts the human-readable actor, source, item, quantity, denominations, endpoints, and waiting state.
- The item-catalog unit contract combines regular items, base items, and active campaign brew, deduplicates by
  case-insensitive `name|source`, and surfaces loading failures without adding data files to initial Hub boot.
- The signed-out Hub scores 100 in Lighthouse accessibility snapshots in both desktop/day and 390x844
  mobile/night configurations. Both runs report zero failed accessibility audits.
- Real-stack Playwright verifies the skip link moves keyboard focus to the main landmark, the Hub and campaign
  retain a semantic `h1`, Hub-owned controls have accessible names, entry controls retain 44 px targets, and
  signed-out/campaign layouts do not overflow at 390x844 portrait or 844x390 landscape.
- The Character Sheet campaign flow verifies that opening the campaign panel moves focus to its destination
  picker and closing it restores focus to the replacement toggle.
- Failure-state hardening classifies fetch rejection, malformed success, and unreadable 503 responses without
  exposing browser-specific errors. Campaign UI contracts cover offline retention, reconnect refresh, direct
  protocol reload, terminal read-only access state, size/safety validation, insufficient transfer/resource,
  lease, and conflict copy.
- Real-stack lifecycle coverage now proves offline/reconnect posture, protocol-update recovery, an insufficient
  spell-slot action followed by rejection, client-side insufficient-currency feedback, and read-only state
  after live session and membership revocation.
- Realtime campaign coverage proves that accepted Character Sheet HP edits and initiative rolls reach the DM
  roster/activity view, a second device is initially read-only, lease takeover fences the stale writer, and
  campaign pages react immediately to session or membership revocation.
- Campaign snapshot consumers coalesce `character.projection.invalidated` metadata into one authorization-scoped HTTP refetch and fence older
  in-flight snapshot responses with the campaign event sequence, so an authoritative refresh cannot regress a
  newer visible projection. A single 10-second client watchdog requests an authoritative snapshot while the
  socket remains live, closing the gap where a missed outbox delivery could otherwise leave stale data visible.
- Moved-character browser coverage opens the old campaign URL and proves it canonicalizes before campaign
  context activation. Journey Tracker regressions prove linked campaign participants and their activity/slot
  references remain ephemeral.
- Transfer acceptance refreshes canonical character documents, shared inventory, balances, source/target/item
  pickers, and the inbox together; the lifecycle journey proves the accepted item is immediately selectable
  from party inventory without reloading.
- The saturation scenario runs after the interactive journeys, writes 500 rolls, exercises six members, large
  character documents and transfer contention, then waits for the transactional outbox to drain completely
  before cleanup.
- The current four-scenario PostgreSQL/HTTPS run passes in 3.0 minutes and still recovers from independent BFF
  and database restarts, passes production-entry-point smoke, and removes its isolated resources.
- Oracle operations contracts cover persistent systemd timers, host-readable encrypted backup output,
  non-destructive off-machine pulls, readiness/WebSocket/TLS/host/Compose/operational-metric checks, and the
  isolated restore procedure.
