# NPC Manager Relationship Tracking Design

## Status

Planning document for a later implementation round. This document proposes behavior and integration points; it does not describe an implemented feature.

The research baseline is NPC Manager serializer v3. A parallel round is adding spell-slot, charge, condition, and effect tracking, so implementation must use the next serializer version available after that work lands rather than assuming relationships will be v4.

## 1. Goal and scope

Relationship tracking should help a DM answer three questions quickly during play:

1. How does this NPC currently feel about the party or a particular player character?
2. How does this NPC feel about another NPC?
3. What happened to make that relationship change?

The feature is a **directional relationship ledger**, not a social simulation. "Magister Vale distrusts Kestrel" and "Kestrel respects Magister Vale" are separate records. Each record has a current disposition, lightweight tags, a current summary, and a chronological history of meaningful changes.

### Primary use cases

- Record one NPC's attitude toward the party as a whole.
- Record one NPC's distinct attitude toward an individual Party Tracker character.
- Record directional NPC-to-NPC loyalties, rivalries, debts, suspicions, and family ties.
- Change disposition during play and preserve why it changed.
- Find unresolved relationships after an NPC or PC is removed without losing campaign history.
- Review the campaign's relationship network from one NPC's detail view or a manager-wide ledger.

### Recommended disposition scale

Use a compact five-point scale:

| Value | Label | Meaning |
|---:|---|---|
| `-2` | Hostile | Actively opposed; likely to harm or obstruct |
| `-1` | Unfriendly | Distrustful, resentful, or reluctant |
| `0` | Indifferent | No meaningful positive or negative commitment |
| `1` | Friendly | Helpful, trusting, or personally warm |
| `2` | Allied | Strong commitment, loyalty, or shared cause |

The number is the persisted value; labels are presentation. Indicators must always include text and an icon or shape in addition to color. The scale is intentionally small enough for fast in-session changes and broad enough to show evolution.

Tags add nuance without turning disposition into a multi-axis rules engine. Examples include `owes a debt`, `family`, `rival`, `afraid`, `romantic`, `blackmail`, and `secret ally`.

### V1 non-goals

- No automatic disposition changes from rolls, damage, healing, conditions, faction membership, or encounter outcomes.
- No persuasion DC calculation, reaction roll, morale system, or mechanical bonuses.
- No inferred reciprocal relationship. The reverse direction is always explicit.
- No general-purpose faction, organization, location, deity, or item endpoints.
- No player-facing view or secret/public visibility model.
- No real-time collaboration or cross-device synchronization beyond normal DM Screen persistence.
- No graph physics, force-directed canvas, or drag-position persistence.
- No relationship import/export separate from the NPC Manager's existing panel state.
- No automatic deletion of relationship records when an endpoint disappears.

## 2. Existing architecture constraints

The proposal follows the current NPC Manager architecture documented in [10-npc-manager.md](./10-npc-manager.md):

- [`dmscreen-npctracker.js`](../../js/dmscreen/npctracker/dmscreen-npctracker.js) owns state, component callbacks, workspace mode, rendering, and persisted mutations. Every persisted mutation ends in `NpcTrackerRoot._doSave()` and `board.doSaveStateDebounced()`.
- [`dmscreen-npctracker-serial.js`](../../js/dmscreen/npctracker/dmscreen-npctracker-serial.js) normalizes both compressed and expanded input, provides backward-compatible defaults, and emits compressed state.
- [`dmscreen-npctracker-roster.js`](../../js/dmscreen/npctracker/dmscreen-npctracker-roster.js) owns the roster toolbar and grouped NPC list.
- [`dmscreen-npctracker-detail.js`](../../js/dmscreen/npctracker/dmscreen-npctracker-detail.js) owns the selected NPC's command header and roleplay/statblock views.
- NPC instances use `CryptUtil.uid()` IDs and are independent even when they share the same monster snapshot.
- Party Tracker characters expose their persisted `id` and current `name` through `PartyTracker.getCharacters()`, flattened by `DmScreenUtil.getPartyTrackerCharacters({board})`.
- Party Tracker emits `partyTrackerUpdate` after character changes. Journey Tracker demonstrates the intended cross-panel consumption pattern in `onBoardEvent({type})`.
- Rendering is imperative. Relationship mutations must re-render the affected detail or ledger surface explicitly.
- UI uses `ee` templates, `.onn()`, `.appendTo()`, `.empty()`, `.txt()`, or `textContent`. `.text()` must not be used.

