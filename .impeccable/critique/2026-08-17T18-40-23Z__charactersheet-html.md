---
target: mobile character sheet interactivity
total_score: 24
max_score: 40
na_heuristics: 
p0_count: 1
p1_count: 2
timestamp: 2026-08-17T18-40-23Z
slug: charactersheet-html
---
Method: dual-agent (A: assess-a · B: assess-b)

**Target:** mobile Manager character sheet — interactivity & functional parity. Play Mode excluded per user scope.
**Coverage:** 5 classes (Wizard 9, Fighter 9, Warlock 9, Barbarian 9, Rogue 5) × day/night × 10 tabs, iPhone 12 emulation with real touch.

#### Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | Status strip is genuinely live; but a dead long-press gives *no* feedback at all, and the roll toolbar logs a roll the user didn't ask for. |
| 2 | Match System / Real World | 3 | D&D verbs are right and class-aware (Pact vs Slots). "Upcast" — a core casting concept — has no mobile representation. |
| 3 | User Control and Freedom | 2 | Context menu can become undismissable; item delete has no confirm and no undo. |
| 4 | Consistency and Standards | 2 | "Tap outside to dismiss" silently stops working; the FAB has a backdrop, the context menu doesn't; desktop right-click has no working mobile twin. |
| 5 | Error Prevention | 2 | Advantage requires first firing a real, logged roll that didn't count. Destructive delete unguarded. |
| 6 | Recognition Rather Than Recall | 2 | The 500ms long-press has zero affordance anywhere, yet is the only route to some capability. |
| 7 | Flexibility and Efficiency | 2 | Advantage = 2 taps + a junk roll; upcast impossible without a desktop. |
| 8 | Aesthetic and Minimalist Design | 3 | Strip is dense but purposeful; Overview still runs ~6 screens with ~1,535px structurally uncollapsible. |
| 9 | Error Recovery | 3 | Zero JS errors; HP clamps correctly under abuse. But a silent long-press failure is unrecoverable confusion. |
| 10 | Help and Documentation | 2 | No hint that "More" holds four tabs, that long-press exists, or how to upcast. |
| **Total** | | **24/40** | **Acceptable — significant improvements needed** |

#### Design Specificity Verdict

**LLM assessment:** This is **authored for a D&D character sheet, not a generic responsive wrapper** — and the evidence is specific. The status strip reshapes itself per class *by construction*: a Champion Fighter grows no Slots segment, a Warlock yields `Pact 2/2`, a level-5 Rogue shows only HP/AC, all from one scan with no per-class branching. The FAB maps to real table verbs. The "delegate to the real control, never reimplement" contract holds under test.

The crack is precise and worth naming: **the mobile layer is excellent exactly where it delegates, and broken exactly where it invents.** Everything that clicks a real desktop control works flawlessly. The three subsystems the mobile layer built for itself — the long-press context menu, the roll toolbar, the bespoke selectors — are where every confirmed defect lives. That is not a coincidence; it is the architecture telling you which code has test coverage and which doesn't.

**Deterministic scan:** `detect.mjs --json charactersheet.html` → exit 2, **4 findings**, all pre-existing and none attributable to the mobile work: `overused-font` (Inter) at `charactersheet.html:27`, `broken-image` at `:413` and `:1600` (both `ve-hidden` placeholders populated at runtime), and `em-dash-overuse` in static body copy. The three known false positives were re-confirmed as false and dismissed: the `charactersheet-mobile.js:339` "transition/height" match is inside a **comment**; the `charactersheet-mobile.css:1786` `#8b5cf6` is the *fallback* in `var(--cs-accent, #8b5cf6)`.

**A measurement artifact I caught and rejected:** Assessment B reported the spell-slot pip as a sub-floor **20×20** target. That is `getBoundingClientRect()` measuring the *visual* pip and failing to see the `::after` hit expansion. I verified directly with `elementFromPoint`: the true hit extent is **24×24** (half-extent 12px in each direction), exactly as designed. **Not a regression — do not "fix" it.**

**Visual overlays:** none. Assessment B ran the CLI detector but did not perform live-server overlay injection, so **no user-visible overlay exists in a browser tab.** The deterministic signal above is the CLI scan only.

#### Overall Impression

**The sheet does not break when you click it — and that is a real result.** Across roughly 1,600 clicks per class in both themes, the census produced **zero console errors, zero page errors, zero clipped sections, zero horizontal overflow, and zero scroll-lock leaks**. All 10 tabs are reachable. HP math survives abuse: heal at max stays at max, 999 damage lands on 0, a direct `-5` clamps to 0. The stability half of your question has a clean answer.

