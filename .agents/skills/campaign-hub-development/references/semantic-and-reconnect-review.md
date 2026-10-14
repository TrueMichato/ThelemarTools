# Semantic and reconnect review

Read this for multi-target authority, exact-command replay, source templates or the Character Sheet's
HTTP/realtime/recovery seam. These lessons extend the document-write contract in
[Architecture and authority](./architecture-and-authority.md).

## Command evidence is historical; permission is current

An exact retry answers **what that command did**, not **what the workflow looks like now**.

- Preserve original command/body identity, operation/event/receipt/leg IDs and command outcome. Later approval,
  selection, finalization, cancellation or expiry must not replace that outcome with today's aggregate.
- Reauthorize the caller using current membership, role, pinned participation and lifecycle. Then project the
  stored outcome through the current audience/privacy mask. Do not replay an unfiltered stored body.
- Refresh only viewer-sensitive presentation, capabilities, allowed fields/targets/results and currently valid
  owner-only refs. Demoted nonparticipants get the stable not-found response. A former co-DM who still owns a
  target gets only their permitted participant view, not retained DM/source/co-target fields or counts.
- Leave stored receipts/events/revisions unchanged. Fetch fresh detail/outgoing/participant recovery for current
  workflow state; never treat a replay acknowledgement as proof of the latest workflow status.

Primary sources: `projectMultiTargetStoredCommandResponse` in
`server/src/multi-target-operation-authority.js`; the four multi-target command methods in both stores;
`HubMultiTargetOperations.test.js` and `HubMultiTargetOperationsPostgres.test.js`.

## Discovery, consent and coherent reads

- A pending-only inbox is not durable participant recovery: approval/rejection removes a leg from pending, and
  a fresh device may have no operation ID. Recover the caller's permitted responded/live/terminal legs through
  the bounded current contract without exposing co-target identity/count or starving pending work.
- Join an invitation to the exact currently owned character with the server-issued opaque `targetRef` and
  owner truth. Duplicate names are expected; names, array order and guessed identities are not consent authority.
  Archive/move/ref rotation must invalidate stale bindings. Owner-only refs do not widen source/DM DTOs.
- Use exclusive cursors with deterministic tie-breakers and database timestamp precision. Converting
  PostgreSQL microseconds to JavaScript milliseconds can skip same-transaction rows. Prove limit-one pagination
  over tied/sub-millisecond timestamps, not just a large happy-path page.
- Read membership, parent, target and finalization as one coherent authorized aggregate. Race detail/replay
  with privacy changes, role loss, finalization, purge and retention cleanup.
- Follow the actual lock graph, including command advisory/row locks, account/lifecycle locks, campaign
  advisory locks, membership and ascending character locks. Sorted character IDs alone do not prevent
  inversions. Current multi-target replay avoids taking a command-row `FOR UPDATE` before campaign authority;
  do not remove its command advisory protection or generalize that exception to unrelated paths.
- Cleanup participates in the same consistency fence as detail. Reader-first returns one complete authorized
  aggregate; cleanup-first returns stable not-found, never a hybrid result. Reproduce actual competing store
  calls under the least-privilege PostgreSQL runtime role; retry/catch masking is not a lock-order fix.
- Source-owned candidates may terminalize while a usable peer keeps the parent live. Peer auto-approval and
  source-owned pending/peer-approved states remain invalid. Test lifecycle calls and database constraints, not
  only helper predicates. Add a reserved forward migration rather than editing even a held reviewed migration.

Primary sources: `pListMultiTargetInbox`, `pGetMultiTargetOperation`, `pCleanupMultiTargetHistory` and command
replay in both stores; migrations 0011-0013; `HubMultiTargetLockOrder.test.js`;
`HubMultiTargetOperationsPostgres.test.js`.

## Reconnect needs safety and forward progress

Model **recoverable scope** (character/load, account, campaign, access mode, repository) separately from
**attempt tokens** (authority/context/realtime generations). Same-scope reconnect invalidates an attempt, not
the unfinished work.

1. On invalidation, synchronously mark authority pending, conceal/suspend controls, close pickers and fence
   queued HTTP/WebSocket/resync/canonical callbacks. Fresh transport tokens are not authorization.
2. Keep a shared installed-context readiness barrier closed until authorized context, rules and overlays are
   installed. Check it at schedule, queue entry, after awaits, stage/adopt/commit, recovery reads and UI feedback.
   A fresh-generation callback can still be unauthorized while this barrier is closed.
3. Fence every track: accepted, live, latest-submitted, each pending command base/snapshot, durable recovery,
   leg/no-op coverage and visible page. Roll back staged durable commands and coverage together on interrupted
   adoption. Do not let synchronous reconnect rehydrate an uncommitted staged snapshot.
