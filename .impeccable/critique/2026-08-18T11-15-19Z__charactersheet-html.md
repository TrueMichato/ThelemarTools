---
target: add item / add spell filter modals (re-critique)
total_score: 16
max_score: 40
na_heuristics: 
p0_count: 2
p1_count: 2
timestamp: 2026-08-18T11-15-19Z
slug: charactersheet-html
---
Method: dual-agent (A: critique-a-filters-v2 · B: critique-b-filters-v2)

# Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 2 | Result counts exist; Spell empty never shows; Item “(N active)” often stale |
| 2 | Match System / Real World | 2 | Tabs OK; “Clear All” = select none is anti-language |
| 3 | User Control and Freedom | 1 | No global Reset; Clear All is a trapdoor to zero results |
| 4 | Consistency and Standards | 1 | Clear/Clear All/None; `ve-active` vs `.active`; conditions Clear only first checkbox |
| 5 | Error Prevention | 1 | Easy zero-universe; Spell dead empty hides failure |
| 6 | Recognition Rather Than Recall | 2 | Grouped lists help; active filters poorly summarized |
| 7 | Flexibility and Efficiency | 2 | Search + My Classes; hard caps; no presets |
| 8 | Aesthetic and Minimalist Design | 1 | ~68 Item chips expanded; Spell 6–8 multiselects always on |
| 9 | Error Recovery | 1 | Passive “Try adjusting…”; no Reset CTA; Spell empty dead |
| 10 | Help and Documentation | 2 | Intro blurbs; no “why empty?” |
| **Total** | | **16/40** | **Weak — reliability + recovery, not polish** |

# Design Specificity Verdict

**LLM:** Generic multi-select CRUD in 5etools tokens — not a character-sheet picker system. Copy-pasted DNA across Item/Spell/Feat/Conditions with inconsistent labels, defaults, empty recovery. Item tabs + collapsible are the only progressive-disclosure win.

**Deterministic scan:** CLI 42 findings (mostly design-system color/radius advisories). Browser inject: 43 overlays; Add Item modal shows cramped list padding, low-contrast, layout-transition on collapsible; dropdown stack z=9999 inside auto scroller still architecturally fragile.

**Agreement:** Empty/recovery and Clear semantics remain P0/P1. Detector confirms modal list chrome issues; does not catch dead `!filtered` or conditions first-checkbox bug (logic).

**Overlays:** Active in Playwright session during assessment (not left running). Screenshots: session/repo `add-item-modal.png`, `add-item-filters-dropdown.png`.

# Overall Impression

Unchanged core failure mode since 2026-08-04 critique (19/40 → **16/40** on a harsher re-score). Plan not implemented. Item collapse helps; Spell empty still broken; Clear All still lies; new reliability bugs (stale active count, ve-active mismatch, conditions Clear All partial DOM update) make shared-helper pass more urgent.

# What's Working

1. Item category tabs + default-collapsed Filters  
2. Spell My Classes / subclass defaults when they work  
3. List row craft (icon · title · + Add / Known)

# Priority Issues

### [P0] Spell empty dead code — unchanged
- `if (!filtered)` @ `charactersheet-spells.js` ~1700  
- Fix: `!filtered.length` + Reset CTA  
- Command: harden

### [P0] No Reset; Clear All trapdoor — unchanged (live-confirmed Item)
- Clear All → No Types → 0 results; empty has no recovery  
- Fix: Select none labels + modal Reset filters → open defaults  
- Command: clarify + harden

### [P1] Status/active-state bugs (NEW emphasis)
- Spell chips toggle `ve-active`; CSS styles `.active`  
- Item `_updateFilterToggle` not refreshed on all filter changes  
- Conditions Clear All/All only mutates first checkbox DOM while Set may clear  
- Fix with shared helper / one pressed-state class  
- Command: polish + harden

### [P1] Filter chrome overload — still out of core empty/reset but worse expanded
- ~68 Item chips; Spell always-full row  
- Defer full distill; optional: ensure Item collapse stays default; don’t expand scope to redesign chips in this pass  
- Command later: distill

### [P2] No shared picker primitive — plan still correct
- N hand-rolled multiselects; extract helper  
- Command: harden (architecture)

# Persona Red Flags

- **Alex:** Clear All → empty, abandons  
- **Jordan:** 11k magic items + 150 cap, no presets  
- **Riley mid-session:** Spell blank empty = panic  

# Minor Observations

Double search ornament; intro blurb height; Official source sets disagree; hard caps; dropdown-in-scroller clip risk; builder spell-picker is simpler third grammar.

# Questions

1. If 80% of adds are name search, why is default viewport a filter cockpit?  
2. Should Clear ever mean zero universe, or only restore smart default?  
3. What single “For this character” preset replaces Class/Subclass/Source/Level?

# Cognitive Load

High. Many decision points >4 options. Checklist heavily failed on progressive disclosure, hierarchy, recovery, consistency.

# Plan delta (for implementers)

Prior plan still correct on empty + Reset + shared helper + all pickers. **Add in-scope:** (1) conditions multiselect All/Clear DOM bug, (2) unify pressed class `active`+`aria-pressed`, (3) call filter-toggle count update on every dirty change. **Keep deferred:** chip-wall distill, dropdown portaling.
