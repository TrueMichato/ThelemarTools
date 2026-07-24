# Character Sheet Design Overhaul

This document is the reference for the character-sheet **visual/UX redesign**
carried out on the `truemichato-character-sheet-ui-overhaul` branch. It exists
so future work has a complete basis: what changed, why, where it lives, and the
rules that govern staying on-brand.

**Companion files (source of truth for tokens & components):**
- **[`DESIGN.md`](../../DESIGN.md)** (repo root) — the canonical visual design
  system in Stitch format: token frontmatter, the six-section spec (Overview /
  Colors / Typography / Elevation / Components / Do's & Don'ts), and the Named
  Rules. **Read this first** before touching any character-sheet CSS or
  render markup.
- **`.impeccable/design.json`** — machine-readable sidecar: tonal ramps,
  shadow/motion/breakpoint tokens, drop-in component snippets, narrative.
- **`PRODUCT.md`** (repo root) — the product register and anti-references the
  design serves.

> **Scope discipline that held across the whole redesign:** every change was
> **presentation/UX only** — no data-model, state, or feature-behaviour
> changes. All element IDs and JS-rendered class names were preserved (tests
> and layout persistence depend on them). Sanctioned JS edits were limited to
> presentation (settings-key wiring, toolbar/overflow restructure, render
> chrome). The gate on every phase: impeccable detector `[]` new findings,
> Jest `CharacterSheet` **392 suites / 12,074 tests** green, and a day+night
> contrast/overflow browser probe at 1440 + 390.

---

## North Star & the two surfaces

**"The Lamp-Lit Table."** The sheet is for a character in active play — a
two-second glance mid-encounter to spend a resource and look back up. Dark-first
(night is the flagship), day at full parity via a token override that follows
the site's Day/Night selector. Color is rationed to *meaning*; numbers are loud,
chrome is quiet.

The system spans **two coordinated surfaces on one token layer:**

| Surface | Files | Role |
|---|---|---|
| **Manager view** | `charactersheet.html`, `css/charactersheet.css`, `css/charactersheet-mobile.css`, `js/charactersheet/charactersheet*.js` | Dense, tabbed build/reference sheet (Overview / Combat / Spells / Inventory / Features). |
| **Play Mode ("Alt View")** | `css/charactersheet-playmode.css`, `js/charactersheet/charactersheet-playmode.js` | Stripped at-the-table tactical HUD. Toggle `#charsheet-btn-playmode` (Ctrl+Shift+P), body class `charsheet--play-mode`. |

The organizing idea is **a consistent shell around diverse content.** D&D's
classes don't share one interaction grammar, and that diversity is intentional.
The design never flattens the grammars; it wraps each in the same chrome.

---

## The token layer (`css/charactersheet-modern.css`)

All four `css/charactersheet*.css` files are **hand-authored plain CSS — no SCSS
source.** Edit them directly; the `npx sass` rebuild constraint does **not**
apply here.

Tokens live under `:root` (night/dark = default) and `:root:not(.ve-night-mode)`
(day override — the site adds `.ve-night-mode` to `<html>` for night, so day
carries no class). The redesign added/tuned:

- **Color** — one indigo brand accent (`--cs-primary` `#6366f1` day / `#7681f5`
  night) plus a compact semantic set (success/warning/danger/info) and reserved
  data accents (gold/emerald/ruby/sapphire/amethyst). Every text token was
  **contrast-tuned per theme to clear WCAG AA** (night muted text was the single
  biggest failure bucket — lifted off the AI light-gray default).
- **Type roles** — `--cs-font-display` (Cinzel, hero only), `--cs-font-body` /
  `--cs-font-label` (Inter, all UI), `--cs-font-mono` (JetBrains Mono); weight
  (`--cs-weight-*`), leading (`--cs-leading-*`), tracking (`--cs-tracking-*`).
- **Spacing** — 4pt scale `--cs-space-2xs…3xl` (2/4/8/16/24/32/48/64px).
- **Radius** — `--cs-radius-sm…full` (6/10/16/24/9999px).
- **Motion** — `--cs-transition-fast/normal/slow` (Material ease-in-out) +
  `--cs-ease-out-quart/quint/expo` (ease-out only, **no bounce/elastic**).
- **Shadow** — `--cs-shadow-sm/md/lg/glow`, flat-at-rest, softer+cooler in day.

See `DESIGN.md` frontmatter for the full token catalog with values.

---

## Work streams

The redesign ran as four streams. Each is independently committed and gated.

