---
target: the Powers tab (Talent & Psionics support)
total_score: 20
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 4
timestamp: 2026-08-18T19-05-01Z
slug: js-charactersheet-charactersheet-powers-js
---
Method: dual-agent (A: assessment-a · B: assessment-b)
Browser/overlay pass skipped: plan mode blocked starting the local server. CLI detector ran successfully.

#### Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | Strain, running powers and the projection are visible; the death margin never is |
| 2 | Match System / Real World | 3 | Good Talent vocabulary, but Play Mode ships insider shorthand `AW` / `O2` |
| 3 | User Control and Freedom | 2 | "Manifest it and die" is a one-click permanent kill with no second guard |
| 4 | Consistency and Standards | 1 | Violates four of its own DESIGN.md rules (stripes, hardcoded hues, indigo, undefined token) |
| 5 | Error Prevention | 2 | Worst-case projection helps; track choice still demands memorised penalty tables |
| 6 | Recognition Rather Than Recall | 2 | Dialog shows total strain, never per-track consequence, before you commit |
| 7 | Flexibility and Efficiency | 2 | Powers is behind "More" on mobile; Play Mode caps at 10 powers |
| 8 | Aesthetic and Minimalist Design | 2 | Organised but chrome-heavy for a mid-combat action |
| 9 | Error Recovery | 2 | Death has no recovery framing; decline path reads as the lesser button |
| 10 | Help and Documentation | 1 | Nothing teaches strain thresholds or that this can kill you |
| **Total** | | **20/40** | **Needs work** — mechanically strong, not yet table-ready |

#### Design Specificity Verdict

Mechanically authored, visually category-interchangeable. The model is unmistakably this product — powers as first-class entities, at-will powers badged "At will · no test · no strain", a worst-case projection before commitment, RAW overflow choices. But the composition is generic admin UI: stat tiles, three selects, badges, a green→amber→red meter, modal form rows. The one truth that makes this class unlike anything else on the sheet — a routine action can permanently kill your character — exists only as copy inside an error branch.

Deterministic scan: `detect.mjs` returned 6 findings, 0 attributable to the Powers tab — `overused-font` (charactersheet.html:27), two `broken-image` (:414, :1609, both `ve-hidden` portrait placeholders, likely false positives), advisory `em-dash-overuse`, and two pre-existing inline-style findings in charactersheet-playmode.js:2471. The real damage is in rules the detector does not encode, caught by static verification instead.

Visual overlays: none. Plan mode blocked the local server, so injection was never attempted.

#### Overall Impression

The engineering is good and the design is the weak half. One pipeline, one source of truth, powers projected rather than duplicated. But the tab was built to the sheet's pattern language without re-reading the sheet's rules: two banned accent stripes, five hardcoded colour literals that ignore day/night, indigo spent on decorative stat values, and a token that does not exist. The biggest opportunity is untouched — this is the only surface on the sheet where pressing a button can kill you, and it looks exactly like every other surface.

#### What's Working

1. The live projection strip (charactersheet-powers.js:635-655) — worst-case strain, projected total, and whether concentration will evict an older power, recomputed as you push harder, before you commit.
2. Strain to Maintain appears exactly when RAW allows it (charactersheet.js:12718-12733), inside the failed concentration save rather than as a button you must remember.
3. Active manifestations put End and Exert on the row itself (:227-245), matching how the thing is used at a table.

#### Priority Issues

**[P1] A Talent's action surface is behind "More", and a dead Spells tab holds its slot.** `_PLAY_TAB_HREFS` (charactersheet-mobile.js:1051-1057) is a fixed allowlist containing Spells. The Talent has no spellcasting and `_updateTabVisibility` never hides Spells, so a Talent on a phone gets a permanently empty tab in the play bar while their action economy sits two taps deep. MobileTabOverflow.test.js:33-44 hardcodes a stale 10-tab list, so no test caught it. Fix: resolve the play set against visible tabs; swap Spells for Powers when the character manifests but does not cast. Command: /impeccable adapt

**[P1] Lethal overflow is a normal-looking button.** `Manifest it and die` (charactersheet-powers.js:686) is a `ve-btn-xs ve-btn-danger` identical to every other destructive control, and the safer option is the plain secondary. Fix: promote the decline path to primary; put the kill path behind an explicit confirmation naming the character. Command: /impeccable harden

**[P1] The tab breaks four of the sheet's own design rules.** Banned `border-left` stripes at css/charactersheet.css:25294 and :25380; hardcoded gradient at :25244 and bare rgba() badges at :25423-25441 (neither responds to day/night); `--cs-primary-strong` on all seven header stat values, violating the One Voice Rule; undefined `--cs-border-strong` at :25527. Command: /impeccable polish

**[P1] The manifest dialog is a form where it should be a risk decision.** Up to nine controls at once (:563-601), well past the 4-option threshold, reporting only total strain so the track choice runs on memorised tables. Fix: lead with a risk card; make the three tracks choice cards naming the penalty each would switch on; collapse advanced modifiers. Command: /impeccable distill

**[P2] Strain is not a two-second glance.** The meter reads only `Strain 3 / 9` (:117) with colour carrying the rest — nothing shows the next threshold or the lethal margin. Play Mode has the same gap. Fix: threshold ticks at 1/3/5/7 plus per-track next-penalty text. Command: /impeccable layout

#### Persona Red Flags

**Experienced player, mid-combat, on a phone.** Powers is behind "More" while an empty Spells tab sits in the bar. The Play Mode card caps at 10 powers. `Strain 3/9` tells them neither the next penalty nor the lethal margin. Every manifest costs a modal.

**First-time Talent player.** "Manifestation die", "Psionic Exertion", "Adept", "Reduce Stress" appear with no inline teaching. Three strain tracks are offered with no comparison of consequences. The empty state explains where powers come from, never what strain is or that it can kill them. They meet the death rule for the first time in a red error box.

#### Minor Observations

- Favourite star has `title` + `aria-pressed` but no `aria-label` (:469).
- The learning tracker reuses `.charsheet__strain-meter` (:329), so progress and danger share one metaphor.
- Meter transition uses generic `ease`, not the stated 150-250ms ease-out.
- "No power matches those filters" offers no clear-filters action (:386-388).
- Search re-renders the whole tab per keystroke (:430-439); scroll position and expanded rows are lost.
- `Unknown Spell` (charactersheet.js:12607) reachable as a fallback label in a high-stakes prompt.

#### Questions to Consider

- What would this tab look like if "this action can kill you" were the first design constraint rather than an error branch?
- Should a Talent ever see a Spells tab at all?
- Are body / mind / soul meaningful enough to ask before the roll, or should the sheet recommend the least harmful track?
- Could manifesting be an inline expanding action row instead of a modal?
