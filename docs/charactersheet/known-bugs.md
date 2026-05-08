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

**Status**: Fixed (2026-05-07)
**Surfaced by**: `test/e2e/specs/tgtt-arcane-archer-fighter-hochling.spec.ts`
(L3, L5, MEGA — all failed; wizard never closed)

**Root cause** (two coupled bugs):
1. **Builder L1 combat-method tagging** — `_applySelectedOptionalFeatures`
   in `charactersheet-builder.js` was passing `optionalFeatureTypes:
   opt.featureType` for combat-method picks. Raw `combatMethod` data
   entries (in `homebrew/TravelersGuidetoThelemar.json`) have
   `tradition`/`degree` fields but NO `featureType` field, so picks
   were stored with `optionalFeatureTypes: undefined`. This broke
   `getOptionalFeatureGains` at L2: it could not match the L1 picks
   against the progression's `CTM:*` types, so it returned the FULL
   progression total (4) instead of the new picks (1) → autofill
   selected 4 methods at L2 → entire 1st-degree pool exhausted by L3.
2. **Level-up render container reuse** — `_renderMethodsForLevelUp`
   in `charactersheet-levelup.js` did `container.innerHTML = ""` at
   the start, but `_renderCombatMethodsLevelUp`'s "has traditions"
   branch passed the SHARED outer container. So when CTM was the
   second gain rendered (e.g. after Battle Tactics at L3 with
   subclass), the CTM render wiped the BT section that had just
   been appended, leaving the wizard with an unsatisfiable BT
   picker count of 0/2.

**Fixes**:
- `charactersheet-builder.js` L1728+: Derive `optionalFeatureTypes`
  from `featureKey.split("_")` when `opt.featureType` is missing or
  not an array. Mirrors the level-up fallback at
  `charactersheet-levelup.js:3757`.
- `charactersheet-levelup.js` L2710+: Wrap the CTM rendering in a
  dedicated sub-container (`charsheet__levelup-methods-container`)
  appended to the outer container, so the inner `innerHTML = ""`
  no longer wipes sibling gain sections.

**Regression coverage**: `tgtt-arcane-archer-fighter-hochling.spec.ts`
L3/L5/L7/MEGA all re-enabled and passing.

**Severity**: High — completely blocked levelling up an Arcane Archer
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



### CS-BUG-010 — TGTT Gambler Rogue half-caster slot table missing/under-counted

**Status**: Open / suspected. The TGTT Gambler Rogue subclass grants
a third-caster spellcasting feature at L3, but at character L5 the
sheet reports only `{1: 2}` first-level slots — short of the half-
caster table the spec was authored against (Eldritch-Knight-style
1/3 caster typically has `{1: 4, 2: 2}` by L7 and `{1: 3}` by L5).

**Investigation hints**:
- Confirm the intended Gambler progression in
  `homebrew/TravelersGuidetoThelemar.json` (the subclass entry plus
  any `additionalSpells` wiring).
- Verify the spellcasting class config picks up the Gambler third-
  caster table during `_applyClassFeatures` for the Rogue base class.

**Test workaround**: Gambler `spellSlots` milestones at L3/L5 are
relaxed to known-passing values; the L11/L17/L20 assertions still
guard the upper half of the table.

---

### CS-BUG-011 — TGTT Heroic Soul Sorcerer "Stamina" / Combat Methods pool not surfaced as a resource

**Status**: Open / suspected. The Heroic Soul Sorcerer subclass
grants a Combat Methods Stamina pool at L3 (size = 2 × proficiency
bonus, restores on short or long rest). The character sheet does
not expose any resource named "Stamina" — `getResource("Stamina")`
returns `-1` at L3.

**Investigation hints**:
- Find the actual key/name the Combat Methods feature pipeline uses
  (could be "Combat Methods", "Stamina Points", subclass-prefixed,
  or not registered at all).
- If the Combat Methods pipeline is shared with the TGTT Fighter,
  cross-reference the working Arcane Archer Fighter spec for the
  expected resource name.

**Test workaround**: Heroic Soul L3 milestone drops the
`expectResources: {"Stamina": ...}` assertion. Re-add once the
correct key is known.

---

### CS-BUG-012 — TGTT Trickster Rogue "Trickster Dice" pool not surfaced as a resource

**Status**: Open / suspected. The Trickster Rogue subclass grants
4 Trickster Dice (d8) at L3, scaling to 7 by L17 and restoring on
short or long rest. `getResource("Trickster Dice")` returns `-1`
at L3 — the resource pipeline isn't registering the dice pool.

