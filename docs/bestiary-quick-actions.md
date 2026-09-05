# Bestiary Quick Actions

Bestiary Quick Actions apply temporary, non-destructive changes to a creature statblock. The same override is visible in the Bestiary, DM Screen statblock panels, and the Initiative Tracker creature viewer.

## Workflow

Open the pencil button beside a creature's name to:

- convert the current statblock to or from a Flee, Mortals! Minion;
- add loaded Flee, Mortals! area traits individually or by environment;
- preview and attach lair actions from a loaded legendary group;
- apply a magic item's structured bonuses and editable Trait, Action, Bonus Action, or Reaction entries; or
- edit core combat fields and statblock entry sections.

The workspace lists each operation separately. Removing an operation rebuilds the creature from its source data and replays the remaining operations in order.

Area traits use an explicit Flee, Mortals! mechanics catalog. Representable effects such as defenses, condition immunities, speeds, senses, size and Hit Dice changes, granted bonus actions, and melee damage riders update the statblock; prose-only effects remain rendered rules. Choice-bearing traits request all required options before a single or environment-wide add.

Flee, Mortals! `PB` expressions in applied traits and lair actions resolve against the creature's final proficiency bonus. This includes fixed DCs, `PBdN` damage, numeric PB bonuses, and PB multiplication.

Magic items always appear as hoverable links under one **Special Equipment** trait. Their rule blocks are automatically classified and remain editable before applying. Activated AC and speed changes preserve the base value and add a labeled alternate state instead of permanently replacing it.

## Guided Quick Edit

Quick Edit has two synchronized modes for complex statblock sections:

- **Guided** provides spellcasting trait cards with display location, casting ability, header/footer entries, frequency and spell-level groups, reordering, and rendered previews. Legendary and mythic cards provide introduction text, action counts, legendary action costs, reordering, and previews.
- **Advanced JSON** exposes the complete `trait`, `action`, `bonus`, `reaction`, `legendary`, `mythic`, and `spellcasting` arrays. It remains the lossless fallback for unusual nested entries or fields that the guided controls do not own.

Switching from Advanced JSON back to Guided mode requires every editor to contain a valid JSON array. Invalid content remains in place with an inline error and never overwrites the last valid guided draft.

## Minion reference

The Minion action explains exactly what conversion changes in the statblock and includes a collapsed encounter reference for shared turns, the Minion trait, overkill attacks, group attacks, and the optional group-saving-throw and tough-minion rules. Initiative grouping and encounter procedures remain manual; the converter changes only the displayed creature.

Standard area-trait, lair-action, and magic-item hover windows are elevated above Quick Actions while its modal is open. Closing the modal restores the site's normal hover layering.

## Lifetime and identity

Overrides live only in `BESTIARY_QUICK_ACTIONS_REGISTRY`. They are not written to URLs, data-loader caches, DM Screen state, or local storage, and a page refresh clears them.

Registry keys use `name|source` plus a scaling context. Base, scaled-CR, spell-summon-level, and class-summon-level statblocks therefore have independent overrides.

## Saving to homebrew

**Save to Homebrew** materializes the currently displayed override as a clean monster copy in an editable homebrew source. The user chooses the source and name and can overwrite a matching editable creature or save a uniquely named copy. PB-resolved lair actions are saved as a companion legendary group. Saving never changes the source creature.

On the Bestiary page, a saved creature is inserted into the current list immediately. Other already-open creature catalogs show a persistent success message explaining that they must be refreshed before the saved copy appears.

## Implementation

- `js/bestiary/bestiary-quick-actions-engine.js` owns immutable operation replay and the in-memory registry.
- `js/bestiary/bestiary-quick-actions-ui.js` owns the shared modal workflow.
- `scss/includes/bestiary-quick-actions.scss` contains shared Bestiary and DM Screen styles.
