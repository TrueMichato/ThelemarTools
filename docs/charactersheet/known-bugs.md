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

### CS-BUG-106 — Otherworldly Wings renders with no toggle, so its fly speed can never be turned on

**Status**: Open (not fixed here — found during the CS-BUG-016 sweep).

**Note on the id**: filed as CS-BUG-104 and renumbered to 106 on merge. The
reserved block 103–107 was handed to this session, but 103 and 104 had already
been claimed on `character-sheet-wip` by two other sessions (the Features-tab
"Use" bug and the `Blessed Strikes` materialisation bug). Numbers are allocated
out-of-band, so a reservation is a claim, not a lock — check
`grep -oE '^#+ CS-BUG-[0-9]+' docs/charactersheet/known-bugs.md` against the
**merged** base before writing an id into a spec.

**Surfaced by**: `test/e2e/specs/tgtt-hexblade-divine-soul-tortle.spec.ts`,
matrix row `{level: 16, name: /otherworldly wings/i, kind: "toggle"}`, which
failed with `feature has no toggle button (expected toggleable)`. The row had
**never executed before** — the spec aborted at its L2 checkpoint on an
unrelated stale claim, so this is a first-ever run, not a regression.

**Evidence**: the feature is present and correct in the export —

```
{"name":"Otherworldly Wings","className":"Sorcerer","subclassName":"Divine Soul",
 "source":"XGE","level":14,
 "entries":["Starting at 14th level, you can use a bonus action to manifest a pair
   of spectral wings from your back. While the wings are present, you have a
   flying speed of 30 feet. The wings last until you're incapacitated, you die,
   or you dismiss them as a bonus action.", …]}
```

A bonus-action, dismissible, fly-speed-granting feature is textbook
activatable, and the codebase already models exactly this shape as a curated
active state elsewhere. Re-derive the current set of fly-speed emitters before
relying on any count:

```
git grep -n 'target: "speed:' -- js/charactersheet/   # discard the speed:walk hits
```

Otherworldly Wings is simply absent from that set, so nothing gives it an
activation surface and the 30 ft fly speed is unreachable in play.

**Fix**: add a curated active state for Otherworldly Wings emitting
`{type: "bonus", target: "speed:fly", value: 30}`, matching the existing
fly-speed states. Then flip the spec row back from `kind: "passive"` to
`kind: "toggle"`.

---

### CS-BUG-105 — Class-level always-prepared spells never reach a character built in the wizard

**Status**: Open. Product bug, **not fixed here** — surfaced by a harness
sweep (CS-BUG-016) and filed rather than patched.

**Note on the id**: filed as CS-BUG-103 and renumbered to 105 on merge — 103
was already claimed on `character-sheet-wip`. See the note under CS-BUG-106.

**Symptom**: A character created through the builder wizard never receives
the always-prepared spells declared on the base CLASS object's
`additionalSpells`. Measured on the E2E export artifacts:

| Class | Declared grant | Present after wizard build? |
|---|---|---|
| Cleric (TGTT) | `prepared {"1": ["thaumaturgy\|xphb", "ceremony\|xphb"]}` | **No** — absent at L1, L3 and L5 |
| Paladin (TGTT) | `prepared {"2": ["divine smite\|xphb"], "5": ["find steed\|xphb"]}` | **No** — absent at L3 |
| Ranger (TGTT) | `prepared {"1": ["hunter's mark\|xphb"]}` | **No** (the E2E green was the preset's `signatureSpells` picking it by hand) |

Subclass grants are unaffected — the Oath of Bastion paladin does receive
Shield of Faith / Sanctuary — which is what makes the gap easy to miss.

**Root cause**: `populateClassSpells()` is catalog-gated and no-ops until
`setClassCatalog()` has run. There is exactly one call site:

```
$ git grep -n 'setClassCatalog' -- js/
js/charactersheet/charactersheet-state.js:14648:  (doc comment)
js/charactersheet/charactersheet-state.js:14767:  (doc comment)
js/charactersheet/charactersheet-state.js:26718:  (doc comment)
js/charactersheet/charactersheet-state.js:37054:  (doc comment)
js/charactersheet/charactersheet-state.js:37058:  setClassCatalog (classes) {
js/charactersheet/charactersheet.js:17405:    this._state.setClassCatalog(this._classes || []);
```

…and that line lives in `_reconcileClassFeatures()`, whose only callers are
load-shaped:

```
$ git grep -n '_reconcileClassFeatures' -- js/
js/charactersheet/charactersheet.js:1525:   _pLoadCharacter        (load from storage)
js/charactersheet/charactersheet.js:1846:   _onDuplicateCharacter
js/charactersheet/charactersheet.js:1869:   addCharacter           (only caller: charactersheet-export.js:259, import)
js/charactersheet/charactersheet.js:2797:   _onImportCharacter
js/charactersheet/charactersheet.js:17387:  _reconcileClassFeatures ()
```

The builder-wizard finish path is not among them, so a freshly built
character has no class catalog. Level-up does re-run
`applyClassFeatureEffects()` (`charactersheet-levelup.js:5205`), but
`populateClassSpells()` inside it early-returns on the missing catalog —
so the grant never lands at any level either.

**Why the existing tests are green**: the state-level mechanism is
correct and well covered by
`test/jest/charactersheet/CharacterSheetClassAlwaysPreparedSpells.test.js`,
which calls `setClassCatalog()` itself. Verified independently with a
throwaway Jest probe: with the catalog set, Divine Smite lands at Paladin 3
and is correctly absent at Paladin 1. This is a *correct calculation that
nothing invokes* — the tests assert the mechanism, not the wiring.

**Player impact**: every freshly built TGTT Cleric silently lacks Ceremony
and Thaumaturgy; every TGTT Paladin lacks Divine Smite and Find Steed;
every TGTT Ranger lacks Hunter's Mark. Saving and reloading the character
repairs it (the load path sets the catalog and the reconcile is
idempotent), which makes the bug look intermittent.

**Suggested fix**: call `_reconcileClassFeatures()` (or at minimum
`setClassCatalog()` + `applyClassFeatureEffects()`) on the builder-wizard
finish path and after level-up, not only on load/import/duplicate.

**Blocked assertion**: `tgtt-bastion-paladin-bugbear.spec.ts` L2
`{kind: "spellInList", spell: "Divine Smite"}` is skipped with this id.

---

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

### CS-BUG-108 — The level-up "Swap a Known Spell" list was empty for every known caster

**Status**: Fixed.
**Surfaced by**: reading `charactersheet-levelup.js:4218` while checking an
unrelated set-enumeration claim about granted-spell handling.

**Symptom.** Every Bard, Ranger, Sorcerer and Warlock, at every level from 2 to
20, opened the optional "🔄 Swap Spell" accordion and was told **"No swappable
spells known."** The PHB allowance to trade one known spell on level-up was
entirely dead. Nothing errored, nothing was logged, and no test was red — the
feature rendered its own empty-state message and returned.

**Root cause — a comment and its code disagreeing.**

```js
// Get current known spells (level 1+, not feature-granted)
.filter(s => s.level > 0 && !s.alwaysPrepared && !s.sourceFeature);
```

The comment says *not feature-granted*. The code says *has no attribution at
all*. Those are different sets, and the codebase populates the difference: the
Builder, QuickBuild and LevelUp all stamp a **positive** attribution onto every
spell the player picks — `"Spells Known"`, `"Cantrips Known"`, `"Wizard
Spellbook"`, `"Prepared Spells"` — at 15 assignment sites across four modules. So
`!s.sourceFeature` rejected precisely the set the picker exists to offer and
admitted only orphans, which a normally-built character has none of.

Measured at the production call site (`getSpellsKnown()` on a level-4 Sorcerer
holding two spells learned exactly the way LevelUp writes them):

| | result |
|---|---|
| `getSpellsKnown()` | `Magic Missile (sf: "Spells Known")`, `Shield (sf: "Spells Known")` |
| old filter `!s.sourceFeature` | `[]` |
| fixed predicate | `["Magic Missile", "Shield"]` |

**Fix.** The distinction already had a canonical predicate one file away —
`CharacterSheetClassUtils.isPlayerChosenSpell`, whose docstring states exactly
the intended semantics. Rather than inline a second expression of the same rule,
the whole candidate test moved onto a named sibling,
`CharacterSheetClassUtils.isSwappableKnownSpell(spell)`, and the level-up filter
became a single call to it. Orphans stay swappable so pre-attribution saves don't
regress; `alwaysPrepared` and feature attributions stay excluded.

**Not a regression, and not adjacent to the level-up swap by accident.** Divine
Soul's affinity spell has its own dedicated swap on the Spells tab
(`_pSwapDivineSoulAffinity`), restricted to the Cleric list at the grant's level.
The two swap surfaces are deliberately disjoint, and this fix preserves that: a
subclass grant is still withheld from the level-up list.

**Falsification** — four breaks, signature intact each time:

| break | reds | sample |
|---|---|---|
| predicate reverted to `return !spell.sourceFeature` | **7** | `Expected: > 0 / Received: 0` |
| over-corrected to `return true` (admit grants) | **2** | subclass + racial grants leak in |
| `alwaysPrepared` guard removed | **1** | assertion |
| `level > 0` guard removed | **1** | `Expected: false / Received: true` |

The `level > 0` break initially produced **ZERO** reds. The cantrip test drove
`addSpell`, and state routes cantrips to `cantripsKnown` — so `getSpellsKnown()`
never yields one and the guard was unreachable from that test. It was passing on
routing, not on the guard. Rewritten to assert the predicate directly, with the
routing pinned as its own separate test so that if routing ever changes, the
guard is known to be the only thing left holding. Same shape as the zero-red
finding in CS-BUG-092: **a break that yields no reds usually means the tests stop
short of the logic, not that the logic is dead.**

**Pinned by**: `test/jest/charactersheet/CharacterSheetSpellSwapCandidates.test.js`
(19 tests) — the **predicate**; and
`test/jest/charactersheet/CharacterSheetSpellSwapRender.test.js` (3 tests) —
the **call site**.

**Why two pins.** The candidates file re-derives the filter locally
(`spells.filter(s => ClassUtils.isSwappableKnownSpell(s))`) and asserts its
coupling to `_renderSpellSwapSection` only in a comment. Measured: restoring the
original `!s.sourceFeature` **at the call site** — i.e. reintroducing this exact
bug — leaves all **19 green**, because the predicate it tests is still correct.
The render pin drives the production method and reads what it wrote, so the same
break fails **2 of 3** with the user-visible string:

```
Expected substring: not "No swappable spells known."
Received string:        "<p class=\"ve-muted ve-small\">No swappable spells known.</p>"
```

Breaking the predicate instead also reds it (2 of 3), so the two pins overlap on
the helper and only the render pin covers the wiring. Same shape as CS-BUG-102,
where the state API was fixed and the renderer kept its own copy: **a helper
extracted to fix a call-site bug leaves the call site itself unpinned unless
something drives it.**

**Note on E2E**: no Playwright spec exercises the swap accordion — a grep for
`charsheet__levelup-spell-swap` / `charsheet__spell-swap-btn` across
`test/e2e/**` returns nothing. That absence is why a dead core allowance
survived: the feature renders its own empty state, so there is no error, no log
and nothing red. The render pin above is a Jest-level substitute, not a
replacement for a real level-up UI probe.

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

**Status**: **Closed — disproved and its skips retired (CS-BUG-016 sweep).**
Confirmed independently at L1, not just L5: a freshly-built L1 Horror
Warlock export carries `spellcasting.pactSlots = {current: 1, max: 1,
level: 1}`. Pact magic is wired correctly and always was at the levels
this entry covered.

Two consequences were cleaned up while retiring this entry:

1. The four `kind: "resource"` matrix rows in
   `tgtt-horror-warlock-theocracian.spec.ts` that looked for a
   resource-tracker pool named "Pact Magic" were **unsatisfiable
   regardless of this bug** — pact slots are modelled as spell slots
   (`spellcasting.pactSlots`), so no such pool is ever created. Measured
   pool list on that sheet at L1/L2 is `[Magical Cunning, Devastating
   Strike]`. Same shape as the mercy-monk spec asserting a
   Debilitation-only feature. Retired; the claim moved to
   `milestones[*].pactSlots`, which probes the surface that exists.
2. The `pactSlots` milestone assertions this entry had caused to be
   dropped are **restored** at L1/3/5/11/17/20 and pass.

**Related harness defect found while closing this** (fixed, not a product
bug): `CharacterSheetPage.getPactSlots()` scraped
`.charsheet__pact-slots`, `.charsheet__slot-current`,
`.charsheet__slot-max` and `.charsheet__pact-level` — **none of which
exists anywhere in `js/`** (`grep -rl 'charsheet__pact-slots' js/` →
no matches). The reader could therefore never succeed, and reported
`level 0`, which is what made pact slots *look* unregistered. It now
reads `_state.getPactSlots()` (`charactersheet-state.js:13763`). This is
the same "probe that cannot pass for a legitimate product state" class as
CS-BUG-016 itself.

Builder-side issue at the Spells step remains tracked separately as
**CS-BUG-024**. Re-file a new entry if a regression surfaces.

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
companion carrying its type structurally rather than inline. A
*cannot-PASS* defect living in the **shared harness**, latent for every
future author. It was reachable only through the inert-window fix.

> **⚠️ The fix adds `damageType` ONLY. Do not "complete" it by adding
> `description`.** An earlier phrasing here — *"the field is `description`,
> not `desc`"* — read as though `description` were the intended replacement.
> It is not, and adding it reintroduces the defect class this fix removes:
> `description` is **prose** fed to a `contains` matcher, so
> `damageContains: "fire"` would be satisfied by a description reading *"the
> target catches fire"* — a probe passing for the wrong reason. The exclusion
> is a judgement, not an oversight, and is argued in the comment above
> `comprehensiveBuildHelpers.ts`'s `const flat = …`.
>
> `desc` is retained but **dead**: `grep -cE '\bdesc:' js/charactersheet/charactersheet-state.js`
> → **0**, versus **254** for `description:`. It is harmless only for that
> reason; if a future companion shape starts populating `desc` with prose it
> becomes the same hazard and should be dropped too.

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

> **⚠️ Correction — the mechanism described above no longer exists. Do not
> repair a row by reasoning from it.** The `.source` flattening was removed
> in `b018a512` (merged). `assertFeaturesMatrix` now resolves a RegExp
> `name` against the pool names actually on the sheet
> (`CharacterSheetPage.getResourceNames()`) and **throws** when it matches
> zero pools or more than one. So an anchored pattern such as
> `/^channel divinity$/i` resolves correctly today; it is no longer
> unmatchable, and it no longer *needs* a `resourceName` pin.
>
> What still stands: `resourceName` remains the correct pin for **genuine
> ambiguity** (one pattern, two distinctly-named pools), and "never widen
> the regex" is unchanged — widening trades a probe that cannot pass for
> one that passes for the wrong reason.
>
> **What that fix deliberately does NOT do:** it does not make the
> enumeration authoritative on its own. A resolver is only as good as the
> surfaces its name list covers, and `getResourceNames()` originally
> scraped **one** of the **three** surfaces `getResource()` reads (it falls
> back to `_getCombatTabResource`, which probes
> `.charsheet__combat-resource-item` and `.cs-combat-feature`/
> `.cs-combat-pool`). Combat-tab-only pools — Indomitable, Action Surge —
> therefore resolved to "matched none" although the getter would have found
> them, throwing a genuine `featuresMatrix at L11` on
> `tgtt-arcane-archer-fighter-hochling`. Closed in `03c60308`, together
> with two defects behind it: combat-panel titles wrap the action caption
> and the "2 / 2 remaining" line in the same node (take the first line),
> and the same pool renders under two labels — `Second Wind` on the tracker
> vs `💗Second Wind` on the combat panel — so exact-string dedupe reports
> **false ambiguity** (group by a decoration-stripped key).
>
> The rule worth keeping: **a name-enumerating reader and the getter it
> feeds must cover the same surfaces.** Splitting "which names exist" from
> "fetch this name" across different selector sets is a silent-mismatch
> generator.
>
> Note also that detector 4's own doc comment in
> `scripts/auditE2eCoverage.mjs` still describes the pre-`b018a512`
> resolution logic. Left as-is here rather than edited, since that file is
> owned elsewhere — but its rationale is stale even though it currently
> reports zero rows.

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

### Follow-up — traced to the wiring, and the count is TWELVE

The four Wizard keys were traced rather than left as "candidates". The
result splits them, and corrects two plausible-sounding wiring targets that
would send an implementer to the wrong surface.

**`hasRitualAdept` — NOT a gap.** Ritual Adept is implemented, via
`ritualCastingMode = "spellbook"` (`charactersheet-state.js:23368`, 5 refs),
set on the line immediately above the `hasRitualAdept` comment. The calc key
is the redundant twin, exactly as with the Time Domain pools.

**`hasSignatureSpells` — a genuine missing wire, and the target exists.**
`getNoSlotCastResourcesForSpell()` (`:34407`) is a generic, data-driven
no-slot cast path already wired into the cast menu
(`charactersheet-spells.js:2322` → `castOptions`). Signature Spells fits its
descriptor shape exactly: named spells, limited charges, long-rest recharge.

**`hasSpellMastery` — a gap, and `noSlotCasts` CANNOT express it as written.**
The descriptor requires a backing resource with charges — `getResource(...)`
then `if ((resource.current || 0) <= 0) continue`. Spell Mastery is
*unlimited*, so it has no resource to gate on. It needs an unlimited sentinel
or a separate branch; it is not a drop-in.

**`spell.atWill` is the WRONG target for either.** It is tempting — there is
a working "At Will" badge and a suppressed cast button — but that code lives
in `_renderInnateSpellItem` (`charactersheet-spells.js:7347`, `:7374`,
`:7424`), i.e. the INNATE spell list. Spell Mastery and Signature Spells act
on *prepared spellbook* spells. Routing them through `atWill` would surface
duplicates in the innate section while the prepared copy still spends a slot.

**`spellbookSpellsKnown`** — no enforcement and no display found; the cap is
advisory only.

**Twelfth key, found while checking the above:** `lunarFreeCastCount`
(`:20763`) also has exactly 1 ref. And it is another write-only-but-working
case — Lunar free-casting runs through an entirely separate path
(`getLunarFreeCastOptions()` `:56387`, `_data.lunarFreeCastsUsed`, and the
`charsheet__lunar-cast` button in `charactersheet-combat.js:5263`). So it
must NOT be cited as machinery to wire Signature Spells into; it is a
symptom, not a half-built feature.

**Player-facing consequence:** a level-18 wizard casting a 1st-level spell
still spends a slot, and a level-20 wizard has no free Signature Spell cast.
That is a base-Wizard rules violation, not a subclass edge case, so it
affects every wizard build in the suite.

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
| regex branch disabled | **274** across 13 specs |

`--strict` counts leaks among its exit conditions — but note it does **not**
discriminate on this axis today: `warnings` (8 LOW specs) and `totalUnmatch`
(6 unmatched resource rows) already trip the same gate, so `--strict` exits 1
on the shipped tree as well as the broken one. The **leak count** is the
measurement that separates them; the exit code is not. Verified rather than
inferred from the wiring:

```
shipped  --strict → exit 1
broken   --strict → exit 1
```

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

### Follow-up — SCALE CORRECTION: "eleven" understates this by an order of magnitude

The heading above says eleven because eleven is what a hand audit of *two
specs* found. Building the detector measured the real population, and the
number is the most important thing in this entry:

| population | count |
|---|---|
| calc keys assigned (`calculations.<key> =`) across `js/` | **2114** |
| of those, never read by any static reference | **1504** (71%) |
| calc keys the E2E specs actually probe | **239** |
| **spec-probed keys that are write-only** | **93, across 16 specs** |

So this is not a two-spec defect. It is the dominant idiom of the suite's
`featureCalculation` probes, and it reaches 16 of 41 specs including
`tgtt-lunar-sorcery-sorcerer` (20), `tgtt-talent-chronopath` (16) and
`tgtt-arcana-cleric` (8).

**Do not read that as "1504 unimplemented features."** Two reasons, both
measured:

1. **Write-only ≠ inert** (the distinction the original entry drew, now
   load-bearing at scale). `layOnHandsPool` is write-only, and Lay on Hands
   demonstrably works — via its own pool UI, not the calc key. Same shape for
   Chronological Interference and Eyes of the Future Past, which work through
   the generic feature-uses parser reading the homebrew entry.
2. **A static reference count cannot see how this product reads calc keys.**
   `charactersheet.js:8831-8837` builds the key from the feature's *display
   name* at runtime — `calc[`${key}Dc`]`, `${key}Damage`, `${key}SaveAbility`,
   `${key}DamagePerStrain`, `${key}DamageType`, `${key}Duration`. So "Decay"
   reads `decayDc`, `decayDamageType`, `decaySaveAbility`… every one of which
   a naive count calls write-only. There are two further dynamic paths:
   `calculations[entry.calcFlag] = true` via the invocation registry
   (`:57849`), and `getFeatureCalculation(key)` — a public getter by arbitrary
   string, which in practice has exactly **one** caller passing the literal
   `"rageDamage"`.

What the finding *does* support, for all 93, is the narrower and always-true
claim: **that probe is not watching the surface that would break.** It pins a
value the product computes and discards, so it cannot fail when the feature's
real path regresses — the same predetermined-outcome property as an inert
level window, reached from the product side instead of the harness side.

### Follow-up — detector shipped, and falsified before shipping

`scripts/auditE2eCoverage.mjs` now reports write-only calc probes. Design
notes that are consequences of measurement, not taste:

- **Scoped to spec-probed keys.** Reporting all 1504 would be worse than
  useless; noise is how a correct check gets switched off.
- **Dynamic suffixes are discovered from source, not hardcoded**, and matching
  keys are listed *separately* as candidates rather than silently dropped —
  over-subtraction is also a way to be wrong. 13 keys land there.
- **Never wired to `--strict`.** Reference counting cannot see data-driven
  reads, so a gate here would be permanently red and therefore ignored.
- **Scans `js/` only, never `docs/`.** This file and several spec comments now
  quote these key names verbatim.

Falsified on the shipped script with four planted controls in one run:

| planted | expected | result |
|---|---|---|
| `zzPlantedWriteOnly` — assigned, probed, no reader | detected | **detected** ✅ |
| `zzPlantedHasReader` — same, plus one `calc.zzPlantedHasReader` read | silent | silent ✅ |
| `zzPlantedDynamicDc` — ends in a discovered dynamic suffix | candidate, not counted | candidate ✅ |
| a **real** write-only key named only inside `//` and `/* */` comments | silent | silent ✅ |

The fourth is the one that mattered, and the first version of it was **weak**:
it named a key that was never assigned, so the `assigned.has(key)` guard would
have filtered it no matter what the comment blanking did — testing the guard's
front door rather than its decision. Rewritten to name a genuinely write-only
key, then falsified by making `probedCalcKeys` read raw source instead of
blanked: **94 → 96 probes across 17 → 18 specs**, with both comment-only
references flagged. That is detector #3's failure mode (a check firing on its
own documentation) caught *before* shipping rather than after.

