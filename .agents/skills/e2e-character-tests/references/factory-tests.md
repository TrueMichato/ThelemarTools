# Factory Tests Reference

`test/e2e/utils/characterSpecFactory.ts` is the heart of the E2E
suite.  A `CharacterSpec` (or `MulticlassCharacterSpec`) declaratively
describes a build; the factory generates the canonical 7-test set.
This document maps each generated test back to a coverage check.

## Single-class — `describeCharacter(spec)`

| Generated test | Standard checks | Cost | Skipped when |
|---|---|---|---|
| `L1: creates {displayName} via builder wizard` | #1, #5 (smoke part) | 30-45 s | never |
| `L3: subclass arrives and registers feature` | #2 | 60-90 s | never |
| `L5: extra attack / 3rd-level slots / prof +3` | #3 | 90-180 s | never |
| `L5 loadout: installs gear + signature toggle changes derived stats` | #4, #5 | 120-180 s | `midTierLoadout` and `signatureToggle` both omitted |
| `MEGA L1→20: cast / attack / resource / rest milestones` | #6 | 3-6 min | `skipMega` set or `RUN_MEGA` env unset |
| `USE: cast/attack/resource/rest at L${atLevel}` | #7-#16 | 30-120 s | `usage` omitted; individual probes when `{skip: true}` |
| `L1 export round-trip preserves identity` | #17 | 20-30 s | never |

## Multiclass — `describeMulticlassCharacter(spec)`

| Generated test | Standard checks | Cost | Skipped when |
|---|---|---|---|
| `builds full multiclass plan and reaches final milestone` | #1, #6 multiclass variant, #18 | 6-10 min | `RUN_MEGA` env unset |

The multiclass test runs:

1. L1 build via primary class preset.
2. Loop over `plan` legs:
   - For leg 0: `levelUpTo(toTotalLevel)` directly.
   - For legs 1+: `startMulticlass(className, classSource)` then
     `levelUpTo(toTotalLevel)`.
3. After each leg, if `usageAfterEachLeg[idx]` exists, runs the
   `_runMulticlassUsageProbe` helper (a slimmer version of the USE
   block: spell slot, resource, attack, skill).
4. Final assert against `finalMilestone`.

## `usage` probe blocks (within USE test)

The USE test runs ALL applicable probes inside one `test(...)` (one
build, multiple checks).  Order of execution:

1. **`castSpellSlotLevel`** — verifies slot decrements by exactly 1.
2. **`useResourceName`** — verifies named resource decrements.
3. **`attackName`** — finds matching attack in `getAttackNames()`,
   asserts `clickAttackRoll()` returns true.
4. **`expectLongRestRestores`** — long rest, assert slot back at max.
5. **`skillRoll`** — `rollSkill(name)` returns finite bonus,
   `expectBonusAtLeast` if specified.
6. **`shortRestRestores`** — pre-spend the resource (if needed),
   `triggerShortRest`, assert restored to `expectAfter`.
7. **`concentrationCheck`** — `startConcentration(spell, level)`, then
   either `dealDamage(50)` or activate Rage, then assert
   `getConcentrationStatus().active === expectActive`.
8. **`deathSaves`** — mark 1 success + 1 failure, assert counters,
   `resetDeathSaves`, assert zero.
9. **`applyCondition`** — apply, `hasCondition`, optionally check
   derived effect (e.g. speed = 0 for Paralyzed).
10. **`featAbility`** — toggle feat, expect derived stat delta.

Each probe has a try/catch that logs `[USE-PROBE]` warnings to console
without aborting the test.  A probe failure is a hard fail only if the
assertion library throws, not if the API returns a soft error.

## `{skip: true}` semantics

```ts
usage: {
  concentrationCheck: {skip: true},  // monks have no concentration spells
}
```

generates inside the USE test:

```ts
test.skip("concentration probe skipped: monks have no concentration spells");
```

— making the gap visible in the report without polluting it with red.

If the *entire* `usage` block is `usage: {skip: true}`, the whole USE
test is skipped (use only when blocked by a CS-BUG that prevents the
build from reaching the probe level).

## How effect probes run

`featuresMatrix` entries with `effects: [...]` are dispatched inside
the L3 / L5 / MEGA tests by `assertFeaturesMatrix` in
[`comprehensiveBuildHelpers.ts`](../../../test/e2e/utils/comprehensiveBuildHelpers.ts)
(see the Phase 7 effect dispatcher, ~line 1144).  Two effect families:

- **Passive / roll effects** (`saveBonus`, `skillBonus`, `ac`, `speed`,
  `initiative`, `spellSaveDc`, `advantage`, `resistance`, `immunity`,
  `vulnerability`, `attackPresent`, `attackBonus`,
  `attackDamageContains`, `pickActivatable`, `pickToggleable`,
  `rollAbilityCheck`, `rollSkillCheck`, `spells`, …) run individually
  against the page in the order declared.
- **Toggle deltas** (`toggleAcDelta`, `toggleSpeedDelta`,
  `toggleSaveDelta`, `toggleSkillDelta`, `toggleAttackDelta`,
  `toggleDamageDelta`, `toggleGrantsAdvantage`, …) are batched: the
  helper snapshots derived stats, toggles the matched feature on,
  re-snapshots, asserts the deltas, toggles off, asserts restore.

### `pickedFeatureGrants` (Phase 11)

When a `kind: "pick"` row uses
`{kind: "pickedFeatureGrants", pickName, subEffects}`, the dispatcher
checks whether the named pick actually surfaced on the sheet (via
`allFeatures` regex match).  If yes, it expands `subEffects` into the
concrete probes above; if no, it silently no-ops (backward-compatible
with specs that don't yet declare per-pick effects).  Nesting is
forbidden — a `subEffects` element with `kind: "pickedFeatureGrants"`
is dropped.

This is how the TGTT pool helpers (`buildSpecialtyChecks`,
`buildBattleTacticChecks`, `buildMetamagicChecks`, …) attach per-pick
effects for the auto-picker's deterministic first choice.  See
[`tgttFeaturePools.ts`](../../../test/e2e/utils/tgttFeaturePools.ts)
(auto-generated) and
[`tgttFeatureEffects.ts`](../../../test/e2e/utils/tgttFeatureEffects.ts)
(hand-written).

## Adding a new probe category

1. Add a new method to `CharacterSheetPage` (see `page-objects.md`).
2. Add new optional field to `CharacterSpec.usage` interface.
3. Add probe block inside the USE test in `describeCharacter`.
4. If applicable to multiclass: add to `_runMulticlassUsageProbe`.
5. Update the standard table in `references/standard.md` (the
   numbered required-checks list — give it a number).
6. Update this file's coverage map.
7. Update `spec-template.md` placeholder.
8. Touch every existing TGTT spec to either populate the new field or
   `{skip: true}` it with a reason.

## What the factory does NOT do

- Doesn't pick races / classes — that's `characterBuilder.ts` presets.
- Doesn't auto-mark known product bugs as expected failures.  If a
  CS-BUG blocks a check, the spec must `{skip: true}` it.
- Doesn't retry on infra failures.  Flakes get fixed at the page-object
  level (conservative timings, state-stable polling).
