# ADR 0012: Idempotent semantic character operations with operation-aware rebase

Status: Accepted as an architecture contract (2026-09-01)

Implementation: The protocol-v3 server/store/API/event substrate is implemented. DM/co-DM operations apply
immediately; the source-derived peer proposal state machine exists but has no successful production `cost=none`
template. Character Sheet operation-aware reconciliation and approval UI remain separate follow-up work.

## Context

ADR 0002 distinguishes owner document patches from semantic server commands, but the current implementation
does not carry that distinction through the Character Sheet:

- `server/src/hub-actions.js` implements structured damage, healing, condition add/remove, and spell-slot spend
  against canonical character data;
- both DM and player submissions currently create `pending_actions`; a target owner or DM/co-DM later resolves
  them;
- idempotency receipts deduplicate an HTTP key, while pending-action and event ids are generated independently;
- `js/hub/hub-http-character-repository.js` rebases path diffs and raises `CHARACTER_CONFLICT` when local and
  remote paths overlap;
- `CharacterSheet._saveCurrentCharacter()` separately protects edits made during an in-flight save and raises
  `CHARACTER_LIVE_CONFLICT` when those paths overlap;
- both conflicts enter a binary local/server modal. That is appropriate for unrelated document writes, but it
  treats an intentional semantic operation such as "heal 5" as an opaque overwrite of `/hp/current`.

The result is avoidable conflict prompts and, if implemented naively, a risk that choosing a stale whole
snapshot erases an already-applied operation. Reconnect, a lost response, duplicate delivery, lease takeover,
and an operation arriving while the modal is open all need one deterministic contract.

This decision refines ADR 0002 rather than introducing event sourcing. The character document remains
canonical; semantic events are the ordered explanation needed to reconcile an accepted document with live
local edits.

## Decision

### Stable command and event identity

Every semantic intent has a client-generated UUID `commandId`. The same id is retained across timeout, retry,
reconnect, approval retry, and lost-response recovery until the command reaches a terminal state. The current
idempotency header carries that id; generating a new id for a retry is a client bug.

The server stores, in one transaction:

- `commandId`, actor, command kind, canonical request hash, and terminal/non-terminal result;
- a stable `operationId` for the semantic intent;
- a stable `eventId` for each emitted lifecycle event;
- canonical character revision when application occurs;
- audit, domain event, and outbox rows.

A repeated `commandId` with the same canonical request returns the stored result and the same ids without
reapplying the operation or emitting another event. Reuse with different actor, target, kind, arguments, or
approval decision fails with the existing `IDEMPOTENCY_KEY_REUSED` code. Event/outbox retries retain `eventId`;
clients deduplicate by `eventId` and additionally remember applied `operationId`.

Proposal and approval are separate commands with separate `commandId` values but one `operationId`. Reject,
cancel, and expiry are terminal and cannot later become applied.

### Versioned operation catalog

An operation is closed, typed, and versioned:

```json
{
  "operationId": "UUID",
  "kind": "hp.heal",
  "version": 1,
  "targetCharacterId": "UUID",
  "arguments": {"amount": 5}
}
```

The initial catalog is:

| Kind | Typed arguments | Semantics |
|---|---|---|
| `hp.damage` | positive finite `amount` | Temporary HP absorbs first; current HP floors at zero |
| `hp.heal` | positive finite `amount` | Current HP increases and clamps to the applicable maximum |
| `condition.add` | validated condition reference | Add idempotently under normalized condition identity |
| `condition.remove` | validated condition reference | Remove every matching normalized condition |
| `spell_slot.spend` | integer `level`, positive integer `amount` | Decrement the matching slot if available |
| `spell_slot.restore` | integer `level`, positive integer `amount` | Increment the matching slot, clamped to its maximum |

This low-level operation envelope is a privileged command surface. Only a DM, co-DM, or an allowlisted
internal server workflow may submit a generic `kind` plus `arguments`. A player/peer route rejects a body that
contains free-authored operation kind or arguments; target approval must never turn arbitrary peer JSON into an
authoritative effect.

