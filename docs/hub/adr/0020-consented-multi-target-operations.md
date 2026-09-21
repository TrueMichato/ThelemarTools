# ADR 0020: Consented multi-target semantic operations

Status: Accepted design contract; Wave A0 proof only, not implemented (2026-09-21)

> **Extends and supersedes narrow prior rules:** This ADR extends
> [ADR 0012](0012-idempotent-semantic-character-operations.md) from one target to one immutable bounded target
> set. It supersedes ADR 0012's self-target rule: the source owner's finalization is consent for source-owned
> target legs, so no separate self-approval command exists; deselection terminally declines that leg. It extends
> [ADR 0016](0016-atomic-peer-source-costs.md) from one source plus one target to one source plus N selected
> targets while preserving no reservation, one source cost, deterministic derivation, and one all-or-none
> transaction. It also narrowly supersedes ADR 0016's blanket prohibition on paying for a target no-op: a
> reviewed multi-target healing template with `allowTargetNoOp=true` may record an approved selected target as
> applied with no state delta when already at maximum HP, without disclosing that fact to the source.
>
> **Implementation boundary:** This Wave A0 change records design and executable documentation/query proof only.
> This design-only PR contains no production migration, routes, store methods, protocol 6, capability
> advertisement, events, browser controls, or production state-machine behavior. ADR 0020 nevertheless requires
> future additive migration `0010_multi_target_semantic_operations.sql` in A3. The draft must remain unmerged until the coordinator records the physical game-day GO/NO-GO.

In short, this contract extends ADR 0012 and extends ADR 0016 while superseding only the narrow rules stated
above. It requires future additive migration `0010_multi_target_semantic_operations.sql`.

## Context

The current semantic-operation authority is singular:

- migration `0005_semantic_character_operations.sql` stores one target character/ref, operation, result revision,
  and applied event;
- migration `0007_peer_source_costs.sql` stores one target owner, source cost/result, and combined self-target;
- `pCreateStructuredAction()` derives one target operation;
- `pResolveStructuredAction()` combines one target's consent and application in one `accept` command;
- `pListPendingActions()`, `pListCharacterPendingActions()`, `_pExpireSemanticOperations()`,
  `_pCancelSemanticOperationsForLifecycle()`, and PostgreSQL resolution discovery all read singular target columns;
- reconciliation recognizes only `operationId/source`, `operationId/target`, and `operationId/combined`.

Repeating the singular operation would charge once per target, permit partial commits, split one cast across
unrelated command identities, and make reconnect unable to prove the full selected set. Overloading the parent
JSON would not give PostgreSQL enforceable uniqueness, ownership, lifecycle, response, finalization, or cleanup
relationships.

The accepted product flow fixes 1-8 player-character candidates at proposal. Every target owner independently
responds for each owned character. After all pending target legs respond or reach the collection deadline, the
source chooses one exact ordered approved subset and finalizes once. The server spends one source cost and
applies every selected leg atomically, or none.

## Decision

### Scope, limits, and deferrals

Version 1 supports:

- one active player-owned source character;
- a minimum of 1 and maximum of 8 ordered, unique, active player-owned target characters;
- one closed server template and one closed source-cost bundle;
- one target-leg response per character;
- source-owned targets which need no separate response command but remain deselectable;
- one exact ordered final selected subset;
- zero selected targets as explicit cancellation;
- one source cost plus all selected target legs in one atomic transaction;
- at most 3 live collection operations per source character;
- at most 5 live collection operations per source account;
- at most 50 live collection operations per campaign;
- at most 20 pending invitations per target owner;
- cursor-paginated inbox/outgoing reads capped at 100 rows per page;
- expiry/cleanup batches capped at 100 parent operations.

Proposal creation enforces every live-cap transactionally. It first locks a dedicated global multi-target quota
namespace (advisory-lock seed 10) for the source account and every distinct target-owner account in ascending
account UUID order, before acquiring the campaign lifecycle lock. Those account locks serialize the global
5-live/source-account and 20-pending-invitations/target-owner checks across different campaigns. The
3-live/source-character and 50-live/campaign checks run later under campaign/character authority.

