# Runbook: application/database rollback

> **Status:** Portable procedure
> **Owner:** Campaign Hub operator

## Application-only rollback

Use when the prior image supports the current schema:

1. Stop promotion.
2. Record incident/request/build versions.
3. Deploy prior immutable BFF/static digests.
4. Verify required migration compatibility before readiness.
5. Probe auth, character read/write, WebSocket, outbox, and local-only mode.
6. Monitor errors/outbox for at least the promotion window.

## Database restore rollback

Use only when data/schema crossed a boundary incompatible with the prior app:

1. Stop BFF writes and outbox dispatcher.
2. Preserve current database and logs/evidence.
3. Select provider PITR timestamp or encrypted backup tied to the intended image/migrations.
4. Restore into an isolated database first.
5. Verify migration ledger, counts/constraints, representative account/campaign/character, outbox, and
   authorization.
6. Promote restored database using provider-safe switch.
7. Deploy compatible image digest.
8. Verify RPO impact and notify affected private users.

Do not:

- delete/modify migration ledger rows;
- edit applied SQL;
- restore over production without an isolated validation;
- replay client mutations blindly after rollback.
