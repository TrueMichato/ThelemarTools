# Runbook: application/database rollback

> **Status:** Portable procedure
> **Owner:** Campaign Hub operator

## Application-only rollback

Use when the prior image supports the current schema:

1. Stop promotion.
2. Record incident/request/build versions.
3. Run `npm run hub:check-auth-rollback` with the exact providers supported by the target image and the current
   allowlist. Stop if it reports any blocked account.
4. Confirm every pending/applied migration is classified in `deploy/hub/migration-policy.json`.
5. Deploy prior immutable BFF/static digests.
6. Verify required migration compatibility before readiness.
7. Probe auth, character read/write, WebSocket, outbox, and local-only mode.
8. Monitor errors/outbox for at least the promotion window.

Migration 0006 is previous-app-compatible before any currently admitted account relies solely on a provider
unsupported by the target image. Never infer rollback safety from provider row counts alone; the exact allowlist
is part of usability. Already de-admitted accounts do not make an otherwise compatible rollback less safe. The
preflight returns only a count to avoid exposing account/provider subjects in evidence.

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
