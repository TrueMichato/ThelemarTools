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

### Toggle re-render mid-click

- **Symptom**: `activateFeature` times out with
  `locator.click: Timeout 5000ms exceeded` and a call log that reaches
  `performing click action` and stops — while the failure snapshot shows
  the feature is **already in "Currently Active"**.
- **Root cause**: flipping a toggle re-renders the whole Active States
  panel, so the Activate button detaches mid-click. Playwright treats
  that as an unconfirmed click, retries, and waits forever for a
  `.charsheet__activate-btn` that legitimately no longer exists.
- **Fix**: already handled — `CharacterSheetPage.activateFeature`
  catches the click error and swallows it when `isFeatureActive()` is
  true. If you add a new toggle path, use the same click-then-verify
  pattern rather than a bare `click()`.

### Feat sub-choices block the level-up wizard

- **Symptom**: `expectModalClosed` fails at TGTT L4+; Finish refuses to
  close the wizard.
- **Root cause**: at TGTT L4 the auto-picked "Ability Score Improvement"
  *feat* renders its own `Additional Choices for …: Choose ability to
  increase by 2:` button grid, which nothing used to drain.
- **Fix**: already handled — `LevelUpPage.autoFillRequiredChoices` has a
  generic feat-sub-choice drainer that scans
  `.charsheet__levelup-feat-choices, .charsheet__opt-feat-progression-choices`,
  reads the want-count from the `Choose N …` prompt, and clicks one
  unselected option per pass (the grid re-renders on every toggle).
### A batch-only timeout that passes standalone

- **Symptom**: a MEGA/matrix test dies with a bare `Test timeout of
  Nms exceeded`, followed by a cascade of `Target page, context or
  browser has been closed` errors attributed to individual matrix rows.
  The row list looks like a dozen simultaneous feature regressions.
- **Root cause**: the walk simply ran out of clock. Under batch
  contention a single level-up step stretches from ~4s to ~9s, which is
  enough to double a 20-rung walk.
- **Tell it apart from a real bug**: re-run the ONE spec alone. Measured
  examples: the Chained Fury matrix takes 4.5 min alone and The Horror
  Warlock 3.8 min, and both blew a 6-minute budget inside a multi-spec
  batch while passing unchanged on their own. A genuine failure names a
  mechanic and reproduces standalone; this one evaporates.
- **Never triage the cascade rows.** Everything after "page closed" is
  noise from the teardown, not evidence. Read the FIRST error only.

### The auto-filler's own picking bias

- **Symptom**: a level-gated choice cannot be completed — e.g. Wizard
  Spell Mastery (L18) or Signature Spells (L20) reporting a slot with no
  eligible spell.
- **Root cause**: spell-picker sections are one per spell level in
  ascending DOM order, so "click the first addable `+`" always lands in
  the level-1 section, which never exhausts. Measured: a Bladesinger
  walked to L17 that way had a spellbook of `{L0:3, L1:38}` — not one
  level-2 spell — so the level-2 mastery slot genuinely had no candidate.
- **Tell it apart from a real bug**: dump the character's spells grouped
  by level. If the distribution is degenerate (everything at one level),
  the harness built an impossible character and the product is correctly
  refusing it. A player picking normally would never hit this.
- **The wider rule**: when a late-game feature has no valid input, check
  what the harness fed the build on the way up before blaming the
  feature.

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

## "Not enough <Feature> remaining" — disabled Activate button in the features matrix

**Symptom.** A `featuresMatrix` row with toggle effects fails at a *later*
checkpoint than the one it was declared for:

```
featuresMatrix at L11 (1 failures):
  - L6 /eyes of the future past/i (toggle) could not activate to probe toggle
    effects: locator.click: Timeout 5000ms exceeded
    locator resolved to <button disabled title="Not enough … remaining" …>
```

**Cause — infra, not product.** `assertFeaturesMatrix` re-evaluates *every*
earlier row at each later checkpoint. A toggle sitting on a small pool
(e.g. `max(1, wisMod)` on a preset that leaves the ability at 10) is drained by
the probe's own earlier activation, so the Activate button is legitimately
disabled by the time the row runs again.

**Fix (already in `comprehensiveBuildHelpers.ts`).** The toggle branch calls
`charSheet.triggerLongRest()` before taking the `before` snapshot. This costs
no coverage: pool sizing is asserted separately by `featureUsesEqualAbilityMod`
and `kind: "resource"`.

**Do not** "fix" this by narrowing the row to a single level — that hides the
re-evaluation, which is exactly what caught CS-BUG-116 (states never re-applied
their conditions on a *second* activation). The repeat is the valuable part.

**Tell it apart from a real bug:** if the button is *enabled* and activation
succeeds but the effect reads wrong on the second cycle, it is a product bug.
If the button is *disabled* with a "not enough remaining" title, it is pool
exhaustion.

---

## A batch-level flake exists in the 5-spec serial run — confirm before chasing

**Observed:** running the five TGTT batch-3 specs together
(`tgtt-belly-dancer-rogue-jaknian`, `tgtt-chained-fury-barbarian-minotaur`,
`tgtt-gambler-rogue-clairnian`, `tgtt-jester-bard-dendulra`,
`tgtt-time-domain-cleric`) with `--workers=1`, one run in three reported

```
2 failed
  Chained Fury Barbarian Minotaur › L5: extra attack / 3rd-level slots / prof +3
  Chained Fury Barbarian Minotaur › L5 loadout: installs gear + signature toggle …
```

**Measurement, so the next person does not re-derive it:**

| Invocation | Result |
|---|---|
| 5 specs, `--workers=1` (run 1) | 30 passed, 0 failed |
| 5 specs, `--workers=1` (run 2) | 28 passed, **2 failed** |
| 5 specs, `--workers=1` (run 3) | 30 passed, 0 failed |
| `-g "L5"` alone | 3 passed |
| Full Chained Fury spec alone | 6 passed, 2 skipped, 0 failed |
| 5 specs, `--workers=2` | 1 failed — a *different* test (Gambler L5), also non-reproducing |

**The cause is not established.** The failing run's artifacts were overwritten
by the reruns, so there is no error text behind this entry — only the
reproduction statistics above. Do not cite a mechanism for it that has not been
measured.

**What this means in practice.** A single red run of these specs is not
evidence of a regression. Before investigating, re-run the failing test in
isolation and re-run the full serial suite. Only treat it as real if it
reproduces. Conversely, do not use this entry to wave away a *consistent*
failure — the distinguishing property here is that it never reproduced under
any narrower invocation.

**Worth noting:** three separate sessions independently hit Playwright races in
this area, all of the form "the Active-States panel re-renders and detaches the
button mid-click" (fixed for both `activateFeature` and `deactivateFeature` by
click-then-verify via `isFeatureActive()`). This flake may be another member of
that family, but that is a hypothesis, not a finding.
