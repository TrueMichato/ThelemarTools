# Campaign Hub performance budgets

> **Status:** V1 budgets; production telemetry/load validation pending
> **Last verified:** 2026-08-24
> **Owner:** Campaign Hub maintainers

| Surface | V1 budget | Enforcement |
|---|---:|---|
| HTTP request body | 2 MB | Fastify `bodyLimit` |
| Canonical character document | 1.5 MB serialized UTF-8 | `validateCloudCharacterData` after every mutation |
| Campaign brew bundle | 1 MB / 100 documents / depth 100 | `validateCampaignBrewBundle` |
| Shared cloud-value traversal | 200,000 values / depth 150 | `validateCloudValue` before type-specific validation |
| Character patch | 500 operations, path ≤500 chars | route schema |
| Event replay | ≤500 events/request | route schema |
| Outbox dispatch | 100 events/batch | dispatcher/store |
| Character roll history | 200 local entries | existing Character Sheet cap |
| Party size acceptance | 6+ active members | authorization/realtime tests and V1 target |
| Database connection | 5 s | pg pool |
| Database query/statement | 10 s | pg pool |
| WebSocket fanout | event payload, not full campaign snapshot | outbox dispatcher |

Full character documents are used only for explicit import/export and authorized snapshot reads. Routine
editing emits path patches; other players receive a limited projection. DM Board saves remain one compressed
workspace blob, protected by debounce, revision, and lease fencing.

Campaign brew also passes the shared cloud-value traversal. Effective errors are `BREW_TOO_DEEP` for the
brew-specific depth 101-150 range and `CLOUD_DATA_TOO_DEEP` beyond the shared depth 150 ceiling.

Idempotency receipts retain only a character reference for character-returning commands and expire after
24 hours. Retrying such a command returns the current canonical character; it never reapplies the mutation.

Before public onboarding, load tests must cover concurrent campaign sockets, 500-event resync, large
characters near the body limit, and transfer contention. Budgets should be reduced if production telemetry
shows mobile latency or database pressure.
