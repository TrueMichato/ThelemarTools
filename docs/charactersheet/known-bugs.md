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

**Regression pins**: `CharacterSheetCrownPaladin.test.js` §CS-BUG-050 and
§Exalted Champion. Verified to fail with the bare-form branch reverted.

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

**Regression pins**: `CharacterSheetCrownPaladin.test.js` §CS-BUG-051 (7 tests).
Note the fixture is the umbrella **as the sheet renders it** — with the referenced
options expanded inline — because a fixture carrying only the bare `entries` passes
with the guard removed and proves nothing. Verified to fail with the guard disabled.

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
(8 tests, including the `disadvantage` inversion control). Both halves verified
independently — reverting the dedup key fails 3, reverting the reader fails 2.

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

**Regression pins**: `CharacterSheetCrownPaladin.test.js` §CS-BUG-053, which goes
through `detectActivatableFeature` on a feature shaped as the sheet actually grants
it (`consumes: {name: "Channel Divinity"}`, no `uses` of its own — measured on a
live build), not through the parser directly; plus the `combatAction` probes in
`tgtt-crown-paladin.spec.ts`. Verified to fail with the fix reverted.

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

**Regression pins**: `CharacterSheetCrownPaladin.test.js` §CS-BUG-054 (7 tests,
including a guard on the bug's premise — that the prose alone mints nothing — and a
cross-check that the 2024 Paladin still scales 2 → 3); the `kind: "resource"` matrix
row and the USE probe's `shortRestRestores` in `tgtt-crown-paladin.spec.ts`.
Verified to fail with the creation block reverted.

---

## CS-BUG-055 — `FeatureUsesParser` read "N times your <class> level" as a use count

**Status**: Fixed.
**Surfaced by**: College of Creation Bard implementation — a spawned
`bard/creation/14/gnome` showed `Performance of Creation` at **20/20 uses**.

**Root cause**: `FeatureUsesParser.parseUses`
(`js/charactersheet/charactersheet-state.js`) matched a leading
`(\d+)\s*(?:times?|uses?)` anywhere in the feature text. Performance of
Creation's description contains *"a nonmagical item … worth no more than
20 times your bard level in gp"*, so "20 times" was harvested as a use
count. Any feature whose text contains an `N times <noun>` **multiplier**
was affected, not just this subclass.

**Fix**: the pattern now carries a negative lookahead for the nouns that
mark a multiplier:

```js
/(\d+)\s*(?:times?|uses?)\b(?!\s+(?:your|the|a|an|its|his|her|their|that)\b)/
```

The `\b` after the alternation is **load-bearing**. Without it the regex
engine escapes the lookahead by backtracking `times` → `time`, leaving the
`s` to break `\s+`, and the bug silently returns. A regression test in
`test/jest/charactersheet/CharacterSheetCreationBard.test.js` (PART 1) was
verified to fail with `Received: 20` before the `\b` was added.

With the guard in place the text falls through to the `\bonce\b` pattern
and yields the correct 1 use per long rest.

---

## CS-BUG-056 — E2E builds put an 8 in every caster's spellcasting ability

**Status**: Fixed (opt-in).
**Surfaced by**: `tgtt-creation-bard.spec.ts` — `moteOfPotentialDc` came
back as **9** (8 + prof 2 + CHA mod −1), because
`BuilderWizardPage.assignStandardArrayDefaults()` hard-coded
STR 15 / DEX 14 / CON 13 / INT 12 / WIS 10 / **CHA 8** for every build in
the suite. Every spellcaster spec was therefore exercising a dump-stat
caster, and any probe asserting a realistic DC/mod floor had to be either
skipped or loosened into meaninglessness.

**Fix**: `assignStandardArrayDefaults(priority?)` now accepts an ability
order (best score first) and `CharacterPreset.abilityPriority` threads it
through `createCharacterViaWizard`. Omitting it preserves the historical
STR-first order byte-for-byte, so existing presets are unaffected —
verified by re-running `tgtt-jester-bard-dendulra.spec.ts` after the
change. `PRESET_FULL_CREATION_BARD_CHANGELING` sets
`["cha", "dex", "con", "wis", "int", "str"]`.

**Follow-up (not done here)**: the other caster presets
(Bladesinger, Chronurgy, Surrealism, Time/Lust Domain, Heroic Soul,
Horror Warlock, Jester) would all benefit from the same one-line
addition, which would also let several `CS-BUG-016`-skipped
`spellSaveDc` / `cantripCount` probes be re-enabled. Deliberately left
out of this change so the blast radius stays confined to one spec.

---

## CS-BUG-085 — every active state that GRANTS a non-walk movement type was silently zeroed

**Status**: RESOLVED.

