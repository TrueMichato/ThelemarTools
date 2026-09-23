# Encounter Workspace

The separate [Encounter Workspace](../encounterworkspace.html) starts with a **saved Bestiary pinned list**, not the current pins or an uploaded list. Open it from the Bestiary's control bar (or its Encounter Builder settings when active) or the Dungeon Master navigation menu, then choose a saved list. A working copy is stored in this browser; neither the saved Bestiary list nor the DM Screen NPC Manager roster is changed.

Each counted creature becomes its own instance with a stable ID. Scaled CR, spell-summon, and class-summon variants are resolved using the pinned list's custom hash before a statblock snapshot is copied for each instance. The snapshot stays unchanged even if the Bestiary source or saved list later changes. All targets start selected; the roster checkboxes and **All/None** controls save individual target selection. Reloading restores the working encounter and selection without looking up the original source again.

Choosing another saved list replaces the working copy only after confirmation (including when the current roster is empty). Missing homebrew, invalid scaling, and invalid counts are reported individually; available monsters still load. If no entries resolve, the encounter remains a named empty working copy with the load notices. The workspace does not write to Bestiary saved-list storage, and choosing or cancelling a list does not affect current pins.

To protect the browser from an unbounded roster, a saved list can materialize at most 1,000 instances. An entry that would exceed this limit is reported as omitted rather than partially materialized.

## Rolls and conditions

Above the roster, choose an **ability check**, **saving throw**, or **skill check**, then an ability/skill and Normal, Advantage, or Disadvantage. **Roll selected** rolls once for each selected instance through the site's dice roller and displays each monster's die, bonus, total, and roll effect. Saving throws and skills use explicit monster bonuses where present, otherwise their governing ability modifier; installed skill definitions contribute their governing ability when available. Duplicate monsters are listed and rolled independently. Cancelling a roll or receiving an invalid dice result produces a failure row, not a made-up total; other selected monsters still complete.

**Conditions** applies/removes a chosen condition on the selected instances only. Each statblock shows its own removable condition chips, and the roster summarizes them. The picker uses site conditions and installed homebrew where available; conditions already in an encounter remain visible and removable if their source later disappears. Hover a known chip for its definition. Normal 5e condition effects supported by the NPC Manager apply to these checks and saves: Poisoned and Frightened disadvantage on checks (including skills), Restrained disadvantage on Dexterity saves, and automatic failure of Strength and Dexterity saves for Paralyzed, Stunned, Unconscious, and Petrified. A chosen advantage and condition disadvantage cancel (and vice versa); the result explains why. Conditional effects are shown with the NPC Manager's assumptions, such as Frightened's source being in sight. No custom homebrew mechanics are inferred from condition text.

Conditions and target selection are saved only on the encounter instances; the frozen monster snapshots and saved Bestiary list remain unchanged. Foundation v1 encounters load as v2 with empty condition lists until conditions are added. Rolls/results are transient, not persisted. Replacing the working encounter loses its local conditions after confirmation.

HP tracking, attacks and initiative, Quick Actions, area traits, lair actions, and custom modifiers are deferred to the next milestone.
