---
target: add item / add spell filter modals
total_score: 19
max_score: 40
na_heuristics: 
p0_count: 1
p1_count: 3
timestamp: 2026-08-04T12-20-51Z
slug: charactersheet-html
---
Method: dual-agent (A: critique-assess-a · B: critique-assess-b)

# Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 2 | Results counts exist; spell empty UI never renders; multi-filter state truncated to “N selected” |
| 2 | Match System / Real World | 3 | D&D labels clear; “Clear All” means select-none (empty universe), not reset filters |
| 3 | User Control and Freedom | 2 | Esc/focus restore solid; no global reset; stacked filters hard to unwind |
| 4 | Consistency and Standards | 1 | Add Item ≠ Add Spell (collapse, active class, chips vs row); neither matches site ModalFilterBase |
| 5 | Error Prevention | 2 | Class defaults help; Clear All zero-outs easily; hard caps 100/150 without next step |
| 6 | Recognition Rather Than Recall | 2 | Active filters collapse to counts; must reopen menus to know state |
| 7 | Flexibility and Efficiency | 3 | Debounced search, tabs, Official/My Classes, sort — strong once learned |
| 8 | Aesthetic and Minimalist Design | 1 | ~69 item chips + 8 spell multiselects; emoji/gradient noise over results |
| 9 | Error Recovery | 1 | Spell empty branch dead (`if (!filtered)`); empty copy has no one-click clear |
| 10 | Help and Documentation | 2 | Short spell intro; no guidance on filter model or caps |
| **Total** | | **19/40** | **Weak — high extraneous load on a mid-session task** |

# Design Specificity Verdict

**LLM assessment:** Partially authored for 5etools, not fully. Domain language (sources, attunement, ritual, class lists, rarity) is native. Structure is a **custom character-sheet fork** of picker UX, not the site’s familiar `ModalFilterBase` / filter-box / mini-pill system. Visual language drifts into emoji-heavy, gradient “SaaS picker” chrome that fights PRODUCT.md (familiar, unobtrusive, dense-but-scannable) and DESIGN.md (rationed indigo, quiet chrome, no novelty).

**Deterministic scan:** CLI `detect.mjs` exit 2 — **36 findings** (0 errors, 4 warnings, 32 advisories). Dominant rules: `design-system-color` (17), `design-system-radius` (12), `design-system-font-size` (3) in `charactersheet-inventory.js`, `charactersheet-spells.js`, `filter.scss`, `filter-night.scss`. Page-level warnings on portrait images / Inter / em-dashes are mostly false positives for this surface.

Browser inject (Playwright on localhost:8080, live-server :8400): with Add Item open, detector reported **clipped-overflow-container** (6), **low-contrast** (8), **undersized-ui-text** (9), **layout-transition** on filter collapsible, **cramped-padding** on `.charsheet__modal-list`. Overlay count **61** labels (not Chrome [Human] tab — profile lock; Playwright path used).

**Visual overlays:** Detector overlays were captured on the live Add Item modal (filters expanded). Live server stopped after assessment. Screenshots archived to session files (not left in repo root).

Agreement: LLM and detector both flag filter chrome overload, overflow/clip risk on multiselect menus inside scrollers, and design-token drift. Detector did not catch the spell empty-state logic bug (code-path); LLM did. CLI color/radius advisories partially false-positive against established CS/5e tokens.

# Overall Impression

These modals are competent power-tools wearing the wrong costume for the moment they’re used. Search, tabs, class defaults, Known badges, and the `CharacterSheetModal` a11y shell are real craft. What fails is **filter grammar**: too many always-on controls, inconsistent Item vs Spell dialects, fragile dropdown stacking, and a broken spell empty state. Biggest opportunity: make pickers **search-first with progressive filters**, one shared control system, and honest empty/reset recovery — so “add Rope / add Shield” takes seconds at the table.

# What's Working

1. **`CharacterSheetModal` shell** — `role="dialog"`, labelled header, Esc-in-input, Tab trap, focus restore: real a11y spine.
2. **Domain-aware defaults & feedback** — class/subclass preselect + “My Classes”; Known badge; rarity coloring; results counts; item tabs by equipment/magic/consumable/component.
3. **List row craft** — hover links, sticky section headers, primary “+ Add”, subtitle metadata: scannable once filters get out of the way.

# Priority Issues

### [P0] Spell empty state is dead code
- **What:** `.charsheet__modal-empty` never shows; `if (!filtered)` is always truthy for arrays.
- **Why it matters:** Zero results look like a broken blank list; recovery path invisible mid-session.
- **Fix:** `if (!filtered.length)`; primary **Clear filters** CTA on empty canvas.
- **Where:** `js/charactersheet/charactersheet-spells.js` ~1694
- **Suggested command:** `/impeccable harden`