The authoritative event contains the declared operation after input normalization, its semantic version,
target identity, resulting character revision, and no unrelated character fields. Actor attribution remains in
the authorized event envelope and is not duplicated in the payload. It never substitutes a
post-clamp effective delta: `hp.heal 5` remains `hp.heal 5` even if canonical HP clamps, so the client can apply
the same operation to `B` and `L` and a peer actor cannot infer hidden HP from the clamp. Operation functions
are pure and deterministic for a given validated character state and normalized operation. A semantic version
is never silently redefined; incompatible rules require a new version.

Informational requests do not mutate a character and are not disguised as semantic state operations.
Inventory transfers, XP grants, and item grants keep their existing domain-specific commands until they adopt
equivalent versioned operation contracts.

### Source-derived peer proposals

A peer effect originates from an actual Character Sheet ability or spell targeting flow, not the generic
operation catalog. The proposal command has this closed shape:

```json
{
  "commandId": "UUID",
  "sourceCharacterId": "actor-owned character UUID",
  "sourceEntity": {
    "type": "ability",
    "uid": "stable source entity identity",
    "version": "stable content/rules version"
  },
  "effectTemplateId": "server-recognized template identity",
  "choice": {"templateDefinedChoice": "closed typed value"},
  "targetRef": "opaque targeting reference"
}
```

`sourceEntity.type` is initially `ability` or `spell`. Its `uid` uses the stable entity identity from the
activated campaign content/rules context, and `version` pins the exact semantics that produced the UI choice.
`effectTemplateId` selects a server registry entry for that entity version. `choice` may contain only selectors
declared by that template, such as a listed mode or cast level; it cannot contain an operation `kind`, amount,
condition, slot delta, or other free-authored effect argument unless the template itself defines that exact
closed choice.

Monster/NPC sources, one proposal producing multiple target mutations, and area/multi-target orchestration are
outside this initial contract.

The server, not the peer, derives the normalized semantic operation from
`sourceEntity + effectTemplateId + choice`. At proposal creation it authoritatively validates:

1. the authenticated actor owns `sourceCharacterId`, which is active in the same campaign;
2. the pinned source entity/template exists in the active content/rules policy and the submitted choice matches
   its schema;
3. the canonical source character actually has the source and can currently use the chosen template;
4. the opaque target reference is valid for that source, range/target policy permits it, and the actor is
   allowed to propose to it;
5. operation derivation produces exactly one supported single-target operation;
6. all source-side resource and cost semantics are supported by this contract.

The same checks run again while holding the source and target aggregate locks in stable id order immediately
before application. The apply transaction uses current source/target truth and the pinned entity/template
version. Target approval is consent, not authority to legitimize a missing, arbitrary, no-longer-usable, or
stale source.

This initial contract deliberately supports only templates whose declared actor-side cost is `none`. A peer
effect that would consume or reserve a spell slot, charge, limited use, item, ammunition, currency, material
component, concentration state, action/reaction, or any other source-character state fails closed with
`SOURCE_COST_UNSUPPORTED` before a pending action is created and again at apply. No actor resource is reserved
at proposal, committed at approval, or released on reject/cancel/expiry in this initial scope because no
cost-bearing peer proposal is admitted. Supporting such effects later requires an atomic reservation contract
that names each reserved resource, prevents double spend, commits source cost with the target effect, and
releases it on every terminal non-applied transition.

The server stores immutable, privacy-safe `sourceDisplaySnapshot`, `targetDisplaySnapshot`, and
`effectDisplaySnapshot` values with the proposal for approval and audit UI. They are derived from the applicable
ADR 0011 peer profiles plus template-owned display text, not copied character/entity truth. Events may include
those snapshots and the actor's submitted source identity/version/template/choice, but never hidden source or
target state, derived eligibility facts, effective/clamped deltas, or a broader profile.

Target discovery uses only profile-visible identity and opaque references. Proposal/apply failures sent to the
peer actor are non-enumerating (`SOURCE_OR_TARGET_UNAVAILABLE` or `PROPOSAL_STALE`). Shared lifecycle events carry
only the closed reason `unavailable`; richer diagnostics may exist only in an authorized command response or
separately targeted private metadata. A different failure code, timing response, activity row, or event payload
must not reveal hidden HP, condition, spell-slot, inventory, carry, source availability, or target eligibility.

