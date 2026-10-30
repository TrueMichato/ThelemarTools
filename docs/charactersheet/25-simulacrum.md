# Companion fast play and Simulacrum

The Companions tab and Play Mode's **More > Companions** drawer are for
running companions at the table, not maintaining a second character sheet.
All companion records remain visible together. Cards put identity, HP,
defenses, availability, and damage/healing controls before reference material.
Feature companions retain their specialized commands, ferocity, lifecycle
controls, and diagnostics.

## Shared direct rolls

The same native controls provide Initiative, all six saving throws, skills,
ability checks, Normal/Advantage/Disadvantage, and supported attacks and local
damage. Unsupported or missing statistics are explicitly unavailable. Use the
statblock for unsupported manual actions.

Ordinary companions use their own exact/scaled statistics. Actor-backed
duplicates use their current isolated passive effects, never the owner's
current statistics. Optional class resources, conditional bonuses, rerolls,
and additional attack riders still require manual adjudication.

An attack uses the existing companion Action transaction. Checks and damage
rolls are read-only: they do not spend the owner's resources or advance an
actor revision. Critical damage doubles every dice group, not flat bonuses;
a fixed 1-damage attack remains 1.

Grouped cards show living/total counts and aggregate HP first. **Individual
creatures** is a native keyboard-accessible disclosure with per-creature
healing and damage. Bulk controls remain outside that disclosure. Rolls are
for one creature, not a simultaneous group attack, and the Action gate belongs
to the companion record. Play Mode uses the same grouped controls rather than
an unrelated scalar HP editor.

Feature setup and provenance are available under **Setup and provenance**.
Commands and actionable diagnostics remain outside that disclosure.

## Running a Simulacrum

Choose **Manage / cast** on its card. The manager starts with HP, AC, edition,
turn availability, and immediate management controls. Casting occupies the
main desktop column; direct rolls and utility trackers occupy the adjacent
column. On narrow screens these become one document. **Cast**, **Rolls**, and
**Manage** jump to the same sections rather than switching hidden tabs.

The casting area contains slot totals, the supported-effect target, a
spell-name/source search, learned spells, and innate/feature spells. Ordinary
and Pact slots of the same level remain separate explicit choices. Prepared
status, rituals, Metamagic, Font of Magic, conditions, concentration, feature
resources, and eligible rest controls retain their existing handlers.
**Rules and manual resolution** and **Full statblock** are secondary
disclosures; they do not replace supported actions.

Read-only rolls leave the casting selectors and their DOM nodes intact.
After a mutating action rebuilds the manager, it restores the chosen target,
spell/pool selections, search, open disclosures, scroll position, and keyed
keyboard focus. A selection which has become unavailable is retained as a
disabled placeholder with a visible message; casting requires a valid
replacement instead of silently choosing another pool or target. These
preferences are transient UI state, not additions to the save schema.

## Authority and recovery

`actorSnapshot` version 1 remains authoritative. Its copied statistics are
immutable with respect to later owner changes. The manager calls the existing
isolated actor runtime and its revision-guarded commit/rollback bridge; it
never substitutes the owner's State. Creation, payment, replacement, casting
costs, persistence, repair, and rest policy are unchanged.

- **PHB:** no spell-slot or Pact-slot recovery. Eligible non-slot resources
  can recover through the existing rest controls. HP requires paid laboratory
  repair.
- **XPHB:** no Short/Long Rest or casting Simulacrum. Paid repair is staged
  during the owner's Long Rest and requires the duplicate within 5 feet.
- **Destroyed/melted:** inspect the statblock or dismiss the record; acting,
  recovery, and repair are unavailable.
- **Invalid snapshot:** show the existing diagnostic/recovery path. Never
  fabricate an actor from the currently selected owner.

Multiple duplicates and other companions remain independent. Switching
characters or changing/removing an actor invalidates stale controls rather
than redirecting their callbacks to a different character.

## Maintenance surfaces

- `charactersheet.js`: card composition, feature provenance markup, grouped
  controls, shared direct-roll UI and turn summary.
- `charactersheet-simulacrum.js`: shared duplicate card and manager presentation.
- `charactersheet-playmode.js`: companion drawer delegation and ordinary
  companion presentation. The tools menu is unchanged.
- Companion-scoped blocks in `charactersheet.css`,
  `charactersheet-mobile.css`, and `charactersheet-modern.css`.
- `CharacterSheetCompanionRolls`, `CharacterSheetSimulacrumUi`,
  `CharacterSheetCompanions`, and the Simulacrum Playwright workflow cover
  the shared controls, actor isolation, persistence, and view-state retention.
