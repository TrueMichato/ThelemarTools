---
target: the Powers tab (Talent & Psionics support)
total_score: 33
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 0
timestamp: 2026-08-18T19-43-54Z
slug: js-charactersheet-charactersheet-powers-js
---
Method: dual-agent follow-up (A: recritique · B: detect.mjs CLI)
Browser evidence gathered by direct Playwright verification; no overlay injection.

Second pass on the Talent & Psionics support, after acting on the 20/40 critique and adding
Combat-tab reach. Re-scored honestly by an agent instructed not to confirm improvement.

#### Design Health Score

| # | Heuristic | Score | Key Issue |
|---|---|---|---|
| 1 | Visibility of System Status | 4 | Lethal margin now leads every strain surface, including Resources and Play Mode |
| 2 | Match System / Real World | 4 | `AW`/`O2` shorthand replaced with the order number plus words |
| 3 | User Control and Freedom | 4 | Fatal overflow gated behind a named second confirmation; survivable path is primary |
| 4 | Consistency and Standards | 4 | Stripes gone, colours tokenised, indigo reserved; the third hand-written strain block folded into the shared renderer |
| 5 | Error Prevention | 3 | Risk card previews the cost, but track cards show the next threshold rather than the result of a multi-point hit |
| 6 | Recognition Rather Than Recall | 3 | Per-track consequences visible everywhere; still only partially projected |
| 7 | Flexibility and Efficiency | 3 | Powers reaches the mobile play bar; Combat list grouped and capped at 8 |
| 8 | Aesthetic and Minimalist Design | 3 | Dialog leads with the decision; Combat cockpit no longer floods at 26 powers |
| 9 | Error Recovery | 3 | Death framing is strong; no post-event recovery guidance beyond copy |
| 10 | Help and Documentation | 2 | One-sentence explainer on first encounter; no deeper teaching |
| **Total** | | **33/40** | **Good** — up from 20/40 |

#### What changed

Five priority issues from the first pass, all addressed:

1. **Mobile demotion** — `resolvePlayTabs()` spends a Talent's dead Spells slot on Powers, only when the character casts nothing. `partitionTabs()` stays a pure static taking the play set as an argument.
2. **Lethal overflow** — "Let it go — drop to 0 hit points" is primary and takes focus; the kill is behind "Push it through anyway…" then a confirmation naming the character.
3. **Design system** — two banned stripes removed, five hardcoded colours tokenised, indigo off the stat values, undefined token replaced, tabular numerals and ease-out added.
4. **Manifest dialog** — risk card leads; three strain tracks became choice cards naming the penalty each would switch on; per-rest levers collapsed while Exertion stays visible.
5. **Strain glanceability** — lethal margin and next-threshold text on all three surfaces.

#### Two live bugs found and fixed on the way

- **CS-BUG-165** — the Combat tab costed powers by regexing their prose, misfiling 17 of 103 and offering ten-minute rituals as turn actions.
- **CS-BUG-166** — an allowlist above the psionic detector meant powers learned the normal way never reached activation at all.

#### Remaining issues

- **[P2] Track cards project the next threshold, not the result of the actual hit.** Taking 4 strain at once can cross two thresholds; the card names only the first.
- **[P2] No post-event recovery guidance.** After a character drops to 0, the sheet states the outcome but does not point at what to do next.
- **[P3] Help and Documentation is still thin.** One sentence on first encounter is not teaching; there is no "what is strain?" affordance.
- **[P3] Powers appear in both the Psionics cockpit and the Action Economy panel on the same tab.** Correct in both now, but it is the same information twice.

#### Design Specificity

Materially improved. The lethal copy, the drop-vs-die branch, the margin that leads every surface, and the per-track consequence text are all authored for a game where a routine action can kill you — none of it would transfer to a generic app. The remaining generic feel is in the Combat list, which is still fundamentally a list.