### Approval policy

- A DM/co-DM operation is authorized and applied immediately in one canonical transaction. It does not create
  a pending approval merely because the target belongs to a player.
- A source-derived peer proposal always enters `proposed`, including a self-targeted proposal, and requires a
  later, distinct target-owner approval command before application. For self-targeting, the same account may
  issue that second command in its target-owner capacity; proposal creation itself never auto-approves.
- A target owner may approve or reject. A DM/co-DM may reject or cancel abusive/stale proposals, but approving
  on the target's behalf is unnecessary: a DM who intends the effect issues a new DM operation, which
  auto-applies with its own actor and command identity.
- Proposal creation and application both perform the authoritative source, policy, derivation, target, and cost
  validation above. Neither response discloses hidden HP, conditions, spell slots, inventory, carry, source
  usability, or target eligibility.
- Every peer proposal receives a bounded, non-null expiry at creation. Expiry is a terminal transition with its
  own stable event id; the implementation may configure the duration but may not leave proposals indefinitely
  actionable.
- An otherwise-authorized resolution command which reaches a still-proposed operation after its deadline wins
  the single `expired` transition and returns replayable terminal metadata rather than applying the requested
  decision.

Application locks the source and target aggregates in stable id order, rechecks actor/approver authorization
inside the transaction, re-derives and applies the operation to current canonical target truth, increments the
target character revision, and commits the receipt, pending-action transition when applicable, audit, domain
event, metadata-only projection invalidation from
[ADR 0011](0011-authorization-scoped-character-projections.md), and outbox rows atomically.

Semantic operations do not require or steal the target owner's edit lease. The revision change intentionally
causes an already-submitted owner patch to rebase. Lease epoch remains the fence for the subsequent owner save.

### Operation-aware Character Sheet rebase

For one applied operation `E`, the sheet tracks:

- `B`: last accepted authoritative base;
- `L`: current live local state, including unsaved and in-flight-era edits;
- `R = E(B)`: new authoritative state returned/fetched for the operation;
- `F = E(L)`: desired live state after applying the same operation to local work.

The required transition is:

```text
acceptedBase := R
liveState    := F
nextSave     := diff(R, F)
```

In words: when the sheet has accepted base **B** and local **L** while the server creates **R = E(B)**, the
sheet creates desired **F = E(L)**, adopts **R** as its accepted base, and saves **R -> F**.

Example: base HP is 10, an unsaved local edit makes it 8, and a DM heals 5. The authoritative result is 15,
the desired live result is 13, and the follow-up patch is derived from 15 to 13. Neither the local two points
of damage nor the heal is erased.

The client uses the normalized operation from the applied event, not untrusted display text or a guessed diff.
It applies an `operationId` at most once. If the authoritative response is not exactly the next expected
aggregate revision, the client fetches truth and ordered operation history before changing its accepted base.
If the operation cannot be applied to `L` under its declared version, automatic saving stops and the recovery
surface preserves `B`, `L`, `R`, the operation, and the error; it never falls back to a whole-snapshot write.

Operations compose in aggregate revision order. For `E1` then `E2`, both the base and live tracks apply `E1`
before `E2`. A metadata-only projection invalidation is not sufficient for an owner editor; owner/DM operation
events are explicit-recipient events and carry the normalized operation required for this transition.

### In-flight save ordering

The repository serializes save completions and semantic events per character. Starting a save freezes its
submitted base and snapshot but does not freeze `L`.

1. **Operation commits before the owner patch.** The patch receives a revision conflict. The server/replay
   supplies the intervening operation and `R`; the repository applies the operation to current `L`, adopts
   `R`, and submits `diff(R, F)` with the original local intent preserved.
2. **Owner patch commits before the operation.** The patch response becomes the accepted base. The later
   operation event applies to that base and to whatever live state now exists.
3. **Response is lost.** Retrying the same `commandId` returns the same canonical result and ids. A save retry
   likewise keeps its original idempotency key. Event replay cannot apply the operation twice.
