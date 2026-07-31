# Character Sheet — Known Bugs Tracker

Living list of confirmed character-sheet bugs surfaced by the E2E suite
(`test/e2e/specs/tgtt-*.spec.ts`) or otherwise reproducible. Each entry
should include: status, repro, suspected root cause, affected tests, and
notes for whoever fixes it.

When fixing one, move the entry to the **Resolved** section with a
commit reference rather than deleting it.

---

## Phase 16 — E2E spec doctrine sweep (no-blind-spots)

A doctrine sweep across the 19 TGTT E2E specs replaced every
`void buildXChecks; // CS-BUG-NNN` suppression with the canonical
`withSkipReason(buildXChecks(...), "CS-BUG-NNN")` wrapper added to
`scripts/_genTgttPools.helpers.ts`. Helper invocations now stay in
the `featuresMatrix` even when the picks they assert are blocked,
carrying the CS-BUG pointer so `scripts/auditE2eCoverage.mjs` and
human reviewers see the gap instead of a hidden hole.

Specs touched (all still report **✓ FULL** coverage after the edit):
- `tgtt-arcane-archer-fighter-hochling.spec.ts` (`buildBattleTacticChecks`, `buildAnyArcaneShotChecks` → CS-BUG-017)
- `tgtt-belly-dancer-rogue-jaknian.spec.ts` (`buildSpecialtyChecks` → CS-BUG-017)
- `tgtt-gambler-rogue-clairnian.spec.ts` (`buildSpecialtyChecks` → CS-BUG-017)
- `tgtt-horror-warlock-theocracian.spec.ts` (`buildAnyInvocationChecks` → CS-BUG-017)
- `tgtt-jester-bard-dendulra.spec.ts` (`buildJesterActChecks` → CS-BUG-017)
- `tgtt-trickster-rogue-goblin.spec.ts` (`buildSpecialtyChecks`, `buildTricksterTrickChecks` → CS-BUG-017)

Open bugs re-affirmed by the sweep (no new CS-BUGs filed; all
failures encountered during validation matched existing entries):
- **CS-BUG-017** still blocks pick-rendering for Specialties past L11,
  Battle Tactics past L3, Trickster Tricks, Jester Acts, Eldritch
  Invocations, Arcane Shot, Pact Boons (now visible via `skipReason`
  on every helper-emitted row).
- **CS-BUG-013** still blocks Horror Warlock pact-magic slots.
- ~~**CS-BUG-018** still blocks several class resource maxes.~~
  **Superseded** — CS-BUG-018 itself is Fixed, and the resource-max
  failures attributed to it here were the harness resource-surface
  blindness now tracked as **CS-BUG-027**. The Indomitable and Action
  Surge maxes assert and pass.

Infra note: three `beforeEach` hook timeouts under 3-worker parallel
load (the original `gotoWithThelemar` flake — not a regression; the
same specs pass under `--workers=1`). No new infra bugs filed.

### Iteration 2 — export-loss fix + universal-helper coverage

A follow-up iteration addressed two gaps surfaced after the first
sweep:

**Infra fix — post-test JSON exports lost under parallel workers.**
Before: a 6-spec / 3-worker run produced only ~9 of 48 expected
`test-results/exports-for-validation/<spec>/<test>--<status>.json`
files; per-spec coverage was a binary "all 6 or zero". Root cause:
`EXPORTS_ROOT` in
[characterSpecFactory.ts](../../test/e2e/utils/characterSpecFactory.ts)
was anchored to `process.cwd()`, which Playwright workers can rebase
to a per-test output dir that gets nuked by the per-test cleanup.
Fix: anchor `EXPORTS_ROOT` to `path.dirname(fileURLToPath(import.meta.url))`
three segments up — worker-cwd-independent. Also added a sentinel
`_export_failures.log` append-on-catch so future losses surface
without depending on `console.warn` buffering. Verified: 36/36
exports on the re-run; 19/19 on the Phase H follow-up; no failures
log written in either run.

**Coverage additions — 4 specs upgraded with universal helpers**
(all four remain ✓ FULL/OK after the edits, no test regressions):
- `tgtt-mercy-monk-changeling.spec.ts` —
  `buildSpecialtyChecks("Monk")` (replaces 10 open-coded
  `skipReason: "CS-BUG-017"` rows) + `buildPreciseStrikeChecks()`
  (Mercy Monk's Precise Strike Methods picker; first use of the
  helper in any spec).
- `tgtt-child-of-sun-sorcerer-hochling.spec.ts` —
  `buildAnyMetamagicChecks(["TGTT"])` appended additively to the
  existing rich `pickToggleable` rows so the per-pick
  `pickedFeatureGrants` probe is also exercised.
- `tgtt-heroic-soul-sorcerer-halfogre.spec.ts` — same additive
  pattern.
- `tgtt-hexblade-divine-soul-tortle.spec.ts` — introduced
  `HEXBLADE_LEVELMAP = {1:1, 2:2}`, added
  `buildAnyInvocationChecks(["XPHB","XGE","TGTT"], …,
  HEXBLADE_LEVELMAP)` for the Warlock leg, and migrated the
  Sorcerer leg from the deprecated `buildMetamagicChecks` to
  `buildAnyMetamagicChecks(["TGTT"], …, SORC_LEVELMAP)`. Pact Boon
  (`buildAnyPactBoonChecks`) deliberately omitted: the build caps
  at Warlock 2 and Pact Boon arrives at Warlock 3.

**Deferred to a future iteration** (not blocked by any CS-BUG, but
require non-trivial preset inspection before wiring):
- `buildDreamwalkerChecks` — no current spec uses the Dreamwalker
  subclass; helper waits on the first such spec being authored.
