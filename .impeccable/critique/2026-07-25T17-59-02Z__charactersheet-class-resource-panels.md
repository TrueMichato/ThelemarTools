---
target: Overview Ranger panel, Overview Metamagic panel, Druid Resources modal
total_score: 18
p0_count: 2
p1_count: 3
timestamp: 2026-07-25T17-59-02Z
slug: charactersheet-class-resource-panels
---
## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 2 | `Wild Shape2 / 2` — the count is glued to its label; Metamagic descriptions render 3 chars wide in the Overview |
| 2 | Match System / Real World | 3 | Good D&D vocabulary + a genuine Tune/Detune gloss; "Roll floor 8 on Perception/Stealth/Acrobatics" is opaque |
| 3 | User Control and Freedom | 1 | One click on any of 12 Zodiac cards spends a Wild Shape use, no confirm/undo; mobile tab bar (z 1050) covers the bottom 59px of the modal (z 1001) |
| 4 | Consistency and Standards | 1 | Three button vocabularies in one modal; Tune (a *spend*) uses the emerald `--heal` variant; Zodiac cards are `#222` on a `#1e293b` surface |
| 5 | Error Prevention | 1 | Zodiac selection is irreversible and undifferentiated across a 12-target grid |
| 6 | Recognition Rather Than Recall | 2 | Truncated Metamagic text forces recall; Hunter's Prey names the rule but offers no path to change it |
| 7 | Flexibility and Efficiency | 2 | Dimmed rows only recover contrast on `:hover` — no `:focus-within`; no filter on the 12-card grid |
| 8 | Aesthetic and Minimalist Design | 1 | 1,378px Ranger wall of full-brightness prose; one-word-per-line Metamagic columns; invisible section containers |
| 9 | Error Recovery | 2 | Failure toasts are good; no undo for a mis-spent resource |
| 10 | Help and Documentation | 3 | Hover statblocks, cost tooltips, plain-language Tune gloss — genuinely strong |
| **Total** | | **18/40** | **Poor — these three surfaces need real work (the rest of the sheet scores far higher)** |

## Anti-Patterns Verdict

**LLM assessment.** Not AI slop in aesthetic — the sheet has a real, committed voice. The failure mode here is the *product* failure mode: **strangeness without purpose**. Components built for a 510px column were dropped into a 265px column with no responsive fallback, and three surfaces each invented their own control vocabulary instead of using the documented one.

**Deterministic scan.** `detect.mjs` on `css/charactersheet.css` returns 1,154 findings (892 `design-system-color`, 231 `design-system-radius`, 12 `layout-transition`, 11 `side-tab`, 7 `design-system-font`). Scoped to the three targets:
- Metamagic (L18600–18900): `#ef4444` ×2 (documented ruby is `#f26161`), `rgba(139,92,246,.08)`, `border-radius: 4px` ×3 (documented `sm` is 6px).
- Ranger (L9240–9480): `#777`, `#ef4444` ×2, `rgba(127,127,127,.08)`, `border-radius: 8px` / `0.25rem`.
- Druid (L9490–9560): `border-radius: 8px`, `rgba(0,0,0,.3)`.
- `js/charactersheet/charactersheet-druid-resources.js` scans clean (0 findings) — the module's problems are structural, not literal-color drift, so the detector can't see them.
- The 11 `side-tab` hits are the documented owner exception (content-section identity rainbow) — false positives by design.

**Browser evidence.** Live inspection at 1400px and 390px on spawned `ranger/hunter/9`, `sorcerer/draconic/9`, `druid/zodiac/9`. No overlay injection was used; findings come from computed-style and geometry probes plus screenshots.

## Overall Impression

Two of these three surfaces are broken, not merely unpolished. The Metamagic panel in the Overview column renders its descriptions **23px wide** — a vertical stack of ellipsised word-fragments (`C… / cr… / a… / su… / on`). The Ranger panel breaks "Focused Quarry" mid-word into `Focuse / d / Quarry`. The Druid modal prints `Wild Shape2 / 2` because it uses a CSS class that **does not exist in the codebase**.

The single biggest opportunity: **every one of these is a container-width or token-resolution failure, not a taste problem.** The same Metamagic component looks excellent on the Combat tab (rows 30–44px tall, descriptions 238–349px wide). The design intent is right; the components just have no defence when the container shrinks or a token is missing.

## What's Working