---

## CS-BUG-095 — a "restore" cost in prose was parsed as an activation cost, permanently disabling the toggle

**Status:** Fixed.
**Affects:** Crown of Spellfire (Spellfire Sorcery 18, *Forgotten Realms:
Heroes of the Feywild* → `FRHoF`; `classSource: "XPHB"`). No other feature in
the shipped corpus pairs a numeric Sorcery-Point *restore* cost with a toggle
that rides another feature's uses, so this victim is currently unique — but the
mis-parse is generic and any similarly-worded feature would inherit it.

### Symptom

Crown of Spellfire is a **free** "alter your Innate Sorcery" toggle: activating
it costs nothing (it rides an existing Innate Sorcery use). Its prose only
mentions Sorcery Points to describe *restoring* a spent use —

> …you can't use it again until you finish a Long Rest unless you spend 5
> Sorcery Points (no action required) to restore your use of it…

The generic `detectActivatableFeature` read *"spend 5 Sorcery Points"* as the
**activation** cost, and the `.includes("sorcery")` resource matcher bound it to
the 2-use **Innate Sorcery** pool. The Activate button is disabled whenever its
linked resource is short (`charactersheet.js`, the `2 < 5` guard), so the Crown
row rendered **permanently disabled** — `isVisible() === true` but never
actionable. The E2E toggle `.click()` timed out on a visible-but-dead control,
which reads exactly like a flaky UI wait rather than a mis-parse.

### Fix

An explicit early return in `detectActivatableFeature`
(`charactersheet-state.js`), placed just after the psionic check and mirroring
the existing bespoke returns, that yields a clean **zero-cost** `crownOfSpellfire`
toggle. It is name-guarded to `"crown of spellfire"` on a Spellfire/`FRHoF`
character, so no other feature can reach it. With `resourceCost: 0` and no linked
resource, the Activate button is enabled and the toggle behaves as designed
(60-ft Fly + hover, Spell Avoidance, once-per-turn Burning Life Force).

### Why the regression pins the READING — and what "the reading" actually is

The load-bearing, render-consumed surface is **which resource
`getActivatableFeatures()` binds to the Crown row**, because that is the field
`charactersheet.js` charges the Activate button against:

- **broken** → the row binds the shared **Sorcery-Point / Innate-Sorcery spend
  pool** (`matchedBy: "name"`, `sorceryPointCost: 5`; in the field, a 2-use
  Innate Sorcery pool → the `2 < 5` disable);
- **fixed** → the row binds *at most* Crown's **own 1/Long-Rest use pool**
  (`"Crown of Spellfire"`, `current 1 ≥ cost 1`), so the button stays live.

**Correction (measured after review).** An earlier draft of this test asserted
`crownRow.resource == null`, and an earlier draft of the fixture *paraphrased
away* the "spend 5 Sorcery Points" clause. Both were wrong, and they masked each
other: with the trigger prose removed the mis-parse had nothing to bite, so the
row was `null` in **both** worlds and the assertion never discriminated (green
under a neutralised guard). Two facts only surfaced once the fixture carried the
**verbatim** published prose:

1. The real prose legitimately mints a `feature.uses` **1/Long-Rest** pool, so
   the *correct* fixed row carries a resource — it is **not** `null`. `resource
   == null` was therefore never the right assertion.
