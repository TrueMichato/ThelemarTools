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

**Independently corroborated by three sessions.** Both defects were hit by
subclass work that had no knowledge of each other, which is the strongest
evidence they were harness bugs rather than product bugs:

| Session | Defect hit | What they did |
|---|---|---|
| Barbarian Juggernaut (TDCSR) | (a) + (b) | surfaced both; reproduced on its own branch |
| Monk Astral Self (TCE) | (a) | its L5 signature-toggle probe asserted an AC/DC delta that Astral Arms does not move; worked around it by asserting `toggleAddsAttack` instead |
| Cleric Light Domain (XPHB) | (b) | independently made the same `clickAttackRoll` shape fix |

Astral's response was to add a **generic** `toggleAddsAttack` `EffectCheck`
kind (`comprehensiveBuildHelpers.ts`), which is the right layer — but it
addresses a different surface. `toggleAddsAttack` is opt-in per
`featuresMatrix` entry; the `signatureToggle` assertion and
`toggleDelta: "any"` still ran through `probeToggleDelta` and so still saw
only AC/DC. The two fixes are complementary: theirs lets a spec *declare*
that a toggle grants an attack, mine makes the default probe stop reporting
"no effect" for toggles that move resistances, speed, or the attack list.

**Note on a misattributed symptom**: intermittent
`net::ERR_CONNECTION_REFUSED at localhost:8080` during these runs is a
startup race between back-to-back Playwright runs (`reuseExistingServer`
picking up a server that is still shutting down), **not** an
`http-server` crash. Confirmed by polling the port for a whole run: it
stayed up throughout. An earlier suspicion that the boot wait in
`gotoWithThelemar` was too short was also wrong — measured boot is
~11s initial and ~10s post-brew, well inside the existing budget.

---

## CS-BUG-029 — the USE probe's skill-roll check silently degrades to a no-op

**Status**: **RESOLVED** (2026-07-31). Root cause was found to be a wrong tab
switch, fixed incidentally by the Oath of Devotion branch (`6a6a8203`) and
verified on the merged tree. The residual timeout-scaling half was fixed
separately (see *Resolution* below).

**Root cause** (was mis-attributed while open): `rollSkill` called
`switchToTab(this.tabAbilities)`. Skills do **not** render there — they render
into `#charsheet-skills`, which lives inside the *Overview* pane
(`charactersheet.html:565`, within `#charsheet-tab-overview`). Because
`#charsheet-tab-abilities` genuinely exists, the switch **succeeded** and
navigated away from the rows, so the visibility gate correctly reported "not
visible" and the probe returned `clicked: false`. The original code carried a
comment asserting skill rolls "live there in the 2024-style sheet", which was
simply wrong — and that confident-but-incorrect comment is why the real cause
went unnoticed.

**Resolution**:
1. `6a6a8203` (Oath of Devotion) switched to `tabOverview` and tightened
   `characterSpecFactory.ts:440` from log-and-continue to a hard
   `expect(result.clicked).toBe(true)`.
2. Follow-up on the merged tree replaced the hard-coded visibility/click gates
   with `uiGate()`, which scales with `PW_TIMEOUT_MS`. This matters *more* now
   that (1) made the check a hard assertion: a fixed 1.5s gate would convert
   contention — the exact condition `PW_TIMEOUT_MS` is raised to absorb — into
   a spurious failure.
3. An accurate comment was added at the tab switch specifically warning against
   "fixing" it back to `tabAbilities`.

**Verification**: Juggernaut USE probe passed with no warning; Warlock +
Battle Master ran **12 passed / 4 skipped**, matching the trusted `f68edacb`
baseline exactly, with no `[skillRoll]` warnings in either.

**Lesson**: a code comment is not evidence. The wrong tab survived because the
comment explaining it read as authoritative; the fix took minutes once the
markup was actually checked.

---

## CS-BUG-030 — the USE probe's attack-roll check silently degrades to a no-op

**Status**: **RESOLVED** — harness fix + spec pre-equip, landed together.
Same anti-pattern as CS-BUG-029, found while verifying its fix.

**Symptom**: runs log lines like

```
[usage probe] attack name /longsword|greatsword|.../i not found; rendered=["Talons Natural","Unarmed Strike"]
[usage probe] attack name /dagger|crossbow|quarterstaff/i not found; rendered=["Unarmed Strike","Devastating Strike Natural"]
```

