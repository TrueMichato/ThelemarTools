# Campaign Hub troubleshooting

> **Status:** Current first-response guide; provider commands are added after selection
> **Last verified:** 2026-08-24
> **Owner:** Campaign Hub maintainers

Do not begin by editing database rows. Preserve request ids, timestamps, app/protocol/migration versions, and
the affected aggregate ids. Never paste cookies, OAuth codes, invite tokens, database URLs, or character
documents into tickets/logs.

| Symptom | First checks | Likely areas | Safe next action |
|---|---|---|---|
| BFF refuses startup | Required env, DB reachability, `hub.accounts` | `server/src/index.js`, migration | Run health/migration status; do not bypass readiness |
| `/api/health` returns 503 | DB connectivity/schema | pool TLS/role/schema | Inspect DB/provider health and migration status |
| OAuth loops/fails | callback URL, app origin, OAuth cookie, subject allowlist | proxy origin/cookie/PKCE | Verify exact origin/callback and numeric subject |
| Invite redemption repeats/fails | URL fragment then `sessionStorage["hub-pending-invite"]`, invite expiry/use/revoke | OAuth round-trip or invalid invite | Current page clears the pending key after one success/failure; inspect without copying the token into logs |
| Mutation returns `INVALID_ORIGIN` | browser Origin and proxy scheme/host | edge forwarded headers, `HUB_APP_ORIGIN` | Fix proxy replacement/trust; never broaden to wildcard |
| `INVALID_CSRF` | session bootstrap/rotation | stale page/session | Refresh `/api/session`; verify secrets are consistent |
| `PROTOCOL_UPDATE_REQUIRED` | page/service-worker build | stale cached client | activate new worker/reload; do not accept old writes |
| `LEASE_HELD`/`LEASE_FENCED` | active device and epoch | takeover/tab coordination | use explicit takeover or recover local draft |
| `REVISION_CONFLICT` | server revision and local recovery | repository queued base/rebase | use conflict UI; export recovery before destructive choice |
| Character save rejected as too large | serialized byte count | notes/features/inventory growth | export, reduce content, retry; do not raise quota casually |
| Brew rejected | error code, size/depth/dependencies/HTML | `campaign-content.js` | correct source bundle; never disable validation |
| Hub page loads error state | `/api/session`, console, service worker | API unavailable, boot order, bound fetch | confirm same-origin route and no cached API response |
| WebSocket disconnects immediately | Origin, cookie, protocol, membership | edge upgrade/timeout/auth | inspect close code and HTTP membership |
| Realtime stale after reconnect | last sequence/resync response/outbox lag | client buffer or dispatcher | trigger resync, inspect oldest pending event |
| Outbox rows fail/retry | earliest failed campaign event | dispatcher/store/network | fix first event cause; preserve campaign order |
| Party Tracker rows disappear | campaign snapshot/membership | linked projection is intentionally unsaved | restore connectivity/context; do not duplicate locally |
| Transfer is stuck reserved | source/target status, membership, escrow | transfer lifecycle | resolve/cancel through authoritative command/runbook |
| Backup command fails | libpq env, target existence, role | `backup.mjs`, provider access | choose a new encrypted target; never overwrite evidence |
| Restore fails | empty drill DB, archive integrity, role/version | `restore.mjs`, provider tools | keep source backup immutable; capture full tool error |

## Escalation data

Collect only:

- UTC timestamp and request/correlation id;
- app image digest, app version, protocol version, migration version;
- route and stable error code;
- account/campaign/aggregate UUIDs where access permits;
- database/outbox counts and ages, not JSON bodies;
- WebSocket close code/reason;
- backup identifier and restore tool versions.

If confidentiality, authorization, inventory duplication/loss, or restore integrity is uncertain, stop
mutations for the affected campaign/environment and follow the incident runbook once Phase 6E creates it.
