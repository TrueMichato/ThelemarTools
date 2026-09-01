# Campaign Hub traceability matrix

> **Status:** Active; expand with every continuation change
> **Last verified:** 2026-09-01
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
| Character projections are authorization-scoped | `adr/0011-authorization-scoped-character-projections.md`, `data-lifecycle.md` | `server/src/character-projection.js`, both stores, `js/hub/hub-character-view.js`, `js/charactersheet/charactersheet-sharing.js` | `HubCharacterProjection`, `HubProjectionPolicy`, `HubProjectionCanary`, `HubProjectionLifecycle`, `HubPartyTrackerProjection` | migration 0004 |
| Transfers cannot duplicate/lose assets | `domain-model.md` | `hub-actions.js`, transactional store locks/escrow | Hub actions and Phase 4 domain | future stuck-transfer runbook |
| Service worker never caches auth/API | `security.md` | Hub route policy + `sw-template.js` | route-policy/service-worker build | stale-client staging scenario |
| Backup is portable and atomic | `operations.md` | backup/restore/pg-env scripts | local PostgreSQL backup/restore drill | backup/restore runbook |
| Oracle recovery meets RPO/RTO | ADR 0006; `roadmap.md` V1-G1 | encrypted backup/restore and scheduled-operation tooling implemented; off-machine/isolated proof active | exact-release staging restore/rollback evidence required | backup/restore and rollback runbooks |
| Member/session/account lifecycle | ADR 0007; data lifecycle | invite/member/session/deletion APIs, migration 0002, socket closure, purge command | lifecycle administration/API/migration/session tests and PostgreSQL drill | member removal, account deletion, session compromise runbooks |
| Safe schema evolution | ADR 0005; `migrations.md` | checksummed/advisory-locked runner, baseline fingerprint, migration-aware readiness, role grants | migration runner/contract/role tests and PostgreSQL fresh/baseline drills | migration guide; failure runbook pending |
| Reproducible deployment | ADR 0004; `deployment.md` | BFF/static images, Compose DB/migrate/grants/BFF/static/edge, live/ready probes | deployment contract, image build/inspect, Compose config/start/routing/restart probes | deployment guide |
| Technical retention and recovery signals | ADR 0006; `observability.md` | migration 0003, maintenance lock/cleanup, metrics, encrypted backup/restore, evidence role | maintenance/observability/encryption tests and real cleanup/backup/restore drills | operations and incident runbooks |
| Real-stack multi-context behavior | ADR 0008; `ci-and-provenance.md` | test-only BFF image, disposable Compose override/orchestrator, Hub page object and Playwright journeys | lifecycle/load scenarios, BFF/DB restart probes | CI artifacts; Phase 6H game day |
| Reproducible CI and supply-chain evidence | ADR 0008; `ci-and-provenance.md` | pinned workflow, secret scan, exact-image export, SBOMs, provenance writer, image scan; Oracle release from verified tag | `HubCiContract`, local SBOM/image build, GitHub CI, deployed tag `hub-staging-2026-09-01` at `8f181712` | V2-T0 release automation |
| Staging/launch provider | ADR 0010 (supersedes 0009); `provider-comparison.md` | `compose.hub.public.yml`, `deploy/hub/Caddyfile.public`; release `hub-staging-2026-09-01` at `8f181712` deployed on the existing Oracle A1 host under the C-ALT deviation | Compose overlay validation, successful live OAuth/PostgreSQL/API/WebSocket smoke, and exact-image real-stack browser gate; physical game day remains | `runbooks/oracle-provisioning.md`; `runbooks/oracle-operations.md` |
| One BFF replica in private V1 | `provider-comparison.md`; R-15 | single-VM Compose stack is inherently one replica | CI reconnect/replay and Phase 6G deploy-restart drill | shared-fanout ADR required before scale-out |
| Provider client-IP authenticity | ADR 0009 (superseded); R-08 | `server/src/client-ip.js` retained but inactive on Oracle; Caddy is sole ingress and `HUB_TRUST_PROXY` names its fixed private address | `HubClientIp`, `HubWebSocket`; Phase 6G client-IP drill confirms real addresses reach rate limits | re-enable `HUB_CLIENT_IP_HEADER` only if a managed provider is adopted |
| Quiet WebSocket survival | ADR 0010; `realtime-protocol.md` | 25-second server ping/pong heartbeat in `HubRealtime` | `HubRealtime`; managed-ingress idle drill pending | reconnect/resync fallback |

Use `not implemented` explicitly. A planned row must not be presented as current capability.
