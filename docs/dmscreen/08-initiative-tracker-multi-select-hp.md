# Initiative Tracker — Multi-Select Bulk HP

**Feature**: apply one HP expression to many selected rows at once
(the classic "Fireball hits everyone" workflow).

**Tracker issue**: [5ET-tracker 1232](5ET-tracker 1232) (5ET-1140).

## User workflow

1. Tick the checkbox on the left of any active tracker row.
2. Extend the selection with **Shift + click** — selects the inclusive
   range from the previously-clicked row to the just-clicked row, in the
   currently-visible sort order.
3. Once at least one row is selected, the **bulk-HP bar** appears at the
   top of the tracker with a live "Selected: N" count.
4. Type an HP expression, optionally tick **½** for save-for-half damage,
   and press **Enter** or click **Apply**.
5. Every selected row's `hpCurrent` is updated in a single state
   mutation (one save, one network sync).
6. An **Undo** button appears after each apply and restores the previous
   HP values for the affected rows (stack depth 5, session-scoped).
7. **✕** clears the selection without changing HP.

## Expression grammar in the bulk bar

The bulk bar reuses `UiUtil.getStrNumericModified` — the same parser
that drives the single-row HP input — with **one deliberate divergence**:

| Input           | Bulk-bar behaviour                                    | Single-row behaviour             |
|-----------------|-------------------------------------------------------|----------------------------------|
| `30`            | Damage 30 (bare N is treated as `-30`)                | Set to 30                        |
| `+12`           | Heal 12                                               | Heal 12                          |
| `-6`            | Damage 6                                              | Damage 6                         |
| `=15`           | Set to 15                                             | Set to 15                        |
| `-1d6+2` / `8d6`| Roll once, apply the shared magnitude to each row     | Roll once, apply to this row     |

The divergence is intentional — DMs narrating a Fireball type "30"
(the damage roll) and expect it to hurt everyone, not overwrite their
HP totals. The placeholder text and input tooltip document this.

### Half damage (½ checkbox)

