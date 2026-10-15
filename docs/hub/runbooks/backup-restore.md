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
  isolated application readiness, authenticated workflow validation, exact-image return, cleanup, and redacted
  private evidence finalization. It must be at most four hours. Do not pause or restart either clock for an
  approval wait, failed attempt, retry, fixture collision, or cleanup delay.

`server/scripts/restore-encrypted.mjs` is an **archive-import-only** helper. It does not write operational
evidence and its successful exit is not a successful restore drill. Use the reviewed recovery-driver
operations image that contains the import-only helper and finalizer; use the exact r11f BFF/static images and
matching r11f test harness for application validation. These are distinct source/image identities and must be
recorded separately.

Do not reset the RTO clock after a failed attempt. Record each safe failure in the private evidence file as
`{ "phase": "<phase>", "code": "<allowed code>", "at": "<ISO timestamp>" }` under `safeFailures`; use an
empty array when there were none; at most 100 records are accepted. Phases are `archive`, `restore`,
`baseline`, `test-harness`, `workflows`, `exact-release-return`, `cleanup`, and `finalization`. Codes are
`ARCHIVE_SELECTION_FAILED`,
`ARCHIVE_HASH_MISMATCH`, `DECRYPTION_FAILED`, `RESTORE_FAILED`, `MIGRATION_LEDGER_MISMATCH`,
`CONSTRAINT_VALIDATION_FAILED`, `FIXTURE_COLLISION`, `TEST_HARNESS_START_FAILED`, `WORKFLOW_FAILED`,
`EXACT_RELEASE_RETURN_FAILED`, `CLEANUP_FAILED`, `FINALIZATION_FAILED`, and `OTHER_SAFE_FAILURE`.
Never include raw error text, credentials, IDs, or restored content. Finalization preserves this bounded list
in the private summary and optional operational evidence details.

### Prepare exact-version application inputs before T0

Set the source paths to clean reviewed checkouts before the drill. The recovery-driver image is pinned by a
separately reviewed, mode-0600 `never-deployed-recovery-driver` manifest and evidence pair; it is not read from
a release `state.tsv` and must not have a successful deployment record. The r11f checkout must be exactly
`4578c8671a7b05066fb9a19411cb8a31cdd753ef`; Playwright page objects/specs and the test server are run from
that checkout. Use the exact BFF/static IDs below and a separately verified immutable Caddy image ID. Build
the test harness from the exact BFF image and r11f tree; record its resulting image ID. The driver provenance
binds the clean source/tree, operations Dockerfile, lockfile, isolated build result, image ID, and reviewed
driver qualification. These checks/builds are preparation, not restored-workflow evidence.

```bash
drill_id="<drill-id>"
recovery_driver_root="<clean reviewed recovery-driver source checkout>"
driver_manifest="$HOME/.local/state/thelemar-hub/recovery-driver/manifest.json"
driver_evidence="$HOME/.local/state/thelemar-hub/recovery-driver/evidence.json"
driver_binding="$HOME/.local/state/thelemar-hub/recovery-driver/verified-binding.tsv"
r11f_source_root="<clean r11f source checkout>"
r11f_source_sha=4578c8671a7b05066fb9a19411cb8a31cdd753ef
r11f_bff_image="sha256:7dc84ccefba2d58f6f0dc8fc3a47551d0ba8bcd75f847b9742a90cb769aac231"
r11f_static_image="sha256:6318106691636a821735b0b025478846d4fdce1827e5078ea4566dee6fdc3254"
r11f_edge_image="<verified immutable Caddy image ID>"

test "$(stat -c '%a' "$driver_manifest")" = "600"
test "$(stat -c '%a' "$driver_evidence")" = "600"
python3 "$recovery_driver_root/deploy/hub/release-helper.py" recovery-driver-provenance \
  --manifest "$driver_manifest" --evidence "$driver_evidence" \
  --git-root "$recovery_driver_root" >"$driver_binding"
chmod 600 "$driver_binding"
recovery_operations_image="$(awk -F '\t' '$1 == "image_id" {print $2}' "$driver_binding")"
recovery_source_sha="$(awk -F '\t' '$1 == "source_sha" {print $2}' "$driver_binding")"
test "$(git -C "$recovery_driver_root" rev-parse HEAD)" = "$recovery_source_sha"
test "$(git -C "$r11f_source_root" rev-parse HEAD)" = "$r11f_source_sha"
test -z "$(git -C "$r11f_source_root" status --porcelain)"
test "$(docker image inspect --format '{{.Id}}' "$r11f_bff_image")" = "$r11f_bff_image"
test "$(docker image inspect --format '{{.Id}}' "$r11f_static_image")" = "$r11f_static_image"
test "$(docker image inspect --format '{{.Id}}' "$r11f_edge_image")" = "$r11f_edge_image"
test "$(docker image inspect --format '{{.Id}}' "$recovery_operations_image")" = "$recovery_operations_image"
test "$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' \
  "$recovery_operations_image")" = "$recovery_source_sha"
test "$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.source"}}' \
  "$recovery_operations_image")" = "https://github.com/TrueMichato/ThelemarTools"
test_harness_tag="hub-restore-test-${drill_id}"
docker build --pull=false \
  --build-arg "HUB_TEST_BASE_IMAGE=$r11f_bff_image" \
  --file "$r11f_source_root/server/test.Dockerfile" \
  --tag "$test_harness_tag" "$r11f_source_root"
test_harness_image="$(docker image inspect --format '{{.Id}}' "$test_harness_tag")"
test "$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' \
  "$test_harness_image")" = "$r11f_source_sha"
```

