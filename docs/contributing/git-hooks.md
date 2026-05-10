# Git Hooks

This fork installs two git hooks via [Husky](https://typicode.github.io/husky/)
to keep regressions out of the **character sheet**, **DM Screen**, and
**TGTT/Thelemar homebrew** surfaces. Hooks are wired up automatically by the
`prepare` npm script — running `npm install` is enough.

## Tier overview

| Hook | When | What runs | Typical time |
|---|---|---|---|
| **pre-commit** | every `git commit` | lint-staged + jest related-tests | seconds–~30 s |
| **pre-push** | every `git push` | full eslint + stylelint + jest + data validation (+ optional E2E) | ~3–5 min (+2–3 min E2E) |

## pre-commit

Orchestrated by [`scripts/hooks/run-precommit.mjs`](../../scripts/hooks/run-precommit.mjs).

1. **`lint-staged`** runs only on the staged set:
   - `*.{js,cjs,mjs}` → `eslint --fix --no-warn-ignored`
   - `*.scss`         → `stylelint --fix --allow-empty-input`
   - `data/**/*.json` → fast JSON syntax check (`scripts/hooks/check-json-syntax.mjs`)
2. **Docs-only short-circuit.** If every staged path is under `docs/`, `.agents/`,
   `*.md`, or other doc files, jest is skipped (lint-staged still ran).
3. **`jest --findRelatedTests`** over staged JS files. Picks up character-sheet,
   DM-screen, parser, renderer, and TGTT tests automatically based on imports.
4. **TGTT broad pass.** If `js/tgtt-filter.js` or any
   `test/jest/charactersheet/*TGTT*.test.js` is staged, also runs
   `jest --testPathPattern=TGTT`. The filter is brittle, so we re-run all TGTT
   tests when it's touched.

## pre-push

Orchestrated by [`scripts/hooks/run-prepush.mjs`](../../scripts/hooks/run-prepush.mjs).
Each step short-circuits the push on failure.

1. `npm run test:js`        — full eslint
2. `npm run test:css:lint`  — full stylelint
3. `npm run test:unit`      — full jest suite (≈4,175+ tests)
4. `npm run test:data`      — schema/tag/multisource/foundry data validation
5. **(opt-in)** Playwright — see below.

## Opting into Playwright on pre-push

E2E is **off by default** because Playwright takes 2–3 min for the smoke subset
and 10–20+ min for the full suite. Two opt-ins:

```bash
RUN_E2E=1 git push          # smoke subset (5 specs, ~2-3 min)
RUN_E2E_FULL=1 git push     # full Playwright suite (10-20+ min)
```

The smoke subset (`scripts/hooks/run-e2e-smoke.mjs`) covers:

- `builder-wizard.spec.ts` — character creation
- `levelup.spec.ts`        — most state-heavy interaction
- `overview-tab.spec.ts`   — renders nearly every state field
- `combat.spec.ts`         — HP, attacks, conditions, death saves
- `tgtt-bladesinger-wizard-tabaxi.spec.ts` — proves TGTT homebrew layer loads

## Bypassing hooks

Use sparingly — these hooks exist because there is no CI test runner.

```bash
git commit --no-verify        # skip pre-commit once
git push   --no-verify        # skip pre-push once
HUSKY=0 git commit            # disable all husky hooks for one command
```

## Troubleshooting

- **"jest: command not found"** — run `npm install`. Husky hooks rely on local
  `node_modules`.
- **Hook didn't run after `git clone`** — make sure `npm install` finished
  successfully (it triggers the `prepare` script, which sets `core.hooksPath`).
  Check with `git config --get core.hooksPath` (should be `.husky/_`).
- **Hook is too slow** — check what's staged. `jest --findRelatedTests` over a
  large set of touched modules can pull in many test files. Stage smaller
  commits or use `--no-verify` for WIP intermediate commits.
- **Pre-commit fails on a test that's irrelevant to your change** — this means
  jest's import graph found a real coupling. Investigate before bypassing.
- **`lint-staged` complains about an ignored file** — eslint config ignores
  certain paths; the `--no-warn-ignored` flag suppresses warnings, but if a
  staged file genuinely shouldn't be linted, add it to `eslint.config.mjs`'s
  ignore list rather than bypassing the hook.

## Files involved

```
.husky/
  pre-commit                  # one-line entry that calls run-precommit.mjs
  pre-push                    # one-line entry that calls run-prepush.mjs
scripts/hooks/
  lib-staged-files.mjs        # shared: list/classify staged files
  check-json-syntax.mjs       # lint-staged: parse-only JSON check
  run-related-jest.mjs        # jest --findRelatedTests + TGTT pass
  run-precommit.mjs           # pre-commit orchestrator
  run-prepush.mjs             # pre-push orchestrator
  run-e2e-smoke.mjs           # Playwright smoke subset
package.json                  # husky + lint-staged devDeps; lint-staged config
```
