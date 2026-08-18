---
target: charactersheet.html — Manager view on mobile (all tabs, all classes; Play Mode excluded)
total_score: 24
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 3
timestamp: 2026-08-17T10-54-14Z
slug: charactersheet-html
---
Method: dual-agent (A: assessment-a-design · B: assessment-b-detector)

Scope: `charactersheet.html` **Manager view at phone widths**, across all 9 tabs and 6 spawned classes (cleric/tempest/9, rogue/arcane-trickster/9, sorcerer/draconic/12, fighter/champion/11, druid/moon/9, warlock/fiend/9, barbarian/totem/9). Play Mode and desktop excluded per your brief.

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | Roll box + active-tab highlight work, but HP/AC scroll off-screen — nothing status-relevant stays pinned. |
| 2 | Match System / Real World | 3 | Strong D&D vocabulary; broken by a near-empty Spells tab and a hidden Abilities tab that silently redirects. |
| 3 | User Control and Freedom | 3 | Modals dismiss via X + Escape + background scroll-lock; close X is 28×28 at top-right, outside thumb reach. |
| 4 | Consistency and Standards | 2 | Inputs at 14–15px trigger iOS auto-zoom in **all 200 measured rows**; 8.8px tab labels; 6 breakpoints in play (1024/992/768/700/640/576/480). |
| 5 | Error Prevention | 3 | Adequate; destructive trash icon lives in cramped, clipped top chrome. |
| 6 | Recognition Rather Than Recall | 2 | 6 of 9 tabs visible (`scrollWidth 459 > clientWidth 390`), no scroll affordance — Companions/Builder/Respec are invisible. |
| 7 | Flexibility and Efficiency | 2 | Swipe-nav and FAB exist but have zero affordance; no one-handed fast path to spend a resource. |
| 8 | Aesthetic and Minimalist Design | 1 | First viewport on every tab is 100% chrome: marketing hero + search + a 10-control management toolbar. Zero character data above the fold. |
| 9 | Error Recovery | 3 | No error traps found; 0 console errors across 200 measurements. |
| 10 | Help and Documentation | 2 | Swipe / long-press / FAB are undocumented and undiscoverable. |
| **Total** | | **24/40** | **Acceptable — significant improvements needed** |

## Design Specificity Verdict

**LLM assessment**: This is a **genuine mobile shell wrapped around an un-reauthored desktop information architecture** — and the hybrid is the whole problem.

The shell is authored for this product and someone who understood mobile built it: an icon bottom-tab bar, default-collapsed accordions, full-width scroll-locked bottom-sheet modals, haptics, swipe-between-tabs, safe-area insets, and a published `--cs-tabbar-height` clearance token. None of that could be lifted into an unrelated app unchanged.

But the *content* the shell wraps is a desktop dump. The shared marketing hero ("CHARACTER SHEET.") and a character-*management* toolbar (Create New Character, import, export, Alt View, Note, wrench, trash) sit above the character on **every tab**. The Overview is a 5.2–5.3-screen, ~20-section kitchen sink and it is the default landing. That scroll could be lifted into any dense web app unchanged — it reads like a desktop `<main>` narrowed to one column.

The north star is a phone glanced at for two seconds to spend a resource. To spend Channel Divinity today you scroll past ~530px of chrome, then expand a collapsed accordion, then tap Use. Four actions for the interaction the design system exists to make instant.

**Deterministic scan**: `detect.mjs` exited 2 with only **4 findings** — `overused-font` (1, Google Fonts: Inter, `charactersheet.html:27`), `broken-image` (2, `:413` and `:1600`), `em-dash-overuse` (1, 20 in body text). I'm calling **3 of 4 false positives**: both images are `ve-hidden` dynamic portrait placeholders, and em-dash count is an advisory copy heuristic with no mobile bearing. The static detector is near-silent here, which is itself the finding: **nothing wrong with this surface is detectable from markup.** It is all layout, density, and stacking-order behavior that only appears at 390px with a populated character.

The mechanical CSS sweep found: 423 single-hyphen `var(--rgb-…)` references, **91 `white-space: nowrap`**, **153 approximately hover-only affordances against only 31 `:focus-visible`**, 21 fixed `width`/`min-width` inside mobile media queries, and 6 distinct breakpoint widths. I verified the 423 `--rgb-*` refs are a **false alarm** — the documented compatibility alias block at `css/charactersheet-modern.css:219` (`body.is-charsheet-page`) maps every one to a live `--cs-*` token. They work; just don't add more.

