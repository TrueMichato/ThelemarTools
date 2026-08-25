# Runbook: deploy and promote

> **Status:** Portable procedure; provider commands pending Phase 6G
> **Owner:** Campaign Hub operator

## Preconditions

- clean reviewed commit;
- immutable BFF/static image digests with source/version/protocol/migration labels;
- Hub, migration, container, security, and documentation gates passed;
- backup age <26h and last restore drill <35d;
- migration plan reviewed;
- rollback image and recovery point recorded.

## Procedure

1. Record source SHA, image digests, package/protocol/required migration versions.
2. Run migration `plan` against staging/target with schema-owner credentials.
3. Take/verify encrypted portable backup and provider PITR recovery point.
4. Run one-shot migrations.
5. Run role grants as schema owner.
6. Start BFF by digest with runtime role only.
7. Wait for liveness then readiness.
8. Start/update same-origin edge/static service.
9. Probe:
   - `/api/live`, `/api/ready`, `/api/session`;
   - HTTPS `__Host-` OAuth cookie;
   - WebSocket upgrade reaches BFF;
   - outbound GitHub API;
   - protected metrics.
10. Run synthetic sign-in/campaign read in staging.
11. Observe 5xx, latency, outbox, DB, and reconnect metrics for the promotion window.
12. Record evidence and approve/abort.

## Stop conditions

- migration checksum/plan mismatch;
- backup/restore evidence missing;
- readiness failure;
- BFF using owner database role;
- origin/cookie/proxy mismatch;
- privacy/authorization regression;
- outbox starts aging.

## Rollback

Use [rollback.md](rollback.md). Never edit the migration ledger or run an ad-hoc down migration.