The first concurrent proposal which remains within all caps wins; later proposals fail with
`COLLECTION_LIMIT_REACHED` and create no operation, invitation, event, outbox, audit, or command result.

The BFF additionally applies explicit mutation rate limits before store entry:

- propose: 10/minute per account and 30/minute per campaign;
- respond: 30/minute per account and 120/minute per campaign;
- finalize/cancel: 20/minute per account and 60/minute per campaign.

Rate-limit rejection is `429 RATE_LIMITED`, carries no target/cost detail, and creates no workflow evidence.

The candidate set is immutable. A roster, party, visibility, or targetability change may revoke a leg but never
adds or substitutes a target. Proposal creation resolves every opaque target ref and rejects duplicate resolved
character ids, even when different refs or repeated browser entries name the same character.

Deferred:

- NPC/monster targets, party aliases, arbitrary prose, damage/combat resolution, offline writes;
- adding/replacing targets after proposal;
- incremental/repeated partial commits or per-target source costs;
- more than eight targets without a future measured contract version covering per-leg consent, events, locks,
  query budgets, and reconciliation;
- general no-op payment outside reviewed templates;
- collaborative document editing.

### Identity and addressing

| Identity | Meaning |
|---|---|
| `proposalCommandId` | Actor/body-bound proposal command |
| `operationId` | Parent identity spanning proposal, every leg, finalization, events, recovery, and audit |
| `invitationId` | Opaque, globally unique target-leg address; one owner may own several legs |
| `responseCommandId` | Actor/body/invitation/decision-bound target response |
| `finalizationCommandId` | Actor/body/ordered-subset-bound source finalization |
| `legId` | Stable persisted mutation/reconciliation identity for one unique character |
| `eventId` | Stable domain-event/outbox identity |

The response route and command address `invitationId`, never only `operationId` or account id. Parent identity is
ambiguous when one owner owns two candidate characters.

Derived reconciliation keys are:

```text
operationId/source
operationId/target/targetCharacterId
operationId/combined/sourceCharacterId
```

There is exactly one character update and one mutation leg per unique character id. If the source is selected as
a target, cost then effect run on one clone and produce one combined leg/event/revision increment. Other selected
targets each produce one target leg.

### Lifecycle and deadlines

```mermaid
stateDiagram-v2
  [*] --> collecting_responses: proposal + fixed target legs
  collecting_responses --> awaiting_source_selection: every leg terminal or collection closes
  collecting_responses --> cancelled: source-side lifecycle/cancel
  collecting_responses --> expired: operation TTL
  awaiting_source_selection --> applied: exact non-empty approved subset commits
  awaiting_source_selection --> cancelled: empty subset or no approved legs remain
  awaiting_source_selection --> expired: operation TTL
  awaiting_source_selection --> failed: source/cost/policy/template invalid
  applied --> [*]
  cancelled --> [*]
  expired --> [*]
  failed --> [*]
```

Each target leg has response state:

```text
pending -> approved | rejected | expired | revoked | declined
```

All states except `pending` are terminal. Source-owned legs begin `approved_by_source` internally and become
`declined` when omitted from the exact final subset. Other approved legs omitted by the source also become
`declined`; this records that they were intentionally not selected, without changing the owner's historical
approval.

`collection_closes_at` is distinct from the parent `expires_at` operation TTL. Finalization locks the parent,
evaluates elapsed pending legs inline, writes their `expired` responses in ordinal order, and proceeds only when
all legs are terminal. A bounded maintenance sweep and bounded lazy sweep use the same parent-first transition.
Response expiry does not consume cost or expire the whole operation.

The live parent states are exactly `collecting_responses` and `awaiting_source_selection`.

Maintenance processes at most 100 parents per run. Each short transaction selects exactly one due parent with
`ORDER BY collection_closes_at, id LIMIT 1 FOR UPDATE SKIP LOCKED`, completes that locked parent, and commits
before selecting another. A lazy sweep uses the same ordering and one-parent transaction. No maintenance worker
locks a child directly.