4. **A newer local edit arrives while either request is in flight.** It remains part of `L`; no response may
   replace live state without first rebasing from the exact submitted snapshot, as the current
   `CHARACTER_LIVE_CONFLICT` guard already requires.

When ordering evidence is incomplete, the client fetches canonical truth plus operation events after its last
accepted event sequence. It does not infer ordering from WebSocket arrival time.

### Replay and reconnect

- Applied operation events use targeted visibility: actor, target owner, and DM/co-DM. Shared campaign
  consumers receive only ADR 0011 invalidation metadata.
- Reconnect first reauthorizes, then fetches owner truth and replays ordered visible events after the last
  accepted sequence. The client deduplicates by `eventId`/`operationId`.
- Each HTTP/WebSocket replay page carries authoritative `{scannedThroughSequence, hasMore}` metadata. Privacy
  redaction may leave a page short or empty; clients continue from the scanned sequence while `hasMore` is true
  and never treat visible event count as proof that later lifecycle events do not exist.
- Owner/DM truth carries `operationWatermark`, the latest applied-operation campaign sequence already reflected
  in that canonical revision. Owner/DM resync refs may carry it; peer profiles and peer refs never do. Events at
  or below that watermark still deliver and update history but do not transform a fetched canonical base again.
- Local recovery retains its accepted base, local snapshot, command ids, and operation watermark. It is not
  silently promoted to a base after reload.
- If replay needed to transform local work has expired, the client cannot prove `F`. It blocks cloud save and
  offers authoritative reload plus an exportable local recovery artifact; it never submits a blind snapshot.

### Lease fencing and revocation

After adopting `R`, saving `R -> F` requires the current session's valid lease epoch. `LEASE_HELD`,
`LEASE_EXPIRED`, or `LEASE_FENCED` preserves `F` in recovery and makes the sheet read-only until the existing
takeover flow completes. A semantic event is not permission to bypass a fence.

Authorization is rechecked while holding the command/target transaction locks:

- revocation before the commit rolls the operation back;
- a commit that wins the race remains canonical and replayable to still-authorized recipients;
- session or membership revocation closes sockets, clears authorized response caches, and forbids queued
  follow-up saves;
- role demotion prevents a queued DM command from auto-applying;
- actor removal cancels that actor's pending peer proposals;
- target removal, character detach/archive, or campaign archive cancels pending proposals without applying
  them.

After access loss, a local draft may be exported but cannot be pushed through conflict resolution or lease
takeover.

### Existing overlap modal

`CHARACTER_CONFLICT` and `CHARACTER_LIVE_CONFLICT` remain correct for opaque document changes that overlap.
An applied semantic operation is not sent through that binary path merely because it touches the same JSON
path as local state; the `B/L -> R/F` transition is its conflict resolution.

If an ordinary overlap modal is already open when a semantic event arrives:

1. do not open a second modal and do not mutate an untracked copy behind the dialog;
2. enqueue the event by `eventId` in the conflict recovery record;
3. apply each queued operation once, in revision order, to both the authoritative candidate and the local
   candidate before honoring `Use Server` or `Use Local`;
4. set the resulting authoritative candidate as the accepted base;
5. if `Use Local` remains selected, save only its diff from that transformed base under a valid lease;
6. if authorization is revoked, disable `Use Local`/takeover, preserve export, and close campaign access.

Thus a modal choice can resolve the unrelated overlapping edit, but it cannot undo or duplicate a later
semantic operation. The implementation should replace stacked `InputUiUtil.pGetUserBoolean()` calls with one
per-character conflict coordinator capable of holding this queue; this ADR does not implement that UI.

## Required implementation evidence

Production implementation is not complete until tests cover:

1. stable `commandId`, `operationId`, and `eventId` across exact retries, lost responses, outbox retry, and
   reconnect, plus mismatch rejection;
2. generic operation admission for DM/co-DM/internal callers only, and rejection of peer-authored `kind`,
   `arguments`, amounts, or condition/resource deltas;
3. required `sourceCharacterId`, stable `sourceEntity` identity/version, `effectTemplateId`, and typed `choice`,
   including actor ownership, source presence/usability, policy, derivation, target, and apply-time stale-source
   checks;
