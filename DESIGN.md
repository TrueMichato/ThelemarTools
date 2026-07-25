---
name: 5etools Character Sheet
description: A dark-first, token-driven D&D 5e character sheet — a consistent shell around diverse class content, across a Manager view and a Play Mode.
colors:
  primary: "#6366f1"
  primary-night: "#7681f5"
  primary-text: "#4f46e5"
  primary-strong: "#4f46e5"
  accent-gold: "#f59e0b"
  accent-emerald: "#10b981"
  accent-ruby: "#f26161"
  accent-sapphire: "#3b82f6"
  accent-amethyst: "#a855f7"
  success: "#10b981"
  warning: "#f59e0b"
  danger: "#f26161"
  info: "#06b6d4"
  bg-base-night: "#0f172a"
  bg-surface-night: "#1e293b"
  bg-elevated-night: "#334155"
  text-primary-night: "#f1f5f9"
  text-secondary-night: "#9fadc0"
  text-muted-night: "#98a5b8"
  bg-base-day: "#eef1f6"
  bg-surface-day: "#ffffff"
  bg-elevated-day: "#f4f6fb"
  text-primary-day: "#0f172a"
  text-secondary-day: "#475569"
  text-muted-day: "#5b6675"
  border-night: "#ffffff1a"
  border-day: "#0f172a1f"
typography:
  display:
    fontFamily: "Cinzel, Georgia, serif"
    fontSize: "2.5rem"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "-0.01em"
  headline:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: "1.5rem"
    fontWeight: 600
    lineHeight: 1.25
  title:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: "1rem"
    fontWeight: 600
    lineHeight: 1.4
  body:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.6
  label:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: "0.75rem"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "0.05em"
  mono:
    fontFamily: "'JetBrains Mono', 'Fira Code', monospace"
    fontSize: "0.75rem"
    fontWeight: 600
rounded:
  sm: "6px"
  md: "10px"
  lg: "16px"
  xl: "24px"
  full: "9999px"
spacing:
  "2xs": "2px"
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "32px"
  "2xl": "48px"
  "3xl": "64px"
components:
  section-card:
    backgroundColor: "{colors.bg-surface-night}"
    textColor: "{colors.text-primary-night}"
    rounded: "{rounded.lg}"
    padding: "24px"
  combat-section:
    backgroundColor: "{colors.bg-surface-night}"
    textColor: "{colors.text-primary-night}"
    rounded: "{rounded.md}"
    padding: "16px"
  status-strip:
    backgroundColor: "{colors.bg-base-night}"
    textColor: "{colors.text-primary-night}"
    rounded: "{rounded.sm}"
    padding: "4px 8px"
  state-toggle-on:
    backgroundColor: "{colors.success}"
    textColor: "{colors.success}"
    rounded: "{rounded.full}"
    padding: "0.2rem 0.6rem"
    height: "24px"
  state-toggle-used:
    backgroundColor: "{colors.danger}"
    textColor: "{colors.danger}"
    rounded: "{rounded.full}"
    padding: "0.2rem 0.6rem"
    height: "24px"
  action-button:
    backgroundColor: "{colors.bg-elevated-night}"
    textColor: "{colors.text-secondary-night}"
    rounded: "{rounded.sm}"
    padding: "0.2rem 0.55rem"
    height: "24px"
  action-button-primary:
    backgroundColor: "{colors.primary-strong}"
    textColor: "#ffffff"
    rounded: "{rounded.sm}"
    padding: "0.2rem 0.55rem"
  feature-block:
    backgroundColor: "{colors.bg-base-night}"
    textColor: "{colors.text-primary-night}"
    rounded: "{rounded.sm}"
    padding: "8px"
---

# Design System: 5etools Character Sheet

## 1. Overview

**Creative North Star: "The Lamp-Lit Table"**

This is the interface for a D&D 5e character in active play: a DM and four
players around a lamp-lit table, phones and laptops open mid-encounter,
glancing down for two seconds to spend a resource and look back up. Every
decision serves that glance. The default surface is dark because that is the
room the sheet lives in; the light theme is a first-class parity mode, not the
starting point. The type is quiet, the numbers are loud, and the color is
rationed so that when a chip turns green or a pool turns red it *means*
something. The sheet should disappear into the game — the failure mode is not
"boring," it is "I had to stop playing to read my own character."