Target-side move/removal/archive/ownership/ref/access loss revokes only that leg. Source-side ownership,
membership, character, campaign, or source-template lifecycle change cancels the whole operation. If target-side
revocation leaves no approved leg, the parent becomes `cancelled`. Lifecycle and expiry reach child legs only
through a locked parent.

There is no reservation, refund, `partially_applied`, repeated finalization, or accepted-but-not-finalized cost.

### Consent and source finalization

Each target owner approves/rejects each invitation independently. One owner with two candidates submits two
idempotent response commands. A DM/co-DM may reject/revoke/cancel but never approve for another owner.

Source-owned legs do not create a separate response command. Source finalization is consent for every selected
source-owned leg and explicit decline for every deselected source-owned leg. This supersedes ADR 0012's separate
self-target approval requirement only for this contract.

Finalization is source-owner authority and is allowed only after collection closes and before operation expiry.
The body contains the exact ordered list of selected invitation ids. The selected set must be unique, belong to
the immutable operation, be approved at lock time, and remain current/authorized. The server never silently
drops a submitted leg. If any submitted leg is rejected, expired, revoked, declined, moved, archived,
re-owned, ref-rotated, or otherwise invalid, the entire finalization returns
`FINALIZATION_SELECTION_INVALID` with no workflow, character, audit, event, outbox, watermark, or receipt-shaped
success side effect. The source may refresh and submit a new command/subset.

An empty list commits `cancelled`/`empty_selection` and no character mutation. A non-empty valid list rederives
current source, cost, rules/content/template pins, memberships, target authorization, applicability, normalized
effects, and document safety under locks. Source/cost/policy/template invalidity commits terminal `failed` with no
character mutation. Target authority invalidity rejects only that finalization attempt; it is never a partial
apply.

Exact response/finalization replay returns the same identities and result. Command reuse with another actor,
invitation, decision, order, or subset returns `IDEMPOTENCY_KEY_REUSED`. A different finalization command after a
terminal parent returns its authorization-shaped terminal outcome without mutation.

### Privacy-preserving permitted target no-op

Multi-target healing templates may opt into `allowTargetNoOp=true` only after template-specific review. At
finalization:

- an approved selected target already at its applicable maximum HP is valid;
- its leg commits as `applied` with `changed=false`, no character update, no revision increment, and no projection
  invalidation for that character;
- the one source cost is still consumed for the exact chosen set;
- the target owner/DM may see their own leg's generic applied/no-change result;
- the source sees only that the selected set applied, never which target was full or which leg changed;
- source-as-target at full HP still commits the source cost through one combined leg; the combined event/revision
  reflects only the cost mutation and does not identify the healing no-op.

This exception applies only to effect inapplicability explicitly allowed by the pinned template. Invalid
authority, policy, character shape, target identity, effect derivation, or unsupported state remains fail-closed
and atomic. A non-healing template or a template without the flag retains ADR 0016's no-op failure rule.

Privacy canaries must prove the source response, audit, events, logs, metrics, timing classes, and reconnect
history cannot distinguish all-changed, some-full, or all-full selected sets.

### Normative PostgreSQL lock order

Every proposal/response/finalization/expiry/lifecycle path uses this total order:

1. command advisory lock (seed 9) and payload-aware replay lookup;
2. authenticated session/account rows;
3. for proposal creation, quota advisory locks (seed 10) for source account plus distinct target-owner accounts
   in ascending account UUID order;
4. campaign advisory lock (seed 6) then active campaign row;
5. parent semantic operation rows in ascending operation UUID order `FOR UPDATE`;
6. target child rows ordered by `(operation_id, target_character_id)`;
7. required membership rows in ascending account UUID order;
8. unique character advisory locks (seed 2) in ascending character UUID order;
9. character rows in ascending UUID order `FOR UPDATE`;
10. separately persisted resources in ascending `(kind,row UUID)` order;
11. character lease rows in the same character order;
12. pinned rules/brew/template reads;
13. compute every next document/leg/event before any canonical write;
14. write workflow, unique character updates, audit, events/outbox, watermarks, and command result; commit once.

