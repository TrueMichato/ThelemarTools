---
score: 26
maxScore: 40
p0: 0
p1: 2
p2: 3
p3: 1
target: charactersheet.html combat tab + class modals
register: product
timestamp: 2026-07-23T09-05-20Z
slug: charactersheet-html-combat-tab
---
# Critique — Character Sheet · Combat tab & class-specific modals

**Target:** `charactersheet.html` Combat tab + class sections/modals in `js/charactersheet/charactersheet-combat.js` (11,150 lines)
**Register:** product (design serves the tool; users are D&D 5e players/DMs at the table)
**Method:** Assessment A (design review — live browser on Illrigger L10 fixture + full code read of 8 classes' section/modal renderers via two isolated readers) + Assessment B (detector on markup) held separate until synthesis.
**Classes examined:** Illrigger (live), Fighter, Rogue, Druid, Monk, Ranger, Barbarian/World-Tree, Sorcerer (code).

## Heuristic score — 26/40 (competent, real consistency & density gaps)

| # | Nielsen heuristic | Score | Note |
|---|---|---|---|
| 1 | Visibility of system status | 3 | Pools show current/max, buttons disable when spent, toasts fire. But no roll-result live region, Battle-Tactic toggles don't persist, feedback channel varies (toast vs colour vs disable). |
| 2 | Match to real world | 3 | Strong domain match (seals, EP, sorcery points, action-economy). Jargon leaks: "Tune/Detune", "OFF", "½ level SP". |
| 3 | User control & freedom | 3 | Escape closes modals (verified), Skip/Cancel present, Reset for Second Wind/Action Surge. No undo on most spends; exit verb inconsistent (Skip/Cancel/Close). |
| 4 | **Consistency & standards** | **2** | Biggest weakness. Four action paradigms across classes; ragged button labels/widths; emoji vocabulary drifts; inline side-stripes vs full borders; SP editable in Combat not Overview. |
| 5 | Error prevention | 2 | Buttons disable at 0, but the generic Action modal doesn't re-check on click; invalid dice notation silently accepted; a rider-modal input is clipped. |
| 6 | Recognition over recall | 3 | Inline descriptions, effect previews, hover links. But cost encoding ("½ level SP") and hidden computations (conduit dmg, ranger switch bonus) force recall/trust. |
| 7 | Flexibility & efficiency | 2 | No bulk tune/detune, no Enter-to-confirm on choice modals, no shortcuts; repeated actions inline is good. |
| 8 | Aesthetic & minimalist | 2 | Dense but the right column empties to a ~500px void on class-heavy characters while sections stack only left; 3 near-empty cards; emoji noise; ALL-CAPS reads shouty. |
| 9 | Error recovery | 3 | Titles explain disabled state ("Not enough sorcery points"). No `aria-invalid`; bad dice accepted silently. |
| 10 | Help & documentation | 3 | Hover links to source text, effect previews, reminder prose — reasonable for the domain. |

## AI-slop / anti-patterns verdict

**Not AI-slop** — this is unmistakably hand-built, domain-deep tooling with a real shared vocabulary (`badge`, `ve-btn-*`, current/max pools, effect previews). It reads as a labour of love, not a generation.

**But two *absolute-ban* violations are hiding in JS inline styles** — invisible to the CSS detector and to the earlier `quieter css/charactersheet.css` pass:
- **Side-stripe borders**: `style="border-left: 2px solid var(--rgb-link); padding-left: .5rem"` repeated across Fighter, World-Tree Vitality, and Combat-Masteries feature blocks. This is the exact banned pattern the CSS pass retired everywhere else — it survived because it's authored in `charactersheet-combat.js`, not the stylesheet.
- **Hardcoded hex in roll output**: `style="color:#9b59b6"` (necrotic) and `style="color:#c44"` (damage) instead of tokens — off the design-token system and unverified for contrast.

Detector on `charactersheet.html` itself: **baseline only** (2 `broken-image` portrait placeholders w/ onerror, 1 `em-dash-overuse`, 1 `single-font`) — the class sections are JS-rendered so static markup analysis can't reach them. This is exactly why the code read mattered.

## Overall impression

The Combat tab is the most feature-ambitious surface in the sheet and, per class, genuinely impressive: Illrigger gets seals + interdict boons + an infernal-conduit spend form; Sorcerer gets a real metamagic dashboard; Fighter, Ranger, Druid, Rogue, Monk each get bespoke resource UI. State coverage is broadly excellent — pools bound at 0, buttons disable when exhausted, empty states are written ("No creatures are currently interdicted").

The problem is **cohesion, not capability.** Eight classes were each designed as a snowflake, so a player who multiclasses — or a DM running four PCs — meets four different mental models for "spend a resource": Fighter's Use/Reset buttons, Druid's +/− steppers, Illrigger-Conduit's dropdown-and-Spend form, and everyone's modal pickers. The shared button/badge vocabulary papers over it visually, but the *interaction grammar* is inconsistent, and that's what raises cognitive load at the table.

## What's working (keep)

- **Resource-exhaustion discipline** on the inline toggles (Sneak Attack, Weapon Riders, Metamagic): state-coloured READY/OFF/USED + disabled + toast is a genuinely good pattern. Make it *the* pattern.
- **Effect previews** in the action modal — informative without clutter.
- **Metamagic dashboard** is the strongest bespoke surface: Tuned/Available/Active grouping, affordability check before Tune, aria-labelled SP steppers. It's close to the reference standard the others should copy.
- **The Phase-4 full-border pill summaries** (Interdiction / Conduit ruby bars) render cleanly in both themes and read far better than the old stripes.
- **Domain empty states** are written like a human wrote them.

## Priority issues

### P1 — Accessibility floor across combat modals & toggles (WCAG 2.1 AA)
Emoji-only status with no text alternative (~15 across the modals), **colour-only** Advantage/Disadvantage cue (🟢/🔴 — colourblind fail), toggle state carried by colour alone, and roll results dropped into a plain `<div>` with no `aria-live`, so screen-reader users never hear the outcome. This is the same class of blocker the main-sheet `harden` pass fixed for skills/saves — the combat renderer was out of that scope.
→ **`/impeccable harden js/charactersheet/charactersheet-combat.js`**

### P1 — One resource-interaction grammar, not four
Fighter Use/Reset vs Druid ± steppers vs Conduit dropdown-Spend vs modal pickers. Pick one spend/restore idiom (the inline state-toggle is the best candidate) and normalise ragged button labels ("Place seal" / "Charm a target" / "Gain temp HP" / "Invoke (1 seal)" / "Expend a seal" → one verb grammar).
→ **`/impeccable distill js/charactersheet/charactersheet-combat.js`** (design-system consolidation; interactive — behaviour + tests at risk)

### P2 — Ban violations in JS inline styles
Retire the `border-left: 2px solid var(--rgb-link)` feature-block stripes (Fighter/Vitality/Masteries → full border or bg tint via a shared `.charsheet__combat-feature-block` class) and move roll-output `#9b59b6`/`#c44` onto damage-type tokens.
→ **`/impeccable quieter js/charactersheet/charactersheet-combat.js`**

### P2 — Column imbalance on class-heavy characters
Class sections stack only in the left column; the right column (Defenses / Conditions / Active Effects, all commonly empty) bottoms out ~500px above the left, leaving a large void. Consider a masonry/balanced flow or letting class sections span, and collapsing empty Defenses/Conditions/Effects cards to a thin "add" affordance instead of full cards.
→ **`/impeccable layout charactersheet.html`**

### P2 — Modal input & validation defects
The rider modal (Baleful Interdict) ships a **clipped Target `<input>`** ("creature hit by Unarmed…" cut off); attack/rider modals lack a `<form>` wrapper and silently accept invalid dice notation (crash risk on roll). Add `aria-invalid`, size the field, validate dice.
→ **`/impeccable harden`** (fold into the P1 harden pass)

### P3 — Copy & tone
"OFF" is ambiguous (powered-off vs available), "Tune/Detune" and "½ level SP" are insider jargon, ALL-CAPS status reads aggressive, emoji-in-button-text ("💾 Save Changes") is unusual, and exit verbs vary (Skip/Cancel/Close). Standardise.
→ **`/impeccable clarify js/charactersheet/charactersheet-combat.js`**

## Persona red flags

- **Alex (power user, multiclass)** — must relearn a resource idiom per class; no bulk Tune/Detune; no Enter-to-confirm on choice modals; Battle-Tactic toggles silently reset on reload (data-loss surprise).
- **Jordan (first session)** — "OFF" and "½ level SP" mean nothing yet; the Baleful-Interdict modal *auto-fires on Attack* before any roll (feels like an error); hidden computations ask them to trust a number they can't see derived.
- **Sam (screen reader / colourblind)** — emoji-only status, colour-only advantage cue, no roll announcement, colour-only toggle state, clipped input: several independent AA blockers on the tab where combat decisions actually happen.

## Minor observations

- Ragged right-edge buttons (varying label widths) make method/boon lists look unaligned; a fixed action column (Grid) would settle them.
- Metamagic SP is editable in Combat but not Overview — same widget, different powers per tab; pick one.
- Indicator glyphs ●/○/◆ encode Tuned/Available/Active by shape only; fine with the text labels present, but add `aria-hidden`.
- No loading/busy state on modal-open or dice-roll; fine at current speed, worth a note.
- Second Wind heals live but only a toast reports it, while Conduit animates dice — inconsistent roll feedback.

## Questions for you

1. **Priority order** — do you want the accessibility floor (P1 harden) first, or the interaction-grammar unification (P1 distill), which is the larger design bet?
2. **Scope of the grammar unification** — is consolidating four spend idioms into one in-scope now, or is that a bigger redesign to defer while we bank the safe fixes (a11y, ban-violations, layout, copy)?
3. **Emoji** — same call as the main sheet's deferred Phase 5: port the themed-icon/`_icon()` system into the combat renderer, or keep emoji + add text alternatives as the AA-minimum stopgap?
4. **Column balance** — acceptable to collapse empty Defenses/Conditions/Active-Effects cards into thin affordances, or must they stay full-height cards for muscle-memory?
