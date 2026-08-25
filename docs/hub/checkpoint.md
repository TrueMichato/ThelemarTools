# Campaign Hub checkpoint record

> **Status:** Complete and validated through Phase 6F
> **Captured:** 2026-08-25
> **Branch:** `multiplayer-hub`
> **Base/HEAD at capture:** `c91554179649944665a52b7ed5a82d4af5a5eb8c`
> **Owner:** Campaign Hub maintainers

## Why this document exists

The Phase 0-5 implementation began as a large working tree based directly on
`origin/character-sheet-wip`. The approved checkpoint strategy separates it into reviewable backend, browser,
existing-site integration, and documentation layers before Phase 6B/6C implementation begins.

The pre-sync historical branch tip remains preserved at:

```text
backup/multiplayer-hub-pre-sync-81f5aa1a
```

That backup is historical rewritten-equivalent work, not the current Campaign Hub implementation.

## Commit series

| Layer | Commit | Contents |
|---|---|---|
| Authoritative backend | `830472104133684da7cfab2df5dfdcb2582d2161` | Dependencies, migration 0001, BFF/security/domain helpers, PostgreSQL/memory authorities, operations scripts, shared JSON patch, server/domain tests |
| Browser Hub client | `03e7fed33de5bc2d05cf3bcf828bbffb0ed785cc` | Hub/Campaign pages, browser repositories/context/realtime, brew/renderer/PWA/navigation seams, Hub styles and client tests |
| Character Sheet/DM Screen integration | `f8e07e7020908821f3bee10dc2f0cbc872aea556` | Character Sheet cloud/context/roll integration, private Board/Party Tracker projection integration, styles and focused tests |
| Documentation/handoff | `5a5da87394e369a44f8fdb270fa22dc2db427f8a` | `docs/hub`, ADRs, checkpoint/history/roadmaps, traceability/risks/runbook structure, documentation/performance tests |

No commit has been pushed and no pull request has been opened.

Checkpoint metadata was recorded in `b2405f2e` after the four primary layers.

`HubRealtime.test.js` spans the server dispatcher/visibility authority and browser reconnect/order client. Its
test file lands in the backend commit while the browser client lands in the immediately following browser
commit; the checkpoint-level Hub gate validates the combined contract.

## Continuation commit series

| Phase/layer | Commit | Contents |
|---|---|---|
| 6B/6C lifecycle and migrations | `24fa150f785d3825fefad048d126e850831fc931` | Invite/member/session/account lifecycle, seven-day deletion, migration ledger and 0002 |
| 6D portable deployment | `cab23807767edb71fc7131998c0936b9310c5e50` | Production BFF/static images, PostgreSQL/migration/grant services, same-origin HTTPS Compose topology |
| 6B-6D documentation | `fc507679066eeae095fc053ca4e0a89c064725b1` | Lifecycle, migration, role, deployment, and runbook record |
| 6E operations | `3b76da439762ed81bd2550235f1cc0a211f53227` | Migration 0003, maintenance, metrics/logging, encrypted backup/restore and evidence |
| 6E SLO/runbooks | `44d0fe142d0f2005c3cf7cc79393a277175c4239` | SLO/alert catalog and deploy/rollback/outage/incident procedures |
| 6F CI/E2E implementation | `68476c71a6b9b8cc046b2ac608340c2b91200fb5` | Pinned Hub CI, exact-image evidence, test-only auth, disposable real-stack Playwright, scale/fault/security contracts |
| 6F documentation | `39a0a0d805a8500271e38c2f5962490758db4bda` | CI/provenance boundary, Phase 6F evidence, traceability, risk and roadmap status |

Nothing in the continuation series has been pushed and no pull request has been opened.

## Change groups

### New product surfaces

- `hub.html`
- `campaign.html`
- `scss/hub.scss`
- generated `css/hub.css`
- all `js/hub/*.js`

### Production authority

- `server/.env.example`
- `server/migrations/0001_hub_core.sql`
- `server/scripts/*.mjs`
- `server/src/*.js`

### Existing integration seams

- Character Sheet controller/state/export/roll-history/spawn-driver modules;
- DM Screen Board and Party Tracker modules;
- personal/temporary brew utility modules;
- renderer attribute escaping;
- global navigation;
- service-worker template;
- package manifest/lockfile;
- DM Screen SCSS/generated CSS.

### Regression coverage

- all `test/jest/hub/*.test.js`;
- Character Sheet campaign-rules/repository seam tests;
- Character Sheet persistence and roll-history updates;
- targeted existing DM Screen suites.

### Documentation

- all `docs/hub/` references and ADRs.

Use:

```bash
git status --short
git diff --check
git diff --stat
git ls-files --others --exclude-standard
```

to verify the remaining documentation-only working tree before the fourth commit.

## Verification attached to this checkpoint

- complete broad Jest gate: 601 suites / 17,495 tests;
- Character Sheet: 527 suites / 16,819 tests;
- Hub before Phase 6A documentation: 29 suites / 212 tests;
- targeted DM Screen: 6 suites / 138 tests;
- JS lint, relevant SCSS build/lint, service-worker build, production dependency audit;
- fresh PostgreSQL 17 migration, real grant/transfer/quota transaction drill, receipt inspection, backup, and
  single-transaction restore;
- signed-out/signed-in Hub and campaign desktop/mobile browser checks.

Final combined validation after the series:

- `npm run test:hub`: 30 suites / 216 tests passed;
- documentation contract: 4 tests passed;
- staged and final diff checks passed;
- working tree was clean before closing the checkpoint status.

## Checkpoint result

- The reviewed commit series and checkpoint metadata are durable.
- Migration 0001 is now immutable; future schema work begins at migration 0002 under ADR 0005.
- Phases 6A-6F are complete; Phase 6G managed-provider selection and staging is next.
- Do not push or open a PR without separate explicit instruction.