The system's organizing idea is **a consistent shell around diverse content.**
D&D's classes do not share one grammar: a Rogue arms Sneak Attack dice, a
Fighter spends limited-use surges, an Illrigger burns Interdiction seals, a
Sorcerer tunes passive Metamagic. That diversity is intentional and correct —
it maps to real differences in the game's rules. So the design does **not**
flatten those grammars into one control. Instead it wraps every class surface
in the same chrome: the same header contract, the same at-a-glance status
strip, the same ON/OFF/USED state vocabulary, the same roll-feedback channel,
the same accessibility spine. One shell, many contents. A player fluent in one
class's panel can read any other class's panel without relearning where to
look.

This system explicitly rejects decorative SaaS styling, novelty affordances,
and anything that trades scanability for flourish. It rejects display fonts on
UI labels and nested cards. Motion is state, never entertainment: a resource
that changes announces the change and settles; the page never performs its own
arrival.

**Owner exception — the content-section identity rainbow.** Two flourishes are
deliberately kept as the sheet owner's signature, overriding the generic bans
for these specific elements only: (1) the eleven tabbed **content** sections
(Resources, Attacks, Spells, Skills, Saves, Passives, Senses, States, Features,
Methods, Metamagic) each carry their own hue tint + a leading colour stripe —
the "rainbow" — layered on top of the unified 1px card border; and (2) the
Combat tab renders emoji glyphs as its iconography (matching the emoji section
icons across the rest of the sheet). The bans still hold everywhere else: the
**structural** chrome sections (header/identity/HP/currency/…) stay on the one
neutral surface, and no new arbitrary stripe or fifth state colour is
introduced. See §"Owner exception" in the No-Stripe Rule below.

**Key Characteristics:**
- **Dark-first, day-at-parity.** Night is the flagship; the light theme is a full token override that follows the site's Day/Night selector, never a separate switch.
- **Two coordinated surfaces.** A dense, tabbed **Manager** view for building and reference, and a stripped **Play Mode** ("Alt View") for the table — both drawing on one token layer.
- **Rationed color.** One indigo accent plus a small semantic set (success / warning / danger / info); accent is for state and primary actions, never decoration.
- **Numbers loud, chrome quiet.** Tabular numerals, a serif display face reserved for the hero name and big stat values, a humanist sans doing all the UI work.
- **Glance-legible state.** Every stateful control encodes itself in color **and** icon **and** text, so it survives a two-second look and a color-blind reader alike.
- **WCAG 2.1 AA is a floor, not a goal.** Every text token is contrast-tuned per theme; every icon has a text alternative; every toggle carries `aria-pressed`.

> **Deeper reference.** This file is the visual-system spec. For the full
> narrative of the redesign — every work stream, what changed and why, file
> pointers, and the phase-by-phase Combat Section Shell rollout — see
> [`docs/charactersheet/14-design-system-overhaul.md`](docs/charactersheet/14-design-system-overhaul.md).

## 2. Colors

A rationed, indigo-anchored palette on a deep slate canvas: one accent hue
carries identity and primary action, a compact semantic set carries state, and
everything else is a tuned neutral ramp that differs per theme.

### Primary
- **Arcane Indigo** (`#6366f1` day / `#7681f5` night): The single brand accent. Primary actions, current selection, focus rings, the 4px title marker, keyboard-hint chips. Night brightens the hue so indigo numerals and labels clear AA on the dark canvas; day re-pins the classic indigo-500. Fills that carry white text use the darker **Indigo Strong** (`#4f46e5`) so white clears the 3:1 large-text floor; indigo used as *text* uses **Indigo Text** (`#4f46e5` day / `#8b93f7` night).

### Secondary
- **Torchlight Gold** (`#f59e0b` night / `#b45309` day): The "spend" intent — sorcery points, surges, cost captions. Warning state shares this hue.
- **Verdant Emerald** (`#10b981` night / `#047857` day): The "on / armed / healed" intent — active StateToggles, heal actions, success.

### Tertiary
- **Blood Ruby** (`#f26161` night / `#dc2626` day): "Used / spent / end / danger" — exhausted toggles, burn/end actions, and the Illrigger's signature Interdiction/Conduit summary strips.
- **Sapphire** (`#4b8ef7` night / `#2563eb` day) and **Amethyst** (`#b06bf8` night / `#9333ea` day): Reserved data-label accents (passive scores, class flavor). Used sparingly; never as a fourth "action" color.

