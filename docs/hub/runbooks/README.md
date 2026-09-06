# Campaign Hub runbooks

> **Status:** Current portable and Oracle operations runbooks
> **Last reviewed:** 2026-09-06
> **Owner:** Campaign Hub maintainers

Runbooks are executable operational procedures. Each final runbook must contain:

- purpose and severity;
- prerequisites/permissions;
- safety warnings and stop conditions;
- exact provider-portable checks;
- ordered actions;
- verification and user-impact checks;
- rollback/recovery;
- evidence to record;
- escalation/owner;
- last drill date.

## Current procedure

- [Current setup, backup, restore, retention, and rotation](../operations.md)
- [Member removal](member-removal.md)
- [Account deletion grace and purge](account-deletion.md)
- [Session/device compromise](session-compromise.md)
- [Oracle host operations, backups, monitoring, and restore drill](oracle-operations.md)
- [Deploy and promote](deploy-promote.md)
- [Application/database rollback](rollback.md)
- [Encrypted backup and restore drill](backup-restore.md)
- [Database outage](database-outage.md)
- [Stuck/failed outbox](outbox-failure.md)
- [Secret rotation](secret-rotation.md)
- [Incident declaration and response](incident.md)
- [Database migration failure](migration-failure.md)
- [Private OAuth allowlist change](allowlist-change.md)
- [Authentication provider registry and rollback](auth-provider-registry.md)
- [Campaign ownership recovery](campaign-ownership-recovery.md)

## Historical reference

- [Oracle Cloud Always Free Phase 6G provisioning record](oracle-provisioning.md) — retained for provenance;
  its Foundry coexistence instructions are superseded, and current host operations route through the runbooks
  above.

The procedures are implemented. Private launch still requires installing and drilling the Oracle operations
units, producing a fresh off-machine backup and restore record, and rehearsing the exact release rollback.
