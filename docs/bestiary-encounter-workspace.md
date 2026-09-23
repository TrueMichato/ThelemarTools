# Encounter Workspace

The separate [Encounter Workspace](../encounterworkspace.html) starts with a **saved Bestiary pinned list**, not the current pins or an uploaded list. Open it from the Bestiary's control bar (or its Encounter Builder settings when active) or the Dungeon Master navigation menu, then choose a saved list. A working copy is stored in this browser; neither the saved Bestiary list nor the DM Screen NPC Manager roster is changed.

Each counted creature becomes its own instance with a stable ID. Scaled CR, spell-summon, and class-summon variants are resolved using the pinned list's custom hash before a statblock snapshot is copied for each instance. The snapshot stays unchanged even if the Bestiary source or saved list later changes. All targets start selected; the roster checkboxes and **All/None** controls save individual target selection. Reloading restores the working encounter and selection without looking up the original source again.

Choosing another saved list replaces the working copy only after confirmation (including when the current roster is empty). Missing homebrew, invalid scaling, and invalid counts are reported individually; available monsters still load. If no entries resolve, the encounter remains a named empty working copy with the load notices. The workspace does not write to Bestiary saved-list storage, and choosing or cancelling a list does not affect current pins.

To protect the browser from an unbounded roster, a saved list can materialize at most 1,000 instances. An entry that would exceed this limit is reported as omitted rather than partially materialized.

This first milestone only supports roster display, canonical compact statblocks, and target selection. Batch rolling, HP, conditions, Quick Actions, traits, lair actions, and modifier application are **not yet available**; the working-copy schema keeps source snapshots separate so these operations can be added to encounter instances in later work without changing Bestiary data.