### [P1] Filter chrome overload (Item expanded + Spell row)
- **What:** Item: ~69 `.charsheet__modal-filter-btn` chips when expanded; Spell: 8 multiselects in one filter row. Detector: cramped list padding, layout-transition on collapsible max-height wall.
- **Why it matters:** Extraneous load on a mid-session task; results list becomes secondary; violates progressive disclosure.
- **Fix:** Primary row = Search + 2–3 high-value filters; rest in “More filters”; properties/masteries as searchable multi-select, not chip fields.
- **Where:** `charactersheet-inventory.js` filter section; `charactersheet-spells.js` filter row; `css/charactersheet.css` collapsible/list
- **Suggested command:** `/impeccable distill` (then `/impeccable layout`)

### [P1] No global Reset; “Clear All” mental model is wrong
- **What:** Per-dropdown “Clear All” → empty set / nothing matches; no modal-level reset.
- **Why it matters:** Users clear filters to *broaden*, not empty the universe. Easy to strand on 0 results.
- **Fix:** Persistent **Reset filters**; rename menu action to “Select none” vs “Reset to all”; empty-state CTA.
- **Suggested command:** `/impeccable clarify` + `/impeccable harden`

### [P1] Active filter styling split-brain
- **What:** Spells toggle `ve-active`; items/CSS style `.charsheet__modal-filter-btn.active`. Spell quick filters are `<span role="button">`; items use real `<button>`s.
- **Why it matters:** Ritual/Concentration/etc. don’t get the indigo “on” treatment → status invisible; inconsistent AT/keyboard.
- **Fix:** One tokenized pressed state (`aria-pressed` + single class) shared by both pickers; real buttons everywhere.
- **Suggested command:** `/impeccable polish`

### [P2] Dropdown vs modal scroll architecture is fragile
- **What:** Modal scroller with list forces `overflow-y: auto`; multiselect menus `position: absolute; z-index: 9999` inside clip ancestors. Collapsible open sets `overflow: visible` only on itself. Bootstrap `.ve-dropdown-menu` z=1000 equals modal overlay.
- **Why it matters:** Classic clip/stack failures as filter panel grows (`max-height: 600px`).
- **Fix:** Portaled/fixed menus (anchor rect) or non-clipping filter header with only the list scrolling.
- **Where:** `css/charactersheet.css` ~14562–14599, ~15059–15074, ~15296–15335; `scss/includes/ui.scss`
- **Suggested command:** `/impeccable audit` (a11y/overflow) then `/impeccable harden`

# Persona Red Flags

**Alex (Power User)**  
Wants bulk speed and remembered filter idioms from items/spells pages. Red flags: reinvented multiselects, no keyboard multi-select patterns, 150/100 hard caps without load-more, listener leaks on repeat opens, inconsistency vs `ModalFilterBase`.

**Jordan (First-Timer)**  
Opens Add Item → Equipment 1508 / Magic 11940; Filters expand into weapon-property encyclopedia. Red flags: emoji taxonomy, truncated “N selected,” Clear All → nothing matches, no explanation of tabs vs type filter.

**Riley (Mid-session player/DM, time pressure)**  
Needs “add Rope / add Shield” in &lt;10s while table waits. Red flags: filter chrome steals viewport; spell blank empty state; must hunt among 8 dropdowns; narrow wrap worsens hierarchy.

# Minor Observations

- Multiselect checkboxes `display: none` — custom checks only; weak AT; missing `aria-haspopup` / `aria-expanded` on menu buttons and filter toggle.
- Inline styles / hard-coded purples on spell status (detector `design-system-color`).
- Gradient primary buttons + hover lift ≈ PRODUCT anti-reference “decorative SaaS.”
- Builder `CharacterSheetSpellPicker` is a third grammar vs Add Spell modal.
- `document.addEventListener("click", …)` per open without teardown → stacked closers over a session.
- Day muted labels borderline for small section labels (detector low-contrast near threshold).
- Search placeholder emoji + CSS magnifier = double affordance.
- Item “showing first 150” has no load-more / virtualize path.
- CLI broken-image on portraits and sheet-wide overused-font/em-dash: false positives for this critique target.

# Questions to Consider

1. If the rest of 5etools already solved “search + filters + list” with FilterBox, why do CS pickers re-teach a second dialect at the table?
2. Would a single **search-first** drawer with *optional* filters outperform eight always-visible multiselects for 90% of adds?
3. Is “show 11,940 magic items” honesty or intimidation — should the default universe be **character-relevant** with an explicit “Browse all”?
4. When empty, is the primary action **Clear filters** or **Create custom** — and why is neither on the empty canvas today?

# Cognitive Load

Checklist failures: 6/8 (visible options, progressive disclosure, hierarchy, trustworthy feedback, working memory, consistent patterns).  
Decision points routinely exceed 4 options (Type, Rarity, Sources, Properties, Damage, Sort, Class, Level, School, Tags…).  
**Rating: high cognitive load — critical to address for Operate mode.**
