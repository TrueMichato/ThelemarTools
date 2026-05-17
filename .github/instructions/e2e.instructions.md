---
applyTo: "test/e2e/**/*.ts,docs/e2e/**/*.md"
description: "Instructions for authoring and maintaining the comprehensive Playwright character-build E2E suite (test/e2e/specs/tgtt-*.spec.ts). Enforces the required-checks standard, the spec-template + 10-step authoring checklist, the page-object boundary, and the infra-vs-product-bug discipline."
---

# E2E Character Tests Instructions

## When this applies

Any change under `test/e2e/` — new TGTT character spec, factory
extension, page-object method, helper utility, or a documentation
update under `docs/e2e/`.

## Use the dedicated skill

Invoke the `e2e-character-tests` skill before writing any E2E spec.
It defines the required-checks standard, the spec template, the
page-object API surface, and the infra-vs-product-bug troubleshooting
heuristics.  Reader-facing entry point:
`docs/e2e/comprehensive-test-standard.md`.

Reference docs (read what applies):

- `.agents/skills/e2e-character-tests/references/standard.md` — the 18
  numbered required checks every comprehensive spec must hit.
- `.agents/skills/e2e-character-tests/references/spec-template.md` —
  copy-paste template plus the 10-step authoring checklist.
- `.agents/skills/e2e-character-tests/references/page-objects.md` —
  every public page-object method and when to use it.
- `.agents/skills/e2e-character-tests/references/factory-tests.md` —
  how `CharacterSpec` becomes individual tests; the coverage map.
- `.agents/skills/e2e-character-tests/references/troubleshooting.md` —
  decision tree for telling infra failures apart from product bugs.

## Hard rules

- **Specs are thin.** A `tgtt-*.spec.ts` file declares one
  `CharacterSpec` (or `MulticlassCharacterSpec`) and calls
  `describeCharacter` / `describeMulticlassCharacter`. No open-coded
  level-up loops. No raw locators. No `page.evaluate` in spec files.
- **No blind spots.** Every spec includes explicit checks for every
  feature picked, every milestone hit, every loadout change, every
  signature toggle, every specialty pick, every mastery pick, and
  every battle-tactic pick (plus the parallel Metamagic / Invocation
  / Jester Act / Trickster Trick / Precise Strike / Pact Boon /
  Dreamwalker pickers). Use the `build*Checks` helpers in
  `test/e2e/utils/tgttFeaturePools.ts` to stay DRY — they attach
  per-pick `pickedFeatureGrants` effects automatically. Don't
  open-code pools when a helper exists.
- **Coverage gaps stay visible.** Every spec must list every standard
  check; opt out with `{skip: true}` plus a one-line reason
  (`// monks have no concentration spell`, `// blocked by CS-BUG-NNN`).
- **Real product bugs go to known-bugs.md.** Add `CS-BUG-NNN` to
  `docs/charactersheet/known-bugs.md`, set the probe to `{skip: true}`
  with `// blocked by CS-BUG-NNN`, and keep moving. Do **not** loosen
  assertions to paper over a product bug.
- **DOM goes through page objects.** New probes extend
  `CharacterSheetPage` / `LevelUpPage` / `BuilderWizardPage`, then the
  factory or spec calls them. If you write `page.evaluate(...)` in a
  spec, it belongs in a page object instead.
- **Preserve Phase-3 invariants.**
  - `pHandleLevelUpClassPicker` only fires when the wizard is NOT
    already visible (single-class regression guard).
  - Multiclass entry uses `cs._levelUp.showLevelUp(className)` direct
    when `targetClassName` is set.
  - DOM-mutation waits stay around 200-400 ms for accordion bodies;
    prefer state-stable polling (`waitForFunction(() => stable)`) over
    fixed `waitForTimeout` for new flows.

## Artifacts

The factory auto-exports the final `cs._state.toJson()` for every
generated test (pass AND fail) to
`test-results/exports-for-validation/<display-slug>/<title-slug>--<status>.json`.
This is wired in `characterSpecFactory.ts` (`_exportCharacterForValidation`)
as the last-registered `afterEach` so Playwright's LIFO order runs it
before `clearHomebrewStorage` wipes IndexedDB. Use these dumps for
manual validation of anything the suite can't probe directly. Don't
duplicate the hook in spec files.

## Before opening a PR

- Run the touched spec(s):
  ```bash
  npx playwright test test/e2e/specs/tgtt-<file>.spec.ts --reporter=list
  RUN_MEGA=1 npx playwright test test/e2e/specs/tgtt-<file>.spec.ts --reporter=list
  ```
- For factory or page-object changes, re-run the full suite:
  ```bash
  RUN_MEGA=1 npx playwright test test/e2e/specs/tgtt-*.spec.ts \
    --reporter=list --workers=2
  ```
- Acceptance bar: every remaining red maps to a `CS-BUG-NNN` entry in
  `docs/charactersheet/known-bugs.md`.