### Restore safely

1. Record T0, then select the newest archive by modification time and verify its filename, size, SHA-256, mode,
   owner, and `HUBENC1` header.
2. Provision a unique Docker internal network (`docker network create --internal "$drill_network"`), named volume,
   and empty PostgreSQL 17.6 target. Give the database the
   network alias `hub-restore-db`; the restore-drill Compose project deliberately has no database service.
   Never use production as the restore target and never attach the restored database itself to the production
   network.
3. Generate temporary database passwords with a URL-safe alphabet such as `openssl rand -hex 24`. Do not place
   unescaped Base64 passwords in connection URLs.
4. Obtain the encryption key through approved secret access without printing it. The host archive is mode
   `0600`; because the operations image runs as `postgres`, stage a hash-verified encrypted copy in a drill-only
   volume owned by that user rather than loosening the source file.
5. Verify the exact recovery-driver operations image ID/source SHA from the separate never-deployed provenance
   manifest and reviewed evidence prepared above; do not require or fabricate a successful release record.
   Separately read the exact r11f BFF/static IDs and source SHA from the successful r11f release record
   `20261012T104617Z-hub-staging-2026-10-12-r11f-2096971` (source
   `4578c8671a7b05066fb9a19411cb8a31cdd753ef`). The finalizer is pinned to that source and the exact BFF/static
   image IDs below. Put the test-only BFF image ID, exact static/Caddy image IDs, `HUB_R11F_SOURCE_ROOT`,
   `HUB_TEST_AUTH_ENABLED=true`, test auth secret, restored runtime-role password, and unique network/project
   values in a separate mode-0600 test environment file. Keep `HUB_BACKUP_ENCRYPTION_KEY` only in the separate
   import environment file. Do **not**
   configure `HUB_OPERATIONS_DATABASE_URL` for import or attach the import runner to any production network.
   The r11f BFF image is `sha256:7dc84ccefba2d58f6f0dc8fc3a47551d0ba8bcd75f847b9742a90cb769aac231`;
   the r11f static image is `sha256:6318106691636a821735b0b025478846d4fdce1827e5078ea4566dee6fdc3254`.
   Use the clean exact r11f checkout, its `server/test.Dockerfile`, page objects, and specs prepared before T0.
   The test environment may set `HUB_PEER_SOURCE_COSTS_CAMPAIGN_IDS=*` only for the unchanged isolated
   test-harness configuration; the production return environment must use explicit campaign IDs (empty is
   valid when this drill only verifies boot/readiness) and never a wildcard. Both environments set
   `HUB_AUTH_PROVIDERS=github` and `HUB_IDENTITY_RETENTION_REQUIRED_PROVIDERS=github`, with drill-only nonempty
   GitHub credential placeholders. The test harness may keep GitHub emergency-disabled because its synthetic
   auth path is supplied by the matching test image. The production return must set
   `HUB_AUTH_EMERGENCY_DISABLED_PROVIDERS=` explicitly empty: exact r11f requires one available adapter at
   startup, and disabling its only configured provider prevents boot. This is a production-legal boot
   configuration, not real-provider continuity: keep the restore network Docker-internal with no egress, make
   no OAuth/provider-flow attempt, and record provider authentication as untested. The placeholder credentials
   are not real provider credentials. Pin the test harness and Caddy by immutable image ID in both environment
   files, and record those IDs privately. The test harness is not an exact release BFF image.

