# Campaign Hub Phase 0-5 checkpoint

> **Status:** Commit series in progress; three implementation layers committed
> **Captured:** 2026-08-24
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
| Documentation/handoff | Pending this commit | `docs/hub`, ADRs, checkpoint/history/roadmaps, traceability/risks/runbook structure, documentation/performance tests |

No commit has been pushed and no pull request has been opened.

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

Phase 6A adds documentation tests; rerun `npm run test:hub` before checkpointing.

## Checkpoint completion procedure

1. Commit the documentation/handoff layer after documentation/performance/full Hub checks.
2. Update this table with the documentation commit SHA in a tiny documentation-only record commit.
3. Run the full Hub suite and verify a clean working tree.
4. Declare migration 0001 immutable.
5. Mark the checkpoint gate complete; Phase 6B/6C may begin.
6. Do not push or open a PR without separate explicit instruction.
