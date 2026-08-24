# Campaign Hub testing guide

> **Status:** Current automated coverage plus planned launch coverage
> **Last verified:** 2026-08-24
> **Owner:** Campaign Hub maintainers

## Test layers

| Layer | Location | Purpose |
|---|---|---|
| Pure domain | `test/jest/hub/HubActions.test.js`, `HubCloudDataValidation.test.js`, `HubCampaignContent.test.js` | Effects, escrow, quotas, sanitization, rules/brew validation |
| Repository proofs | `HubCharacterRepository.test.js`, `HubDmWorkspaceRepository.test.js` | Revision/lease/rebase/recovery semantics |
| HTTP repositories | `HubHttpCharacterRepository.test.js`, `HubHttpDmWorkspaceRepository.test.js` | API translation, retry, canonical ids, recovery |
| BFF/domain API | `HubServerApp.test.js`, `HubPhase1Domain.test.js` through `HubPhase4Domain.test.js`, `HubLifecycle.test.js` | Auth, campaigns, characters, content, realtime actions, lifecycle |
| Authorization/security | `HubAuthorizationMatrix.test.js`, `HubXssContract.test.js`, `HubInviteRoleSafety.test.js`, `HubRouteContract.test.js` | Tenancy, roles, XSS, schemas, route policy |
| Realtime | `HubRealtime.test.js`, `HubWebSocket.test.js`, `HubBroadcastSync.test.js` | Visibility, replay, presence, sockets, tabs |
| Integration seams | Character Sheet repository/rules/roll-history tests; `HubPartyTrackerProjection.test.js` | Existing page behavior and local/Hub separation |
| Static UI/PWA contracts | `HubPageContract.test.js`, `HubRoutePolicy.test.js`, `HubPerformanceBudget.test.js` | Required states, boot order, navigation, service-worker and fixed limits |
| Database contract | `HubMigrationContract.test.js`, local PostgreSQL drills | Schema clauses and real migration/transaction/restore |

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
    test/jest/hub/HubPartyTrackerProjection.test.js \
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
```

## Test data rules

- Never use a real OAuth token, invite token, database URL, or private character in fixtures.
- Use stable synthetic account/campaign labels and generated UUIDs.
- Malicious fixtures must be inert strings, not executable external resources.
- PostgreSQL drills use a disposable UTF-8 database and an isolated restore target.
- Test-auth code must live only in a test entry point and must fail startup in production mode.

## Required continuation coverage

Phase 6 adds:

- invite listing/revocation, member role/removal, session revoke, deletion grace/cancel/purge;
- migration ledger fresh/baseline/upgrade/checksum/concurrency/failure;
- least-privilege role tests;
- OCI/Compose boot, readiness, graceful shutdown, and proxy/WebSocket smoke;
- maintenance retention and log-redaction fixtures;
- real-stack multi-context Playwright;
- load and fault tests against documented budgets;
- restore evidence tied to one image/migration version.

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