### 1. Main sheet visual overhaul (Rounds 1–5)

Commits `90d64180`, `10d9f9e7`, `b69ccddd`, `1e16e8b8`, `1148d0c7`.
Files: `css/charactersheet.css`, `css/charactersheet-mobile.css`,
`css/charactersheet-modern.css`, `charactersheet.html`,
`js/charactersheet/charactersheet.js`.

- **Card unification + rainbow retirement.** Every `.charsheet__section--*`
  renders on one neutral surface; the 13 per-section gradient tints and the
  banned `border-left: 3px` side-stripes were removed at source.
- **Nested-card flattening.** Ability scores, passives, currency, AC/Init/Speed,
  Jumps/Carry, spellcasting-stat, count-chips → borderless **recessed cells** on
  the parent surface (the Recessed-Inset Rule; nested cards are forbidden).
- **Semantic-color recalibration (R4/R5).** After over-removal feedback, color
  was restored **on the data (numbers)**, chrome kept neutral: passive scores
  (perception=gold / investigation=sapphire / insight=amethyst), combat stats
  (AC=sapphire / Init=gold / Speed=green), hit-dice amethyst, inventory
  equipped=green / starred=gold, category count-badge accent. Day auto-maps to
  darker AA-legible shades.
- **Typography.** Added `--cs-font-label` (Inter); moved section headings + stat
  labels off Cinzel (uppercase + tracked), fixing mid-word wraps
  ("PROFICIENC Y BONUS"). Cinzel stays a hero face.
- **Identity/XP.** Name no longer clips (flex-wrap identity row + clamped hero
  size); XP mini-panel → calm headline + slim progress track + inline
  `<details>` for manual Add/Set.
- **Toolbar.** Settings/customization row defaults **collapsed behind "More"**;
  Import/Export/Print moved into it with labels.
- **Day-mode navbar harmony.** Site header retinted into the sheet's indigo (day)
  / slate (night) family so header + sheet read as one surface.
- **Responsive/overflow fixes.** Death Saves wrap inside the card; inventory
  columns `min-width:0` + full-width mobile stack; passive labels `nowrap`.
- **Focus + modals.** One generic `:focus-visible` accent ring across
  interactive primitives; modal scrim gained `backdrop-blur(5px)` + scrim 0.74
  so overlapping page content no longer bleeds through.

### 2. Play Mode / "Alt View" (Phases 1–2)

Commits `577aa838`, `69c5d1cf`, `d12dbd36`, `d55331c2`.
Files: `css/charactersheet-playmode.css`, `js/charactersheet/charactersheet-playmode.js`.

- **Phase 1 — stabilize.** Alt View now **owns the viewport**: the builder
  `#charsheet-header` chrome is hidden under `.charsheet--play-mode` via a rule
  in `@layer vetools` (so it outranks `.ve-flex-col`'s layered
  `display:flex !important` — layered `!important` beats unlayered). Added a
  "Level Up" bridge delegating to the main-sheet wizard (Alt View does **not**
  reimplement building). Reduced a 17-button status row to 6 primary actions +
  a body-appended `position:fixed` "More" menu (escapes overflow clipping);
  flex-wrap for mobile.
- **Phase 1 — settings-key bug fix.** Rebound 4 inert Play-Mode toggles from the
  dead keys (`tgttCarry`/`tgttJumping`/`tgttLinguistics`/`tgttCriticalRolls`) to
  the canonical keys the calc engine reads (`thelemar_carryWeight` /
  `thelemar_jumping` / `thelemar_linguisticsBonus` / `thelemar_criticalRolls`).
- **Phase 1 — design language.** Removed 3 banned side-stripes → hairline
  callouts; section titles Cinzel → `--cs-font-label`; drawer bounce →
  `ease-out-quint`; HP fills animate `clip-path` not width; reduced-motion
  extended to companion fill.
- **Phase 2 — flagship identity.** Collapsed ~9 decorative per-section hues to
  the 4 semantic state roles; kept the canonical D&D item-rarity scale. Fixed a
  systematic 20-declaration extra-paren remap bug.
- **Phase 2 — one icon system.** Replaced ~496 emoji with a central `_icon()`
  helper: game content → inlined **game-icons.net SVGs** (CC BY 3.0, in-file
  attribution, `fill:currentColor` so state color applies), UI chrome → Font
  Awesome. Added `_pip()`/`_setIcon()`/`_setIconLabel()`. Phase-2 fixup
  (`d55331c2`) fixed icon-key text leaking into turn-economy slots + markdown
  export, and stripped orphan U+FE0F variation selectors.
