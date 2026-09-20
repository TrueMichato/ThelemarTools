# Campaign Hub operations

> **Status:** Current portable procedures plus Oracle host installation runbook
> **Last verified:** 2026-09-13
> **Owner:** Campaign Hub maintainers

The commands below have been exercised locally against PostgreSQL 17. The reused Oracle host is now dedicated
to the Campaign Hub after Foundry was intentionally decommissioned; release automation remains scoped to the
named Hub Compose services and does not perform host-wide cleanup. The deployment uses
nightly encrypted portable backups rather than managed PITR. Installation, off-machine copying, monitoring,
and the isolated restore drill are defined in
[Oracle host operations](runbooks/oracle-operations.md). Manual operations, monitoring, off-machine copying,
authenticated recovery, and exact-release rollback passed on Oracle on 2026-09-12. Genuine scheduled daily
maintenance and backup executions passed on 2026-09-13, completing V1-G1.

## Local/initial setup

1. Copy `server/.env.example` into your secret-management system. Do not commit a populated `.env`.
2. Create the PostgreSQL database.
3. Apply the schema:

   ```bash
   DATABASE_URL=... npm run hub:migrate:plan
   DATABASE_URL=... npm run hub:migrate
   DATABASE_URL=... npm run hub:migrate:status
   ```

4. Create a GitHub OAuth application with callback
   `<HUB_APP_ORIGIN>/auth/github/callback`.
5. Set `HUB_AUTH_PROVIDERS=github`. `HUB_AUTH_EMERGENCY_DISABLED_PROVIDERS` is an incident-only kill switch;
   disabling the sole provider intentionally prevents startup.
6. Apply migration 0009, configure `HUB_OPERATOR_ACCOUNT_IDS` with explicitly designated internal account UUIDs,
   and leave both `HUB_ACCOUNT_ENTITLEMENTS_ENABLED=false` and
   `HUB_INVITE_ACCOUNT_ADMISSION_ENABLED=false` until the r9 preflight passes. Startup reconciliation is
   add-only: missing configured accounts warn, new configured operators are audited, and removed configuration
   never revokes authority.
   Configure an independent `HUB_INVITE_TOKEN_SECRET`; do not reuse cookie or CSRF secrets.
7. Serve the static site and BFF behind the same HTTPS origin, forwarding `/api/*` and `/auth/*` to the BFF.
   Set `HUB_TRUST_PROXY` only to the exact proxy IP/CIDR list, and configure that proxy to replace incoming
   forwarded headers. Leave it empty for a directly exposed BFF.
8. Start the BFF with `npm run hub:serve`.

Layer 2 deploys Discord and Google disabled in normal production. Existing users add another provider only
through layer 3's explicit reauthentication and **Link provider** flow; linking never consumes another campaign
invite. For isolated staging acceptance only, use fresh identities, configure
`HUB_AUTH_PROVIDERS=github,discord,google`, and run:

```bash
HUB_APP_ORIGIN=https://staging.example \
HUB_METRICS_TOKEN=... \
npm run hub:check-auth-first-enable
```

The command requires both providers to be `available`, snapshots their aggregate success counters, and passes
only after a new complete callback increments each counter. A partial pass, provider reset, malformed response,
or timeout blocks enablement. It emits no subject, account, profile, or OAuth material. After layer 3, use the
same paired preflight before first production enablement. Independent emergency disablement is allowed only
after admission.

The process refuses to listen until PostgreSQL is reachable and the required ledger migration exists.
`/api/health` also returns 503 if readiness fails. See [migrations.md](migrations.md).

### r9 entitlement enablement

1. Verify migration 0009 and role grants on an isolated restored database.
2. Confirm every non-deleted current campaign owner, including archived/deleting owners, has exactly one active
   `campaign:create`; confirm role-only DM/co-DM accounts were not backfilled.
3. Confirm every configured operator UUID exists and has active `platform:operate` plus `campaign:create`.
   Run `npm run hub:check-account-entitlements` with the candidate environment; it performs the same add-only
   reconciliation and fails unless an active platform operator remains.
4. Complete provider reauthentication as one designated operator, grant and revoke a synthetic creator, and
   prove the revoked account receives `CAMPAIGN_CREATE_NOT_ENTITLED` with zero campaign/audit/event/outbox
   creation side effects.
5. Set `HUB_ACCOUNT_ENTITLEMENTS_ENABLED=true`, restart through the normal release path, and verify
   `account.entitlements.v1` in `/api/meta` and entitlement arrays in `/api/session`.
6. Only after that evidence may `HUB_INVITE_ACCOUNT_ADMISSION_ENABLED=true` be considered.

Rollback is application-only: set both switches false or deploy the previous compatible application. Leave
`hub.account_entitlements` and migration 0009 in place; never down-migrate or delete entitlement rows.

Before rolling back to a GitHub-only image, prove every active account still has a GitHub identity:

```bash
DATABASE_URL=... \
HUB_ALLOWED_OAUTH_SUBJECTS=github:12345678 \
HUB_ROLLBACK_SUPPORTED_AUTH_PROVIDERS=github \
npm run hub:check-auth-rollback
```

`HUB_ALLOWED_OAUTH_SUBJECTS` is read only by this legacy-image rollback preflight; the running r9 BFF does not
use it for admission. Exit status 2 blocks rollback without exposing account or subject identifiers. Follow the
[authentication provider registry runbook](runbooks/auth-provider-registry.md).

## Backup

The Oracle deployment creates encrypted portable snapshots through the `backup` Compose profile. The
unencrypted command below remains a local development reference only:

```bash
DATABASE_URL=... npm run hub:backup -- backups/hub-YYYY-MM-DD.dump
```

The command refuses to overwrite an existing file. Store backups encrypted outside the application host.

## Restore drill

Never test restores against production. Provision an empty drill database, then:

```bash
DATABASE_URL=postgresql://.../hub_restore_drill \
HUB_RESTORE_CONFIRM=RESTORE \
npm run hub:restore -- backups/hub-YYYY-MM-DD.dump
```

After restore:

1. Start the BFF against the drill database and check `/api/health`.
2. Verify account, campaign, membership, character, audit, event, and outbox counts.
3. Sign in with an existing test account and open a representative campaign.
4. Record the backup timestamp, restore duration, checks, and operator.
5. Destroy the drill database.

The 2026-09-12 Oracle drill met the documented objectives: RPO 3,865 seconds and continuous RTO 6,772 seconds,
with exact-r7 authenticated workflows, exact-r6 compatibility on schema `0007`, exact-r7 return, and complete
disposable cleanup. Repeat at least every 35 days and after a material recovery-path change.

## Retention and quotas

- Canonical character JSON is limited to 1.5 MB after every import, patch, grant, action, and transfer.
- Command receipts expire after 24 hours and character-returning receipts store only a character reference.
- Invite-creation receipts store no raw invite. The BFF reconstructs an exact retry with
  `HUB_INVITE_TOKEN_SECRET`.
- Run `PostgresHubStore.pDeleteExpiredCommandReceipts()` from the scheduled maintenance worker until it
  returns zero. The expiry index keeps this bounded cleanup efficient.
- Domain-event replay and immutable audit retention remain separate policies; do not delete audit rows as
  part of receipt cleanup.

Maintenance is a singleton advisory-locked bounded one-shot. Oracle timer units are checked in; installation,
enablement, and scheduled execution evidence passed for V1-G1:

```bash
DATABASE_URL=... HUB_MAINTENANCE_BATCH_SIZE=1000 npm run hub:maintenance
```

It removes expired receipts, old published outbox rows, expired/revoked sessions/invites, and old leases,
then processes due deletion. User-visible domain/audit/roll/action history is preserved. The result lists
both `purgedAccountIds` and `blockedAccountIds`; blocked ids are alerts.

Encrypted backup:

```bash
DATABASE_URL=... \
HUB_OPERATIONS_DATABASE_URL=... \
HUB_BACKUP_ENCRYPTION_KEY=... \
npm run hub:backup:encrypted -- /secure/path/hub-YYYY-MM-DD.dump.enc
```

See [observability.md](observability.md) and [backup/restore runbook](runbooks/backup-restore.md).

## Secret and session rotation

- Rotating `HUB_COOKIE_SECRET` invalidates all cookies.
- Rotating `HUB_CSRF_SECRET` invalidates issued CSRF tokens; clients refresh `/api/session`. Invite tokens use
  the independent invite-token secret and are unaffected.
- Rotating `HUB_INVITE_TOKEN_SECRET` prevents reconstruction of raw tokens for outstanding invite-creation
  receipt retries unless the old key remains in `HUB_INVITE_TOKEN_PREVIOUS_SECRETS`. Add the new current key,
  retain prior keys newest-first for at least 24 hours, then remove expired keys. Existing distributed invite
  links continue to validate against stored hashes. More than four total keys or duplicate/short keys fail startup.
- Rotate the GitHub client secret through the provider and deployment secret manager.
- Revoke individual browser sessions through the database/admin path; logout revokes the current token.

## Database roles

Provision role identities/passwords in the provider, then grant least privilege as the migration owner:

```bash
DATABASE_URL=... \
HUB_RUNTIME_DB_ROLE=hub_runtime \
HUB_BACKUP_DB_ROLE=hub_backup \
npm run hub:grant-roles
```

The runtime connection string used by `hub:serve` should belong to `hub_runtime`; migration and grant commands
use the schema owner. The backup command should use the read-only backup role when the provider permits.

## Current launch gaps

- complete the physical [one-DM/two-player game day](runbooks/private-game-day.md) and record the explicit
  private-launch go/no-go.

See the [living roadmap](roadmap.md) and [runbooks](runbooks/README.md).
