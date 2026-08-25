# Campaign Hub implementation status

> **Last updated:** 2026-08-25
> **Owner:** Campaign Hub maintainers

## Status

Private invite-only V1 and portable launch readiness through Phase 6F are implemented on `multiplayer-hub`.
The code is ready for a
private-table staging deployment after the environment-specific gates below are completed. Semi-public
onboarding remains intentionally disabled.

Phase 6A documentation/handoff, the reviewed checkpoint series, Phase 6B lifecycle administration, Phase 6C
migration management, Phase 6D portable deployment, Phase 6E operations, and Phase 6F CI/real-stack
integration are complete.

- Lifecycle includes invite list/revoke, owner role changes, owner/co-DM member removal, voluntary leave,
  session/device revocation, immediate socket closure, workspace archive/restore, character detachment,
  escrow/action cleanup, and seven-day deletion request/cancel/purge with blocked-id reporting.
- Migration management includes immutable/checksummed files, advisory locking, baseline detection,
  status/plan/apply, migration-aware readiness, runtime/backup role grants, migration 0002, and
  fresh/baseline/concurrent/failure/checksum/restored-database drills.
- Current Hub validation passes 42 suites / 273 tests; repository JS lint and Hub SCSS build/lint pass.

Phase 6D portable deployment is implemented and locally verified: non-root/read-only BFF image, lightweight
static image, PostgreSQL 17, one-shot migration/role grants, least-privilege runtime, same-origin Caddy edge,
WebSocket forwarding, liveness/readiness, and graceful restart.

Phase 6E portable operations/observability is implemented: migration 0003 operational evidence, singleton
bounded maintenance, protected Prometheus metrics, bounded route/request correlation, query/secret-safe JSON
logs, SLO/alert catalog, AES-256-GCM backup/restore, dedicated backup/evidence roles, and executable deploy/
rollback/outage/outbox/rotation/incident runbooks. Real cleanup, singleton lock, role boundaries, tamper
failure, encrypted backup/restore, evidence-age metrics, and OAuth log sanitization were drilled. Managed
PITR, scheduling, dashboards, and alerts remain Phase 6G.

Phase 6F adds a pinned-action Hub pull-request workflow, deterministic install/lint/test/migration/supply-chain
gates, exact-image export with Node/image SBOMs and provenance, production-excluded synthetic authentication
derived from the exact release image, production-entry-point smoke, and an isolated disposable same-origin
HTTPS/PostgreSQL Playwright stack. Two multi-context journeys pass in 50.5 seconds, covering the private
lifecycle, real Character Sheet loading, six-member load, 500-event replay, near-limit character storage,
contended transfer reservation, and BFF/database restart recovery.

Phase 6G provider preparation compares four managed platforms and proposes DigitalOcean at approximately
$20-30/month with AWS fallback. The guarded `do-connecting-ip` adapter and 25-second WebSocket heartbeat are
implemented and pass the full real-stack gate. Provider/cost/region acceptance and live managed-infrastructure
evidence remain pending; no resource has been created.

## Implemented

- Private GitHub OAuth allowlist, server sessions, CSRF/origin checks, protocol gating.
- Accounts, campaigns, roles, invites, membership, export, archive, and ownership transfer.
- Local/cloud Character Sheet repository switch, non-destructive claim, clone, move, archive, lease takeover.
- Immutable campaign brew/rules versions and early page context activation.
- Private per-DM workspaces using the existing Board blob and lease fencing.
- Authenticated WebSockets, presence, visibility-filtered event replay, snapshots, outbox dispatcher.
- DM full character reads; limited player projections; live Party Tracker linked rows.
- Durable roll log.
- Structured effect proposals/approval, XP/item grants, party inventory, escrowed item/currency transfers.
- Whole-item transfers preserve Character Sheet invariants, rollback identity, and metadata-safe stack merges.
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

## Final verification

- Blocker-only security/correctness review: no unresolved high-severity findings.
- Complete broad Jest gate: 601 suites and 17,495 tests passed. The Phase 6A Hub gate passes
  30 suites / 216 tests, including documentation, invite-recovery, and sanitizer regressions.
- Character Sheet: 527 suites and 16,819 tests passed.
- DM Screen targeted regression: 6 suites and 138 tests passed.
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

## V1 limitations

- Monster/NPC structured actions are not automated.
- Campaign brew intentionally rejects raw HTML and persistent blocklists.
- Full simultaneous character/Board co-editing is not supported; one active editor holds the lease.
- Offline players can view a cached copy only; cloud mutation requires an authenticated online session.
- Semi-public moderation, self-service recovery, billing, and legal/privacy publication are not enabled.
- Private V1 supports one BFF replica and therefore no multi-replica application HA.

## Deployment gates

1. Configure managed PostgreSQL point-in-time recovery and execute the restore drill there.
2. Configure same-origin HTTPS routing and prove the selected exact-proxy or provider client-IP boundary.
3. Create the GitHub OAuth app and stable numeric allowlist.
4. Store independent cookie/CSRF/OAuth/database secrets in the deployment secret manager.
5. Complete a private-table staging session with real GitHub OAuth and multiple physical devices before
   inviting the V1 group.
