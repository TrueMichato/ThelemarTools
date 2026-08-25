# ADR 0005: Immutable checksummed forward-only migrations

Status: Implemented through lifecycle migration 0002

## Context

The current `hub:migrate` command applies `0001_hub_core.sql` directly. This is sufficient before first
deployment but unsafe once a database contains durable user data: reruns are not tracked, the application
cannot identify schema version, and later edits to 0001 would be ambiguous.

## Decision

1. Freeze 0001 at the Phase 0-5 checkpoint.
2. Add `hub.schema_migrations` with version, filename, checksum, applied timestamp, and app build metadata.
3. Acquire a PostgreSQL advisory lock before planning/applying migrations.
4. Apply each migration transactionally and fail closed on checksum mismatch.
5. Provide `status`, `plan`, and `apply` commands.
6. Support:
   - fresh databases;
   - verified pre-ledger Phase 0-5 databases, which record 0001 only after a schema fingerprint passes;
   - already-current databases.
7. Use forward-only migrations. Database rollback is PITR/restore combined with a compatible application
   image, not destructive down SQL.
8. Split migration-owner and runtime database privileges.
9. Make readiness require the migration version expected by the running app.

## Consequences

- Applied migration files become immutable artifacts.
- Every schema change requires a new numbered migration and documentation.
- A failed migration leaves the previous schema intact where PostgreSQL transactional DDL permits.
- Provider deployment must support a one-shot migration job before BFF readiness.

## Rejected alternatives

- Edit/reapply 0001 after launch: cannot prove database history.
- Automatic schema mutation from BFF startup: couples availability and privilege escalation.
- General down migrations: cannot reliably reverse data transformations and increase incident risk.
