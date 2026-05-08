---
applyTo: "charactersheet.html,js/charactersheet/**/*.js,test/jest/charactersheet/**/*.js,css/charactersheet*.css,scss/charactersheet*.scss,docs/charactersheet/**/*.md,CHARACTERSHEET_TEST_AUDIT.md,LEVELUP_REFACTOR_MAP.md"
description: "Instructions for 5etools character sheet work with emphasis on generic architecture-first solutions, polished UI/UX, and synchronized tests/docs/reference updates."
---

# Character Sheet Instructions

## Primary Goals

- Prefer generic, reusable solutions over one-off fixes. If a bug or feature pattern can be solved in a shared parser, helper, registry, state calculation, or renderer path, do that instead of adding another special case.
- Use the existing character sheet architecture before creating new abstractions. Extend current modules, state flows, helper utilities, effect registries, and CSS conventions unless there is a clear architectural gap.
- Treat UI quality and UX quality as first-class requirements. Character sheet changes should feel intentional, readable, responsive, and free of dead ends, stale state, or confusing interactions.
- Keep tests, documentation, and reference files in sync with code changes. Character sheet work is not complete until the behavior is verified and the maintenance surface is updated.

## Architecture-First Rules

- Read the relevant reference before editing:
  - `.agents/skills/charactersheet-development/references/architecture.md`
  - `.agents/skills/charactersheet-development/references/feature-calculations.md`
  - `.agents/skills/charactersheet-development/references/testing-guide.md`
  - `.agents/skills/charactersheet-development/references/development-status.md`
  - `.agents/skills/charactersheet-development/references/subsystem-details.md`
- Respect the current architecture: `CharacterSheetState` is the source of truth, modules render manually, and shared logic should usually live in existing helpers such as `CharacterSheetClassUtils`, `CharacterSheetSpellPicker`, parser utilities, or effect registries.
- Before adding a new helper, module, registry, or state field, check whether an existing one can be extended cleanly.
- Prefer data-driven and rules-driven implementations over hardcoded name checks when practical.
- If a rule must be class-specific or feature-specific, keep the special case narrow and place it beside the related existing logic rather than scattering it across modules.
- Do not create parallel systems for state, rendering, feature calculation, or effect application.
- Preserve backward compatibility for saved characters. If new state is introduced, ensure load/migration/default behavior is handled.

## Generic Solution Bias

- When the same logic could apply to multiple classes, subclasses, spells, items, or active states, extract the shared behavior instead of duplicating branches.
- Prefer improving parsers, `getFeatureCalculations()`, `FeatureEffectRegistry`, active state definitions, shared render helpers, or class utilities before writing repetitive per-feature code.
- Avoid tightly coupling UI fixes to a single class or subclass if the root issue is a general rendering or state update problem.
- If duplication is unavoidable, document why the generic path was not appropriate.

## UI And UX Standards

- Preserve and improve the existing visual language instead of introducing unrelated styles. Use the current character sheet structure, utility classes, BEM-like naming, and stylesheet organization.
- New UI should feel polished, not merely functional. Prioritize clear hierarchy, spacing, readable copy, sensible grouping, and good mobile behavior.
- UX must be explicit and reliable:
  - no stale UI after state changes
  - no controls that appear interactive but do nothing
  - no hidden destructive actions
  - no ambiguous labels or vague toasts
  - no flows that strand the user without a recovery path
- Favor graceful handling of missing data, partial data, and invalid input. Fail soft where possible and surface actionable feedback.
- Preserve responsiveness and accessibility basics: keyboard reachability where applicable, visible state changes, logical focus behavior, and text that is understandable without reading the code.
- When editing dialogs, builders, level-up flows, spell pickers, or combat controls, think through the full interaction path, not just the triggering click handler.

## Testing Requirements

- Update or add tests for every character sheet behavior change.
- Prefer targeted assertions on computed behavior, state transitions, rendered outcomes, or effect application. Avoid shallow assertions that only prove setup happened.
- Follow the existing Jest import pattern for browser-global modules. Import dependencies explicitly when needed before importing the module under test.
- Run the most relevant targeted suites first, then broader related suites when the change touches shared architecture such as:
  - `charactersheet-state.js`
  - `charactersheet-class-utils.js`
  - active state logic
  - feature calculations
  - builder, level-up, or quick build shared flows
- If a bug fix does not include a regression test, explain why not.

## Documentation And Reference Updates

- Update the closest relevant documentation whenever behavior, workflows, limitations, or architecture expectations change.
- Common documentation targets include:
  - `docs/charactersheet/`
  - `CHARACTERSHEET_TEST_AUDIT.md`
  - `LEVELUP_REFACTOR_MAP.md`
  - character sheet reference docs under `.agents/skills/charactersheet-development/references/`
- If the change adds or reshapes a reusable pattern, update the reference material so later agents can follow the same approach.
- If a limitation is removed or a workflow becomes supported, update the corresponding limitation or roadmap document.

## Implementation Checklist

- Confirm the change uses the existing architecture before introducing anything new.
- Check whether the solution can be made generic or shared.
- Verify all affected modules re-render correctly after state changes.
- Review the UI in context, including empty states, edge cases, and mobile width behavior where relevant.
- Add or update regression tests.
- Update docs and reference files that describe the touched behavior.
- Keep comments and code organization concise and maintainable.

## Comprehensive E2E Coverage

- The Playwright suite at `test/e2e/specs/tgtt-*.spec.ts` is the safety net for player-facing character sheet behavior. Treat it as required coverage, not an afterthought.
- When adding or extending a class, subclass, feat, race, or active-state mechanic that a player would encounter in normal play, verify it is exercised by the relevant TGTT character spec — and add probes if it is not.
- When authoring or extending an E2E character build spec, **invoke the `e2e-character-tests` skill** and follow `.agents/skills/e2e-character-tests/references/standard.md`. Every spec must hit (or explicitly `{skip: true}` with a one-line reason) every numbered required check.
- New product bugs surfaced by the suite must be logged as `CS-BUG-NNN` entries in `docs/charactersheet/known-bugs.md`; the affected probe must be skipped with `// blocked by CS-BUG-NNN`. Do not loosen E2E assertions to make red go green over a real bug.

## Preferred Outcome

Agents working on the character sheet should leave the codebase with less duplication, better reuse of existing systems, stronger tests, clearer docs, and a more polished user experience than they found.