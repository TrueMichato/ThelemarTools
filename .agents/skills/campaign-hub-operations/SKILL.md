---
name: campaign-hub-operations
description: "Operate, release, recover, and review the Campaign Hub deployment in TrueMichato/ThelemarTools. Use whenever work involves the Oracle Always Free A1 host, deploy/hub/release.sh, immutable Hub release tags, Foundry coexistence on port 30000, migrations or database roles during release, encrypted backups, isolated restores, rollback, systemd maintenance/backup/monitor timers, alerts, staging, V1-G1 host evidence, V1-G2 game day, break glass, secret/session rotation, allowlist or OAuth-provider enablement, member removal, account deletion, campaign ownership recovery, or determining whether merged Hub code is deployed and enabled. Also use for changes to Hub release/backup/restore automation. Do not use for generic Docker/OCI or OAuth work unrelated to the deployed Campaign Hub, or for ordinary Hub product implementation."
---

# Campaign Hub Operations

This skill protects an irreplaceable reused Oracle host and its co-tenant Foundry service. Default to read-only
inspection, exact identity, and fail-closed stops. A working-looking ad hoc command is not an acceptable release
or recovery procedure.

## Start here

Read the reference matching the task:

| Work | Reference |
|---|---|
| Oracle host, Foundry, exact tag promotion, release automation, rollback decision | [Oracle safety and release](./references/oracle-safety-and-release.md) |
| Migrations, roles, backups, isolated restore, lifecycle/incident recovery | [Recovery, migrations and roles](./references/recovery-migrations-and-roles.md) |
| Timers, monitoring, staging/game-day gates, runbook routing and evidence | [Evidence and runbooks](./references/evidence-and-runbooks.md) |

Always verify current `docs/hub/roadmap.md`, `implementation-status.md`, `operations.md`, `staging-plan.md`,
`security.md`, the relevant runbook, and the exact scripts before proposing commands.

## Human authorization boundary

Perform read-only repository and host preflight first. Stop for explicit human authorization before any step
that mutates an external system or could affect availability, data, credentials, access, billing, networking, or
recovery state, including:

- creating or moving a release tag;
- running `release.sh --dry-run` on the shared host, because it temporarily checks out source, builds images,
  takes the release lock, writes evidence, and queries the live database even though it does not mutate service
  or database state;
- running mutating `release.sh`;
- applying migrations or grants outside disposable test infrastructure;
- changing OCI, DNS, firewall, Caddy, systemd, secrets, allowlists, OAuth configuration, or account access;
- starting a production backup/restore, switching databases, rollback, or break-glass action;
- deleting a drill resource or operational evidence.

Authorization for one bounded action does not authorize later destructive or external steps. Present the exact
target, command, expected effect, stop conditions, and recovery path before asking.

## Hard stops

- **Never stop, resize, recreate, terminate, or detach the Oracle A1 instance or boot volume.** Planned guest
  reboot is the only allowed power-cycle action while replacement ARM capacity is unavailable.
- **Never interrupt or reconfigure Foundry.** It must remain listening on port `30000`, and Hub Compose must not
  reference that port.
- **Never deploy a moving branch, lightweight tag, dirty checkout, raw Compose build, or manually chosen image.**
  Promotion uses an immutable annotated `hub-*` tag and `deploy/hub/release.sh`.
- **Never pass `--yes` or type `RELEASE <tag> <sha>` on the operator's behalf.** The human operator must run the
  mutating invocation or enter the final confirmation directly.
- **Never override `HUB_RELEASE_EXPECTED_BRANCH` to make reachability checks pass.** Fix the reviewed ancestry.
- **Never run `docker compose down -v`, delete Hub volumes as rollback, reverse an applied migration, edit the
  migration ledger, or run an ad hoc down migration.**
- **Never restore over the live database.** Restore into an isolated PostgreSQL 17 target, validate it, then make
  a separate authorized switch decision.
- **Never print, copy into Git, or place in evidence** secrets, OAuth material, database URLs, backup keys,
  private campaign data, character bodies, or brew bodies.
- **Never scale beyond one BFF replica** until shared realtime fanout has a new accepted topology decision.
- **Never rewrite coordinated release history.** Use normal descendant commits and immutable release tags; do
  not rebase, amend, reset, squash, force-push, or move a reviewed tag.
- Stop on dirty source, tag/SHA drift, missing migration policy, unhealthy current service, missing/old backup or
  restore evidence, Foundry listener failure, role mismatch, privacy regression, outbox aging, or ambiguous target.

## Operational method

1. **Identify four states separately:** merged source, immutable release candidate, deployed release, and enabled
   capabilities. Do not infer one from another.
2. **Pin identities:** exact HEAD, full tag object and peeled commit SHA, current deployed tag/SHA, protocol,
   migration ledger, Compose/image identity, and capability configuration.
3. **Read the current runbook and script:** commands in prose are secondary to checked-in automation and its
   tests. Confirm the runbook still matches the script.
4. **Run read-only preflight:** inspect current health, clean checkout, tag reachability, backup/restore age,
   disk, migrations/policy, roles, TLS/WebSocket/metrics, one-replica state, and Foundry listener without running
   the release script.
5. **Stop for authorization** before the first external mutation, including a shared-host `release.sh --dry-run`.
6. **Use the narrow automated path.** Let `release.sh`, migration tools, backup scripts, or named runbook own the
   action. Do not improvise equivalent shell.
7. **Verify and record exact-head evidence:** source/tag/SHA, operator/time, versions, migrations, images,
   backup/restore identity, checks, failures, user impact, rollback state, and open waivers—redacted and private.

## Current baseline distinctions

At skill creation baseline `a60020e2e106a1dacdd222769a80a5c199803030`, Oracle records
`hub-staging-2026-09-01` at `8f181712453e048f62abe53b14200886fa965c21`. Newer implementation is merged but
not promoted. V1-G1 host-operations proof and V1-G2 physical game day remain external gates.

Reverify this before every operation. Do not quote historical CI/test totals as proof for a new tag.

## Routing

- Use `campaign-hub-development` for Hub endpoints, stores, realtime, product capabilities, Character Sheet/
  DM Screen integration, or lifecycle code.
- Use this skill as well when changing release, migration, backup, restore, timer, monitor, or operational
  evidence code—the safety contract is part of implementation review.
- Generic Docker/OCI work with no Campaign Hub deployment context does not belong here.
