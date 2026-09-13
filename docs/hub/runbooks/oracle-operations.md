# Runbook: Oracle host operations for the Campaign Hub

> **Status:** Release r7 deployed; V1-G1 operations and recovery evidence complete
> **Last drilled:** 2026-09-13
> **Owner:** Campaign Hub operator

This procedure adds scheduled maintenance, encrypted backups, off-machine copies, and five-minute health
checks without stopping or resizing the Oracle instance. The host is now dedicated to the Campaign Hub after
Foundry was intentionally decommissioned.

The current deployed release is the annotated tag `hub-staging-2026-09-10-r7` (tag object
`a65fec81eba3cd147fd44b54e617bf83d4a707f8`, commit
`77d955c053dcdfe949235620db93f7eba477af34`). Manual maintenance and backup runs, five-minute monitoring,
off-machine backup copying, an isolated authenticated restore, and an exact-r6 application rollback rehearsal
passed on 2026-09-12. The first genuine daily maintenance and backup timer activations passed on 2026-09-13,
completing V1-G1.

## Safety rules

- Rebooting the instance is allowed when planned.
- Do not stop, resize, recreate, or detach the boot volume while replacement Always Free ARM capacity is
  unavailable.
- Never restore over the production database.
- Keep `.env.hub`, the backup encryption key, SSH keys, and backup archives private.
- Configure heartbeat URLs only for a service you trust. The checks send no campaign data or error details.

## 1. Prepare host-local encrypted backup storage

On the Oracle VM:

```bash
cd /home/ubuntu/ThelemarTools
mkdir -p .hub-backups
chmod 700 .hub-backups
```

`compose.hub.public.yml` bind-mounts this directory into the one-shot backup container. Existing backups in the
old `hub-backups` named volume are not deleted; copy them out separately if that volume already contains
archives.

Confirm `.env.hub` contains the existing `HUB_BACKUP_ENCRYPTION_KEY`. Optionally add two private heartbeat URLs:

```dotenv
HUB_MONITOR_HEARTBEAT_URL=https://your-monitor.example/success-id
HUB_MONITOR_FAILURE_URL=https://your-monitor.example/failure-id
```

This Oracle host's `ubuntu` account is UID/GID 1001. Keep the host path explicit so a clean release checkout
cannot redirect backups:

```dotenv
HUB_BACKUP_DIR=/home/ubuntu/ThelemarTools/.hub-backups
HUB_BACKUP_UID=1001
HUB_BACKUP_GID=1001
```

Confirm with `id -u`, `id -g`, and `stat -c '%u:%g %a' .hub-backups`. The release command refuses a mismatch.
Its `--repair-backup-ids` flag changes only those two `.env.hub` keys; it never changes filesystem ownership.

The success URL creates an external dead-man's-switch signal. The failure URL receives an empty POST when a
check fails. Do not put secrets or campaign identifiers in either URL's label.

## 2. Install the systemd units

The checked-in units assume the deployment is `/home/ubuntu/ThelemarTools` and runs as `ubuntu`. If either
differs, edit the copied units—not the repository copies—before enabling them.

```bash
cd /home/ubuntu/ThelemarTools
chmod 750 deploy/hub/monitor-host.sh deploy/hub/pull-backups.sh
sha256sum deploy/hub/systemd/thelemar-hub-*
sudo cp deploy/hub/systemd/thelemar-hub-* /etc/systemd/system/
sha256sum /etc/systemd/system/thelemar-hub-*
sudo systemctl daemon-reload
systemctl list-timers 'thelemar-hub-*' --all
sudo systemctl enable --now thelemar-hub-maintenance.timer
systemctl list-timers thelemar-hub-maintenance.timer --all
sudo systemctl enable --now thelemar-hub-backup.timer
systemctl list-timers thelemar-hub-backup.timer --all
sudo systemctl enable --now thelemar-hub-monitor.timer
systemctl list-timers 'thelemar-hub-*' --all
```

The timers run maintenance around 01:15 UTC, backup around 02:15 UTC, and monitoring every five minutes.
Inspect `LastTriggerUSec`, `NextElapseUSecRealtime`, and the service journal after each enable. `Persistent=true`
may immediately catch up a missed daily run after a reboot or first installation; this is expected, but it must
not be mistaken for the next genuine scheduled run. The checked-in `flock` lock prevents overlapping duplicate
jobs.
The maintenance and backup services first require their released image to exist, then run noninteractively with
dependency startup and image pulls disabled. Maintenance reuses the released BFF image because both execute the
same server runtime. If an image is missing, stop and repair the release image catalog; do not let scheduled work
build replacement images from the checkout.