2. The discriminator is the **name** of the bound pool, not its presence. The
   regression now asserts `resource.name` is **not** Sorcery-flavoured (and, if
   present, is Crown's own pool), and asserts it **first**, so a leading accessor
   failure can never mask it (the lesson from this review round: *"a revert makes
   it red" is necessary but not sufficient — which assertion went red matters*).

The `getFeatureCalculations()` / `stateCall` accessors below the row assertion
are corroboration only. And the **field pin** — the probe that found the bug in
the first place and cannot be fooled by a fixture — is the E2E `featuresMatrix`
L18 row (`kind: "toggle"`), which `.click()`s the **real rendered** Activate
button against the **real brew prose**; it passes 8/8.

### Falsification

Neutralising the early-return's guard condition **in place** (`if (false &&
name === …`, signature kept, generic mis-parse restored) turned the regression
**red: 1 failure**, and the first assertion to fail is the render-consumed
row-binding one — `test/…/CharacterSheetSpellfireSorcerer.test.js:276`,
`expect(/sorcer/i.test(boundName)).toBe(false)` → **`Expected false, Received
true`** (the broken row binds `"Sorcery Points"`). A genuine wrong-value catch on
the reading the renderer consumes, not a `TypeError`/`ReferenceError`, and not an
accessor. Restored, it is green (27/27). The eight Spellfire methods carry their
own seven in-place chokepoint falsifications (signatures kept: 3/2/1/1/1/1/1
red).

### Correction to the record: commit `f03737f7`'s message is wrong

An earlier attempt at this fix (`f03737f7`, superseded by `fae134bb`) changed the
fixture only — **1 line, 0 assertions** — and kept `resource == null`. Its commit
message reports that a fixture carrying the published *"until you finish a Long
Rest"* clause **"independently created a 1/long-rest uses pool and failed the row
assertion with the fix in place — a fixture artefact that mimics a product
regression."**

**That characterisation is backwards, and the message is in pushed history where
`git log -- <this file>` will surface it as guidance.** The 1/Long-Rest pool is
not an artefact: it is what the real published prose legitimately mints, and the
failure it produced was the *correct* signal that `resource == null` was the
wrong expectation. The response was to delete the true clause from the fixture so
the wrong assertion stayed green — i.e. the data was bent to fit the assertion.

> Generalised: when repairing a fixture makes an assertion go red, the first
> hypothesis must be **"the assertion was always wrong"**, not "the fixture is
> lying". A fixture that props up a wrong expectation *survives* fixture repair
> by presenting the repair as a regression, which is strictly more dangerous than
> one that merely keeps a pin inert.

---

## CS-BUG-104 — a *resolved* `Blessed Strikes` choice still materialises both options, contradicting the parser's own `count: 1` — and a TGTT domain turns that into a visible duplicate

**Status:** **Fixed for newly-derived characters; NOT retroactive.** The
materialisation site now defers to the parser's verdict instead of re-deriving
one from the entry shape. Pinned in both directions by
`test/jest/charactersheet/CharacterSheetSubfeatureChoiceMaterialisation.test.js`.
**A character saved before `8839135c` keeps the duplicate rows forever** —
`loadFromJson` never re-derives features from class data. See **CS-BUG-110**.

> **The parser was never the defect.** `FeatureChoiceParser.extractChoices()`
> returned `{count: 1, options: [Divine Strike, Potent Spellcasting]}` for
> Blessed Strikes throughout — correctly. Do not go looking in
> `_extractStructuredChoices` for the grant; the grant was emitted by
> `CharacterSheetClassUtils.getLevelFeatures`, which read the same entry shape
> with a different rule. See "Fix as landed" for the enumerated population.

**Root cause (measured at three stages; this entry's cause was relocated twice
before reaching this one, and amended once after — see Provenance).**
`Blessed Strikes` (Cleric XPHB L7) is a choose-one
feature. The choice is extracted correctly, then materialised incorrectly — and
the pick record silently inherits that error rather than contradicting it (see
the 2026-08-02 correction below). Measured on `cleric/life domain/7`:

| stage | reading | verdict |
|---|---|---|
| extraction | `FeatureChoiceParser.extractChoices()` → `count: 1`, 2 options | **correct** |
| pick record | `_data.chosenSubfeatures` → **both** options recorded | **WRONG** (see correction) |
| materialisation | `_data.features` → **both** options, each `parentFeature: "Blessed Strikes"` | **WRONG** |

```
_data.features on cleric/life domain/7:
    Divine Order         L1  parent=null
    Protector            L1  parent=Divine Order          ← one option, correct
    Blessed Strikes      L7  parent=null
    Divine Strike        L7  parent=Blessed Strikes   ┐
    Potent Spellcasting  L7  parent=Blessed Strikes   ┘ ← BOTH, only one was chosen

_data.chosenSubfeatures: [… {parent: "Blessed Strikes", name: "Divine Strike"} …]
```

##### 🔴 Correction (2026-08-02) — the `pick record` row above was wrong, and so was the paragraph under it

The row originally read:

> | pick record | `_data.chosenSubfeatures` → `Blessed Strikes → Divine Strike` (one) | **correct** |

and was followed by:

> **The bug is self-evidencing**: one state object holds both the correct record
> (one pick) and the incorrect materialisation (two rows). No comparison against
> the rules is needed to see the inconsistency.

Both are **refuted by measurement on the true pre-fix tree**. `c188b94b`'s fix is
two coupled edits, so "pre-fix" must be materialised as the actual parent commit —
reverting one edit yields a hybrid tree matching no commit that has ever existed:

```
git rev-parse c188b94b^                              -> f86af94e
git checkout f86af94e -- js/charactersheet/charactersheet-class-utils.js \
                         js/charactersheet/charactersheet-state.js
grep -c 'choiceOptionNames' js/charactersheet/charactersheet-class-utils.js   -> 0   (fix absent)
```

On that tree, on the very build this entry names, `_data.chosenSubfeatures` holds
**two** entries, not one:

```
cleric/life domain/7   (spawner)
  option rows        : ["Divine Strike@L7", "Potent Spellcasting@L7"]
  chosenSubfeatures  : ["Blessed Strikes@L7->Divine Strike",
                        "Blessed Strikes@L7->Potent Spellcasting"]
```

The same reading was obtained independently on a **wizard**-built Cleric 7. So this
is not spawner-vs-wizard path dependence — the row is wrong on both paths, including
its own cited one.

**How the error survived: the ellipsis.** The dump above is elided on both sides —
`[… {parent: "Blessed Strikes", name: "Divine Strike"} …]` — and the second entry was
inside one of those ellipses. The table row is an *interpretation* of an elided dump,
and the dump as printed is equally compatible with the correct reading. A quoted
excerpt that elides the part which would refute it reads exactly like a quoted excerpt
that does not.

**The consequence is the load-bearing half.** Recording inherits from materialisation:
`seedSubclassFeatureChoices` branch (b) records a chosen subfeature for *every*
materialised row. So the pre-fix state is **2 rows vs 2 records — internally
consistent**. The "self-evidencing" claim is therefore backwards: the state object
contains no inconsistency to notice, and the only thing that identifies two as wrong
is the parser's own `count: 1` (equivalently, the rules text). The bug is
**exactly not** self-evidencing, which is why it shipped.

**The entry's conclusion is unaffected.** Extraction is still exonerated,
materialisation is still the sole defect, and the fix in `c188b94b` is still correct
and correctly targeted — this corrects the evidence for it, not the verdict. It is
the third piece of evidence in this entry not to survive scrutiny (after the circular
Cunning Strike counts and the malformed open question), while the conclusion has
survived all three. Found by the `plan-cs-bug-018-skips` session, which retracted its
own supporting measurement to get here.

The duplicate you actually notice comes later — a TGTT domain grants its own
same-named feature at L8, so the name now appears twice on the Features tab.
The official text names this exact interaction: *"if you get either option from
a Cleric subclass in an older book, use only the option you choose for this
feature."*

**Not the parser.** `_extractStructuredChoices` (`charactersheet-state.js:790`)
documents two encodings and names Blessed Strikes explicitly as the second
(*"a bare `{type:"entries", entries:[refClassFeature, refClassFeature]}` block
… no `options` wrapper"*). It handles it correctly. A reader sent to
`FeatureChoiceParser` will find working code.

**The defect is a reader/writer drift between the parser and the grant site.**
`charactersheet-class-utils.js:3386-3412` extracts `refClassFeature` sub-entries
as *automatic grants* — the loop exists for Ki / Monk's Focus, where every ref
genuinely is granted — and guards against player choices with a single test:

```js
// :3379  IMPORTANT: Skip "options" type entries — those are player choices …
if (entry.type === "options") continue;              // :3391 — the whole guard
…
extracted.push({name: refName, …, parentFeature: feature.name});   // :3401
```

> **Line numbers here were re-derived on 2026-08-02 and WILL drift again.** The
> previous set was stale by **+61 to +68** — *not a constant offset*, so they
> cannot be repaired by adding a delta; each must be re-derived. Roughly a dozen
> sessions edit this file concurrently, and an unrelated 32-line insertion above
> the block moved every citation at once. Re-derive with:
>
> ```sh
> grep -n 'IMPORTANT: Skip\|entry.type === "options") continue\|extracted.push' \
>   js/charactersheet/charactersheet-class-utils.js
> ```
>
> The quoted code above is the stable handle; the numbers are a convenience.

| encoding | parser (`state.js:790`, since `9a03a9f8`) | grant site (`:3391`) |
|---|---|---|
| 1. `{type:"options", count, entries:[…]}` | handled | **skipped** ✅ |
| 2. bare `{type:"entries", entries:[ref, ref]}` + "one of the following" prose | handled | **not skipped** 🔴 |

The parser learned encoding 2 on 2026-07-03; the grant site still knows only
encoding 1, so a Blessed Strikes falls through to the automatic-grant loop and
both refs are pushed with `parentFeature: "Blessed Strikes"` — exactly the
`_data.features` shape above. The comment at `:3379` states the intent is to
*skip player choices*, so this is an incomplete encoding check rather than a
design decision.

Measured live through the spawner (`getFeatures()`, fields as returned):

```
cleric/time domain/8   → Potent Spellcasting ×2
    {name: "Potent Spellcasting", lvl: 7, src: "XPHB", cls: "Cleric"}
    {name: "Potent Spellcasting", lvl: 8, src: "TGTT", cls: "Cleric", sub: "Time"}

cleric/blood domain/8  → Divine Strike ×2
    {name: "Divine Strike", lvl: 7, src: "XPHB", cls: "Cleric"}
    {name: "Divine Strike", lvl: 8, src: "TGTT", cls: "Cleric", sub: "Blood"}

cleric/life domain/8, cleric/tempest domain/8 → no duplicate
```

**It does not double-count mechanically**, which is the half that decides the
severity and the half a data grep cannot answer:

```
cleric/time domain/8   wisMod=5  potentSpellcastingBonus=5   (not 10)
cleric/blood domain/8            divineStrikeDamage="1d8"    (not 2d8)
```

**Correction to the mechanism originally given here.** This entry previously
explained the single value by saying `calculations.x = …` is an assignment and
therefore idempotent, so the second grant overwrites the first. That is true of
assignment in general but is *not* what is happening. The level-7 rows assign
nothing at all — there is never a second write to be idempotent about:

```
cleric/life domain/7  → blessedStrikesDamage="1d8"          ← only key set
                        (no divineStrike*, no potentSpellcasting*)
cleric/life domain/8  → + divineStrikeDamage, divineStrikeType, hasDivineStrike
cleric/time domain/8  → + hasPotentSpellcasting, potentSpellcastingBonus=5
```

So the level-7 `Divine Strike` / `Potent Spellcasting` rows are **inert
display rows**; the mechanics come entirely from the level-8 subclass grant.
Cosmetic, not a rules violation.

**Scope — enumerated, not inferred.** Two separate enumerations, both total
over the content this repo loads:

*Which features can collide at all.* Every `classFeature` in
`data/class/class-*.json` (all sources, 283 XPHB entries among them) compared
against all 224 TGTT `subclassFeature` entries, matched on `(className, name)`.
`homebrew/TravelersGuidetoThelemar.json` is the only homebrew file in the repo
that defines `subclassFeature` at all, so this pair is exhaustive.

```
TOTAL COLLIDING (class, featureName) PAIRS: 2
  Cleric  Divine Strike        XPHB base L7  ↔  TGTT L8
  Cleric  Potent Spellcasting  XPHB base L7  ↔  TGTT L8
```

**No other class is affected — zero collisions outside Cleric.**

*Which domains.* 6 of the 8 TGTT-source Cleric domains:

```
AFFECTED  Blood   → Divine Strike        (confirmed live)
          Time    → Potent Spellcasting  (confirmed live)
          Beauty, Darkness, Lust, Madness → Potent Spellcasting
                                            (data-enumerated, not spawned)
CLEAN     Light, None
```

The other TGTT Cleric subclasses — 16 `TGTT-2014`, 2 `TGTT-2024`, 3 `TGTT-AR`
— are clean; they carry no same-named level-8 grant and inherit the level-7
rows alone. This is why `cleric/life domain/8` (`TGTT-2024`) and
`cleric/knowledge domain/8` (`TGTT-2014`) show no duplicate even though both
*do* set `divineStrike*` calc keys.

**The blast radius is exactly two features — enumerated, not sampled.**
249 features across the class data use `refClassFeature`/`refSubclassFeature`,
so the tempting inference is that the mechanism is broken wholesale. It is not:
in almost all of those the refs are a *grant list* (a subclass header naming
what it gives), where materialising every ref is correct. Only encoding 2
reaches the unguarded path. Classifying every `classFeature` and
`subclassFeature` in `data/class/class-*.json` + `homebrew/*.json` with the
parser's own predicate (recursive; bare un-named `entries` block, ≥2 refs,
prose matching `/one of the following|choose one/i`):

```
ENCODING 2 — falls through :3391          2 features, BOTH measured live
  Blessed Strikes   Cleric XPHB L7   count=1  refs=2   → 2 rows   🔴 BUG
  Cunning Strike    Rogue  XPHB L5   count=1  refs=3   → 3 rows   ✅ benign

ENCODING 1 — correctly skipped           57 groups (Divine Order, Primal
  Order, Elemental Fury, Specialties, Jester's Acts Options, …)   all fine
```

**This supersedes an earlier "7 candidates, 4 unmeasured" note in this entry.**
That number came from a loose scan that did not require the prose test and did
not recurse. With the parser's actual predicate the population is 2, both
measured, **none unmeasured**.

**🔴 The second member is why the obvious fix is wrong.** Cunning Strike hits
the same unguarded path and is *display-correct anyway*: XPHB grants a Rogue
all three effects (Poison / Trip / Withdraw) and picks between them **at use
time**, so three rows is right. The prose test is a false positive there: "one
of the following" describes an at-use menu, not a level-up pick.

> **🔴 RETRACTED EVIDENCE — the "3 recorded / 3 materialised, consistent on
> `rogue/thief/5`" measurement that previously appeared here is CIRCULAR and
> must not be cited.** The record is *downstream of* the materialisation, so the
> two counts cannot disagree and their agreement corroborates nothing.
>
> Mechanism, verified in trunk: the extractor stamps every row it creates with
> `parentFeature: feature.name` (`charactersheet-class-utils.js:3408`), and
> branch **(b)** of the choice seeder (`:3162-3183`) then selects on exactly that
> field — `String(f?.parentFeature||"").toLowerCase() === String(feature.name||"").toLowerCase()`
> at `:3167-3169` — and calls `_recordChosenSubfeature` once per match (`:3172`).
> Whatever materialises, records.
>
> It also explains **both** members, which is what makes it the real path rather
> than a plausible one:
>
> | | (a) already-resolved guard `:3159` | (b) records from `_data.features` | counts |
> |---|---|---|---|
> | Blessed Strikes | ~~**fires** — a real level-up choice exists~~ | ~~never reached~~ | ~~1 rec / 2 mat → **genuine disagreement**~~ |
> | Cunning Strike | doesn't fire — no level-up choice | **fires**, records all 3 | 3 / 3 → **manufactured agreement** |
>
> ~~So the Blessed Strikes finding is *strengthened*: its record is independent and
> still disagrees. Only the Cunning Strike corroboration dies.~~ **The sound basis
> for "Cunning Strike is correct" is the rules text alone** — which is
> independently true, so the conclusion stands; the evidence for it does not.
>
> 🔴 **The Blessed Strikes row of this table is itself refuted (2026-08-02).**
> Measured on the true pre-fix tree (`f86af94e`), on both the spawner and wizard
> paths, `_data.chosenSubfeatures` holds **two** entries for Blessed Strikes. Guard
> (a) therefore does **not** fire on the seeding pass — nothing is recorded yet at
> that point — so branch (b) runs and records one per materialised row, exactly as
> it does for Cunning Strike. The counts are **2 rec / 2 mat → manufactured
> agreement**, the same cell as the row below it, and Blessed Strikes' record is
> *not* independent. The retraction this table was written to perform was correct
> and did not go far enough: it removed the corroborating member and left the
> remaining member's numbers un-remeasured. See the correction under the evidence
> block at the top of this entry.
>
> This also kills a fix shape that looks obvious: *"filter the extracted rows
> against `chosenSubfeatures`"* is circular by the above, and separately dead
> because `getLevelFeatures` is called from `charactersheet-levelup.js:96/497/4415`
> to compute **what the new level grants** — i.e. it runs *before* that level's
> choice exists. The boundary the verdict must cross is **temporal**, not just
> structural.
>
> And it answers the question this entry previously left open. *"Whether the
> three rows survive via the choice-seeding path instead"* was malformed:
> seeding does not keep rows alive, it **records rows materialisation already
> produced**. Suppress the materialisation and there is nothing for branch (b) to
> record.

So teaching `:3391` the parser's bare-sibling predicate — the natural fix, and
the one a reader will reach for first — would skip Cunning Strike too and risks
trading a visible Cleric bug for a visible Rogue one. The distinction the guard
actually needs is *learn-one* vs *use-one*, and with n=2 both members must be
re-measured after any change.

**A prose discriminator does exist** — an earlier revision of this entry claimed
no shape-based rule could work, which is too strong:

```
Blessed Strikes  "You GAIN one of the following options OF YOUR CHOICE …"   learn-one
Cunning Strike   "WHEN you deal Sneak Attack damage, you CAN ADD one of …"  use-one
```

Gain-clause vs trigger-clause. The parser matches both only because
`/one of the following|choose one/i` tests the wrong half of the sentence. The
argument against shipping such a rule is therefore **not** impossibility but
sample size: a regex tuned on n=2 is a structural claim drawn from two examples.
Stated this way because "a discriminator exists; the question is prose-matching
vs plumbing the verdict through" invites a different decision than "shape cannot
work."

**Adjacent, unfiled, no id requested.** Life Domain sets `divineStrikeType`
while Blood Domain sets `divineStrikeDamageType` — two key names for one
concept, so at most one of them can be the key any reader consumes. Noticed
while measuring the above; not investigated, and deliberately not filed on a
single observation.

**Adjacent, unfiled, no id requested.** Life Domain sets `divineStrikeType`
while Blood Domain sets `divineStrikeDamageType` — two key names for one
concept, so at most one of them can be the key any reader consumes. Noticed
while measuring the above; not investigated, and deliberately not filed on a
single observation.

**Surface observed on: the LIVE SHEET in a real browser**, via a Playwright
probe — not Jest, and not a grep. Exact reproduction:

```ts
// test/e2e/specs/<temp>.spec.ts, run with PW_PORT=<distinct> PW_WORKERS=1
await page.goto("/charactersheet.html", {waitUntil: "domcontentloaded"});
await page.waitForFunction(() => (globalThis as any).charSheet?.spawn);
await page.evaluate(async () => {
    const cs = (globalThis as any).charSheet;
    await cs.spawn("cleric/time domain/8", {save: false});
    return cs._state.getFeatures().map(f => f.name)
        .filter(n => /potent spellcasting/i.test(n));       // → 2 entries
});
```

This distinction is load-bearing. Under **Jest** `getFeatures()` returns an
empty array — no data load — so filtering it for a feature name yields nothing
and *any* Jest-based observation of this bug is vacuous by construction. The
browser is the only surface on which it is visible at all.

**Provenance — this entry's cause was relocated three times, then amended
once; each relocation moved it to a different file.**

It was originally raised as *"Potent Spellcasting appears twice at L8 and
L18"*. The levels were wrong (they are 7 and 8) and the scope was too narrow
(Divine Strike is affected identically). A data enumeration then found all 11
occurrences of Potent Spellcasting at level 8 and none at 18, which correctly
refuted the claim *as stated* — but the second source is the XPHB **base
class**, not a domain, so it was outside the files searched. A first live probe
also came back clean because it spawned `cleric//18`, and the auto-picker chose
Order Domain — a non-TGTT domain, which is exactly the case that does not
reproduce.

Two lessons, both paid for:

1. **A garbled bug report can still be a true bug report.** The reporter's
   *explanation* ("L8 and L18") was refutable and was refuted; the
   *observation* ("two rows on the screen") was never investigated. When a
   mechanism is wrong but someone claims to have seen something, the question
   is "what would produce this observation?", not "is this explanation sound?"
2. **A probe that cannot fail for the right reason proves nothing.** Spawning
   `cleric//18` let the auto-picker choose the variable that selects the bug.
   Pin every choice that matters.

The second correction is to this entry's own first version, which named the
TGTT domains as the cause and asserted `**Scope:** TGTT domains only` — an
exhaustive-sounding claim made from exactly two measurements. Enumerating it
properly moved the cause upstream to `Blessed Strikes`, showed that the
level-7 rows are inert rather than overwritten, and showed the affected set is
6 named domains and **no other class at all**. The original scope sentence
happened to be directionally right, which is the reason it survived review:
an unenumerated claim that is accidentally true reads exactly like a measured
one.

The third correction is to the version that replaced it, which said the sheet
*"materialises both options"* and implied the choice was never resolved. A
reviewer fed the real data entry to `FeatureChoiceParser.extractChoices()` and
got `count: 1` with two options — the extractor is **correct**, and had been
since `9a03a9f8` (2026-07-03), a month before the report. My evidence had
always come from `getFeatures()` / `_data.features`, a different surface from
the one my sentence named. Probing the stage in between settled it: the defect is
strictly at materialisation.
(⚠️ This paragraph originally continued *"`_data.chosenSubfeatures` records exactly
one pick, so recording is correct too"*. That clause is **refuted** — pre-fix it
records **two**, because branch (b) records one per materialised row. The
conclusion it was supporting — defect strictly at materialisation — is unchanged.
See the 2026-08-02 correction at the top of this entry.)

3. **Confirming the premise of a mechanism is not confirming the mechanism.**
   The data shape I cited was real and was verified; the behaviour I inferred
   from it was not, and one probe refuted it. Both of us stopped at the shape.
   The cost of getting this wrong is specific and predictable: a registry entry
   naming the wrong file sends the next reader into working code.
4. **State the surface you measured, not the surface you believe in.** "The
   sheet materialises both" and "`_data.features` contains both" look like the
   same sentence and are not. The first is a claim about a pipeline; the second
   is a reading. Only the second was ever taken.

**A fourth round, which was not the entry being wrong — and is the reason the
three-stage table is in it.** After the correction above landed, the entry was
challenged again on the grounds that `extractChoices()` returns `count: 1` and
therefore "materialises both" was refuted. But this version of the entry *says*
`count: 1`, in a table row labelled **correct**, and its title says a
***resolved*** choice materialises both. The challenge was aimed at a summary
of the entry from which the word "resolved" had dropped, and the summary was
never checked against the entry. Retracted in full by its author within
minutes, who then located `class-utils.js:3391` — the finding this entry had
marked *not located*.

5. **A summary that drops one qualifier turns a correct claim into a
   refutable one.** "A resolved choice still materialises both" and "the choice
   is never resolved" differ by one word and point at opposite stages. Read the
   primary source before contradicting it — including, and especially, when the
   contradiction feels well-founded.
6. **Structure is what makes an entry cheap to correct.** The challenge was
   resolved by pointing at one table row. Had this entry asserted only a
   conclusion, the same exchange would have re-litigated the wrong stage
   indefinitely — which is exactly what its first two versions did.

### Fix as landed

Two edits, coupled — neither is safe alone.

1. **`charactersheet-state.js`, `_extractStructuredChoices`.** The bare-sibling
   encoding was admitted whenever the prose contained "one of the following".
   It now additionally requires an **acquisition verb** within the same sentence
   (`/\b(?:gain|gains|learn|learns|choose|select|pick)\b[^.]{0,60}?\bone of the following\b/i`),
   because the phrase alone does not distinguish acquiring an option from
   selecting one per use.
2. **`charactersheet-class-utils.js`, `getLevelFeatures`.** The extraction loop
   now skips any sibling ref the parser has already classified as a choice
   option, via the new `getChoiceOptionNames()`. It **delegates** rather than
   re-deciding: the two readers of this encoding disagreeing is the whole bug.

**Why a shape test at the materialisation site cannot work — the enumerated
population.** Exactly **seven** features in shipped data use the bare-sibling
encoding (scan of `data/class/` + `homebrew/`; there are no homebrew instances):

| Feature | Prose | Correct behaviour |
|---|---|---|
| Blessed Strikes (Cleric XPHB 7) | "You **gain** one of the following options" | pick one |
| Cunning Strike (Rogue XPHB 5) | "you can **add** one of the following effects" | **learn all** |
| Channel Divinity (Cleric XPHB 2) | "You start with two such effects" | learn all |
| Ki (Monk PHB 2) | "You start knowing three such features" | learn all |
| Monk's Focus (Monk XPHB 2) | "You start knowing three such features" | learn all |
| Martial Arts (Monk XPHB 1) | "You gain the following benefits" | learn all |
| Devious Strikes (Rogue XPHB 14) | "The following effects are now among your options" | learn all |

Blessed Strikes and Cunning Strike are **structurally identical and
semantically opposite**, so no rule local to the loop can separate them. Only
five of the seven were ever ambiguous to the old prose test; Cunning Strike was
its single false positive, and it was *harmless* only because the
materialisation it should have suppressed short-circuited the prompt (branch (b)
of `seedSubclassFeatureChoices`, which records already-applied children as
chosen). Fixing the materialisation without also narrowing the prose test would
have converted that latent false positive into a **visible Rogue regression** —
all three Cunning Strike effects vanishing — i.e. traded a Cleric bug for a
Rogue one. That was the originally-proposed fix, and it was refuted by
measurement rather than by review.

### Falsification

Both directions were broken in place, signatures intact, with the red count
predicted before measuring. Each predicted **2 red**; each produced exactly 2,
all genuine value assertions (no `Type`/`ReferenceError`).

| Break | Red | First failure |
|---|---|---|
| prose test reverted to the unguarded regex | **2** | `Expected length: 0 / Received length: 1` (Cunning Strike re-classified), then `Expected: 3 / Received: 0` (Rogue loses every effect) |
| `getChoiceOptionNames` skip removed from the loop | **2** | Cleric 7 grants both options; the pending choice is `undefined` |

The two controls stay green under both breaks by design: Monk 2 (three
learn-all children) and the Blessed Strikes classification itself.

The pinned surfaces are deliberately the **read** ones — what the sheet grants
(`getLevelFeatures`) and what the player is offered
(`seedSubclassFeatureChoices` → `addPendingFeatureChoice`) — not
`extractChoices()` alone, which was correct before the fix and would therefore
have pinned nothing.

#### Complement added 2026-08-02 — the "fixed by granting nothing" hole

The row `a Cleric 7 is granted NEITHER Blessed Strikes option` asserts
`not.toContain("Divine Strike")` on the **unresolved** state. That is the correct
pre-choice assertion, but it is one-sided: it would stay green if the bug were
"fixed" by making `fulfillFeatureChoice` grant nothing at all. Flagged by the
`plan-cs-bug-018-skips` session.

Closed by `resolving the choice grants EXACTLY the picked option and not the
other`, which drives the real resolution path — `seedSubclassFeatureChoices` →
`getPendingFeatureChoices()` → `fulfillFeatureChoice(id, "Divine Strike")` — and
asserts the picked option is present, the rejected one absent, and the pending
queue drained. Two PREMISE guards (a choice exists; `count === 1`) keep it from
degrading into a vacuous pass if seeding ever stops producing the choice.

**Falsified**, break in place with the signature intact
(`_fulfillSubfeatureChoice` → `if (false) this.addFeature(built);`):

```
✕ resolving the choice grants EXACTLY the picked option and not the other
  Expected value: "Divine Strike"   Received array: ["Blessed Strikes"]
✓ a Cleric 7 is granted NEITHER Blessed Strikes option        <- stayed GREEN
Tests: 1 failed, 6 passed
```

The green row is the point: it demonstrates the hole rather than arguing it.

⚠️ **This suite must `import "./setup.js"` before the product imports.**
`jest.config.json` declares no global `setupFiles`, and `addPendingFeatureChoice`
calls `CryptUtil.uid()` — omitting it yields `ReferenceError: CryptUtil is not
defined` from inside the seeder, which reads like a product fault.

#### Spawner and wizard diverge here — do not derive an expectation from a spawned build

Measured post-fix on Cleric 7, the level that carries the choice:

| path | `pendingChoices` | option rows |
|---|---|---|
| spawner | **0** — auto-resolves | `["Divine Strike"]` |
| wizard | **1** — queues for the player | `[]` |

Both are correct. A probe that reads option rows off a spawned build will report
the choice as already made. The player-facing consumer that drains the queue is
`charactersheet.js:13056 processPendingFeatureChoices()`, which drives one modal
per pending choice at Builder-finalize, LevelUp and QuickBuild.

### Existing saves — no migration

A character created before this fix already has **both** features in
`_data.features`. There is no way to recover which the player intended, so no
migration is attempted: leaving both is non-destructive and mechanically
single (the calculations are idempotent, as recorded above). Respec is the
remedy.

## CS-BUG-089 — a companion whose attack is declared structurally has no rollable attack at all

**Status:** Fixed.
**Affects:** every `CLASS_SUMMON` companion authored in the structured attack
vocabulary. The reproducible victim in the shipped corpus is the **Hound of Ill
Omen** (Shadow Magic Sorcerer 6). Any future curated summon written the same way
inherits it, which is why the fix is at the point of entry rather than in the
Hound.

### Symptom

Summon the Hound at level 6. It arrives with a fully specified Bite — `+5` to
hit, `2d6+3` piercing, plus a DC 13 Strength save or prone — and the companion
card renders **zero attack buttons**. There is nothing to click and nothing to
roll. The damage is visible nowhere on the sheet.

### Root cause — two vocabularies, one reader

Companion attacks arrive in two shapes:

| shape | example | who reads it |
|---|---|---|
| prose (bestiary) | `{name: "Bite", entries: ["{@atk mw} {@hit 5} to hit… {@damage 2d6+3}"]}` | everything |
| structured (curated) | `{name: "Bite", attackBonus: 5, damage: "2d6+3", damageType: "piercing"}` | **nothing that renders or rolls** |

`addCompanion()` stored the structured form verbatim as `companion.attacks` and
initialised `actions: companionData.actions || []`. Every surface that produces
a button or a roll reads `companion.actions` and parses 5etools prose out of
`entries`:

- `charactersheet.js:4853` — attack-button filter, `/\{@atk/` over `actions[].entries`
- `charactersheet.js:5705` — the same filter, second render path
- `charactersheet.js:5797` — `_rollCompanionAttack()`, `{@hit N}` / `{@damage X}` over `entries`
- `charactersheet.js:5963` — companion attack list

So a structured attack landed in a field no rendering or rolling path consults.

**Enumerated, not assumed.** `git grep -n "\.attacks" -- js/charactersheet/`
returns exactly two other readers of `companion.attacks`, and neither rescues
this:

1. `charactersheet-playmode.js:2835` / `:4013` do `comp.actions || comp.attacks || []`.
   That fallback **never fires** — `addCompanion()` always writes an array to
   `actions` and `[]` is truthy — and it renders only `name`/`entries` anyway,
   neither of which a structured attack has.
2. `_recalculateScaledCompanion()` rewrites both lists, but only when the
   companion declares `scaling.attackName`. The Hound's descriptor is
   `{className: "Sorcerer", tempHpPerLevel: 0.5}` — no `attackName` — so it is
   never reached.

This corrects an earlier and weaker-sounding but false claim that "nothing reads
`companion.attacks`". Two things do; neither renders a button or rolls dice.

### Fix

`static CharacterSheetState._withStructuredAttackActions(actions, attacks)`,
applied once at `addCompanion()`. It synthesises a prose action per structured
attack that is not already represented, emitting exactly the tokens the four
consumers parse (`{@atk}`, `{@hit N}`, `{@h}{@damage X} <type> damage.`) and
appending any `description` so riders such as the prone save survive.

Authored prose wins: an attack whose name already matches an action, or which
already carries `entries`, is left untouched. `companion.attacks` is preserved
unchanged, so the translation is purely additive and nothing that reads the
structured form is disturbed.

### Regression pins

`test/jest/charactersheet/CharacterSheetShadowMagicSorcerer.test.js` — both
assert the tokens the real consumers parse, applying the render predicate from
`charactersheet.js:4853` verbatim rather than a paraphrase.

Falsified by breaking the logic **in place**, signature kept — never by deleting
the method, which would only prove the test touches new code:

| break | red | failure |
|---|---|---|
| the fix absent entirely (pre-fix baseline) | 1 | `Expected length: 1 / Received length: 0` — zero attack buttons |
| `seen.has(...)` collision guard removed | 1 | `Expected length: 1 / Received length: 2` — duplicate `Bite` row |
| `{@damage …}` wrapper dropped from the emitted entry | 1 | damage list `Expected - 3 / Received + 1` |

All three are real **assertion** failures, not `TypeError`.

Honest note on pin 2: it is **green pre-fix**, because it asserts *precedence*
and the total absence of translation satisfies that trivially. It is a guard
against the fix over-reaching, not against the original bug — pin 1 is the pin
for the bug itself. Falsifying it required the second break above.

---

## CS-BUG-069 — `featuresMatrix` rows in a level window with no checkpoint are never evaluated, and the detector that should catch them reports zero

**Status:** Open. Partially addressed — `913600e4` widened the offending
windows that existed at the time and added `scripts/auditE2eCoverage.mjs`. The
underlying hole is still open, and **16 rows are inert** — count corrected twice (12 -> 13 -> 16); see Root cause 1 and Root cause 4. SEVEN root causes are now recorded.

**Affects:** `test/e2e/utils/characterSpecFactory.ts` (the MEGA and matrix
loops) and `scripts/auditE2eCoverage.mjs` (the detector).

### The one-command falsification — no instrumentation needed

`node scripts/auditE2eCoverage.mjs` prints **coverage percentages above 100%
next to a ✓ FULL badge**. At `c1d8df7c`: **11 of 42 rows exceed 100%**, topping
out at **168%** (`tgtt-trickster-rogue-goblin`). A coverage figure over 100% is
arithmetically impossible, so the metric is unsound on its face — before any
question of *which* rows it can see. This was on screen in every run of the
script; the inert-row enumeration below required a collection-time probe to
obtain the weaker result.

> **Do not quote 174% / "14 of 42".** Those figures are real but were measured
> at `406e3e96`, a pre-sweep tree, and do not reproduce at trunk — for the
> reason immediately below. Re-derive before citing; this section's own numbers
> will drift the same way.

### 🔴 Sharper: the score counts a SKIPPED assertion as coverage, so lifting a skip makes coverage go DOWN

`scripts/auditE2eCoverage.mjs:728`

```js
const effective = effectsCount + helperCount + skipReasonCount + siblingCovered - inertWithProbes;
```

`skipReasonCount` counts `skipReason: "…"` annotations — prose attached to an
assertion that **does not run**. The comment eight lines above it argues, at
length and correctly, that `reasonCount` must *not* be added because *"an
explanatory comment records that a gap is KNOWN; it does not make the feature
verified … a row whose only accounting is prose must keep counting against the
spec."* The next statement adds the strictly weaker signal: prose on a row that
is not merely unexplained but **disabled**. The function contradicts its own
stated principle in adjacent lines.

Consequence, measured across the CS-BUG-016 skip-lifting sweep (`406e3e96` →
`c1d8df7c`), which is unambiguously an *increase* in verification:

| spec | skips lifted | reported coverage |
|---|---|---|
| `tgtt-child-of-sun-sorcerer-hochling` | 19 → 6 (**13**) | 174% → **105%** |
| `tgtt-lust-cleric-lexalian` | 26 → 8 (**18**) | 131% → **62%** (FULL → LOW) |
| `tgtt-bladesinger-wizard-tabaxi` | 14 → 10 | 154% → **123%** |

Both lift counts match the per-spec CS-BUG-016 skip inventory exactly (13 and
18), which is what identifies the mechanism rather than merely correlating with
it. **The metric moves in the wrong direction when coverage genuinely
improves**, and it moved one spec from ✓ FULL to ⚠ LOW *as a result of being
better tested*. That is worse than the >100% artefact: an impossible percentage
announces itself, whereas a plausible percentage that ranks improvement as
regression will be believed and acted on.

Minimum repair is deleting `skipReasonCount` from the sum — **but that is
measured to be insufficient.** Removing it takes the >100% rows from **11 to
3**, not to 0:

```
tgtt-meteor-knight-fighter.spec.ts        13 entries  15 effects  0 helpers  →  115%  ✓ FULL
tgtt-steel-hawk-fighter.spec.ts           13 entries  15 effects  0 helpers  →  115%  ✓ FULL
tgtt-tdcsr-juggernaut-barbarian.spec.ts   21 entries  20 effects  2 helpers  →  124%  ✓ FULL
```

On the first two, `effectsCount` **alone exceeds `entryCount`** with every
other term at zero — and that is not a units mismatch, it is a **proof of
denominator undercount**. An `effects:` block belongs to exactly one row, so
`effectsCount ≤ (true row count)` holds unconditionally. Therefore:

> **Any spec where `effectsCount > entryCount` is, by construction, a
> denominator undercount. No other explanation is available.**

Confirmed empirically as well as structurally — **919 rows scanned across all 43
specs, zero carrying more than one `effects:` block.** An earlier revision of
this entry asserted "a row may carry more than one" and used it to argue the two
terms were incommensurable; that clause was false, and the argument built on it
is withdrawn. *(Invariant supplied by the `lunar-sorcery-sorcerer` session; the
919-row sweep is the check on it.)*

The real cause is **root cause 5** below — `:683`'s comment blinding, the same
defect as `:188` on the opposite side of the ratio. True coverage:

| spec | `entryCount` | real rows | blinded | effects | true coverage |
|---|---|---|---|---|---|
| `tgtt-meteor-knight-fighter` | 13 | 15 | 2 | 15 | **100%** |
| `tgtt-steel-hawk-fighter` | 13 | 15 | 2 | 15 | **100%** |
| `tgtt-tdcsr-juggernaut-barbarian` | 21 | 22 | 1 | 20 | **91%** |

All three are ≤ 100% once the denominator is correct.

**The conclusion survives its own retracted premise: deleting one term makes the
artefact rarer without making the metric sound.** It is true for a different
reason than first recorded — the units mismatch is real and fatal for
`helperCount` (root cause 6), but it is not what produced these three badges.
The printed table contains its own disproof, and the two columns that expose it
are already side by side.

### The printed table cannot reproduce its own percentage

Two of the four numerator terms are invisible in the output:

- the printed **`skip`** column is `skipCount` = `/\bskip:\s*true\b/` (`:698-699`),
  but the term added to `effective` is `skipReasonCount` = `/\bskipReason:\s*"/`
  (`:700-701`). They diverge routinely — bladesinger **10 vs 7**, child-of-sun
  **6 vs 3**, champion **2 vs 0**, arcana-cleric **1 vs 0**.
- `siblingCovered` (`:719`) is added to the score and **printed nowhere**.

A reader checking the arithmetic from the table gets a different number and
concludes they have misread the columns. Worth recording that an earlier
attempt to confirm the mechanism this way *appeared* to succeed by coincidence
— child-of-sun's printed `skip` of 6 happens to equal `skipReasonCount` 3 plus
`siblingCovered` 3, so `12 + 2 + 6 = 20` gave the right total for the wrong
reason. Verify terms against the source, never against this table.

### Symptom

`assertFeaturesMatrix()` is only ever called at the checkpoints
`[3, 5, 11, 17, 20]` (`characterSpecFactory.ts:366` and `:393`). A row is gated
by `level` and `untilLevel`, so a row whose window contains no checkpoint is
**never evaluated at all** — it looks like coverage in the spec, contributes to
the coverage percentage, and asserts nothing, forever. It cannot fail, so it
cannot report the regression it was written to catch.

### Measured, by enumerating the parsed objects — not by scanning source

Instrumenting `buildComprehensiveCharacterTests()` at collection time and
running `npx playwright test --list`:

```
DEAD_WINDOW Astral Self Monk Changeling    :: L2..2   :: /combat methods/i (passive)
DEAD_WINDOW Astral Self Monk Changeling    :: L6..7   :: /combat methods/i (passive)
DEAD_WINDOW Astral Self Monk Changeling    :: L8..9   :: /combat methods/i (passive)
DEAD_WINDOW Astral Self Monk Changeling    :: L13..14 :: /combat methods/i (passive)
DEAD_WINDOW Astral Self Monk Changeling    :: L15..16 :: /combat methods/i (passive)
DEAD_WINDOW Hunter Ranger Centaur          :: L2..2   :: /combat methods/i (passive)
DEAD_WINDOW Hunter Ranger Centaur          :: L6..6   :: /combat methods/i (passive)
DEAD_WINDOW Hunter Ranger Centaur          :: L7..8   :: /combat methods/i (passive)
DEAD_WINDOW Hunter Ranger Centaur          :: L9..10  :: /combat methods/i (passive)
DEAD_WINDOW Hunter Ranger Centaur          :: L13..14 :: /combat methods/i (passive)
DEAD_WINDOW Hunter Ranger Centaur          :: L15..16 :: /combat methods/i (passive)
DEAD_WINDOW Meteor Knight Fighter Aarakocra:: L13..16 :: /satellite mastery/i (resource)
```

Meanwhile `node scripts/auditE2eCoverage.mjs` prints an **empty `inert` column
for all three specs**, and badges two of them as fully covered (measured at
`fae134bb`; see the drift note above):

```
tgtt-hunter-zodiac-centaur.spec.ts    52 entries … inert (blank)  102%  ✓ FULL
tgtt-meteor-knight-fighter.spec.ts    13 entries … inert (blank)  115%  ✓ FULL
tgtt-astral-self-monk-changeling.ts   24 entries … inert (blank)   58%  ⚠ LOW
```

> At `c1d8df7c` these read **85% OK / 115% ✓ FULL / 58% ⚠ LOW** — hunter-zodiac
> dropped out of FULL only because the skip-lifting sweep removed skips it was
> being credited for. The **`inert` column is still blank on all three, and on
> all 18 specs**, which is the invariant part of this symptom; the percentages
> are not.

A spec scoring **✓ FULL at 102%** while carrying six never-executed rows is
worse than no detector, because the badge actively discourages a second look.

### Root cause — seven, not two

**1. `findInertRows()` scans spec source text, but 14 of the 16 rows do not
exist in spec source.** They are emitted at runtime by `buildCombatMethodChecks`
(`test/e2e/utils/tgttFeaturePools.ts:1420`/`:1431`). A lexical scan of
`test/e2e/specs/*.ts` is structurally incapable of seeing a row a helper
returns. This is the same class of error already recorded in CS-BUG-087's notes:
**a regex scan over source is not an enumeration.**

> **Measured, and it is worse than "14 of the 16": `findInertRows()` finds
> ZERO rows on ALL 43 specs.** Instrumented the audit in-tree to print its own
> intermediate, then restored it byte-identical:
>
> ```
> node scripts/auditE2eCoverage.mjs   (43 specs)
> 43 × inertRows=0 withProbes=0
> ```
>
> It misses even the two rows that *are* in spec source, for two different
> reasons — one per detection cause:
> - **Meteor Knight `L13..16`** — the object literal is `{`, then a two-line
>   comment, then `level: 13` (`tgtt-meteor-knight-fighter.spec.ts:73-77`). The
>   pattern is `/\{\s*level:\s*(\d+)/`, which allows only whitespace between the
>   brace and the key. Comment ⇒ no match. (Cause 2.)
> - **Wild Shape `L8..11`** (`tgtt-hunter-zodiac-centaur.spec.ts:328`) — matches
>   the pattern fine, then survives `CHECKPOINTS.some(c => c >= lo && c <= hi)`
>   because the global list contains **11**. Against the row's real legs
>   `{6,20}` nothing lands. (Cause 4.)
>
> **Consequence — the formula's own guard against this defect has never fired.**
> `:712-713` build `inertWithProbes` from the blind scanner and `:728` subtracts
> it:
>
> ```js
> const inertRows = findInertRows(src);
> const inertWithProbes = inertRows.filter(r => r.hasProbes).length;
> …
> const effective = … + siblingCovered - inertWithProbes;   // always - 0
> ```
>
> So the expression contains an explicit correction term intended to stop inert
> rows being laundered into the score, wired to the one input structurally
> incapable of finding them. It has evaluated to `0` for every spec, every run.
> This is a sharper indictment than the >100% artefact, and it lives in the same
> line. Credit to the `lunar-sorcery-sorcerer` session for the structural
> argument; the "exactly 0 on 43 of 43" figure is the measurement of it.

**4. The detector's model is wrong, not just its reach — it holds ONE global
checkpoint list, and multiclass specs do not use it.** `characterSpecFactory.ts:907`

```js
await assertFeaturesMatrix(charSheet, featuresMatrix, leg.toTotalLevel);
```

The multiclass path evaluates the matrix **once per leg, at that leg's total
level**. For `tgtt-hunter-zodiac-centaur` the legs are `toTotalLevel: 6` (`:458`)
and `20` (`:460`) — **two stops, not five**. So the *same file* feeds two call
sites that need two different checkpoint sets, and `grep -c 'toTotalLevel'
scripts/auditE2eCoverage.mjs` returns **0**: the tool has no concept of legs at
all.

Causes 1-3 are about what the detector can *see*. This one is about the model
being wrong, so **a perfect `findInertRows()` still gets this file wrong.** The
worked example is `tgtt-hunter-zodiac-centaur.spec.ts:328` — hand-written,
lexically plain, no comment between brace and key, so every proposed scanner
repair marks it live:

```js
{ level: 8, untilLevel: 11, name: /wild shape/i, kind: "resource", resourceMax: [2, 2], restoreOn: "short" }
```

`6 < 8` and `20 > 11`, so no leg lands inside the window.

> ⚠️ **One correction to how this row is usually described.** It is *not* a
> silent kill. The comment at `:323-327` states the inertness outright — *"the
> multiclass matrix is evaluated once PER LEG … so the level-8 tier is inert
> here and the `shortRestRestores` probe is relocated onto the level-12 tier
> rather than dropped."* The author knew and compensated; what is lost is the
> row's `resourceMax: [2,2]`, not the restore probe. That makes it a **perfect**
> demonstration of root cause 4 — the detector calls live a row whose own
> adjacent comment says it is dead — and a **poor** example of an author being
> misled.

> **Consequence for the bug's character (2026-08-03).** With that correction, all
> 16 rows fall into exactly two buckets: **14 invisible-by-construction**
> (helper-emitted, so absent from spec source entirely) and **2 knowingly
> documented** (Meteor Knight `L13..16` and this one, each with an adjacent
> comment naming its own inertness). **There is not one case of an author being
> misled.**
>
> That is a sharper indictment than "the detector missed 16 rows", because it
> removes the consolation reading. The tool exists to tell an author that a row
> they believe is live is dead. On this evidence it has never had that job to do:
> where an author was capable of noticing, they noticed and wrote it down; where
> they were not, the tool cannot see it either. **Its value proposition is
> unrealised in both directions simultaneously** — which is also why no amount of
> lexical repair reaches the 14, and why the 2 it could theoretically catch are
> precisely the ones that need catching least.
>
> *(Framing supplied by the `lunar-sorcery-sorcerer` session, after retracting the
> "silently killed" reading above. The relocation is verified complete: `:341-345`
> carries `restoreOn: "short"` and `effects: [{kind: "shortRestRestores", resource:
> "Wild Shape"}]` on the level-12 tier.)*

> **Count corrected 12 → 13 (2026-08-02, still reproducing at `380389fb`).**
> Both earlier figures were derived by reading, and both missed the same row: the
> **capped multiclass leg** `buildCombatMethodChecks("Ranger", {subclassName:
> "Hunter", maxClassLevel: 6})` at `tgtt-hunter-zodiac-centaur.spec.ts:271` emits
> its own inert `L2..2`, distinct from the uncapped call at `:45`. A second call
> to the same helper in the same file is exactly what a by-eye pass elides.
>
> Enumerated at **runtime** — the only instrument that can see these rows at all,
> which is root cause 1 restated as a method:
>
> ```ts
> // npx tsx ./probe.mts, run IN-TREE (imports resolve from file location)
> import {buildCombatMethodChecks} from "./test/e2e/utils/tgttFeaturePools.js";
> const CP = [3, 5, 11, 17, 20];
> for (const r of buildCombatMethodChecks("Ranger", {subclassName: "Hunter"}))
>     if (!CP.some(c => c >= r.level && c <= (r.untilLevel ?? 20))) console.log(r.level, r.untilLevel);
> ```
>
> | call site | checkpoint set | rows | inert |
> |---|---|---|---|
> | `buildCombatMethodChecks("Monk", {subclassName: "Astral Self"})` | `[3,5,11,17,20]` | 10 | **5** — L2..2, L6..7, L8..9, L13..14, L15..16 |
> | `buildCombatMethodChecks("Ranger", {subclassName: "Hunter"})` (`:45`) | `[3,5,11,17,20]` | 12 | **6** — L2..2, L6..6, L7..8, L9..10, L13..14, L15..16 |
> | `…{maxClassLevel: 6}` (`:271`, the missed one) | **`{6,20}`** | 5 | **3** — L2..2, L3..4, L5..5 |
> | Wild Shape `L8..11` (`:328`, hand-written) | **`{6,20}`** | — | **1** |
> | Meteor Knight `L13..16` (hand-written, self-documented) | `[3,5,11,17,20]` | — | 1 |
> | | | | **16** |
>
> **Count corrected again, 13 → 16.** The `13` figure applied
> `[3,5,11,17,20]` to every call site. That set is a property of the
> **consuming spec**, not a constant — see root cause 4. The two `{6,20}` rows
> above are what the wrong parameter hid, and the second of them is
> hand-written. Negative controls, since they are the useful half:
> `tgtt-hexblade-divine-soul-tortle` (legs `{2,20}`) is **clean** — its helpers
> return no windowed rows — and the single-class loops apply no level-cap
> filter, so no spec loses checkpoints to its own max level. The multiclass
> defect is confined to one file.
>
> The gate is `comprehensiveBuildHelpers.ts:2311`
> (`if (fc.untilLevel != null && currentLevel > fc.untilLevel) continue;`), so an
> `untilLevel`-less row is unbounded above and only *windowed* rows can be inert.
>
> **And `RUN_MEGA` does not rescue what `RUN_MATRIX` misses.** Both loops declare
> the same list independently — `characterSpecFactory.ts:366` and `:393` each read
> `const checkpoints = [3, 5, 11, 17, 20]`. Worth stating because "the mega test
> walks 1→20" is the natural assumption from its name, and it is false: it walks
> five stops. The duplicated literal is also why any rescue mechanism has to
> change two sites, not one.

**2. The regex is `/\{\s*level:\s*(\d+)/`, so a comment between `{` and
`level:` blinds it.** That is precisely what a careful author writes on a row
they know is inert — the Meteor Knight L13..16 row carries *"Not exercised by
the current checkpoint list [3, 5, 11, 17, 20], but kept so the tier ladder is
complete"* and is therefore invisible to the detector that exists to find it.

**5. The SAME blinding also afflicts the denominator — and it is what produces
every surviving >100% row.** `:683` counts entries with
`/\{\s*level:\s*\d+\s*,/g`: whitespace only between the brace and the key, the
identical shape as cause 2, on the opposite side of the fraction. Cause 2 hides
inert rows *from the detector*; cause 5 hides documented rows *from the
denominator*.

Measured — the two 115% specs reproduce exactly, from source:

```
tgtt-meteor-knight-fighter   entryCount=13  real rows=15  blinded=2  effects=15  ->  115%
tgtt-steel-hawk-fighter      entryCount=13  real rows=15  blinded=2  effects=15  ->  115%
tgtt-tdcsr-juggernaut-barbarian  entryCount=21  real=22  blinded=1  effects=20  ->   95%
```

Both specs have 15 rows and 15 `effects:` blocks. **Coverage is genuinely 100%;
the entire overshoot is the denominator losing 2 rows.** The four lost rows, and
what precedes each:

```
meteor-knight :76   level: 13   <- "// PB 5 (levels 13-16). Not exercised by the current checkpoint list…"
meteor-knight :140  level: 10   <- "// The middle damage tier: 1d6 from 10 until Satellite Barrage bumps it…"
steel-hawk    :61   level: 3    <- "// Damage tier 1: 1d8 from 3 until Eagle Eye bumps it at 10."
steel-hawk    :205  level: 10   <- "// Damage tier 2 plus the widened crit range, both released at 10…"
```

All four are among the **best-documented rows in their files**. The metric
penalises exactly the rows an author took most care over.

> **The script diagnosed this itself and fixed a different instance of it.**
> `:676-682`, verbatim, six lines above the offending regex: *"The stricter
> anchor missed 102 entries across 27 of 39 specs, all of them tiered rows, so
> **the denominator shrank exactly where a spec was best written and every
> coverage figure came out overstated.**"* The author hit the failure mode via
> the `name:` anchor, repaired that instance, wrote down the general rule — and
> left a second instance of the same rule live in the next line. That is the
> **third** self-indicting comment in this file, after `:178-185` (laundering)
> and `:721-727` (prose is not verification). *Found by the
> `lunar-sorcery-sorcerer` session; the 115% reproduction is the measurement of
> it.*

**6. `helperCount` counts distinct helper *functions*, not rows — and omits the
one helper that matters most.** `:705` is `new Set(helperUsage).size` over a
fixed alternation of 16 names, so three calls to `buildWeaponMasteryChecks`
contribute **1**. Worse:

```
grep -c 'buildCombatMethodChecks' scripts/auditE2eCoverage.mjs   ->  0
grep -rn 'buildCombatMethodChecks' test/e2e/specs/*.ts | wc -l   ->  6   (across 2 specs)
```

**The helper that emits 14 of the 16 inert rows is not in the alternation at
all**, so it contributes **0** to the numerator — not 1. Those rows are
mis-counted on *both* sides of the fraction: invisible to `entryCount` because
they are not literals, and invisible to `helperCount` because the function is
unlisted.

**Consequence for any repair.** Dropping `skipReasonCount` takes 11 rows over
100% down to 3; anchoring the entry regex past comments takes those 3 to 0. The
two together remove every impossible figure — **and the metric is still
unsound**, because causes 1, 4 and 6 are untouched and the tell is now gone. A
partial repair here is worse than none: it buys silence, not correctness.

**7. On a PARTIAL tree it warns, silently substitutes the wrong model, and
prints an authoritative table anyway.** The script resolves `ROOT` from its own
file location, so cross-tree measurement (`git archive … | tar -x -C /tmp/…` —
the standard workflow for reproducing another session's numbers) easily produces
a tree with `test/e2e/specs/` present and `test/e2e/utils/characterSpecFactory.ts`
absent. Measured, three configurations:

| tree | behaviour |
|---|---|
| full repo | correct |
| script alone, outside the repo | warns, then **crashes** (`ENOENT … scandir '/private/tmp/test/e2e/specs'`) |
| **specs present, `characterSpecFactory.ts` absent** | **warns twice, prints the full table, prints a verdict — "13 spec(s) below threshold"** |

```
[audit] WARNING: could not read the checkpoint list … Falling back to [3, 5, 11, 17, 20].
[audit]          Coverage below may be WRONG.
  …full table, every row badged…
  13 spec(s) below threshold.
```

The crash case is safe — loud, and it stops. The middle case is the dangerous
one, and note **what** it falls back to: the hardcoded `[3, 5, 11, 17, 20]`,
i.e. exactly the constant root cause 4 establishes is the wrong model for
multiclass specs. A partial materialisation therefore substitutes a known-wrong
checkpoint list and reports a verdict on it. Same family as a `✓ FULL` badge
over 168% — every failure mode of this tool is *legible but non-blocking*.

> **Corollary for reviewers, learned the expensive way this batch.** Running a
> fetched copy of this script against your own working tree produces a **hybrid
> corresponding to no tree that has ever existed** — trunk's instrument over
> stale specs. The `shadow-sorcery-rhw` session got `14 rows / max 174%` that way
> and was one message from filing it as a falsification of the true `11 / 168`.
> To reproduce another session's tooling measurement, materialise their **whole**
> tree, and read the warning line before the table.

### The strongest evidence for the inversion is a natural experiment, not the synthetic one

The `- skipReasonCount` deletion (11 rows → 3) is a *synthetic* demonstration:
the instrument was edited to produce it. A cleaner one arrived by accident. The
hybrid tree above differs from trunk largely by **merged skip-lifting work**, so
the same unmodified script over the same rows shows coverage *falling* as skips
are genuinely fixed:

| spec | stale tree | trunk | skips |
|---|---|---|---|
| `tgtt-lust-cleric-lexalian` | **131% ✓ FULL** | **62% ⚠ LOW** | 26 → 8 |
| `tgtt-child-of-sun-sorcerer-hochling` | 174% | 105% | 19 → 6 |
| `tgtt-hunter-zodiac-centaur` | 102% | 85% | 32 → 23 |
| `tgtt-surrealism-bard-yuanti` | 110% | 90% | 16 → 12 |

Lust-cleric is demoted **FULL → LOW by a 69-point fall caused entirely by fixing
18 real skips.** Nobody touched the instrument; the drop was produced by merged
work, in the direction that punishes it. That is stronger than the deletion
experiment precisely because it cannot be attributed to the edit.

### Why widening the window is the wrong fix

All eleven undocumented rows sit on **intermediate progression tiers** — a
Monk's combat methods at L6-7 differ from L8-9. Stretching `L13..14` out to
touch L11 or L17 does not make the row run; it makes it assert a value that is
**factually wrong for the level it now covers**. The previous sweep's widening
was safe only for the specific rows it touched.

### Suggested direction (not implemented here)

Compute the checkpoint list *from* the matrix instead of hardcoding it: keep
`[3, 5, 11, 17, 20]` as the base, then add one rescue stop per otherwise
unreachable window (greedily shared between overlapping windows), and at a
rescue stop assert **only** the entries that stop exists for — a full re-pass at
every added level blows the MEGA timeout. A prototype of this made all of the
above rows execute for the first time.

If that lands, `scripts/auditE2eCoverage.mjs:131` must change with it: it reads
the checkpoint list with `/const\s+checkpoints\s*=\s*\[([\d,\s]+)\]/` and
**silently falls back** to a hardcoded default the moment that literal becomes a
variable — so the detector would keep reporting against a checkpoint list the
runner no longer uses.

## CS-BUG-107 — an unanchored `/Roc/i` matches "Au**roc**hs", aborting the Zodiac Druid matrix at its FIRST checkpoint

**Status:** **Fixed** (harness/authoring defect — **not** a product bug).
**Surface:** `test/e2e/utils/tgttFeatureEffects.ts:441` → `ZODIAC_FORM_EFFECTS["Roc"]`

> **Correction to this entry's original surface.** It first named
> `test/e2e/specs/tgtt-hunter-zodiac-centaur.spec.ts` → `buildZodiacFormChecks()`.
> That is wrong, and the mis-attribution cost a round trip: the pool in
> `tgttFeaturePools.ts` was **already fully anchored** (`/^Roc$/i`,
> `/^Aurochs$/i`) *before* this entry was filed —
> `git show 71b64cde^:test/e2e/utils/tgttFeaturePools.ts` proves it, and
> `git show --stat 71b64cde` shows that commit touched **only**
> `known-bugs.md`. Reading the anchored pool and inferring the bug was
> fixed was itself an error; the failure still reproduced verbatim on a
> real run. The single unanchored pattern lived in a different,
> **hand-written** file (`tgttFeatureEffects.ts` states "These maps are
> NOT auto-generated"), which also retires the earlier claim that the fix
> belonged in generated code and was therefore out of reach.
>
> Re-derive rather than trust either file name:
> ```
> grep -rnE '/[^/^]*Roc[^/$]*/' test/e2e/ | grep -v '\^Roc\$'
> ```

**Fix:** anchor the pattern — `matchAny: [/^Roc$/i]`. Verified
`/Roc/i.test("Aurochs") === true` and `/^Roc$/i.test("Aurochs") === false`.

A sweep for the same substring-collision shape across **every** map in
that file — testing each `matchAny` pattern against every sibling key in
its own map — returns **no other collisions**. Roc/Aurochs was the only
instance.

### Symptom

`RUN_MATRIX=1` on `tgtt-hunter-zodiac-centaur` fails at L3:

```
featuresMatrix at L3 (1 failures):
  - L3 /Zodiac Form: Month/i (passive) effect pickActivatable: only 0 of expected
    >=1 matched picks could be activated.
    errors=[Aurochs: activateFeature(Aurochs): no visible Activate or Use control
    within 5s. diagnostic={"feature":true,"activationInfo":null,"activatable":false}]
```

Because the matrix throws on the first failing checkpoint, **checkpoints 5 / 11 /
17 / 20 have never executed on this spec.** Every assertion above L3 — including
the Wild Shape ladder, which its own comment flags as `UNVERIFIED` for exactly
this reason — is unproven, while the spec's other seven tests pass. This is the
inert-window failure shape arriving through a different door: not a row that is
never reached, but a whole spec truncated at its first checkpoint.

### Root cause (measured)

`ZODIAC_FORM_EFFECTS` (`test/e2e/utils/tgttFeatureEffects.ts:440`) attaches the
representative probe as an **unanchored** regex:

```ts
"Roc": [{kind: "pickActivatable", matchAny: [/Roc/i], min: 1}],
```

`/Roc/i.test("Aurochs") === true` — "Au**roc**hs" contains the substring. Aurochs
is a *different* constellation in the same 12-member L3 pool, and its documented
effect is a conditional STR-check advantage with no activatable control
(`ZODIAC_FORM_EFFECTS["Aurochs"] = []`). The probe therefore matches, and tries
to activate, a feature that was never meant to be activatable.

This is the mirror of the widening hazard already recorded against detector 4:
the fix for an unmatchable name is an **exact** name, never a looser regex,
precisely because a loose one matches more than intended.

### Second cause — anchoring alone may not be sufficient (NOT measured)

`js/charactersheet/charactersheet-combat.js:9807` deliberately drops Zodiac Form
from the generic activatable-states list:

> `// Druid Wild Shape / Wild Companion / Zodiac Form are handled by the`
> `// dedicated Druid Resources modal — drop them from the generic list`

gated on `this._page?._druidResourcesEnabled`. If that gate is live in the E2E
build, `Roc` is excluded from the same surface as `Aurochs` and anchoring to
`/^Roc$/i` will change *which* name the probe reports without making it pass —
i.e. `pickActivatable` is the wrong probe kind for this catalog, the same verdict
already reached for metamagic (CS-BUG-018, `pickToggleable`).

**This half is a hypothesis with a cited mechanism, not a measurement.** Whoever
takes it should anchor the regex first and re-run; if the failure merely renames
itself to `Roc`, re-target to the Druid Resources surface or drop the probe.

### Proven pre-existing

Not introduced by the CS-BUG-016 sweep, which touched only `spellInList` /
`spellSaveDc` / `cantripCount` rows in this spec. Reproduced at the pre-merge
commit `c87153b7` in a throwaway worktree: **byte-identical error text**, 1 failed
/ 1 passed (4.7m).

### Note on the surface

`test/e2e/utils/tgttFeaturePools.ts` is **auto-generated** (`scripts/genTgttPools.mjs`).
The editable sources are `scripts/_genTgttPools.helpers.ts` (`buildCatalogChecks`,
`buildZodiacFormChecks`) and `test/e2e/utils/tgttFeatureEffects.ts`
(`ZODIAC_FORM_EFFECTS`). Regenerate with `node scripts/genTgttPools.mjs` and
confirm the diff is otherwise empty — a stale pool is itself a known source of
false reds.

---

## CS-BUG-109 — the spell **cast output** still hand-rolls its own save DC, so item, custom and active-state DC bonuses vanish at the moment you cast

**Status:** **Fixed** — routed through the shared chokepoint and pinned on the
printed reading. Player-visible, and broader than the two DC bugs already fixed.

**Relationship to CS-BUG-099 / CS-BUG-102.** Those fixed two of *three* sites.
099 fixed the state API (`charactersheet-state.js:13160 / :13199 / :13219`,
each now adding `getBonusFromStates?.("spellDc")`). 102 fixed the Spells-tab
card (`_buildSpellClassCard()`, `charactersheet-spells.js:7826 / :7829`).
CS-BUG-102's own entry says the fix covered *"the tab a player actually casts
from"* — but the **cast output itself** is a third, separate computation that
neither fix reached.

**Root cause.** `charactersheet-spells.js:3906`, inside the cast flow:

```js
let saveDC = 8 + spellcastingMod + profBonus - exhaustionDcPenalty;
```

with (`:3847`, `:3856`) `profBonus = this._state.getProficiencyBonus()` raw, and
`spellcastingMod` assigned **conditionally** — `= rollTotal`, a fresh per-cast die,
in the Gambler branch (`:3858-3861`), and `= this._state.getAbilityMod(castingAbility)`
only in the `else` (`:3867`). *(An earlier revision of this entry cited the `else`
branch alone and called it "raw", which read as though the ability modifier were the
only possible value. It is not, and that omission is load-bearing — see* **Why the
accessor needed a parameter** *below.)* Only
the variant-component modifier is added afterwards (`:3911`). It never consults
`customModifiers.spellDc`, `itemBonuses.spellSaveDc`, or
`getBonusFromStates("spellDc")`.

The value is then printed to the player and recorded for the roll log:

```js
attackInfo += `<br>Save DC: <strong>${saveDC}</strong> …`;   // :3922
_rollMeta.dc = {total: saveDC, breakdown: `8 + ${spellcastingMod} + ${profBonus}…`};  // :3925
```

**Measured**, Sorcerer 5, CHA 18, `customModifiers.spellDc = 2`,
`itemBonuses.spellSaveDc = 1`, **no active state at all**:

| reading | value |
|---|---|
| `getSpellSaveDC("cha")` (state API, post-099) | **18** |
| Spells-tab card (post-102) | **18** |
| cast output / roll log (`:3906`) | **15** |

A 3-point disagreement from item + custom bonuses alone; an active-state buff
widens it further. So the card says 18, and clicking **Cast** on that same card
prints "Save DC: **15**" — the number the table actually plays with.

**Why this is wider than 102.** 102 was surfaced by an active-state toggle, so
its framing is buff-centric. This site drops **item** bonuses too, which means
plain published magic items are affected with no homebrew involved — Rod of the
Pact Keeper, Robe of the Archmagi, and anything else writing
`itemBonuses.spellSaveDc`.

**Suggested fix (historical — written before the fix; ⚠️ INCOMPLETE, superseded
by *Fix as landed* below. Kept because a reviewer implemented it literally and the
result is instructive; do not follow it in isolation).** Do not add three more terms
at `:3906` — that would be a *fourth* hand-rolled formula. Route it through the same
state chokepoint the other two now use (`getSpellSaveDcForAbility()` /
`getSpellSaveDC()`), then add the variant-component modifier on top, and update the
`_rollMeta.dc.breakdown` string so the printed derivation matches the printed total.

> **What this wording omits.** A bare `getSpellSaveDcForAbility(ability)` call uses
> `getAbilityMod(ability)`, which on the Gambler path **replaces a rolled die with a
> static modifier** — deleting that feature's mechanic on the only code path that
> implements it, and printing a self-contradicting `Save DC: 15 (🎲 1d8: 6)` because
> the roll badge at `:3922` survives independently. The landed fix therefore added
> `opts.abilityModOverride`. A second reader also derived a double-subtracted
> exhaustion term from this wording; that one the wording happens to avoid, but only
> because `exhaustionDcPenalty` stays live in scope at `:3848` and is re-interpolated
> into the breakdown at `:3925`, so an incremental patch can reintroduce it. Both are
> now pinned.
>
> Corrected instruction, for anyone re-deriving this: *route the **value** through the
> chokepoint, pass the rolled modifier in via `abilityModOverride`, and leave the local
> exhaustion variable to the breakdown string alone.*

**Note for whoever fixes it:** pin the **printed / roll-log reading**, not the
formula. The first CS-BUG-102 pin asserted `8 + mod + prof + stateBonus` by
hand and stayed green with the production fix neutralised (0 of 13,276 red) —
the "correct calculation that nothing reads" shape. `CharacterSheetSpellsTabDc.test.js`
shows the working pattern: stub the DOM **before** a dynamic `import()`, because
`charactersheet-spells.js:11` destructures `e_`/`ee` at module load.

### Fix as landed

`_handleSpellEffects()` no longer builds a save DC. It calls
`getSpellSaveDcForAbility(castingAbility, …)` — the same accessor the state API
and the Spells-tab card use — and then applies only the variant-component
modifier on top. The `castingAbility` derivation that already existed inside the
non-Gambler branch was hoisted so both branches can name it.

**Why the accessor needed a parameter.** Gambler spellcasting rolls a die *in
place of* the ability modifier, so the cast site genuinely cannot call the
no-argument accessor. Rather than let that justify a rival formula,
`getSpellSaveDcForAbility(ability, {abilityModOverride})` now substitutes **the
ability modifier alone**; proficiency, custom, item, active-state and exhaustion
terms are untouched. Before this fix a Gambler cast dropped those bonuses too.

**The breakdown string is derived by subtraction**, not re-summed:

```js
const dcOtherBonuses = saveDC - (8 + spellcastingMod + profBonus - exhaustionDcPenalty);
```

so a term added to the chokepoint in future appears in the printed derivation
without this call site being taught about it. Re-listing the bonuses by hand
here would have been the same fourth formula in display clothing.

### Falsification

Pin: `test/jest/charactersheet/CharacterSheetCastSaveDc.test.js` (8 tests). It
drives the real `_handleSpellEffects()` and reads back the two surfaces the
player sees — the `Save DC: <strong>N</strong>` in the cast toast and the
`Spell Save DC:` roll-history entry. It never recomputes the formula.

Both new code paths were broken in place, signatures intact, with the red count
predicted before it was measured:

| break | predicted | measured |
|---|---|---|
| `saveDC` back to `8 + spellcastingMod + profBonus - exhaustionDcPenalty` | 4 red | **4 red** — `Expected: 18 / Received: 15`, the reported case verbatim |
| `abilityModOverride` ignored (`const abilityMod = this.getAbilityMod(ability)`) | 1 red | **1 red** — `Expected: 12 / Received: 15` |

No `TypeError`/`ReferenceError` in either; every red is a wrong-value assertion.

Two rows stay green under the first break **by design** and are labelled as
controls: the `PREMISE` row (proves the save-DC branch is reached at all, so the
other assertions are not comparing `null` to `null`) and the no-bonus baseline
(correct in both directions — it is the case the old formula got right). The
second break leaves the Gambler bonus-stacking row green because that row
measures a *delta*, which the override does not change; the row it does move is
the one that pins the substitution itself.

### The two traps in the obvious repair

A reviewing session, reading only the *plan* ("route `:3906` through the shared
chokepoint"), independently derived two ways that instruction ships green while
being wrong. Both are avoided in the landed fix, but the plan as worded does not
say so, and the literal reading of it produces both. Recorded here because the
next person to touch this line will read the sentence, not the diff.

> **The review caused the fix's shape — it did not merely agree with it.**
> Measured, because the opposite was asserted once and was wrong:
> `git log -S'abilityModOverride'` puts its first appearance in `f86af94e` at
> **18:47**, and `git show 3c529e2e:…charactersheet-state.js | grep -c
> abilityModOverride` returns **0** — that being the tree the reviewer measured
> at 18:04. Their citation of the old `8 + prof + getAbilityMod(ability)` form
> was live code, not a stale line number, and `f86af94e`'s own message encodes
> their objection ("*which is why it cannot use the no-argument accessor*").
> **"Your citation is stale" is the reflexive diagnosis in a fast-moving trunk,
> and applied wrongly it erases the cause of the fix** and tells the reader no
> action was needed. Two commands settle it: `git log -S <symbol>` for when the
> change landed, `git show <their-sha>:<file>` for what they actually saw.

**Trap 1 — exhaustion subtracted twice.** `exhaustionDcPenalty` exists on *both*
sides. `getSpellSaveDcForAbility` already subtracts it
(`charactersheet-state.js:13172` / `:13180`), and the cast site still reads it
locally. A route-through that keeps the local term *in the value* penalises an
exhausted caster twice. Only a **Thelemar-rules** exhausted caster can reach it,
so it fails no other configuration. The landed fix keeps the local variable for
the *breakdown string only* and derives the residual by subtraction
(`dcOtherBonuses`), so the value passes through the chokepoint exactly once.

**Trap 2 — Gambler spellcasting flattened.** `charactersheet-spells.js:3861`
assigns `spellcastingMod = rollTotal` — a fresh die rolled per cast. A bare
`getSpellSaveDcForAbility(ability)` call uses `getAbilityMod(ability)` and would
replace the rolled modifier with a static one. That is not a rounding error; it
deletes the feature's whole mechanic on the only path that implements it. This
is why `opts.abilityModOverride` exists, and why it overrides **the ability mod
alone** rather than the DC.

Amended plan wording, for anyone re-deriving this: *add the shared **bonus**
terms at the cast site by routing the value through the chokepoint, passing the
rolled modifier in as an override, and leave the local exhaustion variable to the
breakdown string.*

Trap 1 was correct in the landed code but **unpinned** — the pin had a Gambler
block and no exhaustion case. Three rows added, and the trap broken in place to
prove they bite:

| break | predicted | measured |
|---|---|---|
| `getSpellSaveDcForAbility(...) - exhaustionDcPenalty` at the cast site | 2 red | **2 red** — `Expected: 12 / Received: 9` and `Expected: 16 / Received: 14` |

The `PREMISE` row (exhaustion actually moves the canonical DC under Thelemar
rules) stays green by design: it reads the accessor, not the cast output, so it
proves the fixture reaches the penalty at all rather than comparing an unchanged
number to itself.

---

## CS-BUG-110 — CS-BUG-104's fix is prospective, so a character saved before it keeps the duplicate choose-one rows forever

**Status:** Open. Display-only. Measured end-to-end by the `plan-cs-bug-018-skips`
session; the *proposed* repair in that report is recorded below **and corrected**,
because it does not fix either measured case.

**Reproduction (a full round trip, not an inference).** On the fixed tree:

```
1. materialise the TRUE pre-fix tree — `git checkout c188b94b^ -- \
     js/charactersheet/charactersheet-class-utils.js \
     js/charactersheet/charactersheet-state.js`
2. spawn cleric/life domain/7, export toJson()   -> Blessed Strikes children = 2
3. restore the fix
4. load that JSON on the FIXED tree              -> still 2: ["Divine Strike","Potent Spellcasting"]
```

> **⚠️ Method note on step 1.** An earlier draft of this reproduction said
> *"revert the CS-BUG-104 delegation"*. CS-BUG-104's fix is **two coupled edits**
> — `getChoiceOptionNames()` in `charactersheet-class-utils.js` **and** the
> `continue` at the materialisation call site — so reverting one of them yields a
> **hybrid tree matching no commit that has ever existed**. The conclusion here is
> unaffected (materialisation is 2 rows on either tree), but the *recording* count
> differs between them, so anyone extending this repro from the old wording gets a
> different answer than the entry implies. That exact hybrid is what produced the
> since-corrected `recording: correct` row in CS-BUG-104. Use `c188b94b^`, and
> confirm with `grep -c 'choiceOptionNames' js/charactersheet/charactersheet-class-utils.js`
> → **0** on the pre-fix tree.

**Root cause.** `_migrateFeatures()` (`charactersheet-state.js:6546`) is a
`.map()` over the stored `_data.features` array:

```js
this._data.features = this._data.features.map(f => { … });
```

A `map` can transform a row and can never remove one, and nothing else in
`loadFromJson` re-derives features from class data. So CS-BUG-104 corrected the
**derivation** while leaving the **stored result** untouched. Any Cleric 7+
saved before `8839135c` still renders three rows at L7, and a TGTT Time Domain
Cleric 8 still shows Potent Spellcasting twice.

### ⚠️ The obvious repair does not work — do not ship it

The originating report proposed *"a one-line dedup in `_migrateFeatures` keyed
on `(name, parentFeature, level)`"*. That key is inert on both measured cases,
by the report's own output:

| case | rows | why the key keeps both |
|---|---|---|
| `cleric/life domain/7` | `["Divine Strike", "Potent Spellcasting"]` | **different names** — these are two *options* of one choice, not two copies of one row |
| `cleric/time domain/8` | Potent Spellcasting ×2 | same name, but **levels 7 and 8** — `level` is in the key |

The stored defect is an **over-grant of a choose-one group**, not a duplicated
row, so no identity-based dedup can see it. A correct repair has to re-derive
the group and keep the chosen option — and that is harder than it looks, because
branch (b) of the choice seeder (`charactersheet-class-utils.js`, the
`appliedFeatures.forEach(_recordChosenSubfeature)` path) records a chosen
subfeature for **every materialised row**. A pre-fix save therefore has *both*
options recorded as chosen, so `chosenSubfeatures` cannot arbitrate. (Same
circularity already noted in CS-BUG-104's evidence section.)

**Severity is display-only and unchanged from CS-BUG-104's own finding:** the L7
rows assign no calc keys, and `blessedStrikesDamage: "1d8"` comes from the
surviving row either way. Filed rather than fixed because a wrong one-liner here
would look like a fix, pass a dedup-shaped test, and change nothing.

### It does not self-heal on level-up — measured through the real wizard

The open question above was whether a subsequent level-up would re-derive the
row set and silently repair a pre-`8839135c` save. **It does not.** Measured by
the originating session through `levelUpTo` (a real wizard run, not a state
poke):

```
after load     {"blessedStrikes":["Divine Strike","Potent Spellcasting"], "lvl":7}
after LEVEL-UP {"blessedStrikes":["Divine Strike","Potent Spellcasting"], "lvl":8}
```

So the duplicate is **permanent for the life of the save**, through any number
of level-ups.

Two mechanisms, both verified here rather than taken from the report — the
second is more specific than the report states:

1. **`addFeature` cannot see it.** `charactersheet-state.js:36414` dedups on
   `(name, source, className, level)` and the very first line of the predicate
   is `if (f.name !== feature.name) return false;`. The two stored rows are
   *different names*, so the dedup declines on its first comparison.
2. **There IS an earlier-level backfill, but it is gated off for a loaded
   save.** `charactersheet-levelup.js:4440-4450` loops
   `for (let earlierLevel = 1; earlierLevel < newLevel; …)` and recomputes
   `getLevelFeatures` for every earlier level — but only inside
   `if (!alreadyHadSubclass)` (`:4439`), which exists so the backfill fires
   exactly once, at subclass acquisition. A Cleric 7 loaded from JSON already
   has a subclass, so it never runs. **And it is doubly incapable if it does
   run** — two independent reasons, and the *earlier* one is the one a reader
   trips over:
   - **(a) It never sees these rows.** The line above the push is
     `const earlierSubclassFeatures = earlierFeatures.filter(f => f.isSubclassFeature);`
     (`charactersheet-levelup.js:4448`; the same filter guards the second
     backfill site at `charactersheet-quickbuild.js:4795`). Blessed Strikes is a
     **`classFeature`**, and the `extracted.push({…})` block that stamps
     `parentFeature` (`charactersheet-class-utils.js:3401-3410`) sets no
     `isSubclassFeature` key at all. The five `isSubclassFeature: true` sites
     (`:3435`, `:3475`, `:3517`, `:3553`, `:3621`) are all on the *subclass*
     path. Measured through the pin's own `materialise()` helper, so no browser
     was involved:

     ```
     Rogue XPHB 5, parent "Cunning Strike"  -> 3 rows, all isSubclassFeature=undefined
       Poison (Cost: 1d6) / Trip (Cost: 1d6) / Withdraw (Cost: 1d6)
     Monk  XPHB 2, parent "Monk's Focus"    -> 3 rows, all isSubclassFeature=undefined
       Flurry of Blows / Patient Defense / Step of the Wind
     ```
   - **(b) Even if it saw them, the body is
     `newFeatures.push(...earlierSubclassFeatures)`** — it can only add rows,
     never remove one. Firing it would produce a *third* row, not heal the pair.

   **Why (a) is worth stating and not a footnote.** (b) alone invites the repair
   *"make the backfill replace instead of push"*. That repair would still do
   nothing, because the filter excludes these rows before the push is reached.
   Recording only (b) forecloses one wrong one-liner (the `addFeature` dedup) and
   leaves a second one open. Correction contributed by the
   `plan-cs-bug-018-skips` session; the "it can only add" half was mine and was
   accurate but not the operative gate.

> **Probe hygiene, from the same investigation.** The first attempt at this
> measurement called `st.addClassLevel?.("Cleric")` and reported "features len
> delta 0". `grep -rn 'addClassLevel' js/charactersheet/` returns **nothing** —
> the optional chain silently no-op'd, and the probe would have reported the
> right conclusion on the strength of a call that never executed. Generalised
> rule: **`?.` on the object under test converts "this API does not exist" — the
> single most interesting possible result — into a silent pass, and must not
> appear in a probe.**

### Also recorded: a benign state-shape change from the CS-BUG-104 fix

Cunning Strike's `chosenSubfeatures` went **3 → 0** (branch (b) no longer runs,
since narrowing means no group is produced). `_data.features` rows are
unaffected, and display and mechanics read those, so this is believed benign —
recorded because it will show up in save diffs and should not surprise the next
reader.

## CS-BUG-111 — the rest-restore probes have a silent-pass branch; measured reachable, exercised 24×, fired 0×

**Status:** Open, latent. **Do not "fix" this without re-running the measurement
below** — the branch is currently inert, and converting it to a throw changes
behaviour for every `restoreOn` / `*RestRestores` row in the suite (59 + 113
occurrences) in exchange for nothing presently observable.

Flagged by the `cs-bug-016-spell-autofill-sweep` session and explicitly handed
off unfixed. Measured here before recording, because "reported not fixed" with
no measurement invites a harmful repair.

**The shape.** Two sites spend one charge, then bail silently if the spend
appears not to have happened:

```
comprehensiveBuildHelpers.ts:1563   if (afterSpend.current >= before.current) return;   // soft skip
comprehensiveBuildHelpers.ts:2424   if (afterSpend.current >= before)        { break; } // soft skip
```

A bare `return`/`break` — nothing logged, nothing counted. If the spend is a
no-op the entire rest-restoration assertion is skipped and the test passes. The
correct shape already exists **nineteen lines below the first site**:
`:1582` is `if (!await charSheet.spendFeatureUse(e.feature)) throw …`.

### Measurement — a positive control, not an absence of failures

Instrumented both branches to throw, ran four resource-dense specs: **0 throws,
24 passed / 8 skipped — byte-identical to the un-instrumented run.**

That result was *ambiguous and nearly recorded as a clean negative.* Re-ran with
a log line at branch entry instead of a throw: **zero `REACHED` lines.** The
lines had never executed. These rows live in `FeatureCheck` matrices evaluated
by `assertFeaturesMatrix`, which is gated at `characterSpecFactory.ts:389`
behind `RUN_MATRIX` — one of the tests that had been *skipped*. The instrument
had been aimed at a path the run could not reach.

With the gate on (`RUN_MATRIX=1`, `tgtt-battle-master-fighter`):

```
REACHED-1563 Second Wind     2->1, 3->2, 4->3, 5->4   fires=false   (7×)
REACHED-1563 Action Surge    1->0                     fires=false   (3×)
REACHED-1563 Superiority Dice 4->3                    fires=false   (2×)
REACHED-2424  … identical distribution                fires=false  (12×)
                                                       7 passed (11.2m)
```

**Reachable, exercised 24 times, fired 0 times** — every spend decremented. So
the soft spot is a real latent hazard and is masking nothing measured today.

> **The methodological point is the more valuable half.** The first run's
> "0 throws / 24 passed" looked exactly like a clean negative and was in fact a
> non-execution. An instrument that never runs reports the same thing as an
> instrument that runs and finds nothing. **A falsification instrument needs a
> positive control proving it executed** — same family as `?.` on the object
> under test (CS-BUG-110), `--strict` exit codes, and `getFeatures()` under
> Jest, and the reason a "soft skip" must log rather than return bare.

**If this is ever repaired**, the repair is to *log and count* the soft skip so
it is visible in the run, not to throw — and the fix must be re-measured with
`RUN_MATRIX=1`, since without it the affected lines do not execute at all.
