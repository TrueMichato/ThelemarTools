# NPC Manager

The NPC Manager is DM Screen panel type 26. It keeps independent NPC instances in a session roster, provides roleplay-focused details and full statblocks, and supports persistent groups with batch d20 rolling.

## Architecture

| File | Role |
|---|---|
| `js/dmscreen/npctracker/dmscreen-npctracker.js` | Panel app, root controller, persisted mutations, workspace mode |
| `js/dmscreen/npctracker/dmscreen-npctracker-serial.js` | Versioned state, migration, group deletion helper |
| `js/dmscreen/npctracker/dmscreen-npctracker-roster.js` | Add/import toolbar, grouped roster, assignment controls |
| `js/dmscreen/npctracker/dmscreen-npctracker-detail.js` | Roleplay view, statblock view, single-NPC rolls |
| `js/dmscreen/npctracker/dmscreen-npctracker-roll.js` | Shared d20 roll, bonus resolution, scope and sort helpers |
| `js/dmscreen/npctracker/dmscreen-npctracker-batch.js` | Batch configuration and results workspace |
| `scss/includes/dmscreen-npc-tracker.scss` | Panel, group, detail, batch, responsive, and night-mode styles |

`NpcTrackerRoot` owns state and wires the roster, detail, and batch components through callbacks. Every persisted mutation ends at `_doSave()` and `board.doSaveStateDebounced()`. Batch configuration and results are intentionally in-memory; each underlying roll is retained by the normal dice roll log.

## State and serializer v2

The expanded state is:

```js
{
  version: 2,
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
      monster: {/* bestiary entity */},
      fluff: null,
    },
  ],
}
```

Serialized keys are `v`, `s:{sel,all,uc}`, `g:[{id,n,c}]`, and `n:[{id,a,g,hp:{c,m,t},mon,fluff}]`.

Membership lives on each NPC as `groupId`. This guarantees that duplicate instances of the same monster can be assigned independently and prevents one NPC from belonging to multiple groups. Deleting a group clears matching memberships; it never deletes NPCs.

Version 1 saves have no groups or memberships. Deserialization defaults them to `groups: []`, `groupId: null`, and an expanded Unsorted section. Invalid group records are dropped, duplicate group IDs are ignored after the first, and dangling NPC memberships are repaired to Unsorted.

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

## Responsive behavior

Wide panels show the grouped roster and current detail/batch workspace side by side. At the existing 520px container breakpoint, the roster and workspace become separate views; both NPC detail and batch results provide a **Roster** back action. Night mode uses the same neutral surfaces, selected blue, borders, and form controls as other DM Screen panels.

## Deferred work

- Batch HP and conditions
- Drag-and-drop group or NPC ordering
- Encounter import/export
- Sending batch initiative directly to Initiative Tracker
