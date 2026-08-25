# Runbook: database migration failure

> **Status:** Current portable procedure
> **Owner:** Campaign Hub operator

## Detect

- `hub:migrate` exits non-zero;
- checksum/file mismatch;
- BFF readiness reports missing required migration;
- one-shot migrator blocks BFF startup.

## Immediate actions

1. Stop deployment/promotion. Do not start a newer BFF against the old schema.
2. Record image/source, migration plan, database target, ledger rows, timestamp, and exact SQLSTATE/error
   without credentials/data bodies.
3. Do not edit applied migration files or ledger rows.
4. Verify the failed migration transaction rolled back and the prior application/schema remain compatible.

## Diagnose

- checksum mismatch: compare repository artifact to applied ledger; treat drift as supply-chain/release error;
- pre-ledger baseline failure: inspect missing tables/columns/triggers; never force baseline;
- permission failure: migrator must use schema owner, runtime role must not migrate;
- lock/wait: identify competing migrator/DDL and preserve advisory-lock semantics;
- data constraint failure: inspect aggregate counts, not private JSON bodies, and author a new forward migration
  or phased cleanup.

## Recover

- If prior schema remains usable, deploy/retain the prior compatible image and correct the next migration
  artifact.
- If an irreversible external effect occurred or compatibility is uncertain, follow rollback/restore.
- Rerun `status`, `plan`, `apply`, readiness, and representative workflows.

Never create an ad-hoc down migration during an incident.