**Affected**: any active state granting a fly / swim / climb / burrow speed —
the curated `unearthlyCountenance` (Daemonologist Wizard L10, "60-foot flying
speed") and, far more broadly, **everything `parseEffectsFromDescription`
produces** from "you gain a flying speed of 60 feet" and its swim/climb
equivalents (`charactersheet-state.js` ~:46016/46022/46028).

**Symptom**: `getSpeed("fly")` returned **0** with the state active. On a
Daemonologist Wizard L10 with Unearthly Countenance toggled on, the sheet showed
no flying speed at all.

**Root cause** — the same reader/writer vocabulary drift as CS-BUG-050, in a
different pipeline. `getSpeed()` guards non-walk speeds behind "the character
must already have this movement type":

```js
if (type !== "walk" && base === 0) return 0;
```

That guard is correct for a flat `+10 speed` — it must not conjure a climb speed
for a character who has none. But a state that **grants** the movement type
outright emits `{type: "bonus", target: "speed:fly", value: 60}`, which lands in
the `bonus` term, not `base`. The guard fired first and returned 0, discarding a
`bonus` that `getSpeedBonusFromStates()` had already computed correctly.

The read loop immediately above it only recognised the *other* vocabulary,
`{type: "flySpeed"}`, which is what the Fly spell emits — so spell-granted flight
worked and state-granted flight did not.

**Second defect, same site**: the parser emits the literal string `"walking"` for
"a flying speed equal to your walking speed". `getSpeedBonusFromStates()` did
`bonus += e.value || 0`, so that string-concatenated (`0 + "walking"` →
`"0walking"`) and the caller's `Math.floor` turned the whole speed into **NaN** —
the same symbolic-token class as CS-BUG-038.

**Fix**: new `_getGrantedSpeedFromStates(type)` reads only **type-specific**
targets (`speed:fly`, never the generic `speed`), so the guard becomes
`base === 0 && _getGrantedSpeedFromStates(type) <= 0`. The flat "+10 speed"
protection is preserved by construction. `getSpeedBonusFromStates()` now resolves
`"walking"` to `getWalkSpeed()` and coerces with `Number(...)`.

**Why it survived this long**: every pre-existing test seeded the base speed
first — `CharacterSheetActiveStateEngine.test.js` did `state.setSpeed("fly", 60)`
before adding the bonus — so none of them ever crossed the `base === 0` guard.
The E2E probe that should have caught it, `tgtt-daemonologist-wizard-dwarf.spec.ts`,
used `{kind: "togglePlusSpeed", type: "fly", delta: 60}`, and `togglePlusSpeed`
**silently returned for every non-walk type**. It had been green since batch 1
while asserting nothing.

**Regression pin — falsified**: `CharacterSheetActiveStateEngine.test.js`
§CS-BUG-085, 6 tests. Reverting both halves of the fix turns **4** of them red
(granted fly, granted swim, the `"walking"` NaN case, and the prose-parsed case);
the two `PREMISE:` tests stay green by design — they guard the behaviour the fix
must *not* change (no fly speed by default, and a generic "+10 speed" still
conjures nothing).

**Harness hardening shipped alongside**: `togglePlusSpeed` now **throws** for any
non-walk type, pointing the author at `toggleGrantsSpeed` (added by the Circle of
the Sea session), so this class of dead probe cannot recur. The Daemonologist
spec was migrated to `{kind: "toggleGrantsSpeed", type: "fly", min: 60}` and now
genuinely asserts the 60 ft.

**Known latent seam left in place (measured, NOT shipped-reachable)**: after this
fix there are **two** vocabularies by which an active state can grant a movement
type, and they **add** rather than take the maximum.

- *Bonus vocabulary* — `{type: "bonus", target: "speed:fly", value: 60}`, summed
  by `getSpeedBonusFromStates()`. This is what the curated states and every
  prose-parsed grant emit, and it is the head this fix repaired.
- *Read-site vocabulary* — `{type: "flySpeed", value: N}` or
  `{type: "flySpeed", equalToWalk: true}`, resolved directly inside
  `getSpeedByType()`. This is what the Fly spell and Stormborn use. It never
  crossed the `base === 0` guard, which is why Stormborn was green throughout and
  did not catch the bug.

Measured on a Daemonologist Wizard 10 (walk 30): the bonus head alone gives
**60**; adding an `equalToWalk` grant on top gives **90**, not 60. By RAW two
sources each granting a flying speed should give the higher, not the sum.

Deliberately not fixed here. It is **unreachable today** — the only two live
emitters are Unearthly Countenance (Daemonologist 10) and Stormborn (Tempest
Cleric 17), which would require character level 27. Recorded rather than filed as
its own id, since it shares this pipeline and cannot currently be triggered.

> **CORRECTION (audited after the Circle of the Sea session's read-back).** This
> entry originally claimed a fix "cannot be made at the read site, because the
> `bonus` vocabulary is genuinely ambiguous — the same shape expresses both
> 'grant a 60 ft fly speed' and 'add +10 to the fly speed you already have'".
> **That is false for type-specific targets.** Enumerated, there are exactly
> **four** emitters of a `{type: "bonus", target: "speed:<fly|swim|climb|burrow>"}`
> effect, and **all four are grants**:
>
> | Emitter | Shape |
> |---|---|
> | `ACTIVE_STATE_TYPES.unearthlyCountenance` | `{target: "speed:fly", value: 60}` |
> | `parseEffectsFromDescription` fly | regex `/(?:gain\|have) (?:a )?flying speed …/i` |
> | `parseEffectsFromDescription` swim | same shape |
> | `parseEffectsFromDescription` climb | same shape |
>
> The three parser regexes match **only** `gain`/`have a <X>ing speed` phrasing.
> They cannot match "your flying speed increases by 10", so no additive typed
> effect can be produced by this pipeline at all. The genuinely additive
> vocabulary lives elsewhere: the generic `{type: "speed", value: 10}` effect
> (walking, e.g. the artifact "Speed Increase" property) and the **named
> modifier** `speed:fly` modType, which is a different pipeline summed into
> `customModifiers.speed.fly` by `_recalculateCustomModifiers()`.
>
> So the remediation is **much cheaper than recorded**: within the *effect*
> pipeline, type-specific `speed:<type>` contributions are grants and should be
> combined with `Math.max` — against each other and against the `equalToWalk`
> read-site head — rather than summed. No parser change and no new discriminator
> field are required. `equalToWalk` is already unambiguously a grant, so once the
> effect head maxes, the read-site head can fold into it (value resolved from the
> walk speed at read time) and the pipeline returns to a single head.
>
> Two guards any such fix must keep, both already pinned by the PREMISE tests in
> `CharacterSheetActiveStateEngine.test.js`: a generic `{target: "speed"}` must
> still never conjure a movement type, and the **named-modifier** `speed:<type>`
> path must stay additive — maxing there would silently delete a player's
> hand-entered "+10 fly" custom modifier.

Verified unchanged by this fix: `getSpeedByType("fly")` agrees with
`getSpeed("fly")` on the bonus head (both **60**); Stormborn still reads **30**
= walking speed; and a generic `{target: "speed", value: 10}` still yields a
climb speed of **0** even with two fly-granting states active.

---

## CS-BUG-086 — a subclass whose spell list lives in a TABLE was granted nothing, and the shipped `additionalSpells` transcribed only one column

**Status**: RESOLVED (Lunar Sorcery Sorcerer implementation).

**Affected**: Lunar Sorcery Sorcerer (DSotDQ), all levels. Generically, any
subclass whose spell progression is published as a `type: "table"` entry.

**Symptom**: a Lunar Sorcery Sorcerer knew **5 of the 15** Lunar Spells. Ten
spells — the entire New Moon and Crescent Moon columns — were never granted at
any level.

**Root cause — two independent halves.**

1. `SpellGrantParser.getFeatureSpellText()` (`charactersheet-state.js` ~:581)
   walks only `node.entries` and `node.items`. It never descends into a
   `type: "table"` node's `rows`, so a table-published spell list is invisible to
   the prose grant path. This is the 5etools house style for multi-column
   progressions, so the blind spot is structural, not incidental.
2. The shipped `data/class/class-sorcerer.json:1940-1971` compensates with a
   *single* `additionalSpells` block named `"Full Moon"` — one of the table's
   three columns. RAW ("You learn additional spells … as shown on the Lunar
   Spells table") **every** column is learned; the phase gates other things.

**Fix**: new declarative `static CharacterSheetState.FEATURE_SPELL_GRANTS`
registry keyed `"<Class>|<subclass shortName or name>"`, resolved by the static,
pure `getFeatureGrantedSpells(cls)` and applied **first** in
`getSubclassAlwaysPreparedSpells()`. Grants then flow through the ordinary
always-prepared pipeline (enrichment, cantrip routing, dedupe against the partial
`additionalSpells`, `sourceFeature` attribution). `data/class/` is deliberately
**not** modified — it is upstream-synced and only version-bump commits have ever
touched it.

**Why the parser was not taught to read tables**: it would over-grant for the
many CHOOSE-ONE spell tables (Circle of the Land's terrain columns, Warlock
expanded lists), turning a missing-spells bug into a wrong-spells bug across
shipped content.

**Correction to a claim made while fixing this**: the descriptor was first
designed with a `doesNotCountAgainstKnown` flag. `git grep` over `js/` returns
**zero** occurrences of that identifier — it does not exist. The convention
actually *read* is `alwaysPrepared` + `sourceFeature`
(`charactersheet-levelup.js` filters `s.level > 0 && !s.alwaysPrepared &&
!s.sourceFeature`; `charactersheet-class-utils.js` filters granted cantrips by
`sourceFeature`). Granted **cantrips** deliberately omit `alwaysPrepared`, so
`sourceFeature`/`sourceClass` are the only readable flags there. Inventing the
new field would have been exactly the dead-`hasXxx` anti-pattern this suite
exists to kill.

**Regression pin — falsified**: `CharacterSheetLunarSorcery.test.js`. Breaking
`getFeatureGrantedSpells()` in place (keeping the signature) turns the grant
tests red with real assertion failures, not `TypeError`.

---

## CS-BUG-087 — `featuresMatrix` entries whose level window contained no checkpoint were silently never evaluated

**Status**: RESOLVED (rescue checkpoints added; seven dead windows across three specs now execute).

**Affected**: every E2E spec using `featuresMatrix`.

**Symptom**: none — that is the bug. The suite stayed green while the entry
asserted nothing, and the entry looked like coverage in review.

**Root cause**: the MEGA and matrix runners in `characterSpecFactory.ts` only
stop and evaluate at levels **[3, 5, 11, 17, 20]**. An entry declared
`{level: 6, untilLevel: 10, …}` contains none of those, so
`assertFeaturesMatrix` was never called with a `currentLevel` inside its window.
Nothing warned; the entry was dead code that reported success.

**Enumerated** — and a correction worth recording. A first pass used a regex
scanner over the spec sources and reported "274 windows scanned, 2 dead". That
number was **wrong**: a regex over source text is not an enumeration, because it
only sees the entries it happens to match. Running the check against the real
parsed `featuresMatrix` objects at collection time found **7 dead windows across
3 specs**:

| Spec | Window | What it hid |
|---|---|---|
| `tgtt-shadow-magic-sorcerer` | `2..2` (Sorcery Points) | the `longRestRestores` probe on the pool |
| `tgtt-shadow-magic-sorcerer` | `6..10` (Hound of Ill Omen) | the **entire `classSummon` probe** — AC 14, HP 37, bite/piercing, plus the `scaling.tempHpPerLevel` descriptor reads (this is how CS-BUG-089 was found) |
| `tgtt-arcane-archer-fighter-hochling` | `13..16` (Indomitable) | the 2-use tier of the pool |
| `tgtt-talent-chronopath` | `7..10` ×2 (Psionic Exertion) | `psionicExertionsKnown: 2` |
| `tgtt-talent-chronopath` | `12..16` (Psychic Boost) | `psychicBoostUses: 2` |
| `tgtt-talent-chronopath` | `13..16` (5th-order powers) | `maxPowerOrder: 5`, `manifestationDie: 1d8` |

The Hound's L17 window (`17..∞`) *did* run, so the feature was not wholly
unasserted — but the summon's stat block never was.

**Fix** — and note this is *not* the first fix attempted. The first version
threw at collection time demanding the author widen the window. That was wrong
twice over:

1. It aborts Playwright's **entire** collection (`Total: 0 tests in 0 files`), so
   one bad spec bricks the suite for everybody in a parallel batch.
2. More importantly, widening is usually **impossible**. Every one of the five
   newly-found windows is an *intermediate progression tier* — Indomitable is 1
   use at 9-12, **2 at 13-16**, 3 at 17+. Widening `13..16` to touch a checkpoint
   makes the asserted value factually wrong at that checkpoint. The guard was
   demanding a false assertion.

The shipped fix instead **adds the stops the spec needs**.
`_matrixCheckpointsFor()` returns the base `MATRIX_CHECKPOINTS` plus a rescue
stop for every otherwise-unreachable window, chosen greedily so overlapping
tiers share one stop (`12..16` and `13..16` both resolve to a single stop at 13).
The runners already level up through every level one at a time — a checkpoint
only decides where to pause and assert — so a rescue stop is cheap, and specs
with no dead windows get the identical five stops as before.

A rescue stop asserts **only the entries it exists for**
(`rescueEntriesByLevel`). Re-running the full matrix there is pure waste, and
measurably not free: a late full pass costs about as much as the L11 one.

Only structurally impossible windows (`untilLevel < level`, or a window outside
1-20) still throw, since no stop can rescue those.

The two shadow-magic windows were also widened by hand (to `3..4` and `6..16`),
which is correct there because the asserted values genuinely do not change
across the widened range.

**Verified**: the four Chronopath entries and the Arcane Archer entry now
execute for the first time. Chronopath's matrix passes (4.6 m). Arcane Archer
reaches and passes its L13 rescue stop, then times out at L17 — **which it also
does on an unmodified base checkout** (A/B verified at `f551d9a2`), so that
spec's timeout is a pre-existing problem with its size, not a consequence of
this change.

---

## CS-BUG-088 — `LevelUpPage`'s named-subclass-choice modal selector matches nothing

**Status**: OPEN (recorded, deliberately not fixed).

**Affected**: `test/e2e/pages/LevelUpPage.ts:897` and `:902`;
`test/e2e/pages/BuilderWizardPage.ts:337` and `:341`.

**Symptom**: latent. The helpers locate `.ui-modal__inner`, but 5etools modals
carry the class **`ve-ui-modal__inner`** (`js/utils-ui.js:573` — the `ve-`
prefix is part of the token, so a bare `.ui-modal__inner` matches **zero**
elements).

**Why it has not failed**: `selectNamedSubclassChoice` (`:900`) races the dead
modal locator against `.charsheet__levelup-named-subclass-choice`, and Level-Up
renders its choice **inline**, so the working half always wins. The
`expectNamedSubclassChoiceModalVisible` helper (`:896`) has no such fallback and
is the genuinely dead one.

**How it was found**: the Builder *does* use the modal branch, so the new
`BuilderWizardPage.answerSubclassChoiceModal()` written for Lunar Sorcery hung on
an open "Lunar Embodiment" modal until the selector was corrected to
`.ve-ui-modal__inner` (`BuilderWizardPage.ts:419`).

**Not fixed here** deliberately: correcting `:337`/`:341`/`:897`/`:902` changes
shared page objects that `divine-soul-affinity.spec.ts` and every subclass-choice
spec depend on, and the blast radius does not belong in a subclass change. Two
related off-by-one traps found alongside, both fixed only in the new helper: the
choice `<select>`'s **index 0 is the disabled "Select…" placeholder** (use
index 1), and the confirm button must be matched `/^OK$/i` rather than by
substring.

---

## CS-BUG-089 — a companion whose attack is declared structurally has no rollable attack at all

**Status**: RESOLVED (Lunar Sorcery session; the victim is Shadow Magic).

**Affected**: `js/charactersheet/charactersheet.js:4851` (companion card attack
buttons) and `:5794` (`_rollCompanionAttack`); `js/charactersheet/charactersheet-state.js`
`addCompanion()`. Live victim: **Hound of Ill Omen** (Shadow Magic Sorcerer 6).

**Symptom**: a summoned Hound of Ill Omen rendered **zero attack buttons** and had
nothing to roll, despite carrying a fully specified bite
(`attackBonus: 5`, `damage: "2d6+3"`, `damageType: "piercing"`, plus the DC 13
Strength prone rider).

**Root cause** — two companion attack vocabularies, only one of which is read:

| shape | example | who reads it |
|---|---|---|
| prose | `{name: "Bite", entries: ["{@atk mw} {@hit 5} … {@h}{@damage 2d6+3} piercing damage."]}` | the card (filters `companion.actions` for `{@atk`) **and** `_rollCompanionAttack()` (parses `{@hit}` / `{@damage}` / `{@dc}` out of `actions` entries) |
| structured | `{name: "Bite", attackBonus: 5, damage: "2d6+3", damageType: "piercing", range, description}` | see below — nothing that renders or rolls it |

`addCompanion()` stored `attacks` verbatim. Enumerating every reader
(`git grep -n "\.attacks" -- js/charactersheet/`, discarding `_data.attacks`,
`attacksPerAction` and `attacksAgainst`) gives exactly **four** sites that touch
`companion.attacks`, and none of them makes a structured attack rollable:

1. `charactersheet-playmode.js:2835` and 2. `:4020` — `const actions = comp.actions || comp.attacks || [];`.
   This fallback is **unreachable for anything built by `addCompanion()`**, which
   has always written `actions: companionData.actions || []` — and `[]` is
   truthy, so the left operand always wins. Even if it did fire, both sites
   render only `action.name` and `action.entries`; a structured attack has no
   `entries`, so it would surface as a bare name with no numbers. Play Mode has
   no companion attack roll button either way.
3. `charactersheet-state.js:53746` (`_recalculateScaledCompanion`) — writes both
   arrays, but **only when `scaling.attackName` is set**. The Hound's scaling
   descriptor carries only `className` / `tempHpPerLevel`.
4. `charactersheet-state.js:54044` — annotates `attack.damageBonus` for created
   undead. A write, not a render.

So the honest form of the claim is not "nothing reads it" but "no path that
renders an attack button or rolls an attack reads it, and the one prose fallback
that exists is dead for `addCompanion()` output."

**Fix**: `static CharacterSheetState._withStructuredAttackActions(actions, attacks)`,
applied once at `addCompanion()` entry, translates each unrepresented structured
attack into the prose shape. Existing prose actions win on name collision, and an
attack that already carries `entries` is left alone — so bestiary-derived
companions are untouched.

**How it was found**: only because CS-BUG-087's collection-time guard made the
`classSummon` probe in `tgtt-shadow-magic-sorcerer.spec.ts` **reachable for the
first time** — its window was `6..10`, which contains none of the matrix
checkpoints `[3, 5, 11, 17, 20]`.

**Parallel harness gap fixed alongside**: the `classSummon` flattener in
`test/e2e/utils/comprehensiveBuildHelpers.ts` joined `a.damage` / `a.desc` /
`a.entries` but **never `a.damageType`**, so `damageContains` could not match a
damage type on any structured attack — the harness would have mis-reported the
product bug as a probe failure even once reachable.

**Regression pins**: `test/jest/charactersheet/CharacterSheetShadowMagicSorcerer.test.js`.
Falsified in place (signature kept): dropping the `{@damage}` wrapper and the type
from the synthesised entry → **1 red**, a real assertion failure
(`Expected pattern: /\{@damage 2d6\+3\}/`). Independently, disabling the
name-collision guard → **1 red** on the "does not clobber" pin. A whole-function
no-op reds only the first pin, which is correct: the second pin asserts
precedence, a property a no-op preserves.

---

## CS-BUG-090 — the E2E export round-trip test was under-budgeted for its own wizard run

**Status**: RESOLVED.

**Affected**: `test/e2e/utils/characterSpecFactory.ts` — the
`L1 export round-trip preserves identity` test generated for **every**
`describeCharacter` spec.

**Symptom**: `Test timeout of 60000ms exceeded` while still inside
`createCharacterViaWizard` — surfacing either as
`locator.click: waiting for locator('#charsheet-builder-next')` or as
`page.waitForTimeout`. Both read like a hung UI and neither is one.

**Root cause**: the round-trip test does the same full builder-wizard run as the
`L1 build` test, which explicitly budgets `test.setTimeout(120_000)`. The
round-trip test set no timeout at all and inherited the 60 s global default from
`playwright.config.ts`. It passed only on presets whose wizard happens to finish
inside 60 s.

**How it was found**: the Lunar Sorcery preset answers a subclass-choice modal
at L1, which pushes creation past the limit. Measured after the fix: **51.6 s** —
i.e. the test was passing with under 9 s of headroom on every other spec too, so
this was latent flake across the whole suite, not a Lunar-specific problem.

**Fix**: `test.setTimeout(120_000)` on the round-trip test, matching the L1 build
test it mirrors. Raising a timeout cannot make a passing spec fail, so the blast
radius is one-directional.

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

## CS-BUG-038 — symbolic modifier values were string-concatenated, rendering `NaN` and literal garbage on the sheet

**Status**: FIXED

**Severity**: Critical — user-visible numeric corruption on the main sheet for
*every* Barbarian at level 18+ and *every* Artificer at level 20, regardless of
subclass, race or homebrew settings.

**Symptom** (measured, `barbarian/chained fury/18/minotaur`): the sheet rendered

```
STR   200strScore00   NaN(NaN)
      Saving Throw NaN · Athletics NaN
```

The identical build at L17 was clean; the corruption appeared the instant
**Indomitable Might** (Barbarian 18) was granted. `artificer/battle smith/20`
was worse — all six saving throws returned the literal string
`"11attunedItems000000"` via **Soul of Artifice**.

**Root cause**: the feature/feat/racial effect registries express some modifier
values *symbolically* rather than numerically, because the number is not knowable
when the feature is granted (Soul of Artifice scales with how many items you have
attuned *right now*). But only the single token `"proficiency"` was ever
understood, and only at the storage site. Every other token — `"strScore"`,
`"attunedItems"`, `"conModx2"`, `"strMod"` — survived as a raw **string** through
`_getNamedModifierEffectiveValue`, whose `let value = mod.value || 0` performed no
coercion. `_recalculateCustomModifiers` then did `+= value` into numeric total
maps, so JavaScript concatenated instead of adding:
`0 + "strScore"` → `"0strScore"`.

A **second, independent defect** compounded it: `_recalculateCustomModifiers`
matched ability modifiers with `mod.type.startsWith("ability:")` and read
`split(":")[1]`, so the sub-typed `"ability:str:minimum"` (Indomitable Might — a
floor on Strength *checks*, not a bonus to the score) was silently treated as an
additive score bonus. The itemizer `_getAbilityNamedModifierComponents` used
strict `!== "ability:str"` and ignored the same modifier, so the two paths
disagreed about it.

**Fix** — one resolver at the single chokepoint, not a fourth one-off ternary:

1. New `_resolveSymbolicModifierValue(value)` defines the whole token vocabulary
   in one place (`<abl>Score`, `<abl>Mod`, bare `<abl>`, `attunedItems`, `level`,
   `conModx2`, `proficiency`, numeric strings). It returns `null` — not `0` — for
   anything it cannot resolve, so the caller can distinguish "resolved to zero"
   from "did not understand this".
2. `_getNamedModifierEffectiveValue` resolves through it and ends with a
   `Number.isFinite` guard. All five consumers (the quick-total path and the
   three itemizers) already funnel through this method, so the numeric-safety
   guarantee cannot drift between them. Resolving here rather than at
   `addNamedModifier` time keeps the value **live**: Soul of Artifice tracks
   attunement as the player attunes and un-attunes.
3. Unresolvable tokens contribute `0` and emit a deduped `console.warn`, so the
   next such registry entry is caught instead of shipping silently.
4. The `ability:` branch now matches only the bare two-segment form, bringing it
   onto the same predicate the itemizer already used.
5. The redundant `"proficiency"` ternary in `_processFeatRegistryEffects` was
   removed — `addNamedModifier` already performs that exact conversion, so the
   duplicate only risked the two copies drifting.

**Not fixed here** (recorded, out of scope): `ability:<abl>:minimum` still has no
*handler* — Indomitable Might's actual rule (treat a Strength check below your
score as if you had rolled your score) remains unimplemented. It now contributes
nothing instead of contributing garbage.

**Regression pins**: `CharacterSheetSymbolicModifiers.test.js` (9 tests).
Falsified by reverting: **7 of 9 go red** on a full revert of the product change,
and the `ability:` sub-type guard is independently pinned by 1 test under a
targeted revert. The remaining 2 are deliberate no-regression controls (bare
`ability:str` still additive; `"proficiency"` still becomes a flag).

⚠️ Note for future pins of this shape: an `isFinite` assertion passes **vacuously**
against an unresolved-but-additive value — with the resolver in place but the
sub-type guard reverted, STR became `36`, which is perfectly finite. Only the
exact-value assertion (`toBe(18)`) caught it. Every test here carries a premise
guard asserting the symbolic token really is stored on the modifier and really
would concatenate.

**Why the suite missed it**: every STR assertion at L18-20 in the one spec that
reaches those levels was `{skip: true}` under `CS-BUG-018`, and the sole
unskipped probe there was `{kind: "rollAbilityCheck"}`, which asserts only that a
roll *occurred*, not that its total was a number.
## CS-BUG-080 — Sorcery Points had three independent formulas and no creator

**Status**: Fixed.
**Surfaced by**: Shadow Magic Sorcerer implementation (pathfinder session for
five Sorcerer subclasses).

**Root cause**: the size of the Sorcery Points pool was computed in three
places that did not agree and were not connected:

| Surface | Formula | Used by |
|---|---|---|
| `getFeatureCalculations()` Sorcerer branch | TGTT `level + 1`, else `level` | feature rows, E2E `featureCalculation` probes |
| `CharacterSheetClassUtils.CLASS_RESOURCES` → `updateClassResources` | `level` for every source | Builder / Level-Up / Quick Build |
| *(nothing)* | — | `getResources()` on a hand-built or imported character |

The third row is the real defect: `getResources()` had ensure-hooks for Ki,
Channel Divinity, Rage and others, but **none for Sorcery Points**. A Sorcerer
that never went through `updateClassResources` — a JSON import, a respec, a
Jest fixture, a `spawn()` — simply had no pool, so every `consumes:
{name: "Sorcery Point"}` feature was unusable.

**Fix**: `static CharacterSheetState.getSorceryPointsMaxForClass(cls)` is now
the single source of truth. `charactersheet-class-utils.js` delegates to it,
the `getFeatureCalculations()` Sorcerer branch delegates to it, and a new
`_ensureSorceryPoints()` joins the `getResources()` ensure-chain.

`_ensureSorceryPoints()` is deliberately **create-only** — it early-returns if
a "Sorcery Points" resource already exists. Two legitimate writers mutate
`resource.max` in place: `setSorceryPoints()` (explicit override) and the TGTT
`tuneMetamagic()` / `detuneMetamagic()` pair, which *locks* points by lowering
`max`. A reconciling ensure-hook silently untunes every metamagic the moment
anything calls `getResources()`. Subtracting `getLockedSorceryPoints()` was
tried and still broke `setSorceryPoints(5)` fixtures. Re-scaling on level-up
remains `updateClassResources`' job.

**Regression pins**: `CharacterSheetShadowMagicSorcerer.test.js` §"base-class
Sorcery Points machinery" (create-only, PHB ladder, TGTT ladder, tuning
survives `getResources()`).

