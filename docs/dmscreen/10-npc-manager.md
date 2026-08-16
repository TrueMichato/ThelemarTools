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

## State and serializer v4

The expanded state is:

```js
{
  version: 3,
  settings: {
    selectedId: null,
    isIncludeAllCreatures: false,
    isUnsortedCollapsed: false,
    textSize: "normal",
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
      spellSlots: {"1": {current: 3, max: 4}},
      charges: [{id: "wand", name: "Moon Wand", current: 5, max: 7, isAuto: true}],
      monster: {/* bestiary entity */},
      fluff: null,
    },
  ],
}
```

Serialized keys are `v`, `s:{sel,all,uc,ts}`, `g:[{id,n,c}]`, and `n:[{id,a,g,hp:{c,m,t},c,ss,ch,mon,fluff}]`. Spell slots use `ss:{level:{c,m}}`; charge trackers use `ch:[{id,n,c,m,a}]`, where `a` marks a statblock-derived tracker.

Membership lives on each NPC as `groupId`. This guarantees that duplicate instances of the same monster can be assigned independently and prevents one NPC from belonging to multiple groups. Deleting a group clears matching memberships; it never deletes NPCs.

Version 1 saves have no groups or memberships. Deserialization defaults them to `groups: []`, `groupId: null`, and an expanded Unsorted section. Invalid group records are dropped, duplicate group IDs are ignored after the first, and dangling NPC memberships are repaired to Unsorted.

Version 2 saves have no conditions. Serializer v3 defaults every migrated NPC to `conditions: []`. Condition names are normalized and deduplicated, but are not checked against a fixed parser list. This is intentional: an installed-brew condition must survive save/load even when that brew is temporarily unavailable.

Version 3 saves have no text-size or resource state. Serializer v4 defaults `textSize` to `normal`, derives full spell slots from `monster.spellcasting[].spells[level].slots`, and detects charged items from Special Equipment text. Saved current values are clamped to their maxima. Existing saves therefore gain usable trackers without losing HP, conditions, memberships, or selection.

## Site and homebrew reference data

The NPC Manager renders immediately with the parser's standard conditions and skills, then loads the complete site and installed-brew catalogs in the background:

- Conditions and statuses use `DataLoader.pCacheAndGetAllSite(UrlUtil.PG_CONDITIONS_DISEASES)` plus `pCacheAndGetAllBrew(...)`.
- Skills use the DataLoader `"skill"` page for the same site-plus-brew merge.

Condition and skill names are deduplicated case-insensitively. Condition duplicates use a modern-source preference: TGTT-family sources (`TGTT` and `TGTT-*`) win first, followed by XPHB, other sourced entries, PHB, and finally the parser's null-source fallback. This makes the picker and chip hover use installed Thelemar or 2024 rules text instead of silently retaining the first 2014 entry. Skill deduplication keeps its existing first-sourced behavior because skill UIDs and monster bonuses have separate source-sensitive resolution rules.

A completed load refreshes the roster and active workspace without changing selection or encounter state. If the user is editing a control, the refresh waits until focus leaves the NPC panel so an in-progress value is not reset.

Reference loading affects available choices only. It never participates in serialization, so missing or removed brew cannot erase a saved condition or an explicit monster skill.

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

The selected-NPC roleplay view exposes every site and installed-brew skill, not only entries listed in `monster.skill`. It also includes custom skills found directly in the monster's skill block, including `Name|SOURCE` keys exported by the Character Sheet.

Skill bonuses resolve in this order:

1. An exact `Name|SOURCE` bonus in `monster.skill`.
2. A matching bare-name bonus in `monster.skill`.
3. The governing ability modifier from the site/brew skill entity.
4. `+0` for an ad-hoc Lore skill that has no governing ability and no listed bonus.

Listed proficiencies are emphasized. The same descriptor and bonus path drives single-NPC and batch rolls, so custom skill labels never expose their raw UID and cannot drift between surfaces.

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
- Conditions come from the merged site and installed-brew catalog. Each roster row and selected-NPC header has a quick-add selector; active chips remove their condition in one click. Batch add/remove still operates on every selected NPC. All paths use `getNpcTrackerConditionsAfterUpdate()`, persist independently for duplicate instances, and render consistently in roster and detail views. A saved condition remains visible and removable even if its brew source is later removed.
- Catalog-backed condition chips use the standard Conditions & Diseases hover, including installed homebrew sources. A custom condition with no current catalog entity remains visible and removable but has no hover target.
- Standard mechanical conditions affect NPC Manager rolls. Poisoned and Frightened impose disadvantage on checks and attacks; Blinded, Restrained, Prone, and Invisible affect attacks; Restrained affects Dexterity saves; incapacitating conditions prevent attacks and can automatically fail Strength or Dexterity saves. Advantage and disadvantage cancel normally, and every affected result identifies the condition. Unknown homebrew conditions do not invent mechanics.
- A complete initiative batch can be appended to an existing Initiative Tracker. The handoff preserves each selected NPC's exact rolled total, alias and monster identity, current/maximum/temporary HP, and conditions. It respects the tracker lock and is intentionally a one-way snapshot; Initiative Tracker owns combat state after handoff.

## Roleplay and resource depth

- Special Equipment is normalized to the first Roleplay Traits entry, case-insensitively. Current bestiary data stores it as a trait; direct `specialEquipment` data is also accepted.
- Proficiency Bonus appears with the core abilities and saves. Explicit `pbNote` text wins; otherwise the value is derived from CR with `Parser.crToPb()`.
- Spellcasting NPCs receive level-by-level current/maximum slot controls. **Cast** spends one slot, **+1** restores one, and **Reset** restores the level to maximum.
- Special Equipment prose such as “the moon wand has 7 charges” seeds an item-charge tracker. DMs can spend, restore, reset, rename, resize, remove, or manually add trackers when the source prose is unstructured.

## Responsive behavior

Wide panels show the grouped roster and current detail/batch workspace side by side. Roster rows prioritize live-play controls: identity, HP, and conditions remain visible, while alias, group assignment, and removal live behind **Edit NPC**. The toolbar separates the primary **Add NPC** action from grouping, import, and encounter-wide controls.

The visual hierarchy uses tactical slate for structural chrome, warm parchment-toned content surfaces, blue for selection and interactive emphasis, and each condition's canonical color only for condition state. Selected roster rows, At-a-Glance statistics, resource controls, and Encounter Control have distinct surface depth without changing their order or behavior. Night mode uses dedicated high-contrast surfaces, borders, primary text, muted text, and state colors rather than reusing washed-out day values.

The toolbar also provides **A / A+** text sizing. The choice persists with the panel and increases the NPC Manager's information text without changing global site typography.

The detail workspace keeps identity, HP, conditions, and the roleplay/statblock switch in a persistent command header. Encounter Control follows the table workflow from targets to roll setup, results/initiative handoff, then reversible HP and condition actions.

At the panel container breakpoint, the roster and workspace become separate views; both NPC detail and batch results provide a **Roster** back action. Narrow controls stack without hiding core actions or collapsing HP values, while canonical statblocks use contained horizontal scrolling. The same hierarchy remains usable at a 300px panel width and with **A+** text enabled.

## Deferred work

- Drag-and-drop group or NPC ordering
- Encounter import/export
- Live two-way HP or condition synchronization with Initiative Tracker