- `buildPactBoonChecks` / `buildAnyPactBoonChecks` for the
  Horror Warlock spec (Phase H.3 hexblade leg already skipped per
  level cap; horror-warlock would need a `withSkipReason("CS-BUG-017")`
  wrapper since picks don't surface).

### Iteration 3 — full-suite verification + weapon-mastery coverage

A third sweep validated the Iteration-2 export-loss fix at full
suite scale and resolved the deferred weapon-mastery coverage:

**Full suite verification.** A clean
`rm -rf test-results/exports-for-validation` + full
`tgtt-*.spec.ts` run (3 workers, 31.3 min) produced **120 passed /
1 failed (Horror Warlock L1 export-round-trip — pre-existing 60 s
timeout, infra) / 38 skipped**, with **every one of the 20 export
directories populated** (56 JSON files total — every test that
reached `afterEach` exported successfully; no
`_export_failures.log` written).

**Weapon-mastery picker is deterministic.** Extracted from the L1
exports across all 7 martial specs: the wizard's
`selectFirstAvailableWeaponMasteries(N)` reliably picks the first
N proficient simple weapons in DOM order — `Club + Dagger` for the
six 2-pick presets, `Club + Dagger + Dart` for the only 3-pick
preset (`PRESET_FULL_ARCANE_ARCHER_HOCHLING`). All 20 spec
directories produced exports under the same naming.

**Coverage additions — 7 specs upgraded** (all FULL except
hunter-zodiac which lands at 92% OK due to multiclass leg
distribution; all compile clean, no test regressions on the
single-spec re-verify of bastion-paladin: 6/6 expected exports):
- `tgtt-arcane-archer-fighter-hochling.spec.ts` —
  `buildWeaponMasteryChecks(["Club","Dagger","Dart"])` (Fighter
  3 picks).
- `tgtt-bastion-paladin-bugbear.spec.ts`,
  `tgtt-chained-fury-barbarian-minotaur.spec.ts`,
  `tgtt-belly-dancer-rogue-jaknian.spec.ts`,
  `tgtt-gambler-rogue-clairnian.spec.ts`,
  `tgtt-trickster-rogue-goblin.spec.ts` —
  `buildWeaponMasteryChecks(["Club","Dagger"])` (2 picks each).
- `tgtt-hunter-zodiac-centaur.spec.ts` —
  `buildWeaponMasteryChecks(["Club","Dagger"])` added to both
  `HUNTER_FEATURES_MATRIX` (L20 standalone leg) and
  `HUNTER_ZODIAC_MULTI_FEATURES_MATRIX` (multiclass Ranger leg).

**Intentionally LOW.** `tgtt-time-domain-cleric.spec.ts` audits
at 65% (LOW). Every probe in this matrix is gated on CS-BUG-015
(TGTT Time Domain prepares TGTT-flavor spells in place of
first-party domain spells, and Channel Divinity / spell-save-DC
helpers return 0 on the build). Adding more checks here would
create false failures, not real coverage — leave LOW until
CS-BUG-015 is resolved.

---

## Open

### CS-BUG-002 — Subclass features not granted on level-up (TGTT 2024-style subclasses)

**Status**: Fixed (Wave 3)
**Surfaced by**:
- `tgtt-bladesinger-wizard-tabaxi.spec.ts` (L3, L5, L7, MEGA — fails with `expected toggle matching /bladesong/i`)
- `tgtt-chronurgy-wizard-nyuidj.spec.ts` (L7, MEGA L1→20 — `probeToggleDelta: no feature matches /chronal|convergent|temporal|momentary/i`; activatable feature list shows zero subclass features)
- `tgtt-hexblade-divine-soul-tortle.spec.ts` multiclass MEGA — at L2 (Warlock 2) the feature list lacks any Hexblade entry (no Hex Warrior, no Hexblade's Curse); only base Warlock 2024 features (Pact Magic, Magical Cunning, Eldritch Invocations) are present.
- `tgtt-heroic-soul-sorcerer-half-ogre.spec.ts` (L3 export — `features` array has no subclass entries; Heroic Spells / Over Soul / Legendary Weapon never reach the sheet).
- `tgtt-the-horror-warlock-theocracian.spec.ts` (L3 — Expanded Spell List / Devastating Strike both missing).

**Root cause**: `_applyLevelUp` (`charactersheet-levelup.js:3811`) and the
parallel batch path in `_applyQuickBuild`
(`charactersheet-quickbuild.js:4074`) only call
`getLevelFeatures(classData, newLevel, selectedSubclass, …)` for the
CURRENT level when a subclass is first picked. That returns subclass
features declared at `feature.level === newLevel`. But many 2024-style
subclasses — including all TGTT Sorcerer/Warlock subclasses, plus
first-party Bladesinger/Chronurgy in their TGTT-shaped payload —
declare features at levels BELOW the subclass-gain level (TGTT classes
grant the subclass at L3, but Heroic Soul / Fiendish Bloodline / The
Horror all declare L1 subclass features). The earlier per-level apply
runs saw `subclass: null` so the iterator in `getLevelFeatures` had
nothing to walk; those features were lost forever.

**Fix**:
- `charactersheet-levelup.js:3811-3837` and
  `charactersheet-quickbuild.js:4072-4093`: when a subclass is first
  selected, additionally loop `getLevelFeatures(...)` for every level
  `1..(newLevel - 1)`, filter for `isSubclassFeature`, and append the
  catch-up subclass features into the apply set. `selectedSubclass` is
  only truthy on the level where the subclass is first picked, so the
  loop can't create duplicates on subsequent level-ups.

**Regression coverage**:
`test/jest/charactersheet/CharacterSheetClassUtilsFeatureBuild.test.js`
adds a `getLevelFeatures` test that confirms subclass features
declared at L1 are reachable when queried with `level=1` + the
subclass payload, and that querying at the gain level (L3) without an
inherent L3 subclass feature returns no L1 features — proving the
backfill loop is the right place for the fix.

**Severity**: High — was preventing every defining feature of
several signature TGTT subclasses from ever reaching the sheet.

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
multiclass MEGA E2E test. Also re-surfaces in
`divine-soul-affinity.spec.ts > should collect and persist Divine
Soul affinity during Level Up` — after the affinity modal closes,
its backdrop intercepts clicks on the L2 Sorcerer level-up HP
accordion, same DOM signature (`.ve-ui-modal__overlay intercepts
pointer events`). Repro: build a character at L2, multiclass
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

**Status**: **Fixed (Wave 2)** + spec-side workaround applied.

**Root cause (two-part)**:

1. **Product (defense-in-depth)**: `activateState("rage")` already
   honored `breaksConcentration` and broke concentration correctly
   (verified by direct Jest repro). However the lower-level
   `addActiveState()` entry point did NOT carry the same guard — any
   code path that bypasses `activateState` (now or in the future)
   could activate Rage without clearing concentration. Both
   `breaksConcentration` and `exclusiveWith` are now applied inside
   `addActiveState` as well; both ops are idempotent so calling
   through `activateState` (which still has its own guard) is safe.
2. **E2E infra**: the test was calling
   `charSheet.activateFeature("Rage")`, which targets the Features
   tab `.charsheet__feature-toggle` element. That class is the **card
   collapse chevron**, not an activation control — clicking it never
   activates Rage. The spec now drives rage via
   `page.evaluate(() => cs._state.activateState("rage"))`, same
   pattern as the "damage" branch of the same probe.

**Fix**:
- `js/charactersheet/charactersheet-state.js:32152` — `addActiveState`
  now mirrors the `exclusiveWith` + `breaksConcentration` guards
  from `activateState`.
- `test/e2e/utils/characterSpecFactory.ts:443` — `concentrationCheck`
  with `thenAction: "rage"` now drives state directly.
- `test/e2e/specs/tgtt-chained-fury-barbarian-minotaur.spec.ts:30` —
  removed `{skip: true}`; probe now runs with
  `castSpell: "Bless", thenAction: "rage", expectActive: false`.

**Follow-up**: the Features tab does not currently expose an
"Activate" affordance for state-bearing features (Rage, Bladesong,
etc.) — only the Combat tab's `#charsheet-combat-rage` button does.
Worth filing separately as a UI consistency gap.

---

### CS-BUG-008 — Bardic Inspiration not restored on short rest at L5+ (XPHB Font of Inspiration)

**Status**: **Fixed (Wave 2)**.

**Root cause**: `CharacterSheetClassUtils.updateClassResources` (called
on every level-up) only updated `existingResource.max` when a max
increased. It never touched `existingResource.recharge`, so a Bard
that leveled L1→L4 with `recharge: "long"` kept that recharge after
crossing L5 — even though the L5 `resourceDef` correctly specifies
`recharge: newLevel >= 5 ? "short" : "long"`. New characters created
at L5+ via the Builder were fine (initial creation set it correctly);
only the level-up path was broken.

**Fix**: `js/charactersheet/charactersheet-class-utils.js:3082` — on
every `updateClassResources` pass, sync
`existingResource.recharge` to the current `resourceDef.recharge`.
Idempotent for resources whose recharge never changes
(Rage / Sorcery Points / Lay on Hands).

**Test follow-up**: `shortRestRestores` skip on
`tgtt-surrealism-bard-yuanti.spec.ts` can be removed once a fresh
E2E run confirms the fix.

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



### CS-BUG-010 — TGTT Gambler Rogue third-caster slot table under-counted

**Status**: **Fixed (Wave 4)**.

**Root cause**: `CharacterSheetState.calculateSpellSlots` used
`Math.floor(level / 3)` unconditionally for every 1/3 caster. That is
the PHB p.164 **multiclass** rounding rule, not the per-class table.
The XPHB / PHB single-class table for Eldritch Knight / Arcane
Trickster (and the TGTT Gambler / Architect of Ruin that copy it) is
effectively `Math.ceil(classLevel / 3)`: L3 → 2 L1 slots, L4-6 → 3,
L7-9 → 4, etc. The pre-fix code under-counted slots by 1 across the
entire single-class progression (e.g. Rogue L5 saw 2 L1 slots
instead of 3, Rogue L7 saw 2 instead of 3).

**Fix**: `js/charactersheet/charactersheet-state.js:8415-8421` —
the 1/3 caster branch now mirrors the existing 1/2 caster branch:
`isMulticlassCaster ? Math.floor(level / 3) : Math.ceil(level / 3)`.
Single-class third casters use the per-class table; multiclassing
still rounds down as PHB requires.

**Regression coverage**: `CharacterSheetEdgeCases.test.js` —
"CS-BUG-010: single-class third-caster uses ceil(level/3)" (Rogue 5
→ 3 L1 slots) and "CS-BUG-010: multiclass third-caster still uses
floor(level/3)" (Wizard 1 + EK 5 → 3 L1 slots).

**Test follow-up**: drop the relaxed L3/L5 Gambler milestones in
`tgtt-gambler-rogue-clairnian.spec.ts`; assert the full progression.

---

### CS-BUG-011 — TGTT Heroic Soul Sorcerer "Stamina" / Combat Methods pool not surfaced as a resource

**Status**: Closed, not a bug but a problem in homebrew source that was fixed.

### CS-BUG-012 — TGTT Trickster Rogue "Trickster Dice" pool not surfaced as a resource

**Status**: **Fixed (Wave 2)**.

**Root cause**: The Trickster subclass's L3 feature
("Trickster's Shenanigans") declares Trickster Dice as prose only in
`homebrew/TravelersGuidetoThelemar.json` (lines 27885-27890). There's
no structured `resources` payload, and the text-parser
(`parseUses`) doesn't recognize "four trickster dice" without a
`(\d+)\s*(times|uses)` shape. So the dice pool was never registered.

**Fix**: `js/charactersheet/charactersheet-class-utils.js` —
`updateClassResources` now has a `"Rogue"` entry that registers
"Trickster Dice" when the active subclass is TGTT Trickster:
4 dice at L3, 5 at L9, 6 at L13, 7 at L17, recharge "short".

**Test follow-up**: re-enable `expectResources: {"Trickster Dice": 4}`
+ `useResourceName: "Trickster Dice"` on
`tgtt-trickster-rogue-goblin.spec.ts`.

---

### CS-BUG-013 — TGTT The Horror Warlock pact-magic slots not registered

**Status**: Stale (Wave 1 triage — closing). Per
`test-results/exports-for-validation/the-horror-warlock-theocracian/l5-extra-attack-3rd-level-slots-prof-3--passed.json`
the L5 export now shows `spellcasting.pactSlots = {current: 2, max: 2,
level: 3}` — the standard XPHB Warlock L5 pact table. The bug
likely fixed itself in a downstream change to the spellcasting
pipeline. Builder-side issue at the Spells step is tracked
separately as **CS-BUG-024**. Re-file a new entry if a regression
surfaces on a future MEGA run.

---

### CS-BUG-014 — Belly Dancer "Dance of the Country" grants advantage on Athletics instead of Acrobatics

**Status**: Fixed (Wave 1 triage).
**Surfaced by**: `tgtt-belly-dancer-rogue-jaknian.spec.ts` Phase-7 toggle
effect probe (`toggleGrantsAdvantage skill:acrobatics` on the L3 Dance
of the Country toggle).

**Root cause**: `ACTIVE_STATE_TYPES.dancing.effects` in
`js/charactersheet/charactersheet-state.js` (~L29484) declared
`{type: "advantage", target: "skill:athletics"}`. Per the homebrew
description ("advantage on Dexterity (Acrobatics) rolls") the target
should be `skill:acrobatics`.

**Fix**: One-line change in `ACTIVE_STATE_TYPES.dancing` — target
flipped from `skill:athletics` to `skill:acrobatics`. The Snake
Charmer AC bonus path at L17582 reads `isStateActive("dancing")` only
(not the skill target) so no other call sites needed updating.

**Spec update**: `toggleGrantsAdvantage skill:acrobatics` probe in
`tgtt-belly-dancer-rogue-jaknian.spec.ts` is no longer skipped for
014 (still skipped under the outer 017 toggle-registration umbrella).

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

### CS-BUG-016 — TGTT class presets surface 0 cantrips, spellSaveDc=0, and TGTT-flavor (not first-party) spell list across ALL caster classes

**Status**: **Reclassified as E2E infra-side (Wave 4 triage)** — not a
product bug. Keep the spec-side `skip` markers until the test
infrastructure is updated; product code is correct.

**Triage evidence** (Wave 4 — `test-results/exports-for-validation/`):

- Bladesinger Wizard L1 export: `cantripsKnown=[]`, `spellsKnown=[]`.
  At L3 the `spellsKnown` list is `["Absorb Elements",
  "Accelerate/Decelerate", "Acrid Orb",
  "Alabaster's Adjacent Acquisition"]` — the first four entries of an
  alphabetically-sorted spell list. At L5 it grows to the first eight.
- Surrealism Bard L1 export: `cantripsKnown=["Poison Spray"]` (the
  one cantrip is racial, granted by Yuan-ti, not by the Bard).
- Every other TGTT caster preset L1 export shows the same pattern:
  the only entries present are racial / item-granted; the class
  cantrip/spell pick produced an empty list.

In a real interactive session a user opens the cantrip/spell picker
modal at L1 and chooses from the full list (the modal IS shown for
TGTT casters — see `js/charactersheet/charactersheet-builder.js`
`_getSpellPickInfoForLevel1` at L8755+, which correctly reads
`cantripProgression` / `preparedSpellsProgression` /
`spellsKnownProgression` on every TGTT caster class). The E2E driver
appears to auto-fill picks by selecting the first N rows of whatever
list happens to be visible, and when no row is selected at all the
list stays empty. The "TGTT-flavor spells" reported in the bug are
just the alphabetical head of the TGTT spell catalogue, not a
product-side spell-list filter bug.

`spellSaveDc=null` in the JSON is the correct serialization for a
derived field (it's computed at render time from the spellcasting
ability + proficiency bonus). The renderer hasn't been observed
displaying `0` outside of the E2E DOM-probe — the probe likely reads
a tab that hasn't materialised yet during autopilot.

**Resolution**: No product-code change. The fix lives in the E2E
infrastructure (cantrip/spell auto-pick should select N rows in the
modal, not zero) and in spec-side spell-list assertions (specs should
assert real cantrips the test would have picked, not first-N
alphabetical TGTT entries). The first-party caster build path that
would actually expose a spell-pipeline regression (Bladesinger picks
from the Wizard spell list, not TGTT) already passes its
`spellSlots` and `casterProgression` probes — both spell slot
shape and caster-ability wiring are correct.

**Action for spec authors**: replace `skipReason: "CS-BUG-016"` with
`skipReason: "E2E-INFRA: cantrip/spell auto-pick empty"` and keep the
probes skipped until the E2E infrastructure issue is addressed
separately. Re-file a narrower bug only if a real interactive Builder
session reproduces empty cantrips after the user picks them.

**Surfacing specs** (kept for traceability): see prior revision —
every TGTT caster MEGA spec.

---

### CS-BUG-015 — Time Domain Cleric: cantrips not auto-prepped & Channel Divinity not surfaced as a resource

**Status**: **Closed as Stale (Wave 1) + Infra-side (Wave 4)**.

The Channel Divinity half is no longer reproducible — current Time
Cleric L5 export shows `resources` including
`{name: "Channel Divinity", current: 2, max: 2}`. The cantrip-
auto-prep half is the same E2E auto-pick gap documented under
CS-BUG-016 (above) — not a product bug. No code change needed.

---

### CS-BUG-017 — Multiple TGTT subclass features and resources don't register on the sheet

**Status**: Split & partial-fix landed.

This was originally an umbrella for two distinct failure modes; Wave 3
split them so each can be tracked independently.

#### CS-BUG-017a — features absent from the feature list entirely

**Status**: **Fixed (Wave 3)** — merged into CS-BUG-002. Same root
cause (subclass features declared at `level < subclass-gain level`
never apply when the subclass is first picked), same fix (catch-up
backfill loop in `_applyLevelUp` / `_applyQuickBuild`). Covers:

| Class / subclass | Level | Feature |
|---|---|---|
| Heroic Soul Sorcerer | 1 | Over Soul, Heroic Spells, Legendary Weapon |
| Fiendish Bloodline Sorcerer | 1 | Summoner's Magic, Summoned Ferocity, Infernal Companion |
| Horror Warlock | 1 | Devastating Strike, Expanded Spell List |

#### CS-BUG-017b — feature present, toggle / resource not surfacing

**Status**: Open — requires live-sheet repro (Wave 5). The features
are now in the feature list (after the 017a fix) but the rendered
sheet doesn't expose the toggle / resource UI for them.

| Class / subclass | Level | Feature | Symptom |
|---|---|---|---|
| Mercy Monk | 3 | Hand of Healing | toggle button absent (`toggleable=∅`) |
| Mercy Monk | 3 | Hand of Harm | toggle button absent |
| Mercy Monk | 3 | Channel Divinity (parent class resource via Mercy plumbing) | resource not surfaced |
| Surrealism Bard | 3 | Warped Reality | toggle button absent |
| Belly Dancer Rogue | 3 | Dance of the Country | toggle button absent |
| Horror Warlock | 3 | Pact Boon pick | pick row not surfacing on sheet |
| Mercy Monk | 3 | Implements of Mercy → Medicine proficiency | `skill:medicine=0`. ⚠️ The "no Medicine roll button" half of this row was a **harness** defect (skill rows are click-to-roll, no button exists) — see **CS-BUG-027(c)**. Only `skill:medicine=0` remains open. |

Notes for the eventual fix:
- `Dance of the Country` is already registered as a `dancing` state
  type with `detectPatterns: ["dance of the country"]` at
  `charactersheet-state.js:29481+`. The detection appears wired —
  this needs a live UI walkthrough to determine why the toggle button
  isn't rendering even though `detectActivatableFeature` should match.
- `Warped Reality` has no `activatable` metadata in
  `homebrew/TravelersGuidetoThelemar.json` — it relies on the
  text-detection path. May benefit from explicit `activatable` data
  rather than depending on heuristic parsing.
- `Hand of Healing` / `Hand of Harm` are first-party features whose
  classification is currently `"combat"` (`charactersheet-state.js:30507-30508`),
  which routes them through the combat-action path rather than the
  toggle path. Verify in live UI whether the Combat tab exposes them
  before treating this as a regression.

**Severity**: Medium — the features now exist on the sheet (after
017a) but their interactive surface is incomplete.

---

### CS-BUG-018 — TGTT Heroic Soul Sorcerer: Sorcery Points formula off-by-one

**Status**: **Fixed (Wave 2)**.

**Root cause**: `CharacterSheetClassUtils.updateClassResources`
(`charactersheet-class-utils.js:3033`) returned `lvl + 1` for the
TGTT Sorcerer branch of the Sorcery Points formula. Should be
plain `lvl` — TGTT grants Font of Magic at L1, so SP equals
sorcerer level from L1 onward (L1=1, L3=3, L5=5, ...). The `+1`
gave every TGTT Sorcerer one extra SP at every level.

**Fix**: removed the `+1`. Now `if (isTGTT) return lvl;`.

#### Closed sub-cases (originally filed under CS-BUG-018)

The following items from the original umbrella are no longer
reproducible against the current exports and were dropped from this
entry in Wave 1 triage. They remain documented here for history:

| Sub-case | Current export | Verdict |
|---|---|---|
| Chained Fury Rage L1=3 | L1 export: `Rage: 2/2` | Stale — fixed |
| Bastion Lay on Hands L1=15 | L1 export: `Lay on Hands: 5/5` | Stale — fixed |
| Belly Dancer / Gambler / Trickster Sneak Attack dice = 0 | SA isn't tracked via the resources array; it's a static class config (`sneakAttackDice = ceil(rogueLevel/2)`) | Spec-side — the `getResource("Sneak Attack")` probe is checking the wrong field. Move to E2E spec triage. |

---

### CS-BUG-019 — Lust Domain Cleric Persuasion bonus reports as **negative** (-1)

**Status**: **Fixed (Wave 2, partial)** — proficiency grant restored.
Negative Cha-mod display, if still present, is correct math
(Cha 8 = −1 mod) — proficiency now adds +PB on top.

**Root cause**: The TGTT Lust "Bonus Proficiencies" L3 feature is
prose only ("You gain proficiency in the Deception and Persuasion
skills…"). `CharacterSheetState`'s skill-proficiency text parser
(`charactersheet-state.js:925`) used per-skill regexes that only
matched a single skill immediately after `proficiency in/with [the]`.
For "Deception and Persuasion", Deception matched but Persuasion was
preceded by "and " — so the parser skipped it. Same shape would
also drop the middle skills in "X, Y, and Z" proficiency lists.

**Fix**: replaced the two single-skill patterns with one
list-aware pattern that walks an optional comma/and-separated
prefix and suffix around the target skill. Validated on:

- `Deception and Persuasion skills` → both grant
- `Insight, Religion, and History` → all three grant
- `Athletics and Survival` → both grant
- `the Insight skill` → still grants Insight
- `Choose any one of Acrobatics or Athletics` → no false grant

**On the negative bonus**: a TGTT Lust Cleric built with Cha 8
correctly shows −1 from the ability mod. With the proficiency fix,
the displayed bonus will be `PB + chaMod` = `+2 + (−1) = +1` at L3.
That's RAW. If the user wants Lust Cleric to have a positive
Persuasion bonus, raise Cha at chargen.

**Test follow-up**: lift the `skipReason: "CS-BUG-019"` on the L3
Lust Domain skillBonus effect probe and re-run.

---


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


## CS-BUG-021 — Subclass radio loses `checked` state after re-render in Level-Up wizard

**Status**: **Fixed (Wave 5)**.

**Root cause**: `_renderSubclassSelectionCompact` in
`js/charactersheet/charactersheet-levelup.js` rebuilt every subclass
radio from scratch on `renderList()` calls (triggered by search-text
edits, source-filter changes, and any other re-render of the inner
list). The `<input type="radio">` template hard-coded no `checked`
attribute and the function had no memory of the user's last pick, so
filter/search interactions left the accordion visually populated but
with zero radios checked.

**Fix**: track the selection inside the component
(`currentSelectedSubclass`), update it in the option click handler,
and conditionally emit `checked` + the `.selected` class in
`renderSubclassItem`. Caller signature now optionally accepts
`initialSubclass` so future re-mount paths can restore the pick
without changing existing call sites.

**Test follow-up**: drop `test.skip(... "blocked on CS-BUG-021")`
markers in `test/e2e/specs/levelup.spec.ts` (subclass selection at
L3, ASI at L4, and the 1→3 sequential test). A fresh Playwright run
should pass once the auto-fill no longer trips the radio reset.


## CS-BUG-022 — Builder finish doesn't always make the overview pane Playwright-visible

**Status**: Open (low priority — UI-only, doesn't affect actual character data)
**Surfaced**: MEGA triage Phase X
(`builder-wizard.spec.ts > should create a Human Fighter through the wizard`).
**Component**: Character Sheet · Builder · `_finishCharacter` →
`switchToTab("#charsheet-tab-overview")`.

### Symptom
After a wizard finishes successfully — character is saved,
`_currentCharacterId` is set, `state.getName()` returns the right
name, the overview pane has both `ve-active` and `in` classes —
Playwright's `toBeVisible()` against `#charsheet-tab-overview` (or
the inner `#charsheet-ipt-name`) reports `hidden`. The pane's
content nonetheless renders correctly in the accessibility
snapshot, so this is purely a layout/visibility ambiguity, not
a missing render. Forcing `cs.switchToTab("#charsheet-tab-overview")`
from the test does NOT clear it for the affected build.

### Repro
1. Run `builder-wizard.spec.ts > should create a Human Fighter
   through the wizard` — Aarakocra (MPMM) + TGTT Fighter +
   Standard Array + gold equipment.
2. After `finishWizard()`, `expect(page.locator("#charsheet-tab-overview"))
   .toBeVisible()` fails even though `cs._currentCharacterId` and
   `cs._state.getName()` are both populated.
3. Other builds (Dwarf Cleric, etc.) using the same flow pass.
4. The character data IS rendered — the page snapshot shows
   correct name, level, XP, etc.

### Suggested fix
Investigate why the `tab-pane.fade.in.ve-active` combination
sometimes resolves as `hidden` to Playwright (likely a
parent-container collapse during `_updateTabVisibility`). Either
ensure the parent `.tab-content` or its ancestor has positive
height/visibility before `_finishCharacter` returns, or add a
post-switch repaint.

### E2E coverage
- `test/e2e/specs/builder-wizard.spec.ts > should create a Human
  Fighter through the wizard` — `test.skip(... , "blocked on
  CS-BUG-022")`. The Dwarf Cleric and search tests in the same
  file are unaffected and remain enabled.


## CS-BUG-023 — Quick Build wizard never exposes an `Apply`/`Finish`/`Complete` button after spec-flow Next clicks

**Status**: Open
**Surfaced by**: `divine-soul-affinity.spec.ts > should collect and
persist Divine Soul affinity in Builder -> Quick Build`.
**Component**: Character Sheet · Quick Build overlay
(`charactersheet-quickbuild.js`).

### Symptom
After running the Quick Build flow programmatically (pick subclass,
choose Divine Soul affinity, click Next a fixed number of times to
walk through the auto-generated steps), the test scans for a final
action button by role + name `/Apply|Finish|Complete/i`. The button
never appears — Playwright times out at 60s. Quick Build seems to
require an extra interaction (a pick that's not auto-defaulted) or
the final button is labelled with text outside that regex (e.g.
"Done" or an emoji-only button), or the flow has a different number
of Next steps than the spec assumes.

### Suggested fix
- Either standardise the Quick Build final button on a consistent
  text label (`Finish` is the convention used elsewhere) and add a
  stable `data-testid="quickbuild-finish"`, or
- Update the spec to drive Quick Build via its public state-side
  API once it exists, mirroring how `createCharacterViaWizard`
  bypasses the Builder.

### E2E coverage
`divine-soul-affinity.spec.ts > Builder -> Quick Build` —
unchanged; left failing pending this bug entry. Re-enable
auto-fill / final-click logic once the button is reachable.


## CS-BUG-024 — Builder `Next` button hangs (click action never returns) for The Horror Warlock at the L1 spells step

**Status**: Open
**Surfaced by**: `tgtt-horror-warlock-theocracian.spec.ts > L1
export round-trip preserves identity` (the round-trip variant
specifically — full-build paths don't surface it).
**Component**: Character Sheet · Builder · Spells step transition
for TGTT Horror Warlock.

### Symptom
After completing the Spells step (`autoFillStartingSpells()`),
clicking `#charsheet-builder-next` times out at 60s in Playwright
even though the button is reported `visible, enabled and stable`.
The click action is dispatched but the subsequent navigation /
re-render never resolves, so Playwright keeps polling. Other
Warlock subclasses (Hexblade, Divine Soul) in the same flow do
finish; this is Horror-Warlock-specific.

### Hypothesis
Likely the same root cause as CS-BUG-013 (Horror Warlock pact
slots not registered) — the Next handler may be calling into a
spell-step finaliser that synchronously awaits a pact-magic
configuration that's never wired up. Worth a try/catch instrumented
around the Spells → Details transition in
`charactersheet-builder.js`.

### E2E coverage
`tgtt-horror-warlock-theocracian.spec.ts` L1 round-trip — left
failing; documented here so it isn't re-triaged as a new failure.


## CS-BUG-025 — E2E harness never advances past the Builder's "Name Your Character" step, so `createCharacterViaWizard` cannot build any character

**Status**: Fixed
**Surfaced by**: every spec that calls `createCharacterViaWizard` —
confirmed on an unmodified `character-sheet-wip` checkout with
`PW_WORKERS=1 npx playwright test tgtt-arcane-archer-fighter-hochling.spec.ts --grep L1`
(2 failed / 2 skipped). Independently hit by the Battle Master
subclass-support session while trying to run its 8 generated tests.
**Component**: E2E harness (`test/e2e/utils/characterBuilder.ts`) vs
Character Sheet · Builder step order
(`js/charactersheet/charactersheet-builder.js`).

### Symptom

```
TimeoutError: page.waitForFunction: Timeout 15000ms exceeded.
  at waitForListItems (test/e2e/utils/waitHelpers.ts:34)
  at BuilderWizardPage.selectRaceExact (test/e2e/pages/BuilderWizardPage.ts:133)
  at createCharacterViaWizard (test/e2e/utils/characterBuilder.ts:529)
```

`#builder-race-list` never gains a `.charsheet__builder-list-item`,
so the harness dies before a single character is created. Because
this is in the shared factory path, **the whole comprehensive
character-build suite is dark**, not just one spec.

### Root cause

The failure screenshot/`error-context.md` shows the wizard still
parked on the **Name** step when `selectRaceExact` runs. The Builder
stepper reads `✏ Name → 1 Species → 2 Background → 3 Class → …`, but
`test/e2e/utils/characterBuilder.ts:524-529` still says:

```js
// Builder steps (current order, see js/charactersheet/charactersheet-builder.js):
//   1. Race  →  2. Background  →  3. Class  →  4. Abilities
//   5. Equipment  →  6. Spells  →  7. Details

// Step 1: Race
await builder.selectRaceExact(preset.race, preset.raceSource);
```

The name-first step was added by commit `4f059f9a` ("Fix
builder/quickbuild ASI base inflation, orphaned racial modal,
name-first step", 2026-06-09) — see the `<h4>Name Your Character</h4>`
render at `charactersheet-builder.js:2665`. The harness was never
updated to match, so it has been unable to reach the Species step
since that date. This is harness/product drift, **not** a Builder
regression: the Name step behaves correctly for a human user.

### Suggested fix

In `createCharacterViaWizard`, fill the name textbox and advance
before touching the race list, and refresh the step-order comment:

```js
// Step 0: Name
await page.getByRole("textbox", {name: "Enter character name"})
	.fill(preset.name ?? "E2E Test Character");
await builder.clickNext();

// Step 1: Species
await builder.selectRaceExact(preset.race, preset.raceSource);
```

Prefer making the harness step-order-agnostic (drive off the stepper
labels, or expose a stable `data-testid` per step and a
`builder.goToStep("species")` helper) so the next step-order change
does not silently blind the suite again. Consider a cheap guard test
that asserts the harness's assumed step order matches the rendered
stepper, failing loudly instead of timing out.

### E2E coverage

All `test/e2e/specs/tgtt-*.spec.ts` comprehensive specs plus
`builder-wizard.spec.ts` and `divine-soul-affinity.spec.ts` are
affected. Note this blocker sits *in front of* several existing
entries (CS-BUG-022/023/024), so those cannot be re-verified until
this one is fixed.

**Severity**: High — no product code is broken, but the entire
character-build safety net is non-functional.

### Resolution

Fixed in the harness only; no product code changed. Clearing the Name
step exposed three further blockers that had accumulated behind it, all
fixed in the same pass:

| Blocker | Fix |
|---|---|
| Wizard parked on the Name step | `BuilderWizardPage.completeNameStep()`, called by `createCharacterViaWizard` and (defensively) by both race selectors, so the ~20 specs that drive the wizard directly are covered too. It no-ops when the step is absent, so a future step-order change can't re-break it. |
| Class step gated by an unfilled **Class Feats** progression dropdown | `BuilderWizardPage.selectClassFeatProgressions()` fills every `.charsheet__opt-feat-progression-slot` select, preferring the first feat that renders no additional choices (so `_validateOptFeatureFeatProgressionPicks` is satisfied deterministically). |
| Class step gated by an under-filled skill picker (presets' hand-written `skillCount` drifts from what the class grants) | `BuilderWizardPage.topUpClassSkillsToRequired()` reads the live `Selected: X/Y` counter and picks the remainder. |
| Level-up wizard refusing to close because a post-level-up `_pPromptFeatureChoice` modal was still open from the *previous* level | `LevelUpPage.resolvePendingFeatureChoices()` picks the first concrete option (not "Decide later"), called before each level and after each `finish()`. |

Diagnostics hardened so the next drift fails loudly rather than as an
opaque timeout:

- `waitForListItems` now reports which builder step is actually on screen.
- `LevelUpPage.finish()` records toasts via a `MutationObserver` (they
  auto-hide after 5s, so they were always gone by the time the assertion
  timed out), and `expectModalClosed()` reports the captured toast /
  runtime error.
- `createCharacterViaWizard`'s completion guard now also requires at
  least one class on the character. The old name-only guard passed even
  when the wizard had silently stalled mid-flow, because the name is set
  by the wizard's *first* step.

Verified: `tgtt-arcane-archer-fighter-hochling.spec.ts` 6 passed / 2
skipped (was 2 failed / 2 skipped), plus spot checks on
`tgtt-battle-master-fighter.spec.ts` and `tgtt-lust-cleric-lexalian.spec.ts`.

The step-order-agnostic redesign suggested above is still worth doing;
`completeNameStep`'s no-op-when-absent behaviour is a partial down
payment on it.

---

## CS-BUG-026 — *(unused)*

Reserved for a spell-attack critical-range leak (Champion's expanded crit
range and magic-item `critThreshold` both applied to spell attacks through
the shared `getCriticalRange()`). The XPHB Champion work fixed it inline
instead of filing it — `getCriticalRange(kind)` now scopes both sources to
`kind !== "spell"` (`charactersheet-state.js`). No entry was ever written;
the ID is left retired so the numbering stays stable.

---

## CS-BUG-027 — E2E harness probes three non-existent surfaces, producing false "not found" failures (resources, weapon masteries, skill rolls)

**Status**: **Fixed**.

Discovered while validating the merged wave-1/wave-2 base with
`RUN_MEGA=1`. The MEGA progression test for
`tgtt-arcane-archer-fighter-hochling.spec.ts` had **never passed** — it
is gated behind `RUN_MEGA=1`, so the routine "6 passed / 2 skipped"
result reported at `c3a66b36` never exercised it. Running it produced
three failures at L3, every one of which was a harness defect rather
than a product defect. Verified pre-existing by re-running at
`c3a66b36` in a detached worktree: byte-identical error text.

### (a) `getResource` only knew one of three resource surfaces

The product deliberately gives each limited-use pool exactly one
canonical home, and the generic Resources panel explicitly *excludes*
pools owned elsewhere (`charactersheet-features.js:2196` — "so each
surfaces in exactly one canonical home"). There are three surfaces:

| Surface | Markup | Examples |
|---|---|---|
| Generic Resources panel | `.charsheet__resource-row` | Stamina, Ki, class pools |
| Synthetic combat resources (`getSyntheticCombatResources`) | `.charsheet__combat-resource-item` + pips | Second Wind, Arcane Shot, Indomitable |
| Class combat-panel features with a `csCombatPoolCaption` | `.cs-combat-feature` + `.cs-combat-pool__count/__max` | Action Surge |

`CharacterSheetPage.getResource` queried only the first, so **every**
`kind: "resource"` check for a combat-owned pool was a guaranteed
false failure. Fixed by falling through all three (Combat tab is
opened on demand, since surfaces 2 and 3 render lazily).

### (b) Weapon Mastery picks were probed against the feature list

`kind: "pick"` resolves names against
`getActivatableFeatureNames()`. Weapon masteries are real picks but are
*not* features — they render as Combat-tab badges
(`_renderWeaponMasteries`, `charactersheet.js:4096`). So
`buildWeaponMasteryChecks` could never pass. Fixed by adding
`getWeaponMasteryNames()` and folding it into the pool that `pick`
searches (additive — it can never hide a name the feature list already
supplied).

### (c) Skill-roll probes looked for a button that does not exist

**This one had been misattributed to a product bug.** Skill rows are
click-to-roll: the handler is bound to the ROW
(`charactersheet.js:3238`), and there is no inner roll button.
`clickSkillRollHard` searched for `.charsheet__skill-roll, button` and
`rollSkill` searched for `.charsheet__skill-roll,
.charsheet__skill-bonus, button` — the latter also naming a class that
does not exist anywhere in the markup (the modifier cell is
`.charsheet__skill-mod`). Both therefore reported "roll button not
found" **for every skill on every character**. Fixed by falling back to
clicking the row.

> **Record correction.** The CS-BUG-017b row "Mercy Monk 3 —
> Implements of Mercy → Medicine proficiency: `skill:medicine=0`, no
> Medicine roll button" is **half wrong**: the *"no Medicine roll
> button"* half is this harness defect, not a product defect. The
> `skill:medicine=0` half is untouched and remains open. The other
> CS-BUG-017b rows (absent *toggle* buttons, pick rows not surfacing)
> are also untouched — only the skill-roll-button symptom is
> reclassified.

### (d) A product prompt left open wedged the whole run

Once (a)–(c) were fixed the run advanced far enough to hit a real
interaction bug in the harness: `rollAbilityCheck` triggers the XPHB
Fighter **Tactical Mind** prompt (`charactersheet.js:12213`), a
legitimate modal offering to spend a Second Wind use. Nothing dismissed
it, so the next `switchToTab` click was intercepted by
`.ve-ui-modal__overlay` and — because the click was unbounded —
retried until the entire 360s test timeout expired instead of failing.

Fixed on two levels: `dismissTransientModals()` is now called after
every roll probe (*before* its assertions, so a thrown assertion cannot
strand a modal), and `switchToTab` is bounded at 5s with one
dismiss-and-retry before failing loudly.

### (e) Superseded matrix rows kept asserting stale values

`assertFeaturesMatrix` ran every entry with `level <= currentLevel`, so
the L2 Action Surge row (`resourceMax: 1`) kept firing at L17 and
reported the *correct* new value of 2 as a failure. Added an optional
`untilLevel` bound to `FeatureCheck` and applied it to the Action Surge
and Indomitable progressions.

Also removed three stale `skip: "CS-BUG-018"` markers on the
Indomitable rows: CS-BUG-018 is the Sorcerer Sorcery-Points off-by-one
and is **Fixed**; with the bound in place all three Indomitable maxes
(1 → 2 at L13 → 3 at L17) now assert and pass.

**Verification**: `RUN_MEGA=1` MEGA L1→20 on
`tgtt-arcane-archer-fighter-hochling.spec.ts` passes for the first
time. Full normal run of that spec plus
`tgtt-battle-master-fighter.spec.ts`: 11 passed, 4 skipped
(MEGA/matrix-gated), 1 pre-existing failure (below).

**Not fixed here**: `tgtt-battle-master-fighter.spec.ts` › "USE:
cast/attack/resource/rest at L5" times out in `waitForToolsLoaded`
during the initial `goto` — the known `gotoWithThelemar` page-load
flake. Confirmed identical at `cdc45536` in a detached worktree, so it
is unrelated to these fixes.

---

## CS-BUG-028 — E2E harness reports false failures for toggles that move no AC/DC, and three page-object methods are shadowed duplicates

**Status**: **Fixed**.

Surfaced while merging the TDCSR Juggernaut branch, whose spec failed on
`toggle /rage/i should produce a stat delta` and `attack roll for Unarmed
Strike should be clickable`. Both reproduced on the source branch itself,
so neither was merge-induced — and neither was a product bug.

### (a) `probeToggleDelta` only measured AC and the spell save DC

The helper's own comment says callers "only require *some* derived
effect", but it returned `{acDelta, dcDelta}` and the assertions summed
those two numbers. Plenty of signature toggles move neither: **Rage**
grants a melee damage bonus, bludgeoning/piercing/slashing resistance and
STR advantage — no AC change, no DC change. Every Rage-style toggle was
therefore reported as having no effect.

`probeToggleDelta` now snapshots the other cheap derived surfaces a
toggle realistically alters — resistances, speed, attack list, and the
damage string of each rendered attack (bounded to 6) — and returns an
aggregate `changed` flag alongside the existing deltas. The
`signatureToggle` assertion and the feature matrix's `toggleDelta: "any"`
both use `changed`; explicit `toggleDelta: "ac"` / `"dc"` stay strict,
because those name a surface deliberately.

### (b) Three `CharacterSheetPage` methods were defined twice

`clickAttackRoll`, `getAbilityScore` and `getSpeed` each had two
definitions in the same class. In JS the **later** definition silently
wins, so the earlier one was dead code — and callers had been written
against the dead signature:

| Method | Dead (earlier) | Live (later) |
|---|---|---|
| `clickAttackRoll` | `Promise<boolean>` | `Promise<{clicked, threwError, errorMessage?}>` |
| `getAbilityScore` | `Promise<number>` | `Promise<{score, mod}>` |
| `getSpeed` | DOM text parse | `state.getSpeed(type)` |

`expect(clicked).toBe(true)` compared an **object** to `true`, so the
check failed *whenever the attack existed* — the failure was guaranteed,
not flaky, for every spec using `usage.attackName`. `getAbilityScore` had
the same shape mismatch in `overview-tab.spec.ts` and
`thelemar-homebrew.spec.ts`.

Deleted the three dead definitions and corrected the callers to the live
shapes (attack-roll callers now also assert `threwError === false`, which
the object form makes available for free). `getSpeed`'s two forms were
behaviourally compatible, so only the dead code was removed.

**Verification**: `tgtt-tdcsr-juggernaut-barbarian.spec.ts` 6 passed / 2
skipped (was 3 failed). No regressions:
`tgtt-arcane-archer-fighter-hochling.spec.ts` +
`tgtt-champion-fighter-xphb.spec.ts` together 12 passed / 4 skipped.

**Note on a misattributed symptom**: intermittent
`net::ERR_CONNECTION_REFUSED at localhost:8080` during these runs is a
startup race between back-to-back Playwright runs (`reuseExistingServer`
picking up a server that is still shutting down), **not** an
`http-server` crash. Confirmed by polling the port for a whole run: it
stayed up throughout. An earlier suspicion that the boot wait in
`gotoWithThelemar` was too short was also wrong — measured boot is
~11s initial and ~10s post-brew, well inside the existing budget.