---

## CS-BUG-081 — the sheet's Damage button bypassed `takeDamage()` entirely

**Status**: Fixed.
**Surfaced by**: Shadow Magic Sorcerer — Strength of the Grave never fired
from the UI even though the state method worked in Jest.

**Root cause**: `charactersheet.js` `_onDamage()` hand-rolled the temp-HP /
current-HP arithmetic and wrote `setHp()` directly, never calling
`this._state.takeDamage()`. Every hook hanging off `takeDamage` was therefore
unreachable from the sheet's own Damage control — including the pre-existing
**Death Ward** branch, which could only ever fire from code paths that called
the state method directly.

**Fix**: `_onDamage()` now routes through `this._state.takeDamage(amount)` and
then awaits `_pOfferZeroHpIntervention()`.

**Regression pins**: `CharacterSheetShadowMagicSorcerer.test.js` §Strength of
the Grave (the state-level path); the `takeDamage` →
`applyZeroHpIntervention` `stateCall` chain in
`tgtt-shadow-magic-sorcerer.spec.ts`.

---

## CS-BUG-082 — `calculations.darkvision` was written by six subclasses and read by nobody

**Status**: Fixed.
**Surfaced by**: Shadow Magic Sorcerer — Eyes of the Dark published
`calculations.darkvision = 120` and the sheet's senses stayed at the racial 60.

