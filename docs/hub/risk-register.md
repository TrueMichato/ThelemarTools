# Campaign Hub risk register

> **Status:** Active
> **Last reviewed:** 2026-08-24
> **Owner:** Campaign Hub maintainers

| ID | Risk | Trigger/evidence | Impact | Current mitigation | Detection | Next action |
|---|---|---|---|---|---|---|
| R-01 | Uncheckpointed large working tree | Phase 0-5 began uncommitted | Review/recovery ambiguity | Closed by reviewed checkpoint commits and 30-suite Hub validation; no push/PR yet | `git log`, clean-tree check | Closed; reopen only if later work accumulates without commits |
| R-02 | Schema could not evolve safely after first deployment | Phase 0-5 migrator applied one file without a ledger | Failed/repeated migration or unknown schema version | Closed by checksummed/advisory-locked ledger, baseline detection, migration-aware readiness, roles, and migration 0002 | Migration tests/status and PostgreSQL drills | Closed; every future schema change gets a new immutable version |
| R-03 | Administrative lifecycle was incomplete | Phase 0-5 lacked invite revoke, member removal, session management, and deletion | Operators would require direct DB access | Closed by Phase 6B APIs/UI, transactional cleanup, seven-day deletion, purge reporting, and tests | Lifecycle tests and purge output | Closed; monitor blocked purge ids in Phase 6E |
| R-04 | Portable BFF deployment was missing | Root image is static-only | Provider-specific drift and unsafe proxy setup | Closed by non-root BFF image, lightweight static image, one-shot migrations/grants, private/public networks, and same-origin edge | Deployment contracts and local Compose probes | Closed locally; Phase 6G verifies provider adaptation |
| R-05 | Managed backup objectives are unproven | Only local PostgreSQL drills completed | Data loss or recovery outside RTO | Portable backup/restore scripts | Backup age/restore evidence (not yet automated) | PITR + nightly encrypted backup; demonstrate RPO/RTO |
| R-06 | Outbox/maintenance failures are not observable enough | Dispatcher logs to process stderr; cleanup is manual | Delayed realtime, table growth | Claim/retry logic and health endpoint | Manual logs/database queries | Phase 6E metrics, alerts, singleton maintenance |
| R-07 | Browser/API behavior lacks real-stack E2E | Current browser checks used mocked API; domain tests inject Fastify | Boot/proxy/service-worker regressions can escape | Strong Jest contracts and manual browser checks | CI/manual staging | Phase 6F disposable stack and multi-context Playwright |
| R-08 | Provider proxy/header behavior can invalidate security assumptions | `HUB_TRUST_PROXY` must match exact proxy behavior | Origin/IP/rate-limit/cookie errors | Explicit configuration, exact-origin checks | Staging security tests | Select provider only after portable proxy contract |
| R-09 | Character/Board upstream churn | Active WIP files are large integration hotspots | Rebase regressions and duplicated persistence paths | Narrow repository/context seams and tests | Character Sheet/DM Screen suites | Maintain hotspot list and rebase checklist |
| R-10 | Private assumptions expand into public service | Enabling open registration without moderation/legal/quotas | Abuse, privacy, cost, tenant-security exposure | Numeric allowlist and invite-only campaigns | Configuration/release review | Keep public roadmap behind explicit gate |
| R-11 | Sensitive content leaks through logs/diagnostics | Characters include notes/backstory; OAuth and invite tokens exist | Privacy/security incident | Current API avoids response logging by design | No automated redaction scan yet | Phase 6E log field catalog and fixture scan |
| R-12 | Account deletion conflicts with audit/ownership/backups | User requests deletion while owning campaigns or appearing in history | Referential failure or incomplete deletion | Seven-day state machine, ownership block, lifecycle cleanup, FK anonymization, purge/block reporting implemented | Lifecycle tests, purge output, backup aging docs | Phase 6E schedules/alerts purge and records backup-aging evidence |
| R-13 | Realtime scale exceeds V1 assumptions | More sockets/events than private table target | Latency, replay pressure, reconnect storms | 500 replay/100 dispatch budgets | No production telemetry yet | Phase 6F load tests; Phase 6E metrics |
| R-14 | Supply-chain drift | Existing workflows use mutable action refs and broad `npm i` | Non-reproducible or compromised builds | Lockfile and dependency audit | Manual audit | Phase 6F deterministic CI, pinned actions, SBOM/image scan |

## Review rule

Review this register at every phase boundary, after any incident/security finding, and before go/no-go.
Closing a risk requires evidence in `traceability.md`; renaming or moving it is not closure.
