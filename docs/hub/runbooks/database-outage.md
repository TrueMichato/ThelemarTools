# Runbook: database outage

> **Status:** Portable procedure
> **Owner:** Campaign Hub operator

## Detect

- `/api/ready` 503 while `/api/live` remains 200;
- database provider alarm or pool/connect errors;
- authenticated API 5xx;
- outbox age rises after recovery.

## Contain

1. Declare incident if outage exceeds five minutes or writes may be ambiguous.
2. Do not disable readiness or switch to memory authority.
3. Preserve BFF logs/request ids and provider timeline.
4. Stop repeated migration/maintenance/backup jobs.
5. Keep static local-only site available when possible; communicate Hub unavailability.

## Recover

1. Restore database service/private networking/TLS/credentials.
2. Verify migration ledger and required version.
3. Confirm runtime role connectivity and readiness.
4. Inspect oldest/failed outbox and run dispatcher/retry.
5. Verify session auth, character read/write, transfer state, and WebSocket resync.
6. If data recovery is required, follow backup/restore and rollback runbooks.

## Evidence

Record outage start/end, provider cause, affected writes, RPO, request ids, migration/build versions, outbox
recovery, and user notification.