### Neutral
- **Slate Canvas** — base background (`#0f172a` night / `#eef1f6` day): the room the sheet sits in.
- **Card Surface** (`#1e293b` night / `#ffffff` day): every `.charsheet__section` and `.cs-combat-section` card.
- **Recessed Surface** (`#334155` night / `#f4f6fb` day): elevated chips, buttons, and status-strip insets read as *cut into* the card, not floating above it.
- **Ink** — primary text (`#f1f5f9` night / `#0f172a` day), secondary (`#9fadc0` / `#475569`), muted (`#98a5b8` / `#5b6675`). The night ramp is deliberately lifted off the AI-default light-gray: muted text was raised until it cleared 4.5:1 on card surfaces.
- **Hairline Border** (`rgba(255,255,255,0.1)` night / `rgba(15,23,42,0.12)` day): the one border weight. Full borders only.

### Named Rules
**The One Voice Rule.** Arcane Indigo is the only brand accent. It marks primary action, current selection, and focus — nothing decorative. If two things on a screen are indigo and only one is the primary action, one is wrong.

**The Rationed-Semantic Rule.** Green means on/available/healed. Amber means spend/cost/warning. Red means used/end/danger. These four are the entire state vocabulary. A class may not introduce a fifth state color for flavor. Green is **outcome-free** — it marks availability or completion, never the result of an action: an "add" button and a spell-cast confirmation are neutral/`info`, not green.

**The No-Stripe Rule.** The colored `border-left` / `border-right` accent stripe is forbidden — including when authored in JS style strings, where the CSS detector can't see it. State is carried by a full 1px border plus a background tint, never a side-stripe. (Nine such stripes were retired from the combat renderer.)

> **Owner exception.** The eleven tabbed **content** sections (Resources / Attacks / Spells / Skills / Saves / Passives / Senses / States / Features / Methods / Metamagic) deliberately keep a leading 3px colour stripe as part of the owner's per-section identity "rainbow" — a signature that predates the unified-surface pass and is retained by explicit request. This is the *only* sanctioned side-stripe. It rides on top of the neutral 1px card border (the card definition stays), is theme-agnostic (rgba over the mode-aware `--cs-bg-surface`), and is scoped to those content sections only. The detector flags these eleven as `side-tab`; they are flagged-and-documented rather than blanket-suppressed, so a *new* stray stripe anywhere else still trips the rule. Structural chrome sections stay neutral.

## 3. Typography

**Display Font:** Cinzel (with Georgia, serif fallback)
**Body / Label Font:** Inter (with system-ui stack)
**Mono Font:** JetBrains Mono (with Fira Code fallback)

**Character:** A high-contrast pairing on the serif-vs-sans axis. Cinzel is a
Roman-inscriptional serif that reads "fantasy ledger" — it is a *hero* face,
reserved for the character name, page title, and big stat numerals. Inter does
every piece of real UI work: headings, buttons, labels, body, and dense data.
Hierarchy rides weight + color + space, not size alone, so adjacent sizes stay
distinguishable even where the scale is tight.

### Hierarchy
- **Display** (Cinzel, 700, up to 2.5rem, line-height 1, tracking −0.01em): Character name, page title, hero stat numerals only. Never a UI label.
- **Headline** (Inter, 600, 1.5rem, line-height 1.25): Modal titles, major panel headings.
- **Title** (Inter, 600, 1rem, line-height 1.4): Section-card titles, feature-block titles.
- **Body** (Inter, 400, 1rem, line-height 1.6): Prose, descriptions, help text. Cap prose at 65–75ch.
- **Label** (Inter, 600, 0.75rem, tracking 0.05–0.1em, UPPERCASE): Stat labels, status-strip labels, toggle text. Uppercasing is done at the selector, not in the content.
- **Mono** (JetBrains Mono, 600, 0.75rem): Keyboard hints (`kbd`), dice formulas, tabular counts where alignment matters.

### Named Rules
**The Cinzel-Is-a-Hero Rule.** Cinzel appears on the name, the page title, and big numerals — and nowhere else. It is never a button, a toggle, a chip, or a data label. (Cinzel on UI labels caused the wrap bugs this system was built to fix.)

**The Tabular-Numeral Rule.** Any number that changes in play (pool counts, dice totals, modifiers) uses `font-variant-numeric: tabular-nums` so it doesn't reflow as it ticks.

## 4. Elevation

