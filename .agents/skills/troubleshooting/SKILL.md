---
name: troubleshooting
description: "Diagnose and fix common errors across the 5etools project — site data/schema, character sheet, DM screen, and tests. Use when: encountering ReferenceError in tests, wrong ability scores or modifier calculations, stale UI after state changes, schema validation failures, save/load crashes, parser extracting wrong effects, spell edition mismatches (PHB vs XPHB), Builder/LevelUp/QuickBuild bugs, DM Screen DOM issues (.text() not working), TGTT homebrew feature leaking, double-counted modifiers, renderer errors (unhandled tags, dice expressions, array to renderer), data loading failures (missing strategies, orphan subraces), degraded mode / silent failures (module init, renderer fallback, stale attack IDs), or any error/bug investigation in the codebase."
---

# Troubleshooting — Common Errors & Fixes

## When to Use

- Encountering errors, crashes, or unexpected behavior in the 5etools codebase
- Debugging failing tests or false-green tests
- Investigating wrong calculations (AC, ability scores, DCs, spell slots)
- Fixing save/load migration issues with old character data
- Resolving schema validation failures
- Diagnosing stale UI, missing features, or parser detection errors
- Fixing DM Screen DOM issues
- Investigating TGTT homebrew feature leaking or source gating problems

## Before You Start

Load the detailed reference for the error category you're dealing with:

| Error Category | Reference |
|----------------|-----------|
| Test failures, import errors, weak assertions, Jest infrastructure | [Common Errors §A](./references/common-errors.md#a-test-errors) |
| State management: ability scores, reactive UI, save/load, migrations | [Common Errors §B](./references/common-errors.md#b-state-management-errors) |
| Data/schema: additionalProperties, item values, monster shape, tags | [Common Errors §C](./references/common-errors.md#c-data--schema-errors) |
| Feature calculations: level-gating, DC formulas, naming conventions | [Common Errors §D](./references/common-errors.md#d-feature-calculation-errors) |
| UI/DOM: .text() vs .txt(), jQuery vs vanilla, imperative rendering | [Common Errors §E](./references/common-errors.md#e-ui--dom-errors) |
| Parser/detection: d100 tables, spell choice types, dialect confusion | [Common Errors §F](./references/common-errors.md#f-parser--feature-detection-errors) |
| Builder/LevelUp/QuickBuild: duplicated logic, missing fields, crashes | [Common Errors §G](./references/common-errors.md#g-builder--levelup--quickbuild-errors) |
| DM Screen: serialization, board events, TGTT gating | [Common Errors §H](./references/common-errors.md#h-dm-screen-errors) |
| TGTT homebrew: source gating, combat traditions, specialties | [Common Errors §I](./references/common-errors.md#i-tgtt-homebrew-errors) |
| Renderer: unhandled tags, array errors, style hints, cross-refs, dice | [Common Errors §J](./references/common-errors.md#j-renderer--site-code-errors) |
| Data loading: strategy not found, reference resolution, orphan subraces | [Common Errors §K](./references/common-errors.md#k-data-loading-errors) |
| Degraded mode: module init failure, renderer fallback, silent cancellations | [Common Errors §L](./references/common-errors.md#l-degraded-mode--silent-failure-patterns) |
| Quick symptom → first-check lookup table | [Common Errors §M](./references/common-errors.md#m-debugging-quick-reference) |

## Procedure

### 1. Identify the Error Category

Match the symptom to a category:

| Symptom | Category |
|---------|----------|
| `ReferenceError` in Jest | **A1** — Import order wrong |
| Tests pass but don't verify mechanics | **A2** — Weak assertions |
| Wrong ability score / modifier | **B1** — Base vs total confusion |
| UI doesn't update after state change | **B2** — No reactive UI, forgot `render()` |
| Old save crashes on load | **B3** — Missing migration defaults |
| Schema validation rejects data | **C1** — `additionalProperties: false` |
| Tag renders as plain text | **C7** — Missing braces in `{@tag}` |
| Feature doesn't appear at right level | **D1** — Class level vs character level |
| DM Screen text not showing | **E1** — `.text()` doesn't work |
| Parser grabs wrong effect | **F1** — Table content not stripped |
| Spell missing from picker | **F4** — `fromSubclass` not checked |
| Builder bug not in LevelUp | **G1** — Duplicated logic across modules |
| TGTT features on non-TGTT character | **I1** — Missing source gating |
| `Unhandled tag` error in renderer | **J1** — Check tag name spelling |
| `Array passed to renderer!` | **J2** — Wrap array in entries object |
| Hover shows "Failed to load" | **K2** — Reference resolution failure |
| Part of sheet broken, no crash | **L1** — Module init try-catch isolated |
| Active state does nothing when toggled | **L4** — State type not in `ACTIVE_STATE_TYPES` |

### 2. Read the Detailed Fix

Open [common-errors.md](./references/common-errors.md) and navigate to the specific error code (e.g., **B1**, **F4**). Each entry has: symptom, root cause, and fix with code examples.

### 3. Apply and Verify

- For **test errors**: Run the specific test file with `NODE_OPTIONS='--experimental-vm-modules' npx jest CharacterSheet{Name} --no-coverage --forceExit`
- For **state/calculation errors**: Write a test that reproduces the bug FIRST, then fix
- For **data errors**: Run schema validation after editing
- For **Builder/LevelUp/QuickBuild**: Check all three modules for the same pattern

## Pitfalls

- **Ability scores have TWO fields** — `_data.abilities` (base) and `_data.abilityBonuses` (bonuses). Use `getAbilityScore()` for total, never read base directly.
- **PHB vs XPHB spells can differ mechanically** — Blade Ward concentration, True Strike targeting. Always match name AND source.
- **DM Screen uses vanilla DOM, character sheet uses jQuery** — `.text()` works in jQuery but NOT in the DM Screen toolkit. Use `.txt()` or `.textContent`.
- **`getFeatureCalculations()` is expensive** — Call once per test, assert on the returned object. Not memoized.
- **Three parallel progression modules** — Builder, LevelUp, QuickBuild share logic. A bug in one likely exists in all three.
- **`additionalProperties: false` in all schemas** — One unknown field = validation failure. Check schema before adding properties.
- **Save/load needs backward-compatible defaults** — New state fields must have defaults in `loadFromJson()` or old saves crash.
- **TGTT homebrew is gated by settings** — Always check `settings.enableTgtt` and `classSource === "TGTT"` before applying TGTT mechanics.
- **Import order matters in tests** — Dependencies must be imported BEFORE the module under test. Modules assign to `globalThis`.
- **`"entries"` not `"entry"`** — Most common typo in data files. The entry type is always plural.
- **Array to renderer is deferred** — Error thrown via `setTimeout`, won't crash immediately but console shows it. Always wrap arrays in `{type: "entries", entries: [...]}`.
- **Renderer has fail-fast philosophy** — ~99% of errors throw immediately. The few that don't are deferred via `setTimeout` — check console for both sync and async errors.
- **Feat→spell granting is a separate pipeline** — `additionalSpells` on feats is parsed by `SpellGrantParser`, not the main feature parser. Missing cantrips often means this pipeline wasn't invoked.
