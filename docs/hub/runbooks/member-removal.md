# Runbook: remove a campaign member

> **Status:** Current private-V1 procedure
> **Last drilled:** 2026-08-24 in memory/API/PostgreSQL tests
> **Owner:** Campaign Hub operator

## Purpose

Remove a non-owner member without losing their characters, stranding escrow, leaving active authorization, or
persisting their private DM workspace as active.

## Preconditions

- Caller is campaign owner/DM, or co-DM removing a player/spectator.
- Target is not campaign owner.
- BFF, database, outbox, and WebSocket fanout are healthy.
- Record request id, campaign id, membership id, actor account id, and timestamp—never character bodies.

## User procedure

Use the Remove control on `campaign.html`. The UI warns that campaign characters return to personal
ownership.

## Authority transaction

The remove command:

1. locks campaign/membership and affected characters;
2. cancels proposed actions involving the member;
3. restores every reserved transfer involving their account/characters;
4. revokes character/workspace leases;
5. detaches owned campaign characters and clears scoped import ids;
6. archives their private DM workspace;
7. marks membership `removed`;
8. appends character/member/action/transfer events and audit;
9. commits one command receipt;
10. closes the account's sockets for that campaign.

## Verify

- membership absent from active member list;
- removed account receives 404/closed socket for campaign;
- detached character is readable by its owner outside the campaign;
- source inventory/currency equals pre-reservation values;
- no reserved transfer/proposed action remains involving target;
- workspace lease is gone and workspace archived;
- audit/event/outbox rows exist.

## Failure/rollback

The PostgreSQL transaction rolls back all database changes. If the HTTP response is lost, retry with the same
idempotency key. Do not manually detach characters or delete membership rows.

If socket closure fails after commit, message/fanout revalidation still closes access; investigate realtime
health and use session revocation if immediate containment is required.
