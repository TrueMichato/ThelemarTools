---
name: e2e-character-tests
description: "Author and maintain end-to-end Playwright tests for 5etools character builds (test/e2e/specs/tgtt-*.spec.ts and the shared characterSpecFactory). Use whenever the user asks to write, extend, or debug E2E character tests, comprehensive build tests, level-up flows in Playwright, builder-wizard tests, or 'add a test for the X class build'. Covers the CharacterSpec / MulticlassCharacterSpec interfaces, the seven generated tests per spec (L1 / L3 / L5 / L5-loadout / MEGA L1-20 / USE probes / export round-trip), the new Phase-4 probes (skill rolls, short rest, concentration, death saves, conditions, feat abilities, multiclass usage-after-each-leg), the page-object API (CharacterBuilderPage, LevelUpPage, CharacterSheetPage), the picker-bypass and wizard-guard rules established in Phase 3, and the troubleshooting heuristics for telling infra failures (modal races, 'Target page closed', autoFill timing) apart from real product bugs (CS-BUG-NNN entries in docs/charactersheet/known-bugs.md)."
---

# E2E Character Tests

Use this skill whenever a task involves writing, extending, or debugging
the comprehensive Playwright character-build tests in
`test/e2e/specs/tgtt-*.spec.ts`.  These specs are generated from a shared
factory that drives the full creation → level-up → loadout → usage path
through the real Character Sheet UI.  The goal is to catch ~95% of the
problems a player would hit when building one of the canonical TGTT
character archetypes.

## When this skill applies

- A new TGTT character build needs an end-to-end test (e.g. user says
  "add an E2E test for X / Y class").
- An existing spec needs new probes (cast a spell, use a resource, roll a
  skill, take a rest, apply a condition…).
- A flaky or red E2E test must be triaged into either a real product bug
  or a test-infra fix.
- The page objects (`CharacterSheetPage`, `LevelUpPage`,
  `CharacterBuilderPage`) need extending with a new probe.
- The standard required-checks list needs to grow.

## What to do first

1. Read **`references/standard.md`** — the authoritative numbered
   required-checks list.  Every new spec must line up with it.
2. Read **`references/spec-template.md`** — copy-paste template plus the
   10-step authoring checklist.
3. Read **`references/page-objects.md`** if you need to know which
   page-object method does what.
4. Read **`references/factory-tests.md`** if you need to know how the
   factory expands `CharacterSpec` into individual tests.
5. Read **`references/troubleshooting.md`** before declaring any failure
   "real" — most infra-side reds have been seen before and have known
   workarounds.

## File layout

```
test/e2e/
├── specs/
│   ├── tgtt-<archetype>.spec.ts   ← thin spec files; one CharacterSpec each
│   └── …
├── pages/
│   ├── CharacterBuilderPage.ts    ← creation wizard driver
│   ├── LevelUpPage.ts             ← level-up wizard driver
│   └── CharacterSheetPage.ts      ← reads + UI interactions on the sheet
└── utils/
    ├── characterSpecFactory.ts    ← describeCharacter / describeMulticlassCharacter
    ├── characterBuilder.ts        ← createCharacterViaWizard, levelUpTo
    ├── comprehensiveBuildHelpers.ts  ← assertMilestone, probeToggleDelta, …
    ├── homebrewLoader.ts          ← gotoWithThelemar, clearHomebrewStorage
    └── waitHelpers.ts
```

## Critical rules

- **Use the factory.**  Spec files should be thin: import the factory,
  declare a `CharacterSpec`, done.  Don't open-code level-up loops in a
  spec; that breaks the standard checklist and the timeouts.
- **No blind spots.**  Every spec includes **explicit** checks for every
  feature picked, every milestone hit, every loadout change, every
  signature toggle, every specialty pick, every mastery pick, and every
  battle-tactic pick (and the parallel Metamagic / Invocation /
  Jester Act / Trickster Trick / Precise Strike / Pact Boon /
  Dreamwalker pickers).  **Use the `build*Checks` helpers** in
  [`test/e2e/utils/tgttFeaturePools.ts`](../../../test/e2e/utils/tgttFeaturePools.ts)
  to stay DRY — they emit the matrix rows AND attach per-pick
  `pickedFeatureGrants` effects for the auto-picker's first choice.
  Don't open-code pools or per-pick probes when a helper exists.
- **Skip with `{skip: true}` rather than dropping a probe.**  The spec
  file should always show the standard's full surface area, even when a
  particular mechanic doesn't apply — coverage gaps must be visible.
- **Real product bugs go to `docs/charactersheet/known-bugs.md`.**  Add a
  `CS-BUG-NNN` entry, set the affected probe to `{skip: true}` with a
  `// blocked by CS-BUG-NNN` comment, and re-run the suite.  Don't paper
  over a product bug with looser assertions.
- **Wizard-guard rule (Phase 3).**  `pHandleLevelUpClassPicker` only
  fires when the wizard isn't already visible.  If you touch
  `levelUpTo`, preserve that guard or single-class level-ups will time
  out.
- **Picker-bypass for multiclass.**  `levelUpTo({targetClassName})`
  goes through `cs._levelUp.showLevelUp(className)` directly and skips
  the picker entirely.  This is the only reliable way to drive the
  secondary class.
- **Conservative DOM-mutation timings.**  ~200-400 ms inter-click waits
  are correct for accordion bodies that re-render via setTimeout.  Don't
  shorten them speculatively — empirical races have caught us before.

## Running the suite

```bash
# All specs, full coverage including MEGA L1-20:
RUN_MEGA=1 npx playwright test test/e2e/specs/tgtt-*.spec.ts \
  --reporter=list --workers=2

# Single spec, fast (no MEGA):
npx playwright test test/e2e/specs/tgtt-time-domain-cleric.spec.ts

# A single test by name:
npx playwright test -g "Time Domain Cleric.*L5"

# Inspect last run's report:
npx playwright show-report
```

Acceptance bar after any factory or page-object change: rerun the full
suite; remaining failures must all map to entries in
`docs/charactersheet/known-bugs.md`.

## Artifacts (post-test JSON export)

Every generated test (single-class L1/L3/L5/L5-loadout/MEGA/USE/round-trip
plus the multiclass plan test) auto-dumps `cs._state.toJson()` to:

```
test-results/exports-for-validation/<display-slug>/<test-title-slug>--<status>.json
```

on both pass and fail. Wired in
[`characterSpecFactory.ts`](../../../test/e2e/utils/characterSpecFactory.ts)
(`_exportCharacterForValidation`) as the last-registered `afterEach`
(Playwright runs them LIFO, so the export reads state BEFORE
`clearHomebrewStorage` wipes IndexedDB). Failures are logged and
swallowed — the export never turns a green test red. Use the dropped
JSON to manually load a build into the live sheet for visual /
rendering validation that the suite can't probe directly.

## See also

- [`docs/e2e/comprehensive-test-standard.md`](../../../docs/e2e/comprehensive-test-standard.md)
  — reader-facing pointer to this skill.
- [`docs/charactersheet/known-bugs.md`](../../../docs/charactersheet/known-bugs.md)
  — running list of product bugs surfaced by the suite.
- [`charactersheet-development`](../charactersheet-development/SKILL.md)
  skill — for state/render/feature-calc questions inside the sheet
  itself.