4. Retain unfinished canonical demand during its await. Do not clear it before execution, let an old finalizer
   erase newer coalesced work, or spin while authority is unavailable. Resume automatically with fresh attempt
   tokens after context installation when the recoverable scope still matches.
5. Hand off fenced exact receipts to semantic recovery even if context installed before ordered delivery
   completed. Serialize recovery outside an already-running mutation-queue delivery to avoid self-deadlock.
   Canonical catch-up waits behind pending semantic recovery; exact recovery clears its evidence/save block.
6. Terminal access loss, signout, teardown or a different character/account/campaign/access/repository scope
   discards old demand and conceals data. Ordinary transport loss retains exact recovery evidence.
7. On fresh load, discard an already-settled `_latestSubmitted` cache, not real durable pending commands.
   Rehydrate pending tracks from their exact stored snapshots/coverage. A stale settled track with null
   revision/sequence can falsely block valid events with `OPERATION_HISTORY_UNAVAILABLE`.

**Prove liveness, not just a matching HP number.** Hold save A, queue an HTTP receipt, trigger actual
invalidation/reconnect, deliver before and after context installation, then assert automatic history recovery,
all-track/no-op convergence, no stale toast, cleared save block, and successful save B. Include repeated
interruptions, newer coalesced demand, scope replacement and an already-open owner twin.

Use actual page/coordinator/repository/controllers. Manually incrementing epochs or replacing the scheduling
helper can test a predicate while missing the failing call chain. Remove the real guard/handoff in a disposable
negative control and require the regression to fail; if another path masks the mutant, strengthen the scenario
rather than claiming proof.

Primary sources: `_isHubOperationAuthorityReady`, `_scheduleHubRealtimeResync`,
`_pDrainHubAuthoritativeReconcile` and `_pRunHubAuthoritativeReconcile` in
`js/charactersheet/charactersheet.js`; `js/charactersheet/charactersheet-realtime.js`;
`js/hub/hub-http-character-repository.js`; `CharacterSheetRealtimeApply.test.js`;
`test/e2e/hub/shared-sheet-multi-target.spec.ts`.

## Admit templates through real identity, not convenient fixtures

- Read checked-in PHB/XPHB data through `5etools-data` guidance, then use static source-qualified definitions.
  Recheck acquisition, edition, preparation, slot/pool and content provenance at proposal and final rederivation.
  A matching display name is insufficient when an explicit UID contradicts it or brew metadata claims another
  identity. Browser eligibility anticipates the same server predicate, never replaces it.
- Feature costs bind one actual persisted resource to the exact feature through unique reciprocal IDs and
  source-qualified provenance, with synchronized current/max/recharge mirrors. Reject ambiguous, anonymous or
  contradictory bindings; do not synthesize a server-side resource or claim a same-name legacy pool.
- Fix ordinary acquisition when it fails to persist the link. Prove load/round-trip, level-up/down, respec, rest,
  spent-point preservation and the absence of side effects from getters. Preserve unrelated manually configured
  pools byte-for-byte; they are not raw material for silently repairing another feature.
- List predicates the server can and cannot establish. Shared identity/targetability and consent do not prove
  distance, sight, action/component eligibility or creature type. Stop for an explicit decision when a template
  needs unavailable authority; an approved table-adjudicated boundary must be narrow and visible to source and
  target **before confirmation**, not an implication of using Cure Wounds as prior art.
- Do not invent a minimum healing amount, widen a typed effect or share no-op behavior across authority lanes.
  The HW/MHW dice-expression floor is a separately approved narrow convention, not RAW or a global spell rule.
  Singular unchanged-target failure is private/unspent; MHW's explicitly opted-in full-HP no-op is applied and
  revisionless. Reverify current definitions before extending either.
- Trace legal bounds end-to-end: resolver, source/target prompts, closed HTTP schema, registry, resource
  affordability and both stores. Registry tests alone missed a singular HTTP amount ceiling.

Primary sources: `js/hub/hub-healing-word-spells.js`, `hub-lay-on-hands.js`, `hub-source-costs.js`;
`server/src/semantic-operation-registry.js`, `peer-source-cost-authority.js`, `server/src/app.js`;
`charactersheet-class-utils.js` and the source-template/acquisition/lifecycle tests.

## Evidence provenance

The user-requested session sources were: **Multiplayer hub exploration**
(`4d0276f2-bd1b-483f-8d5b-6568882944e8`, controlled landing and staged mutation isolation),
**Multiplayer hub exploration** (`7054fd5d-ccf9-46c5-be7d-f3ed146d6a9c`, r9/r11 identity, physical no-write
navigation and evidence gaps), and **Hub continuation plan** (`83265e23-4c1d-4853-8e48-3254b8de05cb`,
A3 replay/locks/recovery, A4 readiness/liveness and A5 source identity). They explain why these scenarios matter;
current code/contracts and current authorization still decide what to do.