Relationships should be a top-level state collection rather than a property on each NPC. This keeps campaign history independent from live-play state such as HP, conditions, effects, spell slots, and charges, and it allows records whose NPC subject has been removed to remain discoverable.

## 3. Proposed data model

### Expanded state

Add a top-level `relationships` array:

```js
{
  version: NEXT_VERSION,
  settings: { /* existing settings */ },
  groups: [ /* existing groups */ ],
  npcs: [ /* existing NPC instances and live-play state */ ],
  relationships: [
    {
      id: "relationship-id",
      subject: {
        kind: "npc",
        id: "npc-instance-id",
        label: "Magister Vale",
      },
      object: {
        kind: "pc",
        id: "party-tracker-character-id",
        label: "Kestrel",
      },
      disposition: -1,
      tags: ["owes a debt", "suspicious"],
      note: "Believes Kestrel concealed evidence.",
      history: [
        {
          id: "history-entry-id",
          at: "2026-08-16T13:00:00.000Z",
          note: "Kestrel refused to identify the courier.",
          from: 0,
          to: -1,
        },
      ],
    },
  ],
}
```

### Endpoint shape

An endpoint has:

- `kind`: `"npc"`, `"pc"`, or `"party"`.
- `id`: stable identity, not a display name.
- `label`: last-known display label, persisted as an orphan-safe snapshot.

NPC references use the NPC Manager roster instance ID. This is important because two independent copies of the same bestiary monster can have different relationships.

PC references use the Party Tracker character ID. Party Tracker preserves this ID through its serializer, while character renames only change the display name.

The party as a whole is a synthetic endpoint:

```js
{kind: "party", id: "party", label: "The Party"}
```

It is not computed from the current list of PCs and therefore remains stable when membership changes.

V1 should only create relationships whose subject is an NPC. The endpoint schema remains symmetric so later versions can support PC-authored attitudes or broader imports without a migration. V1 object endpoints may be the party, a PC, or another NPC.

### Relationship invariants

- A relationship is directed.
- V1 permits one record per directed `(subject kind, subject id, object kind, object id)` pair.
- Subject and object cannot identify the same endpoint.
- The reverse pair is independent.
- `disposition` is an integer from `-2` through `2`.
- Tags are trimmed, non-empty, deduplicated case-insensitively, and retain the first entered display casing.
- `note` is the current concise summary, not the full history.
- History is append-only through normal UI operations and ordered newest-first for display.
- A disposition change atomically updates `disposition` and appends a history entry with `from` and `to`.
- A note-only history entry may omit `from` and `to`.
- Timestamps are ISO 8601 UTC strings. V1 records the real-world edit time; in-world dates are deferred.

The UI should prevent duplicate pairs. Deserialization should not silently discard historical data from malformed duplicate pairs. If duplicates are encountered, retain them and mark the later records as conflicts in the ledger until the DM merges or removes one. Silent "first wins" behavior would violate the no-data-loss requirement.

### Compressed serialization

Follow the current serializer's short-key convention:

```js
{
  v: NEXT_VERSION,
  s: { /* existing settings */ },
  g: [ /* existing groups */ ],
  n: [ /* existing NPCs */ ],
  r: [
    {
      id: "relationship-id",
      s: {k: "npc", i: "npc-instance-id", l: "Magister Vale"},
      o: {k: "pc", i: "party-tracker-character-id", l: "Kestrel"},
      d: -1,
      t: ["owes a debt", "suspicious"],
      n: "Believes Kestrel concealed evidence.",
      h: [
        {
          id: "history-entry-id",
          at: "2026-08-16T13:00:00.000Z",
          n: "Kestrel refused to identify the courier.",
          f: 0,
          t: -1,
        },
      ],
    },
  ],
}
```

| Expanded field | Compressed key | Default |
|---|---|---|
| `relationships` | `r` | `[]` |
| `subject` | `s` | invalid relationship if absent |
| `object` | `o` | invalid relationship if absent |
| endpoint `kind` | `k` | no inferred kind |
| endpoint `id` | `i` | no inferred ID |
| endpoint `label` | `l` | kind-specific "Unknown..." label |
| `disposition` | `d` | `0` |
| `tags` | `t` | `[]` |
| `note` | `n` | `""` |
| `history` | `h` | `[]` |
| history `note` | `n` | `""` |
| history `from` | `f` | omitted |
| history `to` | `t` | omitted |

