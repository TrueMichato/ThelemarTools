---
target: Overview Ranger panel, Overview Metamagic panel, Druid Resources modal
total_score: 33
p0_count: 0
p1_count: 0
timestamp: 2026-07-25T21-41-26Z
slug: charactersheet-class-resource-panels
previous: 2026-07-25T17-59-02Z__charactersheet-class-resource-panels.md
---
## Design Health Score

Re-critique after the remediation pass planned in `plan.md` (WP1–WP8). Same harness,
same three surfaces, same fixtures (`ranger/hunter/9`, `sorcerer/draconic/9`,
`druid/zodiac/9`), measured at 1400×900 and 390×844 in **both** themes.

| # | Heuristic | Was | Now | What changed |
|---|-----------|-----|-----|--------------|
| 1 | Visibility of System Status | 2 | 4 | `Wild Shape 2 / 2` renders correctly (`ve-flex-h-between` → `ve-split-v-center`); Metamagic descriptions are **247px** wide in the 265px Overview column, up from 23px |
| 2 | Match System / Real World | 3 | 4 | All 12 constellation summaries rewritten with consistent action-cost prefixes and real numbers ("Reaction: reduce damage to an ally within 30 ft.") |
| 3 | User Control and Freedom | 1 | 4 | Zodiac spend is behind a confirm naming form + cost; mobile modal is fully scrollable (last card bottom 773px vs tab-bar top 791px) |
| 4 | Consistency and Standards | 1 | 4 | One button vocabulary (`.cs-combat-btn` verb variants) across all three surfaces; Tune moved `--heal` → `--spend`; Zodiac cards have a real stylesheet rule, no inline `style` |
| 5 | Error Prevention | 1 | 4 | Confirm dialog + `_isSelectingZodiac` re-entrancy guard + post-await `canSpendWildShapeUse` re-check + already-active short-circuit |
| 6 | Recognition Rather Than Recall | 2 | 4 | No truncated text anywhere; Hunter's Prey copy now points at the flow that can actually change it |
| 7 | Flexibility and Efficiency | 2 | 3 | `:focus-within` parity added; row-dimming removed so keyboard users never *lose* contrast in the first place. Still no filter on the 12-card grid |
| 8 | Aesthetic and Minimalist Design | 1 | 3 | Ranger panel 1,378px → **821px** via `<details>` disclosure + removing the 7 repeated `✦ Passive` badges; Druid modal has three visibly recessed sections |
| 9 | Error Recovery | 2 | 3 | Still no undo for a spent use — but the mis-spend it protected against can no longer happen silently |
| 10 | Help and Documentation | 3 | 4 | Hover rules text survives (now un-nested from the `<button>`); two new named rules in DESIGN.md; the three silent-failure CSS traps documented in the architecture reference |
| **Total** | | **18/40** | **33/40** | **Good — no P0s, no P1s remain** |

## What Was Fixed

**P0 — Metamagic descriptions unreadable in the Overview column.** The dashboard renders
from one code path onto three tabs and silently assumed Combat's 510px width. Fixed with
the new **Container-Adaptive Rule**: `.cs-adaptive-panel` (`container-type: inline-size`)
plus an `@container cs-panel (max-width: 380px)` two-row grid, so the description spans the
full panel beneath the identity/action row. `text-overflow: ellipsis` + `overflow: hidden`
deleted unconditionally from `.charsheet__mm-desc` — they cannot fire on a wrapping element,
they only clip. Measured: **23/68/104/34px → 247px on all four rows**; Combat at 510px is
unchanged (`display: flex`, rows 30–44px).

**P0 — `Wild Shape2 / 2`.** `ve-flex-h-between` does not exist in the codebase (only
`-h-center` and `-h-right` are defined). All 7 usages swapped to `ve-split-v-center`.

**P1 — Zodiac mis-tap spends a Wild Shape use.** `_pSelectZodiacForm` is now async and
mirrors the sibling `_pTransformWildShapeFree` pattern exactly. Verified live: cancel →
2/2 unchanged and zero `aria-pressed="true"`; confirm → 1/2, exactly one active card,
`aria-pressed="true"` on exactly one; re-clicking the active card → no second prompt, no
second spend. The hover link moved out of the `<button>`, which let the
`closest(".ve-help-subtle")` escape hatch be deleted from all three handlers that carried it.

**P1 — dead design tokens.** The site defines only six `--rgb-*` properties and they use
*double-hyphen* modifiers. Every single-hyphen character-sheet reference (~540 of them,
~100 the sole source for their declaration) was silently dropping its whole declaration.
Fixed with one scoped alias block on `body.is-charsheet-page` rather than 100 edits.

**P1 — off-vocabulary colour.** Primal Focus selected state `ve-btn-danger` → indigo
`--selected`; `+1d6 dmg` `badge-outline-danger` → `badge-outline-secondary`; Tune
`--heal` → `--spend`; all radius fallbacks realigned to the DESIGN.md scale.

**P2 — mobile tab bar occluding the modal.** An 11-step `--cs-z-*` semantic scale now backs
every character-sheet `z-index`, and the tab bar publishes `--cs-tabbar-height` (with
`env(safe-area-inset-bottom)`) which the modal scroller pads by — chosen over re-stacking
`.ve-ui-modal__inner`, which is site-wide shared chrome.