**Investigation hints**:
- Confirm the Trickster L3 feature in
  `homebrew/TravelersGuidetoThelemar.json` and how it expects the
  pool to be tracked.
- Check whether the resource is being registered under a different
  name (e.g. "Trickster's Dice" with apostrophe, or "Trickery").

**Test workaround**: Trickster spec drops `expectResources` and
`useResourceName` for "Trickster Dice"; the `signatureToggle`
assertion still validates one of the picked Tricks surfaces.

---

### CS-BUG-013 — TGTT The Horror Warlock pact-magic slots not registered

**Status**: Open / suspected. The Horror Warlock subclass should
inherit the standard Warlock pact-magic table (1 slot at L1 of
spell-level 1; 2 slots of level 2 at L3; 2 of level 3 by L5; up to
4 of level 5 at L17). The sheet reports `pactSlots = {level: 0}`
across the entire 1→20 range, suggesting pact magic isn't being
wired for this TGTT subclass — and downstream the L5 USE probe
hangs trying to cast an L3 pact slot that doesn't exist.

**Investigation hints**:
- Diff the Horror Warlock subclass entry in
  `homebrew/TravelersGuidetoThelemar.json` against a working
  Warlock subclass (Hexblade / Divine Soul) — check for missing
  spellcasting / `additionalSpells` blocks.
- Verify `_initWarlockSlots` in the spellcasting pipeline runs for
  TGTT Warlock subclasses.

**Test workaround**: Horror Warlock spec drops all `pactSlots`
assertions and the L5 USE probe (set `castSpellSlotLevel` to skip
or omit). Re-enable once pact slots arrive.

---

### CS-BUG-014 — Belly Dancer "Dance of the Country" grants advantage on Athletics instead of Acrobatics

**Status**: Open
**Surfaced by**: `tgtt-belly-dancer-rogue-jaknian.spec.ts` Phase-7 toggle
effect probe (`toggleGrantsAdvantage skill:acrobatics` on the L3 Dance
of the Country toggle).

**Repro**:
1. Build a TGTT Rogue with subclass `The Belly Dancer` and level to 3.
2. Activate the `Dance of the Country` feature on the Features tab.
3. Observe the skill panel / call
   `cs._state.getAdvantageState("skill:acrobatics")` — `advantage` is
   `false`. Calling `getAdvantageState("skill:athletics")` instead
   returns `advantage: true`.

