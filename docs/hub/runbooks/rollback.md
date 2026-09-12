# Runbook: application/database rollback

> **Status:** Portable procedure
> **Last drilled:** 2026-09-12 on Oracle with r6 -> r7
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

For a rehearsal, do not retag mutable production references or replace live containers. Start the prior
preserved BFF/static image IDs in a uniquely named isolated stack against the restored current-schema database.
Discover the preservation references from the current release evidence: the preservation tag name identifies
the release operation that created it, while its OCI revision/version labels identify the application actually
preserved.

Migration 0006 is previous-app-compatible before any currently admitted account relies solely on a provider
unsupported by the target image. Never infer rollback safety from provider row counts alone; the exact allowlist
is part of usability. Already de-admitted accounts do not make an otherwise compatible rollback less safe. The
preflight returns only a count to avoid exposing account/provider subjects in evidence.

### 2026-09-12 exact-release evidence

Release r7 evidence identified predecessor `hub-staging-2026-09-08-r6` at
`1cf2810e69156e2b197acee8acfe18481dafcb8e`. The preserved application images were:

- BFF `sha256:03261fc95615f7bc5a3df04b2989acd469f2e4dad59e8cb411d6c61d803f3101`;
- static `sha256:c7b6947294c7514245f864d360402f44d6516411fb628435865a08a868d2a481`.

The exact-r6 auth rollback preflight reported zero blocked production accounts. In the isolated restored
environment, r6 reached readiness on schema `0007` and returned authenticated session, campaign, character,
and party-inventory reads. The same environment then returned to exact r7 and repeated authenticated reads.
Production container IDs remained unchanged with zero restarts. This proves application compatibility; it does
not authorize a production rollback without a new explicit operator approval.

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