```bash
drill_env="$HOME/.local/state/thelemar-hub/restore-drill/${drill_id}.env"
drill_network="hub-restore-${drill_id}"
archive_volume="hub-restore-archive-${drill_id}"
archive_name="hub-YYYYMMDDTHHMMSSZ.dump.enc"
restore_runner="hub-restore-runner-${drill_id}"

test "$(stat -c '%a' "$drill_env")" = "600"
test "$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' \
  "$recovery_operations_image")" = "$recovery_source_sha"
docker network inspect "$drill_network" >/dev/null
docker volume inspect "$archive_volume" >/dev/null
! docker container inspect "$restore_runner" >/dev/null 2>&1

docker create \
  --name "$restore_runner" \
  --network "$drill_network" \
  --env-file "$drill_env" \
  --env HUB_RESTORE_CONFIRM=RESTORE \
  --mount "type=volume,src=${archive_volume},dst=/secure,readonly" \
  "$recovery_operations_image" \
  node server/scripts/restore-encrypted.mjs "/secure/$archive_name"
docker start --attach "$restore_runner"
test "$(docker inspect --format '{{.State.ExitCode}}' "$restore_runner")" = "0"
```

Do not replace this with `npm run` from the host checkout; that would execute checkout code rather than the
reviewed recovery-driver image. The runner joins only the isolated network for the restore target. Preserve it
on failure until safe exit metadata and logs are saved; remove it and the drill environment file during
separately approved exact cleanup. Authentication failure/tampering must leave no plaintext output. The
command's `archive-import-only` output must never be copied into freshness evidence as a completed drill.

Provision the isolated database roles and grants with the exact r11f grant script after restore and before
baseline or application startup. `pg_restore --no-owner --no-privileges` does not create cluster roles or
restore grants. Keep the owner credential in a separate mode-0600 file; the BFF receives only the newly
provisioned runtime credential. Do not run the current checkout's grant script against the r11f schema.

```bash
role_admin_env="$HOME/.local/state/thelemar-hub/restore-drill/${drill_id}-role-admin.env"
runtime_env="$HOME/.local/state/thelemar-hub/restore-drill/${drill_id}-runtime.env"
test "$(stat -c '%a' "$role_admin_env")" = "600"
test "$(stat -c '%a' "$runtime_env")" = "600"
docker run --rm --network "$drill_network" --env-file "$role_admin_env" \
  --entrypoint node "$r11f_bff_image" server/scripts/grant-roles.mjs
docker run --rm --network "$drill_network" --env-file "$runtime_env" \
  --entrypoint node "$r11f_bff_image" --input-type=module -e '
    import pg from "pg";
    const pool = new pg.Pool({connectionString: process.env.DATABASE_URL, ssl: false});
    try {
      const identity = await pool.query("SELECT current_user");
      if (identity.rows[0].current_user !== "hub_runtime") process.exitCode = 2;
      await pool.query("SELECT count(*) FROM hub.accounts");
      try {
        await pool.query("CREATE TABLE hub.__restore_role_probe (id integer)");
        await pool.query("DROP TABLE hub.__restore_role_probe");
        process.exitCode = 3;
      } catch (error) {
        if (error.code !== "42501") throw error;
      }
    } finally {
      await pool.end();
    }
  '
```

The probe must exit zero: the isolated runtime role can read Hub data but cannot alter the schema. Remove the
role-admin environment file with the other temporary credentials during final cleanup.

### Prove the restored service

Before creating the test BFF, capture the exact-r11f structural baseline and collision preflight. The baseline
tool reads aggregate counts, migration checksums, constraint readiness, and whether fixed test identities
already exist; it emits no identity, account, campaign, character, or content fields. Use a mode-0600
environment file containing only the restored target `DATABASE_URL`:

```bash
umask 077
baseline_env="$HOME/.local/state/thelemar-hub/restore-drill/<drill-id>-baseline.env"
baseline_file="$HOME/.local/state/thelemar-hub/restore-drill/<drill-id>-before.json"
test "$(stat -c '%a' "$baseline_env")" = "600"
docker run --rm --network "$drill_network" --env-file "$baseline_env" \
  "$recovery_operations_image" node server/scripts/restore-drill-baseline.mjs before \
  >"$baseline_file"
chmod 600 "$baseline_file"
```

The baseline command rejects any ledger other than the exact r11f `0001`-`0009` filenames and checksums,
unvalidated constraints, or a collision with the r11f harness's fixed `github:101`, `discord:202`, or
`hub-test` identities. A collision is a stop condition, not permission to delete, rename, or namespace an
archived identity.

For the pinned r11f record, do not run newer migration, grant, or schema tooling against this restored target;
the only role-grant operation is the exact-r11f grant script above.
Start the isolated test-only stack from `compose.hub.restore-drill.yml`, using only the exact r11f
static image, a test BFF derived from its exact BFF image, the pinned Caddy image, the pre-checked external
restore network, and the restored target database. This file deliberately declares no database, migration, or
role-grant service. Verify that the exact r11f test BFF reaches readiness as `hub_runtime` and that the source
archive remains unchanged. Use only the unchanged matching r11f Playwright page objects and
`private-v1.spec.ts`, `private-v1-character-campaigns.spec.ts`, and
`character-sheet-party-inventory.spec.ts`; do **not** run
`server/scripts/run-hub-e2e.mjs` or `npm run test:hub:e2e:stack`, because those launchers create, migrate, and
tear down their own fresh database.

```bash
test_env="$HOME/.local/state/thelemar-hub/restore-drill/${drill_id}-test.env"
test "$(stat -c '%a' "$test_env")" = "600"
helper="$recovery_driver_root/deploy/hub/release-helper.py"
restore_project="$("$helper" env --file "$test_env" --key HUB_RESTORE_PROJECT_NAME)"
restore_network="$("$helper" env --file "$test_env" --key HUB_RESTORE_NETWORK)"
edge_port="$("$helper" env --file "$test_env" --key HUB_RESTORE_EDGE_PORT)"
test "$("$helper" env --file "$test_env" --key HUB_R11F_SOURCE_ROOT)" = "$r11f_source_root"
test "$restore_network" = "$drill_network"
test "$("$helper" env --file "$test_env" --key HUB_RESTORE_BFF_IMAGE)" = "$test_harness_image"
test "$("$helper" env --file "$test_env" --key HUB_RESTORE_STATIC_IMAGE)" = "$r11f_static_image"
test "$("$helper" env --file "$test_env" --key HUB_RESTORE_EDGE_IMAGE)" = "$r11f_edge_image"
test "$("$helper" env --file "$test_env" --key HUB_RESTORE_NODE_ENV)" = "test"
test "$("$helper" env --file "$test_env" --key HUB_TEST_AUTH_ENABLED)" = "true"
test "$("$helper" env --file "$test_env" --key HUB_PEER_SOURCE_COSTS_CAMPAIGN_IDS)" = "*"
test "$("$helper" env --file "$test_env" --key HUB_MULTI_TARGET_OPERATIONS_CAMPAIGN_IDS)" = ""
compose=(docker compose --project-name "$restore_project" --env-file "$test_env" \
  -f "$recovery_driver_root/compose.hub.restore-drill.yml")
"${compose[@]}" up --pull never -d
curl --fail --silent --show-error --insecure \
  "https://localhost:${edge_port}/api/ready" >/dev/null
export HUB_TEST_AUTH_SECRET="$("$helper" env --file "$test_env" --key HUB_TEST_AUTH_SECRET)"
(cd "$r11f_source_root" && \
  HUB_E2E_ORIGIN="https://localhost:${edge_port}" \
  npx playwright test --config playwright.hub.config.ts \
    test/e2e/hub/private-v1.spec.ts \
    test/e2e/hub/private-v1-character-campaigns.spec.ts \
    test/e2e/hub/character-sheet-party-inventory.spec.ts)
```

