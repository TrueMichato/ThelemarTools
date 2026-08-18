---
target: js/charactersheet/charactersheet-materials.js
total_score: 18
max_score: 40
na_heuristics: 0
p0_count: 2
p1_count: 3
timestamp: 2026-08-18T14-39-18Z
slug: js-charactersheet-charactersheet-materials-js
---
# Critique — Item Materials Flow

**Target:** `js/charactersheet/charactersheet-materials.js` (+ inventory badges, materials CSS)
**Mode:** Operate
**Method:** dual-agent (A: assessment-a-design-1 · B: assessment-b-detector-1)
**Detector:** `detect.mjs` run on `charactersheet.html`, `crafting.html` (exit 2, 3 findings — all out-of-scope shell code) and `charactersheet-materials.js` (exit 0, clean).
**Browser:** Assessment A owned the shared Chrome DevTools session (desktop + 390px). Assessment B's browser injection was skipped for that contention; B's evidence is CLI detector + static source/CSS + computed contrast.

## Design Health Score

| # | Heuristic | Score | Evidence |
|---|---|---|---|
| 1 | Visibility of system status | 2/4 | Live before/after preview exists, but paints at the **top** of the modal while you hover rows far below (`materials.js:1293,1357`). Apply just closes the modal (`:1392`) — no confirmation of what changed. |
| 2 | Match system ↔ real world | 2/4 | `MC`, `✦`, `Pen`, `−∞` unexplained. `getSummary` (`:763-776`) is item-agnostic → prints **"AC 19" on a longsword**. |
| 3 | User control & freedom | 2/4 | Non-destructive projection makes most applies reversible — but no undo affordance, no confirm, and `destroy` (Ordinary Glass) is genuinely irreversible with no forewarning. |
| 4 | Consistency & standards | 2/4 | Breaks the repo's own DESIGN.md: 5 colored `border-left` accent stripes (`css:24631,24635,24674,24678,24683`); indigo rationing broken by 65 `ve-btn-primary` Apply buttons (`:1348`). |
| 5 | Error prevention | 2/4 | Destroyable materials presented identically to Steel; red clear-trash sits beside the modal ✕; overload only whispered in a preview line. |
| 6 | Recognition rather than recall | 1/4 | **65 materials, no search, no filter, no sort, no compare.** Preview is one-at-a-time and spatially divorced → hover→memorize→hover→memorize. |
| 7 | Flexibility & efficiency | 2/4 | Fine for a mouse power-user who knows the catalog. No search, favorites, or keyboard-efficient path; touch users get almost nothing. |
| 8 | Aesthetic & minimalist design | 2/4 | Current-material header and preview header print the identical summary back-to-back (`:1206-1210` vs `:1318`); inventory rows duplicate each fact as both pill and button (`inventory.js:7502/7621`, `7503/7625`). |
| 9 | Error recovery | 2/4 | MC modal explains overload/interference well; shattered items dead-end with no recovery UI. |
| 10 | Help & documentation | 1/4 | `✦`, `MC`, `−∞`, condensate roles, resonance domains all presume the 678-line doc. Only inline help is `title=` — mouse-only. |

**Total: 18 / 40** (0 N/A)

## Design Specificity Verdict

**Fails.** The picker has **essentially zero bespoke CSS** — grep for `charsheet__material-modal`, `-option`, `-hover`, `-preview`, `-current`, `-list` in `css/charactersheet.css` returns **nothing**. The entire main surface is generic utilities (`stripe-even/odd`, `ve-btn-primary`, `p-2`) plus native `<details>` triangles and a native `<select>`. Swap "material/resonance" for "sticker/color" and this is a Shopify variant picker. The *content* is unmistakably 5etools; the *design* is anonymous.

The one place bespoke CSS does exist (`charsheet__mc-*`) is the one place that violates the house style.

## Overall Impression

