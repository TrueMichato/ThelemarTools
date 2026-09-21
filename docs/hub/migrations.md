# Campaign Hub migration guide

> **Status:** Implemented through source-cost binding migration 0010
> **Last verified:** 2026-09-21
> **Owner:** Campaign Hub maintainers

## Invariants

- `0001_hub_core.sql` is immutable after checkpoint commit `83047210`.
- Every later schema change uses the next numbered SQL file.
- Migration files after 0001 do not contain `BEGIN`, `COMMIT`, or `ROLLBACK`; the runner owns transactions.
- Applied filename/checksum changes fail closed.
- Only the migration owner runs schema migrations and default-privilege grants.
- The BFF runtime role cannot create/alter schema.
- Rollback means compatible application rollback plus PITR/restore, not a destructive down migration.

## Commands

```bash
# Show applied and pending migrations without changing the database
DATABASE_URL=... HUB_DATABASE_SSL=true npm run hub:migrate:status

# Show whether pending versions will be applied or 0001 will be baselined
DATABASE_URL=... HUB_DATABASE_SSL=true npm run hub:migrate:plan

# Acquire the migration advisory lock and apply pending work
DATABASE_URL=... HUB_DATABASE_SSL=true npm run hub:migrate
```

The runner reads `server/migrations/*.sql`, ordered by four-digit version.

## Ledger

`hub.schema_migrations` records:

- `version`;
- immutable `filename`;
- SHA-256 `checksum`;
- applying app/package version;
- database application timestamp.

The runner holds a session-level PostgreSQL advisory lock while planning/applying so concurrent deploys cannot
race.

## Fresh database

1. Plan reports `0001` as `apply`.
2. The self-transactional 0001 file creates the schema.
3. The runner creates the ledger and records 0001.
4. Later migrations run one transaction each and record their ledger row in that transaction.
5. Rerun reports no pending work.

The runner reports 0001 in `appliedNow` for a fresh database.

## Existing pre-ledger database

For a database created by the Phase 0-5 script:

1. Plan detects `hub.accounts` and no ledger.
2. It verifies the complete baseline table set, critical columns, and tenant triggers.
3. Plan reports 0001 as `baseline`, never replay.
4. Apply creates the ledger and records the current frozen 0001 checksum.
5. Later migrations apply normally.

If the fingerprint is incomplete, baselining fails. Do not force-insert a ledger row.

## Authoring migration 0002+

1. Choose the next four-digit version and descriptive lowercase filename.
2. Do not edit older files.
3. Make statements safe inside one PostgreSQL transaction.
4. Add constraints/indexes only after proving existing rows satisfy them.
5. For large/rewrite operations, document lock/runtime impact and use a phased migration if needed.
6. Update:
   - `HUB_REQUIRED_MIGRATION_VERSION`;
   - domain/data-lifecycle/API references;
   - migration tests for fresh and upgrade paths;
   - backup/restore and rollback runbooks;
   - traceability/risk/status.
7. Test against:
   - fresh database;
   - current checkpoint database;
   - already-upgraded database;
   - intentional failure;
   - checksum mismatch;
   - concurrent runners;
   - restored database.

Current migrations:

- 0001 canonical Hub schema;
- 0002 lifecycle administration and deletion-safe foreign keys;
- 0003 operational maintenance/backup/restore evidence.
- 0004 additive character projection policy/revision columns; existing rows adopt the `table` preset.
- 0005 semantic operations/commands, stable lifecycle-event linkage, random character target references,
  owner/DM operation watermarks, bounded proposal expiry, and terminalization of legacy arbitrary proposals.
- 0006 provider-neutral identity metadata, session identity provenance, deferred last-identity protection, and
  durable one-time OAuth transaction bindings/cleanup.
- 0007 atomic peer source-cost bindings, deterministic derivation pins, source-result/event linkage, terminal
  `failed` state, and source/target revision observations for protocol-4 operation legs.
- 0008 short-lived invite admission contexts, hash-only browser/retry correlation, their one-to-one OAuth
  transaction binding, and bounded terminal account/session/membership outcome evidence.
- 0009 provider-neutral account entitlements, one-time current-owner creator backfill, nullable actor
  provenance, active-row indexes, and deferred last-operator protection.
