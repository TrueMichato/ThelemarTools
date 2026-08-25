# Runbook: encrypted backup and restore drill

> **Status:** Current portable procedure
> **Last drilled:** 2026-08-25 locally
> **Owner:** Campaign Hub operator

## Backup

Requirements:

- read-only backup database role;
- separate operations-evidence role;
- base64 32-byte encryption key from secret manager;
- destination outside application runtime/host in production.

Local reference:

```bash
HUB_BACKUP_ENCRYPTION_KEY="$(openssl rand -base64 32)" \
docker compose --profile backup --env-file .env.hub -f compose.hub.yml run --rm backup
```

The script:

1. writes a temporary custom-format `pg_dump`;
2. encrypts via AES-256-GCM with random 12-byte IV;
3. writes mode 0600 with `HUBENC1` envelope and authentication tag;
4. deletes plaintext temporary data;
5. prints filename/size/SHA-256;
6. records successful/failed bounded evidence through `hub_operations`.

Store the encryption key separately from backup archives.

## Restore drill

1. Provision an empty isolated database.
2. Select backup by timestamp/hash and obtain its key through approved secret access.
3. Run:

```bash
DATABASE_URL=postgresql://.../hub_restore_drill \
HUB_OPERATIONS_DATABASE_URL=postgresql://hub_operations:.../hub \
HUB_BACKUP_ENCRYPTION_KEY=... \
HUB_RESTORE_CONFIRM=RESTORE \
npm run hub:restore:encrypted -- /secure/path/hub.dump.enc
```

4. Authentication failure/tampering must leave no plaintext output.
5. Verify:
   - encrypted file SHA-256;
   - migrations through required version;
   - table/tenant/FK constraints;
   - account/campaign/character/audit/event/outbox counts;
   - representative sign-in and workflows against the isolated BFF;
   - restore duration <=4h;
   - source backup remains immutable.
6. Record restore evidence, destroy drill environment, and review any RPO/RTO miss.

## Alerts

- backup age >26h: investigate;
- >30h: high severity;
- restore drill >35d: high severity;
- failed evidence row: inspect stable code and preserve source archive.