**Root cause**: several class/subclass feature blocks publish a `darkvision`
calculation, but `_getClassFeatureEffects()` had no case that turned it into
anything. Grepping for consumers of `calculations.darkvision` returned zero
hits outside the writers themselves. Darkvision granted by a *class* feature
simply did not exist.

**Fix**: `_getClassFeatureEffects()` now emits a generic
`{type: "sense", sense: "darkvision", range, source}` effect for any
`calculations.darkvision > 0`, feeding the existing sense-effect pipeline. The
sense machinery already takes the maximum, so a racial 60 and a class 120
resolve correctly in either application order.

**Regression pins**: `CharacterSheetShadowMagicSorcerer.test.js` §Eyes of the
Dark; the `getSenses` `stateCall` in the E2E matrix (verified against a Dwarf,
whose racial darkvision 60 must be superseded).

---

## CS-BUG-083 — active-state name matching hijacked identically-named features from other sources

**Status**: Fixed.
**Surfaced by**: Shadow Magic Sorcerer — "Eyes of the Dark" classified as the
**TGTT Shadow Knight** toggle of the same name, so a Sorcerer's passive
darkvision feature rendered as an activatable state it does not have.

**Root cause**: `static detectActivatableFeature()` walks `ACTIVE_STATE_TYPES`
and matches purely on feature name. It is static, so it has no character
context and cannot ask "does this character actually have the Shadow Knight
version?". Four TGTT Shadow Knight states carry names generic enough to
collide with unrelated content.

