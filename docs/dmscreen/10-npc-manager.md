# NPC Manager

The NPC Manager is DM Screen panel type 26. It keeps independent NPC instances in a session roster, provides roleplay-focused details and full statblocks, and supports persistent groups with batch d20 rolling.

## Architecture

| File | Role |
|---|---|
| `js/dmscreen/npctracker/dmscreen-npctracker.js` | Panel app, root controller, persisted mutations, workspace mode |
| `js/dmscreen/npctracker/dmscreen-npctracker-serial.js` | Versioned state, migration, group deletion helper |
| `js/dmscreen/npctracker/dmscreen-npctracker-roster.js` | Add/import toolbar, grouped roster, assignment controls |
| `js/dmscreen/npctracker/dmscreen-npctracker-detail.js` | Roleplay view, compact canonical statblock, all single-NPC rolls |
| `js/dmscreen/npctracker/dmscreen-npctracker-roll.js` | Shared d20 roll, bonus resolution, scope and sort helpers |
| `js/dmscreen/npctracker/dmscreen-npctracker-batch.js` | Batch configuration and results workspace |
| `scss/includes/dmscreen-npc-tracker.scss` | Panel, group, detail, batch, responsive, and night-mode styles |

`NpcTrackerRoot` owns state and wires the roster, detail, and batch components through callbacks. Every persisted mutation ends at `_doSave()` and `board.doSaveStateDebounced()`. Batch configuration and results are intentionally in-memory; each underlying roll is retained by the normal dice roll log.

## State and serializer v3

The expanded state is:

```js
{
  version: 3,
  settings: {
    selectedId: null,
    isIncludeAllCreatures: false,
    isUnsortedCollapsed: false,
  },
  groups: [
    {id: "group-id", name: "Town Council", isCollapsed: false},
  ],
  npcs: [
    {
      id: "npc-id",
      alias: "Magister Vale",
      groupId: "group-id",
      hp: {current: 27, max: 27, temp: 0},
      conditions: ["poisoned"],
      monster: {/* bestiary entity */},
      fluff: null,
    },
  ],
}
```

Serialized keys are `v`, `s:{sel,all,uc}`, `g:[{id,n,c}]`, and `n:[{id,a,g,hp:{c,m,t},c,mon,fluff}]`.

Membership lives on each NPC as `groupId`. This guarantees that duplicate instances of the same monster can be assigned independently and prevents one NPC from belonging to multiple groups. Deleting a group clears matching memberships; it never deletes NPCs.

Version 1 saves have no groups or memberships. Deserialization defaults them to `groups: []`, `groupId: null`, and an expanded Unsorted section. Invalid group records are dropped, duplicate group IDs are ignored after the first, and dangling NPC memberships are repaired to Unsorted.

Version 2 saves have no conditions. Serializer v3 defaults every migrated NPC to `conditions: []`; invalid and duplicate condition names are repaired against `Parser.CONDITIONS`.

## Group workflow

- **New Group** creates a named section.
- Group headers show a member count and controls to collapse, batch roll, rename, or delete.
- **Unsorted** is implicit and cannot be renamed or deleted.
- Each NPC row has a group selector. Moving a row updates only that NPC instance.
- Named-group and Unsorted collapse states persist across panel reloads.
- Empty named groups remain visible so NPCs can be assigned to them.

Group array order is creation order. NPCs retain their global roster order within each section. Drag-and-drop ordering is not part of this version.

## Batch rolling

Batch rolling is available from every non-empty group, Unsorted, and **Roll All**. It opens a dedicated workspace without changing the persisted roster.

Supported rolls:

| Roll | Bonus |
|---|---|
| Initiative | `Renderer.monster.getInitiativeBonusNumber({mon})` |
| Ability check | Governing ability modifier |
| Saving throw | Explicit `monster.save[ability]`, otherwise ability modifier |
| Skill check | Explicit `monster.skill[skill]`, otherwise governing ability modifier |

The selected-NPC roleplay view exposes every standard skill, not only entries listed in `monster.skill`. Listed proficiencies are emphasized; unlisted skills remain rollable and use the governing ability modifier through the same `getNpcTrackerRollBonus()` path as batch rolls.

Every NPC is rolled sequentially through:

```js
Renderer.dice.pRoll2(`1d20${signedBonus}`, {
  isUser: false,
  name: npcDisplayName,
  label,
}, {isResultUsed: true});
```

This produces one normal roll-log entry per NPC and returns the total for the combined results table. The displayed die face is `total - bonus`. Cancelled or non-numeric rolls are omitted and reported; no result row is fabricated.

Initiative results default to total descending with roster-order tie-breaking. Ability, save, and skill results initially preserve roster order. Name and Total headers can re-sort the table, and **Roll Again** repeats the current configuration.

## Statblock and encounter control

**Full statblock** uses the same compact `Renderer.monster.getCompactRenderedString()` table structure as the DM Screen creature viewer. The canonical `.ve-stats` table preserves 5etools statblock typography and behavior, and scrolls horizontally rather than overlapping content when a tile is narrower than the statblock's readable minimum.

Every batch scope is also an encounter-operations workspace. Scope members begin selected and can be toggled independently before rolling or applying a mutation.

Encounter Control presents roll type, governing ability/skill, and the primary Roll action first. Target selection is available from a compact disclosure. Results and Initiative Tracker handoff appear immediately after rolling; secondary HP and condition operations live together under **Encounter actions** so they remain available without pushing results below the fold.

- HP expressions accept damage (`30` or `-30`), healing (`+12`), absolute values (`=15`), and dice (`8d6`). The optional **Half** toggle rounds toward zero using the Initiative Tracker's shared rule. Damage consumes temporary HP before current HP, and healing is capped at maximum HP.
- The last five batch HP operations are available to the session-only **Undo HP** stack. The roster state itself still saves after every apply or undo.
- Standard conditions come from `Parser.CONDITIONS`. Each roster row and selected-NPC header has a quick-add selector; active chips remove their condition in one click. Batch add/remove still operates on every selected NPC. All paths use `getNpcTrackerConditionsAfterUpdate()`, persist independently for duplicate instances, and render consistently in roster and detail views.
- A complete initiative batch can be appended to an existing Initiative Tracker. The handoff preserves each selected NPC's exact rolled total, alias and monster identity, current/maximum/temporary HP, and conditions. It respects the tracker lock and is intentionally a one-way snapshot; Initiative Tracker owns combat state after handoff.

## Responsive behavior

Wide panels show the grouped roster and current detail/batch workspace side by side. At the panel container breakpoint, the roster and workspace become separate views; both NPC detail and batch results provide a **Roster** back action. Narrow controls stack without collapsing HP values, while canonical statblocks use contained horizontal scrolling. Night mode uses the same neutral surfaces, selected blue, borders, focus states, and form controls as other DM Screen panels.

## Deferred work

- Drag-and-drop group or NPC ordering
- Encounter import/export
- Live two-way HP or condition synchronization with Initiative Tracker
