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

**Previously "intentionally LOW" — CORRECTED.**
`tgtt-time-domain-cleric.spec.ts` used to audit at 24% with the note
"every probe in this matrix is gated on CS-BUG-015 … leave LOW until
CS-BUG-015 is resolved." That guidance outlived its premise:
CS-BUG-015 is **Closed as Stale** (see its entry below), so the spec
was carrying two `skipReason: "CS-BUG-015"` rows and ~8 prose gap
comments deferring to a bug that no longer existed.

Re-measured the product directly rather than trusting the spec (the
spec is the artefact under suspicion, so it cannot be its own oracle).
Every frozen claim was false: Channel Divinity **does** surface as a
pool (1 / 2 / 3 at L2 / L6 / L18), and `getFeatureCalculations()`
exposes `hasChronologicalInterference`, `chronologicalInterferenceUses`
(= proficiency bonus), `hasRightOnTime`, `rightOnTimeBonus`,
`hasTemporalManipulation`, `temporalManipulationDc`,
`hasEyesOfFuturePast`, `eyesOfFuturePastUses` (= `max(1, wisMod)`),
`hasPotentSpellcasting`, `potentSpellcastingBonus`,
`potentSpellcastingClass` and `hasTemporalMastery`. Spec rewritten
against those; matrix green L1→20. Coverage 24% → 61%.

Two authoring rules came out of it, both preset-safety issues:

- `PRESET_FULL_TIME_CLERIC` sets no `abilityPriority`, so this build's
  **Wisdom is 10** and every Wis-derived value is 0 or its floor. Assert
  such values with `featureCalculationDerivedFrom` /
  `featureUsesEqualAbilityMod`, which pin the RELATIONSHIP. A literal
  would be asserting the preset, not the product.
- The two remaining bare-row clusters (domain-spell tiers, Divine
  Intervention) are genuine gaps, not deferred ones, and are now
  documented as such per-row.

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

### CS-BUG-103 — Features-tab "Use" silently burned a limited use for any state-gated feature

**Status**: Fixed.
**Surfaced by**: `tgtt-shadow-sorcery-rhw-sorcerer.spec.ts` L18
`pickActivatable(/umbral form/i)`, which clicked the Features-tab **Use**
button and then found nothing active.

**Measured live** on an exported L20 character, before the fix: clicking
Use on Umbral Form while its prerequisite state (Innate Sorcery) was
*not* running took `uses` from **1 to 0**, left `umbralFormRhw`
**inactive**, and left Sorcery Points **unchanged**. The player paid a
once-per-long-rest budget for nothing, with no message.

**Root cause**: `CharacterSheetFeatures._useFeature()`
(`js/charactersheet/charactersheet-features.js`) first asks
`_getActivatableAbilityForFeature()`. That resolves through
`getActivatableFeatures()`, which *correctly* skips any state whose
`requiresStates` are unmet — so a gated feature is simply absent from
the classified-ability branch and falls through to the bare
"decrement a use" fallback below it.

**Scope (enumerated, not assumed)**: `git grep -n "requiresStates"
js/charactersheet/` returns exactly two state definitions —
`umbralFormRhw` (`["innateSorcery"]`) and `astralBody`
(`["astralArms", "astralVisage"]`) — plus three consumers
(`getActivatableFeatures`, `activateState`, and the `deactivateState`
cascade). `astralBody` has `resourceCost: 0` and no uses budget, so
`umbralFormRhw` is the only feature that could actually lose something
today; the defect and the fix are both generic, and any future gated
state with a uses budget would have hit it.

**Fix**: new `CharacterSheetState#getUnmetStateRequirementsForFeature(feature)`
returns the *display names* of a feature's unmet prerequisite states;
`_useFeature()` consults it before spending anything and toasts
`"<name> requires <prereq> to be active."` instead of decrementing.

**Known scope limit (deliberate)**: `isActivatableAbilityEntry()` returns
false for any `isToggle` state, so the Features-tab Use button still
falls to the bare decrement for *ungated* toggle-with-uses features
(Rage, Bladesong, …). The Overview toggle row is the working surface for
those. Widening that classification was judged out of scope here; the
current contract is pinned by the test *"does NOT block the Features-tab
use once Innate Sorcery is running"*.

**Regression pin**: `CharacterSheetShadowSorceryRhw.test.js`, describe
*"Gated activatable features do not burn a use from the Features tab
(CS-BUG-103)"* — four tests, two of which drive
`features._useFeature(id)` (the reading) rather than the new accessor.
`return [];` as the first statement of
`getUnmetStateRequirementsForFeature` turns **2 of 13,280** red
(assertion failures, no `TypeError`).

---

### CS-BUG-102 — Spells-tab spell save DC ignored every active-state buff

**Status**: Fixed.
**Surfaced by**: `tgtt-shadow-sorcery-rhw-sorcerer.spec.ts` L5 loadout —
`probeToggleDelta(/innate sorcery/i)` reported `changed=false` for a
toggle whose entire mechanical effect is "+1 to your Sorcerer spell save
DC" plus advantage on spell attacks.

**Root cause**: `_buildSpellClassCard()`
(`js/charactersheet/charactersheet-spells.js`) hand-rolled the DC as
`8 + mod + prof` instead of asking the state. The Combat tab reads
`getSpellcastingClassBreakdown()[].saveDc`, which routes through
`getSpellSaveDcForAbility()` and *does* include state bonuses — so the
two tabs showed two different DCs, and the Spells tab, the one a player
actually casts from, showed the lower one.

Scope is wider than Innate Sorcery: any custom ability registering a
`{type: "bonus", target: "spellDc"}` effect (a documented target in the
custom-ability editor) was invisible on the Spells tab.

**Fix**: The card now folds `getBonusFromStates("spellDc")` into
`canonicalDc` and into the Gambler rolled-DC branch's static term.
Deliberately *not* done for the spell attack bonus:
`_rollSpellsTabAttack` already adds `getBonusFromStates("attack:spell")`
on top of the displayed value, so folding it into the display would
double-count it on every roll.

**Regression pin**: `CharacterSheetSpellsTabDc.test.js`, which builds a
real card by calling `_buildSpellClassCard()` and reads back the DC the
card wrote. Neutralizing `stateDcBonus` to `0` turns **2 of 13,280** red
(assertion failures, no `TypeError`).

**A tautological pin was caught and replaced.** The first pin for this
bug lived in `CharacterSheetShadowSorceryRhw.test.js` and recomputed
`8 + mod + prof + getBonusFromStates("spellDc")` by hand, then asserted
the result tracked `getSpellSaveDcForAbility()`. It never touched
`_buildSpellClassCard()`, so with the production fix neutralized the
entire suite stayed **GREEN (435 suites / 13,276 tests)** — the exact
"correct calculation that nothing reads" shape this bug *was*. Driving
the card required a dedicated test file: `charactersheet-spells.js`
captures its DOM helper at module load (`const {e_, ee} = globalThis;`
line 11), so a DOM stub has to be installed before the module is
imported, which per-file module isolation gives for free.

---

### CS-BUG-101 — Re-scaled feature uses did not reach the mirrored resource row

**Status**: Fixed.
**Surfaced by**: a live L20 probe of Shadow Sorcery (RHW) showing
`Power of Shadow 5/5` in the resource tracker while the feature itself
correctly carried 1 use per long rest.

**Root cause**: `_ensureZeroHpInterventionUses()` re-scaled
`feature.uses` when a definition's `usesMax` changed, but the resource
row mirroring that feature was written once at grant time and never
re-synced — so the tracker kept whatever number it was first given.