The normative multi-target aggregate sequence is command advisory lock -> global quota locks ascending by account
UUID (proposal only) -> campaign advisory/row -> parent
operation rows ascending by UUID -> child legs by `(operation_id,target_character_id)` -> character advisory
locks ascending -> character rows ascending -> leases. Session/account and membership checks remain in their
listed positions but never invert that aggregate sequence.

Discovery may read immutable ids before the parent lock only to identify the parent; after locking, all ids must
match. Lifecycle/expiry reaches children only through the locked parent. No path locks a child before its parent
or upgrades from character locks back to operation/campaign authority.

Response paths stop after the child/membership rows. Reject/cancel/expiry take no character locks. Finalization
dedupes source plus selected target ids before acquiring character locks.

Maintenance uses the bounded `SKIP LOCKED` query above and processes one locked parent per transaction. Lifecycle paths
which affect several operations lock all affected parent ids in ascending order before locking any child. A3
must run concurrent PostgreSQL tests with overlapping operation sets discovered in opposite orders and opposing
source/target UUID orders; neither may deadlock or partially transition.

Cross-campaign proposal tests must fill a target owner's global pending-invitation cap, then race two proposals
from different campaigns whose source/target-owner account lists are discovered in opposite orders. Ascending
seed-10 quota locks produce exactly one quota-lock winner at the final slot, one
`COLLECTION_LIMIT_REACHED` loser, no deadlock, and no loser workflow evidence.

The read-only set-shaping feasibility example at
`test/fixtures/hub/adr-0020-multi-target-set-shaping.sql` demonstrates valid target uniqueness, exact contiguous
ordinals, subset membership, source/target deduplication, ascending UUID order, and negative duplicate/gapped
candidate detection. It performs no `FOR UPDATE`, creates no schema, and is not a lock or implementation proof.

### Concurrency and hazard outcomes

| Hazard | Winner | Loser/result | Accepted/latest/live/durable/visible tracks |
|---|---|---|---|
| Two owners respond concurrently | Both distinct child rows may commit | Parent becomes ready only after last terminal leg | Each response/event durable once; source refreshes coarse status |
| Same owner, two targets | Each invitation command is independent | Parent account identity cannot collapse responses | Two child responses; owner sees two cards |
| Two responses for one invitation | First child-row lock commit | Exact retry replays; changed command returns stored terminal state/error | No latest-click overwrite |
| Response vs collection expiry | First parent/child lock before DB deadline | Expiry wins after deadline; late response sees `expired` | Pending visible card is replaced from authority |
| Finalize vs late response | Finalize expires pending legs inline then validates | Late response either won first or sees terminal leg | No inferred approval |
| Target move/removal/archive | Parent-first lifecycle transaction | Leg becomes `revoked`; operation survives if approved legs remain | Hidden label removed; neutral unavailable ordinal remains |
| Source lifecycle loss | Parent-first lifecycle transaction | Whole operation cancels | All private UI concealed before stale callback |
| Source cost spent/restored | First bound-resource mutation trips ABA fence | Finalization terminally fails; restoration does not revive | No target legs/events |
| Duplicate finalization | First valid parent-lock commit | Exact replay returns same leg/event ids; different command sees terminal | One source/combined leg and selected target legs |
| Source-as-target | One unique source character lock/update | No second source or target update | One combined leg/event/revision; other targets independent |
| Duplicate resolved target | Proposal validation | Whole proposal rejected | No workflow row/event |
| Rules/template change | Finalization revalidation | Whole operation terminal `failed` | No character/leg/invalidation |
| Permitted full-HP target | Successful finalization | No target state delta/revision/invalidation for that leg | Source sees no difference; target owner sees bounded own outcome |
| Rejected finalization | Validation | Source may retry new subset/command | No workflow/audit/event/outbox/character side effect |
| Reconnect/replay | Canonical rows, event ids, leg ids, watermarks | Duplicate delivery suppressed | Accepted base, live, latest submitted, durable recovery, visible sheet converge per leg |