**Visual overlays**: not available. Neither assessment performed the `live-server` + `detect.js` in-page injection, so **there is no user-visible overlay in your browser**. The fallback signal is the CLI scan above plus 110 full-page screenshots at `~/impeccable-mobile-a/` (60 files, per class × tab) and `~/impeccable-mobile-b/` (50 files), with raw metrics at `~/impeccable-mobile-b/per-tab-measurements.csv` (200 rows).

## Overall Impression

Your impression is correct, but the diagnosis is more encouraging than "mobile is broken." The hard part is done. The mobile layer is not a stub — it's ~2,200 lines of deliberate, competent work (`charactersheet-mobile.css` + `charactersheet-mobile.js`), and it holds up mechanically: **zero horizontal document overflow at 390, 360, and even 320px**, zero console errors, correct scroll-locked bottom sheets, safe-area handling. The reflow discipline is genuinely good.

What's missing is not responsiveness. It's **editorial decisions about what a phone screen is for.** Every pixel of your first viewport is spent on branding and character-management chrome that nobody touches mid-session, while HP — the single number a player looks at most — scrolls away and never comes back.

The single biggest opportunity: **decide what Manager-on-mobile is for, and let Play Mode have the rest.** Play Mode already has real mobile support (breakpoints at 1024 and 640 plus two dedicated `pointer: coarse` blocks). It is your at-the-table glance surface. Manager-on-mobile is currently trying to be a worse version of it while failing at the job only it can do — building, levelling, editing, and inventory on a phone. Aim Manager at prep/edit parity and it becomes excellent; keep aiming it at the two-second combat glance and it will always lose to the surface purpose-built for that.

## What's Working

1. **Bottom-sheet modals are executed correctly.** Full-width, rounded top, dimmed, background verified `overflow: hidden` scroll-locked, in-sheet search and a "Priority Sources" filter. Measured 390×657 with no bottom overflow. This is the native iOS/Android sheet convention done right, and it is the strongest single piece of mobile craft on the sheet.
2. **The Quick Build / Level-Up wizard is the template the rest should copy.** One step at a time, a progress bar, and — the detail that matters — the primary CTA pinned in a sticky footer inside the thumb zone. It's chunked, calm, and it's the only place on mobile where the most important action is where your thumb already is.
3. **The shell investment is real and load-bearing.** `--cs-tabbar-height` respecting `env(safe-area-inset-bottom)`, `_initCollapsibleSections`, haptics, swipe nav, plus clean one-column reflow with no horizontal overflow down to 320px. You are not starting from zero — you're starting from a good chassis with the wrong cargo.

## Priority Issues

### [P1] The first viewport contains zero character data — on all 9 tabs

**Why it matters**: A player opening their sheet sees a purple marketing banner (~280px of 844), a "Search everywhere…" bar, and a 10-control management toolbar before a single game number. The character's own name renders around y≈1085 — below the fold. On the two-second glance this is a total failure, and it repeats on every tab. My 390px screenshot also shows the toolbar failing on its own terms: **"Create New Charac⌄" is truncated mid-word** and the grey button group's trash icon is **clipped off the right edge**.

**Fix**: (a) Hide the shared site header on mobile — it already carries `hidden-xs hidden-sm` in markup at `charactersheet.html:44` but `css/charactersheet.css:23265–23300` re-lays-it-out anyway; add `body.is-charsheet-page .page__header{display:none}` inside the `@media (max-width:768px)` block in `css/charactersheet-mobile.css`. Play Mode already solved this exact two-competing-headers problem at `charactersheet-playmode.css:18` — mirror it. (b) Fold the management toolbar into the existing **Menu** button or the FAB, so `.tab-content` renders only per-character content. That recovers ~500px, roughly 60% of a phone screen.

**Suggested command**: `/impeccable adapt`

### [P1] Modal footers and primary CTAs render underneath the bottom tab bar

**Why it matters**: This is a stacking-order inversion, and it's the most concrete bug in the review. The site modal is `z-index: 1000/1001` (`scss/vars/vars.scss:95–96`). The mobile tab bar is `--cs-z-tabbar: 1050` and the FAB is `--cs-z-panel: 1040` (`css/charactersheet-modern.css:186–188`). Mobile CSS anchors `.ve-ui-modal__inner` to `bottom: 0`. So **the bottom ~56px + safe-area of every bottom sheet — exactly where a bottom sheet puts its confirm action — is covered by the tab bar**, and the FAB floats on top of the sheet's content.

