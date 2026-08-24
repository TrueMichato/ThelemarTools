# Campaign Hub implementation status

> **Last updated:** 2026-08-24
> **Owner:** Campaign Hub maintainers

## Status

Private invite-only V1 is implemented through Phase 5 on `multiplayer-hub`. The code is ready for a
private-table staging deployment after the environment-specific gates below are completed. Semi-public
onboarding remains intentionally disabled.

Phase 6A documentation/handoff and the approved checkpoint commit series are complete. Combined Hub
validation passes 30 suites / 216 tests with a clean tree. Migration 0001 is immutable; Phase 6B lifecycle
and Phase 6C migrations are ready to begin. Phases 6D-6H remain pending; see
[private-v1-roadmap.md](private-v1-roadmap.md).

## Implemented

- Private GitHub OAuth allowlist, server sessions, CSRF/origin checks, protocol gating.
- Accounts, campaigns, roles, invites, membership, export, archive, and ownership transfer.
- Local/cloud Character Sheet repository switch, non-destructive claim, clone, move, archive, lease takeover.
- Immutable campaign brew/rules versions and early page context activation.
- Private per-DM workspaces using the existing Board blob and lease fencing.
- Authenticated WebSockets, presence, visibility-filtered event replay, snapshots, outbox dispatcher.
- DM full character reads; limited player projections; live Party Tracker linked rows.
- Durable roll log.
- Structured effect proposals/approval, XP/item grants, party inventory, escrowed item/currency transfers.
- Whole-item transfers preserve Character Sheet invariants, rollback identity, and metadata-safe stack merges.
- Character HTML is sanitized at the authority boundary; canonical documents are capped at 1.5 MB after
  every mutation.
- Idempotency receipts are compact, expire after 24 hours, and have bounded cleanup support.
- Backup/restore scripts and successful PostgreSQL 17 restore drills.

## Final verification

- Blocker-only security/correctness review: no unresolved high-severity findings.
- Complete broad Jest gate: 601 suites and 17,495 tests passed. The Phase 6A Hub gate passes
  30 suites / 216 tests, including documentation, invite-recovery, and sanitizer regressions.
- Character Sheet: 527 suites and 16,819 tests passed.
- DM Screen targeted regression: 6 suites and 138 tests passed.
- Fresh PostgreSQL 17 migration, real grant/transfer/quota transactions, compact receipt inspection, backup,
  and single-transaction restore passed against a UTF-8 drill cluster.
- Repository JavaScript lint, Hub/DM Screen SCSS lint/build, service-worker build, and production dependency
  audit passed.
- Signed-out Hub, signed-in Hub, and DM Campaign views were checked at desktop and 390 px mobile widths with
  clean consoles, no horizontal overflow, and 44 px visible controls.

## V1 limitations

- Monster/NPC structured actions are not automated.
- Campaign brew intentionally rejects raw HTML and persistent blocklists.
- Full simultaneous character/Board co-editing is not supported; one active editor holds the lease.
- Offline players can view a cached copy only; cloud mutation requires an authenticated online session.
- Semi-public moderation, self-service recovery, billing, and legal/privacy publication are not enabled.

## Deployment gates

1. Configure managed PostgreSQL point-in-time recovery and execute the restore drill there.
2. Configure same-origin HTTPS routing and exact trusted proxy CIDRs.
3. Create the GitHub OAuth app and stable numeric allowlist.
4. Store independent cookie/CSRF/OAuth/database secrets in the deployment secret manager.
5. Complete a private-table staging session with real GitHub OAuth and multiple physical devices before
   inviting the V1 group.