Database clock/lock order determines winners, never browser time or WebSocket arrival.

### Canonical writes, events, privacy, and reconciliation

For a successful finalization:

1. insert the finalization and exact ordered selected-leg rows;
2. compute one mutation result per unique character;
3. update each changed unique character exactly once in ascending UUID order;
4. insert one durable leg row per selected unique character plus source-only leg when the source is not selected;
5. append one bounded finalization audit summary;
6. emit a source cost/combined event first to source owner plus DM/co-DM;
7. emit one target applied event per selected invitation in proposal ordinal order, including no-op legs, to that
   target owner, the source owner where the coarse response status is authorized, and DM/co-DM;
8. emit one collapsed metadata-only projection invalidation for the union audience of all changed character
   projections; the payload remains empty and contains no roster/target ids;
9. persist the source-owner finalization result and commit once.

Source proposal, ready, source-cost, finalization, and source-terminal events are visible to source owner plus
DM/co-DM. Per-leg request, response, applied, revoked, expired, and declined events are visible to that target
owner, the source owner where that response status is authorized, and DM/co-DM. Event presentation is projected
per viewer: a target owner sees only their leg; a source owner sees only authorized labels and coarse leg status;
DM/co-DM sees the bounded management projection. No target-owner payload exposes a co-target identity, decision,
ordinal mapping, selection, changed flag, or applicability.

DM/co-DM observation is intentional: they need bounded support, abuse moderation, lifecycle diagnosis, and
campaign audit without character documents, hidden resource values, or co-target disclosures.

No event contains the full private roster or selected target list. Events are allocated in deterministic
batches: source event, target events by proposal ordinal, then the collapsed invalidation.

Target events carry operation id, invitation id, leg id, normalized target operation, resulting revision when
changed, and a bounded changed flag visible only to that target owner/DM. Source projections remove the changed
flag and target state. Unrelated users receive no workflow event.

Reconciliation applies durable legs:

```text
source:   accepted := C(B);      live := C(L)
target i: accepted := Ei(B);     live := Ei(L)
combined: accepted := Ei(C(B));  live := Ei(C(L))
next save: diff(new accepted, new live)
```

No-op target legs mark coverage/history but do not transform document tracks. Each sheet stages every relevant
transform before adopting accepted base, live state, latest-submitted state, durable recovery queue, or visible
state. Unknown coverage triggers serialized canonical resync; it never repeats finalization or guesses from
arrival order.

### Schema decision: additive migration 0010 is required

Migration `0010_multi_target_semantic_operations.sql` is required in A3. The normalized target table is
`hub.semantic_operation_targets`; do not store target/response/selection arrays in JSON.

Migration 0010 also creates singleton `hub.semantic_multi_target_usage`:

- `singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton)`;
- `first_used_at timestamptz NOT NULL`;
- `first_operation_id uuid NOT NULL`;
- no foreign key to semantic-operation or campaign history.

The first accepted multi-target proposal inserts
`(true, now(), operationId)` transactionally with `ON CONFLICT DO NOTHING`. This irreversible high-water marker
survives parent/child/finalization/command/leg cleanup and proves the schema has been used even after every
cleanable workflow row has aged out.

The existing `semantic_operations` parent remains the shared aggregate:

- add `target_set_version integer`;
- make singular `target_character_id`, `target_ref`, `target_owner_account_id_at_proposal`,
  `target_revision_observed`, `resulting_character_revision`, and singular target/applied event fields nullable;
- add parent collection/finalization deadlines and parent status support;
- add a shape constraint: legacy rows have `target_set_version IS NULL` and all migration-0005/0007 singular
  target fields retain their old requirements; multi-target rows have `target_set_version = 1`, singular target
  fields/results are null, and targets exist only in children.

`semantic_operation_targets` requires:

- PK `(operation_id,target_character_id)`;
- `campaign_id`, globally unique `invitation_id`, unique `(operation_id,ordinal)`, immutable `target_ref`, pinned
  owner, safe snapshot, normalized target operation, observed/result revisions, response state/actor/command/time/
  event, selection state/index, lifecycle invalidation/revoke reason/event, leg id/kind/event, and changed flag;