**But "all functionalities available" does not.** There is one confirmed, verified **P0: you cannot upcast a spell on mobile.** Not "it's awkward" — there is no control anywhere on the device. For a Wizard, Cleric, Druid, Bard, Warlock, Paladin, Ranger, or Artificer, casting Fireball at 5th level is impossible on a phone. It works on desktop via right-click.

The single biggest opportunity is a one-word fix. `charactersheet-mobile.js` reads `window._charsheetPage` (lines 1585/1590), but **nothing in the repository ever assigns that global** — the real one is `window.charSheet`. So `this._page` is permanently `undefined`, the spell branch of `_getContextMenuItems` never runs, the menu builds 0 items, and `_showContextMenu` returns early at `if (!items.length) return;`. A whole feature surface is dark because of a name mismatch.

Note honestly that the score did not move from the previous 24/40. That is not stagnation — the earlier critique and the work that followed addressed **layout and viewport**, and this critique probes **interactivity**, an axis that was never previously measured. These are pre-existing bugs newly exposed, not new damage.

#### What's Working

1. **The class-agnostic status strip is the best thing here.** Verified across five classes: correct segments every time, from a single code path with no per-class branching. It re-paints after every mutation. This is the hard version of the problem, solved correctly.

2. **HP math is genuinely defensive.** Heal 50 at full HP → stays at max. Damage 999 at 5 HP → 0, not −994. Direct entry of −5 → clamped to 0. No negative states, no overflow, no errors. The most safety-critical numbers on the sheet are the best-guarded.

3. **The classic mobile-modal P0 is avoided.** While a modal is open the FAB and strip hide; on dismissal `body` scroll is restored every time — verified across Settings and Layout for all three classes. Most mobile retrofits leave the body scroll-locked; this one doesn't.

#### Priority Issues

**[P0] Spell upcasting is unreachable on mobile**
- **What:** The long-press spell menu — sole home of `⬆ Upcast to level N`, ritual casting, and variant components — never opens. Root cause verified three ways: `window._charsheetPage` is `undefined` (never assigned; the real global is `window.charSheet`), `mobile._page === undefined`, and `_getContextMenuItems(spellRow)` returns **0 items**. A level-9 Wizard's spell row offers only: Cast Spell, Spell Info, Add Note, Remove Spell, Star. The green Cast button is hardcoded `{autoSlot: true}`, so it silently takes a *base-level* slot and never prompts.
- **Why it matters:** Upcasting is core 5e play, not an edge case. This is task-prevention, not friction — the P0 definition exactly. `charactersheet-spells.js:318` even documents the intent: *"Long-press (mobile) routes through charactersheet-mobile.js → `_openSpellCastMenu`."* The design is correct; the wiring is dead. Sorcerers escape via a dedicated metamagic button; every other caster is stuck.
- **Fix:** Assign the real page instance (`window._charsheetPage = charSheet` at bootstrap) or, better, route the spell branch through the shared `spellsCtrl._openSpellCastMenu` the desktop right-click already calls — the entry point that exists for precisely this. Then add a regression test asserting the spell menu builds >0 items, because nothing currently guards it.
- **Suggested command:** `/impeccable harden`

**[P1] Long-press is load-bearing but invisible — and three of its five menus target selectors that don't exist**
- **What:** The 500ms long-press has no affordance anywhere: no handle, no hint, no ripple. Worse, `_getContextMenuItems` matches `.charsheet__inventory-item` and `.charsheet__resource-item`, which **do not exist in the DOM** (the real classes are `.charsheet__item` and `.charsheet__resource-row`). So inventory and resource menus are dead code, and the spell menu is dead via P0.
- **Why it matters:** A gesture users can't discover, which fails silently when they do find it, reads as a broken app. It is also the *only* single-action route to an advantage roll.
- **Fix:** Correct the selectors, then give long-press a real affordance (a ⋮ handle on rows that have menus, or a first-run coach mark). Add a test that every context-menu branch matches ≥1 live element.
- **Suggested command:** `/impeccable harden`

**[P1] The roll toolbar forces a spurious, logged roll before you can roll with advantage**
- **What:** Confirmed empirically. Clean log → tap "Acrobatics" → **1 entry** ("Acrobatics Check", 9) → tap "⬆️ Adv." → **2 entries** ("Acrobatics Check (Advantage)", 21). The tap passes through and fires a real roll; the toolbar only offers a *second* one.
- **Why it matters:** Desktop does this in one shift-click. At a table with a shared roll log, a roll that "didn't count" is exactly what starts arguments. It also makes the sheet misreport what the player did.
- **Fix:** Either show the toolbar without firing (long-press or first-tap gates, second tap commits), or let the pass-through tap *become* the chosen roll rather than a throwaway Normal plus a second roll.
- **Suggested command:** `/impeccable shape`