The system is **flat-by-default with tonal layering, and a whisper of shadow
for the top-level card only.** Depth is conveyed primarily by tone: the base
canvas is darkest (night) / coolest (day), cards sit one step up on the Card
Surface, and inset elements (status strips, feature blocks) drop back down to
the base tone so they read as *recessed into* the card rather than floating.
Shadow is a secondary cue reserved for the outermost `.charsheet__section`
card, and it responds to state (it deepens on hover) rather than sitting heavy
at rest.

### Shadow Vocabulary
- **Ambient rest** (`box-shadow: var(--cs-shadow-sm)` — `0 1px 2px rgba(0,0,0,0.3)` night / `0 1px 2px rgba(15,23,42,0.06)` day): Section cards at rest. Barely there.
- **Hover lift** (`var(--cs-shadow-md)`): Section cards on hover, paired with a border-color brighten. The only elevation change most surfaces ever make.
- **Focus glow** (`var(--cs-shadow-glow)` — `0 0 20px rgba(99,102,241,…)`): Reserved indigo halo for the rare emphasized element; not a default card treatment.

### Named Rules
**The Recessed-Inset Rule.** Inner elements (status strips, feature blocks, pip trays) sit on the *base* background tone, not a lighter one. Nested content reads as cut into the card, never as a card-on-a-card. Nested cards are forbidden.

**The Flat-At-Rest Rule.** Surfaces are flat at rest. Shadow appears as a response to state (hover) — never as a permanent decoration to make a card "pop."

**The Layer-Scale Rule.** Stacking is a *named scale*, not a number the author invents at the call site. Eleven semantic steps live on `:root` in `css/charactersheet-modern.css` and every character-sheet `z-index` reads one of them:

| Token | Value | Owns |
|---|---|---|
| `--cs-z-base` | 0 | In-flow content |
| `--cs-z-raised` | 10 | Cards/rows lifted within their own section |
| `--cs-z-sticky` | 100 | Sticky headers + column pins inside a scroller |
| `--cs-z-overlay` | 1000 | Full-screen scrims |
| `--cs-z-modal` | 1001 | Modal surface, above its own scrim |
| `--cs-z-scrim` | 1039 | Local backdrop, below the panel it dims |
| `--cs-z-panel` | 1040 | Roll history, FAB stack, floating panels |
| `--cs-z-banner` | 1045 | Level-up / status banners |
| `--cs-z-tabbar` | 1050 | Mobile bottom tab bar |
| `--cs-z-toast` | 1060 | Toasts + the roll-modifier toolbar |
| `--cs-z-tooltip` | 1070 | Context menus, hover cards — always on top |

Values were chosen to preserve the stacking order already shipping, so migration is mechanical. Two corollaries: (1) **a fixed layer owes the layers beneath it clearance, not just a higher number** — the mobile tab bar publishes its own height as `--cs-tabbar-height` (including `env(safe-area-inset-bottom)`), and anything it can cover pads by that amount rather than re-stacking shared chrome; (2) when a shared, site-wide element is in the stack, scope the fix to `body.is-charsheet-page` so non-sheet surfaces are untouched. *Known outliers:* two `10000`/`10001` declarations remain in `css/charactersheet.css`; they are a logged follow-up, not a licence for new ones.

## 5. Components

### Buttons
- **Shape:** Gently rounded (6px, `--cs-radius-sm`), 24px min-height, compact 0.2rem × 0.55rem padding — a dense in-play control, not a marketing CTA.
- **Base (`.cs-combat-btn`):** Recessed-surface fill, secondary ink, hairline border. This *is* the "reset" variant.
- **Variants (verb-mapped, labels stay class-authored):** `--primary` (indigo-strong fill, white text — use/enter), `--spend` (amber tint + border — spend/surge), `--heal` (emerald tint + border — heal), `--danger` (ruby tint + border — end/burn), `--selected` (indigo-strong fill — chosen option).
- **Hover / Focus:** Hover brightens border + background one step (150ms). Focus shows a 2px indigo outline offset 2px. Disabled drops to 0.5 opacity with `not-allowed`.

### Add affordance (canonical `.charsheet__add-btn`)
The single sheet-wide vocabulary for "add a thing" (Add Spell / Item / Attack /
Condition / Feat / Custom Ability). Indigo-strong fill, white text (6.29:1),
`glyphicon-plus` + a text label; a `--float` modifier right-aligns it in a
section header. It replaced four competing vocabularies (two of which stole the
reserved green) so **green is vacated** for available/complete only. Every
instance keeps its existing id-based handler — the component is presentation,
not behavior.

