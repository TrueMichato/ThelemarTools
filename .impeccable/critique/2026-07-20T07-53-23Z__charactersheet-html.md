---
target: character sheet design
total_score: 28
p0_count: 0
p1_count: 3
timestamp: 2026-07-20T07-53-23Z
slug: charactersheet-html
---
# Critique — D&D 5e Character Sheet (charactersheet.html)

Evaluated: day mode (default) + night mode, Overview + Combat tabs, desktop (1440) + mobile (390), empty/first-run state. Dev server localhost:5050.

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | Strong HP/level/empty-state feedback; 7 silent console errors |
| 2 | Match System / Real World | 3 | Fluent D&D vocabulary; emoji aid recognition |
| 3 | User Control and Freedom | 3 | Respec tab, undo-rest, level history; no global undo |
| 4 | Consistency and Standards | 2 | Two card systems (pastel Overview vs white Combat); one heading right-aligned; rainbow accents; blue legacy navbar clashes |
| 5 | Error Prevention | 3 | Dropdowns, defaults, Quick Build reduce invalid input |
| 6 | Recognition over Recall | 3 | Everything visible + labeled; text+icon tabs |
| 7 | Flexibility and Efficiency | 3 | Layout/theme/font customization, Quick Build, favourites; no command palette / shortcuts |
| 8 | Aesthetic and Minimalist | 2 | Nested cards everywhere; 4 toolbar rows; uniform visual weight; rainbow noise |
| 9 | Error Recovery | 3 | n/a — little error surfacing observed |
| 10 | Help and Documentation | 3 | Loading tips, inline empty-state guidance, tooltips |
| **Total** | | **28/40** | **Good (lower end)** |

## Anti-Patterns Verdict

Not classic AI slop — this is clearly hand-built on a real token system (indigo primary + 5 named accent hues, spacing/radius/transition scales, dark-default + day-mode override) with genuine D&D theming. It does not read as generic SaaS. But in **day mode** it reads "enthusiast hobby project," not "cutting-edge tool": rainbow pastel card grid + emoji-as-icons everywhere + Cinzel display font on every UI label.

Detector: `single-font` (partial FP — Inter is the body font, Cinzel only headings), `broken-image` x2 (FP — hidden `.ve-hidden` portrait placeholders), `em-dash-overuse` (20, mostly flavor/help text — minor). My additions: nested cards (banned), display font in UI labels (product ban), text overflow ("PROFICIENC Y BONUS", "INSPIRATI ON", "PERCEPTI").

## Overall Impression
The information architecture is genuinely strong and complete — but the surface is over-decorated. Every datum lives in its own bordered, tinted, emoji-headed card, so nothing is more important than anything else. Night mode is markedly better than the default day mode; the pastels that wash out on white read as premium subtle accents on slate. Biggest opportunity: impose a visual hierarchy and one card treatment, and make the day theme as strong as the night theme.

## What's Working
- **Complete, well-organized IA.** Three-column desktop layout maps cleanly to identity / play / resources. Nothing important is buried.
- **Excellent empty states.** "No attacks configured. Add weapons from Inventory.", "Build your character to see features," the lore-skills explainer — these teach the interface instead of showing "nothing here."
- **Mobile is the strongest view.** Clean single column + bottom tab bar (correct native pattern); less rainbow noise than desktop.
- **Deep customization already exists** (Layout drag-drop, Theme, Font size, Alt View, Modifiers) — directly serves the "highly customizable" goal.

## Priority Issues

**[P1] One card treatment, not two (+ rainbow accents).** Overview uses pastel-tinted rainbow cards; Combat uses plain white cards; "WEAPONS & ATTACKS" is right-aligned while every other heading is left. Five accent hues (gold/emerald/ruby/sapphire/amethyst) are used decoratively side-by-side. Reserve color for meaning (danger=HP/damage, success=heal/rest, accent=primary action/selection) and make every card the same neutral surface. Fix: `/impeccable layout` then `/impeccable colorize`.

**[P1] Kill the nested cards and the visual noise floor.** Ability Scores card contains 6 stat cards; Passive contains 3; Currency contains 5. Nested cards are always wrong. Every element has equal border+tint+shadow weight, so hierarchy collapses. Flatten inner groups into borderless cells on a shared surface; let whitespace and one heading do the grouping. Fix: `/impeccable distill`.

**[P1] The toolbar stack is a wall of options.** Four dense rows (character/XP/Level-Up/Multiclass/Quick-Build → icon actions → modifier legend → Layout/Theme/Size/Font/Dice/Modifiers/Settings/NPC-Export) sit above the tabs before any character data. ~20 controls at uniform weight = analysis paralysis for a first-timer, friction for a pro. Collapse secondary tools into an overflow / command menu; surface only New, Quick Build, Level Up. Fix: `/impeccable layout`.

**[P2] Cinzel display font on every UI label.** Cinzel small-caps on every section heading is thematic but hurts scannability at label sizes and causes real wrapping bugs ("PROFICIENC Y BONUS", "INSPIRATI ON"). Keep Cinzel for the character name / a few hero moments; move section labels to Inter (uppercase, tracked) for legibility. Fix: `/impeccable typeset`.

**[P2] Day theme is the weaker default.** The design is clearly authored dark-first; day mode is a washed-out adaptation (muted gray labels on tinted near-white, low contrast). Since day is the default, it deserves parity: darker ink for body/labels (≥4.5:1), and tints resolved to solid muted surfaces rather than translucent overlays on white. Fix: `/impeccable colorize` / `/impeccable polish`.

## Persona Red Flags

**Alex (Power User):** No keyboard shortcuts or command palette for the core loop (roll a save, take damage, cast). Adv/disadv modifiers are mouse-chord only (Shift/Ctrl+click). Four toolbar rows to scan. Wants a keyboard-first play mode.

**Jordan (First-Timer):** Lands on ~20 uniform-weight controls with no "start here." Emoji-only meaning in places (🎲, ⚡, 😫). Doesn't know Quick Build is the fast path. First 5 seconds don't answer "what do I do first?"

**Casey (Mobile):** Actually well served — bottom tab bar, thumb-reachable, single column. One bug: orange subtitle text overlaps the title in the header on mobile.

## Minor Observations
- Header subtitle (orange) overlaps the title in day mode and on mobile — looks broken.
- Legacy 5etools blue navbar collides with the modern sheet aesthetic in day mode (harmonizes acceptably in night mode).
- Mixed icon systems (emoji + FontAwesome) — pick one for a coherent visual voice.
- 20 em-dashes in helper copy; fine for flavor but trims easily.

## Questions to Consider
- What if the play surface were dark-first and keyboard-driven — a "play mode" distinct from the "build mode" toolbar clutter?
- Does every section need a card, a border, a tint, an emoji, AND a heading? What survives if you remove three of those four?
- What would the *confident* version look like — one neutral surface, color only where it means something, type doing the hierarchy?
