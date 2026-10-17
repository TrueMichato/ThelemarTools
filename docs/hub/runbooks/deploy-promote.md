# Runbook: deploy and promote

> **Status:** Oracle one-command release and live induced-failure drill verified for r7
> **Owner:** Campaign Hub operator

## Preconditions

- reviewed commit reachable from `origin/multiplayer-hub` and an immutable annotated `hub-*` tag;
- deployment root `/home/ubuntu/ThelemarTools` is clean and the current release also has an annotated rollback tag;
- `.env.hub` is mode 0600, has an absolute `HUB_BACKUP_DIR`, and explicitly maps the Oracle `ubuntu`
  account with `HUB_BACKUP_UID=1001` and `HUB_BACKUP_GID=1001`;
- Hub, migration, container, security, and documentation gates passed;
- backup age <26h and last restore drill <35d;
- the host is dedicated to the Hub, and the rendered Compose model contains only the named Hub services;
- at least 4 GiB free on the release filesystem and 1 GiB on the backup filesystem.

## Prepare the tag on the local machine

Before requesting approval to create a release tag, check the local checkout against the actual remote head
and check the effective tagger (repository-local Git identity overrides the global identity):

```bash
git status --short --branch
git rev-parse HEAD
git ls-remote --heads origin refs/heads/multiplayer-hub
git config --show-origin --get user.name
git config --show-origin --get user.email
git ls-remote --tags origin 'refs/tags/<proposed-tag>*'
```

Stop if the intended commit is not the reviewed remote head, the tag name is occupied, or the effective
identity is a test placeholder. Do not tag from a stale or dirty checkout or discard existing edits to make
it clean. Use a separate clean worktree detached at the exact reviewed commit, or safely fast-forward the
checkout only after checking that no local edits or untracked paths overlap incoming files. Obtain explicit
approval for the exact new tag and commit; never move an existing tag or force-push it. After pushing, verify
that the remote tag object is annotated and its peeled commit is the approved SHA with
`git ls-remote --tags origin 'refs/tags/<proposed-tag>' 'refs/tags/<proposed-tag>^{}'`.
Tagging does not authorize a shared-host dry run or promotion.

## A7 release-engine maintenance transition

This is the only tag-policy exception to the ordinary reviewed-head rule. It exists because the deployed r11f
engine executes its own in-memory release helper; checking out a candidate does not make the candidate engine
execute the first transition.

Let **D** be deployed r11f at `4578c8671a7b05066fb9a19411cb8a31cdd753ef`, **A** the existing A7 line beginning
at `5b6c1a7dff2ae96ff23c82b491c0189979d07487`, **E** a narrowly reviewed engine-maintenance commit, and **M**
the later normal merge containing both A7 and E. Build E in a separate clean worktree based on exact D. The six
operational source assets in this preparation boundary are:

1. `deploy/hub/release.sh`;
2. `deploy/hub/release-helper.py`;
3. `compose.hub.release.yml`, limited to the reviewed three-line `services.maintenance.image` binding;
4. `compose.hub.recovery-mode.yml`;
5. `deploy/hub/systemd/thelemar-hub-backup.service`; and
6. `deploy/hub/systemd/thelemar-hub-maintenance.service`.

Keep all five required release-image `${...:?}` bindings and `backup.build: !reset null` intact. The only
permitted hunk in `compose.hub.release.yml` is the reviewed three-line maintenance-image binding:

```yaml
services:
  maintenance:
    image: ${HUB_RELEASE_BFF_IMAGE:-thelemartools-hub-bff}
```

The test-source portion of the preparation allowlist is:

7. `test/jest/hub/HubReleaseAutomation.test.js`;
8. `test/jest/hub/HubReleaseHelper.test.js`; and
9. `test/jest/hub/git-test-utils.js`.

`git-test-utils.js` is a test-only dependency, not a production or package dependency. The documentation
portion is:

10. `docs/hub/runbooks/deploy-promote.md`;
11. `docs/hub/runbooks/oracle-operations.md`; and
12. `docs/hub/runbooks/rollback.md`.

