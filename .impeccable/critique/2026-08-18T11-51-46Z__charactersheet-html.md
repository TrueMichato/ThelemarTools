---
timestamp: 2026-08-18T11-51-46Z
slug: charactersheet-html
---
---
target: charactersheet.html (Add Item / Add Spell filtered pickers, post-P0)
total_score: 24
max_score: 40
p0_count: 0
p1_count: 3
slug: charactersheet-html
method: dual-agent (A residual UX + B detector/browser)
---

# Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | Counts + Reset when dirty; weak active-filter summary |
| 2 | Match System / Real World | 3 | Select none / Reset filters grammar landed |
| 3 | User Control and Freedom | 3 | Reset → open defaults works (live Item) |
| 4 | Consistency and Standards | 2 | Item collapsible vs Spell always-on; span vs button chips |
| 5 | Error Prevention | 2 | Empty recoverable; dropdowns still clip/stack-fragile |
| 6 | Recognition Rather Than Recall | 2 | ~69 Item chips; little facet hierarchy |
| 7 | Flexibility and Efficiency | 2 | Search OK; expert facets dominate chrome |
| 8 | Aesthetic and Minimalist Design | 1 | Chip wall + 8 Spell multiselects = primary residual pain |
| 9 | Error Recovery | 3 | Empty canvas + Reset verified |
| 10 | Help and Documentation | 2 | Copy OK; no filter hierarchy help |
| **Total** | | **24/40** | **P0 recovery fixed; density + dropdown architecture remain** |

Delta vs 2026-08-18 pre-P0 (**16/40**): +8 from recovery/status/control. No remaining P0 logic bugs (`if (!filtered)` gone).

# Design Specificity Verdict

**LLM (A):** Operate pickers. Recovery is product-specific; chrome still forked multiselect CRUD. Item tabs + collapsed Filters are the right shell; expanded interior is a property/mastery/damage chip wall (~69 live). Spell never adopted that shell.

**Deterministic (B):** CLI static HTML noise. Live inject modal-scoped: cramped list padding, collapsible max-height transition. Absolute dropdowns z=9999 under scrollable scroller. P0 Reset **live-verified** on Add Item.

**Agreement:** Next pass = distill facets → portal/fixed popovers. Detector understates IA density.

# What's Working

1. Shared `charactersheet-filter-picker-helpers.js`
2. Item tabs + default-collapsed Filters + “(N active)”
3. Spell My Classes defaults
4. Live Reset path on Add Item
5. List row craft

# Priority Issues

### [P1] Item chip wall + weak type-awareness — distill
- Only Consumable tab hides weapon/armor/dmg facets; Types multiselect does not gate them.
- Some chips use `classList.toggle("active")` instead of `setPressed`.
- ~34 properties + ~17 masteries + ~12 dmg + cats ≈ 69 chips when expanded.

### [P1] Spell always-on filter chrome — distill
- Up to ~8 multiselects + 5 component chips always visible.
- Component chips are `<span role=button>` not `<button>`.

### [P1] Multiselect dropdown clip — harden
- Absolute menus; Item scroller overflow auto; Spell only flips open-left/right.
- Need shared fixed/portal popover with flip + outside/Escape.

### [P2] Sticky toolbar / residual setPressed — polish

### [P2] ModalFilterBase migration — defer entirely this pass

# Recommended sequence

1. Distill Item facets (type/tab-aware + nested secondary sections)
2. Distill Spell progressive disclosure (match Item shell)
3. Shared anchored popover for CS multiselects in these modals
4. Light a11y polish (real buttons, setPressed everywhere)
5. Out: ModalFilterBase rewrite

# False positives (B)

Portrait empty src · Inter · em-dashes · page AI palette · intentional collapsible transition · many clipped heuristics when collapsible closed

# Live evidence

- Item: 3 multiselects, 69 chips expanded, Reset works
- Spell: 8 multiselects (source), 5 chips; modal open flake in B (nav to spells.html)
- Assessment A residual score 24/40
