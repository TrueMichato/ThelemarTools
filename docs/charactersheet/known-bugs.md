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

