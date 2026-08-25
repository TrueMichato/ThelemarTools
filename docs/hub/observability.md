# Campaign Hub observability and SLOs

> **Status:** Portable metrics/logging implemented; provider alerts pending Phase 6G
> **Last verified:** 2026-08-25
> **Owner:** Campaign Hub operator

## Logging contract

The production BFF emits structured JSON logs through Fastify/Pino.

Required fields:

- timestamp/level/message;
- request id;
- method and bounded route URL;
- response status and duration;
- remote/client address after exact proxy trust or the explicitly configured provider header;
- process/container identity;
- explicit signal on graceful shutdown.

Never log:

- cookies or `Set-Cookie`;
- Authorization, CSRF, or idempotency headers;
- OAuth codes/verifiers/state;
- invite raw tokens or hashes;
- database URLs/passwords;
- character/workspace/brew/request/response bodies;
- backup encryption keys.

`HUB_LOG_REDACT_PATHS` is applied by `server/src/index.js`. Fastify request ids accept only
`[a-zA-Z0-9_.:-]` up to 100 characters; other values are replaced by UUIDs and every response returns
`X-Request-Id`.

`HUB_CLIENT_IP_HEADER` is optional and accepts only `do-connecting-ip`. It is mutually exclusive with
`HUB_TRUST_PROXY`. One validated provider address is used for the safe request log, HTTP rate-limit key, and
WebSocket connection context; invalid/missing values use the direct socket peer. Logs retain the full IPv6
address while HTTP rate-limit keys use the plugin's default `/64` normalization.

## Metrics endpoint

```text
GET /api/metrics
Authorization: Bearer <HUB_METRICS_TOKEN>
```

- token is independent and at least 32 characters;
- missing/wrong token returns 401;
- absent server configuration hides the endpoint with 404;
- output is Prometheus text;
- route labels use Fastify route templates, never raw ids/query strings.

Signals:

| Metric | Type | Meaning |
|---|---|---|
| `hub_process_uptime_seconds` | Gauge | Current BFF process uptime |
| `hub_http_requests_total` | Counter | Responses by method/template/status |
| `hub_http_request_duration_milliseconds_sum/count` | Counter pair | Compute route average/rate-window latency |
| `hub_websocket_connections` | Gauge | Current authorized sockets |
| `hub_outbox_pending` | Gauge | Pending/publishing/failed outbox rows |
| `hub_outbox_failed` | Gauge | Failed rows awaiting retry |
| `hub_outbox_oldest_age_seconds` | Gauge | Age of oldest undelivered event |
| `hub_active_sessions` | Gauge | Unrevoked/unexpired sessions |
| `hub_expired_receipts` | Gauge | Receipts awaiting maintenance |
| `hub_deletion_due_accounts` | Gauge | Accounts past purge deadline |
| `hub_last_maintenance_age_seconds` | Gauge | Time since successful maintenance |
| `hub_last_backup_age_seconds` | Gauge | Time since recorded encrypted backup |
| `hub_last_restore_drill_age_seconds` | Gauge | Time since recorded successful drill |
| `hub_dispatcher_last_batch_count` | Gauge | Most recent in-process outbox batch |
| `hub_dispatcher_last_success_age_seconds` | Gauge | Time since a batch without delivery failure |
| `hub_dispatcher_consecutive_errors` | Gauge | Consecutive batches containing delivery failures |

Metrics reset with the process for HTTP counters; database-backed operational ages persist.
Age metrics use `-1` when no successful run has ever been recorded, so a missing backup/drill cannot look
fresh.

## Operational evidence

`hub.operational_runs` stores bounded non-sensitive evidence for:

- maintenance;
- encrypted backup;
- restore drill.

Details contain counts, filename basename, size, SHA-256, duration, or stable error code—never credentials or
database content. Maintenance writes with the runtime role. Backup/restore write through `hub_operations`,
which can only select/insert operational evidence.

## Private-V1 objectives

| Objective | Target | Window |
|---|---:|---|
| Authenticated API availability | >=99.0% excluding announced maintenance | Rolling 30 days |
| Read/mutation HTTP server error rate | <1% | 15 minutes |
| Typical API p95 latency | <500 ms | 15 minutes |
| Outbox oldest undelivered age | <30 seconds | Continuous |
| Failed outbox rows | 0 beyond 5 minutes | Continuous |
| Successful maintenance age | <26 hours | Continuous |
| Encrypted backup age | <26 hours | Continuous |
| Restore drill age | <35 days | Continuous |
| Deletion due without purge | 0 beyond 1 hour | Continuous |
| Recovery point objective | <=24 hours | Incident |
| Recovery time objective | <=4 hours | Restore drill/incident |

## Alert matrix

| Severity | Trigger | Immediate action |
|---|---|---|
| Critical | Readiness down >5 min; restore fails; suspected privacy/secret incident | Incident runbook; freeze promotion/mutations as appropriate |
| High | Outbox oldest >60s; failed rows >0 for 5 min; backup age >30h; due deletion >1h | Outbox/backup/deletion runbook |
| Medium | 5xx >1% for 15m; p95 >500ms for 30m; maintenance age >30h | Correlate routes/request ids and DB/pool signals |
| Low | WebSocket reconnect increase; receipts/technical rows growing before threshold | Investigate trend before next release |

Provider dashboards/alerts must implement these semantics without renaming away the portable metric meanings.