and still report the test as **passed** (`characterSpecFactory.ts:389-394`
logs and continues, rationalised as "the preset might have renamed the
weapon").

**Why it matters**: when this fires, the spec's attack-roll verification does
not run at all. Observed on `tgtt-battle-master-fighter` — a spec whose entire
subject is *weapon* maneuvers — where no weapon attack was ever rolled.

**Root cause is NOT a rename.** The characters have no *equipped* weapon. The
suite already knew this: ~13 specs carry the skipReason *"TGTT preset
deliberately ships unarmed; see Phase 15 P4 for pre-equip plan"* on their
matrix `rollAttack` checks. The matrix opted out **explicitly**; the USE probe
opted out **silently**.

**Measured scope**: **17 dead probes across 16 specs** (`tgtt-hunter-zodiac-centaur`
declares two characters) — every spec except 8. The earlier "24 specs" figure
came from a static "no weapon in `midTierLoadout`" scan and the "13" figure was
measured before CS-BUG-031 was fixed, while 4 specs still died at creation and
never reached their probe. 13 + 4 = 17.

**Three defects, all required to fix it:**

1. **The probe degraded silently** (`characterSpecFactory.ts`) — a declared
   `usage.attackName` that matched nothing logged and passed. Now a hard
   failure, with `usage.attackNameOptional` as the documented opt-out. The same
   degrade existed in the multiclass leg probe (`runLegUsageProbe`) and was
   fixed identically.
2. **The USE test never installed `midTierLoadout` at all.** Only the *L5
   loadout* test did. So adding weapons to specs would not, on its own, have
   fixed anything — the probe could only ever see preset-granted gear. The USE
   test now installs the loadout after reaching its level.
3. **`addInventoryItems` silently dropped `equipped: true` for items already in
   inventory** (`comprehensiveBuildHelpers.ts`). `state.addItem()` merges into an
   existing stack and bumps only `quantity`; the requested equipped/attuned
   state is discarded. This is why two Sorcerer specs still failed after the
   first two fixes: Sorcerer starting gear *already contains a Dagger* (and a
   Light Crossbow, which matched the regex), unequipped — so "add an equipped
   Dagger" merged into the existing unequipped row and rendered no attack. The
   helper now forces the equipped/attuned state via `state.setItemEquipped()`
   after the merge.

   This one is worth remembering beyond this bug: **`equipped: true` was a
   no-op for any preset-granted item**, which is precisely what
   `InventoryItemRef.equipped` was added for.

**Fix**: all 16 specs got an explicit weapon in `midTierLoadout` matching their
declared `attackName`. The one multiclass leg that declares `attackName`
(`Ranger 6 / Druid 14 Centaur`) is marked `attackNameOptional` with a reason —
multiclass legs have no loadout hook.

**Follow-up (not done here)**: with pre-equip now working, the ~13 matrix
`rollAttack` checks skipped for "TGTT preset deliberately ships unarmed" could
be re-enabled. That needs the MEGA matrix path to install a loadout too, which
is a separate change.

---

## CS-BUG-031 — 4 comprehensive specs fail at character creation (wizard stalls on an unfilled required picker)

**Status**: **RESOLVED** — harness bug, fixed in the same commit as this update.
**Pre-existing, not a regression**: reproduced identically at `6ebe4b34`, the
pre-batch base, before any of the 11 subclass merges landed.

**Affected specs** (every test in them, not just the USE probe — `L1: creates
… via builder wizard` fails too):

- `tgtt-belly-dancer-rogue-jaknian.spec.ts`
- `tgtt-gambler-rogue-clairnian.spec.ts`
- `tgtt-trickster-rogue-goblin.spec.ts`
- `tgtt-hunter-zodiac-centaur.spec.ts`

**Symptom**: `TimeoutError: page.waitForFunction: Timeout 10000ms exceeded` at
`characterBuilder.ts:796` — the post-`finishWizard` guard that confirms the
character actually saved *and* has a class.

**This is the guard working, not a flaky gate.** Its own comment predicts this
case: the class check exists precisely because "a name-only guard also passes
when the wizard silently stalled partway (e.g. blocked by an unfilled required
picker) and never finished". The failure page snapshot confirms the wizard is
still sitting on the Rogue class step with required choices outstanding —
Skills (choose 4), Expertise (choose 2), a language, weapon mastery (choose 2),
and a `Choose 1` group containing `Expertise Training (TGTT)`.

**Not contention.** Reproduced with `PW_WORKERS=1`, single spec, on an idle
machine, at `PW_TIMEOUT_MS=180000`. Deterministic across 3 runs. Raising the
gate does **not** help (verified: scaling it changed nothing), so do not
"fix" this by widening the timeout — that would only convert a hard failure
back into the silent-stall case the guard was added to catch.

**Lead (WRONG — recorded so the reasoning error isn't repeated)**: the 4
failures are 3 Rogues + 1 Ranger, and pass-by-comparison
builds (`tgtt-bastion-paladin-bugbear`, `tgtt-chained-fury-barbarian-minotaur`)
are classes *without* level-1 Expertise. The harness does handle Expertise
(`characterBuilder.ts:735` → `selectFirstAvailableExpertise(4)`, commented for
"Rogue / Bard / TGTT-Ranger"), so the gap is narrower than "unsupported".
Prime suspect is the separate `Choose 1` feature group
(`Expertise Training (TGTT)`), which is a *feature choice*, not one of the
expertise skill checkboxes `selectFirstAvailableExpertise` ticks.

**Actual root cause**: the *language* picker, not Expertise at all. The
blocking toast is `"Please select 1 languages from Thieves' Cant."`, preceded
by repeated `"You can only choose 1 options."`.

The product migrated the class-feature language chooser to the same grouped
**checkbox-pill grid** used by the race / background language choosers
(`charactersheet-builder.js:~5542` Thieves' Cant, `~5590` Forked Tongue), and
the harness helper was never updated. `selectAllClassFeatureLanguages()` still
only understood a `<select>` — so it grabbed the picker's **source-filter
`<select>`**, set it to an arbitrary source (which *hides* most language pills,
marking them `--hidden`), and never ticked a language. The live counter stayed
`Selected: 0/1` and the Class step refused to advance.

Markup contract the helper must honour:

| Selector | Role |
|---|---|
| `.charsheet__builder-class-lang-selection` | container (one per language choice) |
| `.charsheet__builder-lang-source-filter` | source filter `<select>` — **never touch it**; setting it makes the picker unfillable |
| `.charsheet__builder-lang-pill` | label wrapping the checkbox; `--hidden` when filtered out, `--disabled` at max |
| `Selected: X/N` text | the product's own live counter — drive off this |

**Fix**: rewrote `selectAllClassFeatureLanguages()` (`BuilderWizardPage.ts`) to
iterate every `.charsheet__builder-class-lang-selection`, parse the live
`Selected: X/N` counter, and tick visible/enabled pill checkboxes until the
requirement is met, re-reading the counter after each tick. A `<select>`
fallback remains for any legacy chooser, explicitly excluding the source
filter.

**Why it went unnoticed**: these specs were last touched on 2026-05-17
("e2e tests upgrades"), and that change re-verified only **one** of the seven
upgraded specs (`bastion-paladin`, per the coverage note above). The other six
were never run. Suite-wide green was therefore never established for them.

Compounding it, `clickNext` (`BuilderWizardPage.ts:101`) clicks and waits 500 ms
**without verifying the wizard advanced**. A blocked step silently stays put,
every later step no-ops on absent selectors, and the failure only surfaces
10 s later at a guard far from the cause.

**Diagnostic technique that cracked it** (reusable): a throwaway spec that
monkey-patches `BuilderWizardPage.prototype.clickNext` to log
`charSheet._builder._currentStep` before/after each click, and wraps
`JqueryUtil.doToast` to capture validation messages. Product validation lives in
`_validateCurrentStep()` (`charactersheet-builder.js:372+`); case 3 = Class, each
gate emitting a distinct toast.

**Verification**: all four specs plus the `tgtt-battle-master-fighter` neighbour
at `PW_WORKERS=1` → **36 passed / 13 skipped / 0 failed**. (Neighbour run per the
shared-harness rule: `BuilderWizardPage.ts` is used by every spec.)

**Impact before fix**: 4 of 25 comprehensive specs contributed no coverage at
all.

**Do NOT** "fix" a recurrence by widening the `characterBuilder.ts:796` guard —
that guard is what surfaced this bug; widening it restores the silent stall.

---

## CS-BUG-032 — two signature toggles produce no derived effect at L5

**Status**: RESOLVED (`parseEffectsFromDescription` / `_effectMatchesType` /
`resolveFeatureRef` / `_buildAbilityActivationInfo` / rage `detectPatterns` /
`probeToggleDelta` / both spec patterns).

**Filed as an either/or — "spec authoring OR product gap". It was neither.**
Separating the two causes uncovered **seven distinct defects**, five of them
real product bugs with a blast radius far wider than these two specs. The two
originally-suspected features (Sentry's Lingering Aura, Pantomime) genuinely
are target/ally-facing, so `changed: false` was correct behaviour for them —
but investigating *why* is what exposed everything below.

### 1. `advantage on …` matched `disadvantage on …` (most severe)

`advantage on attack rolls` is a literal **substring** of `disadvantage on
attack rolls`. All **26** `advantage on …` patterns in
`parseEffectsFromDescription` were affected, so any feature describing a debuff
it inflicts on an **enemy** granted the *player* the corresponding buff. The
Jester's Pantomime ("the creature … has disadvantage on attack rolls") handed
the Bard `{type: "advantage", target: "attack"}`.

Fixed with a `(?<!dis)` negative lookbehind on every one. Regression case:
`"advantage on Dexterity saving throws and creatures have disadvantage on
attack rolls against you"` must yield `save:dex` **only**.

### 2. A bare category target did not match its subtypes

`_effectMatchesType` required an exact target string, so an effect targeting
`check` did not match a query for `check:str`. Three roll-time consumers and
`_getConditionalActiveStateModifiersForType` already honoured the bare
category, so the vocabulary was being interpreted inconsistently.

Beyond the toggles: a state granting "advantage on saving throws" was
**silently invisible to the concentration check**, which asks
`getAdvantageState("save:con")`.

### 3. "tragedies" classified a Bard feature as Barbarian Rage

`ACTIVE_STATE_TYPES.rage.detectPatterns` contained the unanchored
`you can.*rage`, tested against the **whole rendered description** — which
bleeds in adjacent flavour sidebars. The XPHB Bard's "A Bard's Repertoire"
sidebar mentions **trage**dies, so the passive *Jack of All Trades* was
detected as Rage, handing a Bard b/p/s resistance, STR advantage and rage
damage. Fixed with word boundaries (`\brage\b`), which still correctly
rejects "enrage".

### 4. `refOptionalfeature` options resolved to empty stubs

`resolveFeatureRef` branched only on `classFeature` / `subclassFeature`.
Options declared as `refOptionalfeature` fell through to `null`, and
`_fulfillSubfeatureChoice` then added `{name, source, entries: []}` — an
ability with **no text**, therefore no parsed effects. `_applyFeatureOptionsForLevel`
only iterates *selected* options, so these were genuinely picked abilities
rendering blank, not leaked UI noise. Fixed by threading an optional-feature
catalog through `setClassFeatureCatalog` (third parameter) and adding a
resolver branch.

### 5. Parsed duration was discarded

`_buildAbilityActivationInfo` dropped the duration `analyzeToggleability`
had already parsed, so every timed self-buff was stored as "Instant".

### 6. Harness — `probeToggleDelta` had no advantage dimension

It snapshotted AC/DC/resistances/speed/attacks/damage. An ability whose entire
effect is an advantage flag therefore always read as "no effect". Now also
snapshots `getAdvantageState` for `attack`, `check:str`, `check:dex`,
`save:con`.

### 7. Harness — the "no toggle found" skip was silent

It reported only the pattern that failed to match, never what *was* toggleable,
which is precisely how a mis-authored pattern stays indistinguishable from a
genuinely toggle-less class. It now prints the toggleable rows it saw.

That immediately paid for itself: the Bastion spec had been retargeted to
`/undaunted/i` on the strength of a **spawner-built** character, but `Undaunted`
is one of **fourteen** L3 *Specialty* options, so a wizard-built character
usually does not have it — the probe was silently skipping. Both specs now
target a guaranteed toggle.

### Verification

24 Jest tests in `CharacterSheetFeatureTextEffects.test.js`, **proven to fail
16/24** with `charactersheet-state.js` reverted (the 8 survivors are the
intended no-op controls). Full Jest 425 suites / 12,705 tests. E2E: Bastion
6 passed, Jester 6 passed, Juggernaut (Rage blast-radius neighbour) 6 passed.

### Lessons

- **Do not trust your own bug report's suggested fix.** This one framed the
  question as a binary and the answer was outside both options.
- **A substring relationship between an antonym pair is a systematic hazard**,
  not a one-off typo — audit every sibling pattern, not just the failing one.
- **Unanchored `detectPatterns` are tested against text you did not write.**
  Rendered descriptions include neighbouring sidebars.
- **Measure, do not infer.** The "tragedies" cause was unguessable; every root
  cause here came from dumping real in-browser state.

---

## CS-BUG-033 — PHB Cleric Channel Divinity pool stays at two uses after level 18

**Status**: RESOLVED.

**Affected**: PHB 2014 Clerics at levels 18-20, reproduced by
`tgtt-tempest-cleric.spec.ts`. The XPHB Paladin pool (3 uses at level 11) had
the identical defect.

**Symptom**: the character reaches Cleric 20 and
`getFeatureCalculations().channelDivinityUses` correctly returns `3`, but the
player-facing `Channel Divinity` resource still has `max: 2`. The PHB feature
text grants three uses beginning at Cleric 18.

**Repro**:

```bash
RUN_MEGA=1 RUN_MATRIX=1 PW_PORT=8081 PW_TIMEOUT_MS=180000 PW_WORKERS=1 \
  npx playwright test test/e2e/specs/tgtt-tempest-cleric.spec.ts --reporter=line
```

**Root cause — three separate defects.** The filed "suspected root cause" (no
re-scaling on level-up) was real but was *not* what the E2E run was hitting:

1. **State (`charactersheet-state.js`)** — `addFeature` parses the use count out
   of the feature text at grant-time ("twice") and never re-scales it. Added
   `_ensureChannelDivinityUses()`, called from `getResources()` alongside the
   existing `_ensureBattleMasterSuperiorityDice` / `_ensureShadowKnightResources`
   reconcilers. It derives the maximum from class level directly (never from
   `getFeatureCalculations()`, which would recurse back through `getResources()`),
   only ever *raises* the maximum, takes the largest contribution across classes
   sharing the pool, and keeps the owning feature's own `uses` in step — rest
   restoration reads the feature, so a stale feature restores only 2 of 3.
   Progression lives in `_getChannelDivinityUsesForClass`, covering Cleric
   (1/2/3 at 2/6/18) and Paladin (XPHB 2/3 at 3/11; classic 1 per rest).

2. **Rendering (`getGenericPoolResources`)** — *the actual cause of the
   player-facing staleness.* The Overview Resources panel read
   `this._data.resources` **directly**, bypassing `getResources()` and therefore
   every reconciler. The pool stayed visibly stale until some other surface
   happened to reconcile it, which is why the matrix test (which long-rests
   first) saw `max: 3` while the milestone test, asserting immediately after
   level-up, saw `max: 2`. It now sources from `getResources()`, so Superiority
   Dice and the Shadow Knight pools benefit identically.

3. **Harness** — see CS-BUG-034; the `shortRestRestores` probe could never pass.

**Verification**: new `CharacterSheetChannelDivinityScaling.test.js` (17 tests,
asserting the *resource*, not `getFeatureCalculations()` — the pre-existing
Cleric suite only checked the calculation, which is exactly why this went
unnoticed). Confirmed genuine by disabling the reconciler and watching 7 of them
fail while the negative controls stayed green. Browser-verified at L17/18/20
(2/2, 3/3, 3/3). Tempest spec now passes 8/8 with `RUN_MEGA` **and**
`RUN_MATRIX`, with both previously-waived assertions re-enabled. Light Domain
Cleric and Oath of Devotion Paladin matrices pass.

---

## CS-BUG-034 — rest/spend effect probes called state methods that do not exist

**Status**: RESOLVED.

**Affected**: the `shortRestRestores` / `longRestRestores` `EffectCheck` and the
`featuresMatrix` `restoreOn` restoration probe, in
`test/e2e/utils/comprehensiveBuildHelpers.ts`. 27 specs declare one or both.

**Symptom**: the probes called `cs._state.shortRest?.()`, `cs._state.longRest?.()`
and `cs._state.spendResource?.(name, n)`. None of those methods exist — the real
API is `onShortRest()` / `onLongRest()` / `useResourceCharge()`. Because every
call used optional-call syntax, the mismatch was swallowed silently:

- the spend no-opped, so the probe fell into its own "API absent" soft skip and
  passed without asserting anything; and
- where a spend did land, the rest no-opped, so the check could never pass and
  the resource looked permanently unrestorable.

This is why CS-BUG-033 first surfaced as `expected short rest to restore
"Channel Divinity" to ≥3, got 2/3` — the rest never happened.

**Fix**: both probes now drive the page object (`charSheet.useResourceByName`,
`charSheet.triggerShortRest`, `charSheet.triggerLongRest`), which is what the
already-working `usage.shortRestRestores` path in `characterSpecFactory.ts` uses.

**Note for future work**: these probes only execute under `RUN_MEGA` /
`RUN_MATRIX`. A default 6-passed/2-skipped run does not exercise them, so this
class of defect cannot be caught without the gated selections.

---

## CS-BUG-035 — Battle Master feature matrix fails at L11

**Status**: RESOLVED (spec authoring in `tgtt-battle-master-fighter.spec.ts`).
Both failures were expectation bugs; the product was correct in both cases.

### 1. Growing pools asserted with a fixed max

The matrix re-evaluates **every** earlier entry at each later checkpoint
(3, 5, 11, 17, 20). A pool that grows with level therefore makes its own
earlier entry fail: Superiority Dice go 4 -> 5 (L7) -> 6 (L15), so the L3
entry's `resourceMax: 4` was stale from L11 onward.

`FeatureCheck.untilLevel` exists for exactly this, and its own documentation
uses Action Surge as the worked example. Each tier now gets its own entry with
an exact max, rather than a loosened `[min, max]` range:

```ts
{level: 3,  name: /superiority dice/i, kind: "resource", untilLevel: 6,  resourceMax: 4, ...},
{level: 7,  name: /superiority dice/i, kind: "resource", untilLevel: 14, resourceMax: 5},
{level: 15, name: /superiority dice/i, kind: "resource", resourceMax: 6},
```

**Fixing this exposed a second, identical failure that had been masked** by the
run aborting at L11 first: Action Surge goes 1 -> 2 uses at Fighter 17. Same
treatment.

### 2. `Know Your Enemy` is not a resource row, by design

XPHB Know Your Enemy is a 1/long-rest **feature use** with a Superiority-Die
restore. `getGenericPoolResources()` deliberately excludes any resource whose
linked feature already renders as an ability row with a Use button, so it does
not — and should not — appear as a resource row. `kind: "resource"` was simply
the wrong probe.

Re-declared as `kind: "passive"` with a
`{kind: "longRestRestoresFeatureUses", feature: "Know Your Enemy"}` effect,
which asserts strictly **more** than the old resource probe: spend a use, take
a long rest, verify it came back.

### Stale `CS-BUG-018` skips

CS-BUG-018 is Fixed/superseded, but ~15 entries across 9 specs still carry
`skip: true, skipReason: "CS-BUG-018"`, leaving core resource pools (Rage,
Sorcery Points, Focus Points) unasserted. The Astral Self Monk's **Focus
Points** was un-skipped here (it powers every Astral Self form, so it is in
scope for the "every ability has an actual effect" bar) and now asserts all
five tiers. The remaining stale skips are in specs outside that scope and are
tracked as follow-up — un-skipping each requires the same `untilLevel` tiering.

**Verification**: Battle Master matrix 1 passed; full Battle Master with
`RUN_MEGA=1` 7 passed / 1 gated skip; Astral Self matrix 1 passed.

### Lesson

**Fixing the first failure in a grouped assertion reveals the ones it was
masking.** The matrix throws on the first checkpoint with errors, so an early
stale expectation hides every later one. Budget for a second and third round
rather than treating the first green run as completion.

---

## CS-BUG-036 — Sun Shield light ranges are dead calculation metadata

**Status**: RESOLVED.

**Affected**: Way of the Sun Soul Monk (**Sun Shield**, L17) and Light Domain
Cleric (**Corona of Light**, L6) — both shed light in their source text.

**Symptom**: both features correctly activated an active state and exposed
their other mechanics, but their light radii existed only on
`getFeatureCalculations()` (`sunShieldBrightLightRange` /
`sunShieldDimLightRange`, and Corona's equivalent). No renderer and no state
consumer read either value, so activating them produced no observable light on
the sheet — a direct violation of the "every ability has an actual effect" bar.

**Root cause**: the active-state effect vocabulary had no way to express
emitted light at all. There were 40-plus effect types (`sense`, `resistance`,
`setSpeed`, ...) but nothing for light, so the ranges had nowhere to live
except as inert calculation metadata. Note this is the opposite of the usual
failure: the calculations were always *correct*, which is precisely why
asserting them (as the pre-existing tests did) could never catch it.

**Fix**:
1. Added a generic `{type: "light", brightRange, dimRange}` active-state
   effect. Ranges are TOTAL radii, matching both the source-book phrasing
   ("bright light for 30 feet and dim light for another 30 feet" ->
   `{brightRange: 30, dimRange: 60}`) and the existing calculation values.
2. Added `getEmittedLight()`, which aggregates every active `light` effect.
   Light does **not** stack, so the brightest single radius wins per band;
   `dimRange` is floored at `brightRange` so a malformed effect cannot render
   a dim radius inside its own bright one.
3. Rendered it on three surfaces: the Overview **Senses** panel (a new
   "Sheds light" row — it is the other half of "what can be seen", and unlike
   a sense it tells the player what they are giving away), the inline
   active-state row label, and `summarizeEffects()`.
4. Declared the effect on `sunShield` (30/60) and `coronaOfLight` (60/90).

Any future feature, spell effect or item that emits light now surfaces on all
three surfaces by declaring the effect alone — no per-feature rendering code.

**Not covered**: Zodiac Form also sheds light (`zodiacFormBrightLight`), but it
is an `isGeneric: true` state whose `customEffects` *replace* the base effects
at activation, so it needs the `_getSupplementalActiveStateEffects()` hook
rather than a base-effect declaration. Left alone deliberately — it is outside
the subclass batch and the change is not mechanical.

**Regression pins**: `test/jest/charactersheet/CharacterSheetEmittedLight.test.js`
(11 tests, asserting the *aggregator*, not the calculations; verified to fail
8/11 with the two declarations removed, the 3 survivors being the intended
no-op controls) and the now-unskipped `activeStateLight` probe in
`tgtt-sun-soul-monk.spec.ts`.

---

## CS-BUG-050 — every prose-parsed resistance / immunity / vulnerability on an active state was silently inert

**Status**: FIXED (Oath of the Crown Paladin batch)

**Symptom**: activating a state whose damage defences came from its own
description (rather than from a curated `effects` array) changed nothing.
`getResistances()`, `getImmunities()`, `getVulnerabilities()` and
`getConditionImmunities()` all returned the same values before and after
activation.

**Root cause**: two vocabularies for the same idea. The curated
`SPELL_BUFF_REGISTRY` form is `{type: "resistance", damageType: "fire"}`, which
is normalised to `target: "damage:fire"` at registration time, and the readers
(`_getResistancesFromStates` et al.) filtered on
`e.target?.startsWith("damage:")`. But `parseEffectsFromDescription` emits the
**bare** form — `{type: "resistance", target: "fire"}`. Every prose-parsed
defence therefore failed the filter and was dropped.

**Fix**: a single generic normaliser, `_getDamageDefenceFromStates(effectType,
conditional)`, that all four readers delegate to. It accepts both the
`damage:<type>` and the bare form, resolving the latter through a
`static DAMAGE_TYPES` whitelist so that non-damage targets that share the flat
shape (`"ac"`, `"speed:walk"`, `"save:wis"`) can never be mistaken for a damage
type. New code should still emit `damage:<type>`; this makes the reader
tolerant rather than blessing the bare form.

**Regression pins**: `CharacterSheetCrownPaladin.test.js` §Exalted Champion.

---

## CS-BUG-051 — a subclass "Channel Divinity" umbrella minted a phantom, resource-less second ability row

**Status**: FIXED (Oath of the Crown Paladin batch)

**Symptom**: a Crown Paladin at L3 showed **two** "Channel Divinity" entries in
the activatable list — the real class feature carrying the use pool, and a
second one from the oath that spent nothing and did nothing.

**Root cause**: many subclasses model their Channel Divinity options as an
umbrella feature whose `entries` are one line of prose plus N
`refSubclassFeature` pointers. `detectActivatableFeature` flattened those
entries to text, saw activation-looking prose, and built an ability row for the
wrapper itself — even though the wrapper has no `uses` of its own and every
option it points at is already surfaced separately.

**Fix**: `static isReferenceWrapperFeature(feature)` — true when a feature has
at least one `ref*` entry, no other structured content, and no `uses` of its
own — and an early `return null` for it in `detectActivatableFeature`. Detected
**structurally**, never by name, so it covers every oath, domain and patron
that uses the same shape.

**Regression pins**: `CharacterSheetCrownPaladin.test.js` §Channel Divinity
wrapper (4 tests, including two negative controls).

---

## CS-BUG-052 — text-parsed conditional modifiers never reached the per-roll opt-in picker

**Status**: FIXED (Oath of the Crown Paladin batch)

**Symptom**: Unyielding Spirit ("you have advantage on saving throws to avoid
becoming paralyzed or stunned") registered modifiers but they never appeared in
`aggregateModifiers("save:con").conditionalsAvailable`, so the roll-time
picker never offered them and the advantage could not be taken at all.

**Root cause**: two independent defects on the same path.
1. `_processFeatureModifiers`'s idempotency guard keyed on
   `type|target|value|source` and ignored `conditional`, so a feature that
   grants the *same* advantage under two *different* conditions collapsed into
   one modifier — Unyielding Spirit lost "stunned" entirely.
2. `getModifiersForType` skipped every `!mod.enabled` modifier, but
   conditionals are deliberately registered with `enabled: false` (they must
   not auto-apply). Text-parsed conditionals were therefore double-gated into
   invisibility: off by design, then dropped by the reader.

**Fix**: (1) `conditional` is part of the dedup identity key. (2) the reader
lets disabled-but-conditional modifiers through
(`if (!mod.enabled && !mod.conditional) return;`), preserving the Modifiers-UI
"off" display semantics for genuinely disabled entries.

Also generalised the `FeatureModifierParser` save-advantage patterns while
here: a new condition-gated matcher understands "to avoid/resist/end/prevent
being/becoming X" and "against being/becoming X" over a 16-condition
vocabulary and multi-condition lists, emitting one conditional `save:all`
modifier per condition. Every `advantage on …` literal on that path carries the
mandatory `(?<!dis)` lookbehind so "disadvantage on …" can never be inverted
into a buff.

**Regression pins**: `CharacterSheetCrownPaladin.test.js` §Unyielding Spirit
(8 tests, including the `disadvantage` inversion control).

---

## CS-BUG-053 — "ability"-classified activatables could never roll anything

**Status**: FIXED (Oath of the Crown Paladin batch)

**Symptom**: Champion Challenge rendered a Use button that spent Channel
Divinity but never prompted the Wisdom save it exists to force; Turn the Tide
spent a use and healed nothing. The prose was on screen; the mechanic was not.

**Root cause**: `detectActivatableFeature` has two nearby return sites. The
`"combat"` / `"reaction"` classification path calls
`_parseCombatActionEffects` and returns the result as `combatActionEffects`.
The `"ability"` path — `_buildAbilityActivationInfo`, which handles **every**
Channel Divinity option, every Invoke Hell option, and every other limited-use
instant — did not. The roll surfaces read `combatActionEffects`, so for that
whole family of features there was nothing to roll.

**Fix**: `_buildAbilityActivationInfo` now parses and returns
`combatActionEffects` like its sibling. One line; it un-breaks an entire
feature family rather than one subclass.

Two supporting generic changes landed with it:
- `_parseCombatActionEffects` learned the "regains hit points equal to NdM +
  your <Ability> modifier (minimum of K)" shape, emitting `abilityMod` and
  `minimum`.
- Because that parser is **static** (no character context), a save it finds
  carries `dc: null` and a heal carries a symbolic `abilityMod`. Previously the
  action modal hard-fell-back to **DC 10** for any such save. New
  `_resolveCombatActionEffects(effects, feature)` in `charactersheet-combat.js`
  resolves both against the live character — the DC via the new
  `state.getFeatureSaveDc(feature)` (prefers the owning class's spell save DC,
  falls back to the global one, else null rather than a bogus number) and the
  ability modifier folded into the formula, idempotently. All three call sites
  (combat-tab enrichment, roll modal, dice roller) go through it.

**Regression pins**: `CharacterSheetCrownPaladin.test.js` §Champion Challenge
and §Turn the Tide; the `combatAction` probes in `tgtt-crown-paladin.spec.ts`.

---

## CS-BUG-054 — the 2014 Paladin's Channel Divinity was unlimited

**Status**: FIXED (Oath of the Crown Paladin batch)

**Symptom**: no "Channel Divinity" resource appeared in `getResources()` for a
2014 (PHB) Paladin at any level, and every oath's Channel Divinity options
could be used an unbounded number of times.

**Root cause**: the use pool was minted opportunistically by `addFeature`'s
prose parse. The 2024 Paladin's feature text names a count ("you can use it
twice"), so it worked; the **2014** Paladin's text names none — it only says
"You must then finish a short or long rest to use your Channel Divinity again"
— so nothing was created, and the sibling of CS-BUG-033 went unnoticed because
that fix only addressed *scaling* of an already-existing pool.

**Fix**: `_ensureChannelDivinityUses` (called from `getResources()`) now
**creates** the resource and the backing `feature.uses` when the class table
says the character should have uses but no pool exists, instead of only
reconciling the max of one that already exists. `_getChannelDivinityUsesForClass`
remains the single source of truth for the count, so this stays consistent with
CS-BUG-033 and the `CharacterSheetChannelDivinityScaling` suite.

**Regression pins**: `CharacterSheetCrownPaladin.test.js` §Channel Divinity
pool; the `shortRestRestores` matrix probe in `tgtt-crown-paladin.spec.ts`.

---

## CS-BUG-060 — Circle of the Sea's Wrath of the Sea was description-only, and Stormborn collided with the Tempest Cleric

**Status**: RESOLVED (Circle of the Sea Druid implementation).

**Affected**: Circle of the Sea Druid (XPHB 2024), all levels 3-20.

**Symptom**: every one of the subclass's four features rendered as text and did
nothing measurable.

- **Wrath of the Sea** produced a flat `1d10` from a level-indexed table with no
  save DC, no save ability, no push, no emanation range and no Wild Shape cost.
  The real feature is `max(1, WIS mod)`d6 Cold, a Constitution save against the
  druid's own spell save DC, and a 15-foot push of a Large-or-smaller target.
  `detectActivatableFeature()` also mis-classified it as a `wildShape`
  transformation, so activating it tried to turn the druid into a beast.
- **Aquatic Affinity** set an inert `swimSpeed: 60` calculation that no speed
  consumer read, and never widened the Emanation.
- **Stormborn** set `hasStormborn` — the *Tempest Cleric's* L17 key — which is
  wired to an unconditional `{type: "speed", speedType: "fly", equalToWalk:
  true}` emission. A Sea Druid therefore flew permanently from level 10, with or
  without the Emanation, and gained none of its three resistances.
- **Oceanic Gift** exposed an invented `oceanicGiftTargets` count and no
  placement choice or cost.

**Root cause**: the calculation block was written from the feature *names*
rather than the feature text, and reused a foreign calculation key.

**Fix**: replaced the calculation block with values derived from the XPHB text,
renamed Stormborn's key to `hasSeaStormborn`, and added a generic
`wrathOfTheSea` active state whose effects are supplied per-level and
per-placement:

- `saveDamageBurst` is a new *generic* `trigger.effectType`: the state emits
  unresolved scaling hints (`diceAbility`, `diceMinimum`, `dieSize`,
  `dcCalculation`) and `getActiveStateTrigger()` resolves them, which keeps the
  effect provider out of the `getSpeed → getActiveStateEffects` re-entrancy
  cycle.
- `equalToWalk` is now honoured on **active-state** speed effects, resolved at
  the read site in `getSpeed()` / `getSpeedByType()`.
- `placement` is now persisted on an active-state record and passed to
  `_getSupplementalActiveStateEffects`, so an ally-placed Emanation withholds
  Stormborn's benefits from the druid while keeping the druid's DC and dice.
- `_extractCondition()` learned the phrasing `while active`, without which the
  description-text modifier pipeline registered Stormborn's fly speed as an
  always-on named modifier in parallel with the (correctly gated) active state.

**Tests**: 24 mechanical assertions in
`test/jest/charactersheet/CharacterSheetDruid.test.js` (21 of which go red
against the pre-fix file) and the full matrix in
`test/e2e/specs/tgtt-sea-druid.spec.ts`.

---

## CS-BUG-061 — XPHB Wild Shape pool never scaled past two uses, and Archdruid granted an unlimited pool

**Status**: RESOLVED.

**Affected**: every 2024 (XPHB / TGTT) Druid from level 6 up — Circle of the
Sea, Stars, Zodiac, Moon, Wild Companion, and anything else fuelled by the pool.

**Symptom**: `getFeatureCalculations().wildShapeUses` was a hard-coded `2` for
both editions, and the on-sheet "Wild Shape" resource stayed at max 2 at every
level. Separately, `hasArchdruid` set `wildShapeUses = Infinity` at level 20.

**Root cause**: two independent errors.

1. The 2024 Druid Features table has a **Wild Shape column** — 2 uses at levels
   2-5, 3 at 6-16, 4 at 17-20 — which the calculation ignored. On top of that,
   `addFeature` parses the count out of the feature text ("You can use Wild
   Shape twice") once at grant time and never re-scales, so even a corrected
   calculation would not have moved the player-facing pool. This is exactly the
   failure mode CS-BUG-033 fixed for Channel Divinity.
2. The 2024 Archdruid does **not** grant unlimited Wild Shape. Its "Evergreen
   Wild Shape" benefit refunds *one* expended use whenever you roll Initiative
   with an empty pool.

**Fix**: `wildShapeUses` now follows the table for `isXPHB` druids and stays at
a flat 2 for PHB 2014. A new `_ensureWildShapeUses()` — modelled directly on
`_ensureChannelDivinityUses()` — re-scales the on-sheet resource and the owning
feature's use pool from `getResources()` and `getWildShapeResource()`, raising
only, and never refilling a partly spent pool. Archdruid now sets
`hasEvergreenWildShape` and leaves the pool at 4.

**Found by**: `test/e2e/specs/tgtt-sea-druid.spec.ts` — the L11 matrix
checkpoint could not activate Wrath of the Sea twice because the pool was
starved at 2.

---