1. **The Metamagic dashboard on the Combat tab is genuinely good.** Tuned / Available / Active grouping, a single-line `● name · cost · description · action` grammar, a plain-language "Tune a passive metamagic to keep it active…" gloss that teaches TGTT-specific vocabulary without a tooltip. This is the reference implementation the other two should be measured against.
2. **Deferred resource spend on Wild Shape.** `_pTransformWildShapeFree` and `_pAddKnownForm` spend a use *only after* the picker resolves, guarded by `_isTransforming` / `_isSummoning` re-entrancy flags. That is careful, correct interaction design — and it makes the Zodiac grid's instant, unguarded spend look like an oversight rather than a decision.
3. **Hover-linked names everywhere.** `buildInlineEntriesHoverLink` / `buildCreatureHoverNameHtml` mean every ability, beast, and constellation carries its full rules text on hover without leaving the sheet. Excellent progressive disclosure — and the reason a lot of the inline prose is redundant.

## Priority Issues

### [P0] Metamagic descriptions are unreadable in the Overview column

`.charsheet__mm-row` is `display:flex; flex-wrap:wrap` with `.charsheet__mm-desc { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis }`. `.charsheet__mm-name` is `white-space:nowrap`, so name + cost + Tune button consume the row and the description gets whatever is left.

Measured in the Overview (row width 265px):

| Metamagic | desc width | row height |
|---|---|---|
| Careful Spell | **23px** | 130px |
| Lingering Spell | **34px** | 181px |
| Empowered Spell | 68px | 111px |
| Subtle Spell | 104px | 61px |

Same component on the Combat tab (row width 510px): 238–349px wide, 30–44px tall. `text-overflow: ellipsis` only collapses a single nowrap line — here it wraps per word and clips each one, producing `C… / cr… / a… / su… / on / s… / sa…`.

**Why it matters:** the panel's entire job is telling a sorcerer what each metamagic does before they spend points. It communicates nothing. Worse, the same dashboard is rendered on three tabs (`_getMetamagicDashboardTargets`) and only the Overview instance is broken, so the player sees the working version elsewhere and assumes theirs is corrupted.

**Fix:** give `.charsheet__mm-row` a container query (or a `--compact` modifier the Overview target passes) that switches to a two-line grid — `indicator | name + cost | button` on row 1, description spanning row 2 — below ~380px. Drop `text-overflow: ellipsis` entirely; it cannot work on a wrapping element. Better still: in a 265px column, render the description on hover/expand only and keep the row to one line.

**Suggested command:** `/impeccable adapt js/charactersheet/charactersheet-combat.js` (Metamagic dashboard)

### [P0] `ve-flex-h-between` does not exist — the Druid modal's labels are jammed

Every count in the modal renders as `Wild Shape2 / 2` and `Known Forms0 / 8`. Computed `justify-content` on those rows is `normal`.

`grep -rn "ve-flex-h-between" js/` returns **7 hits, all in `charactersheet-druid-resources.js`**. The codebase defines `.ve-flex-h-center` and `.ve-flex-h-right` (`scss/includes/util.scss:738,743`) — there is no `-between` utility. All seven are silent no-ops.

**Why it matters:** it's the first thing a player reads in the modal, and it reads like a rendering bug. It also means the Zodiac "Dismiss" button and the Known-Forms counter never right-align as designed.

**Fix:** either add `.ve-flex-h-between { justify-content: space-between }` to `scss/includes/util.scss` alongside its siblings, or replace the seven usages with the existing `ve-split-v-center` (which the modal header itself already uses and which does exactly this).

**Suggested command:** `/impeccable polish js/charactersheet/charactersheet-druid-resources.js`

### [P1] Two Ranger CSS declarations silently do nothing, so the panel is a 1,378px wall of undifferentiated prose

The Ranger Overview panel measures **1,378px tall in a 316px column** — pure text, no chunking, no collapse. Three compounding causes, all verified live:

1. `.charsheet__ranger-ability-note { color: var(--rgb-text-dim) }` — **`--rgb-text-dim` is undefined** and there is no fallback, so the declaration is invalid at computed-value time and the note inherits `#bbb`, the full-strength body colour. Every note renders at the same weight as everything else. `.charsheet__ranger-hunters-prey p` has the identical bug — and carries a 9-line comment explaining the layer-order surgery done to make that rule work.
2. `.charsheet__ranger-ability-name { overflow-wrap: anywhere }` — unlike `break-word`, `anywhere` lets soft-wrap opportunities shrink min-content, so the grid's `minmax(0,1fr)` column collapses behind a `white-space:nowrap` badge and breaks words: **`Focuse / d / Quarry`**.
3. `block.style.borderTop = "1px dashed var(--rgb-border, #dee2e6)"` — also undefined, so the divider falls back to **`#dee2e6`**, a light-theme near-white, dashed, in a dark card.

