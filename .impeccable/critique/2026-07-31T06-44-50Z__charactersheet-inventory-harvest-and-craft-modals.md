---
target: charactersheet inventory harvest and craft modals
total_score: 18
max_score: 40
na_heuristics: 
p0_count: 2
p1_count: 2
timestamp: 2026-07-31T06-44-50Z
slug: charactersheet-inventory-harvest-and-craft-modals
---
Method: dual-agent (A: `assessment-a-1` design review · B: `assessment-b-1` detector + browser evidence)
Target: **Harvest** and **Craft** modals, launched from the Inventory tab · Mode: **Operate** · Renders: spawned Ranger/Hunter 8, day theme, 1440×1000 and 390×844

---

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 2 | The "· holding N" counter **never refreshes after a successful roll** — `charactersheet-crafting.js:258` queries `.cs-crafting__held`, a class nothing renders (the span at `:242` is `ve-muted ve-small`). Dead code. "Ready to craft **(0)**" — the actual answer — is the smallest thing on screen. |
| 2 | Match System / Real World | 2 | `HHHVI` / `HHHVII` / `Ar8` / `CC` shipped raw to players via `Parser.sourceJsonToAbv` (`:246`), no legend, no tooltip. Rarity chips are grey outlines — D&D has a canonical rarity colour language and this ignores it. Creature-first harvest premise is exemplary. |
| 3 | User Control and Freedom | 1 | **Escape is a no-op on open** (verified live): both modals end with `iptSearch.focus()` (`:192`, `:391`), and `utils-ui.js:672` bails `if (EventUtil.isInInput(evt))`. **No close X** — `utils-ui.js:557` only renders one when `isFullscreenModal`, which neither call passes. No focus trap. On close, focus lands on `<body>`, never back on the trigger. No undo on a consumed material or a ruined harvest. |
| 4 | Consistency and Standards | 1 | **100% of modal text renders in Arial** at both viewports — the modal is portalled to `body`, outside `.charsheet-modern`. Muted text uses site `#777`, not `--cs-text-muted`. And indigo primary is on **378 buttons you cannot press** — the One Voice Rule inverted. |
| 5 | Error Prevention | 3 | Genuinely good, and the best thing here: last-component spell-reagent warning (`:499`), dangerous-harvest opt-in gate (`:304`), Roll disabled when DC is null (`:235`), Cancel in the commit dialog. Undercut by the 378 false-affordance Craft buttons. |
| 6 | Recognition Rather Than Recall | 2 | Inline `held/qty` (`:450`) is good. But both modals are **search-only with no browse**, band headers scroll away with no sticky context, and nothing explains the three-band model, the DC ladder, or the source codes. |
| 7 | Flexibility and Efficiency | 2 | Search-as-you-type, `creatureName` prefill, rolls routed through the real `_rollSkillCheck` + roll log. But **5,654 DOM nodes rebuilt on every keystroke** (456 recipe subtrees), no filters, and search hides its own answer. |
| 8 | Aesthetic and Minimalist Design | 1 | Harvest: 800×790 modal, table ends at ~455px → **~42% empty white**. Value column is em-dash on 8 of 13 rows, Time on 10 of 13. Craft auto-expands a 378-row band. |
| 9 | Error Recovery | 2 | "The Aboleth Brain Lobe was ruined." (`:311`) is honest but is a 3-second toast on a 1,600 GP loss. No roll shown, no retry, no undo. |
| 10 | Help and Documentation | 2 | Chip tooltips (crafter proficiency, Hamund's Prof rule, "also in another book") are thoughtful. Nothing explains bands, codes, workweeks, or the empty columns. |
| **Total** | | **18/40** | **Needs work** |

---

## Design Specificity Verdict

**LLM assessment.**

**Harvest — the premise is authored, the pixels are not.** The best decision in this feature is that harvest is *creature-first*. The comment at `charactersheet-crafting.js:143-147` says it outright — "something died, and the player wants to know what comes off it… a corpse is not a loot-all button." That is a product-specific model no generic inventory app would arrive at, and the empty state ("Search for the creature you just felled") reinforces it rather than saying "No results."

Then it renders as a 7-column SKU table. Search "aboleth" and you get 13 rows for roughly 7 distinct body parts — *Aboleth Teeth (large bag)* sits four rows above *Aboleth Teeth*; *Aboleth Mucus (3 vials)* above *Aboleth Mucous*; *Aboleth Eye* appears twice at DC 17 and DC 20 with different values. The code knows (`:206`, the `isTwinned` logic) and labels them "· also in another book" in 10.2px grey at 4.48:1. Knowing about the duplication and rendering it anyway is not a fix; it's a footnote on a problem.

Worse, the table is **sorted by DC** — i.e. by difficulty, not by worth. The 1,600 GP Brain Lobe is row 7 of 13, visually identical to the valueless Aboleth Hide two rows below it. The one number that decides "is this worth my turn?" is in a column that's blank on 8 of 13 rows.

**Craft — the model is right and the surface actively fights it.** Three readiness bands (`:379-381`) are the correct answer-first IA for a 456-recipe catalogue. But on open the truthful answer is "Ready to craft **(0)**", and the UI responds by auto-expanding **"Missing one ingredient (378)"** (`isOpen: ready.length === 0`, `:380`) where every ingredient reads `0/1`. The label promises "you're one thing away"; the reality is you have nothing. That is not clutter — it is a **false model of the user's position**, which is the most expensive kind of design error, because the user acts on it.

And the search hides its own result. Type "sword": the only rendered band is `Everything else (1)`, **collapsed** (`isOpen: false`, hard-coded at `:381`). You searched, the tool found exactly one match, and then closed a drawer over it.

**Joint verdict: strong task model, interchangeable furniture.** Strip the emoji off either modal and you have generic admin CRUD — dense tables, outline pill chips, disclosure accordions, a search box, and a modal shell with no dialog semantics. Nothing about the *rendering* knows it is a D&D character sheet. The thinking is specific; the surface is not.

**Deterministic scan.** `detect.mjs` on `charactersheet.html`: exit 2, 4 findings — `overused-font` (Inter, the committed body face — **false positive**), two `broken-image` on `ve-hidden` runtime-populated portraits at `:413` and `:1568` (**false positives**), `em-dash-overuse` on static form labels (**false positive**). `charactersheet-crafting.js`: **exit 0, clean.** None of the four touches the modals. The static detector found nothing here because none of the damage is static — it is all computed style, runtime layout, and information architecture. 0 JS errors and 0 pageerrors across load and every modal interaction; the only console noise is 4 unrelated `BookOfEbonTides` orphan-subrace warnings. **The code is healthy. The design is not.**

**One correction to our own DESIGN.md.** The doc warns that single-hyphen `--rgb-*` spellings are undefined and silently drop the declaration. Assessment B verified at runtime that the compatibility alias block at `charactersheet-modern.css:214-257` is scoped to `body.is-charsheet-page`, which **does** cascade into body-portalled modals — `--rgb-text-muted` resolves to `#5b6675` on `body`. The crafting stylesheet (`charactersheet.css:22099-22213`) is separately clean: `--cs-*` only, every one with a fallback. **Zero declaration-drops in this scope.** The rule is still right for new code; the alarm doesn't apply here.

**Visual overlays.** None. Script injection was confirmed *possible* (`titleMutable: true`, `scriptInject: true`) but no overlay was rendered — this ran headless in a background agent with no human watching the tab. No user-visible overlay exists; the findings above are measured numbers and screenshots (`/tmp/impec-b/*.png`), not an on-page overlay.

---

## Overall Impression

Two modals built by someone who understood the *game* problem well and then reached for the nearest table.

The single biggest opportunity is not visual — it is **editorial**. Every serious issue below is the same failure wearing a different hat: *nothing here decides what matters.* Harvest gives a 1,600 GP Brain Lobe the same visual weight as a valueless Hide and sorts by DC. Craft leads with 378 things you cannot make and buries the honest "(0)". The search finds one answer and collapses it. Three surfaces, one missing act of judgement — and it is a judgement the code already has the data to make.

The second opportunity is that **these probably shouldn't be modals.** DESIGN.md says "Don't reach for a modal first." A persistent Inventory sub-pane would let held materials and craftable recipes coexist on one surface, kill the entire accessibility block below, and remove the context-switch that currently makes you close the dialog to check what you're carrying.

---

## What's Working

1. **Creature-first harvest (`:148-193`).** It matches the actual cognitive trigger at the table. The difference between a tool that fits the hand and one you translate into. Rare, and worth protecting through any redesign.

2. **Materials-as-inventory invariant + the last-component warning (`:20-23`, `:488-501`).** Harvested and crafted goods are ordinary inventory items, so a component spent on a craft vanishes from the spell-cast picker with zero glue code — and the commit dialog names the exact spell you'd lose *before* you commit. That is product-specific safety engineering, and it prevents a whole class of "where did my casting component go?" bugs at the source. This is the best-designed moment in the feature.

3. **Advisory chips that teach the rules (`:443-446`).** "Needs Alchemist's Supplies — you're not proficient", "Hamund's optional Crafter Skill rule wants +5; yours is +4". These carry real rules literacy in a tooltip without lecturing, and they correctly use the day-mode `-text` ink tokens. The *content* of these chips is excellent; only their visual encoding lets them down.

---

## Priority Issues

### [P0] The modal shell is not operable without a mouse
**Why it matters:** Verified live — focus auto-lands in the search input (`:192`, `:391`), and `utils-ui.js:672` skips Escape while focus is in an input, so **the reflexive close gesture does nothing on open**. There is no visible X, because `utils-ui.js:557` only renders one when `isFullscreenModal` is passed, and neither call site passes it. There is no `role="dialog"`, no `aria-modal`, no accessible name, no label on the search input, no `<th scope>` on the 7-column table, and no focus trap — Tab walks straight out into the inventory behind. On close, focus is dumped on `<body>`, not returned to `#charsheet-btn-harvest` / `#charsheet-btn-craft`. A screen-reader player is never told a dialog opened; a keyboard player can't close it and loses their place when it does. This is a WCAG 2.1 AA failure on a surface PRODUCT.md commits to AA.
**Fix:** Pass `isFullscreenModal` (or inject a close control into `.cs-crafting`); add `role="dialog"` + `aria-modal="true"` + `aria-labelledby` on the title; label the search input; move initial focus to the dialog container rather than the input, or add a local Escape handler on the input; trap Tab; restore focus to the trigger on close.
**Suggested command:** `/impeccable harden`

### [P0] Craft opens on a lie and hides its own search results
**Why it matters:** Measured: `Ready to craft (0)` · `Missing one ingredient (378)` **auto-expanded** · `Everything else (78)` collapsed — 456 recipe subtrees and **5,654 DOM nodes**, rebuilt synchronously on every keystroke. Every ingredient in the expanded band reads `0/1`. A first-time player reads "missing one ingredient, 378" as "I'm nearly there on 378 items," which is the exact opposite of true. Then they search "sword" and the single match renders inside a **collapsed** `Everything else (1)` — the tool found the answer and shut a drawer on it (`isOpen: false` hard-coded, `:381`).
**Fix:** Collapse "Missing one ingredient" by default and show the count only. Auto-open whichever band contains the current search match. Relabel it to what it is — a shopping list — and make it actionable ("harvest X" / "buy X"). Cap or virtualise the long bands; don't materialise 456 subtrees to show 20.
**Suggested command:** `/impeccable distill`

### [P1] Indigo primary on 378 buttons you cannot press
**Why it matters:** The most repeated visual element in the Craft modal is a full-strength `ve-btn-primary` "🔨 Craft" attached to a recipe with `0/1` ingredients. DESIGN.md rations indigo to primary action, current selection, and focus; here it marks the action that is *unavailable*, 378 times. The disabling only happens after you click into the commit dialog (`:522`) — so the row button is a false affordance that costs a click and a modal to discover. Meanwhile the rarity chip, which is the single most decision-relevant attribute on the row, is a `rgba(15,23,42,0.12)` outline measuring **~1.2:1** against white — below the 3:1 minimum for non-text UI components, and effectively invisible in the screenshots.
**Fix:** Ghost/disable the row button when `nMissing > 0`. Vacate indigo for the rows in "Ready to craft". Give rarity a real encoding — D&D already has one — and raise the chip border to clear 3:1.
**Suggested command:** `/impeccable colorize`

### [P1] Loss-bearing actions are delivered with the ceremony of a notification
**Why it matters:** A failed Harvesting check destroys the part. You click a 26.7×20px blue "Roll" identical to the twelve others, and find out afterward from a 3-second warning toast: `The Aboleth Brain Lobe was ruined.` (`:311`) — no roll shown, no retry, no undo, on a 1,600 GP loss. The inverse is also unbalanced: crafting a Very Rare item, potentially the payoff of weeks of in-fiction labour, resolves to `🔨 Crafted X` (`:532`) and vanishes. By peak-end logic the design under-rewards its biggest moment and under-warns its biggest loss. The cooking flow already gets this right (`:573-580`) with a rendered outcome modal and "Serve it" — the pattern exists in-house and isn't reused.
**Fix:** Restate the stake before a high-value destructive roll, the way the craft commit dialog already does. Show the roll and the DC in the result, not just the verdict. Give the successful craft the cooking flow's outcome moment. Offer an undo toast on a consume.
**Suggested command:** `/impeccable delight`

### [P2] Neither modal responds to its container, and every target is too small to tap
**Why it matters:** At 390px the 7-column harvest table is crammed into 390 CSS px — "Piece of Aboleth Tentacle" wraps to two lines, "1,600 GP" wraps, column widths go unstable row to row, and the bottom row's Roll button clips at the container edge. In Craft at 390 the button wraps to a second line at a *different vertical offset per row* depending on how many chips preceded it, so the primary action moves as you scan. Measured hit targets: Roll **26.7×20**, Craft **56.3×22** — **13 of 14** interactive elements in Harvest and **44 of 47** in Craft are under 24px tall, against a 44×44 AA target-size recommendation. DESIGN.md's Container-Adaptive Rule asks panels to respond to container width; these respond to nothing.
**Fix:** Below ~480px, transform the harvest table into stacked rows (name + DC + value as a unit, Roll as a full-width action). Give Craft rows a fixed two-column grid so the action button holds one position. Raise every touch target to at least 44px on coarse pointers.
**Suggested command:** `/impeccable adapt`

---

## Persona Red Flags

**Keyboard / screen-reader player.** The dialog is never announced — no `role`, no `aria-modal`, no accessible name. Escape does nothing from where focus lands. The first Tab escapes into the inventory behind. On close, focus is on `<body>` and their place is gone. The search input has a placeholder and no label. The 7-column table has bare `<th>`s with no `scope`, so every cell is read without its header. They cannot use this.

**First-time player who's never seen a crafting system.** Opens Craft. Reads "Missing one ingredient (378)". Concludes they're nearly able to make 378 magic items. Scrolls a wall of identical rows with 378 identical indigo buttons, clicks one, and gets a dialog telling them they can't. Nothing anywhere explains what the three bands mean, what a DC is here, what "~2 workweeks (gp ÷ 50)" means, or what `HHHVI` is.

**DM prepping between sessions (best-served, still blocked).** Creature-first harvest genuinely answers "what dropped?" fast — this persona is why the feature is good. But they must decode `Ar8` vs `CC` vs `HHHVI` with no legend, mentally de-duplicate *Aboleth Teeth* from *Aboleth Teeth (large bag)*, and read a Value column that's blank on 8 of 13 rows. To decide what's worth harvesting they have to sort by value in their head, because the table sorts by DC.

**Power user with 456 recipes.** Search returns one match inside a collapsed accordion. No filter by rarity, tool, or crafter. 5,654 DOM nodes rebuild on every keystroke, so typing has perceptible lag. The tool scales against them.

---

## Minor Observations

- The `· holding N` counter is **dead code**: `:258` removes `.cs-crafting__held`, but `:242` renders the span as `ve-muted ve-small` with no such class. After a successful harvest the count on screen is stale until you re-search.
- Muted text is `#777` on white = **4.48:1** — fails AA by a hair — and **3.63:1** on the zebra-striped rows. Fix is a token swap: `--cs-text-muted` (`#5b6675`) clears at 5.9:1. Affects "13 harvestables", the band counts, "· also in another book", every source code, and every `0/1`.
- 100% of modal text is **Arial**, including the "🧺 Harvest" / "🔨 Craft" titles. A player who raised their text size or picked a different face for readability gets none of it in the exact dialogs where they're parsing DCs and quantities. `.charsheet-page[data-font] .tab-content` never reaches a body-portalled modal.
- The Harvest empty state is one sentence in an 800×790 white box. That's ~42% dead space with the results loaded, and near-total when blank. Size to content, or fill it — "creatures you've felled" would be a genuinely useful shortcut.
- The crafting CSS fallbacks bake **dark-theme** values (`#334155`, `#10b981`, `#f59e0b`, `#98a5b8`) while the live tokens resolve light (`rgba(15,23,42,.12)`, `#047857`, `#b45309`, `#5b6675`). Tokens win today, so nothing breaks — but any future token failure paints dark-theme colours onto a white modal.
- The green "held ingredient" state was never exercised in testing, because no test character holds a matching material. That contrast path is unverified.
- Both modal titles render indigo. Per One Voice, indigo is for primary action, selection, and focus — a title isn't any of the three.

---

## Questions to Consider

- **Should this be a modal at all?** A persistent Inventory sub-pane deletes the entire P0 accessibility block, removes the context-switch to check what you're carrying, and is what DESIGN.md asks for. What is the modal buying you?
- **What if "Missing one ingredient" became a shopping list instead of a teaser?** Grouped by where to get it — this creature, this shop — it becomes the most useful screen in the feature instead of the most misleading.
- **What if Harvest sorted by value?** You already have the number. The table currently sorts by difficulty, which is the DM's concern, not the player's.
- **Is showing both rule-set duplicates empowering or paralysing?** A per-campaign "harvest rules source" setting would collapse 13 rows to 7 and delete a recurring decision the player has no basis to make.
- **Should the destructive Roll and the reversible Craft trade ceremony?** Right now the *cancellable* action gets the careful confirmation dialog and the *irreversible* one gets a bare button.
- **What would a confident version of the Harvest result look like?** Not a table — a short, ordered list of what's worth taking, with the long tail behind "show everything".