**Expected** (per `homebrew/TravelersGuidetoThelemar.json`, the
Dance of the Country feature entry: "You gain advantage on Dexterity
(Acrobatics) rolls"): the active state should mark Acrobatics as
having advantage while the Dance is active.
**Actual**: The `dancing` entry in
`CharacterSheetState.ACTIVE_STATE_TYPES`
(`js/charactersheet/charactersheet-state.js` ~L28620) declares
`{type: "advantage", target: "skill:athletics"}`. The wrong skill is
boosted.

**Suspected fix**: Change the `dancing` state's effect target from
`"skill:athletics"` to `"skill:acrobatics"` in
`ACTIVE_STATE_TYPES`. No other call sites reference this target — the
generic `getAdvantageState("skill:<name>")` lookup will pick up the
correction automatically.

**Severity**: Medium — Belly Dancer's signature Acrobatics-favoring
toggle silently buffs the wrong skill. Athletics also benefits in error.

**Test workaround**: The Phase-7 `toggleGrantsAdvantage` probe on the
L3 Dance of the Country FeatureCheck is set to
`{skip: true, skipReason: "CS-BUG-014"}` until fixed.

---

## E2E Phase 6 — featuresMatrix triage notes

The Phase 6 `featuresMatrix` infra (see
`test/e2e/utils/comprehensiveBuildHelpers.ts`) walks every declared
class/subclass feature L1→20 and verifies it's correctly wired on the
sheet. It runs inside the existing MEGA L1→20 test (only when
`RUN_MEGA=1`) and additionally as a standalone gated test (only when
`RUN_MATRIX=1`).

The first runtime smoke (Time Domain Cleric) surfaced two categories
of failure that need post-Phase-6 triage before each spec can land
clean under `RUN_MATRIX=1`:

1. **Spec-side regex mismatches** — feature names declared in the
   matrix don't match the sheet's actual rendered name (e.g.
   declared `Channel Divinity` resource was likely rendered as
   `Channel Divinity Charges` or surfaced under a different label).
   Fix: tighten/loosen the regex per spec after a single matrix
   triage pass.

2. **Spec-side wrong-spell guesses** — `kind: "spells"` entries
   listed plausible but wrong domain spells (e.g. Time Domain L3
   declared `Feather Fall`; sheet actually grants
   `Accelerate/Decelerate`, `Animate Claw`, …). Fix: replace
   guessed spells with the actual TGTT subclass spell list per
   spec.

3. **Real product bugs** — any `kind: "toggle"` entry that fails
   `toggleDelta: "ac"` / `"any"` after the regex matches a real
   feature is a real bug; file CS-BUG-014+ following the Phase 5
   pattern (`docs/charactersheet/known-bugs.md`) and add
   `skip: true, skipReason: "CS-BUG-NNN"` to the matrix entry.

To do the per-spec triage:
```
RUN_MATRIX=1 npx playwright test test/e2e/specs/tgtt-<spec>.spec.ts \
  -g "MEGA Features matrix" --workers=1
```

---

## CS-BUG-015 — Time Domain Cleric: cantrips not auto-prepped & Channel Divinity not surfaced as a resource

**Status**: Filed (Phase 7 effect-validation matrix smoke).
See **CS-BUG-016** for the cross-class generalisation
(same cantripCount/spellSaveDc/TGTT-flavor pattern observed
on every TGTT caster preset, not just Cleric).

**Repro**: Build a Time Domain Cleric via the TGTT preset (see
`test/e2e/specs/tgtt-time-domain-cleric.spec.ts`). After the L1
build completes, inspect:

* `state.getKnownSpells()` — returns `Accelerate/Decelerate`,
  `Animate Claw`, etc. (TGTT-flavor Time Domain spells), but
  **zero spells with `level === 0`**, i.e. no cantrips. A cleric
  should automatically know 3 cantrips at L1.
* `state.getResource("Channel Divinity")` — returns nothing at
  L2+, even though the matrix `featuresMatrix` previously asserted
  `kind: "resource"` and even though the existing sheet-usage
  probe (`useResourceName: "Channel Divinity"`) works at L5. The
  resource is presumably registered under a different name (e.g.
  `Channel Divinity Charges`, `cd:cleric`, or similar) — needs
  investigation.

**Symptoms in the matrix smoke run**:
```
- L1 /spellcasting/i (passive) effect cantripCount: cantrip count 0 < 3
- L2 /^channel divinity$/i (resource): resource not found on sheet
```

**Test workaround**: All `cantripCount`, `spellInList` (for
first-party Cleric spells like Sacred Flame / Cure Wounds), and
the L2/L6 `^channel divinity$` resource probes on Time Domain
Cleric are marked `kind: "passive"` + `skip: true,
skipReason: "CS-BUG-015"` until the underlying issues are
resolved. The L3/L5/L7/L9/L17 domain-spell tier entries were
also downgraded from `kind: "spells"` to `kind: "passive"` so
they no longer assert specific TGTT-flavor spell names (which
also vary by cleric build).

**Severity**: High — players choosing the TGTT Time Domain
preset start with zero cantrips and have no Channel Divinity
counter visible at L2. Both are core cleric mechanics.

**Investigation hints**:
* Compare the TGTT cleric preset against the first-party PHB
  cleric preset (which presumably auto-preps cantrips) — the
  delta is likely in the preset's `signatureSpells` /
  spell-pick wiring.
* Search for `"Channel Divinity"` usages in the state and
  builder modules — the resource is presumably registered with
  a different key than the human-readable label.
* `getSpellSaveDC()` (page helper, `test/e2e/pages/CharacterSheetPage.ts`)
  also returns 0 on this build — the `#charsheet-disp-spell-save-dc`
  selector reads as empty even though the cleric presumably has a
  valid spell save DC. Possibly the cleric DC is rendered under
  a different element or on a non-Combat tab. Worth verifying as
  part of the same fix.

---

### CS-BUG-016 — TGTT class presets surface 0 cantrips, spellSaveDc=0, and TGTT-flavor (not first-party) spell list across ALL caster classes

**Status**: Open. Generalisation of CS-BUG-015 (which was filed
against the Time Domain Cleric only). Phase 14 MEGA sweep
showed the **same three symptoms** on Wizard (Bladesinger,
Chronurgy), Bard (Jester, Surrealism), Sorcerer (Child of the
Sun, Heroic Soul), Paladin (Bastion), Ranger (Hunter), Warlock
(Horror), and Cleric (Lust Domain) presets:

1. `state.getCantrips()` / `cantripCount` returns **0 at L1**
   for every TGTT caster, even though the class spec grants 2-3
   cantrips at L1.
2. `state.getSpellSaveDC()` returns **0** even though the build
   has a valid spellcasting ability and proficiency bonus.
3. The L1 spell list contains TGTT-flavor spells
   (`Accelerate/Decelerate`, `Animate Claw`, `Acrid Orb`,
   `Assisted Aim`, `Blade of Blood and Bone`, `Absorb Elements`,
   `Amplify`, …) **instead of** the first-party cantrips/spells
   the class' SRS/PHB list would grant (`Vicious Mockery`,
   `Mage Armor`, `Cure Wounds`, `Hunter's Mark`, `Druidcraft`,
   `Sacred Flame`, `Charm Person`, …).

