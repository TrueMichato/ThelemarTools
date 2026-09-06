# Evidence and runbooks

## Scheduled host work

Checked-in systemd units run:

- maintenance around 01:15 UTC;
- encrypted backup around 02:15 UTC;
- host monitoring every five minutes.

Install and drill them only through `docs/hub/runbooks/oracle-operations.md`, with authorization for host
mutation. `Persistent=true` catches missed daily work after reboot; `flock` prevents duplicate jobs.

The monitor checks readiness, protected metrics, WebSocket, TLS, Compose services, disk, memory, CPU load,
outbox, maintenance age, backup age, and restore-drill age. A first run remains unhealthy until an isolated
restore drill records evidence.

Foundry is not covered by the five-minute monitor. `release.sh` verifies its listener during release preflight
and post-release verification; every non-release host procedure must perform the runbook's explicit manual
port-30000 check rather than assuming continuous monitoring.

Thresholds include:

- backup age over 26 hours: investigate; over 30 hours: high severity;
- restore drill older than 35 days: high severity;
- root disk at least 85% or memory below 10%: stop launch/promotion;
- TLS under 14 days, unavailable readiness/WebSocket, aged outbox, or overdue maintenance: stop.

Missing prior release identity is a separate `release.sh` preflight stop, not a monitor threshold.

## V1 external evidence gates

V1-G1 is not implementation work. It requires live-host evidence for:

- release dry run and deliberate promotion of an exact verified descendant tag;
- lock contention, pre-cutover backup failure, and compatible post-cutover rollback failure drills;
- uninterrupted Foundry listener;
- scheduled maintenance/backup/monitor runs;
- encrypted off-machine copy;
- isolated restore within RPO <=24h and RTO <=4h;
- rollback and break-glass decision rehearsal.

V1-G2 starts only after G1 passes. It is a physical one-DM/two-player game day covering real OAuth/devices,
campaign context, character lifecycle, DM workspace, realtime/privacy, semantic effects, inventory/transfers,
disconnect/recovery, leases, and local-mode isolation.

Synthetic CI and local simulation never substitute for these gates. V2 code may be merged independently behind
disabled capabilities.

## Evidence record

Record:

- exact source commit, annotated tag object and peeled SHA;
- deployed and rollback tag/SHA;
- app/protocol/migration/capability versions;
- operator and timestamps;
- exact tests/checks and results;
- image/Compose/provenance identities;
- migration plan/applied versions and compatibility;
- encrypted backup filename/hash/size and restore target/duration;
- TLS/WebSocket/metrics/Foundry/one-replica checks;
- failure phase, traffic/schema mutation state, rollback result;
- defects, waivers, user impact, and go/no-go.

Evidence is private, redacted, and mode 0600 under the documented release evidence directory. Do not store
secrets or campaign content in Git.

## Runbook routing

Use `docs/hub/runbooks/README.md` and select the exact current procedure:

- `deploy-promote.md`: immutable tagged release;
- `oracle-operations.md`: timers, monitoring, off-machine backup, restore drill;
- `backup-restore.md`: portable encrypted backup and isolated restore;
- `rollback.md`: application compatibility or database-switch decision;
- `migration-failure.md`: migration stop/recovery;
- `database-outage.md`: readiness and database incident;
- `outbox-failure.md`: event delivery backlog;
- `incident.md`: declaration, containment, evidence;
- `secret-rotation.md`, `session-compromise.md`, `allowlist-change.md`: security/access changes;
- `auth-provider-registry.md`: provider enablement and rollback; use the checked-in
  `hub:check-auth-first-enable` and `hub:check-auth-rollback` preflights where the runbook requires them;
- `member-removal.md`, `account-deletion.md`, `campaign-ownership-recovery.md`: lifecycle operations; account
  purge uses the checked-in `hub:purge-accounts` path rather than ad hoc database deletion;
- `oracle-provisioning.md`: host-specific reference; its no-stop/Foundry rules apply even after provisioning.

Each runbook action must preserve its stated prerequisites, stop conditions, verification, rollback, evidence,
and escalation owner.