`NpcTrackerSerializer.deserialize()` must accept compressed and expanded keys, just as it does for settings, groups, and NPCs. Existing saves with no `r` or `relationships` property become `relationships: []`.

Serializer validation must be structural only. It may reject records that lack an ID or a structurally valid endpoint, normalize scalar values, and deduplicate tags, but it must **not** require an endpoint ID to resolve against current NPC or Party Tracker data. Resolution is runtime presentation, not persistence validation.

Implementation must bump `NpcTrackerSerializer.VERSION` from whatever version exists after the concurrent live-play work lands and add explicit migration tests from every then-supported earlier version.

## 4. Identity, resolution, and orphan handling

### Runtime resolution

Build endpoint lookup maps at render/reconciliation time:

- NPC map: `state.npcs` keyed by `npc.id`, with display name from `getNpcTrackerDisplayName(npc)`.
- PC map: `DmScreenUtil.getPartyTrackerCharacters({board})` keyed by character `id`, with current `name`.
- Party endpoint: the reserved synthetic endpoint.

Display resolution follows:

1. If the endpoint resolves, show the current display name.
2. If the current name differs from `endpoint.label`, update the snapshot through the controller and save only if it changed.
3. If it does not resolve, show the stored label and an explicit `Missing from NPC roster` or `Missing from Party Tracker` status.
4. Never drop a relationship or history entry because resolution failed.

This mirrors the NPC Manager's current condition/reference-data policy: saved values remain visible and removable even when their catalog entry is unavailable. Relationships take the same policy further by persisting a label snapshot alongside the stable ID.

### Renames

- NPC alias changes do not change relationship identity. The relationship resolves by NPC instance ID and refreshes its last-known label.
- PC name changes do not change relationship identity. `partyTrackerUpdate` triggers a refresh and updates the label snapshot only when the name changed.
- A rename must not append a relationship-history entry; it is endpoint metadata, not a change in attitude.

### Removals

- Removing an NPC does not cascade-delete relationships in which it is subject or object.
- Removing a PC from Party Tracker does not modify relationship records.
- Orphaned records remain visible in the manager-wide ledger and are counted in an `Unresolved` filter.
- The remove-NPC confirmation should state how many relationship records will become unresolved.
- Each unresolved endpoint offers **Relink**, which changes only that endpoint's kind/ID/label and preserves the relationship ID, disposition, tags, note, and history.
- A separate explicit **Delete relationship** action removes the record.

If relinking would create a duplicate directed pair, V1 should block the action and point to the existing relationship. Automatic merging is deferred until merge semantics are designed.

### Multiple Party Tracker panels

`DmScreenUtil.getPartyTrackerCharacters()` currently flattens all Party Tracker panels and exposes character IDs but not source-panel identity. `CryptUtil.uid()` collisions are unlikely, but imported state can duplicate an existing character ID.

V1 should:

- Resolve a PC ID only when it has zero or one match.
- Mark multiple matches as `Ambiguous Party Tracker reference`.
- Preserve and display the snapshot label rather than selecting an arbitrary match.

An optional future extension could return `{character, panelApp}` or another stable origin from `DmScreenUtil`, but V1 should not invent a panel identity that the board does not currently expose.

## 5. UX proposal

The interaction mode is **Operate**: the DM is often mid-session, scanning under time pressure. The UI should prioritize fast recognition, direct edits, compact density, and recoverable history over decorative network visualization.

### 5.1 NPC detail: Relationships section

In the roleplay view, place **Relationships** after **At a glance** and before **Skills**. It is roleplay context, not canonical monster data, so it should not appear inside the full statblock.

The section has:

- An **Add relationship** primary action.
- **Feels toward**: outgoing relationships where the selected NPC is the subject.
- **Felt by others**: incoming NPC relationships, visually secondary and read-only in place, with a jump-to-NPC action.
- A compact count and unresolved warning.

Each relationship row shows:

- Target name and endpoint type (`Party`, `PC`, or `NPC`).
- Disposition pill with label plus icon/shape.
- Up to two tags, then a `+N` overflow indicator.
- Current note, clamped to two lines when collapsed.
- Latest history timestamp.
- Expand/collapse control with `aria-expanded`.

Expanded editing includes:

- Five disposition choices in logical order from Hostile to Allied.
- Tag editor.
- Current-summary textarea.
- **Add history note** field.
- Reverse-chronological timeline.
- Relink and delete actions, with destructive actions visually separated.

Disposition changes should be low-friction. Selecting a new disposition immediately opens a small optional `What changed?` field. Saving appends either the DM's reason or a generated entry such as `Disposition changed from Indifferent to Friendly.` The timeline should never contain a silent numeric transition.

### 5.2 Add relationship flow

From an NPC detail:

1. Click **Add relationship**.
2. Choose target from three grouped options: **The Party**, **Player Characters**, and **NPCs**.
3. Choose initial disposition.
4. Optionally add tags and a summary.
5. Save.

The selected NPC is the subject, so V1 does not ask for a subject. The target picker excludes the subject NPC and any target that already has an outgoing relationship from this subject. Empty groups explain how to populate them, for example `Add a Party Tracker panel to reference player characters.`

Creating a relationship appends an initial history entry with the selected disposition and optional reason.

### 5.3 Manager-wide relationship ledger

V1 needs a global ledger because relationships with a removed subject would otherwise be inaccessible. Add a **Relationships** action to the roster toolbar. It opens a third workspace mode alongside the current detail and batch modes.

The ledger is a scan-friendly list, not a matrix:

- Search by current or snapshot endpoint name, tag, or note.
- Filter by disposition, endpoint type, and resolved/unresolved state.
- Group by subject NPC by default.
- Show both endpoints with a directional arrow and a full text equivalent for assistive technology.
- Selecting a resolved NPC opens its detail relationship section.
- Unresolved records remain fully editable, relinkable, and deletable.

Example:

```text
Relationships (12)     [Search...] [Disposition] [Unresolved]

Magister Vale
  Vale -> The Party       Unfriendly   suspicious, blackmail
  Vale -> Kestrel         Friendly     owes a debt

Missing NPC: Old Jory
  Old Jory -> Vale        Hostile      rival               [Relink]
```

### 5.4 Matrix and graph

The matrix is a V2 overview, not the V1 editing surface:

- Rows are subject NPCs.
- Columns are the party, PCs, and a user-selected subset of NPCs.
- Cells show the five-state disposition and open the relationship editor.
- Row and column headers remain visible while scrolling.
- Empty cells create a relationship.
- The ledger remains available as the accessible and narrow-panel alternative.

A node-link graph is stretch work only. Dense campaign graphs become unreadable quickly, graph navigation is difficult by keyboard, and a force-directed canvas is a poor fit for narrow DM Screen tiles. If implemented, it should be a read-mostly exploration view with filters and a synchronized text ledger, never the only editing surface.

### 5.5 Visual and responsive behavior

- Reuse `.dm-npc__section`, neutral surfaces, selected blue, and existing form controls.
- Reserve color for disposition meaning; do not add decorative gradients or relationship-type colors.
- Encode disposition with text plus a stable icon/shape. Color alone is insufficient.
- Keep negative, neutral, and positive colors contrast-safe in both themes. Hostile and Unfriendly must remain distinguishable without relying on two similar reds.
- Use tabular numerals only for counts, not prose.
- Preserve visible `:focus-visible` states and keyboard access to every row, disclosure, disposition choice, filter, relink, and delete action.
- Announce successful create/update/relink/delete operations through the project's toast pattern; use `aria-live` for filter result counts.
- At the existing `640px` container breakpoint, roster and workspace remain separate views and both ledger and relationship detail provide a **Roster** back action.
- At `320px`, filters and editors stack to full width. The V1 ledger never requires horizontal scrolling.
- Timeline entries wrap naturally; metadata and action buttons must not squeeze note text below a readable width.
- Night-mode rules belong in the existing `.ve-night-mode` block in `dmscreen-npc-tracker.scss`.
- Respect `prefers-reduced-motion`; disclosure and status changes need no decorative animation.

## 6. Integration points and board events

### Party Tracker

Add `NpcTracker.onBoardEvent({type})`, following Journey Tracker's pattern:

```text
partyTrackerUpdate
  -> NpcTrackerRoot reconciles PC endpoint labels/resolution
  -> save only if a persisted label snapshot changed
  -> re-render the visible relationship surface
```

Initial rendering should also read `DmScreenUtil.getPartyTrackerCharacters({board})` so references resolve even before an update event occurs.

Party Tracker remains the source of PC identity and names. Relationship state remains owned entirely by NPC Manager; no relationship data is written into Party Tracker characters.

