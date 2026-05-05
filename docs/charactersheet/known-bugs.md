# Character Sheet — Known Bugs Tracker

Living list of confirmed character-sheet bugs surfaced by the E2E suite
(`test/e2e/specs/tgtt-*.spec.ts`) or otherwise reproducible. Each entry
should include: status, repro, suspected root cause, affected tests, and
notes for whoever fixes it.

When fixing one, move the entry to the **Resolved** section with a
commit reference rather than deleting it.

---

## Open

### CS-BUG-002 — Subclass features not granted on level-up (TGTT 2024-style subclasses)

**Status**: Open
**Surfaced by**:
- `tgtt-bladesinger-wizard-tabaxi.spec.ts` (L3, L5, L7, MEGA — fails with `expected toggle matching /bladesong/i`)
- `tgtt-chronurgy-wizard-nyuidj.spec.ts` (L7 — `probeToggleDelta: no feature matches /chronal|convergent|temporal|momentary/i`; activatable feature list shows zero subclass features)
- Likely also affects other Wizard / 2024-style TGTT subclasses — re-triage after a clean run.

**Repro**:
1. Build a TGTT Wizard with race Tabaxi via the builder wizard.
2. Level up to 3, selecting subclass `Bladesinging` (source `TGTT`).
3. Open the Features tab.

**Expected**: Bladesinger subclass features `Bladesong` and
`Training in War & Song` appear under a "Bladesinger" / subclass
heading.
**Actual**: Only the core Wizard L1/L2 features are listed
(Spellcasting, Ritual Adept, Arcane Recovery, Scholar). No subclass
features at all. The wizard finishes cleanly — the subclass IS recorded
on `_data.classes[0].subclass` — but the features array is never
augmented with the subclass grants.

**Suspected root cause**: `CharacterSheetClassUtils.getLevelFeatures()`
in `js/charactersheet/charactersheet-class-utils.js` (~L1244) iterates
`subclass.subclassFeatures` but the TGTT Bladesinger subclass payload
passed in by `_applyLevelUp` (`js/charactersheet/charactersheet-levelup.js`
~L3635) likely doesn't include the `subclassFeatures` array, OR the
shape doesn't match either of the array-of-strings / array-of-objects
branches. Add a single log of `selectedSubclass.subclassFeatures` at
the top of `_applyLevelUp` to confirm.

**Severity**: High — players selecting Bladesinging never get the
defining feature of the subclass.

---

### CS-BUG-003 — Arcane Archer: level-up wizard unfinishable when all Combat Methods already known

**Status**: Open
**Surfaced by**: `test/e2e/specs/tgtt-arcane-archer-fighter-hochling.spec.ts`
(L3, L5, MEGA — all fail; wizard never closes)

**Repro**:
1. Build a TGTT Fighter with race Hochling via the builder wizard.
2. Level up to 3, selecting subclass `Arcane Archer` (source `TGTT`).
3. Click Finish on the wizard.

**Expected**: Wizard closes; the player is told they have no NEW Combat
Methods to learn this level (or the picker is hidden) but can still
finish the level-up.
**Actual**: Wizard refuses to finish with a toast `Please select 1 new
method`. Every Combat Method checkbox in the picker is `[disabled]`
with the label `Known (1st degree)` because the Hochling species + base
Fighter class together already grant every default-source 1st-degree
method. Even after enabling "Show all source versions", no additional
methods are selectable.

**Suspected fix**: In `_applyLevelUp`'s validator
(`charactersheet-levelup.js` L1078–1088), mirror the `availableCount`
logic the `featureOptionGroups` validator uses a few lines below
(L1090+). Compute how many of `gain.options` the character does NOT
already know, then `requiredCount = Math.min(gain.newCount,
availableCount)`. Skip the toast (and treat as satisfied) when
`requiredCount === 0`.

**Severity**: High — completely blocks levelling up an Arcane Archer
Hochling once defaults are exhausted.

---

### CS-BUG-004 — RESOLVED INTO CS-BUG-002

The Chronurgy regex mismatch was actually the same root cause as
CS-BUG-002 (subclass features never appear on the Features tab).
Folded into that entry; this slot intentionally left blank so
issue numbers stay stable.

---

## Resolved

### CS-BUG-005 — `getFeatChoices` Temporal Dead Zone at L19 (Epic Boon)

**Status**: Fixed by hoisting `getFeatChoices` to a function declaration.
**Surfaced by**: All MEGA L1→20 specs hit this at L19 of any
XPHB/TGTT class (Epic Boon level). Wizard never opens, throws
`ReferenceError: Cannot access 'getFeatChoices' before initialization`,
falls back to a 0%-complete shell that can't be finished.

**Root cause**: `_renderAsiSelection` in
`js/charactersheet/charactersheet-levelup.js` rendered the Epic Boon
list (~L1717) and called `getFeatChoices(boon)` (~L1733), but
`getFeatChoices` was declared as `const` at L1792 — same function
scope, but later in source order, so the call hit the TDZ.

**Fix**: Converted `const getFeatChoices = (feat) => {...}` to
`function getFeatChoices (feat) {...}` so the declaration is
hoisted to the top of `_renderAsiSelection`. No behavioural change
(the helper does not use `this`).

