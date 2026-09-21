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
5. Read `candidate_image_4` and `target_sha` from the selected release's mode-0600 `state.tsv`; this is the
   immutable released backup/operations image and its expected revision. Put `DATABASE_URL`,
   `HUB_OPERATIONS_DATABASE_URL`, and `HUB_BACKUP_ENCRYPTION_KEY` in a drill-only mode-0600 environment file
   outside the repository. The target URL must name the isolated PostgreSQL container on `drill_network`; the
   operations URL may name production `db` only for the bounded `restore_drill` evidence row.

```bash
release_state="$HOME/.local/state/thelemar-hub/releases/<release-id>/state.tsv"
restore_image="$(awk -F '\t' '$1 == "candidate_image_4" {print $2}' "$release_state")"
release_commit="$(awk -F '\t' '$1 == "target_sha" {print $2}' "$release_state")"
drill_env="$HOME/.local/state/thelemar-hub/restore-drill/<drill-id>.env"
drill_network="hub-restore-<drill-id>"
archive_volume="hub-restore-archive-<drill-id>"
archive_name="hub-YYYYMMDDTHHMMSSZ.dump.enc"
restore_runner="hub-restore-runner-<drill-id>"
production_private_network="<name discovered from the running production DB container>"

test "$(stat -c '%a' "$drill_env")" = "600"
test -n "$restore_image"
test "$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' \
  "$restore_image")" = "$release_commit"
docker network inspect "$drill_network" >/dev/null
docker network inspect "$production_private_network" >/dev/null
docker volume inspect "$archive_volume" >/dev/null
! docker container inspect "$restore_runner" >/dev/null 2>&1

docker create \
  --name "$restore_runner" \
  --network "$drill_network" \
  --env-file "$drill_env" \
  --env HUB_RESTORE_CONFIRM=RESTORE \
  --mount "type=volume,src=${archive_volume},dst=/secure,readonly" \
  "$restore_image" \
  node server/scripts/restore-encrypted.mjs "/secure/$archive_name"
docker network connect "$production_private_network" "$restore_runner"
docker start --attach "$restore_runner"
test "$(docker inspect --format '{{.State.ExitCode}}' "$restore_runner")" = "0"
```

Do not replace this with `npm run` from the host checkout; that would execute checkout code rather than the
released image. The temporary runner joins the isolated network for the restore target and the discovered
production private network only to write the bounded `restore_drill` operational row. Preserve it on failure
until safe exit metadata and logs are saved; remove it and the drill environment file during separately approved
exact cleanup. Authentication failure/tampering must leave no plaintext output.

### Prove the restored service

1. Verify:
   - encrypted file SHA-256;
   - migrations through the required version, checksums unchanged, and no pending migration;
   - table/tenant/FK constraints;
   - account/entitlement/campaign/character/audit/event/outbox counts;
   - at least one active platform operator and migration-0009 creator backfill invariants;
   - migration-0010 source-cost binding functions preserve trimmed UUID-only case folding, case-sensitive
     non-UUID ids, and duplicate match cardinality;
   - migration-0011 normalized parent/target/finalization constraints and role grants are present;
   - `hub.semantic_multi_target_usage` exactly matches the source archive: absent before use or present with one
     unchanged singleton after use. Never clear it to make a rollback preflight pass;
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
- schema: migrations `0001`-`0008`, zero unvalidated constraints;
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
