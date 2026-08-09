# E2E Troubleshooting

How to tell **infrastructure failures** (the test, page object, or
factory has a bug) apart from **product bugs** (the character sheet
actually broken), and how to fix the former.

## Decision tree

When a test goes red:

1. **Look at the error message.**
   - `Test timeout of Nms exceeded` → almost always infra (Bucket A or B).
   - `Target page, context or browser has been closed` → infra (parent
     test died, this is a downstream effect).
   - `expect(locator).not.toBeVisible() failed` for the level-up wizard
     → infra; the wizard isn't being closed. Either `finish()` is
     racing or a follow-up modal is hanging.
   - `Could not find subclass "X" with source "Y"` → infra; the spec
     uses the wrong subclass display name (XPHB vs PHB drift).
   - Specific assertion (`expect(slots.current).toBe(...)`) on a
     concrete game stat → likely a product bug. Triage before assuming
     infra.
   - A derived number wrong by a *small, level-dependent* amount, only
     in MEGA → suspect probe residue, not the sheet. See "Probe
     residue" below. Two consecutive misdiagnoses came from this shape.

2. **Ask what the probe did before it measured.**
   Does the feature under test, or an earlier row at the same level,
   cycle a state? Does that state declare `endSave`? A probe that
   changes the character invalidates every later assertion at that
   level and above.

3. **Re-run the single failing test in isolation.**
   ```bash
   npx playwright test test/e2e/specs/tgtt-X.spec.ts --reporter=list -g "L5 loadout"
   ```
   If it passes alone, the suite has parallelism contention (Bucket A
   pattern). If it fails alone, it's deterministic — easier to triage.

4. **Stash all `e2e/` changes and reproduce on the previous baseline.**
   If it still reproduces, it's a product regression (or pre-existing).

## Catalogued infra patterns

### Modal races

- **Symptom**: `levelup-wizard` still visible 10s after `finish()`.
- **Root cause**: a follow-up modal (Skip-Spell prompt, ASI overflow
  warning) opens after the main wizard closes; the page-object
  `finish()` polled only the main one.
- **Fix**: the Phase 3 polling sweep (max 2s, 100ms steps) catches
  this. If it recurs, extend `finish()` to dismiss any visible
  `.ve-ui-modal__inner` after the wizard close.

### autoFill timing

- **Symptom**: `levelUpTo` times out around L5-L7 on heavy classes
  (Bard, Sorcerer, Wizard).
- **Root cause**: fixed `waitForTimeout` calls compounded
  (3 × 300ms + 8 × 150ms + 4 × 250ms + 6s) = ~50s/level on contention.
- **Fix**: the Phase 3 rewrite uses state-stable polling
  (`waitForFunction(() => allCountersStable)`). If it recurs after
  adding a new picker type, port the pattern instead of adding a
  fixed wait.

### Class picker bypass

- **Symptom**: level-up wizard opens for the wrong class on
  multiclass leg 1+.
- **Root cause**: `cs.btnLevelUp.click()` opens a class picker first
  when multiple classes are present; the page object used to short-circuit
  this.
- **Fix**: `pHandleLevelUpClassPicker` only fires when wizard is NOT
  already visible (the established Phase 3 invariant — DO NOT regress).
  For multiclass, prefer `cs._levelUp.showLevelUp(className)` direct
  call when `targetClassName` is set.

### Multiclass entry off-by-one

- **Symptom**: `startMulticlass` then `levelUpTo(N+Y)` runs an extra
  level, or starts from the wrong base.
- **Root cause**: `#charsheet-btn-multiclass` auto-grants the new
  class at L1; `levelUpTo` reads `startLevel` BEFORE this happens.
- **Fix**: page-object `startMulticlass` re-reads `getTotalLevel` after
  the multiclass modal closes; `levelUpTo` recomputes from current
  level on entry.

### "Target page closed" cascade

- **Symptom**: a downstream test fails with `Target page, context or
  browser has been closed`.
- **Root cause**: a previous test in the same worker timed out,
  Playwright tore down the worker context, the next test inherits a
  dead page.
- **Fix**: not in the downstream test — fix the upstream timeout. If
  it's a known unfixable product bug, mark the upstream `test.skip`
  with a CS-BUG reference.

### XPHB / PHB naming drift

- **Symptom**: `Could not find subclass "Way of Mercy"` (it's
  "Warrior of Mercy" in XPHB / TGTT-2024).