`test_env` contains only drill credentials, the restored runtime-role password, unique Compose/network names,
and the pinned image IDs. It contains no archive key, real provider credential, or production database URL.
After workflow completion, verify the image IDs again and remove only the three named services from this
unique Compose project; do not use `compose down`:

```bash
test "$(docker inspect --format '{{.Image}}' "$("${compose[@]}" ps -q bff)")" = "$test_harness_image"
test "$(docker inspect --format '{{.Image}}' "$("${compose[@]}" ps -q static)")" = "$r11f_static_image"
"${compose[@]}" rm --stop --force bff static edge
```

Run authenticated session, campaign read/write, character state read/write, inventory/shared interaction,
cross-character effect, and authorization-denial checks through the supported exact-version test harness.
After the suite stops, record `testServicesStoppedAt`, then return to the exact r11f BFF/static IDs before
capturing the after snapshot. Use a second
mode-0600 environment file with `HUB_RESTORE_BFF_IMAGE` set to `r11f_bff_image`,
`HUB_RESTORE_STATIC_IMAGE` and `HUB_RESTORE_EDGE_IMAGE` set to the pinned IDs,
`HUB_RESTORE_NODE_ENV=production`, and `HUB_TEST_AUTH_ENABLED=false`; omit `HUB_TEST_AUTH_SECRET`. Recreate
only the named services with this file and `--pull never`, then verify readiness and exact BFF/static image
IDs. A test-harness image derived from the same source SHA is not an exact release image.

```bash
return_env="$HOME/.local/state/thelemar-hub/restore-drill/${drill_id}-return.env"
test "$(stat -c '%a' "$return_env")" = "600"
test "$("$helper" env --file "$return_env" --key HUB_RESTORE_PROJECT_NAME)" = "$restore_project"
test "$("$helper" env --file "$return_env" --key HUB_RESTORE_NETWORK)" = "$drill_network"
test "$("$helper" env --file "$return_env" --key HUB_RESTORE_EDGE_PORT)" = "$edge_port"
test "$("$helper" env --file "$return_env" --key HUB_R11F_SOURCE_ROOT)" = "$r11f_source_root"
test "$("$helper" env --file "$return_env" --key HUB_RESTORE_NODE_ENV)" = "production"
test "$("$helper" env --file "$return_env" --key HUB_TEST_AUTH_ENABLED)" = "false"
! grep -q '^HUB_TEST_AUTH_SECRET=' "$return_env"
test "$("$helper" env --file "$return_env" --key HUB_RESTORE_BFF_IMAGE)" = "$r11f_bff_image"
test "$("$helper" env --file "$return_env" --key HUB_RESTORE_STATIC_IMAGE)" = "$r11f_static_image"
test "$("$helper" env --file "$return_env" --key HUB_RESTORE_EDGE_IMAGE)" = "$r11f_edge_image"
test "$("$helper" env --file "$return_env" --key HUB_PEER_SOURCE_COSTS_CAMPAIGN_IDS)" = ""
test "$("$helper" env --file "$return_env" --key HUB_MULTI_TARGET_OPERATIONS_CAMPAIGN_IDS)" = ""
test "$("$helper" env --file "$return_env" --key HUB_AUTH_PROVIDERS)" = "github"
test "$("$helper" env --file "$return_env" --key HUB_AUTH_EMERGENCY_DISABLED_PROVIDERS)" = ""
test "$("$helper" env --file "$return_env" --key HUB_IDENTITY_RETENTION_REQUIRED_PROVIDERS)" = "github"
test "$("$helper" env --file "$return_env" --key GITHUB_CLIENT_ID)" = "drill-only-restore-placeholder"
test "$("$helper" env --file "$return_env" --key GITHUB_CLIENT_SECRET)" = "drill-only-restore-placeholder"
return_compose=(docker compose --project-name "$restore_project" --env-file "$return_env" \
  -f "$recovery_driver_root/compose.hub.restore-drill.yml")
"${return_compose[@]}" up --pull never -d --force-recreate bff static edge
curl --fail --silent --show-error --insecure \
  "https://localhost:${edge_port}/api/ready" >/dev/null
return_bff_container="$("${return_compose[@]}" ps -q bff)"
return_static_container="$("${return_compose[@]}" ps -q static)"
test "$(docker inspect --format '{{.Image}}' "$return_bff_container")" = "$r11f_bff_image"
test "$(docker inspect --format '{{.Image}}' "$return_static_container")" = "$r11f_static_image"
```

