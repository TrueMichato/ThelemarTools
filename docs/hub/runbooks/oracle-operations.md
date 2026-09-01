# Runbook: Oracle host operations for the Campaign Hub

> **Status:** Ready to install and drill on the reused Oracle host
> **Owner:** Campaign Hub operator

This procedure adds scheduled maintenance, encrypted backups, off-machine copies, and five-minute health
checks without stopping or resizing the Oracle instance.

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

The public Compose overlay runs the backup container as UID/GID 1000, matching the standard Oracle `ubuntu`
account. If that account has a different result from `id -u` or `id -g`, set `HUB_BACKUP_UID` and
`HUB_BACKUP_GID` in `.env.hub`.

The success URL creates an external dead-man's-switch signal. The failure URL receives an empty POST when a
check fails. Do not put secrets or campaign identifiers in either URL's label.

## 2. Install the systemd units

The checked-in units assume the deployment is `/home/ubuntu/ThelemarTools` and runs as `ubuntu`. If either
differs, edit the copied units—not the repository copies—before enabling them.

```bash
cd /home/ubuntu/ThelemarTools
chmod 750 deploy/hub/monitor-host.sh deploy/hub/pull-backups.sh
sudo cp deploy/hub/systemd/thelemar-hub-* /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now \
  thelemar-hub-maintenance.timer \
  thelemar-hub-backup.timer \
  thelemar-hub-monitor.timer
systemctl list-timers 'thelemar-hub-*' --all
```

The timers run maintenance around 01:15 UTC, backup around 02:15 UTC, and monitoring every five minutes.
`Persistent=true` catches up a missed daily run after a reboot. `flock` prevents duplicate jobs.

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
threshold. A first run is expected to fail on `hub_last_restore_drill_age_seconds = -1` until Step 5 succeeds.

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
whose newest archive is older than 30 hours, and prints the newest archive's SHA-256.

Schedule this command on that second computer after 03:00 UTC. Treat a missed run as a high-severity backup
alert. Store the encryption key separately from both the VM and archive directory. Retain at least 14 daily
and 3 monthly archives within available storage.

## 5. Perform an isolated restore drill

Choose an archive, generate a temporary drill password, and create a throwaway PostgreSQL container on the
private Compose network:

```bash
cd /home/ubuntu/ThelemarTools
export DRILL_PASSWORD="$(openssl rand -base64 24)"
docker run -d --name hub-restore-drill \
  --network thelemartools_hub-private \
  -e POSTGRES_PASSWORD="$DRILL_PASSWORD" \
  -e POSTGRES_DB=hub_restore \
  postgres:17.6-bookworm
until docker exec hub-restore-drill pg_isready -U postgres -d hub_restore; do sleep 2; done
```

Restore through the operations image. Replace the archive name:

```bash
docker compose --env-file .env.hub \
  -f compose.hub.yml -f compose.hub.public.yml \
  --profile backup run --rm --no-deps \
  -e DATABASE_URL="postgresql://postgres:${DRILL_PASSWORD}@hub-restore-drill:5432/hub_restore" \
  -e HUB_RESTORE_CONFIRM=RESTORE \
  backup \
  node server/scripts/restore-encrypted.mjs /backups/hub-YYYYMMDDTHHMMSSZ.dump.enc
```

Verify the migration ledger, representative rows, and constraints without printing character or homebrew
bodies:

```bash
docker exec hub-restore-drill psql -U postgres -d hub_restore -c \
  'SELECT version, filename, applied_at FROM hub.schema_migrations ORDER BY version;'
docker exec hub-restore-drill psql -U postgres -d hub_restore -c \
  'SELECT (SELECT count(*) FROM hub.campaigns) campaigns,
          (SELECT count(*) FROM hub.characters) characters,
          (SELECT count(*) FROM hub.dm_workspaces) workspaces,
          (SELECT count(*) FROM hub.domain_events) events;'
docker exec hub-restore-drill psql -U postgres -d hub_restore -c \
  'SELECT c.id, c.name, count(ch.id) character_count
     FROM hub.campaigns c LEFT JOIN hub.characters ch ON ch.campaign_id = c.id
    GROUP BY c.id, c.name ORDER BY c.created_at DESC LIMIT 3;'
```

Start an isolated BFF readiness check against the restored database:

```bash
docker compose --env-file .env.hub \
  -f compose.hub.yml -f compose.hub.public.yml \
  run --rm --no-deps -p 127.0.0.1:5053:5052 \
  -e DATABASE_URL="postgresql://postgres:${DRILL_PASSWORD}@hub-restore-drill:5432/hub_restore" \
  -e HUB_APP_ORIGIN=http://127.0.0.1:5053 \
  bff
```

From a second SSH shell, run `curl -fsS http://127.0.0.1:5053/api/ready`, then stop the foreground BFF with
Ctrl-C. Record the archive SHA-256, duration, row counts, migration version, representative campaign IDs, and
result in the private operations record.

Delete only the named drill container:

```bash
docker rm -f hub-restore-drill
unset DRILL_PASSWORD
sudo systemctl start thelemar-hub-monitor.service
```

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

Before each release, also record the git tag/SHA, BFF/static image IDs, migration status, `.env.hub` SHA-256
(hash only), latest backup SHA-256, tested rollback tag, and the browser/unit gate results. Never copy
`.env.hub` contents into the evidence.

## Stop conditions

Do not invite players if any of these remain:

- newest host or off-machine encrypted backup is older than 30 hours;
- no successful isolated restore exists within 35 days;
- root disk is at least 85% full or available memory is below 10%;
- TLS expires within 14 days;
- readiness or the WebSocket route is unavailable;
- failed/aged outbox rows, overdue maintenance, or repeated dispatcher errors exist;
- the prior compatible release tag and recovery point are not recorded.