**Fix**: an opt-in data flag, `noNameDetect: true`, on the state definition.
The name-match loop `continue`s past any state carrying it; such states are
reached only through an explicit `activateState(key)` call or a classification
override. Applied to `shadowKnightDarkness`, `eyesOfTheDark`, `umbralCoating`
and `shadowCloak`. Shadow Magic's own passive then falls to
`FEATURE_CLASSIFICATION_OVERRIDES` (`"eyes of the dark": "ability"`).

Restructuring was also required: the generic `consumes` branch sits ~170 lines
*before* the name-match loop, and `activationAction` / `toggleAnalysis` /
`parsedEffects` are all declared after it, so referencing them from the earlier
branch throws a TDZ `ReferenceError`. The branch now falls through instead of
returning.

**Regression pins**: `CharacterSheetShadowMagicSorcerer.test.js` §Eyes of the
Dark classification; the Shadow Knight suites (unchanged and still green).

---

## CS-BUG-084 — TGTT Sorcery Points were one short at every level

**Status**: Fixed. **Supersedes the resolution of CS-BUG-018.**
**Surfaced by**: Shadow Magic Sorcerer — unifying the three formulas above
forced the disagreement into the open.

**Root cause**: the Thelemar Sorcerer's own class table
(`homebrew/TravelersGuidetoThelemar.json` → Sorcerer `classTableGroups` →
`["Sorcery Points"]`) reads `[2], [3], [4] … [21]` for levels 1–20, i.e.
**`level + 1`**, and points start at **level 1**, not level 2. CS-BUG-018
resolved the `getFeatureCalculations()` ↔ `updateClassResources` disagreement
by changing the *correct* side to match the wrong one, making the pool one
point stingy at every level and absent at level 1.