- 0010 source-cost ABA identity normalization aligned with the shared resolver: trim all ids, lowercase UUIDs
  only, preserve non-UUID case, and retain every matching resource plus feature/innate mirror in the binding
  snapshot so duplicate cardinality cannot disappear behind `LIMIT 1`.

Migration 0007 is additive and keeps protocol-3 cost-free rows readable while new source-cost rows require a
protocol-4 application. Migration 0006 is additive and leaves existing GitHub subjects, account ids, and old
application reads intact.
Migration 0008 is additive and ignored by the previous application. Enabling invite-based creation is a separate
application/data compatibility boundary: keep it disabled until the stacked creator-entitlement layer and
rollback procedure are reviewed.
Migration 0009 is additive and previous-application-compatible: older code ignores the new table. Application
rollback leaves it in place and turns campaign-creation enforcement off; there is no database down migration.
The deferred trigger always protects entitlement-row revocation. Its account-status branch runs only when the
current application sets the transaction-local operator guard, so an exact predecessor using the additive
schema does not receive an unknown raw constraint failure. Entitlement rows removed by an account cascade are
also exempt: current code prevents last-operator deletion before the account transition, while predecessor
request/purge remains schema-compatible.
Migration 0010 is additive and previous-application-compatible. It replaces only immutable trigger helper
functions used by the existing migration-0007 source-cost invalidation trigger; it adds no tables, columns,
routes, descriptors, or capability. Exact predecessor code continues to read and write the same schema, while
the trigger conservatively invalidates proposals whose trimmed/case-sensitive identity or duplicate cardinality
changes.
Migration 0005 is additive apart from terminalizing legacy `structured_effect` rows still in `proposed`.
Protocol v3 never resolves those legacy bodies. The disposable PostgreSQL stack applies 0001-0010, grants the
runtime role, boots the production image against required version 0010, and runs semantic role/replay/
source-cost atomicity/concurrency/expiry/lifecycle persistence checks.

ADR 0020 requires a future additive `0011_multi_target_semantic_operations.sql`, but Wave A0 intentionally adds
neither that SQL file nor a migration-policy entry. When A3 authors it, the policy phase is `expand` and
`previousAppCompatible: true` describes only schema-before-use: a true pre-0011 binary is operationally
compatible only while the planned singleton `hub.semantic_multi_target_usage` marker is absent. The first
accepted proposal inserts that marker transactionally; it has no FK to cleanable history and normal retention
never deletes it. Once present, normal rollback must target a bridge/r10+ binary which understands
`target_set_version`, normalized target history, expiry, retention, purge cleanup, and the marker. A true
pre-0011 rollback is blocked whenever the marker exists, regardless of current parent/child counts; destructive
history/event/outbox/recovery export and purge, with marker deletion last, requires separate review and is not
normal rollback. Runtime receives only SELECT/INSERT on the marker, backup receives SELECT, and restore/preflight
tests must preserve it.

## Readiness

`PostgresHubStore.pCheckHealth()` requires:

- `hub.accounts`;
- `hub.schema_migrations`;
- the version exported by `server/src/migration-version.js`.

An application newer than the database remains unready rather than serving partial behavior.

## Database roles

Create provider roles/passwords outside the repository, then run grants as the migration/schema owner:

```bash
DATABASE_URL=... \
HUB_RUNTIME_DB_ROLE=hub_runtime \
HUB_BACKUP_DB_ROLE=hub_backup \
npm run hub:grant-roles
```

Runtime role receives:

- schema usage;
- table select/insert/update/delete;
- sequence usage/select;
- matching default privileges;
- explicit no schema create.

Backup role receives:

- schema usage;
- table/sequence select;
- matching default privileges;
- explicit no schema create.

The grant script validates role identifiers. It does not rotate existing passwords. When a validated
configured role is missing and its password environment variable is supplied, it creates the login role
transactionally before grants; this supports role additions on already-initialized databases. Run it as the
same role that will create future migration objects so default privileges apply correctly.

## Failure response

- Capture app/image, operation, migration plan, database target name, and exact error without credentials.
- Do not edit the ledger or migration file.
- A later migration failure rolls back that migration transaction.
- A crash after 0001 but before ledger creation is recovered through verified baseline detection.
- If schema/data crossed an irreversible boundary, stop the BFF and use the migration/restore runbook once
  Phase 6E completes it.