4. immediate DM/co-DM application and mandatory target approval for source-derived peer proposals, including
   the same path for self-targeting;
5. fail-closed `SOURCE_COST_UNSUPPORTED` behavior, no initial source reservation/mutation, and terminal
   reject/cancel/expiry behavior;
6. privacy-safe source/target/effect display snapshots plus non-enumerating target/source/eligibility failures;
7. deterministic damage, heal, condition, spell-slot spend/restore semantics and version validation;
8. the exact `B/L`, `R = E(B)`, `F = E(L)`, `diff(R, F)` transition, including clamping/non-commutative cases;
9. both in-flight orderings, newer live edits, duplicate/out-of-order event delivery, and replay watermark
   behavior;
10. lease expiry, takeover fencing, session revocation, membership removal, role demotion, archive, and pending
   proposal cancellation;
11. semantic events arriving before and during each existing conflict modal choice;
12. privacy canaries proving operation details and eligibility failures do not cross ADR 0011 boundaries;
13. parity between memory and PostgreSQL authority plus real two-browser reconnect evidence.

The implementation change must update ADR 0002's proof description, API and realtime protocol documents, event
catalog, permission matrix, domain state machine, data lifecycle/retention, security model, Character Sheet
architecture, and conflict-recovery tests.

### Server substrate checkpoint

The first implementation slice freezes these server-owned choices:

- lifecycle events are `character.operation.proposed`, `.applied`, `.rejected`, `.cancelled`, and `.expired`;
- semantic operation version is exactly `1`; Hub wire compatibility is independently fenced by protocol `3`;
- proposal expiry is bounded to 24 hours;
- `commandId` equals `Idempotency-Key`, while proposal and resolution commands have distinct command ids and one
  stable `operationId`;
- production recognizes PHB/XPHB Cure Wounds as cost-bearing and rejects it with
  `SOURCE_COST_UNSUPPORTED`; no successful production peer template is enabled;
- constructor-injected `cost=none` templates exist only as a test seam for memory/PostgreSQL parity;
- terminal shared events expose only `unavailable`;
- target references rotate on detach/move/archive/reactivation boundaries and are exposed to peers only through
  an identity-visible profile;
- `operationWatermark` appears only in owner/DM truth and authorization-varying owner/DM resync references.

This checkpoint proves required evidence 1-7, the server portions of 9-10, and memory/PostgreSQL parity from 13.
Character Sheet `B/L -> R/F`, modal coordination, effect banners, approval UI, target discovery, successful
production peer templates, source costs, multi-target/monster operations, and live unsaved-edit reconciliation
remain deliberately deferred. Therefore ADR 0012 is not yet marked fully implemented.

## Consequences

- Intentional multiplayer effects preserve concurrent local work without pretending semantic changes are
  disjoint JSON patches.
- DM actions become immediate while peer actions remain consensual and auditable.
- Stable identities make retries and replay safe across HTTP, outbox, WebSocket, and reconnect boundaries.
- The client must retain operation watermarks and enough accepted/local state for deterministic recovery.
- Operation schemas become durable protocol and need explicit semantic versioning.
- Generic overlap UI remains necessary, but semantic events cannot be lost inside it.

## Rejected alternatives

- **Apply the remote result directly to live state:** it erases edits made since the accepted base.
- **Let ordinary path rebase handle operations:** same-path heal/damage/condition changes become false
  conflicts and invite whole-snapshot recovery.
- **Treat every retry as a new action:** duplicate damage/healing is unacceptable.
- **Require target approval for DM operations:** it defeats the adopted DM authority model.
- **Let DMs approve peer proposals:** a fresh DM command expresses the true actor and preserves the approval
  rule.
- **Let peers submit generic operations for approval:** consent cannot prove an actual ability/spell source,
  derive trusted effects, or make stale source/cost state valid.
- **Partially support unreserved peer source costs:** retries and concurrent proposals could double-spend actor
  resources; unsupported cost-bearing templates fail closed until atomic reservation exists.
- **Ignore operations while a conflict modal is open:** the later modal choice could silently undo canonical
  state.
