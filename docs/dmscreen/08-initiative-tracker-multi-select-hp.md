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

## Marker rows (forward-compat)

Rows with `entity._isMarker === true` are **never selectable** — no
checkbox is rendered and the shift-click range calculation skips them.
Introduced ahead of the automatic lair-actions PR (#1234) so
lair-action marker rows will drop in seamlessly when that lands.

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
| `js/utils-ui.js` `UiUtil.getStrNumericModified` | Pure delta-expression parser (extracted from `ComponentUiUtil._getIptNumeric`); returns `{mode, next, delta}`. Used by both the single-row HP input and the bulk bar. |
| `js/dmscreen/initiativetracker/dmscreen-initiativetracker.js` | Selection state (`_selectedRowIds`, `_lastSelectedRowId`), hooks (`_selectionHooks`), undo stack (`_hpApplyUndoStack`), API (`toggleRowSelection` / `clearSelection` / `_applyHpToSelection` / `_undoLastHpApply` / `_pruneSelection`), and the selection-bar render helper `_render_getWrpSelectionBar`. |
| `js/dmscreen/initiativetracker/dmscreen-initiativetracker-rowsbase.js` | Adds a `_pPopulateRow_selection` slot in the row skeleton (default no-op). |
| `js/dmscreen/initiativetracker/dmscreen-initiativetracker-rowsactive.js` | Overrides `_pPopulateRow_selection` to render the checkbox, wire click / shift-click, apply the `.dm-init__row--selected` class, and register/unregister the row-highlight hook. |
| `scss/includes/dmscreen-initiative-tracker.scss` | Styles for `.dm-init__wrp-selection-bar`, `.dm-init__wrp-row-checkbox`, `.dm-init__row-checkbox`, `.dm-init__row--selected`. |
| `test/jest/UiUtilGetStrNumericModified.test.js` | 14-case coverage of the delta parser. |

## Known non-goals

These were intentionally deferred:

- **Global tracker undo** — the scoped stack covers only bulk HP apply.
- **"Select All" button** — small selection sets don't need one.
- **Type-aware selection** (PCs vs monsters) — future.
- **Bulk conditions** (e.g. Prone-everyone) — future.
- **Per-row re-rolls** (each target rolls its own save/damage) — future.