Nobody caught it because both existing TGTT Sorcerer E2E specs
(`tgtt-child-of-sun-sorcerer-hochling.spec.ts`,
`tgtt-heroic-soul-sorcerer-halfogre.spec.ts`) blanket-skip their entire
Sorcery Points ladder with `skipReason: "CS-BUG-018"` rather than assert a
number they could not reconcile.

**Fix**: `getSorceryPointsMaxForClass()` returns `level + 1` for TGTT and
`level >= 2 ? level : 0` for PHB/XPHB, and every surface now reads it.

**Follow-up available**: the CS-BUG-018 skips in the two neighbouring Sorcerer
specs are now liftable with `level + 1` values. Left in place here so the
blast radius of this change stays inside one subclass; whoever picks up
Lunar / Spellfire / Wicked Witch / Shadow Sorcery should take it.

**Regression pins**: `CharacterSheetShadowMagicSorcerer.test.js` §"base-class
Sorcery Points machinery" asserts both ladders explicitly.

### Addendum — the SECOND chokepoint (fixed separately)

The fix above hardened `_getNamedModifierEffectiveValue`, which feeds the cached
`customModifiers` totals. That is **not the only** place a stored modifier becomes
a number. `_resolveNamedModifierNumericValue` (dating from 2026-06-27, so it
predates the original fix) feeds `aggregateModifiers()` and the attack itemizer,
and it still read `mod.value` raw.

