# Recovery, migrations and roles

## Migrations

Migrations are immutable, checksummed, forward-only, and advisory-locked.

```bash
DATABASE_URL=... npm run hub:migrate:plan
DATABASE_URL=... npm run hub:migrate
DATABASE_URL=... npm run hub:migrate:status
```

- Never edit applied SQL or ledger rows.
- Add the next migration and propose an explicit release policy entry. Its phase and
  `previousAppCompatible` value require operator review backed by a real prior-application compatibility
  argument; the migration author cannot self-clear the release gate.
- Prove fresh, prior-ledger/baseline, concurrent runner, failure rollback, checksum mismatch, readiness, role
  grants, and restored-database upgrade behavior.
- Classify expand/deploy/contract compatibility. Contract changes require a successful compatibility window and
  a separately authorized manual procedure.

Primary sources: ADR 0005, `docs/hub/migrations.md`, `server/src/migration-runner.js`,
`server/src/migration-version.js`, `deploy/hub/migration-policy.json`, and migration tests.

## Database roles

Use distinct identities:

- schema owner for migrations/grants;
- `hub_runtime` for BFF reads/writes, without schema ownership;
- `hub_backup` for read-only backup;
- operations/evidence role for bounded operational records.

```bash
DATABASE_URL=... \
HUB_RUNTIME_DB_ROLE=hub_runtime \
HUB_BACKUP_DB_ROLE=hub_backup \
npm run hub:grant-roles
```

Never weaken grants to make a release pass. Stop if the BFF uses the owner role.

## Encrypted backup

Production uses authenticated AES-256-GCM portable archives. The key is separate from the archive and neither
belongs in Git, logs, shell history copied into evidence, or user-visible output.

```bash
DATABASE_URL=... \
HUB_OPERATIONS_DATABASE_URL=... \
npm run hub:backup:encrypted -- /secure/path/hub-YYYY-MM-DD.dump.enc
```

Supply `HUB_BACKUP_ENCRYPTION_KEY` through the approved mode-0600 secret mechanism before invoking the command;
do not paste the key into a recorded command line.

The host-local archive is not sufficient evidence. Pull encrypted archives from a different trusted computer
with `deploy/hub/pull-backups.sh`; it copies new files only and never deletes remote/local archives.

## Isolated restore

Never point restore scripts at the live database. The scripts use destructive `pg_restore --clean --if-exists`
and rely on operator procedure for isolation.

1. Create a named empty PostgreSQL 17 drill target on the private network.
2. Select an immutable encrypted archive by timestamp/hash and retrieve the separate key.
3. Run the documented encrypted restore with `HUB_RESTORE_CONFIRM=RESTORE`.
4. Verify authentication/hash, migration ledger, constraints, bounded row counts, readiness, and representative
   authorized workflows without printing character/brew bodies.
5. Record duration and RPO/RTO evidence privately.
6. Delete only the explicitly named drill resource after separate authorization.

A real rollback preserves the current database first, validates an isolated target, then requires a separate
operator decision to switch databases and deploy a compatible image.

Pin validation to the exact deployed immutable application image and its matching migration set, not current
HEAD. Credit representative authenticated workflows only through a checked-in validator supported by that
release; if none exists, record that evidence item as blocked rather than inventing credentials or test-only
authentication machinery.

Primary sources: `docs/hub/operations.md`, `docs/hub/runbooks/backup-restore.md`,
`docs/hub/runbooks/rollback.md`, `server/scripts/backup-encrypted.mjs`, and restore scripts.