There is a genuinely good system trapped inside a catalog dump. The architecture is right — non-destructive projection, read-time resolution, structured effect data — and the Magic Capacity modal is real craft. But the **picker**, which is where 100% of players actually spend their time, was never designed: it lists 65 options with no way to search, sort, compare, or understand them, and puts the one thing that would help (the before/after diff) somewhere the user isn't looking, behind an event a phone can't fire.

## What's Working

1. **The Magic Capacity modal is the best thing here** (`:1411-1535`). Itemized `+N` breakdown with tabular-num alignment, a plain-language "the rules don't enumerate what counts — override here" escape hatch with a persistent ±1, and an honest inline `🎲 Roll Interference` result. It teaches the concept in place.
2. **The non-destructive projection model pays off in UX, not just architecture.** The preview correctly diffs against the *raw* item (`getItemRaw`, `:1174`), so swapping or removing a material is genuinely safe for 67 of 72 materials. Single most important correctness decision in the feature.
3. **Badge restraint is disciplined.** MC stays neutral until *overloaded*, then goes red (`css:24571-24594`) — "only shout when it costs the player a roll." Correct instinct; it just isn't applied to the 65 indigo Apply buttons.
4. **Modal focus *restore* and Tab trap are properly implemented** (`charactersheet-modal.js:172-207`) — better than most of this codebase.
5. **State encoding already passes the colour-only test.** Every badge carries colour **plus** text, and degradation adds `⚠` and `line-through`. No pure-colour states found.

## Priority Issues

### P0 — The preview is spatially divorced from the choice, and hover-gated (touch users are locked out)
**What:** `renderPreview` paints into a `preview` element appended once at the top (`:1293,1357`); rows update it via `mouseover` (`:1361`) and `focusin` (`:1367`) only. The `.charsheet__material-hover` row is a `<div role="button" tabindex="0">` (`:1344`) with **no click handler** — verified by B: no `keydown`/`keypress`/`keyup` anywhere in the file either. On a long list the diff renders off-screen; at 390px there is no hover event at all, and tapping a material does nothing.
**Why it matters:** the before/after diff *is* the value proposition of this modal. It is unreachable on touch — the table-side use case — and awkward on desktop.
**Fix:** render the preview **inline, expanding under the activated row** (sticky side pane on wide viewports via `@container cs-panel` — B confirms there is currently no `@container`/`@media` for this modal at all). Add `click` + `keydown` (Enter/Space) activation to satisfy the `role="button"` contract you already opted into.
**Command:** `/impeccable adapt js/charactersheet/charactersheet-materials.js`

### P0 — Keyboard and screen-reader users cannot operate the picker
**What:** three compounding defects, all confirmed by both assessments:
- Focus is **never moved into the modal** on open — A verified live `document.activeElement === BODY`. `CharacterSheetModal` restores focus and traps Tab but deliberately leaves focus-in to the caller (`charactersheet-modal.js:18` — *"several of our modals autofocus a search field on open"*); the materials picker never does.
- All **65 Apply buttons have the accessible name "Apply"** (`:1348-1350`), with no material name.
- The icon-only clear button's name is `title=` alone (`:1212`, trash glyph, no `aria-label`) — WCAG H65 explicitly rejects this. Same pattern on the `✦` MC badge (`inventory.js:7503`) and degradation badge (`:1633`), where the *entire* explanation lives in `title=`.
**Why it matters:** WCAG AA in both themes is a stated project rule. A screen-reader user hears "Apply, button" ×65; a keyboard user starts at the page top on every open.
**Fix:** autofocus the (new) filter box on open; `aria-label="Apply {name}"` on each Apply; `aria-label` or `sr-only` text on the clear button; promote the `✦` badge to a real `<button>` with a label, or drop its click affordance and keep the existing action button.
**Command:** `/impeccable audit js/charactersheet/charactersheet-materials.js`

