---
name: campaign-hub-development
description: "Develop, review, debug, and test Campaign Hub product code in TrueMichato/ThelemarTools. Use whenever work touches Hub browser pages, the Fastify BFF, MemoryHubStore/PostgresHubStore parity, HTTP/WebSocket protocols, capabilities, privacy projections, campaign context/rules/content, Character Sheet or DM Screen Hub integration, semantic operations, targeting, inventory/transfers/awards, OAuth identity, or lifecycle product code. Lifecycle product work includes account-deletion request/cancel/purge logic, member-removal, ownership-transfer/recovery endpoints, stores, UI, events, and tests—even when the prompt only says deletion, removal, purge, or recovery. Route execution or review of live/deployed Oracle purges, one-off ownership recovery, runbooks, releases, backups, restores, timers, staging, and game-day operator work to campaign-hub-operations. Do not use for unrelated Fastify/OAuth/Docker, local-only Character Sheet or DM Screen work, or pure 5etools data/schema authoring."
---

# Campaign Hub Development

Use retrieval-led reasoning. Campaign Hub changes cross browser, BFF, two store implementations, tests, and
operational records; a plausible local edit is not enough.

## Start here

Read [Status and source priority](./references/status-and-sources.md) for every Hub task. Then load only the
reference needed:

| Work | Reference |
|---|---|
| BFF routes, stores, transactions, migrations, protocol, realtime, privacy | [Architecture and authority](./references/architecture-and-authority.md) |
| Character Sheet, DM Screen, context, rules/content, operations, inventory, targeting | [Integrations and product scope](./references/integrations-and-product-scope.md) |
| Test selection, parity proof, mutation testing, E2E, docs and review | [Testing and review](./references/testing-and-review.md) |

Read the authoritative project records linked from those references before editing. Do not rely on remembered
milestone counts or historical ADR context.

## Working method

1. **Pin the record.** Capture `git rev-parse HEAD`, the merge base, worktree status, and the relevant capability,
   protocol, migration, or deployed-release identity. Keep merged, deployed, and enabled status separate.
2. **Classify the boundary.** Identify the aggregate, caller role, audience, canonical store, browser integration,
   capability gate, protocol version, and lifecycle states involved.
3. **Trace both authority paths.** Read the route/schema in `server/src/app.js`, the relevant shared authority
   helper, and matching methods in both `memory-hub-store.js` and `postgres-hub-store.js`.
4. **Threat-model output and failure.** Check tenant isolation, privacy inference, event visibility, stable error
   shape, replay behavior, stale versions, retries, access loss, and lifecycle cancellation.
5. **Implement one coherent contract.** Keep browser behavior explanatory; authorization and validation remain
   server-side. Preserve memory/PostgreSQL response, audit, event, outbox, receipt, and ordering parity.
6. **Prove the exact behavior.** Add targeted unit tests, PostgreSQL parity where authority changes, mutation
   coverage for fragile context/policy logic, and real-stack E2E for protocol/privacy/realtime/cross-user flows.
7. **Update records in the same change.** Revise the closest API/event/security/traceability/status document and
   any ADR whose accepted contract changed. Label unimplemented scope explicitly.

## Non-negotiable invariants

- Signed-out and explicit local mode remain first-class and do not require Hub storage.
- The browser is untrusted. PostgreSQL is production authority; `MemoryHubStore` is the deterministic test double.
- Private mutations require session, exact Origin, CSRF, supported protocol, schema, and role checks. Durable
  command/receipt-backed flows additionally require an actor/body-bound idempotency key; do not invent receipt
  requirements for explicitly ephemeral logout or lease-control routes when the authoritative route/store
  contract omits them.
- Document writes use revision, one-editor lease, and monotonic fencing epoch. Do not introduce simultaneous
  co-editing through a side path.
- Canonical write, receipt/command identity, audit, domain event, and outbox effects commit atomically where the
  command contract requires them.