When enabled and the expression evaluates to a numeric delta, the
magnitude is halved with `Math.floor(|delta| / 2)` (5e "damage on save
is halved, round down"). The sign is preserved. Ignored for `=X`.

### Dice are rolled once

For dice expressions like `-2d6+1`, the roll happens **once** at apply
time and the same numeric result is applied to every selected row.
Matches the "one Fireball, one damage roll" mental model. Per-row
re-rolls (independent saves) are a future enhancement.

## Selection state

- Selection is **DM-only, non-persisted, in-memory**. It never enters
  localStorage, never enters the player view, and is not sent to
  networked clients.
- Selection survives scroll and re-render but is cleared implicitly
  when a selected row is removed (delete, reset, import replaces rows).
- The `Undo` stack lives on the same `InitiativeTracker` instance and
  is also non-persisted. Cap = 5 entries.

## Marker rows — shared allow-list (forward-compat)

Rows that represent **non-combatant markers** (lair actions,
environmental effects, future fog / hazard / timer markers, etc.) are
excluded from bulk HP apply — no checkbox is rendered and the
shift-click range calculation skips them.

Selection features route the check through a single shared predicate
so new marker types compose without touching every feature:

```js
import {InitiativeTrackerRowUtil} from "./dmscreen-initiativetracker-consts.js";

if (!InitiativeTrackerRowUtil.isNonCombatantRow(row)) { /* apply */ }
```

**Extending the allow-list.** The predicate iterates
`InitiativeTrackerRowUtil.NON_COMBATANT_FLAGS`, a small array of
`row.entity.*` boolean flag names. To introduce a new marker type
(fog banks, condition markers, environmental hazards), push the flag
name onto this list and add the corresponding boolean field to the
new marker's row entity. **No changes needed** in the multi-select
code or any other consumer of `isNonCombatantRow`.

**Naming convention:** use `is*Marker` so the flag reads clearly in
serialised state.

**Canonical entries today:**

| Flag                 | Introduced by                                         |
|----------------------|-------------------------------------------------------|
| `isLairMarker`       | Automatic lair-actions (tracker #1141, branch `truemichato-auto-lair-actions`) — declared in `dmscreen-initiativetracker-lairmarkers.js` |

## Half-damage rule (5e)

The **½** checkbox routes through `InitiativeTrackerRowUtil.getHalvedDelta(delta)`:

- Floor of `|delta| / 2`, sign preserved (works for healing halves too).
- **1 halves to 0** — 5e's "damage on save is halved, round down"
  (PHB p.196) has no minimum-1 rule. The minimum-1 rule applies only to
  resistance/vulnerability doubling and to the base damage of certain
  attacks, not to save-for-half. If your table houserules "minimum 1
  damage on save", extend the helper.
- Ignored for `=X` (absolute set).

## Interaction with tracker lock

The checkbox, expression input, Half toggle, and Apply/Undo buttons
all carry the `.dm-init-lockable` class — locking the tracker
(padlock button) disables them alongside every other editable input.
The bar itself remains visible so the DM can see what was selected
when they locked.

## 0-HP / dying handling

Bulk apply produces the same per-row `hpCurrent` change a single-row
edit would, so the tracker's existing wound-color hook
(`InitiativeTrackerUtil.getWoundLevel`) and 0-HP handling fire
normally per row. HP is not clamped by the bulk apply — negative HP
is allowed (mirrors single-row behaviour and supports the bloodied /
dying tracking DMs already rely on).

## Code map

| File | Role |
|---|---|
| `js/dmscreen/panels/initiativetracker/dmscreen-initiativetracker-consts.js` | `InitiativeTrackerRowUtil.isNonCombatantRow(row)` shared marker predicate + `getHalvedDelta(delta)` 5e save-for-half helper. Consumed by both this PR and (transitively) any future PR that operates on combatant rows. |
| `js/utils-ui.js` `UiUtil.getStrNumericModified` | Pure delta-expression parser (extracted from `ComponentUiUtil._getIptNumeric`); returns `{mode, next, delta}`. Used by both the single-row HP input and the bulk bar. |
| `js/dmscreen/panels/initiativetracker/dmscreen-initiativetracker.js` | Selection state (`_selectedRowIds`, `_lastSelectedRowId`), hooks (`_selectionHooks`), undo stack (`_hpApplyUndoStack`), API (`toggleRowSelection` / `clearSelection` / `_applyHpToSelection` / `_undoLastHpApply` / `_pruneSelection`), and the selection-bar render helper `_render_getWrpSelectionBar`. |
| `js/dmscreen/panels/initiativetracker/dmscreen-initiativetracker-rowsbase.js` | Adds a `_pPopulateRow_selection` slot in the row skeleton (default no-op). |
| `js/dmscreen/panels/initiativetracker/dmscreen-initiativetracker-rowsactive.js` | Overrides `_pPopulateRow_selection` to render the checkbox, wire click / shift-click, apply the `.dm-init__row--selected` class, and register/unregister the row-highlight hook. |
| `scss/includes/dmscreen-initiative-tracker.scss` | Styles for `.dm-init__wrp-selection-bar`, `.dm-init__wrp-row-checkbox`, `.dm-init__row-checkbox`, `.dm-init__row--selected`. |
| `test/jest/UiUtilGetStrNumericModified.test.js` | Parser + `getHalvedDelta` + `isNonCombatantRow` coverage. |

## Known non-goals

These were intentionally deferred:

- **Global tracker undo** — the scoped stack covers only bulk HP apply.
- **"Select All" button** — small selection sets don't need one.
- **Type-aware selection** (PCs vs monsters) — future.
- **Bulk conditions** (e.g. Prone-everyone) — future.
- **Per-row re-rolls** — each target rolling its own save-for-half or its
  own damage die is the natural next step; today's design rolls once and
  shares the result. Opt-in "roll per row" toggle is planned as a
  follow-up.
- **Minimum-1 damage on save** — not applied. See the half-damage
  section; extend `getHalvedDelta` if your table houserules it.