## Found During Verification (not in the original critique)

Three real defects surfaced only once the earlier fixes made the surfaces measurable:

1. **Row-dimming broke AA at rest.** `.charsheet__mm-row--available` / `--active-info`
   carried `opacity: 0.75` / `0.65`, dragging every text token inside them from 5.86:1
   down to 3.96:1 / 3.34:1 in night mode — under AA at rest, recoverable only by hovering.
   State was already encoded three other ways (group heading, `○` vs `◆`, Tune/Detune), so
   the opacity was a fourth, redundant signal that cost legibility. Removed; de-emphasis is
   now carried by the recessed surface + hairline, which brighten on hover *and* focus.
2. **`--cs-warning-text` / `--cs-success-text` / `--cs-danger-text` were never defined.**
   `.cs-combat-btn--spend` fell back to `--cs-warning`, which is tuned to read as a *fill*
   on white; as text on its own tint it lands at **4.04:1** at 12px. Defined the three
   ink-on-tint variants in the day token block (`#92400e` → 5.7:1). Night is unaffected —
   the tokens are day-only, so the previously-verified night values are untouched.
3. **`ve-muted ve-small` on the Metamagic group note** computed to 10.2px at 3.96:1.
   `ve-muted` is `!important` inside `@layer vetools` and cannot be overridden from a
   character-sheet stylesheet, so the class was dropped in the JS and replaced with
   `.charsheet__mm-group-note` (12px, `--cs-text-secondary`).

## Verification Evidence

- **Contrast**: alpha-composited probe with cumulative ancestor opacity, disabled controls
  excluded (WCAG 1.4.3 exempt). **0 failures** on all three surfaces × both themes ×
  Overview/Combat hosts. Also 0 elements under 12px in the Druid modal.
- **Geometry**: Ranger panel 821px (was 1,378px), all 7 ability names on one line
  (`nameH` 23px — "Focused Quarry" no longer breaks mid-word). Metamagic descriptions 247px
  compact / 238–349px wide. Druid modal: 3 sections, 12 cards, 0 nested interactive elements.
- **Mobile 390×844**: last Zodiac card bottom 773px, tab bar top 791px — 18px clearance.
- **Tests**: `421 suites / 12,475 tests` green, including a new
  `CharacterSheetZodiacConfirmSpend.test.js` (15 tests: confirm/cancel/re-entrancy/
  zero-uses/`aria-pressed`/copy assertions).
- **`detect.mjs`**: 1,278 findings across the six touched files, **all pre-existing**. The
  11 `side-tab` hits are the documented owner exception (content-section identity rainbow);
  the `layout-transition` hits are progress bars and disclosures; the `design-system-font`
  hits are the user-selectable accessibility fonts and code monos. The 244 radius advisories
  are noise from an **empty `rounded` scale in `.impeccable/design.json`** — the sidecar is
  stale relative to DESIGN.md and flags `var(--cs-radius-sm, 6px)` fallbacks that *are* the
  documented 6px. Refreshing the sidecar (`/impeccable document`) is a separate task; it
  would rewrite DESIGN.md, which this pass treats as the source of truth.

## Residual (logged, not blocking)

- **No in-panel Hunter's Prey selector.** `setHuntersPreyOption` still has exactly one
  caller, in `charactersheet-rest.js`. The panel now says so honestly instead of stating a
  rule the UI can't perform. A real selector is a feature, deliberately kept out of a
  design pass. Recorded in `docs/charactersheet/10-known-limitations.md`.
- **No undo for a spent Wild Shape use** (heuristic 9 capped at 3). The confirm dialog
  prevents the mis-spend rather than refunding it; a real undo needs resource-history
  plumbing that doesn't exist.
- **No filter on the 12-card Zodiac grid** (heuristic 7 capped at 3). Twelve is browsable;
  a filter would be chrome for a set this size.
- **Two `10000`/`10001` z-index outliers** remain in `charactersheet.css`, documented as
  follow-up under the Layer-Scale Rule.
- **`.ve-flex-h-between` still doesn't exist site-wide.** Adding it to
  `scss/includes/util.scss` needs a full site CSS rebuild; the trap is documented instead.
- **Ranger badge wrap.** On the one row carrying two badges ("Focused Quarry": Bonus Action
  + `+1d6 dmg`), the second badge wraps within its grid column and reads slightly indented
  against the note below. Giving badges a dedicated full-width row fixes the alignment but
  costs ~56px of panel height across 7 rows — not worth it for chrome.

## Overall Impression

The two hard breakages are gone and the three drift items are back on the documented
language. More importantly, the two failure *modes* are now named rules rather than
one-off fixes: a panel that can be hosted in more than one column responds to its
container (never its host tab), and stacking reads from a semantic scale where a fixed
layer owes clearance to what it covers. Both are in DESIGN.md; the three silent-failure
CSS traps that caused most of the drift — undefined `--rgb-*` tokens, the phantom
`ve-flex-h-between`, and layered-vs-unlayered `!important` — are in the architecture
reference where the next person will hit them.

What keeps this at 33 rather than higher is honest: there is still no way to undo a spent
resource, and Hunter's Prey remains rest-flow-only. Both are features, not polish, and
both are logged.
