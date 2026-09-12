# Runbook: encrypted backup and restore drill

> **Status:** Current portable procedure
> **Last drilled:** 2026-09-12 on Oracle with release r7
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
docker compose --env-file .env.hub -f compose.hub.yml --profile backup \
  run --interactive=false -T --rm --no-deps --pull never backup
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

### Define the clocks before touching the archive

- **RPO** measures data age: `drill T0 - selected backup timestamp`. It must be at most 24 hours.
- **Continuous RTO** begins immediately before archive selection/access and ends only after restore, migrations,
  isolated application readiness, authenticated workflow validation, rollback rehearsal, cleanup, and redacted
  evidence finalization. It must be at most four hours.

Do not reset the RTO clock after a failed attempt. Record safe failures as part of the same drill.

### Restore safely

1. Record T0, then select the newest archive by modification time and verify its filename, size, SHA-256, mode,
   owner, and `HUBENC1` header.
2. Provision a unique internal network, named volume, and empty PostgreSQL 17.6 target. Never use production as
   the restore target and never attach the restored database itself to the production network.
3. Generate temporary database passwords with a URL-safe alphabet such as `openssl rand -hex 24`. Do not place
   unescaped Base64 passwords in connection URLs.
4. Obtain the encryption key through approved secret access without printing it. The host archive is mode
   `0600`; because the released operations image runs as `postgres`, stage a hash-verified encrypted copy in a
   drill-only volume owned by that user rather than loosening the source file.
5. Run the exact released operations image with:

```bash
DATABASE_URL=postgresql://.../hub_restore_drill \
HUB_OPERATIONS_DATABASE_URL=postgresql://hub_operations:.../hub \
HUB_BACKUP_ENCRYPTION_KEY=... \
HUB_RESTORE_CONFIRM=RESTORE \
npm run hub:restore:encrypted -- /secure/path/hub.dump.enc
```

The temporary restore runner may join both the isolated network and the discovered production private network
only when it must write the bounded `restore_drill` operational row. Remove the runner after saving safe exit
metadata and logs. Authentication failure/tampering must leave no plaintext output.

### Prove the restored service

1. Verify:
   - encrypted file SHA-256;
   - migrations through the required version, checksums unchanged, and no pending migration;
   - table/tenant/FK constraints;
   - account/campaign/character/audit/event/outbox counts;
   - exact released migration and role-grant images complete successfully;
   - exact released production BFF reaches readiness as `hub_runtime`;
   - source backup remains immutable.
2. Build `server/test.Dockerfile` only from the exact released BFF image. Expose its Caddy edge on loopback only
   with `HUB_APP_ORIGIN=https://localhost:8443`; never enable test auth in the production image or deployment.
3. Exercise authenticated session, campaign read/write, character state read/write, one inventory/shared
   interaction, one cross-character effect, and an authorization denial across a user/campaign boundary.
4. Follow [application/database rollback](rollback.md) to prove the prior exact application against the restored
   current schema, then return the isolated environment to the current exact release.
5. With separate approval, delete only the uniquely named/labeled drill resources and all temporary credentials.
   Preserve a redacted evidence summary and the production operational rows.

### 2026-09-12 Oracle evidence

- release: `hub-staging-2026-09-10-r7`, commit
  `77d955c053dcdfe949235620db93f7eba477af34`;
- archive: `hub-20260912T092100Z.dump.enc`, 139,651 bytes, SHA-256
  `a7737d5bb752805221020f295bd8efef71e9cd8fd496afd9dfc87f804ee80273`;
- schema: migrations `0001`-`0007`, zero unvalidated constraints;
- authenticated validation: four production-derived Playwright scenarios passed;
- rollback: exact preserved-r6 BFF/static authenticated reads passed on schema `0007`, followed by exact-r7
  readiness and authenticated reads;
- RPO: 3,865 seconds; continuous RTO: 6,772 seconds;
- cleanup: all drill containers, networks, volumes, temporary images, credentials, and session cookies removed;
- production: container identities unchanged, services healthy/running, restart counts zero;
- redacted host evidence:
  `~/.local/state/thelemar-hub/recovery-evidence/hub-rto-20260912T102525Z.json`, mode `0600`, SHA-256
  `f5d20e6ac3b3af5c2613dcd93086e52fdc260ea2678dd5abc35b43f9421fad00`.

## Alerts

- backup age >26h: investigate;
- >30h: high severity;
- restore drill >35d: high severity;
- failed evidence row: inspect stable code and preserve source archive.