- unique `(operation_id,target_ref)`, `(operation_id,selection_index)` where selected, and
  `(operation_id,leg_id)` where applied;
- character, rules, event, and command references use retention-safe `ON DELETE RESTRICT`; historical response/
  finalization actor references use `ON DELETE SET NULL`; operation-owned target/finalization rows use
  `ON DELETE CASCADE` only when explicit parent history cleanup is authorized.

Add `semantic_operation_finalizations` with one row per parent, unique command id, exact ordered invitation-id
selection identity, terminal result, actor, event ids, and timestamps. Exact ordered selection may be retained as
bounded JSON only as the immutable command/result fingerprint; normalized selected flags/indexes remain on target
rows and are authoritative.

`semantic_operation_commands` remains the global command namespace. Expand command types for
`create_multi_target_proposal`, `respond_multi_target`, and `finalize_multi_target`; response commands store their
invitation id. Existing one-target commands remain readable unchanged.

There is exactly one finalization row per operation.

Required constraints/triggers:

- 1-8 contiguous unique target ordinals and `candidate_count` equality;
- one invitation/response per target leg and one finalization per parent;
- exact selected subset is unique, child-owned, terminally approved at commit, and contiguous;
- applied parents have one source/combined leg plus every selected target leg, no unselected leg, and no duplicate
  character update;
- no-op changed=false legs have no result revision/invalidation;
- non-applied parents have no mutation legs/results;
- parent/child campaign consistency.

Required indexes:

- parent `(campaign_id,status,collection_closes_at,id)` partial on collection;
- parent `(campaign_id,status,expires_at,id)` partial on finalization-ready/live;
- source `(source_character_id,status,created_at DESC)` for live-collection cap/outgoing list;
- target inbox `(target_owner_account_id_at_proposal,response_state,collection_closes_at,operation_id,
  target_character_id)` for oldest-pending-first cursor pagination with `LIMIT 100`;
- target lifecycle `(target_character_id,operation_id)` partial while not revoked;
- invitation unique lookup;
- response/selection/ordinal/leg unique indexes;
- bounded terminal cleanup/retention indexes;
- no indexes on private source-cost/choice/operation/snapshot JSON.

Inbox pagination is ordered by `collection_closes_at, operation_id, target_character_id` ascending. The exclusive
cursor carries all three values, so churn at the front cannot starve an older pending invitation behind a
100-row page. Source outgoing collections use `created_at, operation_id` ascending while live, then a separate
newest-first terminal-history cursor.

Every current singular read must be explicitly rewritten to union legacy parents with child legs:

- `pListPendingActions`;
- `pListCharacterPendingActions`;
- `_pExpireSemanticOperations`;
- `_pCancelSemanticOperationsForLifecycle`;
- response/finalization discovery and authorization;
- outgoing status, lifecycle move/archive/removal, account purge, campaign purge, export/retention, and
  predecessor compatibility checks.

Purge must delete command/finalization/target rows through explicit parent history cleanup before character hard
delete so `ON DELETE RESTRICT` cannot leave silent orphan rows or permanently block due-account purge. Lifecycle
state changes remain workflow transitions, never FK cascades.

Detailed terminal multi-target parent/target/finalization/command/leg rows are retained for 90 days, then removed
in oldest-terminal-time/id order in batches of 100 only after every related outbox row is published and the
operation is outside the idempotency/recovery window. Audit and domain events retain their existing independent
policy. Normal cleanup never deletes or rewrites `hub.semantic_multi_target_usage`. Cleanup exposes aggregate
counts/status/age only.

Migration 0010 is `phase: "expand"`. Its migration-policy entry may say `previousAppCompatible: true` only for
the schema-before-use state: while capability remains disabled and the usage marker is absent, a pre-0010 binary
reads legacy rows, ignores additive tables/nullable columns, and never creates `target_set_version=1`.