- **Symptom**: milestone regex `/perfect self|empty body/i` never
  matches at L20 (those are 2014 PHB Monk capstones; 2024 has "Body
  and Mind").
- **Fix**: cross-check display names against the actual data file
  (`data/class/class-monk-tgtt.json` etc.) before authoring a spec.
  Use `/{2024-name}|{2014-name}/i` regex when supporting both editions.

### Workers contention

- **Symptom**: tests pass at `--workers=1`, fail at `--workers=2`.
- **Root cause**: heavy specs racing for CPU; the floor of mandatory
  waits adds up.
- **Fix**: drop the slow test's `test.timeout` to fail-fast (240s),
  or mark `test.serial` for the heaviest sibling specs (Bard,
  Sorcerer, Wizard L5-loadout).

### Probe residue (the probe changed the character it measures)

- **Symptom**: a derived number is *slightly* wrong, only at high
  levels, only in MEGA, and the same probe passes at L1/L3/L5. The
  amount it's wrong by grows with level. Classic false readings:
  "proficiency bonus isn't applied to this DC" and "the DC is off by
  one".
- **Root cause**: a probe activated and deactivated a state, and the
  deactivation *mutated the character* rather than clearing a flag. Any
  state type declaring `endSave` rolls a saving throw on the way out and
  applies its failure consequence — the Belly Dancer's Dance of the
  Country is a DC 10 CON save or a level of exhaustion. `assertFeatures-
  Matrix` cycles states in three places (the toggle branch, `stateCall`
  effects on `passive` rows, and the gated second reading), so across a
  20-rung walk the failures accumulate. Under Thelemar exhaustion rules
  each level is **-1 to every feature DC and every d20**, so by L17 the
  later assertions describe a character that no longer exists.
- **Fix**: already handled — `assertFeaturesMatrix` snapshots exhaustion
  on entry and restores it per entry, after the gated block, and at the
  end. If you add a probe path that cycles states **outside** that
  function, restore there too.
- **Tell it apart from a real bug**: read the number's *delta*, not the
  number. A missing PB is a constant offset at a given level; probe
  residue grows monotonically with how many rungs the walk has taken.
  Check `getExhaustion()` in a diagnostic dump before filing anything.
- **The wider rule**: a probe must OBSERVE the character, not change it.
  Before concluding "the sheet computed this wrong", ask what the probe
  itself did to the sheet on the way to the measurement.

### An assertion floor that presumes a good stat

- **Symptom**: a `min`/`exact` effect check fails on a build that dumps
  the relevant ability, and the "expected" value is one no such build
  could reach.
- **Root cause**: the floor was written against an idealised build. Two
  live examples, both on the Belly Dancer, whose Jaknian dumps Charisma:
  `togglePlusAc` asserted the raw CHA mod (-1) for a feature that grants
  "+CHA to AC, **minimum +1**"; and the Percussive Strike DC carried
  `min: 15` when 8 + PB + CHA is 13 for that character.
- **Fix**: use `togglePlusAc`'s `floor` for min-capped bonuses, and set
  numeric floors from the build's own statistics. Prefer a
  `featureCalculationDerivedFrom` check — it pins the *derivation*, which
  is what rules out a hardcoded constant, and doesn't rot when a build's
  ability array changes.
- **This is spec-side, not a product bug.** The failure mode is nasty
  precisely because a probe fails on exactly the build whose floor
  behaviour it was meant to cover.

## Real product bug indicators

Trust an assertion that:

- Names a concrete game mechanic (`Bladesong didn't appear in
  toggleable features at L3`).
- Reproduces from a clean checkout (no e2e changes).
- Has a documented PHB/XPHB/TGTT specification it's violating.
- Is reproducible by clicking through the sheet manually.

When confirmed:

1. Add `CS-BUG-NNN` to `docs/charactersheet/known-bugs.md`.
2. Set the relevant probe to `{skip: true}` with `// blocked by
   CS-BUG-NNN`.
3. **Do not loosen assertions** to make red go green over a real bug.

## Diagnostic dumps

`LevelUpPage.waitForModal` and `LevelUpPage.finish` log diagnostic
state on timeout. Pattern when adding new modal-driven page-object
methods:

```ts
try {
  await condition;
} catch (e) {
  console.warn("[E2E-DUMP]", await page.evaluate(() => ({
    modalsVisible: [...document.querySelectorAll(".ve-ui-modal__inner")]
      .filter(m => (m as HTMLElement).offsetParent !== null)
      .map(m => m.id),
    classes: globalThis.charSheet?._state?.classes,
  })));
  throw e;
}
```

## Useful commands

```bash
# Single spec
npx playwright test test/e2e/specs/tgtt-X.spec.ts --reporter=list

# Single test by name pattern
npx playwright test test/e2e/specs/tgtt-X.spec.ts -g "L5 loadout" --reporter=list

# Full suite with MEGA paths
RUN_MEGA=1 npx playwright test test/e2e/specs/tgtt-*.spec.ts \
  --reporter=list --workers=2

# Open last HTML report
npx playwright show-report

# Trace viewer for the latest failure
npx playwright show-trace test-results/.../trace.zip
```

## When to ask for help

Stop and report when:

- An infra failure resists diagnosis after two Phase-3-style fixes.
- A "product bug" is too easy to fix and you suspect it's actually
  infra (often the case for first-time spec authors).
- The known-bugs.md entry would be a fundamental redesign of the sheet.