## 3. Drill each job now

Do not wait until the first scheduled run:

```bash
sudo systemctl start thelemar-hub-maintenance.service
sudo systemctl start thelemar-hub-backup.service
sudo systemctl start thelemar-hub-monitor.service

systemctl --no-pager --full status \
  thelemar-hub-maintenance.service \
  thelemar-hub-backup.service \
  thelemar-hub-monitor.service
journalctl -u thelemar-hub-maintenance.service -u thelemar-hub-backup.service \
  -u thelemar-hub-monitor.service --since today --no-pager
ls -lh .hub-backups/
```

The monitor fails if readiness, the protected metrics route, the WebSocket route, TLS lifetime, Compose
services, disk, memory, CPU load, outbox, maintenance age, backup age, or restore-drill age crosses its
threshold. A first run is expected to fail on stale or missing evidence until maintenance, backup, and restore
have succeeded. When Healthchecks.io is used, create one five-minute check with a ten-minute grace period and
email alerting. Store its success and failure URLs only in `.env.hub`; the UUID-bearing URLs are secrets. The
monitor sends empty POST bodies and no campaign, character, account, or error content.

For the launch gate, manual success is not enough. After the next daily windows, verify a new service invocation,
journal entry, operational-run row, and encrypted archive whose timestamps follow the scheduled timer trigger.
If the wall-clock window has not occurred, schedule a bounded follow-up rather than sleeping or claiming success.

## 4. Pull an off-machine copy

Run this on a different trusted computer, not on the Oracle VM. It requires `rsync`, `openssl`, and SSH access
to the VM:

```bash
cd /path/to/your/local/ThelemarTools/checkout
HUB_BACKUP_REMOTE=ubuntu@YOUR_HUB_HOST \
HUB_BACKUP_LOCAL_DIR="$HOME/ThelemarTools-hub-backups" \
./deploy/hub/pull-backups.sh
```

The script copies only new encrypted archives, does not delete remote or local files, rejects a collection
whose newest archive is older than 30 hours, and prints the newest archive's SHA-256. "Newest" is determined by
file modification time across both `hub-YYYY...` scheduled names and `hub-prerelease-...` release names; lexical
filename order is not a safe freshness signal.

Schedule this command on that second computer after 03:00 UTC. Treat a missed run as a high-severity backup
alert. Store the encryption key separately from both the VM and archive directory. Retain at least 14 daily
and 3 monthly archives within available storage.

## 5. Perform an isolated restore drill

Follow the full [encrypted backup and restore drill](backup-restore.md). The Oracle-specific rules proven on
2026-09-12 are:

1. Start one continuous RTO clock **before** archive selection or access. Measure RPO separately from the
   selected archive timestamp.
2. Create a unique internal drill network and a named PostgreSQL 17.6 volume. Do not attach the restored
   database to the production Compose network.
3. Discover the actual production private-network name from the running database container when the temporary
   restore runner must write bounded `restore_drill` evidence. Do not hard-code
   `thelemartools_hub-private`; the current Compose project creates `thelemartools-hub_hub-private`.
4. Generate URL-safe temporary database passwords, for example `openssl rand -hex 24`. Raw Base64 can contain
   `/`, `+`, or `=` and must not be interpolated unescaped into a PostgreSQL URL.
5. The host archive is `0600` and the released operations image runs as non-root `postgres`. Do not weaken the
   source archive permissions. Stage an encrypted, hash-verified copy in a drill-only volume owned by the image's
   `postgres` user, mount that volume read-only, and remove it during exact cleanup.
6. Use the exact released backup, migrate, grant-role, BFF, and static image IDs. Run migrations and grants
   against only the restored database; require the complete ledger, zero pending migrations, valid constraints,
   and runtime-role readiness.
7. Use `HUB_APP_ORIGIN=https://localhost:8443` behind the isolated Caddy edge. The BFF rejects an HTTP origin in
   this production-shaped configuration.
8. Derive the test-only BFF from the exact released BFF with `server/test.Dockerfile`; keep it on the isolated
   database and a loopback-only edge. It must require both `NODE_ENV=test` and
   `HUB_TEST_AUTH_ENABLED=true`. Never add a test-auth switch to the production image or containers.
9. Exercise authenticated session, campaign and character reads/writes, inventory/shared interaction,
   cross-character targeting, and a cross-user/campaign denial. Then rehearse the preserved prior application
   images against the current schema and return the isolated environment to the current release.