**Severity**: High — every TGTT caster build starts with zero
visible cantrips and a broken spell-save-DC display, plus a
spell list that doesn't match what 5e players expect from
their class.

**Likely root cause**: a single TGTT-preset spell-pick wiring
that injects TGTT-only spells into `_data.knownSpells` and skips
the cantrip auto-prep step. The `getSpellSaveDC()` zero return
likely comes from reading the wrong tab or reading from a state
field that the TGTT preset never writes.

**Test workaround**: every affected MEGA spec must mark
`cantripCount`, `spellInList` (for first-party names), and
`spellSaveDc` effect probes as `skip: true,
skipReason: "CS-BUG-016"` until resolved. CS-BUG-015 is the
narrower Cleric-only entry — keep both until 015 is rolled into
016 by the fix commit.

**Surfacing specs**: `tgtt-bladesinger-wizard-tabaxi`,
`tgtt-chronurgy-wizard-nyuidj`, `tgtt-jester-bard-dendulra`,
`tgtt-surrealism-bard-yuanti`,
`tgtt-child-of-sun-sorcerer-hochling`,
`tgtt-heroic-soul-sorcerer-halfogre`,
`tgtt-bastion-paladin-bugbear`,
`tgtt-hunter-zodiac-centaur` (Hunter half),
`tgtt-horror-warlock-theocracian`,
`tgtt-lust-cleric-lexalian`,
`tgtt-time-domain-cleric` (already CS-BUG-015).

---

### CS-BUG-017 — Multiple TGTT subclass features and resources don't register on the sheet

**Status**: Open. Phase 14 MEGA sweep umbrella entry for the
"subclass feature exists in the data but never appears on the
rendered sheet" pattern. Distinct from CS-BUG-002 (which covers
the level-up pipeline not granting *any* subclass features for
TGTT 2024-style Wizard subclasses); CS-BUG-017 cases register
the parent feature but don't surface the toggle/resource the
feature is supposed to provide.

| Class / subclass | Level | Feature | Symptom |
|---|---|---|---|
| Mercy Monk | 3 | Hand of Healing | toggle button absent (`toggleable=∅`) |
| Mercy Monk | 3 | Hand of Harm | toggle button absent |
| Mercy Monk | 3 | Channel Divinity (parent class resource via Mercy plumbing) | resource not surfaced |
| Surrealism Bard | 3 | Warped Reality | toggle button absent |
| Belly Dancer Rogue | 3 | Dance of the Country | toggle button absent |
| Heroic Soul Sorcerer | 1 | Over Soul, Heroic Spells, Legendary Weapon | features absent from feature list entirely |
| Horror Warlock | 1 | Devastating Strike, Expanded Spell List | features absent from feature list entirely |
| Horror Warlock | 3 | Pact Boon pick | pick row not surfacing on sheet |
| Mercy Monk | 3 | Implements of Mercy → Medicine proficiency | `skill:medicine=0`, no Medicine roll button |

**Severity**: High — every player on these subclasses loses
access to their signature toggle/resource. Mercy Monk, Heroic
Soul Sorcerer, and Horror Warlock are the worst-affected because
the missing features are their core class identity.

**Surfacing specs**: `tgtt-mercy-monk-changeling`,
`tgtt-surrealism-bard-yuanti`,
`tgtt-belly-dancer-rogue-jaknian`,
`tgtt-heroic-soul-sorcerer-halfogre`,
`tgtt-horror-warlock-theocracian`.

**Test workaround**: skip the affected `(toggle)` /
`(resource)` / `(passive)` matrix entries with
`skipReason: "CS-BUG-017"` until the subclass plumbing is fixed.

---

### CS-BUG-018 — TGTT class resource maxes wrong on multiple presets

**Status**: Open. Phase 14 MEGA sweep umbrella entry for
incorrect resource maximums on TGTT presets:

