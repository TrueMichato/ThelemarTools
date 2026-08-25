# Campaign Hub operations

> **Status:** Current local procedures; managed-provider runbooks pending Phase 6E/G
> **Last verified:** 2026-08-24
> **Owner:** Campaign Hub maintainers

The commands below have been exercised locally against PostgreSQL 17. They do not by themselves meet the
private-launch recovery target. Managed PITR, scheduled encrypted backup, monitoring, maintenance, provider
roles, and drilled runbooks remain continuation work.

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
5. Add allowed numeric GitHub subjects to `HUB_ALLOWED_OAUTH_SUBJECTS`, for example `github:12345678`.
   Usernames are intentionally unsupported because renamed usernames can be reclaimed.
6. Serve the static site and BFF behind the same HTTPS origin, forwarding `/api/*` and `/auth/*` to the BFF.
   Set `HUB_TRUST_PROXY` only to the exact proxy IP/CIDR list, and configure that proxy to replace incoming
   forwarded headers. Leave it empty for a directly exposed BFF.
7. Start the BFF with `npm run hub:serve`.

The process refuses to listen until PostgreSQL is reachable and the required ledger migration exists.
`/api/health` also returns 503 if readiness fails. See [migrations.md](migrations.md).

## Backup

Production should enable provider-managed point-in-time recovery before the first cloud character is
accepted. The repository command creates an additional portable custom-format snapshot:

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
3. Sign in with an allowlisted test account and open a representative campaign.
4. Record the backup timestamp, restore duration, checks, and operator.
5. Destroy the drill database.

Private V1 cannot be considered launch-ready until this drill is executed against the selected managed
PostgreSQL provider and meets the documented RPO/RTO.

## Retention and quotas

- Canonical character JSON is limited to 1.5 MB after every import, patch, grant, action, and transfer.
- Command receipts expire after 24 hours and character-returning receipts store only a character reference.
- Run `PostgresHubStore.pDeleteExpiredCommandReceipts()` from the scheduled maintenance worker until it
  returns zero. The expiry index keeps this bounded cleanup efficient.
- Domain-event replay and immutable audit retention remain separate policies; do not delete audit rows as
  part of receipt cleanup.

There is currently no scheduled maintenance worker. Receipt cleanup is an explicit store method. Published
outbox/session/invite cleanup is Phase 6E work. Due account deletion is available as a bounded one-shot:

```bash
DATABASE_URL=... HUB_PURGE_LIMIT=100 npm run hub:purge-accounts
```

The result lists both `purgedAccountIds` and `blockedAccountIds`. Any blocked id is an operational alert:
campaign ownership was acquired or not resolved after deletion was requested.

## Secret and session rotation

- Rotating `HUB_COOKIE_SECRET` invalidates all cookies.
- Rotating `HUB_CSRF_SECRET` invalidates issued CSRF tokens; clients refresh `/api/session`. It also changes
  deterministic invite-token derivation. Existing raw invite links still validate against their stored
  hashes, but retrying an old invite-creation idempotency key can no longer reproduce the original raw token;
  rotate only with this recovery consequence documented.
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

- automated scheduling/alerting for account purge is not yet configured;
- no dedicated BFF image/reference same-origin Compose stack;
- no separate migration/runtime/backup database roles;
- no scheduled maintenance;
- no portable metric/SLO/alert implementation;
- no managed PITR/nightly export configuration;
- no provider restore drill;
- no invite/member/session/account lifecycle administration;
- no real-stack browser/load/fault CI.

See [private-v1-roadmap.md](private-v1-roadmap.md) and [runbooks](runbooks/README.md).
