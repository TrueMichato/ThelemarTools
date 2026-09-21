# Runbook: application/database rollback

> **Status:** Portable procedure
> **Last drilled:** 2026-09-12 on Oracle with r6 -> r7
> **Owner:** Campaign Hub operator

## Application-only rollback

Use when the prior image supports the current schema:

1. Stop promotion.
2. Record incident/request/build versions.
3. Run `npm run hub:check-auth-rollback` with the exact providers supported by the target image and, only when
   that target still requires it, the optional legacy allowlist. Stop if it reports any blocked account.
4. If schema 0011 is present, run the matching multi-target rollback preflight:

   ```bash
   DATABASE_URL=... \
   HUB_MULTI_TARGET_ROLLBACK_TARGET=pre-0011 \
   npm run hub:check-multi-target-rollback
   ```

   Exit status 2 blocks rollback. A present usage marker blocks a true pre-0011 target permanently, regardless
   of current parent/child/finalization counts. Nonzero normalized-history counts also fail closed as inconsistent
   with schema-before-use. The JSON result contains aggregate counts/deadlines only and never participant,
   character, invitation, operation, or campaign identities.

   Release automation first stops the candidate BFF to quiesce writes, then reruns this pre-0011 marker
   preflight immediately before any automatic post-cutover application rollback whenever the database contains
   migration 0011 and the previous image requires an older schema, including a retry where an earlier attempt
   applied 0011. The BFF remains stopped through the rollback-or-isolate decision. If quiescing fails, automation
   retries the Hub BFF stop once, then uses a bounded exact-container `docker stop --time 10` fallback and
   verifies that no Compose BFF remains running. If verification still fails, it records a critical fence
   failure and warns that the candidate may still accept writes; it does not claim isolation or start a previous
   image. If the marker appeared after cutover, automation records the
   incompatibility and keeps the quiesced BFF isolated.
   A valid exit-2 preflight records the bounded marker/history blockers. A Docker, database, timeout, script, or
   malformed-result failure is recorded separately as `multi-target-rollback-preflight-failed`; rollback remains
   forbidden, but evidence never falsely claims that the irreversible marker was observed.
5. Confirm every pending/applied migration is classified in `deploy/hub/migration-policy.json`.
6. Deploy prior immutable BFF/static digests.
7. Verify required migration compatibility before readiness.
8. Probe auth, character read/write, WebSocket, outbox, and local-only mode.
9. Monitor errors/outbox for at least the promotion window.

For a rehearsal, do not retag mutable production references or replace live containers. Start the prior
preserved BFF/static image IDs in a uniquely named isolated stack against the restored current-schema database.
Discover the preservation references from the current release evidence: the preservation tag name identifies
the release operation that created it, while its OCI revision/version labels identify the application actually
preserved.

Migration 0006 is previous-app-compatible before any currently admitted account relies solely on a provider
unsupported by the target image. Never infer rollback safety from provider row counts alone; invite-admitted
accounts are also constrained by an optional historical allowlist whenever the target image still enforces it.
Already de-admitted accounts do not make an otherwise compatible rollback less safe. The
preflight returns only a count to avoid exposing account/provider subjects in evidence.

Migration 0009 is an additive previous-app-compatible expand migration. Reverting the application leaves
`hub.account_entitlements` in place and disables enforcement; do not reverse migration 0009 or delete
entitlement rows. Before rollback, set `HUB_INVITE_ACCOUNT_ADMISSION_ENABLED=false` so a pre-entitlement image
cannot admit accounts under a policy it does not enforce.

Migration 0010 is also additive and previous-app-compatible. It only replaces the existing source-cost binding
snapshot helpers with stricter identity/cardinality semantics; do not restore the migration-0007 `LIMIT 1`
function as rollback. A predecessor application can run with migration 0010 in place because the schema and
persisted source-cost descriptors are unchanged.

Migration 0011 is previous-app-compatible only before use. A true pre-0011 rollback requires the preflight above
to pass with an absent marker and zero normalized history. Once `hub.semantic_multi_target_usage` exists, the
normal rollback target must be a bridge/r10+ release which understands `target_set_version`, normalized target
and finalization history, expiry, retention, explicit purge cleanup, projection filtering, and the marker.
For a bridge target, declare every template registry version it supports:

```bash
DATABASE_URL=... \
HUB_MULTI_TARGET_ROLLBACK_TARGET=bridge \
HUB_MULTI_TARGET_SUPPORTED_TEMPLATE_REGISTRY_VERSIONS=multi-target-effects-v1 \
npm run hub:check-multi-target-rollback
```

The bridge preflight reports total/live parent and child counts, pending/selected/applied-leg counts, oldest
collection/finalization/terminal deadlines, incomplete history, unsupported template counts, marker state, and
90-day cleanup readiness. It fails on incomplete history or unsupported template versions. It does not delete
history or the marker. Returning to a true pre-0011 binary after use requires a separately reviewed destructive
history/event/outbox/recovery export-and-purge procedure, backup, explicit human authorization, and marker
deletion last; that is not normal rollback and is not defined here.

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