- **Density.** Tabular numerals on vitals/mods/scores; 3-zone hierarchy;
  full `prefers-reduced-motion` catch-all for all `pm-*`.

### 3. Cross-cutting polish + user-flagged bug fixes

Commit `c56aadc3` (multi-pass: layout / colorize / typeset / animate / clarify /
polish). Also the token-contrast work across
`css/charactersheet-modern.css`.

- **Token layer.** Spacing/type/easing tokens; AA-contrast day+night color
  tokens (see the checkpoint history for the per-token contrast math).
- **Motion.** Purposeful ease-out transitions with reduced-motion fallbacks; no
  layout-property animation beyond fill-bars/accordions.
- **Bug fixes (user-flagged):**
  - Overview **skills grid** alignment + custom-row wrap; the
    `charsheet__mod-effective--positive` overflow above passive scores.
  - **Edit Ability Scores** modal — removed dead space, fixed stepper digit
    clipping (scores were half-hidden, needed more room).
  - **Create Custom Item** modal — removed duplicate header + nested cards.
  - **Add Item** picker — mobile tab overflow.
  - **Inventory tab** — column gutter distance between
    `charsheet__section--inventory` and the adjacent column.
  - **Evasion save badge** — decoupled `.charsheet__save-row` from the skills
    grid so the Dexterity-save Evasion marker flows correctly (it had been
    displaced by the skills-grid edits).

### 4. Combat Section Shell (Phases 0 / A–F)

Commits `e759e1f7`, `9d2e1678`, `1491a79a`, `8517afd8`, `6b6ea418`, `9b3a863f`,
`72b853ca`, `a38688b8`, `37777df1`, `084be43b`, `22fad20a`, `773458dd`,
`a79b3a37`, `f15a1216`, `4185d08b`, `6cf8d63b`, `b9049bed`, `207b240d`.
Files: `js/charactersheet/charactersheet-combat.js`, `css/charactersheet.css`,
`charactersheet.html`, `js/charactersheet/charactersheet-layout.js`, and 4
source-coupled test files.

The Combat tab hosts ~18 conditional sections and **47 class/subclass-gated
surfaces** across **7 interaction grammars** (pip pool, use/reset, ±stepper,
dropdown+spend, inline toggle, modal picker, info-only). The grammar diversity
is **intentional** — the shell standardizes only the *chrome*.

**The shell primitives** (all tokenized, no inline styles / hex / side-stripes;
CSS in `css/charactersheet.css` around L12536–13030, JS helpers module-level in
`charactersheet-combat.js`):

| Primitive | Class / helper | Role |
|---|---|---|
| **SectionShell** | `.cs-combat-section` / `csCombatSection()` | Labelled `role="region"` card: themed icon + title + right-aligned action slot. |
| **StatusStrip** | `.cs-combat-strip` / `csCombatStatusStrip()` | Full-border at-a-glance summary bar (DC/pool/range/save); struck superseded value. |
| **StateToggle** | `.cs-combat-toggle` / `csCombatStateToggle()` | Color+icon+text chip, default **ON/OFF/USED** vocab, `aria-pressed`. Word overridable where game meaning demands; encoding never. |
| **PoolDisplay** | `.cs-combat-pool` / `csCombatPoolCaption()` | Canonical `N / M (recharge)` caption; count/max spanned for SR; auto-red at 0. |
| **FeatureBlock** | `.cs-combat-feature` | Recessed base-tone inset, full border — replaces the banned side-stripe blocks. |
| **ActionButton** | `.cs-combat-btn` + `--primary/--spend/--heal/--danger/--selected` | Verb-mapped variants; labels stay class-authored. |
| **RollResult** | `#cs-combat-live-region` / `_announceCombat()` | Single persistent `aria-live="polite"` region for roll/state feedback. |
| **Icon system** | `CS_COMBAT_ICONS` / `csCombatIcon()` / `csCombatActionChip()` | ~40 semantic-key → Font Awesome map; every glyph decorative + text-paired. |
| **Condition pill** | `.cs-combat-cond` + `--met/--blocked/--none/--toggle` | Sentence-case; becomes `aria-pressed` button when toggle. |

**Phase-by-phase:**

- **Phase 0 — Rogue vertical slice.** Built the minimum primitives and migrated
  Rogue Sneak Attack / Cunning Strike fully through them as the reference every
  later class copies. Vocabulary READY→**ON**.
