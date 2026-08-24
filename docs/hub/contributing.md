# Contributing to Campaign Hub

> **Status:** Current contributor contract
> **Last verified:** 2026-08-24
> **Owner:** Campaign Hub maintainers

## Before changing code

1. Read [current-system.md](current-system.md) and the document for the affected boundary.
2. Identify whether behavior is local-only, Hub-only, or shared. Hub work must not silently change local mode.
3. Find the permission/tenant rule in [permission-matrix.md](permission-matrix.md).
4. Find the requirement and existing evidence in [traceability.md](traceability.md).
5. Check [risk-register.md](risk-register.md) for related open risks.
6. Read the relevant ADR. If the proposed change contradicts it, write a superseding ADR before implementation.

## Change design

Document:

- actor and authorization;
- aggregate and tenant;
- canonical state change;
- revision/lease/fencing effect;
- idempotency key/result;
- audit/domain/outbox events and visibility;
- failure/retry/conflict behavior;
- lifecycle/archive/delete behavior;
- limits and retention;
- local-mode effect;
- migration and rollback/recovery;
- observability without content leakage.

If any item is "not applicable," say why.

## Implementation rules

- The BFF/store is authoritative. Client-side visibility is not authorization.
- Production changes must exist in PostgreSQL; memory authority behavior should match where tests/API use it.
- Do not add browser database credentials or JavaScript-readable durable auth tokens.
- Do not replace generic `StorageUtil` or personal brew persistence for Hub data.
- Do not add a whole-document stale overwrite path.
- Do not remove fencing because a revision check exists; both are required.
- Do not emit a client-visible event before the canonical transaction commits.
- Do not add cross-user renderer HTML without central validation/sanitization.
- Do not log request/response bodies containing character, brew, OAuth, invite, or session data.
- Do not edit an applied migration. Add the next migration once ADR 0005 is implemented.
- Do not make public-registration assumptions while private allowlisting is the accepted scope.

## Documentation definition of done

In the same change:

1. update the current reference document;
2. update API/domain/event/data-lifecycle references when their contracts change;
3. add/supersede an ADR for a durable decision;
4. update traceability and risk disposition;
5. update troubleshooting/runbooks for new failure modes;
6. update implementation status;
7. record exact validation evidence without secrets/user content;
8. label future behavior as planned, not implemented.

## Testing definition of done

At minimum:

- pure/domain regression;
- memory and PostgreSQL behavior where applicable;
- authorization matrix and cross-campaign denial;
- idempotent retry;
- revision/lease/fencing or reason not applicable;
- failure/rollback/recovery;
- realtime replay/visibility when an event changes;
- local-mode regression for shared Character Sheet/DM Screen/brew/PWA code;
- migration fresh/upgrade path for schema changes;
- documentation contract.

Use the smallest targeted commands first, then the phase/release gates in [testing.md](testing.md).

## Review checklist

- Could another campaign/account access this object by changing an id?
- Can a stale device overwrite a newer result?
- Can retry duplicate state, inventory, an event, or an outbox row?
- Can failure leave escrow/resources unavailable?
- Does archive/removal/deletion resolve this state?
- Does reconnect reveal an event the account could not read live?
- Can content execute or trigger authenticated behavior?
- Can logs/backups/tests leak private data?
- Is the implementation claim documented and tested?
- Is rollback a real safe path rather than "run a down migration"?