**Fix**: the helper now also writes `max` / `recharge` / `current` back
to the mirrored resource row, matching the pattern already used by
`_ensureCreationBardUses`.

---

### CS-BUG-100 — `takeDamage()` never applied resistance, immunity or vulnerability

**Status**: Fixed.
**Surfaced by**: a live L20 probe of Shadow Sorcery (RHW) under Umbral
Form — `getResistances()` listed 11 damage types and `takeDamage(20,
{damageType: "fire"})` still removed 20 hit points.

**Root cause**: two separate gaps that hid each other.
`takeDamage()` accepted a `damageType` and used it only to gate zero-HP
interventions; it never applied defenses. And the main sheet's Damage
button (`_onDamage`) never *asked* for a damage type, so the only path
that could have exercised defenses never supplied one. Play Mode had its
own hand-rolled copy of the arithmetic on a different code path
(`setCurrentHp`), which is why the model looked correct in that one
place. This is the "correct calculation that nothing reads" shape: every
resistance the model computed was decorative on the main sheet.

**Enumeration**: `takeDamage` had exactly three callers at the time
(`charactersheet.js` `_onDamage`, and `useDivineAllegiance` /
Infernal Conduit in `charactersheet-state.js`), none passing a
`damageType`, so adding defenses inside it could not double-apply.

**Fix**: extracted `applyDamageDefenses(damage, damageType)` as the
single source of the ×0 / ÷2 / ×2 arithmetic; `takeDamage()` applies it
when a `damageType` is supplied unless `unpreventable` or the new
`skipDefenses` is set; `_onDamage` now prompts for a damage type
whenever the character has any defense; Play Mode routes through the
shared helper instead of its own copy.

**Regression pin**: asserted at the hit points that leave the sheet, not
at `getResistances()`.

---

### CS-BUG-099 — `{type: "bonus", target: "spellDc"}` active-state effect had no consumer

**Status**: Fixed.
**Surfaced by**: implementing XPHB Innate Sorcery, whose whole effect is
"+1 to your Sorcerer spell save DC" and advantage on spell attacks.

**Root cause**: `spellDc` is an advertised effect target in the
custom-ability editor's target list, but no reader existed —
`getSpellSaveDcForAbility()` summed item bonuses, custom modifiers and
the exhaustion penalty and stopped there. `attack:spell` was fully
plumbed (`charactersheet-combat.js`, `charactersheet-spells.js`), which
made the gap easy to miss.

**Fix**: `getSpellSaveDcForAbility()` and both `getSpellSaveDC()`
branches now add `getBonusFromStates("spellDc")`. See also CS-BUG-102,
which was the same value failing to reach the Spells tab's own card.

---

### CS-BUG-098 — Sense grants were darkvision-only

**Status**: Fixed.
**Surfaced by**: Shadow Sorcery (RHW) Eyes of the Dark, which grants
120 ft darkvision **and** 10 ft blindsight.

**Root cause**: the feature-calculation → `getSenses()` bridge read
`calculations.darkvision` / `calculations.darkvisionSource` and nothing
else, so a `calculations.blindsight` (or tremorsense/truesight) grant
was computed and silently dropped.

**Enumeration**: at the time of the fix there were **zero** existing
assignments to `calculations.blindsight`, `.tremorsense` or
`.truesight` anywhere in `js/`, so generalising the block is inert for
every pre-existing build. Re-derive before relying on that:
`git grep -nE 'calculations\.(blindsight|tremorsense|truesight)\s*=' -- js/`

**Fix**: replaced the darkvision-only block with a loop over
`["darkvision", "blindsight", "tremorsense", "truesight"]`, keeping the
existing once-per-source guard.

---

### CS-BUG-097 — XPHB/TGTT Barbarian Rage pool becomes unlimited at level 20

**Status**: Fixed.
**Surfaced by**: `tgtt-chained-fury-barbarian-minotaur.spec.ts` after
retiring its CS-BUG-018 resource skips. The L20 matrix read a Rage
maximum of `999` instead of the TGTT table's exact `6`.

**Root cause**: `CharacterSheetClassUtils.updateClassResources()` used
one PHB progression array for every Barbarian source. Its L20 value was
the PHB unlimited-use sentinel (`999`), even though XPHB and TGTT remain
capped at six uses.

**Fix**: Added a source-aware `getRageUsesMaxForClass()` single source
of truth and routed both feature calculations and the level-up resource
writer through it. PHB keeps the unlimited sentinel; XPHB/TGTT remain
at six. A parameterized Jest regression covers all three sources.

---

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

## CS-BUG-086 — active-state bonuses targeting `skill:<name>` were silently discarded

**Status**: RESOLVED (this branch).

**Affected**: every active state whose effects use the ability-agnostic
`skill:<name>` / `skill:all` bonus vocabulary. The live victim found in-tree
is the **buff registry's Pass Without Trace**, which emits
`{type: "bonus", target: "skill:stealth", value: 10}` as a `selfEffects`
entry (`charactersheet-state.js` ~:55083). `_applyBuffFromRegistry`
(`charactersheet.js` :8178-8201) turns that into `customEffects` on a
`custom` active state, so it reached `getSkillBonusFromStates()` — which
threw it away.

**Symptom**: applying Pass Without Trace moved the displayed Stealth
modifier by **0** instead of **+10**. Because `_rollSkillCheck` goes through
`getSkillMod()`, the roll total was wrong too, not just the display.

**Root cause**: `getSkillBonusFromStates(skill, ability)` only ever matched
the *ability-keyed* `check:` hierarchy — `check:<ability>:<skill>`,
`check:<ability>`, `check`. The `skill:` vocabulary is used freely
everywhere else in the effect system (named modifiers, calculation-based
effects, `_effectMatchesType`), so a state author had no way to know one
aggregator spoke a narrower dialect. Nothing warned; the effect just
evaporated.

**Fix**: `getSkillBonusFromStates()` now additionally matches a
case/whitespace-normalised `skill:<skillName>` and `skill:all`. These are
deliberately **ability-agnostic**: a `skill:stealth` bonus survives an
ability swap on the skill, which is the whole point of the vocabulary.

**Regression pin**: `test/jest/charactersheet/CharacterSheetSteelHawk.test.js`
→ `CS-BUG-086: active-state bonuses targeting skill:<name>` (5 tests:
Pass Without Trace's +10 reaches the modifier, `skill:all` fans out,
scoping does not leak to other skills, survives an ability swap, drops on
deactivation). **Falsified**: reverting only the `isSkillTarget` branch
turns **5** of 13142 red.

---

## CS-BUG-087 — the two advantage aggregators disagreed about hierarchical attack targets

**Status**: RESOLVED (this branch).

**Affected**: any active state granting advantage on a *category* of attack
(`target: "attack:melee"`, `"attack:ranged"`, `"attack"`) when queried with
a more specific roll type (`"attack:melee:str"`).

**Symptom**: `hasAdvantageFromStates("attack:melee:str")` returned `true`
(so the actual roll made by `_rollAttack` DID get advantage) while
`getAdvantageState("attack:melee:str").advantage` returned `false`. The
roll and the badge that explains the roll disagreed.

**Root cause**: `hasAdvantageFromStates()` has an explicit attack-prefix
branch:

```js
if (e.target.startsWith("attack") && rollType.startsWith("attack")) {
    if (rollType.startsWith(e.target)) return true;
    if (e.target.startsWith(rollType)) return true;
}
```