Measured in-browser on `artificer/battle smith/20/human` **after** the original
fix had landed:

```
getSaveMod("str"|"dex"|"con"|"int"|"wis"|"cha")  ->  2, 3, 12, 12, 1, 0   (correct)
aggregateModifiers("save:all").bonus            ->  "1attunedItems"      (a STRING)
```

All six per-save values were already correct — which is exactly **why the
existing per-save regression tests did not catch it**. Soul of Artifice registers
a numeric row *and* a symbolic row on the same `save:all` type, so the aggregate
performed `1 + "attunedItems"`.

⚠️ **Generalisable lesson**: when hardening a value-resolution defect, grep for
*sibling resolvers*, not just for raw readers of the field. The original audit
hunted consumers reading `mod.value` directly and missed a second **resolver**
method, because it looked like a fix rather than a bypass. Two chokepoints now
exist and both are commented as such so they cannot drift apart.

**No double-count check** (the assertion most likely to catch an over-broad
resolver): `wizard/bladesinger/11/elf` still reads AC `11 → 15` and concentration
`+2 → +6` with INT mod 4 — the modifier applied **once**. Bladesong's two named
modifiers are a deliberately `enabled: false` duplicate of the active-state path;
the resolver must not revive them, and does not.

**Recursion note**: resolving `"strScore"` calls `getAbilityScore("str")`, which
looks like an infinite loop for Indomitable Might. It is not: that modifier's type
is `ability:str:minimum`, a *sub-typed* variant which the ability-score
aggregation deliberately skips, so the resolver is never re-entered from inside
`getAbilityScore()`. Verified live — `barbarian/chained fury/18/minotaur` returns
STR `20` with zero page errors.

---

## CS-BUG-065 — WITHDRAWN (the "fix" was a regression; reverted)

**Status**: WITHDRAWN — not a bug. The change filed under this ID was reverted
because it introduced a shipped, player-visible regression.
**Severity**: n/a (the reverted change was high severity)
**Filed by**: Meteor Knight batch, from Increase Gravity (Meteor Knight 15)
"+ your Intelligence modifier to shove ability checks"

### What was claimed

That a `FeatureEffectRegistry` `modifier` effect carrying a `conditional`
string but no `advantage`/`disadvantage` flag was stored `enabled: false` and
therefore "never reached `aggregateModifiers()` at all — not as an applied
bonus and not in `result.conditionalsAvailable`", with "**no** code path
anywhere that could turn it back on".

### Why that is false

Measured on a live `fighter/meteor knight/15/aarakocra` with the original
(`enabled: false`) code:

```
inConditionals: true          <- it IS offered by the per-roll picker
shoveBonus:     1             <- carrying its correct value
baseBonus:      0             <- correctly gated off by default
optInBonus:     1             <- appliedConditionalIds moves it
```

`aggregateModifiers()` surfaces **disabled** conditionals in
`conditionalsAvailable` — the premise that `enabled: false` hid them was
simply wrong. The same is visible in Jest: the pre-existing shove test passes
both with and without the change, which is why its "regression pin" was
green-on-revert and proved nothing.

### What the change actually did

`_recalculateCustomModifiers()` gates on `mod.enabled` **alone** and never on
`mod.conditional`. So storing a numeric conditional `enabled: true` leaks its
value into `customModifiers.skills` — and from there into `getSkillMod()`,
which is both the number printed on the sheet and the modifier every skill
roll uses.

Measured, same character, INT +1:

| | `getSkillMod("athletics")` |
|---|---|
| original code | **5** (correct) |
| with the "fix" | **6** — the shove-only bonus applied to *every* Athletics check |