- **Phase A — complete primitives.** FeatureBlock block-model, PoolDisplay
  caption, full ActionButton variants, icon set 12→28 keys. **Retired all 9 JS
  side-stripes** (incl. a night-mode bug where hardcoded light hex broke in dark
  mode). DOM now has **0 inline `border-left`**.
- **Phase B — accessibility spine.** Four shared a11y render helpers + two
  modal focus helpers (`csFocusModalOnOpen` / `csRestoreModalFocus`) applied to
  the shared choice modal + Arcane Shot + Crit Rider pickers.
- **Phase C — fan out.** Migrated all 11 remaining class/subclass panels onto
  the primitives (Fighter, World-Tree Barbarian, Druid, Illrigger
  Interdiction/Conduit/Masteries, Combat Methods, Ranger Primal Focus, Sorcerer
  Metamagic, Arcane Archer, Channeled Spell). **Class identity preserved** — the
  Illrigger ruby summary strips and the Metamagic dashboard `●/○/◆` status-glyph
  system kept intact; only emoji/buttons inside migrated.
- **Phase D — Combat Resources fold-ins.** Weapon Damage Riders + Arcane Shot
  got the same disclosure chrome as Sneak Attack (StatusStrip + StateToggle
  rows), keeping their distinct inner controls.
- **Phase E — layout (Combat Masonry).** Flattened the two `.charsheet__col-half`
  wrappers into one `.charsheet__combat-masonry` (`column-count:2`,
  `break-inside:avoid`, 1 column ≤768px) so class-heavy content rebalances into
  reclaimed right-column space (killed ~1,700px of dead void; Illrigger L10 tab
  2,891→1,923px). Empty Defenses/Conditions/Active-Effects collapse to a thin
  ~48px "add" affordance with a "None" hint. Fixed a coupled truthy-vs-`.length`
  bug on the 4 defenses arrays. Drag-drop persistence
  (`charactersheet-layout.js`) survives the flatten.
- **Phase F — copy.** Metamagic jargon glosses (SP cost tooltips, Tune/Detune
  aria-labels + titles, first-run intro `.charsheet__mm-intro`); unified one
  modal-dismiss grammar (choice modal Cancel→Close). Verified ON/OFF/USED
  vocabulary + roll-feedback were already systematized by the shared helpers.

**Exit-verb grammar (documented decision):** **Cancel** = abandon a form with
unsaved edits; **Close** = dismiss a use/info/choice modal that discards
nothing; **Skip** = bypass an optional step; **Dismiss** = remove an
active/temporary thing; **Done** = finish a picker.

---

## Governing rules (from `DESIGN.md`)

These are the Named Rules future work must hold:

- **The One Voice Rule** — Arcane Indigo is the only brand accent (primary
  action / selection / focus). Nothing decorative.
- **The Rationed-Semantic Rule** — green=on/available/healed, amber=spend/cost/
  warning, red=used/end/danger. No fifth state color.
- **The No-Stripe Rule** — no colored `border-left`/`border-right` accent, **not
  even in a JS style string** (the detector can't see those; 9 were retired).
- **The Cinzel-Is-a-Hero Rule** — Cinzel on the name, title, and big numerals
  only; never a button/toggle/chip/label.
- **The Tabular-Numeral Rule** — any number that changes in play uses
  `font-variant-numeric: tabular-nums`.
- **The Recessed-Inset Rule** — inner content sits on the *base* tone; no nested
  cards.
- **The Flat-At-Rest Rule** — surfaces flat at rest; shadow responds to state.

---

## Gate discipline for future design work

1. `node --check` + `eslint --quiet` on touched JS.
2. Impeccable detector on touched files — **0 new** findings (the CSS baseline
   carries documented residuals: 1 tab-underline + ~12 layout-transition
   fill-bars, kept intentionally).
3. Jest `CharacterSheet` — 392 suites / 12,074 tests green (pre-commit hook runs
   `jest --findRelatedTests`).
4. Browser probe on the live sheet **day + night** at 1440 + 390: alpha-composited
   contrast ≥ AA on new text, `bodyOverflowX === 0`, controls ≥ 24px.
5. Commit per phase with the required trailers.

**Source-coupled tests:** 4 combat test files assert render markup / source
slices (`CharacterSheetCombatRangerFocus`, `CharacterSheetCombatResourcePips`,
`CharacterSheetCombatTabLayout`, `CharacterSheetFighterRollHooks`). Chrome
changes to those surfaces may require intent-preserving test updates — never
change the assertion's *intent*, only the markup window it reads.