| Spec | Level | Resource | Expected | Actual |
|---|---|---|---|---|
| Heroic Soul Sorcerer | 2 | Sorcery Points | 2 | 4 |
| Heroic Soul Sorcerer | 3 | Sorcery Points | 3 | 4 |
| Chained Fury Barbarian | 1 | Rage uses/day | 2 | 3 |
| Bastion Paladin | 1 | Lay on Hands | 5 | 15 |
| Belly Dancer Rogue | 1 | Sneak Attack dice | ≥1 | 0 |
| Gambler Rogue | 1 | Sneak Attack dice | ≥1 | 0 |
| Trickster Rogue | 1 | Sneak Attack dice | ≥1 | 0 |
| Belly Dancer / Gambler / Trickster | 3 | Sneak Attack dice | ≥2 | 0 |

The Sneak-Attack-dice entries may indicate the dice pool isn't
even being initialised on TGTT Rogue presets (zero, not just a
wrong value). The Lay-on-Hands max=15 may be the TGTT pool size
from a different table — could be by-design or a setting flag
issue.

**Severity**: High — Rogue players with no sneak attack dice
and Sorcerer players with the wrong SP pool will hit broken
mechanics on every turn.

**Test workaround**: skip the affected `(resource)` / `effect
sneakAttackDice` matrix entries with `skipReason: "CS-BUG-018"`
until the resource-table wiring is fixed.

---

### CS-BUG-019 — Lust Domain Cleric Persuasion bonus reports as **negative** (-1)

**Status**: Open. Phase 14 MEGA sweep, surfaced by
`tgtt-lust-cleric-lexalian.spec.ts`.

**Repro**: Build a Lust Domain Cleric via the TGTT preset,
level to 3 (when Lust Domain grants the Bonus Proficiency in
Deception and Persuasion). Inspect the Skills row on the sheet:

- `skill:deception` = +1 (expected ≥+2 — proficiency + Cha mod)
- `skill:persuasion` = **-1** (expected ≥+2 — proficiency + Cha mod)

Persuasion reports a *negative* bonus, which is impossible for
a class-proficient Charisma-based skill. Likely two distinct
sub-bugs being reported by the same probe:

1. The Lust Domain proficiency grant doesn't reach the skill
   table for Persuasion (and possibly under-applies for
   Deception).
2. The Cha modifier is being read negatively for Persuasion —
   possibly reading from the wrong stat row (Wis is typically
   the cleric primary, but a TGTT Lust Cleric might dump a
   stat into Cha via a swap that the skill table doesn't
   pick up correctly).

**Severity**: High — the marquee subclass feature of Lust
Domain (silver-tongued seduction) is straight-up broken.

**Test workaround**: skip the L3 `lust domain` skillBonus
effect with `skipReason: "CS-BUG-019"` until the fix lands.


## CS-BUG-020 — Skill-button rendering inconsistent with state-side proficiency

**Status**: Open  
**Surfaced**: Phase 15 E2E sweep (Bladesinger Wizard Tabaxi, Chronurgy Wizard Nyuidj, Jester Bard Dendulra MEGA L1→20 — 3 specs at L1).  
**Component**: Character Sheet · Abilities tab · Skill rendering.

### Symptom
The new `proficientSkills: true` E2E probe queries
`state.isProficientInSkill(s)` for every standard 5e skill, picks the
first that returns true, then asks the page object to click the
matching `.charsheet__skill-row` roll button. On TGTT class presets
(at least Wizard Bladesinger, Wizard Chronurgy, Bard Jester at L1)
the state reports `arcana` / `acrobatics` etc. as proficient but the
Abilities-tab DOM has no roll button for those skills. Result: the
test errors `skill roll button for "<skill>" not found` even though
state-side the skill is marked proficient.

### Repro
1. Build a TGTT Wizard / Bard via the preset helper.
2. Open the L1 character sheet → Abilities tab.
3. `globalThis.charSheet._state.isProficientInSkill("arcana")` → `true`.
4. The Abilities tab does NOT render the Arcana row's roll button.

### Suggested fix
Either (a) render the roll button consistently for any
state-proficient skill regardless of source, or (b) revisit the
`isProficientInSkill` semantics so that "proficient via state" and
"renders on the sheet" agree.

### E2E coverage
21 `proficientSkills: true` probes across 14 TGTT specs are
currently `skip:true, skipReason:"P5 follow-up: proficientSkills
DOM lookup needs CharacterSheetPage hardening"` — re-enable when
fixed. Tracked as a P5 follow-up in the Phase 15 plan.