Record `exactReleaseReturnedAt` after readiness. While the restored DB, network, and runtime credential still
exist, capture the after snapshot. Then stop the exact-r11f services and remove only the named drill container,
volumes, network, and temporary credential files. The after snapshot deliberately precedes final teardown;
`cleanupCompletedAt` is recorded only after that teardown succeeds. This keeps the snapshot query runnable
without claiming that credentials or infrastructure have already been removed.

```bash
after_snapshot="$HOME/.local/state/thelemar-hub/restore-drill/${drill_id}-after.json"
restore_db="hub-restore-db-${drill_id}"
restore_volume="hub-restore-data-${drill_id}"
test "$(stat -c '%a' "$runtime_env")" = "600"
docker run --rm --network "$drill_network" --env-file "$runtime_env" \
  "$recovery_operations_image" node server/scripts/restore-drill-baseline.mjs after \
  >"$after_snapshot"
chmod 600 "$after_snapshot"
"${return_compose[@]}" rm --stop --force bff static edge
docker rm --force "$restore_db"
docker volume rm "$restore_volume" "$archive_volume"
docker network rm "$drill_network"
rm -f -- "$role_admin_env" "$runtime_env" "$baseline_env" "$test_env" "$return_env" "$drill_env"
```

Preserve the before and after snapshots in the private drill evidence; the finalizer verifies the unchanged
migration ledger and constraints and records each table-count delta as fixture-mutation evidence. This is an
exact-version return, not a predecessor-binary compatibility
drill and not evidence of A7 HW/LoH fallback. A7 full-workflow fallback qualification remains a separate
exact-binary gate in [rollback](rollback.md).

Do not use the fresh-stack launcher against the restored database; it creates, migrates, and cleans its own
database. Do not alter the old test authentication harness or namespace its identities. If a fixed fixture
already exists in the archive, stop before startup and record the collision; do not delete or rewrite it.

After cleanup, use the independently reviewed never-deployed recovery-driver operations image to validate and
finalize the mode-0600 evidence file:

```bash
private_summary="$HOME/.local/state/thelemar-hub/restore-drill/<drill-id>-summary.json"
test "$(stat -c '%a' "$evidence_file")" = "600"
docker run --rm --user "$(id -u):$(id -g)" --network none \
  --mount "type=bind,src=${evidence_file},dst=/evidence.json,readonly" \
  "$recovery_operations_image" \
  node server/scripts/finalize-restore-drill.mjs /evidence.json --private-only \
  >"$private_summary"
chmod 600 "$private_summary"
```

The finalizer checks exact image/source identities, unchanged authentication-harness source, protocol 5 and
the exact r11f `0001`-`0009` migration ledger filenames/checksums, before/after structural snapshots ordered
around workflows, service stop, and exact-image return, the pre-start fixture collision check, each
authenticated check, completed teardown, redacted safe-failure records, millisecond-exact RPO <=24h, and
continuous RTO <=4h. Its private summary records the actual completion time and a stable operational run ID;
the later database acknowledgement is not substituted for the drill completion time. A slow or lost database
acknowledgement produces no success output. Retry only with the same private summary; the stable run ID makes
an already committed write idempotent. Restored-account or real-provider continuity remains **OPEN**.
Import-only output cannot be finalized.

Updating the production `restore_drill` freshness row is a separate, explicitly approved evidence write after
the private summary passes. It records the private completion timestamp, not the later acknowledgement time.
If approved, use the exact recovery-driver operations image and a separate
mode-0600 environment file containing only `HUB_OPERATIONS_DATABASE_URL`; attach that one-shot finalizer to
the named production operations network, mount the same evidence read-only, and run
`node server/scripts/finalize-restore-drill.mjs /evidence.json --record-operational COMPLETE /private-summary.json`.
The private summary is the mode-0600 output from the earlier `--private-only` run. Do not connect the archive
importer, test server, or restored target to production. If that final evidence write fails or times out, retain
the isolated evidence and report no operational acknowledgement; retrying the same summary must not create a
second run. A separate authorized readback may be used to resolve an uncertain acknowledgement.

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