**[P2] The context menu can become permanently undismissable by outside tap**
- **What:** Confirmed. `_showContextMenu` registers the outside-tap dismisser as `touchstart {once: true, capture: true}`. The handler early-returns when the tap lands *inside* the menu — but `once: true` has already removed the listener. Tap the menu's header/padding once, then tap outside: the menu **stays open**. There is no backdrop.
- **Why it matters:** "Tap outside to dismiss" is universal on touch. Failing silently after one inside-tap breaks a learned contract. Escape hatches exist (tap an action, or long-press again) but no user will guess them.
- **Fix:** Drop `once: true`; keep the listener and remove it explicitly in `_hideContextMenu()`. Better: give the menu the same transparent backdrop the FAB already has, so dismissal is a real element rather than a document listener.
- **Suggested command:** `/impeccable harden`

**[P2] Destructive item deletion has no confirmation and no undo**
- **What:** `.charsheet__item-remove` (a 26×25px control) calls `_removeItem` → `state.removeItem` directly. Verified: items 4 → 3, no modal, no toast, no undo.
- **Why it matters:** On touch, mis-taps are the norm, and this control sits inches from ones users tap constantly. Losing a magic item mid-session with no recovery is the worst kind of data loss — silent and permanent.
- **Fix:** Route it through `InputUiUtil.pGetUserBoolean` (the codebase already uses this for cooking/recharge), or implement swipe-to-delete with an undo toast. Note `.charsheet__spell-remove` shares this pattern and is *suspected* but was not directly exercised.
- **Suggested command:** `/impeccable harden`

#### Persona Red Flags

**The player mid-session at the table (primary persona).** The fast paths delight: tap a stat to roll, HP tray to heal, FAB to rest. Then they try to Fireball at 5th level and there is **no control on the device** — they have to open a laptop mid-combat. Wanting advantage, they roll twice and clutter the shared log. Wanting to delete a used potion, they fat-finger the trash on a magic item and it's gone forever. Every one of their high-frequency actions also pops a **full alphabetic keyboard** for damage entry, because the number field is `type="text"`.

**The DM running an NPC caster on a phone.** Hits the same upcast wall on every NPC spell. Long-presses a spell, gets absolute silence, and reasonably concludes the app is broken rather than that the gesture is unimplemented. The FAB's Death Save also fires happily at 68/68 HP, which quietly corrupts tracking for a healthy NPC.

**The first-timer.** Never discovers long-press (zero affordance), so never finds upcast or single-action advantage. Doesn't know four tabs live behind "More". Learns the double-roll as if it were the intended design — and it is currently the only discoverable one.

#### Minor Observations

- **Heal/Damage uses `type="text"`** with no `inputmode="numeric"` — the single most repeated in-session action opens an alpha keyboard. Cheap, high-value fix in `pGetUserNumber`.
- **FAB → Death Save fires at full HP** (death boxes 0 → 1 at 68/68). Shared with desktop, nonsensical RAW; guard to HP ≤ 0.
- **Short-rest modal footer sits inside the tab-bar band** (footer 617–658 vs bar top 611). It stays clickable only because z-order rescues it (1000 > 100). Add bottom padding to the scroller so it never enters the band.
- **Context-menu positioning is estimated, not measured** — hardcoded `tabBarHeight = 60` and `menuEstHeight = items.length * 48`, and it predates the status strip. Empirically it overlaps the strip by ~11px but items stay reachable (menu z 1070 > strip 1040). Imperfect, not broken.
- **`_buildCastOptionItems` supplies a `sublabel`** ("3 slots remaining") that the mobile menu renderer drops entirely — worth carrying over when P0 is fixed.
- **Context-menu labels are injected via `innerHTML`.** The only dynamic label source is the spell branch, which is dead, so **no injection path is reachable today** — but fixing P0 makes it reachable. Switch to `textContent` in the same change.
- Overview remains ~6 screens with ~1,535px structurally uncollapsible (documented rule-6 limit, unchanged).

#### Questions to Consider

1. If the mobile layer's whole thesis is *"delegate to the real control, never reimplement,"* why does the spell path reach for a separately-stored page reference instead of calling the same `_openSpellCastMenu` that desktop right-click uses? The P0 exists precisely where the architecture's own rule was bent.
2. Every confirmed defect lives in the three subsystems the mobile layer *invented*; nothing that delegates broke. Should the bespoke surfaces (context menu, roll toolbar) be held to the same Jest-tested standard as `partitionTabs` and the status strip statics — or removed in favour of delegation?
3. Should a *tap* ever auto-roll on touch? If the toolbar were the single deliberate gate for every roll, H1 dissolves and advantage becomes one gesture instead of two.
4. Upcast and single-action advantage both live behind an invisible 500ms gesture with no alternate route. Is a hidden gesture an acceptable home for capability that has no other path — or should anything with no second route be a visible control by rule?
