# Runbook: account deletion grace and purge

> **Status:** Current private-V1 procedure; scheduling/alerts pending Phase 6E
> **Last drilled:** 2026-08-24 in memory/API/PostgreSQL tests
> **Owner:** Campaign Hub operator

## Request

The user:

1. exports account data;
2. resolves every active owned campaign by ownership transfer or archive;
3. types `DELETE` in the Hub account control.

The authority sets `deletion_requested`, records request/deadline, revokes sessions/leases, closes sockets, and
clears the current cookie. Active campaign ownership returns `ACCOUNT_OWNS_CAMPAIGN` with blocking ids.

## Grace

Grace lasts seven days.

- Reauthentication is allowed.
- `/api/session`, export, deletion status/cancel, and logout remain available.
- Ordinary campaign/API/WebSocket access returns `ACCOUNT_DELETION_PENDING`.
- Cancellation clears timestamps/status and restores normal access.

## Purge

Until Phase 6E schedules it, run bounded purge as the runtime authority:

```bash
DATABASE_URL=... HUB_PURGE_LIMIT=100 npm run hub:purge-accounts
```

Record build/migration version, timestamp, `purgedAccountIds`, and `blockedAccountIds` in the private
operations evidence store.

Purge:

- resolves active memberships with the same safe lifecycle transaction;
- restores escrow/cancels pending work;
- deletes owned characters and owned archived campaigns;
- removes identities/sessions/memberships/workspaces/receipts;
- nulls/anonymizes retained actor references;
- removes the account.

## Blocked purge

Any `blockedAccountIds` result is an alert. Confirm whether a non-archived campaign is still owned. Do not
force-delete the account. Resolve ownership/archive, then rerun.

## Verify

- account/identity/session/owned-character rows absent;
- no event/action/transfer actor FK references account;
- no character/action/transfer FK blocks remain;
- retained audit/domain history has null actor where required;
- other users' detached characters and active campaigns are unaffected;
- backup deletion-aging date is recorded.

## Backup limitation

Purge cannot rewrite immutable backups or PITR history. Privacy documentation and deletion evidence must state
when configured retention makes the data unrecoverable.
