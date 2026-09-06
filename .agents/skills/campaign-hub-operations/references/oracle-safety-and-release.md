# Oracle safety and release

## Protected host

The private staging stack reuses an Oracle Always Free A1 VM on Ubuntu 22.04. Replacement ARM capacity is not
assumed available.

- Never use OCI Stop, guest `shutdown -h`, `poweroff`, `halt`, or `systemctl poweroff`; never recreate,
  terminate, shape-resize, or detach/attach the boot volume. Those actions re-enter scarce ARM capacity or
  destroy the protected host allocation.
- `sudo reboot`, OCI **Reboot**, and OCI **Reset** preserve the host allocation, but use them only when the
  current runbook directs the action and the human explicitly approves it.
- Online boot-volume expansion does not require a stop. Use it only when the runbook directs it and the human
  explicitly approves it; identify the real root device with `findmnt`/`lsblk`, follow OCI's documented
  rescan/grow procedure, and verify filesystem growth. The current 100 GB volume has ample headroom.
- The host is dedicated to the Hub after Foundry was intentionally decommissioned. Release and rollback remain
  confined to named Hub services; never use the Hub procedure for host-wide cleanup.
- Keep exactly one Hub BFF replica because realtime fanout is process-local.

Primary sources: ADR 0010, `docs/hub/runbooks/oracle-provisioning.md`,
`docs/hub/runbooks/oracle-operations.md`, `docs/hub/staging-plan.md`, and `docs/hub/risk-register.md`.

## Required promotion path

Only deploy a reviewed commit reachable from `origin/multiplayer-hub` through an immutable annotated `hub-*` tag:

```bash
./deploy/hub/release.sh --dry-run hub-staging-YYYY-MM-DD
./deploy/hub/release.sh hub-staging-YYYY-MM-DD
```

The dry run does not apply migrations, grant roles, create a backup, or recreate services. It is not a
read-only host inspection: it takes the release lock, temporarily checks out the candidate, builds images,
writes evidence, and runs a migration-plan container against the live database connection. Complete ordinary
read-only health/disk/tag/Compose-scope preflight first, then obtain explicit authorization before running it on the
shared host.

The mutating invocation requires the typed confirmation:

```text
RELEASE <tag> <full-40-character-sha>
```

`--yes` skips the final typed operator confirmation while leaving automated checks enabled. An agent must never
pass it or type the confirmation on the operator's behalf. The human operator must run the mutating invocation
or enter the confirmation directly. Do not create or move the tag, run the dry run on the shared host, or run
the mutating command without explicit authorization.

The script owns:

- process lock and host/current health checks;
- immutable tag object/SHA verification and exact checkout;
- Hub-only Compose service-scope validation;
- encrypted pre-release backup authentication/hash/list verification;
- migration policy/plan and previous-app compatibility;
- exact candidate image IDs and revision labels;
- migration/grants/cutover;
- complete public/runtime/static/backup checks;
- redacted mode-0600 evidence;
- schema-compatible application-only automatic rollback.

Never replace it with `git pull` plus raw `docker compose up --build`.

## Release stop conditions

Stop before mutation on:

- dirty/moved/unreachable/lightweight tag or source/tag drift;
- any attempt to override `HUB_RELEASE_EXPECTED_BRANCH` to bypass reviewed-ancestry checks;
- wrong repository/root/user/UID/GID or permissive `.env.hub`;
- low release/backup disk;
- current readiness/TLS/WebSocket/metrics/container/backup failure;
- any non-Hub service in the rendered Compose model;
- pending migration missing an explicit entry in `deploy/hub/migration-policy.json`;
- contract migration, incompatible previous application, or checksum drift;
- BFF using owner database role;
- privacy/authorization regression or aging outbox.

At creation baseline, migration `0007_peer_source_costs.sql` exists while `migration-policy.json` ends at
`0006`. Treat promotion as blocked until that mismatch is intentionally reviewed and corrected; do not bypass
the release helper.

## Rollback decision

- Before migration: failure leaves running service/database unchanged.
- After compatible expand migration: application images/source may roll back; schema remains forward.
- Incompatible or contract migration: stop Hub BFF writes, preserve current database/evidence, and enter the
  isolated-restore decision path.
- Automatic or ad hoc database restore over the live database is forbidden.

Primary sources: `deploy/hub/release.sh`, `deploy/hub/release-helper.py`,
`docs/hub/runbooks/deploy-promote.md`, `docs/hub/runbooks/rollback.md`, and
`test/jest/hub/HubReleaseAutomation.test.js`.
