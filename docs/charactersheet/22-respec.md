# Respec Workspace

The Respec tab is a transaction-based progression editor. It reconstructs the
opportunities a character should have received at each level, including choices
which were skipped or never recorded, and applies changes only after the entire
draft is valid.

## Architecture

Three layers divide discovery, mutation, and presentation:

| Layer | File | Responsibility |
|---|---|---|
| Progression contract | `charactersheet-progression.js` | Builds the level-by-level decision manifest, assigns stable semantic keys, normalizes legacy history, validates selections, and projects decisions back to compatibility `choices`. |
| Transaction engine | `charactersheet-respec-engine.js` | Clones the live state, owns the candidate manifest, validates the draft, computes the review summary, applies atomically, rolls back failed saves, and retains one undo snapshot. |
| Workspace UI | `charactersheet-respec.js` | Renders the timeline and attention states, opens decision editors, performs candidate-only mechanics, and exposes Cancel, Review, Apply, and Undo. |

The live `CharacterSheetState` is never used as the editing surface. Opening
Respec creates a candidate from `state.toJson()`. All controls target that
candidate until Apply succeeds. An untouched candidate refreshes if the live
character changes before editing begins; a dirty candidate is never replaced
silently.

## Progression Manifest and Ledger

`levelHistory` remains the chronological source of class assignment, but each
entry now carries a versioned `decisions` ledger in addition to the compatibility
`choices` object.

Each decision records:

- its character level and class level;
- the decision family and source feature;
- the required selection count;
- the current selection;
- one of `resolved`, `deferred`, `missing`, `invalid`, or `ambiguous`;
- a semantic key which excludes character level.

Excluding character level from the semantic key is intentional. If the order of
two class levels changes, a choice follows the class-level opportunity which
created it instead of remaining attached to the old character-level row.

The manifest is rebuilt from the loaded class, subclass, optional-feature, feat,
spell, and skill catalogs. A required opportunity appears even when the old
history has no corresponding property. This is how skipped skills, tools,
languages, expertise, spell picks, subclasses, ASIs, feats, and other deferred
choices become repairable.

Legal option catalogs exist only on the in-memory manifest. They are re-derived
when Respec opens and are not serialized into `levelHistory`, preventing full
spell, feat, and feature entities from inflating character saves.

## Legacy Reconstruction

Old saves are normalized on load.

- Exact recorded history becomes a resolved decision.
- A uniquely reconstructable state value may be attached to its opportunity.
- Uncertain values remain `ambiguous`; Respec does not invent a historical
  choice.
- Values with no recorded progression source are preserved rather than removed.

The compatibility `choices` object is regenerated from decisions so existing
level removal, summary, and replay code continues to operate while modules
migrate to the ledger. Choice families which a manifest version does not
rediscover are retained rather than erased.

Legacy detection is structural: a character is legacy only when chronological
level rows are missing. Missing or ambiguous decisions are Respec validation
states, not evidence that a recorded level never existed.

## Ownership and Overlap

Progression-controlled proficiencies and spells use
`state.progressionOwnership`. Each value can have multiple decision sources, and
unattributed imported/manual values are marked `preserved`.

When an editor changes a choice, it detaches only that decision's source. The
mechanical value is removed only when no other progression source or preserved
origin remains. This prevents changing a class skill, tool, language, expertise,
or spell from deleting the same value when a species, background, feature,
another class level, or manual edit still supplies it.

## Historical Class Changes

Every level has a Class decision. Changing it rebuilds the candidate's:

- class totals and chronological primary class;
- first-class and multiclass proficiencies;
- class and subclass features;
- hit dice, hit points, spell slots, and class resources;
- later decision opportunities.

Choices are retained by semantic key when still legal. Choices whose opportunity
disappears are removed from the ledger, and choices which no longer satisfy the
new option set become `invalid`. Entering a new class also checks multiclass
prerequisites against the ability scores which existed at that historical level,
before later recorded ASIs.

Starting equipment and ordinary inventory are not reconstructed by a class
change. Inventory, notes, identity, layout, favorites, custom data, and other
non-progression state remain attached to the candidate.

## Apply, Cancel, and Undo

- **Cancel** discards the candidate without touching the live character.
- **Review** lists staged decision/base changes and all blocking decisions.
- **Apply** validates first, loads the candidate into the live state, persists it,
  and rolls back the live snapshot if persistence fails. If another sheet tab
  changed the live character after the draft opened, Apply refuses to overwrite
  those newer changes.
- **Undo** restores the snapshot from immediately before the last successful
  Apply. Starting another edit consumes that undo opportunity.

Apply is disabled while any required decision is missing, invalid, or ambiguous,
or while an optional decision contains an invalid/ambiguous selection.

## Spell Decisions

Permanent spell acquisition is progression-owned:

- Wizard cantrips and spellbook additions;
- known-caster spell and cantrip gains;
- permanent prepared-spell progression used by supported 2024/homebrew classes;
- Spell Mastery and Signature Spells;
- optional known-spell replacements.

Wizard daily preparation and other freely replaceable runtime loadouts are not
progression decisions. Legal spell options are filtered by class/subclass list
and by the maximum spell level available at the acquisition level.

## Tests

Focused Jest contracts live in:

- `CharacterSheetProgressionManifest.test.js`
- `CharacterSheetRespecEngine.test.js`
- `CharacterSheetRespecWorkspace.test.js`
- the existing `CharacterSheetRespec*.test.js` regression suites

`test/e2e/specs/respec-workspace.spec.ts` exercises a skipped first-level choice
through the rendered UI and verifies candidate isolation, Cancel, Apply, Undo,
and the narrow-screen toolbar.
