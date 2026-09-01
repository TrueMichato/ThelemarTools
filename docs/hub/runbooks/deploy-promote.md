# Runbook: deploy and promote

> **Status:** Oracle one-command release implemented; live induced-failure drill pending
> **Owner:** Campaign Hub operator

## Preconditions

- reviewed commit reachable from `origin/multiplayer-hub` and an immutable annotated `hub-*` tag;
- deployment root `/home/ubuntu/ThelemarTools` is clean and the current release also has an annotated rollback tag;
- `.env.hub` is mode 0600, has an absolute `HUB_BACKUP_DIR`, and explicitly maps the Oracle `ubuntu`
  account with `HUB_BACKUP_UID=1001` and `HUB_BACKUP_GID=1001`;
- Hub, migration, container, security, and documentation gates passed;
- backup age <26h and last restore drill <35d;
- Foundry remains available on port 30000 and is outside every Hub Compose operation;
- at least 4 GiB free on the release filesystem and 1 GiB on the backup filesystem.

## Procedure

From the repository root, inspect the read-only path first:

```bash
./deploy/hub/release.sh --dry-run hub-staging-YYYY-MM-DD
```

The dry run locks the release path, validates the host/current deployment/tag, checks live HTTPS/WebSocket/
metrics through `monitor-host.sh`, verifies Foundry is listening, checks out the candidate, revalidates the
candidate Compose rendering, builds its exact source, and produces the migration compatibility plan. It does
not create a backup, apply migrations, grant roles, or recreate services; it restores the previous checkout
and every pre-build Compose image tag after planning.

Run the deliberate release:

```bash
./deploy/hub/release.sh hub-staging-YYYY-MM-DD
```

The script prints the full tag/SHA, annotated tag identity, pending expand migrations, and rollback identity,
then requires `RELEASE <tag> <full-sha>` exactly before production mutation. `--yes` is reserved for an
operator-controlled non-interactive terminal and does not bypass any safety check.

Annotated tags are mandatory. Cryptographic tag-signature verification is opt-in with
`HUB_RELEASE_REQUIRE_SIGNED_TAG=1`; enable it only after the release-tag process signs tags with a key trusted
by the Oracle host.

Strict phases are: process lock; preflight/current health; rollback capture; encrypted backup plus
authentication/hash/`pg_restore --list` verification; immutable checkout; candidate build and migration plan;
operator approval; forward migration and role grants; BFF/static/edge cutover; then complete health, TLS,
WebSocket, metrics, migration, container, icon, service-worker, backup-age, and Foundry checks. JSON and text
evidence are mode 0600 under `~/.local/state/thelemar-hub/releases/`.

`compose.hub.release.yml` binds migration, grant, BFF, and static services to the exact image IDs captured after
the candidate build. The script revalidates those IDs and the BFF revision label immediately before migration,
so mutable local Compose tags cannot replace the reviewed candidate during operator approval.

`--repair-backup-ids` may change only `HUB_BACKUP_UID` and `HUB_BACKUP_GID` in `.env.hub`. It never runs
`chown`, and no release command stops, restarts, or configures Foundry.

## Stop conditions

- lock contention, dirty source, lightweight/moved/unreachable tag, or source/tag SHA drift;
- wrong repository/root/user/UID/GID, permissive `.env.hub`, missing/relative backup path, or low disk;
- current health/TLS/WebSocket/metrics/container/backup evidence failure or missing Foundry listener;
- migration checksum/plan mismatch or pending migration without explicit release-policy metadata;
- any contract-phase migration;
- backup/restore evidence missing;
- readiness failure;
- BFF using owner database role;
- origin/cookie/proxy mismatch;
- privacy/authorization regression;
- outbox starts aging.

## Configuration knobs

Operator overrides are deliberately explicit:

| Variable | Default | Purpose |
|---|---|---|
| `HUB_RELEASE_EXPECTED_REPOSITORY` | `TrueMichato/ThelemarTools` | Exact normalized GitHub origin |
| `HUB_RELEASE_EXPECTED_ROOT` | `/home/ubuntu/ThelemarTools` | Exact deployment checkout |
| `HUB_RELEASE_EXPECTED_BRANCH` | `multiplayer-hub` | Branch that must contain the tag |
| `HUB_RELEASE_EXPECTED_HOST_USER` | `ubuntu` | Required operating-system account |
| `HUB_RELEASE_EXPECTED_HOST_UID` / `HUB_RELEASE_EXPECTED_HOST_GID` | `1001` / `1001` | Required host identity |
| `HUB_RELEASE_MIN_ROOT_FREE_KB` | `4194304` | Minimum release-filesystem free space |
| `HUB_RELEASE_MIN_BACKUP_FREE_KB` | `1048576` | Minimum backup-filesystem free space |
| `HUB_RELEASE_LOCK_FILE` | `/run/lock/thelemar-hub-release.lock` | Host process lock |
| `HUB_RELEASE_EVIDENCE_DIR` | `~/.local/state/thelemar-hub/releases` | Private durable evidence root |
| `HUB_RELEASE_REQUIRE_SIGNED_TAG` | `0` | Set to `1` to require `git verify-tag` |
| `HUB_FOUNDRY_PORT` | `30000` | Listener that must remain present and absent from Hub Compose |

`HUB_RELEASE_MIGRATE_IMAGE`, `HUB_RELEASE_GRANT_ROLES_IMAGE`, `HUB_RELEASE_BFF_IMAGE`, and
`HUB_RELEASE_STATIC_IMAGE` are internal immutable IDs set by the script; operators must not preconfigure them.

The following variables are test-only seams and must never be set in an operator environment:

| Variable | Test purpose |
|---|---|
| `HUB_RELEASE_TEST_MODE` | Enables test-only behavior, including the non-Linux lock fallback |
| `HUB_RELEASE_SIMULATE` | Replaces real phases with the deterministic simulation |
| `HUB_RELEASE_TEST_HOLD_LOCK_SECONDS` | Holds the simulated preflight for lock-contention coverage |
| `HUB_RELEASE_TEST_ROLLBACK_COMPATIBLE` | Sets planned migration compatibility |
| `HUB_RELEASE_TEST_DEPLOY_ROLLBACK_COMPATIBLE` | Simulates unexpected compatibility drift at deploy |
| `HUB_RELEASE_TEST_PLANNED_MIGRATIONS` | Supplies simulated planned/applied versions |
| `HUB_RELEASE_TEST_FAIL_PHASE` | Fails one named top-level phase |
| `HUB_RELEASE_TEST_FAIL_STEP` | Fails `grant-roles` or `pre-cutover-status` inside deploy |

Simulation is rejected unless both test mode and simulation are `1`; successful simulations emit
`status=simulated`, never production success evidence.

## Rollback

Before migration apply, failure leaves the running containers and database unchanged. Once forward migrations
complete, evidence records `schema_mutated=true` and the exact planned/applied version sets. If role grants or
the pre-cutover migration status then fails, traffic remains on the previous schema-compatible application;
the script restores the previous checkout/image tags but never reverses or restores the database.

After cutover, the script automatically rolls back only the BFF/static application images and source when
every applied migration declares the previous app compatible. It never reverses migrations and never restores
a backup automatically.

Normal planning rejects schema-incompatible or contract migrations before apply/cutover. The BFF-stop and
isolated-restore instruction path is defense in depth for unexpected compatibility drift after traffic
mutation, not a normal reachable release flow. It preserves the current database, backup, and evidence. Use
[rollback.md](rollback.md) and [backup-restore.md](backup-restore.md).

## Manual break glass

Contract migrations are intentionally outside `release.sh`. First complete a successful expand release and
compatibility window. Then schedule downtime, take another verified encrypted backup, stop only the Hub BFF,
run the reviewed contract migration manually with the schema owner, and accept that automatic application
rollback is unavailable. Restore only into an isolated PostgreSQL 17 target, validate it, and switch databases
through the runbook; never restore over production, edit the ledger, or run an ad-hoc down migration.