After the first accepted multi-target proposal sets `hub.semantic_multi_target_usage`, operational rollback to a
true pre-0010 binary is permanently forbidden even if all parent/child history has been cleaned. The normal
rollback target must be a bridge/r10+ release which understands `target_set_version`, child history, projection
filtering, expiry, retention, explicit cleanup, and the usage marker. A pre-0010 rollback preflight requires the
usage marker to be absent; current parent/child counts are diagnostic only and cannot clear a present marker.

Returning to a true pre-0010 binary after data creation requires a separately reviewed destructive
history/event/outbox/recovery export-and-purge procedure with backup, participant/audit export, FK-safe cleanup,
and explicit human authorization. Deleting the usage marker is the final irreversible step of that reviewed
procedure. It is not normal rollback and is not defined by this ADR. No ordinary rollback drops columns/tables
or reverses applied character state.

Role grants run after migration: runtime gets CRUD on new workflow tables and `SELECT, INSERT` (not
`UPDATE, DELETE`) on the usage marker; backup gets SELECT on every new table including the marker; operations
gets no new mutation grant; no role gets schema create. Fresh/upgrade/restore tests prove the marker is absent
before use, inserted once on first accepted proposal, retained by 90-day cleanup, restored by backup, and visible
to rollback preflight.

### Protocol, capability, API, rollout, and rollback

Implementation requires protocol 6. Every protocol `<6`, explicitly 3, 4, and 5, fails closed for multi-target
create, respond, finalize, cancel, inbox, detail, outgoing projections, WebSocket delivery, resync, and replay.
Those clients never receive shapes they could misread. Protocol 6 is the first successful version. Current
one-target protocol-4 routes/events remain unchanged.

Capability:

```json
{
  "multiTargetOperations": {
    "enabled": false,
    "contractVersion": 1,
    "protocolVersion": 6,
    "maxTargets": 8,
    "supportsSourceOwnedFinalizationConsent": true,
    "supportsPartialSelection": true,
    "supportsPartialCommit": false,
    "templateRegistryVersion": "multi-target-effects-v1"
  }
}
```

Planned routes:

- `POST /api/campaigns/:campaignId/multi-target-operations`;
- `POST /api/campaigns/:campaignId/multi-target-operations/:operationId/invitations/:invitationId/respond`;
- `POST /api/campaigns/:campaignId/multi-target-operations/:operationId/finalize`;
- bounded participant detail/inbox/outgoing reads.

Rollout order: A1/A2 foundations, A3 migration/server with capability off, protocol-6 A4 clients, A5 templates,
Memory/PostgreSQL and real-stack proof, one allowlisted campaign/template canary, then measured expansion.
Disabling stops creation; response/reject/cancel/expiry/read remain available. Finalization after deliberate
disablement terminally fails without mutation.

The capability is disabled by default.

Bridge-release rollback preflight reports total and live parent/child counts, oldest
collection/finalization/terminal deadlines, unsupported template versions, incomplete
response/finalization/leg rows, usage-marker state, and cleanup readiness without private identities. A true
pre-0010 target is blocked whenever the usage marker exists, regardless of current row counts.

### A1-A5 handoff

| PR | Scope | Required boundary |
|---|---|---|
| **A1 — DM typed effects** | Existing six-operation immediate DM/co-DM lane completed in the Wave A1 descendant implementation | No prose; pure fixtures; route/Memory/PostgreSQL parity; replay/no-op/privacy/reconciliation coverage; held pending physical game-day GO/NO-GO |
| **A2 — source-cost authority** | Generalized deterministic one-time cost/ABA authority | No reservation; shared Memory/PostgreSQL parity |
| **A3 — server state machine** | Migration 0010, protocol 6, capability/routes, both stores, events, lifecycle, privacy, expiry, locks | Seed-10 cross-campaign quota races, opposing-order deadlock tests, usage-marker persistence, fault injection, purge/bridge rollback |
| **A4 — Character Sheet UX and reconciliation** | Proposal, invitation response, exact-subset finalization, per-leg recovery | Same-owner/two-target and source-as-target UX; dirty/in-flight/reconnect/access-loss coverage |
| **A5 — Healing Word and Mass Healing Word templates** | First reviewed production templates | PHB/XPHB semantics and explicit `allowTargetNoOp=true` privacy evidence |

