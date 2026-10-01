# Bestiary Quick Actions

Bestiary Quick Actions apply temporary, non-destructive changes to a creature statblock. The same override is visible in the Bestiary, DM Screen statblock panels, and the Initiative Tracker creature viewer.

## Workflow

Open the pencil button beside a creature's name to:

- convert the current statblock to or from a Flee, Mortals! Minion;
- add loaded Flee, Mortals! area traits individually or by environment;
- preview and attach lair actions from a loaded legendary group;
- apply a magic item's structured bonuses and editable Trait, Action, Bonus Action, or Reaction entries;
- edit core combat fields and statblock entry sections; or
- stack source-qualified creature templates or playable species, with an explicit before/after statblock preview.

The workspace lists each operation separately. Removing an operation rebuilds the creature from its source data and replays the remaining operations in order. Bestiary-only filter metadata is excluded from the editable statblock copy; the source entry and its filters remain untouched.

## Creature transformations

Open **Templates** in Bestiary Quick Actions or Encounter Workspace. **Templates** lists executable catalog recipes; **Species** lists playable site, prerelease, and installed-homebrew race/species recipes separately. These are not the static Bestiary `monsterTemplate` data. The source-book picker shows full book names and abbreviations when installed or known, with the source code as a fallback for unknown homebrew. Search instantly matches names, full source names, abbreviations, and codes; the result count and empty state reflect the chosen category and book. Select a source-qualified recipe from the filtered list. Different same-name, same-source species definitions are numbered variants rather than merged; versioned species also retain distinct IDs. Changing any filter clears an existing preview and Apply action. Options and acknowledgements remain only while the selected recipe still matches; hiding it clears the selection and details. The selected recipe's full source, code, edition, and verified page (or unverified status) remain in its details.

Choose all required options, acknowledge narrative prerequisites, and explicitly approve DM-gated candidates. The editor lists base and selected-option eligibility and manual-review items; the latter remain **DM tasks**, not automatically applied mechanics.

**Preview transformation** shows the current and proposed rendered statblocks plus a field/entry diff. Stacking recipes is supported; every overlapping change from an earlier recipe must have an explicit **keep existing** or **use incoming** decision before the Apply button is available. Confirm that the remaining manual-review tasks will be adjudicated separately. A recipe can contain only review tasks; a zero-diff preview does not claim its prose was mechanically applied. The source statblock stays untouched. Bestiary changes remain local overrides until you choose **Save to Homebrew**.

Loading a candidate list fails visibly if catalog, site races, prerelease, or homebrew cannot load. A stale history or changed candidate is rejected instead of applying an outdated preview.

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
- `js/bestiary/bestiary-creature-transformation.js` provides the pure, loader-free resolved-recipe preview/replay core. `bestiary-transformation-catalog-adapter.js` validates and translates the catalog's `op` changes to replay's `type` changes; never pass catalog steps directly to replay. `bestiary-transformation-workflow.js` previews individual targets and fences their history, and `bestiary-transformation-editor.js` renders the shared Bestiary/Encounter controls.
- The operation stores the resolved changes, selected options, provenance, prerequisite acknowledgements, conflict decisions, and manual-review items as plain data. Replay requires no catalog lookup; unsupported edits, ambiguous named entries, changed conflicts, and oversized payloads fail explicitly. Removing or reordering operations rebuilds from the immutable source and may require re-preview if a saved conflict decision no longer fits.
- Every base and selected-option eligibility clause must match the **current effective creature before each transformation**, not the original source chassis. Zero-foot speed grants are valid (they do not lower an existing speed), and optional damage replacements skip a missing named entry rather than rejecting an otherwise valid recipe. Resolved recipes and saved operation payloads must be JSON data; undefined properties are rejected rather than silently disappearing when history is serialized.
- `js/bestiary/bestiary-quick-actions-ui.js` owns the shared modal workflow.
- `scss/includes/bestiary-quick-actions.scss` contains shared Bestiary and DM Screen styles.
