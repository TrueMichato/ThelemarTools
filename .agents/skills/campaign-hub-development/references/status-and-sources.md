# Status and source priority

## Verified creation baseline

This skill was authored against repository record
`a60020e2e106a1dacdd222769a80a5c199803030` on 2026-09-06. Recheck current files before relying on this snapshot.

- The latest implemented product merge recorded by the Hub docs is `b8d31d3416b934cc9275b859b5932db050005351`;
  later commits through the creation baseline are records/documentation changes.
- Oracle staging still records annotated release `hub-staging-2026-09-01` at
  `8f181712453e048f62abe53b14200886fa965c21`.
- V1-G1 host-operations evidence and V1-G2 physical one-DM/two-player game day remain active external gates.
- Merged or documented code is not necessarily deployed, and deployed code is not necessarily capability-enabled.

Re-establish these facts from `docs/hub/roadmap.md`, `docs/hub/implementation-status.md`,
`docs/hub/staging-plan.md`, and the actual deployment record before making current-status claims.

## Truth hierarchy

1. `docs/hub/roadmap.md` owns current train status, dependencies, and deferred scope.
2. `docs/hub/implementation-status.md` inventories implemented behavior and rollout gates.
3. `server/src/app.js`, shared authority modules, stores, and migrations own runtime behavior. The API document
   explicitly defers to route schemas when they differ.
4. `docs/hub/architecture.md`, `domain-model.md`, `api-reference.md`, `event-catalog.md`, `security.md`, and
   `traceability.md` describe the current contract.
5. ADR status lines plus explicit superseding/narrowing notes govern their historical body text.
6. Historical checkpoint, private-V1, post-V1, and milestone evidence stays historical. Never relabel old test
   totals as exact-head evidence.

## Known baseline traps

Verify these rather than copying the nearest heading:

- Current client protocol is `4` (`js/hub/hub-api-client.js`, `js/hub/hub-realtime-client.js`,
  `server/src/app.js`, `js/hub/hub-source-costs.js`). Protocol `3` is a restricted legacy lane. At the creation
  baseline, the top of `docs/hub/api-reference.md` still says `3`.
- Current schema includes migrations `0001` through `0007`. At the creation baseline, the opening line of
  `docs/hub/domain-model.md` still says through `0006`.
- `deploy/hub/migration-policy.json` ends at `0006` at the creation baseline. A release containing migration
  `0007_peer_source_costs.sql` must stop until an operator-reviewed policy entry exists.
- ADR 0013's top status and current roadmap say active campaign context is implemented, but its old
  "Outstanding" section was not rewritten. Prefer current status and implementation evidence.
- ADR 0005's status mentions migration `0002`; the migration runner and ledger now cover later immutable
  migrations.
- ADR 0009 is rejected. ADR 0010 is the current Oracle decision. ADR 0008's original digest language is narrowed
  by its verified-tag note for the ARM host.
- The roadmap's phrase "repository head" names the latest implementation merge, not the later records-only
  creation baseline.

When touching one of these documents, repair the stale statement in the same change rather than propagating it.

## Mandatory orientation

Read these before broad Hub changes:

- `docs/hub/README.md`
- `docs/hub/roadmap.md`
- `docs/hub/implementation-status.md`
- `docs/hub/architecture.md`
- `docs/hub/domain-model.md`
- `docs/hub/api-reference.md`
- `docs/hub/event-catalog.md`
- `docs/hub/testing.md`
- `docs/hub/security.md`
- `docs/hub/traceability.md`

Read ADRs 0001-0016 for their decision boundaries; include ADR 0017 for DM item awards. Read only current
runbooks for operational behavior. Use `docs/hub/README.md` as the index.