## Verification required before enablement

1. Same owner with two target invitations and independent replay.
2. Source-as-target plus other targets, one combined update/revision/event.
3. Response/finalization and response/collection-expiry races.
4. Expiry without readers via bounded maintenance sweep.
5. Source-cost spend/restore ABA and independent mutation contention.
6. Target move/removal/archive/ref/ownership change and source lifecycle cancellation.
7. Account/campaign purge with no silent orphan/restrict blockage.
8. Protocol 3/4/5 fail-closed mutation/read/WebSocket/resync/replay and protocol-6 compatibility.
9. Privacy canaries for hidden targets and all-changed/some-full/all-full allowed-no-op sets.
10. Fault injection after every target write, unique character update, event/outbox, audit, and response/finalization
    receipt step.
11. Memory/PostgreSQL byte-equivalent status, projection, ordering, replay, and failure behavior.
12. Opposing source/target UUID order and concurrent finalizations with zero deadlocks/partial commits.
13. Overlapping lifecycle/expiry parent sets discovered in opposite order, proving ascending parent locks and
    `SKIP LOCKED` maintenance progress.
14. Duplicate resolved target/invitation/ordinal/selection rejection, plus explicit duplicate/gapped set-shaping
    proof failures.
15. Rejected finalization zero-side-effect proof.
16. Per-leg accepted/latest/live/durable/visible reconciliation across reconnect/replay.
17. Protocol 3/4/5 failure for every multi-target surface and protocol-6 success.
18. Concurrent live-cap winners, create/respond/finalize churn, 429 mutation throttles, and oldest-pending cursor
    pagination without starvation.
19. Cross-campaign proposals targeting the same owner at the 20-invitation cap, with opposite owner-discovery
    order, one seed-10 winner, one loser, and no deadlock.
20. PostgreSQL source-account-cap race: seed one source account with four live collections, concurrently propose
    in two different campaigns for slot five under the seed-10 source-account lock, and prove exactly one applied
    proposal, one stable `COLLECTION_LIMIT_REACHED` loser, no deadlock, and zero loser parent, child, audit, event,
    outbox, or command/receipt evidence.
21. Fresh/0009 upgrade/concurrent/failure/checksum/roles/backup/restore proof for the irreversible usage marker.
22. Default-off/disable/bridge rollback and true pre-0010 marker-absent preflight.

## Consequences

- Consent remains per owned character while payment remains one source decision.
- Partial approval is usable; partial commit is forbidden.
- Reviewed healing no-ops protect hidden target state without refund or re-proposal oracles.
- Normalized child rows make invitation, response, lifecycle, cleanup, and reconciliation enforceable.
- Existing one-target rows/routes remain readable and unchanged.
- Schema-before-use remains additive, but the first accepted proposal persists an irreversible usage marker which
  permanently fences normal rollback to a true pre-0010 binary.

## Rejected alternatives

- **Repeat one-target operations:** per-target cost and partial commits.
- **Mutable target JSON on the parent:** weak uniqueness/FK/lifecycle/purge/query authority.
- **Account-addressed responses:** ambiguous when one owner owns multiple candidates.
- **Reserve source cost:** mutates before consent and creates release races.
- **Silently drop invalid submitted legs:** violates exact final selection and hides stale authority.
- **Best-effort loop/compensation:** can charge without every effect or apply free effects.
- **Generic failure and re-proposal for full-HP healing:** creates a source-visible oracle about hidden target
  applicability and forces avoidable repeated consent.
- **Disclose full-HP targets to the source:** violates projection privacy.
- **Allow generic paid no-ops:** hides template bugs and spends costs for unsupported state; only reviewed
  `allowTargetNoOp=true` multi-target healing templates receive the exception.
- **DM approval for another owner:** removes independent consent.
- **Browser applicability checks:** stale private browser state is not authority.