### NPC Manager mutations

All relationship mutations should be controller-owned:

```text
Relationship UI callback
  -> NpcTrackerRoot validates and mutates state
  -> re-render detail/ledger as needed
  -> NpcTrackerRoot._doSave()
  -> board.doSaveStateDebounced()
```

Pure normalization, endpoint resolution, filtering, and mutation helpers should live outside DOM classes so Jest can cover them directly.

V1 does not need to emit a new board event because no other panel consumes relationships. Adding an unused event would create an API without a consumer or contract. If another panel later needs relationship state, add a deliberate `npcTrackerRelationshipsUpdate` event and a `DmScreenUtil` accessor in the same phase, with payload and lifecycle tests.

### Coexistence with live-play depth work

The concurrent NPC Manager work adds resources and active effects to each NPC. Relationships should layer cleanly by:

- Storing records in top-level `relationships`, never inside NPC combat/resource fields.
- Keeping the detail command header focused on identity, HP, conditions/effects, and live resources.
- Rendering relationship context in the scrollable roleplay body.
- Not changing batch-roll, encounter-action, HP undo, initiative handoff, spell-slot, charge, condition, or effect behavior.
- Rebasing serializer changes onto the concurrent branch and using its final version number and NPC shape.
- Keeping relationship helpers and UI in dedicated modules to reduce churn in the already-growing root and detail files.

## 7. Phased implementation plan

### V1: minimal, shippable relationship ledger

**Behavior**

- NPC subject to party, PC, or NPC object.
- Five-point disposition, freeform tags, current summary, and timestamped history.
- Selected-NPC detail section with outgoing and incoming records.
- Manager-wide list ledger with search and unresolved filter.
- Party Tracker name synchronization.
- Explicit orphan display, relink, and delete.
- Backward-compatible persistence.

**File-level touch points**

| File | Change |
|---|---|
| `js/dmscreen/npctracker/dmscreen-npctracker-serial.js` | Add top-level relationships, compressed keys, normalization, defaults, and migration version |
| `js/dmscreen/npctracker/dmscreen-npctracker-relationship.js` | New DOM-free endpoint, disposition, mutation, resolution, filter, and conflict helpers |
| `js/dmscreen/npctracker/dmscreen-npctracker-relationships.js` | New ledger/editor renderer and add/relink flows |
| `js/dmscreen/npctracker/dmscreen-npctracker.js` | Own callbacks and mutations, add relationships workspace mode, consume `partyTrackerUpdate`, reconcile snapshots, preserve orphans on NPC removal |
| `js/dmscreen/npctracker/dmscreen-npctracker-detail.js` | Render selected-NPC incoming/outgoing section in roleplay view |
| `js/dmscreen/npctracker/dmscreen-npctracker-roster.js` | Add Relationships workspace action and unresolved/count summary |
| `scss/includes/dmscreen-npc-tracker.scss` | Add relationship rows, disposition states, filters, editor, timeline, responsive, focus, and night-mode rules |
| `test/jest/DmScreenNpcTracker.test.js` | Add serializer, migration, mutation, resolution, orphan, ambiguity, and filtering tests |
| `test/jest/dmscreen/DmScreenNpcTrackerUx.test.js` | Add UI-model and interaction-contract tests consistent with existing NPC Manager coverage |
| `docs/dmscreen/10-npc-manager.md` | After implementation, document final state shape, workflow, persistence, and responsive behavior |
| `docs/dmscreen/11-npc-relationships-design.md` | Update status and record any accepted deviations from this proposal |

`js/dmscreen/dmscreen-util.js` should not need a V1 change unless implementation chooses to expose Party Tracker origin metadata.

### V2: campaign-scale overview

**Behavior**

- Accessible matrix for rapid cross-cast scanning and cell editing.
- Saved filters and tag suggestions from existing relationship data.
- Optional in-world date text on history entries.
- Conflict-resolution flow for malformed duplicate directed pairs.
- Bulk tag and disposition operations with explicit confirmation.
- Optional endpoint categories beyond party/PC/NPC only after a separate data-model decision.

**Likely file changes**

- Extend `dmscreen-npctracker-relationships.js` with matrix/list modes.
- Extend `dmscreen-npctracker-relationship.js` with matrix projection and conflict merge helpers.
- Add matrix responsive and sticky-header rules to `dmscreen-npc-tracker.scss`.
- Add pure projection/merge tests and browser checks for keyboard cell navigation.
- Update `docs/dmscreen/10-npc-manager.md` and this decision record.

