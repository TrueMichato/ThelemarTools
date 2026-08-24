# ADR 0006: Portable observability and technical-record retention

Status: Accepted for Phase 6E; implementation pending

## Context

Private V1 stores complete characters, notes/backstory visible to DMs, rolls, actions, campaign content,
sessions, audit, events, receipts, and outbox rows. User-visible campaign history has product value, while
technical delivery/idempotency records should not grow forever. Logs and metrics must diagnose failures
without duplicating private content.

## Decision

1. Keep user-visible campaign history until campaign/account deletion.
2. Prune technical records on bounded schedules:
   - command receipts: 24 hours;
   - published outbox rows: 7 days;
   - expired/revoked sessions and invites: 30 days.
3. Run cleanup and account purge through a singleton maintenance worker protected by a database advisory lock.
4. Emit structured JSON logs with correlation ids and strict redaction. Never log character/brew bodies,
   cookies, OAuth codes, CSRF values, invite tokens, or database URLs.
5. Define portable metrics/SLOs for request health, database pool, WebSockets, outbox lag/failure, maintenance,
   auth failures, and backup/restore status.
6. Require managed PITR and nightly encrypted portable backup outside the application runtime.
7. Target RPO no greater than 24 hours and RTO no greater than 4 hours.
8. Treat restore evidence as a release/operations artifact tied to build and migration versions.

## Consequences

- Audit/domain/roll storage grows with campaign history and needs telemetry.
- Public operation may require configurable retention and a new privacy review.
- Provider-specific monitoring may implement, but cannot redefine, the portable signal catalog.
- Deletion documentation must explain when backup retention finally removes data.

## Rejected alternatives

- Delete all events after a short window: breaks durable campaign history.
- Log complete request/response bodies: unacceptable privacy exposure.
- Backup only with application scripts: does not provide point-in-time recovery.