### P1 — 65 options with no search, no filter, no compare, no "good pick" signal
**What:** `showMaterialPickerModal` renders every eligible material into 8 **collapsed-by-default** `<details>` groups. No text input. Preview is strictly one-at-a-time.
**Why it matters:** this is the Recognition heuristic scoring 1/4. A player who knows they want Mithril must hunt; a player weighing Steel vs Darkmetal vs Mithril must hold three stat blocks in their head. For many metals the entire visible difference is `MC 3` vs `MC 1`.
**Fix:** top-anchored filter (name + effect keywords) that doubles as the autofocus target from P0; keep accordions as the empty-query grouping; add sort (Dmg / AC / MC); a "pin to compare" toggle letting 2-3 previews sit side by side closes the compare gap.
**Command:** `/impeccable shape "material picker: search, sort and compare across 65 options"`

### P1 — Destructive and irreversible actions are unflagged and un-undoable
**What:** Apply commits instantly and closes (`:1389-1392`) — no confirm, no undo. Materials with a `degradation` block that can *destroy* the item (Ordinary Glass, Rimeglass) carry **no risk indicator at decision time**; the data is authored but the picker never surfaces "can shatter."
**Why it matters:** you built a non-destructive model precisely so mistakes are cheap — and then gave the one genuinely destructive choice the same silent treatment as Steel. This is the peak-stakes moment and it has the least reassurance.
**Fix:** surface `⚠ Fragile — can be destroyed` in the summary/preview for any material with a destroying `degradation` block; fire an undo toast after Apply with a Revert button calling `clearItemMaterial`. You already have the toast pattern in `notifyOverloadedItemsOnRest`.
**Command:** `/impeccable harden js/charactersheet/charactersheet-materials.js`

### P1 — Four contrast pairs fail WCAG AA, one badly
**What:** B computed these from the real token values (alpha-composited):

| Pair | Theme | Ratio | Verdict |
|---|---|---|---|
| `.text-danger` degradation paragraph (`inventory.js:6089`) | night | **2.50** | ❌ hard fail |
| MC badge OVER text | night | **4.19** | ❌ |
| MC badge OVER text | day | **4.14** | ❌ |
| Degradation DESTROYED text | night | **4.09** | ❌ |
| Degradation DESTROYED text | day | **4.03** | ❌ |
| Degradation WORN text | day | 4.58 | ⚠ marginal |

Root cause of the badge failures: `.charsheet__item-mc-badge--over` hardcodes `rgba(239,68,68,.12)` (old `#ef4444` channels) while `--cs-danger` now resolves to `#f26161` night / `#dc2626` day — the tint and the text are no longer the same hue. The 2.50:1 case is Bootstrap's `#a94442 !important` never being overridden for night mode.
**Why it matters:** these are exactly the states that exist to warn the player, and they are the least legible things on the row.
**Fix:** derive badge tints from the `--cs-danger`/`--cs-warning` tokens via `color-mix()` instead of hardcoded rgba; add a night-mode override for `.text-danger` inside the character sheet scope; nudge the danger token or drop tint alpha until both themes clear 4.5:1.
**Command:** `/impeccable colorize css/charactersheet.css`

### P2 — The materials CSS breaks two named DESIGN.md rules
**What:** (a) **No-Stripe** — five colored accent `border-left`s: `.charsheet__mc-headline` `4px solid` + `--over` (`css:24631,24635`), `.charsheet__mc-result` + `--pass`/`--fail` (`:24674,24678,24683`). These are the *sole* visual status indicator on those cards. (b) **One Voice** — 65 `ve-btn-primary` Apply buttons (`:1348`) means nothing reads as primary. Note the JS itself is clean of inline stripes; the violation is purely in CSS.
**Why it matters:** the badges four lines away already do this correctly with a full 1px border + tint (`:24590-24594`). The system is being exempted from its own house style for no reason.
**Fix:** replace the stripes with border + tint, matching the badge treatment; make Apply buttons `ve-btn-default` and reserve indigo for the currently-applied row and focus ring.
**Command:** `/impeccable polish css/charactersheet.css`