This violates the documented invariant that conditional modifiers are not
auto-applied. It is also inconsistent across the three roll handlers, because
they compose differently:

- `_rollSkillCheck` / `_rollSavingThrow` use `getSkillMod()` / `baseMod` only
  and never add `aggregated.bonus` -> the conditional applies **always**.
- `_rollAbilityCheck` adds `aggregated.bonus` **on top of** `baseMod` -> an
  opted-in conditional `check:*` modifier is **double-counted**.

So the change traded "offered but inert at roll time" for "silently always on,
and double-counted on ability checks". Both are wrong; the second is worse
because it puts a wrong number on the character sheet.

### Resolution

Reverted to:

```js
enabled: effect.enabled !== false && (carriesAdvFlag || !effect.conditional),
```

Disabling a numeric conditional costs nothing (the picker still offers it) and
is currently the only thing keeping it out of the quick-total.

### Regression pins (falsified)

`test/jest/charactersheet/CharacterSheetMeteorKnight.test.js` gains two tests
that pin the *player-facing* surface rather than the aggregator:

- `does NOT leak the conditional shove bonus into the plain Athletics modifier`
  — asserts `getSkillCustomMod("athletics") === 0` and that the L15 character's
  displayed Athletics matches an otherwise-identical L14 control (PB is 5 at
  both levels), with a PREMISE guard asserting the conditional is genuinely
  present and genuinely carries +4.
- `keeps the numeric conditional out of the enabled quick-total but still
  offers it` — asserts `enabled === false` *and* that it still appears in
  `conditionalsAvailable`, pinning both halves of the trade-off.

Both verified **red** when the reverted expression is re-applied, and green
after. Note the first pin was *vacuous* in its initial form: it compared
before/after around `applyClassFeatureEffects()`, but `addClass()` already
applies feature effects, so the baseline was pre-polluted and the test passed
under the regression. It also needs an explicit `_recalculateCustomModifiers()`
— without it the quick-total is never rebuilt and the leak cannot be observed.

Full charactersheet suite: 432 suites / 13,100 tests green.

### Genuine follow-up left open

Opting a **numeric** conditional in via the picker does not change a skill or
save roll total, because `_rollSkillCheck` and `_rollSavingThrow` never consume
`aggregated.bonus`. That is a real, pre-existing gap — it predates this batch
and is not what CS-BUG-065 described. Fixing it means reconciling the three
roll handlers' composition conventions (and removing the resulting
double-count risk in `_rollAbilityCheck`), which is a generic change, not a
subclass one.

---

## CS-BUG-066 — prose spell grants were parsed from rendered HTML, so every homebrew "You learn the {@spell x} spell" grant was silently dropped

**Status**: FIXED (Meteor Knight batch)
**Severity**: high — an entire category of homebrew feature grants nothing
**Surfaced by**: Reduce Gravity (Meteor Knight 3) — *feather fall* / *jump* /
*levitate* never appeared in `getInnateSpells()`

### Symptom

A homebrew feature whose text grants spells in prose granted **nothing**.
`getInnateSpells()` and the spellbook were both empty; the feature rendered
its description perfectly, which is exactly the "renders but does nothing"
failure mode.

### Root cause

`_processFeatureSpells()` read `feature.description`. For features stored
through the site renderer that string is already-rendered **HTML**:

```html
<div class="ve-rd__b">…You learn the
<a href="spells.html#feather%20fall_phb">feather fall</a> …</div>
```

`SpellGrantParser.grantsSpells()` tests for `/\{@spell/`, so it matched
nothing and the parser was never even invoked. The same feature object
carried an intact raw `entries` array with `{@spell feather fall}` tags
still in place — the parser was simply reading the wrong field.

### Fix

New generic `SpellGrantParser.getFeatureSpellText(feature)` walks the raw
`entries` tree (including nested `entries` / `items`) and returns it when it
carries `{@spell …}` tags, falling back to `description` otherwise. This
mirrors the existing `FeatureChoiceParser._getRawText()` convention, and
because the selection is driven by "which text actually has tags" it cannot
regress features that only ever had a `description`.

### Regression pins

`CharacterSheetMeteorKnight.test.js` — "parses prose spell grants from raw
entries when the description is rendered HTML". Verified in-browser via
`charSheet.spawn("fighter/meteor knight/3")`: `getInnateSpells()` went from
`[]` to `["Feather Fall", "Jump"]`, and to all three with the at-will upgrade
at 15.

---

## CS-BUG-067 — feature-wide "cast each once per long rest" clauses were out of the parser's context window, upgrading limited grants to permanent ones

**Status**: FIXED (Meteor Knight batch)
**Severity**: medium — turns a 1/long-rest grant into an unlimited one
**Surfaced by**: Reduce Gravity (Meteor Knight 3)

### Symptom

Reduce Gravity's *feather fall* / *jump* arrived with no `uses` and no
`recharge` — i.e. as permanently-available innate spells — even though the
feature says "You can cast each of these spells once with this feature, and
once you cast a spell in this way, you can not do so again until you finish
a long rest."

### Root cause

`SpellGrantParser.parseSpellsFromText()` looked for usage limits in a
±100/200-character window around each `{@spell}` tag. A feature that names
its spells in one sentence and states the shared limit two sentences later
falls outside that window entirely. This is the normal way homebrew is
written, so the failure is systemic rather than specific to this subclass.

### Fix

New `SpellGrantParser._parseFeatureWideCastingLimit(text)` scans the whole
feature for a **single sentence** containing all three of `cast`, `once` and
`short|long rest`, and returns that rest type. `parseSpellsFromText()`
computes it once and uses it as a fallback for any spell that found no local
limit and is not at-will. The single-sentence constraint is what keeps it
from over-firing: an unrelated "once per long rest" elsewhere in the feature
cannot bind to the word "cast" in a different sentence.

### Regression pins

`CharacterSheetMeteorKnight.test.js` — asserts `uses: {current: 1, max: 1}`
and `recharge: "long"` on the level-3 grants, and that the level-15 at-will
upgrade *clears* both.
