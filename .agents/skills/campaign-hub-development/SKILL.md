---
name: campaign-hub-development
description: "Develop, review, debug, and test Campaign Hub product code. Use for Hub pages, Fastify BFF, MemoryHubStore/PostgresHubStore parity, HTTP/WebSocket protocols, capabilities, privacy projections, campaign context/rules/content, Sheet/DM Screen integration, semantic operations, targeting/consent, inventory/transfers/awards, OAuth identity, and lifecycle. Also use for Hub queued-save recovery, reconnect convergence, no-write navigation, exact-command replay privacy, and spell/resource template admission, even with green CI. Lifecycle includes deletion request/cancel/purge logic, member removal, and ownership-transfer/recovery endpoint/store/UI/test work. Route live Oracle execution, one-off ownership recovery, releases, backups, restores, timers, staging, and game-day operations to campaign-hub-operations; use campaign-hub-e2e for Hub Playwright harness/spec work. Exclude unrelated Fastify/OAuth/Docker, local-only Sheet/DM Screen work, and pure data/schema authoring."
---

# Campaign Hub Development

Use retrieval-led reasoning. Campaign Hub changes cross browser, BFF, two store implementations, tests, and
operational records; a plausible local edit is not enough.

## Start here

Read [Status and source priority](./references/status-and-sources.md) and
[Pitfalls and failure modes](./references/pitfalls-and-failure-modes.md) for every Hub task. The first tells you
how to establish what is actually true right now; the second tells you where previous work actually went wrong,
which is where your review attention is worth most. Then load only the reference needed:

| Work | Reference |
|---|---|
| BFF routes, stores, transactions, migrations, protocol, realtime, privacy | [Architecture and authority](./references/architecture-and-authority.md) |
| Exact-command replay, participant recovery, multi-target consent, reconnect/adoption, spell/resource admission | [Semantic and reconnect review](./references/semantic-and-reconnect-review.md) |
| Character Sheet, DM Screen, context, rules/content, operations, inventory, targeting | [Integrations and product scope](./references/integrations-and-product-scope.md) |
| Test selection, parity proof, mutation testing, E2E, docs and review | [Testing and review](./references/testing-and-review.md) |
| Parallel lanes, shared hotspots, ADR/migration numbering, review loops, CI gates, integration | [Delivery and coordination](./references/delivery-and-coordination.md) |
| Hub pages, `js/hub` modules, page/performance contracts, sharing legibility, styling | [Hub browser surfaces](./references/hub-browser-surfaces.md) |

## Where time is actually lost

These recurring failures deserve attention before a local happy-path edit:

- **Green CI misses undescribed interleavings.** Trace queued saves, authority changes, durable recovery, and
  page adoption together. Prove both safety (no stale adoption) and liveness (recovery and the next save finish).
- **A retry has two clocks.** Its command outcome stays historical; permission and presentation use current
  authority. Neither raw receipt replay nor replacing it with today's aggregate is correct.
- **A connected socket is not installed authority.** Reconnect generations cannot reopen writes before current
  context, rules, and overlays are installed.
- **Single-user testing misses the product.** Use independent owners, a still-open second device, and a DM
  observer for cross-user changes. Synthetic evidence does not replace physical acceptance or a recorded waiver.
- **Implemented, reviewed, published, merged, deployed, enabled, and physically accepted are different states.**
  A waiver permits only its named step; it is not a measured PASS or permission to lift other holds.
- **Shared hotspots and scarce numbers collide.** ADR and migration numbers must be reserved rather than chosen;
  contiguity contracts have deadlocked parallel lanes that each waited for the others.
- **Inaccurate handoffs cost more than slow ones.** Report the exact head, the exact commands, and what is
  genuinely unfinished.

Read the authoritative project records linked from those references before editing. Do not rely on remembered
milestone counts or historical ADR context.

## Working method

1. **Pin the record.** Capture `git rev-parse HEAD`, the merge base, worktree status, and the relevant capability,
   protocol and migration identity. For a dirty or pending-merge candidate, identify the reviewed tree/delta too;
   HEAD alone does not describe it. Separate local evidence from deployed state and current authorization.
2. **Classify the boundary.** Identify the aggregate, caller role, audience, canonical store, browser integration,
   capability gate, protocol version, and lifecycle states involved.
3. **Trace both authority paths.** Read the route/schema in `server/src/app.js`, the relevant shared authority
   helper, and matching methods in both `memory-hub-store.js` and `postgres-hub-store.js`.
4. **Threat-model output and failure.** Check tenant isolation, privacy inference, event visibility, stable error
   shape, replay behavior, stale versions, retries, access loss, and lifecycle cancellation. Write a concrete
   interleaving and every affected track's expected state before changing concurrency code.
5. **Implement one coherent contract.** Keep browser behavior explanatory; authorization and validation remain
   server-side. Preserve memory/PostgreSQL response, audit, event, outbox, receipt, and ordering parity.
6. **Prove the exact behavior.** Add targeted unit tests, PostgreSQL parity where authority changes, mutation
   coverage at the real guard/call site, and real-stack E2E for protocol/privacy/realtime/cross-user flows.
   Preserve production workload, budgets and safety fences; diagnose readiness instead of weakening them.
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
- Exact command retries preserve original command/outcome/event/leg identity under current authorization and
  privacy shaping. Use a fresh detail/recovery read for current workflow state.
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

## Scope boundaries to verify

- One BFF replica and one active editor per character/workspace.
- Cloud commands need server authority. Durable local recovery is not general offline mutation authority or
  permission to blindly replay a stale snapshot.
- Read the current registry, routes, rollout helpers and tests for supported targeting templates/resources;
  source presence does not establish campaign enrollment. Do not repeat an old "Cure Wounds only" baseline.
- Read the current rules surface matrix before calling a setting enforced. DM selection alone is not enforcement.
- Read identity capabilities and current product records before declaring linking or reauthentication missing.
- Broader inventory UX, table-adjudicated rules, NPC aggregates, public rollout and collaborative editing require
  their own approved boundaries. Do not opportunistically widen them.

## Cross-skill routing

- Use `5etools-data` for entity identity, source aliases, editions, item/spell/race shapes, brew validation, and
  Renderer/Parser behavior.
- Use `charactersheet-development` and `.github/instructions/charactersheet.instructions.md` when a Hub change
  modifies Character Sheet state, rendering, save/load, builders, or feature calculations.
- Use `dmscreen-development` and `.github/instructions/dmscreen.instructions.md` for Board/panel/Party Tracker
  implementation details.
- Use `troubleshooting` for unexpected runtime/test failures after loading this Hub contract.
- Use `e2e-character-tests` only for the generated TGTT character-build suite under `test/e2e/specs/`. For Hub
  multi-user Playwright journeys under `test/e2e/hub/`, the Hub page objects, `playwright.hub.config.ts`, or a
  failing `npm run test:hub:e2e:stack`, use `campaign-hub-e2e`. The two suites share no factory, config, or
  required-check standard.
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

Three harness traps have repeatedly been mistaken for product bugs. This repository is ESM, so plain `npx jest`
does not work. Hub suites hold sockets and timers, so a hung run needs a bounded timeout and force exit rather
than a blind re-run. And `HubReleaseAutomation.test.js` shells out to Git, so an ambient `GIT_ALLOW_PROTOCOL` or
`GIT_CONFIG_*` in your shell can fail it for reasons that have nothing to do with the diff — print the Git
environment before debugging the code. See [Pitfalls and failure modes](./references/pitfalls-and-failure-modes.md)
for the rest, including the fixture option that silently removes production semantic templates.