### P2 — Internal keys and irrelevant axes leak into user-facing copy
**What:** MC modal renders the raw key `bonusWeapon` as display text (`countMagicalEffects:868` → `:1454`). `getSummary` shows every axis regardless of item kind → "AC" on weapons, damage dice on shields. Current-material and preview headers print the identical line twice (`:1206-1210` vs `:1318`).
**Why it matters:** it reads as a debug view, and it actively misinforms — "AC 19" on a longsword is a stat the player cannot use.
**Fix:** map effect keys to labels ("Weapon +3"); make `getSummary` item-contextual; drop the duplicated header when the previewed material is the applied one.
**Command:** `/impeccable clarify js/charactersheet/charactersheet-materials.js`

### P3 — Dead-end affordances and layout papercuts
Rootstone's affinity reads "dormant — applies only as the protective layer," but `getAvailableRoles` (`:270-274`) only offers *Striking surface* / *Spellcasting focus* on a weapon — the wakeful role is unreachable, so the UI dangles a benefit that can never be claimed. The applied material's accordion opens at the *bottom* of the list, forcing a scroll past 7 collapsed groups. Clear-material (red trash) and modal-close (✕) stack in the same top-right corner — mis-tap risk on mobile. No empty/loading state while the 72-item catalog loads asynchronously.

## Persona Red Flags

- **The player at the table on a phone.** The preview is hover-gated and pinned off-screen; tapping a material does nothing; Apply commits with no confirm; the clear-trash sits under the ✕. **This persona is effectively locked out of the core feature** while being the most likely to use it.
- **The keyboard / screen-reader player.** Focus never enters the modal, 65 identical "Apply" names, an unreachable `✦` roll, `title=`-only explanations. Fails the project's own stated AA bar.
- **The new player who hasn't read the homebrew doc.** `MC`, `✦ 4/1`, `−∞`, "condensate role," "AC 19 on a sword," and a permanently-dormant Rootstone affinity give them no way to distinguish a good choice from a trap. The system assumes 678 lines of prerequisite reading.

## Minor Observations

- Inventory rows duplicate each fact as both a detail pill and an action button (`inventory.js:7502/7621`, `7503/7625`) — two of the same thing per row.
- Detector findings on `charactersheet.html` (`overused-font` Inter :27; `broken-image` :413, :1600) are **out of scope and benign** — the images are `.ve-hidden` portrait placeholders that receive `src` on upload; Inter is a deliberate `--cs-font-body` choice.
- The wider `charactersheet.css` has 34+ raw `z-index` values against a `--cs-z-*` scale used at exactly one call site — the materials block itself is clean, but the scale is effectively unenforced project-wide.
- Single-hyphen `--rgb-*` fallbacks (undefined, fail silently) appear ~38 times elsewhere in `charactersheet.css`; the materials block is clean of them.
- Native `<details>`/`<summary>` and `CharacterSheetModal`'s Tab trap are both correctly keyboard-operable — credit where due.

## Questions to Consider

1. If the entire value of this modal is a before/after diff, why does it render where the user isn't looking — and why is it gated behind an event a phone can't fire?
2. Sixty-five options, no search, no compare, no "recommended for this item" signal: is this a *chooser*, or a catalog dump with Apply buttons attached?
3. You built the non-destructive model specifically so mistakes are cheap. So why is there no Undo — and why does Ordinary Glass, which can delete the item, get the same silent Apply as Steel?
4. `docs/21-item-materials.md` is 678 lines of design intent. How much of it survives to a player who only ever sees `✦ 4/1` and `MC −∞`?
5. The DESIGN.md this repo ships bans colored accent stripes and rations indigo. The materials CSS does both. Is this system held to the house style, or exempt from it?