---

### CS-BUG-001 — `setScholarExpertise` orphan `_saveState` call

**Status**: Fixed in commit `2de132f`.
**Was**: `CharacterSheetState.setScholarExpertise()` called
`this._saveState()` — a method that doesn't exist anywhere in the
codebase. The `TypeError` was swallowed by the level-up async chain,
leaving the wizard hanging with no user-visible feedback.
**Fix**: Removed the orphan call; matches the pattern of all other
setters in the file (mutate `_data` only).

---

### CS-BUG-006 — Multiclass entry leaves modal overlay intercepting wizard clicks

**Status**: Open. Discovered via the Hexblade 2 / Divine Soul 18 Tortle
multiclass MEGA E2E test. Repro: build a character at L2, multiclass
into a second class via the `➕ Multiclass` flow, then trigger Level Up
on the new class. The Level Up wizard renders, but a leftover
`.ve-ui-modal__overlay` from the multiclass-entry modal stays in the
DOM and intercepts pointer events on the HP accordion (and other
inputs), so the user cannot interact with the wizard. After ~1000+
retries Playwright surfaces "element intercepts pointer events".

**Hypothesis**: `_pShowMulticlassChoicesModal` resolves and removes its
inner modal panel but leaves the backdrop attached, OR a follow-up
prompt (Divine Soul affinity? Sorcerer L1 spell picker?) opens a second
overlay that's not torn down before the next Level Up flow begins.

**Workaround for tests**: None — the wizard is genuinely unusable. The
test fails honestly and reflects what a player would experience.

**Investigation hints**:
- Open browser devtools after multiclass entry; check for orphan
  `.ve-ui-modal__overlay` elements.
- Check `UiUtil.pGetShowModal` resolution path in
  `js/charactersheet/charactersheet-levelup.js` for the multiclass
  branch (around L4690 — "Confirm & Add" button handler).

---

### CS-BUG-007 — Activating Rage does not break existing concentration

**Status**: Open. Surfaced by the Phase-4 USE probe on
`tgtt-chained-fury-barbarian-minotaur.spec.ts` (L5). Repro:

1. Build a Barbarian; cast or programmatically `setConcentration("Bless", 1)`.
2. Activate Rage via the toggle (or
   `cs._state.activateState("rage")`).
3. Read `cs._state.getConcentratingSpell()`.

**Expected**: `getConcentratingSpell()` returns `null` — Rage's
`breaksConcentration: true` flag (state config at
`charactersheet-state.js:28543`) should clear concentration on
activation.

**Observed**: Concentration spell remains active after Rage starts.
The `breaksConcentration` flag isn't being honoured by
`activateState`. Likely the state-activation pathway needs to call
`this.breakConcentration()` when the activated state config has
`breaksConcentration: true`.

**Test workaround**: `concentrationCheck` in the Chained Fury spec is
set to `{skip: true}` with a `// blocked by CS-BUG-007` comment until
the state activation hook is wired.

---

### CS-BUG-008 — Bardic Inspiration not restored on short rest at L5+ (XPHB Font of Inspiration)

**Status**: Open. Surfaced by the Phase-4 short-rest probe on
`tgtt-surrealism-bard-yuanti.spec.ts` (L5). Repro:

1. Build a College of Surrealism Bard to L5.
2. Spend one Bardic Inspiration use
   (`cs._state.spendResource("Bardic Inspiration", 1)`).
3. Trigger short rest (`cs._state.shortRest()`).
4. Read `cs._state.getResource("Bardic Inspiration")`.

**Expected**: `current === max` (XPHB 2024 Bard "Font of Inspiration"
restores all Bardic Inspiration on a short rest from L5 onward).

**Observed**: `current` stays at the post-spend value (0); short rest
does not refill Bardic Inspiration. Suggests Font of Inspiration
isn't toggling the resource's `restoreOn` field from `long` → `short`
at L5 in the TGTT/XPHB feature pipeline.

**Test workaround**: `shortRestRestores` in the Surrealism Bard spec
is set to `{skip: true}` with a `// blocked by CS-BUG-008` comment.

---

### CS-BUG-009 — Render hang triggered by `addCondition` on Mercy Monk L5

**Status**: Open / suspected. The Phase-4 `applyCondition: poisoned`
probe on `tgtt-mercy-monk-changeling.spec.ts` consistently times out
the test at 600s, even though the same probe completes in <1s on
other builds. The most likely culprit is `addCondition("poisoned")`
followed by `_renderCharacter()` entering a slow / infinite loop on
Mercy Monk's L5 state (Hand of Healing/Harm + Focus Points pipeline
interacting with poisoned-condition effects).

**Investigation hints**:
- Manually load a Mercy Monk L5 character and call
  `cs._state.addCondition("poisoned"); cs._renderCharacter();` in
  devtools — confirm whether the page hangs.
- If it does, instrument `_applyConditionEffects` and the Monk feature
  re-evaluation path for an infinite loop.

**Test workaround**: `applyCondition` in the Mercy Monk spec is set to
`{skip: true}` with a `// blocked by CS-BUG-009` comment. Remove the
skip once the underlying hang is fixed.