### Stretch: relationship exploration

**Behavior**

- Filtered node-link graph synchronized with the text ledger.
- Optional faction/organization endpoints.
- Timeline export for session recaps.
- Relationship change hooks from other panels only when explicitly configured by the DM.
- User-defined disposition labels while preserving numeric ordering.

**Likely file changes**

- A dedicated `dmscreen-npctracker-relationship-graph.js` rather than adding graph logic to the ledger renderer.
- A tested pure graph-projection helper.
- Reduced-motion, keyboard, screen-reader summary, and high-density fallback behavior.
- New board-event/API documentation if other panels become consumers or producers.

## 8. Testing strategy

### Automated Jest coverage

1. Round-trip the complete relationship shape through compressed serialization.
2. Migrate all prior serializer versions to `relationships: []`.
3. Preserve unresolved NPC and PC endpoints and their label snapshots.
4. Preserve malformed duplicate directed pairs as visible conflicts.
5. Normalize disposition, tags, notes, timestamps, and history defaults without silent data loss.
6. Keep opposite-direction records independent.
7. Reject self-links and block duplicate creation/relinking.
8. Atomically update disposition and append the expected history event.
9. Resolve NPC aliases and PC renames by stable ID.
10. Detect missing and ambiguous Party Tracker IDs.
11. Filter by name snapshot/current name, tag, disposition, endpoint kind, and orphan status.
12. Removing an NPC leaves relationships intact.
13. `partyTrackerUpdate` re-renders and saves only when a snapshot actually changed.

### Manual browser verification

- Create party-, PC-, and NPC-target relationships and reload the DM Screen.
- Rename both endpoints and verify identity/history remain stable.
- Remove and restore/relink endpoints and verify no history is lost.
- Exercise incoming/outgoing detail sections and the global ledger.
- Verify empty Party Tracker, multiple Party Trackers, duplicate PC IDs, and large casts.
- Verify keyboard-only add, edit, disclosure, filter, relink, and delete flows.
- Verify day and night modes at wide, `640px`, `320px`, and approximately `220px` panel widths.
- Verify disposition remains understandable with color removed.
- Verify relationship UI does not reset active NPC live-play fields or interfere with batch/initiative work.

### Implementation gates

- Run targeted NPC Manager Jest suites.
- Run `node --check` for changed JavaScript modules.
- Build `scss/dmscreen.scss` to `css/dmscreen.css`.
- Complete browser verification on `dmscreen.html`.

## 9. Open questions and risks

These decisions should be confirmed before implementation:

1. **Disposition vocabulary:** Accept the recommended Hostile / Unfriendly / Indifferent / Friendly / Allied scale, or use more setting-neutral labels?
2. **V1 subject scope:** Keep subjects NPC-only as recommended, or allow PC subjects immediately?
3. **Party endpoint:** Keep one synthetic `The Party` target, or support named parties? Named parties require identity and membership ownership beyond current Party Tracker contracts.
4. **History time:** Is real-world edit time sufficient for V1, or must the DM enter an in-world campaign date from the start?
5. **Tags:** Keep freeform tags with suggestions from prior entries, or define a controlled campaign taxonomy?
6. **Removal UX:** Is preserving orphans with an explicit warning the desired default, or should NPC removal offer a second, explicit `also delete relationships` option?
7. **Multiple Party Trackers:** Is ambiguous-ID detection sufficient, or should `DmScreenUtil` expose stable source-panel metadata before relationships ship?
8. **Global ledger scope:** Should V1 include all records as recommended, or only orphaned records plus the selected-NPC section?
9. **Matrix priority:** Is the V2 matrix valuable enough to design for immediately, or should filtering and timeline tools take priority?
10. **Reciprocity:** Should adding an NPC-to-NPC relationship offer an optional shortcut to create the reverse record, while still keeping both records independent?
11. **In-world secrecy:** Will a future player-facing surface require per-relationship visibility, or can the data remain DM-only indefinitely?

The highest technical risk is reference identity across multiple Party Tracker panels. The highest UX risk is overloading an active-play panel with a visually impressive but slow graph. Stable IDs plus snapshot labels, a compact detail section, and an accessible list ledger keep V1 reliable while leaving room for richer campaign-scale views later.
