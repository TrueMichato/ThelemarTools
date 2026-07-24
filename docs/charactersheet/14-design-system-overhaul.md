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

The redesign ran as seven streams. Each is independently committed and gated.
Streams 1–4 rebuilt the four surfaces (main sheet, Play Mode, cross-cutting
polish, Combat Section Shell); streams 5–7 followed neglected-surface critiques
into the modal/shared-component layer, the Builder flow, and the JS-rendered
modal interiors.

### 1. Main sheet visual overhaul (Rounds 1–5)

Commits `90d64180`, `10d9f9e7`, `b69ccddd`, `1e16e8b8`, `1148d0c7`.
Files: `css/charactersheet.css`, `css/charactersheet-mobile.css`,
`css/charactersheet-modern.css`, `charactersheet.html`,
`js/charactersheet/charactersheet.js`.

- **Card unification + rainbow retirement.** Every `.charsheet__section--*`
  renders on one neutral surface; the 13 per-section gradient tints and the
  banned `border-left: 3px` side-stripes were removed at source. *(Later
  partially reverted by owner request — see "Owner-requested restorations"
  below: the eleven **content** sections keep their hue tint + colour stripe;
  the structural chrome sections stay neutral.)*
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
| **Icon system** | `CS_COMBAT_ICONS` / `csCombatIcon()` / `csCombatActionChip()` | ~40 semantic-key → **emoji** map (owner-restored; see below); every glyph decorative (`aria-hidden`) + text-paired. |
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

### 5. Modal & shared-component layer (P1 remediation + backlog A–D)

Commits `abbc3422`, `c291c98f`, `6454d7d9`, `90c2af9d`, `10ea697c`, `1ad8ad76`.
Files: `css/charactersheet.css`, `css/charactersheet-modern.css`,
`charactersheet.html`, `js/charactersheet/charactersheet.js`,
`charactersheet-export.js`, `charactersheet-respec.js`.

After the four surface streams, a neglected-surface critique surfaced the
shared modal chrome and the last card-overuse/color-leak hotspots. This stream
brought them in line **without new structure** — colour, tokens, disclosure,
copy, and `:has()` size-to-content only.