You already know about this. The comment at `css/charactersheet-mobile.css:480–486` documents it precisely ("the last ~56px of every modal … was unreachable"). But the patch at `:493` only adds `padding-bottom: var(--cs-tabbar-height)` to `.ve-ui-modal__row--body` and `.ve-ui-modal__scroller`. **The modal footer got no clearance.** That is why Assessment B measured the feature/resource modal's primary action as *not initially visible*, and why Assessment A saw the FAB overlapping Add Condition cards.

**Fix**: Extend the same clearance to `.ve-ui-modal__footer` within `body.is-charsheet-page`; hide the FAB and disable tab-bar pointer events while a modal is open (`body.ve-ui-modal__body-active` already exists as a hook). Also bump the modal close control up from 28×28 — it's under both the 44px HIG target and the 24px WCAG 2.5.8 floor.

**Suggested command**: `/impeccable harden`

### [P1] Overview is a 5.3-screen kitchen sink, and it's the default landing

**Why it matters**: ~20 stacked sections, 4,395–4,501px tall (5.2–5.3 phone screens), 171–274 sub-44px touch targets. It duplicates Combat, Spells, and Features — so users never learn the tabs exist and never leave the worst screen on the sheet. Meanwhile the Combat tab is *entirely* collapsed accordions, so every resource spend costs an extra expand tap that desktop doesn't charge. And nothing pins HP: the number a player checks most scrolls away permanently.

**Fix**: Two moves, in order. (1) Add a **sticky status strip** above the tab bar — HP / AC / top resource / slots. DESIGN.md already specifies a `status-strip` component; this is the literal north-star fix, since it makes the two-second glance require zero scrolling. (2) Make mobile Overview a real dashboard (HP, AC, attacks, live resources) and delegate the rest to their tabs — or default the mobile landing to **Combat**. Consider expanding-by-default the *class resource* panel on Combat, since that's the reason players open the tab.

**Suggested command**: `/impeccable layout`

### [P2] iOS auto-zoom traps and sub-12px text

**Why it matters**: Inputs below 16px cause iOS Safari to zoom the page on focus and never zoom back — the page is left panned and oversized mid-session. Assessment B found zoom traps in **all 200 measured rows**: `input.omni__input` at 14px, `select#charsheet-sel-character` at 15px, inventory and note inputs at 14px, 15–22 per Overview. Separately, 26–55 text nodes per tab render below 12px, with `.charsheet__tab-text` — your navigation labels — at **8.8px**.

**Fix**: In the mobile media query, set `.charsheet input, .charsheet select, .charsheet textarea { font-size: 16px; }` and keep them visually compact with padding rather than font-size. Raise tab labels to ≥11px and other sub-12px labels to ≥12px. Neither costs layout, both are one-line changes, and together they remove the most viscerally "this app isn't made for my phone" moment in the product.

**Suggested command**: `/impeccable adapt`

### [P2] Tab bar truncates, touch targets fall under WCAG minimums, and affordances are hover-only

**Why it matters**: Three compounding touch failures. (a) The tab bar is `scrollWidth 459` in a `clientWidth 390` container with no scroll affordance — **Companions, Builder, and Respec are off the right edge and undiscoverable**; my screenshot shows "Companion" clipped mid-word. (b) Small-target clusters: both agents flag them, and disagree on magnitude because they used different selector scopes (A: 168–274 under 44px on Overview, 44–91 under 24px on Combat; B: up to 78 under 44px, 16 under 24px on Features) — but they agree on the culprits, `.ve-btn-xs` chips, steppers, and bare `<a>`. Anything under 24×24 fails WCAG 2.2 SC 2.5.8 outright. (c) **153 hover-only affordances against 31 `:focus-visible`** — on touch there is no hover, so those states are simply unreachable, and 91 `white-space: nowrap` declarations are what turn narrow containers into clipped text like the truncated toolbar button.

**Fix**: Give the tab bar a peeking edge-gradient + `scroll-snap`, or add a "More" overflow item. Enforce a 44px minimum hit area on chips and steppers in the `@media (pointer: coarse)` block that already exists at `css/charactersheet.css:22927` (use padding/`::before` expansion so visual density is preserved). Pair every hover style with `:focus-visible` and a touch equivalent.

**Suggested command**: `/impeccable audit`

## Persona Red Flags