### State Toggle (signature component)
The heart of the combat shell. One chip that encodes its state three ways at
once — **color + icon + text, never color alone.**
- **Shape:** Full pill (`--cs-radius-full`), 24px min-height, uppercase bold micro-label.
- **States:** `--on` (emerald tint/border/text, "ON"), `--off` (neutral, muted "OFF"), `--used` (ruby tint/border, "USED", `not-allowed`). The default vocabulary is **ON / OFF / USED**; a class may override the *word* only where a different word carries real game meaning (e.g. ACTIVE vs PASSIVE, a mode name) — the color/icon/text *encoding* is never overridable.
- **A11y:** Always `aria-pressed`; an `aria-label` carries the descriptive state ("Sneak Attack: armed") which may intentionally differ from the terse visible "ON". State changes fire a `polite` live-region announcement.

### Status Strip (signature component)
The at-a-glance summary bar (DC / pool / range / save). Full 1px border, base-tone
inset, `role="group"`. Items are label + value pairs; a superseded value (base
dice before a deduction) renders struck-through in muted ink beside the new
value. One strip grammar across every class surface, generalized from the
Illrigger's ruby summary bar.

### Cards / Containers
- **Section card (`.charsheet__section`):** Card Surface, 1px hairline border, 16px radius (`--cs-radius-lg`), 24px padding, `--cs-shadow-sm` at rest → border-brighten + `--cs-shadow-md` on hover. Title uses the display face with a 4px indigo marker bar and a bottom hairline rule.
- **Combat section (`.cs-combat-section`):** The shell's region card — Card Surface, 1px border, 10px radius, 16px padding, `role="region"` + `aria-labelledby`. Header = themed icon + title + right-aligned primary-action slot.
- **Feature block (`.cs-combat-feature`):** Recessed base-tone inset, 6px radius, full border. Replaces the banned side-stripe blocks. Stacks with a `--cs-space-sm` sibling margin; no nesting.
- **Modal (`.ve-ui-modal__inner` / `.ve-w-100`):** Sizes to content by default (`height:auto`, capped by `max-height` + an internal scroller) so a content-light modal never opens a fixed-height void. Content-heavy pickers and the Level-Up wizard opt into an explicit tall height; a `:has()` size-to-content escape hatch (e.g. `:has(.charsheet__rest-modal)`) restores auto-height for a specific light modal. Primary CTA is the indigo One-Voice button, scoped to CS modals only — the site-wide `.ve-btn-primary` is untouched.

### Chips & Pills
- **Action-economy chip (`.cs-combat-chip`):** Small full-border pill (icon + word) for action/bonus/reaction meta; retires the ad-hoc badge system.
- **Condition pill (`.cs-combat-cond`):** Sentence-case met / blocked / none states; becomes an `aria-pressed` button in its `--toggle` variant.
- **Pool caption (`.cs-combat-pool`):** One canonical `N / M (recharge)` grammar for every resource pool; count is bold primary ink, max/recharge muted, auto-red at empty. Numerals tabular; count/max spanned so a screen reader says "3 of 5."

### Navigation
- **Tabs:** The Manager view is tab-driven (Overview / Combat / Spells / Inventory / Features / …). Standard, familiar, keyboard-navigable — no invented affordance.
- **Play Mode toggle:** A single header button (`#charsheet-btn-playmode`, Ctrl+Shift+P) swaps the whole surface into the stripped table view via the `charsheet--play-mode` body class.

### Layout: Combat Masonry (signature pattern)
The Combat tab flows its class-heavy sections through a CSS multi-column masonry
(`column-count: 2`, `break-inside: avoid`, collapsing to one column ≤768px) so
dense class content rebalances into reclaimed space instead of leaving a dead
right-column void. Often-empty cards (Defenses / Conditions / Active Effects)
collapse to a thin ~48px "add" affordance with a right-aligned "None" hint.

### Named Rules

**The Container-Adaptive Rule.** A panel that can be hosted in more than one column responds to **its container's width, never to which tab rendered it.** The sheet renders the same panel code into a ~510px Combat column and a ~265px Overview column; a host-aware branch (`if (tab === "overview")`) forks the component and rots the moment a third host appears. Instead:

- The panel root carries `.cs-adaptive-panel` (`container-type: inline-size; container-name: cs-panel`), and its narrow layout lives in `@container cs-panel (max-width: 380px)`. Any future panel dropped into any future column inherits the behaviour for free.
- **`text-overflow: ellipsis` is banned on an element that is allowed to wrap.** It cannot fire on a multi-line box; all it does is pair with the `overflow: hidden` it needs and silently clip content. If the text is the payload, give it a row of its own in compact mode rather than a truncation.
- **The payload never yields space to chrome.** In compact mode, put identity and the action button on one row and let the description span the full panel width beneath them; never let a `nowrap` badge column in a `minmax(0, 1fr) auto` grid squeeze the readable column to nothing.
- **Density is bought by disclosure, not by shrinking type.** Reference prose that hover already carries (rules reminders, long feature text) collapses behind a `<details>` showing names only; the type scale is not the lever.
- **Verify containment before shipping.** `container-type: inline-size` establishes size containment. Absolutely-positioned children *inside* the panel will be clipped by it; children portalled to `document.body` (as 5etools hover windows are — `js/utils-ui.js`) escape safely. Check which kind you have.

## 6. Do's and Don'ts

### Do:
- **Do** keep the game and the task in focus, not the interface — the sheet disappears into play.
- **Do** ration Arcane Indigo to primary action, current selection, and focus (the One Voice Rule).
- **Do** encode every stateful control in color **and** icon **and** text; give every icon a text alternative and every toggle `aria-pressed`.
- **Do** wrap each class surface in the shared shell (SectionShell / StatusStrip / StateToggle / PoolDisplay / RollResult / ActionButton) while letting its inner grammar stay whatever the class needs.
- **Do** hold the ON / OFF / USED vocabulary; override the word only where a different word carries real game meaning, never the encoding.
- **Do** tune every text token to clear WCAG AA in *both* themes; verify with an alpha-composited contrast probe, not by eye.
- **Do** keep numbers loud (tabular numerals, weight, space) and chrome quiet.
- **Do** reserve Cinzel for the name, title, and big numerals; use Inter for all UI.
- **Do** make multi-host panels respond to their container (`@container cs-panel`), and read `z-index` off the `--cs-z-*` scale.

### Don't:
- **Don't** use a colored `border-left`/`border-right` stripe as an accent — not even in a JS style string. Full border + tint only. (Sole exception: the eleven content-section identity stripes — see the No-Stripe Rule's owner exception. Don't add any *other* stripe.)
- **Don't** nest cards. Inner content is a recessed inset on the base tone, never a card-on-a-card.
- **Don't** reintroduce a per-section gradient tint on the *structural* chrome sections. The content-section identity rainbow is the owner's kept signature; structural chrome (header/identity/HP/currency/…) stays on the one neutral card surface.
- **Don't** put the Cinzel display face on a button, toggle, chip, or data label.
- **Don't** add a fifth state color, or use a semantic hue (green/amber/red) for decoration.
- **Don't** animate for entertainment: no page-load choreography, no bounce/elastic easing. Motion conveys state (150–250ms, ease-out) or it doesn't ship.
- **Don't** treat day mode as an afterthought — it is parity, following the site Day/Night selector with a full token override.
- **Don't** reach for a modal first. Exhaust inline / progressive disclosure before a dialog; when a dialog is unavoidable, move focus into it and restore it on close.
- **Don't** ship muted gray body text on a tinted near-white "for elegance" — the single biggest legibility failure. Bump toward ink until it clears 4.5:1.
- **Don't** invent a raw `z-index` number, branch a panel's layout on its host tab, or put `text-overflow: ellipsis` on an element that wraps.
- **Don't** write `var(--rgb-…)` in character-sheet CSS. The site defines only six `--rgb-*` tokens and they use *double-hyphen* modifiers (`--rgb-bg--alt`, `--rgb-font--muted`, `--rgb-name`, `--rgb-border--statblock`, `--rgb-font`, `--rgb-bg`). Every single-hyphen spelling (`--rgb-bg-alt`, `--rgb-text-dim`, `--rgb-border`, …) is undefined, and `var()` on an undefined custom property **fails silently** — the whole declaration is dropped with no console warning. Use `--cs-*`. A scoped compatibility alias block on `body.is-charsheet-page` in `charactersheet-modern.css` keeps the ~540 legacy references alive; don't add to it.