Add to that a `✦ Passive` badge repeated on 7 consecutive rows (a badge that never varies carries zero information) and a `+1d6 dmg` badge in `badge-outline-danger` red — red means *used/spent/end* in this system, not "damage bonus".

**Fix:** define the missing tokens or point these at `--cs-text-secondary` / `--cs-border`; swap `anywhere` → `break-word` and let the badge column wrap; drop the repeated Passive badge in favour of one "Passive & Situational" group heading (which already exists); collapse the reminder list behind a disclosure — the hover links already carry the full text.

**Suggested command:** `/impeccable layout js/charactersheet/charactersheet.js` (`_renderOverviewRanger`)

### [P1] The Druid modal opts out of the character-sheet token system and fails WCAG AA in both themes

Measured computed values:

| Element | Night | Day |
|---|---|---|
| Zodiac card summary (`ve-muted`, 10.2px) on card `#222` | `#777` → **3.55:1** | `#777` on `#fff` → **4.48:1** |
| Section hint (`ve-muted`, 13.6px) on modal `#1e293b` | `#777` → **3.27:1** | — |
| `.charsheet__druid-section` background | `#1e293b` — **identical to the modal** | `#fff` — identical to the modal |
| Zodiac card background | `#222` (neutral grey) | `#fff` |

Three consequences: (a) body-size text fails the 4.5:1 floor in *both* themes; (b) the three "sections" have no visible boundary at all — Wild Shape, Wild Companion, and Zodiac Form run together as one column; (c) neutral-grey `#222` cards sit on a slate-blue `#1e293b` surface, a visible colour-family clash. `.charsheet__druid-zodiac-card` has **no stylesheet rule whatsoever** — it's a `ve-btn-default` plus an inline `style` attribute.

The modal also uses three button vocabularies in ~40 lines: `ve-btn-default` (± steppers), `ve-btn-primary` (+ Add Form…), `ve-btn-info` (Summon Familiar) — none of them the documented `.cs-combat-btn` variants, and none of them mapped to the verb they perform. Summoning a familiar *spends* a Wild Shape use; it should be `--spend` amber.

**Fix:** replace `ve-muted` with `--cs-text-secondary` (the ramp DESIGN.md says was explicitly raised to clear 4.5:1); give `.charsheet__druid-section` the recessed base tone `--cs-bg-base` per the Recessed-Inset Rule so it reads as cut into the modal; move the Zodiac cards to `--cs-bg-elevated` with the hairline border; convert all four button types to `.cs-combat-btn` variants (`--spend` for Summon Familiar and Transform, `--primary` for Add Form).

**Suggested command:** `/impeccable polish js/charactersheet/charactersheet-druid-resources.js`

### [P1] One click on the Zodiac grid irreversibly spends a Wild Shape use

`_pSelectZodiacForm` calls `activateZodiacFormUsingWildShape` immediately on click. Twelve visually identical 150px cards, no confirmation, no undo, and "Dismiss" does not refund. At level 9 that is one of two daily uses gone to a mis-click. The *sibling* flows in the same file (`_pTransformWildShapeFree`, `_pSummonWildCompanion`, `_pAddKnownForm`) all deliberately defer the spend until a picker resolves, and are guarded against double-fire — so this is an inconsistency inside one module, not a considered trade-off.

Two secondary problems in the same grid: the active card is signalled by `ve-btn-primary` colour **only** — no `aria-pressed`, no icon, no text — which breaks the sheet's own "colour **and** icon **and** text" rule; and `buildInlineEntriesHoverLink` nests an interactive hover link *inside* the `<button>`, which is why the click handler needs a `closest(".ve-help-subtle")` escape hatch. Nested interactive content is invalid and unpredictable for screen readers and keyboard users.

**Fix:** two-step select (card selects → a single "Assume Form (1 use)" confirm), or a select-then-spend flow mirroring `_pTransformWildShapeFree`. Add `aria-pressed` + a "● Active" text marker to the current card. Move the hover trigger out of the button (e.g. an adjacent info affordance) rather than filtering clicks.

**Suggested command:** `/impeccable harden js/charactersheet/charactersheet-druid-resources.js`

### [P2] The mobile tab bar covers the bottom 59px of every Druid modal

At 390×844: `.charsheet__main-tabs` is `position:fixed`, `z-index:1050`, occupying y 785–844. `.ve-ui-modal__inner` is `z-index:1001` and extends to y=844. The last row of the Zodiac grid (Griffon / Bulette / Phoenix) is permanently obscured; the modal's own scroll cannot reveal it because the overlap is at the viewport edge.

