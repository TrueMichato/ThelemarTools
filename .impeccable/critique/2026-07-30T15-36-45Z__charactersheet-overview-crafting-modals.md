---
target: charactersheet overview + crafting modals
total_score: 20
max_score: 40
na_heuristics: 
p0_count: 2
p1_count: 3
timestamp: 2026-07-30T15-36-45Z
slug: charactersheet-overview-crafting-modals
---
Method: dual-agent (A: `assessment-a` design review · B: `assessment-b` detector + browser evidence)
Target: Character Sheet **Overview tab** + **Harvest** and **Craft** modals · Mode: **Operate** · Renders: level-8 Hunter Ranger, day theme, 1440×1000 and 390×844

---

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 2 | Harvest outcome is an auto-dismissing toast with no roll math; the "holding N" cell never refreshes (dead code, `charactersheet-crafting.js:256–260` queries `.cs-crafting__held`, a class nothing renders); "6 harvestables" when 3 rows have no DC and cannot be rolled |
| 2 | Match System / Real World | 2 | `HHHVI` / `HHHVII` / `CC` / `Ar8` are raw database tokens shown to players with no expansion or tooltip; creature-first harvest premise is correct |
| 3 | User Control and Freedom | 2 | Neither modal shows a close affordance; focus is **not** restored to `#charsheet-btn-harvest` on Escape (measured); no `role="dialog"`, no `aria-modal`, no accessible name |
| 4 | Consistency and Standards | 1 | Modal interiors render 100% **Arial** — none of the sheet's typography reaches them; Heal/Damage use Bootstrap `#5cb85c`/`#d9534f`, not `--cs-success`/`--cs-danger`; 16 undefined `--rgb-*` vars used without fallback |
| 5 | Error Prevention | 3 | Genuinely good: last-component spell-reagent warning, dangerous-harvest opt-in gate, Roll disabled when no DC. Undercut by 378 primary-styled "Craft" buttons on recipes you cannot craft |
| 6 | Recognition Rather Than Recall | 2 | 25 sibling `<h4>`s with no hierarchy; the three-band craft model is never explained; emoji-only jump legend (🏃/🧍) |
| 7 | Flexibility and Efficiency | 3 | Search-as-you-type, `creatureName` prefill, filter-by-material entry, rolls routed through the real `_rollSkillCheck` with the roll log |
| 8 | Aesthetic and Minimalist Design | 1 | Harvest modal: 6 rows in a ~1090px-tall white void (~70% empty); Craft auto-expands a 378-row band; 3 of 7 harvest columns are all em-dashes; Overview is 8,926px tall on mobile |
| 9 | Error Recovery | 2 | "The Owlbear Liver was ruined" is honest but ephemeral; no retry affordance, no roll shown, no undo on craft |
| 10 | Help and Documentation | 2 | Advisory tooltips (crafter proficiency, Hamund's Prof rule) are good; nothing explains the bands, the source codes, or the empty columns |
| **Total** | | **20/40** | **Needs work** |

Split score, because the target is not one thing: **the Overview alone would land ~28/40; the two crafting modals land ~13/40.** They are not the same quality of work and should not be read as one number.

---

## Design Specificity Verdict

**LLM assessment.**

**Overview — authored, and genuinely for D&D in play.** This is not category-interchangeable admin UI. The numerals are loud (AC **12**, INIT **+2**, ability mods in pill chips), the labels are quiet, colour is rationed and *means* something. The RANGER panel renders Primal Focus / Focused Quarry as real game text with a Predator/Prey toggle, not a generic "class features" accordion. Someone made decisions here. It reads as a character sheet from three feet away.

**Harvest — authored premise, generic execution.** The idea is exactly right and exactly table-specific: something died, what comes off it. The rendering is a plain 7-column HTML data grid floating in a full-bleed white sheet. Strip the emoji and it is a SKU table. The premise knows it is D&D; the pixels do not.

**Craft — the most generic of the three, and it is losing a fight with its own data.** Three collapsible bands over a 456-recipe catalogue. The honest answer to "what can I make?" is *nothing* — "Ready to craft **(0)**" — and the UI buries that under **"Missing one ingredient (378)"**, auto-expanded. That is a spreadsheet with a search box.

**Deterministic scan.** `detect.mjs` on `charactersheet.html`: exit 2, 4 findings — `overused-font` (Inter, factual not a bug), two `broken-image` on the src-less portrait placeholders (`charactersheet.html:413`, `:1568` — both carry `ve-hidden` and are populated at runtime; **false positives**), and `em-dash-overuse` (20 in body text, but these are embedded D&D source strings; **false positive**). `charactersheet-crafting.js`: exit 0, clean. The static detector found essentially nothing — the real damage is all in computed styles and layout, which is why the browser pass mattered more here.

**Browser measurements** (both viewports). No user-visible overlay was injected; findings below are measured numbers, not an on-page overlay. 0 JS errors and 0 page errors on load and on opening both modals — only 4 benign data warnings about orphan `BookOfEbonTides` subraces. The code is healthy; the design is not.

One thing the detector and I disagreed on: the deterministic contrast probe reported five 1.00:1 white-on-white pairs ("LVL", "100%", "Heal"). Those are **probe artifacts** — the ancestor walk missed the coloured backgrounds. I checked the render: the LVL badge is indigo, the HP bar is green. But the probe's *other* numbers hold up and are real: white on `#5cb85c` = **2.48:1**, white on `#d9534f` = **3.96:1**, `#777` on `#eef1f6` = **3.96:1**. 52 AA failures on the Overview at desktop, 51 at mobile.

---

## Overall Impression

The Overview is a good sheet trapped in a bad document. The crafting modals are a good idea trapped in a table.

The single biggest opportunity is not a redesign — it is **ordering**. Every serious problem below is the same problem wearing a different hat: *nothing decides what matters most.* The Overview stacks 25 equal-weight panels in code order. The harvest table gives a 50gp Owlbear Neck the same visual weight as valueless Owlbear Claws. The craft workbench leads with 378 things you cannot do. Three surfaces, one missing act of editorial judgement.

---

## What's Working

1. **Materials are ordinary inventory items, not a parallel ledger.** `_addMaterialToInventory` writes into `_data.inventory` via the same path as any other item, so a harvested Aboleth Eye disappears from the spell-component picker the moment it is crafted, with zero sync code. Invisible to the player, and exactly right — it kills a whole class of "my sheet says I have it but I can't use it" bugs.
2. **The last-component warning** (`pCommitCraft`, lines 489–501). Before consuming an ingredient it checks whether this is your last one *and* whether it is a spell reagent, then names the spells it enhances. That is authored empathy for a real regret. It is the best micro-interaction in all three surfaces.
3. **Harvest rolls go through the real `_rollSkillCheck`.** Proficiency, exhaustion, conditional modifiers, advantage from active states, and the roll log all come along. A local `d20` would have looked identical and been quietly wrong. Someone resisted the shortcut.

---

## Priority Issues

### [P0] Mobile Overview buries current HP 4 screens down

**What:** At 390px the Overview is **8,926px tall — 10.6 viewport-heights.** Measured DOM order: Ability Scores (y=731) → Senses (1212) → Saving Throws (1365) → Passive Scores (1724) → **Skills (1919, and the panel alone runs 2,539px — three full screens)** → current HP at **y=3,408** → Resources at **y=6,127** → the Ranger Primal Focus toggle at **y=6,415**.

**Why it matters:** The north star is a player glancing down for two seconds mid-encounter. To see their own hit points they scroll four screens; to spend Stamina or flip Predator/Prey, seven. The lowest-urgency content on the page — a 24-row reference table of skills — is second, and consumes 30% of the document. This isn't a layout that needs tuning; on mobile there is no layout at all, just the desktop columns concatenated.

**Fix:** Give the stacked layout an explicit `order` that leads with a vitals cluster (HP + AC + conditions + resources + the class panel), then actions, then reference tables last. Or ship a compact vitals strip that sticks to the top when the columns stack. Skills and Passive Scores go to the bottom, collapsed by default.

**Suggested command:** `/impeccable adapt`

### [P0] Craft opens on 378 things you cannot make

**What:** "Ready to craft **(0)**" with an empty state, immediately followed by **"Missing one ingredient (378)"**, auto-expanded and unbounded. Filtered to "potion" it is still 38. Every row carries a filled indigo primary `🔨 Craft` button — 378 primary buttons for actions that cannot succeed. The list is dominated by tier-variants of the same handful of items (+1/+2/+3 Dragon Arrow, +1/+2 Dragon Bolt, +1/+2 Dragon Wand…) with no grouping, and it is sorted by neither "closest to craftable" nor value — it opens on Young Dragon Tooth recipes for a level-8 ranger.

**Why it matters:** A player opens the workbench to answer one question: *can I make anything right now?* The honest answer is "no." The UI answers with 378 rows of no. That is the opposite of a two-second glance, and 378 primary buttons destroy the meaning of "primary" everywhere else on the sheet.

**Fix:** When "Ready to craft" is empty, lead with the empty state and stop. Collapse "Missing one ingredient" by default, cap it at 3–5, sort by cheapest/most-obtainable missing ingredient, and surface *the one thing you need* as the row's headline: *"+1 Dragon Arrow — you need 1× Young Dragon Tooth."* Group tier-variants under their base item. Demote the button on unmakeable rows to secondary.

**Suggested command:** `/impeccable distill`

### [P1] Both modals lose the sheet's entire typography — including the dyslexia font

**What:** Measured computed `font-family` inside both modal interiors: **Arial, 100% of elements.** Root cause is a scoping bug, not a taste call — `charactersheet.css:1511` applies the font as `.charsheet-page[data-font] .tab-content`, a descendant selector, and `data-font` is set on the `.charsheet-page` element (`charactersheet.js:10227`). `UiUtil.pGetShowModal` portals the dialog to `document.body`, **outside that subtree**, so nothing cascades in.

**Why it matters:** This is not just off-brand. The font picker offers **Atkinson Hyperlegible** — a face people choose because they need it. A user who selected it for dyslexia gets Arial the moment they open Harvest or Craft. An accessibility setting that silently stops working inside a dialog is worse than not offering it.

**Fix:** Move the font/scale custom properties to `:root` (or `body.is-charsheet-page`, which already exists as a scope in `charactersheet-mobile.css`) and have `.ve-ui-modal__inner` consume them, so any portaled surface inherits. Verify with the same computed-style probe.

**Suggested command:** `/impeccable harden`

### [P1] The harvest modal is 70% empty void, and its table is mostly em-dashes

**What:** `isHeight100 + isWidth100 + isUncappedHeight` (lines 155–157) forces a near-full-viewport modal for 6 rows of content. In the owlbear render, ~1,090px of the modal is blank white. Within the table, **3 of 7 columns are entirely em-dashes** (Time on all 6 rows; DC and Value on 3 each), and the 3 rows with no DC have disabled Roll buttons with no explanation — so "6 harvestables" is really 3. On mobile the craft modal is simultaneously **clipped mid-row** *and* followed by ~200px of dead white.

DESIGN.md §5 is explicit: *"Modal sizes to content by default … a content-light modal never opens a fixed-height void,"* and §6: *"Don't reach for a modal first."* Both are violated.

**Why it matters:** The void reads as a loading failure. The dash-filled columns spend a third of the table's width on nothing, while the one thing a player actually wants — *the 50gp Owlbear Neck at DC 20* — sits in row 3 with no emphasis.

**Fix:** Drop `isHeight100`/`isUncappedHeight` and size to content with an internal scroller for long results. Drop columns that are empty for the whole result set. Sort rollable rows above unrollable ones, and say why the rest cannot be rolled ("no harvest DC recorded"). Give value its own visual weight.

**Suggested command:** `/impeccable layout`

### [P1] Both modals are inaccessible as dialogs

**What:** Measured on the modal wrapper: `role` = `null`, `aria-modal` = `null`, no `aria-label`/`aria-labelledby`. Focus *is* moved into the search input on open (good), but after Escape `document.activeElement` is **not** `#charsheet-btn-harvest` — focus is not restored. No close button exists in either modal, so Escape is the only exit and nothing advertises it. With "dragon" searched there are 40 focusable elements and **39 Roll buttons that all share the accessible name "Roll"**; in Craft, 44 buttons all named "🔨 Craft". Roll buttons measure **26.7×20px** on mobile — under both the 44px and even the 24px minimum. 111 of 125 interactive elements on the Overview are under 44×44; 60 are under 24×24, including 13×13px death-save checkboxes and 14×14px proficiency cycle dots.

**Why it matters:** A screen-reader user hears "Roll, Roll, Roll" 39 times with no way to know which material. A keyboard user cannot tab-trap or find the exit. A player tapping a 26×20 target under the table will misfire — and misfiring here consumes a material.

**Fix:** `role="dialog"` + `aria-modal="true"` + `aria-labelledby` on the modal title; restore focus to the trigger in the close callback; add a visible Done/close control. Give each Roll button `aria-label="Roll Harvesting for Owlbear Neck, DC 20"`. Raise the Roll/Craft hit area to 44px minimum (padding, not font size). Fix the death-save and proficiency targets while you are in there.

**Suggested command:** `/impeccable audit`

---

## Persona Red Flags

**Player on a phone, under the table (the actual usage scene).**
- Scrolls **4 screens** to see current HP, **7** to spend Stamina or flip Primal Focus. Every turn.
- Roll buttons are 26.7×20px. Misfires cost materials.
- In Craft, "Potion of Bravery" reflows so the **Craft button drops to its own line, orphaned from the recipe it belongs to** — the chips wrap up onto the title line and break the association.
- The craft modal is clipped mid-row at the bottom *and* has 200px of dead space beneath it, with the bottom tab bar still fully visible and apparently live underneath a modal.

**First-time character-sheet user.**
- Opens Craft, reads "Ready to craft (0)" then "Missing one ingredient (378)". Reasonable conclusions: "this is broken," or "I will never craft anything."
- `HHHVI`, `HHHVII`, `CC`, `Ar8`, `Prof +5` — no legend, no tooltip they would know to hover.
- Chips use one amber for two unrelated axes: `Blacksmith` (a category) and `Prof +4` (a gate you fail) are styled identically, while `Uncommon` (rarity) is grey. The only chip that means "you can't do this" is invisible among the ones that don't.
- The Overview is 25 identical white cards with 25 sibling `<h4>`s and no H1–H3 anywhere. Nothing says where to start.

**Weekly power user (the target audience).**
- Best served — prefill, filter-by-material, roll-log integration all reward fluency.
- Their specific breakage: roll twice for the same material and the "holding N" count stays stale until the modal is reopened, because the refresh at lines 256–260 targets a class that is never rendered.
- Their font choice and text-size preference silently stop applying the moment they open Harvest.

---

## Minor Observations

- **Bans check, mostly clean.** No colored side-stripes in `.cs-crafting__*`; chips are full border + tint, per the No-Stripe rule. No Cinzel on any button, chip or data label (35 Cinzel elements, all headings/display). No invented z-index inside the surfaces (breakdown tooltips at 100; the shared modal layer at 1000/1001).
- **`ve-flex-h-between` is fully gone** — 0 hits across `js/`, `css/`, `scss/` and 0 in the rendered DOM. That silent-no-op class has been cleaned up since it was last noted.
- **16 undefined CSS custom properties are still in use without fallbacks**, including `--rgb-bg-alt` (`.charsheet__section-header`), `--rgb-text` (`.charsheet__section-title`), `--rgb-border` (`.charsheet__hitdice-adjust`), `--rgb-text-dim` (`.charsheet__prof-value`), `--rgb-link` (`.charsheet__ability:hover`). Each one silently drops its whole declaration.
- **Heal/Damage buttons are off-system**: `#5cb85c` and `#d9534f` are Bootstrap 3 legacy, not `--cs-success` (`#10b981`) / `--cs-danger` (`#f26161`). Both fail AA as white-on-fill (2.48:1 and 3.96:1).
- **`text-overflow: ellipsis` is inert on two inputs** (`#charsheet-ipt-name`, `#charsheet-portrait-input`) — `overflow: clip` blocks it. The character name truncates to "Human Hunter Rang…" in the identity card anyway.
- **The identity card says the same thing three times**: title "Human Hunter Ranger 8", LVL 8 badge, and a `CLASS Ranger 8` chip.
- **The Resources panel clips a row mid-glyph** at the bottom of its scroll area, with no fade or scroll affordance — it reads as a rendering bug.
- **Two of the three vitals cards are permanently zero** for most characters: "TEMP HP 0 / Absorbs damage first" and "MAX HP REDUCTION 0 / No reduction" take two-thirds of the vitals row to say nothing.
- **`#charsheet-speed-breakdown` protrudes 9px past the 390px viewport edge.**
- **The same owlbear part appears twice** ("Owlbear Feathers (large bag)" from HHHVI, "Owlbear Feathers" from CC) without the "also in another book" label firing, because the names differ slightly. The disambiguation code exists (lines 203–207) but its exact-name match misses.
- **The dangerous-harvest failure path is better designed than the ordinary one** — a real dialog naming the consequence, versus a vanishing warning toast for the common case.

---

## Questions to Consider

1. If the honest answer to "what can I craft right now?" is *nothing* for most characters most of the time, is a browsable **workbench** the right metaphor at all — or should Craft be a notification that fires *when a harvest completes the last ingredient*, replacing a 456-row catalogue with a moment?
2. The Overview renders 25 panels in fixed code order regardless of class, level, or what is actionable this turn. Is "whatever applies, stacked" a layout, or the absence of one? Would a Ranger and a Wizard want the same top-of-fold?
3. Every outcome in these flows — harvested, ruined, crafted — is a toast that vanishes in seconds. In a game built on memorable rolls, what has the design decided to make forgettable, and is that the right call for the peaks?
4. The harvest table gives a 50gp Owlbear Neck the same weight as valueless Owlbear Claws. Do players want a *table*, or do they want "here's the one thing worth rolling for"?
5. Two dialogs are the only places on this sheet where a user's chosen accessibility font stops working. How many other portaled surfaces inherit that same scoping bug — and what is the rule that prevents the next one?
