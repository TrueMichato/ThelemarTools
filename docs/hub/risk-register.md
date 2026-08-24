# Campaign Hub risk register

> **Status:** Active
> **Last reviewed:** 2026-08-24
> **Owner:** Campaign Hub maintainers

| ID | Risk | Trigger/evidence | Impact | Current mitigation | Detection | Next action |
|---|---|---|---|---|---|---|
| R-01 | Uncheckpointed large working tree | Phase 0-5 remains uncommitted | Review/recovery ambiguity | Backup branch preserves old ref; tests/docs record state | `git status`, change inventory | Decide checkpoint/PR strategy before Phase 6 implementation |
| R-02 | Schema cannot evolve safely after first deployment | Current migrator applies one SQL file without a ledger | Failed/repeated migration or unknown schema version | Fresh/restore drills only | Startup health, manual schema inspection | Phase 6C checksummed migration ledger and roles |
| R-03 | Administrative lifecycle is incomplete | No invite revoke, member removal, session list/revoke, or deletion workflow | Operators require direct DB access; stale access/data | Route authorization and current-session logout | Support reports, authorization tests | Phase 6B lifecycle administration |
| R-04 | No portable BFF deployment image/topology | Root image is static-only | Provider-specific drift and unsafe proxy setup | Same-origin contract documented | Deployment review | Phase 6D OCI/Compose stack |
| R-05 | Managed backup objectives are unproven | Only local PostgreSQL drills completed | Data loss or recovery outside RTO | Portable backup/restore scripts | Backup age/restore evidence (not yet automated) | PITR + nightly encrypted backup; demonstrate RPO/RTO |
| R-06 | Outbox/maintenance failures are not observable enough | Dispatcher logs to process stderr; cleanup is manual | Delayed realtime, table growth | Claim/retry logic and health endpoint | Manual logs/database queries | Phase 6E metrics, alerts, singleton maintenance |
| R-07 | Browser/API behavior lacks real-stack E2E | Current browser checks used mocked API; domain tests inject Fastify | Boot/proxy/service-worker regressions can escape | Strong Jest contracts and manual browser checks | CI/manual staging | Phase 6F disposable stack and multi-context Playwright |
| R-08 | Provider proxy/header behavior can invalidate security assumptions | `HUB_TRUST_PROXY` must match exact proxy behavior | Origin/IP/rate-limit/cookie errors | Explicit configuration, exact-origin checks | Staging security tests | Select provider only after portable proxy contract |
| R-09 | Character/Board upstream churn | Active WIP files are large integration hotspots | Rebase regressions and duplicated persistence paths | Narrow repository/context seams and tests | Character Sheet/DM Screen suites | Maintain hotspot list and rebase checklist |
| R-10 | Private assumptions expand into public service | Enabling open registration without moderation/legal/quotas | Abuse, privacy, cost, tenant-security exposure | Numeric allowlist and invite-only campaigns | Configuration/release review | Keep public roadmap behind explicit gate |
| R-11 | Sensitive content leaks through logs/diagnostics | Characters include notes/backstory; OAuth and invite tokens exist | Privacy/security incident | Current API avoids response logging by design | No automated redaction scan yet | Phase 6E log field catalog and fixture scan |
| R-12 | Account deletion conflicts with audit/ownership/backups | User requests deletion while owning campaigns or appearing in history | Referential failure or incomplete deletion | Export/ownership transfer exist | Manual review | Phase 6B seven-day state machine and data lifecycle |
| R-13 | Realtime scale exceeds V1 assumptions | More sockets/events than private table target | Latency, replay pressure, reconnect storms | 500 replay/100 dispatch budgets | No production telemetry yet | Phase 6F load tests; Phase 6E metrics |
| R-14 | Supply-chain drift | Existing workflows use mutable action refs and broad `npm i` | Non-reproducible or compromised builds | Lockfile and dependency audit | Manual audit | Phase 6F deterministic CI, pinned actions, SBOM/image scan |

## Review rule

Review this register at every phase boundary, after any incident/security finding, and before go/no-go.
Closing a risk requires evidence in `traceability.md`; renaming or moving it is not closure.