10. With separate approval, remove only resources carrying the unique drill label/name. Finish the RTO clock
    after teardown and redacted evidence finalization; retain no temporary credentials or session cookies.

The 2026-09-12 r7 drill used `hub-20260912T092100Z.dump.enc`, SHA-256
`a7737d5bb752805221020f295bd8efef71e9cd8fd496afd9dfc87f804ee80273`. RPO was 3,865 seconds and continuous
RTO was 6,772 seconds. Four production-derived authenticated browser scenarios passed, exact preserved-r6
application reads passed against schema `0007`, the isolated environment returned to r7, and every disposable
resource was removed. The redacted host evidence is mode `0600` at
`~/.local/state/thelemar-hub/recovery-evidence/hub-rto-20260912T102525Z.json`, SHA-256
`f5d20e6ac3b3af5c2613dcd93086e52fdc260ea2678dd5abc35b43f9421fad00`. Do not copy its deleted temporary
credential state into documentation.

The 2026-09-13 scheduled-operation evidence completed V1-G1:

- maintenance triggered at `01:22:40Z`, ran once with `skipped: false`, and produced one succeeded operational
  row at `01:22:41.800835Z`;
- backup triggered at `02:28:07Z`, ran once, and produced one succeeded operational row plus
  `hub-20260913T022807Z.dump.enc`;
- that archive is 139,953 bytes, mode `0600`, owned by `ubuntu:ubuntu`, starts with `HUBENC1`, and has SHA-256
  `997c70f3c67e762422764203a3ab73582c2e6782a5b23ec2c4e5d51b7ca90816`;
- the external heartbeat succeeded; the next daily timer schedules were present; the migration ledger remained
  exactly `0001`-`0007`;
- the exact r7 DB, BFF, static, and edge container IDs remained running with zero restarts. Static and edge were
  re-read at `07:32:25Z` against the `07:29:18Z` snapshot to recover restart counts without restarting or
  recreating either container.

## 6. Daily and release checks

```bash
systemctl --failed
systemctl list-timers 'thelemar-hub-*' --all
journalctl -u thelemar-hub-monitor.service --since '24 hours ago' --no-pager
ls -lh .hub-backups/ | tail
docker compose --env-file .env.hub \
  -f compose.hub.yml -f compose.hub.public.yml ps
curl -fsS "https://${HUB_PUBLIC_DOMAIN}/api/ready"
```

Before each release, run:

```bash
cd /home/ubuntu/ThelemarTools
./deploy/hub/release.sh --dry-run hub-staging-YYYY-MM-DD
./deploy/hub/release.sh hub-staging-YYYY-MM-DD
```

The command records the immutable tag object/full SHA, previous tag/SHA, BFF/static image IDs and repo digests,
Compose/Caddy/migration-policy hash, migration status/plan, durable `schema_mutated` state and exact
planned/applied migration versions, `.env.hub` SHA-256 (never contents), verified encrypted backup
filename/hash/size, readiness, TLS/WebSocket/metrics, static assets, backup age, timestamps, and
rollback result. Evidence is redacted and mode 0600 under
`~/.local/state/thelemar-hub/releases/`.

The command never invokes Compose `down`, removes services or volumes, or recreates PostgreSQL. It validates
that the Compose model contains only named Hub services, recreates only BFF/static/edge, and may stop only the
Hub BFF on the incompatible failure path. An application rollback re-tags the captured BFF/static images and
keeps the current database. Incompatible or contract migrations are normally rejected before apply. Stopping
only the Hub BFF and printing
isolated-restore instructions is a defense-in-depth response to unexpected post-cutover compatibility drift;
no automatic path reverses a migration or restores over production.

The r7 release qualification completed the live Oracle dry-run/release and induced-failure coverage: lock
contention, failed backup before cutover, and forced post-cutover health failure with compatible application
rollback. Retain the redacted release evidence under `~/.local/state/thelemar-hub/releases/`; do not repeat these
host mutations merely to repeat completed V1-G1 evidence.

## Stop conditions

Do not invite players if any of these remain:

- newest host or off-machine encrypted backup is older than 30 hours;
- no successful isolated restore exists within 35 days;
- root disk is at least 85% full or available memory is below 10%;
- TLS expires within 14 days;
- readiness or the WebSocket route is unavailable;
- failed/aged outbox rows, overdue maintenance, or repeated dispatcher errors exist;
- the prior compatible release tag and recovery point are not recorded.