- **Colorize modal CTAs → One Voice (`abbc3422`).** Every CS modal primary CTA
  inherited the site's legacy steel-blue `.ve-btn-primary` (#2a4e6c fill /
  muted text, borderline `<4.5:1`). Scoped a **CS-modal-only** override to
  `--cs-primary-strong` (#4f46e5, white 6.29:1) with a `--cs-primary-hover`
  hover; site-wide `.ve-btn-primary` (DM screen, bestiary, …) is untouched.
  Also tokenized the Companions hero gradient (was inline hardcoded rgba,
  detector-flagged) into `.charsheet__companions-header` on new
  `--cs-accent-amethyst-rgb` / `--cs-accent-sapphire-rgb` channels at the
  original alphas — gradient kept per design intent, detector finding retired.
- **Kill content-light modal void (`c291c98f`).** The `.ve-w-100` default
  pinned content-light modals to `height:min(700px,80vh)`, leaving 40–60% dead
  space. Added `:has()` size-to-content opt-outs (the proven Edit-Ability
  pattern) for the Rest (`:has(.charsheet__rest-modal)`) and Export
  (`:has(.charsheet__export-info)`) modals → `height:auto`, capped + centered
  (Short Rest 700→485px, Export 700→498px). The Level-Up wizard's deliberate
  90vh workspace is untouched. Also fixed Companions: dropped the doubled-plus
  emoji on "+ Custom", centered the 800px column, and lifted empty-state inline
  styles into classes so the hero header + empty state share one axis.
- **Backlog A — unify add affordances (`6454d7d9`).** The six "add" affordances
  spoke four vocabularies (two stealing the reserved green semantic). Replaced
  all six with one canonical `.charsheet__add-btn` (indigo `--cs-primary-strong`
  fill, white 6.29:1, `glyphicon-plus` + label; `--float` modifier for section
  headers). **Green vacated site-wide** for available/complete only. Every
  button keeps its id-based handler.
- **Backlog B — card discipline (`90c2af9d`).** Retired the last card-overuse:
  the four Notes Personality/Ideals/Bonds/Flaws cards collapse into one
  "Characteristics" card of labelled textareas; `.charsheet__feature` rows
  soften from a raised card to a 1px recessed inset (no hover lift); empty
  sections (Class Features / Feats / Custom Abilities / Resources) compact via a
  layered `:has()` rule instead of rendering as tall blank cards (keeping their
  teaching copy).
- **Backlog C — abilities focused card + Notes Appearance (`10ea697c`).** Killed
  the inner scrollbar on `.charsheet__ability-hero-skills` (cards grow to fit up
  to 8 related skills); disambiguated the doubled "Save" (readout relabelled
  "Saving Throw", the "Shield Save" button stays the sole roller); recessed the
  six Age/Height/Weight/Eyes/Skin/Hair inputs into the textarea affordance with
  static `yrs`/`ft`/`lb` unit suffixes (spinners hidden).
- **Backlog D — respec / level-up / export (`1ad8ad76`).** Neutralized the
  Respec HP chip (was danger-red though HP gain is neutral); de-duplicated the
  race/background grants headers ("🧬 Species traits" / "📜 Background
  benefits"); wrapped the raw-JSON export preview in a collapsed
  `<details>` disclosure (Download/Copy stay one click); recolored the Level-Up
  progress-fill bar indigo so green appears **only** on genuinely-complete step
  markers.

### 6. Character Builder flow (BR-A–E)

Commits `10a895ca`, `b20e65ca`, `85bbeb2f`, `4549c506`, `c495e923`. Files:
`js/charactersheet/charactersheet-builder.js`, `css/charactersheet.css`.

The multi-step creation wizard (`#charsheet-tab-builder`) sits **outside**
`.ve-ui-modal__inner`, so the modal-scoped rules from stream 5 never reached it.
This stream brought the Builder to full parity with the shipping shell.

- **BR-A — flatten nested cards → recessed wells (`10a895ca`).** Builder section
  cards become recessed wells (`--cs-bg-base`, no border/shadow) inside the
  single outer content frame; master-detail list/preview panes drop from 2px
  card borders to 1px hairlines. Regrouped the Details step from 7 single-field
  cards into 3 grouped sections (Character / Appearance / Backstory); all input
  ids + listeners preserved.
- **BR-B — unify primary buttons to indigo (`b20e65ca`).** Extended the One-Voice
  rule to `#charsheet-tab-builder .ve-btn-primary` (same `--cs-primary-strong`
  tokens) so Next/Finish and the spell-picker "+" speak the sheet's indigo. The
  Previous button (neutral) and remove toggle (danger red) keep their roles.
- **BR-C — Abilities compact 2×3 grid + sticky score-chip tray (`85bbeb2f`).**
  Rewrote the Abilities step from stacked rows into a 2×3 grid (STR/DEX/CON ·
  INT/WIS/CHA) with a **sticky** score-chip tray so chips + drop targets stay
  co-visible. Standard-array assignment is drag-first (HTML5 DnD) plus
  click-select, both fully keyboard-operable (chips + dropzones are native
  `<button>`s), with a visually-hidden live region announcing each
  assignment and a live "N to assign" count. All pool/pointbuy/manual state
  logic preserved; grid collapses to 1 column ≤768px; reduced-motion guard.
- **BR-D — close light-step void, balance & mobile-stack Details (`4549c506`).**
  Dropped the content-panel `min-height` 400→220px so the lightest step (Name)
  no longer opens a void; the Backstory textarea grows to bottom-align its
  column; the Details two-column row stacks to one column ≤768px (layered
  override to beat `.ve-flex{display:flex!important}` in `@layer vetools`) so
  Appearance sub-fields get full width.
- **BR-E — copy & empty-state cleanups (`c495e923`).** Background-Equipment
  empty state reads "This background grants no additional equipment."; source
  badges (Species/Class/Subclass/Background/Custom) gain a full-source-name
  tooltip (`Parser.sourceJsonToFull`) + `cursor:help`; the Details duplicate
  name field is relabelled "Confirm Name"; the Quick-Build "Start at Higher
  Level" control is lifted to the top of the Class step for up-front
  discoverability (logic unchanged).

### 7. Modal-Layer Remediation (MLR-A–E)

Commits `e03e39e6`, `bb2208b8`, `d665f9ca`. Files: `css/charactersheet.css`,
`js/charactersheet/charactersheet.js`, `charactersheet-spells.js`,
`charactersheet-levelup.js`, and one source-coupled test.

A final pass bringing JS-rendered modal **interiors** up to the redesigned
shell's standard — the shell wraps them, but their bodies still carried
pre-overhaul contrast, void, stripe, and colour-semantic debt.

- **MLR-A — Edit Proficiencies chips (`e03e39e6`).** Theme-aware chip tokens
  (`--cs-bg-elevated` / `--cs-text-primary`) fix day-mode contrast
  (1.14:1 → 16.5:1 day / ~9:1 night); resolve embedded `@tags` via
  `Renderer.stripTags` so a chip never leaks raw `{@filter …}` syntax;
  `max-width:100%` so a long proficiency wraps instead of overflowing.
- **MLR-B — systemic modal size-to-content (`e03e39e6`).** Flipped the
  `.ve-w-100` modal default from fixed `height:min(700px,80vh)` to `height:auto`
  (capped by the existing `max-height` + scroller), killing the ~150px void in
  every content-light modal (prof, settings, multiclass, npc-export).
  Content-heavy pickers + the level-up wizard keep their explicit tall heights
  (later source order wins the equal-specificity `!important` tie).
- **MLR-C — No-Stripe sweep + Settings de-card (`e03e39e6`).** Retired every
  remaining **non-rainbow** `border-left/right` ≥2px accent (hp-bar-fill,
  combat-spell-group + category dividers → 1px, ranger-ability-row stripe,
  custom-abilities category header → full 1px, apply-buff-row edge, Settings
  Thelemar amber stripe → 1px neutral); de-carded the Settings source-filter
  into a recessed scroll region. The owner's per-section rainbow
  (`css:21486–21536`) is untouched. Updated the coupled
  `CharacterSheetUiTweaksRound8` ranger-row assertion to expect no stripe.
- **MLR-D — vacate reserved green from spell-cast feedback (`bb2208b8`).** A cast
  is an action **outcome**, not a completion, so its feedback toasts switched
  `type:"success"` → `type:"info"` (main cast + innate at-will + limited-use);
  green stays on genuine completions (Applied-to-Self, memorize, scribe,
  summon). *Deferred to a future interactive session (documented):* the full
  cast-toast → `.charsheet__dice-result` surface convergence — a multi-part cast
  has no single canonical total, `CharacterSheetSpellcastingFlow` couples on the
  toast content, and ~8 gameplay branches can't be browser-verified
  unsupervised.
- **MLR-E — multiclass banner + density (`d665f9ca`).** Dropped the redundant
  "Add a New Class" heading (duplicated the modal title) and condensed the
  teaching banner to one line (~30% height reclaimed); raised the class-list
  `max-height` 350px → `min(60vh, 480px)`; added a density rule **scoped to
  `.charsheet__multiclass-body .charsheet__levelup-option`** (tighter
  padding/margin) shrinking rows ~85→~67px so 6–7 fit at once. The **shared**
  `.charsheet__levelup-option` base rule (level-up wizard subclass/feat pickers)
  is deliberately untouched.

### Owner-requested restorations

After the overhaul shipped, the sheet owner asked for two of their original,
deliberate design choices to be brought back — both were the owner's asks, not
generated defaults, and both are retained as the sheet's signature. Restored
without disturbing any other change:

1. **Per-section identity "rainbow."** The eleven tabbed **content** sections
   (Resources / Attacks / Spells / Skills / Saves / Passives / Senses / States /
   Features / Methods / Metamagic) each carry their own hue gradient tint + a
   leading 3px colour stripe. Implemented in `css/charactersheet.css` as a
   re-tint block layered *after* the neutral-surface block, so the tint + stripe
   win on specificity while the unified 1px card border (top/right/bottom) is
   preserved — the card definition stays, the identity colour comes back on top.
   rgba over the theme-aware `--cs-bg-surface`, so it holds in night + day. The
   **structural** chrome sections (header/identity/HP/currency/…) stay neutral.
   The detector flags the eleven stripes as `side-tab`; they are
   flagged-and-documented (the sole sanctioned exception to the No-Stripe Rule),
   not blanket-suppressed, so a stray stripe anywhere else still trips the rule.
2. **Combat emoji iconography.** `CS_COMBAT_ICONS` maps each semantic key to an
   emoji glyph (🗡️ Sneak Attack, ⚔️ action, ⚡ bonus, 🔄 reaction, 🐻 Wild Shape,
   🩸 Conduit dice, ✨ spark, …) and `csCombatIcon()` renders it as an
   `aria-hidden` glyph span — matching the emoji section icons across the rest of
   the sheet, rather than Font Awesome marks. The shell's a11y contract is
   unchanged (every glyph stays decorative + paired with visible text or an
   `aria-label`), and all shell structure / StatusStrip / StateToggle / layout /
   copy work from Phases 0–F is untouched.

---

## Governing rules (from `DESIGN.md`)

These are the Named Rules future work must hold:

- **The One Voice Rule** — Arcane Indigo is the only brand accent (primary
  action / selection / focus). Nothing decorative. Extended in streams 5–6 to
  the modal CTAs and the Builder tab, and to a single canonical
  `.charsheet__add-btn` for every "add" affordance — so no surface introduces a
  second primary color.
- **The Rationed-Semantic Rule** — green=on/available/healed, amber=spend/cost/
  warning, red=used/end/danger. No fifth state color. Green is **outcome-free**:
  it marks availability/completion, never an action result (the add-affordance
  unification and the spell-cast `success`→`info` switch both vacated green from
  outcomes).
- **The No-Stripe Rule** — no colored `border-left`/`border-right` accent, **not
  even in a JS style string** (the detector can't see those; 9 JS stripes were
  retired in stream 4, and the last non-rainbow CSS stripes in MLR-C).
  *Sole sanctioned exception:* the eleven content-section identity stripes
  (owner-restored — see below).
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
2. Impeccable detector on touched files — **0 new** findings (the
   `charactersheet.css` baseline carries documented residuals: 11 rainbow
   `side-tab` (owner-restored identity stripes) + 1 `border-accent-on-rounded`
   tab-underline + ~12 `layout-transition` fill-bars, kept intentionally).
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