This is the ad-hoc z-index scale DESIGN.md warns about: 1000 (overlay) / 1001 (modal) / 1040 (roll history) / 1050 (mobile tabs), with no semantic ordering.

**Fix:** add `padding-bottom: calc(var(--cs-mobile-nav-h) + env(safe-area-inset-bottom))` to `.ve-ui-modal__scroller` under the mobile breakpoint, or lower the tab bar below the modal layer. Then define the semantic scale (`--z-dropdown / --z-sticky / --z-modal-backdrop / --z-modal / --z-toast`) and migrate.

**Suggested command:** `/impeccable adapt js/charactersheet/charactersheet-druid-resources.js`

## Persona Red Flags

**Alex (Impatient Power User)** — Opens Overview mid-combat to check whether Careful Spell is worth 1 SP; the description is 23px wide, so he has to switch to the Combat tab to read the same panel. Wants to change Hunter's Prey; the Ranger panel *names* the rule ("Change your Hunter's Prey option on a short or long rest") but the only code path that calls `setHuntersPreyOption` is buried in `charactersheet-rest.js` — there is no control anywhere on the panel that says so. He'll conclude the feature is unimplemented. The Ranger panel's 1,378px of prose is text he already knows; there's no collapse.

**Sam (Accessibility-Dependent)** — Tabs to a Metamagic Tune button: the row stays at `opacity: 0.75` because the un-dim is `:hover` only (no `:focus-within` exists anywhere in `charactersheet.css`), so the description sits at ~3.97:1 while focused. In the Druid modal, `#777` at 10.2px measures 3.55:1 at night and 4.48:1 in day — both under AA. The active Zodiac card announces nothing (no `aria-pressed`), and the hover link nested inside each card button makes the whole grid ambiguous to a screen reader. No visible close button in the modal (site-wide convention, but combined with the covered bottom edge on mobile it compounds).

**Table Player (project persona, from PRODUCT.md: "in-session use under time pressure")** — It's their turn. They open Druid Resources, read `Wild Shape2 / 2`, scan a 12-card grid with no active-state marker and no cost on the cards, mis-tap Beaver instead of Bee, and have burned half their daily Wild Shape with no undo. PRODUCT.md's principle 4 is "dependable feedback and clear states over visual novelty"; this flow delivers neither.

## Minor Observations

- **Sorcery Points appear three times in one Combat-tab viewport**: the section-header `9/9` badge, "Sorcery Points Available 9/9" with steppers, and the Combat Resources pip row `9/9 (long)`. Pick one canonical display.
- **The Metamagic dashboard is rendered on three tabs.** Reasonable for access, but the Overview instance is read-only (`isSorceryPointEditable` is only passed on Combat and Spells) with no signal that the ± disappeared — yet Tune/Detune still spend points there.
- **The ± steppers in the Druid modal are detached from the value they change.** `−` and `+` sit two lines below `2 / 2`, unlabelled except for `title`, in the site's default button style. Put them adjacent to the count.
- **Section headings in the Druid modal are `<span class="ve-bold">`** at body size — no type hierarchy inside an 800px modal. DESIGN.md's Title role (Inter 600, 1rem) exists for exactly this.
- **`_renderOverviewRanger`'s JSDoc promises "the Hunter's Prey active option selector."** There isn't one. Doc drift on a panel whose main gap is that missing selector.
- **Radius fallbacks contradict the documented scale**: `var(--cs-radius-sm, 4px)` / `var(--cs-radius-md, 8px)` vs DESIGN.md's `sm: 6px` / `md: 10px`. Harmless until a token goes missing — which, as `--rgb-text-dim` proves, happens.
- **Copy**: "Roll floor 8 on Perception/Stealth/Acrobatics" (Cat) is unparseable without the rules text. "Attackers must save or choose a new target" (Peacock) omits the save. The Zodiac summaries are inconsistent about naming their action cost — some lead with it ("Reaction:", "Bonus-action"), some omit it.

## Questions to Consider

- **Should the Overview render these panels at all?** The Metamagic dashboard works beautifully at 510px and fails at 265px. Is the Overview's job to *host* class dashboards, or to show a one-line summary that deep-links to the tab where the real control lives?
- **What is the Ranger panel actually for?** Every reminder already carries its full text on hover. If the answer is "so I don't forget I have it," a collapsed 8-row list of names is strictly better than 1,378px of prose.
- **Why does Zodiac spend instantly when every sibling flow in the same file defers?** Making it match would remove the only irreversible one-click cost in the module.
- **If a class panel had to fit in 265px and 44px of height, what would survive?** That constraint would have caught all three of these before they shipped.