These twelve paths are the complete D-to-E source-preparation allowlist; they do not authorize construction,
tagging, or release. All other D paths must remain byte- and mode-identical. In particular, preserve D's
`deploy/hub/migration-policy.json` and migration files 0001-0009 byte-for-byte; they are fixed profile inputs,
not E deltas. Do not add A7 product behavior, runtime code, package/dependency or lockfile changes, or
migrations to E.

The release tests identify the actual checked-out tree from its protocol declaration, required migration
version, policy bytes, and migration files; no environment variable selects a profile. The D/E-compatible
profile is protocol 5, required migration 0009, the exact D policy, and exact D migration bytes 0001-0009.
The current A7 engineering M profile is protocol 6, required migration 0014, files 0001-0014, and migration
0011's schema-before-use policy with its irreversible usage-marker and marker-aware rollback checks.
Unsupported or mismatched combinations fail closed. These are test-source profiles only: the M profile does
not select M as the release target or establish an E commit.
The M-only marker checker, its npm command, and migration-0010-through-0014 rollback examples in `rollback.md`
are for a later M/qualified-image context; they are not available in E's inherited D package.

The recovery overlay and units are operational assets because fallback returns the checkout to E while the
qualified B application and scheduled-job images remain active.
The systemd units use a root-owned overlay installed under `/etc/thelemar-hub`, outside the source checkout,
so it remains available after the checkout returns to E. Their job-state precheck rejects incomplete,
starting, blocked, or explicitly fenced fallback state; install the overlay and revised units only through
the separately authorized `oracle-operations.md` procedure. Merge E normally into A; do not
publish an r11f application-tree downgrade or rewrite reviewed history. Re-review M's exact tree to prove both
A7 content and E's release-engine delta are present.

Before any candidate migration or traffic change, E's engine checks the actual M Compose rendering after
checking out M. Its private binding includes only the normalized campaign/provider fields; full rendered
Compose output is streamed to the helper and must never be persisted in release evidence. A failed binding
stops before migration and traffic. At fallback activation, the engine pins B's BFF/static/operations image
IDs and matching maintenance/backup references in the private state/environment pair. A durable transition
marker keeps scheduled jobs fenced until both files are committed and B has passed readiness; if state,
environment, tag, or marker operations fail, the release must report the failure and may not claim complete
recovery. On fallback failure, quiesce B and restore E before recording the blocked job state. Do not claim
jobs remain fenced unless the blocked state is confirmed.

Only after a fresh remote read identifies M as the reviewed `multiplayer-hub` head may an explicitly approved,
annotated `hub-maintenance-*` tag point to exact E. The private preparation record must bind E and M SHAs,
ancestry, the exact annotated tag object and peeled SHA, E's CI and operational qualification evidence hashes,
and the human approval. E must be a reachable ancestor of M; it is not represented as the remote head. The
existing release engine still enforces the exact remote tag object, peeled SHA, branch reachability, and normal
deployment checks. Never override `HUB_RELEASE_EXPECTED_BRANCH`, tag A or M as the maintenance exception, or
use an unqualified `first-release.sh`/process-substitution handoff. If E is not reachable from fresh M, its
r11f equivalence is not proven, or any evidence/approval is missing, stop without tagging.

The first transition is executed by D's already-running in-memory release engine/helper; checking out E does
not replace the process executing that transition. D's engine executes E once using the ordinary release path.
Its existing evidence predates explicit
release-engine fields, so independently bind this invocation to the deployed D release record and verify the
engine/helper bytes against D's exact source tree; do not infer its identity from candidate E. After
independent verification that E is now the installed source and its release engine is present, E's engine
must execute M/A7. New release records bind the executing engine's source commit/tree and the SHA-256 digests
of its `release.sh` and helper. The helper snapshot is made before candidate checkout; therefore E-to-M/A7
evidence identifies E's engine, not the M candidate. Before E-to-M/A7, verify a fresh invocation records E as
its engine source and the reviewed E script/helper digests. A candidate SHA or image revision label is not
release-engine identity. The maintenance-tag exception does not weaken the ordinary A7 release rule: the A7
tag must still identify the reviewed remote head exactly. No tag, shared-host dry run, or promotion is
authorized by this procedure text.

## Procedure

### First initialized release only

Use this path only when the clean, tagged deployment predates `deploy/hub/release.sh`. Fetch the reviewed
candidate tag without changing the checkout, then execute the wrapper directly from that immutable tag:

```bash
git fetch --no-tags origin refs/tags/hub-staging-YYYY-MM-DD:refs/tags/hub-staging-YYYY-MM-DD
bash <(git show hub-staging-YYYY-MM-DD:deploy/hub/first-release.sh) \
  --dry-run hub-staging-YYYY-MM-DD
```

The wrapper holds the normal release lock, captures the legacy SHA/tag and running BFF/static/backup image IDs,
hashes the legacy Compose/Caddy tree, checks out the candidate, and hands those values to the existing release
engine. The release engine revalidates the complete handoff, pins the prerelease backup to the captured
immutable image with no build or pull path, and restores the legacy checkout on any pre-cutover failure. After
the dry run returns to the legacy tag, run the same command without `--dry-run`; the human must enter the normal
typed release confirmation.

Legacy OCI revision labels may contain either the full commit SHA or a unique Git abbreviation. Both validation
layers resolve the label through the deployment repository and require it to identify the exact rollback commit;
missing, malformed, ambiguous, or unrelated labels fail closed.

Do not use the wrapper after the first successful release. Do not copy candidate files into the legacy
checkout, run a moving branch, or check out the candidate before the wrapper captures the rollback boundary.

From the repository root, inspect the read-only path first:

```bash
./deploy/hub/release.sh --dry-run hub-staging-YYYY-MM-DD
```

The dry run locks the release path, validates the host/current deployment/tag, checks live HTTPS/WebSocket/
metrics through `monitor-host.sh`, verifies the Compose model remains confined to the Hub service allowlist,
checks out the candidate, revalidates the candidate Compose rendering, builds its exact source, and produces
the migration compatibility plan. It does not create a backup, apply migrations, grant roles, or recreate
services. Before building, it keeps every pre-build Compose image alive under a unique
`hub-release-preserve-<release-id>` tag. A dry run verifies all five preserved image identities before restoring
the first mutable tag, restores the previous checkout and all mutable image tags, then removes those temporary
preservation tags.

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
operator approval; forward migration and role grants; account-entitlement reconciliation/readiness; BFF/static/
edge cutover; then complete health, TLS, WebSocket, metrics, migration, container, icon, service-worker, and
backup-age checks. JSON and text evidence are mode 0600 under
`~/.local/state/thelemar-hub/releases/`.

`compose.hub.release.yml` binds the prerelease backup to the exact current operations image and binds migration,
grant, BFF, and static services to the exact image IDs captured after the candidate build. It removes the
backup build path and uses `--pull never`; the script revalidates candidate IDs and the BFF revision label
immediately before migration, so mutable local Compose tags cannot replace reviewed images. The candidate
operations image is built with the other release images, restored to the previous tag after a dry run or
pre-cutover failure, and retained only after a successful release for subsequent backups. After a successful
release, the previous five images remain available under the unique preservation references recorded in the
release evidence, so a later application rollback does not depend on an otherwise unreferenced Docker image ID.

`--repair-backup-ids` may change only `HUB_BACKUP_UID` and `HUB_BACKUP_GID` in `.env.hub`. It never runs
`chown`. Release commands recreate only BFF, static, and edge, may stop only the Hub BFF on the incompatible
failure path, and never run Compose `down`, remove services, or delete volumes.

## Stop conditions

- lock contention, dirty source, lightweight/moved/unreachable tag, or source/tag SHA drift;
- wrong repository/root/user/UID/GID, permissive `.env.hub`, missing/relative backup path, or low disk;
- current health/TLS/WebSocket/metrics/container/backup evidence failure or a non-Hub Compose service;
- migration checksum/plan mismatch or pending migration without explicit release-policy metadata;
- any contract-phase migration;
- backup/restore evidence missing;
- readiness failure;
- BFF using owner database role;
- origin/cookie/proxy mismatch;
- privacy/authorization regression;
- missing r9 designated operator, failed account-entitlement backfill/reconciliation, or an attempt to enable
  invite admission before entitlement enforcement;
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
a backup automatically. Once all previous mutable image tags are restored and verified, a failure to delete a
temporary preservation tag is recorded for manual cleanup but does not prevent the previous BFF/static/edge
services from being recreated and verified.

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
