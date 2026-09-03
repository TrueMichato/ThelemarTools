# Campaign Hub operations

> **Status:** Current portable procedures plus Oracle host installation runbook
> **Last verified:** 2026-08-31
> **Owner:** Campaign Hub maintainers

The commands below have been exercised locally against PostgreSQL 17. The reused Oracle deployment uses
nightly encrypted portable backups rather than managed PITR. Installation, off-machine copying, monitoring,
and the isolated restore drill are defined in
[Oracle host operations](runbooks/oracle-operations.md); the resulting evidence must still be produced on the
live host before private launch.

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
6. Add allowed numeric GitHub subjects to `HUB_ALLOWED_OAUTH_SUBJECTS`, for example `github:12345678`.
   Usernames are intentionally unsupported because renamed usernames can be reclaimed.
7. Serve the static site and BFF behind the same HTTPS origin, forwarding `/api/*` and `/auth/*` to the BFF.
   Set `HUB_TRUST_PROXY` only to the exact proxy IP/CIDR list, and configure that proxy to replace incoming
   forwarded headers. Leave it empty for a directly exposed BFF.
8. Start the BFF with `npm run hub:serve`.

Layer 2 deploys Discord and Google disabled in normal production. Do not add an existing user's Discord or
Google subject to the private-cohort allowlist before layer 3's explicit reauthentication and **Link provider**
flow is deployed: an allowlisted unlinked identity correctly creates a separate account. For isolated staging
acceptance only, use fresh identities, configure `HUB_AUTH_PROVIDERS=github,discord,google`, and run:

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

Before rolling back to a GitHub-only image, prove every currently admitted account still has an admitted GitHub
identity:

```bash
DATABASE_URL=... \
HUB_ALLOWED_OAUTH_SUBJECTS=github:12345678 \
HUB_ROLLBACK_SUPPORTED_AUTH_PROVIDERS=github \
npm run hub:check-auth-rollback
```

Exit status 2 blocks rollback without exposing account or subject identifiers. Follow the
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
3. Sign in with an allowlisted test account and open a representative campaign.
4. Record the backup timestamp, restore duration, checks, and operator.
5. Destroy the drill database.

Private V1 cannot be considered launch-ready until this drill is executed against the deployed Oracle
PostgreSQL stack and meets the documented RPO/RTO.

## Retention and quotas

- Canonical character JSON is limited to 1.5 MB after every import, patch, grant, action, and transfer.
- Command receipts expire after 24 hours and character-returning receipts store only a character reference.
- Run `PostgresHubStore.pDeleteExpiredCommandReceipts()` from the scheduled maintenance worker until it
  returns zero. The expiry index keeps this bounded cleanup efficient.
- Domain-event replay and immutable audit retention remain separate policies; do not delete audit rows as
  part of receipt cleanup.

Maintenance is a singleton advisory-locked bounded one-shot. Oracle timer units are checked in; installation,
enablement, and scheduled execution evidence remain part of V1-G1:

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

- prove the checked-in Oracle maintenance, backup, and monitor timers under scheduled execution;
- complete an encrypted off-machine pull from a second trusted computer;
- complete and record an isolated restore and rollback against release `hub-staging-2026-09-01` at `8f181712`;
- complete the physical one-DM/two-player game day after the host-operations proof passes.

See the [living roadmap](roadmap.md) and [runbooks](runbooks/README.md).
