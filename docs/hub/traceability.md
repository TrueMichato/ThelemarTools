# Campaign Hub traceability matrix

> **Status:** Active; expand with every continuation change
> **Last verified:** 2026-08-24
> **Owner:** Campaign Hub maintainers

| Requirement/invariant | Decision/reference | Implementation | Primary tests/evidence | Operational reference |
|---|---|---|---|---|
| Local mode remains unchanged | ADR 0001; `current-system.md` | local repositories in Character Sheet/DM Screen | Character Sheet persistence/repository suites; broad Jest gate | staging local-only scenario |
| Same-origin cookie BFF | ADR 0001; `security.md` | `server/src/app.js`, `index.js`, OAuth/security modules | `HubServerApp`, OAuth provider, route contract | `operations.md`; future deployment runbook |
| Tenant/role isolation | `permission-matrix.md` | route guards + PostgreSQL store + tenant constraints | `HubAuthorizationMatrix`, `HubInviteRoleSafety` | incident/member-removal runbooks (planned) |
| One active editor and fencing | ADR 0002 | character/workspace repos, lease tables, store writes | repository, Phase 1/2, Board save tests | troubleshooting lease section |
| Canonical docs, audit/event/outbox | ADR 0002 | migration/store/realtime dispatcher | repository, realtime, migration tests; PostgreSQL drill | future outbox runbook |
| Campaign brew never replaces personal brew | ADR 0003 | Hub brew context + temporary brew seam | `HubBrewContext`, Phase 2, XSS tests | content troubleshooting |
| Cross-user content is safe | ADR 0003; `security.md` | campaign/character validators and renderer escaping | campaign content, cloud validation, XSS contract | security incident runbook (planned) |
| Character quota applies after mutation | `performance.md` | `validateCloudCharacterData` in every write path | cloud validation, Phase 4 oversized grant/transfer | troubleshooting quota section |
| Realtime respects visibility | `realtime-protocol.md` | projections, store visible-event query, realtime | realtime/WebSocket/authorization tests | future outbox/realtime runbook |
| Transfers cannot duplicate/lose assets | `domain-model.md` | `hub-actions.js`, transactional store locks/escrow | Hub actions and Phase 4 domain | future stuck-transfer runbook |
| Service worker never caches auth/API | `security.md` | Hub route policy + `sw-template.js` | route-policy/service-worker build | stale-client staging scenario |
| Backup is portable and atomic | `operations.md` | backup/restore/pg-env scripts | local PostgreSQL backup/restore drill | backup/restore runbook |
| Managed recovery meets RPO/RTO | continuation decision | not implemented | staging restore evidence required | Phase 6E/G/H |
| Member/session/account lifecycle | continuation decision | not implemented | Phase 6B tests required | Phase 6B runbooks |
| Safe schema evolution | ADR 0005 planned | not implemented | Phase 6C migration matrix required | migration runbook |
| Reproducible deployment | ADR 0004 planned | not implemented | Phase 6D container/Compose smoke | deployment guide |
| Real-stack multi-context behavior | `staging-plan.md` | not implemented | Phase 6F Playwright and Phase 6H game day | staging evidence |

Use `not implemented` explicitly. A planned row must not be presented as current capability.