`_effectMatchesType()` — which backs `getAdvantageState()` and
`_getConditionalActiveStateModifiersForType()` — had no equivalent. It
handled `check:` → `skill:` category matching and exact matches only, so
`("attack:melee", "attack:melee:str")` fell through to `false`.

**Fix**: `_effectMatchesType()` gained the same hierarchical attack branch,
segment-anchored (`type.startsWith(`${effectTarget}:`)`) so `attack:melee`
can never accidentally match a hypothetical `attack:meleeSomething`.

**Not a Steel Hawk bug**: Launch's momentum state exposed it, but the
inconsistency is generic and predates this branch.

**Regression pin**:
`test/jest/charactersheet/CharacterSheetSteelHawk.test.js` → *"grants
ADVANTAGE on melee attacks while armed — on BOTH aggregators"*, which
asserts both functions agree AND that a ranged attack still gets nothing.
**Falsified**: removing only the attack branch turns **1** of 13142 red.

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
> > **AMENDMENT (Wicked Witch merge).** The count above is now **five**, not
> > four: `ACTIVE_STATE_TYPES.flyMyPretty` (Wicked Witch 14) emits
> > `{target: "speed:fly", value: 60}`. The *conclusion* is unaffected — it is
> > a grant ("60-foot flying speed"), so `Math.max` remains the correct
> > combine and no discriminator is needed. Recorded because the argument
> > above rests on an enumeration, and **an enumeration is a claim with an
> > expiry date**: every new curated active state is a potential emitter, so
> > the count must be re-derived rather than cited. Re-derive with
> > `git grep -n 'target: "speed:' -- js/charactersheet/` and discard the
> > `speed:walk` hits, which are outside the guard entirely.
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

## CS-BUG-075 — a subclass spell grant with a `{choose}` block was silently dropped

**Status**: FIXED (Arcana Domain Cleric batch)

**Symptom**: Arcana Domain's Arcane Initiate grants "two cantrips of your
choice from the wizard spell list". No pick-list ever appeared — in the
Builder, in Level-Up, or in Quick Build — and no cantrip was added. The
feature rendered as prose and did nothing.

**Root cause**: `getSubclassAlwaysPreparedSpells()` walks a subclass's
`additionalSpells` block and resolves every entry through
`_parseSpellReference()`. That helper handles a **string** (`"detect magic"`,
`"magic missile|phb"`) and returns `null` for anything else. A choose block is
an **object** — `{choose: "level=0|class=Wizard", count: 2}` — so it fell out
of the walk entirely. There is no other reader of `additionalSpells`, so **no
subclass in the whole product could offer a player-chosen spell**; the shape
had simply never been implemented.

**Fix**: a parallel, choose-shaped walker rather than a per-subclass
special-case. New `getSubclassSpellChoiceSlots()` walks the same
`additionalSpells` structure, keeps only `{choose}` entries whose level gate
the character has met, and expands each `count` into that many stable slots
keyed by `_spellChoiceSlotKey()` (class / subclass / category / level /
index). `_ensureSubclassSpellChoices()` reconciles those slots against
`_data.fulfilledSpellChoiceSlots` and mints a pending choice for each unfilled
one; `getPendingSpellChoices()` and `hasPendingSpellChoices()` call it first,
so all three creation flows — which already call
`processPendingSpellChoices()` — surface the picker with no flow-specific
work. `fulfillSpellChoice()` records the slot so a choice is never re-offered,
and honours `alwaysPrepared` so a granted spell does not eat the prepared
limit.

This lights up Arcane Mastery (four picks: one each of 6th/7th/8th/9th level)
by the same mechanism, and every other `{choose}` grant in the data.

**Regression pins**: `CharacterSheetArcanaCleric.test.js` §Arcane Initiate's
two wizard cantrips and §Arcane Mastery is a four-part pick-list; the
`stateCall getSubclassSpellChoiceSlots` / `getPendingSpellChoices` and
`cantripCount` probes in `tgtt-arcana-cleric.spec.ts`.

---

## CS-BUG-076 — `potentSpellcastingBonus` was computed by ten subclasses and read by nothing

**Status**: FIXED (Arcana Domain Cleric batch)