- Lock order is deliberate. Acquire multi-character/container locks in stable identity order and avoid
  PostgreSQL lock upgrades after asynchronous work.
- Realtime is notification, not authority. Projection invalidations are metadata-only; consumers refetch through
  the authorization-scoped projector and replace stale views rather than merging private fragments.
- Hub-linked DM Screen Party Tracker projections are read-only, in-memory, and excluded from serialized Board
  state. On reconnect/replay, refetch and replace under the current sequence/generation fence; access loss must
  clear them before any late response can publish.
- Replay advances by the server's raw scanned sequence marker, not by the number of visible events returned.
- Required protocol/capability/version mismatches fail closed. Never infer a capability from code being merged.
- Campaign brew and rules are temporary overlays. They never persist into personal brew, local character JSON,
  or private DM Board state.
- Avoid hidden-state oracles: authorization, targetability, costs, and private field failures use bounded,
  non-enumerating results rather than exposing which secret predicate failed.
- Unsupported semantic effects remain explicit user work. Do not infer hidden target state or interpret arbitrary
  rules prose at the authority boundary.
- Lifecycle changes must close/fence sockets and pending work, restore escrow where required, release leases,
  conceal private state, and preserve player-owned character data according to the current contract.
- Coordinated integration uses normal descendant commits. Do not rebase, amend, reset, squash, force-push, or
  otherwise rewrite reviewed Hub history unless the human explicitly changes that policy.

## Current scope boundaries

- One BFF replica and one active editor per character/workspace.
- Cloud mutations require connectivity; offline mutation queues and blind stale-snapshot replay are deferred.
- Source/species/edition and carry/encumbrance policy are enforced; the other non-content house rules remain
  advisory.
- Peer targeting is the narrow PHB/XPHB Cure Wounds flow with one standard spell slot and one player-owned
  privacy-visible target. Broader abilities, resources, target sets, and NPC/monster targets are not implemented.
- Party stash, transfers, carry summaries, and atomic DM awards exist, but the complete unified inventory
  experience is not finished.
- Discord/Google adapters and provider registry exist; account link/unlink, reauthentication UI, and full rollout
  remain incomplete.
- Public service, moderation/billing, multi-provider production rollout, NPC aggregates, offline writes, and
  collaborative editing require new decisions rather than opportunistic implementation.

## Cross-skill routing

- Use `5etools-data` for entity identity, source aliases, editions, item/spell/race shapes, brew validation, and
  Renderer/Parser behavior.
- Use `charactersheet-development` and `.github/instructions/charactersheet.instructions.md` when a Hub change
  modifies Character Sheet state, rendering, save/load, builders, or feature calculations.
- Use `dmscreen-development` and `.github/instructions/dmscreen.instructions.md` for Board/panel/Party Tracker
  implementation details.
- Use `troubleshooting` for unexpected runtime/test failures after loading this Hub contract.
- Use `e2e-character-tests` only for the generated TGTT character-build suite. Hub multi-user Playwright journeys
  use `test/e2e/hub/` and `docs/hub/testing.md`.
- Use `campaign-hub-operations` for executing or reviewing live/deployed Oracle work: releases, migration
  execution, backups, restores, rollback, timers, monitoring, staging evidence, account purge, exceptional
  one-off ownership recovery, security/access runbooks, and game days. Keep account-deletion, member-removal, or
  ownership-transfer/recovery endpoint/store/UI/test implementation in this development skill. Load both only
  when a code change also modifies release, migration, backup, restore, timer, monitor, evidence automation, or
  the operator-facing `server/scripts/purge-accounts.mjs` path.

## Minimum verification

Start with the smallest relevant tests. Common gates:

```bash
npm run test:hub
npm run test:hub:mutations
npm run test:hub:e2e:stack
```

Use `npm run test:unit -- <paths>` for targeted Jest files. Run PostgreSQL suites for store/schema/transaction
changes, and run affected Character Sheet or DM Screen suites when their integration seams change. Report newly
executed exact-head results separately from historical records.