**Casey (Distracted Mobile User — phone, one hand, 5 seconds, interrupted)**: Opens the sheet mid-turn and sees a purple hero. Scrolls past ~530px of hero + management chrome. Reaches Combat, finds every panel *collapsed*, must expand Resources, then tap Use on Channel Divinity. Four actions, two-handed, well past 5 seconds. Her most-glanced number, **Current HP**, has scrolled off-screen with nothing pinning it. Her one escape hatch, the ⚡ FAB, is unlabeled so she has no idea it's a shortcut — and it's currently sitting on top of the "ABILITY SCORES" heading.

**Alex (Impatient Power User — knows the desktop sheet cold, wants parity speed)**: Every single resource spend costs him an extra expand-tap that desktop doesn't charge, because mobile collapses panels desktop leaves open. **Respec** and **Companions** are off the right edge of the tab bar, breaking his muscle memory with no indication they still exist. Swipe-between-tabs would be his fast path, but it has zero affordance and is deliberately suppressed over horizontally-scrollable content in `_initSwipeNavigation`, so from his side it fires unpredictably — worse than not existing.

**Sam (Accessibility-Dependent — 200% zoom, screen reader, motor precision limits)**: Focusing any input auto-zooms the page and never restores it. At 200% zoom, an already-truncated tab bar and 171–274 sub-44px Overview targets become genuinely un-tappable. The 28×28 modal close X fails WCAG 2.5.8. Keyboard/AT users tabbing the nav hit the **hidden "Abilities" tab that silently redirects to Overview** (`charactersheet.js:1160`) — a dead focus stop with no explanation. The **long-press context menu** on skills, saves, attacks, and inventory has no keyboard or AT-exposed equivalent, so an entire action surface is motor-gated away. And 153 hover-only styles against 31 `:focus-visible` means much of the interface's state feedback never reaches him at all.

## Minor Observations

- **Day mode may be in worse shape than night, and appears to be the default.** Assessment B counted 5,475 day-mode contrast failures vs 449 in night. I do not trust that absolute count — the ancestor-background walk almost certainly produced false "white-on-white" pairs — but the **13× asymmetry is meaningful**, and my own 390px day screenshot confirms genuinely low-contrast grey-on-white micro-labels (`SPECIES` / `CLASS` / `BACKGROUND` / `SIZE` / `REACH`, "Add Portrait"). Also worth confirming deliberately: DESIGN.md declares the system dark-first, yet the sheet rendered in day mode by default. Worth a dedicated pass; it is not mobile-specific and I've kept it out of the priority list.
- The ⚡ FAB **overlaps section headings and open modals** — same z-index inversion as issue #2.
- **Active-tab styling desyncs**: after some interactions Overview keeps its filled active state while the actually-active tab shows only a focus ring.
- The **Spells tab renders near-empty** (1.0 screens) for a level-9 Cleric — just a collapsed "Spell Slots" bar. Whatever the cause, tapping Spells and seeing nothing is the single most confusing moment in the flow.
- Landscape is the worst-case density: scroll depth reaches **12.6 screens**, and the hero still consumes ~130px of a 390px-tall viewport.
- Modals nest cards (intro card + condition cards inside the sheet) — minor tension with DESIGN.md's nested-card ban.
- 20 console warnings, all one cause: orphan BookOfEbonTides subraces at `js/charactersheet/charactersheet.js:668`. Harmless, but noisy.
- Six breakpoint widths are in play across the sheet's CSS (1024/992/768/700/640/576/480). Consolidating to two or three would make future mobile work far cheaper to reason about.
- The loading flavor text ("Think all books are just paper and ink?…") is charming and on-brand. Keep it.
- Already self-reported at `docs/charactersheet/10-known-limitations.md:662`: "Mobile support… basic; touch optimization could be improved." This critique is the specific version of that line.

## Questions to Consider

- **Is tab-parity even the right target?** Play Mode already ships real mobile support (640/1024 breakpoints plus two `pointer: coarse` blocks) and owns the at-the-table glance. What if Manager-on-mobile stopped competing and became an unapologetic **prep / build / edit** surface? The hero and management-toolbar debate mostly evaporates, and "parity with PC" becomes achievable rather than aspirational.
- **Should the mobile landing tab be Combat rather than Overview?** What is the Overview actually *for* on a phone, once a status strip exists?
- **Could the FAB become the single "spend a resource" control** — a radial of this character's live resources — so the most common in-play action costs zero scrolling and one thumb?
- **What if the status strip were the whole answer?** HP / AC / slots / top resource pinned above the tab bar would satisfy the north-star glance on every tab at once, and would make the Overview's length stop mattering.
- Is the shared site `.page__header` worth **any** pixels on a phone character sheet?