**Symptom**: Potent Spellcasting (Arcana / Knowledge / Life… Cleric, and
Druid's Potent Spellcasting) claims to add the Wisdom modifier to cantrip
damage. Rolling a cantrip produced the base dice only.

**Root cause**: `getFeatureCalculations()` sets `potentSpellcastingBonus` in
roughly ten subclass branches, but a repo-wide search found **no consumer** —
the number existed purely to be displayed.

**Fix**: generic, not per-subclass. New
`state.getCantripDamageBonus(spell)` returns `{bonus, sources}` and is scoped
by a new `calculations.potentSpellcastingClass` (set alongside the bonus in
the Cleric and Druid branches) via a new `spellCountsForClass(spell,
className)` helper — so a Cleric/Wizard multiclass does not add Wisdom to
their *wizard* cantrips. `charactersheet-spells.js` `_rollCantripDamage()`
adds `bonus` and labels it in the breakdown; `charactersheet-features.js`
shows a "Cantrip Damage +N" stat badge.

Arcane Initiate's wizard cantrips *count as cleric cantrips*, so they receive
the bonus — asserted explicitly.

**Deliberately out of scope**: the weapon-channel cantrips (Booming Blade,
Green-Flame Blade) do not route through `_rollCantripDamage`, so they do not
pick the bonus up. RAW this is contested; it is noted rather than silently
implemented either way.

**Regression pins**: `CharacterSheetArcanaCleric.test.js` §Potent Spellcasting
(including negative controls for level, non-cantrips and other-class
cantrips); the `stateCall getCantripDamageBonus` probes in
`tgtt-arcana-cleric.spec.ts`.

---

## CS-BUG-077 — `showFilteredSpellPicker` resolved before the modal closed, so batched picks collapsed

**Status**: FIXED (Arcana Domain Cleric batch)

**Symptom**: Arcane Initiate grants **two** wizard cantrips. Only one ever
landed. `processPendingSpellChoices()` marked both slots fulfilled, so the
second was never re-offered.

**Root cause**: `showFilteredSpellPicker` is `async` but returned as soon as
`CharacterSheetModal.pGetShow` had rendered — not when the user had picked.
`processPendingSpellChoices()` awaits it in a `for … of` loop, so every picker
in the batch opened at once, each holding the `knownSpellIds` snapshot taken
before *any* pick. Two picks of the same top-of-list cantrip then collapsed to
one via `addSpell`'s dedupe.

**Fix**: `showFilteredSpellPicker` now returns a promise that settles on modal
close (`cbClose`), so the loop is genuinely sequential and each picker sees the
spells chosen before it.

**Regression pin**: the `cantripCount` probe in `tgtt-arcana-cleric.spec.ts`
(the two Arcane Initiate picks are the only guaranteed cantrips on that build,
so a collapse fails the matrix).

---

## CS-BUG-078 — the 2014 Cleric's Channel Divinity pool was 2 uses at level 2

**Status**: FIXED (Arcana Domain Cleric batch)

**Symptom**: a 2nd-level 2014 Cleric had **two** Channel Divinity uses on the
sheet instead of one, all the way to level 5.

**Root cause**: the pool is minted by `addFeature`'s grant-time prose parser,
and the 2014 Cleric's level-2 feature text advertises its future tiers in the
same paragraph — "Beginning at 6th level, you can use your Channel Divinity
**twice** between rests". The parser read that "twice".
`_ensureChannelDivinityUses` (the CS-BUG-033 reconciler) only ever **raised**
the max, so the over-count was permanent. The CS-BUG-033 suite even encoded
the one-way behaviour as intended ("never lowers a pool that is already larger
than the progression").

**Fix**: `_getChannelDivinityUsesForClass` is authoritative in **both**
directions. `resourceStale` / `featureStale` compare with `!==` rather than
`<`, and `feature.uses.current` is clamped to the new max. Multiclass stays
safe because `desiredMax` is the largest contribution across every class.
The superseded CS-BUG-033 case has been rewritten in place.

**Regression pins**:
`CharacterSheetChannelDivinityScaling.test.js` §lowers a pool that the prose
parser over-counted; `CharacterSheetArcanaCleric.test.js` §Cleric Channel
Divinity pool is capped and scales 1 → 2 → 3; the tiered `Channel Divinity`
resource rows in `tgtt-arcana-cleric.spec.ts`.

---

## CS-BUG-079 — 2014 Cleric domain Channel Divinity options were unclassified and unlimited

**Status**: FIXED (Arcana Domain Cleric batch)

**Symptom**: "Channel Divinity: Arcane Abjuration" surfaced with no
`interactionMode`, was not linked to the Channel Divinity pool, and could be
used an unbounded number of times. Its Wisdom save never rolled.

**Root cause** (measured, and *not* what it first looked like). There are
**two** independent causes producing the same symptom:

1. **The tag is dropped on the way to the sheet.** `class-cleric.json`'s L2
   SCAG entry for Arcane Abjuration *does* carry
   `consumes: {name: "Channel Divinity"}` — but the exported live character
   showed `consumes: None`. `CharacterSheetClassUtils` builds subclass features
   at **five** sites, and only the `refSubclassFeature` expansion copied
   `consumes` / `uses`; the other four whitelist a fixed key set and silently
   dropped them. Paladin oaths reach the sheet through the ref-expansion path,
   which is why Crown's Champion Challenge / Turn the Tide *did* arrive tagged
   and this looked like a data difference between the two classes.
2. **Many options genuinely ship untagged.** 18 of the 40
   `Channel Divinity*` entries in `class-cleric.json` carry no `consumes` at
   all — including Tempest's Destructive Wrath, which is precisely why it
   needed a hard-coded `FEATURE_CLASSIFICATION_OVERRIDES` entry. That is
   per-subclass special-casing of exactly the kind this codebase avoids.

**Fix**, in two generic parts.

*(1) Propagate the tag.* The four subclass-feature construction sites in
`charactersheet-class-utils.js` now spread `consumes` through, matching the
ref-expansion site. This is the true root-cause fix and reaches **113**
`subclassFeature` entries across six pools — Channel Divinity (54), Sorcery
Point (16), Psionic Energy Die (15), Ki (14), Focus Point (9) and Wild Shape
(5) — every one of which previously failed to link when collected through one
of those four paths. `uses` is deliberately **not** propagated: it would mint a
new resource pool for features that merely document a count.

*(2) Classify the naming convention* as the safety net for the 18 options that
carry no tag in the data at all. Every Channel Divinity option
in every source is named `Channel Divinity: <Option>`, so
`detectActivatableFeature` now routes any feature matching
`/^channel\s+divinity\s*:/i` through `_buildAbilityActivationInfo` with
`resourceName: "Channel Divinity"`. Placed **after** the `consumes` branch and
the classification-override block, so Paladin oaths and Destructive Wrath keep
their existing paths unchanged. Options carrying their **own** use pool (TCE's
"Channel Divinity: Harness Divine Power", PB/long rest) are excluded so the
more specific pool keeps owning the row.

Because the option now classifies as an `"ability"`, it inherits the CS-BUG-053
fix and its save DC resolves from the character through `getFeatureSaveDc()`.

**Regression pins**: `CharacterSheetArcanaCleric.test.js` §Arcane Abjuration is
a usable Channel Divinity option (including the `consumes`-tagged and
own-pool negative controls); the `combatAction` + `resource` probes in
`tgtt-arcana-cleric.spec.ts`.

Part (1) needs a pin of its **own**: because part (2) independently classifies
the feature, every other probe on the row stays green with the tag still
missing — reverting the four spreads left the whole matrix green. The dedicated
pin is the `stateCall` probe on the L2 Arcane Abjuration row asserting
`getFeature("Channel Divinity: Arcane Abjuration").consumes.name ===
"Channel Divinity"`. Falsified: with the four spreads reverted it fails with
`consumes.name=null` and is the *only* failure in the matrix; restored, green.

**Blast-radius validation for part (1)**, one spec per affected pool:
`tgtt-tempest-cleric` + `tgtt-crown-paladin` (Channel Divinity),
`tgtt-sea-druid` (Wild Shape), `tgtt-mercy-monk-changeling` (Ki),
`tgtt-child-of-sun-sorcerer-hochling` (Sorcery Point) — all green.
**Not covered**: Focus Point (2024 Monk) and Psionic Energy Die (Psi Warrior)
have no spec in this suite; they are propagated on the same code path but
unverified end-to-end.

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

**Follow-up available — but only for HALF the skips. Read this before lifting
anything.** Each of the two neighbouring Sorcerer specs carries **9** skipped
rows, and they split into two groups that must be treated differently:

| Rows | Kind | Liftable? |
|---|---|---|
| 6 per spec | `kind: "resource"`, `name: "Sorcery Points"` | **Yes** — set `resourceMax` to `level + 1` **and** add `untilLevel` to every tier (the matrix re-evaluates each earlier row at checkpoints `[3,5,11,17,20]`, and this pool grows every level) |
| 3 per spec | `kind: "pickToggleable"` on the `/metamagic/i` rows | **No — structurally unsatisfiable. Do not unskip.** |

The `pickToggleable` rows match on `/…spell.*active/i`, i.e. the **activatable**
surface — but metamagic is deliberately excluded from it at three sites in
`js/charactersheet/charactersheet-combat.js` (`:5806`, `:5827` — *"Skip metamagic
features (managed via metamagic dashboard)"* — and `:6048`). Metamagic is a
**cast-time** mechanic resolved through `getCastableActiveMetamagics()`, because
its cost depends on the individual cast's slot level (`"level"` / `"halfLevel"`)
and its legality on the individual spell. Lifting those six yields six
guaranteed false reds sitting immediately beside the Sorcery Points rows, where
they read as a regression in *this* fix.

Assert metamagic with `stateCall` instead — see
`tgtt-shadow-magic-sorcerer.spec.ts`:

```ts
{kind: "stateCall", method: "getKnownMetamagicKeys", path: "length", exact: 2},
{kind: "stateCall", method: "getMetamagicCost", args: ["twinned", 3], exact: 3},
```

Name-matching probes are unsafe for a second, independent reason: on a
**spawned** build the Features surface lists metamagic options the character has
*not* picked, so a `/quickened spell.*active/i` probe can pass on a character
that does not know it. (Measured: a **wizard-built** character does *not* leak —
forcing `pickedCount: 20` returned `got 2`. The two builders differ whenever a
level carries a choice.) `stateCall` is immune to both problems.

Left in place here so the blast radius of this change stays inside one subclass;
whoever picks up Lunar / Spellfire / Wicked Witch / Shadow Sorcery should take
the six resource rows and leave the three metamagic rows alone.

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

**Falsified**: restoring the literal prior `feature.description` expression
turns **1 test red** on the full `charactersheet/` suite. Measured twice —
once by the implementing session, once independently at merge time.

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

**Falsified**: restoring the original local-context-only expressions

```js
const isOnce = /once|one time/i.test(context) && /rest|dawn|day/i.test(context);
const recharge = /short rest/i.test(context) ? "short" : (/long rest|dawn|day/i.test(context) ? "long" : null);
```

turns **5 tests red** on the full `charactersheet/` suite. Measured
independently at merge time and again by the implementing session; both runs
agree on 5. Keep `_parseFeatureWideCastingLimit()` defined when running this
control — deleting it as well produces a `ReferenceError` and an inflated red
count that proves nothing.

---

## CS-BUG-090 — a species trait whose NAME collides with a combat method was reclassified as one

**Status**: RESOLVED.

**Affected**: any character whose species grants a trait sharing a name with a
TGTT combat method. Enumerated against the shipped data: **Centaur** (GGR,
MPMM, and the TGTT `_copy` of them) → **`Charge`**, and **Kender** (DSotDQ) →
**`Taunt`**. The collision surface is the 321-name `combatMethod` catalogue, so
any future homebrew species trait with a generic combat name joins it.

**Symptom** — the racial trait was stored as a combat method. Measured on a
wizard-built Centaur Hunter Ranger 3, `getCombatMethods()` returned **4** where
the class table grants **3**:

```json
{"name": "Charge", "_entityType": "combatMethod", "tradition": "Rapid Current",
 "degree": 1, "staminaCost": 1, "featureType": "Species"}
```

`featureType: "Species"` — its true origin — sits alongside combat-method
markers it should never have. User-visible consequences: the racial trait
appears in the Combat Methods UI grouped under a tradition the character never
took, it acquires a **1-point stamina cost**, and the character appears to know
one more method than the class table allows — which also lets a genuinely lost
pick hide behind it.

**Root cause** — `_repairCombatMethodMarkers()`
(`js/charactersheet/charactersheet-state.js`) matched the catalogue on
**name + source alone**:

```js
const entity = this._combatMethodCatalog.find(m =>
    m?._entityType === "combatMethod"
    && (m.name || "").toLowerCase() === name
    && (m.source || "").toLowerCase() === source);
```

Its only guard was `hasTypePrefix(f, ["BT", "AS"])` — Battle Tactics and Arcane
Shots. Nothing excluded a species / background / feat trait. A TGTT-sourced
species matches on source too, so the racial `Charge` matched the TGTT method
`Charge` exactly and was stamped.

Note this is a *repair* pass whose whole job is to re-hydrate methods that lost
their markers (CS-BUG report #14, "Doubleshot does nothing"), so it deliberately
trusts name+source. The defect is that "lost its markers" and "never was one"
are indistinguishable under that predicate.

**Fix** — skip features tagged as belonging to another entity kind, unless they
carry a real CTM marker; and undo exactly the fields the pass writes, so it is
its own inverse and repairs saves already mis-stamped:

```js
const FOREIGN_ORIGIN_TYPES = /^(species|race|subrace|lineage|background|feat)$/i;
…
if (isForeignOrigin(f) && !hasTypePrefix(f, ["CTM:"])) {
    if (f._entityType === "combatMethod") delete f._entityType;
    delete f.tradition; delete f.degree; delete f.staminaCost;
    continue;
}
```

The CTM escape hatch keeps the guard from being over-broad: a homebrew species
that legitimately grants a real combat method still repairs.

**Why the suite missed it** — Combat Methods had **no assertion anywhere in the
E2E suite**. `TGTT_COMBAT_METHODS_BY_TRADITION` existed as a fully-populated
constant with zero consumers, and the two specs that mention the feature both
asserted only that the parent `Combat Methods` row exists, under the comment
*"Pick-kind would require enumerating all options; treat as passive listing."*

**Discovered by** the new `buildCombatMethodChecks()` helper, while validating
its own falsification — the count assertion failed at L3 reporting
`getCombatMethods().length=4, expected 3`.

⚠️ **Do not assert combat methods with `kind: "pick"` over
`TGTT_COMBAT_METHODS_BY_TRADITION`.** That was the helper's first design and it
is unsound: the union of 321 generic name patterns matches features that are not
combat methods, so `matchCount` is inflated by a race/class-dependent amount.
The very first run scored 4 matches against 3 real methods — for the same
`Charge` collision, but through the *harness*, and it would still have been
wrong after this product fix. Use `stateCall` on `getCombatMethods()`, which
filters structurally via `CharacterSheetClassUtils.isCombatMethod()`.

### Regression pins

`CharacterSheetCombatMethodRepair.test.js` — describe block
*"CS-BUG-090 — species traits that share a name with a combat method"*.
**Falsified: 2 of 5 go red on revert**, both on assertions
(`Received: "combatMethod"`), not TypeErrors. The other three are deliberate
no-regression controls — a premise guard that the collision exists at all, plus
the two over-broadness controls (a genuine same-named method still repairs; a
species trait carrying CTM markers survives) — which must stay green either way.

E2E: `tgtt-hunter-zodiac-centaur.spec.ts` fails at L3 without the fix and passes
with it, so the new helper pins this end-to-end as well.
## CS-BUG-091 — a subclass-granted combat method absorbed the next class-table increment

**Status:** Fixed.
**Affects:** 27 TGTT subclasses across 4 classes — Fighter 11 (Eldritch Knight
grants **two**), Monk 14, Paladin 1 (Oathbreaker), Rogue 1 (Swashbuckler).
Barbarian and Ranger grant none, which is exactly why this hid for so long.

### Symptom

Every one of those subclasses says, in prose, *"you learn one additional method
from this tradition."* The character received it — and then never received the
**next** method the class table owed them, and stayed one short for the rest of
their career. On a wizard-built Astral Self Monk, measured:

| Monk level | Class table | Expected (table + grant) | Actual |
|---|---|---|---|
| 3 | 2 | 3 | 3 ✅ |
| 4 | 3 | 4 | 3 ❌ |
| 5 | 3 | 4 | 3 ❌ |

The L3 value being *correct* is what made this so quiet: the grant visibly
arrived, so the feature looked implemented. The loss only shows up one level
later, as a pick that is never offered.

### Root cause

`optionalfeatureProgression` for `CTM:*` stores a **cumulative total**, not a
per-level delta. `CharacterSheetClassUtils.getOptionalFeatureGains()` computed:

```js
newOptionsCount = countAtNew - existingOfType;
```

`existingOfType` counts every CTM feature on the character — including the
subclass-granted one. So at Monk 4 the table wanted 3 total, the character
already held 3 (2 class picks + 1 grant), and the difference was 0. The grant
had silently spent the class's next increment.

The grant itself is added by a separate path
(`charactersheet-levelup.js` ~:525, via `getSubclassBonusMethodCount()`), which
fires once at the subclass-selection level. QuickBuild was **already correct** —
it adds the bonus into `gain.totalNeeded` (`charactersheet-quickbuild.js`
~:2456, ~:2492), so its arithmetic nets out. The Builder → Level-Up path was the
odd one out.

### Fix

In `getOptionalFeatureGains()`, discount subclass-granted bonus methods from the
"already known" count, **scoped to `CTM:*` only** — no other progression type
(invocations, maneuvers, arcane shots, metamagic) has an additive-grant concept,
so the blast radius is exactly TGTT combat methods.

The discount is the *excess over the class table's total at the **current**
level*, capped at the subclass allowance:

```js
alreadyGrantedBonus = Math.min(bonusAllowance, Math.max(0, existingOfType - countAtCurrent));
```

⚠️ **Why the inference rather than a flat `- bonusAllowance`:** at the
subclass-selection level the grant has not been taken yet, so the excess is
still 0 and the class path correctly contributes nothing — leaving the
level-up module's own bonus augmentation to supply that single pick. A flat
subtraction would make both paths offer it and hand the player **two** methods
at the grant level. The clamp also keeps a hand-edited import carrying surplus
methods from having the surplus read as grants.

`totalCount` is reported as `countAtNew + alreadyGrantedBonus` so the picker
header satisfies `currentCount + newCount === totalCount` instead of claiming a
total lower than the character's own holding.

### Regression pins

`CharacterSheetCombatMethodBudget.test.js` — 8 tests.
**Falsified: 4 of 8 go red on revert, all on assertions, zero TypeErrors.**
The revert breaks the logic in place with the signature intact (sets the
discount to 0), rather than deleting anything. Three of the four originally
failed as `TypeError: Cannot read properties of undefined`; the tests were
hardened with an explicit `expect(gain).toBeDefined()` so the failure is an
assertion, per the rule that a red `TypeError` is not a falsification.

The 4 that stay green are deliberate controls: the no-double-count guard at the
grant level, the over-discount clamp, the subclass-driven control (no
bonus-granting subclass → old arithmetic), and a non-CTM progression control.

E2E: `tgtt-astral-self-monk-changeling.spec.ts` fails at L5 without the fix
(`getCombatMethods().length=3, expected 4`) and passes L1→20 with it.

### How it was found

Not by interpreting a failure — by **validating a harness helper on a second
class**. `buildCombatMethodChecks` had been built and verified on Ranger only,
and Ranger is one of the two TGTT classes with no subclass grants. Wiring it
into a Monk spec produced a red that turned out to be two independent defects
stacked: a harness gap (the helper ignored subclass grants) *and* this product
bug underneath it. Validating on N=1 class would have shipped both.

---

## CS-BUG-088 — Indomitable Might rendered but did nothing, and was modelled on the wrong rule

**Status:** Fixed
**Severity:** Medium (a capstone-tier class feature with zero mechanical effect)
**Area:** `charactersheet-state.js` (FeatureEffectRegistry, `aggregateModifiers`), `charactersheet.js` (roll handlers)

### Symptom

Indomitable Might (Barbarian 18) appeared on the Features tab and did **nothing**.
Measured live on `barbarian/chained fury/18/minotaur` before the fix:

```
namedModifiers -> {name: "Indomitable Might", type: "ability:str:minimum", value: "strScore"}
aggregateModifiers("ability:str:minimum") -> bonus 0, sources []
aggregateModifiers("check:str")           -> bonus 0, minimum null
getAdvantageState("check:str")            -> no minimum, sources []
_data.rollFloors                          -> {}   (empty)
```

The modifier was created and then read by **no one**. This is precisely the
"description-only rendering" the subclass batch's acceptance bar forbids.

### Root cause — two independent defects

**1. No consumer.** It was registered as
`{type: "modifier", modType: "ability:str:minimum", value: "strScore"}`.
`ability:str:minimum` had exactly one emitter and zero readers suite-wide, so
the value never reached a roll.

**2. The modType encoded the wrong rule — the more important defect.**
RAW is a floor on the **total of a check**, not on the **ability score**:

> PHB: "if your total for a Strength check is less than your Strength score, you can use that score in place of the total."
> XPHB: "…for a Strength check **or Strength saving throw**…"

So simply adding a handler for `ability:str:minimum` would have produced a
*correct-looking number enforcing the wrong rule* — a Strength score reading 20
when RAW never modifies the score. The model had to change, not just the wiring.

Three floors now coexist and must not be conflated:

| Concept | Floors | Example |
|---|---|---|
| `skillMinimum` → `aggregate.minimum` | the **d20 die** | Reliable Talent |
| `checkTotalFloor` → `aggregate.totalMinimum` | the **final total** | Indomitable Might |
| ability-score bonuses | the **score** | what the old modType wrongly implied |

### Fix

- Registry: `{type: "checkTotalFloor", ability: "str", floorFrom: "abilityScore", savesInEditions: ["XPHB"], __editionAware: true}`.
  Only the *rule* is stored, never a number — the floor is read live from
  `getAbilityScore()` so it tracks ASIs, Primal Champion and Wild Shape. (Baking
  the value at grant time is the CS-BUG-038 failure mode.)
- `aggregateModifiers` emits `result.totalMinimum` on `check:<abl>` / `save:<abl>`.
  **A Strength skill check already aggregates `check:str`** (`checkType` in
  `_rollSkillCheck`), so Athletics is covered by the same rule with no second
  entry — and a skill whose ability has been swapped away from STR correctly
  stops matching.
- New shared helper `_applyTotalFloor(total, floor)` applied in all three roll
  handlers *after* every modifier and buff die, because RAW floors the total.
- Edition divergence resolved from the **feature's own `source`**, threaded in
  opt-in via `__editionAware`. Every other registry effect is passed through
  byte-identically, so this cannot change behaviour for anything that does not
  ask for it. (The alternative — making the class-feature lookup source-aware
  like the feat lookup — was rejected: all 23 source-keyed registrations are
  feats/race traits, so it would have changed a shared path for one feature.)

RAW says "you **can** use that score", but the floor can only ever raise a total,
never lower it, so it is auto-applied and disclosed in the result note rather
than prompted — matching the existing die-floor and ability-swap conventions.

### Verification

End-to-end with a stubbed natural 1 on `barbarian/chained fury/20/minotaur`
(STR 24) — displayed totals:

```
Strength Check   8 -> 24   "Total raised to 24 (was 8)"
Athletics Check 20 -> 24   "Total raised to 24 (was 20)"   (skill path)
Strength Save   14 -> 24   "Total raised to 24 (was 14)"   (XPHB only)
Dexterity Check  3         untouched
L17 control                nothing floored anywhere
```

The floor reads 20 at level 18 and 24 at level 20 — it tracks Primal Champion
live rather than baking the grant-time score.

### Regression pins — `test/jest/charactersheet/CharacterSheetIndomitableMight.test.js` (9)

Staged falsification (a single full revert would have flattered the set):

| Reverted | Red | Notes |
|---|---|---|
| aggregate emission only | **4** | all assertions, zero TypeErrors |
| edition tagging only | **1** | exactly the XPHB-saves pin |
| registry to pre-fix state | **5** | the true shipped-bug red count |

The 4 pins that survive every revert are **negative controls** (no leak to other
abilities, no feature ⇒ no floor, die-floor untouched, score/mod unchanged).
They assert *absence*, so by construction they cannot go red on a revert; they
guard against over-application, which is the opposite failure.

### How it was found

Assigned as "add an `ability:<abl>:minimum` handler". Probing the modifier live
before writing any code showed it was inert *and* that the target was wrong, so
the handler would have been the wrong fix. Measuring the value rather than
interpreting the ticket is what changed the outcome.

---

## Phase 17 — predetermined-outcome probe sweep (E2E harness, not a product bug)

Not a CS-BUG: no product defect is described here. It is recorded in this
file because it governs how much any *other* entry in this file can be
trusted.

A **predetermined-outcome probe** is an assertion whose result is fixed by
the harness's own shape rather than by product behaviour. It has two
halves, and both had shipped:

- **Cannot FAIL** — inert level windows, no-op page-object helpers,
  probes aimed at a surface the feature is deliberately excluded from.
- **Cannot PASS** — a `pickedCount: N` against a pool of fewer than N
  options; a `damageContains` against a field the reader never collects.

The property is checkable **statically, before running anything**, which
is the whole point: you cannot find these by running the suite.

### Why an inert row is worse than a skipped one

`scripts/auditE2eCoverage.mjs` flags rows whose `[level, untilLevel]`
window contains none of the matrix checkpoints `[3, 5, 11, 17, 20]`. Such
a row never executes — and unlike `skip: true` it leaves **no marker**, so
it is invisible to both `grep` and human review, and it presents as a
green spec.

The damage is larger than a missing number. **The row's `name:` existence
check dies along with its `effects:`**, so an inert row means the feature
has no verification of any kind at any level. That is a silent hole
straight through this batch's acceptance bar — *every ability a subclass
provides must be offered, shown, and implemented*. Measured: three
permanent Rogue subclass features (Tantalizing Shivers, Fluid Step,
Slippery Mind) were wholly unverified this way, in a spec reporting green.

Generally: **a skipped or inert assertion is a frozen claim about a moving
target, and the freeze is invisible because the test stays green.** Live
assertions are re-validated continuously; these are not. The discipline is
therefore needed most exactly where nothing forces it.

### Repair rule for an inert row

Decide against the **product source**, never against the spec — the spec
is the artefact under suspicion, so it cannot be its own oracle.

- **Value unobservable** (the step holds only *between* checkpoints, e.g.
  Rogue Sneak Attack 4d6 on L7-8) → **delete**. Widening the window to
  reach a checkpoint changes the correct value, so there is nothing to
  repair. Confirm first that every observable step is asserted elsewhere.
- **Value permanent, window merely wrong** (e.g. `manifestationDie` is
  `level >= 13 ? "1d8"`) → **widen, or drop `untilLevel` entirely**. Note
  `findInertRows` skips open-ended rows, since those always reach the last
  checkpoint.

### A dead probe can hide a broken probe

Un-deadening Shadow Magic's Hound of Ill Omen — whose entire structural
block (cost, range, AC, HP, bite, summon/dismiss, scaling descriptor) had
never run — immediately produced:

```
classSummon(summonHoundOfIllOmen) damage "2d6+3" missing "piercing"
```

Not a product bug: the companion sets `damageType: "piercing"` correctly.
The `classSummon` reader in `comprehensiveBuildHelpers.ts` collected only
`[damage, desc, entries]`, so `damageContains` could never match a
companion carrying its type structurally rather than inline — and the
field is `description`, not `desc`. A *cannot-PASS* defect living in the
**shared harness**, latent for every future author. It was reachable only
through the inert-window fix.

**Status: swept.** Inert level windows and unreachable pick thresholds are
both at **zero** suite-wide. Run `node scripts/auditE2eCoverage.mjs` after
any `featuresMatrix` edit; `--strict` exits non-zero.

What remains is a third, softer sibling that **no static check catches**: a
probe that *passes for a different reason than its comment claims*. Known
instance: `tgtt-arcana-cleric.spec.ts` uses `spellMatchMode: "any"`, which
does not relax the name match but **deletes** it — in `"any"` mode
`e.spell` is never read and only `getKnownSpellsByLevel()[level].length >= 1`
is checked. Those four probes correctly pass `spell: ""` and so are honest,
but a `{spell: "Bane", spellMatchMode: "any"}` would be a probe that cannot
fail. Never reach for `"any"` to soften a flaky name check.

**Correction: that third sibling IS statically checkable, and so was a
fourth.** Calling it "soft" was wrong. `spellMatchMode: "any"` with a
non-empty `spell:` is a mechanical rule, and it is now detector 3 in
`scripts/auditE2eCoverage.mjs`.

Detector 4 came out of the Time Domain Cleric rewrite and is the sharpest
of the family so far, because it is **latent rather than live**.
`assertFeaturesMatrix` resolves a `kind: "resource"` row's pool with
`fc.resourceName ?? (fc.name instanceof RegExp ? fc.name.source : fc.name)`,
and `CharacterSheetPage.getResource()` filters with Playwright's
`hasText: <string>` — a **literal, case-insensitive substring** match. So a
RegExp `name` reaches the lookup as its raw `.source`: `/^channel divinity$/i`
searches for a resource literally named `"^channel divinity$"`. Nothing
rendered contains regex metacharacters, so the lookup always misses and the
row throws `resource not found on sheet`.

Six such rows exist suite-wide (`tgtt-bastion-paladin-bugbear.spec.ts:112`,
`tgtt-horror-warlock-theocracian.spec.ts:53,60,61,62`,
`tgtt-surrealism-bard-yuanti.spec.ts:34`) and **all six sit under a
`skip: true` citing an unrelated product bug** (CS-BUG-017 / CS-BUG-013).
That is what makes them dangerous. They cost nothing today; they detonate
the moment someone lifts the skip — which is exactly what this batch has
been doing — and then present as *"the product bug I just un-skipped is
still broken."* The next author debugs the product instead of the harness.
`tgtt-surrealism-bard-yuanti.spec.ts` even carries a correct,
string-named sibling three lines below the broken one.

Fix shape: **add `resourceName: "<exact name>"`; never widen the regex.**
The regex is the right FEATURE matcher (`/^channel divinity$/i` correctly
excludes "Channel Divinity: Temporal Manipulation"); only the pool lookup
needs its own exact key.

Falsified against a real reproduction, per the standing rule that a guard
which has never seen its own defect proves nothing: reintroducing the shape
into the rewritten Time Domain spec — the version that had *measurably*
thrown `resource not found on sheet` — made the detector fire on all three
rows and label them `(LIVE)`, distinct from the six `(latent)`. Restoring
`resourceName` silenced it.

The generalisation, now with four instances behind it: **a skipped
assertion is not inert, it is armed.** It freezes not only its own claim
about the product but any latent defect in the probe itself, and both stay
invisible because the suite is green.

A fifth instance of the same family was fixed in the shared harness at the
same time. `featureCalculationDerivedFrom` resolves `abilityMod`,
`spellSaveDc` and `spellAttackBonus` through ability-keyed state getters;
omitting `ability` passed `undefined` through, those getters answer `0` for
an unknown ability, and the probe silently became "expected 0" — it could
never pass for the right reason. It now throws on the authoring mistake
instead. (Zero live instances; found by making the error myself.)
---

## CS-BUG-092 — prose that buffs a TARGET was parsed as a buff on the character

**Status:** Fixed.
**Affects:** every feature whose prose grants a condition-gated save advantage to
somebody other than the character. The live victim is Granny's Gifts (Wicked
Witch Sorcerer, *Arcadia* 8 → `TGTT-AR`); the same shape occurs in 5 other places
in the shipped corpus (see the enumeration below).

### Symptom

`FeatureModifierParser` turns *"advantage on saving throws against being
charmed"* into an opt-in conditional modifier on the character. The pattern is
**subject-blind**, so Granny's Gifts —

> …whenever you finish a long rest, you can choose yourself or one creature you
> can see within 30 feet of you. **The target has advantage on saving throws
> against being charmed or frightened**…

— registered a permanent charm/fright advantage on the *witch*, regardless of
whom she actually warded. Measured on `character-sheet-wip` at `911b98ba`, via
`aggregateModifiers("save:wis").conditionalsAvailable`:

| Ward state | Offered to the witch | Correct |
|---|---|---|
| warded nobody | `["against being charmed", "against being frightened"]` | `[]` |
| warded an **ally** | `["against being charmed", "against being frightened"]` | `[]` |
| warded **herself** | `["against being charmed", "against being frightened", "against being charmed", "against being frightened"]` | one row each |

So the ward's only cost — giving the benefit away — was silently refunded, and a
self-ward produced **duplicate** rows in the per-roll conditional picker (once
from `setGrannysWardTarget()`'s real named modifier, once from the prose).

### Root cause

`conditionGatedSaveRe` matches the phrase, not the sentence's subject. The
codebase already had one subject-blindness patch on this very regex — the
`(?<!dis)` lookbehind, which stops *"creatures have **dis**advantage on saving
throws against being frightened by you"* parsing as a self-buff — but nothing
covered a third-party **beneficiary**.

### Fix

A generic guard, `FeatureModifierParser.isThirdPartySaveSubject(plainText,
matchIndex)`, consulted by the condition-gated loop. It bounds the clause at the
previous `.`/`;`/`:`, strips the `you` mentions that qualify *which* creature is
picked rather than naming a beneficiary (`you can see`, `you choose`, `within 30
feet of you`, `of you`…), and suppresses the match only when what remains is a
third-party subject immediately followed by `has`/`have`.

Deliberately conservative in both directions: any surviving `you`/`your` in the
clause disables the guard, and the subject must be the *immediate* subject of the
matched clause, so *"You have advantage … In addition, the target has advantage
…"* keeps the first and drops the second.

### Blast radius — enumerated, not assumed

Run over every `.json` under `data/` and `homebrew/` with `@tags` stripped:
**256** condition-gated matches, of which the guard suppresses exactly **6** —
and all 6 are genuinely third-party:

- `bestiary-mpmm.json`, `bestiary-mtf.json`, `trapshazards.json` — the same wild
  magic table row, *"**The target** grows another head, causing **it** to have
  advantage…"*
- `book-ai.json` ×2 — *"**The creature** has…"* / *"**This creature** has…"*
- `spells-phb.json` — *"For the duration, **the target** has advantage on saving
  throws against being poisoned"* (a spell's target)

Zero self-buffs suppressed. Re-derive with the script shape in this entry rather
than citing the count — the corpus grows.

### Regression pin

`test/jest/charactersheet/CharacterSheetThirdPartySaveProse.test.js` — 20 tests.
Falsified three ways, each break keeping the signature intact:

| Break | Reds | Sample |
|---|---|---|
| `isThirdPartySaveSubject` → always `false` | 10 | `Expected length: 0 / Received array: ["against being charmed", "against being frightened"]` |
| qualifier-stripping `replace`s neutered | 2 | `Expected: true / Received: false` |
| subject regex → `return true` | 3 | `Expected: false / Received: true` |

The third break originally produced **zero** reds: every negative control
short-circuited on the `you` test, so nothing exercised the subject regex on its
own. Three controls with neither a `you` nor a third-party subject
(*"Dwarves have advantage…"*, *"Elves have advantage…"*, *"the wearer gains…"*)
were added to close that hole.

---

## CS-BUG-093 — eleven feature calculations are WRITE-ONLY, and asserting them is not evidence of implementation

**Status:** Open (finding; no product fix attempted here)

Found while raising `tgtt-time-domain-cleric` (24% → 61%) and
`tgtt-daemonologist-wizard-dwarf` (32% → 70%). Both rewrites replaced prose
gap comments with `featureCalculation` probes — and then the probes were
audited against the standing rule that a **correct calculation nothing reads
is the most common defect shape in this codebase**. Eleven of the keys have
exactly one reference in `js/`: their own assignment.

```
$ for k in <key>; do echo "$k -> $(grep -rn "$k" js/ --include=*.js | wc -l)"; done
```

**Wizard** (`charactersheet-state.js`)
`spellbookSpellsKnown` :23306 · `hasRitualAdept` :23317 ·
`hasSpellMastery` :23337 · `hasSignatureSpells` :23342

**Cleric / Time Domain** (`charactersheet-state.js`)
`hasChronologicalInterference` + `chronologicalInterferenceUses` :21682-83 ·
`hasTemporalManipulation` + `temporalManipulationDc` :21691-92 ·
`hasEyesOfFuturePast` + `eyesOfFuturePastUses` :21696-97 ·
`hasTemporalMastery` :21708

Controls that prove the detection is not merely counting rare names:
`potentSpellcastingBonus` 15 refs, `hasPotentSpellcasting` 12,
`channelDivinityUses` 4, `arcaneRecoverySlotLevels` 2
(`charactersheet-rest.js:193`), `rightOnTimeBonus` 3.

### The important distinction — write-only ≠ inert

These are **not** all "renders but does nothing". Chronological Interference
and Eyes of the Future Past **do** surface as working pools with correct
maxima (measured: 2/3/4/6/6 and `max(1, wisMod)`), because the generic
feature-uses parser reads the homebrew entry, never the calc key. So for
those the calc key is **redundant dead data** beside a working feature.

For the four Wizard keys no such alternative surface was found; Spell
Mastery ("cast 1st/2nd level at will"), Signature Spells and Ritual Adept
have no pool and no observed consumer. Those are the candidates for
genuinely-displayed-but-unimplemented, and they are the ones worth a product
decision.

### Why this matters beyond tidiness

The batch bar is *offered, shown, **and** mechanically implemented*. A
`featureCalculation` probe that passes against a write-only key satisfies
none of the third clause — it proves the calculation RAN, not that anything
depends on it. It is the calc-only anti-pattern arriving in the very sweep
that exists to remove predetermined-outcome probes, which is exactly why the
rule is "pin the READING, never `getFeatureCalculations()`" — and why a
`stateCall` is not a reading either, only one more accessor.

The two rewritten specs are annotated so a green run cannot be misread as
proof of implementation. Where a real reading exists it is pinned instead:
Channel Divinity / Chronological Interference use `kind: "resource"` (which
reads the rendered sheet), Eyes of the Future Past uses
`featureUsesEqualAbilityMod`, Unearthly Countenance uses `toggleGrantsSpeed`
(`getSpeed`) — the grant that was itself dead until CS-BUG-085.

**Detection is mechanical and worth automating:** any `calculations.<key> =`
whose key appears exactly once across `js/` is write-only by construction.

### Follow-up — the blanker is now pinned, not trusted

`scripts/auditE2eCoverage.mjs` self-checks its own comment blanker. Every
detector in that script reads `blankComments(src)`, so a desynchronised
blanker corrupts all of them simultaneously — and in the direction that is
hardest to notice: comment prose **leaks into the code view and manufactures
false positives**, rather than losing real code.

The blanker had already shipped two bugs (it did not recognise regex
literals, so an apostrophe in `/gambler's folly/i` opened a phantom string
that swallowed the remainder of the file's comments). Both ran clean before
and after the fix; only a deliberately planted instance separated them.

Invariant: after blanking, no `//` may survive outside a string literal.
Measured both directions rather than assumed —

| blanker | leaks |
|---|---|
| shipped | **0** across all 54 specs |
| regex branch disabled | **274** across 14 specs |

`--strict` now exits 1 on any leak.

Two negative results worth not re-deriving:

- Quoted `//` is legitimate and is excluded. `spawn.spec.ts` writes
  `"rogue//1/halfling"` for an empty subclass slot; the naive form of this
  invariant has three standing false positives for that reason.
- **The first invariant I wrote could never fire.** It asserted that real
  `kind:` tokens survive blanking — but a phantom string makes the scanner
  *skip* text rather than blank it, so the failure direction is leakage, not
  loss. It ran green against a deliberately broken blanker. Recorded so
  nobody rebuilds the version that cannot fail.

The blast radius of the original bug is **13 specs** measured behaviourally
(fixed and broken blankers disagree), not the 7 found by pattern-matching
apostrophes-in-regexes nor the 17 matched by a looser grep — that looser
pattern also matches `//` comment openings, which are not instances.
