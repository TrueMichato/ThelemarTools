# Runbook: stuck or failed outbox

> **Status:** Current portable procedure
> **Owner:** Campaign Hub operator

## Trigger

- `hub_outbox_oldest_age_seconds > 60`;
- `hub_outbox_failed > 0` for five minutes;
- dispatcher consecutive errors;
- clients reconnect/resync but miss expected live changes.

## Diagnose

1. Record campaign/event/outbox ids, sequence, attempts, claim time, and stable error—never payload content.
2. Inspect the earliest failed event for the campaign. Later events intentionally do not overtake it.
3. Check BFF/WebSocket health, membership/session lookups, database availability, and process restarts.
4. Confirm stale publishing claims are reclaimable.

## Recover

1. Correct the external/process/database cause.
2. Let failed rows become available and the dispatcher retry.
3. Do not mark published manually unless fanout semantics and client recovery have been proven.
4. Trigger/observe client resync and verify snapshot + visible replay sequence.
5. Confirm oldest age, failed count, and dispatcher errors return to zero.

Canonical state is already committed; never roll it back merely because live delivery failed.
